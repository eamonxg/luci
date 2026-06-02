'use strict';
'require baseclass';
'require dom';
'require network';
'require rpc';
'require view.dashboard.lib.charts as charts';

return baseclass.extend({

	title: _('Wireless'),

	params: [],

	load() {
		return Promise.all([
			network.getWifiDevices(),
			network.getWifiNetworks(),
			network.getHostHints()
		]).then(radios_networks_hints => {
			const tasks = [];

			for (let i = 0; i < radios_networks_hints[1].length; i++)
				tasks.push(L.resolveDefault(radios_networks_hints[1][i].getAssocList(), []).then(L.bind((net, list) => {
					net.assoclist = list.sort((a, b) => { return a.mac > b.mac });
				}, this, radios_networks_hints[1][i])));

			return Promise.all(tasks).then(() => {
				return radios_networks_hints;
			});
		});
	},

	renderHtml() {
		const card = E('div', { 'class': 'router-status-wifi dash-card dash-span-2' });
		const box  = E('div', { 'class': 'wifi-info devices-list' });

		box.appendChild(E('div', { 'class': 'title', 'style': 'display:flex;align-items:center;gap:0.6rem' }, [
			E('img', { 'src': L.resource('view/dashboard/icons/wireless.svg'), 'width': 36, 'title': this.title, 'class': 'middle svgmonotone' }),
			E('h3', { 'class': 'dash-card-title', 'style': 'margin:0' }, [ this.title ])
		]));
		box.appendChild(E('hr', { 'class': 'dash-divider' }));

		// Per-radio info as key/value rows
		this.params.wifi.radios.forEach(radio => {
			const ssid = radio.ssid ? radio.ssid.value : '?';
			const active = radio.isactive ? radio.isactive.value : false;
			box.appendChild(E('div', { 'class': 'dash-section-label', 'style': 'display:flex;justify-content:space-between;align-items:center' }, [
				E('span', {}, [ ssid ]),
				E('span', { 'class': (active === _('yes') || active === true) ? 'dash-badge dash-badge-green' : 'dash-badge dash-badge-red' }, [ active === true ? _('yes') : active ])
			]));
			['chan', 'rate', 'bssid', 'encryption', 'associations'].forEach(k => {
				if (radio[k] && radio[k].visible)
					box.appendChild(E('div', { 'class': 'dash-row' }, [
						E('span', { 'class': 'dash-key' }, [ radio[k].title ]),
						E('span', { 'class': 'dash-val' }, [ radio[k].value ])
					]));
			});
		});

		// Connected clients: signal bars + flow table
		if (this.params.wifi.devices.length) {
			box.appendChild(E('div', { 'class': 'dash-section-label' }, [ _('Connected Devices') ]));
			this.params.wifi.devices.forEach(dev => {
				const q = Math.max(0, Math.min(100, parseInt(dev.progress.value.qualite)));
				box.appendChild(charts.renderSignalRow(
					dev.hostname.value || '?', q, dev.progress.value.rssi + 'dBm'
				));
			});

			const body = E('tbody', {});
			this.params.wifi.devices.forEach(dev => {
				body.appendChild(E('tr', {}, [
					E('td', { 'data-label': _('Hostname') }, [ dev.hostname.value || '?' ]),
					E('td', { 'data-label': _('SSID') }, [ dev.ssid.value ]),
					E('td', { 'data-label': _('Up.') }, [ dev.transferred.value.tx ]),
					E('td', { 'data-label': _('Down.') }, [ dev.transferred.value.rx ])
				]));
			});
			box.appendChild(E('table', { 'class': 'dash-table stackable assoclist devices-info', 'style': 'margin-top:0.6rem' }, [
				E('thead', {}, [ E('tr', {}, [
					E('th', {}, [ _('Hostname') ]), E('th', {}, [ _('SSID') ]),
					E('th', {}, [ _('Up.') ]), E('th', {}, [ _('Down.') ])
				]) ]),
				body
			]));
		}

		card.appendChild(box);
		return card;
	},

	renderSummary() {
		const radios = (this.params.wifi && this.params.wifi.radios) || [];
		const macs = [];
		(this._assocMacs || []).forEach(m => macs.push(m.toLowerCase()));
		return {
			stats: [ charts.renderStatCard({
				label: _('WiFi Networks'), icon: '📶',
				value: String(radios.length),
				desc: _('Active radios')
			}) ],
			macs: macs
		};
	},

	renderUpdateData(radios, networks, hosthints) {

		for (let i = 0; i < radios.sort((a, b) => { a.getName() > b.getName() }).length; i++) {
			const network_items = networks.filter(net => { return net.getWifiDeviceName() == radios[i].getName() });

			for (let j = 0; j < network_items.length; j++) {
				const net = network_items[j];
				const is_assoc = (net.getBSSID() != '00:00:00:00:00:00' && net.getChannel() && !net.isDisabled());
				const chan = net.getChannel();
				const freq = net.getFrequency();
				const rate = net.getBitRate();

				this.params.wifi.radios.push(
					{
						ssid : {
							title: _('SSID'),
							visible: true,
							value: net.getActiveSSID() || '?'
						},

						isactive : {
							title: _('Active'),
							visible: true,
							value: !net.isDisabled()
						},

						chan : {
							title: _('Channel'),
							visible: true,
							value: chan ? '%d (%.3f %s)'.format(chan, freq, _('GHz')) : '-'
						},

						rate : {
							title: _('Bitrate'),
							visible: true,
							value: rate ? '%d %s'.format(rate, _('Mbit/s')) : '-'
						},

						bssid : {
							title: _('BSSID'),
							visible: true,
							value: is_assoc ? (net.getActiveBSSID() || '-') : '-'
						},

						encryption : {
							title: _('Encryption'),
							visible: true,
							value: is_assoc ? net.getActiveEncryption() : '-'
						},

						associations : {
							title: _('Devices Connected'),
							visible: true,
							value: is_assoc ? (net.assoclist.length || '0') : 0
						}
					}
				);
			}
		}

		for (let i = 0; i < networks.length; i++) {
			for (let k = 0; k < networks[i].assoclist.length; k++) {
				const bss = networks[i].assoclist[k];
				this._assocMacs.push(bss.mac);
				const name = hosthints.getHostnameByMACAddr(bss.mac);

				let progress_style;
				const defaultNF = -90; // default noise floor for devices that do not report it
				const defaultCeil = -30;
				// const q = Math.min((bss.signal + 110) / 70 * 100, 100);
				const q = 100 * ((bss.signal - (bss.noise ? bss.noise: defaultNF) ) / (defaultCeil - (bss.noise ? bss.noise : defaultNF)));

				if (q == 0 || q < 25)
					progress_style = 'bg-danger';
				else if (q < 50)
					progress_style = 'bg-warning';
				else if (q < 75)
					progress_style = 'bg-success';
				else
					progress_style = 'bg-success';

				this.params.wifi.devices.push(
					{
						hostname : {
							title: _('Hostname'),
							visible: true,
							value: name || '?'
						},

						ssid : {
							title: _('SSID'),
							visible: true,
							value: networks[i].getActiveSSID()
						},

						progress : {
							title: _('Strength'),
							visible: true,
							value: {
								qualite: q,
								rssi: bss.signal,
								style: progress_style
							}
						},

						transferred : {
							title: _('Transferred'),
							visible: true,
							value: {
								rx: '%s'.format('%.2mB'.format(bss.rx.bytes)),
								tx: '%s'.format('%.2mB'.format(bss.tx.bytes)),
							}
						}
					}
				);
			}
		}
	},

	render([radios, networks, hosthints]) {
		this.params.wifi = { radios: [], devices: [] };
		this._assocMacs = [];
		this.renderUpdateData(radios, networks, hosthints);
		if (this.params.wifi.radios.length)
			return this.renderHtml();
		return E([]);
	}
});
