import { useState, useEffect, useCallback, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────
type GitInfo = {
  currentBranch: string;
  latestCommit: string;
  latestCommitMsg: string;
  remoteUrl: string;
  repoPath: string;
};

type FileChange = {
  path: string;
  status: string;
  added: number;
  removed: number;
  staged: boolean;
  diff?: string;
};

type CustomChange = {
  path: string;
  added: number;
  removed: number;
  features: string[];
  description: string;
  conflictRisk: string;
  deletedUpstream: boolean;
  diff: string;
};

type CustomChangesResult = {
  base: string;
  head: string;
  totalFiles: number;
  totalAdded: number;
  totalRemoved: number;
  changes: CustomChange[];
};

type GitStatus = {
  currentBranch: string;
  staged: number;
  modified: number;
  not_added: number;
  deleted: number;
  conflicted: number;
  ahead: number;
  behind: number;
};

type Commit = {
  hash: string;
  message: string;
  author: string;
  date: string;
};

type Branch = {
  name: string;
  current: boolean;
};

type UpstreamAnalysis = {
  myCommits: Array<{ hash: string; message: string }>;
  myFilesCount: number;
  upstreamCommits: Array<{ hash: string; message: string }>;
  upstreamFilesCount: number;
  upstreamStats: string;
  conflictFiles: string[];
  conflictCount: number;
  forkBase: string;
  currentHead: string;
  upstreamHead: string;
  fetchError?: string | null;
  fetchSkipped?: boolean;
  error?: string;
  errorCode?: string;
  help?: string;
};

type UpstreamConfig = {
  remotes: Array<{ name: string; url: string; type: string }>;
  upstreamUrl: string;
  hasUpstream: boolean;
};

type Tab = "working" | "custom" | "upstream" | "history" | "branches";

// ── API Helper ─────────────────────────────────────────────
const API_BASE = '/api/git';

async function fetchApi<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${endpoint}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }
  return response.json();
}

// ── Hooks ──────────────────────────────────────────────────
function useAutoRefresh(fetchFn: () => Promise<void>, interval = 5000) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    await fetchFn();
    setLastRefresh(new Date());
  }, [fetchFn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void refresh(), interval);
    return () => clearInterval(id);
  }, [autoRefresh, interval, refresh]);

  return {
    autoRefresh,
    toggleAutoRefresh: () => setAutoRefresh(v => !v),
    refresh,
    lastRefresh,
  };
}

