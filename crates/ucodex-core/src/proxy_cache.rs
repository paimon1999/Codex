//! 协议代理响应缓存模块。
//!
//! 缓存非流式代理响应，减少上游请求。参照 mimo-proxy 的缓存策略。

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tokio::sync::RwLock;

/// 缓存最大条目数
const CACHE_MAX_SIZE: usize = 2048;
/// 缓存 TTL (秒)
const CACHE_TTL_SECS: u64 = 3600;
/// 清理间隔 (秒)
const CACHE_CLEAN_INTERVAL_SECS: u64 = 120;

/// 缓存条目
#[derive(Debug, Clone)]
struct CacheEntry {
    /// 转换后的响应 JSON
    response: Value,
    /// Token 用量 (从响应中提取)
    usage: crate::proxy_stats::TokenUsage,
    /// 过期时间
    expires_at: Instant,
    /// 插入时间 (用于 LRU 淘汰)
    inserted_at: Instant,
}

/// 缓存统计
#[derive(Debug, Clone)]
pub struct CacheMetrics {
    pub hits: u64,
    pub misses: u64,
    pub size: usize,
    pub max_size: usize,
}

/// 代理响应缓存
#[derive(Debug, Clone)]
pub struct ProxyCache {
    entries: Arc<RwLock<HashMap<String, CacheEntry>>>,
    hits: Arc<std::sync::atomic::AtomicU64>,
    misses: Arc<std::sync::atomic::AtomicU64>,
}

impl Default for ProxyCache {
    fn default() -> Self {
        Self {
            entries: Arc::new(RwLock::new(HashMap::new())),
            hits: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            misses: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }
}

impl ProxyCache {
    /// 创建新的缓存实例
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// 生成缓存键 (hash of request body)
    pub fn cache_key(request_body: &str) -> String {
        let mut hasher = DefaultHasher::new();
        request_body.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    }

    /// 查找缓存
    pub async fn get(&self, key: &str) -> Option<(Value, crate::proxy_stats::TokenUsage)> {
        let entries = self.entries.read().await;
        if let Some(entry) = entries.get(key) {
            if entry.expires_at > Instant::now() {
                self.hits
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                return Some((entry.response.clone(), entry.usage.clone()));
            }
        }
        self.misses
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        None
    }

    /// 插入缓存
    pub async fn insert(
        &self,
        key: String,
        response: Value,
        usage: crate::proxy_stats::TokenUsage,
    ) {
        let now = Instant::now();
        let entry = CacheEntry {
            response,
            usage,
            expires_at: now + std::time::Duration::from_secs(CACHE_TTL_SECS),
            inserted_at: now,
        };

        let mut entries = self.entries.write().await;

        // 惰性清理过期条目
        entries.retain(|_, v| v.expires_at > now);

        // LRU 淘汰：超过 max_size 时删除最旧条目
        while entries.len() >= CACHE_MAX_SIZE {
            let oldest = entries
                .iter()
                .min_by_key(|(_, v)| v.inserted_at)
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                entries.remove(&k);
            } else {
                break;
            }
        }

        entries.insert(key, entry);
    }

    /// 获取缓存统计
    pub async fn metrics(&self) -> CacheMetrics {
        let entries = self.entries.read().await;
        let hits = self.hits.load(std::sync::atomic::Ordering::Relaxed);
        let misses = self.misses.load(std::sync::atomic::Ordering::Relaxed);

        CacheMetrics {
            hits,
            misses,
            size: entries.len(),
            max_size: CACHE_MAX_SIZE,
        }
    }

    /// 启动后台清理任务
    pub fn start_cleanup_task(self: &Arc<Self>) {
        let cache = Arc::clone(self);
        tokio::spawn(async move {
            let interval = std::time::Duration::from_secs(CACHE_CLEAN_INTERVAL_SECS);
            loop {
                tokio::time::sleep(interval).await;
                let now = Instant::now();
                let mut entries = cache.entries.write().await;
                let before = entries.len();
                entries.retain(|_, v| v.expires_at > now);
                let after = entries.len();
                if before != after {
                    let _ = crate::diagnostic_log::append_diagnostic_log(
                        "proxy_cache.cleaned",
                        serde_json::json!({
                            "removed": before - after,
                            "remaining": after
                        }),
                    );
                }
            }
        });
    }
}

/// 判断请求是否可缓存 (仅非流式)
pub fn is_cacheable(request_body: &Value) -> bool {
    // 流式请求不缓存
    if request_body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_key_deterministic() {
        let body = r#"{"model":"test","messages":[]}"#;
        let key1 = ProxyCache::cache_key(body);
        let key2 = ProxyCache::cache_key(body);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_cache_key_different() {
        let key1 = ProxyCache::cache_key(r#"{"model":"a"}"#);
        let key2 = ProxyCache::cache_key(r#"{"model":"b"}"#);
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_is_cacheable() {
        // 非流式可缓存
        let body = serde_json::json!({"model": "test"});
        assert!(is_cacheable(&body));

        // 流式不可缓存
        let body = serde_json::json!({"model": "test", "stream": true});
        assert!(!is_cacheable(&body));
    }
}
