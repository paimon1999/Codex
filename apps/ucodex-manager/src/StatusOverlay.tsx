import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export function StatusOverlay() {
  const [alive, setAlive] = useState(false);
  const [stats, setStats] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("helper-status-update", () => poll()).then(fn => { unlisten = fn; }).catch(() => {});
    const poll = async () => {
      try {
        const r = await fetch("http://127.0.0.1:57321/backend/status", { method: "POST", body: "{}" });
        setAlive(r.ok);
        if (r.ok) {
          const r2 = await fetch("http://127.0.0.1:57321/proxy-stats");
          if (r2.ok) setStats(await r2.json());
        }
      } catch { setAlive(false); }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { clearInterval(t); unlisten?.(); };
  }, []);

  const fmt = (n: unknown) => {
    const v = Number(n || 0);
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(v);
  };
  const fmtCr = (n: unknown) => {
    const v = Number(n || 0);
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M Cr`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K Cr`;
    if (abs >= 1) return `${v.toFixed(1)} Cr`;
    if (abs >= 0.01) return `${v.toFixed(2)} Cr`;
    return `${v.toFixed(4)} Cr`;
  };

  const s = stats as Record<string, any>;
  const c = s?.cache_stats ?? {};

  const g: React.CSSProperties = { display: "grid", gap: "3px 10px" };
  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    borderRadius: 6, padding: "5px 8px", textAlign: "center",
  };
  const kv = (dim?: boolean): React.CSSProperties => ({
    display: "flex", justifyContent: "space-between", alignItems: "center",
  });

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
      background: "rgba(30,30,30,0.72)",
      backdropFilter: "blur(40px) saturate(200%)",
      WebkitBackdropFilter: "blur(40px) saturate(200%)",
      color: "#e5e7eb", height: "100%", boxSizing: "border-box",
      overflowY: "auto", borderRadius: "0 0 12px 12px",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px 6px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: alive ? "#5ee8b5" : "#f87171",
            boxShadow: `0 0 6px ${alive ? "#5ee8b588" : "#f8717188"}`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 600 }}>Helper</span>
        </div>
        <span style={{ fontSize: 9, color: "#6b7280" }}>
          {alive ? "运行中" : "未运行"}
        </span>
      </div>

      {alive ? (
        <div style={{ padding: "6px 12px 10px" }}>
          {/* 三格卡片 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 6 }}>
            <div style={card}>
              <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 1 }}>请求数</div>
              <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{fmt(s.total_requests)}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 1 }}>错误</div>
              <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace, monospace", color: Number(s.total_errors ?? 0) > 0 ? "#f87171" : "#f9fafb" }}>{String(s.total_errors ?? 0)}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 1 }}>延迟</div>
              <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{typeof s.avg_latency_ms === "number" ? `${Math.round(s.avg_latency_ms)}ms` : "—"}</div>
            </div>
          </div>

          {/* 费用 */}
          <div style={{ ...card, padding: "4px 10px", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#6b7280" }}>总费用</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24", fontFamily: "ui-monospace, monospace" }}>{fmtCr(s.total_cost)}</span>
          </div>

          {/* Token 网格 */}
          <div style={{ ...g, gridTemplateColumns: "1fr 1fr", marginBottom: 6 }}>
            <KVR label="输入" value={fmt(s.total_prompt_tokens)} />
            <KVR label="输出" value={fmt(s.total_completion_tokens)} />
            <KVR label="缓存命中" value={fmt(s.total_cached_tokens)} dim />
            <KVR label="推理" value={fmt(s.total_reasoning_tokens)} dim />
          </div>

          {/* 总 Token */}
          <div style={{
            ...card, padding: "5px 10px", marginBottom: 6, background: "rgba(94,232,181,0.1)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: 10, color: "#5ee8b5" }}>总 Token</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#5ee8b5", fontFamily: "ui-monospace, monospace" }}>{fmt(s.total_tokens)}</span>
          </div>

          {/* 缓存 */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 5 }}>
            <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 3 }}>Cache</div>
            <div style={{ ...g, gridTemplateColumns: "1fr 1fr" }}>
              <KVR label="命中率" value={c.hit_rate != null ? `${(c.hit_rate * 100).toFixed(1)}%` : "—"} />
              <KVR label="大小" value={c.size != null ? `${c.size}/${c.max_size}` : "—"} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "16px 12px", textAlign: "center", color: "#6b7280", fontSize: 11 }}>无法连接 Helper</div>
      )}
    </div>
  );
}

function KVR({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 10, color: dim ? "#6b7280" : "#9ca3af" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 500, fontFamily: "ui-monospace, monospace", color: "#f9fafb" }}>{value}</span>
    </div>
  );
}
