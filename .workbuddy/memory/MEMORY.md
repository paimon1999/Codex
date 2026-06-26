# Ucodex 项目长期记忆（原 Codex++）

## 架构要点
- Manager (Tauri GUI) 内嵌独立 Helper Server，不再依赖 CLI
- `StandaloneHelperHandle` 在 `launcher.rs` 中，Manager 启动时 `block_on` 启动
- 统计数据优先进程内读取，回退 HTTP 轮询 CLI helper

## 关键模块
- `config_manager.rs` — config.toml 全量管理（features/mcp_servers/plugins/projects/notify/raw_toml）
- `relay_config.rs` — 供应商配置读写（toml_edit 保留格式，原子写入+备份）
- `proxy_stats.rs` — Token 统计（AtomicU64 + RwLock）
- `proxy_cache.rs` — 响应缓存（TTL 2h, LRU 2048）
- `config_migration.rs` — 配置版本迁移（链式执行，自动备份，[ucodex_internal] 存版本号）

## 构建注意事项
- `dist/` 由 vite build 生成，`cargo clean` 不清理，需先 `npm --prefix apps/ucodex-manager run vite:build`
- `build-release.sh` 已包含 vite:build 步骤
- ~~macOS 上 UPX 需要 `--force-macos` 参数~~ **UPX 已禁用**：UPX 压缩后二进制文件在 macOS 上出现 "Bad executable" 错误，已从构建脚本中移除
- Tauri codegen 使用 brotli 压缩嵌入前端，`strings`/`grep` 无法直接搜索二进制
- `cargo build` 不执行 `beforeBuildCommand`，前端改动后需手动先跑 vite:build
- 前端改动后需删除 `target/release/build/ucodex-manager-*/out/tauri-codegen-assets/` 强制重新嵌入
- **`renderer-inject.js` 是 `include_str!` 编译时嵌入的**，修改后必须重新构建 launcher 二进制
- 注入通过 Manager GUI 触发（`launch_ucodex` 命令），不是直接运行 ucodex 二进制

## 品牌信息
- 显示名：Ucodex（原 Codex++）
- 项目地址：https://github.com/paimon1999/Codex
- 二进制名：ucodex, ucodex-manager（原 codex-plus-plus, codex-plus-plus-manager）
- 更新机制仍指向 BigPizzaV3/CodexPlusPlus 的 GitHub Release

## MiMo Credits 定价（proxy_stats.rs）
- mimo-v2.5-pro / mimo-v2-pro: 缓存 2.5 Cr/token, 非缓存 300 Cr/token, 输出 600 Cr/token
- mimo-v2.5 / mimo-v2-omni: 缓存 2 Cr/token, 非缓存 100 Cr/token, 输出 200 Cr/token
- 夜间（0:00-8:00 UTC+8）语言模型八折
- 费用显示：M Cr（百万 Credits）/ K Cr（千 Credits）
- `cached_tokens` 从 `prompt_tokens_details.cached_tokens` 提取（兼容 Anthropic `input_tokens_details`）

## 模型显示名称注入（2025-06-13）
- **问题**：Codex UI 显示"自定义"而不是模型名称，且 `model_provider` 字段只能是 "custom"
- **解决方案**：通过注入脚本动态替换 UI 中的"自定义"/"custom"
- **实现**：
  1. Helper Server 添加 `/config` API 端点，返回当前配置
     - `model`: 当前使用的模型名称（如 "mimo-v2.5-pro"）
     - `modelProvider`: 当前使用的供应商 ID（如 "custom"）
     - `displayName`: 用于显示的名称（优先使用 model 字段）
  2. 注入脚本（renderer-inject.js）添加动态替换逻辑
     - 从 Helper Server 获取配置
     - 使用 MutationObserver 监听 DOM 变化
     - 动态替换"自定义"/"custom"为模型名称
     - 每30秒刷新一次配置
- **关键文件**：
  - `launcher.rs`: 添加 `/config` API 端点
  - `renderer-inject.js`: 添加动态替换逻辑
