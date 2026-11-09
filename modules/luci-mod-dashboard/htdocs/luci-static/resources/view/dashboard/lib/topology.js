'use strict';
'require baseclass';
'require network';
'require rpc';

const callAttachments = rpc.declare({ object: 'luci.dashboard', method: 'topology', expect: { '': {} } });

function text(value) {
	return typeof(value) === 'string' ? value.trim() : '';
}

function macAddress(value) {
	const mac = text(value).toUpperCase();
	return /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) &&
		mac !== '00:00:00:00:00:00' && !(parseInt(mac, 16) & 1) ? mac : null;
}

// Compare IPv6 addresses independently of compression, case and prefix length.
// This is only an identity key; preserve the supplied spelling for display.
function addressKey(value) {
	const address = text(value).replace(/\/\d+$/, '').toLowerCase();
	const ipv4 = address.split('.');
	if (ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) < 256))
		return ipv4.map(Number).join('.');
	if (!address.includes(':'))
		return null;

	const scoped = address.split('%');
	if (scoped.length > 2)
		return null;
	let ip = scoped[0];
	if (ip.includes('.')) {
		const end = ip.lastIndexOf(':');
		const tail = ip.slice(end + 1).split('.');
		if (tail.length !== 4 || !tail.every(part => /^\d{1,3}$/.test(part) && Number(part) < 256))
			return null;
		ip = ip.slice(0, end + 1) + ((Number(tail[0]) << 8) | Number(tail[1])).toString(16) + ':' +
			((Number(tail[2]) << 8) | Number(tail[3])).toString(16);
	}
	const halves = ip.split('::');
	if (halves.length > 2)
		return null;
	const left = halves[0] ? halves[0].split(':') : [];
	const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const words = left.concat(right);
	if (!words.every(part => /^[0-9a-f]{1,4}$/.test(part)) ||
		(halves.length === 1 ? words.length !== 8 : words.length >= 8))
		return null;
	const expanded = halves.length === 2 ? left.concat(Array(8 - words.length).fill('0'), right) : words;
	return expanded.map(part => parseInt(part, 16).toString(16)).join(':') + (scoped[1] ? '%' + scoped[1] : '');
}

function addresses(values) {
	return Array.isArray(values) ? values.map(text).filter(value => addressKey(value)) : [];
}

// Hostnames are hints, not device fingerprints. Only explicit product/type
// names select a specific icon; vendor names and MAC addresses stay generic.
const CLIENT_ICON_HINTS = [
	[ 'watch', /(?:^|[^a-z0-9])(?:apple[-_. ]?watch|galaxy[-_. ]?watch|pixel[-_. ]?watch|smartwatch|watch)[0-9]*(?=$|[^a-z0-9])|手表/i ],
	[ 'tablet', /(?:^|[^a-z0-9])(?:ipad(?:air|mini|pro)?|tablet|galaxy[-_. ]?tab|(?:xiaomi|redmi|oneplus|honor|iqoo)[-_. ]?pad|pad)[0-9]*(?=$|[^a-z0-9])|平板/i ],
	[ 'computer', /(?:^|[^a-z0-9])(?:macbook(?:air|pro)?|imac|macmini|macstudio|mac|thinkpad|laptop|notebook|desktop|computer|pc)[0-9]*(?=$|[^a-z0-9])|电脑|笔记本/i ],
	[ 'phone', /(?:^|[^a-z0-9])galaxy[-_. ]?(?:(?:[samf]|note)[-_. ]?[0-9]+(?:fe|plus|ultra)?|z[-_. ]?(?:flip|fold)[-_. ]?[0-9]*)(?=$|[^a-z0-9])/i ],
	[ 'phone', /(?:^|[^a-z0-9])(?:iqoo[-_. ]?(?:(?:neo|z)[-_. ]?)?|pixel[-_. ]?|redmi[-_. ]?note[-_. ]?)[0-9]+(?:pro|plus)?(?=$|[^a-z0-9])/i ],
	[ 'phone', /(?:^|[^a-z0-9])(?:iphone[0-9]*(?:mini|plus|pro|max)*|(?:smartphone|phone)[0-9]*)(?=$|[^a-z0-9])|手机/i ]
];

