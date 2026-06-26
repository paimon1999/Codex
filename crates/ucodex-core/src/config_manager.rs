//! Config.toml 全量管理模块
//!
//! 提供对 `~/.codex/config.toml` 中所有区块的结构化读写能力，
//! 使用 `toml_edit` 保留原始格式和注释。

use std::path::Path;

use anyhow::Context;
use serde_json::Value as JsonValue;
use toml_edit::{DocumentMut, Item, Table};

use crate::config_migration::run_pending_migrations;
use crate::relay_config::{
    default_codex_home_dir, ensure_trailing_newline, normalize_duplicate_toml_text,
    parse_toml_document, table_mut_or_insert,
};

// ───────────────────────────── 公共类型 ─────────────────────────────

/// config.toml 完整结构化快照
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConfigSnapshot {
    /// config.toml 原始文本
    pub raw_toml: String,
    /// 根级键值对（不含 table/array of tables）
    pub root_keys: JsonValue,
    /// [features] 区块
    pub features: JsonValue,
    /// [mcp_servers.*] 区块
    pub mcp_servers: JsonValue,
    /// [plugins.*] 区块
    pub plugins: JsonValue,
    /// [projects.*] 区块
    pub projects: JsonValue,
    /// [marketplaces.*] 区块
    pub marketplaces: JsonValue,
    /// notify 数组
    pub notify: JsonValue,
    /// [model_providers.*] 区块（供应商）
    pub model_providers: JsonValue,
    /// [profiles.*] 区块
    pub profiles: JsonValue,
    /// [skills.*] 区块
    pub skills: JsonValue,
}

// ───────────────────────────── 读取 ─────────────────────────────

/// 读取 config.toml 并返回结构化快照
///
/// 加载前会自动执行待处理的配置迁移，确保返回的数据始终是最新格式。
pub fn load_codex_config(home: &Path) -> anyhow::Result<CodexConfigSnapshot> {
    // 自动迁移
    let _ = run_pending_migrations(home);

    let config_path = home.join("config.toml");
    let raw = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&raw);
    let doc = parse_toml_document(&normalized).unwrap_or_else(|_| DocumentMut::new());

    let root_keys = extract_root_keys(&doc);
    let features = extract_table_as_json(&doc, "features");
    let mcp_servers = extract_dotted_tables_as_json(&doc, "mcp_servers");
    let plugins = extract_dotted_tables_as_json(&doc, "plugins");
    let projects = extract_dotted_tables_as_json(&doc, "projects");
    let marketplaces = extract_dotted_tables_as_json(&doc, "marketplaces");
    let notify = extract_array_as_json(&doc, "notify");
    let model_providers = extract_dotted_tables_as_json(&doc, "model_providers");
    let profiles = extract_dotted_tables_as_json(&doc, "profiles");
    let skills = extract_dotted_tables_as_json(&doc, "skills");

    Ok(CodexConfigSnapshot {
        raw_toml: raw,
        root_keys,
        features,
        mcp_servers,
        plugins,
        projects,
        marketplaces,
        notify,
        model_providers,
        profiles,
        skills,
    })
}

/// 用默认 codex home 读取
pub fn load_codex_config_from_home() -> anyhow::Result<CodexConfigSnapshot> {
    load_codex_config(&default_codex_home_dir())
}

// ───────────────────────────── 写入 ─────────────────────────────

/// 保存 [features] 区块
///
/// `features` 应为 `{"js_repl": false, "goals": true}` 格式的 JSON 对象。
/// 空对象会移除整个 `[features]` 区块。
pub fn save_codex_features(home: &Path, features: &JsonValue) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    match features {
        JsonValue::Object(map) => {
            if map.is_empty() {
                doc.as_table_mut().remove("features");
            } else {
                let table = table_mut_or_insert(&mut doc, "features")?;
                // 先清除旧值
                let keys: Vec<String> = table.iter().map(|(k, _)| k.to_string()).collect();
                for k in &keys {
                    table.remove(k);
                }
                for (k, v) in map {
                    table[k] = toml_edit::Item::Value(json_value_to_toml(v));
                }
            }
        }
        _ => anyhow::bail!("features 必须是 JSON 对象"),
    }

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

