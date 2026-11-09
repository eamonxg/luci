import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const directory = new URL('../htdocs/luci-static/resources/view/dashboard/', import.meta.url);
String.prototype.format = function(...values) {
	let index = 0;
	return this.replace(/%[sd]/g, () => String(values[index++]));
};
function module(path, dependencies = {}) {
	const context = { baseclass: { extend: value => value }, _: value => value, rpc: { declare: () => async () => null }, ...dependencies };
	return new Function(...Object.keys(context), readFileSync(new URL(path, directory), 'utf8'))(...Object.values(context));
}
const topology = module('lib/topology.js');
const lan = { id: 'lan', device: 'br-lan', protocol: 'static', type: 'bridge', up: true };
const radio = (id, bindings = ['lan'], extra = {}) => ({ id, name: 'Home', mode: 'ap', band: '5 GHz', interfaces: bindings, active: true, clientsKnown: true, ...extra });
const station = (network, n, extra = {}) => ({ network, mac: '02:00:00:00:00:' + n.toString(16).padStart(2, '0'), name: 'Device ' + n, addresses: ['192.0.2.' + n], ...extra });
const snapshot = (networks = [], clients = [], extra = {}) => ({
	router: { hostname: 'OpenWrt', upstreams: [] },
	connections: { interfaces: [lan], hosts: [] },
	wifi: { networks, clients }, ...extra
});

test('APs on the same logical LAN share a group while association identity stays scoped', () => {
	const model = topology.buildModel(snapshot([radio('ap0'), radio('ap1', ['lan'], { band: '2.4 GHz' })], [station('ap0', 1), station('ap1', 1)]));
	assert.equal(model.groups.length, 1);
	assert.equal(model.groups[0].id, 'net:lan');
	assert.equal(model.groups[0].tab, undefined);
	assert.equal(model.groups[0].members.length, 2);
	assert.notEqual(model.groups[0].members[0].id, model.groups[0].members[1].id);
	assert.deepEqual(model.groups[0].wifiNetworks, ['ap0', 'ap1']);
});

test('dynamic VLAN station bindings override the parent SSID', () => {
	const model = topology.buildModel(snapshot([radio('ap0')], [station('ap0', 1, { interfaces: ['guest'] })], {
		connections: { interfaces: [lan, { id: 'guest', device: 'br-lan.20', up: true }], hosts: [] }
	}));
	assert.equal(model.groups.find(g => g.id === 'net:lan').members.length, 0);
	assert.equal(model.groups.find(g => g.id === 'net:guest').members.length, 1);
});

test('ambiguous or unbound SSIDs retain their association context without guessing a LAN', () => {
	const model = topology.buildModel(snapshot([radio('ap0', ['lan', 'guest']), radio('ap1', [])], [station('ap0', 1), station('ap1', 2)]));
	assert.equal(model.groups.find(g => g.id === 'net:lan').members.length, 0);
	assert.equal(model.groups.find(g => g.id === 'wifi:ap0').members.length, 1);
	assert.equal(model.groups.find(g => g.id === 'wifi:ap1').tab, 'wifi');
});

test('wireless uplinks and mesh neighbours are peers, not downstream LAN clients', () => {
	const model = topology.buildModel(snapshot([radio('sta0', ['lan'], { mode: 'sta' }), radio('mesh0', ['lan'], { mode: 'mesh' })], [station('sta0', 1), station('mesh0', 2, { associated: true }), station('mesh0', 3)]));
	assert.equal(model.groups.find(g => g.id === 'net:lan').members.length, 0);
	assert.equal(model.groups.find(g => g.id === 'wifi:sta0').kind, 'peer');
	const mesh = model.groups.find(g => g.id === 'wifi:mesh0');
	assert.equal(mesh.members[0].relation, 'observed');
	assert.equal(mesh.members[1].relation, 'unknown');
	assert.equal(mesh.members[1].detail, 'Peer state unknown');
});

test('multiple WAN links remain parallel, dual stack merges only with known device identity', () => {
	const model = topology.buildModel(snapshot([], [], { router: { upstreams: [
		{ family: 4, network: 'wan', device: 'eth0', gateway: '192.0.2.1', up: true },
		{ family: 6, network: 'wan6', device: 'eth0', gateway: 'fe80::1', up: true },
		{ family: 4, network: 'lte', device: 'wwan0', up: true },
		{ family: 6, network: 'fallback', up: false }
	] } }));
	assert.equal(model.upstreams.length, 3);
	assert.equal(model.upstreams.find(up => up.id === 'device:eth0').detail, 'IPv4 / IPv6 · Link up');
	assert.equal(model.upstreams.find(up => up.id === 'network:fallback').active, false);
});

