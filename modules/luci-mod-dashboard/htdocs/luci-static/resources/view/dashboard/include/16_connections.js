'use strict';
'require baseclass';
'require network';
'require view.dashboard.lib.charts as charts';

const HOST_PAGE_SIZE = 32;

return baseclass.extend({
	topologySource: 'connections',
	widgets: [ { id: 'connections', slot: 'tabs', title: _('Connections'), order: 45, hidden: true } ],

	load() {
		// These share network.js's cached netifd/host snapshot with other widgets.
		return Promise.all([
			L.resolveDefault(network.getNetworks(), null),
			L.resolveDefault(network.getHostHints(), null),
			L.resolveDefault(network.getDevices(), [])
		]);
	},

	updateData([ interfaces, hints, devices ]) {
		const localMACs = new Set(devices.map(dev => dev.getMAC()?.toUpperCase()).filter(Boolean));
		this.data = {
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
		this.hostPage = Math.min(this.hostPage || 0, Math.max(0, Math.ceil((this.data.hosts?.length || 0) / HOST_PAGE_SIZE) - 1));
	},

	getTopologyData() {
		return this.data || null;
	},

	renderInterfaces() {
		const interfaces = this.data.interfaces || [];
		this.interfaceTable = charts.table({
			id: 'dashboard-connections-table', node: this.interfaceTable,
			head: [ _('Network'), _('Protocol'), _('Device'), _('IP Address'), _('Gateway'), _('Bridge members'), _('State') ],
			rowKeys: interfaces.map(net => net.id),
			rowAttrs: interfaces.map(net => ({
				'data-dashboard-network-row': net.id,
				'class': this.selectedNetwork === net.id ? 'dashboard-client-located' : '',
				'aria-current': this.selectedNetwork === net.id ? 'true' : null
			})),
			rows: interfaces.map(net => [
				net.name, net.protocol, net.device || '-',
				E('div', {}, net.addresses.map(address => E('div', {}, address))),
				E('div', {}, net.gateways.map(address => E('div', {}, address))),
				net.members.join(', ') || '-', net.up ? _('Link up') : _('Link down')
			]),
			emptyText: this.data.interfaces ? _('No interfaces reported.') : _('Interface data unavailable.')
		});
		return this.interfaceTable;
	},

	renderHosts() {
		const hosts = this.data.hosts || [];
		const start = (this.hostPage || 0) * HOST_PAGE_SIZE;
		this.hostTable = charts.table({
			id: 'dashboard-host-records-table', node: this.hostTable,
			head: [ _('Hostname'), _('IP Address'), _('MAC') ],
			rowKeys: hosts.slice(start, start + HOST_PAGE_SIZE).map(host => host.mac),
			rowAttrs: hosts.slice(start, start + HOST_PAGE_SIZE).map(host => ({ 'data-dashboard-host-row': host.mac })),
			rows: hosts.slice(start, start + HOST_PAGE_SIZE).map(host => [
				host.name, E('div', {}, host.addresses.map(address => E('div', {}, address))), host.mac
			]),
			emptyText: this.data.hosts ? _('No host records reported.') : _('Host data unavailable.')
		});
		if (this.hostRange) {
			this.hostRange.textContent = hosts.length ? _('%d–%d of %d').format(start + 1, Math.min(start + HOST_PAGE_SIZE, hosts.length), hosts.length) : '';
			this.hostPrevious.disabled = start === 0;
			this.hostNext.disabled = start + HOST_PAGE_SIZE >= hosts.length;
			this.hostPager.hidden = hosts.length <= HOST_PAGE_SIZE;
		}
		return this.hostTable;
	},

	navigate({ network, client }) {
		this.selectedNetwork = network || null;
		this.renderInterfaces();
		if (client) {
			const index = (this.data.hosts || []).findIndex(host => host.mac === client);
			if (index >= 0) {
				this.hostPage = Math.floor(index / HOST_PAGE_SIZE);
				this.renderHosts();
				return Array.from(this.hostTable.querySelectorAll('[data-dashboard-host-row]')).find(row => row.dataset.dashboardHostRow === client);
			}
		}
		return Array.from(this.interfaceTable.querySelectorAll('[data-dashboard-network-row]')).find(row => row.dataset.dashboardNetworkRow === network);
	},

	renderTab() {
		const interfaces = this.renderInterfaces(), hosts = this.renderHosts();
		if (this.node)
			return this.node;
		this.hostRange = E('span');
		this.hostPrevious = E('button', { type: 'button', 'class': 'cbi-button', click: () => { this.hostPage--; this.renderHosts(); } }, _('Previous'));
		this.hostNext = E('button', { type: 'button', 'class': 'cbi-button', click: () => { this.hostPage++; this.renderHosts(); } }, _('Next'));
		this.hostPager = E('div', { 'class': 'dashboard-topology-pager' }, [ this.hostRange, this.hostPrevious, this.hostNext ]);
		this.node = E('div', {}, [
			E('div', { 'data-dashboard-section': 'interfaces' }, [ E('h3', {}, _('Logical interfaces')), interfaces ]),
			E('div', { 'data-dashboard-section': 'hosts' }, [
				E('h3', {}, _('Reported host records')),
				E('p', {}, _('Address records do not establish physical attachment or current reachability.')),
				hosts, this.hostPager
			])
		]);
		this.renderHosts();
		return this.node;
	},

	render(data) {
		this.updateData(data);
		return { tabs: [ { id: 'connections', title: _('Connections'), content: () => this.renderTab() } ] };
	}
});