/// 保存单个 feature 开关
pub fn save_codex_feature(home: &Path, key: &str, value: bool) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    let features = table_mut_or_insert(&mut doc, "features")?;
    features[key] = toml_edit::value(value);

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

/// 保存 [mcp_servers.*] 区块
///
/// `servers` 应为 `{"server_id": {"command": "...", "args": [...], "env": {...}}}` 格式。
pub fn save_codex_mcp_servers(home: &Path, servers: &JsonValue) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    // 移除旧的 mcp_servers
    doc.as_table_mut().remove("mcp_servers");

    if let JsonValue::Object(map) = servers {
        if !map.is_empty() {
            let parent = table_mut_or_insert(&mut doc, "mcp_servers")?;
            for (server_id, server_config) in map {
                if let JsonValue::Object(props) = server_config {
                    if !parent.contains_key(&server_id) {
                        parent[&server_id] = toml_edit::table();
                    }
                    let table = parent.get_mut(&server_id).and_then(Item::as_table_mut)
                        .ok_or_else(|| anyhow::anyhow!("{server_id} 必须是 TOML table"))?;
                    for (k, v) in props {
                        if k == "env" {
                            // env 是嵌套表
                            if let JsonValue::Object(env_map) = v {
                                let env_table = table_mut_or_insert_table(table, "env")?;
                                for (ek, ev) in env_map {
                                    env_table[ek] = toml_edit::Item::Value(json_value_to_toml(ev));
                                }
                            }
                        } else {
                            table[k] = toml_edit::Item::Value(json_value_to_toml(v));
                        }
                    }
                }
            }
        }
    }

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

/// 保存 [plugins.*] 区块
///
/// `plugins` 应为 `{"plugin_id": {"enabled": true}}` 格式。
pub fn save_codex_plugins(home: &Path, plugins: &JsonValue) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    doc.as_table_mut().remove("plugins");

    if let JsonValue::Object(map) = plugins {
        if !map.is_empty() {
            let parent = table_mut_or_insert(&mut doc, "plugins")?;
            for (plugin_id, plugin_config) in map {
                if let JsonValue::Object(props) = plugin_config {
                    if !parent.contains_key(&plugin_id) {
                        parent[&plugin_id] = toml_edit::table();
                    }
                    let table = parent.get_mut(&plugin_id).and_then(Item::as_table_mut)
                        .ok_or_else(|| anyhow::anyhow!("{plugin_id} 必须是 TOML table"))?;
                    for (k, v) in props {
                        table[k] = toml_edit::Item::Value(json_value_to_toml(v));
                    }
                }
            }
        }
    }

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

/// 保存 [projects.*] 区块
pub fn save_codex_projects(home: &Path, projects: &JsonValue) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    doc.as_table_mut().remove("projects");

    if let JsonValue::Object(map) = projects {
        if !map.is_empty() {
            let parent = table_mut_or_insert(&mut doc, "projects")?;
            for (path, project_config) in map {
                if let JsonValue::Object(props) = project_config {
                    if !parent.contains_key(&path) {
                        parent[&path] = toml_edit::table();
                    }
                    let table = parent.get_mut(&path).and_then(Item::as_table_mut)
                        .ok_or_else(|| anyhow::anyhow!("{path} 必须是 TOML table"))?;
                    for (k, v) in props {
                        table[k] = toml_edit::Item::Value(json_value_to_toml(v));
                    }
                }
            }
        }
    }

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

/// 保存 notify 数组
pub fn save_codex_notify(home: &Path, notify: &JsonValue) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    match notify {
        JsonValue::Array(arr) => {
            if arr.is_empty() {
                doc.as_table_mut().remove("notify");
            } else {
                let mut toml_arr = toml_edit::Array::new();
                for item in arr {
                    if let Some(s) = item.as_str() {
                        toml_arr.push(s);
                    }
                }
                doc["notify"] = toml_edit::value(toml_arr);
            }
        }
        JsonValue::Null => {
            doc.as_table_mut().remove("notify");
        }
        _ => anyhow::bail!("notify 必须是数组或 null"),
    }

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

