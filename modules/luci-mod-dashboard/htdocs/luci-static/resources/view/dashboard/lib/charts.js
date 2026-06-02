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
