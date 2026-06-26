# Codex++ 自定义修改清单

> 基于 commit `151b36e` → `a0fd557` 的变更记录
> 生成时间：2026-06-14

---

## 📊 修改概览

| 指标 | 数值 |
|------|------|
| 修改文件总数 | 14 |
| 新增代码行 | ~2,700 行 |
| 修改类型 | 功能增强、UI 改进、品牌替换、Bug 修复 |

---

## 🎯 核心功能修改

### 1. 流量统计系统（新增）

**涉及文件：**
- `crates/codex-plus-core/src/proxy_stats.rs` (+208 行)
- `crates/codex-plus-core/src/stats_persistence.rs` (+359 行，新文件)
- `crates/codex-plus-core/src/launcher.rs` (+276 行)
- `apps/codex-plus-manager/src-tauri/src/commands.rs` (+702 行)
- `apps/codex-plus-manager/src/App.tsx` (+688 行)

**功能说明：**
- **MiMo Credits 定价系统**：实现基于 Credits 的计费逻辑
  - `mimo-v2.5-pro` / `mimo-v2-pro`：缓存 2.5 Cr/token，非缓存 300 Cr/token，输出 600 Cr/token
  - `mimo-v2.5` / `mimo-v2-omni`：缓存 2 Cr/token，非缓存 100 Cr/token，输出 200 Cr/token
  - 夜间（0:00-8:00 UTC+8）语言模型八折优惠
- **统计持久化**：SQLite 数据库存储每日/每小时统计
  - 支持历史趋势查询
  - 重启后自动加载历史基线
- **实时统计面板**：前端图表展示（Chart.js）
  - Token 使用量趋势图
  - 请求数量统计
  - 费用累计显示
  - 缓存命中率分析

**关键代码位置：**
```
crates/codex-plus-core/src/proxy_stats.rs:333-382  # MiMo 定价逻辑
crates/codex-plus-core/src/stats_persistence.rs:1-357  # SQLite 持久化
apps/codex-plus-manager/src/App.tsx:3974-4186  # 统计图表组件
```

---

### 2. 模型显示名称注入（新增）

**涉及文件：**
- `assets/inject/renderer-inject.js` (+349 行)

**功能说明：**
- 动态替换 Codex UI 中的"自定义"/"custom"为当前模型名称
- 通过 Helper Server `/config` API 获取配置
- MutationObserver 监听 DOM 变化，实时替换
- 每 30 秒刷新一次配置

**关键代码位置：**
```
assets/inject/renderer-inject.js:8082-8180  # 模型名称替换逻辑
crates/codex-plus-core/src/launcher.rs:953-996  # /config API 端点
```

---

### 3. 注入状态指示器（新增）

**涉及文件：**
- `assets/inject/renderer-inject.js` (+349 行)

**功能说明：**
- 右下角固定定位的状态指示器
- 红绿灯颜色指示注入状态：
  - 🟢 绿色：注入成功
  - 🟡 黄色：检查中
  - 🔴 红色：Bridge 未注入
  - 🟠 橙色：注入异常
- 点击显示详细状态弹窗（版本、Build ID、Helper 地址、模型名称）
- 每 5 秒自动刷新状态

**关键代码位置：**
```
assets/inject/renderer-inject.js:8182-8432  # 状态指示器实现
```

---

### 4. 启动功能增强（修改）

**涉及文件：**
- `apps/codex-plus-manager/src-tauri/src/commands.rs` (+702 行)
- `apps/codex-plus-manager/src-tauri/src/lib.rs` (+11 行)

**功能说明：**
- **启动验证**：`spawn_codex_plus_launch` 启动后验证进程存活
  - 等待 800ms 检查 launcher 是否崩溃
  - 捕获 stderr 获取真实错误信息
  - 检查 Codex 进程是否已出现
- **无注入启动**：新增 `launch_codex_app_only` 命令
  - 直接启动原版 Codex App（不注入）
  - 等待 1.5 秒后验证进程
- **进程管理**：新增 `list_codex_processes`、`kill_codex_process_by_pid`、`kill_all_codex_processes`
- **Helper 快速启动**：`quick_launch_helper` 多路径查找二进制

**关键代码位置：**
```
apps/codex-plus-manager/src-tauri/src/commands.rs:356-502  # 启动验证逻辑
apps/codex-plus-manager/src-tauri/src/commands.rs:502-700  # 进程管理功能
apps/codex-plus-manager/src-tauri/src/lib.rs:66-70  # 注册新命令
```

