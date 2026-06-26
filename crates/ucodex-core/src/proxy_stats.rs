//! 协议代理 Token 统计模块。
//!
//! 参照 mimo-proxy 的 StatsState 模式，追踪代理请求的 token 用量和费用。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// 按模型聚合的统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelStats {
    pub count: u64,
    pub error_count: u64,
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
    pub total_reasoning_tokens: u64,
    pub total_cached_tokens: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_latency_ms: u64,
}

/// 按分钟聚合的时间桶
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TimeBucket {
    pub minute: u64,
    pub requests: u64,
    pub errors: u64,
    pub total_tokens: u64,
    pub total_reasoning_tokens: u64,
    pub total_cost: f64,
    pub total_latency_ms: u64,
}

/// 单条请求记录
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RequestRecord {
    pub timestamp: String,
    pub model: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub reasoning_tokens: u64,
    pub cached_tokens: u64,
    pub total_tokens: u64,
    pub cost_estimate: f64,
    pub latency_ms: u64,
    pub is_stream: bool,
    pub cached: bool,
    pub error: bool,
}

/// 全局统计快照
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProxyStatsSnapshot {
    pub total_requests: u64,
    pub total_errors: u64,
    pub total_latency_ms: u64,
    pub avg_latency_ms: u64,
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
    pub total_reasoning_tokens: u64,
    pub total_cached_tokens: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub models: HashMap<String, ModelStats>,
    pub time_window: Vec<TimeBucket>,
    pub recent: Vec<RequestRecord>,
    pub cache_stats: CacheStats,
}

/// 缓存统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
    pub size: usize,
    pub max_size: usize,
}

/// 持久化基线数据（重启前的历史累计值）
#[derive(Debug, Clone, Default)]
pub struct PersistedBaseline {
    pub total_requests: u64,
    pub total_errors: u64,
    pub total_latency_ms: u64,
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
    pub total_reasoning_tokens: u64,
    pub total_cached_tokens: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
}

/// 全局代理统计状态
#[derive(Debug)]
pub struct ProxyStatsState {
    total_requests: AtomicU64,
    total_errors: AtomicU64,
    total_latency_ms: AtomicU64,
    total_prompt_tokens: AtomicU64,
    total_completion_tokens: AtomicU64,
    total_reasoning_tokens: AtomicU64,
    total_cached_tokens: AtomicU64,
    total_tokens: AtomicU64,
    /// 费用 x10000 存储，避免浮点原子操作问题
    total_cost_x10000: AtomicU64,
    /// 持久化基线（重启前的历史累计值，启动时从 SQLite 加载一次）
    baseline: RwLock<Option<PersistedBaseline>>,
    models: RwLock<HashMap<String, ModelStats>>,
    time_window: RwLock<HashMap<u64, TimeBucket>>,
    recent: RwLock<Vec<RequestRecord>>,
    max_recent: usize,
    max_window_minutes: usize,
}

impl Default for ProxyStatsState {
    fn default() -> Self {
        Self {
            total_requests: AtomicU64::new(0),
            total_errors: AtomicU64::new(0),
            total_latency_ms: AtomicU64::new(0),
            total_prompt_tokens: AtomicU64::new(0),
            total_completion_tokens: AtomicU64::new(0),
            total_reasoning_tokens: AtomicU64::new(0),
            total_cached_tokens: AtomicU64::new(0),
            total_tokens: AtomicU64::new(0),
            total_cost_x10000: AtomicU64::new(0),
            baseline: RwLock::new(None),
            models: RwLock::new(HashMap::new()),
            time_window: RwLock::new(HashMap::new()),
            recent: RwLock::new(Vec::new()),
            max_recent: 200,
            max_window_minutes: 60,
        }
    }
}

/// Token 用量数据
#[derive(Debug, Clone, Default)]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub reasoning_tokens: u64,
    pub cached_tokens: u64,
    pub total_tokens: u64,
    pub model: String,
}

impl ProxyStatsState {
    /// 创建新的统计状态
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// 设置持久化基线（启动时从 SQLite 加载一次）
    pub async fn set_baseline(&self, baseline: PersistedBaseline) {
        let mut b = self.baseline.write().await;
        *b = Some(baseline);
    }

    /// 获取当前会话的请求计数（不含基线）
    pub fn total_requests(&self) -> u64 {
        self.total_requests.load(Ordering::Relaxed)
    }