- **测试验证**：`curl -s http://127.0.0.1:57321/config` 返回正确的配置

## 注入状态指示器（2025-06-13）
- **功能**：在 Codex UI 右下角显示 Ucodex 标记和红绿灯指示注入状态
- **实现**：
  1. 创建固定定位的状态指示器（右下角）
  2. 红绿灯颜色：
     - 🟢 绿色：注入成功（Bridge 存在且调用正常）
     - 🟡 黄色：检查中
     - 🔴 红色：Bridge 未注入
     - 🟠 橙色：注入异常
  3. 点击显示详细状态弹窗：
     - Ucodex 版本号
     - Build ID
     - Helper Server 地址
     - 当前模型名称
     - 刷新状态按钮
  4. 每 5 秒自动刷新状态
- **关键代码**：
  - `createStatusIndicator()`: 创建指示器 UI
  - `checkInjectionStatus()`: 检查 Bridge 状态
  - `refreshStatusIndicator()`: 刷新指示器
  - `showStatusDetails()`: 显示详情弹窗
- **检测逻辑**：
  1. 检查 `window.__codexSessionDeleteBridge` 是否存在
  2. 调用 `bridge("/backend/status", {})` 验证功能
  3. 2 秒超时保护

## 启动功能修复（2025-06-13）
- **问题1**：Manager 没有"启动 Codex"按钮，只有"启动 Ucodex"（带注入）
- **问题2**：`spawn_silent_launcher` 调用 `command.spawn()` 后立即返回 `Ok(())`，不验证进程是否真正启动
  - launcher 可能立即崩溃（找不到 Codex App、端口占用等），但 Manager 仍显示"启动成功"
- **修复**：
  1. 添加 `launch_codex_app_only` 命令：直接启动原版 Codex App（不注入）
     - 使用 macOS `open` 命令或直接运行可执行文件
     - 等待 1.5 秒后检查 Codex 进程是否出现
  2. 修改 `spawn_ucodex_launch`：启动后验证
     - 检查 launcher 二进制是否存在
     - spawn 后等待 800ms，用 `kill -0` 检查进程是否存活
     - 同时检查 Codex 进程是否已出现
     - 如果 launcher 已退出且 Codex 未启动 → 返回错误（含具体原因）
  3. 前端添加"启动 Codex（无注入）"按钮
- **关键文件**：
  - `commands.rs`: `spawn_ucodex_launch`, `spawn_silent_launcher`, `launch_codex_app_only`, `is_process_alive`
  - `lib.rs`: 注册 `launch_codex_app_only` 命令
  - `App.tsx`: 添加 `launchCodexAppOnly` 函数和按钮

## Helper 端口冲突修复（2025-06-13）
- **问题**：Manager 内嵌 Helper Server 占用 57321，launcher 再绑同一端口 → AddrInUse
- **修复**：launcher.rs `start_helper` 中，AddrInUse 时发 HTTP GET 检查是否已有 Helper，若已有则跳过
- **关键文件**：`crates/ucodex-core/src/launcher.rs` (start_helper 方法)

## Codex 无调试端口重启修复（2025-06-13）
- **问题**：Codex 已在运行不带 debug port，`open -a` 只激活不重启 → CDP 9229 不可用 → 注入失败
- **修复**：launch_codex macOS 路径中，检测到 Codex 运行但 CDP 不可用时，先 osascript quit 再重启

## 灵动岛悬浮窗口（2026-06-14）
- **功能**：Manager 侧栏底部「灵动岛」按钮切换到悬浮胶囊窗口
- **实现**：`FloatingMode.tsx` + Tauri JS API 窗口控制（无边框/置顶/跳过任务栏/拖拽）
- **三级展开**：L0 胶囊（状态+模型名）→ L1 信息网格 → L2 Token 详情，5 秒自动收起
- **权限**：`capabilities/default.json` 添加 16 项 `core:window:allow-*` 权限
- **注意**：sidebar 改为 flex column 布局以支持 footer margin-top:auto