---

### 5. Helper 端口冲突修复（修改）

**涉及文件：**
- `crates/codex-plus-core/src/launcher.rs` (+276 行)

**功能说明：**
- Manager 内嵌 Helper Server 占用 57321 端口时，launcher 再绑同一端口会 AddrInUse
- 修复：AddrInUse 时发 HTTP GET 检查是否已有 Helper，若已有则跳过启动

**关键代码位置：**
```
crates/codex-plus-core/src/launcher.rs:591-670  # 端口冲突检测逻辑
```

---

### 6. Codex 无调试端口重启修复（修改）

**涉及文件：**
- `crates/codex-plus-core/src/launcher.rs` (+276 行)

**功能说明：**
- Codex 已在运行但没有 debug port 时，`open -a` 只激活不重启 → CDP 9229 不可用 → 注入失败
- 修复：检测到 Codex 运行但 CDP 不可用时，先 osascript quit 再重启

**关键代码位置：**
```
crates/codex-plus-core/src/launcher.rs:697-742  # 无调试端口重启逻辑
```

---

## 🎨 UI 改进

### 7. 前端界面增强（修改）

**涉及文件：**
- `apps/codex-plus-manager/src/App.tsx` (+688 行)
- `apps/codex-plus-manager/src/styles.css` (+91 行)

**功能说明：**
- **新增路由**：`processes`（进程管理页面）
- **新增组件**：
  - `ProcessesScreen`：进程列表、CPU/内存监控、端口冲突检测
  - `StatsChartsSection`：历史统计图表
  - `useAutoRefresh`：自动刷新 Hook
- **UI 改进**：
  - `.metric-list` 网格布局优化
  - `.data-table` / `.session-table` 表格样式
  - 按钮布局调整（启动 Ucodex / 启动 Codex 无注入）

**关键代码位置：**
```
apps/codex-plus-manager/src/App.tsx:501-514  # 新增路由定义
apps/codex-plus-manager/src/App.tsx:3847-3920  # 格式化工具函数
apps/codex-plus-manager/src/App.tsx:3974-4186  # 统计图表组件
apps/codex-plus-manager/src/styles.css:2139-2210  # 表格样式
```

---

### 8. 依赖新增（配置）

**涉及文件：**
- `apps/codex-plus-manager/package.json` (+4 行)
- `apps/codex-plus-manager/src-tauri/Cargo.toml` (+1 行)

**新增依赖：**
```json
{
  "chart.js": "^4.5.1",
  "react-chartjs-2": "^5.3.1"
}
```
```toml
tokio.workspace = true
```

---

## 🔧 配置修改

### 9. Git 远程仓库配置（修改）

**涉及文件：**
- `.gits.toml` (+4 行)

**修改内容：**
```toml
# 原配置
name = "github"
# 修改为
name = "paimon1999"
```

---

### 10. 配置管理修复（修改）

**涉及文件：**
- `crates/codex-plus-core/src/config_manager.rs` (+34 行)

**功能说明：**
- 修复 MCP 服务器配置写入逻辑
- 改用 `table_mut_or_insert` 获取父表，避免重复创建

**关键代码位置：**
```
crates/codex-plus-core/src/config_manager.rs:153-170  # MCP 配置写入修复
```

---

### 11. 品牌替换：Codex → Ucodex（全局）

**涉及文件：**
- 多个文件中的字符串替换

**替换内容：**
- 启动消息："启动任务" → "启动 Ucodex"
- 按钮文本："启动 Codex" → "启动 Ucodex"
- 应用路径：`/Applications/Codex++.app` → `/Applications/Ucodex.app`
- 进程分类：`codex-app` → 包含 `ucodex` 的检测

---

## 📁 文件变更统计

| 文件路径 | 变更行数 | 变更类型 |
|---------|---------|---------|
| `apps/codex-plus-manager/src-tauri/src/commands.rs` | +702 | 功能增强 |
| `apps/codex-plus-manager/src/App.tsx` | +688 | UI 增强 |
| `crates/codex-plus-core/src/stats_persistence.rs` | +359 | 新增文件 |
| `assets/inject/renderer-inject.js` | +349 | 功能增强 |
| `crates/codex-plus-core/src/launcher.rs` | +276 | Bug 修复 |
| `crates/codex-plus-core/src/proxy_stats.rs` | +208 | 功能增强 |
| `apps/codex-plus-manager/src/styles.css` | +91 | UI 改进 |
| `crates/codex-plus-core/src/config_manager.rs` | +34 | Bug 修复 |
| `apps/codex-plus-manager/src-tauri/src/lib.rs` | +11 | 命令注册 |
| `apps/codex-plus-manager/package.json` | +4 | 依赖新增 |
| `.gits.toml` | +4 | 配置修改 |
| `apps/codex-plus-manager/src-tauri/Cargo.toml` | +1 | 依赖新增 |

