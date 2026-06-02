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
	assert.ok(d.includes('L300,'), 'single point extends a flat line to width: ' + d);
});

// signalQualityClass: maps percent → low/mid/high
test('signalQualityClass thresholds', () => {
	assert.strictEqual(pure.signalQualityClass(10), 'low');
	assert.strictEqual(pure.signalQualityClass(40), 'mid');
	assert.strictEqual(pure.signalQualityClass(80), 'high');
	assert.strictEqual(pure.signalQualityClass(25), 'mid');
	assert.strictEqual(pure.signalQualityClass(50), 'high');
});

console.log(`\n${passed} tests passed`);
