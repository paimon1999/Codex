pub mod commands;
pub mod install;

use std::sync::Mutex;

/// Manager 内嵌的 Helper Server 句柄
pub type HelperHandle = Mutex<Option<ucodex_core::launcher::StandaloneHelperHandle>>;

pub fn run() {
    install_panic_logger();
    let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
        "manager.start",
        serde_json::json!({
            "version": env!("CARGO_PKG_VERSION")
        }),
    );
    let Some(_guard) = acquire_single_instance_guard() else {
        return;
    };
    let show_update = commands::startup_should_show_update();

    // 启动内嵌 Helper Server
    let helper_handle: HelperHandle = Mutex::new(None);
    let helper_port = commands::default_helper_port();
    let helper_started = tauri::async_runtime::block_on(async {
        match ucodex_core::launcher::start_standalone_helper(helper_port).await {
            Ok(handle) => {
                let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
                    "manager.embedded_helper_started",
                    serde_json::json!({ "port": helper_port }),
                );
                *helper_handle.lock().unwrap() = Some(handle);
                true
            }
            Err(error) => {
                let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
                    "manager.embedded_helper_failed",
                    serde_json::json!({ "port": helper_port, "error": error.to_string() }),
                );
                false
            }
        }
    });

    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(helper_handle)
        .setup(move |app| {
            let url = if show_update {
                "index.html?showUpdate=1"
            } else if helper_started {
                "index.html"
            } else {
                "index.html"
            };
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App(url.into()))
                .title("Ucodex 管理工具")
                .inner_size(1180.0, 820.0)
                .min_inner_size(960.0, 720.0)
                .transparent(true)
                .build()?;

            // ── 系统托盘图标 ──────────────────────
            // ── 系统托盘图标 + 实时状态轮询 ────────
            let status_item = MenuItemBuilder::new(if helper_started {
                "● Helper 运行中"
            } else {
                "○ Helper 未运行"
            }).id("tray_status").build(app)?;
            let tokens_item = MenuItemBuilder::new("Tokens: 等待数据...").id("tray_tokens").build(app)?;
            let show_item = MenuItemBuilder::new("打开管理工具").id("tray_show").build(app)?;
            let panel_item = MenuItemBuilder::new("📊 状态面板").id("tray_panel").build(app)?;
            let quit_item = MenuItemBuilder::new("退出").id("tray_quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&status_item, &tokens_item, &PredefinedMenuItem::separator(app)?, &show_item, &panel_item, &PredefinedMenuItem::separator(app)?, &quit_item])
                .build()?;

            let menu_status = status_item.clone();
            let menu_tokens = tokens_item.clone();
            let helper_port_for_poll = helper_port;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    panic!("no default icon")
                }))
                .menu(&menu)
                .tooltip("Ucodex Helper")
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "tray_show" | "tray_status" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "tray_panel" => {
                            show_status_overlay(app.clone());
                        }
                        "tray_quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_status_overlay(app.clone());
                    }
                })
                .build(app)?;

            // ── 后台轮询：每 5 秒探活 + 更新菜单 ──
            let app_handle = app.handle().clone();
            let menu_status_clone = menu_status.clone();
            let menu_tokens_clone = menu_tokens.clone();
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(2))
                    .build()
                    .unwrap_or_default();
                let helper_url = format!("http://127.0.0.1:{helper_port_for_poll}");
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

                    // 探活
                    let alive = client
                        .post(format!("{helper_url}/backend/status"))
                        .body("{}")
                        .send()
                        .await
                        .map(|r| r.status().is_success())
                        .unwrap_or(false);

                    let _ = menu_status_clone.set_text(
                        if alive { "● Helper 运行中" } else { "○ Helper 未运行" }
                    );

                    // 读取 token 统计
                    if alive {
                        if let Ok(resp) = client
                            .get(format!("{helper_url}/proxy-stats"))
                            .send()
                            .await
                        {
                            if let Ok(stats) = resp.json::<serde_json::Value>().await {
                                let total = stats.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let errors = stats.get("total_errors").and_then(|v| v.as_u64()).unwrap_or(0);
                                let total_prompt = stats.get("total_prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let total_completion = stats.get("total_completion_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let total_cost = stats.get("total_cost").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                let avg_latency = stats.get("avg_latency_ms").and_then(|v| v.as_u64()).unwrap_or(0);
                                let token_text = format!(
                                    "Req {} │ In {} │ Out {} │ Cached {} │ {}",
                                    format_token_count(total),
                                    format_token_count(total_prompt),
                                    format_token_count(total_completion),
                                    format_token_count(total_cached),
                                    format_cost_display(total_cost),
                                );
                                let _ = menu_tokens_clone.set_text(&token_text);

                                // 更新 tooltip
                                let total_cached = stats.get("total_cached_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let total_reasoning = stats.get("total_reasoning_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                                let tooltip = format!(
                                    "Ucodex Helper\nReq {} │ Err {} │ {}ms │ {}\nIn {} │ Cached {} │ Out {} │ Reason {}",
                                    format_token_count(total),
                                    errors,
                                    avg_latency,
                                    format_cost_display(total_cost),
                                    format_token_count(total_prompt),
                                    format_token_count(total_cached),
                                    format_token_count(total_completion),
                                    format_token_count(total_reasoning),
                                );
                                let _ = app_handle.tray_by_id("main").map(|t| t.set_tooltip(Some(&tooltip)));
                            }
                        }
                    } else {
                        let _ = menu_tokens_clone.set_text("Tokens: 无法连接");
                    }

                    // 更新 overlay 窗口（如果打开的话）
                    if let Some(overlay) = app_handle.get_webview_window("status-overlay") {
                        let _ = tauri::Emitter::emit(&overlay, "helper-status-update", serde_json::json!({
                            "alive": alive,
                        }));
                    }
                }
            });

            // ── 创建隐藏的 overlay 窗口（按需显示） ──
            let overlay_url = "index.html#status-overlay";
            tauri::WebviewWindowBuilder::new(
                app,
                "status-overlay",
                tauri::WebviewUrl::App(overlay_url.into()),
            )
            .title("Ucodex 状态")
            .inner_size(260.0, 380.0)
            .decorations(false)
            .always_on_top(true)
            .visible(false)
            .skip_taskbar(true)
            .resizable(false)
            .transparent(true)
            .effects(
                EffectsBuilder::new()
                    .effect(Effect::Popover)
                    .state(EffectState::Active)
                    .build(),
            )
            .build()?;


            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::backend_version,
            commands::startup_options,
            commands::load_overview,
            commands::launch_ucodex,
            commands::restart_ucodex,
            commands::launch_codex_app_only,
            commands::load_settings,
            commands::save_settings,
            commands::list_local_sessions,
            commands::delete_local_session,
            commands::load_ccs_providers,
            commands::import_ccs_providers,
            commands::load_provider_sync_targets,
            commands::sync_providers_now,
            commands::refresh_script_market,
            commands::install_market_script,
            commands::set_user_script_enabled,
            commands::delete_user_script,
            commands::open_external_url,
            commands::install_entrypoints,
            commands::uninstall_entrypoints,
            commands::repair_shortcuts,
            commands::repair_backend,
            commands::check_update,
            commands::perform_update,
            commands::load_watcher_state,
            commands::install_watcher,
            commands::uninstall_watcher,
            commands::enable_watcher,
            commands::disable_watcher,
            commands::read_latest_logs,
            commands::copy_diagnostics,
            commands::reset_settings,
            commands::relay_status,
            commands::read_relay_files,
            commands::save_relay_file,
            commands::write_diagnostic_event,
            commands::backfill_relay_profile_from_live,
            commands::list_context_entries,
            commands::read_live_context_entries,
            commands::sync_live_context_entries,
            commands::upsert_context_entry,
            commands::delete_context_entry,
            commands::extract_relay_common_config,
            commands::test_relay_profile,
            commands::fetch_relay_profile_models,
            commands::apply_relay_injection,
            commands::apply_pure_api_injection,
            commands::clear_relay_injection,
            commands::load_proxy_stats,
            commands::load_stats_history,
            commands::load_stats_hourly_for_date,
            commands::load_codex_config,
            commands::save_codex_features,
            commands::save_codex_feature,
            commands::save_codex_mcp_servers,
            commands::save_codex_plugins,
            commands::save_codex_projects,
            commands::save_codex_notify,
            commands::save_codex_raw_toml,
            commands::save_codex_root_keys,
            commands::save_codex_model_providers,
            commands::get_config_migration_status,
            commands::run_config_migrations,
            commands::list_codex_processes,
            commands::kill_codex_process_by_pid,
            commands::kill_all_codex_processes,
            commands::quick_launch_helper,
            commands::set_floating_mode
        ])
        .run(tauri::generate_context!());
    if let Err(error) = run_result {
        let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
            "manager.run_failed",
            serde_json::json!({
                "error": error.to_string()
            }),
        );
    }
}

