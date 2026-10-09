// Run from the module directory:
// ucode -L "$PWD/root/usr/share/ucode/*.uc" tests/temperature.uc
import * as fs from 'fs';
import * as uloop from 'uloop';
import { discover, sample } from 'luci.dashboard.temperature';

const root = fs.mkdtemp('/tmp/dashboard-temperature.XXXXXX');
function dir(path) {
	if (!fs.stat(path)) {
		dir(fs.dirname(path));
		assert(fs.mkdir(path), `mkdir ${path}`);
	}
}
function file(path, value) {
	dir(fs.dirname(path));
	assert(fs.writefile(path, value) != null, `write ${path}`);
}
function remove(path) {
	if (fs.lstat(path)?.type == 'directory') {
		for (let entry in fs.lsdir(path)) remove(`${path}/${entry}`);
		fs.rmdir(path);
	}
	else fs.unlink(path);
}

try {
	dir(`${root}/class/hwmon`);
	dir(`${root}/class/thermal`);
	assert(sample(discover(root)).status == 'unsupported', 'Empty sysfs');
	assert(discover(`${root}/missing`) == null, 'Missing sysfs is not unsupported');
	file(`${root}/class/hwmon/hwmon7/name`, 'coretemp\n');
	file(`${root}/class/hwmon/hwmon7/temp1_label`, 'Package id 0\n');
	file(`${root}/class/hwmon/hwmon7/temp1_input`, '0\n');
	file(`${root}/class/hwmon/hwmon7/temp2_input`, '-1000\n');
	file(`${root}/class/hwmon/hwmon8/name`, 'cpu_thermal\n');
	file(`${root}/class/hwmon/hwmon8/temp1_input`, '49970\n');
	file(`${root}/class/thermal/thermal_zone0/type`, 'cpu-thermal\n');
	file(`${root}/class/thermal/thermal_zone0/temp`, '49970\n');
	fs.symlink(`${root}/class/thermal/thermal_zone0`, `${root}/class/hwmon/hwmon8/device`);
	file(`${root}/class/thermal/thermal_zone1/type`, 'soc-thermal\n');
	file(`${root}/class/thermal/thermal_zone1/temp`, '49000\n');
	file(`${root}/class/hwmon/hwmon9/name`, 'k10temp\n');
	file(`${root}/class/hwmon/hwmon9/temp1_input`, '40000\n');
	let sources = discover(root), result = sample(sources);
	assert(length(sources) == 5, 'Thermal alias must not duplicate CPU');
	assert(result.status == 'ok', 'All fixture values valid');
	assert(result.sensors[0].celsius == 0 && result.sensors[1].celsius == -1, 'Zero and negative temperatures');
	file(`${root}/class/hwmon/hwmon7/temp1_input`, 'invalid');
	fs.unlink(`${root}/class/hwmon/hwmon7/temp2_input`);
	result = sample(sources);
	assert(result.status == 'partial' && result.sensors[0].celsius == null && result.sensors[1].celsius == null, 'Invalid and disappeared inputs');
	for (let source in sources) fs.unlink(source.path);
	assert(sample(sources).status == 'error', 'All inputs failed');
	file(`${root}/class/hwmon/hwmon7/temp1_input`, '50000');
	fs.rename(`${root}/class/hwmon/hwmon7`, `${root}/class/hwmon/hwmon17`);
	assert(sample(discover(root)).sensors[0].celsius == 50, 'Discover renumbered hwmon');
	for (let i = 3; i < 80; i++) file(`${root}/class/hwmon/hwmon17/temp${i}_input`, '10000');
	assert(length(discover(root)) == 64, 'Bound the number of channels');
	const extra = `${root}/categories`;
	const cases = [
		[ 'nvme', '', 'storage' ], [ 'drivetemp', '', 'storage' ],
		[ 'jc42', '', 'other' ], [ 'spd5118', '', 'other' ],
		[ 'amdgpu', '', 'other' ], [ 'gpu-thermal', '', 'other' ],
		[ 'nct6775', 'Motherboard', 'other' ], [ 'nct6775', 'DIMM 0', 'other' ],
		[ 'nct6775', 'AUXTIN0', 'other' ]
	];
	for (let i, c in cases) {
		const path = `${extra}/class/hwmon/hwmon${i}`;
		file(`${path}/name`, c[0]);
		file(`${path}/temp1_label`, c[1]);
		file(`${path}/temp1_input`, '42000');
	}
	const classified = sample(discover(extra));
	for (let i, c in cases) {
		assert(classified.sensors[i].category == c[2], `Conservative category ${c[0]}`);
		assert(index(classified.sensors[i].label, c[0]) == 0 && classified.sensors[i].celsius == 42, `Unfiltered sensor ${c[0]} ${c[1]}`);
	}
	print('PASS sensor discovery, deduplication, values, failure and channel limit\n');

	const code = fs.readfile('root/usr/share/rpcd/ucode/luci.dashboard-temperature');
	uloop.init();
	let api = loadstring(replace(code, "discover('/sys')", `discover('${root}')`))()['luci.dashboard.temperature'].read.call;
	let replies = 0;
	for (let i = 0; i < 3; i++) api({ defer: () => ({}), reply: data => {
		assert(length(data.sensors) > 0, 'Worker returned sensors');
		if (++replies == 3) uloop.end();
	} });
	let guard = uloop.timer(2000, () => { die('Worker did not reply'); });
	uloop.run();
	guard.cancel();
	assert(replies == 3, 'Concurrent requests complete');
	assert(length(api({}).sensors) > 0, 'Cached request needs no defer/worker');
	print('PASS asynchronous collection, concurrent requests and shared cache\n');

	// Inject a slow worker only in this test, never into the deployed collector.
	api = loadstring(replace(code, 'const list = refresh', "system('sleep 2'); const list = refresh"))()['luci.dashboard.temperature'].read.call;
	let responsive = false, timeout = false;
	api({ defer: () => ({}), reply: data => {
		assert(data.status == 'error' && data.age_ms == null, 'Timeout invalidates values');
		timeout = true;
		uloop.end();
	} });
	uloop.timer(10, () => { responsive = true; });
	guard = uloop.timer(2500, () => { die('Timeout did not reply'); });
	uloop.run();
	guard.cancel();
	assert(timeout && responsive, 'Slow worker does not block event loop');
	assert(api({}).status == 'error', 'Backoff avoids another worker');
	print('PASS timeout, event-loop responsiveness and retry backoff\n');
}
catch (e) {
	remove(root);
	die(e);
}
remove(root);
