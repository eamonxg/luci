// Run with: node --test modules/luci-mod-dashboard/tests/temperature.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({
	baseclass: { extend: value => value }, rpc: { declare: () => () => Promise.reject(new Error('offline')) },
	charts: { kpi: value => value, empty: value => value }, _: value => value,
	L: { resolveDefault: (promise, fallback) => promise.catch(() => fallback) },
	E: (tag, attrs, children) => ({ tag, attrs, children })
});
vm.runInContext(`String.prototype.format = function(...values) {
	let i = 0;
	return this.replace(/%([.][0-9]+)?[sdf]/g, (match, precision) => {
		const value = values[i++];
		return precision ? Number(value).toFixed(Number(precision.slice(1))) : String(value);
	});
}`, context);
const source = readFileSync(new URL('../htdocs/luci-static/resources/view/dashboard/include/13_temperature.js', import.meta.url), 'utf8');
const widget = vm.runInContext(`(function() { ${source} })()`, context);
const summary = card => Array.from(card.sub, line => line.replaceAll('\u00a0', ' '));

test('Processor summary ignores hotter network sensors', () => {
	const sections = widget.render({ status: 'ok', age_ms: 0, sensors: [
		{ label: 'cpu_thermal / temp1', celsius: 49.97 }, { category: 'wifi', label: 'mt7915 / temp1', celsius: 49 },
		{ category: 'wifi', label: 'mt7915 / temp1', celsius: 53 }, { label: 'mdio_bus:01 / temp1', celsius: 48.88 }
	] });
	const output = sections.cards[0].node();
	assert.equal(output.value[0], 'CPU 50.0 °C');
	assert.equal(output.title, 'Temperature');
	assert.equal(summary(output)[0], 'Wi-Fi 53.0 °C');
	assert.equal(output.stacked, true);
	const details = JSON.stringify(sections.tabs[0].content());
	assert.ok(details.includes('53.0 °C') && details.includes('48.9 °C'));
	assert.ok(details.includes('mdio_bus:01 / temp1'));
});

test('Unidentified sensors are not used as processor temperature', () => {
	const output = widget.render({ status: 'ok', sensors: [ { label: 'unknown sensor', celsius: -1 }, { label: 'unknown sensor', celsius: 0 } ] }).cards[0].node();
	assert.equal(output.value[0], 'CPU —');
	assert.equal(output.title, 'Temperature');
});

test('Unsupported is hidden; errors never render zero; stale partial data is labelled', async () => {
	assert.equal(widget.render({ status: 'unsupported', sensors: [] }).cards.length, 0);
	assert.equal(widget.render(await widget.load()).cards[0].node().value[0], 'CPU —');
	const output = widget.render({ status: 'partial', age_ms: 30000, sensors: [ { label: 'cpu_thermal / temp1', celsius: 50 }, { label: 'mt7915 / temp1', celsius: null } ] }).cards[0].node();
	assert.equal(output.sub.length, 1);
	assert.ok(output.sub.includes('Reading age: 30 seconds'));
});


test('Intel package, AMD die and ARM CPU readings, including failed primary', () => {
	for (const label of ['coretemp / Package id 0', 'k10temp / Tdie', 'cpu_thermal / temp1']) {
		const card = value => widget.render({ status: 'ok', age_ms: 5000, sensors: [
			{ label: 'nvme / Composite', celsius: 90 }, { label, celsius: value }
		] }).cards[0].node();
		assert.equal(card(0).value[0], '0.0 °C');
		assert.equal(card(-1).value[0], '-1.0 °C');
		assert.equal(card(null).value[0], '—');
		assert.equal(card(40).sub.length, 0);
		assert.equal(card(40).title, 'CPU temperature');
	}
	const output = widget.render({ status: 'ok', sensors: [
		{ label: 'coretemp / Core 0', celsius: 60 },
		{ label: 'coretemp / Package id 0', celsius: 50 }
	] }).cards[0].node();
	assert.equal(output.value[0], '50.0 °C');
});


test('Generic SoC temperature remains in details without being called CPU', () => {
	const sections = widget.render({ status: 'ok', sensors: [ { label: 'soc-thermal', celsius: 45 } ] });
	assert.equal(sections.cards[0].node().value[0], 'CPU —');
	assert.ok(JSON.stringify(sections.tabs[0].content()).includes('45.0 °C'));
});

test('A failed package reading is not replaced by a working core or network sensor', () => {
	const sections = widget.render({ status: 'partial', sensors: [
		{ id: 'cpu/temp2', label: 'coretemp / Core 0', celsius: 60 },
		{ id: 'wifi/temp1', category: 'wifi', label: 'mt7915 / temp1', celsius: 70 },
		{ id: 'cpu/temp1', label: 'coretemp / Package id 0', celsius: null }
	] });
	assert.equal(sections.cards[0].node().value[0], 'CPU —');
	assert.match(JSON.stringify(sections.tabs[0].content()), /Some temperature sensors are unavailable/);
});

test('Non-finite readings are unavailable and unknown categories remain visible', () => {
	for (const value of [null, undefined, NaN, Infinity, -Infinity, '42']) {
		const sections = widget.render({ status: 'partial', sensors: [
			{ label: 'cpu-thermal', celsius: value },
			{ category: 'future-driver', label: 'new-driver / temp1', celsius: 42 }
		] });
		assert.equal(sections.cards[0].node().value[0], '—');
		const details = JSON.stringify(sections.tabs[0].content());
		assert.match(details, /Other sensors/);
		assert.match(details, /new-driver \/ temp1/);
		assert.match(details, /42.0 °C/);
	}
});

