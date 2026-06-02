# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign luci-mod-dashboard into a modern shadcn-style card dashboard with charts (traffic line, device donut, WiFi signal bars), theme-adaptive colors, and mobile responsiveness — preserving 100% of existing functionality.

**Architecture:** Keep LuCI's pluggable include system (`include/NN_*.js` auto-loaded in sorted order). Add a stateless chart-rendering library (`lib/charts.js`) with unit-tested pure geometry functions. Refactor `index.js` into an orchestrator that maintains traffic history, collects an optional `renderSummary()` from each include, and renders the cross-cutting widgets (stat-card row, traffic chart, device donut) plus each include's detail cards into one CSS Grid. Each include is rewritten to emit themed cards and expose `renderSummary()`.

**Tech Stack:** LuCI client JS (`'require'` AMD-style modules, `E()` DOM builder, `dom`, `network`, `rpc`, `poll`), native inline SVG for charts (no chart library — preserves LuCI's zero-dependency tradition), CSS custom properties for theming. Node.js (v24, already installed) runs the pure-function unit tests.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `htdocs/luci-static/resources/view/dashboard/css/custom.css` | **Rewrite.** CSS variable palette (theme-adaptive), card primitives, CSS Grid layout, responsive breakpoints, dark-mode overrides. |
| `htdocs/luci-static/resources/view/dashboard/lib/charts.js` | **New.** Stateless chart helpers. Pure geometry funcs (`donutSegments`, `sparklinePath`, `signalQualityPercent`) + DOM renderers (`renderDonut`, `renderLineChart`, `renderSignalBar`, `renderStatCard`) built with `E()`. |
| `htdocs/luci-static/resources/view/dashboard/lib/charts.test.mjs` | **New.** Node test runner for the pure geometry functions. |
| `htdocs/luci-static/resources/view/dashboard/include/10_router.js` | **Rewrite render.** Themed system + internet detail cards. New `renderSummary()` returns internet/uptime stat cards + WAN traffic byte sample. |
| `htdocs/luci-static/resources/view/dashboard/include/20_lan.js` | **Rewrite render.** Themed DHCP device card. New `renderSummary()` returns device-count stat + DHCP MAC list. |
| `htdocs/luci-static/resources/view/dashboard/include/30_wifi.js` | **Rewrite render.** Themed WiFi card with signal bars + flow table. New `renderSummary()` returns WiFi-radio-count stat + associated MAC list. |
| `htdocs/luci-static/resources/view/dashboard/index.js` | **Refactor.** Orchestrator: traffic-history state, summary collection, cross-cutting widget rendering, grid layout. |

**Cross-include data flow (avoids ordering bugs):** `index.js` already receives the full `results` array from all includes. It calls each include's optional `renderSummary(result)` → `{ stats: [...], macs: [...], trafficSample: {...} }`. `index.js` owns all aggregation (donut = DHCP MACs setminus WiFi MACs; traffic chart = history of WAN samples). No include depends on another include's execution.

---

## Verification approach

- **`lib/charts.js` pure functions:** real TDD via `node charts.test.mjs` (Tasks 2).
- **DOM renderers, include rewrites, layout:** no in-repo browser-test harness exists (CI lints JSON only). Verify by serving the module in a LuCI instance and following the explicit manual checklist in each task. Where the user has a running router/LuCI dev env, load `Status → Dashboard`. Each task lists exactly what to look at.
- **Every JS file must remain valid AMD-style LuCI module syntax.** Quick syntax sanity: `node --check <file>` is NOT valid (LuCI `'require'` pragmas aren't ES modules); instead rely on the browser console being error-free as the check.

---

## Task 1: CSS foundation — theme-adaptive palette, card primitives, grid

**Files:**
- Modify (full rewrite): `htdocs/luci-static/resources/view/dashboard/css/custom.css`

This task replaces hardcoded colors, `!important`, and fixed pixel heights with a CSS-variable system and a responsive grid. Detail-card inner markup classes are kept compatible with what later tasks emit.

- [ ] **Step 1: Replace the file header and define the variable palette**

Overwrite the top of `custom.css` (everything before the `Responsive` block) with the palette + primitives below. Keep the file's existing `@media` responsive block for now (Step 4 replaces it).

```css
/**
 * Dashboard Styles — theme-adaptive, card-based layout
**/

.Dashboard {
	/* Surface + text: map to LuCI generic theme vars first, then safe fallbacks.
	   No !important, so third-party themes can still override. */
	--dash-page-bg:     var(--background-color-low, transparent);
	--dash-card-bg:     var(--background-color-high, #ffffff);
	--dash-card-border: var(--border-color-medium, #e5e7eb);
	--dash-divider:     var(--border-color-medium, #eef0f2);
	--dash-text:        var(--text-color-high, #111827);
	--dash-text-muted:  var(--text-color-low, #6b7280);

	/* Chart palette — identical in light/dark for brand consistency */
	--dash-c-green:  #22c55e;
	--dash-c-red:    #ef4444;
	--dash-c-amber:  #f59e0b;
	--dash-c-blue:   #3b82f6;
	--dash-c-violet: #a78bfa;
	--dash-c-pink:   #ec4899;

	--dash-radius: 12px;
	--dash-gap: 12px;

	color: var(--dash-text);
}

/* ---- Card primitive ---- */
.Dashboard .dash-card {
	background: var(--dash-card-bg);
	border: 1px solid var(--dash-card-border);
	border-radius: var(--dash-radius);
	padding: 1rem 1.25rem;
}
.Dashboard .dash-card-title { font-size: 0.85rem; font-weight: 600; color: var(--dash-text); }
.Dashboard .dash-card-desc  { font-size: 0.75rem; color: var(--dash-text-muted); margin-top: 0.15rem; }
.Dashboard .dash-section-label {
	font-size: 0.72rem; font-weight: 600; color: var(--dash-text-muted);
	text-transform: uppercase; letter-spacing: 0.04em; margin: 0.5rem 0 0.4rem;
}
.Dashboard .dash-divider { border: 0; border-top: 1px solid var(--dash-divider); margin: 0.6rem 0; }

/* ---- Stat card ---- */
.Dashboard .dash-stat .dash-stat-label { font-size: 0.72rem; color: var(--dash-text-muted); }
.Dashboard .dash-stat .dash-stat-num   { font-size: 1.6rem; font-weight: 700; line-height: 1.1; margin: 0.45rem 0 0.2rem; }
.Dashboard .dash-stat .dash-stat-icon  { font-size: 1.1rem; opacity: 0.6; }

/* ---- Key/value rows ---- */
.Dashboard .dash-row {
	display: flex; justify-content: space-between; align-items: center;
	padding: 0.4rem 0; border-bottom: 1px solid var(--dash-divider); font-size: 0.78rem;
}
.Dashboard .dash-row:last-child { border-bottom: none; }
.Dashboard .dash-row .dash-key { color: var(--dash-text-muted); }
.Dashboard .dash-row .dash-val { color: var(--dash-text); font-weight: 500; word-break: break-all; text-align: right; }

/* ---- Badge ---- */
.Dashboard .dash-badge {
	display: inline-flex; align-items: center; gap: 0.25rem;
	padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.7rem; font-weight: 500;
}
.Dashboard .dash-badge.green { background: color-mix(in srgb, var(--dash-c-green) 15%, transparent); color: var(--dash-c-green); }
.Dashboard .dash-badge.red   { background: color-mix(in srgb, var(--dash-c-red) 15%, transparent);   color: var(--dash-c-red); }

/* ---- Table ---- */
.Dashboard .dash-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.Dashboard .dash-table th {
	padding: 0.45rem 0.6rem; text-align: left; font-size: 0.7rem; font-weight: 500;
	color: var(--dash-text-muted); text-transform: uppercase; letter-spacing: 0.03em;
	border-bottom: 1px solid var(--dash-card-border);
}
.Dashboard .dash-table td { padding: 0.45rem 0.6rem; color: var(--dash-text); border-bottom: 1px solid var(--dash-divider); }
.Dashboard .dash-table tr:last-child td { border-bottom: none; }

/* ---- Horizontal signal bar ---- */
.Dashboard .dash-sigbar { flex: 1; height: 6px; background: var(--dash-divider); border-radius: 999px; overflow: hidden; }
.Dashboard .dash-sigbar > i { display: block; height: 100%; border-radius: 999px; }
.Dashboard .dash-sigbar > i.low  { background: var(--dash-c-red); }
.Dashboard .dash-sigbar > i.mid  { background: var(--dash-c-amber); }
.Dashboard .dash-sigbar > i.high { background: var(--dash-c-green); }

/* ---- Donut legend ---- */
.Dashboard .dash-legend { display: flex; flex-direction: column; gap: 0.35rem; }
.Dashboard .dash-legend-row { display: flex; align-items: center; gap: 0.45rem; font-size: 0.72rem; color: var(--dash-text-muted); }
.Dashboard .dash-legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
```

- [ ] **Step 2: Add the CSS Grid layout containers**

Append the grid system. `index.js` (Task 7) wraps everything in `.dash-grid` and uses span helpers.

```css
/* ---- Grid layout ---- */
.Dashboard .dash-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--dash-gap); align-items: start; }
.Dashboard .dash-span-1 { grid-column: span 1; }
.Dashboard .dash-span-2 { grid-column: span 2; }
.Dashboard .dash-span-3 { grid-column: span 3; }
.Dashboard .dash-span-4 { grid-column: span 4; }

/* fade-in reused from existing JS class hooks */
.Dashboard.fade-in, .Dashboard .fade-in { animation: dashFade 0.3s ease; }
@keyframes dashFade { from { opacity: 0; } to { opacity: 1; } }
```

- [ ] **Step 3: Add dark-mode overrides (two detection paths)**

Append. Covers both LuCI Bootstrap's `[data-darkmode="true"]` and generic `prefers-color-scheme`, so third-party themes work without defining LuCI's private vars.

```css
/* ---- Dark mode: only override fallbacks; theme vars (if present) still win ---- */
@media (prefers-color-scheme: dark) {
	.Dashboard {
		--dash-card-bg:     var(--background-color-high, #18181b);
		--dash-card-border: var(--border-color-medium, #27272a);
		--dash-divider:     var(--border-color-medium, #27272a);
		--dash-text:        var(--text-color-high, #fafafa);
		--dash-text-muted:  var(--text-color-low, #a1a1aa);
	}
}
[data-darkmode="true"] .Dashboard {
	--dash-card-bg:     var(--background-color-high, #18181b);
	--dash-card-border: var(--border-color-medium, #27272a);
	--dash-divider:     var(--border-color-medium, #27272a);
	--dash-text:        var(--text-color-high, #fafafa);
	--dash-text-muted:  var(--text-color-low, #a1a1aa);
}
/* Invert monochrome SVG icons in dark mode (both paths) */
@media (prefers-color-scheme: dark) { .Dashboard .svgmonotone { filter: invert(0.9); } }
[data-darkmode="true"] .Dashboard .svgmonotone { filter: invert(0.9); }
```

- [ ] **Step 4: Replace the responsive block**

Delete the old `@media screen and (min-width: 200px) and (max-width: 640px)` block at the end of the file and replace with:

```css
/**
 * Responsive
 **/
@media screen and (max-width: 1024px) {
	.Dashboard .dash-grid { grid-template-columns: repeat(2, 1fr); }
	.Dashboard .dash-span-3, .Dashboard .dash-span-4 { grid-column: span 2; }
	.Dashboard .dash-span-2 { grid-column: span 2; }
}
@media screen and (max-width: 640px) {
	.Dashboard .dash-grid { grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
	/* stat cards stay 2-up; everything else full width */
	.Dashboard .dash-span-2, .Dashboard .dash-span-3, .Dashboard .dash-span-4 { grid-column: span 2; }
	.Dashboard .dash-card { padding: 0.8rem 0.9rem; }
	/* tables → stacked card rows on phones */
	.Dashboard .dash-table.stackable thead { display: none; }
	.Dashboard .dash-table.stackable tr { display: block; padding: 0.4rem 0; border-bottom: 1px solid var(--dash-divider); }
	.Dashboard .dash-table.stackable td { display: flex; justify-content: space-between; border: none; padding: 0.15rem 0; }
	.Dashboard .dash-table.stackable td::before { content: attr(data-label); color: var(--dash-text-muted); font-size: 0.7rem; }
}
```

- [ ] **Step 5: Verify no leftover hardcoded values**

Run: `grep -nE '#[0-9a-fA-F]{3,6}|!important|[0-9]+px' htdocs/luci-static/resources/view/dashboard/css/custom.css | grep -v 'fallback\|var(' | grep -vE '6px|9px|999px|1px'`
Expected: only intentional small structural pixels (border widths `1px`, dot sizes `6px`/`9px`, pill radius `999px`) remain; NO `!important`, NO `466px`/`97px`, NO hex colors outside `var(... , #fallback)` fallbacks. If anything else shows, fix it.

- [ ] **Step 6: Commit**

```bash
git add htdocs/luci-static/resources/view/dashboard/css/custom.css
git commit -m "feat(dashboard): theme-adaptive CSS foundation and grid

Replace hardcoded colors, !important, and fixed pixel heights with a
CSS-variable palette mapped to LuCI generic theme vars (with fallbacks),
card primitives, responsive grid, and dual-path dark mode."
```

---

## Task 2: charts.js — pure geometry functions (TDD)

**Files:**
- Create: `htdocs/luci-static/resources/view/dashboard/lib/charts.js`
- Create (test): `htdocs/luci-static/resources/view/dashboard/lib/charts.test.mjs`

The geometry math is the error-prone part — unit-test it in isolation. These functions are written as plain functions on a plain object so the test file can import them; the LuCI module wrapper is added in Task 3 around the SAME functions. To keep one source of truth, we author the pure functions in a way both the browser module and the node test can use: the test re-implements the import via a small extraction shim (see Step 1).

- [ ] **Step 1: Write the failing test**

Create `lib/charts.test.mjs`:

```js
// Run with: node charts.test.mjs
// Pure geometry functions are duplicated here as the import target via a shim:
// we read charts.js, strip the LuCI 'require'/baseclass wrapper, and eval the
// pure-function block delimited by // <pure> ... // </pure> markers.
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

const src = readFileSync(new URL('./charts.js', import.meta.url), 'utf8');
const m = src.match(/\/\/ <pure>([\s\S]*?)\/\/ <\/pure>/);
assert(m, 'charts.js must contain a // <pure> ... // </pure> block');
const pure = {};
new Function('exports', m[1] + '\nexports.donutSegments = donutSegments; exports.sparklinePath = sparklinePath; exports.signalQualityClass = signalQualityClass;')(pure);

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// donutSegments: returns [{value, dasharray, dashoffset, frac}], circumference-based
test('donutSegments splits proportionally and sums to full circle', () => {
	const segs = pure.donutSegments([5, 4, 3], 100); // C = 100 for easy math
	assert.strictEqual(segs.length, 3);
	assert.ok(Math.abs(segs[0].frac - 5/12) < 1e-9);
	// dash lengths sum to circumference
	const sum = segs.reduce((a, s) => a + s.len, 0);
	assert.ok(Math.abs(sum - 100) < 1e-9);
});

test('donutSegments handles all-zero as empty (no NaN)', () => {
	const segs = pure.donutSegments([0, 0, 0], 100);
	assert.ok(segs.every(s => s.len === 0 && !Number.isNaN(s.len)));
});

// sparklinePath: maps [{up,down}] samples to an SVG path "d" string scaled to width/height
test('sparklinePath produces a path starting at x=0 and ending at x=width', () => {
	const d = pure.sparklinePath([10, 20, 15, 30], 'up', 300, 100, 30);
	assert.ok(d.startsWith('M0,'), 'starts at x=0: ' + d);
	assert.ok(/(?:L|C|\s)2?99(?:\.\d+)?,|300,/.test(d) || d.includes('300,'), 'reaches right edge: ' + d);
});

test('sparklinePath with single point is a flat line', () => {
	const d = pure.sparklinePath([42], 'up', 300, 100, 30);
	assert.ok(d.startsWith('M0,'), d);
});

// signalQualityClass: maps percent → low/mid/high
test('signalQualityClass thresholds', () => {
	assert.strictEqual(pure.signalQualityClass(10), 'low');
	assert.strictEqual(pure.signalQualityClass(40), 'mid');
	assert.strictEqual(pure.signalQualityClass(80), 'high');
});

console.log(`\n${passed} tests passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd htdocs/luci-static/resources/view/dashboard/lib && node charts.test.mjs`
Expected: FAIL — `charts.js` does not exist yet (`ENOENT`) or no `// <pure>` block.

- [ ] **Step 3: Write minimal implementation**

Create `lib/charts.js` with ONLY the pure block for now (Task 3 adds the LuCI wrapper + DOM renderers around it):

```js
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
	let d = 'M' + pts[0][0] + ',' + pts[0][1].toFixed(2);
	for (let i = 1; i < pts.length; i++)
		d += ' L' + pts[i][0].toFixed(2) + ',' + pts[i][1].toFixed(2);
	if (n === 1) d += ' L' + width + ',' + pts[0][1].toFixed(2);
	return d;
}

function signalQualityClass(percent) {
	if (percent < 25) return 'low';
	if (percent < 50) return 'mid';
	return 'high';
}
// </pure>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd htdocs/luci-static/resources/view/dashboard/lib && node charts.test.mjs`
Expected: PASS — `7 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add htdocs/luci-static/resources/view/dashboard/lib/charts.js htdocs/luci-static/resources/view/dashboard/lib/charts.test.mjs
git commit -m "feat(dashboard): pure chart geometry helpers with unit tests"
```

---

## Task 3: charts.js — DOM renderers

**Files:**
- Modify: `htdocs/luci-static/resources/view/dashboard/lib/charts.js`

Wrap the pure functions in a LuCI `baseclass` and add `E()`-based renderers used by the includes and `index.js`. SVG uses `E('svg', ...)` — note LuCI's `E()` creates elements in the HTML namespace; for SVG we must use `document.createElementNS`. Provide a small `svgEl` helper.

- [ ] **Step 1: Append the baseclass export with renderers**

Add to the end of `charts.js` (after the `// </pure>` block):

```js
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
```

- [ ] **Step 2: Confirm the test still passes (wrapper didn't break the pure block)**

Run: `cd htdocs/luci-static/resources/view/dashboard/lib && node charts.test.mjs`
Expected: PASS — `7 tests passed` (the shim only evals the `// <pure>` block, so the `return baseclass.extend(...)` is ignored).

- [ ] **Step 3: Manual smoke check of module shape**

Run: `grep -c "return baseclass.extend" htdocs/luci-static/resources/view/dashboard/lib/charts.js`
Expected: `1`. Confirms exactly one module export.

- [ ] **Step 4: Commit**

```bash
git add htdocs/luci-static/resources/view/dashboard/lib/charts.js
git commit -m "feat(dashboard): SVG chart DOM renderers (donut, line, signal, stat)"
```

---

## Task 4: 10_router.js — themed cards + renderSummary

**Files:**
- Modify: `htdocs/luci-static/resources/view/dashboard/include/10_router.js`

Preserve every field (system: model/firmware/kernel/arch/localtime/uptime; internet: IPv4+IPv6 connected/uptime/protocol/addrs/gateway/dns/prefix). Re-emit as themed cards. Add `renderSummary()` returning the internet + uptime stat cards and a WAN traffic byte sample.

- [ ] **Step 1: Add `'require'` for charts and the WAN device sampler in `load()`**

At the top, after `'require uci';` add:

```js
'require view.dashboard.lib.charts as charts';
```

Replace `load()` to also resolve the WAN protocol's L3 device byte counters. Replace the existing `load()`:

```js
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
```

- [ ] **Step 2: Rewrite `renderHtml` to emit themed cards**

Replace the whole `renderHtml(data, type)` method body so that:
- The wrapper uses `dash-card dash-span-2` instead of `dashboard-bg box-s1`.
- Title row uses the existing icon `<img>` (keep `svgmonotone` class + icon-switch logic) plus `<h3>`.
- Rows use `.dash-row` / `.dash-key` / `.dash-val`; connected status uses `.dash-badge green|red`.
- Section labels (`IPv4`/`IPv6`) use `.dash-section-label`.
- The colon separator is appended via `E('span',{},[title])` + value span (NOT a hardcoded `：` inside the string — drop the full-width colon; the flex layout provides separation).

```js
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
					cls = field.value ? 'dash-badge green' : 'dash-badge red';
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
```

Note: the IPv4-address array post-processing previously in the loop (`addrs[ip].split('/')[0]`) must be preserved. Keep the existing `renderUpdateWanData`/`renderInternetBox`/`renderRouterBox` data-prep methods unchanged — they still populate `this.params`. Only the address-split logic that lived inside `renderHtml` moves: add it into `renderUpdateWanData` where `addrsv4` is set:

In `renderUpdateWanData` (v4 branch), change:
```js
this.params.internet.v4.addrsv4.value = ifc.getIPAddrs() || [ '-'];
```
to:
```js
this.params.internet.v4.addrsv4.value = (ifc.getIPAddrs() || ['-']).map(a => a.split('/')[0]);
```

- [ ] **Step 3: Add `renderSummary` and keep `render` returning both detail cards**

Add method and update `render`:

```js
renderSummary(data) {
	// data is the same array passed to render(); compute stat cards + traffic sample.
	const systeminfo = data[3];
	const v4 = this.params.internet ? this.params.internet.v4 : null;
	const connected = v4 ? !!v4.connected.value : false;
	const stats = [
		charts.renderStatCard({
			label: _('Internet'), icon: '🌐',
			value: E('span', { 'class': connected ? 'dash-badge green' : 'dash-badge red' }, [ connected ? _('Connected') : _('Disconnected') ]),
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
```

Note: `renderInternetBox` populates `this.params.internet` before `renderSummary` reads it, so `index.js` must call `render()` before `renderSummary()` (Task 7 guarantees this order).

- [ ] **Step 4: Manual verification**

Load `Status → Dashboard` in a LuCI dev instance. Confirm: System card shows model/firmware/kernel/arch/local-time/uptime; Internet card shows IPv4 + IPv6 sections with connected badge, protocol, addresses, gateway, DNS. Browser console has no errors. (Stat cards/traffic appear after Task 7.)

- [ ] **Step 5: Commit**

```bash
git add htdocs/luci-static/resources/view/dashboard/include/10_router.js
git commit -m "feat(dashboard): themed system/internet cards + renderSummary"
```

---

## Task 5: 20_lan.js — themed DHCP card + renderSummary

**Files:**
- Modify: `htdocs/luci-static/resources/view/dashboard/include/20_lan.js`

Preserve: hostname/IP/MAC per lease, total count, `dnsmasq`/`odhcpd` feature gate.

- [ ] **Step 1: Rewrite `renderHtml` to a themed, mobile-stackable table**

Replace `renderHtml()`:

```js
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
```

- [ ] **Step 2: Add `renderSummary` (device-count stat + MAC list)**

```js
renderSummary() {
	const devs = (this.params.lan && this.params.lan.devices) || [];
	return {
		stats: [],
		macs: devs.map(d => (d.macaddr || '').toLowerCase()).filter(Boolean)
	};
},
```

Replace the `stats: []` line with the device-count stat card:
```js
		stats: [ charts.renderStatCard({ label: _('Online Devices'), icon: '💻', value: String(devs.length), desc: _('Active DHCP leases') }) ],
```
and add the charts require at top of file after `'require network';`:
```js
'require view.dashboard.lib.charts as charts';
```

- [ ] **Step 3: Update `render` to store leases and keep feature gate**

Replace `render`:

```js
render([leases]) {
	if (L.hasSystemFeature('dnsmasq') || L.hasSystemFeature('odhcpd'))
		return this.renderLeases(leases);
	this.params.lan = { devices: [] };
	return E([]);
}
```

(`renderLeases` → `renderUpdateData` → sets `this.params.lan`; unchanged. Setting an empty `params.lan` in the no-feature path prevents `renderSummary` from throwing.)

- [ ] **Step 4: Manual verification**

Reload Dashboard. DHCP card lists devices with hostname/IP/MAC and a count in the description. Resize browser ≤640px: table rows stack with labels. No console errors.

- [ ] **Step 5: Commit**

```bash
git add htdocs/luci-static/resources/view/dashboard/include/20_lan.js
git commit -m "feat(dashboard): themed DHCP device card + renderSummary"
```

---

## Task 6: 30_wifi.js — signal bars + flow table + renderSummary

**Files:**
- Modify: `htdocs/luci-static/resources/view/dashboard/include/30_wifi.js`

Preserve: per-radio SSID/active/channel+freq/bitrate/BSSID/encryption/connected-count; per-client hostname/SSID/signal/up+down; signal quality math (noise floor); no-radio → empty.

- [ ] **Step 1: Add charts require and rewrite the radio/section part of `renderHtml`**

After `'require rpc';` add:
```js
'require view.dashboard.lib.charts as charts';
```

Rewrite `renderHtml()` so that: wrapper is `dash-card dash-span-2`; each radio renders a `.dash-section-label` header with `SSID · channel · freq · rate · encryption` and an active badge; each radio's associated clients render as `charts.renderSignalRow(hostname, qualityPercent, rssiText)`; below, a stackable flow table lists hostname/SSID/up/down. Keep the data already prepared in `this.params.wifi.radios` and `this.params.wifi.devices`.

```js
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
			E('span', { 'class': (active === _('yes') || active === true) ? 'dash-badge green' : 'dash-badge red' }, [ active === true ? _('yes') : active ])
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
```

Note: existing `renderUpdateData` keeps populating `this.params.wifi.radios[i].ssid.value` etc. The `isactive` field is converted to `_('yes')/_('no')` inside the OLD renderHtml loop; that conversion must move. In `renderUpdateData`, the radios already store `isactive.value` as a boolean. Leave it boolean; the new code above handles both boolean and the yes/no string defensively.

- [ ] **Step 2: Add `renderSummary` (radio-count stat + associated MAC list)**

```js
renderSummary() {
	const radios = (this.params.wifi && this.params.wifi.radios) || [];
	const macs = [];
	// associated client MACs gathered during renderUpdateData (see Step 3)
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
```

- [ ] **Step 3: Capture associated MACs in `renderUpdateData`**

Inside `renderUpdateData`, before the device loop, init `this._assocMacs = [];` and inside the inner `assoclist` loop where `bss` is read, push `this._assocMacs.push(bss.mac);`. Also reset it in `render` before calling `renderUpdateData`:

In `render`:
```js
render([radios, networks, hosthints]) {
	this.params.wifi = { radios: [], devices: [] };
	this._assocMacs = [];
	this.renderUpdateData(radios, networks, hosthints);
	if (this.params.wifi.radios.length)
		return this.renderHtml();
	return E([]);
}
```

In `renderUpdateData`, inside `for (let k = 0; ...assoclist.length...)` after `const bss = networks[i].assoclist[k];` add:
```js
			this._assocMacs.push(bss.mac);
```

- [ ] **Step 4: Manual verification**

Reload Dashboard with WiFi active. Each radio shows SSID + active badge + channel/rate/BSSID/encryption/connected-count. Connected clients show colored horizontal signal bars (green/amber/red by strength) and a flow table with up/down. Disable WiFi → card disappears, no errors. Console clean.

- [ ] **Step 5: Commit**

```bash
git add htdocs/luci-static/resources/view/dashboard/include/30_wifi.js
git commit -m "feat(dashboard): wifi signal bars, flow table + renderSummary"
```

---

## Task 7: index.js — orchestrator (stat row, traffic chart, donut, grid)

**Files:**
- Modify: `htdocs/luci-static/resources/view/dashboard/index.js`

Refactor so `index.js` owns the cross-cutting widgets and the grid. Maintain a bounded traffic history. Render order: top stat-card row → traffic chart (span-2) → device donut (span-2) → each include's detail cards.

- [ ] **Step 1: Add charts require and a module-level traffic history**

After `'require network';` add:
```js
'require view.dashboard.lib.charts as charts';
```

Below the stylesheet append block, add:
```js
const TRAFFIC_MAX = 60;          // keep last 60 samples
let trafficHistory = [];          // [{ up, down }] bytes/sec
let lastSample = null;            // { rx, tx, t }
```

- [ ] **Step 2: Add a helper that converts a raw byte sample into a rate and pushes history**

```js
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
```

- [ ] **Step 3: Refactor `startPolling` to collect summaries (tagged) and render the grid**

Distinguishing wired vs wireless for the donut needs to know which `macs` came from LAN vs WiFi. Each summary is tagged with its include module name (`__name`, set in Step 5's `load()`); the donut uses that tag to assign MACs to the LAN or WiFi set.

Replace `startPolling` and the per-include append logic. The key changes: call `render()` first (populates each include's `params`), then `renderSummary()`, tag by include module name, build grid.

```js
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
			root.classList.add('Dashboard');
			dom.content(root, grid);
		});
	};

	return step().then(() => { poll.add(step); });
}
```

- [ ] **Step 4: Tag includes with their module name in `load()` and simplify `render()`**

Update the view's `load()` to remember each include's module name, and `render()` to provide a single root container:

```js
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
```

- [ ] **Step 5: Manual verification (full integration)**

Reload Dashboard. Confirm in order: a row of stat cards (Internet badge, Uptime, Online Devices, WiFi Networks); a realtime traffic chart that begins flat and grows a line after the second poll (~5s); a device-distribution donut (wired vs wireless) with legend and a center total; then System, Internet, DHCP, and WiFi detail cards. Watch two poll cycles — traffic line should update. Console clean.

- [ ] **Step 6: Commit**

```bash
git add htdocs/luci-static/resources/view/dashboard/index.js
git commit -m "feat(dashboard): orchestrate stat row, traffic chart, donut, grid"
```

---

## Task 8: Cross-cutting verification (theme, mobile, i18n, regression)

**Files:** none (verification only); fix-ups committed if issues found.

- [ ] **Step 1: Functionality regression checklist**

Open Dashboard and tick every item from the spec's §3 functional list:
- System: model, firmware, kernel, arch, local time, uptime — all present.
- Internet IPv4: connected badge, uptime, protocol, address(es), gateway, DNS.
- Internet IPv6: connected badge, uptime, protocol, prefix, gateway, DNS.
- DHCP: hostname/IP/MAC per device + total count; hidden when no dnsmasq/odhcpd.
- WiFi radios: SSID, active, channel+freq, bitrate, BSSID, encryption, connected count.
- WiFi clients: hostname, SSID, signal (bar), up/down; card hidden when no radios.

Any missing field → fix the relevant include and re-commit before continuing.

- [ ] **Step 2: Theme verification**

Switch LuCI theme to dark (Bootstrap `data-darkmode`) → cards/text/borders adapt, SVG icons inverted, chart colors still legible. Switch to a light theme → white cards, dark text. If a third-party theme is available (e.g. Material), load it → confirm cards still readable (no black-on-black), because vars fall back gracefully.

Run to confirm no hard `!important`/fixed colors slipped into JS inline styles:
`grep -rnE '!important|#[0-9a-fA-F]{6}' htdocs/luci-static/resources/view/dashboard/include/ htdocs/luci-static/resources/view/dashboard/index.js`
Expected: no matches (chart colors use `var(--dash-c-*)`).

- [ ] **Step 3: Mobile verification**

Narrow the browser to 375px. Confirm: stat cards 2-up; traffic chart, donut, and each detail card full-width; tables collapse to stacked rows with `data-label` prefixes; no horizontal scroll; no text overflow.

- [ ] **Step 4: i18n check**

Confirm no full-width `：` colons remain hardcoded in JS:
`grep -rn '：' htdocs/luci-static/resources/view/dashboard/`
Expected: no matches (separation is structural now). If any remain, remove them.

Then run the message-extraction sanity (if available): `grep -rn "_('" htdocs/luci-static/resources/view/dashboard/include/ | wc -l` — confirm strings are wrapped in `_()`.

- [ ] **Step 5: Run the chart unit tests once more**

Run: `cd htdocs/luci-static/resources/view/dashboard/lib && node charts.test.mjs`
Expected: PASS — `7 tests passed`.

- [ ] **Step 6: Final commit (only if fix-ups were made)**

```bash
git add -A
git commit -m "fix(dashboard): theme/mobile/i18n verification fix-ups"
```

---

## Self-review notes

- **Spec §3 functionality** → Tasks 4/5/6 re-emit every field; Task 8 §1 verifies.
- **Spec §4 layout** → Task 1 grid + Task 7 ordering.
- **Spec §5 data sources** → Task 4 traffic sampling via `getL3Device().getRXBytes/getTXBytes`; donut via MAC set-difference in Task 7; no new RPC.
- **Spec §6 colors** → Task 1 vars + dual dark-mode paths; Task 8 §2 verifies fallbacks; §4 removes hardcoded colons.
- **Spec §7 files** → all five files + new `lib/charts.js` covered.
- **Spec §8 non-goals** → native SVG only (no chart lib); no persistence; no backend/RPC changes.
- **Type consistency** → `renderSummary()` returns `{ stats, macs?, trafficSample? }` consistently across includes; `charts.renderStatCard/renderDonut/renderLineChart/renderSignalRow` signatures match call sites; `__name` set in `load()` and read in `startPolling`.
