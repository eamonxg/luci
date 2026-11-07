'use strict';

import { basename, glob, readfile } from 'fs';

// Linux's bridge sysfs ABI uses 16-byte records. It does not expose VLAN IDs,
// so never use this provider to locate clients on a VLAN-filtering bridge.
export function decode_fdb(data, ports) {
	const entries = [];
	if (type(data) != 'string')
		return entries;
	for (let offset = 0; offset + 16 <= length(data); offset += 16) {
		const number = ord(data, offset + 6) | (ord(data, offset + 12) << 8);
		if (ord(data, offset + 7) || (ord(data, offset) & 1) || !ports[number])
			continue;
		const bytes = [];
		for (let i = 0; i < 6; i++)
			push(bytes, sprintf('%02X', ord(data, offset + i)));
		const mac = join(':', bytes);
		if (mac != '00:00:00:00:00:00')
			push(entries, { mac, port: ports[number] });
	}
	return entries;
};

export function collect(root, arp_path) {
	root = root ?? '/sys/class/net';
	arp_path = arp_path ?? '/proc/net/arp';
	const local_macs = [];
	for (let path in glob(`${root}/*/address`) ?? []) {
		const address = trim(readfile(path) ?? '');
		if (address)
			push(local_macs, uc(address));
	}
	const bridges = [];
	for (let path in glob(`${root}/*/bridge`) ?? []) {
		const device = basename(substr(path, 0, length(path) - 7));
		const ports = {}, members = [];
		for (let member in glob(`${root}/${device}/brif/*`) ?? []) {
			const name = basename(member);
			const number = int(trim(readfile(`${member}/port_no`) ?? ''), 16);
			if (number > 0)
				ports[number] = name;
			push(members, name);
		}
		const filtering = trim(readfile(`${path}/vlan_filtering`) ?? '') != '0';
		// Bound each response, and disclose truncation instead of inventing zero.
		const limit = 262144;
		const data = filtering ? null : readfile(`${root}/${device}/brforward`, limit + 1);
		push(bridges, {
			device, members, available: type(data) == 'string',
			partial: type(data) == 'string' && (length(data) > limit || length(data) % 16 != 0),
			entries: decode_fdb(type(data) == 'string' ? substr(data, 0, limit) : null, ports)
		});
	}
	const arp = readfile(arp_path), neighbours = [];
	for (let line in split(arp ?? '', '\n')) {
		const fields = split(trim(line), /\s+/);
		if (length(fields) == 6 && (int(fields[2], 16) & 2))
			push(neighbours, { address: fields[0], mac: uc(fields[3]), device: fields[5] });
	}
	return { bridges, neighbours, localMACs: local_macs, neighboursAvailable: type(arp) == 'string' };
};