/// 保存原始 TOML 文本（全文替换）
///
/// 会先验证 TOML 格式合法性，再原子写入。
pub fn save_codex_raw_toml(home: &Path, raw_toml: &str) -> anyhow::Result<()> {
    // 验证 TOML 格式
    raw_toml
        .parse::<toml::Table>()
        .with_context(|| "config.toml 不是有效的 TOML 格式")?;
    write_config_atomic(home, raw_toml)
}

/// 保存 [model_providers.*] 区块（供应商定义）
pub fn save_codex_model_providers(home: &Path, providers: &JsonValue) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    doc.as_table_mut().remove("model_providers");

    if let JsonValue::Object(map) = providers {
        if !map.is_empty() {
            let parent = table_mut_or_insert(&mut doc, "model_providers")?;
            for (provider_id, provider_config) in map {
                if let JsonValue::Object(props) = provider_config {
                    if !parent.contains_key(&provider_id) {
                        parent[&provider_id] = toml_edit::table();
                    }
                    let table = parent.get_mut(&provider_id).and_then(Item::as_table_mut)
                        .ok_or_else(|| anyhow::anyhow!("{provider_id} 必须是 TOML table"))?;
                    for (k, v) in props {
                        table[k] = toml_edit::Item::Value(json_value_to_toml(v));
                    }
                }
            }
        }
    }

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

/// 保存根级键值对
///
/// `keys` 应为 `{"model": "gpt-5.4", "model_provider": "custom"}` 格式。
/// 值为 null 的键会被移除。
pub fn save_codex_root_keys(home: &Path, keys: &JsonValue) -> anyhow::Result<()> {
    let config_path = home.join("config.toml");
    let existing = std::fs::read_to_string(&config_path).unwrap_or_default();
    let normalized = normalize_duplicate_toml_text(&existing);
    let mut doc = parse_toml_document(&normalized)?;

    if let JsonValue::Object(map) = keys {
        for (k, v) in map {
            if v.is_null() {
                doc.as_table_mut().remove(k);
            } else {
                doc[k] = toml_edit::Item::Value(json_value_to_toml(v));
            }
        }
    }

    let updated = ensure_trailing_newline(doc.to_string());
    write_config_atomic(home, &updated)
}

// ───────────────────────────── 内部工具 ─────────────────────────────

/// 提取根级键值对（排除 table 和 array of tables）
fn extract_root_keys(doc: &DocumentMut) -> JsonValue {
    let mut map = serde_json::Map::new();
    for (key, item) in doc.as_table().iter() {
        match item {
            Item::Value(v) => {
                map.insert(key.to_string(), toml_value_to_json(v));
            }
            // 跳过 table 和 array of tables，它们由各自的提取函数处理
            _ => {}
        }
    }
    JsonValue::Object(map)
}

/// 提取简单 table 为 JSON
fn extract_table_as_json(doc: &DocumentMut, key: &str) -> JsonValue {
    match doc.get(key).and_then(Item::as_table) {
        Some(table) => toml_table_to_json(table),
        None => JsonValue::Object(serde_json::Map::new()),
    }
}

/// 提取带点号的 table（如 mcp_servers.foo）为嵌套 JSON
///
/// TOML 中 `[mcp_servers.foo]` 在 `toml_edit` 中表示为 `doc["mcp_servers"]["foo"]`。
fn extract_dotted_tables_as_json(doc: &DocumentMut, top_key: &str) -> JsonValue {
    match doc.get(top_key).and_then(Item::as_table) {
        Some(table) => toml_table_to_json(table),
        None => JsonValue::Object(serde_json::Map::new()),
    }
}

/// 提取数组为 JSON
fn extract_array_as_json(doc: &DocumentMut, key: &str) -> JsonValue {
    match doc.get(key) {
        Some(Item::Value(toml_edit::Value::Array(arr))) => {
            let items: Vec<JsonValue> = arr.iter().map(toml_value_to_json).collect();
            JsonValue::Array(items)
        }
        Some(Item::Value(v)) => toml_value_to_json(v),
        _ => JsonValue::Array(vec![]),
    }
}

