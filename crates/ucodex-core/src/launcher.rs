use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use async_trait::async_trait;
use futures_util::StreamExt;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::proxy_cache::ProxyCache;
use crate::proxy_stats::{ProxyStatsState, TokenUsage};
use crate::settings::{BackendSettings, SettingsStore, normalize_codex_extra_args};
use crate::stats_persistence::StatsPersistence;
use crate::status::{LaunchStatus, StatusStore};

/// Helper 服务器共享状态
#[derive(Clone)]
struct HelperState {
    stats: Arc<ProxyStatsState>,
    cache: Arc<ProxyCache>,
    persistence: Option<Arc<StatsPersistence>>,
}

impl HelperState {
    /// 记录统计并持久化到数据库（fire-and-forget 持久化）
    async fn record_stats(
        &self,
        usage: &TokenUsage,
        latency_ms: u64,
        is_stream: bool,
        cached: bool,
        error: bool,
    ) {
        self.stats.record(usage, latency_ms, is_stream, cached, error).await;
        if let Some(ref persistence) = self.persistence {
            let cost = crate::proxy_stats::estimate_cost(
                &usage.model,
                usage.prompt_tokens,
                usage.cached_tokens,
                usage.completion_tokens,
            );
            let _ = persistence.record_request(
                usage.prompt_tokens,
                usage.completion_tokens,
                usage.reasoning_tokens,
                usage.cached_tokens,
                usage.total_tokens,
                cost,
                latency_ms,
                error,
            ).await;
        }
    }
}

/// 独立 Helper Server 的运行时句柄
///
/// 持有此句柄可获取统计快照；drop 后自动关闭 server。
pub struct StandaloneHelperHandle {
    stats: Arc<ProxyStatsState>,
    cache: Arc<ProxyCache>,
    persistence: Option<Arc<StatsPersistence>>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl StandaloneHelperHandle {
    /// 克隆内部引用（供跨 await 使用，先 clone 再 drop guard）
    pub fn clone_refs(&self) -> (Arc<ProxyStatsState>, Arc<ProxyCache>) {
        (self.stats.clone(), self.cache.clone())
    }

    /// 获取持久化句柄
    pub fn persistence(&self) -> Option<&Arc<StatsPersistence>> {
        self.persistence.as_ref()
    }

    /// 获取统计快照（供 Tauri command 直接读取）
    pub async fn stats_snapshot(&self) -> crate::proxy_stats::ProxyStatsSnapshot {
        let cache_metrics = self.cache.metrics().await;
        let cache_stats = crate::proxy_stats::CacheStats {
            hits: cache_metrics.hits,
            misses: cache_metrics.misses,
            hit_rate: if cache_metrics.hits + cache_metrics.misses > 0 {
                cache_metrics.hits as f64 / (cache_metrics.hits + cache_metrics.misses) as f64
            } else {
                0.0
            },
            size: cache_metrics.size,
            max_size: cache_metrics.max_size,
        };
        self.stats.snapshot(cache_stats).await
    }

    /// 关闭 helper server
    pub fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for StandaloneHelperHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// 在指定端口启动独立的 Helper Server（不依赖 Codex 进程）
///
/// 返回 `StandaloneHelperHandle`，可直接在 Tauri command 中用于获取统计快照。
pub async fn start_standalone_helper(helper_port: u16) -> anyhow::Result<StandaloneHelperHandle> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", helper_port))
        .await
        .with_context(|| format!("failed to bind helper server on 127.0.0.1:{helper_port}"))?;
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "helper.standalone_started",
        serde_json::json!({
            "helper_port": helper_port,
            "address": format!("http://127.0.0.1:{helper_port}")
        }),
    );
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();