    /// 记录一次代理请求
    pub async fn record(
        &self,
        usage: &TokenUsage,
        latency_ms: u64,
        is_stream: bool,
        cached: bool,
        error: bool,
    ) {
        // 全局计数器
        self.total_requests.fetch_add(1, Ordering::Relaxed);
        if error {
            self.total_errors.fetch_add(1, Ordering::Relaxed);
        }
        self.total_latency_ms
            .fetch_add(latency_ms, Ordering::Relaxed);

        // Token 计数
        self.total_prompt_tokens
            .fetch_add(usage.prompt_tokens, Ordering::Relaxed);
        self.total_completion_tokens
            .fetch_add(usage.completion_tokens, Ordering::Relaxed);
        self.total_reasoning_tokens
            .fetch_add(usage.reasoning_tokens, Ordering::Relaxed);
        self.total_cached_tokens
            .fetch_add(usage.cached_tokens, Ordering::Relaxed);
        self.total_tokens
            .fetch_add(usage.total_tokens, Ordering::Relaxed);

        // 费用估算（区分缓存/非缓存输入 token）
        let cost = estimate_cost(
            &usage.model,
            usage.prompt_tokens,
            usage.cached_tokens,
            usage.completion_tokens,
        );
        let cost_x10000 = (cost * 10000.0) as u64;
        self.total_cost_x10000
            .fetch_add(cost_x10000, Ordering::Relaxed);

        // 按模型聚合
        {
            let mut models = self.models.write().await;
            let entry = models.entry(usage.model.clone()).or_default();
            entry.count += 1;
            if error {
                entry.error_count += 1;
            }
            entry.total_prompt_tokens += usage.prompt_tokens;
            entry.total_completion_tokens += usage.completion_tokens;
            entry.total_reasoning_tokens += usage.reasoning_tokens;
            entry.total_cached_tokens += usage.cached_tokens;
            entry.total_tokens += usage.total_tokens;
            entry.total_cost += cost;
            entry.total_latency_ms += latency_ms;
        }

        // 按分钟聚合
        let minute = current_minute();
        {
            let mut window = self.time_window.write().await;
            let entry = window.entry(minute).or_insert_with(|| TimeBucket {
                minute,
                ..Default::default()
            });
            entry.requests += 1;
            if error {
                entry.errors += 1;
            }
            entry.total_tokens += usage.total_tokens;
            entry.total_reasoning_tokens += usage.reasoning_tokens;
            entry.total_cost += cost;
            entry.total_latency_ms += latency_ms;

            // 清理过期桶
            let cutoff = minute.saturating_sub(self.max_window_minutes as u64);
            window.retain(|k, _| *k > cutoff);
        }

        // 最近请求记录
        {
            let mut recent = self.recent.write().await;
            let record = RequestRecord {
                timestamp: format_timestamp(SystemTime::now()),
                model: usage.model.clone(),
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                reasoning_tokens: usage.reasoning_tokens,
                cached_tokens: usage.cached_tokens,
                total_tokens: usage.total_tokens,
                cost_estimate: cost,
                latency_ms,
                is_stream,
                cached,
                error,
            };
            recent.push(record);
            // FIFO 淘汰
            while recent.len() > self.max_recent {
                recent.remove(0);
            }
        }
    }

