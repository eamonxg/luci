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

test('Processor summary ignores hotter network sensors', () => {
	const sections = widget.render({ status: 'ok', age_ms: 0, sensors: [
		{ label: 'cpu_thermal / temp1', celsius: 49.97 }, { label: 'mt7915 / temp1', celsius: 49 },
		{ label: 'mt7915 / temp1', celsius: 53 }, { label: 'mdio_bus:01 / temp1', celsius: 48.88 }
	] });
	const output = sections.cards[0].node();
	assert.equal(output.value[0], '50.0 °C');
	assert.equal(output.title, 'CPU temperature');
	assert.equal(output.sub[0], 'Sensors: 4');
	assert.equal(output.stacked, undefined);
	const details = JSON.stringify(sections.tabs[0].content());
	assert.ok(details.includes('53.0 °C') && details.includes('48.9 °C'));
	assert.ok(details.includes('mdio_bus:01 / temp1'));
});

test('Unidentified sensors are not used as processor temperature', () => {
	const output = widget.render({ status: 'ok', sensors: [ { label: 'unknown sensor', celsius: -1 }, { label: 'unknown sensor', celsius: 0 } ] }).cards[0].node();
	assert.equal(output.value[0], '—');
	assert.equal(output.title, 'CPU temperature');
});

test('Unsupported is hidden; errors never render zero; stale partial data is labelled', async () => {
	assert.equal(widget.render({ status: 'unsupported', sensors: [] }).cards.length, 0);
	assert.equal(widget.render(await widget.load()).cards[0].node().value[0], '—');
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
		assert.equal(card(40).sub[0], 'Sensors: 2');
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
	assert.equal(sections.cards[0].node().value[0], '—');
	assert.ok(JSON.stringify(sections.tabs[0].content()).includes('45.0 °C'));
});
