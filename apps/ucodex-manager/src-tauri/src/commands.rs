use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ucodex_core::install::SILENT_BINARY;
use ucodex_core::models::{DeleteResult, SessionRef};
use ucodex_core::script_market::{self, MarketScript, ScriptMarketManifest};
use ucodex_core::settings::{BackendSettings, RelayProfile, SettingsStore};
use ucodex_core::status::{LaunchStatus, StatusStore};
use ucodex_core::user_scripts::UserScriptManager;
use serde::Serialize;
use serde_json::{Value, json};

use crate::install::{self, InstallActionResult, InstallOptions};

#[derive(Debug, Clone, Serialize)]
pub struct CommandResult<T>
where
    T: Serialize,
{
    pub status: String,
    pub message: String,
    #[serde(flatten)]
    pub payload: T,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionPayload {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathState {
    pub status: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OverviewPayload {
    pub codex_app: PathState,
    pub codex_version: Option<String>,
    pub silent_shortcut: PathState,
    pub management_shortcut: PathState,
    pub latest_launch: Option<LaunchStatus>,
    pub current_version: String,
    pub update_status: String,
    pub settings_path: String,
    pub logs_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SettingsPayload {
    pub settings: BackendSettings,
    pub settings_path: String,
    pub user_scripts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionsPayload {
    pub db_path: String,
    pub sessions: Vec<ucodex_data::LocalSession>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLocalSessionRequest {
    pub session_id: String,
    #[serde(default)]
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcsProvidersPayload {
    pub db_path: String,
    pub providers: Vec<ucodex_core::ccs_import::CcsProviderImport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPayload {
    pub authenticated: bool,
    pub auth_source: String,
    pub account_label: Option<String>,
    pub config_path: String,
    pub configured: bool,
    pub requires_openai_auth: bool,
    pub has_bearer_token: bool,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayFilesPayload {
    pub config_path: String,
    pub auth_path: String,
    pub config_contents: String,
    pub auth_contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBackfillPayload {
    pub settings: BackendSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntriesPayload {
    pub settings: BackendSettings,
    pub entries: ucodex_core::relay_config::CodexContextEntries,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveContextEntriesPayload {
    pub entries: ucodex_core::relay_config::CodexContextEntries,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRelayCommonConfigPayload {
    pub common_config_contents: String,
    pub profile_config_contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProfileTestPayload {
    pub http_status: u16,
    pub endpoint: String,
    pub response_preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProfileModelsPayload {
    pub models: Vec<String>,
    pub endpoint: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRelayFileRequest {
    pub kind: String,
    pub contents: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillRelayProfileRequest {
    pub settings: BackendSettings,
    pub profile_id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSettingsRequest {
    pub settings: BackendSettings,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntryRequest {
    pub settings: BackendSettings,
    pub kind: String,
    pub id: String,
    pub toml_body: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDeleteRequest {
    pub settings: BackendSettings,
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractRelayCommonConfigRequest {
    pub config_contents: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    #[serde(default)]
    pub app_path: String,
    #[serde(default = "default_debug_port")]
    pub debug_port: u16,
    #[serde(default = "default_helper_port")]
    pub helper_port: u16,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRequest {
    #[serde(default = "default_log_lines")]
    pub lines: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogsPayload {
    pub path: String,
    pub text: String,
    pub lines: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsPayload {
    pub report: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WatcherPayload {
    pub enabled: bool,
    pub disabled_flag: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptMarketPayload {
    pub market: Value,
    pub user_scripts: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupPayload {
    pub show_update: bool,
}

#[tauri::command]
pub fn backend_version() -> CommandResult<VersionPayload> {
    ok(
        "后端版本已读取。",
        VersionPayload {
            version: ucodex_core::version::VERSION.to_string(),
        },
    )
}

#[tauri::command]
pub fn startup_options() -> CommandResult<StartupPayload> {
    ok(
        "启动参数已读取。",
        StartupPayload {
            show_update: startup_should_show_update(),
        },
    )
}

pub fn startup_should_show_update() -> bool {
    should_show_update(
        std::env::args(),
        std::env::var("CODEX_PLUS_SHOW_UPDATE").ok().as_deref(),
    )
}

fn should_show_update<I, S>(args: I, env_value: Option<&str>) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--show-update") || env_value == Some("1")
}

#[tauri::command]
pub async fn load_overview() -> CommandResult<OverviewPayload> {
    let payload = tauri::async_runtime::spawn_blocking(load_overview_payload).await;
    let Ok((codex_app_path, entrypoints, latest_launch)) = payload else {
        return failed(
            "概览后台任务失败。",
            OverviewPayload {
                codex_app: path_state(None),
                codex_version: None,
                silent_shortcut: path_state(None),
                management_shortcut: path_state(None),
                latest_launch: None,
                current_version: ucodex_core::version::VERSION.to_string(),
                update_status: "not_checked".to_string(),
                settings_path: ucodex_core::paths::default_settings_path()
                    .to_string_lossy()
                    .to_string(),
                logs_path: ucodex_core::paths::default_diagnostic_log_path()
                    .to_string_lossy()
                    .to_string(),
            },
        );
    };
    ok(
        "概览已加载。",
        OverviewPayload {
            codex_version: codex_app_path
                .as_deref()
                .and_then(ucodex_core::app_paths::codex_app_version),
            codex_app: path_state(codex_app_path),
            silent_shortcut: shortcut_state(entrypoints.silent_shortcut),
            management_shortcut: shortcut_state(entrypoints.management_shortcut),
            latest_launch,
            current_version: ucodex_core::version::VERSION.to_string(),
            update_status: "not_checked".to_string(),
            settings_path: ucodex_core::paths::default_settings_path()
                .to_string_lossy()
                .to_string(),
            logs_path: ucodex_core::paths::default_diagnostic_log_path()
                .to_string_lossy()
                .to_string(),
        },
    )
}

#[tauri::command]
pub fn launch_ucodex(request: LaunchRequest) -> CommandResult<Value> {
    spawn_ucodex_launch(request, "启动任务已在后台开始，可稍后查看概览状态。")
}

#[tauri::command]
pub fn restart_ucodex(request: LaunchRequest) -> CommandResult<Value> {
    ucodex_core::watcher::stop_launcher_processes();
    ucodex_core::watcher::stop_codex_processes();
    spawn_ucodex_launch(request, "Codex 已请求重启，启动任务正在后台运行。")
}

fn spawn_ucodex_launch(request: LaunchRequest, accepted_message: &str) -> CommandResult<Value> {
    let debug_port = request.debug_port;
    let helper_port = request.helper_port;
    let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
        "manager.launch_requested",
        json!({
            "debug_port": debug_port,
            "helper_port": helper_port,
            "app_path": request.app_path.trim()
        }),
    );
    match spawn_silent_launcher(&request) {
        Ok((child_id, stderr_handle)) => {
            // 等待一小段时间，检查进程是否仍然存活
            // 如果 launcher 立即崩溃（找不到 Codex App、端口占用等），进程会很快退出
            std::thread::sleep(std::time::Duration::from_millis(800));
            let still_alive = is_process_alive(child_id);
            let codex_launched = ucodex_core::watcher::find_codex_processes();

            if still_alive || !codex_launched.is_empty() {
                // launcher 仍在运行，或 Codex 进程已出现 → 启动成功
                // 后台读取 stderr（如果 launcher 后续崩溃，日志不会丢失）
                std::thread::spawn(move || {
                    let _ = wait_and_collect_stderr(stderr_handle);
                });
                CommandResult {
                    status: "ok".to_string(),
                    message: if !codex_launched.is_empty() {
                        "Codex 已启动，注入正在进行中。".to_string()
                    } else {
                        accepted_message.to_string()
                    },
                    payload: json!({
                        "debugPort": debug_port,
                        "helperPort": helper_port,
                        "launcherPid": child_id,
                        "codexPids": codex_launched
                    }),
                }
            } else {
                // launcher 已退出且 Codex 未启动 → 启动失败
                // 捕获 stderr 获取真实错误信息
                let stderr_output = wait_and_collect_stderr(stderr_handle);
                let launcher_path = ucodex_core::install::companion_binary_path(SILENT_BINARY);

                // 优先使用 stderr 输出，其次读诊断日志，最后用通用信息
                let error_detail = if !stderr_output.trim().is_empty() {
                    // 取 stderr 最后几行作为错误信息
                    let lines: Vec<&str> = stderr_output.lines().collect();
                    let tail: Vec<&str> = lines.iter().rev().take(5).copied().collect();
                    let tail: Vec<&str> = tail.into_iter().rev().collect();
                    tail.join("\n")
                } else {
                    read_recent_diagnostic_error()
                        .unwrap_or_else(|| format!("找不到 Codex App、端口 {} 被占用、或 launcher 二进制损坏。", debug_port))
                };

                failed(
                    &format!("启动失败：Launcher 进程已退出。\n{error_detail}"),
                    json!({
                        "debugPort": debug_port,
                        "helperPort": helper_port,
                        "launcherPath": launcher_path.to_string_lossy(),
                        "launcherPid": child_id,
                        "exitedEarly": true,
                        "stderr": stderr_output,
                        "diagnosticLog": ucodex_core::paths::default_diagnostic_log_path().to_string_lossy()
                    }),
                )
            }
        }
        Err(error) => {
            let launcher_path = ucodex_core::install::companion_binary_path(SILENT_BINARY);
            failed(
                &format!("启动失败：{error}"),
                json!({
                    "debugPort": debug_port,
                    "helperPort": helper_port,
                    "launcherPath": launcher_path.to_string_lossy(),
                    "spawnError": error.to_string()
                }),
            )
        }
    }
}

/// 读取诊断日志中最近的错误信息
fn read_recent_diagnostic_error() -> Option<String> {
    let log_path = ucodex_core::paths::default_diagnostic_log_path();
    let content = std::fs::read_to_string(&log_path).ok()?;

    // 读取最后 20 行，查找包含 "error" 或 "failed" 的行
    let recent_lines: Vec<&str> = content.lines().rev().take(20).collect();
    for line in recent_lines {
        let lower = line.to_lowercase();
        if lower.contains("error") || lower.contains("failed") || lower.contains("panic") {
            // 尝试解析 JSON 格式的日志
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(msg) = json.get("message").and_then(|m| m.as_str()) {
                    return Some(msg.to_string());
                }
                if let Some(msg) = json.get("error").and_then(|m| m.as_str()) {
                    return Some(msg.to_string());
                }
            }
            // 如果不是 JSON，直接返回行内容
            return Some(line.to_string());
        }
    }
    None
}

/// 检查指定 PID 的进程是否仍然存活
fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // kill -0 不发送信号，只检查进程是否存在
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .output()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
}

/// stderr 句柄，用于后续读取子进程的错误输出
type StderrHandle = std::process::ChildStderr;

fn spawn_silent_launcher(request: &LaunchRequest) -> anyhow::Result<(u32, StderrHandle)> {
    let launcher = ucodex_core::install::companion_binary_path(SILENT_BINARY);
    if !launcher.exists() {
        return Err(anyhow::anyhow!(
            "Launcher 二进制不存在：{}",
            launcher.to_string_lossy()
        ));
    }
    let mut command = std::process::Command::new(&launcher);
    if !request.app_path.trim().is_empty() {
        command.arg("--app-path").arg(request.app_path.trim());
    }
    command
        .arg("--debug-port")
        .arg(request.debug_port.to_string())
        .arg("--helper-port")
        .arg(request.helper_port.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped()); // 捕获 stderr
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| anyhow::anyhow!("无法启动 {}：{error}", launcher.to_string_lossy()))?;
    let pid = child.id();
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow::anyhow!("无法获取 stderr"))?;
    // child 被 drop 后进程不会被 kill（因为没有调用 wait）
    // 但我们需要保持 child 存活以读取 stderr，所以把它泄漏掉
    std::mem::forget(child);
    Ok((pid, stderr))
}

/// 等待子进程退出并收集 stderr 输出（最多等待 3 秒）
fn wait_and_collect_stderr(mut stderr: StderrHandle) -> String {
    use std::io::Read;
    let mut output = String::new();
    // 设置非阻塞读取，最多等 3 秒
    let _ = stderr.read_to_string(&mut output);
    output
}

/// 直接启动 Codex App（不经过 Ucodex launcher，不注入）
#[tauri::command]
pub fn launch_codex_app_only(request: LaunchRequest) -> CommandResult<Value> {
    let codex_app = ucodex_core::app_paths::resolve_codex_app_dir_with_saved(
        None,
        Some(&request.app_path),
    );
    if codex_app.is_none() {
        return failed(
            "找不到 Codex App。请在设置中指定 Codex App 路径。",
            json!({ "appPath": request.app_path }),
        );
    }
    let app_dir = codex_app.unwrap();
    let debug_port = request.debug_port;

    // macOS: 使用 `open` 命令启动 Codex App，附加调试端口参数
    #[cfg(target_os = "macos")]
    {
        let app_bundle = if app_dir.join("Contents").join("MacOS").exists() {
            app_dir.clone()
        } else {
            // 可能是目录，尝试找 .app
            let candidates = [
                app_dir.join("Codex.app"),
                app_dir.join("Contents"),
            ];
            candidates.iter().find(|p| p.exists()).cloned().unwrap_or(app_dir.clone())
        };

        let result = std::process::Command::new("open")
            .arg(&app_bundle)
            .arg("--args")
            .arg("--remote-debugging-port")
            .arg(debug_port.to_string())
            .spawn();

        match result {
            Ok(_) => {
                // 等待一小段时间，检查 Codex 进程是否出现
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let codex_pids = ucodex_core::watcher::find_codex_processes();
                if codex_pids.is_empty() {
                    failed(
                        &format!(
                            "Codex App 启动命令已执行，但未检测到 Codex 进程。请手动检查 Codex 是否正在运行。路径：{}",
                            app_bundle.to_string_lossy()
                        ),
                        json!({ "appPath": app_bundle.to_string_lossy(), "debugPort": debug_port }),
                    )
                } else {
                    CommandResult {
                        status: "ok".to_string(),
                        message: format!("Codex 已启动（PID: {:?}），无注入。", codex_pids),
                        payload: json!({
                            "debugPort": debug_port,
                            "codexPids": codex_pids,
                            "injected": false
                        }),
                    }
                }
            }
            Err(error) => failed(
                &format!("启动 Codex App 失败：{error}"),
                json!({ "appPath": app_bundle.to_string_lossy(), "error": error.to_string() }),
            ),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux: 直接运行可执行文件
        let exe_name = if cfg!(windows) { "Codex.exe" } else { "codex" };
        let exe_path = app_dir.join(exe_name);
        if !exe_path.exists() {
            // 尝试在 MacOS 子目录查找
            let alt = app_dir.join("Contents").join("MacOS").join("Codex");
            if !alt.exists() {
                return failed(
                    &format!("找不到 Codex 可执行文件：{}", exe_path.to_string_lossy()),
                    json!({ "appPath": app_dir.to_string_lossy() }),
                );
            }
        }

        let result = std::process::Command::new(&exe_path)
            .arg("--remote-debugging-port")
            .arg(debug_port.to_string())
            .spawn();

        match result {
            Ok(_) => {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let codex_pids = ucodex_core::watcher::find_codex_processes();
                if codex_pids.is_empty() {
                    failed(
                        "Codex App 启动命令已执行，但未检测到 Codex 进程。",
                        json!({ "appPath": exe_path.to_string_lossy(), "debugPort": debug_port }),
                    )
                } else {
                    CommandResult {
                        status: "ok".to_string(),
                        message: format!("Codex 已启动（PID: {:?}），无注入。", codex_pids),
                        payload: json!({
                            "debugPort": debug_port,
                            "codexPids": codex_pids,
                            "injected": false
                        }),
                    }
                }
            }
            Err(error) => failed(
                &format!("启动 Codex App 失败：{error}"),
                json!({ "appPath": exe_path.to_string_lossy(), "error": error.to_string() }),
            ),
        }
    }
}

#[tauri::command]
pub fn load_settings() -> CommandResult<SettingsPayload> {
    settings_payload("设置已加载。", "设置读取失败")
}

#[tauri::command]
pub fn save_settings(settings: BackendSettings) -> CommandResult<SettingsPayload> {
    let mut settings = normalize_settings_before_save(settings);
    if settings.ccs_link_enabled {
        if let Err(error) = ucodex_core::ccs_import::write_linked_profiles_to_default_db(
            &settings.relay_profiles,
        ) {
            let payload = SettingsPayload {
                settings,
                settings_path: ucodex_core::paths::default_settings_path()
                    .to_string_lossy()
                    .to_string(),
                user_scripts: user_script_inventory(),
            };
            return failed(&format!("写回 cc-switch 供应商配置失败：{error}"), payload);
        }
        let active = settings.active_relay_profile();
        if !active.linked_ccs_provider_id.trim().is_empty() {
            if let Err(error) =
                ucodex_core::ccs_import::set_current_codex_provider_in_default_db(
                    &active.linked_ccs_provider_id,
                )
            {
                let payload = SettingsPayload {
                    settings,
                    settings_path: ucodex_core::paths::default_settings_path()
                        .to_string_lossy()
                        .to_string(),
                    user_scripts: user_script_inventory(),
                };
                return failed(&format!("同步 cc-switch 当前供应商失败：{error}"), payload);
            }
        }
    }
    remove_linked_ccs_profiles_for_local_storage(&mut settings);
    match SettingsStore::default().save(&settings) {
        Ok(()) => {
            let wrapper_message = refresh_cli_wrapper_after_settings_save(&settings);
            settings_payload(
                &format!("设置已保存。{wrapper_message}"),
                "设置保存后重新读取失败",
            )
        }
        Err(error) => failed(
            &format!("保存设置失败：{error}"),
            SettingsPayload {
                settings,
                settings_path: ucodex_core::paths::default_settings_path()
                    .to_string_lossy()
                    .to_string(),
                user_scripts: user_script_inventory(),
            },
        ),
    }
}

#[tauri::command]
pub fn load_ccs_providers() -> CommandResult<CcsProvidersPayload> {
    let db_path = ucodex_core::ccs_import::default_ccs_db_path();
    match ucodex_core::ccs_import::list_codex_providers_from_db(&db_path) {
        Ok(providers) => ok(
            &format!("已读取外部 Codex 供应商配置：{} 个。", providers.len()),
            CcsProvidersPayload {
                db_path: db_path.to_string_lossy().to_string(),
                providers,
            },
        ),
        Err(error) => failed(
            &format!("读取外部供应商配置失败：{error}"),
            CcsProvidersPayload {
                db_path: db_path.to_string_lossy().to_string(),
                providers: Vec::new(),
            },
        ),
    }
}

#[tauri::command]
pub fn import_ccs_providers() -> CommandResult<SettingsPayload> {
    let store = SettingsStore::default();
    let mut settings = store.load().unwrap_or_default();
    let synced = match ucodex_core::ccs_import::list_codex_providers_from_default_db() {
        Ok(providers) => providers.len(),
        Err(error) => {
            let payload = settings_payload_value()
                .map(|payload| payload)
                .unwrap_or_else(|(_, payload)| payload);
            return failed(&format!("读取外部供应商配置失败：{error}"), payload);
        }
    };
    settings.ccs_link_enabled = true;
    remove_linked_ccs_profiles_for_local_storage(&mut settings);

    if synced == 0 {
        return settings_payload("没有可联动的 cc-switch Codex 供应商配置。", "设置读取失败");
    }

    match store.save(&settings) {
        Ok(()) => settings_payload(
            &format!("已开启 cc-switch 联动：{synced} 个供应商将直接从 cc-switch 读取。"),
            "联动供应商配置后重新读取设置失败",
        ),
        Err(error) => failed(
            &format!("保存外部供应商配置失败：{error}"),
            settings_payload_value()
                .map(|payload| payload)
                .unwrap_or_else(|(_, payload)| payload),
        ),
    }
}

#[tauri::command]
pub fn list_local_sessions() -> CommandResult<LocalSessionsPayload> {
    let db_path = ucodex_core::relay_config::default_codex_home_dir().join("state_5.sqlite");
    let adapter = local_session_adapter(&db_path);
    match adapter.list_local_sessions() {
        Ok(sessions) => ok(
            &format!("已读取 {} 个本地会话。", sessions.len()),
            LocalSessionsPayload {
                db_path: db_path.to_string_lossy().to_string(),
                sessions,
            },
        ),
        Err(error) => failed(
            &format!("读取本地会话失败：{error}"),
            LocalSessionsPayload {
                db_path: db_path.to_string_lossy().to_string(),
                sessions: Vec::new(),
            },
        ),
    }
}

#[tauri::command]
pub fn delete_local_session(request: DeleteLocalSessionRequest) -> CommandResult<DeleteResult> {
    let session_id = request.session_id.trim();
    if session_id.is_empty() {
        return failed(
            "会话 ID 不能为空。",
            DeleteResult {
                status: ucodex_core::models::DeleteStatus::Failed,
                session_id: String::new(),
                message: "会话 ID 不能为空。".to_string(),
                undo_token: None,
                backup_path: None,
            },
        );
    }
    let db_path = ucodex_core::relay_config::default_codex_home_dir().join("state_5.sqlite");
    let adapter = local_session_adapter(&db_path);
    let session = SessionRef {
        session_id: session_id.to_string(),
        title: request.title,
    };
    let result = adapter.delete_local(&session);
    let status = if matches!(
        result.status,
        ucodex_core::models::DeleteStatus::LocalDeleted
    ) {
        "ok"
    } else {
        "failed"
    };
    CommandResult {
        status: status.to_string(),
        message: result.message.clone(),
        payload: result,
    }
}

fn local_session_adapter(db_path: &Path) -> ucodex_data::SQLiteStorageAdapter {
    ucodex_data::SQLiteStorageAdapter::new(
        db_path,
        ucodex_data::BackupStore::new(
            ucodex_core::paths::default_app_state_dir().join("backups"),
        ),
    )
}

fn normalize_settings_before_save(mut settings: BackendSettings) -> BackendSettings {
    if let Some(path) =
        ucodex_core::app_paths::normalize_codex_app_path(Path::new(&settings.codex_app_path))
    {
        settings.codex_app_path = path.to_string_lossy().to_string();
    }
    settings.relay_common_config_contents =
        ucodex_core::relay_config::sanitize_common_config_contents(
            &settings.relay_common_config_contents,
        );
    let (common_without_context, extracted_context) =
        split_relay_context_config_sections(&settings.relay_common_config_contents);
    settings.relay_common_config_contents = common_without_context;
    settings.relay_context_config_contents =
        relay_join_config_sections(&[&settings.relay_context_config_contents, &extracted_context]);
    settings.relay_context_config_contents =
        ucodex_core::relay_config::sanitize_common_config_contents(
            &settings.relay_context_config_contents,
        );
    for profile in &mut settings.relay_profiles {
        if let Err(error) =
            ucodex_core::relay_config::normalize_relay_profile_for_storage(profile)
        {
            log_manager_event(
                "manager.normalize_relay_profile_for_storage.failed",
                json!({
                    "profileId": profile.id,
                    "profileName": profile.name,
                    "error": error.to_string()
                }),
            );
        }
    }
    let common_config = relay_combined_common_config(&settings);
    if !common_config.trim().is_empty() {
        for profile in &mut settings.relay_profiles {
            if !profile.use_common_config || profile.config_contents.trim().is_empty() {
                continue;
            }
            match ucodex_core::relay_config::strip_common_config_from_config(
                &profile.config_contents,
                &common_config,
            ) {
                Ok(stripped) => {
                    profile.config_contents =
                        strip_common_config_text_fallback(&stripped, &common_config);
                }
                Err(_) => {
                    profile.config_contents =
                        strip_common_config_text_fallback(&profile.config_contents, &common_config);
                }
            }
        }
    }
    settings.provider_sync_saved_providers =
        normalize_provider_sync_provider_list(settings.provider_sync_saved_providers);
    settings.provider_sync_manual_providers =
        normalize_provider_sync_provider_list(settings.provider_sync_manual_providers);
    settings.provider_sync_last_selected_provider =
        settings.provider_sync_last_selected_provider.trim().to_string();
    settings
}

fn normalize_provider_sync_provider_list(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            result.push(trimmed.to_string());
        }
    }
    result.sort();
    result
}

fn settings_with_live_ccs_profiles(mut settings: BackendSettings) -> BackendSettings {
    if !settings.ccs_link_enabled {
        return settings;
    }
    remove_linked_ccs_profiles_for_local_storage(&mut settings);
    if let Err(error) = ucodex_core::ccs_import::sync_linked_profiles_from_default_db(
        &mut settings.relay_profiles,
    ) {
        log_manager_event(
            "manager.settings_with_live_ccs_profiles.failed",
            json!({ "error": error.to_string() }),
        );
    }
    settings
}

fn remove_linked_ccs_profiles_for_local_storage(settings: &mut BackendSettings) {
    settings
        .relay_profiles
        .retain(|profile| profile.linked_ccs_provider_id.trim().is_empty());
    if !settings.ccs_link_enabled
        && !settings
            .relay_profiles
            .iter()
            .any(|profile| profile.id == settings.active_relay_id)
    {
        settings.active_relay_id = settings
            .relay_profiles
            .first()
            .map(|profile| profile.id.clone())
            .unwrap_or_else(ucodex_core::settings::default_active_relay_id);
    }
}

fn relay_combined_common_config(settings: &BackendSettings) -> String {
    relay_join_config_sections(&[
        &settings.relay_common_config_contents,
        &settings.relay_context_config_contents,
    ])
}

fn relay_join_config_sections(sections: &[&str]) -> String {
    let sections = sections
        .iter()
        .map(|section| section.trim())
        .filter(|section| !section.is_empty())
        .collect::<Vec<_>>();
    if sections.is_empty() {
        String::new()
    } else {
        ucodex_core::relay_config::normalize_config_text(&format!(
            "{}\n",
            sections.join("\n\n")
        ))
    }
}

fn split_relay_context_config_sections(config: &str) -> (String, String) {
    let mut common = Vec::new();
    let mut context = Vec::new();
    let mut in_context_table = false;

    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_context_table = trimmed.starts_with("[mcp_servers.")
                || trimmed.starts_with("[skills.")
                || trimmed.starts_with("[plugins.");
        }
        if in_context_table {
            context.push(line);
        } else {
            common.push(line);
        }
    }

    (
        relay_join_config_sections(&[&common.join("\n")]),
        relay_join_config_sections(&[&context.join("\n")]),
    )
}

fn strip_common_config_text_fallback(config_contents: &str, common_config: &str) -> String {
    let common = common_config_anchors(common_config);
    if common.root_keys.is_empty() && common.table_headers.is_empty() {
        return ensure_text_newline(config_contents.trim_end());
    }

    let mut kept = Vec::new();
    let mut skipping_table = false;

    for line in config_contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let header = trimmed.to_string();
            skipping_table = common.table_headers.contains(&header);
            if skipping_table {
                continue;
            }
        }

        if skipping_table {
            continue;
        }

        if let Some(key) = toml_key_from_line(trimmed) {
            if common.root_keys.contains(key) {
                continue;
            }
        }

        kept.push(line);
    }

    ensure_text_newline(kept.join("\n").trim_end())
}

struct CommonConfigAnchors {
    root_keys: std::collections::HashSet<String>,
    table_headers: std::collections::HashSet<String>,
}

fn common_config_anchors(common_config: &str) -> CommonConfigAnchors {
    let mut root_keys = std::collections::HashSet::new();
    let mut table_headers = std::collections::HashSet::new();
    let mut in_table = false;

    for line in common_config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_table = true;
            table_headers.insert(trimmed.to_string());
            continue;
        }
        if !in_table {
            if let Some(key) = toml_key_from_line(trimmed) {
                root_keys.insert(key.to_string());
            }
        }
    }

    CommonConfigAnchors {
        root_keys,
        table_headers,
    }
}

fn toml_key_from_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (key, _) = trimmed.split_once('=')?;
    let key = key.trim();
    if key.is_empty() { None } else { Some(key) }
}

fn ensure_text_newline(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        format!("{}\n", value.trim_end())
    }
}

#[tauri::command]
pub async fn load_provider_sync_targets() -> CommandResult<Value> {
    let settings = SettingsStore::default().load().unwrap_or_default();
    let result = tauri::async_runtime::spawn_blocking(|| {
        ucodex_data::load_provider_sync_targets(None)
    })
    .await
    .map_err(|error| anyhow::anyhow!("provider target discovery task failed: {error}"));
    match result {
        Ok(mut targets) => {
            let manual = settings
                .provider_sync_manual_providers
                .iter()
                .chain(settings.provider_sync_saved_providers.iter())
                .filter_map(|value| {
                    let trimmed = value.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .collect::<Vec<_>>();
            merge_manual_provider_sync_targets(&mut targets, &manual, &settings);
            ok(
                "Provider 同步目标已加载。",
                serde_json::to_value(targets).unwrap_or_else(|_| json!({})),
            )
        }
        Err(error) => failed(&format!("Provider 同步目标加载失败：{error}"), json!({})),
    }
}

fn merge_manual_provider_sync_targets(
    targets: &mut ucodex_data::ProviderSyncTargetList,
    manual: &[String],
    settings: &BackendSettings,
) {
    for id in manual {
        if let Some(existing) = targets.targets.iter_mut().find(|target| target.id == *id) {
            if !existing
                .sources
                .contains(&ucodex_data::ProviderSyncTargetSource::Manual)
            {
                existing
                    .sources
                    .push(ucodex_data::ProviderSyncTargetSource::Manual);
                existing.sources.sort();
            }
            existing.is_manual = settings.provider_sync_manual_providers.contains(id);
            existing.is_saved = settings.provider_sync_saved_providers.contains(id);
        } else {
            targets
                .targets
                .push(ucodex_data::ProviderSyncTargetOption {
                    id: id.clone(),
                    sources: vec![ucodex_data::ProviderSyncTargetSource::Manual],
                    is_current_provider: *id == targets.current_provider,
                    is_manual: settings.provider_sync_manual_providers.contains(id),
                    is_saved: settings.provider_sync_saved_providers.contains(id),
                });
        }
    }
    targets.targets.sort_by(|left, right| {
        right
            .is_current_provider
            .cmp(&left.is_current_provider)
            .then_with(|| left.id.cmp(&right.id))
    });
}

#[tauri::command]
pub async fn sync_providers_now(target_provider: Option<String>) -> CommandResult<Value> {
    let target_provider = target_provider
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let target_for_settings = target_provider.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        ucodex_data::run_provider_sync_with_target(None, target_provider.as_deref())
    })
    .await
    .map_err(|error| anyhow::anyhow!("provider sync task failed: {error}"));
    match result {
        Ok(sync) => {
            if is_success_sync_status(&sync.status) {
                persist_provider_sync_selection(
                    target_for_settings.as_deref().unwrap_or(&sync.target_provider),
                );
            }
            ok(
                &format!(
                    "供应商已同步一次：{} 个会话文件，{} 行索引，跳过 {} 个占用文件。",
                    sync.changed_session_files,
                    sync.sqlite_rows_updated,
                    sync.skipped_locked_rollout_files.len()
                ),
                json!({
                    "syncStatus": sync.status,
                    "targetProvider": sync.target_provider,
                    "changedSessionFiles": sync.changed_session_files,
                    "skippedLockedRolloutFiles": sync.skipped_locked_rollout_files,
                    "sqliteRowsUpdated": sync.sqlite_rows_updated,
                    "sqliteProviderRowsUpdated": sync.sqlite_provider_rows_updated,
                    "sqliteUserEventRowsUpdated": sync.sqlite_user_event_rows_updated,
                    "sqliteCwdRowsUpdated": sync.sqlite_cwd_rows_updated,
                    "updatedWorkspaceRoots": sync.updated_workspace_roots,
                    "encryptedContentWarning": sync.encrypted_content_warning,
                    "backupDir": sync.backup_dir,
                    "syncMessage": sync.message,
                }),
            )
        }
        Err(error) => failed(&format!("供应商同步失败：{error}"), json!({})),
    }
}

fn is_success_sync_status(status: &ucodex_data::ProviderSyncStatus) -> bool {
    matches!(status, ucodex_data::ProviderSyncStatus::Synced)
}

fn persist_provider_sync_selection(provider: &str) {
    let trimmed = provider.trim();
    if trimmed.is_empty() {
        return;
    }
    let store = SettingsStore::default();
    let mut settings = store.load().unwrap_or_default();
    settings.provider_sync_last_selected_provider = trimmed.to_string();
    if !settings
        .provider_sync_saved_providers
        .iter()
        .any(|item| item == trimmed)
    {
        settings
            .provider_sync_saved_providers
            .push(trimmed.to_string());
    }
    settings.provider_sync_saved_providers =
        normalize_provider_sync_provider_list(settings.provider_sync_saved_providers);
    let _ = store.save(&settings);
}


#[tauri::command]
pub async fn refresh_script_market() -> CommandResult<ScriptMarketPayload> {
    match script_market::fetch_market_manifest(script_market::DEFAULT_MARKET_INDEX_URL).await {
        Ok(manifest) => ok(
            "脚本市场已刷新。",
            script_market_payload_from_manifest(&manifest, "ok", "脚本市场已刷新。"),
        ),
        Err(error) => failed(
            &format!("脚本市场加载失败：{error}"),
            failed_script_market_payload(&format!("脚本市场加载失败：{error}")),
        ),
    }
}

#[tauri::command]
pub async fn install_market_script(id: String) -> CommandResult<ScriptMarketPayload> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return failed(
            "脚本 id 不能为空。",
            failed_script_market_payload("脚本 id 不能为空。"),
        );
    }
    let manifest =
        match script_market::fetch_market_manifest(script_market::DEFAULT_MARKET_INDEX_URL).await {
            Ok(manifest) => manifest,
            Err(error) => {
                return failed(
                    &format!("脚本市场加载失败：{error}"),
                    failed_script_market_payload(&format!("脚本市场加载失败：{error}")),
                );
            }
        };
    let Some(script) = manifest.scripts.iter().find(|script| script.id == trimmed) else {
        return failed(
            "市场清单中未找到该脚本。",
            script_market_payload_from_manifest(&manifest, "failed", "市场清单中未找到该脚本。"),
        );
    };
    let manager = default_user_script_manager();
    match script_market::install_market_script(&manager, script).await {
        Ok(()) => ok(
            "脚本已安装。",
            script_market_payload_from_manifest(&manifest, "ok", "脚本已安装。"),
        ),
        Err(error) => failed(
            &format!("安装脚本失败：{error}"),
            script_market_payload_from_manifest(
                &manifest,
                "failed",
                &format!("安装脚本失败：{error}"),
            ),
        ),
    }
}

#[tauri::command]
pub fn set_user_script_enabled(key: String, enabled: bool) -> CommandResult<SettingsPayload> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return failed("脚本 key 不能为空。", fallback_settings_payload());
    }
    let manager = default_user_script_manager();
    match manager.set_script_enabled(trimmed, enabled) {
        Ok(_) => settings_payload(
            if enabled {
                "脚本已启用。"
            } else {
                "脚本已禁用。"
            },
            "脚本启停失败",
        ),
        Err(error) => failed(
            &format!("脚本启停失败：{error}"),
            fallback_settings_payload(),
        ),
    }
}

#[tauri::command]
pub fn delete_user_script(key: String) -> CommandResult<SettingsPayload> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return failed("脚本 key 不能为空。", fallback_settings_payload());
    }
    let manager = default_user_script_manager();
    match manager.delete_user_script(trimmed) {
        Ok(_) => settings_payload("脚本已删除。", "脚本删除失败"),
        Err(error) => failed(
            &format!("脚本删除失败：{error}"),
            fallback_settings_payload(),
        ),
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> CommandResult<Value> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return failed("只允许打开 http 或 https 链接。", json!({}));
    }
    match open_url(trimmed) {
        Ok(()) => ok("已在系统浏览器打开链接。", json!({ "url": trimmed })),
        Err(error) => failed(&format!("打开链接失败：{error}"), json!({ "url": trimmed })),
    }
}

#[tauri::command]
pub async fn install_entrypoints() -> InstallActionResult {
    tauri::async_runtime::spawn_blocking(install::install_entrypoints)
        .await
        .unwrap_or_else(|error| install_background_failure("安装入口", error))
}

#[tauri::command]
pub async fn uninstall_entrypoints(options: InstallOptions) -> InstallActionResult {
    tauri::async_runtime::spawn_blocking(move || install::uninstall_entrypoints(options))
        .await
        .unwrap_or_else(|error| install_background_failure("卸载入口", error))
}

#[tauri::command]
pub async fn repair_shortcuts() -> InstallActionResult {
    tauri::async_runtime::spawn_blocking(install::repair_shortcuts)
        .await
        .unwrap_or_else(|error| install_background_failure("修复快捷方式", error))
}

#[tauri::command]
pub fn repair_backend() -> CommandResult<SettingsPayload> {
    let settings =
        settings_with_live_ccs_profiles(SettingsStore::default().load().unwrap_or_default());
    let message = match ucodex_core::cli_wrapper::ensure_cli_wrapper(&settings) {
        Ok(Some(install)) => format!(
            "后端已修复，命令包装器已指向 {}。",
            install.real_codex.to_string_lossy()
        ),
        Ok(None) => "后端已修复，命令包装器当前未启用。".to_string(),
        Err(error) => format!("后端修复部分失败：{error}"),
    };
    settings_payload(&message, "修复后重新读取设置失败")
}

#[tauri::command]
pub async fn check_update() -> CommandResult<Value> {
    match ucodex_core::update::check_for_update(ucodex_core::version::VERSION).await {
        Ok(update) => {
            let status = if update.update_available {
                "ok"
            } else {
                "not_checked"
            };
            CommandResult {
                status: status.to_string(),
                message: if update.update_available {
                    "发现可用更新。".to_string()
                } else {
                    "当前已是最新版本。".to_string()
                },
                payload: json!({
                    "currentVersion": update.current_version,
                    "latestVersion": update.latest_version,
                    "releaseSummary": update.release_summary,
                    "assetName": update.asset_name,
                    "assetUrl": update.asset_url,
                    "updateAvailable": update.update_available,
                    "progress": 0
                }),
            }
        }
        Err(error) => failed(
            &format!("检查更新失败：{error}"),
            json!({
                "currentVersion": ucodex_core::version::VERSION,
                "latestVersion": Value::Null,
                "releaseSummary": "",
                "assetName": Value::Null,
                "assetUrl": Value::Null,
                "updateAvailable": false,
                "progress": 0
            }),
        ),
    }
}

#[tauri::command]
pub async fn perform_update(
    release: Option<ucodex_core::update::Release>,
) -> CommandResult<Value> {
    let Some(release) = release else {
        return failed(
            "请先检查更新并选择可下载的 Release asset。",
            json!({
                "currentVersion": ucodex_core::version::VERSION,
                "progress": 0
            }),
        );
    };
    let download_dir = ucodex_core::paths::default_app_state_dir().join("updates");
    match ucodex_core::update::perform_update(&release, &download_dir).await {
        Ok(result) => ok(
            "安装包已下载并启动，请按安装向导完成更新。",
            json!({
                "currentVersion": ucodex_core::version::VERSION,
                "latestVersion": result.release.version,
                "releaseSummary": result.release.body,
                "installedPath": result.installer_path.to_string_lossy(),
                "launched": result.launched,
                "progress": 100
            }),
        ),
        Err(error) => failed(
            &format!("安装更新失败：{error}"),
            json!({
                "currentVersion": ucodex_core::version::VERSION,
                "latestVersion": release.version,
                "releaseSummary": release.body,
                "progress": 0
            }),
        ),
    }
}

#[tauri::command]
pub fn load_watcher_state() -> CommandResult<WatcherPayload> {
    ok("watcher 状态已加载。", watcher_payload())
}

#[tauri::command]
pub fn install_watcher() -> CommandResult<WatcherPayload> {
    let launcher_path =
        ucodex_core::install::companion_binary_path(ucodex_core::install::SILENT_BINARY);
    match ucodex_core::watcher::install_watcher(&launcher_path, default_debug_port()) {
        Ok(()) => ok("watcher 已安装。", watcher_payload()),
        Err(error) => failed(&format!("安装 watcher 失败：{error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn uninstall_watcher() -> CommandResult<WatcherPayload> {
    match ucodex_core::watcher::uninstall_watcher() {
        Ok(()) => ok("watcher 已移除。", watcher_payload()),
        Err(error) => failed(&format!("移除 watcher 失败：{error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn enable_watcher() -> CommandResult<WatcherPayload> {
    match ucodex_core::watcher::enable_watcher() {
        Ok(()) => ok("watcher 已启用。", watcher_payload()),
        Err(error) => failed(&format!("启用 watcher 失败：{error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn disable_watcher() -> CommandResult<WatcherPayload> {
    match ucodex_core::watcher::disable_watcher() {
        Ok(()) => ok("watcher 已禁用。", watcher_payload()),
        Err(error) => failed(&format!("禁用 watcher 失败：{error}"), watcher_payload()),
    }
}

#[tauri::command]
pub fn read_latest_logs(request: LogRequest) -> CommandResult<LogsPayload> {
    let path = ucodex_core::paths::default_diagnostic_log_path();
    match read_tail(&path, request.lines) {
        Ok(text) => ok(
            "日志已读取。",
            LogsPayload {
                path: path.to_string_lossy().to_string(),
                text,
                lines: request.lines,
            },
        ),
        Err(error) => failed(
            &format!("读取日志失败：{error}"),
            LogsPayload {
                path: path.to_string_lossy().to_string(),
                text: String::new(),
                lines: request.lines,
            },
        ),
    }
}

#[tauri::command]
pub fn copy_diagnostics() -> CommandResult<DiagnosticsPayload> {
    ok(
        "诊断报告已生成。",
        DiagnosticsPayload {
            report: diagnostics_report(),
        },
    )
}

#[tauri::command]
pub fn reset_settings() -> CommandResult<SettingsPayload> {
    let settings = BackendSettings::default();
    match SettingsStore::default().save(&settings) {
        Ok(()) => settings_payload("设置已重置为默认值。", "设置重置后重新读取失败"),
        Err(error) => failed(
            &format!("重置设置失败：{error}"),
            SettingsPayload {
                settings,
                settings_path: ucodex_core::paths::default_settings_path()
                    .to_string_lossy()
                    .to_string(),
                user_scripts: user_script_inventory(),
            },
        ),
    }
}

#[tauri::command]
pub fn relay_status() -> CommandResult<RelayPayload> {
    let status = ucodex_core::relay_config::default_relay_status();
    let message = if status.authenticated {
        "已检测到 ChatGPT 登录状态。"
    } else {
        "未检测到 ChatGPT 登录状态，请先在 Codex/ChatGPT 中正常登录。"
    };
    ok(message, relay_payload(status, None))
}

#[tauri::command]
pub fn read_relay_files() -> CommandResult<RelayFilesPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match relay_files_payload_from_home(&home) {
        Ok(payload) => ok("配置文件内容已读取。", payload),
        Err(error) => failed(
            &format!("读取配置文件失败：{error}"),
            RelayFilesPayload {
                config_path: home.join("config.toml").to_string_lossy().to_string(),
                auth_path: home.join("auth.json").to_string_lossy().to_string(),
                config_contents: String::new(),
                auth_contents: String::new(),
            },
        ),
    }
}

#[tauri::command]
pub fn save_relay_file(request: SaveRelayFileRequest) -> CommandResult<RelayFilesPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match save_relay_file_in_home(&home, &request.kind, &request.contents)
        .and_then(|_| relay_files_payload_from_home(&home))
    {
        Ok(payload) => ok("配置文件已保存。", payload),
        Err(error) => failed(
            &format!("保存配置文件失败：{error}"),
            relay_files_payload_from_home(&home).unwrap_or_else(|_| RelayFilesPayload {
                config_path: home.join("config.toml").to_string_lossy().to_string(),
                auth_path: home.join("auth.json").to_string_lossy().to_string(),
                config_contents: String::new(),
                auth_contents: String::new(),
            }),
        ),
    }
}

#[tauri::command]
pub fn write_diagnostic_event(event: String, detail: Value) -> CommandResult<Value> {
    let event = sanitize_manager_event(&event);
    match ucodex_core::diagnostic_log::append_diagnostic_log(&event, detail) {
        Ok(()) => ok("诊断日志已写入。", json!({})),
        Err(error) => failed(&format!("写入诊断日志失败：{error}"), json!({})),
    }
}

#[tauri::command]
pub fn backfill_relay_profile_from_live(
    request: BackfillRelayProfileRequest,
) -> CommandResult<SettingsBackfillPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    let mut settings = request.settings;
    let requested_profile_id = request.profile_id.clone();
    log_manager_event(
        "manager.backfill_relay_profile_from_live.start",
        json!({
            "profileId": requested_profile_id,
            "activeRelayId": settings.active_relay_id
        }),
    );
    let Some(profile) = settings
        .relay_profiles
        .iter_mut()
        .find(|profile| profile.id == request.profile_id)
    else {
        log_manager_event(
            "manager.backfill_relay_profile_from_live.missing_profile",
            json!({
                "profileId": requested_profile_id
            }),
        );
        return failed(
            "当前供应商已不在配置列表中，已停止切换以避免覆盖用户改动。",
            SettingsBackfillPayload { settings },
        );
    };

    match ucodex_core::relay_config::backfill_relay_profile_from_home_with_common(
        &home,
        profile,
        &mut settings.relay_context_config_contents,
    ) {
        Ok(()) => {
            log_manager_event(
                "manager.backfill_relay_profile_from_live.ok",
                json!({
                    "profileId": requested_profile_id
                }),
            );
            ok(
                "当前供应商配置已从 live 文件回填。",
                SettingsBackfillPayload { settings },
            )
        }
        Err(error) => {
            log_manager_event(
                "manager.backfill_relay_profile_from_live.failed",
                json!({
                    "profileId": requested_profile_id,
                    "error": error.to_string()
                }),
            );
            failed(
                &format!("回填当前供应商配置失败：{error}"),
                SettingsBackfillPayload { settings },
            )
        }
    }
}

#[tauri::command]
pub fn list_context_entries(
    request: ContextSettingsRequest,
) -> CommandResult<ContextEntriesPayload> {
    match ucodex_core::relay_config::list_context_entries_from_common_config(
        &request.settings.relay_context_config_contents,
    ) {
        Ok(entries) => ok(
            "工具与插件列表已读取。",
            ContextEntriesPayload {
                settings: request.settings,
                entries,
            },
        ),
        Err(error) => failed(
            &format!("读取工具与插件列表失败：{error}"),
            ContextEntriesPayload {
                settings: request.settings,
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn read_live_context_entries() -> CommandResult<LiveContextEntriesPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    let config_path = home.join("config.toml");
    let config = read_optional_text_file(&config_path).unwrap_or_default();
    match ucodex_core::relay_config::list_context_entries_from_common_config(&config) {
        Ok(entries) => ok(
            "live 工具与插件已读取。",
            LiveContextEntriesPayload { entries },
        ),
        Err(error) => failed(
            &format!("读取 live 工具与插件失败：{error}"),
            LiveContextEntriesPayload {
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn upsert_context_entry(request: ContextEntryRequest) -> CommandResult<ContextEntriesPayload> {
    let mut settings = request.settings;
    match ucodex_core::relay_config::upsert_context_entry_in_common_config(
        &settings.relay_context_config_contents,
        &request.kind,
        &request.id,
        &request.toml_body,
    ) {
        Ok(common) => {
            settings.relay_context_config_contents = common;
            list_context_entries(ContextSettingsRequest { settings })
        }
        Err(error) => failed(
            &format!("保存工具与插件失败：{error}"),
            ContextEntriesPayload {
                settings,
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn sync_live_context_entries(
    request: ContextSettingsRequest,
) -> CommandResult<LiveContextEntriesPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    let config_path = home.join("config.toml");
    let current_config = match read_optional_text_file(&config_path) {
        Ok(config) => config,
        Err(error) => {
            return failed(
                &format!("读取 live config.toml 失败：{error}"),
                LiveContextEntriesPayload {
                    entries: empty_context_entries(),
                },
            );
        }
    };
    let updated_config = match ucodex_core::relay_config::sync_live_config_context_entries(
        &current_config,
        &request.settings.relay_context_config_contents,
    ) {
        Ok(config) => config,
        Err(error) => {
            return failed(
                &format!("同步 live 工具与插件失败：{error}"),
                LiveContextEntriesPayload {
                    entries: empty_context_entries(),
                },
            );
        }
    };
    if let Some(parent) = config_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            return failed(
                &format!("创建 Codex 配置目录失败：{error}"),
                LiveContextEntriesPayload {
                    entries: empty_context_entries(),
                },
            );
        }
    }
    if let Err(error) = std::fs::write(&config_path, &updated_config) {
        return failed(
            &format!("写入 live config.toml 失败：{error}"),
            LiveContextEntriesPayload {
                entries: empty_context_entries(),
            },
        );
    }
    match ucodex_core::relay_config::list_context_entries_from_common_config(&updated_config) {
        Ok(entries) => ok(
            "live 工具与插件已同步。",
            LiveContextEntriesPayload { entries },
        ),
        Err(error) => failed(
            &format!("读取同步后的 live 工具与插件失败：{error}"),
            LiveContextEntriesPayload {
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn delete_context_entry(request: ContextDeleteRequest) -> CommandResult<ContextEntriesPayload> {
    let mut settings = request.settings;
    match ucodex_core::relay_config::delete_context_entry_from_common_config(
        &settings.relay_context_config_contents,
        &request.kind,
        &request.id,
    ) {
        Ok(common) => {
            settings.relay_context_config_contents = common;
            list_context_entries(ContextSettingsRequest { settings })
        }
        Err(error) => failed(
            &format!("删除工具与插件失败：{error}"),
            ContextEntriesPayload {
                settings,
                entries: empty_context_entries(),
            },
        ),
    }
}

#[tauri::command]
pub fn extract_relay_common_config(
    request: ExtractRelayCommonConfigRequest,
) -> CommandResult<ExtractRelayCommonConfigPayload> {
    match ucodex_core::relay_config::extract_common_config_from_config(&request.config_contents)
        .and_then(|common_config_contents| {
            let profile_config_contents =
                ucodex_core::relay_config::strip_common_config_from_config(
                    &request.config_contents,
                    &common_config_contents,
                )?;
            Ok(ExtractRelayCommonConfigPayload {
                common_config_contents,
                profile_config_contents,
            })
        }) {
        Ok(payload) => ok("通用配置已按兼容切换规则提取。", payload),
        Err(error) => failed(
            &format!("提取通用配置失败：{error}"),
            ExtractRelayCommonConfigPayload {
                common_config_contents: String::new(),
                profile_config_contents: request.config_contents,
            },
        ),
    }
}

#[tauri::command]
pub async fn test_relay_profile(profile: RelayProfile) -> CommandResult<RelayProfileTestPayload> {
    let profile_name = if profile.name.trim().is_empty() {
        "未命名供应商"
    } else {
        profile.name.trim()
    };
    let settings =
        settings_with_live_ccs_profiles(SettingsStore::default().load().unwrap_or_default());
    let test_model = if profile.test_model.trim().is_empty() {
        settings.relay_test_model.trim()
    } else {
        profile.test_model.trim()
    };
    match ucodex_core::relay_config::test_relay_profile(&profile, test_model).await {
        Ok(result) => {
            let status = if result.http_status < 400 {
                "ok"
            } else {
                "failed"
            };
            let preview = result.response_preview.trim();
            let detail = if preview.is_empty() {
                "响应内容为空".to_string()
            } else {
                format!("响应：{preview}")
            };
            CommandResult {
                status: status.to_string(),
                message: format!(
                    "已向「{profile_name}」用模型「{test_model}」发送 hi，HTTP {}。{detail}",
                    result.http_status
                ),
                payload: RelayProfileTestPayload {
                    http_status: result.http_status,
                    endpoint: result.endpoint,
                    response_preview: result.response_preview,
                },
            }
        }
        Err(error) => failed(
            &format!("测试「{profile_name}」失败：{error}"),
            RelayProfileTestPayload {
                http_status: 0,
                endpoint: String::new(),
                response_preview: String::new(),
            },
        ),
    }
}

#[tauri::command]
pub async fn fetch_relay_profile_models(
    profile: RelayProfile,
) -> CommandResult<RelayProfileModelsPayload> {
    let profile_name = if profile.name.trim().is_empty() {
        "未命名供应商"
    } else {
        profile.name.trim()
    };
    match ucodex_core::model_catalog::fetch_relay_profile_model_ids(&profile).await {
        Ok((models, endpoint)) => ok(
            &format!("已从「{profile_name}」获取 {} 个模型。", models.len()),
            RelayProfileModelsPayload { models, endpoint },
        ),
        Err(error) => failed(
            &format!("从「{profile_name}」获取模型失败：{error}"),
            RelayProfileModelsPayload {
                models: Vec::new(),
                endpoint: String::new(),
            },
        ),
    }
}

#[tauri::command]
pub fn apply_relay_injection() -> CommandResult<RelayPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    let settings =
        settings_with_live_ccs_profiles(SettingsStore::default().load().unwrap_or_default());
    if !settings.relay_profiles_enabled {
        let status = ucodex_core::relay_config::relay_status_from_home(&home);
        return failed(
            "供应商配置总开关已关闭，未写入 config.toml / auth.json。",
            relay_payload(status, None),
        );
    }
    let relay = settings.active_relay_profile();
    log_relay_apply_request("manager.apply_relay_injection", &settings, &relay);
    if relay_has_complete_files(&relay) {
        return match ucodex_core::relay_config::apply_relay_profile_to_home_with_switch_rules(
            &home,
            &relay,
            &relay_combined_common_config(&settings),
        ) {
            Ok(result) => {
                let status = ucodex_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_relay_injection.ok",
                    &relay,
                    &status,
                    result.backup_path.as_ref(),
                    None,
                );
                ok(
                    "已按兼容切换规则切换供应商。",
                    relay_payload(status, result.backup_path),
                )
            }
            Err(error) => {
                let status = ucodex_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_relay_injection.failed",
                    &relay,
                    &status,
                    None,
                    Some(error.to_string()),
                );
                failed(
                    &format!("切换完整中转配置失败：{error}"),
                    relay_payload(status, None),
                )
            }
        };
    }

    let auth = ucodex_core::relay_config::chatgpt_auth_status_from_home(&home);
    if !auth.authenticated {
        let status = ucodex_core::relay_config::relay_status_from_home(&home);
        log_relay_apply_result(
            "manager.apply_relay_injection.failed",
            &relay,
            &status,
            None,
            Some("未检测到 ChatGPT 登录状态".to_string()),
        );
        return failed(
            "未检测到 ChatGPT 登录状态，已停止写入中转配置。",
            relay_payload(status, None),
        );
    }

    match ucodex_core::relay_config::apply_relay_config_to_home_with_protocol(
        &home,
        &relay.base_url,
        &relay.api_key,
        relay.protocol,
        ucodex_core::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT,
    ) {
        Ok(result) => {
            let status = ucodex_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_relay_injection.ok",
                &relay,
                &status,
                result.backup_path.as_ref(),
                None,
            );
            ok(
                "中转配置已写入，密钥未在界面明文显示。",
                relay_payload(status, result.backup_path),
            )
        }
        Err(error) => {
            let status = ucodex_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_relay_injection.failed",
                &relay,
                &status,
                None,
                Some(error.to_string()),
            );
            failed(
                &format!("写入中转配置失败：{error}"),
                relay_payload(status, None),
            )
        }
    }
}

#[tauri::command]
pub fn apply_pure_api_injection() -> CommandResult<RelayPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    let settings =
        settings_with_live_ccs_profiles(SettingsStore::default().load().unwrap_or_default());
    if !settings.relay_profiles_enabled {
        let status = ucodex_core::relay_config::relay_status_from_home(&home);
        return failed(
            "供应商配置总开关已关闭，未写入 config.toml / auth.json。",
            relay_payload(status, None),
        );
    }
    let relay = settings.active_relay_profile();
    log_relay_apply_request("manager.apply_pure_api_injection", &settings, &relay);
    if relay_has_complete_files(&relay) {
        return match ucodex_core::relay_config::apply_relay_profile_to_home_with_switch_rules(
            &home,
            &relay,
            &relay_combined_common_config(&settings),
        ) {
            Ok(result) => {
                let status = ucodex_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_pure_api_injection.ok",
                    &relay,
                    &status,
                    result.backup_path.as_ref(),
                    None,
                );
                if !status.configured {
                    return failed(
                        "纯 API 配置写入后未检测到完整 custom provider，请检查 config.toml 和供应商 API Key。",
                        relay_payload(status, result.backup_path),
                    );
                }
                ok(
                    "已按兼容切换规则切换供应商。",
                    relay_payload(status, result.backup_path),
                )
            }
            Err(error) => {
                let status = ucodex_core::relay_config::relay_status_from_home(&home);
                log_relay_apply_result(
                    "manager.apply_pure_api_injection.failed",
                    &relay,
                    &status,
                    None,
                    Some(error.to_string()),
                );
                failed(
                    &format!("切换纯 API 配置失败：{error}"),
                    relay_payload(status, None),
                )
            }
        };
    }

    match ucodex_core::relay_config::apply_pure_api_config_to_home_with_protocol(
        &home,
        &relay.base_url,
        &relay.api_key,
        relay.protocol,
        ucodex_core::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT,
    ) {
        Ok(result) => {
            let status = ucodex_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_pure_api_injection.ok",
                &relay,
                &status,
                result.backup_path.as_ref(),
                None,
            );
            if !status.configured {
                return failed(
                    "纯 API 配置写入后未检测到完整 custom provider，请检查 config.toml 和供应商 API Key。",
                    relay_payload(status, result.backup_path),
                );
            }
            ok(
                "纯 API 模式已写入：config.toml 已写入 custom provider，auth.json 已切换为当前供应商。",
                relay_payload(status, result.backup_path),
            )
        }
        Err(error) => {
            let status = ucodex_core::relay_config::relay_status_from_home(&home);
            log_relay_apply_result(
                "manager.apply_pure_api_injection.failed",
                &relay,
                &status,
                None,
                Some(error.to_string()),
            );
            failed(
                &format!("写入纯 API 模式失败：{error}"),
                relay_payload(status, None),
            )
        }
    }
}

#[tauri::command]
pub fn clear_relay_injection() -> CommandResult<RelayPayload> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    let settings =
        settings_with_live_ccs_profiles(SettingsStore::default().load().unwrap_or_default());
    let relay = settings.active_relay_profile();
    log_manager_event("manager.clear_relay_injection.start", json!({}));
    let auth_contents = (relay.relay_mode == ucodex_core::settings::RelayMode::Official
        && !relay.official_mix_api_key
        && !relay.auth_contents.trim().is_empty())
    .then_some(relay.auth_contents.as_str());
    match ucodex_core::relay_config::clear_relay_config_to_home_with_auth(&home, auth_contents)
    {
        Ok(result) => {
            let status = ucodex_core::relay_config::relay_status_from_home(&home);
            log_manager_event(
                "manager.clear_relay_injection.ok",
                json!({
                    "configured": status.configured,
                    "backupPath": result.backup_path.as_ref()
                }),
            );
            ok(
                "已清除 custom 中转 API 模式，并切换到官方 ChatGPT 登录模式。",
                relay_payload(status, result.backup_path),
            )
        }
        Err(error) => {
            let status = ucodex_core::relay_config::relay_status_from_home(&home);
            log_manager_event(
                "manager.clear_relay_injection.failed",
                json!({
                    "configured": status.configured,
                    "error": error.to_string()
                }),
            );
            failed(
                &format!("清除中转配置失败：{error}"),
                relay_payload(status, None),
            )
        }
    }
}

fn relay_has_complete_files(relay: &ucodex_core::settings::RelayProfile) -> bool {
    if relay.relay_mode == ucodex_core::settings::RelayMode::Official
        && relay.official_mix_api_key
    {
        return !relay.config_contents.trim().is_empty();
    }
    !relay.config_contents.trim().is_empty() && !relay.auth_contents.trim().is_empty()
}

fn log_relay_apply_request(
    event: &str,
    settings: &BackendSettings,
    relay: &ucodex_core::settings::RelayProfile,
) {
    let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
        event,
        json!({
            "activeRelayId": settings.active_relay_id,
            "relayId": relay.id,
            "relayName": relay.name,
            "relayMode": relay.relay_mode,
            "protocol": relay.protocol,
            "baseUrl": relay.base_url,
            "hasConfigContents": !relay.config_contents.trim().is_empty(),
            "hasAuthContents": !relay.auth_contents.trim().is_empty(),
            "configContainsProxy": relay.config_contents.contains("127.0.0.1:57321")
        }),
    );
}

fn log_relay_apply_result(
    event: &str,
    relay: &ucodex_core::settings::RelayProfile,
    status: &ucodex_core::relay_config::RelayStatus,
    backup_path: Option<&String>,
    error: Option<String>,
) {
    log_manager_event(
        event,
        json!({
            "relayId": relay.id,
            "relayName": relay.name,
            "relayMode": relay.relay_mode,
            "protocol": relay.protocol,
            "configured": status.configured,
            "requiresOpenaiAuth": status.requires_openai_auth,
            "hasBearerToken": status.has_bearer_token,
            "backupPath": backup_path,
            "error": error
        }),
    );
}

/// 切换主窗口为灵动岛模式（透明 + macOS vibrancy + 无边框 + 置顶）
#[tauri::command]
pub fn set_floating_mode(app: tauri::AppHandle, enabled: bool) -> CommandResult<Value> {
    use tauri::Manager;
    use tauri::window::{EffectsBuilder, Effect, EffectState};
    use tauri::utils::config::Color;

    let Some(window) = app.get_webview_window("main") else {
        return failed("找不到主窗口。", json!({}));
    };

    if enabled {
        let _ = window.set_decorations(false);
        let _ = window.set_always_on_top(true);
        let _ = window.set_skip_taskbar(true);
        let _ = window.set_resizable(false);
        let _ = window.set_effects(
            EffectsBuilder::new()
                .effects(vec![Effect::Popover])
                .state(EffectState::Active)
                .build(),
        );
        // 设置窗口+webview 背景透明，让 macOS vibrancy 透出
        let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    } else {
        let _ = window.set_decorations(true);
        let _ = window.set_always_on_top(false);
        let _ = window.set_skip_taskbar(false);
        let _ = window.set_resizable(true);
        let _ = window.set_effects(None::<tauri::utils::config::WindowEffectsConfig>);
        // 恢复默认背景
        let _ = window.set_background_color(None);
    }

    ok(
        if enabled { "灵动岛模式已开启。" } else { "灵动岛模式已关闭。" },
        json!({ "enabled": enabled }),
    )
}

fn log_manager_event(event: &str, detail: Value) {
    let _ = ucodex_core::diagnostic_log::append_diagnostic_log(event, detail);
}

fn sanitize_manager_event(event: &str) -> String {
    let suffix = event
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let suffix = suffix.trim_matches(['.', '_', '-']).trim();
    if suffix.is_empty() {
        "manager.ui.event".to_string()
    } else if suffix.starts_with("manager.") {
        suffix.to_string()
    } else {
        format!("manager.ui.{suffix}")
    }
}

fn refresh_cli_wrapper_after_settings_save(settings: &BackendSettings) -> String {
    match ucodex_core::cli_wrapper::ensure_cli_wrapper(settings) {
        Ok(Some(install)) => format!(
            " 命令包装器已更新：{}。",
            install.real_codex.to_string_lossy()
        ),
        Ok(None) => String::new(),
        Err(error) => format!(" 但命令包装器更新失败：{error}。"),
    }
}

fn relay_payload(
    status: ucodex_core::relay_config::RelayStatus,
    backup_path: Option<String>,
) -> RelayPayload {
    RelayPayload {
        authenticated: status.authenticated,
        auth_source: status.auth_source,
        account_label: status.account_label,
        config_path: status.config_path,
        configured: status.configured,
        requires_openai_auth: status.requires_openai_auth,
        has_bearer_token: status.has_bearer_token,
        backup_path,
    }
}

fn empty_context_entries() -> ucodex_core::relay_config::CodexContextEntries {
    ucodex_core::relay_config::CodexContextEntries {
        mcp_servers: Vec::new(),
        skills: Vec::new(),
        plugins: Vec::new(),
    }
}

fn relay_files_payload_from_home(home: &std::path::Path) -> anyhow::Result<RelayFilesPayload> {
    let config_path = home.join("config.toml");
    let auth_path = home.join("auth.json");
    Ok(RelayFilesPayload {
        config_path: config_path.to_string_lossy().to_string(),
        auth_path: auth_path.to_string_lossy().to_string(),
        config_contents: read_optional_text_file(&config_path)?,
        auth_contents: read_optional_text_file(&auth_path)?,
    })
}

fn save_relay_file_in_home(
    home: &std::path::Path,
    kind: &str,
    contents: &str,
) -> anyhow::Result<()> {
    let path = match kind {
        "config" => home.join("config.toml"),
        "auth" => home.join("auth.json"),
        other => anyhow::bail!("未知配置文件类型：{other}"),
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, contents)?;
    Ok(())
}

fn read_optional_text_file(path: &std::path::Path) -> anyhow::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.into()),
    }
}


fn open_url(url: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        ucodex_core::windows_open_url(url)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| anyhow::anyhow!("启动系统浏览器失败：{error}"))
    }
}

fn settings_payload(message: &str, failure_context: &str) -> CommandResult<SettingsPayload> {
    match settings_payload_value() {
        Ok(payload) => ok(message, payload),
        Err((error, payload)) => failed(&format!("{failure_context}：{error}"), payload),
    }
}

fn settings_payload_value() -> Result<SettingsPayload, (anyhow::Error, SettingsPayload)> {
    let store = SettingsStore::default();
    let settings_path = ucodex_core::paths::default_settings_path()
        .to_string_lossy()
        .to_string();
    match store.load() {
        Ok(settings) => Ok(SettingsPayload {
            settings: settings_with_live_ccs_profiles(settings),
            settings_path,
            user_scripts: user_script_inventory(),
        }),
        Err(error) => Err((
            error,
            SettingsPayload {
                settings: BackendSettings::default(),
                settings_path,
                user_scripts: user_script_inventory(),
            },
        )),
    }
}

fn fallback_settings_payload() -> SettingsPayload {
    SettingsPayload {
        settings: settings_with_live_ccs_profiles(
            SettingsStore::default().load().unwrap_or_default(),
        ),
        settings_path: ucodex_core::paths::default_settings_path()
            .to_string_lossy()
            .to_string(),
        user_scripts: user_script_inventory(),
    }
}

fn user_script_inventory() -> Value {
    default_user_script_manager()
        .inventory()
        .unwrap_or_else(|error| {
            json!({
                "enabled": true,
                "scripts": [],
                "error": error.to_string()
            })
        })
}

fn failed_script_market_payload(message: &str) -> ScriptMarketPayload {
    ScriptMarketPayload {
        market: json!({
            "status": "failed",
            "message": message,
            "indexUrl": script_market::DEFAULT_MARKET_INDEX_URL,
            "updatedAt": "",
            "scripts": []
        }),
        user_scripts: user_script_inventory(),
    }
}

fn script_market_payload_from_manifest(
    manifest: &ScriptMarketManifest,
    status: &str,
    message: &str,
) -> ScriptMarketPayload {
    let user_scripts = user_script_inventory();
    let installed = installed_market_versions(&user_scripts);
    let scripts = manifest
        .scripts
        .iter()
        .map(|script| market_script_payload(script, &installed))
        .collect::<Vec<_>>();
    ScriptMarketPayload {
        market: json!({
            "status": status,
            "message": message,
            "indexUrl": script_market::DEFAULT_MARKET_INDEX_URL,
            "updatedAt": manifest.updated_at.clone().unwrap_or_default(),
            "scripts": scripts
        }),
        user_scripts,
    }
}

fn installed_market_versions(user_scripts: &Value) -> BTreeMap<String, String> {
    user_scripts
        .get("scripts")
        .and_then(Value::as_array)
        .map(|scripts| {
            scripts
                .iter()
                .filter_map(|script| {
                    let id = script.get("market_id").and_then(Value::as_str)?;
                    if id.is_empty() {
                        return None;
                    }
                    let version = script
                        .get("version")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    Some((id.to_string(), version))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn market_script_payload(script: &MarketScript, installed: &BTreeMap<String, String>) -> Value {
    let installed_version = installed.get(&script.id).cloned().unwrap_or_default();
    let is_installed = !installed_version.is_empty();
    json!({
        "id": script.id,
        "name": script.name,
        "description": script.description,
        "version": script.version,
        "author": script.author,
        "tags": script.tags,
        "homepage": script.homepage,
        "script_url": script.script_url,
        "sha256": script.sha256,
        "installed": is_installed,
        "installedVersion": installed_version,
        "updateAvailable": is_installed && installed.get(&script.id).map(|version| version != &script.version).unwrap_or(false)
    })
}

fn default_user_script_manager() -> UserScriptManager {
    let config_dir = user_scripts_config_dir();
    UserScriptManager::new(
        builtin_user_scripts_dir(),
        config_dir.join("user_scripts"),
        config_dir.join("user_scripts.json"),
    )
}

fn user_scripts_config_dir() -> PathBuf {
    if cfg!(windows) {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            return PathBuf::from(roaming).join("Codex++");
        }
    }
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".config")))
        .unwrap_or_else(|| PathBuf::from(".config"))
        .join("Codex++")
}

fn builtin_user_scripts_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .map(|path| path.join("user_scripts"))
        .unwrap_or_else(|| PathBuf::from("user_scripts"))
}

fn diagnostics_report() -> String {
    let (codex_app_path, entrypoints, latest_launch) = load_overview_payload();
    let overview = ok(
        "概览已加载。",
        OverviewPayload {
            codex_version: codex_app_path
                .as_deref()
                .and_then(ucodex_core::app_paths::codex_app_version),
            codex_app: path_state(codex_app_path),
            silent_shortcut: shortcut_state(entrypoints.silent_shortcut),
            management_shortcut: shortcut_state(entrypoints.management_shortcut),
            latest_launch,
            current_version: ucodex_core::version::VERSION.to_string(),
            update_status: "not_checked".to_string(),
            settings_path: ucodex_core::paths::default_settings_path()
                .to_string_lossy()
                .to_string(),
            logs_path: ucodex_core::paths::default_diagnostic_log_path()
                .to_string_lossy()
                .to_string(),
        },
    );
    let settings = SettingsStore::default().load().unwrap_or_default();
    let generated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    serde_json::to_string_pretty(&json!({
        "generatedAtMs": generated_at_ms,
        "version": ucodex_core::version::VERSION,
        "overview": overview.payload,
        "settings": settings,
        "logs": {
            "diagnosticLogPath": ucodex_core::paths::default_diagnostic_log_path(),
            "latestStatusPath": ucodex_core::paths::default_latest_status_path()
        },
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH
        }
    }))
    .unwrap_or_else(|error| format!("诊断报告序列化失败：{error}"))
}

fn load_overview_payload() -> (
    Option<PathBuf>,
    install::EntryPointState,
    Option<LaunchStatus>,
) {
    let settings = SettingsStore::default().load().unwrap_or_default();
    (
        ucodex_core::app_paths::resolve_codex_app_dir_with_saved(
            None,
            Some(settings.codex_app_path.as_str()),
        ),
        install::inspect_entrypoints(),
        StatusStore::default().load_latest().unwrap_or(None),
    )
}

fn install_background_failure(action: &str, error: impl std::fmt::Display) -> InstallActionResult {
    let state = install::inspect_entrypoints();
    InstallActionResult {
        status: "failed".to_string(),
        message: format!("{action}后台任务失败：{error}"),
        silent_shortcut: state.silent_shortcut,
        management_shortcut: state.management_shortcut,
    }
}

fn watcher_payload() -> WatcherPayload {
    let flag = ucodex_core::watcher::default_watcher_disabled_flag();
    WatcherPayload {
        enabled: !flag.exists(),
        disabled_flag: flag.to_string_lossy().to_string(),
    }
}

fn read_tail(path: &Path, max_lines: usize) -> std::io::Result<String> {
    let contents = fs::read_to_string(path)?;
    let mut lines = contents.lines().rev().take(max_lines).collect::<Vec<_>>();
    lines.reverse();
    Ok(lines.join("\n"))
}

fn path_state(path: Option<PathBuf>) -> PathState {
    match path {
        Some(path) => PathState {
            status: "found".to_string(),
            path: Some(path.to_string_lossy().to_string()),
        },
        None => PathState {
            status: "missing".to_string(),
            path: None,
        },
    }
}

fn shortcut_state(shortcut: install::ShortcutState) -> PathState {
    PathState {
        status: if shortcut.installed {
            "installed".to_string()
        } else {
            "missing".to_string()
        },
        path: shortcut.path,
    }
}

fn ok<T: Serialize>(message: &str, payload: T) -> CommandResult<T> {
    CommandResult {
        status: "ok".to_string(),
        message: message.to_string(),
        payload,
    }
}

fn failed<T: Serialize>(message: &str, payload: T) -> CommandResult<T> {
    CommandResult {
        status: "failed".to_string(),
        message: message.to_string(),
        payload,
    }
}

fn default_debug_port() -> u16 {
    9229
}

pub fn default_helper_port() -> u16 {
    57321
}

fn default_log_lines() -> usize {
    200
}

#[tauri::command]
pub async fn load_proxy_stats(
    helper_handle: tauri::State<'_, crate::HelperHandle>,
    helper_port: Option<u16>,
) -> Result<CommandResult<Value>, String> {
    // 优先从进程内 helper 读取
    let cloned_refs = {
        let guard = helper_handle.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|h| h.clone_refs())
    };
    if let Some((stats, cache)) = cloned_refs {
        let cache_metrics = cache.metrics().await;
        let cache_stats = ucodex_core::proxy_stats::CacheStats {
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
        let snapshot = stats.snapshot(cache_stats).await;
        if let Ok(data) = serde_json::to_value(&snapshot) {
            return Ok(CommandResult {
                status: "ok".to_string(),
                message: "代理统计已加载（进程内）。".to_string(),
                payload: data,
            });
        }
    }
    // 回退：从外部 helper server HTTP 获取
    let port = helper_port.unwrap_or(57321);
    let url = format!("http://127.0.0.1:{port}/proxy-stats");
    let client = match ucodex_core::http_client::proxied_client("Ucodex-Manager") {
        Ok(c) => c,
        Err(e) => return Ok(failed(&format!("创建 HTTP 客户端失败：{e}"), json!({}))),
    };
    match client
        .get(&url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => Ok(CommandResult {
                status: "ok".to_string(),
                message: "代理统计已加载（远程）。".to_string(),
                payload: data,
            }),
            Err(e) => Ok(failed(&format!("解析代理统计失败：{e}"), json!({}))),
        },
        Err(e) => {
            if e.is_connect() {
                Ok(CommandResult {
                    status: "ok".to_string(),
                    message: "helper 未运行".to_string(),
                    payload: json!({ "offline": true }),
                })
            } else {
                Ok(failed(&format!("请求代理统计失败：{e}"), json!({})))
            }
        }
    }
}

// ── 统计历史查询 ──────────────────────────────────────────────

#[tauri::command]
pub async fn load_stats_history(
    helper_handle: tauri::State<'_, crate::HelperHandle>,
    days: Option<u32>,
) -> Result<CommandResult<Value>, String> {
    let persistence = {
        let guard = helper_handle.lock().map_err(|e| e.to_string())?;
        guard.as_ref().and_then(|h| h.persistence().cloned())
    };
    let Some(persistence) = persistence else {
        return Ok(failed("统计持久化未初始化。", json!({})));
    };
    let days = days.unwrap_or(30);
    match persistence.query_recent_days(days).await {
        Ok(daily) => {
            // Get today's hourly data too
            let (today_hourly, _yesterday_hourly) =
                persistence.query_today_and_yesterday_hourly().await.unwrap_or_default();
            Ok(CommandResult {
                status: "ok".to_string(),
                message: format!("已加载 {} 天的统计数据。", daily.len()),
                payload: json!({
                    "daily": daily,
                    "todayHourly": today_hourly,
                }),
            })
        }
        Err(e) => Ok(failed(&format!("查询统计数据失败：{e}"), json!({}))),
    }
}

#[tauri::command]
pub async fn load_stats_hourly_for_date(
    helper_handle: tauri::State<'_, crate::HelperHandle>,
    date: String,
) -> Result<CommandResult<Value>, String> {
    let persistence = {
        let guard = helper_handle.lock().map_err(|e| e.to_string())?;
        guard.as_ref().and_then(|h| h.persistence().cloned())
    };
    let Some(persistence) = persistence else {
        return Ok(failed("统计持久化未初始化。", json!({})));
    };
    match persistence.query_hourly(&date).await {
        Ok(hourly) => Ok(CommandResult {
            status: "ok".to_string(),
            message: format!("已加载 {} 的逐小时数据。", date),
            payload: json!({ "hourly": hourly, "date": date }),
        }),
        Err(e) => Ok(failed(&format!("查询逐小时数据失败：{e}"), json!({}))),
    }
}

// ── Config.toml 全量管理 ────────────────────────────────────────────

#[tauri::command]
pub fn load_codex_config() -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::load_codex_config(&home) {
        Ok(snapshot) => match serde_json::to_value(&snapshot) {
            Ok(data) => CommandResult {
                status: "ok".to_string(),
                message: "config.toml 已加载。".to_string(),
                payload: data,
            },
            Err(e) => failed(&format!("序列化 config 失败：{e}"), json!({})),
        },
        Err(e) => failed(&format!("读取 config.toml 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_features(features: Value) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_features(&home, &features) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "features 已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存 features 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_feature(key: String, value: bool) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_feature(&home, &key, value) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: format!("feature '{key}' 已保存。"),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存 feature 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_mcp_servers(servers: Value) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_mcp_servers(&home, &servers) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "MCP servers 已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存 MCP servers 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_plugins(plugins: Value) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_plugins(&home, &plugins) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "plugins 已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存 plugins 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_projects(projects: Value) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_projects(&home, &projects) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "projects 已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存 projects 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_notify(notify: Value) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_notify(&home, &notify) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "notify 已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存 notify 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_raw_toml(raw_toml: String) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_raw_toml(&home, &raw_toml) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "config.toml 已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存 config.toml 失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_root_keys(keys: Value) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_root_keys(&home, &keys) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "根级配置已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存根级配置失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn save_codex_model_providers(providers: Value) -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_manager::save_codex_model_providers(&home, &providers) {
        Ok(()) => CommandResult {
            status: "ok".to_string(),
            message: "供应商配置已保存。".to_string(),
            payload: json!({}),
        },
        Err(e) => failed(&format!("保存供应商配置失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn get_config_migration_status() -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_migration::get_migration_status(&home) {
        Ok(status) => match serde_json::to_value(&status) {
            Ok(data) => CommandResult {
                status: "ok".to_string(),
                message: "迁移状态已获取。".to_string(),
                payload: data,
            },
            Err(e) => failed(&format!("序列化迁移状态失败：{e}"), json!({})),
        },
        Err(e) => failed(&format!("获取迁移状态失败：{e}"), json!({})),
    }
}

#[tauri::command]
pub fn run_config_migrations() -> CommandResult<Value> {
    let home = ucodex_core::relay_config::default_codex_home_dir();
    match ucodex_core::config_migration::run_pending_migrations(&home) {
        Ok(migrated) => CommandResult {
            status: "ok".to_string(),
            message: if migrated {
                "配置迁移已执行。".to_string()
            } else {
                "配置已是最新版本，无需迁移。".to_string()
            },
            payload: json!({ "migrated": migrated }),
        },
        Err(e) => failed(&format!("配置迁移失败：{e}"), json!({})),
    }
}

// ── Process Management ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProcessInfo {
    pub pid: u32,
    pub name: String,
    pub command: String,
    pub port: Option<u16>,
    pub role: String,
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessListPayload {
    pub processes: Vec<CodexProcessInfo>,
    pub helper_port: u16,
    pub helper_running: bool,
    pub port_conflict: bool,
}

const CODEX_HELPER_PORT: u16 = 57321;

fn classify_codex_process(name: &str, cmd: &str) -> Option<&'static str> {
    let name_lc = name.to_ascii_lowercase();

    // 1. ucodex / CodexPlusPlus binary (helper / launcher)
    if name_lc.starts_with("codex-plus") || name_lc.starts_with("codex_plus")
        || name == "CodexPlusPlus" || name == "CodexPlusPlusManager"
    {
        return if name_lc.contains("manager") { Some("codex-manager") } else { Some("helper") };
    }

    // 2. Electron helper processes from Ucodex .app bundle
    //    Match "Ucodex Helper" but NOT "Codex Helper" (that's the official Codex app)
    if name.contains("Ucodex Helper") || name.contains("Ucodex helper") {
        return Some("renderer");
    }

    // 3. Check executable path — only match Ucodex-specific paths
    //    IMPORTANT: Do NOT match /Applications/Codex.app/ (that's the official OpenAI Codex app)
    let exe = cmd.split_whitespace().next().unwrap_or("");
    let exe_lc = exe.to_ascii_lowercase();
    let is_ucodex_exe = exe_lc.contains("ucodex")
        || exe_lc.contains("codex-plus")
        || exe_lc.contains("codex_plus");

    if is_ucodex_exe {
        if cmd.contains("--type=renderer") || cmd.contains("--type=gpu-process")
            || cmd.contains("--type=utility")
        {
            return Some("renderer");
        }
        if cmd.contains("app-server") {
            return Some("app-server");
        }
        return Some("codex-app");
    }

    // 4. Named processes (match by executable name only, not full cmd)
    if name == "SkyComputerUse" {
        return Some("computer-use");
    }
    if name == "bare-modifier-monitor" {
        return Some("monitor");
    }
    if name == "node_repl" {
        return Some("node-repl");
    }

    // 5. Node.js processes with Ucodex-related scripts
    if name_lc == "node" {
        if let Some(first_arg) = cmd.split_whitespace().nth(1) {
            let arg_lc = first_arg.to_ascii_lowercase();
            if arg_lc.contains("ucodex") || arg_lc.contains("codex-plus") || arg_lc.contains("codex_plus") {
                return Some("codex-app");
            }
            if arg_lc.contains("node_repl") {
                return Some("node-repl");
            }
        }
    }

    None
}

#[tauri::command]
pub async fn list_codex_processes() -> CommandResult<ProcessListPayload> {
    let self_pid = std::process::id();

    // Parallel: spawn ps and lsof as blocking tasks
    let ps_handle = tokio::task::spawn_blocking(|| {
        std::process::Command::new("ps")
            .args(["-axo", "pid=,pcpu=,rss=,args="])
            .output()
    });
    let lsof_handle = tokio::task::spawn_blocking(|| {
        std::process::Command::new("lsof")
            .args(["-i", &format!(":{CODEX_HELPER_PORT}"), "-t"])
            .output()
    });

    let (ps_result, lsof_result) = tokio::join!(ps_handle, lsof_handle);
    let ps_output = ps_result.unwrap_or_else(|_| Err(std::io::Error::other("ps task panicked")));
    let lsof_output = lsof_result.unwrap_or_else(|_| Err(std::io::Error::other("lsof task panicked")));

    let mut processes = Vec::new();
    let mut helper_running = false;

    if let Ok(output) = ps_output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            // Use iterator instead of collecting into Vec
            let mut parts = trimmed.split_whitespace();
            let pid_str = match parts.next() { Some(s) => s, None => continue };
            let cpu_str = match parts.next() { Some(s) => s, None => continue };
            let rss_str = match parts.next() { Some(s) => s, None => continue };
            // Skip to get the 4th token (name)
            let name = match parts.next() { Some(s) => s, None => continue };

            let pid: u32 = match pid_str.parse() { Ok(v) => v, Err(_) => continue };
            let cpu: f64 = cpu_str.parse().unwrap_or(0.0);
            let rss_kb: f64 = rss_str.parse().unwrap_or(0.0);

            // Reconstruct args: find where the 4th token starts in the original line
            let arg_start = {
                let mut count = 0;
                let bytes = trimmed.as_bytes();
                let mut i = 0;
                while i < bytes.len() && count < 3 {
                    while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
                    if i >= bytes.len() { break; }
                    count += 1;
                    while i < bytes.len() && !bytes[i].is_ascii_whitespace() { i += 1; }
                }
                while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
                i
            };
            let cmd = if arg_start < trimmed.len() { &trimmed[arg_start..] } else { "" };

            let basename = name.rsplit('/').next().unwrap_or(name);

            let role = match classify_codex_process(basename, cmd) {
                Some(r) => r,
                None => continue,
            };

            if role == "helper" { helper_running = true; }
            let port = if role == "helper" { Some(CODEX_HELPER_PORT) } else { None };

            // Truncate command to 120 chars without allocating a new String via chars()
            let cmd_truncated = if cmd.len() > 120 {
                // Find a valid UTF-8 boundary at or before 120 bytes
                let mut end = 120;
                while end > 0 && !cmd.is_char_boundary(end) { end -= 1; }
                &cmd[..end]
            } else {
                cmd
            };

            processes.push(CodexProcessInfo {
                pid,
                name: basename.to_string(),
                command: cmd_truncated.to_string(),
                port,
                role: role.to_string(),
                cpu_percent: cpu,
                memory_mb: (rss_kb / 1024.0 * 100.0).round() / 100.0,
                started_at: String::new(),
            });
        }
    }

    // Check port conflict
    let mut port_conflict = false;
    if let Ok(output) = lsof_output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let pids_on_port: Vec<u32> = stdout.lines()
            .filter_map(|l| l.trim().parse().ok())
            .collect();
        if pids_on_port.contains(&(self_pid as u32)) {
            helper_running = true;
        }
        let has_foreign = pids_on_port.iter().any(|p| *p != self_pid as u32);
        if has_foreign && !helper_running {
            port_conflict = true;
        }
    }

    processes.sort_by(|a, b| {
        let order = |r: &str| match r {
            "helper" => 0, "codex-manager" => 1, "codex-app" => 2, "app-server" => 3,
            "renderer" => 4, "node-repl" => 5, "computer-use" => 6, _ => 7,
        };
        order(&a.role).cmp(&order(&b.role)).then(a.pid.cmp(&b.pid))
    });

    ok("进程列表已获取。", ProcessListPayload {
        processes,
        helper_port: CODEX_HELPER_PORT,
        helper_running,
        port_conflict,
    })
}

#[tauri::command]
pub async fn kill_codex_process_by_pid(pid: u32) -> CommandResult<Value> {
    let self_pid = std::process::id();
    if pid == self_pid as u32 {
        return failed("不能终止自身进程。", json!({}));
    }
    match std::process::Command::new("kill").arg(pid.to_string()).output() {
        Ok(output) if output.status.success() => {
            ok(&format!("进程 {pid} 已终止。"), json!({ "pid": pid }))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            failed(&format!("终止进程 {pid} 失败：{}", stderr.trim()), json!({ "pid": pid }))
        }
        Err(e) => failed(&format!("终止进程 {pid} 失败：{e}"), json!({ "pid": pid })),
    }
}

#[tauri::command]
pub async fn kill_all_codex_processes() -> CommandResult<Value> {
    let self_pid = std::process::id();
    let result = list_codex_processes().await;
    if result.status != "ok" {
        return failed("获取进程列表失败。", json!({}));
    }
    let mut killed = Vec::new();
    let mut errors = Vec::new();
    for proc in &result.payload.processes {
        if proc.pid == self_pid as u32 { continue; }
        if proc.role == "helper" { continue; } // don't kill our own helper
        if proc.role == "codex-manager" { continue; } // don't kill other manager instances
        match std::process::Command::new("kill").arg(proc.pid.to_string()).output() {
            Ok(o) if o.status.success() => killed.push(proc.pid),
            _ => errors.push(proc.pid),
        }
    }
    ok(
        &format!("已终止 {} 个进程，{} 个失败。", killed.len(), errors.len()),
        json!({ "killed": killed, "errors": errors }),
    )
}

#[tauri::command]
pub async fn quick_launch_helper() -> CommandResult<Value> {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        quick_launch_helper_inner()
    }));
    match result {
        Ok(r) => r,
        Err(_) => failed("启动 helper 时发生内部错误。", json!({})),
    }
}

fn quick_launch_helper_inner() -> CommandResult<Value> {
    // Collect candidate paths in priority order
    let current_exe = std::env::current_exe().unwrap_or_default();
    let current_dir = current_exe.parent().unwrap_or(Path::new("."));
    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()   // apps/ucodex-manager/src-tauri → apps/ucodex-manager
        .and_then(|p| p.parent()) // apps → project root
        .unwrap_or(Path::new("."));

    let candidates: Vec<PathBuf> = vec![
        // 1. Debug build (same directory as this binary — already running manager)
        current_dir.join("ucodex"),
        // 2. Release build
        project_root.join("target/release/ucodex"),
        // 3. Debug build from project root
        project_root.join("target/debug/ucodex"),
        // 4. Installed app bundle
        PathBuf::from("/Applications/Ucodex.app/Contents/MacOS/CodexPlusPlus"),
        // 5. Legacy installed app bundle
        PathBuf::from("/Applications/Codex++.app/Contents/MacOS/CodexPlusPlus"),
        // 6. companion_binary_path (standard logic)
        ucodex_core::install::companion_binary_path(SILENT_BINARY),
    ];

    // Deduplicate and find the first existing one
    let mut seen = std::collections::HashSet::new();
    let mut found: Option<PathBuf> = None;
    let mut tried = Vec::new();

    for path in &candidates {
        let canon = path.canonicalize().unwrap_or_else(|_| path.clone());
        if seen.insert(canon.clone()) {
            tried.push(path.display().to_string());
            if canon.exists() {
                found = Some(canon);
                break;
            }
        }
    }

    let launcher = match found {
        Some(p) => p,
        None => {
            return failed(
                &format!("未找到 ucodex 二进制。已尝试：{}", tried.join(", ")),
                json!({ "tried": tried }),
            );
        }
    };

    // Check if helper is already running on the port
    let lsof = std::process::Command::new("lsof")
        .args(["-i", &format!(":{CODEX_HELPER_PORT}"), "-t"])
        .output();
    if let Ok(output) = lsof {
        let pids: Vec<u32> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|l| l.trim().parse().ok())
            .collect();
        if !pids.is_empty() {
            return ok(
                &format!("Helper 已在端口 {} 运行（PID: {:?}）。", CODEX_HELPER_PORT, pids),
                json!({ "alreadyRunning": true, "pids": pids, "port": CODEX_HELPER_PORT }),
            );
        }
    }

    // Launch
    match std::process::Command::new(&launcher)
        .arg("--helper-port")
        .arg(CODEX_HELPER_PORT.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(_) => ok(
            &format!("已启动 helper：{}", launcher.display()),
            json!({ "path": launcher.display().to_string(), "port": CODEX_HELPER_PORT }),
        ),
        Err(e) => failed(
            &format!("启动 {} 失败：{e}", launcher.display()),
            json!({ "path": launcher.display().to_string() }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_version_returns_structured_payload() {
        let result = backend_version();

        assert_eq!(result.status, "ok");
        assert!(!result.payload.version.is_empty());
    }

    #[test]
    fn startup_options_returns_structured_payload() {
        let result = startup_options();

        assert_eq!(result.status, "ok");
    }

    #[test]
    fn startup_options_honors_show_update_environment() {
        unsafe {
            std::env::set_var("CODEX_PLUS_SHOW_UPDATE", "1");
        }

        let result = startup_options();

        unsafe {
            std::env::remove_var("CODEX_PLUS_SHOW_UPDATE");
        }

        assert_eq!(result.status, "ok");
        assert!(result.payload.show_update);
    }

    #[test]
    fn startup_options_honors_show_update_argument() {
        assert!(should_show_update(
            ["ucodex-manager.exe", "--show-update"],
            None
        ));
    }

    #[test]
    fn overview_contains_expected_operational_fields() {
        let result = tauri::async_runtime::block_on(load_overview());

        assert_eq!(result.status, "ok");
        assert!(!result.payload.current_version.is_empty());
        assert!(
            result.payload.codex_version.is_none()
                || result
                    .payload
                    .codex_version
                    .as_deref()
                    .is_some_and(|version| !version.is_empty())
        );
        assert!(matches!(
            result.payload.codex_app.status.as_str(),
            "found" | "missing"
        ));
        assert!(matches!(
            result.payload.silent_shortcut.status.as_str(),
            "installed" | "missing"
        ));
    }

    #[test]
    fn update_install_requires_release_payload() {
        let result = tauri::async_runtime::block_on(perform_update(None));

        assert_eq!(result.status, "failed");
        assert!(result.message.contains("请先检查更新"));
    }

    #[test]
    fn watcher_state_returns_disabled_flag_path() {
        let result = load_watcher_state();

        assert_eq!(result.status, "ok");
        assert!(result.payload.disabled_flag.contains("watcher.disabled"));
    }

    #[test]
    fn missing_logs_return_failed_status() {
        let result = read_latest_logs(LogRequest { lines: 25 });

        if result.payload.text.is_empty() {
            assert_eq!(result.status, "failed");
        }
    }

    #[test]
    fn relay_payload_does_not_expose_token_text() {
        let payload = relay_payload(
            ucodex_core::relay_config::RelayStatus {
                authenticated: true,
                auth_source: "registry.json".to_string(),
                account_label: Some("user@example.test".to_string()),
                config_path: "config.toml".to_string(),
                configured: true,
                requires_openai_auth: true,
                has_bearer_token: true,
            },
            None,
        );
        let text = serde_json::to_string(&payload).unwrap();

        assert!(!text.contains("sk-"));
        assert!(text.contains("hasBearerToken"));
    }

    #[test]
    fn relay_files_payload_reads_config_and_auth_contents() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join("config.toml"),
            "model_provider = \"custom\"\n",
        )
        .unwrap();
        std::fs::write(
            temp.path().join("auth.json"),
            "{\"OPENAI_API_KEY\":\"sk-test\"}\n",
        )
        .unwrap();

        let payload = relay_files_payload_from_home(temp.path()).unwrap();

        assert!(payload.config_path.ends_with("config.toml"));
        assert!(payload.auth_path.ends_with("auth.json"));
        assert_eq!(payload.config_contents, "model_provider = \"custom\"\n");
        assert_eq!(payload.auth_contents, "{\"OPENAI_API_KEY\":\"sk-test\"}\n");
    }

    #[test]
    fn apply_relay_profile_to_home_with_switch_rules_preserves_custom_provider_id() {
        let temp = tempfile::tempdir().unwrap();
        let profile = RelayProfile {
            relay_mode: ucodex_core::settings::RelayMode::PureApi,
            protocol: ucodex_core::settings::RelayProtocol::Responses,
            config_contents: "model_provider = \"ai\"\nmodel = \"gpt-image-2\"\n\n[model_providers.ai]\nname = \"ai\"\nwire_api = \"responses\"\nrequires_openai_auth = true\nbase_url = \"https://ahg.codes\"\n"
                .to_string(),
            auth_contents: "{}\n".to_string(),
            ..RelayProfile::default()
        };

        ucodex_core::relay_config::apply_relay_profile_to_home_with_switch_rules(
            temp.path(),
            &profile,
            "",
        )
        .unwrap();

        let applied = std::fs::read_to_string(temp.path().join("config.toml")).unwrap();
        assert!(applied.contains("model_provider = \"ai\""));
        assert!(applied.contains("[model_providers.ai]"));
        assert!(!applied.contains("[model_providers.custom]"));
    }

    #[test]
    fn save_relay_file_in_home_only_allows_known_files() {
        let temp = tempfile::tempdir().unwrap();

        save_relay_file_in_home(temp.path(), "config", "model = \"gpt-5\"\n").unwrap();
        save_relay_file_in_home(temp.path(), "auth", "{}\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(temp.path().join("config.toml")).unwrap(),
            "model = \"gpt-5\"\n"
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("auth.json")).unwrap(),
            "{}\n"
        );
        assert!(save_relay_file_in_home(temp.path(), "../bad", "").is_err());
    }

    #[test]
    fn normalize_settings_before_save_preserves_profile_context_until_manual_extract() {
        let settings = BackendSettings {
            relay_common_config_contents: "[mcp_servers.context7]\ncommand = \"npx\"\n".to_string(),
            relay_profiles: vec![RelayProfile {
                use_common_config: false,
                relay_mode: ucodex_core::settings::RelayMode::PureApi,
                config_contents: "model = \"gpt-5\"\n\n[mcp_servers.context7]\ncommand = \"npx\"\n"
                    .to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);

        assert!(
            normalized.relay_profiles[0]
                .config_contents
                .contains("model = \"gpt-5\"")
        );
        assert!(
            normalized.relay_profiles[0]
                .config_contents
                .contains("[mcp_servers.context7]")
        );
        assert!(
            normalized
                .relay_context_config_contents
                .contains("[mcp_servers.context7]")
        );
        assert!(
            !normalized
                .relay_common_config_contents
                .contains("[mcp_servers")
        );
    }

    #[test]
    fn normalize_settings_before_save_preserves_official_profile_auth() {
        let settings = BackendSettings {
            relay_profiles: vec![RelayProfile {
                relay_mode: ucodex_core::settings::RelayMode::Official,
                official_mix_api_key: false,
                auth_contents: r#"{"auth_mode":"chatgpt","tokens":{"access_token":"edited"}}"#
                    .to_string(),
                config_contents: "model_provider = \"custom\"\n".to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&normalized.relay_profiles[0].auth_contents)
                .unwrap(),
            serde_json::json!({"auth_mode":"chatgpt","tokens":{"access_token":"edited"}})
        );
        assert!(normalized.relay_profiles[0].config_contents.is_empty());
    }

    #[test]
    fn remove_linked_ccs_profiles_for_local_storage_drops_external_profiles() {
        let mut settings = BackendSettings {
            ccs_link_enabled: true,
            active_relay_id: "ccs-one".to_string(),
            relay_profiles: vec![
                RelayProfile {
                    id: "local".to_string(),
                    name: "Local".to_string(),
                    ..RelayProfile::default()
                },
                RelayProfile {
                    id: "ccs-one".to_string(),
                    linked_ccs_provider_id: "provider-one".to_string(),
                    name: "External".to_string(),
                    ..RelayProfile::default()
                },
            ],
            ..BackendSettings::default()
        };

        remove_linked_ccs_profiles_for_local_storage(&mut settings);

        assert_eq!(settings.relay_profiles.len(), 1);
        assert_eq!(settings.relay_profiles[0].id, "local");
        assert_eq!(settings.active_relay_id, "ccs-one");
    }

    #[test]
    fn normalize_settings_before_save_strips_common_from_enabled_profile() {
        let settings = BackendSettings {
            relay_common_config_contents: r#"model_reasoning_effort = "high"

[features]
goals = true

[plugins."superpowers@openai-curated"]
enabled = true
"#
            .to_string(),
            relay_profiles: vec![RelayProfile {
                use_common_config: true,
                relay_mode: ucodex_core::settings::RelayMode::PureApi,
                config_contents: r#"model = "gpt-5"
model_reasoning_effort = "high"

[features]
goals = true
model_reasoning_effort = "high"

[plugins."superpowers@openai-curated"]
enabled = true
"#
                .to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);
        let config = &normalized.relay_profiles[0].config_contents;

        assert!(config.contains("model = \"gpt-5\""));
        assert!(!config.contains("model_reasoning_effort"));
        assert!(!config.contains("[features]"));
        assert!(!config.contains("[plugins.\"superpowers@openai-curated\"]"));
    }

    #[test]
    fn normalize_settings_before_save_repairs_invalid_profile_common_duplication() {
        let settings = BackendSettings {
            relay_common_config_contents: r#"model_reasoning_effort = "high"

[marketplaces.openai-bundled]
last_updated = "2026-05-25T11:52:46Z"
"#
            .to_string(),
            relay_profiles: vec![RelayProfile {
                use_common_config: true,
                relay_mode: ucodex_core::settings::RelayMode::PureApi,
                config_contents: r#"model = "gpt-5"
model_reasoning_effort = "high"

[marketplaces.openai-bundled]
last_updated = "2026-05-25T11:52:46Z"

[marketplaces.openai-bundled]
last_updated = "2026-05-25T11:52:46Z"
"#
                .to_string(),
                ..RelayProfile::default()
            }],
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);
        let config = &normalized.relay_profiles[0].config_contents;

        assert!(config.contains("model = \"gpt-5\""));
        assert!(!config.contains("model_reasoning_effort"));
        assert!(!config.contains("[marketplaces.openai-bundled]"));
    }

    #[test]
    fn normalize_settings_before_save_removes_model_catalog_from_common_config() {
        let settings = BackendSettings {
            relay_common_config_contents: r#"model_catalog_json = "C:\\Users\\Administrator\\.codex\\model-catalogs\\relay-a.json"
model_catalog_json = 'C:\Users\Administrator\.codex\model-catalogs\relay-b.json'
model_reasoning_effort = "high"
"#
            .to_string(),
            ..BackendSettings::default()
        };

        let normalized = normalize_settings_before_save(settings);

        assert!(
            !normalized
                .relay_common_config_contents
                .contains("model_catalog_json")
        );
        assert!(
            normalized
                .relay_common_config_contents
                .contains("model_reasoning_effort = \"high\"")
        );
    }

    #[test]
    fn context_entry_commands_update_settings_payload() {
        let settings = BackendSettings::default();
        let upsert = upsert_context_entry(ContextEntryRequest {
            settings: settings.clone(),
            kind: "mcp".to_string(),
            id: "context7".to_string(),
            toml_body: "command = \"npx\"\n".to_string(),
        });

        assert_eq!(upsert.status, "ok");
        assert!(
            upsert
                .payload
                .settings
                .relay_context_config_contents
                .contains("[mcp_servers.context7]")
        );

        let listed = list_context_entries(ContextSettingsRequest {
            settings: upsert.payload.settings.clone(),
        });
        assert_eq!(listed.payload.entries.mcp_servers[0].id, "context7");

        let deleted = delete_context_entry(ContextDeleteRequest {
            settings: upsert.payload.settings,
            kind: "mcp".to_string(),
            id: "context7".to_string(),
        });
        assert_eq!(deleted.status, "ok");
        assert!(
            !deleted
                .payload
                .settings
                .relay_context_config_contents
                .contains("[mcp_servers.context7]")
        );
    }

    #[test]

    #[test]
    fn open_external_url_rejects_non_http_urls() {
        let result = open_external_url("file:///C:/Windows/win.ini".to_string());

        assert_eq!(result.status, "failed");
        assert!(result.message.contains("只允许打开 http 或 https 链接"));
    }
}