    /// 生成统计快照（自动合并持久化基线）
    pub async fn snapshot(&self, cache_stats: CacheStats) -> ProxyStatsSnapshot {
        // 读取持久化基线
        let baseline = self.baseline.read().await.clone().unwrap_or_default();

        // 当前会话的内存计数
        let session_requests = self.total_requests.load(Ordering::Relaxed);
        let session_errors = self.total_errors.load(Ordering::Relaxed);
        let session_latency_ms = self.total_latency_ms.load(Ordering::Relaxed);
        let session_prompt = self.total_prompt_tokens.load(Ordering::Relaxed);
        let session_completion = self.total_completion_tokens.load(Ordering::Relaxed);
        let session_reasoning = self.total_reasoning_tokens.load(Ordering::Relaxed);
        let session_cached = self.total_cached_tokens.load(Ordering::Relaxed);
        let session_tokens = self.total_tokens.load(Ordering::Relaxed);
        let session_cost_x10000 = self.total_cost_x10000.load(Ordering::Relaxed);

        // 合并：基线 + 当前会话
        let total_requests = baseline.total_requests + session_requests;
        let total_errors = baseline.total_errors + session_errors;
        let total_latency_ms = baseline.total_latency_ms + session_latency_ms;
        let total_prompt_tokens = baseline.total_prompt_tokens + session_prompt;
        let total_completion_tokens = baseline.total_completion_tokens + session_completion;
        let total_reasoning_tokens = baseline.total_reasoning_tokens + session_reasoning;
        let total_cached_tokens = baseline.total_cached_tokens + session_cached;
        let total_tokens = baseline.total_tokens + session_tokens;
        let total_cost = baseline.total_cost + (session_cost_x10000 as f64 / 10000.0);

        let avg_latency_ms = if total_requests > 0 {
            total_latency_ms / total_requests
        } else {
            0
        };

        let models = self.models.read().await.clone();
        let time_window = {
            let window = self.time_window.read().await;
            let mut buckets: Vec<TimeBucket> = window.values().cloned().collect();
            buckets.sort_by_key(|b| b.minute);
            buckets
        };
        let recent = self.recent.read().await.clone();

        ProxyStatsSnapshot {
            total_requests,
            total_errors,
            total_latency_ms,
            avg_latency_ms,
            total_prompt_tokens,
            total_completion_tokens,
            total_reasoning_tokens,
            total_cached_tokens,
            total_tokens,
            total_cost,
            models,
            time_window,
            recent,
            cache_stats,
        }
    }
}

/// 费用估算（单位：Credits）
///
/// MiMo 定价（Credits / token）：
/// - mimo-v2.5-pro / mimo-v2-pro: 缓存 2.5, 非缓存 300, 输出 600
/// - mimo-v2.5 / mimo-v2-omni:    缓存 2,   非缓存 100, 输出 200
/// - 其他模型: 使用 USD 估算（兼容旧逻辑）
///
/// 夜间（0:00-8:00 UTC+8）MiMo 语言模型八折
pub fn estimate_cost(model: &str, prompt_tokens: u64, cached_tokens: u64, completion_tokens: u64) -> f64 {
    let uncached_input = prompt_tokens.saturating_sub(cached_tokens);

    // MiMo 模型定价（Credits / token）
    let mimo_pricing = if model.contains("mimo-v2.5-pro") || model.contains("mimo-v2-pro") {
        Some((2.5, 300.0, 600.0)) // (cached_input, uncached_input, output)
    } else if model.contains("mimo-v2.5") || model.contains("mimo-v2-omni") {
        Some((2.0, 100.0, 200.0))
    } else {
        None
    };

    if let Some((cached_price, uncached_price, output_price)) = mimo_pricing {
        let mut cost = cached_tokens as f64 * cached_price
            + uncached_input as f64 * uncached_price
            + completion_tokens as f64 * output_price;

        // 夜间折扣：0:00-8:00 UTC+8，八折
        if is_nighttime_utc8() {
            cost *= 0.8;
        }
        return cost;
    }

    // 非 MiMo 模型：USD 估算（兼容旧逻辑）
    let (input_price, output_price) = if model.contains("gpt-4o") {
        (2.50, 10.00)
    } else if model.contains("gpt-4") {
        (30.0, 60.0)
    } else if model.contains("gpt-3.5") {
        (0.50, 1.50)
    } else if model.contains("claude-3-opus") || model.contains("claude-opus") {
        (15.0, 75.0)
    } else if model.contains("claude-3-sonnet") || model.contains("claude-sonnet") {
        (3.0, 15.0)
    } else if model.contains("claude-3-haiku") || model.contains("claude-haiku") {
        (0.25, 1.25)
    } else if model.contains("deepseek") {
        (0.14, 0.28)
    } else if model.contains("qwen") {
        (0.40, 1.20)
    } else {
        (0.0, 0.0)
    };
    (prompt_tokens as f64 * input_price + completion_tokens as f64 * output_price) / 1_000_000.0
}

/// 判断当前是否为夜间时段（0:00-8:00 UTC+8）
fn is_nighttime_utc8() -> bool {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let local_secs = secs + 8 * 3600; // UTC+8
    let hour = (local_secs % 86400) / 3600;
    hour < 8
}