---

## 🔄 与上游的冲突分析

**上游版本跨度**：v1.2.4 → v1.2.6（370 个提交）

| 冲突等级 | 文件数 | 说明 |
|---------|-------|------|
| 🔴 高冲突 | 6 | 上游大量重构，需重新移植 |
| 🟡 中冲突 | 2 | 上游有修改，需手动合并 |
| 🟢 低冲突 | 4 | 配置文件，容易解决 |

**被上游删除的文件（需重新实现）：**
- `crates/codex-plus-core/src/proxy_stats.rs` - 上游删除
- `crates/codex-plus-core/src/stats_persistence.rs` - 上游删除
- `crates/codex-plus-core/src/config_manager.rs` - 上游删除，替换为 `config_coordinator.rs`

---

## 📝 更新建议

1. **品牌替换**：在新代码上重新做字符串替换（简单）
2. **流量统计**：需要在新架构上重新设计实现（复杂）
   - 上游删除了 `proxy_stats.rs` 和 `stats_persistence.rs`
   - 需要评估新架构中的替代方案
3. **注入脚本**：在新版 `renderer-inject.js` 上重新移植
4. **启动逻辑**：在新版 `commands.rs` 上重新实现验证逻辑

---

## 📦 完整 Diff：前端部分（TS/TSX/CSS）

### `apps/codex-plus-manager/src/App.tsx`（+688 行）

#### 1. 新增 import

```diff
+import { Activity,
   ArrowLeft, BarChart3, ...
 } from "lucide-react";
-import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
+import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
+import {
+  Chart as ChartJS,
+  CategoryScale, LinearScale, PointElement, LineElement,
+  BarElement, Title, Tooltip, Legend, Filler,
+} from "chart.js";
+import { Line, Bar } from "react-chartjs-2";
+ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement,
+  BarElement, Title, Tooltip, Legend, Filler);
```

#### 2. 新增路由 `processes`

```diff
-type Route = "overview" | "relay" | ... | "proxyStats" | "configEditor" | ...
+type Route = "overview" | "relay" | ... | "proxyStats" | "processes" | "configEditor" | ...

   { id: "proxyStats", label: "代理统计", icon: BarChart3 },
+  { id: "processes", label: "进程管理", icon: Activity },
```

#### 3. `launchCodexAppOnly` 函数

```typescript
const launchCodexAppOnly = async () => {
  const result = await run(() =>
    call<CommandResult<Record<string, unknown>>>("launch_codex_app_only", {
      request: {
        appPath: launchForm.appPath,
        debugPort: numberOrDefault(launchForm.debugPort, 9229),
        helperPort: numberOrDefault(launchForm.helperPort, 57321),
      },
    }),
  );
  if (result) {
    showNotice("启动 Codex", result.message, result.status);
    await refreshOverview(true);
  }
};
```

#### 4. Actions 类型扩展

```diff
 type Actions = {
   launch: () => Promise<void>;
   restart: () => Promise<void>;
+  launchCodexAppOnly: () => Promise<void>;
   ...
 };
```

#### 5. Overview 页面新增按钮

```diff
   <Rocket className="h-4 w-4" />
   启动 Ucodex
 </Button>
+<Button variant="secondary" onClick={() => void actions.launchCodexAppOnly()}>
+  启动 Codex（无注入）
+</Button>
```

#### 6. 格式化工具函数（新增）

```typescript
function formatInterval(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${ms / 1000}s`;
  return `${ms / 60000}min`;
}

