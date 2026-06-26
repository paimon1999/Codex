import { useEffect, useRef, useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";

interface FloatingModeProps {
  onExitFloating: () => void;
  modelName?: string;
  version?: string;
  buildId?: string;
  helperPort?: string;
  latestLaunchStatus?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    reasoningTokens?: number;
  };
}

type ExpandLevel = 0 | 1 | 2;

const COMPACT_SIZE = { width: 240, height: 40 };
const LEVEL1_SIZE = { width: 300, height: 140 };
const LEVEL2_SIZE = { width: 340, height: 230 };

export function FloatingMode({
  onExitFloating,
  modelName = "未知模型",
  version,
  buildId,
  helperPort,
  latestLaunchStatus,
  tokenUsage,
}: FloatingModeProps) {
  const [expandLevel, setExpandLevel] = useState<ExpandLevel>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetCollapseTimer = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      setExpandLevel(0);
      resizeWindow(0);
    }, 4000);
  }, []);

  const resizeWindow = async (level: ExpandLevel) => {
    const win = getCurrentWindow();
    const sizes = [COMPACT_SIZE, LEVEL1_SIZE, LEVEL2_SIZE];
    const target = sizes[level];
    try {
      await win.setSize(new LogicalSize(target.width, target.height));
    } catch (e) {
      console.warn("[FloatingMode] resize failed:", e);
    }
  };

  useEffect(() => {
    const setupWindow = async () => {
      const win = getCurrentWindow();
      try {
        await win.setDecorations(false);
        await win.setAlwaysOnTop(true);
        await win.setResizable(false);
        await win.setSkipTaskbar(true);
        await win.setSize(new LogicalSize(COMPACT_SIZE.width, COMPACT_SIZE.height));
        await win.center();
      } catch (e) {
        console.warn("[FloatingMode] window setup failed:", e);
      }
    };
    setupWindow();
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
      if (expandTimer.current) clearTimeout(expandTimer.current);
    };
  }, []);

  // 左键点击: 循环展开/收起
  const handleClick = useCallback(async () => {
    const nextLevel: ExpandLevel = expandLevel < 2 ? ((expandLevel + 1) as ExpandLevel) : 0;
    setExpandLevel(nextLevel);
    await resizeWindow(nextLevel);
    if (nextLevel > 0) {
      resetCollapseTimer();
    }
  }, [expandLevel, resetCollapseTimer]);

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // 拖拽
  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (expandLevel > 0 || contextMenu) return;
    e.preventDefault();
    setIsDragging(true);
    try {
      await getCurrentWindow().startDragging();
    } catch { /* ignore */ }
    setIsDragging(false);
  }, [expandLevel, contextMenu]);

  // 退出悬浮
  const handleExit = useCallback(async () => {
    const win = getCurrentWindow();
    try {
      await win.setDecorations(true);
      await win.setAlwaysOnTop(false);
      await win.setResizable(true);
      await win.setSkipTaskbar(false);
      await win.setSize(new LogicalSize(1180, 820));
      await win.setMinSize(new LogicalSize(960, 720));
      await win.center();
    } catch (e) {
      console.warn("[FloatingMode] exit failed:", e);
    }
    onExitFloating();
  }, [onExitFloating]);

  // 最小化
  const handleMinimize = useCallback(async () => {
    try {
      await getCurrentWindow().minimize();
    } catch { /* ignore */ }
  }, []);

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const formatCost = (n: number): string => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M Cr`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K Cr`;
    if (abs >= 1) return `${n.toFixed(1)} Cr`;
    if (abs >= 0.01) return `${n.toFixed(2)} Cr`;
    return `${n.toFixed(4)} Cr`;
  };

  const isActive = latestLaunchStatus === "success" || latestLaunchStatus === "running";

  return (
    <div
      className={`floating-island floating-level-${expandLevel} ${isDragging ? "dragging" : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
    >
      {/* ─── Level 0: 胶囊 ────────────────────── */}
      <div className="floating-row floating-row-main">
        <div className="floating-status-dot" data-active={isActive} />
        <span className="floating-model-name">{modelName}</span>
        {tokenUsage && expandLevel === 0 && (
          <span className="floating-token-badge">{formatTokens(tokenUsage.totalTokens)}</span>
        )}
        <div className="floating-actions">
          <button
            className="floating-btn"
            onClick={(e) => { e.stopPropagation(); handleMinimize(); }}
            title="最小化"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className="floating-btn floating-btn-exit"
            onClick={(e) => { e.stopPropagation(); handleExit(); }}
            title="退出"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 8L8 2M2 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Level 1: 概览 ────────────────────── */}
      {expandLevel >= 1 && (
        <div className="floating-row floating-row-info">
          <div className="floating-info-grid">
            <InfoCell label="状态" value={isActive ? "运行中" : "离线"} active={isActive} />
            <InfoCell label="端口" value={`:${helperPort || "57321"}`} />
            <InfoCell label="版本" value={version || "—"} />
            <InfoCell label="Build" value={buildId || "—"} />
          </div>

          {tokenUsage && (
            <div className="floating-cost-row">
              <span className="floating-cost-label">Token</span>
              <span className="floating-cost-value">{formatTokens(tokenUsage.totalTokens)}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Level 2: Token 详情 ──────────────── */}
      {expandLevel >= 2 && tokenUsage && (
        <div className="floating-row floating-row-detail">
          <div className="floating-detail-grid">
            <DetailCell label="输入" value={formatTokens(tokenUsage.promptTokens)} />
            <DetailCell label="输出" value={formatTokens(tokenUsage.completionTokens)} />
            <DetailCell label="推理" value={formatTokens(tokenUsage.reasoningTokens ?? 0)} dim />
            <DetailCell label="缓存" value={formatTokens(tokenUsage.cachedTokens)} dim />
            <DetailCell label="总计" value={formatTokens(tokenUsage.totalTokens)} accent />
          </div>
        </div>
      )}

      {/* ─── 右键菜单 ─────────────────────────── */}
      {contextMenu && (
        <>
          <div className="floating-context-mask" onClick={closeContextMenu} />
          <div
            className="floating-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseLeave={closeContextMenu}
          >
            <button onClick={() => { closeContextMenu(); handleExit(); }}>
              退出灵动岛
            </button>
            <button onClick={() => { closeContextMenu(); handleMinimize(); }}>
              最小化
            </button>
            <button onClick={() => { closeContextMenu(); setExpandLevel(0); resizeWindow(0); }}>
              收起
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function InfoCell({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="floating-info-item">
      <span className="floating-info-label">{label}</span>
      <span className="floating-info-value" data-active={active}>{value}</span>
    </div>
  );
}

function DetailCell({ label, value, dim, accent }: { label: string; value: string; dim?: boolean; accent?: boolean }) {
  return (
    <div className="floating-detail-item">
      <span className="floating-detail-label">{label}</span>
      <span className={`floating-detail-value ${dim ? "dim" : ""} ${accent ? "accent" : ""}`}>{value}</span>
    </div>
  );
}