/// TOML Table → serde_json::Value
fn toml_table_to_json(table: &Table) -> JsonValue {
    let mut map = serde_json::Map::new();
    for (key, item) in table.iter() {
        match item {
            Item::Value(v) => {
                map.insert(key.to_string(), toml_value_to_json(v));
            }
            Item::Table(t) => {
                map.insert(key.to_string(), toml_table_to_json(t));
            }
            Item::ArrayOfTables(arr) => {
                let items: Vec<JsonValue> = arr.iter().map(toml_table_to_json).collect();
                map.insert(key.to_string(), JsonValue::Array(items));
            }
            _ => {}
        }
    }
    JsonValue::Object(map)
}

/// TOML Value → serde_json::Value
fn toml_value_to_json(value: &toml_edit::Value) -> JsonValue {
    match value {
        toml_edit::Value::String(s) => JsonValue::String(s.value().to_string()),
        toml_edit::Value::Integer(i) => JsonValue::Number((*i.value()).into()),
        toml_edit::Value::Float(f) => {
            if let Some(n) = serde_json::Number::from_f64(*f.value()) {
                JsonValue::Number(n)
            } else {
                JsonValue::Null
            }
        }
        toml_edit::Value::Boolean(b) => JsonValue::Bool(*b.value()),
        toml_edit::Value::Datetime(dt) => JsonValue::String(dt.value().to_string()),
        toml_edit::Value::Array(arr) => {
            let items: Vec<JsonValue> = arr.iter().map(toml_value_to_json).collect();
            JsonValue::Array(items)
        }
        toml_edit::Value::InlineTable(t) => {
            let mut map = serde_json::Map::new();
            for (k, v) in t.iter() {
                map.insert(k.to_string(), toml_value_to_json(v));
            }
            JsonValue::Object(map)
        }
    }
}

/// serde_json::Value → toml_edit::Value
fn json_value_to_toml(value: &JsonValue) -> toml_edit::Value {
    match value {
        JsonValue::String(s) => toml_edit::Value::from(s.as_str()),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                toml_edit::Value::from(i)
            } else if let Some(f) = n.as_f64() {
                toml_edit::Value::from(f)
            } else {
                toml_edit::Value::from(0)
            }
        }
        JsonValue::Bool(b) => toml_edit::Value::from(*b),
        JsonValue::Null => toml_edit::Value::from(""),
        JsonValue::Array(arr) => {
            let mut toml_arr = toml_edit::Array::new();
            for item in arr {
                toml_arr.push(json_value_to_toml(item));
            }
            toml_edit::Value::Array(toml_arr)
        }
        JsonValue::Object(map) => {
            let mut inline = toml_edit::InlineTable::new();
            for (k, v) in map {
                inline.insert(k, json_value_to_toml(v));
            }
            toml_edit::Value::InlineTable(inline)
        }
    }
}

/// 在已有的 Table 中创建或获取嵌套子表
fn table_mut_or_insert_table<'a>(
    table: &'a mut Table,
    key: &str,
) -> anyhow::Result<&'a mut Table> {
    if !table.contains_key(key) {
        table[key] = toml_edit::table();
    }
    if table.get(key).and_then(Item::as_table).is_none() {
        table[key] = toml_edit::table();
    }
    table
        .get_mut(key)
        .and_then(Item::as_table_mut)
        .ok_or_else(|| anyhow::anyhow!("{key} 必须是 TOML table"))
}

/// 原子写入 config.toml（带备份）
fn write_config_atomic(home: &Path, content: &str) -> anyhow::Result<()> {
    std::fs::create_dir_all(home)?;
    let config_path = home.join("config.toml");

    // 验证
    content
        .parse::<toml::Table>()
        .with_context(|| "写入失败：生成的 TOML 格式不合法")?;

    // 备份
    if config_path.exists() {
        let backup_dir = home
            .join("backups")
            .join(format!("config-{}", chrono_timestamp()));
        let _ = std::fs::create_dir_all(&backup_dir);
        let _ = std::fs::copy(&config_path, backup_dir.join("config.toml"));
    }

    crate::settings::atomic_write(&config_path, content.as_bytes())
        .with_context(|| "写入 config.toml 失败")
}