test('AP and IPv6-only configurations do not manufacture missing gateways', () => {
	assert.deepEqual(topology.buildModel(snapshot([radio('ap0')], [station('ap0', 1)])).upstreams, []);
	const model = topology.buildModel(snapshot([], [], { router: { upstreams: [{ family: 6, network: 'wan6', device: 'eth0', gateway: '::', up: true }] } }));
	assert.equal(model.upstreams.length, 1);
	assert.equal(model.upstreams[0].name, 'wan6');
	assert.deepEqual(model.upstreams[0].gateways, []);
});

test('address records never become wired attachment or current connectivity claims', () => {
	const host = station('unused', 1);
	const model = topology.buildModel(snapshot([], [], { wifiSupported: false, wifi: null, connections: { interfaces: [lan], hosts: [host] } }));
	assert.equal(model.groups[0].members.length, 0);
	assert.equal(model.groups[0].summary, 'Endpoint attachment not reported.');
	assert.equal(model.unplaced.length, 1);
	assert.equal(model.unplaced[0].relation, 'unknown');
});

test('a failed association read remains unknown instead of zero or a stale attachment', () => {
	const client = station('ap0', 1);
	const model = topology.buildModel(snapshot([radio('ap0', ['lan'], { clientsKnown: false })], [client], { connections: { interfaces: [lan], hosts: [client] } }));
	assert.equal(model.groups[0].members.length, 0);
	assert.equal(model.groups[0].summary, 'Wireless association data unavailable.');
	assert.equal(model.unplaced.length, 1);
});

test('partial data keeps successful associations and discloses missing data', () => {
	const model = topology.buildModel(snapshot([radio('ap0'), radio('ap1', ['lan'], { clientsKnown: false })], [station('ap0', 1)]));
	assert.equal(model.groups[0].members.length, 1);
	assert.match(model.groups[0].summary, /Some wireless data is unavailable/);
});

test('unsupported interface collection retains only reported wireless bindings', () => {
	const model = topology.buildModel(snapshot([radio('ap0')], [station('ap0', 1)], { connections: null }));
	assert.equal(model.interfacesAvailable, false);
	assert.equal(model.groups[0].name, 'lan');
	assert.equal(model.groups[0].tab, 'wifi');
	assert.equal(model.groups[0].network, 'ap0');
});

test('logical tunnels and one-arm interfaces remain distinct roles, without invented peers', () => {
	const model = topology.buildModel(snapshot([], [], { connections: { interfaces: [lan, { id: 'wg0', protocol: 'wireguard', virtual: true, device: 'wg0', up: true }], hosts: [] }, router: { upstreams: [{ family: 4, network: 'lan', device: 'br-lan', gateway: '192.0.2.1', up: true }] } }));
	assert.equal(model.upstreams[0].network, 'lan');
	assert.equal(model.groups.find(g => g.id === 'net:lan').relation, 'logical');
	assert.deepEqual(model.groups.find(g => g.id === 'net:wg0').members, []);
});

test('invalid MACs and duplicates cannot create phantom endpoints', () => {
	const good = station('ap0', 1);
	const model = topology.buildModel(snapshot([radio('ap0')], [good, good, {...good, mac:'00:00:00:00:00:00'}, {...good, mac:'01:00:00:00:00:01'}], { connections: { interfaces: [lan], hosts: [good, {...good, mac:'02:00:00:00:00:02'}, {...good, mac:'02:00:00:00:00:02'}] } }));
	assert.equal(model.groups[0].members.length, 1);
	assert.equal(model.unplaced.length, 1);
});

test('the model retains all associations for paging and does not silently cap at 64', () => {
	const model = topology.buildModel(snapshot([radio('ap0')], Array.from({length:100}, (_, i) => station('ap0', i + 1))));
	assert.equal(model.groups[0].members.length, 100);
});

test('wireless collection distinguishes a rejected RPC from a successful empty list', async () => {
	const ok = {getAssocList: async () => []}, failed = {getAssocList: async () => { throw new Error('denied'); }};
	const wifi = module('include/30_wifi.js', { network: {getWifiDevices:async()=>[],getWifiNetworks:async()=>[ok,failed],getHostHints:async()=>({})}, L:{resolveDefault:(promise,value)=>promise.catch(()=>value),bind:(fn,ctx,...args)=>fn.bind(ctx,...args)} });
	await wifi.load();
	assert.equal(ok.assoclistKnown,true);
	assert.equal(failed.assoclistKnown,false);
	assert.deepEqual(failed.assoclist,[]);
});