    // 初始化统计持久化（失败不阻塞启动）
    let state_dir = crate::paths::default_app_state_dir();
    let persistence = match StatsPersistence::open(&state_dir) {
        Ok(p) => Some(Arc::new(p)),
        Err(e) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "helper.stats_persistence_failed",
                serde_json::json!({ "error": e.to_string() }),
            );
            None
        }
    };

    let stats = ProxyStatsState::new();

    // 启动时从 SQLite 加载历史基线（在处理任何请求之前）
    if let Some(ref pers) = persistence {
        if let Ok(daily) = pers.query_recent_days(365).await {
            let mut baseline = crate::proxy_stats::PersistedBaseline::default();
            for d in &daily {
                baseline.total_requests += d.total_requests;
                baseline.total_errors += d.total_errors;
                baseline.total_prompt_tokens += d.total_prompt_tokens;
                baseline.total_completion_tokens += d.total_completion_tokens;
                baseline.total_reasoning_tokens += d.total_reasoning_tokens;
                baseline.total_tokens += d.total_tokens;
                baseline.total_cost += d.total_cost;
                baseline.total_latency_ms += d.total_latency_ms;
            }
            if baseline.total_requests > 0 {
                stats.set_baseline(baseline).await;
            }
        }
    }

    let state = HelperState {
        stats: stats.clone(),
        cache: ProxyCache::new(),
        persistence: persistence.clone(),
    };
    state.cache.start_cleanup_task();
    let cache = state.cache.clone();
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                accepted = listener.accept() => {
                    if let Ok((stream, addr)) = accepted {
                        let state = state.clone();
                        tokio::spawn(async move {
                            let _ = handle_helper_connection(stream, Some(addr), state).await;
                        });
                    }
                }
            }
        }
    });
    Ok(StandaloneHelperHandle {
        stats,
        cache,
        persistence,
        shutdown: Some(shutdown_tx),
        task: Some(task),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexLaunch {
    Process {
        command: Vec<String>,
        wait_strategy: ProcessWaitStrategy,
        macos_cleanup_policy: Option<MacosCleanupPolicy>,
    },
    PackagedActivation {
        app_user_model_id: String,
        arguments: String,
        process_id: Option<u32>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessWaitStrategy {
    TrackedChild,
    ExternalWaitCommand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacosCleanupPolicy {
    QuitIfNotPreviouslyRunning,
    SkipQuitBecauseAlreadyRunning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowsProcessControlStrategy {
    NativeWindowsApi,
}

#[cfg(windows)]
pub fn windows_process_control_strategy() -> WindowsProcessControlStrategy {
    WindowsProcessControlStrategy::NativeWindowsApi
}

impl CodexLaunch {
    pub fn process_id(&self) -> Option<u32> {
        match self {
            Self::PackagedActivation { process_id, .. } => *process_id,
            Self::Process { .. } => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LaunchOptions {
    pub app_dir: Option<PathBuf>,
    pub debug_port: u16,
    pub helper_port: u16,
    pub status_store: StatusStore,
}

impl Default for LaunchOptions {
    fn default() -> Self {
        Self {
            app_dir: None,
            debug_port: 9229,
            helper_port: 57321,
            status_store: StatusStore::default(),
        }
    }
}

#[derive(Clone)]
pub struct LaunchHandle {
    pub debug_port: u16,
    pub helper_port: u16,
    pub app_dir: PathBuf,
    pub launch: CodexLaunch,
    pub status_store: StatusStore,
    helper_started: bool,
    hooks: Arc<dyn LaunchHooks>,
}

impl std::fmt::Debug for LaunchHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LaunchHandle")
            .field("debug_port", &self.debug_port)
            .field("helper_port", &self.helper_port)
            .field("app_dir", &self.app_dir)
            .field("launch", &self.launch)
            .field("status_store", &self.status_store)
            .finish_non_exhaustive()
    }
}

impl LaunchHandle {
    pub async fn wait_for_codex_exit(&self) -> anyhow::Result<()> {
        let result = self.hooks.wait_for_codex_exit(&self.launch).await;
        if self.helper_started {
            self.hooks.shutdown_helper(self.helper_port).await;
        }
        result
    }
}

#[async_trait(?Send)]
pub trait LaunchHooks: Send + Sync {
    fn resolve_app_dir(
        &self,
        app_dir: Option<&Path>,
        settings: &BackendSettings,
    ) -> anyhow::Result<PathBuf>;
    fn select_debug_port(&self, requested: u16) -> u16;
    fn select_helper_port(&self, requested: u16) -> u16;
    async fn load_settings(&self) -> anyhow::Result<BackendSettings>;
    async fn run_provider_sync(&self) -> anyhow::Result<()>;
    async fn apply_active_relay_profile(&self, _settings: &BackendSettings) -> anyhow::Result<()> {
        Ok(())
    }
    async fn start_helper(&self, helper_port: u16) -> anyhow::Result<()>;
    async fn launch_codex(
        &self,
        app_dir: &Path,
        debug_port: u16,
        extra_args: &[String],
    ) -> anyhow::Result<CodexLaunch>;
    async fn bridge_context(
        &self,
        _debug_port: u16,
        _app_dir: &Path,
    ) -> anyhow::Result<Option<crate::routes::BridgeContext>> {
        Ok(None)
    }
    async fn inject(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()>;
    async fn inject_bridge(
        &self,
        debug_port: u16,
        helper_port: u16,
        _ctx: crate::routes::BridgeContext,
    ) -> anyhow::Result<()> {
        self.inject(debug_port, helper_port).await
    }
    async fn ensure_injection(&self, debug_port: u16, helper_port: u16, app_dir: &Path) -> bool {
        for attempt in 1..=120 {
            let result = match self.bridge_context(debug_port, app_dir).await {
                Ok(Some(ctx)) => self.inject_bridge(debug_port, helper_port, ctx).await,
                Ok(None) => self.inject(debug_port, helper_port).await,
                Err(error) => Err(error),
            };
            match result {
                Ok(()) => return true,
                Err(error) => {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "launcher.ensure_injection_retry_failed",
                        serde_json::json!({
                            "debug_port": debug_port,
                            "helper_port": helper_port,
                            "attempt": attempt,
                            "message": error.to_string()
                        }),
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
        false
    }
    async fn start_bridge_watchdog(
        &self,
        _debug_port: u16,
        _helper_port: u16,
    ) -> anyhow::Result<()> {
        Ok(())
    }
    async fn write_status(&self, status: &str);
    async fn wait_for_codex_exit(&self, launch: &CodexLaunch) -> anyhow::Result<()>;
    async fn shutdown_helper(&self, helper_port: u16);
    async fn terminate_codex(&self, launch: &CodexLaunch);
}

#[derive(Default)]
pub struct DefaultLaunchHooks {
    child: Mutex<Option<Child>>,
    helper: Mutex<Option<HelperRuntime>>,
    bridge_watchdog: Mutex<Option<BridgeWatchdogRuntime>>,
}

struct HelperRuntime {
    shutdown: tokio::sync::oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

struct BridgeWatchdogRuntime {
    shutdown: tokio::sync::oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

pub async fn launch_and_inject(options: LaunchOptions) -> anyhow::Result<LaunchHandle> {
    launch_and_inject_with_hooks(options, DefaultLaunchHooks::shared()).await
}

pub async fn launch_and_inject_with_hooks<H>(
    options: LaunchOptions,
    hooks: H,
) -> anyhow::Result<LaunchHandle>
where
    H: IntoLaunchHooks,
{
    let hooks = hooks.into_launch_hooks();
    let debug_port = hooks.select_debug_port(options.debug_port);
    let mut helper_port = hooks.select_helper_port(options.helper_port);
    let settings = hooks.load_settings().await?;
    let app_dir = hooks.resolve_app_dir(options.app_dir.as_deref(), &settings)?;
    let status_store = options.status_store.clone();
    let mut helper_started = false;
    let mut launched = None;
    let mut keep_launched_on_error = false;

    let result: anyhow::Result<LaunchHandle> = async {
        if settings.provider_sync_enabled {
            hooks.run_provider_sync().await?;
        }
        let protocol_proxy_enabled = relay_protocol_proxy_enabled(&settings);
        if protocol_proxy_enabled {
            helper_port = crate::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT;
        }
        if settings.enhancements_enabled || protocol_proxy_enabled {
            hooks.start_helper(helper_port).await?;
            helper_started = true;
        }

        // Apply active relay profile to ~/.codex/config.toml before launching Codex
        hooks.apply_active_relay_profile(&settings).await?;

        let launch = hooks
            .launch_codex(&app_dir, debug_port, &settings.codex_extra_args)
            .await?;
        launched = Some(launch.clone());
        keep_launched_on_error = true;

        let mut injection_degraded = false;
        if settings.enhancements_enabled {
            let injection_ready = hooks.ensure_injection(debug_port, helper_port, &app_dir).await;
            if injection_ready {
                keep_launched_on_error = false;
                hooks.start_bridge_watchdog(debug_port, helper_port).await?;
            } else {
                let degraded = launch_status(
                    "running_degraded",
                    "Codex 已启动，Ucodex 增强仍在等待页面就绪。",
                    debug_port,
                    helper_port,
                    &app_dir,
                );
                options.status_store.save_latest(&degraded)?;
                hooks.write_status("running_degraded").await;
                injection_degraded = true;
            }
        }

        if !settings.enhancements_enabled || !injection_degraded {
            let status = launch_status(
                "running",
                "Ucodex launcher ready",
                debug_port,
                helper_port,
                &app_dir,
            );
            options.status_store.save_latest(&status)?;
            hooks.write_status("running").await;
        }

        Ok(LaunchHandle {
            debug_port,
            helper_port,
            app_dir: app_dir.clone(),
            launch,
            status_store: status_store.clone(),
            helper_started,
            hooks: Arc::clone(&hooks),
        })
    }
    .await;

    match result {
        Ok(handle) => Ok(handle),
        Err(error) => {
            if helper_started {
                hooks.shutdown_helper(helper_port).await;
            }
            if let Some(launch) = &launched {
                if !keep_launched_on_error {
                    hooks.terminate_codex(launch).await;
                }
            }
            let message = error.to_string();
            let failure = launch_status("failed", &message, debug_port, helper_port, &app_dir);
            let _ = status_store.save_latest(&failure);
            hooks.write_status("failed").await;
            Err(error)
        }
    }
}

fn relay_protocol_proxy_enabled(settings: &BackendSettings) -> bool {
    settings.active_relay_profile().protocol == crate::settings::RelayProtocol::ChatCompletions
}

pub trait IntoLaunchHooks {
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks>;
}

impl<T> IntoLaunchHooks for &T
where
    T: LaunchHooks + Clone + 'static,
{
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks> {
        Arc::new(self.clone())
    }
}

impl IntoLaunchHooks for Arc<dyn LaunchHooks> {
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks> {
        self
    }
}

impl IntoLaunchHooks for DefaultLaunchHooks {
    fn into_launch_hooks(self) -> Arc<dyn LaunchHooks> {
        Arc::new(self)
    }
}

impl DefaultLaunchHooks {
    pub fn shared() -> Arc<dyn LaunchHooks> {
        Arc::new(Self::default())
    }
}

#[async_trait(?Send)]
impl LaunchHooks for DefaultLaunchHooks {
    fn resolve_app_dir(
        &self,
        app_dir: Option<&Path>,
        settings: &BackendSettings,
    ) -> anyhow::Result<PathBuf> {
        crate::app_paths::resolve_codex_app_dir_with_saved(
            app_dir,
            Some(settings.codex_app_path.as_str()),
        )
        .ok_or_else(|| anyhow::anyhow!("Codex App directory not found"))
    }

    fn select_debug_port(&self, requested: u16) -> u16 {
        crate::ports::select_platform_loopback_port(requested)
    }

    fn select_helper_port(&self, requested: u16) -> u16 {
        crate::ports::select_platform_loopback_port(requested)
    }

    async fn load_settings(&self) -> anyhow::Result<BackendSettings> {
        let mut settings = SettingsStore::default().load()?;
        hydrate_live_ccs_profiles(&mut settings);
        Ok(settings)
    }

    async fn run_provider_sync(&self) -> anyhow::Result<()> {
        anyhow::bail!("provider sync requires launcher hooks with ucodex-data integration")
    }

    async fn apply_active_relay_profile(&self, settings: &BackendSettings) -> anyhow::Result<()> {
        if !settings.relay_profiles_enabled {
            return Ok(());
        }
        let profile = settings.active_relay_profile();
        let home = crate::relay_config::default_codex_home_dir();
        let common_config = crate::relay_config::normalize_config_text(
            &[
                settings.relay_common_config_contents.as_str(),
                settings.relay_context_config_contents.as_str(),
            ]
            .into_iter()
            .map(str::trim)
            .filter(|section| !section.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        );
        if profile.relay_mode == crate::settings::RelayMode::Official
            && !profile.official_mix_api_key
        {
            let auth_contents = (!profile.auth_contents.trim().is_empty())
                .then_some(profile.auth_contents.as_str());
            crate::relay_config::clear_relay_config_to_home_with_auth(&home, auth_contents)?;
            return Ok(());
        }
        crate::relay_config::apply_relay_profile_to_home_with_switch_rules(
            &home,
            &profile,
            &common_config,
        )?;
        Ok(())
    }

    async fn start_helper(&self, helper_port: u16) -> anyhow::Result<()> {
        // 先检查端口是否已被占用（可能是 Manager 内嵌的 Helper Server）
        match tokio::net::TcpListener::bind(("127.0.0.1", helper_port)).await {
            Ok(listener) => {
                // 端口可用，正常启动 Helper Server
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "helper.listening",
                    serde_json::json!({
                        "helper_port": helper_port,
                        "address": format!("http://127.0.0.1:{helper_port}")
                    }),
                );
                let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel();
                let state = HelperState {
                    stats: ProxyStatsState::new(),
                    cache: ProxyCache::new(),
                    persistence: None,
                };
                state.cache.start_cleanup_task();
                let task = tokio::spawn(async move {
                    loop {
                        tokio::select! {
                            _ = &mut shutdown_rx => break,
                            accepted = listener.accept() => {
                                if let Ok((stream, addr)) = accepted {
                                    let state = state.clone();
                                    tokio::spawn(async move {
                                        let _ = handle_helper_connection(stream, Some(addr), state).await;
                                    });
                                }
                            }
                        }
                    }
                });
                *self.helper.lock().await = Some(HelperRuntime {
                    shutdown: shutdown_tx,
                    task,
                });
                Ok(())
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                // 端口已被占用，检查是否是已有的 Helper Server
                let url = format!("http://127.0.0.1:{helper_port}/backend/status");
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(2))
                    .build()
                    .unwrap_or_default();
                match client.get(&url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        // 已有 Helper Server 在运行（可能是 Manager 内嵌的），跳过启动
                        let _ = crate::diagnostic_log::append_diagnostic_log(
                            "helper.reused",
                            serde_json::json!({
                                "helper_port": helper_port,
                                "reason": "port already in use by existing helper server"
                            }),
                        );
                        eprintln!("[ucodex] Helper port {helper_port} already in use by existing server, skipping");
                        Ok(())
                    }
                    _ => {
                        // 端口被其他程序占用，报错
                        Err(anyhow::anyhow!(
                            "failed to bind helper runtime on 127.0.0.1:{helper_port} (port in use by another process)"
                        ))
                    }
                }
            }
            Err(e) => {
                Err(e).with_context(|| format!("failed to bind helper runtime on 127.0.0.1:{helper_port}"))
            }
        }
    }

    async fn launch_codex(
        &self,
        app_dir: &Path,
        debug_port: u16,
        extra_args: &[String],
    ) -> anyhow::Result<CodexLaunch> {
        if cfg!(windows) {
            if let Some(activation) = build_packaged_activation(app_dir, debug_port, extra_args) {
                let CodexLaunch::PackagedActivation {
                    app_user_model_id,
                    arguments,
                    ..
                } = &activation
                else {
                    unreachable!();
                };
                let process_id = activate_packaged_app(app_user_model_id, arguments).await?;
                return Ok(match activation {
                    CodexLaunch::PackagedActivation {
                        app_user_model_id,
                        arguments,
                        ..
                    } => CodexLaunch::PackagedActivation {
                        app_user_model_id,
                        arguments,
                        process_id: Some(process_id),
                    },
                    CodexLaunch::Process { .. } => unreachable!(),
                });
            }
        }

        if app_dir.extension().and_then(|value| value.to_str()) == Some("app") {
            let already_running = is_macos_app_running(app_dir).await;
            let cdp_available = crate::watcher::cdp_listening(debug_port);

            let cleanup_policy = if already_running {
                if cdp_available {
                    // Codex 已在运行且 CDP 可用 → 直接使用，不关闭
                    MacosCleanupPolicy::SkipQuitBecauseAlreadyRunning
                } else {
                    // Codex 已在运行但没有调试端口 → 必须关闭后重启
                    let app_name = app_dir
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .unwrap_or("Codex");
                    let _ = Command::new("osascript")
                        .arg("-e")
                        .arg(format!(
                            r#"tell application "{}" to quit"#,
                            app_name.replace('"', "\\\"")
                        ))
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .await;
                    // 等待 Codex 完全退出
                    for _ in 0..30 {
                        if !is_macos_app_running(app_dir).await {
                            break;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    }
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "launcher.relaunch_without_debug",
                        serde_json::json!({
                            "app_dir": app_dir.to_string_lossy(),
                            "debug_port": debug_port,
                            "reason": "Codex was running without debug port, quit and relaunching"
                        }),
                    );
                    MacosCleanupPolicy::QuitIfNotPreviouslyRunning
                }
            } else {
                MacosCleanupPolicy::QuitIfNotPreviouslyRunning
            };
            let command = build_macos_open_command(app_dir, debug_port, extra_args);
            let executable = command
                .first()
                .ok_or_else(|| anyhow::anyhow!("macOS open command is empty"))?;
            let child = Command::new(executable)
                .args(&command[1..])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .context("failed to launch macOS Codex app")?;
            *self.child.lock().await = Some(child);
            return Ok(CodexLaunch::Process {
                command,
                wait_strategy: ProcessWaitStrategy::ExternalWaitCommand,
                macos_cleanup_policy: Some(cleanup_policy),
            });
        }

        let command = build_codex_command(app_dir, debug_port, extra_args);
        let executable = command
            .first()
            .ok_or_else(|| anyhow::anyhow!("Codex command is empty"))?;
        let mut child_command = Command::new(executable);
        child_command
            .args(&command[1..])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        child_command.creation_flags(crate::windows_integration::CREATE_NO_WINDOW);
        let child = child_command
            .spawn()
            .with_context(|| format!("failed to launch Codex executable {executable}"))?;
        *self.child.lock().await = Some(child);
        Ok(CodexLaunch::Process {
            command,
            wait_strategy: ProcessWaitStrategy::TrackedChild,
            macos_cleanup_policy: None,
        })
    }

    async fn inject(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
        retry_injection(debug_port, helper_port).await
    }

    async fn start_bridge_watchdog(&self, debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
        let (shutdown, mut shutdown_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    _ = interval.tick() => {
                        let _ = check_and_reinject_bridge(debug_port, helper_port).await;
                    }
                }
            }
        });
        if let Some(runtime) = self
            .bridge_watchdog
            .lock()
            .await
            .replace(BridgeWatchdogRuntime { shutdown, task })
        {
            let _ = runtime.shutdown.send(());
            let _ = runtime.task.await;
        }
        Ok(())
    }

    async fn write_status(&self, _status: &str) {}

    async fn wait_for_codex_exit(&self, launch: &CodexLaunch) -> anyhow::Result<()> {
        match launch {
            CodexLaunch::Process { .. } => {
                if let Some(mut child) = self.child.lock().await.take() {
                    let _ = child.wait().await;
                }
                Ok(())
            }
            CodexLaunch::PackagedActivation { process_id, .. } => {
                if let Some(process_id) = process_id {
                    wait_for_windows_process_id(*process_id).await?;
                }
                Ok(())
            }
        }
    }

    async fn shutdown_helper(&self, _helper_port: u16) {
        if let Some(runtime) = self.bridge_watchdog.lock().await.take() {
            let _ = runtime.shutdown.send(());
            let _ = runtime.task.await;
        }
        if let Some(runtime) = self.helper.lock().await.take() {
            let _ = runtime.shutdown.send(());
            let _ = runtime.task.await;
        }
    }

    async fn terminate_codex(&self, launch: &CodexLaunch) {
        match launch {
            CodexLaunch::Process {
                wait_strategy: ProcessWaitStrategy::ExternalWaitCommand,
                command,
                macos_cleanup_policy,
            } => {
                if let Some(mut child) = self.child.lock().await.take() {
                    let _ = child.kill().await;
                }
                if let (Some(app_dir), Some(cleanup_policy)) = (
                    macos_app_dir_from_open_command(command),
                    *macos_cleanup_policy,
                ) {
                    let _ = run_macos_cleanup_command(&app_dir, cleanup_policy).await;
                }
            }
            CodexLaunch::Process { .. } => {
                if let Some(mut child) = self.child.lock().await.take() {
                    let _ = child.kill().await;
                }
            }
            CodexLaunch::PackagedActivation {
                process_id: Some(process_id),
                ..
            } => {
                let _ = terminate_windows_process_id(*process_id).await;
            }
            CodexLaunch::PackagedActivation {
                process_id: None, ..
            } => {}
        }
    }
}

fn hydrate_live_ccs_profiles(settings: &mut BackendSettings) {
    if !settings.ccs_link_enabled {
        return;
    }
    settings
        .relay_profiles
        .retain(|profile| profile.linked_ccs_provider_id.trim().is_empty());
    let _ = crate::ccs_import::sync_linked_profiles_from_default_db(&mut settings.relay_profiles);
}

async fn handle_helper_connection(
    mut stream: tokio::net::TcpStream,
    remote_addr: Option<SocketAddr>,
    state: HelperState,
) -> anyhow::Result<()> {
    let request_bytes = read_http_request(&mut stream).await?;
    let request = String::from_utf8_lossy(&request_bytes);
    let request_line = request.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();
    let request_body = http_request_body(&request);
    let remote_addr_text = remote_addr.map(|addr| addr.to_string());

    let _ = crate::diagnostic_log::append_diagnostic_log(
        "helper.request",
        serde_json::json!({
            "method": method,
            "path": path,
            "request_line": request_line,
            "remote_addr": remote_addr_text,
            "body_bytes": request_body.len()
        }),
    );

    if crate::protocol_proxy::is_responses_proxy_path(path) && method == "POST" {
        return handle_protocol_proxy_connection(
            &mut stream,
            request_body,
            method,
            path,
            remote_addr_text,
            &state,
        )
        .await;
    }
    if crate::protocol_proxy::is_chat_completions_proxy_path(path) && method == "POST" {
        return handle_chat_completions_proxy_connection(
            &mut stream,
            request_body,
            method,
            path,
            remote_addr_text,
            &state,
        )
        .await;
    }
    if crate::protocol_proxy::is_models_proxy_path(path) && matches!(method, "GET" | "OPTIONS") {
        return handle_models_proxy_connection(&mut stream, method, path, remote_addr_text).await;
    }
    if path == "/proxy-stats" && method == "GET" {
        let cache_stats = state.cache.metrics().await;
        let snapshot = state.stats.snapshot(
            crate::proxy_stats::CacheStats {
                hits: cache_stats.hits,
                misses: cache_stats.misses,
                hit_rate: if cache_stats.hits + cache_stats.misses > 0 {
                    cache_stats.hits as f64 / (cache_stats.hits + cache_stats.misses) as f64
                } else {
                    0.0
                },
                size: cache_stats.size,
                max_size: cache_stats.max_size,
            },
        ).await;
        let body = serde_json::to_vec(&snapshot)?;
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body).await?;
        return Ok(());
    }
    if path == "/config" && method == "GET" {
        let home = crate::relay_config::default_codex_home_dir();
        let config_path = home.join("config.toml");
        let raw = std::fs::read_to_string(&config_path).unwrap_or_default();
        let doc = crate::relay_config::parse_toml_document(&raw)
            .unwrap_or_else(|_| toml_edit::DocumentMut::new());
        let model = doc.get("model")
            .and_then(toml_edit::Item::as_str)
            .unwrap_or("")
            .to_string();
        let model_provider = doc.get("model_provider")
            .and_then(toml_edit::Item::as_str)
            .unwrap_or("custom")
            .to_string();
        let provider_name = doc.get("model_providers")
            .and_then(toml_edit::Item::as_table)
            .and_then(|t| t.get(&model_provider))
            .and_then(toml_edit::Item::as_table)
            .and_then(|t| t.get("name"))
            .and_then(toml_edit::Item::as_str)
            .unwrap_or("")
            .to_string();
        let display_name = if !model.is_empty() {
            model.clone()
        } else if !provider_name.is_empty() && provider_name != "custom" {
            provider_name
        } else {
            model_provider.clone()
        };
        let body = serde_json::to_vec(&serde_json::json!({
            "status": "ok",
            "model": model,
            "modelProvider": model_provider,
            "displayName": display_name
        }))?;
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &body).await?;
        return Ok(());
    }

    let (status, body, content_type, log_event) =
        if matches!(path, "/backend/status" | "/backend/repair")
            && matches!(method, "GET" | "POST" | "OPTIONS")
        {
            (
                "200 OK".to_string(),
                serde_json::to_vec(&serde_json::json!({
                    "status": "ok",
                    "message": "后端已连接",
                    "version": crate::version::VERSION,
                    "transport": "http-helper"
                }))?,
                "application/json; charset=utf-8".to_string(),
                if path == "/backend/status" {
                    "helper.backend_status_ok"
                } else {
                    "helper.backend_repair_ok"
                },
            )
        } else if path == "/diagnostics/log" && matches!(method, "POST" | "OPTIONS") {
            if method == "POST" {
                let detail = serde_json::from_str::<serde_json::Value>(request_body)
                    .unwrap_or_else(|error| {
                        serde_json::json!({
                            "parse_error": error.to_string(),
                            "raw": request_body
                        })
                    });
                let event = detail
                    .get("event")
                    .and_then(serde_json::Value::as_str)
                    .map(sanitize_diagnostic_event)
                    .unwrap_or_else(|| "event".to_string());
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    &format!("renderer.{event}"),
                    detail,
                );
            }
            (
                "200 OK".to_string(),
                serde_json::to_vec(&serde_json::json!({
                    "status": "ok",
                    "message": "日志已记录"
                }))?,
                "application/json; charset=utf-8".to_string(),
                "helper.diagnostics_log_ok",
            )
        } else {
            (
                "404 Not Found".to_string(),
                serde_json::to_vec(&serde_json::json!({
                    "status": "failed",
                    "message": "未知后端路径"
                }))?,
                "application/json; charset=utf-8".to_string(),
                "helper.unknown_path",
            )
        };
    let _ = crate::diagnostic_log::append_diagnostic_log(
        log_event,
        serde_json::json!({
            "method": method,
            "path": path,
            "status": status,
            "remote_addr": remote_addr_text
        }),
    );
    let response = if method == "OPTIONS" {
        format!(
            "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
    } else {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
    };
    stream.write_all(response.as_bytes()).await?;
    if method != "OPTIONS" {
        stream.write_all(&body).await?;
    }
    stream.shutdown().await?;
    Ok(())
}

async fn handle_models_proxy_connection(
    stream: &mut tokio::net::TcpStream,
    method: &str,
    path: &str,
    remote_addr_text: Option<String>,
) -> anyhow::Result<()> {
    if method == "OPTIONS" {
        write_http_response(
            stream,
            "204 No Content",
            "application/json; charset=utf-8",
            &[],
        )
        .await?;
        stream.shutdown().await?;
        return Ok(());
    }

    let upstream = match crate::protocol_proxy::open_models_proxy_request().await {
        Ok(upstream) => upstream,
        Err(error) => {
            let body = serde_json::to_vec(&serde_json::json!({
                "status": "failed",
                "message": error.to_string()
            }))?;
            write_http_response(
                stream,
                "502 Bad Gateway",
                "application/json; charset=utf-8",
                &body,
            )
            .await?;
            log_helper_response(
                "helper.models_proxy_failed",
                method,
                path,
                "502 Bad Gateway",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
    };

    let status = upstream.status();
    let is_success = upstream.is_success();
    let content_type = if upstream.content_type.is_empty() {
        "application/json; charset=utf-8".to_string()
    } else {
        upstream.content_type.clone()
    };
    let body = upstream.response.bytes().await?.to_vec();
    write_http_response(stream, &status, &content_type, &body).await?;
    log_helper_response(
        if is_success {
            "helper.models_proxy_ok"
        } else {
            "helper.models_proxy_upstream_error"
        },
        method,
        path,
        &status,
        remote_addr_text,
    );
    stream.shutdown().await?;
    Ok(())
}

async fn handle_protocol_proxy_connection(
    stream: &mut tokio::net::TcpStream,
    request_body: &str,
    method: &str,
    path: &str,
    remote_addr_text: Option<String>,
    state: &HelperState,
) -> anyhow::Result<()> {
    let start_time = std::time::Instant::now();
    let cache_key = ProxyCache::cache_key(request_body);
    let request_json = serde_json::from_str::<serde_json::Value>(request_body).ok();

    // 缓存查找 (仅非流式)
    let cacheable = request_json
        .as_ref()
        .map(|j| crate::proxy_cache::is_cacheable(j))
        .unwrap_or(false);
    if cacheable {
        if let Some((cached_response, cached_usage)) = state.cache.get(&cache_key).await {
            let body = serde_json::to_vec(&cached_response)?;
            write_http_response(stream, "200 OK", "application/json; charset=utf-8", &body).await?;
            state.record_stats(
                &cached_usage,
                start_time.elapsed().as_millis() as u64,
                false,
                true,
                false,
            ).await;
            log_helper_response(
                "helper.protocol_proxy_cache_hit",
                method,
                path,
                "200 OK",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
    }
    let upstream = match crate::protocol_proxy::open_responses_proxy_request(request_body).await {
        Ok(upstream) => upstream,
        Err(error) => {
            let body = serde_json::to_vec(&serde_json::json!({
                "status": "failed",
                "message": error.to_string()
            }))?;
            write_http_response(
                stream,
                "502 Bad Gateway",
                "application/json; charset=utf-8",
                &body,
            )
            .await?;
            log_helper_response(
                "helper.protocol_proxy_failed",
                method,
                path,
                "502 Bad Gateway",
                remote_addr_text,
            );
            stream.shutdown().await?;
            return Ok(());
        }
    };

    if !upstream.is_success() {
        let status = upstream.status();
        let upstream_content_type = upstream.content_type.clone();
        let upstream_body = upstream.response.bytes().await?.to_vec();
        let error = crate::protocol_proxy::responses_error_from_upstream(
            upstream.status_code,
            &upstream_content_type,
            &upstream_body,
        );
        let body = serde_json::to_vec(&error)?;
        write_http_response(stream, &status, "application/json; charset=utf-8", &body).await?;
        log_helper_response(
            "helper.protocol_proxy_upstream_error",
            method,
            path,
            &status,
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }

    if upstream.is_stream {
        write_http_stream_headers(stream, "200 OK", "text/event-stream; charset=utf-8").await?;
        let mut converter = request_json
            .as_ref()
            .map(crate::protocol_proxy::ChatSseToResponsesConverter::with_request)
            .unwrap_or_default();
        let mut bytes_stream = upstream.response.bytes_stream();
        let mut stream_failed = false;
        let mut last_usage: Option<TokenUsage> = None;

        while let Some(chunk) = bytes_stream.next().await {
            match chunk {
                Ok(bytes) => {
                    // 尝试从 SSE chunk 提取 token usage
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(usage) = crate::proxy_stats::extract_usage_from_sse_chunk(&json) {
                                    last_usage = Some(usage);
                                }
                            }
                        }
                    }
                    let converted = converter.push_bytes(&bytes);
                    if !converted.is_empty() {
                        stream.write_all(&converted).await?;
                    }
                }
                Err(error) => {
                    let failed = converter.fail(
                        format!("Stream error: {error}"),
                        Some("stream_error".to_string()),
                    );
                    if !failed.is_empty() {
                        stream.write_all(&failed).await?;
                    }
                    stream_failed = true;
                    break;
                }
            }
        }

        if !stream_failed {
            let tail = converter.finish();
            if !tail.is_empty() {
                stream.write_all(&tail).await?;
            }
        }

        // 记录流式请求统计
        let latency_ms = start_time.elapsed().as_millis() as u64;
        let usage = last_usage.unwrap_or_default();
        state.record_stats(&usage, latency_ms, true, false, stream_failed).await;

        log_helper_response(
            "helper.protocol_proxy_stream_ok",
            method,
            path,
            "200 OK",
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }

    let upstream_body = upstream.response.bytes().await?;
    let chat_json: serde_json::Value = serde_json::from_slice(&upstream_body)?;
    let response_json = if let Some(request_json) = request_json.as_ref() {
        crate::protocol_proxy::chat_completion_to_response_with_request(chat_json, request_json)?
    } else {
        crate::protocol_proxy::chat_completion_to_response(chat_json)?
    };

    // 提取 token usage 并记录统计
    let usage = crate::proxy_stats::extract_usage_from_response(&response_json);
    let latency_ms = start_time.elapsed().as_millis() as u64;
    state.record_stats(&usage, latency_ms, false, false, false).await;

    // 缓存非流式响应
    if cacheable {
        state.cache.insert(cache_key, response_json.clone(), usage).await;
    }

    let body = serde_json::to_vec(&response_json)?;
    write_http_response(stream, "200 OK", "application/json; charset=utf-8", &body).await?;
    log_helper_response(
        "helper.protocol_proxy_ok",
        method,
        path,
        "200 OK",
        remote_addr_text,
    );
    stream.shutdown().await?;
    Ok(())
}

async fn handle_chat_completions_proxy_connection(
    stream: &mut tokio::net::TcpStream,
    request_body: &str,
    method: &str,
    path: &str,
    remote_addr_text: Option<String>,
    state: &HelperState,
) -> anyhow::Result<()> {
    let start_time = std::time::Instant::now();
    let upstream =
        match crate::protocol_proxy::open_chat_completions_proxy_request(request_body).await {
            Ok(upstream) => upstream,
            Err(error) => {
                let usage = TokenUsage::default();
                state.record_stats(&usage, start_time.elapsed().as_millis() as u64, false, false, true).await;
                let body = serde_json::to_vec(&serde_json::json!({
                    "status": "failed",
                    "message": error.to_string()
                }))?;
                write_http_response(
                    stream,
                    "502 Bad Gateway",
                    "application/json; charset=utf-8",
                    &body,
                )
                .await?;
                log_helper_response(
                    "helper.chat_completions_proxy_failed",
                    method,
                    path,
                    "502 Bad Gateway",
                    remote_addr_text,
                );
                stream.shutdown().await?;
                return Ok(());
            }
        };

    let status = upstream.status();
    let is_success = upstream.is_success();
    let content_type = if upstream.content_type.is_empty() {
        "application/json; charset=utf-8".to_string()
    } else {
        upstream.content_type.clone()
    };

    if upstream.is_stream && is_success {
        write_http_stream_headers(stream, &status, &content_type).await?;
        let mut bytes_stream = upstream.response.bytes_stream();
        let mut last_usage: Option<TokenUsage> = None;
        while let Some(chunk) = bytes_stream.next().await {
            let bytes = chunk?;
            // 尝试从 SSE chunk 提取 token usage
            let text = String::from_utf8_lossy(&bytes);
            for line in text.lines() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(usage) = crate::proxy_stats::extract_usage_from_sse_chunk(&json) {
                            last_usage = Some(usage);
                        }
                    }
                }
            }
            stream.write_all(&bytes).await?;
        }
        let latency_ms = start_time.elapsed().as_millis() as u64;
        let usage = last_usage.unwrap_or_default();
        state.record_stats(&usage, latency_ms, true, false, false).await;
        log_helper_response(
            "helper.chat_completions_proxy_stream_ok",
            method,
            path,
            &status,
            remote_addr_text,
        );
        stream.shutdown().await?;
        return Ok(());
    }

    let body = upstream.response.bytes().await?.to_vec();

    // 提取 token usage 并记录统计
    if is_success {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) {
            let usage = crate::proxy_stats::extract_usage_from_response(&json);
            let latency_ms = start_time.elapsed().as_millis() as u64;
            state.record_stats(&usage, latency_ms, false, false, false).await;
        }
    } else {
        let usage = TokenUsage::default();
        state.record_stats(&usage, start_time.elapsed().as_millis() as u64, false, false, true).await;
    }

    write_http_response(stream, &status, &content_type, &body).await?;
    log_helper_response(
        if is_success {
            "helper.chat_completions_proxy_ok"
        } else {
            "helper.chat_completions_proxy_upstream_error"
        },
        method,
        path,
        &status,
        remote_addr_text,
    );
    stream.shutdown().await?;
    Ok(())
}

async fn write_http_response(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> anyhow::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.write_all(body).await?;
    Ok(())
}

async fn write_http_stream_headers(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    content_type: &str,
) -> anyhow::Result<()> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;
    Ok(())
}

fn log_helper_response(
    event: &str,
    method: &str,
    path: &str,
    status: &str,
    remote_addr_text: Option<String>,
) {
    let _ = crate::diagnostic_log::append_diagnostic_log(
        event,
        serde_json::json!({
            "method": method,
            "path": path,
            "status": status,
            "remote_addr": remote_addr_text
        }),
    );
}

async fn read_http_request(stream: &mut tokio::net::TcpStream) -> anyhow::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    let mut chunk = vec![0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if header_end.is_none() {
            header_end = find_header_end(&buffer);
            if let Some(end) = header_end {
                content_length = content_length_from_headers(&buffer[..end]).unwrap_or(0);
            }
        }
        if let Some(end) = header_end {
            if buffer.len() >= end + 4 + content_length {
                break;
            }
        }
        if buffer.len() > 32 * 1024 * 1024 {
            anyhow::bail!("HTTP 请求过大");
        }
    }

    Ok(buffer)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn content_length_from_headers(headers: &[u8]) -> Option<usize> {
    let text = String::from_utf8_lossy(headers);
    text.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("content-length") {
            value.trim().parse().ok()
        } else {
            None
        }
    })
}

fn http_request_body(request: &str) -> &str {
    request
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default()
}

fn sanitize_diagnostic_event(event: &str) -> String {
    let sanitized = event
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "event".to_string()
    } else {
        sanitized
    }
}

pub fn build_codex_arguments(debug_port: u16, extra_args: &[String]) -> Vec<String> {
    let mut args = vec![
        format!("--remote-debugging-port={debug_port}"),
        format!("--remote-allow-origins=http://127.0.0.1:{debug_port}"),
    ];
    args.extend(normalize_codex_extra_args(extra_args));
    args
}

pub fn build_codex_command(app_dir: &Path, debug_port: u16, extra_args: &[String]) -> Vec<String> {
    let mut command = vec![
        crate::app_paths::build_codex_executable(app_dir)
            .to_string_lossy()
            .to_string(),
    ];
    command.extend(build_codex_arguments(debug_port, extra_args));
    command
}

pub fn build_packaged_activation(
    app_dir: &Path,
    debug_port: u16,
    extra_args: &[String],
) -> Option<CodexLaunch> {
    Some(CodexLaunch::PackagedActivation {
        app_user_model_id: crate::app_paths::packaged_app_user_model_id(app_dir)?,
        arguments: command_line_arguments(&build_codex_arguments(debug_port, extra_args)),
        process_id: None,
    })
}

async fn retry_injection(debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
    let mut last_error = None;
    for _ in 0..20 {
        match try_inject(debug_port, helper_port).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Codex injection failed")))
}

pub async fn check_and_reinject_bridge(debug_port: u16, helper_port: u16) -> bool {
    let healthy = match bridge_health_ok(debug_port).await {
        Ok(healthy) => healthy,
        Err(error) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "bridge.health_check_failed",
                serde_json::json!({
                    "debug_port": debug_port,
                    "helper_port": helper_port,
                    "message": error.to_string()
                }),
            );
            false
        }
    };
    if healthy {
        return false;
    }

    let _ = crate::diagnostic_log::append_diagnostic_log(
        "bridge.reinject_start",
        serde_json::json!({
            "debug_port": debug_port,
            "helper_port": helper_port
        }),
    );
    match retry_injection(debug_port, helper_port).await {
        Ok(()) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "bridge.reinject_ok",
                serde_json::json!({
                    "debug_port": debug_port,
                    "helper_port": helper_port
                }),
            );
            true
        }
        Err(error) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "bridge.reinject_failed",
                serde_json::json!({
                    "debug_port": debug_port,
                    "helper_port": helper_port,
                    "message": error.to_string()
                }),
            );
            false
        }
    }
}