function formatCost(cost: number): string {
  const m = cost / 1_000_000;
  if (m >= 1) return `${m.toFixed(1)} M Cr`;
  if (m >= 0.001) return `${(m * 1000).toFixed(1)} K Cr`;
  return `${cost.toFixed(0)} Cr`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function extractCacheStats(stats: Record<string, unknown>) {
  const cs = stats.cache_stats as Record<string, unknown> | undefined;
  return {
    hits: (cs?.hits as number) ?? 0,
    misses: (cs?.misses as number) ?? 0,
    hitRate: (cs?.hit_rate as number) ?? 0,
    size: (cs?.size as number) ?? 0,
    maxSize: (cs?.max_size as number) ?? 0,
  };
}
```

#### 7. `useAutoRefresh` Hook（新增）

```typescript
function useAutoRefresh(fetch: (silent: boolean) => Promise<void>, defaultInterval = 5000) {
  const [interval, setInterval_] = useState(defaultInterval);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  useEffect(() => { void fetchRef.current(false); }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { void fetchRef.current(true); }, interval);
    return () => clearInterval(id);
  }, [autoRefresh, interval]);

  return {
    interval, setInterval: setInterval_, autoRefresh,
    toggleAutoRefresh: () => setAutoRefresh(v => !v),
    detailText: autoRefresh ? `每 ${formatInterval(interval)} 自动刷新` : "自动刷新已暂停",
  };
}
```

#### 8. `StatsChartsSection` 组件（新增，~130 行）

```typescript
type DailyStatsRecord = {
  date: string; totalRequests: number; totalErrors: number;
  totalPromptTokens: number; totalCompletionTokens: number;
  totalReasoningTokens: number; totalCachedTokens: number;
  totalTokens: number; totalCost: number; totalLatencyMs: number; avgLatencyMs: number;
};

type HourlyStatsRecord = {
  datetime: string; requests: number; errors: number;
  promptTokens: number; completionTokens: number;
  reasoningTokens: number; cachedTokens: number;
  totalTokens: number; cost: number; latencyMs: number;
};

// Chart.js 颜色配置
const chartColors = {
  tokens: { border: "#6366f1", bg: "rgba(99,102,241,0.15)" },
  requests: { border: "#22c55e", bg: "rgba(34,197,94,0.15)" },
  cost: { border: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  latency: { border: "#ef4444", bg: "rgba(239,68,68,0.15)" },
  // ...
};

function StatsChartsSection({ historyDays }: { historyDays: number }) {
  // 调用 Tauri invoke("load_stats_history", { days }) 获取数据
  // 渲染：Token 用量趋势、请求量趋势、费用趋势、延迟趋势、今日逐小时分布
}
```

#### 9. `ProxyStatsScreen` 增强

- 新增 `historyDays` 状态 + 天数切换按钮（7/14/30 天）
- 新增 `useAutoRefresh` 自动刷新（可暂停/恢复，可调间隔 0.5s~1min）
- 模型统计表格扩展列：输入 Token、缓存命中、输出 Token、推理 Token
- 最近请求表格扩展列：输入、缓存、输出、费用、延迟
- 新增 `total_cached_tokens` 缓存命中细分
- 新增历史趋势图表区域（`StatsChartsSection`）

#### 10. `ProcessesScreen` 组件（新增，~250 行）

```typescript
type CodexProcessInfo = {
  pid: number; name: string; command: string;
  port: number | null; role: string;
  cpuPercent: number; memoryMb: number; startedAt: string;
};

type ProcessListPayload = {
  processes: CodexProcessInfo[];
  helperPort: number; helperRunning: boolean; portConflict: boolean;
};

function ProcessesScreen({ actions }: { actions: Actions }) {
  // Tauri 命令：list_codex_processes, quick_launch_helper,
  //            kill_codex_process_by_pid, kill_all_codex_processes
  // 功能：进程列表、CPU/内存监控、端口冲突检测、启动 Helper、清理全部
  // 含调试输出面板（显示原始 JSON 返回）
}
```

#### 11. 路由渲染

```diff
   {route === "proxyStats" ? <ProxyStatsScreen ... /> : null}
+  {route === "processes" ? <ProcessesScreen actions={actions} /> : null}
```

#### 12. 路由字幕

```diff
   proxyStats: "Token 用量、费用估算与缓存命中率",
+  processes: "查看和管理 Codex 相关进程、端口冲突检测",
```

#### 13. 正则修复

```diff
-    if (/^\[[^\]]+\]$/.test(trimmed)) {
+    if (/^\[[^\]]+]$/.test(trimmed)) {
```

---

### `apps/codex-plus-manager/src/styles.css`（+91 行）

#### 1. `.metric-list` 网格优化

```diff
 .metric-list {
   display: grid;
-  gap: 8px;
+  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
+  gap: 4px 16px;
 }
```

#### 2. `.metric-list` 子元素样式

```css
.metric-list div {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 0;
}
.metric-list div span {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}
.metric-list div strong {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
```

#### 3. 表格样式（新增）

```css
.data-table, .session-table {
  width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px;
}
.data-table th, .session-table th {
  text-align: left; font-weight: 600; font-size: 12px;
  color: hsl(var(--muted-foreground)); text-transform: uppercase;
  letter-spacing: 0.04em; padding: 10px 14px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--secondary) / 0.3); white-space: nowrap;
}
.data-table td, .session-table td {
  padding: 10px 14px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
  vertical-align: middle; line-height: 1.4;
}
.data-table tbody tr:hover, .session-table tbody tr:hover {
  background: hsl(var(--accent) / 0.4);
}
.data-table code, .session-table code {
  font-family: "SF Mono", Consolas, "Fira Code", monospace;
  font-size: 12px; background: hsl(var(--secondary) / 0.5);
  padding: 2px 6px; border-radius: 4px;
}
.session-table-wrap {
  overflow-x: auto; margin: 0 -2px; padding: 0 2px;
}
```

---

### `apps/codex-plus-manager/package.json`（+2 依赖）

```diff
+    "chart.js": "^4.5.1",
     "class-variance-authority": "^0.7.1",
     ...