// ── Diff Renderer ──────────────────────────────────────────
function DiffBlock({ diff, maxHeight = 500 }: { diff: string; maxHeight?: number }) {
  if (!diff || diff === '(无变更)' || diff === '(新文件，暂无 diff)') {
    return (
      <div className="p-4 text-sm text-center rounded-xl" style={{ color: "var(--text2)", background: "var(--surface)" }}>
        {diff || '(无变更)'}
      </div>
    );
  }

  return (
    <pre
      className="text-xs leading-relaxed rounded-xl overflow-auto"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        maxHeight,
        margin: 0,
        padding: 0,
      }}
    >
      {diff.split("\n").map((line, i) => {
        let bg = "transparent";
        let color = "var(--text)";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          bg = "#dcfce7"; color = "#166534";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          bg = "#fee2e2"; color = "#991b1b";
        } else if (line.startsWith("@@")) {
          bg = "#dbeafe"; color = "#1e40af";
        } else if (line.startsWith("index") || line.startsWith("diff --git")) {
          color = "var(--text2)";
        }
        return (
          <div
            key={i}
            className="px-4 py-0.5 whitespace-pre"
            style={{ background: bg, color, fontFamily: '"SF Mono", Consolas, "Fira Code", monospace' }}
          >
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

// ── Components ─────────────────────────────────────────────
function Badge({ children, color, variant = "solid" }: { children: React.ReactNode; color: string; variant?: "solid" | "outline" }) {
  const style = variant === "outline"
    ? { background: "transparent", color, border: `1px solid ${color}` }
    : { background: `${color}15`, color, border: `1px solid ${color}30` };
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold" style={style}>
      {children}
    </span>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs" style={{ color: "var(--text2)" }}>
        {icon && <span className="mr-1">{icon}</span>}
        {label}
      </span>
      <span className="text-lg font-bold" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  );
}

function TabButton({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors relative"
      style={{
        background: active ? "var(--accent)" : "var(--surface2)",
        color: active ? "#fff" : "var(--text2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center"
          style={{ background: "var(--red)", color: "#fff" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
    </svg>
  );
}

function EmptyState({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="text-4xl mb-4">{icon}</span>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm" style={{ color: "var(--text2)" }}>{description}</p>
    </div>
  );
}

// ── File Card (Working) ────────────────────────────────────
function WorkingFileCard({ file, onClick }: { file: FileChange; onClick: () => void }) {
  const statusColor = file.staged ? "var(--green)" : "var(--yellow)";
  const statusLabel = file.staged ? "Staged" : "Modified";

  return (
    <div onClick={onClick} className="p-4 rounded-xl cursor-pointer transition-all hover:shadow-md group"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge color={statusColor}>{statusLabel}</Badge>
            {file.status === 'added' && <Badge color="var(--green)">新增</Badge>}
            {file.status === 'deleted' && <Badge color="var(--red)">删除</Badge>}
          </div>
          <div className="text-sm font-mono truncate group-hover:text-blue-500 transition-colors">{file.path}</div>
        </div>
        <div className="text-right shrink-0 text-sm font-mono">
          {file.added > 0 && <span style={{ color: "var(--green)" }}>+{file.added}</span>}
          {file.added > 0 && file.removed > 0 && " "}
          {file.removed > 0 && <span style={{ color: "var(--red)" }}>-{file.removed}</span>}
        </div>
      </div>
    </div>
  );
}

// ── File Card (Custom) ─────────────────────────────────────
function CustomFileCard({ file, onClick }: { file: CustomChange; onClick: () => void }) {
  const riskColor = file.conflictRisk === 'high' ? "var(--red)" : file.conflictRisk === 'medium' ? "var(--yellow)" : "var(--green)";
  const riskLabel = file.conflictRisk === 'high' ? "高" : file.conflictRisk === 'medium' ? "中" : "低";

  return (
    <div onClick={onClick} className="p-4 rounded-xl cursor-pointer transition-all hover:shadow-md group"
      style={{ background: "var(--surface)", border: `1px solid ${file.deletedUpstream ? "var(--red)" : "var(--border)"}` }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge color={riskColor}>{riskLabel}风险</Badge>
            {file.deletedUpstream && <Badge color="var(--red)">上游已删除</Badge>}
          </div>
          <div className="text-sm font-mono truncate group-hover:text-blue-500 transition-colors">{file.path}</div>
        </div>
        <div className="text-right shrink-0 text-sm font-mono">
          <span style={{ color: "var(--green)" }}>+{file.added}</span>
          {" "}
          <span style={{ color: "var(--red)" }}>-{file.removed}</span>
        </div>
      </div>
      <p className="text-xs mb-2" style={{ color: "var(--text2)" }}>{file.description}</p>
      <div className="flex flex-wrap gap-1">
        {file.features.slice(0, 3).map((f) => (
          <span key={f} className="px-2 py-0.5 rounded text-xs" style={{ background: "var(--surface2)", color: "var(--text2)" }}>{f}</span>
        ))}
        {file.features.length > 3 && (
          <span className="px-2 py-0.5 rounded text-xs" style={{ background: "var(--surface2)", color: "var(--text2)" }}>+{file.features.length - 3}</span>
        )}
      </div>
    </div>
  );
}

// ── File Detail Modal ──────────────────────────────────────
function FileDetail({ file, diff, onClose }: { file: { path: string; added: number; removed: number }; diff: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[85vh] overflow-auto rounded-2xl animate-fade-in"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.15)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4"
          style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 className="text-lg font-bold">{file.path.split('/').pop()}</h3>
            <p className="text-xs font-mono" style={{ color: "var(--text2)" }}>{file.path}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:opacity-80" style={{ background: "var(--surface2)" }}>✕</button>
        </div>
        <div className="px-6 py-4">
          <div className="grid grid-cols-2 gap-4 mb-4 p-4 rounded-xl" style={{ background: "var(--surface)" }}>
            <Stat label="新增行数" value={`+${file.added}`} icon="+" />
            <Stat label="删除行数" value={`-${file.removed}`} icon="-" />
          </div>
          <div className="mb-4">
            <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text2)" }}>代码变更</h4>
            <DiffBlock diff={diff} maxHeight={600} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Working Changes View ───────────────────────────────────
function WorkingChangesView({ search, setSearch }: { search: string; setSearch: (s: string) => void }) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null);
  const [fileDiff, setFileDiff] = useState('');

  const fetchData = useCallback(async () => {
    const data = await fetchApi<FileChange[]>('/changes');
    setChanges(data);
    setLoading(false);
  }, []);

  const { autoRefresh, toggleAutoRefresh, refresh } = useAutoRefresh(fetchData, 3000);

  const filtered = useMemo(() => {
    if (!search) return changes;
    const q = search.toLowerCase();
    return changes.filter(c => c.path.toLowerCase().includes(q));
  }, [changes, search]);

  const loadDiff = useCallback(async (file: FileChange) => {
    setSelectedFile(file);
    const data = await fetchApi<{ diff: string }>('/diff', { file: file.path, base: 'HEAD' });
    setFileDiff(data.diff);
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>;

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <input type="text" placeholder="搜索文件路径..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 rounded-xl text-sm outline-none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
        <button onClick={toggleAutoRefresh}
          className="px-3 py-1.5 rounded-lg text-xs"
          style={{ background: autoRefresh ? "var(--green)" : "var(--surface2)", color: autoRefresh ? "#fff" : "var(--text2)", border: `1px solid ${autoRefresh ? "var(--green)" : "var(--border)"}` }}>
          {autoRefresh ? "⏸ 暂停" : "▶ 开始"} 自动刷新
        </button>
        <span className="text-sm shrink-0" style={{ color: "var(--text2)" }}>{filtered.length} 个文件</span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="✨" title={search ? "没有匹配的文件" : "工作区干净"} description={search ? "尝试其他搜索词" : "没有未提交的修改"} />
      ) : (
        <div className="grid gap-3">
          {filtered.map((f) => <WorkingFileCard key={f.path} file={f} onClick={() => void loadDiff(f)} />)}
        </div>
      )}
      {selectedFile && <FileDetail file={selectedFile} diff={fileDiff} onClose={() => { setSelectedFile(null); setFileDiff(''); }} />}
    </>
  );
}

// ── Custom Changes View ────────────────────────────────────
function CustomChangesView({ search, setSearch }: { search: string; setSearch: (s: string) => void }) {
  const [data, setData] = useState<CustomChangesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<CustomChange | null>(null);
  const [fileDiff, setFileDiff] = useState('');
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [tab, setTab] = useState<'files' | 'features' | 'conflict' | 'stats'>('files');

  useEffect(() => {
    void fetchApi<CustomChangesResult>('/custom-changes').then(setData).finally(() => setLoading(false));
  }, []);

  const allFeatures = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.changes.flatMap(c => c.features))].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let result = data.changes;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => c.path.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.features.some(f => f.toLowerCase().includes(q)));
    }
    if (selectedFeature) {
      result = result.filter(c => c.features.includes(selectedFeature));
    }
    return result;
  }, [data, search, selectedFeature]);

  const loadDiff = useCallback(async (file: CustomChange) => {
    setSelectedFile(file);
    const resp = await fetchApi<{ diff: string }>('/custom-diff', { file: file.path });
    setFileDiff(resp.diff);
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>;
  if (!data) return <EmptyState icon="❌" title="加载失败" description="无法获取自定义修改数据" />;

  const highRisk = data.changes.filter(c => c.conflictRisk === 'high').length;
  const medRisk = data.changes.filter(c => c.conflictRisk === 'medium').length;
  const lowRisk = data.changes.filter(c => c.conflictRisk === 'low').length;
  const deletedUpstream = data.changes.filter(c => c.deletedUpstream).length;

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 p-4 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <Stat label="修改文件" value={data.totalFiles} icon="📁" />
        <Stat label="新增行数" value={`+${data.totalAdded}`} icon="+" />
        <Stat label="删除行数" value={`-${data.totalRemoved}`} icon="-" />
        <Stat label="上游已删除" value={deletedUpstream} icon="⚠️" />
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <TabButton active={tab === 'files'} onClick={() => setTab('files')}>文件列表</TabButton>
        <TabButton active={tab === 'features'} onClick={() => setTab('features')}>功能分类</TabButton>
        <TabButton active={tab === 'conflict'} onClick={() => setTab('conflict')}>冲突分析</TabButton>
        <TabButton active={tab === 'stats'} onClick={() => setTab('stats')}>统计</TabButton>
      </div>

      {/* Search & Filter */}
      {tab === 'files' && (
        <div className="flex items-center gap-3 mb-4">
          <input type="text" placeholder="搜索文件、功能、描述..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 rounded-xl text-sm outline-none"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
          <select value={selectedFeature ?? ''} onChange={(e) => setSelectedFeature(e.target.value || null)}
            className="px-3 py-2 rounded-xl text-sm outline-none max-w-[160px]"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
            <option value="">全部功能</option>
            {allFeatures.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className="text-sm shrink-0" style={{ color: "var(--text2)" }}>{filtered.length} 个文件</span>
        </div>
      )}

      {/* Files Tab */}
      {tab === 'files' && (
        <div className="grid gap-3">
          {filtered.map((f) => <CustomFileCard key={f.path} file={f} onClick={() => void loadDiff(f)} />)}
        </div>
      )}

      {/* Features Tab */}
      {tab === 'features' && (
        <div className="space-y-4">
          {allFeatures.map(feat => {
            const featFiles = data.changes.filter(c => c.features.includes(feat));
            return (
              <div key={feat} className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="px-4 py-3 font-semibold text-sm" style={{ background: "var(--surface2)" }}>
                  {feat}（{featFiles.length} 个文件）
                </div>
                <div>
                  {featFiles.map(f => (
                    <div key={f.path} className="px-4 py-3 cursor-pointer hover:opacity-80 transition-opacity"
                      style={{ borderTop: "1px solid var(--border)" }}
                      onClick={() => void loadDiff(f)}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-mono truncate">{f.path}</span>
                        <span className="text-sm font-mono shrink-0 ml-3">
                          <span style={{ color: "var(--green)" }}>+{f.added}</span>{' '}
                          <span style={{ color: "var(--red)" }}>-{f.removed}</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Conflict Tab */}
      {tab === 'conflict' && (
        <div className="space-y-2">
          {[...data.changes].sort((a, b) => {
            const order = { high: 0, medium: 1, low: 2 };
            return (order[a.conflictRisk as keyof typeof order] ?? 3) - (order[b.conflictRisk as keyof typeof order] ?? 3);
          }).map(f => (
            <div key={f.path} className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:opacity-80 transition-opacity"
              style={{ background: "var(--surface)", border: `1px solid ${f.deletedUpstream ? "var(--red)" : "var(--border)"}` }}
              onClick={() => void loadDiff(f)}>
              <Badge color={f.conflictRisk === 'high' ? "var(--red)" : f.conflictRisk === 'medium' ? "var(--yellow)" : "var(--green)"}>
                {f.conflictRisk === 'high' ? '高' : f.conflictRisk === 'medium' ? '中' : '低'}
              </Badge>
              {f.deletedUpstream && <Badge color="var(--red)">已删除</Badge>}
              <span className="text-sm font-mono flex-1 truncate">{f.path}</span>
              <span className="text-xs font-mono shrink-0" style={{ color: "var(--text2)" }}>
                +{f.added} / -{f.removed}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stats Tab */}
      {tab === 'stats' && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h3 className="text-sm font-semibold mb-3">按风险分布</h3>
            <div className="space-y-3">
              {[
                { label: "高风险", count: highRisk, color: "var(--red)" },
                { label: "中风险", count: medRisk, color: "var(--yellow)" },
                { label: "低风险", count: lowRisk, color: "var(--green)" },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs w-12" style={{ color: "var(--text2)" }}>{label}</span>
                  <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${(count / data.totalFiles) * 100}%`, background: color }} />
                  </div>
                  <span className="text-xs w-6 text-right font-semibold" style={{ color }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-6 rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h3 className="text-sm font-semibold mb-3">按功能分布</h3>
            <div className="space-y-2">
              {allFeatures.map(feat => {
                const count = data.changes.filter(c => c.features.includes(feat)).length;
                return (
                  <div key={feat} className="flex items-center gap-3">
                    <span className="text-xs w-24 truncate" style={{ color: "var(--text2)" }}>{feat}</span>
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}>
                      <div className="h-full rounded-full" style={{ width: `${(count / data.totalFiles) * 100}%`, background: "var(--accent)" }} />
                    </div>
                    <span className="text-xs w-6 text-right font-semibold" style={{ color: "var(--accent)" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {selectedFile && <FileDetail file={selectedFile} diff={fileDiff} onClose={() => { setSelectedFile(null); setFileDiff(''); }} />}
    </>
  );
}

// ── Upstream Config Panel ──────────────────────────────────
function UpstreamConfigPanel({ onConfigured }: { onConfigured: () => void }) {
  const [config, setConfig] = useState<UpstreamConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<UpstreamConfig>('/upstream-config');
      setConfig(data);
      setNewUrl(data.upstreamUrl || '');
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const saveUpstream = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const resp = await fetch('/api/git/set-upstream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl }),
      });
      const result = await resp.json();
      if (result.success) {
        setEditing(false);
        await loadConfig();
        onConfigured();
      } else {
        setSaveError(result.error);
      }
    } catch (err: any) {
      setSaveError(err.message);
    } finally { setSaving(false); }
  };

  if (loading) return <div className="p-4 text-sm" style={{ color: "var(--text2)" }}>加载上游配置...</div>;

  return (
    <div className="p-4 rounded-xl mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span>⚙️</span> 上游仓库配置
        </h3>
        {!editing && (
          <button onClick={() => setEditing(true)} className="px-3 py-1 rounded-lg text-xs"
            style={{ background: "var(--surface2)", color: "var(--text2)", border: "1px solid var(--border)" }}>
            {config?.hasUpstream ? '修改' : '配置'}
          </button>
        )}
      </div>

      {config?.hasUpstream && !editing ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--green)", color: "#fff" }}>已配置</span>
            <span className="text-sm font-mono truncate" style={{ color: "var(--text)" }}>{config.upstreamUrl}</span>
          </div>
          {config.remotes.length > 1 && (
            <div className="text-xs" style={{ color: "var(--text2)" }}>
              其他远程仓库：{config.remotes.filter(r => r.name !== 'upstream').map(r => `${r.name} → ${r.url}`).join(', ')}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: "var(--text2)" }}>
            配置上游仓库地址，用于对比你的修改与上游最新版本的差异。
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs shrink-0" style={{ color: "var(--text2)" }}>upstream →</span>
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://github.com/BigPizzaV3/CodexPlusPlus.git"
              className="flex-1 px-3 py-1.5 rounded-lg text-sm font-mono outline-none"
              autoComplete="off"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void saveUpstream()} disabled={saving || !newUrl}
              className="px-4 py-1.5 rounded-lg text-sm disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}>
              {saving ? '保存中...' : '保存'}
            </button>
            {config?.hasUpstream && (
              <button onClick={() => { setEditing(false); setNewUrl(config.upstreamUrl); }}
                className="px-4 py-1.5 rounded-lg text-sm"
                style={{ background: "var(--surface2)", color: "var(--text2)" }}>
                取消
              </button>
            )}
          </div>
          {saveError && (
            <p className="text-xs" style={{ color: "var(--red)" }}>{saveError}</p>
          )}
          <div className="text-xs" style={{ color: "var(--text2)" }}>
            💡 常用上游地址：
            <button onClick={() => setNewUrl('https://github.com/BigPizzaV3/CodexPlusPlus.git')}
              className="ml-1 underline" style={{ color: "var(--accent)" }}>BigPizzaV3/CodexPlusPlus</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upstream Analysis View ─────────────────────────────────
function UpstreamAnalysisView() {
  const [analysis, setAnalysis] = useState<UpstreamAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UpstreamAnalysis | null>(null);
  const [skipFetch, setSkipFetch] = useState(false);
  const [fetchPhase, setFetchPhase] = useState<'idle' | 'fetching' | 'analyzing'>('idle');
  const [retryCount, setRetryCount] = useState(0);

  const fetchData = useCallback(async (skip = false) => {
    setLoading(true);
    setError(null);
    setFetchPhase(skip ? 'analyzing' : 'fetching');

    try {
      const data = await fetchApi<UpstreamAnalysis>('/upstream-analysis', {
        skipFetch: skip ? 'true' : 'false',
      });

      // 检查是否是业务错误（NO_UPSTREAM / NO_FETCH_HEAD）
      if (data.errorCode) {
        setError(data);
        setAnalysis(null);
      } else {
        setAnalysis(data);
        setError(null);
      }
    } catch (err: any) {
      setError({
        error: err.message,
        errorCode: 'NETWORK_ERROR',
        help: '无法连接到 API 服务器。请确保 dev server 正在运行。',
      } as UpstreamAnalysis);
    } finally {
      setLoading(false);
      setFetchPhase('idle');
    }
  }, []);

  useEffect(() => { void fetchData(skipFetch); }, [fetchData, skipFetch, retryCount]);

  // Loading 状态
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Spinner size={40} />
        <p className="mt-4 text-sm font-medium" style={{ color: "var(--text)" }}>
          {fetchPhase === 'fetching' ? '正在从 GitHub 拉取上游数据...' : '正在分析差异...'}
        </p>
        <p className="mt-2 text-xs" style={{ color: "var(--text2)" }}>
          {fetchPhase === 'fetching'
            ? '如果长时间卡住，可能是网络问题。你可以「跳过 Fetch」使用缓存数据。'
            : '对比你的提交与上游最新版本...'}
        </p>
        {fetchPhase === 'fetching' && (
          <button onClick={() => { setLoading(false); setSkipFetch(true); setFetchPhase('idle'); }}
            className="mt-4 px-4 py-2 rounded-lg text-sm"
            style={{ background: "var(--surface2)", color: "var(--text2)", border: "1px solid var(--border)" }}>
            ⏭ 跳过 Fetch，使用缓存数据
          </button>
        )}
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="space-y-4">
        <UpstreamConfigPanel onConfigured={() => setRetryCount(c => c + 1)} />
        <div className="p-6 rounded-xl" style={{
          background: "var(--surface)",
          border: `1px solid ${error.errorCode === 'NO_UPSTREAM' ? 'var(--yellow)' : 'var(--red)'}`,
        }}>
          <div className="flex items-start gap-3">
            <span className="text-2xl">{error.errorCode === 'NO_UPSTREAM' ? '⚙️' : '⚠️'}</span>
            <div className="flex-1">
              <h3 className="text-lg font-semibold mb-2" style={{ color: error.errorCode === 'NO_UPSTREAM' ? 'var(--yellow)' : 'var(--red)' }}>
                {error.errorCode === 'NO_UPSTREAM' ? '未配置上游仓库' :
                 error.errorCode === 'NO_FETCH_HEAD' ? '无法获取上游数据' :
                 '获取上游分析失败'}
              </h3>
              <p className="text-sm mb-3" style={{ color: "var(--text2)" }}>{error.error}</p>
              {error.help && (
                <pre className="text-xs p-3 rounded-lg mb-3 whitespace-pre-wrap"
                  style={{ background: "var(--bg)", color: "var(--text2)", border: "1px solid var(--border)" }}>
                  {error.help}
                </pre>
              )}
              {error.fetchError && (
                <div className="text-xs p-3 rounded-lg mb-3" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid var(--yellow)" }}>
                  <strong>Fetch 错误详情：</strong> {error.fetchError}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setRetryCount(c => c + 1)}
                  className="px-4 py-2 rounded-lg text-sm"
                  style={{ background: "var(--accent)", color: "#fff" }}>
                  🔄 重试
                </button>
                {error.errorCode === 'NO_FETCH_HEAD' && (
                  <button onClick={() => { setSkipFetch(true); setRetryCount(c => c + 1); }}
                    className="px-4 py-2 rounded-lg text-sm"
                    style={{ background: "var(--surface2)", color: "var(--text2)", border: "1px solid var(--border)" }}>
                    ⏭ 跳过 Fetch
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="space-y-4">
      {/* Upstream Config */}
      <UpstreamConfigPanel onConfigured={() => setRetryCount(c => c + 1)} />

      {/* Fetch Warning */}
      {analysis.fetchError && (
        <div className="p-4 rounded-xl text-sm" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid var(--yellow)" }}>
          <div className="flex items-start gap-2">
            <span>⚠️</span>
            <div>
              <strong>Fetch 上游失败</strong> — 使用的是缓存的上游数据，可能不是最新版本。
              <pre className="mt-2 text-xs whitespace-pre-wrap" style={{ color: "var(--text2)" }}>{analysis.fetchError}</pre>
              <button onClick={() => { setSkipFetch(false); setRetryCount(c => c + 1); }}
                className="mt-2 px-3 py-1 rounded-lg text-xs"
                style={{ background: "var(--accent)", color: "#fff" }}>
                🔄 重新 Fetch
              </button>
            </div>
          </div>
        </div>
      )}

      {analysis.fetchSkipped && (
        <div className="p-3 rounded-xl text-xs" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          💡 已跳过 Fetch，使用缓存的上游数据。点击
          <button onClick={() => { setSkipFetch(false); setRetryCount(c => c + 1); }}
            className="mx-1 underline" style={{ color: "var(--accent)" }}>重新加载</button>
          可获取最新数据。
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6 rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <Stat label="你的提交" value={analysis.myCommits.length} icon="📝" />
        <Stat label="你的文件" value={analysis.myFilesCount} icon="📁" />
        <Stat label="上游新提交" value={analysis.upstreamCommits.length} icon="⬆️" />
        <Stat label="冲突文件" value={analysis.conflictCount} icon="⚠️" />
      </div>

      {/* Fork Info */}
      <div className="p-4 rounded-xl text-sm font-mono" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <span style={{ color: "var(--text2)" }}>Fork 点：</span>
        <span style={{ color: "var(--accent)" }}>{analysis.forkBase}</span>
        <span style={{ color: "var(--text2)" }}> → 当前：</span>
        <span style={{ color: "var(--green)" }}>{analysis.currentHead}</span>
        <span style={{ color: "var(--text2)" }}> → 上游：</span>
        <span style={{ color: "var(--yellow)" }}>{analysis.upstreamHead}</span>
      </div>

      {/* Conflict Files */}
      {analysis.conflictFiles.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--red)" }}>
          <div className="px-4 py-3 font-semibold text-sm" style={{ background: "rgba(239,68,68,0.1)" }}>
            ⚠️ 冲突文件（你和上游都修改了，{analysis.conflictCount} 个）
          </div>
          <div>
            {analysis.conflictFiles.map(f => (
              <div key={f} className="px-4 py-2 text-sm font-mono" style={{ borderTop: "1px solid var(--border)" }}>
                {f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Commits */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 font-semibold text-sm" style={{ background: "var(--surface2)" }}>
          你的自定义提交（{analysis.myCommits.length} 个）
        </div>
        <div>
          {analysis.myCommits.map(c => (
            <div key={c.hash} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: "1px solid var(--border)" }}>
              <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>{c.hash}</span>
              <span className="text-sm flex-1">{c.message}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Upstream Commits */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="px-4 py-3 font-semibold text-sm" style={{ background: "var(--surface2)" }}>
          上游新提交（{analysis.upstreamCommits.length} 个）
        </div>
        <div className="max-h-96 overflow-auto">
          {analysis.upstreamCommits.slice(0, 30).map(c => (
            <div key={c.hash} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: "1px solid var(--border)" }}>
              <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: "var(--surface2)", color: "var(--text2)" }}>{c.hash}</span>
              <span className="text-sm flex-1 truncate">{c.message}</span>
            </div>
          ))}
          {analysis.upstreamCommits.length > 30 && (
            <div className="px-4 py-2 text-xs text-center" style={{ color: "var(--text2)", borderTop: "1px solid var(--border)" }}>
              ... 还有 {analysis.upstreamCommits.length - 30} 个提交
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── History View ───────────────────────────────────────────
function HistoryView() {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchApi<Commit[]>('/log', { limit: '50' }).then(setCommits).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>;
  if (commits.length === 0) return <EmptyState icon="📝" title="没有提交记录" description="还没有任何 Git 提交" />;

  return (
    <div className="space-y-2">
      {commits.map((commit) => (
        <div key={commit.hash} className="p-4 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono mb-1" style={{ color: "var(--accent)" }}>{commit.hash}</div>
              <div className="text-sm">{commit.message}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs" style={{ color: "var(--text2)" }}>{commit.author}</div>
              <div className="text-xs" style={{ color: "var(--text2)" }}>{new Date(commit.date).toLocaleDateString('zh-CN')}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Branches View ──────────────────────────────────────────
function BranchesView() {
  const [branchData, setBranchData] = useState<{ current: string; branches: Branch[] }>({ current: '', branches: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchApi<{ current: string; branches: Branch[] }>('/branches').then(setBranchData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>;
  if (branchData.branches.length === 0) return <EmptyState icon="🌿" title="没有分支" description="还没有创建任何分支" />;

  return (
    <div className="space-y-2">
      {branchData.branches.map((branch) => (
        <div key={branch.name} className="flex items-center gap-3 p-4 rounded-xl"
          style={{ background: branch.current ? "var(--accent-bg)" : "var(--surface)", border: `1px solid ${branch.current ? "var(--accent)" : "var(--border)"}` }}>
          <span className="text-lg">{branch.current ? '🌿' : '📁'}</span>
          <span className="text-sm font-mono flex-1">{branch.name}</span>
          {branch.current && <Badge color="var(--green)">当前</Badge>}
        </div>
      ))}
    </div>
  );
}

// ── App ────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>("custom");
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchBasicData = useCallback(async () => {
    try {
      const [info, status] = await Promise.all([
        fetchApi<GitInfo>('/info'),
        fetchApi<GitStatus>('/status'),
      ]);
      setGitInfo(info);
      setGitStatus(status);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const { lastRefresh, refresh } = useAutoRefresh(fetchBasicData, 10000);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center">
          <Spinner size={48} />
          <p className="mt-4 text-sm" style={{ color: "var(--text2)" }}>正在扫描 Git 仓库...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center max-w-md p-6 rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--red)" }}>
          <span className="text-4xl mb-4 block">⚠️</span>
          <h2 className="text-lg font-semibold mb-2">连接失败</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text2)" }}>{error}</p>
          <button onClick={() => void refresh()} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--accent)", color: "#fff" }}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="sticky top-0 z-40 px-6 py-4" style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
                <span className="text-2xl">🔍</span>
                Ucodex DevTools
              </h1>
              <p className="text-xs" style={{ color: "var(--text2)" }}>
                {gitInfo?.currentBranch && <span className="inline-flex items-center gap-1 mr-3">🌿 <span className="font-mono">{gitInfo.currentBranch}</span></span>}
                {gitInfo?.latestCommit && <span className="inline-flex items-center gap-1 mr-3">📝 <span className="font-mono">{gitInfo.latestCommit}</span> {gitInfo.latestCommitMsg}</span>}
                {lastRefresh && <span className="inline-flex items-center gap-1">🕐 {lastRefresh.toLocaleTimeString('zh-CN')}</span>}
              </p>
            </div>
          </div>

          {/* Status Bar */}
          {gitStatus && (
            <div className="flex items-center gap-4 mb-4 p-3 rounded-xl text-xs" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--green)" }} /> Staged: {gitStatus.staged}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--yellow)" }} /> Modified: {gitStatus.modified}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--text2)" }} /> Untracked: {gitStatus.not_added}</span>
              {gitStatus.deleted > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--red)" }} /> Deleted: {gitStatus.deleted}</span>}
              {gitStatus.ahead > 0 && <span>⬆ Ahead: {gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span>⬇ Behind: {gitStatus.behind}</span>}
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            <TabButton active={tab === "custom"} onClick={() => { setTab("custom"); setSearch(""); }}>自定义修改</TabButton>
            <TabButton active={tab === "upstream"} onClick={() => setTab("upstream")}>上游分析</TabButton>
            <TabButton active={tab === "working"} onClick={() => { setTab("working"); setSearch(""); }} count={gitStatus?.modified}>工作区</TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>提交历史</TabButton>
            <TabButton active={tab === "branches"} onClick={() => setTab("branches")}>分支</TabButton>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-5xl mx-auto px-6 py-6">
        {tab === "custom" && <CustomChangesView search={search} setSearch={setSearch} />}
        {tab === "upstream" && <UpstreamAnalysisView />}
        {tab === "working" && <WorkingChangesView search={search} setSearch={setSearch} />}
        {tab === "history" && <HistoryView />}
        {tab === "branches" && <BranchesView />}
      </main>
    </div>
  );
}