async fn bridge_health_ok(debug_port: u16) -> anyhow::Result<bool> {
    let targets = crate::cdp::list_targets(debug_port).await?;
    let target = crate::cdp::pick_page_target(&targets)?;
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("selected CDP target has no websocket URL"))?;
    let result = crate::bridge::evaluate_script_with_await_promise(
        websocket_url,
        crate::bridge::bridge_health_check_script(),
        true,
    )
    .await?;
    Ok(runtime_evaluate_result_is_true(&result))
}

fn runtime_evaluate_result_is_true(result: &Value) -> bool {
    result
        .get("result")
        .and_then(|result| result.get("result"))
        .and_then(|result| result.get("value"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

async fn try_inject(debug_port: u16, helper_port: u16) -> anyhow::Result<()> {
    let targets = crate::cdp::list_targets(debug_port).await?;
    let target = crate::cdp::pick_page_target(&targets)?;
    let websocket_url = target
        .web_socket_debugger_url
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("selected CDP target has no websocket URL"))?;
    let script = crate::assets::injection_script(helper_port);
    let ctx = crate::routes::BridgeContext::core(Arc::new(crate::routes::CoreRuntimeService::new(
        debug_port,
        StatusStore::default(),
    )));
    crate::bridge::install_bridge(
        websocket_url,
        crate::bridge::BRIDGE_BINDING_NAME,
        Arc::new(move |path, payload| {
            let ctx = ctx.clone();
            Box::pin(
                async move { Ok(crate::routes::handle_bridge_request(ctx, &path, payload).await) },
            )
        }),
        &[script],
    )
    .await
}

pub fn build_macos_open_command(
    app_dir: &Path,
    debug_port: u16,
    extra_args: &[String],
) -> Vec<String> {
    let mut command = vec![
        "open".to_string(),
        "-W".to_string(),
        "-a".to_string(),
        app_dir.to_string_lossy().to_string(),
        "--args".to_string(),
    ];
    command.extend(build_codex_arguments(debug_port, extra_args));
    command
}

pub fn build_macos_cleanup_command(
    app_dir: &Path,
    policy: MacosCleanupPolicy,
) -> Option<Vec<String>> {
    if policy == MacosCleanupPolicy::SkipQuitBecauseAlreadyRunning {
        return None;
    }
    let app_name = app_dir
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Codex");
    Some(vec![
        "osascript".to_string(),
        "-e".to_string(),
        format!(
            r#"tell application "{}" to quit"#,
            app_name.replace('"', "\\\"")
        ),
    ])
}

async fn run_macos_cleanup_command(
    app_dir: &Path,
    policy: MacosCleanupPolicy,
) -> anyhow::Result<()> {
    let Some(command) = build_macos_cleanup_command(app_dir, policy) else {
        return Ok(());
    };
    let Some(executable) = command.first() else {
        return Ok(());
    };
    let _ = Command::new(executable)
        .args(&command[1..])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .with_context(|| format!("failed to request macOS app quit for {}", app_dir.display()))?;
    Ok(())
}

fn macos_app_dir_from_open_command(command: &[String]) -> Option<PathBuf> {
    let app_index = command.iter().position(|part| part == "-a")?;
    command.get(app_index + 1).map(PathBuf::from)
}

async fn is_macos_app_running(app_dir: &Path) -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let app_name = app_dir
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Codex");
    let script = format!(
        r#"application "{}" is running"#,
        app_name.replace('"', "\\\"")
    );
    let Ok(output) = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    else {
        return false;
    };
    output.status.success()
        && String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true")
}

#[cfg(windows)]
async fn wait_for_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || wait_for_windows_process_id_blocking(process_id))
        .await
        .context("Windows process wait task failed")?
}

