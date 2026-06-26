//! Config.toml 迁移版本管理
//!
//! 通过在 config.toml 中维护一个隐藏的 `[ucodex_internal]` 区块来追踪
//! 当前配置版本号。迁移链是一系列版本步进函数 (v0→v1→v2→…),
//! 每个函数只做增量修改，不改变已有数据。
//!
//! 约定：
//! - 版本号从 1 开始（无版本标记视为 0）
//! - `[ucodex_internal]` 区块仅包含 `config_version`，不存储用户数据
//! - 迁移函数只添加/重命名键，绝不删除用户数据
//! - 迁移前自动备份

use std::path::Path;

use anyhow::Context;
use toml_edit::DocumentMut;

use crate::relay_config::{
    ensure_trailing_newline, normalize_duplicate_toml_text, parse_toml_document,
};

// ───────────────────── 版本读写 ─────────────────────

/// 读取当前配置版本（无标记视为 0）
pub fn get_config_version(home: &Path) -> anyhow::Result<u32> {
    let config_path = home.join("config.toml");
    let raw = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&raw);
    let doc = parse_toml_document(&normalized).unwrap_or_else(|_| DocumentMut::new());

    Ok(doc
        .get("ucodex_internal")
        .and_then(|item| item.get("config_version"))
        .and_then(|v| v.as_value())
        .and_then(|v| v.as_integer())
        .unwrap_or(0) as u32)
}

/// 写入配置版本号到 `[ucodex_internal]` 区块
pub fn set_config_version(home: &Path, version: u32) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let raw = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&raw);
    let mut doc = parse_toml_document(&normalized)?;

    if !doc.contains_key("ucodex_internal") {
        doc["ucodex_internal"] = toml_edit::table();
    }
    let internal = doc
        .get_mut("ucodex_internal")
        .and_then(toml_edit::Item::as_table_mut)
        .ok_or_else(|| anyhow::anyhow!("ucodex_internal 必须是 table"))?;
    internal["config_version"] = toml_edit::value(version as i64);

    // 删除注释残留：确保 ucodex_internal 区块始终干净
    let content = ensure_trailing_newline(doc.to_string());
    std::fs::create_dir_all(home)?;
    crate::settings::atomic_write(&config_path, content.as_bytes())
        .with_context(|| "写入 config_version 失败")
}

// ───────────────────── 迁移定义 ─────────────────────

/// 当前最新配置版本号
///
/// 每次添加新迁移时递增此值，并添加对应的 `migrate_vN` 函数。
pub const LATEST_CONFIG_VERSION: u32 = 2;

/// 迁移函数类型：接收 &mut DocumentMut，就地修改
type MigrationFn = fn(&mut DocumentMut) -> anyhow::Result<()>;

/// 返回从 `from_version` 到 `from_version + 1` 的迁移函数
///
/// None 表示该版本无需迁移（版本号仍然递增，但不改内容）
fn migration_for_version(from_version: u32) -> Option<MigrationFn> {
    match from_version {
        0 => Some(migrate_v0_to_v1),
        1 => Some(migrate_v1_to_v2),
        // 未来迁移在此添加：
        // 2 => Some(migrate_v2_to_v3),
        _ => None,
    }
}

// ───────────────────── 迁移执行 ─────────────────────

/// 执行所有待处理的迁移
///
/// 返回是否实际执行了迁移（用于 UI 提示是否需要重启）。
pub fn run_pending_migrations(home: &Path) -> anyhow::Result<bool> {
    let current = get_config_version(home)?;
    if current >= LATEST_CONFIG_VERSION {
        return Ok(false);
    }

    // 备份原始配置
    let config_path = home.join("config.toml");
    if config_path.exists() {
        let backup_dir = home
            .join("backups")
            .join(format!("config-migration-v{}", current));
        let _ = std::fs::create_dir_all(&backup_dir);
        let _ = std::fs::copy(&config_path, backup_dir.join("config.toml"));
    }

    let raw = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&raw);
    let mut doc = parse_toml_document(&normalized)?;

    let mut migrated = false;
    for ver in current..LATEST_CONFIG_VERSION {
        if let Some(migration_fn) = migration_for_version(ver) {
            migration_fn(&mut doc)?;
            migrated = true;
        }
        // 写入版本号（即使迁移函数为 None，版本号也要递增）
        if !doc.contains_key("ucodex_internal") {
            doc["ucodex_internal"] = toml_edit::table();
        }
        if let Some(internal) = doc.get_mut("ucodex_internal") {
            if let Some(table) = internal.as_table_mut() {
                table["config_version"] = toml_edit::value((ver + 1) as i64);
            }
        }
    }

    let content = ensure_trailing_newline(doc.to_string());
    std::fs::create_dir_all(home)?;
    crate::settings::atomic_write(&config_path, content.as_bytes())
        .with_context(|| "写入迁移后 config.toml 失败")?;

    Ok(migrated)
}

