import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const directory = new URL('../htdocs/luci-static/resources/view/dashboard/', import.meta.url);
String.prototype.format = function(...values) {
	let index = 0;
	return this.replace(/%[sd]/g, () => String(values[index++]));
};
function module(path, dependencies = {}) {
	const context = { baseclass: { extend: value => value }, _: value => value, ...dependencies };
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
	assert.equal(model.groups[0].tab, 'connections');
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

test('selection follows a reported VLAN reassignment and clamps to the selected association page', () => {
	const widget = module('include/15_network_path_preview.js', { charts:{}, topology, document:{activeElement:null} });
	widget.init = () => {};
	widget.updateTree = () => {};
	widget.pages = new Map([['net:lan', 1]]);
	widget.activeGroup = 'net:lan';
	widget.selection = { tab:'wifi', network:'ap0', client:'02:00:00:00:00:06' };
	widget.updateTopology(snapshot([radio('ap0')], [station('ap0', 6, {interfaces:['guest']})], {connections:{interfaces:[lan,{id:'guest',device:'br-lan.20',up:true}],hosts:[]}}));
	assert.equal(widget.activeGroup,'net:guest');
	assert.equal(widget.pages.get('net:guest'),0);
	widget.updateTopology(snapshot([radio('ap0')], []));
	assert.deepEqual(widget.selection,{});
});

test('interface collection exposes reported bridge members and excludes local host MACs', () => {
	const connections = module('include/16_connections.js', { L:{toArray:v=>v==null?[]:Array.isArray(v)?v:[v]} });
	const dev = {getName:()=> 'br-lan',getType:()=> 'bridge',getPorts:()=>[{getName:()=> 'lan1'}]};
	const net = {getName:()=> 'lan',getL3Device:()=>dev,getDevice:()=>dev,getProtocol:()=> 'static',isVirtual:()=>false,isUp:()=>true,getIPAddrs:()=>['192.0.2.1/24'],getIP6Addrs:()=>['fd00::1/64'],getGatewayAddr:()=>null,getGateway6Addr:()=>null};
	connections.updateData([[net],{hosts:{'02:00:00:00:00:01':{name:'self'},'02:00:00:00:00:02':{name:'host',ipaddrs:['192.0.2.2']}}},[{getMAC:()=> '02:00:00:00:00:01'}]]);
	assert.deepEqual(connections.data.interfaces[0].members,['lan1']);
	assert.deepEqual(connections.data.interfaces[0].addresses,['192.0.2.1/24','fd00::1/64']);
	assert.equal(connections.data.hosts.length,1);
	assert.equal(connections.data.hosts[0].name,'host');
});

test('failed interface and host collection remains unavailable', async () => {
	const fail = async()=>{throw new Error('denied');};
	const connections = module('include/16_connections.js', { network:{getNetworks:fail,getHostHints:fail,getDevices:fail},L:{resolveDefault:(p,v)=>p.catch(()=>v)} });
	connections.updateData(await connections.load());
	assert.equal(connections.data.interfaces,null);
	assert.equal(connections.data.hosts,null);
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
