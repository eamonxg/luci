#!/usr/bin/env python3
"""Run the ucode collector checks locally, or with --ssh root@router."""

import argparse
import io
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile


def record(mac, port, local=0):
    return bytes.fromhex(mac.replace(':', '')) + bytes([port & 255, local]) + bytes(4) + bytes([port >> 8]) + bytes(3)


def files():
    base = Path(__file__).resolve().parent.parent
    data = record('02:00:00:00:00:01', 1) + record('02:00:00:00:00:02', 257)
    data += record('02:00:00:00:00:03', 1, 1) + record('33:33:00:00:00:01', 1)
    data += record('00:00:00:00:00:00', 1) + record('02:00:00:00:00:04', 9) + b'bad'
    return {
        'tests/topology-collector.uc': (base / 'tests/topology-collector.uc').read_bytes(),
        'root/usr/share/ucode/luci/dashboard/topology.uc': (base / 'root/usr/share/ucode/luci/dashboard/topology.uc').read_bytes(),
        'fixture/br-lan/brforward': data,
        'fixture/br-lan/address': b'02:00:00:00:00:FF\n',
        'fixture/br-lan/bridge/vlan_filtering': b'0\n',
        'fixture/br-lan/brif/eth0/port_no': b'0x1\n',
        'fixture/br-lan/brif/eth2/port_no': b'0x101\n',
        'fixture/arp': b'IP address HW type Flags HW address Mask Device\n192.0.2.2 0x1 0x2 02:00:00:00:00:01 * br-lan\n192.0.2.3 0x1 0x0 00:00:00:00:00:00 * br-lan\n',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ssh', help='Run with the target device\'s ucode interpreter')
    args = parser.parse_args()
    if not args.ssh:
        with tempfile.TemporaryDirectory(prefix='luci-topology-test-') as directory:
            root = Path(directory)
            for name, data in files().items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            subprocess.run(['ucode', str(root / 'tests/topology-collector.uc'), str(root / 'fixture')], check=True)
        return

    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', args.ssh]
    directory = subprocess.check_output(ssh + ['mktemp -d /tmp/luci-topology-test.XXXXXXXX'], text=True).strip()
    if not re.fullmatch(r'/tmp/luci-topology-test\.[A-Za-z0-9]+', directory):
        raise RuntimeError('Unexpected temporary directory')
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for name, data in files().items():
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o644
            archive.addfile(info, io.BytesIO(data))
    quoted = shlex.quote(directory)
    try:
        subprocess.run(ssh + [f'tar -xzf - -C {quoted}'], input=stream.getvalue(), check=True)
        subprocess.run(ssh + [f'ucode {quoted}/tests/topology-collector.uc {quoted}/fixture'], check=True)
    finally:
        subprocess.run(ssh + [f'rm -rf {quoted}'], check=True)


if __name__ == '__main__':
    main()
