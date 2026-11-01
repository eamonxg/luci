# Dashboard temperature checks

From the repository root, run the frontend behavior tests:

```sh
node --test modules/luci-mod-dashboard/tests/temperature.mjs
```

On a system with ucode, its fs module, and its uloop module, run from the
`modules/luci-mod-dashboard` directory:

```sh
ucode -L "$PWD/root/usr/share/ucode/*.uc" tests/temperature.uc
```

The ucode tests create and remove their own temporary sysfs fixtures. They cover
Intel/AMD/ARM names, thermal/hwmon duplicates, zero and negative temperatures,
invalid and disappearing inputs, rediscovery, the channel limit, concurrent
requests, cached responses, timeout, and event-loop responsiveness. A slow worker
is injected only in the test; the production implementation never runs a shell.

## Master integration verification, 2026-11-01

Rebased onto `5599f42b0e` from `origin/master`, also the fetched `upstream/master`.
All twelve frontend tests passed, including the current dashboard widget registry,
default layout, independent card/tab selection and skipping collection when both
widgets are disabled. Failed CPU readings, non-finite values, component summaries,
CPU-only cards and unknown sensor categories are covered as well.

All three ucode fixture/worker test groups passed with a locally built ucode and
its fs/uloop modules. JavaScript syntax, translation validation and diff checks
passed. ESLint reported no errors; its `charts` alias warnings and the PO header
warnings remain. A browser preview using the actual card/table renderer and
sample readings was checked at desktop and 390-pixel viewport widths. This run
did not repeat the router verification below or build an OpenWrt firmware image.

## Integration verification, 2026-10-09

Tested on Cudy TR3000 256MB v1, OpenWrt 25.12-SNAPSHOT, Linux 6.12.108:

- The deployed `luci.dashboard.temperature read` RPC returns CPU, two Wi-Fi
  sensors and one Ethernet PHY; the duplicate CPU thermal zone is omitted.
- Ten successive ubus calls averaged 1.125 ms, with a maximum of 5.008 ms for
  the first call. Sample ages increased from 0 to 8 ms, confirming shared results.
  These are wall-clock measurements, not whole-system CPU usage measurements.
- Browser verification confirmed Chinese labels, live updates and complete
  network-chip readings at desktop and 390-pixel viewport widths.
- Frontend tests and ucode fixture/worker tests passed. Chinese PO validation
  passed with existing header warnings; JavaScript syntax and diff checks passed.

No x86 hardware or sustained throughput benchmark was available. The x86 cases
above use fixtures, and the worker fault tests simulate slow collection rather
than a kernel driver stuck in uninterruptible sleep.

The implementation reads only on demand, shares a ten-second cache, rediscovers
devices at most once per minute during normal operation and caches unsupported
devices for one minute. A one-second deadline invalidates failed readings and
starts bounded retry backoff. An unfinished worker prevents another worker from
being started, including after the deadline. Sensor paths are owned by the
backend and never accepted as RPC arguments.

## Generic temperature display

All discovered hwmon and non-duplicate thermal temperature channels are shown
with their original driver names and labels. There is no chip whitelist, threshold model or historical temperature storage.
Discovery adds a display-only category using named CPU/SoC/storage and ath10k/ath11k
drivers, explicit ieee80211/MDIO device paths, and named thermal zones or hwmon
channel labels. NSS zones (`nss-top-thermal`, `nss0-thermal`, `nss1-thermal`), WCSS
PHY zones and explicitly named modem zones are recognized. Unlabelled numbered
TSENS channels are not mapped by index; unknown devices remain Other.
Classification does not filter channels or change the CPU card selection.
CPU, Wi-Fi, NSS, modem, PHY, disk, memory, board and GPU readings are supported whenever
exposed by these standard interfaces; unknown sensor names are equally valid.
Absent channels are not listed. Existing channels that fail show an unavailable
value, so failure is not confused with missing hardware.

The card is titled Temperature when it includes Wi-Fi, NSS or modem summaries,
with the CPU reading as its primary value. Only discovered components appear.
Each secondary summary shows that component's highest valid reading; failed
components show an unavailable value. The details table retains every sensor,
its original name, category and reading, and explains the summary rule.

Without those secondary components, a recognized CPU uses the title CPU
temperature and a plain temperature value, without a sensor-count subtitle.
A small frontend selector prefers explicit Intel package/AMD die readings, then
CPU thermal channels identified by their name or backend category. Generic SoC
channels remain in details and are not relabelled as CPU. Unknown channels are
never substituted for an unavailable processor.

Modem detection requires a named standard hwmon/thermal sensor. Merely installing
a modem does not expose its temperature. The dashboard does not issue vendor AT
commands or depend on QModem/ModemManager or other optional plugins.
The ten-second shared cache and worker deadline remain to bound collection cost
and isolate slow driver reads. No shell commands, SMART probes or additional
pollers are used.
