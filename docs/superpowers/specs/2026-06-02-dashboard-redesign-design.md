# luci-mod-dashboard 重设计 — 设计文档

**日期：** 2026-06-02
**模块：** `modules/luci-mod-dashboard`
**目标：** 在不删减任何现有功能的前提下，将 dashboard 重新设计为现代后台风格（参考 shadcn / Vercel），并加入图表可视化、移动端适配、主题自适应配色。

---

## 1. 背景与动机

现有 dashboard 存在以下问题（已在分析中确认）：

- **配色硬编码**：`custom.css` 中 `#212529`、`#000`、`#e0e0e0`、`rgba(0,0,0,0.1)` 等写死颜色，第三方主题下对比度失效。
- **CSS 变量与 Bootstrap 主题强绑定**：`--text-color-high`、`--background-color-medium`、`--border-color-medium` 为 LuCI Bootstrap 主题私有，第三方主题不定义即全部回退到硬编码。
- **暗模式依赖私有 attribute**：`[data-darkmode="true"]` 仅 Bootstrap 主题设置，第三方主题暗模式下 SVG 图标不反转。
- **大量固定像素尺寸**：`min-height:466px`、`height:97px`、`top:3px` 等脆弱微调，多语言/字体缩放下错位。
- **`!important` 破坏继承链**：第三方主题无法覆盖文字颜色。
- **视觉单调**：仅有表格，无任何图表。

## 2. 设计决策（已确认）

| 决策点 | 选定方案 |
|--------|---------|
| 整体布局 | **方案 A** — 统计卡 + 详情栅格（shadcn / Vercel 风格） |
| 图表 | 加入：实时流量折线图、设备分布甜甜圈图、WiFi 信号横向条形图 |
| 配色策略 | **主题自适应** — 保留 shadcn 结构，颜色全用 CSS 变量跟随 LuCI 主题明暗切换 |
| 移动端 | CSS Grid 自动塌缩多列 → 单列；表格 → 卡片列表 |
| 功能范围 | **保留全部现有功能，零删减** |

## 3. 功能清单（必须全部保留）

来自三个 include 文件的现有功能，新设计必须 1:1 覆盖：

**系统信息（10_router.js）**
- 型号、固件版本、内核版本、架构、本地时间、运行时间

**互联网状态（10_router.js）**
- IPv4：连接状态、运行时间、协议、地址、网关、DNS
- IPv6：连接状态、运行时间、协议、前缀、地址、网关、DNS
- 互联网/未连接图标切换逻辑

**DHCP 设备（20_lan.js）**
- 主机名、IP 地址、MAC，设备总数
- `dnsmasq`/`odhcpd` 特性检测后才渲染

**无线网络（30_wifi.js）**
- 每个无线接口：SSID、活动状态、信道+频率、速率、BSSID、加密、已连接设备数
- 每个已连接设备：主机名、SSID、信号强度（进度条）、上下行流量
- 信号质量计算（含噪声基底 noise floor）
- 无 radio 时不渲染

## 4. 新布局结构（方案 A）

```
┌─────────────────────────────────────────────────────┐
│ [统计卡:互联网] [统计卡:运行时间] [统计卡:设备] [WiFi] │  ← 4列, 移动端2x2
├──────────────────────────────┬──────────────────────┤
│ 实时流量折线图 (2/3 宽)        │ 设备分布甜甜圈 (1/3) │  ← 移动端各占满宽
├──────────────────────────────┴──────────────────────┤
│ [系统信息卡]              │ [互联网 IPv4/IPv6 卡]    │  ← 2列, 移动端单列
├──────────────────────────┼──────────────────────────┤
│ [无线:信号条形图+流量表]   │ [DHCP 设备表]            │  ← 2列, 移动端单列+卡片列表
└──────────────────────────┴──────────────────────────┘
```

## 5. 数据来源可行性（已验证）

**无需新增任何后端 RPC 或依赖。** 全部数据现有接口已提供：