test('Module summaries show only discovered components and preserve every channel in details', () => {
	const sections = widget.render({ status: 'ok', sensors: [
		{ category: 'cpu', label: 'cpu0-thermal', celsius: 67 },
		{ category: 'nss', label: 'nss0-thermal', celsius: 66 },
		{ category: 'nss', label: 'nss1-thermal', celsius: 68 },
		{ category: 'wifi', label: 'wcss-phya0-thermal', celsius: 65 },
		{ category: 'wifi', label: 'wcss-phyb0-thermal', celsius: 67 },
		{ category: 'modem', label: 'modem-thermal', celsius: 50 }
	] });
	const card = sections.cards[0].node();
	assert.equal(card.title, 'Temperature');
	assert.equal(card.value[0], 'CPU 67.0 °C');
	assert.deepEqual(summary(card), ['NSS 68.0 °C · Wi-Fi 67.0 °C', 'Modem 50.0 °C']);
	const details = sections.tabs[0].content();
	const table = details.children.find(node => node.tag == 'table');
	assert.equal(table.children.length, 7);
	assert.deepEqual(Array.from(table.children.slice(1), row => row.children[0].children[0]), ['CPU', 'NSS', 'NSS', 'Wi-Fi', 'Wi-Fi', 'Modem']);
	assert.match(JSON.stringify(details), /65.0 °C/);
	assert.match(JSON.stringify(details), /highest available temperature/);

	const wifiOnly = widget.render({ status: 'ok', sensors: [
		{ category: 'cpu', label: 'cpu-thermal', celsius: 40 },
		{ category: 'wifi', label: 'mt7915 / temp1', celsius: 41 }
	] }).cards[0].node();
	assert.deepEqual(summary(wifiOnly), ['Wi-Fi 41.0 °C']);
});

test('Failed module readings remain visible and valid zero/negative readings are summarized', () => {
	const render = (wifi, modem) => widget.render({ status: 'partial', age_ms: 30000, sensors: [
		{ category: 'cpu', label: 'cpu-thermal', celsius: 40 },
		{ category: 'wifi', label: 'radio 0', celsius: wifi },
		{ category: 'wifi', label: 'radio 1', celsius: null },
		{ category: 'modem', label: 'modem-thermal', celsius: modem }
	] }).cards[0].node();
	assert.deepEqual(summary(render(0, -1)), ['Wi-Fi 0.0 °C · Modem -1.0 °C', 'Reading age: 30 seconds']);
	assert.deepEqual(summary(render(null, NaN)), ['Wi-Fi — · Modem —', 'Reading age: 30 seconds']);
	assert.equal(render(99, 99).value[0], 'CPU 40.0 °C');
});

test('CPU channels labelled by a shared hwmon driver can supply the primary reading', () => {
	const sections = widget.render({ status: 'ok', sensors: [
		{ category: 'wifi', label: 'tsens / wcss-phya0-thermal', celsius: 70 },
		{ category: 'cpu', label: 'tsens / cpu0-thermal', celsius: 60 }
	] });
	assert.equal(sections.cards[0].node().value[0], 'CPU 60.0 °C');
});

test('CPU-only cards have a specific title, a plain reading and no sensor-count filler', () => {
	const card = widget.render({ status: 'ok', sensors: [
		{ category: 'cpu', label: 'cpu0-thermal', celsius: 67 }
	] }).cards[0].node();
	assert.equal(card.title, 'CPU temperature');
	assert.deepEqual(Array.from(card.value), ['67.0 °C']);
	assert.deepEqual(Array.from(card.sub), []);
});

test('Temperature widgets integrate with dashboard defaults and independent layout controls', async () => {
	const includes = [Object.assign({}, widget, {
		load: async () => ({ status: 'ok', age_ms: 0, sensors: [{ label: 'cpu-thermal', celsius: 42 }] })
	})];
	context.widgets = vm.runInContext(`(function() {
		${readFileSync(new URL('../htdocs/luci-static/resources/view/dashboard/lib/widgets.js', import.meta.url), 'utf8')}
	})()`, context);
	context.Node = class {};
	context.view = { extend: value => value };
	context.document = { querySelector: () => ({ appendChild() {} }) };
	context.L.resource = value => value;
	context.L.env = {};
	const indexSource = readFileSync(new URL('../htdocs/luci-static/resources/view/dashboard/index.js', import.meta.url), 'utf8');
	const dashboard = vm.runInContext(`(function() {
		${indexSource.replace('return view.extend({', 'view.extend({')}
		return { load: invokeIncludesLoad, collect: collectSections };
	})()`, context);
	const defaults = Object.fromEntries(context.widgets.slots.map(slot => [slot, context.widgets.defaults(includes, slot)]));
	assert.deepEqual(Array.from(defaults.cards), ['temperature']);
	assert.deepEqual(Array.from(defaults.tabs), ['temperatures']);

	for (const enabled of ['both', 'cards', 'tabs', 'neither']) {
		const layout = {
			cards: enabled == 'both' || enabled == 'cards' ? ['temperature'] : [],
			tabs: enabled == 'both' || enabled == 'tabs' ? ['temperatures'] : [],
			charts: []
		};
		const results = await dashboard.load(includes, layout);
		const sections = dashboard.collect(includes, results, layout);
		assert.equal(sections.cards.length, layout.cards.length);
		assert.equal(sections.tabs.length, layout.tabs.length);
		assert.equal(includes[0].skipped, enabled == 'neither');
		if (sections.tabs.length)
			assert.equal(sections.tabs[0].title, widget.widgets.find(w => w.slot == 'tabs').title);
	}
});