test('selection follows a reported VLAN reassignment and keeps its association identity', () => {
	const widget = module('include/15_network_path_preview.js', { charts:{}, topology, document:{activeElement:null} });
	widget.init = () => {};
	widget.updateTree = () => {};
	widget.accessStates = new Map();
	widget.activeGroup = 'net:lan';
	widget.selection = { tab:'wifi', network:'ap0', client:'02:00:00:00:00:06' };
	widget.updateTopology(snapshot([radio('ap0')], [station('ap0', 6, {interfaces:['guest']})], {connections:{interfaces:[lan,{id:'guest',device:'br-lan.20',up:true}],hosts:[]}}));
	assert.equal(widget.activeGroup,'net:guest');
	assert.equal(widget.selection.network,'ap0');
	widget.updateTopology(snapshot([radio('ap0')], []));
	assert.deepEqual(widget.selection,{});
});

test('interface collection exposes reported bridge members and excludes local host MACs', () => {
	const collector = module('lib/topology.js', { L:{toArray:v=>v==null?[]:Array.isArray(v)?v:[v]} });
	const dev = {getName:()=> 'br-lan',getType:()=> 'bridge',getPorts:()=>[{getName:()=> 'lan1'}]};
	const net = {getName:()=> 'lan',getL3Device:()=>dev,getDevice:()=>dev,getProtocol:()=> 'static',isVirtual:()=>false,isUp:()=>true,getIPAddrs:()=>['192.0.2.1/24'],getIP6Addrs:()=>['fd00::1/64'],getGatewayAddr:()=>null,getGateway6Addr:()=>null};
	const data = collector.collectConnections([[net],{hosts:{'02:00:00:00:00:01':{name:'self'},'02:00:00:00:00:02':{name:'host',ipaddrs:['192.0.2.2']}}},[{getMAC:()=> '02:00:00:00:00:01'}]]);
	assert.deepEqual(data.interfaces[0].members,['lan1']);
	assert.deepEqual(data.interfaces[0].addresses,['192.0.2.1/24','fd00::1/64']);
	assert.equal(data.hosts.length,1);
	assert.equal(data.hosts[0].name,'host');
});

test('failed interface and host collection remains unavailable', async () => {
	const fail = async()=>{throw new Error('denied');};
	const collector = module('lib/topology.js', { network:{getNetworks:fail,getHostHints:fail,getDevices:fail},L:{resolveDefault:(p,v)=>p.catch(()=>v)} });
	const data = await collector.loadConnections();
	assert.equal(data.interfaces,null);
	assert.equal(data.hosts,null);
});

test('mesh without counters or confirmed peer state does not turn missing values into zero', () => {
	const wifi = module('include/30_wifi.js',{uci:{get:()=>undefined},L:{toArray:v=>v==null?[]:Array.isArray(v)?v:[v]}});
	const net={getName:()=> 'mesh-config',getIfname:()=> 'phy0-mesh0',getWifiDeviceName:()=> 'radio0',getNetworkNames:()=>['lan'],getMode:()=> 'mesh',getActiveSSID:()=>null,getMeshID:()=> 'backhaul',isDisabled:()=>false,isUp:()=>true,getBSSID:()=> '02:00:00:00:00:10',getActiveBSSID:()=> '02:00:00:00:00:10',getChannel:()=>36,getFrequency:()=>5.180,getBitRate:()=>0,getActiveEncryption:()=> 'SAE',assoclistKnown:true,assoclist:[{mac:'02:00:00:00:00:11','mesh plink':'LISTEN'}]};
	wifi.params={wifi:{radios:[],devices:[]}};
	wifi.renderUpdateData([{getName:()=> 'radio0'}],[net],{hosts:{},getHostnameByMACAddr:()=>null,getIPAddrByMACAddr:()=>null});
	assert.equal(wifi.params.wifi.devices[0].network,'mesh-config');
	assert.equal(wifi.params.wifi.devices[0].ssid.value,'backhaul');
	assert.equal(wifi.params.wifi.devices[0].transferred.value.rx,'-');
	assert.equal(wifi.params.wifi.devices[0].transferred.value.bytes.rx,null);
	assert.equal(wifi.getTopologyData().clients[0].associated,false);
});

test('optional wireless charts do not turn failed collection into no clients', () => {
	const wifi = module('include/30_wifi.js',{charts:{card:options=>options,empty:message=>message}});
	wifi.params={wifi:{radios:[{clientsKnown:false}],devices:[]}};
	for(const method of ['renderDistributionChart','renderSignalChart','renderTrafficChart'])
		assert.equal(wifi[method]().body,'Wireless association data unavailable.');
});