+    "react-chartjs-2": "^5.3.1",
```

---

## 📦 完整 Diff：Rust 后端部分

### `apps/codex-plus-manager/src-tauri/src/commands.rs`（+680 行）

#### 1. `spawn_codex_plus_launch` 启动验证重构

```diff
-    match spawn_silent_launcher(&request) {
-        Ok(()) => CommandResult { status: "accepted", ... },
-        Err(error) => failed(...)
-    }
+    match spawn_silent_launcher(&request) {
+        Ok((child_id, stderr_handle)) => {
+            // 等待 800ms，检查 launcher 是否存活
+            std::thread::sleep(Duration::from_millis(800));
+            let still_alive = is_process_alive(child_id);
+            let codex_launched = codex_plus_core::watcher::find_codex_processes();
+            if still_alive || !codex_launched.is_empty() {
+                // 后台读取 stderr
+                CommandResult { status: "ok", ... }
+            } else {
+                // launcher 已退出 → 捕获 stderr + 诊断日志
+                let stderr_output = wait_and_collect_stderr(stderr_handle);
+                let error_detail = if !stderr_output.trim().is_empty() { ... }
+                    else { read_recent_diagnostic_error() };
+                failed("启动失败：Launcher 进程已退出。", ...)
+            }
+        }
+    }
```

#### 2. 新增辅助函数

```rust
/// 读取诊断日志中最近的错误
fn read_recent_diagnostic_error() -> Option<String>

/// 检查 PID 是否存活（Unix: kill -0, Windows: tasklist）
fn is_process_alive(pid: u32) -> bool

