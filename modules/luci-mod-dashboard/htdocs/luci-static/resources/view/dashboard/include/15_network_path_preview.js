'use strict';
'require baseclass';
'require view.dashboard.lib.charts as charts';

// Visual prototype only. These values are fixtures, never live device state.
const PREVIEW = {
	gateway: { title: 'Gateway', name: '192.168.1.1', detail: 'DNS · 192.168.1.1', icon: 'internet', tab: 'internet' },
	router: { title: 'This router', name: 'JDCloud RE-SS-01', detail: '192.168.6.1', icon: 'router', tab: 'system' },
	networks: [
		{ title: '5 GHz', name: 'Rilakkuma_Arthur_5G', detail: 'Channel 36 · 80 MHz', clients: '1 client', icon: 'wireless', tab: 'wifi', network: 'phy0-ap0', section: 'clients' },
		{ title: '2.4 GHz', name: 'Rilakkuma_Arthur', detail: 'Channel 1 · 20 MHz', clients: '2 clients', icon: 'wireless', tab: 'wifi', network: 'phy1-ap0', section: 'clients' },
		{ title: 'LAN', name: 'br-lan', detail: '192.168.6.0/24', clients: 'DHCP Devices', icon: 'router', tab: 'dhcp' }
	]
};

document.head.appendChild(E('link', {
	rel: 'stylesheet',
	href: L.resource('view/dashboard/css/network-path-preview.css')
}));

return baseclass.extend({
	widgets: [ { id: 'network_path_preview', slot: 'charts', title: _('Network path (preview)'), order: 5, hidden: true } ],

	node(data, local) {
		return E('button', {
			'class': 'dashboard-path-node ifacebox' + (local ? ' dashboard-path-local' : ''),
			type: 'button',
			'aria-label': _('%s: go to details').format(data.name),
			'data-dashboard-tab': data.tab,
			'data-dashboard-section': data.section || null,
			'data-dashboard-network': data.network || null
		}, [
			E('span', { 'class': 'dashboard-path-node-head' }, [
				charts.icon(data.icon), E('span', {}, data.title),
				E('span', { 'class': 'dashboard-path-state' }, [ E('i', { 'aria-hidden': 'true' }), _('Up') ])
			]),
			E('strong', { 'class': 'dashboard-path-name' }, data.name),
			E('span', { 'class': 'dashboard-path-detail' }, data.detail),
			data.clients ? E('span', { 'class': 'dashboard-path-clients' }, [ data.clients, E('span', { 'aria-hidden': 'true' }, ' ›') ]) : ''
		]);
	},

	render() {
		if (!this.preview) {
			this.preview = charts.card({
				title: _('Network path'),
				desc: _('Simulated overview. Select a node to open the live detail tab.'),
				className: 'dashboard-path-preview',
				body: [
					E('div', { 'class': 'dashboard-path-map' }, [
						E('div', { 'class': 'dashboard-path-upstream' }, [
							this.node(PREVIEW.gateway),
							E('div', { 'class': 'dashboard-path-transfer' }, [
								E('span', {}, '↓ 24.6 Mbit/s'), E('span', {}, '↑ 3.2 Mbit/s'),
								E('small', {}, 'wan · 1 Gbit/s')
							])
						]),
						E('div', { 'class': 'dashboard-path-link', 'aria-hidden': 'true' }),
						this.node(PREVIEW.router, true),
						E('div', { 'class': 'dashboard-path-link', 'aria-hidden': 'true' }),
						E('div', { 'class': 'dashboard-path-branches' }, PREVIEW.networks.map(net =>
							E('div', { 'class': 'dashboard-path-branch' }, this.node(net))))
					]),
					E('div', { 'class': 'dashboard-path-footer' }, [
						E('button', { type: 'button', 'class': 'dashboard-path-summary-link', 'data-dashboard-tab': 'wifi', 'data-dashboard-section': 'clients' }, _('Wireless: 3 clients')),
						E('button', { type: 'button', 'class': 'dashboard-path-summary-link', 'data-dashboard-tab': 'dhcp' }, _('DHCP Devices')),
						E('span', { 'class': 'dashboard-path-preview-label' }, _('Preview only'))
					])
				]
			});
			this.preview.dataset.dashboardSpan = 'full';
			this.preview.dataset.dashboardOverview = 'network-path';
		}
		return { charts: [ { id: 'network_path_preview', node: this.preview } ] };
	}
});