test('topology supplies existing destinations even when saved tabs omit them', async () => {
	const stored = { cards: [], charts: ['network_path_preview'], tabs: ['resources', 'connections', 'resources'] };
	const widgets = module('lib/widgets.js', {
		uci: { load: async () => {}, get: (config, section, slot) => stored[slot] },
		L: { toArray: value => value || [], resolveDefault: promise => promise }
	});
	const widget = module('include/15_network_path_preview.js');
	const includes = [widget, { widgets: ['internet', 'system', 'dhcp', 'wifi', 'resources'].map(id => ({ id, slot: 'tabs' })) }];
	const layout = await widgets.layout(includes);
	assert.deepEqual(layout.tabs, ['resources', 'connections', 'internet', 'system', 'wifi']);
	assert.deepEqual(widgets.resolveLayout(includes, { ...layout, tabs: ['dhcp'] }).tabs, ['dhcp', 'internet', 'system', 'wifi', 'connections']);
	assert.deepEqual(stored.tabs, ['resources', 'connections', 'resources']);
	assert.deepEqual(widgets.resolveLayout(includes, widgets.configuredLayout(includes)), layout);
	assert.deepEqual(widgets.resolveLayout(includes, layout), layout);
	assert.deepEqual(widgets.resolveLayout(includes, { ...layout, charts: [], tabs: ['resources'] }).tabs, ['resources']);
	const wiredOnly = [widget, { widgets: ['internet', 'system'].map(id => ({ id, slot: 'tabs' })) }];
	assert.deepEqual(widgets.resolveLayout(wiredOnly, { cards: [], charts: ['network_path_preview'], tabs: [] }).tabs, ['internet', 'system', 'connections']);
});

test('group clicks toggle children without selecting a detail destination; reveal opens the selected client', () => {
	const widget = module('include/15_network_path_preview.js', { topology, document: { activeElement: null } });
	widget.init = () => {};
	widget.updateTree = () => {};
	widget.accessStates = new Map();
	widget.selection = {};
	widget.updateTopology(snapshot([radio('ap0')], Array.from({ length: 9 }, (_, i) => station('ap0', i + 1))));
	widget.toggleGroup('net:lan');
	assert.equal(widget.activeGroup, 'net:lan');
	assert.equal(widget.collapsed, false);
	widget.toggleGroup('net:lan');
	assert.equal(widget.collapsed, true);
	widget.updateTopology(snapshot([radio('ap0')], Array.from({ length: 9 }, (_, i) => station('ap0', i + 1))));
	assert.equal(widget.collapsed, true);
	widget.select({ tab: 'wifi', network: 'ap0', client: station('ap0', 9).mac });
	assert.equal(widget.collapsed, false);
	assert.equal(widget.activeGroup, 'net:lan');
	assert.equal(widget.accessStates.get('net:lan|wifi:ap0'), true);
	assert(widget.accessPreview(widget.model.groups[0], widget.model.groups[0].access[0]).members.some(member => member.mac === station('ap0', 9).mac));
	widget.toggleGroup('net:guest');
	assert.equal(widget.activeGroup, 'net:lan');
	assert.equal(widget.collapsed, false);
	assert.equal(widget.selection.client, station('ap0', 9).mac);
});

test('upstreams use Internet and unplaced records do not link to unrelated details', () => {
	const model = topology.buildModel(snapshot([], [], {
		router: { upstreams: [{ family: 4, network: 'wan', device: 'eth0', up: true }] },
		connections: { interfaces: [lan], hosts: [station('unused', 1)] }
	}));
	assert.equal(model.upstreams[0].tab, 'internet');
	assert.equal(model.upstreams[0].network, 'wan');
	assert.equal(model.unplaced[0].tab, 'connections');
});

test('Internet details include every WAN while the KPI retains the lowest metric route', () => {
	const router = module('include/10_router.js', {
		rpc: { declare: () => {} }, E: (tag, attributes, children) => ({ tag, attributes, children })
	});
	const net = (name, metric) => ({
		getName: () => name, getMetric: () => metric, getUptime: () => 0,
		getI18n: () => 'DHCP', getGatewayAddr: () => name + '-gateway',
		getIPAddrs: () => [name + '-address'], getDNSAddrs: () => [], isUp: () => true
	});
	router.wanData = [[net('wan', 10), net('lte', 20)], []];
	router.params = { internet: router.internetData(router.wanData) };
	router.renderInternetColumn = (group, name) => ({ name, gateway: group.gatewayv4?.value });
	const content = router.renderInternetTab();
	assert.deepEqual(content.children.slice(0, 2), [{ name: 'wan', gateway: 'wan-gateway' }, { name: 'lte', gateway: 'lte-gateway' }]);
	assert.equal(router.params.internet.v4.gatewayv4.value, 'wan-gateway');
	const destinations = [{ dataset: { dashboardNetwork: 'wan' } }, { dataset: { dashboardNetwork: 'lte' } }];
	router.internetNode = { querySelectorAll: () => destinations };
	assert.equal(router.navigate({ network: 'lte' }), destinations[1]);
});