// ───────────────────── 迁移链 ─────────────────────

/// v0 → v1: 初始化版本标记
///
/// 无实际数据修改，仅写入版本号标记已进入迁移管理系统。
fn migrate_v0_to_v1(_doc: &mut DocumentMut) -> anyhow::Result<()> {
    // 初始版本，无需修改数据
    Ok(())
}

/// v1 → v2: 预留迁移示例
///
/// 此迁移为空，作为模板展示如何添加新迁移。
/// 实际使用时替换为真实逻辑。
fn migrate_v1_to_v2(_doc: &mut DocumentMut) -> anyhow::Result<()> {
    // 示例：重命名一个已废弃的键
    // if doc.get("old_key").is_some() {
    //     let value = doc["old_key"].clone();
    //     doc["new_key"] = value;
    //     doc.as_table_mut().remove("old_key");
    // }
    Ok(())
}

// ───────────────────── 信息查询 ─────────────────────

/// 迁移状态快照（供 UI 展示）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStatus {
    /// 当前配置版本
    pub current_version: u32,
    /// 最新可用版本
    pub latest_version: u32,
    /// 是否有待执行的迁移
    pub has_pending: bool,
    /// 待执行的迁移版本列表
    pub pending_versions: Vec<u32>,
}

/// 获取当前迁移状态
pub fn get_migration_status(home: &Path) -> anyhow::Result<MigrationStatus> {
    let current = get_config_version(home)?;
    let pending: Vec<u32> = (current..LATEST_CONFIG_VERSION)
        .filter(|&v| migration_for_version(v).is_some())
        .collect();

    Ok(MigrationStatus {
        current_version: current,
        latest_version: LATEST_CONFIG_VERSION,
        has_pending: !pending.is_empty(),
        pending_versions: pending,
    })
}

// ───────────────────── 测试 ─────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn default_version_is_zero() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("config.toml"), "model = \"gpt-5.4\"\n").unwrap();
        assert_eq!(get_config_version(dir.path()).unwrap(), 0);
    }

    #[test]
    fn set_and_read_version() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("config.toml"), "model = \"gpt-5.4\"\n").unwrap();

        set_config_version(dir.path(), 1).unwrap();
        assert_eq!(get_config_version(dir.path()).unwrap(), 1);

        // 确保原有数据未被破坏
        let raw = fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(raw.contains("gpt-5.4"));
    }

    #[test]
    fn run_migrations_from_zero() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join("config.toml"),
            "[features]\njs_repl = true\n",
        )
        .unwrap();

        let migrated = run_pending_migrations(dir.path()).unwrap();
        assert!(migrated);
        assert_eq!(
            get_config_version(dir.path()).unwrap(),
            LATEST_CONFIG_VERSION
        );

        // 原始数据保留
        let raw = fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(raw.contains("js_repl = true"));
    }

    #[test]
    fn no_migration_when_up_to_date() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("config.toml"), "").unwrap();
        set_config_version(dir.path(), LATEST_CONFIG_VERSION).unwrap();

        let migrated = run_pending_migrations(dir.path()).unwrap();
        assert!(!migrated);
    }

    #[test]
    fn migration_preserves_existing_content() {
        let dir = TempDir::new().unwrap();
        let original = r#"model = "gpt-5.4"
model_provider = "custom"

[features]
js_repl = false
goals = true

[mcp_servers.my_server]
command = "my_server"
args = ["--verbose"]

[mcp_servers.my_server.env]
API_KEY = "secret"
"#;
        fs::write(dir.path().join("config.toml"), original).unwrap();

        run_pending_migrations(dir.path()).unwrap();

        let migrated = fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(migrated.contains("gpt-5.4"));
        assert!(migrated.contains("js_repl = false"));
        assert!(migrated.contains("my_server"));
        assert!(migrated.contains("API_KEY = \"secret\""));
    }

    #[test]
    fn migration_status_report() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("config.toml"), "").unwrap();

        let status = get_migration_status(dir.path()).unwrap();
        assert_eq!(status.current_version, 0);
        assert_eq!(status.latest_version, LATEST_CONFIG_VERSION);
        assert!(status.has_pending);
    }
}
