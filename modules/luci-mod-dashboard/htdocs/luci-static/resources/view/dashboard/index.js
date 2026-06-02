'use strict';
'require view';
'require dom';
'require poll';
'require fs';
'require network';
'require view.dashboard.lib.charts as charts';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet',
	'type': 'text/css',
	'href': L.resource('view/dashboard/css/custom.css')
}));

const TRAFFIC_MAX = 60;          // keep last 60 samples
let trafficHistory = [];          // [{ up, down }] bytes/sec
let lastSample = null;            // { rx, tx, t }

function invokeIncludesLoad(includes) {
	const tasks = [];
	let has_load = false;

	for (let i = 0; i < includes.length; i++) {
		if (typeof(includes[i].load) == 'function') {
			tasks.push(includes[i].load().catch(L.bind(() => {
				this.failed = true;
			}, includes[i])));

			has_load = true;
		}
		else {
			tasks.push(null);
		}
	}

	return has_load ? Promise.all(tasks) : Promise.resolve(null);
}

function pushTrafficSample(sample) {
	if (!sample) return;
	if (lastSample && sample.t > lastSample.t) {
		const dt = (sample.t - lastSample.t) / 1000;
		if (dt > 0) {
			trafficHistory.push({
				up:   Math.max(0, (sample.tx - lastSample.tx) / dt),
				down: Math.max(0, (sample.rx - lastSample.rx) / dt)
			});
			if (trafficHistory.length > TRAFFIC_MAX) trafficHistory.shift();
		}
	}
	lastSample = sample;
}

function startPolling(includes, root) {
	const step = () => {
		return network.flushCache().then(() => {
			return invokeIncludesLoad(includes);
		}).then(results => {
			const detailCards = [];
			const summaries = [];

			for (let i = 0; i < includes.length; i++) {
				if (includes[i].failed) continue;

				// detail cards
				let content = null;
				if (typeof includes[i].render == 'function')
					content = includes[i].render(results ? results[i] : null);
				else if (includes[i].content != null)
					content = includes[i].content;
				if (content != null)
					(Array.isArray(content) ? content : [content]).forEach(c => detailCards.push(c));

				// summary (after render, so params are populated)
				if (typeof includes[i].renderSummary == 'function') {
					const sum = includes[i].renderSummary(results ? results[i] : null) || {};
					sum.__name = includes[i].__name || ('include' + i);
					summaries.push(sum);
				}
			}

			// traffic: find the summary carrying a trafficSample
			summaries.forEach(s => { if (s.trafficSample) pushTrafficSample(s.trafficSample); });

			// build grid content
			const grid = E('div', { 'class': 'dash-grid' });

			// stat cards
			summaries.forEach(s => (s.stats || []).forEach(c => grid.appendChild(c)));

			// traffic chart (span-2)
			grid.appendChild(E('div', { 'class': 'dash-card dash-span-2' }, [
				charts.renderLineChart(
					trafficHistory.length ? trafficHistory : [{ up: 0, down: 0 }],
					[
						{ key: 'up',   color: 'var(--dash-c-blue)', label: '▲ ' + _('Upload') },
						{ key: 'down', color: 'var(--dash-c-pink)', label: '▼ ' + _('Download') }
					],
					{ title: _('Realtime Traffic'), desc: _('WAN up/down') }
				)
			]));

			// donut (span-2): wired vs wifi-associated
			const lanMacs = new Set();
			const wifiMacs = new Set();
			summaries.forEach(s => {
				if (!s.macs) return;
				if (s.__name.indexOf('20_lan') >= 0) s.macs.forEach(m => lanMacs.add(m));
				if (s.__name.indexOf('30_wifi') >= 0) s.macs.forEach(m => wifiMacs.add(m));
			});
			let wired = 0;
			lanMacs.forEach(m => { if (!wifiMacs.has(m)) wired++; });
			const donutData = [
				{ label: _('Wired'),   value: wired,          color: 'var(--dash-c-blue)' },
				{ label: _('Wireless'),value: wifiMacs.size,  color: 'var(--dash-c-violet)' }
			];
			const totalDev = wired + wifiMacs.size;
			grid.appendChild(E('div', { 'class': 'dash-card dash-span-2' }, [
				E('div', { 'class': 'dash-card-title' }, [ _('Device Distribution') ]),
				E('div', { 'class': 'dash-card-desc', 'style': 'margin-bottom:0.8rem' }, [ _('%d online').format(totalDev) ]),
				charts.renderDonut(donutData, totalDev)
			]));

			// detail cards
			detailCards.forEach(c => grid.appendChild(c));

			// swap into the DOM
			root.style.display = '';
			root.classList.add('fade-in');
			dom.content(root, grid);
		});
	};

	return step().then(() => { poll.add(step); });
}

return view.extend({
	load() {
		return L.resolveDefault(fs.list('/www' + L.resource('view/dashboard/include')), []).then(entries => {
			return Promise.all(entries.filter(e => e.type == 'file' && e.name.match(/\.js$/))
				.map(e => 'view.dashboard.include.' + e.name.replace(/\.js$/, ''))
				.sort()
				.map(n => L.require(n).then(mod => { mod.__name = n; return mod; })));
		});
	},

	render(includes) {
		const root = E('div', { 'class': 'Dashboard', 'style': 'display:none' });
		return startPolling(includes, root).then(() => root);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
