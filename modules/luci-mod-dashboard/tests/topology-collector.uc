'use strict';

import { decode_fdb, collect } from '../root/usr/share/ucode/luci/dashboard/topology.uc';
import { readfile, writefile } from 'fs';

function check(value, message) {
	if (!value)
		die(message);
};

// The runner creates a small sysfs fixture tree in the argument directory.
const root = ARGV[0];
check(root && root != '/', 'Pass the fixture directory');
const bytes = readfile(`${root}/br-lan/brforward`);
const records = decode_fdb(bytes, { '1': 'eth0', '257': 'eth2' });
check(length(records) == 2, 'Ignore local, multicast, zero, unknown-port and truncated records');
check(records[0].mac == '02:00:00:00:00:01', 'Decode MAC bytes');
check(records[1].port == 'eth2', 'Preserve the high byte of the port number');
check(length(decode_fdb(null, {})) == 0, 'Missing FDB data is safe');

let snapshot = collect(root, `${root}/arp`);
check(length(snapshot.bridges) == 1 && snapshot.bridges[0].device == 'br-lan', 'Discover bridge membership');
check(snapshot.bridges[0].available && snapshot.bridges[0].partial, 'Expose partial FDB records');
check(length(snapshot.localMACs) == 1 && snapshot.localMACs[0] == '02:00:00:00:00:FF', 'Identify local interfaces separately from endpoints');
check(length(snapshot.neighbours) == 1 && snapshot.neighbours[0].device == 'br-lan', 'Ignore incomplete ARP entries');

writefile(`${root}/br-lan/bridge/vlan_filtering`, '1\n');
snapshot = collect(root, `${root}/arp`);
check(!snapshot.bridges[0].available && length(snapshot.bridges[0].entries) == 0, 'Never infer VLAN membership from the legacy FDB ABI');
check(length(snapshot.bridges[0].members) == 2, 'Ports remain visible when FDB placement is unsupported');
snapshot = collect(`${root}/absent`, `${root}/absent/arp`);
check(length(snapshot.bridges) == 0 && !snapshot.neighboursAvailable, 'Missing providers remain unavailable');
print('Topology collector checks passed\n');