fn chrono_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

// ───────────────────────────── 测试 ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn load_and_save_features() {
        let dir = TempDir::new().unwrap();
        let home = dir.path();
        fs::write(
            home.join("config.toml"),
            "[features]\njs_repl = false\ngoals = true\n",
        )
        .unwrap();

        let snapshot = load_codex_config(home).unwrap();
        assert_eq!(snapshot.features["js_repl"], JsonValue::Bool(false));
        assert_eq!(snapshot.features["goals"], JsonValue::Bool(true));

        // 修改
        let mut new_features = serde_json::Map::new();
        new_features.insert("js_repl".into(), JsonValue::Bool(true));
        new_features.insert("goals".into(), JsonValue::Bool(false));
        save_codex_features(home, &JsonValue::Object(new_features)).unwrap();

        let snapshot = load_codex_config(home).unwrap();
        assert_eq!(snapshot.features["js_repl"], JsonValue::Bool(true));
        assert_eq!(snapshot.features["goals"], JsonValue::Bool(false));
    }

    #[test]
    fn load_and_save_mcp_servers() {
        let dir = TempDir::new().unwrap();
        let home = dir.path();
        fs::write(
            home.join("config.toml"),
            r#"[mcp_servers.node_repl]
args = []
command = "node_repl"
startup_timeout_sec = 120

[mcp_servers.node_repl.env]
NODE_PATH = "/usr/bin/node"
"#,
        )
        .unwrap();

        let snapshot = load_codex_config(home).unwrap();
        assert_eq!(
            snapshot.mcp_servers["node_repl"]["command"],
            JsonValue::String("node_repl".into())
        );
        assert_eq!(
            snapshot.mcp_servers["node_repl"]["env"]["NODE_PATH"],
            JsonValue::String("/usr/bin/node".into())
        );
    }

    #[test]
    fn load_and_save_plugins() {
        let dir = TempDir::new().unwrap();
        let home = dir.path();
        fs::write(
            home.join("config.toml"),
            r#"[plugins."browser@openai-bundled"]
enabled = true
"#,
        )
        .unwrap();

        let snapshot = load_codex_config(home).unwrap();
        assert_eq!(
            snapshot.plugins["browser@openai-bundled"]["enabled"],
            JsonValue::Bool(true)
        );
    }

    #[test]
    fn load_and_save_notify() {
        let dir = TempDir::new().unwrap();
        let home = dir.path();
        fs::write(
            home.join("config.toml"),
            r#"notify = ["/usr/bin/say", "turn-ended"]
"#,
        )
        .unwrap();

        let snapshot = load_codex_config(home).unwrap();
        assert_eq!(snapshot.notify.as_array().unwrap().len(), 2);
        assert_eq!(snapshot.notify[0], JsonValue::String("/usr/bin/say".into()));
    }

    #[test]
    fn save_raw_toml_validates() {
        let dir = TempDir::new().unwrap();
        let home = dir.path();

        // 有效 TOML
        assert!(save_codex_raw_toml(home, "model = \"gpt-5.4\"\n").is_ok());

        // 无效 TOML
        assert!(save_codex_raw_toml(home, "this is not [valid toml").is_err());
    }

    #[test]
    fn empty_config_returns_defaults() {
        let dir = TempDir::new().unwrap();
        let snapshot = load_codex_config(dir.path()).unwrap();
        assert_eq!(snapshot.features, JsonValue::Object(serde_json::Map::new()));
        assert_eq!(
            snapshot.mcp_servers,
            JsonValue::Object(serde_json::Map::new())
        );
    }

    #[test]
    fn save_empty_features_removes_section() {
        let dir = TempDir::new().unwrap();
        let home = dir.path();
        fs::write(home.join("config.toml"), "[features]\njs_repl = true\n").unwrap();

        save_codex_features(home, &JsonValue::Object(serde_json::Map::new())).unwrap();

        let raw = fs::read_to_string(home.join("config.toml")).unwrap();
        assert!(!raw.contains("[features]"));
    }
}