function clientIcon(name) {
	const hostname = text(name);
	for (const [ icon, pattern ] of CLIENT_ICON_HINTS)
		if (pattern.test(hostname))
			return icon;
	return 'device';
}

function byId(a, b) {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function names(values) {
	return Array.isArray(values) ? Array.from(new Set(values.map(text).filter(Boolean))) : [];
}

function modeLabel(mode) {
	if (mode === 'ap' || mode === 'ap-wds')
		return _('Access point');
	if (mode === 'sta' || mode === 'sta-wds')
		return _('Wireless uplink');
	if (mode === 'mesh')
		return _('Mesh peers');
	return _('Wireless peers');
}

return baseclass.extend({
	loadConnections() {
		// These share network.js's cached netifd/host snapshot with other widgets.
		return Promise.all([
			L.resolveDefault(network.getNetworks(), null),
			L.resolveDefault(network.getHostHints(), null),
			L.resolveDefault(network.getDevices(), []),
			L.resolveDefault(callAttachments(), null)
		]).then(data => this.collectConnections(data));
	},

	collectConnections([ interfaces, hints, devices, observations ]) {
		const localMACs = new Set(devices.map(dev => dev.getMAC()?.toUpperCase()).filter(Boolean));
		const deviceData = dev => ({
			id: dev.getName?.(), type: dev.getType?.(),
			devtype: dev.dev?.devtype, parent: dev.getParent?.()?.getName() || dev.dev?.parent,
			mac: dev.getMAC?.()?.toUpperCase(),
			// getCarrier() turns a missing link record into false. Keep it unknown.
			carrier: typeof(dev.dev?.link?.carrier) === 'boolean' ? dev.dev.link.carrier : null,
			speed: dev.getSpeed?.() ?? null,
			duplex: dev.getDuplex?.() ?? null
		});
		return {
			observations: observations || null,
			devices: devices.map(deviceData).filter(dev => dev.id),
			interfaces: interfaces?.filter(net => net.getName() !== 'loopback' && net.getL3Device()?.getName() !== 'lo').map(net => {
				const dev = net.getL3Device() || net.getDevice();
				return {
					id: net.getName(), name: net.getName(), device: dev?.getName() || '',
					physicalDevice: net.getDevice()?.getName() || '',
					protocol: net.getProtocol(), type: dev?.getType() || '',
					virtual: net.isVirtual(), up: net.isUp(),
					addresses: net.getIPAddrs().concat(net.getIP6Addrs()),
					members: (dev?.getPorts() || []).map(port => port.getName()),
					ports: (dev?.getPorts() || []).map(deviceData),
					gateways: [ net.getGatewayAddr(), net.getGateway6Addr() ].filter(value => value && value !== '0.0.0.0' && value !== '::')
				};
			}) || null,
			hosts: hints ? Object.entries(hints.hosts || {}).filter(([ mac ]) => !localMACs.has(mac.toUpperCase())).map(([ mac, hint ]) => ({
				mac: mac.toUpperCase(), name: hint.name || mac,
				addresses: L.toArray(hint.ipaddrs || hint.ipv4).concat(L.toArray(hint.ip6addrs || hint.ipv6))
			})).sort((a, b) => a.mac.localeCompare(b.mac)) : null
		};
	},

	buildModel(snapshot) {
		const source = snapshot || {};
		const router = source.router || {};
		const connections = source.connections || {};
		const wifi = source.wifi || {};
		const groups = new Map();
		const radios = new Map();
		const upstreams = new Map();
		const observedMACs = new Set();
		const memberIds = new Set();
		const interfaces = Array.isArray(connections.interfaces) ? connections.interfaces : [];
		const observations = connections.observations || {};
		const devices = new Map((connections.devices || []).map(device => [ device.id, device ]));
		const localMACs = new Set([ ...(connections.devices || []).map(device => device.mac), ...(observations.localMACs || []) ].map(macAddress).filter(Boolean));
		const accessFor = (group, id, data) => {
			group.access ||= [];
			let access = group.access.find(item => item.id === id);
			if (!access) {
				access = Object.assign({ id, members: [], relation: 'logical' }, data);
				group.access.push(access);
			}
			return access;
		};

		for (const item of interfaces) {
			const name = text(item?.id);
			if (!name || name === 'loopback' || item.device === 'lo')
				continue;
			groups.set('net:' + name, {
				id: 'net:' + name, name: text(item.name) || name, icon: 'network',
				kind: 'logical', relation: 'logical', network: name,
				context: text(item.device) || text(item.protocol), active: item.up === true,
				device: item.device, type: item.type, protocol: item.protocol,
				members: [], wifiNetworks: [], errors: [], radios: 0, access: []
			});
		}

		// These are reported default-route links, not Internet reachability or
		// policy-routing decisions. Families share a reported device or interface identity.
		for (const item of Array.isArray(router.upstreams) ? router.upstreams : []) {
			if (!item || (item.family !== 4 && item.family !== 6))
				continue;
			const network = text(item.network), device = text(item.device);
			const gateway = addressKey(item.gateway);
			if (!network && !device)
				continue;
			const id = device ? 'device:' + device : 'network:' + network;
			if (!upstreams.has(id))
				upstreams.set(id, { id, device, names: [], families: [], states: [], gateways: [], gatewayAddresses: [], network, tab: 'internet', icon: 'internet' });
			const up = upstreams.get(id);
			if (network && !up.names.includes(network))
				up.names.push(network);
			if (!up.families.includes(item.family))
				up.families.push(item.family);
			up.states.push(item.up === true);
			if (gateway && ![ '0.0.0.0', '0:0:0:0:0:0:0:0' ].includes(gateway) && !up.gateways.includes(gateway)) {
				up.gateways.push(gateway);
				up.gatewayAddresses.push(text(item.gateway));
			}
		}
		for (const up of upstreams.values()) {
			for (const item of interfaces)
				if (item.protocol === 'dhcpv6' && up.device && item.device === up.device && !up.names.includes(item.id)) {
					up.names.push(item.id);
					if (!up.families.includes(6))
						up.families.push(6);
					up.states.push(item.up === true);
				}
			up.name = up.names.join(' / ') || up.id.slice(7);
			const state = up.states.every(Boolean) ? _('Link up') : up.states.some(Boolean) ? _('Mixed link state') : _('Link down');
			up.detail = up.families.sort().map(family => 'IPv' + family).join(' / ') + ' · ' + state;
			up.active = up.states.some(Boolean);
		}

		const wirelessGroup = radio => {
			const id = 'wifi:' + radio.id;
			if (!groups.has(id))
				groups.set(id, {
					id, name: radio.name, icon: 'wireless', kind: radio.ap ? 'wireless' : 'peer',
					relation: 'logical', tab: 'wifi', network: radio.id,
					context: [ modeLabel(radio.mode), radio.band ].filter(Boolean).join(' · '),
					active: radio.active, members: [], wifiNetworks: [], errors: [], radios: 0
				});
			return groups.get(id);
		};
		const groupFor = (radio, bindings) => {
			if (!radio.ap || bindings.length !== 1)
				return wirelessGroup(radio);
			const id = 'net:' + bindings[0];
			if (!groups.has(id))
				groups.set(id, {
					id, name: bindings[0], icon: 'network', kind: 'logical', relation: 'logical',
					tab: 'wifi', network: radio.id, context: _('Reported wireless binding'),
					active: radio.active, members: [], wifiNetworks: [], errors: [], radios: 0
				});
			return groups.get(id);
		};
		const linkRadio = (group, radio) => {
			accessFor(group, 'wifi:' + radio.id, {
				name: radio.name, icon: 'wireless', kind: 'wireless', active: radio.active,
				detail: [ modeLabel(radio.mode), radio.band, radio.known ? null : _('Data unavailable') ].filter(Boolean).join(' · ')
			});
			if (!group.wifiNetworks.includes(radio.id)) {
				group.wifiNetworks.push(radio.id);
				group.radios++;
				if (!radio.known)
					group.errors.push(radio.id);
			}
		};

		for (const item of Array.isArray(wifi.networks) ? wifi.networks : []) {
			const id = text(item?.id), mode = text(item?.mode) || 'ap';
			if (!id || radios.has(id) || mode === 'monitor')
				continue;
			const radio = {
				id, name: text(item.name) || id, device: text(item.device), mode, ap: mode === 'ap' || mode === 'ap-wds',
				band: text(item.band), active: item.active === true, known: item.clientsKnown !== false,
				bindings: names(item.interfaces)
			};
			radios.set(id, radio);
			linkRadio(groupFor(radio, radio.bindings), radio);
		}

		for (const item of Array.isArray(wifi.clients) ? wifi.clients : []) {
			const radio = radios.get(text(item?.network)), mac = macAddress(item?.mac);
			if (!radio || !radio.known || !mac)
				continue;
			const bindings = Array.isArray(item.interfaces) ? names(item.interfaces) : radio.bindings;
			const group = groupFor(radio, bindings);
			linkRadio(group, radio);
			const id = group.id + '|' + radio.id + '|' + mac;
			if (memberIds.has(id))
				continue;
			memberIds.add(id);
			observedMACs.add(mac);
			const ips = addresses(item.addresses), name = text(item.name);
			const associated = radio.mode === 'mesh' ? item.associated === true : item.associated !== false;
			group.members.push({
				id, name: name && name !== '?' ? name : mac, icon: radio.ap ? clientIcon(name) : 'router',
				tab: 'wifi', network: radio.id, mac, relation: associated ? 'observed' : 'unknown',
				access: 'wifi:' + radio.id, addresses: ips,
				detail: associated ? [ ips[0]?.replace(/\/\d+$/, '') || mac, radio.band ].filter(Boolean).join(' · ') : _('Peer state unknown'),
				context: [ radio.name, modeLabel(radio.mode), associated ? '' : _('Peer state unknown') ].filter(Boolean).join(' · ')
			});
		}

		// Netifd supplies membership and carrier information independently of Wi-Fi.
		const wirelessDevices = new Set(Array.from(radios.values()).map(radio => radio.device).filter(Boolean));
		for (const item of interfaces) {
			const group = groups.get('net:' + item.id);
			if (!group)
				continue;
			for (const port of item.ports || [])
				devices.set(port.id, port);
			const reported = (observations.bridges || []).find(bridge => bridge.device === item.device)?.members || [];
			const ports = names([ ...(item.members || []), ...reported ]);
			if (!ports.length && item.device && item.type !== 'bridge')
				ports.push(item.device);
			for (const name of ports) {
				const device = devices.get(name) || {};
				if (device.type === 'wifi' || wirelessDevices.has(name))
					continue;
				const kind = [ 'tunnel', 'wireguard', 'vlan', 'vrf', 'alias' ].includes(device.type || item.type) ? 'virtual' : 'port';
				const speed = Number(device.speed);
				accessFor(group, 'device:' + name, {
					name, device: name, kind, icon: kind === 'port' ? 'port' : 'network',
					active: device.carrier === null || device.carrier === undefined ? null : device.carrier,
					detail: [ kind === 'virtual' ? (item.protocol || _('Virtual interface')) : _('Network interface'),
						device.carrier === true ? _('Link up') : device.carrier === false ? _('Link down') : _('Link state unknown'),
						speed > 0 ? (speed >= 1000 ? speed / 1000 + ' Gbit/s' : speed + ' Mbit/s') : null ].filter(Boolean).join(' · ')
				});
			}
		}
		const assigned = new Set(interfaces.flatMap(item => [ item.device, item.physicalDevice, ...(item.members || []) ]));
		// DSA user ports report their CPU-facing parent. That parent is an
		// internal conduit, not an unused socket or another client network.
		const conduits = new Set(Array.from(devices.values()).filter(device => device.devtype === 'dsa' && device.parent).map(device => device.parent));
		for (const group of groups.values())
			for (const access of group.access || [])
				if (access.device)
					assigned.add(access.device);
		for (const device of devices.values()) {
			if (!device.id || device.id === 'lo' || assigned.has(device.id) || conduits.has(device.id) || ![ 'ethernet', 'switch', 'vlan', 'tunnel', 'wireguard' ].includes(device.type))
				continue;
			if (!groups.has('interfaces:unassigned'))
				groups.set('interfaces:unassigned', { id: 'interfaces:unassigned', name: _('Unassigned interfaces'), icon: 'port', kind: 'logical', relation: 'logical', context: _('Not assigned to a configured network'), members: [], wifiNetworks: [], errors: [], radios: 0, access: [] });
			accessFor(groups.get('interfaces:unassigned'), 'device:' + device.id, {
				name: device.id, device: device.id, kind: 'port', icon: 'port', active: device.carrier,
				detail: device.carrier === true ? _('Link up') : device.carrier === false ? _('Link down') : _('Link state unknown')
			});
		}

		const hosts = new Map();
		const remember = item => {
			const mac = macAddress(item?.mac);
			if (!mac || localMACs.has(mac))
				return null;
			let host = hosts.get(mac);
			if (!host) {
				host = { mac, name: mac, addresses: [] };
				hosts.set(mac, host);
			}
			if (text(item.name) && item.name !== '?' && item.name.toUpperCase() !== mac)
				host.name = item.name;
			for (const address of addresses(item.addresses || [ item.address ]))
				if (!host.addresses.some(existing => addressKey(existing) === addressKey(address)))
					host.addresses.push(address);
			return host;
		};
		for (const item of connections.hosts || [])
			remember(item);
		for (const item of observations.neighbours || [])
			remember(item);
		for (const bridge of observations.bridges || [])
			for (const entry of bridge.entries || [])
				remember(entry);

		const attach = (group, host, access, relation, evidence) => {
			if (!host || group.members.some(member => member.mac === host.mac))
				return;
			group.members.push({
				id: group.id + '|' + host.mac, mac: host.mac, name: host.name, icon: clientIcon(host.name),
				network: group.network, access, addresses: host.addresses.slice(), relation, tab: 'connections',
				detail: host.addresses[0]?.replace(/\/\d+$/, '') || host.mac, context: evidence
			});
			observedMACs.add(host.mac);
		};
		for (const bridge of observations.bridges || []) {
			const owners = Array.from(groups.values()).filter(group => group.device === bridge.device);
			if (!bridge.available || owners.length !== 1)
				continue;
			const group = owners[0], locations = new Map();
			for (const entry of bridge.entries || []) {
				const mac = macAddress(entry.mac);
				if (!mac || !group.access.some(access => access.id === 'device:' + entry.port))
					continue;
				if (!locations.has(mac))
					locations.set(mac, new Set());
				locations.get(mac).add(entry.port);
			}
			for (const [mac, ports] of locations) {
				if (ports.size === 1) {
					const port = Array.from(ports)[0];
					attach(group, hosts.get(mac), 'device:' + port, 'observed', _('Discovered via %s').format(port));
				}
				else {
					accessFor(group, 'unlocated', { name: _('Interface not identified'), icon: 'device', kind: 'unknown', detail: _('Network known; interface not identified') });
					attach(group, hosts.get(mac), 'unlocated', 'logical', _('Multiple interfaces reported'));
				}
			}
		}
		for (const neighbour of observations.neighbours || []) {
			const owners = Array.from(groups.values()).filter(group => group.device === neighbour.device);
			if (owners.length !== 1)
				continue;
			const group = owners[0];
			if (group.type !== 'bridge' && !group.radios && Array.from(upstreams.values()).some(up =>
				up.names.includes(group.network) && up.gateways.includes(addressKey(neighbour.address)))) {
				observedMACs.add(macAddress(neighbour.mac));
				continue;
			}
			if (group.members.some(member => member.mac === macAddress(neighbour.mac)))
				continue;
			accessFor(group, 'unlocated', { name: _('Interface not identified'), icon: 'device', kind: 'unknown', detail: _('Network known; interface not identified') });
			attach(group, hosts.get(macAddress(neighbour.mac)), 'unlocated', 'logical', _('Address observed on %s').format(neighbour.device));
		}

		for (const group of groups.values()) {
			for (const access of group.access || [])
				access.members = group.members.filter(member => member.access === access.id).sort(byId);
			group.members.sort(byId);
			const count = group.members.length;
			const quantity = group.kind === 'peer' ? _('%d reported peers').format(count) : _('%d wireless associations').format(count);
			group.detail = [ group.context, count ? quantity : group.errors.length ? _('Data unavailable') : group.active ? _('Link up') : _('Link down') ].filter(Boolean).join(' · ');
			group.summary = count ? quantity : group.errors.length ? _('Wireless association data unavailable.')
				: group.radios ? _('No wireless associations reported.') : _('Endpoint attachment not reported.');
			if (count && group.errors.length)
				group.summary += ' · ' + _('Some wireless data is unavailable.');
			const ports = group.access?.filter(access => access.kind === 'port' || access.kind === 'virtual') || [];
			if (ports.length || group.members.some(member => member.tab === 'connections')) {
				const devices = new Set(group.members.map(member => member.mac)).size;
				group.detail = [ group.context, ports.length ? _('%d interfaces').format(ports.length) : null, devices ? _('%d discovered devices').format(devices) : null ].filter(Boolean).join(' · ');
				group.summary = count ? _('%d discovered devices').format(count) : _('No endpoint attachment reported.');
			}
			if (group.kind === 'logical')
				group.detail = _('%d devices').format(new Set(group.members.map(member => member.mac)).size);
		}

		const unplaced = new Map();
		for (const item of hosts.values()) {
			const mac = macAddress(item?.mac), ips = addresses(item?.addresses);
			const name = text(item?.name);
			if (!mac || observedMACs.has(mac) || unplaced.has(mac))
				continue;
			unplaced.set(mac, {
				id: mac, mac, name: name && name !== '?' ? name : mac, detail: ips[0]?.replace(/\/\d+$/, '') || _('Attachment unknown'),
				icon: clientIcon(item.name), relation: 'unknown', context: _('Attachment unknown'), addresses: ips, tab: 'connections'
			});
		}

		return {
			infrastructure: Array.from(devices.values()).filter(device => conduits.has(device.id) && !assigned.has(device.id)),
			router: { id: 'router', name: text(router.hostname) || text(router.model) || _('This device'), detail: text(router.managementAddress) || text(router.model), icon: radios.size ? 'router' : 'gateway', tab: 'system' },
			upstreams: Array.from(upstreams.values()).sort(byId),
			groups: Array.from(groups.values()).filter(group => !(
				Array.from(upstreams.values()).some(up => up.names.includes(group.network)) &&
				([ 'dhcp', 'dhcpv6', 'pppoe', 'ppp', 'qmi', 'mbim', 'ncm', '3g' ].includes(group.protocol) || [ 'tunnel', 'wireguard' ].includes(group.type)) &&
				!group.radios && !group.members.length
			)).sort(byId),
			unplaced: Array.from(unplaced.values()).sort(byId),
			interfacesAvailable: Array.isArray(connections.interfaces),
			wifiAvailable: source.wifi != null,
			wifiSupported: source.wifiSupported ?? source.wifi != null,
			attachmentsAvailable: connections.observations != null,
			partial: (observations.bridges || []).some(bridge => bridge.partial)
		};
	}
});
