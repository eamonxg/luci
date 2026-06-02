'use strict';
'require baseclass';

// <pure>
// Pure geometry helpers — no DOM, unit-tested in charts.test.mjs.

function donutSegments(values, circumference) {
	const total = values.reduce((a, v) => a + (v > 0 ? v : 0), 0);
	let offset = 0;
	return values.map(v => {
		const frac = total > 0 ? (v > 0 ? v : 0) / total : 0;
		const len = frac * circumference;
		const seg = { value: v, frac: frac, len: len, dashoffset: -offset };
		offset += len;
		return seg;
	});
}

function sparklinePath(samples, key, width, height, pad) {
	const n = samples.length;
	if (n === 0) return '';
	const get = s => (typeof s === 'object' && s !== null) ? (s[key] || 0) : s;
	let max = 0;
	for (let i = 0; i < n; i++) max = Math.max(max, get(samples[i]));
	if (max <= 0) max = 1;
	const usableH = height - pad * 2;
	const stepX = n > 1 ? width / (n - 1) : 0;
	const pts = samples.map((s, i) => {
		const x = n > 1 ? i * stepX : 0;
		const y = pad + (usableH - (get(s) / max) * usableH);
		return [x, y];
	});
	const fmtX = x => Number.isInteger(x) ? x : x.toFixed(2);
	let d = 'M' + fmtX(pts[0][0]) + ',' + pts[0][1].toFixed(2);
	for (let i = 1; i < pts.length; i++)
		d += ' L' + fmtX(pts[i][0]) + ',' + pts[i][1].toFixed(2);
	if (n === 1) d += ' L' + width + ',' + pts[0][1].toFixed(2);
	return d;
}

function signalQualityClass(percent) {
	if (percent < 25) return 'low';
	if (percent < 50) return 'mid';
	return 'high';
}
// </pure>

function svgEl(tag, attrs, children) {
	const ns = 'http://www.w3.org/2000/svg';
	const el = document.createElementNS(ns, tag);
	for (const k in (attrs || {})) el.setAttribute(k, attrs[k]);
	(children || []).forEach(c => { if (c != null) el.appendChild(c); });
	return el;
}

return baseclass.extend({
	donutSegments: donutSegments,
	sparklinePath: sparklinePath,
	signalQualityClass: signalQualityClass,

	// stat card: { label, value (string|Node), icon (emoji), desc }
	renderStatCard(opts) {
		return E('div', { 'class': 'dash-card dash-stat dash-span-1' }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:flex-start' }, [
				E('span', { 'class': 'dash-stat-label' }, [ opts.label ]),
				E('span', { 'class': 'dash-stat-icon' }, [ opts.icon || '' ])
			]),
			E('div', { 'class': 'dash-stat-num' }, [ opts.value ]),
			E('div', { 'class': 'dash-stat-label' }, [ opts.desc || '' ])
		]);
	},

	// donut: data = [{ label, value, color }]
	renderDonut(data, centerText) {
		const C = 2 * Math.PI * 28; // r=28
		const segs = donutSegments(data.map(d => d.value), C);
		const circles = [ svgEl('circle', { cx: 40, cy: 40, r: 28, fill: 'none', stroke: 'var(--dash-divider)', 'stroke-width': 12 }) ];
		segs.forEach((s, i) => {
			if (s.len <= 0) return;
			circles.push(svgEl('circle', {
				cx: 40, cy: 40, r: 28, fill: 'none', stroke: data[i].color, 'stroke-width': 12,
				'stroke-dasharray': s.len.toFixed(3) + ' ' + (C - s.len).toFixed(3),
				'stroke-dashoffset': s.dashoffset.toFixed(3),
				transform: 'rotate(-90 40 40)'
			}));
		});
		circles.push(svgEl('text', { x: 40, y: 45, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700, fill: 'var(--dash-text)' }, [ document.createTextNode(String(centerText)) ]));
		const svg = svgEl('svg', { viewBox: '0 0 80 80', width: 80, height: 80, style: 'flex-shrink:0' }, circles);
		const legend = E('div', { 'class': 'dash-legend' }, data.map(d =>
			E('div', { 'class': 'dash-legend-row' }, [
				E('span', { 'class': 'dash-legend-dot', 'style': 'background:' + d.color }),
				E('span', {}, [ d.label + ' ' + d.value ])
			])
		));
		return E('div', { 'style': 'display:flex;align-items:center;gap:1rem' }, [ svg, legend ]);
	},

	// line chart: series = [{ key, color, label }], samples = [{up, down}, ...]
	renderLineChart(samples, series, opts) {
		const W = 520, H = 100, P = 8;
		const grid = [25, 50, 75].map(y => svgEl('line', { x1: 0, y1: y, x2: W, y2: y, stroke: 'var(--dash-divider)', 'stroke-width': 1 }));
		const paths = series.map(s => svgEl('path', {
			d: sparklinePath(samples, s.key, W, H, P), fill: 'none', stroke: s.color, 'stroke-width': 1.5
		}));
		const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', style: 'width:100%;height:90px;display:block' }, grid.concat(paths));
		const legend = E('div', { 'style': 'display:flex;gap:0.9rem;font-size:0.72rem' }, series.map(s =>
			E('span', { 'style': 'color:' + s.color }, [ s.label ])
		));
		return E('div', {}, [
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem' }, [
				E('div', {}, [
					E('div', { 'class': 'dash-card-title' }, [ opts.title ]),
					E('div', { 'class': 'dash-card-desc' }, [ opts.desc ])
				]),
				legend
			]),
			svg
		]);
	},

	// horizontal signal bar row: label + bar (percent) + right text
	renderSignalRow(label, percent, rightText) {
		const cls = signalQualityClass(percent);
		const w = Math.max(0, Math.min(100, percent));
		return E('div', { 'style': 'display:flex;align-items:center;gap:0.5rem;font-size:0.72rem;margin:0.25rem 0' }, [
			E('span', { 'style': 'width:5rem;flex-shrink:0;color:var(--dash-text-muted)' }, [ label ]),
			E('div', { 'class': 'dash-sigbar' }, [ E('i', { 'class': cls, 'style': 'width:' + w + '%' }) ]),
			E('span', { 'style': 'width:3.2rem;text-align:right;color:var(--dash-text-muted)' }, [ rightText ])
		]);
	}
});