test('Settings displays the same enabled detail tabs as topology navigation', async () => {
	const uci = { get: (config, section, slot) => ({ charts: ['network_path_preview'], tabs: ['resources'] })[slot] };
	const L = { toArray: value => value || [] };
	const widgets = module('lib/widgets.js', { uci, L });
	const includes = [module('include/15_network_path_preview.js'), {
		widgets: ['resources', 'internet', 'system', 'dhcp', 'wifi'].map(id => ({ id, title: id, slot: 'tabs' }))
	}];
	const options = {};
	const form = { Map: class {
		section() { return { option(type, slot) { return options[slot] = { value() {} }; } }; }
		render() { return Promise.resolve({}); }
	} };
	const layout = module('lib/layout.js', {
		form, widgets, L, ui: { createHandlerFn: () => () => {} },
		E: (tag, attrs, children) => ({ tag, attrs, children })
	});
	await layout.render(includes);
	assert.deepEqual(options.tabs.cfgvalue(), ['resources', 'internet', 'system', 'wifi', 'connections']);
	assert.deepEqual(options.charts.cfgvalue(), ['network_path_preview']);
});


test('topology clients open their existing Wireless association details without requiring a lease', () => {
	const model = topology.buildModel(snapshot([radio('ap0'), radio('ap1')], [station('ap0', 1), station('ap1', 1)]));
	assert.deepEqual(model.groups[0].members.map(member => [member.tab, member.network, member.mac]), [
		['wifi', 'ap0', station('ap0', 1).mac], ['wifi', 'ap1', station('ap1', 1).mac]
	]);
});


test('the original DHCP tab remains available when lease data exists without service feature flags', async () => {
	for (const available of [true, false]) {
		const dhcp = module('include/20_lan.js', {
			rpc: { declare: () => async () => { if (!available) throw new Error('unsupported'); return {dhcp_leases:[]}; } },
			L: { hasSystemFeature: () => false, resolveDefault: (promise, fallback) => promise.catch(() => fallback) }
		});
		assert.equal(await dhcp.available(), available);
	}
});

const wiredSnapshot = (overrides = {}) => snapshot([], [], {
	wifi: null, wifiSupported: false,
	connections: {
		interfaces: [{ ...lan, members: ['eth0', 'eth2', 'eth3'] }],
		devices: ['eth0', 'eth2', 'eth3'].map(id => ({ id, type: 'ethernet', carrier: true, speed: 1000 })),
		hosts: [station('', 1), station('', 2), station('', 3)],
		observations: { bridges: [{ device: 'br-lan', available: true, entries: [
			{ mac: station('', 1).mac, port: 'eth0' }, { mac: station('', 2).mac, port: 'eth2' }, { mac: station('', 3).mac, port: 'eth3' }
		] }], neighbours: [] },
		...overrides
	}
});

test('a wired appliance exposes every member interface and learned endpoint without Wi-Fi', () => {
	const model = topology.buildModel(wiredSnapshot());
	const group = model.groups[0];
	assert.equal(model.router.icon, 'gateway');
	assert.equal(model.wifiSupported, false);
	assert.deepEqual(group.access.map(item => item.name), ['eth0', 'eth2', 'eth3']);
	assert.deepEqual(group.access.map(item => item.members.length), [1, 1, 1]);
	assert.equal(group.members.length, 3);
	assert.equal(model.unplaced.length, 0);
	assert.equal(group.members[0].context, 'Discovered via eth0');
	assert.equal(group.members[0].tab, 'connections', 'a learned address opens the Network inventory, not an unrelated lease or Wireless row');
	assert.match(group.access[0].detail, /1 Gbit\/s/);
	assert(!JSON.stringify(group).includes('online'), 'learning an address is not a reachability probe');
});

test('missing attachment RPC keeps ports visible and known devices accessible with unknown placement', () => {
	const model = topology.buildModel(wiredSnapshot({ observations: null }));
	assert.equal(model.groups[0].access.length, 3);
	assert.equal(model.groups[0].members.length, 0);
	assert.equal(model.unplaced.length, 3);
	assert(model.unplaced.every(host => host.relation === 'unknown' && host.tab === 'connections'));
	assert.equal(model.attachmentsAvailable, false);
});

test('IPv6-only and static hosts can be located by MAC without DHCP or an IPv4 neighbour', () => {
	const model = topology.buildModel(wiredSnapshot({ hosts: [{ ...station('', 1), addresses: ['fd00::abcd', 'fe80::abcd'] }] }));
	const endpoint = model.groups[0].members.find(host => host.mac === station('', 1).mac.toUpperCase());
	assert.equal(endpoint.detail, 'fd00::abcd');
	assert.deepEqual(endpoint.addresses, ['fd00::abcd', 'fe80::abcd']);
	assert.equal(endpoint.context, 'Discovered via eth0');
});

