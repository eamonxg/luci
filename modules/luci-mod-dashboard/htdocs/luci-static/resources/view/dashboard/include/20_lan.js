'use strict';
'require baseclass';
'require rpc';
'require network';
'require view.dashboard.lib.charts as charts';

const PAGE_SIZE = 12;
const callLuciDHCPLeases = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });

return baseclass.extend({
	params: {},
	dataSources: [ 'wifi' ],
	widgets: [
		{ id: 'dhcp', slot: 'cards', title: _('DHCP Devices'), order: 50, hidden: true },
		{ id: 'dhcp', slot: 'tabs', title: _('Clients'), order: 40 }
	],

	load() {
		return Promise.all([
			L.resolveDefault(callLuciDHCPLeases(), null),
			L.resolveDefault(network.getHostHints(), null),
			L.resolveDefault(network.getDevices(), [])
		]);
	},

	buildClients(wifi) {
		const clients = new Map();
		const local = new Set((this.devices || []).map(device => device.getMAC()?.toUpperCase()).filter(Boolean));
		const merge = (value, name, addresses) => {
			const mac = String(value || '').toUpperCase();
			if (!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) || mac === '00:00:00:00:00:00' || (parseInt(mac, 16) & 1) || local.has(mac))
				return null;
			if (!clients.has(mac))
				clients.set(mac, { mac, name: mac, addresses: [], associations: [], lease: false });
			const client = clients.get(mac);
			if (name && name !== '?' && name.toUpperCase() !== mac)
				client.name = name;
			for (const address of L.toArray(addresses))
				if (address && !client.addresses.includes(address))
					client.addresses.push(address);
			return client;
		};
		for (const [ mac, hint ] of Object.entries(this.hints?.hosts || {}))
			merge(mac, hint.name, L.toArray(hint.ipaddrs || hint.ipv4).concat(L.toArray(hint.ip6addrs || hint.ipv6)));
		for (const lease of this.params.lan?.devices || []) {
			const client = merge(lease.macaddr, lease.hostname, lease.ipaddr);
			if (client)
				client.lease = true;
		}
		const networks = new Map((wifi?.networks || []).filter(net => net.clientsKnown !== false && net.mode !== 'monitor').map(net => [ net.id, net ]));
		for (const association of wifi?.clients || []) {
			const net = networks.get(association.network);
			if (!net)
				continue;
			const client = merge(association.mac, association.name, association.addresses);
			if (client && !client.associations.some(item => item.network === association.network))
				client.associations.push({ network: association.network, label: [net.name, net.band].filter(Boolean).join(' · '), known: association.associated !== false });
		}
		const rank = client => client.associations.some(item => item.known) ? 0 : client.lease ? 1 : 2;
		return Array.from(clients.values()).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.mac.localeCompare(b.mac));
	},

	updateTopology(snapshot) {
		this.wireless = snapshot.wifi || null;
		this.clientRows = this.buildClients(this.wireless);
		if (this.clientTable)
			this.renderTable();
	},

	filteredClients() {
		const query = (this.query || '').trim().toLowerCase();
		return (this.clientRows || []).filter(client => !query || [client.name, client.mac, ...client.addresses].some(value => value.toLowerCase().includes(query)));
	},

	renderKpi() {
		const count = this.params.lan.devices.length;
		return charts.kpi({ icon: 'devices', title: _('DHCP Devices'), value: [ String(count) ], sub: [ count ? _('Active leases') : _('No active leases') ] });
	},

	renderTable() {
		const clients = this.filteredClients();
		this.page = Math.max(0, Math.min(this.page || 0, Math.ceil(clients.length / PAGE_SIZE) - 1));
		const start = this.page * PAGE_SIZE;
		const shown = clients.slice(start, start + PAGE_SIZE);
		const association = client => client.associations.find(item => client.mac === this.selectedClient && item.network === this.selectedNetwork) || client.associations[0];
		this.clientTable = charts.table({
			id: 'dashboard-lan-table', node: this.clientTable,
			head: [ _('Device'), _('IP Address'), _('Source'), _('MAC') ],
			rowKeys: shown.map(client => client.mac),
			rowAttrs: shown.map(client => ({
				'data-dashboard-client-row': client.mac,
				'data-dashboard-network': association(client)?.network,
				'class': client.mac === this.selectedClient ? 'dashboard-client-located' : '',
				'aria-current': client.mac === this.selectedClient ? 'true' : null
			})),
			rows: shown.map(client => {
				const link = association(client);
				const name = link && this.topologyEnabled ? E('button', {
					type: 'button', 'class': 'dashboard-client-locate',
					'data-dashboard-locate': client.mac, 'data-dashboard-network': link.network,
					'aria-label': _('Locate %s in network topology').format(client.name)
				}, client.name) : client.name;
				const source = link ? (link.known ? _('Wireless association') : _('Peer state unknown')) : client.lease ? _('DHCP lease') : _('Address record');
				return [
					E('div', { 'class': 'dashboard-client-stack' }, [ E('div', {}, name), link ? E('small', { 'class': 'dashboard-client-secondary' }, link.label) : '' ]),
					E('div', { 'title': client.addresses.join(', ') }, [ E('div', {}, client.addresses[0] || '-'), client.addresses.length > 1 ? E('small', { 'class': 'dashboard-client-secondary' }, _('%d addresses').format(client.addresses.length)) : '' ]),
					charts.badge(source, link?.known ? 'success' : ''), client.mac
				];
			}),
			emptyText: this.query ? _('No matching clients.') : _('No client records available.')
		});
		if (this.range) {
			this.range.textContent = clients.length ? _('%d–%d of %d').format(start + 1, Math.min(start + PAGE_SIZE, clients.length), clients.length) : _('No matching clients.');
			this.previous.disabled = this.page === 0;
			this.next.disabled = start + PAGE_SIZE >= clients.length;
			this.pager.hidden = clients.length <= PAGE_SIZE;
		}
		return this.clientTable;
	},

	navigate({ client, network }) {
		this.selectedClient = client;
		this.selectedNetwork = network;
		this.query = '';
		if (this.search)
			this.search.value = '';
		const index = this.filteredClients().findIndex(item => item.mac === client);
		this.page = index < 0 ? 0 : Math.floor(index / PAGE_SIZE);
		this.renderTable();
		return Array.from(this.clientTable.querySelectorAll('[data-dashboard-client-row]')).find(row => row.dataset.dashboardClientRow === client);
	},

	renderTab() {
		this.renderTable();
		if (this.node)
			return this.node;
		this.search = E('input', {
			type: 'search', placeholder: _('Search name, IP or MAC'), 'aria-label': _('Search clients'),
			input: () => { this.query = this.search.value; this.page = 0; this.renderTable(); }
		});
		this.range = E('span', { role: 'status' });
		this.previous = E('button', { type: 'button', 'class': 'cbi-button', click: () => { this.page--; this.renderTable(); } }, _('Previous'));
		this.next = E('button', { type: 'button', 'class': 'cbi-button', click: () => { this.page++; this.renderTable(); } }, _('Next'));
		this.pager = E('div', { 'class': 'dashboard-clients-pager' }, [ this.previous, this.next ]);
		this.node = E('div', { 'class': 'dashboard-clients', 'data-dashboard-section': 'clients' }, [
			E('div', { 'class': 'dashboard-clients-toolbar' }, [ this.search, this.range, this.pager ]),
			E('p', { 'class': 'dashboard-net-note' }, _('DHCP leases and address records do not confirm that a device is currently connected.')),
			this.clientTable
		]);
		this.renderTable();
		return this.node;
	},

	render([ leases, hints, devices ]) {
		this.params.lan = { devices: Array.isArray(leases?.dhcp_leases) ? leases.dhcp_leases : [] };
		this.hints = hints;
		this.devices = devices;
		this.clientRows = this.buildClients(this.wireless);
		return {
			cards: [ { id: 'dhcp', node: () => this.renderKpi() } ],
			tabs: [ { id: 'dhcp', title: _('Clients'), content: () => this.renderTab() } ]
		};
	}
});
