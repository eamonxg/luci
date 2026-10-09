'use strict';
'require baseclass';
'require rpc';
'require view.dashboard.lib.charts as charts';

const read = rpc.declare({ object: 'luci.dashboard.temperature', method: 'read', expect: { '': {} } });
const temperature = value => Number.isFinite(value) ? '%.1f °C'.format(value) : '—';

// Prefer package/die readings, then an explicitly named CPU channel.
// Selection is independent of the current values, so a failed CPU read cannot
// silently turn the processor card into a Wi-Fi or disk temperature card.
function processorSensor(sensors) {
	const rank = sensor => {
		const [name, channel = ''] = (sensor.label || '').toLowerCase().split(' / ');
		if (/^(coretemp|k10temp|k8temp)$/.test(name))
			return /^(package id [0-9]+|tdie)$/.test(channel) ? 0 : channel == 'tctl' ? 1 : 2;
		if (/^cpu[0-9]*[-_]thermal$/.test(name))
			return 3;
		return 99;
	};
	return sensors.filter(s => rank(s) < 99).sort((a, b) => rank(a) - rank(b) || (a.id || a.label).localeCompare(b.id || b.label, undefined, { numeric: true }))[0];
}


return baseclass.extend({
	widgets: [
		{ id: 'temperature', slot: 'cards', title: _('CPU temperature'), order: 40 },
		{ id: 'temperatures', slot: 'tabs', title: _('Temperatures'), order: 40 }
	],

	load() {
		return L.resolveDefault(read(), { status: 'error', sensors: [] });
	},

	render(data) {
		const sensors = Array.isArray(data.sensors) ? data.sensors : [];
		const categories = { cpu: _('CPU'), soc: _('SoC'), wifi: _('Wi-Fi'), ethernet: _('Ethernet PHY'), storage: _('Storage'), other: _('Other sensors') };
		const processor = processorSensor(sensors);
		const value = processor?.celsius;
		const message = data.status == 'unsupported' ? _('No supported temperature sensors found') : _('Temperature temporarily unavailable');
		const stale = data.age_ms >= 15000;
		const sub = [ !processor ? _('Processor temperature unavailable') : !Number.isFinite(value) ? message
			: stale ? _('Reading age: %d seconds').format(Math.floor(data.age_ms / 1000)) : _('Sensors: %d').format(sensors.length) ];

		return {
			cards: data.status == 'unsupported' ? [] : [{
				id: 'temperature', node: () => charts.kpi({ icon: 'temperature', title: _('CPU temperature'), value: [ temperature(value) ], sub })
			}],
			tabs: data.status == 'unsupported' ? [] : [{ id: 'temperatures', title: _('Temperature'), content: () => E('div', {}, [
				stale ? E('p', {}, [ _('Reading age: %d seconds').format(Math.floor(data.age_ms / 1000)) ]) : '',
				data.status == 'partial' ? E('p', {}, [ _('Some temperature sensors are unavailable') ]) : '',
				sensors.length ? E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [ E('th', { 'class': 'th' }, _('Component')), E('th', { 'class': 'th' }, _('Sensor')), E('th', { 'class': 'th' }, _('Temperature')) ]),
					...sensors.map(s => E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td', 'data-title': _('Component') }, [ categories[s.category] || categories.other ]), E('td', { 'class': 'td', 'data-title': _('Sensor') }, [ s.label ]), E('td', { 'class': 'td', 'data-title': _('Temperature') }, [ temperature(s.celsius) ]) ]))
				]) : charts.empty(message)
			]) }]
		};
	}
});