test('a bridge behind one port may contain multiple discovered devices without inventing a direct cable', () => {
	const data = wiredSnapshot();
	data.connections.observations.bridges[0].entries.forEach(entry => { entry.port = 'eth0'; });
	const model = topology.buildModel(data);
	assert.equal(model.groups[0].access[0].members.length, 3);
	assert(model.groups[0].members.every(host => host.context === 'Discovered via eth0'));
});

test('ambiguous FDB ports preserve the network while leaving the interface unidentified', () => {
	const data = wiredSnapshot();
	data.connections.observations.bridges[0].entries.push({ mac: station('', 1).mac, port: 'eth2' });
	const group = topology.buildModel(data).groups[0];
	const endpoint = group.members.find(host => host.mac === station('', 1).mac.toUpperCase());
	assert.equal(endpoint.access, 'unlocated');
	assert.equal(endpoint.relation, 'logical');
	assert.equal(endpoint.context, 'Multiple interfaces reported');
});

test('a shared bridge does not assign hosts to an arbitrary logical interface', () => {
	const data = wiredSnapshot();
	data.connections.interfaces.push({ ...data.connections.interfaces[0], id: 'alias' });
	const model = topology.buildModel(data);
	assert(model.groups.every(group => group.members.length === 0));
	assert.equal(model.unplaced.length, 3);
});

test('VLAN-unaware FDB data is rejected; an explicit neighbour can identify only its logical network', () => {
	const data = wiredSnapshot();
	data.connections.observations.bridges[0].available = false;
	data.connections.observations.neighbours = [{ mac: station('', 1).mac, address: '192.0.2.1', device: 'br-lan.20' }];
	data.connections.interfaces.push({ id: 'guest', device: 'br-lan.20', type: 'vlan', protocol: 'static', up: true });
	const model = topology.buildModel(data);
	assert.equal(model.groups.find(group => group.network === 'lan').members.length, 0);
	const member = model.groups.find(group => group.network === 'guest').members[0];
	assert.equal(member.access, 'unlocated');
	assert.equal(member.relation, 'logical');
	assert.equal(model.unplaced.length, 2);
});

test('endpoint identity stays scoped when the same MAC is reported in separate bridge domains', () => {
	const data = wiredSnapshot();
	data.connections.interfaces.push({ id: 'guest', device: 'br-guest', type: 'bridge', members: ['eth4'], up: true });
	data.connections.observations.bridges.push({ device: 'br-guest', available: true, entries: [{ mac: station('', 1).mac, port: 'eth4' }] });
	const model = topology.buildModel(data);
	const records = model.groups.flatMap(group => group.members).filter(member => member.mac === station('', 1).mac.toUpperCase());
	assert.equal(records.length, 2);
	assert.notEqual(records[0].id, records[1].id);
});

test('local Wi-Fi association evidence wins over a learned bridge address for that network', () => {
	const data = wiredSnapshot();
	data.wifiSupported = true;
	data.wifi = { networks: [radio('ap0')], clients: [station('ap0', 1)] };
	const group = topology.buildModel(data).groups[0];
	assert.equal(group.members.filter(host => host.mac === station('', 1).mac.toUpperCase()).length, 1);
	assert.equal(group.members.find(host => host.mac === station('', 1).mac.toUpperCase()).access, 'wifi:ap0');
	assert.equal(group.access.find(item => item.id === 'wifi:ap0').members.length, 1);
});

test('pure upstream interfaces are not duplicated as empty downstream networks', () => {
	const data = wiredSnapshot();
	data.router.upstreams = [{ family: 4, network: 'wan', device: 'pppoe-wan', up: true }];
	data.connections.interfaces.push({ id: 'wan', device: 'pppoe-wan', type: 'tunnel', up: true });
	const model = topology.buildModel(data);
	assert.equal(model.upstreams.length, 1);
	assert(!model.groups.some(group => group.network === 'wan'));
});

test('unassigned interfaces remain visible, while WAN carrier interfaces are not duplicated as unassigned', () => {
	const data = wiredSnapshot();
	data.connections.devices.push({ id: 'eth4', type: 'ethernet', carrier: false });
	data.connections.devices.push({ id: 'eth1', type: 'ethernet', carrier: true });
	data.connections.interfaces.push({ id: 'wan', device: 'pppoe-wan', physicalDevice: 'eth1', type: 'tunnel', up: true });
	const group = topology.buildModel(data).groups.find(item => item.id === 'interfaces:unassigned');
	assert.deepEqual(group.access.map(item => item.name), ['eth4']);
	assert.equal(group.access[0].active, false);
});