#[cfg(windows)]
async fn terminate_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || terminate_windows_process_id_blocking(process_id))
        .await
        .context("Windows process termination task failed")?
}

#[cfg(windows)]
fn wait_for_windows_process_id_blocking(process_id: u32) -> anyhow::Result<()> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_FAILED};
    use windows::Win32::System::Threading::{
        INFINITE, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        WaitForSingleObject,
    };

    unsafe {
        let handle = OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            process_id,
        )
        .with_context(|| format!("failed to open Windows process id {process_id}"))?;
        let wait_result = WaitForSingleObject(handle, INFINITE);
        let _ = CloseHandle(handle);
        if wait_result == WAIT_FAILED {
            anyhow::bail!("failed to wait for Windows process id {process_id}");
        }
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_windows_process_id_blocking(process_id: u32) -> anyhow::Result<()> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, TerminateProcess,
    };

    unsafe {
        let handle = OpenProcess(
            PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            process_id,
        )
        .with_context(|| format!("failed to open Windows process id {process_id}"))?;
        let terminate_result = TerminateProcess(handle, 1);
        let _ = CloseHandle(handle);
        terminate_result
            .with_context(|| format!("failed to terminate Windows process id {process_id}"))?;
    }
    Ok(())
}

#[cfg(not(windows))]
async fn wait_for_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    anyhow::bail!("cannot wait for Windows process id {process_id} on this platform")
}

