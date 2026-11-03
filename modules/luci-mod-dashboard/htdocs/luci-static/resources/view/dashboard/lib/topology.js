'use strict';
'require baseclass';

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

return baseclass.extend({
	buildModel(snapshot) {
		const source = snapshot || {};
		const router = source.router || {};
		const wifi = source.wifi || {};
		const upstreams = new Map();
		const networks = new Map();
		const clientIds = new Set();

		for (const item of Array.isArray(router.upstreams) ? router.upstreams : []) {
			if (!item || (item.family !== 4 && item.family !== 6))
				continue;
			const network = text(item.network);
			const device = text(item.device);
			const gatewayKey = addressKey(item.gateway);
			const gateway = gatewayKey && ![ '0.0.0.0', '0:0:0:0:0:0:0:0' ].includes(gatewayKey) ? text(item.gateway) : '';
			if (!network && !device && !gateway)
				continue;
			const id = [ item.family, network || device, gateway ? gatewayKey : '' ].join('|');
			if (!upstreams.has(id))
				upstreams.set(id, {
					id,
					name: gateway || device || network,
					detail: [ network, 'IPv' + item.family, item.up === true ? _('Link up') : _('Link down') ].filter(Boolean).join(' · '),
					up: item.up === true
				});
		}

		for (const item of Array.isArray(wifi.networks) ? wifi.networks : []) {
			const id = text(item?.id);
			if (!id || networks.has(id))
				continue;
			networks.set(id, { id, name: text(item.name) || id, detail: text(item.band), active: item.active === true, clients: [] });
		}

		for (const item of Array.isArray(wifi.clients) ? wifi.clients : []) {
			const network = networks.get(text(item?.network));
			const mac = macAddress(item?.mac);
			if (!network || !mac)
				continue;
			const id = network.id + '|' + mac;
			if (clientIds.has(id))
				continue;
			clientIds.add(id);
			const ips = addresses(item.addresses);
			const name = text(item.name);
			network.clients.push({
				id, network: network.id, mac,
				name: name && name !== '?' ? name : mac,
				icon: clientIcon(name),
				detail: ips[0]?.replace(/\/\d+$/, '') || mac
			});
		}

		for (const network of networks.values()) {
			network.clients.sort(byId);
			network.detail = [ network.detail, network.clients.length === 1 ? _('1 client') : _('%d clients').format(network.clients.length) ].filter(Boolean).join(' · ');
		}

		return {
			router: {
				name: text(router.hostname) || text(router.model) || _('This router'),
				detail: text(router.managementAddress) || text(router.model)
			},
			upstreams: Array.from(upstreams.values()).sort(byId),
			networks: Array.from(networks.values()).sort(byId),
			totalClients: clientIds.size,
			wifiAvailable: source.wifi != null
		};
	}
});