test('an explicit upstream gateway stays in the upstream context rather than a duplicate downstream WAN', () => {
	const data = wiredSnapshot();
	data.router.upstreams = [{ family: 4, network: 'uplink', device: 'eth1', up: true, gateway: '198.51.100.1' }];
	data.connections.interfaces.push({ id: 'uplink', device: 'eth1', type: 'ethernet', protocol: 'dhcp', up: true });
	data.connections.observations.neighbours.push({ mac: '02:00:00:00:01:01', address: '198.51.100.1', device: 'eth1' });
	const model = topology.buildModel(data);
	assert(!model.groups.some(group => group.network === 'uplink'));
	assert(!model.unplaced.some(host => host.mac === '02:00:00:00:01:01'));
	assert.deepEqual(model.upstreams[0].gatewayAddresses, ['198.51.100.1']);
});

test('a missing carrier observation stays unknown even when the legacy accessor returns false', () => {
	const collector = module('lib/topology.js');
	const data = collector.collectConnections([[], null, [{ getName: () => 'eth9', getMAC: () => null, getCarrier: () => false }], null]);
	assert.equal(data.devices[0].carrier, null);
});

test('a static one-arm LAN remains visible even when its interface also supplies the default route', () => {
	const model = topology.buildModel(snapshot([], [], { wifi: null, wifiSupported: false,
		router: { upstreams: [{ family: 4, network: 'lan', device: 'eth0', up: true, gateway: '192.0.2.1' }] },
		connections: { interfaces: [{ id: 'lan', device: 'eth0', type: 'ethernet', protocol: 'static', up: true }], hosts: [] }
	}));
	assert.equal(model.upstreams.length, 1);
	assert.equal(model.groups[0].network, 'lan');
});

test('IPv6 configuration on the reported PPPoE device is folded into that same upstream', () => {
	const model = topology.buildModel(snapshot([], [], {
		router: { upstreams: [{ family: 4, network: 'wan', device: 'pppoe-wan', up: true }] },
		connections: { interfaces: [lan, { id: 'wan_6', device: 'pppoe-wan', type: 'tunnel', protocol: 'dhcpv6', up: false }], hosts: [] }
	}));
	assert.deepEqual(model.upstreams[0].families, [4, 6]);
	assert.deepEqual(model.upstreams[0].names, ['wan', 'wan_6']);
	assert.match(model.upstreams[0].detail, /Mixed link state/);
	assert(!model.groups.some(group => group.network === 'wan_6'));
});

test('the collector local-address inventory excludes the router itself from every host source', () => {
	const data = wiredSnapshot();
	data.connections.observations.localMACs = [station('', 1).mac];
	data.connections.observations.neighbours.push({ mac: station('', 1).mac, address: '192.0.2.1', device: 'br-lan' });
	const model = topology.buildModel(data);
	assert(!model.groups.flatMap(group => group.members).concat(model.unplaced).some(host => host.mac === station('', 1).mac.toUpperCase()));
});

test('Network details retain unplaced records and complete IPv6 addresses without assigning a fabricated network', () => {
	const details = module('lib/connections.js', { E: (tag, attrs, children) => ({ tag, attrs, children }) });
	details.render = () => { details.sections ||= { networks: {}, interfaces: {}, devices: {} }; };
	details.draw = () => {};
	const data = wiredSnapshot({ observations: null });
	data.connections.hosts[0].addresses = ['192.0.2.2', 'fd00::2'];
	details.update(topology.buildModel(data));
	assert.equal(details.sections.devices.records.length, 3);
	assert.equal(details.sections.devices.records[0].values[1], '192.0.2.2, fd00::2');
	assert.equal(details.sections.devices.records[0].values[3], 'Not identified');
	assert.equal(details.sections.interfaces.records.length, 3);
	assert.equal(details.sections.networks.records.length, 1);
});

test('Network details paginate and navigate to a device beyond the current page, scoped by network', () => {
	const details = module('lib/connections.js', {
		E: (tag, attrs) => ({ tag, attrs }),
		charts: { table: options => ({ parentNode: details.sections.devices.body,
			querySelectorAll: () => options.rowKeys.map(key => ({ dataset: { rowKey: key } })) }) }
	});
	details.render = () => {};
	details.search = { value: '' };
	const section = { page: 0, head: [], body: {}, pager: {}, previous: {}, next: {}, range: {},
		records: Array.from({ length: 73 }, (_, i) => ({ key: 'host-' + i, client: '02:00:00:00:00:01', network: 'lan' + i, search: 'host-' + i, values: ['host-' + i] })) };
	details.sections = { devices: section };
	details.drawSection(section);
	assert.equal(section.table.querySelectorAll().length, 25);
	assert.equal(section.range.textContent, '1–25 of 73');
	assert.equal(section.previous.disabled, true);
	assert.equal(section.next.disabled, false);
	details.search.value = 'unrelated search';
	const target = details.navigate({ client: '02:00:00:00:00:01', network: 'lan70' });
	assert.equal(details.search.value, '');
	assert.equal(section.page, 2);
	assert.equal(target.dataset.rowKey, 'host-70');
	assert.equal(section.range.textContent, '51–73 of 73');
	assert.equal(section.next.disabled, true);
	details.search.value = 'host-70';
	details.draw();
	assert.equal(section.page, 0);
	assert.equal(section.table.querySelectorAll().length, 1);
	assert.equal(section.pager.hidden, true);
});