#[cfg(not(windows))]
async fn terminate_windows_process_id(process_id: u32) -> anyhow::Result<()> {
    anyhow::bail!("cannot terminate Windows process id {process_id} on this platform")
}

fn launch_status(
    status: &str,
    message: &str,
    debug_port: u16,
    helper_port: u16,
    app_dir: &Path,
) -> LaunchStatus {
    LaunchStatus {
        status: status.to_string(),
        message: message.to_string(),
        started_at_ms: now_ms(),
        debug_port: Some(debug_port),
        helper_port: Some(helper_port),
        codex_app: Some(app_dir.to_string_lossy().to_string()),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn command_line_arguments(args: &[String]) -> String {
    args.iter()
        .map(|arg| quote_windows_argument(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_windows_argument(arg: &str) -> String {
    if !arg.is_empty() && !arg.bytes().any(|byte| matches!(byte, b' ' | b'\t' | b'"')) {
        return arg.to_string();
    }
    let mut output = String::from("\"");
    let mut backslashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                output.push_str(&"\\".repeat(backslashes * 2 + 1));
                output.push('"');
                backslashes = 0;
            }
            _ => {
                output.push_str(&"\\".repeat(backslashes));
                output.push(ch);
                backslashes = 0;
            }
        }
    }
    output.push_str(&"\\".repeat(backslashes * 2));
    output.push('"');
    output
}

#[cfg(not(windows))]
pub async fn activate_packaged_app(
    _app_user_model_id: &str,
    _arguments: &str,
) -> anyhow::Result<u32> {
    anyhow::bail!("Packaged app activation is only supported on Windows")
}

#[cfg(windows)]
pub async fn activate_packaged_app(
    app_user_model_id: &str,
    arguments: &str,
) -> anyhow::Result<u32> {
    let app_user_model_id = app_user_model_id.to_string();
    let arguments = arguments.to_string();
    tokio::task::spawn_blocking(move || {
        activate_packaged_app_blocking(&app_user_model_id, &arguments)
    })
    .await
    .context("packaged app activation task failed")?
}

#[cfg(windows)]
fn activate_packaged_app_blocking(app_user_model_id: &str, arguments: &str) -> anyhow::Result<u32> {
    use windows::Win32::System::Com::{
        CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
        CoUninitialize,
    };
    use windows::Win32::UI::Shell::{ApplicationActivationManager, IApplicationActivationManager};
    use windows::core::HSTRING;

    unsafe {
        let coinit = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninitialize = coinit.is_ok();
        coinit.ok().or_else(|error| {
            const RPC_E_CHANGED_MODE: i32 = -2147417850;
            if error.code().0 == RPC_E_CHANGED_MODE {
                Ok(())
            } else {
                Err(error)
            }
        })?;

        let result: windows::core::Result<u32> = (|| {
            let manager: IApplicationActivationManager =
                CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)?;
            let process_id = manager.ActivateApplication(
                &HSTRING::from(app_user_model_id),
                &HSTRING::from(arguments),
                windows::Win32::UI::Shell::ACTIVATEOPTIONS(0),
            )?;
            Ok(process_id)
        })();

        if should_uninitialize {
            CoUninitialize();
        }
        result.map_err(Into::into)
    }
}
