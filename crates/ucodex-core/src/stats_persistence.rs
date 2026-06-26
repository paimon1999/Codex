//! 代理统计持久化模块。
//!
//! 将每日统计摘要写入 SQLite，支持按日期范围查询历史趋势。

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// 每日统计摘要
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStatsRecord {
    pub date: String,           // YYYY-MM-DD
    pub total_requests: u64,
    pub total_errors: u64,
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
    pub total_reasoning_tokens: u64,
    pub total_cached_tokens: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_latency_ms: u64,
    pub avg_latency_ms: u64,
    pub models_json: String,    // JSON string of per-model stats
}

/// 每小时统计摘要（用于日内细粒度图表）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyStatsRecord {
    pub datetime: String,       // YYYY-MM-DD HH:00
    pub requests: u64,
    pub errors: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub reasoning_tokens: u64,
    pub cached_tokens: u64,
    pub total_tokens: u64,
    pub cost: f64,
    pub latency_ms: u64,
}

/// 统计历史查询结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsHistoryPayload {
    pub daily: Vec<DailyStatsRecord>,
    pub hourly: Vec<HourlyStatsRecord>,
}

/// SQLite 持久化管理器
pub struct StatsPersistence {
    db: Arc<Mutex<Connection>>,
}

impl StatsPersistence {
    /// 打开（或创建）统计数据库
    pub fn open(db_dir: &PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(db_dir)?;
        let db_path = db_dir.join("proxy_stats.db");
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS daily_stats (
                date            TEXT PRIMARY KEY,
                total_requests  INTEGER NOT NULL DEFAULT 0,
                total_errors    INTEGER NOT NULL DEFAULT 0,
                total_prompt_tokens     INTEGER NOT NULL DEFAULT 0,
                total_completion_tokens INTEGER NOT NULL DEFAULT 0,
                total_reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
                total_cached_tokens     INTEGER NOT NULL DEFAULT 0,
                total_tokens    INTEGER NOT NULL DEFAULT 0,
                total_cost      REAL NOT NULL DEFAULT 0.0,
                total_latency_ms INTEGER NOT NULL DEFAULT 0,
                avg_latency_ms  INTEGER NOT NULL DEFAULT 0,
                models_json     TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS hourly_stats (
                datetime        TEXT NOT NULL,
                requests        INTEGER NOT NULL DEFAULT 0,
                errors          INTEGER NOT NULL DEFAULT 0,
                prompt_tokens   INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                cached_tokens   INTEGER NOT NULL DEFAULT 0,
                total_tokens    INTEGER NOT NULL DEFAULT 0,
                cost            REAL NOT NULL DEFAULT 0.0,
                latency_ms      INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (datetime)
            );
            CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_stats(date);
            CREATE INDEX IF NOT EXISTS idx_hourly_datetime ON hourly_stats(datetime);
            ",
        )?;
        // Migration: add cached_tokens column if missing (existing databases)
        let _ = conn.execute("ALTER TABLE daily_stats ADD COLUMN total_cached_tokens INTEGER NOT NULL DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE hourly_stats ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0", []);
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
        })
    }

    /// 增量写入一次请求记录到 hourly_stats（UPSERT）
    pub async fn record_request(
        &self,
        prompt_tokens: u64,
        completion_tokens: u64,
        reasoning_tokens: u64,
        cached_tokens: u64,
        total_tokens: u64,
        cost: f64,
        latency_ms: u64,
        is_error: bool,
    ) -> anyhow::Result<()> {
        let now = chrono_now();
        let hour_key = &now[..13]; // "YYYY-MM-DD HH"
        let date_key = &now[..10]; // "YYYY-MM-DD"

        let db = self.db.lock().await;
        // Upsert hourly
        db.execute(
            "INSERT INTO hourly_stats (datetime, requests, errors, prompt_tokens, completion_tokens, reasoning_tokens, cached_tokens, total_tokens, cost, latency_ms)
             VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(datetime) DO UPDATE SET
                requests = requests + 1,
                errors = errors + ?2,
                prompt_tokens = prompt_tokens + ?3,
                completion_tokens = completion_tokens + ?4,
                reasoning_tokens = reasoning_tokens + ?5,
                cached_tokens = cached_tokens + ?6,
                total_tokens = total_tokens + ?7,
                cost = cost + ?8,
                latency_ms = latency_ms + ?9",
            params![
                format!("{}:00", hour_key),
                if is_error { 1 } else { 0 },
                prompt_tokens,
                completion_tokens,
                reasoning_tokens,
                cached_tokens,
                total_tokens,
                cost,
                latency_ms,
            ],
        )?;

        // Upsert daily
        db.execute(
            "INSERT INTO daily_stats (date, total_requests, total_errors, total_prompt_tokens, total_completion_tokens, total_reasoning_tokens, total_cached_tokens, total_tokens, total_cost, total_latency_ms, avg_latency_ms, models_json)
             VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, '{}')
             ON CONFLICT(date) DO UPDATE SET
                total_requests = total_requests + 1,
                total_errors = total_errors + ?2,
                total_prompt_tokens = total_prompt_tokens + ?3,
                total_completion_tokens = total_completion_tokens + ?4,
                total_reasoning_tokens = total_reasoning_tokens + ?5,
                total_cached_tokens = total_cached_tokens + ?6,
                total_tokens = total_tokens + ?7,
                total_cost = total_cost + ?8,
                total_latency_ms = total_latency_ms + ?9,
                avg_latency_ms = (total_latency_ms + ?9) / (total_requests + 1)",
            params![
                date_key,
                if is_error { 1 } else { 0 },
                prompt_tokens,
                completion_tokens,
                reasoning_tokens,
                cached_tokens,
                total_tokens,
                cost,
                latency_ms,
            ],
        )?;

        Ok(())
    }

    /// 查询指定日期范围的每日统计
    pub async fn query_daily(&self, from: &str, to: &str) -> anyhow::Result<Vec<DailyStatsRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT date, total_requests, total_errors, total_prompt_tokens, total_completion_tokens,
                    total_reasoning_tokens, total_cached_tokens, total_tokens, total_cost, total_latency_ms, avg_latency_ms, models_json
             FROM daily_stats WHERE date >= ?1 AND date <= ?2 ORDER BY date"
        )?;
        let rows = stmt.query_map(params![from, to], |row| {
            Ok(DailyStatsRecord {
                date: row.get(0)?,
                total_requests: row.get(1)?,
                total_errors: row.get(2)?,
                total_prompt_tokens: row.get(3)?,
                total_completion_tokens: row.get(4)?,
                total_reasoning_tokens: row.get(5)?,
                total_cached_tokens: row.get(6)?,
                total_tokens: row.get(7)?,
                total_cost: row.get(8)?,
                total_latency_ms: row.get(9)?,
                avg_latency_ms: row.get(10)?,
                models_json: row.get(11)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// 查询指定日期的每小时统计
    pub async fn query_hourly(&self, date: &str) -> anyhow::Result<Vec<HourlyStatsRecord>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT datetime, requests, errors, prompt_tokens, completion_tokens,
                    reasoning_tokens, cached_tokens, total_tokens, cost, latency_ms
             FROM hourly_stats WHERE datetime >= ?1 AND datetime < ?2 ORDER BY datetime"
        )?;
        let next_date = date_plus_one(date);
        let rows = stmt.query_map(params![format!("{} 00:00", date), format!("{} 00:00", next_date)], |row| {
            Ok(HourlyStatsRecord {
                datetime: row.get(0)?,
                requests: row.get(1)?,
                errors: row.get(2)?,
                prompt_tokens: row.get(3)?,
                completion_tokens: row.get(4)?,
                reasoning_tokens: row.get(5)?,
                cached_tokens: row.get(6)?,
                total_tokens: row.get(7)?,
                cost: row.get(8)?,
                latency_ms: row.get(9)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// 查询最近 N 天的每日统计
    pub async fn query_recent_days(&self, days: u32) -> anyhow::Result<Vec<DailyStatsRecord>> {
        let today = today_str();
        let from = days_ago(days);
        self.query_daily(&from, &today).await
    }

    /// 查询今天和昨天的每小时统计（用于对比图表）
    pub async fn query_today_and_yesterday_hourly(&self) -> anyhow::Result<(Vec<HourlyStatsRecord>, Vec<HourlyStatsRecord>)> {
        let today = today_str();
        let yesterday = days_ago(1);
        let today_hourly = self.query_hourly(&today).await?;
        let yesterday_hourly = self.query_hourly(&yesterday).await?;
        Ok((today_hourly, yesterday_hourly))
    }
}

// ── 时间工具 ──────────────────────────────────────────────

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    // Simple UTC+8 conversion
    let local_secs = secs + 8 * 3600;
    let days = local_secs / 86400;
    let secs_in_day = local_secs % 86400;
    let hours = secs_in_day / 3600;
    let minutes = (secs_in_day % 3600) / 60;

    let (y, m, d) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02} {:02}:{:02}", y, m, d, hours, minutes)
}

fn today_str() -> String {
    let now = chrono_now();
    now[..10].to_string()
}

fn days_ago(n: u32) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs() + 8 * 3600;
    let days = secs / 86400;
    let target = days.saturating_sub(n as u64);
    let (y, m, d) = days_to_ymd(target);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn date_plus_one(date: &str) -> String {
    // Parse YYYY-MM-DD and add 1 day
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 { return date.to_string(); }
    let y: u64 = parts[0].parse().unwrap_or(2026);
    let m: u64 = parts[1].parse().unwrap_or(1);
    let d: u64 = parts[2].parse().unwrap_or(1);
    let total_days = ymd_to_days(y, m, d) + 1;
    let (ny, nm, nd) = days_to_ymd(total_days);
    format!("{:04}-{:02}-{:02}", ny, nm, nd)
}

fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    // Simplified civil calendar from Unix epoch days
    let mut y = 1970u64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if days < days_in_year { break; }
        days -= days_in_year;
        y += 1;
    }
    let leap = is_leap(y);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 1u64;
    for &md in &month_days {
        if days < md { break; }
        days -= md;
        m += 1;
    }
    (y, m, days + 1)
}

fn ymd_to_days(y: u64, m: u64, d: u64) -> u64 {
    let mut days = 0u64;
    for year in 1970..y {
        days += if is_leap(year) { 366 } else { 365 };
    }
    let leap = is_leap(y);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for i in 0..(m as usize).saturating_sub(1) {
        days += month_days[i];
    }
    days + d - 1
}

fn is_leap(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_date_math() {
        assert_eq!(today_str().len(), 10);
        let yesterday = days_ago(1);
        assert_eq!(yesterday.len(), 10);
        assert!(today_str() > yesterday);
    }

    #[test]
    fn test_date_plus_one() {
        assert_eq!(date_plus_one("2026-01-01"), "2026-01-02");
        assert_eq!(date_plus_one("2026-01-31"), "2026-02-01");
        assert_eq!(date_plus_one("2026-12-31"), "2027-01-01");
        assert_eq!(date_plus_one("2024-02-28"), "2024-02-29"); // leap year
    }
}