test('DSA CPU conduits are identified from reported parent relationships, without hiding independent Ethernet ports', () => {
	const collector = module('lib/topology.js');
	const dev = (id, devtype, parent) => ({ dev: { devtype }, getName: () => id, getMAC: () => null,
		getType: () => devtype === 'dsa' ? 'switch' : 'ethernet', getParent: () => parent ? { getName: () => parent } : null });
	const data = collector.collectConnections([[], null, [dev('eth0', 'ethernet'), dev('lan1', 'dsa', 'eth0'), dev('eth9', 'ethernet')], null]);
	const model = topology.buildModel({ connections: data });
	assert.equal(data.devices.find(item => item.id === 'lan1').parent, 'eth0');
	assert.deepEqual(model.infrastructure.map(item => item.id), ['eth0']);
	assert(!model.groups.flatMap(group => group.access).some(access => access.device === 'eth0'));
	assert(model.groups.flatMap(group => group.access).some(access => access.device === 'eth9'));
});

test('the overview omits unused networks and unassigned interfaces while keeping them available in details', () => {
	const widget = module('include/15_network_path_preview.js');
	const model = topology.buildModel(snapshot([], [], { connections: { interfaces: [lan,
		{ id: 'docker', device: 'docker0', type: 'bridge', protocol: 'none', up: false }],
		devices: [{ id: 'eth9', type: 'ethernet', carrier: true }], hosts: [] } }));
	assert.deepEqual(widget.overviewGroups(model).map(group => group.id), ['net:lan']);
	assert(model.groups.some(group => group.id === 'net:docker'));
	assert(model.groups.some(group => group.id === 'interfaces:unassigned'));
	assert(widget.overviewGroups(model, 'net:docker').some(group => group.id === 'net:docker'));
	const group = { access: [{ id: 'off', active: false, members: [] }, { id: 'up', active: true, members: [] }, { id: 'unknown', members: [] }] };
	widget.selection = {};
	assert.deepEqual(widget.overviewAccess(group).map(access => access.id), ['up', 'unknown']);
	widget.selection = { access: 'off' };
	assert(widget.overviewAccess(group).some(access => access.id === 'off'));
});

test('large client groups default to a summary and expand to three clients, with late selections still visible', () => {
	const widget = module('include/15_network_path_preview.js');
	widget.accessStates = new Map();
	widget.selection = {};
	const model = topology.buildModel(snapshot([radio('ap0'),radio('ap1')], [
		...Array.from({ length: 100 }, (_, i) => station('ap0', i + 1)), station('ap1', 101)
	]));
	const group = model.groups[0], access = group.access.find(item => item.id === 'wifi:ap0');
	assert.equal(widget.accessPreview(group, access).expanded, false);
	assert.equal(widget.accessPreview(group, access).members.length, 0);
	widget.accessStates.set(group.id + '|' + access.id, true);
	assert.equal(widget.accessPreview(group, access).members.length, 3);
	widget.selection = { network: 'ap0', client: station('ap0', 99).mac.toUpperCase() };
	assert(widget.accessPreview(group, access).members.some(member => member.mac === widget.selection.client));
	assert.equal(widget.accessPreview(group, access).members.length, 3);
	assert.equal(widget.accessPreview(group, group.access.find(item => item.id === 'wifi:ap1')).members.length, 1);
});

test('View all scopes the full device list to one attachment, preserving all clients through polling', () => {
	const details = module('lib/connections.js', { E: (tag, attrs) => ({ tag, attrs }) });
	details.render = () => { details.sections ||= { networks: {}, interfaces: {}, devices: {} }; };
	details.draw = () => {};
	const data = snapshot([radio('ap0'),radio('ap1')], [
		...Array.from({ length: 50 }, (_, i) => station('ap0', i + 1)), station('ap1', 100)
	]);
	details.update(topology.buildModel(data));
	details.scope = { group: 'net:lan', access: 'wifi:ap0', network: 'lan' };
	let records = details.sections.devices.records.filter(record => details.matchesScope(record));
	assert.equal(records.length, 50);
	assert(records.every(record => record.network === 'ap0'));
	details.update(topology.buildModel(data));
	assert.equal(details.sections.devices.records.filter(record => details.matchesScope(record)).length, 50);
	details.scope = null;
	assert.equal(details.sections.devices.records.filter(record => details.matchesScope(record)).length, 51);
});