fn install_panic_logger() {
    std::panic::set_hook(Box::new(|panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "非字符串 panic payload".to_string());
        let location = panic_info.location().map(|location| {
            serde_json::json!({
                "file": location.file(),
                "line": location.line(),
                "column": location.column()
            })
        });
        let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
            "manager.panic",
            serde_json::json!({
                "payload": payload,
                "location": location
            }),
        );
    }));
}

fn acquire_single_instance_guard() -> Option<ucodex_core::ports::LoopbackPortGuard> {
    match ucodex_core::ports::acquire_resilient_loopback_port_guard(
        ucodex_core::ports::MANAGER_GUARD_PORT,
    ) {
        Ok(guard) => {
            if let Some(fallback_lock_path) = guard.fallback_path() {
                let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
                    "manager.guard_fallback",
                    serde_json::json!({
                        "requested_guard_port": ucodex_core::ports::MANAGER_GUARD_PORT,
                        "fallback_lock_path": fallback_lock_path
                    }),
                );
            }
            Some(guard)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
            let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
                "manager.already_running",
                serde_json::json!({
                    "guard_port": ucodex_core::ports::MANAGER_GUARD_PORT
                }),
            );
            None
        }
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
            let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
                "manager.already_running",
                serde_json::json!({
                    "guard_port": ucodex_core::ports::MANAGER_GUARD_PORT
                }),
            );
            None
        }
        Err(error) => {
            let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
                "manager.guard_failed",
                serde_json::json!({
                    "guard_port": ucodex_core::ports::MANAGER_GUARD_PORT,
                    "error": error.to_string()
                }),
            );
            match std::net::TcpListener::bind(("127.0.0.1", 0)) {
                Ok(listener) => Some(ucodex_core::ports::LoopbackPortGuard::listener(
                    listener,
                )),
                Err(fallback_error) => {
                    let _ = ucodex_core::diagnostic_log::append_diagnostic_log(
                        "manager.guard_fallback_failed",
                        serde_json::json!({
                            "error": fallback_error.to_string()
                        }),
                    );
                    None
                }
            }
        }
    }
}
use tauri::{
    Manager, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    window::{EffectsBuilder, Effect, EffectState},
};