/// 从 JSON 响应中提取 token 用量
pub fn extract_usage_from_response(body: &serde_json::Value) -> TokenUsage {
    let mut usage = TokenUsage::default();

    // 从 usage 字段提取
    if let Some(u) = body.get("usage") {
        usage.prompt_tokens = u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        usage.completion_tokens = u
            .get("completion_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        usage.total_tokens = u.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        usage.reasoning_tokens = u
            .get("completion_tokens_details")
            .and_then(|d| d.get("reasoning_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        // 提取 cached_tokens: 兼容 OpenAI 和 Anthropic 格式
        usage.cached_tokens = u
            .get("prompt_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|v| v.as_u64())
            .or_else(|| {
                u.get("input_tokens_details")
                    .and_then(|d| d.get("cached_tokens"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(0);
    }

    // 从 model 字段提取
    usage.model = body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    usage
}

/// 从 SSE 流的最后一个 chunk 提取 token 用量
pub fn extract_usage_from_sse_chunk(data: &serde_json::Value) -> Option<TokenUsage> {
    let u = data.get("usage")?;
    let prompt_tokens = u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let completion_tokens = u
        .get("completion_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let total_tokens = u.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let reasoning_tokens = u
        .get("completion_tokens_details")
        .and_then(|d| d.get("reasoning_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    // 提取 cached_tokens: 兼容 OpenAI 和 Anthropic 格式
    let cached_tokens = u
        .get("prompt_tokens_details")
        .and_then(|d| d.get("cached_tokens"))
        .and_then(|v| v.as_u64())
        .or_else(|| {
            u.get("input_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(|v| v.as_u64())
        })
        .unwrap_or(0);

    // 只有当有实际 token 数据时才返回
    if total_tokens == 0 && prompt_tokens == 0 && completion_tokens == 0 {
        return None;
    }

    let model = data
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Some(TokenUsage {
        prompt_tokens,
        completion_tokens,
        reasoning_tokens,
        cached_tokens,
        total_tokens,
        model,
    })
}

fn current_minute() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 60
}

fn format_timestamp(time: SystemTime) -> String {
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs();
    let hours = (secs % 86400) / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_estimate_cost() {
        // DeepSeek: $0.14/M input, $0.28/M output
        let cost = estimate_cost("deepseek-chat", 1000, 0, 2000);
        assert!((cost - 0.0007).abs() < 0.0001);

        // GPT-4o: $2.50/M input, $10.00/M output
        // (1000 * 2.50 + 1000 * 10.00) / 1_000_000 = 0.0125
        let cost = estimate_cost("gpt-4o", 1000, 0, 1000);
        assert!((cost - 0.0125).abs() < 0.0001);

        // MiMo-v2.5-pro: cached 2.5, uncached 300, output 600 Credits/token
        // 1000 prompt (500 cached) + 2000 completion
        let cost = estimate_cost("mimo-v2.5-pro", 1000, 500, 2000);
        let expected = 500.0 * 2.5 + 500.0 * 300.0 + 2000.0 * 600.0;
        assert!((cost - expected).abs() < 0.0001);

        // MiMo-v2.5: cached 2, uncached 100, output 200 Credits/token
        let cost = estimate_cost("mimo-v2.5", 1000, 0, 1000);
        let expected = 1000.0 * 100.0 + 1000.0 * 200.0;
        assert!((cost - expected).abs() < 0.0001);

        // Unknown model: free
        let cost = estimate_cost("unknown-model", 1000, 0, 1000);
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn test_extract_usage() {
        let body = serde_json::json!({
            "model": "mimo-v2.5-pro",
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 200,
                "total_tokens": 300,
                "completion_tokens_details": {
                    "reasoning_tokens": 50
                },
                "prompt_tokens_details": {
                    "cached_tokens": 30
                }
            }
        });
        let usage = extract_usage_from_response(&body);
        assert_eq!(usage.prompt_tokens, 100);
        assert_eq!(usage.completion_tokens, 200);
        assert_eq!(usage.total_tokens, 300);
        assert_eq!(usage.reasoning_tokens, 50);
        assert_eq!(usage.cached_tokens, 30);
        assert_eq!(usage.model, "mimo-v2.5-pro");
    }

    #[test]
    fn test_extract_usage_anthropic_format() {
        let body = serde_json::json!({
            "model": "claude-3-sonnet",
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 200,
                "total_tokens": 300,
                "input_tokens_details": {
                    "cached_tokens": 40
                }
            }
        });
        let usage = extract_usage_from_response(&body);
        assert_eq!(usage.cached_tokens, 40);
    }
}
