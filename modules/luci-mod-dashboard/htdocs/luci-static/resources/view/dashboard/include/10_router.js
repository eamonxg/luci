'use strict';
'require baseclass';
'require fs';
'require rpc';
'require network';
'require uci';
'require view.dashboard.lib.charts as charts';

var callSystemBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

var callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

var callGetUnixtime = rpc.declare({
	object: 'luci',
	method: 'getUnixtime',
	expect: { result: 0 }
});

return baseclass.extend({

	params: [],

	load() {
		return Promise.all([
			network.getWANNetworks(),
			network.getWAN6Networks(),
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callGetUnixtime(), 0),
			uci.load('system')
		]);
	},

	// Sample WAN device byte counters from the lowest-metric WANv4 interface.
	sampleWanBytes(wanNetworks) {
		let min_metric = 2000000000, ifc = null;
		for (let i = 0; i < wanNetworks.length; i++) {
			const m = wanNetworks[i].getMetric();
			if (m < min_metric) { min_metric = m; ifc = wanNetworks[i]; }
		}
		if (!ifc) return null;
		const dev = ifc.getL3Device && ifc.getL3Device();
		if (!dev) return null;
		return { rx: dev.getRXBytes() || 0, tx: dev.getTXBytes() || 0, t: Date.now() };
	},

	renderRow(title, value, badgeClass) {
		return E('div', { 'class': 'dash-row' }, [
			E('span', { 'class': 'dash-key' }, [ title ]),
			E('span', { 'class': badgeClass ? ('dash-val ' + badgeClass) : 'dash-val' }, [ value ])
		]);
	},

	renderHtml(data, type) {
		let icon = type;
		const title = ('router' == type) ? _('System') : _('Internet');
		const card = E('div', { 'class': type + '-status-self dash-card dash-span-2' });
		const box  = E('div', { 'class': type + '-status-info' });

		if ('internet' == type)
			icon = (data.v4.connected.value || data.v6.connected.value) ? type : 'not-internet';

		box.appendChild(E('div', { 'class': 'title', 'style': 'display:flex;align-items:center;gap:0.6rem' }, [
			E('img', {
				'src': L.resource('view/dashboard/icons/' + icon + '.svg'),
				'width': ('router' == type) ? 40 : 36,
				'title': title,
				'class': (type == 'router' || icon == 'not-internet') ? 'middle svgmonotone' : 'middle'
			}),
			E('h3', { 'class': 'dash-card-title', 'style': 'margin:0' }, [ title ])
		]));
		box.appendChild(E('hr', { 'class': 'dash-divider' }));

		if ('internet' == type) {
			['v4', 'v6'].forEach(idx => {
				box.appendChild(E('div', { 'class': 'dash-section-label' }, [ data[idx].title ]));
				for (const ver in data[idx]) {
					if (ver === 'title') continue;
					const field = data[idx][ver];
					if (!field.visible) continue;
					let cls = '';
					let val = field.value;
					if (ver === 'connected') {
						cls = field.value ? 'dash-badge dash-badge-green' : 'dash-badge dash-badge-red';
						val = field.value ? _('yes') : _('no');
					}
					if ((ver === 'addrsv4' || ver === 'dnsv4' || ver === 'dnsv6' || ver === 'addrsv6') && Array.isArray(val))
						val = val.join(', ');
					box.appendChild(this.renderRow(field.title, val, cls));
				}
			});
		} else {
			for (const idx in data)
				box.appendChild(this.renderRow(data[idx].title, data[idx].value));
		}

		card.appendChild(box);
		return card;
	},

	renderUpdateWanData(data, v6) {

		let min_metric = 2000000000;
		let min_metric_i = 0;
		for (let i = 0; i < data.length; i++) {
			const metric = data[i].getMetric();
			if (metric < min_metric) {
				min_metric = metric;
				min_metric_i = i;
			}
		 }

		const ifc = data[min_metric_i];
		if(ifc){
			if (v6) {
				const uptime = ifc.getUptime();
				this.params.internet.v6.uptime.value = (uptime > 0) ? '%t'.format(uptime) : '-';
				this.params.internet.v6.ipprefixv6.value =  ifc.getIP6Prefix() || '-';
				this.params.internet.v6.gatewayv6.value =  ifc.getGateway6Addr() || '-';
				this.params.internet.v6.protocol.value=  ifc.getI18n() || E('em', _('Not connected'));
				this.params.internet.v6.addrsv6.value = ifc.getIP6Addrs() || [ '-' ];
				this.params.internet.v6.dnsv6.value = ifc.getDNS6Addrs() || [ '-' ];
				this.params.internet.v6.connected.value = ifc.isUp();
			} else {
				const uptime = ifc.getUptime();
				this.params.internet.v4.uptime.value = (uptime > 0) ? '%t'.format(uptime) : '-';
				this.params.internet.v4.protocol.value=  ifc.getI18n() || E('em', _('Not connected'));
				this.params.internet.v4.gatewayv4.value =  ifc.getGatewayAddr() || '0.0.0.0';
				this.params.internet.v4.connected.value = ifc.isUp();
				this.params.internet.v4.addrsv4.value = (ifc.getIPAddrs() || ['-']).map(a => a.split('/')[0]);
				this.params.internet.v4.dnsv4.value = ifc.getDNSAddrs() || [ '-' ];
			}
		}
	},

	renderInternetBox(data) {

		this.params.internet = {

			v4: {
				title: _('IPv4 Internet'),

				connected: {
					title: _('Connected'),
					visible: true,
					value: false
				},

				uptime: {
					title: _('Uptime'),
					visible: true,
					value: '-'
				},

				protocol: {
					title: _('Protocol'),
					visible: true,
					value: '-'
				},

				addrsv4: {
					title: _('IPv4'),
					visible: true,
					value: [ '-' ]
				},

				gatewayv4: {
					title: _('GatewayV4'),
					visible: true,
					value: '-'
				},

				dnsv4: {
					title: _('DNSv4'),
					visible: true,
					value: ['-']
				}
			},

			v6: {
				title: _('IPv6 Internet'),

				connected: {
					title: _('Connected'),
					visible: true,
					value: false
				},

				uptime: {
					title: _('Uptime'),
					visible: true,
					value: '-'
				},

				protocol: {
					title: _('Protocol'),
					visible: true,
					value: ' - '
				},

				ipprefixv6 : {
					title: _('IPv6 prefix'),
					visible: true,
					value: ' - '
				},

				addrsv6: {
					title: _('IPv6'),
					visible: false,
					value: [ '-' ]
				},

				gatewayv6: {
					title: _('GatewayV6'),
					visible: true,
					value: '-'
				},

				dnsv6: {
					title: _('DNSv6'),
					visible: true,
					value: [ '-' ]
				}
			}
		};

		this.renderUpdateWanData(data[0], false);
		this.renderUpdateWanData(data[1], true);

		return this.renderHtml(this.params.internet, 'internet');
	},

	renderRouterBox(data) {

		const boardinfo   = data[2];
		const systeminfo  = data[3];
		const unixtime    = data[4];

		let datestr = null;

		if (unixtime) {
			const date = new Date(unixtime * 1000);
			const zn = uci.get('system', '@system[0]', 'zonename')?.replaceAll(' ', '_') || 'UTC';
			const ts = uci.get('system', '@system[0]', 'clock_timestyle') || 0;
			const hc = uci.get('system', '@system[0]', 'clock_hourcycle') || 0;

			datestr = new Intl.DateTimeFormat(undefined, {
				dateStyle: 'medium',
				timeStyle: (ts == 0) ? 'long' : 'full',
				hourCycle: (hc == 0) ? undefined : hc,
				timeZone: zn
			}).format(date);
		}

		this.params.router = {
			uptime: {
				title: _('Uptime'),
				value: systeminfo.uptime ? '%t'.format(systeminfo.uptime) : null,
			},

			localtime: {
				title: _('Local Time'),
				value: datestr
			},

			kernel: {
				title: _('Kernel Version'),
				value: boardinfo.kernel
			},

			model: {
				title: _('Model'),
				value: boardinfo.model
			},

			system: {
				title: _('Architecture'),
				value: boardinfo.system
			},

			release: {
				title: _('Firmware Version'),
				value: boardinfo?.release?.description
			}
		};

		return this.renderHtml(this.params.router, 'router');
	},

	renderSummary(data) {
		// data is the same array passed to render(); compute stat cards + traffic sample.
		const systeminfo = data[3];
		const v4 = this.params.internet ? this.params.internet.v4 : null;
		const connected = v4 ? !!v4.connected.value : false;
		const stats = [
			charts.renderStatCard({
				label: _('Internet'), icon: '🌐',
				value: E('span', { 'class': connected ? 'dash-badge dash-badge-green' : 'dash-badge dash-badge-red' }, [ connected ? _('Connected') : _('Disconnected') ]),
				desc: (this.params.internet && this.params.internet.v4.protocol.value) || ''
			}),
			charts.renderStatCard({
				label: _('Uptime'), icon: '⏱',
				value: systeminfo.uptime ? '%t'.format(systeminfo.uptime) : '-',
				desc: _('Since last reboot')
			})
		];
		return { stats: stats, trafficSample: this.sampleWanBytes(data[0]) };
	},

	render(data) {
		this._lastData = data;
		return [ this.renderInternetBox(data), this.renderRouterBox(data) ];
	}
});
