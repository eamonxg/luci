'use strict';
'require baseclass';
'require network';

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
			L.resolveDefault(network.getDevices(), [])
		]).then(data => this.collectConnections(data));
	},

	collectConnections([ interfaces, hints, devices ]) {
		const localMACs = new Set(devices.map(dev => dev.getMAC()?.toUpperCase()).filter(Boolean));
		return {
			interfaces: interfaces?.filter(net => net.getName() !== 'loopback' && net.getL3Device()?.getName() !== 'lo').map(net => {
				const dev = net.getL3Device() || net.getDevice();
				return {
					id: net.getName(), name: net.getName(), device: dev?.getName() || '',
					protocol: net.getProtocol(), type: dev?.getType() || '',
					virtual: net.isVirtual(), up: net.isUp(),
					addresses: net.getIPAddrs().concat(net.getIP6Addrs()),
					members: (dev?.getPorts() || []).map(port => port.getName()),
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

		for (const item of interfaces) {
			const name = text(item?.id);
			if (!name || name === 'loopback' || item.device === 'lo')
				continue;
			groups.set('net:' + name, {
				id: 'net:' + name, name: text(item.name) || name, icon: 'network',
				kind: 'logical', relation: 'logical', network: name,
				context: text(item.device) || text(item.protocol), active: item.up === true,
				members: [], wifiNetworks: [], errors: [], radios: 0
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
				upstreams.set(id, { id, names: [], families: [], states: [], gateways: [], network, tab: 'internet', icon: 'internet' });
			const up = upstreams.get(id);
			if (network && !up.names.includes(network))
				up.names.push(network);
			if (!up.families.includes(item.family))
				up.families.push(item.family);
			up.states.push(item.up === true);
			if (gateway && ![ '0.0.0.0', '0:0:0:0:0:0:0:0' ].includes(gateway) && !up.gateways.includes(gateway))
				up.gateways.push(gateway);
		}
		for (const up of upstreams.values()) {
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
				id, name: text(item.name) || id, mode, ap: mode === 'ap' || mode === 'ap-wds',
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
				detail: associated ? [ ips[0]?.replace(/\/\d+$/, '') || mac, radio.band ].filter(Boolean).join(' · ') : _('Peer state unknown'),
				context: [ radio.name, modeLabel(radio.mode), associated ? '' : _('Peer state unknown') ].filter(Boolean).join(' · ')
			});
		}

		for (const group of groups.values()) {
			group.members.sort(byId);
			const count = group.members.length;
			const quantity = group.kind === 'peer' ? _('%d reported peers').format(count) : _('%d wireless associations').format(count);
			group.detail = [ group.context, count ? quantity : group.errors.length ? _('Data unavailable') : group.active ? _('Link up') : _('Link down') ].filter(Boolean).join(' · ');
			group.summary = count ? quantity : group.errors.length ? _('Wireless association data unavailable.')
				: group.radios ? _('No wireless associations reported.') : _('Endpoint attachment not reported.');
			if (count && group.errors.length)
				group.summary += ' · ' + _('Some wireless data is unavailable.');
		}

		const unplaced = new Map();
		for (const item of Array.isArray(connections.hosts) ? connections.hosts : []) {
			const mac = macAddress(item?.mac), ips = addresses(item?.addresses);
			const name = text(item?.name);
			if (!mac || observedMACs.has(mac) || unplaced.has(mac))
				continue;
			unplaced.set(mac, {
				id: mac, mac, name: name && name !== '?' ? name : mac, detail: ips[0]?.replace(/\/\d+$/, '') || _('Attachment unknown'),
				icon: clientIcon(item.name), relation: 'unknown', context: _('Attachment unknown')
			});
		}

		return {
			router: { id: 'router', name: text(router.hostname) || text(router.model) || _('This device'), detail: text(router.managementAddress) || text(router.model), icon: 'router', tab: 'system' },
			upstreams: Array.from(upstreams.values()).sort(byId),
			groups: Array.from(groups.values()).sort(byId),
			unplaced: Array.from(unplaced.values()).sort(byId),
			interfacesAvailable: Array.isArray(connections.interfaces),
			wifiAvailable: source.wifi != null,
			wifiSupported: source.wifiSupported ?? source.wifi != null
		};
	}
});
