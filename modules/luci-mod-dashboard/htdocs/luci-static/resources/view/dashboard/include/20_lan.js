'use strict';
'require baseclass';
'require rpc';
'require network';
'require view.dashboard.lib.charts as charts';

var callLuciDHCPLeases = rpc.declare({
	object: 'luci-rpc',
	method: 'getDHCPLeases',
	expect: { '': {} }
});

return baseclass.extend({
	title: _('DHCP Devices'),

	params: {},

	load() {
		return Promise.all([
			callLuciDHCPLeases(),
		]);
	},

	renderHtml() {
		const card = E('div', { 'class': 'router-status-lan dash-card dash-span-2' });
		const box  = E('div', { 'class': 'lan-info devices-list' });

		box.appendChild(E('div', { 'class': 'title', 'style': 'display:flex;align-items:center;gap:0.6rem' }, [
			E('img', { 'src': L.resource('view/dashboard/icons/devices.svg'), 'width': 36, 'title': this.title, 'class': 'middle svgmonotone' }),
			E('h3', { 'class': 'dash-card-title', 'style': 'margin:0' }, [ this.title ])
		]));
		box.appendChild(E('div', { 'class': 'dash-card-desc' }, [ _('%d devices').format(this.params.lan.devices.length) ]));
		box.appendChild(E('hr', { 'class': 'dash-divider' }));

		const rows = [ E('thead', {}, [ E('tr', {}, [
			E('th', {}, [ _('Hostname') ]), E('th', {}, [ _('IP Address') ]), E('th', {}, [ _('MAC') ])
		]) ]) ];

		const body = E('tbody', {});
		this.params.lan.devices.forEach(d => {
			body.appendChild(E('tr', {}, [
				E('td', { 'data-label': _('Hostname') }, [ d.hostname ]),
				E('td', { 'data-label': _('IP Address') }, [ d.ipv4 ]),
				E('td', { 'data-label': _('MAC') }, [ d.macaddr ])
			]));
		});
		rows.push(body);

		box.appendChild(E('table', { 'class': 'dash-table stackable assoclist devices-info' }, rows));
		card.appendChild(box);
		return card;
	},

	renderSummary() {
		const devs = (this.params.lan && this.params.lan.devices) || [];
		return {
			stats: [ charts.renderStatCard({ label: _('Online Devices'), icon: '💻', value: String(devs.length), desc: _('Active DHCP leases') }) ],
			macs: devs.map(d => (d.macaddr || '').toLowerCase()).filter(Boolean)
		};
	},

	renderUpdateData(leases) {
		const dev_arr = [];

		leases.forEach(({ hostname = '?', ipaddr: ipv4 = '-', macaddr = '00:00:00:00:00:00' }) => {
			dev_arr.push({ hostname, ipv4, macaddr });
		});

		this.params.lan = { devices: dev_arr };
	},

	renderLeases(leases) {
		this.renderUpdateData([...leases.dhcp_leases]);

		return this.renderHtml();
	},

	render([leases]) {
		if (L.hasSystemFeature('dnsmasq') || L.hasSystemFeature('odhcpd'))
			return this.renderLeases(leases);
		this.params.lan = { devices: [] };
		return E([]);
	}
});