/// 等待并收集 stderr（最多 3 秒）
fn wait_and_collect_stderr(mut stderr: StderrHandle) -> String
```

#### 3. `spawn_silent_launcher` 增强

```diff
-fn spawn_silent_launcher(request: &LaunchRequest) -> anyhow::Result<()> {
+fn spawn_silent_launcher(request: &LaunchRequest) -> anyhow::Result<(u32, StderrHandle)> {
+    if !launcher.exists() {
+        return Err(anyhow::anyhow!("Launcher 二进制不存在：{}", ...));
+    }
     // ...
-    command.spawn().map(|_| ()).map_err(...)
+    let mut child = command.spawn()?;
+    let pid = child.id();
+    let stderr = child.stderr.take()?;
+    std::mem::forget(child);  // 泄漏 child，保持进程存活
+    Ok((pid, stderr))
```

#### 4. `launch_codex_app_only` 新增（无注入启动）

```rust
#[tauri::command]
pub fn launch_codex_app_only(request: LaunchRequest) -> CommandResult<Value> {
    // macOS: open <app_bundle> --args --remote-debugging-port <port>
    // 等待 1.5s 后检查 Codex 进程是否出现
    // Windows/Linux: 直接运行可执行文件
}
```

#### 5. `load_stats_history` / `load_stats_hourly_for_date` 新增

```rust
#[tauri::command]
pub async fn load_stats_history(days: Option<u32>) -> CommandResult<Value> {
    // 调用 persistence.query_recent_days(days)
    // 同时获取 today_hourly 数据
}

#[tauri::command]
pub async fn load_stats_hourly_for_date(date: String) -> CommandResult<Value> {
    // 调用 persistence.query_hourly(&date)
}
```

#### 6. 进程管理模块新增（~350 行）

```rust
// 数据结构
struct CodexProcessInfo { pid, name, command, port, role, cpu_percent, memory_mb, started_at }
struct ProcessListPayload { processes, helper_port, helper_running, port_conflict }

// 进程分类
fn classify_codex_process(name: &str, cmd: &str) -> Option<&'static str>
// 返回: helper / codex-manager / codex-app / app-server / renderer / node-repl / computer-use / monitor

// Tauri 命令
#[tauri::command] pub async fn list_codex_processes() -> CommandListPayload
#[tauri::command] pub async fn kill_codex_process_by_pid(pid: u32) -> CommandResult<Value>
#[tauri::command] pub async fn kill_all_codex_processes() -> CommandResult<Value>
#[tauri::command] pub async fn quick_launch_helper() -> CommandResult<Value>
```

---

### `apps/codex-plus-manager/src-tauri/src/lib.rs`（+8 行）

```diff
+            commands::launch_codex_app_only,
             commands::load_settings,
+            commands::load_stats_history,
+            commands::load_stats_hourly_for_date,
+            commands::list_codex_processes,
+            commands::kill_codex_process_by_pid,
+            commands::kill_all_codex_processes,
+            commands::quick_launch_helper,
```

---

### `apps/codex-plus-manager/src-tauri/Cargo.toml`（+1 行）

```diff
+tokio.workspace = true
```

---

### `crates/codex-plus-core/src/launcher.rs`（+231 行）

#### 1. HelperState 扩展

```diff
 struct HelperState {
     stats: Arc<ProxyStatsState>,
     cache: Arc<ProxyCache>,
+    persistence: Option<Arc<StatsPersistence>>,
 }

+impl HelperState {
+    /// 记录统计并持久化到数据库（fire-and-forget）
+    async fn record_stats(&self, usage, latency_ms, is_stream, cached, error) {
+        self.stats.record(...).await;
+        if let Some(ref persistence) = self.persistence {
+            let _ = persistence.record_request(...).await;
+        }
+    }
+}
```

#### 2. StandaloneHelperHandle 扩展

```diff
 pub struct StandaloneHelperHandle {
     stats: Arc<ProxyStatsState>,
     cache: Arc<ProxyCache>,
+    persistence: Option<Arc<StatsPersistence>>,
     shutdown: Option<oneshot::Sender<()>>,
 }

+    pub fn persistence(&self) -> Option<&Arc<StatsPersistence>> { ... }
```

#### 3. 启动时加载历史基线

```rust
// 初始化 StatsPersistence（失败不阻塞启动）
let persistence = StatsPersistence::open(&state_dir).ok().map(Arc::new);

// 从 SQLite 加载 365 天历史 → PersistedBaseline
if let Some(ref pers) = persistence {
    let daily = pers.query_recent_days(365).await;
    // 累加到 baseline → stats.set_baseline(baseline)
}
```

#### 4. 端口冲突修复

```diff
 async fn start_helper(&self, helper_port: u16) -> anyhow::Result<()> {
-    let listener = TcpListener::bind(("127.0.0.1", helper_port)).await?;
-    // 直接启动
+    match TcpListener::bind(("127.0.0.1", helper_port)).await {
+        Ok(listener) => {
+            // 端口可用，正常启动 Helper Server
+            ...
+        }
+        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
+            // 端口被占用，检查是否已有 Helper 在运行
+            let resp = reqwest::get(format!("http://127.0.0.1:{helper_port}/health")).await;
+            if resp.is_ok() {
+                // 已有 Helper 运行，跳过启动
+                return Ok(());
+            }
+            // 不是我们的 Helper → 报错
+        }
+    }
```

---

### `crates/codex-plus-core/src/proxy_stats.rs`（+185 行）

#### MiMo Credits 定价逻辑

```rust
pub fn estimate_cost(model: &str, prompt: u64, cached: u64, completion: u64) -> f64 {
    let non_cached = prompt.saturating_sub(cached);
    let is_night = is_night_time(); // 0:00-8:00 UTC+8

    let (cached_rate, input_rate, output_rate) = match model_prefix {
        "mimo-v2.5-pro" | "mimo-v2-pro" => (2.5, 300.0, 600.0),
        "mimo-v2.5" | "mimo-v2-omni" => (2.0, 100.0, 200.0),
        _ => (0.0, 0.0, 0.0),
    };

    let total = cached as f64 * cached_rate
              + non_cached as f64 * input_rate
              + completion as f64 * output_rate;

    if is_night { total * 0.8 } else { total }
}
```

#### 新增字段

```diff
 pub struct ProxyStatsSnapshot {
+    pub total_cached_tokens: u64,
+    pub total_prompt_tokens: u64,
+    pub total_completion_tokens: u64,
+    pub total_reasoning_tokens: u64,
 }
```

#### `cached_tokens` 兼容提取

```rust
let cached = prompt_tokens_details
    .and_then(|d| d.get("cached_tokens"))
    .and_then(|v| v.as_u64())
    .or_else(|| input_tokens_details  // Anthropic 兼容
        .and_then(|d| d.get("cached_tokens"))
        .and_then(|v| v.as_u64()))
    .unwrap_or(0);
```

---

### `crates/codex-plus-core/src/stats_persistence.rs`（+357 行，新文件）

SQLite 持久化层，存储每请求统计和每日/每小时聚合。

```rust
pub struct StatsPersistence { conn: Arc<Mutex<rusqlite::Connection>> }

// 表结构
// daily_stats: date, total_requests, total_errors, total_prompt_tokens,
//              total_completion_tokens, total_reasoning_tokens, total_cached_tokens,
//              total_tokens, total_cost, total_latency_ms, avg_latency_ms
// hourly_stats: datetime, requests, errors, prompt_tokens, completion_tokens,
//               reasoning_tokens, cached_tokens, total_tokens, cost, latency_ms
// request_log: timestamp, model, prompt_tokens, completion_tokens, cached_tokens,
//              total_tokens, cost_estimate, latency_ms, error

// 核心方法
impl StatsPersistence {
    pub fn open(state_dir: &Path) -> Result<Self>     // 创建/打开 SQLite
    pub async fn record_request(...) -> Result<()>     // 记录单次请求
    pub async fn query_recent_days(days: u32) -> Result<Vec<DailyStatsRecord>>
    pub async fn query_hourly(date: &str) -> Result<Vec<HourlyStatsRecord>>
    pub async fn query_today_and_yesterday_hourly() -> Result<(Vec<HourlyStatsRecord>, Vec<HourlyStatsRecord>)>
}
```

---

### `crates/codex-plus-core/src/config_manager.rs`（+24 行）

```diff
 fn write_mcp_server(table: &mut toml_edit::Table, name: &str, ...) {
-    table.insert(name, Item::Table(server_table));
+    // 使用 table_mut_or_insert 获取父表，避免重复创建
+    let mcp = table.entry("mcpServers").or_insert_with(|| {
+        let mut t = toml_edit::Table::new();
+        t.set_implicit(true);
+        Item::Table(t)
+    });
+    mcp.as_table_like_mut().unwrap().insert(name, Item::Table(server_table));
 }
```

---

### `assets/inject/renderer-inject.js`（+347 行）

详见上方"模型显示名称注入"和"注入状态指示器"章节。核心新增：

1. **模型名称替换**：`replaceModelDisplayName()` + MutationObserver
2. **状态指示器**：`createStatusIndicator()` + `checkInjectionStatus()`
3. **调试桥接**：`__codexSessionDeleteBridge` 注入
4. **每 5 秒自动刷新**状态

---

## 🛠️ 查询工具

本项目提供交互式查询工具，无需手动翻阅 diff：

```bash
./scripts/my-changes.sh list          # 列出所有修改文件（带行数）
./scripts/my-changes.sh show commands # 查看 commands.rs 的 diff
./scripts/my-changes.sh search "关键词" # 搜索所有改动
./scripts/my-changes.sh feature       # 列出所有功能分类
./scripts/my-changes.sh feature 流量统计  # 查看流量统计相关文件
./scripts/my-changes.sh stats         # 统计摘要
./scripts/my-changes.sh conflict      # 与上游冲突分析
./scripts/my-changes.sh tree          # 文件树状图
./scripts/my-changes.sh export        # 导出为 patch 文件
```

---

## 📚 相关文档

- [项目 README](README.md)
- [更新日志](CHANGELOG.md)
- [开发指南](CONTRIBUTING.md)
- [查询工具](scripts/my-changes.sh)