fn format_token_count(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{}M", n / 1_000_000)
    } else if n >= 1_000 {
        format!("{}K", n / 1_000)
    } else {
        n.to_string()
    }
}

fn format_cost_display(cost: f64) -> String {
    let m = cost / 1_000_000.0;
    if m >= 1.0 {
        format!("{:.1} M Cr", m)
    } else if m >= 0.001 {
        format!("{:.1} K Cr", m * 1000.0)
    } else {
        format!("{:.0} Cr", cost)
    }
}

fn show_status_overlay(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(overlay) = app.get_webview_window("status-overlay") {
        if overlay.is_visible().unwrap_or(false) {
            let _ = overlay.hide();
            return;
        }
        if let Ok(Some(monitor)) = overlay.primary_monitor() {
            let scale = monitor.scale_factor();
            // primary_monitor().position() 和 size() 返回物理像素
            let mon_x = monitor.position().x;
            let mon_w = monitor.size().width as i32;
            let bar_h = (24.0 * scale) as i32;
            let margin = (10.0 * scale) as i32;
            let win_w = (260.0 * scale) as i32;

            let x = mon_x + mon_w - win_w - margin;
            let y = monitor.position().y + bar_h;
            let _ = overlay.set_position(tauri::PhysicalPosition::new(x, y));
        }
        let _ = overlay.show();
        // 30 秒后自动隐藏
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            if let Some(w) = handle.get_webview_window("status-overlay") {
                let _ = w.hide();
            }
        });
    }
}