| 新元素 | 数据来源 | 状态 |
|--------|---------|------|
| 4个统计卡 | 现有三个 include | ✅ 已有 |
| 系统信息卡 | `callSystemBoard` + `callSystemInfo` | ✅ 已有 |
| WAN IPv4/IPv6 | `network.getWANNetworks/getWAN6Networks` | ✅ 已有 |
| WiFi 接口/设备 | `network.getWifiNetworks` + `getAssocList` | ✅ 已有 |
| WiFi 信号条形图 | `bss.signal` + 已计算质量 `q` | ✅ 已有 |
| WiFi 流量表 | `bss.rx.bytes` + `bss.tx.bytes` | ✅ 已有 |
| DHCP 设备表 | `callLuciDHCPLeases` | ✅ 已有 |
| **设备分布甜甜圈** | DHCP MAC ∩ WiFi assoclist MAC 交叉比对 | ✅ 纯前端逻辑 |
| **实时流量折线图** | `NetworkDevice.getTXBytes()/getRXBytes()` (luci-base 已有, 读 /proc/net/dev) | ✅ API 已有, 当前未调用 |

**流量折线图说明：** 在每次 poll 时对 WAN 网卡采样 TX/RX 字节数，计算相邻两次的 delta 得到瞬时速率，存入模块级历史数组渲染折线。限制：刷新页面后历史清零（浏览器内存，纯前端流量图的固有限制，与 LuCI 其他实时图表一致）。

## 6. 配色架构（解决核心问题）

定义一套语义化 CSS 变量，每个都带**合理降级值**，并尽量映射到 LuCI 通用属性而非 Bootstrap 私有变量：

```css
.Dashboard {
  --dash-card-bg:      var(--background-color-high, #fff);
  --dash-card-border:  var(--border-color-medium, #e5e7eb);
  --dash-text:         var(--text-color-high, #111827);
  --dash-text-muted:   var(--text-color-low, #71717a);
  --dash-accent-green: #22c55e;
  --dash-accent-blue:  #3b82f6;
  /* ... 图表色板独立, 明暗通用 */
}
```

**明暗切换：** 优先用 `@media (prefers-color-scheme: dark)` 覆盖变量；同时保留对 LuCI `[data-darkmode="true"]` 的兼容，两条路径都生效。

**移除：** 所有 `!important`、所有固定 `px` 微调（改 `rem`/`em` 或删除）、`min-height:466px`（改为内容自适应）。

## 7. 影响的文件

| 文件 | 改动 |
|------|------|
| `css/custom.css` | 重写：新卡片布局 + CSS 变量配色 + 响应式 Grid |
| `include/10_router.js` | 重写 `renderHtml`；新增 WAN 网卡 TX/RX 采样 |
| `include/20_lan.js` | 重写 `renderHtml`；导出设备 MAC 供甜甜圈交叉比对 |
| `include/30_wifi.js` | 重写 `renderHtml`：信号条形图 + 流量；导出已连接 MAC |
| `index.js` | 新增流量历史数组维护；新增甜甜圈/折线图 SVG 渲染辅助；协调跨 include 的 MAC 数据共享 |
| (新) 图表辅助 | SVG 折线图 / 甜甜圈 / 条形图渲染函数（可内联或独立小模块） |

## 8. 非目标（YAGNI）

- 不做用户可配置的卡片拖拽/布局自定义
- 不引入任何前端图表库（Chart.js 等）；用原生 SVG，保持 LuCI 零依赖传统
- 不做流量历史持久化（接受刷新清零）
- 不改动后端 rpcd/acl，不新增 RPC 方法
- 不改动 i18n 文案逻辑（但修复 JS 中硬编码的全角冒号 `：`，改走拼接以适配 RTL/多语言）

## 9. 测试与验证

- 在 LuCI Bootstrap 主题明/暗模式下视觉验证
- 至少一个第三方主题（如 Material）下验证不再回退到硬编码、暗模式图标正常
- 移动端宽度（≤640px）下 Grid 塌缩、表格转卡片列表正常
- 多语言（zh / en / 一种 RTL）下无文字溢出
- 功能回归：逐项核对第 3 节功能清单，确保零删减
