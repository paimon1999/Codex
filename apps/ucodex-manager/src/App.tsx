import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { FloatingMode } from "./FloatingMode";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  CheckCircle2,
  CircleArrowUp,
  Copy,
  Download,
  Edit3,
  FileCog,
  GripVertical,
  Info,
  ExternalLink,
  Hammer,
  KeyRound,
  LayoutDashboard,
  Link2,
  MessageCircle,
  FileCode2,
  Moon,
  Network,
  Play,
  Power,
  PowerOff,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Settings,
  ShieldCheck,
  Sun,
  TestTube,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

import { Badge as UiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Status = "ok" | "failed" | "not_implemented" | "not_checked" | string;

type CommandResult<T> = T & {
  status: Status;
  message: string;
};

type PathState = {
  status: string;
  path: string | null;
};

type LaunchStatus = {
  status: string;
  message: string;
  started_at_ms: number;
  debug_port: number | null;
  helper_port: number | null;
  codex_app: string | null;
};

type OverviewResult = CommandResult<{
  codex_app: PathState;
  codex_version: string | null;
  silent_shortcut: PathState;
  management_shortcut: PathState;
  latest_launch: LaunchStatus | null;
  current_version: string;
  update_status: string;
  settings_path: string;
  logs_path: string;
}>;

type BackendSettings = {
  codexAppPath: string;
  codexExtraArgs: string[];
  providerSyncEnabled: boolean;
  providerSyncSavedProviders: string[];
  providerSyncManualProviders: string[];
  providerSyncLastSelectedProvider: string;
  relayProfilesEnabled: boolean;
  ccsLinkEnabled: boolean;
  enhancementsEnabled: boolean;
  codexAppPluginEntryUnlock: boolean;
  codexAppPluginMarketplaceUnlock: boolean;
  codexAppForcePluginInstall: boolean;
  codexAppModelWhitelistUnlock: boolean;
  codexAppSessionDelete: boolean;
  codexAppMarkdownExport: boolean;
  codexAppProjectMove: boolean;
  codexAppConversationTimeline: boolean;
  codexAppConversationView: boolean;
  codexAppThreadScrollRestore: boolean;
  codexAppUpstreamWorktreeCreate: boolean;
  codexAppNativeMenuPlacement: boolean;
  codexAppServiceTierControls: boolean;
  codexGoalsEnabled: boolean;
  launchMode: LaunchMode;
  relayBaseUrl: string;
  relayApiKey: string;
  relayProfiles: RelayProfile[];
  relayCommonConfigContents: string;
  relayContextConfigContents: string;
  activeRelayId: string;
  relayTestModel: string;
  cliWrapperEnabled: boolean;
  cliWrapperBaseUrl: string;
  cliWrapperApiKey: string;
  cliWrapperApiKeyEnv: string;
};

type LaunchMode = "patch" | "relay";

type RelayProfile = {
  id: string;
  linkedCcsProviderId: string;
  name: string;
  model: string;
  baseUrl: string;
  upstreamBaseUrl: string;
  apiKey: string;
  protocol: RelayProtocol;
  relayMode: RelayMode;
  officialMixApiKey: boolean;
  testModel: string;
  configContents: string;
  authContents: string;
  useCommonConfig: boolean;
  contextSelection: RelayContextSelection;
  contextSelectionInitialized: boolean;
  contextWindow: string;
  autoCompactLimit: string;
  modelList: string;
  userAgent: string;
};

type RelayContextSelection = {
  mcpServers: string[];
  skills: string[];
  plugins: string[];
};

type ContextKind = "mcp" | "skill" | "plugin";

type CodexContextEntry = {
  id: string;
  kind: ContextKind;
  title: string;
  summary: string;
  tomlBody: string;
  enabled: boolean;
};

type CodexContextEntries = {
  mcpServers: CodexContextEntry[];
  skills: CodexContextEntry[];
  plugins: CodexContextEntry[];
};

type RelayProtocol = "responses" | "chatCompletions";
type RelayMode = "official" | "mixedApi" | "pureApi";
const PROTOCOL_PROXY_BASE_URL = "http://127.0.0.1:57321/v1";
const CHAT_UPSTREAM_BASE_URL_KEY = "codex_plus_chat_base_url";
const SCRIPT_MARKET_REPOSITORY_URL = "https://github.com/BigPizzaV3/CodexPlusPlusScriptMarket";

const emptyContextSelection = (): RelayContextSelection => ({
  mcpServers: [],
  skills: [],
  plugins: [],
});

type UserScriptInventory = {
  enabled?: boolean;
  scripts?: Array<{
    key: string;
    name: string;
    source: string;
    enabled: boolean;
    status: string;
    error: string;
    market_id?: string;
    version?: string;
    installed?: boolean;
    source_url?: string;
    homepage?: string;
  }>;
};

type SettingsResult = CommandResult<{
  settings: BackendSettings;
  settings_path: string;
  user_scripts: UserScriptInventory;
}>;

type RelayResult = CommandResult<{
  authenticated: boolean;
  authSource: string;
  accountLabel: string | null;
  configPath: string;
  configured: boolean;
  requiresOpenaiAuth: boolean;
  hasBearerToken: boolean;
  backupPath: string | null;
}>;

type RelayFilesResult = CommandResult<{
  configPath: string;
  authPath: string;
  configContents: string;
  authContents: string;
}>;

type LocalSession = {
  id: string;
  title: string;
  cwd: string;
  modelProvider: string;
  archived: boolean;
  updatedAtMs: number | null;
  rolloutPath: string;
};

type LocalSessionsResult = CommandResult<{
  dbPath: string;
  sessions: LocalSession[];
}>;

type DeleteLocalSessionResult = CommandResult<{
  status: string;
  session_id: string;
  message: string;
  undo_token: string | null;
  backup_path: string | null;
}>;

type ContextEntriesResult = CommandResult<{
  settings: BackendSettings;
  entries: CodexContextEntries;
}>;

type LiveContextEntriesResult = CommandResult<{
  entries: CodexContextEntries;
}>;

type ExtractRelayCommonConfigResult = CommandResult<{
  commonConfigContents: string;
  profileConfigContents: string;
}>;

type SettingsBackfillResult = CommandResult<{
  settings: BackendSettings;
}>;

type RelayProfileTestResult = CommandResult<{
  httpStatus: number;
  endpoint: string;
  responsePreview: string;
}>;

type RelayProfileModelsResult = CommandResult<{
  models: string[];
  endpoint: string;
}>;

type CcsProviderImport = {
  sourceId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: RelayProtocol;
  configContents: string;
  authContents: string;
};

type ProviderSyncPayload = {
  syncStatus?: string;
  targetProvider?: string;
  changedSessionFiles?: number;
  skippedLockedRolloutFiles?: string[];
  sqliteRowsUpdated?: number;
  sqliteProviderRowsUpdated?: number;
  sqliteUserEventRowsUpdated?: number;
  sqliteCwdRowsUpdated?: number;
  updatedWorkspaceRoots?: number;
  encryptedContentWarning?: string | null;
};

type ProviderSyncTargetSource = "config" | "rollout" | "sqlite" | "manual";

type ProviderSyncTargetOption = {
  id: string;
  sources: ProviderSyncTargetSource[];
  isCurrentProvider: boolean;
  isManual: boolean;
  isSaved: boolean;
};

type ProviderSyncTargetsPayload = {
  currentProvider: string;
  targets: ProviderSyncTargetOption[];
};

type ProviderSyncTargetsResult = CommandResult<ProviderSyncTargetsPayload>;

type ProviderSyncProgress = {
  active: boolean;
  percent: number;
  message: string;
  result: CommandResult<ProviderSyncPayload> | null;
};

type LogsResult = CommandResult<{
  path: string;
  text: string;
  lines: number;
}>;

type DiagnosticsResult = CommandResult<{
  report: string;
}>;

type WatcherResult = CommandResult<{
  enabled: boolean;
  disabled_flag: string;
}>;

type InstallResult = CommandResult<{
  silent_shortcut: { installed: boolean; path: string | null };
  management_shortcut: { installed: boolean; path: string | null };
}>;

type UpdateResult = CommandResult<{
  currentVersion: string;
  latestVersion?: string | null;
  releaseSummary?: string;
  assetName?: string | null;
  assetUrl?: string | null;
  updateAvailable?: boolean;
  installedPath?: string;
  progress?: number;
}>;

type ScriptMarketItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  homepage: string;
  script_url: string;
  sha256: string;
  installed: boolean;
  installedVersion: string;
  updateAvailable: boolean;
};

type ScriptMarketResult = CommandResult<{
  market: {
    status: string;
    message: string;
    indexUrl: string;
    updatedAt: string;
    scripts: ScriptMarketItem[];
  };
  user_scripts: UserScriptInventory;
}>;

function providerSyncProgressMessage(result: CommandResult<ProviderSyncPayload>): string {
  const changed = result.changedSessionFiles ?? 0;
  const rows = result.sqliteRowsUpdated ?? 0;
  const target = result.targetProvider || "当前 provider";
  const skipped = result.skippedLockedRolloutFiles?.length ?? 0;
  const skippedText = skipped ? `，跳过 ${skipped} 个占用文件` : "";
  return `已同步到 ${target}：修复 ${changed} 个会话文件，更新 ${rows} 行索引${skippedText}。`;
}

const providerSyncSourceLabels: Record<ProviderSyncTargetSource, string> = {
  config: "配置",
  rollout: "会话",
  sqlite: "索引",
  manual: "手动",
};

function providerSyncTargetLabel(target: ProviderSyncTargetOption): string {
  const labels = target.sources.map((source) => providerSyncSourceLabels[source]).filter(Boolean);
  const current = target.isCurrentProvider ? ["当前"] : [];
  return [...labels, ...current].join(" / ") || "发现";
}

function syncMarketInstalledState(current: ScriptMarketResult | null, userScripts: UserScriptInventory): ScriptMarketResult | null {
  if (!current) return current;
  const installed = new Map(
    (userScripts.scripts ?? [])
      .filter((script) => script.market_id)
      .map((script) => [script.market_id || "", script.version || ""]),
  );
  return {
    ...current,
    user_scripts: userScripts,
    market: {
      ...current.market,
      scripts: current.market.scripts.map((script) => {
        const installedVersion = installed.get(script.id) || "";
        return {
          ...script,
          installed: Boolean(installedVersion),
          installedVersion,
          updateAvailable: Boolean(installedVersion) && installedVersion !== script.version,
        };
      }),
    },
  };
}

type StartupResult = CommandResult<{
  showUpdate: boolean;
}>;

type Route = "overview" | "relay" | "sessions" | "context" | "enhance" | "userScripts" | "proxyStats" | "processes" | "configEditor" | "maintenance" | "about" | "settings";
type Theme = "dark" | "light";

const routes: Array<{ id: Route; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "relay", label: "供应商配置", icon: KeyRound },
  { id: "sessions", label: "会话管理", icon: MessageCircle },
  { id: "context", label: "工具与插件", icon: Network },
  { id: "enhance", label: "页面增强", icon: Hammer },
  { id: "userScripts", label: "脚本市场", icon: FileCode2 },
  { id: "proxyStats", label: "代理统计", icon: BarChart3 },
  { id: "processes", label: "进程管理", icon: Activity },
  { id: "configEditor", label: "配置管理", icon: FileCog },
  { id: "maintenance", label: "安装维护", icon: Wrench },
  { id: "about", label: "关于", icon: Info },
  { id: "settings", label: "设置", icon: Settings },
];

const defaultSettings: BackendSettings = {
  codexAppPath: "",
  codexExtraArgs: [],
  providerSyncEnabled: false,
  providerSyncSavedProviders: [],
  providerSyncManualProviders: [],
  providerSyncLastSelectedProvider: "",
  relayProfilesEnabled: true,
  ccsLinkEnabled: false,
  enhancementsEnabled: true,
  codexAppPluginEntryUnlock: true,
  codexAppPluginMarketplaceUnlock: true,
  codexAppForcePluginInstall: true,
  codexAppModelWhitelistUnlock: true,
  codexAppSessionDelete: true,
  codexAppMarkdownExport: true,
  codexAppProjectMove: true,
  codexAppConversationTimeline: true,
  codexAppConversationView: false,
  codexAppThreadScrollRestore: true,
  codexAppUpstreamWorktreeCreate: true,
  codexAppNativeMenuPlacement: true,
  codexAppServiceTierControls: false,
  codexGoalsEnabled: false,
  launchMode: "patch",
  relayBaseUrl: "",
  relayApiKey: "",
  relayProfiles: [
    {
      id: "default",
      linkedCcsProviderId: "",
      name: "默认中转",
      model: "",
      baseUrl: "",
      upstreamBaseUrl: "",
      apiKey: "",
      protocol: "responses",
      relayMode: "official",
      officialMixApiKey: false,
      testModel: "",
      configContents: "",
      authContents: "",
      useCommonConfig: true,
      contextSelection: emptyContextSelection(),
      contextSelectionInitialized: true,
      contextWindow: "",
      autoCompactLimit: "",
      modelList: "",
      userAgent: "",
    },
  ],
  relayCommonConfigContents: "",
  relayContextConfigContents: "",
  activeRelayId: "default",
  relayTestModel: "gpt-5.4-mini",
  cliWrapperEnabled: false,
  cliWrapperBaseUrl: "",
  cliWrapperApiKey: "",
  cliWrapperApiKeyEnv: "CUSTOM_OPENAI_API_KEY",
};

export function App() {
  const [theme, setTheme] = useState<Theme>(() => loadInitialTheme());
  const [route, setRoute] = useState<Route>(() => loadInitialRoute());
  const [notice, setNotice] = useState<{ title: string; message: string; status?: Status } | null>(null);
  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [settings, setSettings] = useState<SettingsResult | null>(null);
  const [relay, setRelay] = useState<RelayResult | null>(null);
  const [relayFiles, setRelayFiles] = useState<RelayFilesResult | null>(null);
  const [localSessions, setLocalSessions] = useState<LocalSessionsResult | null>(null);
  const [liveContextEntries, setLiveContextEntries] = useState<CodexContextEntries | null>(null);
  const [logs, setLogs] = useState<LogsResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [watcher, setWatcher] = useState<WatcherResult | null>(null);
  const [update, setUpdate] = useState<UpdateResult | null>(null);
  const [scriptMarket, setScriptMarket] = useState<ScriptMarketResult | null>(null);
  const [launchForm, setLaunchForm] = useState({
    appPath: "",
    debugPort: "9229",
    helperPort: "57321",
  });
  const [settingsForm, setSettingsForm] = useState<BackendSettings>({ ...defaultSettings });
  const [providerSyncProgress, setProviderSyncProgress] = useState<ProviderSyncProgress>({
    active: false,
    percent: 0,
    message: "尚未运行历史会话修复。",
    result: null,
  });
  const [providerSyncTargets, setProviderSyncTargets] = useState<ProviderSyncTargetsResult | null>(null);
  const [selectedProviderSyncTarget, setSelectedProviderSyncTarget] = useState("");
  const [removeOwnedData, setRemoveOwnedData] = useState(false);
  const [proxyStats, setProxyStats] = useState<Record<string, unknown> | null>(null);
  const [codexConfig, setCodexConfig] = useState<Record<string, unknown> | null>(null);
  const [floatingMode, setFloatingMode] = useState(false);

  // ─── 灵动岛模式：同步窗口属性 + body class ──
  useEffect(() => {
    if (floatingMode) {
      document.body.classList.add("floating-mode");
    } else {
      document.body.classList.remove("floating-mode");
    }
    invoke("set_floating_mode", { enabled: floatingMode }).catch((e) => {
      console.warn("[FloatingMode] set_floating_mode failed:", e);
    });
  }, [floatingMode]);

  const call = <T,>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

  const logDiagnostic = (event: string, detail: Record<string, unknown> = {}) => {
    void invoke("write_diagnostic_event", { event, detail }).catch(() => {});
  };

  const run = async <T,>(task: () => Promise<T>): Promise<T | null> => {
    try {
      return await task();
    } catch (error) {
      showNotice("调用失败", stringifyError(error), "failed");
      return null;
    }
  };

  const refreshOverview = async (silent = false) => {
    const result = await run(() => call<OverviewResult>("load_overview"));
    if (result) {
      setOverview(result);
      if (!silent) showResultNotice("概览已检查", result, { silentSuccess: true });
    }
  };

  const refreshSettings = async (silent = false) => {
    const result = await run(() => call<SettingsResult>("load_settings"));
    if (result) {
      setSettings(result);
      const normalized = normalizeSettings(result.settings);
      setSettingsForm(normalized);
      setLaunchForm((current) => ({
        ...current,
        appPath: current.appPath || result.settings.codexAppPath || "",
      }));
      if (!silent) showResultNotice("设置已加载", result, { silentSuccess: true });
      return normalized;
    }
    return null;
  };

  const refreshScriptMarket = async (silent = false) => {
    const result = await run(() => call<ScriptMarketResult>("refresh_script_market"));
    if (result) {
      setScriptMarket(result);
      setSettings((current) => (current ? { ...current, user_scripts: result.user_scripts } : current));
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("脚本市场", result, { silentSuccess: true });
    }
  };

  const installMarketScript = async (id: string) => {
    const result = await run(() => call<ScriptMarketResult>("install_market_script", { id }));
    if (result) {
      setScriptMarket(result);
      setSettings((current) => (current ? { ...current, user_scripts: result.user_scripts } : current));
      showResultNotice("脚本市场", result);
    }
  };

  const setUserScriptEnabled = async (key: string, enabled: boolean) => {
    const result = await run(() => call<SettingsResult>("set_user_script_enabled", { key, enabled }));
    if (result) {
      setSettings(result);
      setScriptMarket((current) => syncMarketInstalledState(current, result.user_scripts));
      showResultNotice("本地脚本", result);
    }
  };

  const deleteUserScript = async (key: string) => {
    const script = settings?.user_scripts?.scripts?.find((item) => item.key === key);
    const name = script?.name || key;
    if (!window.confirm(`删除脚本“${name}”？此操作会移除本地脚本文件。`)) return;
    const result = await run(() => call<SettingsResult>("delete_user_script", { key }));
    if (result) {
      setSettings(result);
      setScriptMarket((current) => syncMarketInstalledState(current, result.user_scripts));
      showResultNotice("本地脚本", result);
    }
  };

  const refreshRelay = async (silent = false) => {
    const result = await run(() => call<RelayResult>("relay_status"));
    if (result) {
      setRelay(result);
      if (!silent) showResultNotice("登录状态", result, { silentSuccess: true });
    }
  };

  const refreshRelayFiles = async (silent = false) => {
    const result = await run(() => call<RelayFilesResult>("read_relay_files"));
    if (result) {
      setRelayFiles(result);
      if (!silent) showResultNotice("配置文件", result, { silentSuccess: true });
    }
    return result;
  };

  const refreshLocalSessions = async (silent = false) => {
    const result = await run(() => call<LocalSessionsResult>("list_local_sessions"));
    if (result) {
      setLocalSessions(result);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("会话管理", result, { silentSuccess: true });
    }
    return result;
  };

  const deleteLocalSession = async (session: LocalSession) => {
    const title = session.title || session.id;
    if (!window.confirm(`删除会话“${title}”？此操作会删除本地数据库记录和 rollout 文件，并创建备份。`)) return;
    const result = await run(() =>
      call<DeleteLocalSessionResult>("delete_local_session", {
        request: { sessionId: session.id, title: session.title },
      }),
    );
    if (result) {
      showResultNotice("会话删除", result);
      await refreshLocalSessions(true);
    }
  };

  const refreshLiveContextEntries = async (silent = false) => {
    const result = await run(() => call<LiveContextEntriesResult>("read_live_context_entries"));
    if (result) {
      setLiveContextEntries(result.entries);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("工具与插件", result, { silentSuccess: true });
    }
    return result;
  };

  const syncLiveContextEntries = async (next: BackendSettings, silent = false) => {
    const result = await run(() => call<LiveContextEntriesResult>("sync_live_context_entries", { request: { settings: next } }));
    if (result) {
      setLiveContextEntries(result.entries);
      if (!silent || !isSuccessStatus(result.status)) showResultNotice("工具与插件", result, { silentSuccess: true });
    }
    return result;
  };

  const refreshLogs = async (silent = false) => {
    const result = await run(() => call<LogsResult>("read_latest_logs", { request: { lines: 240 } }));
    if (result) {
      setLogs(result);
      if (!silent) showResultNotice("日志已刷新", result, { silentSuccess: true });
    }
  };

  const refreshDiagnostics = async (silent = false) => {
    const result = await run(() => call<DiagnosticsResult>("copy_diagnostics"));
    if (result) {
      setDiagnostics(result);
      if (!silent) showResultNotice("诊断已生成", result, { silentSuccess: true });
    }
  };

  const refreshWatcher = async (silent = false) => {
    const result = await run(() => call<WatcherResult>("load_watcher_state"));
    if (result) {
      setWatcher(result);
      if (!silent) showResultNotice("Watcher 状态", result, { silentSuccess: true });
    }
  };

  const refreshProxyStats = async (silent = false) => {
    const result = await run(() => call<Record<string, unknown>>("load_proxy_stats"));
    if (result) {
      setProxyStats(result);
      if (!silent) showNotice("代理统计", "已刷新代理统计数据。", "ok");
    }
  };

  const refreshCodexConfig = async (silent = false) => {
    const result = await run(() => call<Record<string, unknown>>("load_codex_config"));
    if (result) {
      setCodexConfig(result);
      if (!silent) showNotice("配置管理", "已加载 config.toml。", "ok");
    }
  };

  const navigate = async (next: Route) => {
    setRoute(next);
    if (next === "overview") await refreshOverview(true);
    if (next === "relay") {
      await refreshSettings(true);
      await refreshRelay(true);
      await refreshRelayFiles(true);
    }
    if (next === "sessions") {
      await refreshSettings(true);
      await refreshLocalSessions(true);
      await refreshProviderSyncTargets(true);
    }
    if (next === "context") {
      await refreshSettings(true);
      await refreshRelayFiles(true);
      await refreshLiveContextEntries(true);
    }
    if (next === "settings") await refreshSettings(true);
    if (next === "userScripts") {
      await refreshSettings(true);
      await refreshScriptMarket(true);
    }
    if (next === "proxyStats") await refreshProxyStats(true);
    if (next === "configEditor") await refreshCodexConfig(true);
    if (next === "about") {
      await refreshOverview(true);
      await refreshLogs(true);
      await refreshDiagnostics(true);
    }
    if (next === "maintenance") {
      await refreshOverview(true);
      await refreshWatcher(true);
    }
  };

  const launch = async () => {
    const result = await launchCommand("launch_ucodex");
    if (result) {
      showNotice("启动 Ucodex", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const launchCodexAppOnly = async () => {
    const result = await run(() =>
      call<CommandResult<Record<string, unknown>>>("launch_codex_app_only", {
        request: {
          appPath: launchForm.appPath,
          debugPort: numberOrDefault(launchForm.debugPort, 9229),
          helperPort: numberOrDefault(launchForm.helperPort, 57321),
        },
      }),
    );
    if (result) {
      showNotice("启动 Codex", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const restart = async () => {
    const result = await launchCommand("restart_ucodex");
    if (result) {
      showNotice("重启 Ucodex", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const launchCommand = async (command: "launch_ucodex" | "restart_ucodex") => {
    const result = await run(() =>
      call<CommandResult<Record<string, unknown>>>(command, {
        request: {
          appPath: launchForm.appPath,
          debugPort: numberOrDefault(launchForm.debugPort, 9229),
          helperPort: numberOrDefault(launchForm.helperPort, 57321),
        },
      }),
    );
    return result;
  };

  const repairBackend = async () => {
    const result = await run(() => call<SettingsResult>("repair_backend"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("后端修复", result.message, result.status);
    }
  };

  const installEntrypoints = async () => {
    const result = await run(() => call<InstallResult>("install_entrypoints"));
    if (result) {
      showNotice("入口安装", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const uninstallEntrypoints = async () => {
    const result = await run(() =>
      call<InstallResult>("uninstall_entrypoints", {
        options: { removeOwnedData },
      }),
    );
    if (result) {
      showNotice("入口卸载", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const repairShortcuts = async () => {
    const result = await run(() => call<InstallResult>("repair_shortcuts"));
    if (result) {
      showNotice("快捷方式修复", result.message, result.status);
      await refreshOverview(true);
    }
  };

  const watcherAction = async (command: string) => {
    const result = await run(() => call<WatcherResult>(command));
    if (result) {
      setWatcher(result);
      showNotice("Watcher 操作", result.message, result.status);
    }
  };

  const checkUpdate = async (silent = false) => {
    const result = await run(() => call<UpdateResult>("check_update"));
    if (result) {
      setUpdate(result);
      if (!silent || result.updateAvailable) {
        showNotice("GitHub Release 检查", result.message, result.status);
      }
    }
  };

  const performUpdate = async () => {
    const release =
      update?.latestVersion && update.assetName && update.assetUrl
        ? {
            version: update.latestVersion,
            url: "",
            body: update.releaseSummary ?? "",
            asset_name: update.assetName,
            asset_url: update.assetUrl,
          }
        : null;
    const result = await run(() => call<UpdateResult>("perform_update", { release }));
    if (result) {
      setUpdate(result);
      showNotice("更新安装", result.message, result.status);
    }
  };

  const saveSettings = async () => {
    const next = await settingsForSave(settingsForm, false);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("设置保存", result.message, result.status);
    }
  };

  const saveSettingsValue = async (next: BackendSettings, silent = true, preserveLinkedProfiles = false) => {
    const normalized = normalizeSettings(next);
    setSettingsForm(normalized);
    const settingsToSave = await settingsForSave(normalized, preserveLinkedProfiles);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: settingsToSave }));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      if (!silent || !isSuccessStatus(result.status)) showNotice("设置保存", result.message, result.status);
    }
  };

  const settingsForSave = async (next: BackendSettings, preserveLinkedProfiles: boolean) => {
    const normalized = normalizeSettings(next);
    if (!normalized.ccsLinkEnabled || preserveLinkedProfiles) return normalized;
    const refreshed = await refreshSettings(true);
    if (!refreshed) return normalized;
    return mergeLiveLinkedRelayProfiles(normalized, normalizeSettings(refreshed));
  };

  const importCcsProviders = async () => {
    const result = await run(() => call<SettingsResult>("import_ccs_providers"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showResultNotice("联动 cc-switch", result);
    }
  };

  const resetSettings = async () => {
    const result = await run(() => call<SettingsResult>("reset_settings"));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      showNotice("设置重置", result.message, result.status);
    }
  };


  const refreshProviderSyncTargets = async (silent = false) => {
    const result = await run(() => call<ProviderSyncTargetsResult>("load_provider_sync_targets"));
    if (result) {
      setProviderSyncTargets(result);
      const targets = result.targets ?? [];
      const saved = settingsForm.providerSyncLastSelectedProvider;
      const preferred =
        targets.find((target) => target.id === saved)?.id ||
        targets.find((target) => target.isCurrentProvider)?.id ||
        targets[0]?.id ||
        "openai";
      setSelectedProviderSyncTarget((current) => (targets.some((target) => target.id === current) ? current : preferred));
      if (!silent && !isSuccessStatus(result.status)) showNotice("Provider 同步目标", result.message, result.status);
    }
    return result;
  };

  const syncProvidersNow = async () => {
    if (providerSyncProgress.active) return;
    setProviderSyncProgress({
      active: true,
      percent: 12,
      message: selectedProviderSyncTarget ? `正在同步到 ${selectedProviderSyncTarget}…` : "正在扫描历史会话与索引…",
      result: null,
    });
    const progressTimer = window.setInterval(() => {
      setProviderSyncProgress((current) => {
        if (!current.active) return current;
        return {
          ...current,
          percent: Math.min(88, current.percent + 8),
          message: current.percent < 40 ? "正在检查会话 provider 标记…" : "正在写入修复与备份…",
        };
      });
    }, 350);
    try {
      const targetProvider = selectedProviderSyncTarget || undefined;
      const result = await run(() =>
        call<CommandResult<ProviderSyncPayload>>("sync_providers_now", { targetProvider }),
      );
      if (result) {
        setProviderSyncProgress({
          active: false,
          percent: 100,
          message: providerSyncProgressMessage(result),
          result,
        });
        if (targetProvider) {
          const next = {
            ...settingsForm,
            providerSyncLastSelectedProvider: targetProvider,
            providerSyncSavedProviders: Array.from(
              new Set([...(settingsForm.providerSyncSavedProviders ?? []), targetProvider]),
            ).sort(),
          };
          setSettingsForm(next);
        }
        await refreshProviderSyncTargets(true);
        showNotice("历史会话修复", result.message, result.status);
      } else {
        setProviderSyncProgress({
          active: false,
          percent: 100,
          message: "历史会话修复失败，请查看错误提示后重试。",
          result: null,
        });
      }
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const applyRelayInjection = async (silent = false) => {
    const settingsResult = await run(() => call<SettingsResult>("save_settings", { settings: settingsForm }));
    if (settingsResult) {
      setSettings(settingsResult);
      setSettingsForm(normalizeSettings(settingsResult.settings));
      if (!isSuccessStatus(settingsResult.status)) {
        showNotice("设置保存", settingsResult.message, settingsResult.status);
        return false;
      }
    } else {
      return false;
    }
    const result = await run(() => call<RelayResult>("apply_relay_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("官方混入 API Key", result.message, result.status);
    }
    return !!result && isSuccessStatus(result.status) && result.configured;
  };

  const saveLaunchMode = async (launchMode: LaunchMode, silent = false, baseSettings: BackendSettings = settingsForm) => {
    const next = { ...baseSettings, launchMode };
    setSettingsForm(next);
    const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
    if (result) {
      setSettings(result);
      setSettingsForm(normalizeSettings(result.settings));
      if (!silent) showNotice("页面增强模式", result.message, result.status);
    }
    return result;
  };

  const applyPureApiInjection = async (silent = false) => {
    const settingsResult = await run(() => call<SettingsResult>("save_settings", { settings: settingsForm }));
    if (settingsResult) {
      setSettings(settingsResult);
      setSettingsForm(normalizeSettings(settingsResult.settings));
      if (!isSuccessStatus(settingsResult.status)) {
        showNotice("设置保存", settingsResult.message, settingsResult.status);
        return false;
      }
    } else {
      return false;
    }
    const result = await run(() => call<RelayResult>("apply_pure_api_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("纯 API 模式", result.message, result.status);
    }
    return !!result && isSuccessStatus(result.status) && result.configured;
  };

  const clearRelayInjection = async (silent = false) => {
    const result = await run(() => call<RelayResult>("clear_relay_injection"));
    if (result) {
      setRelay(result);
      await refreshRelayFiles(true);
      if (!silent || !isSuccessStatus(result.status)) showNotice("官方登录模式", result.message, result.status);
    }
    return !!result && isSuccessStatus(result.status) && !result.configured;
  };

  const saveRelayFile = async (kind: "config" | "auth", contents: string, silent = false) => {
    const result = await run(() => call<RelayFilesResult>("save_relay_file", { request: { kind, contents } }));
    if (result) {
      setRelayFiles(result);
      if (!silent || !isSuccessStatus(result.status)) {
        showNotice(kind === "config" ? "config.toml" : "auth.json", result.message, result.status);
      }
      await refreshRelay(true);
    }
  };

  const upsertContextEntry = async (next: BackendSettings, kind: ContextKind, id: string, tomlBody: string) => {
    const result = await run(() =>
      call<ContextEntriesResult>("upsert_context_entry", {
        request: { settings: next, kind, id, tomlBody },
      }),
    );
    if (!result) return null;
    let normalized = normalizeSettings(result.settings);
    const saveResult = await run(() => call<SettingsResult>("save_settings", { settings: normalized }));
    if (saveResult) {
      setSettings(saveResult);
      normalized = normalizeSettings(saveResult.settings);
    }
    setSettingsForm(normalized);
    if (!isSuccessStatus(result.status)) showResultNotice("工具与插件", result);
    return normalized;
  };

  const deleteContextEntry = async (next: BackendSettings, kind: ContextKind, id: string) => {
    const result = await run(() =>
      call<ContextEntriesResult>("delete_context_entry", {
        request: { settings: next, kind, id },
      }),
    );
    if (!result) return null;
    let normalized = normalizeSettings(result.settings);
    const saveResult = await run(() => call<SettingsResult>("save_settings", { settings: normalized }));
    if (saveResult) {
      setSettings(saveResult);
      normalized = normalizeSettings(saveResult.settings);
    }
    setSettingsForm(normalized);
    if (!isSuccessStatus(result.status)) showResultNotice("工具与插件", result);
    return normalized;
  };

  const extractRelayCommonConfig = async (configContents: string) => {
    const result = await run(() =>
      call<ExtractRelayCommonConfigResult>("extract_relay_common_config", {
        request: { configContents },
      }),
    );
    if (result) showResultNotice("通用配置文件", result);
    return result && isSuccessStatus(result.status) ? result : null;
  };

  const testRelayProfile = async (profile: RelayProfile) => {
    const result = await run(() => call<RelayProfileTestResult>("test_relay_profile", { profile }));
    if (result) showNotice("供应商测试", result.message, result.status);
  };

  const fetchRelayProfileModels = async (profile: RelayProfile) => {
    const result = await run(() => call<RelayProfileModelsResult>("fetch_relay_profile_models", { profile }));
    if (result) showNotice("模型列表", result.message, result.status);
    return result && isSuccessStatus(result.status) ? result.models : null;
  };

  const switchOfficialMode = async () => {
    const switched = await clearRelayInjection(true);
    if (!switched) return;
    const result = await saveLaunchMode("relay", true);
    if (result) showNotice("官方登录模式", "已切回官方登录；页面增强已设为兼容增强。", result.status);
  };

  const switchPureApiMode = async () => {
    const switched = await applyPureApiInjection(true);
    if (!switched) return;
    const result = await saveLaunchMode("patch", true);
    if (result) showNotice("纯 API 模式", "已切换到纯 API；页面增强已设为完整增强。", result.status);
  };

  const switchRelayProfile = async (next: BackendSettings, previousActiveRelayId = settingsForm.activeRelayId) => {
    let switchSettings = normalizeSettings(next);
    if (switchSettings.ccsLinkEnabled) {
      const targetRelayId = switchSettings.activeRelayId;
      const refreshed = await refreshSettings(true);
      if (!refreshed) return;
      const latest = normalizeSettings(refreshed);
      if (!latest.relayProfiles.some((profile) => profile.id === targetRelayId)) {
        showNotice("供应商切换", "目标供应商已不在 cc-switch 或本地配置中，请刷新供应商列表后重试。", "failed");
        return;
      }
      switchSettings = syncLegacyRelayFields({ ...latest, activeRelayId: targetRelayId });
    }
    if (!switchSettings.relayProfilesEnabled) {
      showNotice("供应商配置已关闭", "当前不会写入 Codex config.toml / auth.json。打开供应商配置总开关后再切换。", "failed");
      return;
    }
    const targetBeforeSnapshot = activeRelayProfile(switchSettings);
    logDiagnostic("switchRelayProfile.start", {
      currentRelayId: settingsForm.activeRelayId,
      targetRelayId: switchSettings.activeRelayId,
      targetRelayName: targetBeforeSnapshot.name,
      targetRelayMode: targetBeforeSnapshot.relayMode,
      ccsLinkEnabled: switchSettings.ccsLinkEnabled,
    });
    const nextWithSnapshot = await snapshotActiveRelayFilesBeforeSwitch(switchSettings, previousActiveRelayId);
    if (!nextWithSnapshot) {
      logDiagnostic("switchRelayProfile.snapshot_failed", {
        currentRelayId: settingsForm.activeRelayId,
        targetRelayId: switchSettings.activeRelayId,
      });
      return;
    }

    const selectedBeforeSave = activeRelayProfile(nextWithSnapshot);
    const validationError = relayProfileSwitchValidation(selectedBeforeSave);
    if (validationError) {
      logDiagnostic("switchRelayProfile.validation_failed", {
        targetRelayId: selectedBeforeSave.id,
        targetRelayName: selectedBeforeSave.name,
        error: validationError,
      });
      showNotice("供应商配置可能不正确", validationError, "failed");
      return;
    }

    let selectedSettings = nextWithSnapshot;
    logDiagnostic("switchRelayProfile.save_settings_start", {
      targetRelayId: selectedBeforeSave.id,
      targetRelayName: selectedBeforeSave.name,
    });
    const settingsResult = await run(() => call<SettingsResult>("save_settings", { settings: nextWithSnapshot }));
    if (settingsResult) {
      selectedSettings = normalizeSettings(settingsResult.settings);
      setSettings(settingsResult);
      setSettingsForm(selectedSettings);
      if (!isSuccessStatus(settingsResult.status)) {
        logDiagnostic("switchRelayProfile.save_settings_failed", {
          targetRelayId: selectedBeforeSave.id,
          status: settingsResult.status,
          message: settingsResult.message,
        });
        showNotice("供应商切换", settingsResult.message, settingsResult.status);
        return;
      }
    } else {
      logDiagnostic("switchRelayProfile.save_settings_no_result", {
        targetRelayId: selectedBeforeSave.id,
      });
      return;
    }

    const selectedAfterSave = activeRelayProfile(selectedSettings);
    const command = relayProfileSwitchCommand(selectedAfterSave);
    logDiagnostic("switchRelayProfile.apply_start", {
      targetRelayId: selectedAfterSave.id,
      targetRelayName: selectedAfterSave.name,
      command,
    });
    const result = await run(() => call<RelayResult>(command));
    if (!result) {
      logDiagnostic("switchRelayProfile.apply_no_result", {
        targetRelayId: selectedAfterSave.id,
        command,
      });
      return;
    }

    setRelay(result);
    await refreshRelayFiles(true);
    if (!isSuccessStatus(result.status) || (selectedAfterSave.relayMode === "pureApi" && !result.configured)) {
      logDiagnostic("switchRelayProfile.apply_failed", {
        targetRelayId: selectedAfterSave.id,
        command,
        status: result.status,
        message: result.message,
        configured: result.configured,
      });
      showNotice("供应商切换", relayProfileReadinessText(selectedAfterSave, result), result.status);
      return;
    }

    const currentSelected = activeRelayProfile(selectedSettings);
    const launchMode = currentSelected.relayMode === "pureApi" ? "patch" : "relay";
    logDiagnostic("switchRelayProfile.launch_mode_start", {
      targetRelayId: currentSelected.id,
      launchMode,
    });
    const modeResult = await saveLaunchMode(launchMode, true, selectedSettings);
    if (modeResult) {
      logDiagnostic("switchRelayProfile.ok", {
        targetRelayId: currentSelected.id,
        launchMode,
        status: modeResult.status,
      });
      showNotice("供应商切换", relayProfileModeSwitchedText(currentSelected), modeResult.status);
    } else {
      logDiagnostic("switchRelayProfile.launch_mode_no_result", {
        targetRelayId: currentSelected.id,
        launchMode,
      });
    }
  };

  const snapshotActiveRelayFilesBeforeSwitch = async (next: BackendSettings, previousActiveRelayId: string): Promise<BackendSettings | null> => {
    const current = settingsForm.relayProfiles.find((profile) => profile.id === previousActiveRelayId) || activeRelayProfile(settingsForm);
    const selected = activeRelayProfile(next);
    if (current.id === selected.id) return next;

    logDiagnostic("snapshotActiveRelayFilesBeforeSwitch.start", {
      currentRelayId: current.id,
      currentRelayName: current.name,
      selectedRelayId: selected.id,
      selectedRelayName: selected.name,
    });
    const result = await run(() =>
      call<SettingsBackfillResult>("backfill_relay_profile_from_live", {
        request: { settings: next, profileId: current.id },
      }),
    );
    if (!result || !isSuccessStatus(result.status)) {
      logDiagnostic("snapshotActiveRelayFilesBeforeSwitch.failed", {
        currentRelayId: current.id,
        selectedRelayId: selected.id,
        status: result?.status,
        message: result?.message,
      });
      showNotice("供应商切换", result?.message ?? "读取当前配置文件失败，已停止切换以避免覆盖用户改动。", result?.status ?? "failed");
      return null;
    }

    logDiagnostic("snapshotActiveRelayFilesBeforeSwitch.ok", {
      currentRelayId: current.id,
      selectedRelayId: selected.id,
    });
    return syncLegacyRelayFields(normalizeSettings(result.settings));
  };


  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      showNotice("复制失败", stringifyError(error), "failed");
    }
  };

  const openExternalUrl = async (url: string) => {
    const result = await run(() => call<CommandResult<Record<string, unknown>>>("open_external_url", { url }));
    if (result) {
      showResultNotice("打开链接", result, { silentSuccess: true });
    }
  };

  const showNotice = (title: string, message: string, status?: Status) => {
    setNotice({ title, message, status });
  };

  const showResultNotice = (
    title: string,
    result: Pick<CommandResult<unknown>, "message" | "status">,
    options: { silentSuccess?: boolean } = {},
  ) => {
    if (options.silentSuccess && isSuccessStatus(result.status)) return;
    showNotice(title, result.message, result.status);
  };

  useEffect(() => {
    void (async () => {
      const startup = await run(() => call<StartupResult>("startup_options"));
      if (startup?.showUpdate) {
        setRoute("about");
        void checkUpdate(false);
      } else {
        void checkUpdate(true);
      }
      await refreshOverview(true);
      await refreshSettings(true);
      await refreshRelay(true);
      await refreshProviderSyncTargets(true);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    window.localStorage.setItem("ucodex-theme", theme);
  }, [theme]);

  const saveCodexAppPath = async (appPath: string) => {
    const next = { ...settingsForm, codexAppPath: appPath };
    const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
    if (result) {
      setSettings(result);
      const normalized = normalizeSettings(result.settings);
      setSettingsForm(normalized);
      setLaunchForm((current) => ({ ...current, appPath: normalized.codexAppPath }));
      await refreshOverview(true);
    }
    return result;
  };

  const actions = useMemo(
    () => ({
      refreshCurrent: () => navigate(route),
      launch,
      restart,
      launchCodexAppOnly,
      repairBackend,
      installEntrypoints,
      uninstallEntrypoints,
      repairShortcuts,
      checkUpdate,
      performUpdate,
      saveSettings,
      saveSettingsValue,
      refreshSettings,
      resetSettings,
      chooseCodexAppPath: async (mode: "folder" | "file") => {
        let selected: unknown;
        try {
          selected = await open(
            mode === "folder"
              ? { directory: true, multiple: false, title: "选择 Codex 应用目录" }
              : {
                  directory: false,
                  multiple: false,
                  title: "选择 Codex.exe 或 Codex.app",
                  filters: [{ name: "Codex 应用", extensions: ["exe", "app"] }],
                },
          );
        } catch (error) {
          // Surface plugin failures (e.g. missing capability permission) so the
          // buttons no longer appear unresponsive — see #345.
          const message = error instanceof Error ? error.message : String(error);
          showNotice("Codex 应用路径", `打开选择器失败：${message}`, "failed");
          return;
        }
        if (typeof selected === "string" && selected.trim()) {
          const result = await saveCodexAppPath(selected.trim());
          if (result) {
            showNotice("Codex 应用路径", "应用路径已保存，之后启动会自动复用。", result.status);
          }
        }
      },
      clearCodexAppPath: async () => {
        const next = { ...settingsForm, codexAppPath: "" };
        const result = await run(() => call<SettingsResult>("save_settings", { settings: next }));
        if (result) {
          setSettings(result);
          setSettingsForm(normalizeSettings(result.settings));
          setLaunchForm((current) => ({ ...current, appPath: "" }));
          showNotice("Codex 应用路径", "已清除保存路径，后续启动会回到自动探测。", result.status);
          await refreshOverview(true);
        }
      },
      saveManualCodexAppPath: async () => {
        const appPath = launchForm.appPath.trim();
        if (!appPath) {
          showNotice("Codex 应用路径", "请先填写或选择应用路径。", "failed");
          return;
        }
        const result = await saveCodexAppPath(appPath);
        if (result) {
          showNotice("Codex 应用路径", "应用路径已保存，之后启动会自动复用。", result.status);
        }
      },
      syncProvidersNow,
      refreshProviderSyncTargets,
      setProviderSyncTarget: (provider: string) => {
        setSelectedProviderSyncTarget(provider);
        setSettingsForm((current) => ({ ...current, providerSyncLastSelectedProvider: provider }));
      },
      setLaunchMode: async (launchMode: LaunchMode) => {
        await saveLaunchMode(launchMode);
      },
      refreshRelay,
      refreshRelayFiles,
      refreshLiveContextEntries,
      syncLiveContextEntries,
      importCcsProviders,
      refreshScriptMarket,
      installMarketScript,
      setUserScriptEnabled,
      deleteUserScript,
      refreshLocalSessions,
      deleteLocalSession,
      openExternalUrl,
      applyRelayInjection,
      applyPureApiInjection,
      clearRelayInjection,
      saveRelayFile,
      upsertContextEntry,
      deleteContextEntry,
      extractRelayCommonConfig,
      testRelayProfile,
      fetchRelayProfileModels,
      switchRelayProfile,
      switchOfficialMode,
      switchPureApiMode,
      refreshLogs,
      refreshDiagnostics,
      refreshProxyStats,
      refreshCodexConfig,
      showMessage: async (title: string, message: string, status?: Status) => showNotice(title, message, status),
      copyLogs: () => copyText(logs?.text ?? "", "日志已复制。"),
      copyDiagnostics: () => copyText(diagnostics?.report ?? "", "诊断报告已复制。"),
      goLogs: () => navigate("about"),
      checkHealth: async () => {
        await refreshOverview(true);
        await refreshRelay(true);
        await refreshWatcher(true);
        showNotice("检查完成", "已刷新 Codex 应用、入口和 Watcher 状态。", "ok");
      },
      installWatcher: () => watcherAction("install_watcher"),
      uninstallWatcher: () => watcherAction("uninstall_watcher"),
      enableWatcher: () => watcherAction("enable_watcher"),
      disableWatcher: () => watcherAction("disable_watcher"),
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [route, launchForm, settingsForm, settings, removeOwnedData, update, logs, diagnostics, theme, relayFiles, localSessions, selectedProviderSyncTarget, launch],
  );
  const hasUpdate = update?.updateAvailable === true;

  // ─── 悬浮模式渲染 ─────────────────────────────
  if (floatingMode) {
    return (
      <div className={theme}>
        <FloatingMode
          onExitFloating={() => setFloatingMode(false)}
          modelName={settings?.settings?.relayProfiles?.[0]?.name || "Ucodex"}
          version={overview?.current_version}
          buildId={overview?.current_version}
          helperPort={overview?.latest_launch?.helper_port?.toString() || "57321"}
          latestLaunchStatus={overview?.latest_launch?.status}
          tokenUsage={proxyStats ? {
            promptTokens: Number((proxyStats as Record<string, unknown>).total_prompt_tokens ?? 0),
            completionTokens: Number((proxyStats as Record<string, unknown>).total_completion_tokens ?? 0),
            totalTokens: Number((proxyStats as Record<string, unknown>).total_tokens ?? 0),
            cachedTokens: Number((proxyStats as Record<string, unknown>).total_cached_tokens ?? 0),
            reasoningTokens: Number((proxyStats as Record<string, unknown>).total_reasoning_tokens ?? 0),
          } : undefined}
        />
      </div>
    );
  }

  return (
    <div className={`shell ${theme}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" title="Ucodex">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f472b6"/>
                  <stop offset="50%" stopColor="#a78bfa"/>
                  <stop offset="100%" stopColor="#60a5fa"/>
                </linearGradient>
              </defs>
              <path d="M6 8 L16 24 L26 8" stroke="url(#brandGrad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <circle cx="22" cy="12" r="3.5" fill="url(#brandGrad)"/>
            </svg>
          </div>
          <div className="brand-copy">
            <div className="brand-title-row">
              <div className="brand-title">Ucodex</div>
              {hasUpdate ? (
                <button
                  className="update-dot"
                  onClick={() => {
                    setRoute("about");
                    void checkUpdate(false);
                  }}
                  title={`发现新版本 ${update?.latestVersion ?? ""}`}
                  type="button"
                >
                  <CircleArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="brand-subtitle">管理控制台</div>
          </div>
        </div>
        <nav className="nav">
          {routes.map((item) => {
            const Icon = item.icon;
            return (
            <button
              className={`nav-item ${route === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => void navigate(item.id)}
              title={item.label}
              type="button"
            >
              <span className="nav-icon">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          );
          })}
        </nav>
        <div className="sidebar-footer">
          <button
            className="nav-item floating-toggle"
            onClick={() => setFloatingMode(true)}
            title="切换到悬浮窗口模式"
            type="button"
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="4" width="12" height="8" rx="3" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
              </svg>
            </span>
            <span className="nav-label">灵动岛</span>
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar" key={`topbar-${route}`}>
          <div>
            <h1>{routeTitle(route)}</h1>
            <p>{routeSubtitle(route)}</p>
          </div>
          <div className="topbar-actions">
            <Button
              onClick={actions.toggleTheme}
              size="icon"
              title={theme === "dark" ? "切换到浅色" : "切换到深色"}
              variant="outline"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button onClick={() => void actions.restart()} title="重启 Ucodex" variant="outline">
              <Rocket className="h-4 w-4" />
              重启 Ucodex
            </Button>
            <Button onClick={() => void actions.refreshCurrent()} size="icon" title="刷新当前页面" variant="outline">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <section className="screen" key={route}>
          {route === "overview" ? (
            <OverviewScreen
              overview={overview}
              actions={actions}
            />
          ) : null}
          {route === "relay" ? (
            <RelayScreen
              settings={settings}
              relayFiles={relayFiles}
              form={settingsForm}
              onFormChange={setSettingsForm}
              actions={actions}
            />
          ) : null}
          {route === "sessions" ? (
            <SessionsScreen
              settings={settings}
              form={settingsForm}
              sessions={localSessions}
              providerSyncProgress={providerSyncProgress}
              providerSyncTargets={providerSyncTargets}
              selectedProviderSyncTarget={selectedProviderSyncTarget}
              onFormChange={setSettingsForm}
              actions={actions}
            />
          ) : null}
          {route === "context" ? (
            <ContextScreen
              form={settingsForm}
              liveEntries={liveContextEntries}
              relayFiles={relayFiles}
              onFormChange={setSettingsForm}
              actions={actions}
            />
          ) : null}
          {route === "enhance" ? (
            <EnhanceScreen form={settingsForm} onFormChange={setSettingsForm} actions={actions} />
          ) : null}
          {route === "userScripts" ? <UserScriptsScreen settings={settings} market={scriptMarket} actions={actions} /> : null}
          {route === "proxyStats" ? <ProxyStatsScreen stats={proxyStats} actions={actions} /> : null}
          {route === "processes" ? <ProcessesScreen actions={actions} /> : null}
          {route === "configEditor" ? <ConfigEditorScreen config={codexConfig} actions={actions} /> : null}
          {route === "maintenance" ? (
            <MaintenanceScreen
              overview={overview}
              watcher={watcher}
              settings={settings}
              launchForm={launchForm}
              onLaunchFormChange={setLaunchForm}
              removeOwnedData={removeOwnedData}
              onRemoveOwnedDataChange={setRemoveOwnedData}
              actions={actions}
            />
          ) : null}
          {route === "about" ? <AboutScreen overview={overview} update={update} logs={logs} diagnostics={diagnostics} actions={actions} /> : null}
          {route === "settings" ? (
            <SettingsScreen settings={settings} theme={theme} form={settingsForm} onFormChange={setSettingsForm} actions={actions} />
          ) : null}
        </section>
      </main>
      {notice ? (
        <NoticeDialog
          key={`${notice.title}-${notice.message}-${notice.status ?? ""}`}
          notice={notice}
          onClose={() => setNotice(null)}
        />
      ) : null}
    </div>
  );
}

type Actions = {
  refreshCurrent: () => Promise<void>;
  launch: () => Promise<void>;
  restart: () => Promise<void>;
  launchCodexAppOnly: () => Promise<void>;
  repairBackend: () => Promise<void>;
  installEntrypoints: () => Promise<void>;
  uninstallEntrypoints: () => Promise<void>;
  repairShortcuts: () => Promise<void>;
  checkUpdate: () => Promise<void>;
  performUpdate: () => Promise<void>;
  saveSettings: () => Promise<void>;
  saveSettingsValue: (settings: BackendSettings, silent?: boolean, preserveLinkedProfiles?: boolean) => Promise<void>;
  refreshSettings: (silent?: boolean) => Promise<BackendSettings | null>;
  resetSettings: () => Promise<void>;
  chooseCodexAppPath: (mode: "folder" | "file") => Promise<void>;
  clearCodexAppPath: () => Promise<void>;
  saveManualCodexAppPath: () => Promise<void>;
  syncProvidersNow: () => Promise<void>;
  refreshProviderSyncTargets: (silent?: boolean) => Promise<ProviderSyncTargetsResult | null>;
  setProviderSyncTarget: (provider: string) => void;
  setLaunchMode: (launchMode: LaunchMode) => Promise<void>;
  refreshRelay: () => Promise<void>;
  refreshRelayFiles: () => Promise<RelayFilesResult | null>;
  refreshLiveContextEntries: () => Promise<LiveContextEntriesResult | null>;
  syncLiveContextEntries: (settings: BackendSettings, silent?: boolean) => Promise<LiveContextEntriesResult | null>;
  importCcsProviders: () => Promise<void>;
  refreshScriptMarket: () => Promise<void>;
  installMarketScript: (id: string) => Promise<void>;
  setUserScriptEnabled: (key: string, enabled: boolean) => Promise<void>;
  deleteUserScript: (key: string) => Promise<void>;
  refreshLocalSessions: () => Promise<LocalSessionsResult | null>;
  deleteLocalSession: (session: LocalSession) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  applyRelayInjection: () => Promise<boolean>;
  applyPureApiInjection: () => Promise<boolean>;
  clearRelayInjection: () => Promise<boolean>;
  saveRelayFile: (kind: "config" | "auth", contents: string, silent?: boolean) => Promise<void>;
  upsertContextEntry: (
    settings: BackendSettings,
    kind: ContextKind,
    id: string,
    tomlBody: string,
  ) => Promise<BackendSettings | null>;
  deleteContextEntry: (settings: BackendSettings, kind: ContextKind, id: string) => Promise<BackendSettings | null>;
  extractRelayCommonConfig: (configContents: string) => Promise<ExtractRelayCommonConfigResult | null>;
  testRelayProfile: (profile: RelayProfile) => Promise<void>;
  fetchRelayProfileModels: (profile: RelayProfile) => Promise<string[] | null>;
  switchRelayProfile: (settings: BackendSettings, previousActiveRelayId?: string) => Promise<void>;
  switchOfficialMode: () => Promise<void>;
  switchPureApiMode: () => Promise<void>;
  refreshLogs: () => Promise<void>;
  refreshDiagnostics: () => Promise<void>;
  refreshProxyStats: (silent?: boolean) => Promise<void>;
  refreshCodexConfig: (silent?: boolean) => Promise<void>;
  showMessage: (title: string, message: string, status?: Status) => Promise<void>;
  copyLogs: () => Promise<void>;
  copyDiagnostics: () => Promise<void>;
  goLogs: () => Promise<void>;
  installWatcher: () => Promise<void>;
  uninstallWatcher: () => Promise<void>;
  enableWatcher: () => Promise<void>;
  disableWatcher: () => Promise<void>;
  toggleTheme: () => void;
  checkHealth: () => Promise<void>;
};

function OverviewScreen({
  overview,
  actions,
}: {
  overview: OverviewResult | null;
  actions: Actions;
}) {
  const health = healthItems(overview);
  return (
    <>
      <Panel>
        <CardHead title="健康检查" detail="概览只展示关键问题，具体配置在对应页面处理" />
        <CardContent>
          <div className="health-grid">
            <div className={`health-item ${overview?.codex_version ? "ok" : "needs-fix"}`}>
              {overview?.codex_version ? <CheckCircle2 className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              <div>
                <strong>Codex 版本</strong>
                <span>{overview?.codex_version ?? "未检测到 Codex 应用版本。"}</span>
              </div>
              <Badge status={overview?.codex_version ? "ok" : "not_checked"} />
            </div>
            {health.map((item) => (
              <div className={`health-item ${item.ok ? "ok" : "needs-fix"}`} key={item.title}>
                {item.ok ? <CheckCircle2 className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <Badge status={item.status} />
              </div>
            ))}
          </div>
          <Toolbar>
            <Button onClick={() => void actions.checkHealth()}>
              <RefreshCw className="h-4 w-4" />
              检查
            </Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>
              <Wrench className="h-4 w-4" />
              修复入口
            </Button>
            <Button variant="secondary" onClick={() => void actions.repairBackend()}>
              修复后端
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="最近启动" detail={overview?.logs_path ?? "暂无状态文件"} />
        <CardContent>
          <LatestLaunch status={overview?.latest_launch ?? null} />
          <Toolbar>
            <Button onClick={() => void actions.launch()}>
              <Rocket className="h-4 w-4" />
              启动 Ucodex
            </Button>
            <Button variant="secondary" onClick={() => void actions.launchCodexAppOnly()}>
              启动 Codex（无注入）
            </Button>
            <Button variant="secondary" onClick={() => void actions.goLogs()}>
              打开关于
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function RelayScreen({
  settings: _settings,
  relayFiles,
  form,
  onFormChange,
  actions,
}: {
  settings: SettingsResult | null;
  relayFiles: RelayFilesResult | null;
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const normalized = normalizeSettings(form);
  const [detailProfileId, setDetailProfileId] = useState<string | null>(null);
  const [newProfileDraft, setNewProfileDraft] = useState<RelayProfile | null>(null);
  const detailProfile = newProfileDraft || (detailProfileId
    ? normalized.relayProfiles.find((profile) => profile.id === detailProfileId) || null
    : null);
  const isNewProfile = !!newProfileDraft;
  const saveRelaySettings = async (next: BackendSettings, preserveLinkedProfiles = false) => {
    onFormChange(next);
    await actions.saveSettingsValue(next, true, preserveLinkedProfiles);
  };
  const editRelayProfile = async (profileId: string) => {
    let nextSettings = normalized;
    const profile = normalized.relayProfiles.find((item) => item.id === profileId);
    if (profile?.linkedCcsProviderId && normalized.ccsLinkEnabled) {
      const refreshed = await actions.refreshSettings(true);
      if (refreshed) nextSettings = normalizeSettings(refreshed);
    }
    setNewProfileDraft(null);
    setDetailProfileId(
      nextSettings.relayProfiles.some((item) => item.id === profileId) ? profileId : null,
    );
  };
  useEffect(() => {
    if (!newProfileDraft && detailProfileId && !normalized.relayProfiles.some((profile) => profile.id === detailProfileId)) {
      setDetailProfileId(null);
    }
  }, [detailProfileId, newProfileDraft, normalized.relayProfiles]);
  useEffect(() => {
    if (!newProfileDraft && detailProfileId === normalized.activeRelayId) {
      void actions.refreshRelayFiles();
    }
  }, [detailProfileId, newProfileDraft, normalized.activeRelayId]);

  if (detailProfile) {
    return (
      <RelayProfileDetail
        profile={detailProfile}
        relayFiles={!isNewProfile && detailProfile.id === normalized.activeRelayId ? relayFiles : null}
        form={normalized}
        isNew={isNewProfile}
        onBack={() => {
          setNewProfileDraft(null);
          setDetailProfileId(null);
        }}
        onFormChange={saveRelaySettings}
        onSaved={() => {
          setNewProfileDraft(null);
          setDetailProfileId(null);
        }}
        actions={actions}
      />
    );
  }

  return (
    <>
      <Panel>
        <CardHead title="供应商列表" detail={`${normalized.relayProfiles.length} 个供应商配置；可拖动排序，点编辑进入详情`} />
        <CardContent>
          <label className="switch-row relay-master-switch">
            <input
              checked={normalized.relayProfilesEnabled}
              onChange={(event) => {
                const next = { ...normalized, relayProfilesEnabled: event.currentTarget.checked };
                void saveRelaySettings(next);
              }}
              type="checkbox"
            />
            <span>
              <strong>启用供应商配置切换</strong>
              <small>关闭后本工具不会在手动切换时写入 Codex 的 config.toml / auth.json；启动 Codex 时始终不会自动改这些文件。</small>
            </span>
          </label>
          <label className="switch-row relay-link-switch">
            <input
              checked={normalized.ccsLinkEnabled}
              onChange={(event) => {
                if (event.currentTarget.checked) {
                  void actions.importCcsProviders();
                  return;
                }
                const next = { ...normalized, ccsLinkEnabled: false };
                void saveRelaySettings(next);
              }}
              type="checkbox"
            />
            <span>
              <strong>联动 cc-switch</strong>
              <small>开启后读取 cc-switch Codex 供应商并保存时回写；同时使用多个管理工具可能导致 config.toml / auth.json 被反复覆盖。</small>
            </span>
          </label>
          <div className="relay-add-row">
            <Button
              variant="secondary"
              onClick={() => {
                setNewProfileDraft(createRelayProfile(normalized));
                setDetailProfileId(null);
              }}
            >
              <Plus className="h-4 w-4" />
              添加供应商
            </Button>
          </div>
          <RelayProfileList
            form={normalized}
            onEdit={(profileId) => void editRelayProfile(profileId)}
            onFormChange={saveRelaySettings}
            disabled={!normalized.relayProfilesEnabled}
            actions={actions}
          />
        </CardContent>
      </Panel>
    </>
  );
}

function EnhanceScreen({
  form,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const setEnhanceFlag = (key: keyof BackendSettings, value: boolean) => onFormChange({ ...form, [key]: value });
  const masterEnabled = form.enhancementsEnabled;
  const patchMode = form.launchMode === "patch";
  return (
    <>
      <Panel>
        <CardHead title="页面功能增强" detail="会话删除、导出、项目移动、Timeline 和用户脚本等界面能力" />
        <CardContent>
          <label className="switch-row">
            <input
              checked={form.enhancementsEnabled}
              onChange={(event) => onFormChange({ ...form, enhancementsEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>启用 Ucodex 页面增强</strong>
              <small>关闭后会停用删除、导出、项目移动、Timeline、插件相关和菜单位置增强。</small>
            </span>
          </label>
          <ModeSelector launchMode={form.launchMode} actions={actions} />
          {form.launchMode === "relay" ? (
            <div className="hint-line">
              <ShieldCheck className="h-4 w-4" />
              <span>当前为兼容增强模式，插件市场解锁、强制解锁入口和特殊插件强制安装不会启用；其他页面功能仍可用。</span>
            </div>
          ) : null}
          <div className="feature-switch-grid">
            <FeatureToggle title="插件市场解锁" detail="API Key 模式下扩展插件市场请求，尽量显示完整插件列表；官方/混合模式通常不需要。" checked={form.codexAppPluginMarketplaceUnlock} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppPluginMarketplaceUnlock", value)} />
            <FeatureToggle title="强制解锁入口" detail="恢复 1.1.9 的入口解锁方式，强制显示并启用插件入口。" checked={form.codexAppPluginEntryUnlock} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppPluginEntryUnlock", value)} />
            <FeatureToggle title="特殊插件强制安装" detail="解除 App unavailable / 应用不可用导致的前端安装禁用。" checked={form.codexAppForcePluginInstall} disabled={!masterEnabled || !patchMode} onChange={(value) => setEnhanceFlag("codexAppForcePluginInstall", value)} />
            <FeatureToggle title="模型白名单解锁" detail="从环境变量和 config.toml 的 /v1/models 拉取模型并补进模型列表。" checked={form.codexAppModelWhitelistUnlock} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppModelWhitelistUnlock", value)} />
            <FeatureToggle title="Fast 按钮" detail="显示服务模式切换按钮；Fast 仅支持 gpt-5.4 / gpt-5.5，其他模型按 Standard 发送。" checked={form.codexAppServiceTierControls} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppServiceTierControls", value)} />
            <FeatureToggle title="会话删除" detail="在会话列表悬停显示删除按钮，并支持撤销。" checked={form.codexAppSessionDelete} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppSessionDelete", value)} />
            <FeatureToggle title="Markdown 导出" detail="在会话列表显示导出按钮，导出带时间戳的 Markdown。" checked={form.codexAppMarkdownExport} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppMarkdownExport", value)} />
            <FeatureToggle title="会话项目移动" detail="把会话移动到普通对话或其他本地项目。" checked={form.codexAppProjectMove} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppProjectMove", value)} />
            <FeatureToggle title="对话 Timeline" detail="在对话右侧显示用户提问时间线，支持摘要和跳转。" checked={form.codexAppConversationTimeline} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppConversationTimeline", value)} />
            <FeatureToggle title="对话居中宽度" detail="把主对话和输入框限制到固定最大宽度，适合大屏阅读。" checked={form.codexAppConversationView} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppConversationView", value)} />
            <FeatureToggle title="切换对话保留位置" detail="切换 thread 时恢复上一次浏览位置。" checked={form.codexAppThreadScrollRestore} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppThreadScrollRestore", value)} />
            <FeatureToggle title="Upstream worktree" detail="从最新 upstream 分支创建 Git worktree。" checked={form.codexAppUpstreamWorktreeCreate} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppUpstreamWorktreeCreate", value)} />
            <FeatureToggle title="原生菜单栏位置" detail="把 Ucodex 菜单插入 Codex 顶部原生菜单栏。" checked={form.codexAppNativeMenuPlacement} disabled={!masterEnabled} onChange={(value) => setEnhanceFlag("codexAppNativeMenuPlacement", value)} />
          </div>
          <div className="hint-line">
            <Info className="h-4 w-4" />
            <span>如果使用官方模式或官方混入 API 模式，通常不需要开启插件市场解锁、强制解锁入口和特殊插件强制安装。</span>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>保存增强设置</Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function UserScriptsScreen({ settings, market, actions }: { settings: SettingsResult | null; market: ScriptMarketResult | null; actions: Actions }) {
  const inventory = settings?.user_scripts;
  const scripts = inventory?.scripts ?? [];
  const marketScripts = market?.market.scripts ?? [];
  const installedCount = marketScripts.filter((script) => script.installed).length;
  return (
    <>
      <Panel>
        <CardHead title="脚本市场" detail={`${marketScripts.length} 个市场脚本，已安装 ${installedCount} 个，本地整体 ${inventory?.enabled === false ? "关闭" : "开启"}`} />
        <CardContent>
          <div className="metric-list">
            <Metric label="市场状态" value={market?.market.message ?? "尚未刷新"} />
            <Metric label="远程脚本" value={`${marketScripts.length} 个`} />
            <Metric label="已安装" value={`${installedCount} 个`} />
            <Metric label="本地整体" value={inventory?.enabled === false ? "关闭" : "开启"} />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.refreshScriptMarket()}>
              <RefreshCw className="h-4 w-4" />
              刷新市场
            </Button>
            <Button onClick={() => void actions.openExternalUrl(SCRIPT_MARKET_REPOSITORY_URL)} variant="secondary">
              <ExternalLink className="h-4 w-4" />
              投稿
            </Button>
            <Button onClick={() => void actions.refreshCurrent()} variant="secondary">
              <RefreshCw className="h-4 w-4" />
              刷新本地
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="市场脚本" detail={market?.market.updatedAt ? `清单更新时间：${market.market.updatedAt}` : "从 GitHub 静态清单加载"} />
        <CardContent>
          {marketScripts.length ? (
            <div className="script-market-grid">
              {marketScripts.map((script) => (
                <MarketScriptCard key={script.id} script={script} actions={actions} />
              ))}
            </div>
          ) : (
            <div className="empty">{market?.status === "failed" ? market.message : "点击刷新市场加载远程脚本。"}</div>
          )}
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="本地脚本" detail="内置、手动和市场安装脚本；可在这里启停或删除用户脚本" />
        <CardContent>
          <div className="table">
            {scripts.length ? scripts.map((script) => <ScriptRow key={script.key} script={script} actions={actions} />) : <div className="empty">未发现用户脚本。</div>}
          </div>
        </CardContent>
      </Panel>
    </>
  );
}

function SessionsScreen({
  settings,
  form,
  sessions,
  providerSyncProgress,
  providerSyncTargets,
  selectedProviderSyncTarget,
  onFormChange,
  actions,
}: {
  settings: SettingsResult | null;
  form: BackendSettings;
  sessions: LocalSessionsResult | null;
  providerSyncProgress: ProviderSyncProgress;
  providerSyncTargets: ProviderSyncTargetsResult | null;
  selectedProviderSyncTarget: string;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const items = sessions?.sessions ?? [];
  const activeCount = items.filter((item) => !item.archived).length;
  const archivedCount = items.length - activeCount;
  return (
    <>
      <Panel>
        <CardHead title="会话管理" detail="读取 Codex 本地 state_5.sqlite，会删除数据库记录和对应 rollout 文件" />
        <CardContent>
          <div className="metric-list">
            <Metric label="会话总数" value={`${items.length} 个`} />
            <Metric label="未归档" value={`${activeCount} 个`} />
            <Metric label="已归档" value={`${archivedCount} 个`} />
            <Metric label="数据库" value={sessions?.dbPath ?? "~/.codex/state_5.sqlite"} />
          </div>
          <div className="form-row">
            <Field label="同步目标">
              <select
                className="select-input"
                disabled={providerSyncProgress.active || !(providerSyncTargets?.targets ?? []).length}
                value={selectedProviderSyncTarget}
                onChange={(event) => actions.setProviderSyncTarget(event.currentTarget.value)}
              >
                {(providerSyncTargets?.targets ?? []).map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.id}（{providerSyncTargetLabel(target)}）
                  </option>
                ))}
                {!(providerSyncTargets?.targets ?? []).length ? <option value="">当前配置 provider</option> : null}
              </select>
            </Field>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.refreshLocalSessions()}>
              <RefreshCw className="h-4 w-4" />
              刷新会话
            </Button>
            <Button disabled={providerSyncProgress.active} onClick={() => void actions.syncProvidersNow()} variant="outline">
              <RefreshCw className="h-4 w-4" />
              {providerSyncProgress.active ? "正在修复…" : "立刻修复历史会话"}
            </Button>
          </Toolbar>
          <div className="provider-sync-progress" data-active={providerSyncProgress.active}>
            <div className="provider-sync-progress-head">
              <strong>{providerSyncProgress.active ? "正在修复历史会话" : "历史会话修复进度"}</strong>
              <span>{providerSyncProgress.percent}%</span>
            </div>
            <div
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={providerSyncProgress.percent}
              className="provider-sync-progress-bar"
              role="progressbar"
            >
              <div className="provider-sync-progress-fill" style={{ width: `${providerSyncProgress.percent}%` }} />
            </div>
            <small>{providerSyncProgress.message}</small>
          </div>
          <div className="hint-line">
            <Info className="h-4 w-4" />
            <span>删除会创建本地备份；如果 Codex App 正在使用该会话，建议先关闭对应会话窗口再操作。</span>
          </div>
          <label className="switch-row">
            <input
              checked={form.providerSyncEnabled}
              onChange={(event) => onFormChange({ ...form, providerSyncEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>
              <strong>启动前自动修复历史会话</strong>
              <small>开启后，通过 Ucodex 启动 Codex 前自动整理一次旧对话的归属标记。</small>
            </span>
          </label>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>保存自动修复设置</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="本地会话" detail={items.length ? "按更新时间倒序显示" : "点击刷新会话读取本地数据库"} />
        <CardContent>
          {items.length ? (
            <div className="session-list">
              {items.map((session) => (
                <div className="session-row" key={session.id}>
                  <div className="session-main">
                    <strong>{session.title || "未命名会话"}</strong>
                    <span>{session.id}</span>
                    <small>{session.cwd || "未记录项目路径"}</small>
                  </div>
                  <div className="session-meta">
                    <Badge status={session.archived ? "archived" : "ok"} />
                    <span>{session.modelProvider || "provider 未记录"}</span>
                    <span>{formatTime(session.updatedAtMs ?? 0)}</span>
                  </div>
                  <Button variant="outline" onClick={() => void actions.deleteLocalSession(session)}>
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">未读取到本地会话，或当前 state_5.sqlite 不存在。</div>
          )}
        </CardContent>
      </Panel>
    </>
  );
}


function MaintenanceScreen({
  overview,
  watcher,
  settings,
  launchForm,
  onLaunchFormChange,
  removeOwnedData,
  onRemoveOwnedDataChange,
  actions,
}: {
  overview: OverviewResult | null;
  watcher: WatcherResult | null;
  settings: SettingsResult | null;
  launchForm: { appPath: string; debugPort: string; helperPort: string };
  onLaunchFormChange: (next: { appPath: string; debugPort: string; helperPort: string }) => void;
  removeOwnedData: boolean;
  onRemoveOwnedDataChange: (value: boolean) => void;
  actions: Actions;
}) {
  const savedCodexAppPath = settings?.settings.codexAppPath ?? "";
  return (
    <>
      <Panel>
        <CardHead title="检查与修复" detail="检查入口、Codex 应用和 Watcher 状态" />
        <CardContent>
          <div className="status-table">
            <StatusRow title="Codex 应用" status={overview?.codex_app.status} path={overview?.codex_app.path} />
            <StatusRow title="静默启动入口" status={overview?.silent_shortcut.status} path={overview?.silent_shortcut.path} />
            <StatusRow title="管理控制台入口" status={overview?.management_shortcut.status} path={overview?.management_shortcut.path} />
            <StatusRow title="Watcher 自动接管" status={watcher?.enabled ? "ok" : "disabled"} path={watcher?.disabled_flag} />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.checkHealth()}>检查</Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>修复快捷方式</Button>
            <Button variant="secondary" onClick={() => void actions.repairBackend()}>修复后端</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="入口管理" detail="快捷方式写入系统实际桌面位置，不使用写死桌面路径" />
        <CardContent>
          <label className="check-row">
            <input checked={removeOwnedData} onChange={(event) => onRemoveOwnedDataChange(event.currentTarget.checked)} type="checkbox" />
            <span>卸载时移除 Ucodex 托管数据</span>
          </label>
          <Toolbar>
            <Button onClick={() => void actions.installEntrypoints()}>安装入口</Button>
            <Button variant="secondary" onClick={() => void actions.uninstallEntrypoints()}>卸载入口</Button>
            <Button variant="secondary" onClick={() => void actions.repairShortcuts()}>修复入口</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="自动接管" detail="Watcher 用于保持 Ucodex 接管状态" />
        <CardContent>
          <Toolbar>
            <Button variant="secondary" onClick={() => void actions.installWatcher()}>安装 watcher</Button>
            <Button variant="secondary" onClick={() => void actions.uninstallWatcher()}>移除 watcher</Button>
            <Button variant="secondary" onClick={() => void actions.enableWatcher()}>启用</Button>
            <Button variant="secondary" onClick={() => void actions.disableWatcher()}>禁用</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="Codex 应用路径" detail="免安装版或解包版只需要选择一次，之后静默启动会自动复用" />
        <CardContent>
          <div className="status-table">
            <StatusRow title="保存路径" status={savedCodexAppPath ? "ok" : "not_checked"} path={savedCodexAppPath || null} />
            <StatusRow title="当前识别" status={overview?.codex_app.status} path={overview?.codex_app.path} />
          </div>
          <Field label="保存的应用路径">
            <Input
              value={settings?.settings.codexAppPath ?? ""}
              placeholder="选择 Codex.exe、Codex.app、app 目录或解包目录"
              readOnly
            />
          </Field>
          <Toolbar>
            <Button onClick={() => void actions.chooseCodexAppPath("folder")}>选择应用目录</Button>
            <Button variant="secondary" onClick={() => void actions.chooseCodexAppPath("file")}>选择 Codex.exe</Button>
            <Button variant="secondary" onClick={() => void actions.clearCodexAppPath()}>清除保存路径</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="手动启动" detail="应用路径留空时使用已保存路径；没有保存路径时使用自动探测" />
        <CardContent>
          <Field label="应用路径覆盖">
            <Input
              value={launchForm.appPath}
              onChange={(event) => onLaunchFormChange({ ...launchForm, appPath: event.currentTarget.value })}
              placeholder={savedCodexAppPath || "例如 C:\\Program Files\\WindowsApps\\OpenAI.Codex...\\app"}
            />
          </Field>
          <div className="form-row">
            <Field label="Debug 端口">
              <Input
                value={launchForm.debugPort}
                onChange={(event) => onLaunchFormChange({ ...launchForm, debugPort: event.currentTarget.value })}
              />
            </Field>
            <Field label="Helper 端口">
              <Input
                value={launchForm.helperPort}
                onChange={(event) => onLaunchFormChange({ ...launchForm, helperPort: event.currentTarget.value })}
              />
            </Field>
          </div>
          <Toolbar>
            <Button onClick={() => void actions.launch()}>启动 Ucodex</Button>
            <Button variant="secondary" onClick={() => void actions.launchCodexAppOnly()}>启动 Codex（无注入）</Button>
            <Button variant="secondary" onClick={() => void actions.saveManualCodexAppPath()}>
              保存为默认路径
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function AboutScreen({
  overview,
  update,
  logs,
  diagnostics,
  actions,
}: {
  overview: OverviewResult | null;
  update: UpdateResult | null;
  logs: LogsResult | null;
  diagnostics: DiagnosticsResult | null;
  actions: Actions;
}) {
  return (
    <>
      <Panel>
        <CardHead title="关于 Ucodex" detail="本地 Codex 增强、管理工具和安装包维护" />
        <CardContent>
          <div className="metric-list">
            <Metric label="Ucodex 版本" value={overview?.current_version ?? update?.currentVersion ?? "-"} />
            <Metric label="Codex 版本" value={overview?.codex_version ?? "未检测到"} />
            <Metric label="项目地址" value="github.com/paimon1999/Codex" />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.openExternalUrl("https://github.com/paimon1999/Codex")} variant="secondary">
              <ExternalLink className="h-4 w-4" />
              打开项目主页
            </Button>
            <Button onClick={() => void actions.openExternalUrl("https://github.com/paimon1999/Codex/issues")} variant="secondary">
              <ExternalLink className="h-4 w-4" />
              反馈问题
            </Button>
            <Button onClick={() => void actions.openExternalUrl("https://discord.gg/y96kX7A76v")} variant="secondary">
              <MessageCircle className="h-4 w-4" />
              Discord
            </Button>
            <Button onClick={() => void actions.openExternalUrl("https://t.me/CodexPlusPlus")} variant="secondary">
              <MessageCircle className="h-4 w-4" />
              Telegram
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="GitHub Release 更新" detail={`当前版本 ${overview?.current_version ?? update?.currentVersion ?? "-"}`} />
        <CardContent>
          <div className="metric-list">
            <Metric label="状态" value={update?.status ?? "not_checked"} />
            <Metric label="最新版本" value={update?.latestVersion ?? "未检查"} />
            <Metric label="资源" value={update?.assetName ?? "-"} />
            <Metric label="进度" value={`${update?.progress ?? 0}%`} />
          </div>
          <Textarea className="log-view" readOnly value={update?.releaseSummary || update?.message || "尚未检查 GitHub Release；更新会下载并启动安装包。"} />
          <Toolbar>
            <Button onClick={() => void actions.checkUpdate()}>检查更新</Button>
            <Button variant="secondary" onClick={() => void actions.performUpdate()}>下载并运行安装包</Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <LogsPanel logs={logs} actions={actions} />
      <DiagnosticsPanel diagnostics={diagnostics} actions={actions} />
    </>
  );
}

function SettingsScreen({
  settings,
  theme,
  form,
  onFormChange,
  actions,
}: {
  settings: SettingsResult | null;
  theme: Theme;
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  return (
    <>
      <Panel>
        <CardHead title="基础设置" detail={settings?.settings_path ?? ""} />
        <CardContent>
          <div className="theme-row">
            <div>
              <strong>界面主题</strong>
              <span>当前为{theme === "dark" ? "深色" : "浅色"}模式。</span>
            </div>
            <Button variant="secondary" onClick={actions.toggleTheme}>切换主题</Button>
          </div>
          <Field label="供应商测试模型">
            <Input
              value={form.relayTestModel}
              onChange={(event) => onFormChange({ ...form, relayTestModel: event.currentTarget.value })}
              placeholder="例如 gpt-5.4-mini"
            />
          </Field>
          <label className="check-row">
            <input
              checked={form.cliWrapperEnabled}
              onChange={(event) => onFormChange({ ...form, cliWrapperEnabled: event.currentTarget.checked })}
              type="checkbox"
            />
            <span>启用 Codex 命令包装器</span>
          </label>
          <div className="form-row">
            <Field label="包装器 Base URL">
              <Input
                value={form.cliWrapperBaseUrl}
                onChange={(event) => onFormChange({ ...form, cliWrapperBaseUrl: event.currentTarget.value })}
              />
            </Field>
            <Field label="API Key 环境变量">
              <Input
                value={form.cliWrapperApiKeyEnv}
                onChange={(event) => onFormChange({ ...form, cliWrapperApiKeyEnv: event.currentTarget.value })}
              />
            </Field>
          </div>
          <Field label="API Key">
            <Input
              type="password"
              value={form.cliWrapperApiKey}
              onChange={(event) => onFormChange({ ...form, cliWrapperApiKey: event.currentTarget.value })}
            />
          </Field>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>保存设置</Button>
            <Button variant="secondary" onClick={() => void actions.resetSettings()}>
              重置设置
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
      <Panel>
        <CardHead title="Codex 启动参数" detail="启动 Codex App 时追加到默认 CDP 参数后。留空则保持默认启动行为。" />
        <CardContent>
          <Field label="额外参数">
            <Textarea
              className="launch-args-input"
              placeholder="--force_high_performance_gpu"
              spellCheck={false}
              value={codexExtraArgsToInput(form.codexExtraArgs)}
              onChange={(event) =>
                onFormChange({
                  ...form,
                  codexExtraArgs: inputToCodexExtraArgs(event.currentTarget.value),
                })
              }
            />
          </Field>
          <p className="field-hint">每行一个参数，例如 --force_high_performance_gpu。不需要填写 open 或 --args。</p>
          <Toolbar>
            <Button onClick={() => void actions.saveSettings()}>保存设置</Button>
          </Toolbar>
        </CardContent>
      </Panel>
    </>
  );
}

function LogsPanel({ logs, actions }: { logs: LogsResult | null; actions: Actions }) {
  const lines = splitLogLines(logs?.text ?? "");
  return (
    <Panel>
      <CardHead title="最近日志" detail={logs?.path ?? ""} />
      <CardContent>
        <div className="log-lines">
          {lines.length ? (
            lines.map((line, index) => (
              <div className="log-line" key={`${index}-${line.slice(0, 12)}`}>
                <span>{index + 1}</span>
                <code>{line || " "}</code>
              </div>
            ))
          ) : (
            <div className="empty">暂无日志。</div>
          )}
        </div>
        <Toolbar>
          <Button onClick={() => void actions.refreshLogs()}>刷新</Button>
          <Button variant="secondary" onClick={() => void actions.copyLogs()}>
            复制
          </Button>
        </Toolbar>
      </CardContent>
    </Panel>
  );
}

function DiagnosticsPanel({ diagnostics, actions }: { diagnostics: DiagnosticsResult | null; actions: Actions }) {
  return (
    <Panel>
      <CardHead title="诊断报告" detail="包含版本、路径、设置和平台信息" />
      <CardContent>
        <Textarea className="log-view tall" readOnly value={diagnostics?.report ?? "尚未生成诊断报告。"} />
        <Toolbar>
          <Button onClick={() => void actions.refreshDiagnostics()}>重新生成</Button>
          <Button variant="secondary" onClick={() => void actions.copyDiagnostics()}>
            复制报告
          </Button>
        </Toolbar>
      </CardContent>
    </Panel>
  );
}

function RelayProfileList({
  form,
  onFormChange,
  onEdit,
  disabled = false,
  actions,
}: {
  form: BackendSettings;
  onFormChange: (value: BackendSettings) => void;
  onEdit: (id: string) => void;
  disabled?: boolean;
  actions: Actions;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = reorderRelayProfiles(form, String(active.id), String(over.id));
    if (next !== form) onFormChange(next);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={form.relayProfiles.map((profile) => profile.id)} strategy={verticalListSortingStrategy}>
        <div className="relay-profile-list">
          {form.relayProfiles.map((profile, index) => (
            <SortableRelayProfileCard
              actions={actions}
              form={form}
              index={index}
              key={profile.id}
              onEdit={onEdit}
              onFormChange={onFormChange}
              disabled={disabled}
              profile={profile}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRelayProfileCard({
  form,
  profile,
  index,
  onFormChange,
  onEdit,
  disabled = false,
  actions,
}: {
  form: BackendSettings;
  profile: RelayProfile;
  index: number;
  onFormChange: (value: BackendSettings) => void;
  onEdit: (id: string) => void;
  disabled?: boolean;
  actions: Actions;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: profile.id });
  const active = profile.id === form.activeRelayId;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      className={`relay-profile-card ${active ? "active" : ""} ${isDragging ? "dragging" : ""}`}
      data-relay-profile-id={profile.id}
      key={profile.id}
      onKeyDown={(event) => {
        if (event.key === "Enter") onEdit(profile.id);
      }}
      ref={setNodeRef}
      style={style}
      tabIndex={0}
    >
      <button
        aria-label="拖动排序"
        className="relay-drag"
        title="拖动排序"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="relay-index" title={profile.name || "未命名供应商"}>
        {providerInitial(profile.name)}
      </span>
      <span className="relay-summary">
        <strong>{profile.name || "未命名供应商"}</strong>
        <small>{relayProfileSourceLabel(profile)} · {relayModeLabel(profile.relayMode)} · {relayProtocolLabel(profile.protocol)} · {relayProfileConfigBrief(profile)}</small>
      </span>
      <span className="relay-card-actions">
        <Button
          className={`relay-use-button ${active ? "active" : ""}`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            const previousActiveRelayId = form.activeRelayId;
            const next = syncLegacyRelayFields({ ...form, activeRelayId: profile.id });
            void actions.switchRelayProfile(next, previousActiveRelayId);
          }}
          size="sm"
          title={disabled ? "供应商配置总开关已关闭" : active ? "当前正在使用" : "设为当前"}
          variant={active ? "secondary" : "outline"}
        >
          <CheckCircle2 className="h-4 w-4" />
          {active ? "使用中" : "使用"}
        </Button>
        <span className="relay-card-extra">
          <Button
            onClick={(event) => {
              event.stopPropagation();
              void actions.testRelayProfile(profile);
            }}
            size="icon"
            title="发送 hi 测试"
            variant="ghost"
          >
            <TestTube className="h-4 w-4" />
          </Button>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onEdit(profile.id);
            }}
            size="icon"
            title="编辑"
            variant="ghost"
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            onClick={(event) => {
              event.stopPropagation();
              onFormChange(duplicateRelayProfile(form, profile.id));
            }}
            size="icon"
            title="复制"
            variant="ghost"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            disabled={form.relayProfiles.length <= 1}
            onClick={(event) => {
              event.stopPropagation();
              onFormChange(removeRelayProfile(form, profile.id));
            }}
            size="icon"
            title="删除供应商"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </span>
      </span>
    </div>
  );
}

function MarketScriptCard({ script, actions }: { script: ScriptMarketItem; actions: Actions }) {
  const status = script.updateAvailable ? "可更新" : script.installed ? `已安装 ${script.installedVersion}` : "未安装";
  return (
    <div className="script-market-card">
      <div className="script-market-title">
        <div>
          <strong>{script.name}</strong>
          <span>{script.author || "未知作者"}</span>
        </div>
        <UiBadge variant={script.updateAvailable ? "default" : script.installed ? "secondary" : "outline"}>{status}</UiBadge>
      </div>
      <p className="script-market-description">{script.description || "暂无描述。"}</p>
      <div className="script-market-tags">
        <span className="script-market-tag">v{script.version}</span>
        {script.tags.map((tag) => (
          <span className="script-market-tag" key={tag}>{tag}</span>
        ))}
      </div>
      <div className="script-market-actions">
        <Button onClick={() => void actions.installMarketScript(script.id)} size="sm">
          <Download className="h-4 w-4" />
          {script.updateAvailable ? "更新" : script.installed ? "重新安装" : "安装"}
        </Button>
        {script.homepage ? (
          <Button onClick={() => void actions.openExternalUrl(script.homepage)} size="sm" variant="secondary">
            <ExternalLink className="h-4 w-4" />
            主页
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RelayProfileDetail({
  profile,
  relayFiles,
  form,
  isNew = false,
  onBack,
  onFormChange,
  onSaved,
  actions,
}: {
  profile: RelayProfile;
  relayFiles: RelayFilesResult | null;
  form: BackendSettings;
  isNew?: boolean;
  onBack: () => void;
  onFormChange: (value: BackendSettings, preserveLinkedProfiles?: boolean) => void | Promise<void>;
  onSaved?: () => void;
  actions: Actions;
}) {
  const [draft, setDraft] = useState<RelayProfile>(profile);
  const isActive = !isNew && profile.id === form.activeRelayId;
  useEffect(() => {
    setDraft(
      deriveRelayProfileFromFiles(
        isActive && relayFiles
          ? {
            ...profile,
            configContents: relayFiles.configContents,
            authContents: relayFiles.authContents,
          }
          : profile,
      ),
    );
  }, [profile.id, isActive, isNew, relayFiles?.configContents, relayFiles?.authContents]);
  const saveDraft = async () => {
    const normalizedDraft = deriveRelayProfileFromFiles(draft);
    const next = isNew
      ? addRelayProfile(form, normalizedDraft)
      : updateRelayProfile(form, profile.id, normalizedDraft);
    await onFormChange(next, !!normalizedDraft.linkedCcsProviderId);
    if (isActive) {
      await actions.saveRelayFile(
        "config",
        effectiveRelayConfigPreview(normalizedDraft, form, normalizedDraft),
        true,
      );
      await actions.saveRelayFile("auth", normalizedDraft.authContents, true);
    }
    onSaved?.();
  };
  const switchDraft = () => {
    if (isNew || !form.relayProfilesEnabled) return;
    const normalizedDraft = deriveRelayProfileFromFiles(draft);
    const previousActiveRelayId = form.activeRelayId;
    const next = syncLegacyRelayFields({
      ...form,
      relayProfiles: form.relayProfiles.map((item) => (item.id === profile.id ? normalizedDraft : item)),
      activeRelayId: profile.id,
    });
    void actions.switchRelayProfile(next, previousActiveRelayId);
  };
  return (
    <div className="relay-detail-page" key={profile.id}>
      <div className="relay-detail-sticky">
        <Toolbar>
          <Button onClick={onBack} variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            返回列表
          </Button>
          <Button onClick={() => void saveDraft()}>
            <Save className="h-4 w-4" />
            保存
          </Button>
        </Toolbar>
      </div>
        <RelayProfileEditor profile={draft} form={form} isNew={isNew} onProfileChange={setDraft} onSwitch={switchDraft} actions={actions} />
      <RelayFileEditors
        contextProfile={profile}
        profile={draft}
        form={form}
        isActive={isActive}
        profileId={profile.id}
        onFormChange={onFormChange}
        onProfileChange={setDraft}
        actions={actions}
      />
    </div>
  );
}

function ContextScreen({
  form,
  liveEntries,
  relayFiles,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  liveEntries: CodexContextEntries | null;
  relayFiles: RelayFilesResult | null;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  return (
    <Panel fill>
      <CardHead title="Codex 工具与插件" detail="独立管理 Codex 的 MCP、Skills、Plugins；切换任意供应商都会带上。" />
      <CardContent>
        <RelayContextManager
          form={normalizeSettings(form)}
          liveEntries={liveEntries}
          relayFiles={relayFiles}
          onFormChange={onFormChange}
          actions={actions}
        />
      </CardContent>
    </Panel>
  );
}

function RelayProfileEditor({
  profile,
  form,
  isNew = false,
  onProfileChange,
  onSwitch,
  actions,
}: {
  profile: RelayProfile;
  form: BackendSettings;
  isNew?: boolean;
  onProfileChange: (value: RelayProfile) => void;
  onSwitch: () => void;
  actions: Actions;
}) {
  const showApiFields = profile.relayMode !== "official" || profile.officialMixApiKey;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const updateDraft = (patch: Partial<RelayProfile>) => {
    onProfileChange(applyRelayProfilePatchToFiles(profile, patch, { allowGenerateFiles: isNew }));
  };
  return (
    <div className="relay-profile-editor">
      <div className="relay-editor-head">
        <div>
          <strong>{profile.name || "未命名供应商"}</strong>
          <span>{relayProfileEditorStatus(profile, form, isNew)}</span>
        </div>
        {isNew ? null : (
          <Button
            disabled={!form.relayProfilesEnabled}
            onClick={onSwitch}
            title={!form.relayProfilesEnabled ? "供应商配置总开关已关闭" : undefined}
            variant={profile.id === form.activeRelayId ? "secondary" : "default"}
          >
            {profile.id === form.activeRelayId ? "使用中" : "设为当前"}
          </Button>
        )}
      </div>
      <div className="relay-fields">
        <Field className="relay-field-name" label="名称">
          <Input
            value={profile.name}
            onChange={(event) => updateDraft({ name: event.currentTarget.value })}
          />
        </Field>
        <Field className="relay-field-mode" label="接入模式">
          <select
            className="field-select"
            value={profile.relayMode}
            onChange={(event) => {
              const relayMode = event.currentTarget.value as RelayMode;
              updateDraft(relayMode === "official" ? { relayMode, officialMixApiKey: false } : { relayMode });
            }}
          >
            <option value="official">官方登录</option>
            <option value="pureApi">纯 API</option>
          </select>
        </Field>
        <Field className="relay-field-config-model" label="配置模型">
          <Input
            value={profile.model}
            onChange={(event) => updateDraft({ model: event.currentTarget.value })}
            placeholder="写入 config.toml 的 model 字段，例如 gpt-5"
          />
        </Field>
        <Field className="relay-field-goals" label="Codex 目标">
          <label className="inline-check">
            <input
              checked={configHasCodexGoalsFeature(profile.configContents)}
              onChange={(event) =>
                updateDraft({
                  configContents: setCodexGoalsFeatureInConfig(profile.configContents, event.currentTarget.checked),
                })
              }
              type="checkbox"
            />
            <span>启用目标功能</span>
          </label>
        </Field>
        <div className="relay-advanced-toggle">
          <Button
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Settings className="h-4 w-4" />
            更多选项
          </Button>
        </div>
        {showAdvanced ? (
          <div className="relay-advanced-fields">
            <Field className="relay-field-test-model" label="测试模型">
              <Input
                value={profile.testModel}
                onChange={(event) => updateDraft({ testModel: event.currentTarget.value })}
                placeholder={`留空使用默认：${form.relayTestModel || defaultSettings.relayTestModel}`}
              />
            </Field>
            <Field className="relay-field-context-window" label="上下文大小">
              <Input
                inputMode="numeric"
                value={profile.contextWindow}
                onChange={(event) => updateDraft({ contextWindow: event.currentTarget.value.replace(/[^\d]/g, "") })}
                placeholder="留空不改写，例如 200000"
              />
            </Field>
            <Field className="relay-field-auto-compact" label="压缩上下文大小">
              <Input
                inputMode="numeric"
                value={profile.autoCompactLimit}
                onChange={(event) => updateDraft({ autoCompactLimit: event.currentTarget.value.replace(/[^\d]/g, "") })}
                placeholder="留空不改写，例如 160000"
              />
            </Field>
          </div>
        ) : null}
        {profile.relayMode === "official" ? (
          <Field className="relay-field-official-key" label="API Key">
            <label className="inline-check">
              <input
                checked={profile.officialMixApiKey}
                onChange={(event) => updateDraft({ officialMixApiKey: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>混入 API KEY</span>
            </label>
          </Field>
        ) : null}
        {showApiFields ? (
          <div className="relay-api-fields">
            <Field className="relay-field-base-url" label="Base URL">
              <Input
                value={profile.baseUrl}
                onChange={(event) => updateDraft({ baseUrl: event.currentTarget.value })}
                placeholder="填写中转服务 Base URL"
              />
            </Field>
            <Field className="relay-field-key" label="Key">
              <Input
                type="password"
                value={profile.apiKey}
                onChange={(event) => updateDraft({ apiKey: event.currentTarget.value })}
                placeholder="输入中转服务的 API Key"
              />
            </Field>
            <Field className="relay-field-protocol" label="上游协议">
              <div className="protocol-options">
                <button
                  className={`protocol-option ${profile.protocol === "responses" ? "active" : ""}`}
                  onClick={() => updateDraft({ protocol: "responses" })}
                  type="button"
                >
                  Responses API
                </button>
                <button
                  className={`protocol-option ${profile.protocol === "chatCompletions" ? "active" : ""}`}
                  onClick={() => updateDraft({ protocol: "chatCompletions" })}
                  type="button"
                >
                  Chat Completions
                </button>
              </div>
            </Field>
          </div>
        ) : null}
        {showApiFields ? (
          <Field className="relay-field-model-list" label="模型列表">
            <div className="relay-model-list-tools">
              <Textarea
                value={profile.modelList}
                onChange={(event) => updateDraft({ modelList: event.currentTarget.value })}
                placeholder="每行一个模型，例如 qwen3-coder"
              />
              <Button
                onClick={async () => {
                  const models = await actions.fetchRelayProfileModels(profile);
                  if (models?.length) updateDraft({ modelList: models.join("\n") });
                }}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Download className="h-4 w-4" />
                从上游获取
              </Button>
            </div>
          </Field>
        ) : null}
        {showApiFields ? (
          <Field className="relay-field-user-agent" label="User-Agent">
            <Input
              value={profile.userAgent}
              onChange={(event) => updateDraft({ userAgent: event.currentTarget.value })}
              placeholder="留空使用默认值"
            />
          </Field>
        ) : null}
      </div>
      {showApiFields && profile.protocol === "chatCompletions" ? (
        <div className="hint-line relay-protocol-hint">
          <MessageCircle className="h-4 w-4" />
          <span>此上游会通过本地 127.0.0.1:57321 转成 Responses API，需要从 Ucodex 启动 Codex。</span>
        </div>
      ) : null}
      <div className="hint-line relay-protocol-hint">
        <ShieldCheck className="h-4 w-4" />
        <span>{relayProfileModeHelp(profile)}</span>
      </div>
      {profile.linkedCcsProviderId ? (
        <div className="hint-line relay-protocol-hint">
          <Link2 className="h-4 w-4" />
          <span>
            此供应商联动自 cc-switch：{profile.linkedCcsProviderId}。开启“保存时回写 cc-switch”后，本页保存会同步修改 cc-switch 数据库中的同一供应商。
          </span>
        </div>
      ) : null}
    </div>
  );
}

function RelayContextManager({
  form,
  liveEntries,
  relayFiles,
  onFormChange,
  actions,
}: {
  form: BackendSettings;
  liveEntries: CodexContextEntries | null;
  relayFiles: RelayFilesResult | null;
  onFormChange: (value: BackendSettings) => void;
  actions: Actions;
}) {
  const entries = contextEntriesWithLiveEntries(form, liveEntries);
  const [activeKind, setActiveKind] = useState<ContextKind>("mcp");
  const [editor, setEditor] = useState<{ kind: ContextKind; entry?: CodexContextEntry } | null>(null);
  const visibleEntries = contextEntriesByKind(entries, activeKind);
  const label = contextKindLabel(activeKind);

  const saveEntry = async (kind: ContextKind, id: string, tomlBody: string) => {
    const next = await actions.upsertContextEntry(form, kind, id, tomlBody);
    if (!next) return;
    onFormChange(next);
    setEditor(null);
  };

  const toggleContextEntryEnabled = async (entry: CodexContextEntry) => {
    const nextBody = setContextEntryEnabled(entry.tomlBody, !entry.enabled);
    const next = await actions.upsertContextEntry(form, entry.kind, entry.id, nextBody);
    if (!next) return;
    onFormChange(next);
    const syncResult = await actions.syncLiveContextEntries(next, true);
    if (syncResult && isSuccessStatus(syncResult.status)) {
      void actions.refreshRelayFiles();
    }
  };

  const deleteEntry = async (entry: CodexContextEntry) => {
    const next = await actions.deleteContextEntry(form, entry.kind, entry.id);
    if (!next) return;
    onFormChange(next);
  };

  return (
    <div className="relay-context-panel">
      <div className="relay-context-head">
        <div>
          <strong>Codex 工具与插件</strong>
          <span>MCP、Skills、Plugins 作为全局配置独立管理，切换任意供应商都会合并。</span>
        </div>
        <div className="relay-context-head-actions">
          <Button onClick={() => setEditor({ kind: activeKind })} size="sm" variant="secondary">
            <Plus className="h-4 w-4" />
            新增{label}
          </Button>
        </div>
      </div>
      <div className="segmented">
        {contextKindOptions.map((option) => (
          <button
            className={activeKind === option.kind ? "active" : ""}
            key={option.kind}
            onClick={() => setActiveKind(option.kind)}
            type="button"
          >
            <span>{option.label}</span>
            <small>{contextEntriesByKind(entries, option.kind).length}</small>
          </button>
        ))}
      </div>
      <div className="relay-context-summary">
        当前共有 {visibleEntries.length} 个{label}；这些条目独立于供应商保存，会写入所有供应商切换后的 config.toml。
      </div>
      <div className="relay-context-list">
        {visibleEntries.length ? (
          visibleEntries.map((entry) => (
            <div className="relay-context-row" key={`${entry.kind}-${entry.id}`}>
              <strong className="context-title">{entry.title || entry.id}</strong>
              <div className="relay-context-actions">
                <button
                  aria-checked={entry.enabled}
                  aria-label={`contextEnabledSwitch-${entry.kind}-${entry.id}`}
                  className={`context-enabled-switch ${entry.enabled ? "active" : ""}`}
                  onClick={() => void toggleContextEntryEnabled(entry)}
                  role="switch"
                  title={entry.enabled ? "禁用此扩展项" : "启用此扩展项"}
                  type="button"
                >
                  <span className="context-switch-track" aria-hidden="true">
                    <span className="context-switch-thumb" />
                  </span>
                </button>
                <Button onClick={() => setEditor({ kind: entry.kind, entry })} size="icon" title="编辑扩展项" variant="ghost">
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button
                  className="relay-context-delete"
                  onClick={() => void deleteEntry(entry)}
                  size="icon"
                  title="删除扩展项"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="empty">暂无{label}，可以从通用配置文件或这里新增。</div>
        )}
      </div>
      {editor ? (
        <ContextEntryEditor
          entry={editor.entry}
          kind={editor.kind}
          onCancel={() => setEditor(null)}
          onSave={(kind, id, tomlBody) => void saveEntry(kind, id, tomlBody)}
        />
      ) : null}
    </div>
  );
}

function ContextEntryEditor({
  kind,
  entry,
  onCancel,
  onSave,
}: {
  kind: ContextKind;
  entry?: CodexContextEntry;
  onCancel: () => void;
  onSave: (kind: ContextKind, id: string, tomlBody: string) => void;
}) {
  const [draftKind, setDraftKind] = useState<ContextKind>(entry?.kind ?? kind);
  const [id, setId] = useState(entry?.id ?? "");
  const [tomlBody, setTomlBody] = useState(entry?.tomlBody ?? "");
  const canSave = id.trim().length > 0;

  return (
    <div className="context-editor">
      <div className="context-editor-fields">
        <Field label="类型">
          <select
            className="field-select"
            disabled={!!entry}
            value={draftKind}
            onChange={(event) => setDraftKind(event.currentTarget.value as ContextKind)}
          >
            {contextKindOptions.map((option) => (
              <option key={option.kind} value={option.kind}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="ID">
          <Input
            disabled={!!entry}
            value={id}
            onChange={(event) => setId(event.currentTarget.value.trim())}
            placeholder="例如 context7"
          />
        </Field>
      </div>
      <Field label="TOML 配置体">
        <Textarea
          className="context-editor-textarea"
          value={tomlBody}
          onChange={(event) => setTomlBody(event.currentTarget.value)}
          placeholder={'只填写表头下面的内容，例如：\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]'}
          spellCheck={false}
        />
      </Field>
      <Toolbar>
        <Button disabled={!canSave} onClick={() => onSave(draftKind, id.trim(), tomlBody)} size="sm">
          <Save className="h-4 w-4" />
          保存扩展项
        </Button>
        <Button onClick={onCancel} size="sm" variant="secondary">取消</Button>
      </Toolbar>
    </div>
  );
}

function SyncedTextarea({
  value,
  onValueChange,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const isFocusedRef = useRef(false);
  const latestExternalValueRef = useRef(value);

  useEffect(() => {
    latestExternalValueRef.current = value;
    if (!isFocusedRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  return (
    <Textarea
      className={className}
      value={localValue}
      onBlur={() => {
        isFocusedRef.current = false;
        setLocalValue(latestExternalValueRef.current);
      }}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setLocalValue(next);
        onValueChange(next);
      }}
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      spellCheck={false}
    />
  );
}

function RelayFileEditors({
  contextProfile,
  profile,
  form,
  isActive,
  profileId,
  onFormChange,
  onProfileChange,
  actions,
}: {
  contextProfile: RelayProfile;
  profile: RelayProfile;
  form: BackendSettings;
  isActive: boolean;
  profileId: string;
  onFormChange: (value: BackendSettings) => void;
  onProfileChange: (value: RelayProfile) => void;
  actions: Actions;
}) {
  const configPreview = effectiveRelayConfigPreview(profile, form, contextProfile);
  const entries = contextEntriesForProfile(form, contextProfile);
  return (
    <div className="relay-file-grid">
      <div className="relay-file-panel">
        <div className="relay-file-head">
          <div>
            <strong>config.toml 预览</strong>
            <span>{isActive ? "当前供应商切换后会写入的预览；上下文开关变化会立即反映" : "切换到此供应商时会写入的预览；上下文开关变化会立即反映"}</span>
          </div>
        </div>
        <SyncedTextarea
          className="relay-file-textarea"
          value={configPreview}
          onValueChange={(value) => {
            const withoutCommon = stripCommonConfigTextFallback(
              value,
              relayCombinedCommonConfig(form),
            );
            const configContents = stripContextEntriesFromConfig(withoutCommon, entries);
            onProfileChange(deriveRelayProfileFromFiles({
              ...profile,
              configContents,
            }));
          }}
        />
      </div>
      <div className="relay-file-panel">
        <div className="relay-file-head">
          <div>
            <strong>通用配置文件</strong>
            <span>只保留非 MCP、Skills、Plugins 的跨供应商配置；工具与插件在独立页面管理。</span>
          </div>
          <Button
            onClick={async () => {
              const extracted = await actions.extractRelayCommonConfig(profile.configContents || "");
              if (!extracted) return;
              const split = splitContextConfigText(extracted.commonConfigContents || "");
              if (!split.common.trim() && !split.context.trim()) {
                await actions.showMessage("通用配置文件", "当前供应商 config.toml 里没有可提取的通用配置。", "failed");
                return;
              }
              const promotedProfile = {
                ...profile,
                configContents: extracted.profileConfigContents,
              };
              const next = syncLegacyRelayFields({
                ...form,
                relayCommonConfigContents: split.common,
                relayContextConfigContents: joinTomlSectionsRootFirst([form.relayContextConfigContents || "", split.context]),
                relayProfiles: form.relayProfiles.map((item) => (item.id === profileId ? promotedProfile : item)),
              });
              onFormChange(next);
              onProfileChange(promotedProfile);
              await actions.saveSettingsValue(next, false);
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Download className="h-4 w-4" />
            提取当前供应商配置
          </Button>
        </div>
        <SyncedTextarea
          className="relay-file-textarea"
          value={form.relayCommonConfigContents}
          onValueChange={(value) => onFormChange({ ...form, relayCommonConfigContents: value })}
        />
      </div>
      <div className="relay-file-panel">
        <div className="relay-file-head">
          <div>
            <strong>auth.json</strong>
            <span>{isActive ? "当前使用中：打开时从 ~/.codex/auth.json 回填，保存后会作为此供应商 auth 存档" : "切换到此供应商时会写入 ~/.codex/auth.json"}</span>
          </div>
        </div>
        <SyncedTextarea
          className="relay-file-textarea"
          value={profile.authContents}
          onValueChange={(value) => onProfileChange(deriveRelayProfileFromFiles({ ...profile, authContents: value }))}
        />
      </div>
    </div>
  );
}

function ModeSelector({ launchMode, actions }: { launchMode: LaunchMode; actions: Actions }) {
  return (
    <div className="mode-grid">
      <button
        className={`mode-option ${launchMode === "relay" ? "active" : ""}`}
        onClick={() => void actions.setLaunchMode("relay")}
        type="button"
      >
        <strong>兼容增强</strong>
        <span>适合官方登录或官方混入 API Key；保留会话删除、导出、项目移动、Timeline 和用户脚本，关闭插件入口相关增强。</span>
      </button>
      <button
        className={`mode-option ${launchMode === "patch" ? "active" : ""}`}
        onClick={() => void actions.setLaunchMode("patch")}
        type="button"
      >
        <strong>完整增强</strong>
        <span>适合纯 API；启用插件入口、强制安装、会话删除导出、项目移动等全部页面能力。</span>
      </button>
    </div>
  );
}

function FeatureItem({ title, detail, enabled }: { title: string; detail: string; enabled: boolean }) {
  return (
    <div className="feature-item">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <Badge status={enabled ? "ok" : "disabled"} />
    </div>
  );
}

function FeatureToggle({
  title,
  detail,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`feature-toggle ${disabled ? "disabled" : ""}`}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <Badge status={!disabled && checked ? "ok" : "disabled"} />
    </label>
  );
}

function GuideList({ items }: { items: string[] }) {
  return (
    <div className="guide-list">
      {items.map((item, index) => (
        <div className="guide-step" key={item}>
          <span>{index + 1}</span>
          <p>{item}</p>
        </div>
      ))}
    </div>
  );
}

function NoticeDialog({
  notice,
  onClose,
}: {
  notice: { title: string; message: string; status?: Status };
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className={`toast-card ${notice.status === "failed" ? "failed" : ""}`}>
        <div className="toast-progress" />
        <div className="toast-icon">
          {notice.status === "failed" ? <Bell className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
        </div>
        <div className="toast-body">
          <h2>{notice.title}</h2>
          <p>{notice.message}</p>
        </div>
        <button className="toast-close" onClick={onClose} type="button">×</button>
      </div>
    </div>
  );
}

function Panel({ children, fill = false, className = "" }: { children: React.ReactNode; fill?: boolean; className?: string }) {
  return (
    <Card className={`panel ${fill ? "fill" : ""} ${className}`}>
      {children}
    </Card>
  );
}

function CardHead({ title, detail }: { title: string; detail: string }) {
  return (
    <CardHeader className="panel-head">
      <CardTitle>{title}</CardTitle>
      <CardDescription>{detail}</CardDescription>
    </CardHeader>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <Label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </Label>
  );
}

function StatusRow({ title, status = "unknown", path }: { title: string; status?: string; path?: string | null }) {
  return (
    <div className="status-row">
      <span>{title}</span>
      <Badge status={status} />
      <code>{path || "未记录路径"}</code>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  return <UiBadge className={statusClass(status)} variant="secondary">{statusLabel(status)}</UiBadge>;
}

function LatestLaunch({ status }: { status: LaunchStatus | null }) {
  if (!status) return <div className="empty">暂无启动状态。</div>;
  return (
    <div className="metric-list">
      <Metric label="状态" value={status.status} />
      <Metric label="消息" value={status.message} />
      <Metric label="Debug" value={String(status.debug_port ?? "-")} />
      <Metric label="Helper" value={String(status.helper_port ?? "-")} />
      <Metric label="时间" value={formatTime(status.started_at_ms)} />
    </div>
  );
}

function formatInterval(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${ms / 1000}s`;
  return `${ms / 60000}min`;
}

function formatCost(cost: number): string {
  const abs = Math.abs(cost);
  if (abs >= 1_000_000_000) return `${(cost / 1_000_000_000).toFixed(2)}B Cr`;
  if (abs >= 1_000_000) return `${(cost / 1_000_000).toFixed(2)}M Cr`;
  if (abs >= 1_000) return `${(cost / 1_000).toFixed(2)}K Cr`;
  if (abs >= 1) return `${cost.toFixed(1)} Cr`;
  if (abs >= 0.01) return `${cost.toFixed(2)} Cr`;
  return `${cost.toFixed(4)} Cr`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(2)}K`;
  return String(tokens);
}

function extractCacheStats(stats: Record<string, unknown>) {
  const cs = stats.cache_stats as Record<string, unknown> | undefined;
  return {
    hits: (cs?.hits as number) ?? 0,
    misses: (cs?.misses as number) ?? 0,
    hitRate: (cs?.hit_rate as number) ?? 0,
    size: (cs?.size as number) ?? 0,
    maxSize: (cs?.max_size as number) ?? 0,
  };
}

/** Shared auto-refresh hook for both ProcessesScreen and ProxyStatsScreen */
function useAutoRefresh(fetch: (silent: boolean) => Promise<void>, defaultInterval = 5000) {
  const [interval, setInterval_] = useState(defaultInterval);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  // Auto-load on mount
  useEffect(() => {
    void fetchRef.current(false);
  }, []);

  // Periodic auto-refresh (silent)
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void fetchRef.current(true);
    }, interval);
    return () => clearInterval(id);
  }, [autoRefresh, interval]);

  return {
    interval,
    setInterval: setInterval_,
    autoRefresh,
    toggleAutoRefresh: () => setAutoRefresh(v => !v),
    detailText: autoRefresh ? `每 ${formatInterval(interval)} 自动刷新` : "自动刷新已暂停",
  };
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "warn" | "danger" | "muted" }) {
  const border = tone === "danger" ? "var(--color-destructive, #ef4444)" : tone === "warn" ? "#f59e0b" : tone === "ok" ? "#22c55e" : "var(--color-border, rgba(0,0,0,0.08))";
  return (
    <div style={{ borderColor: border, borderWidth: 1, borderStyle: "solid", borderRadius: 8, padding: "8px 10px", background: tone === "danger" ? "rgba(239,68,68,0.06)" : tone === "warn" ? "rgba(245,158,11,0.06)" : "var(--color-card, transparent)" }}>
      <div style={{ fontSize: 11, color: "var(--color-muted-foreground, #6b7280)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
      {hint ? <div style={{ marginTop: 4, fontSize: 11, color: tone === "danger" ? "#ef4444" : tone === "warn" ? "#b45309" : "#6b7280" }}>{hint}</div> : null}
    </div>
  );
}

function ScriptRow({ script, actions }: { script: NonNullable<UserScriptInventory["scripts"]>[number]; actions: Actions }) {
  const source = script.market_id ? `市场 · ${script.version || "未知版本"}` : script.source === "builtin" ? "内置" : "用户";
  const canDelete = script.source === "user";
  return (
    <div className="table-row">
      <span>{script.name}</span>
      <span>{source}</span>
      <span>{script.enabled ? "启用" : "关闭"}</span>
      <span>{script.status}</span>
      <div className="script-row-actions">
        <Button onClick={() => void actions.setUserScriptEnabled(script.key, !script.enabled)} size="sm" variant="secondary">
          {script.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          {script.enabled ? "禁用" : "启用"}
        </Button>
        {canDelete ? (
          <Button onClick={() => void actions.deleteUserScript(script.key)} size="sm" variant="outline">
            <Trash2 className="h-4 w-4" />
            删除
          </Button>
        ) : null}
      </div>
    </div>
  );
}


type DailyStatsRecord = {
  date: string;
  totalRequests: number;
  totalErrors: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalReasoningTokens: number;
  totalCachedTokens: number;
  totalTokens: number;
  totalCost: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
};

type HourlyStatsRecord = {
  datetime: string;
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
};

const chartColors = {
  tokens: { border: "#6366f1", bg: "rgba(99,102,241,0.15)" },
  requests: { border: "#22c55e", bg: "rgba(34,197,94,0.15)" },
  cost: { border: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
  latency: { border: "#ef4444", bg: "rgba(239,68,68,0.15)" },
  errors: { border: "#ef4444", bg: "rgba(239,68,68,0.15)" },
  input: { border: "#6366f1", bg: "rgba(99,102,241,0.15)" },
  output: { border: "#8b5cf6", bg: "rgba(139,92,246,0.15)" },
  reasoning: { border: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
};

const chartBaseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "nearest" as const, intersect: false },
  plugins: {
    legend: { position: "top" as const, labels: { boxWidth: 12, padding: 16, font: { size: 12 } } },
    tooltip: { backgroundColor: "rgba(0,0,0,0.8)", padding: 10, cornerRadius: 8, position: "nearest" as const },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.06)" }, ticks: { font: { size: 11 } } },
  },
};

function StatsChartsSection({ historyDays, onHistoryDaysChange }: { historyDays: number; onHistoryDaysChange: (days: number) => void }) {
  const [daily, setDaily] = useState<DailyStatsRecord[]>([]);
  const [hourly, setHourly] = useState<HourlyStatsRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke<CommandResult<{ daily: DailyStatsRecord[]; todayHourly: HourlyStatsRecord[] }>>(
        "load_stats_history",
        { days: historyDays },
      );
      if (res.status === "ok") {
        setDaily(res.daily ?? []);
        setHourly(res.todayHourly ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [historyDays]);

  useEffect(() => { void fetchHistory(); }, [fetchHistory]);

  if (loading && daily.length === 0) {
    return <div className="empty" style={{ padding: 24 }}>正在加载历史统计数据...</div>;
  }

  if (daily.length === 0 && hourly.length === 0) {
    return (
      <Panel>
        <CardHead title="历史趋势" detail="数据库中暂无记录" />
        <CardContent>
          <div className="empty">暂无历史数据。使用 Codex 进行对话后，统计数据会自动持久化到数据库。</div>
          <Toolbar>
            <Button onClick={() => void fetchHistory()} variant="outline" disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </Toolbar>
        </CardContent>
      </Panel>
    );
  }

  const dailyLabels = daily.map(d => d.date.slice(5)); // MM-DD
  const hourlyLabels = hourly.map(h => h.datetime.slice(11)); // HH:00

  const tokenChartData = {
    labels: dailyLabels,
    datasets: [
      { label: "输入 Token", data: daily.map(d => d.totalPromptTokens), borderColor: chartColors.input.border, backgroundColor: chartColors.input.bg, fill: true, tension: 0.3 },
      { label: "输出 Token", data: daily.map(d => d.totalCompletionTokens), borderColor: chartColors.output.border, backgroundColor: chartColors.output.bg, fill: true, tension: 0.3 },
      { label: "推理 Token", data: daily.map(d => d.totalReasoningTokens), borderColor: chartColors.reasoning.border, backgroundColor: chartColors.reasoning.bg, fill: true, tension: 0.3 },
    ],
  };

  const requestChartData = {
    labels: dailyLabels,
    datasets: [
      { label: "请求数", data: daily.map(d => d.totalRequests), borderColor: chartColors.requests.border, backgroundColor: chartColors.requests.bg, fill: true, tension: 0.3 },
      { label: "错误数", data: daily.map(d => d.totalErrors), borderColor: chartColors.errors.border, backgroundColor: chartColors.errors.bg, fill: true, tension: 0.3 },
    ],
  };

  const costChartData = {
    labels: dailyLabels,
    datasets: [
      { label: "费用 ($)", data: daily.map(d => d.totalCost), borderColor: chartColors.cost.border, backgroundColor: chartColors.cost.bg, fill: true, tension: 0.3 },
    ],
  };

  const latencyChartData = {
    labels: dailyLabels,
    datasets: [
      { label: "平均延迟 (ms)", data: daily.map(d => d.avgLatencyMs), borderColor: chartColors.latency.border, backgroundColor: chartColors.latency.bg, fill: true, tension: 0.3 },
    ],
  };

  const hourlyChartData = {
    labels: hourlyLabels,
    datasets: [
      { label: "请求数", data: hourly.map(h => h.requests), backgroundColor: "rgba(99,102,241,0.6)", borderRadius: 4 },
      { label: "Token (K)", data: hourly.map(h => Math.round(h.totalTokens / 1000)), backgroundColor: "rgba(139,92,246,0.6)", borderRadius: 4 },
    ],
  };

  const chartStyle = { height: 260, width: "100%" as const, position: "relative" as const };

  return (
    <>
      {daily.length > 0 && (
        <>
          <Panel>
            <CardHead title="Token 用量趋势" detail={`最近 ${daily.length} 天`} />
            <CardContent>
              <div style={chartStyle}>
                <Line data={tokenChartData} options={chartBaseOptions} />
              </div>
            </CardContent>
          </Panel>

          <Panel>
            <CardHead title="请求量趋势" detail="每日请求数与错误数" />
            <CardContent>
              <div style={chartStyle}>
                <Line data={requestChartData} options={chartBaseOptions} />
              </div>
            </CardContent>
          </Panel>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Panel>
              <CardHead title="费用趋势" detail="每日费用估算" />
              <CardContent>
                <div style={{ height: 200, width: "100%", position: "relative" }}>
                  <Line data={costChartData} options={{ ...chartBaseOptions, plugins: { ...chartBaseOptions.plugins, legend: { display: false } } }} />
                </div>
              </CardContent>
            </Panel>
            <Panel>
              <CardHead title="延迟趋势" detail="每日平均延迟" />
              <CardContent>
                <div style={{ height: 200, width: "100%", position: "relative" }}>
                  <Line data={latencyChartData} options={{ ...chartBaseOptions, plugins: { ...chartBaseOptions.plugins, legend: { display: false } } }} />
                </div>
              </CardContent>
            </Panel>
          </div>
        </>
      )}

      {hourly.length > 0 && (
        <Panel>
          <CardHead title="今日逐小时分布" detail={`${hourly.length} 个小时有数据`} />
          <CardContent>
            <div style={chartStyle}>
              <Bar data={hourlyChartData} options={chartBaseOptions} />
            </div>
          </CardContent>
        </Panel>
      )}

      <Toolbar>
        <Button onClick={() => void fetchHistory()} variant="outline" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          刷新历史数据
        </Button>
      </Toolbar>
    </>
  );
}

function ProxyStatsScreen({ stats, actions }: { stats: Record<string, unknown> | null; actions: Actions }) {
  const [historyDays, setHistoryDays] = useState(14);
  const autoRefresh = useAutoRefresh(actions.refreshProxyStats, 5000);

  if (!stats) return <div className="empty">正在加载代理统计...</div>;
  if ((stats as Record<string, unknown>).offline) {
    return (
      <>
        <Panel>
          <CardHead title="代理服务状态" detail="helper 服务器未运行" />
          <CardContent>
            <div className="empty">helper 服务器未运行。点击下方按钮启动 Ucodex，启动后代理统计将自动可用。</div>
            <Toolbar>
              <Button onClick={() => void actions.launch()}>
                <Rocket className="h-4 w-4" />
                启动 Ucodex
              </Button>
              <Button onClick={() => void actions.refreshProxyStats()} variant="outline">
                <RefreshCw className="h-4 w-4" />
                刷新状态
              </Button>
            </Toolbar>
          </CardContent>
        </Panel>
      </>
    );
  }

  const s = stats as {
    total_requests?: number;
    total_errors?: number;
    total_prompt_tokens?: number;
    total_completion_tokens?: number;
    total_reasoning_tokens?: number;
    total_cached_tokens?: number;
    total_tokens?: number;
    total_cost?: number;
    avg_latency_ms?: number;
    cache_stats?: { hits?: number; misses?: number; hit_rate?: number; size?: number; max_size?: number };
    models?: Record<string, { count?: number; total_tokens?: number; total_cost?: number; total_prompt_tokens?: number; total_completion_tokens?: number; total_cached_tokens?: number; total_reasoning_tokens?: number }>;
    recent?: Array<{ timestamp?: string; model?: string; prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number; reasoning_tokens?: number; total_tokens?: number; cost_estimate?: number; latency_ms?: number; cached?: boolean }>;
  };

  const cache = extractCacheStats(stats);

  const modelEntries = Object.entries(s.models ?? {}).sort(
    ([, a], [, b]) => (b.total_tokens ?? 0) - (a.total_tokens ?? 0),
  );

  return (
    <>
      <Panel>
        <CardHead title="全局统计" detail={autoRefresh.detailText} />
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,1fr) minmax(160px,1fr)", gap: 12 }}>
            <Metric label="总费用" value={formatCost(s.total_cost ?? 0)} hint={(s.total_requests ?? 0) > 0 ? `均值 ${formatCost(((s.total_cost ?? 0) as number) / ((s.total_requests as number) || 1))} / req` : "暂无请求"} tone={((s.total_cost ?? 0) as number) > 1_000_000 ? "warn" : "ok"} />
            <Metric label="平均延迟" value={`${formatTokens(s.avg_latency_ms ?? 0)}ms`} hint={((s.avg_latency_ms ?? 0) as number) > 5000 ? "偏高，建议检查上游响应" : "正常范围"} tone={((s.avg_latency_ms ?? 0) as number) > 8000 ? "danger" : ((s.avg_latency_ms ?? 0) as number) > 3000 ? "warn" : "ok"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px,1fr))", gap: 10, marginTop: 10 }}>
            <Metric label="请求数" value={formatTokens(s.total_requests ?? 0)} />
            <Metric label="错误数" value={formatTokens(s.total_errors ?? 0)} tone={((s.total_errors ?? 0) as number) > 0 ? "danger" : "ok"} hint={((s.total_requests ?? 0) as number) > 0 ? `错误率 ${((((s.total_errors ?? 0) as number) / ((s.total_requests as number) || 1)) * 100).toFixed(2)}%` : ""} />
            <Metric label="输入 Token" value={formatTokens(s.total_prompt_tokens ?? 0)} hint={`缓存 ${formatTokens(s.total_cached_tokens ?? 0)}`} />
            <Metric label="输出 Token" value={formatTokens(s.total_completion_tokens ?? 0)} hint={`推理 ${formatTokens(s.total_reasoning_tokens ?? 0)}`} />
          </div>
          <Toolbar>
            <Button onClick={() => void actions.refreshProxyStats()} variant="outline">
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
            <Button onClick={autoRefresh.toggleAutoRefresh} variant="outline">
              {autoRefresh.autoRefresh ? "暂停" : "恢复"}自动刷新
            </Button>
            <select
              className="field-select"
              style={{ width: "auto", minHeight: 34, fontSize: 13 }}
              value={autoRefresh.interval}
              onChange={(e) => autoRefresh.setInterval(Number(e.target.value))}
            >
              <option value={500}>0.5s</option>
              <option value={1000}>1s</option>
              <option value={5000}>5s</option>
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1min</option>
            </select>
          </Toolbar>
        </CardContent>
      </Panel>

      <Panel>
        <CardHead title="缓存状态" detail="非流式响应缓存，减少上游请求" />
        <CardContent>
          <div className="metric-list">
            <Metric label="缓存命中" value={formatTokens(cache.hits)} />
            <Metric label="缓存未命中" value={formatTokens(cache.misses)} />
            <Metric label="命中率" value={`${(cache.hitRate * 100).toFixed(1)}%`} hint={cache.hitRate <= 0.01 ? "命中率很低，建议检查缓存配置或访问模式" : undefined} tone={cache.hitRate <= 0.01 ? "warn" : "ok"} />
            <Metric label="缓存大小" value={`${formatTokens(cache.size)} / ${formatTokens(cache.maxSize)}`} />
          </div>
          {cache.hitRate <= 0.01 ? (
            <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", fontSize: 12 }}>
              缓存命中率接近 0%，看起来还没有命中缓存。可先确认：是否启用了缓存、是否命中可缓存路径、以及是否被手动清空。
            </div>
          ) : null}
        </CardContent>
      </Panel>

      <StatsChartsSection historyDays={historyDays} onHistoryDaysChange={setHistoryDays} />

      {modelEntries.length > 0 ? (
        <Panel>
          <CardHead title="按模型统计" detail="各模型的 Token 用量和费用（MiMo Credits）" />
          <CardContent>
            <div className="session-table-wrap">
              <table className="session-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>请求数</th>
                    <th>输入 Token</th>
                    <th>  缓存命中</th>
                    <th>输出 Token</th>
                    <th>推理 Token</th>
                    <th>费用 (Cr)</th>
                  </tr>
                </thead>
                <tbody>
                  {modelEntries.map(([model, data]) => (
                    <tr key={model}>
                      <td><code>{model || "(空)"}</code></td>
                      <td>{data.count ?? 0}</td>
                      <td>{formatTokens(data.total_prompt_tokens ?? 0)}</td>
                      <td>{formatTokens(data.total_cached_tokens ?? 0)}</td>
                      <td>{formatTokens(data.total_completion_tokens ?? 0)}</td>
                      <td>{formatTokens(data.total_reasoning_tokens ?? 0)}</td>
                      <td>{formatCost(data.total_cost ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Panel>
      ) : null}

      {s.recent && s.recent.length > 0 ? (
        <Panel>
          <CardHead title="最近请求" detail={`最近 ${s.recent.length} 条记录`} />
          <CardContent>
            <div className="session-table-wrap">
              <table className="session-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>模型</th>
                    <th>输入</th>
                    <th>缓存</th>
                    <th>输出</th>
                    <th>推理</th>
                    <th>费用</th>
                    <th>延迟</th>
                  </tr>
                </thead>
                <tbody>
                  {s.recent.slice(-20).reverse().map((r, i) => (
                    <tr key={i}>
                      <td><code>{r.timestamp ?? "-"}</code></td>
                      <td><code>{r.model || "-"}</code></td>
                      <td>{formatTokens(r.prompt_tokens ?? 0)}</td>
                      <td>{formatTokens(r.cached_tokens ?? 0)}</td>
                      <td>{formatTokens(r.completion_tokens ?? 0)}</td>
                      <td>{formatTokens(r.reasoning_tokens ?? 0)}</td>
                      <td>{formatCost(r.cost_estimate ?? 0)}</td>
                      <td>{r.latency_ms ?? 0}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Panel>
      ) : null}
    </>
  );
}

type CodexProcessInfo = {
  pid: number;
  name: string;
  command: string;
  port: number | null;
  role: string;
  cpuPercent: number;
  memoryMb: number;
  startedAt: string;
};

type ProcessListPayload = {
  processes: CodexProcessInfo[];
  helperPort: number;
  helperRunning: boolean;
  portConflict: boolean;
};

const roleLabels: Record<string, string> = {
  helper: "协议代理",
  "codex-manager": "管理工具",
  "codex-app": "Codex 主进程",
  "app-server": "App Server",
  renderer: "渲染进程",
  "node-repl": "Node REPL",
  "computer-use": "Computer Use",
  monitor: "快捷键监听",
};

const roleColors: Record<string, string> = {
  helper: "var(--accent)",
  "codex-manager": "#0ea5e9",
  "codex-app": "#6366f1",
  "app-server": "#8b5cf6",
  renderer: "#a78bfa",
  "node-repl": "#22c55e",
  "computer-use": "#f59e0b",
  monitor: "#64748b",
};

function ProcessesScreen({ actions }: { actions: Actions }) {
  const [data, setData] = useState<ProcessListPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchResult, setLaunchResult] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = async (silent = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await invoke<CommandResult<ProcessListPayload>>("list_codex_processes");
      setRawResponse(JSON.stringify(res, null, 2));
      if (res.status === "ok") {
        setData(res);
        setError(null);
      } else {
        setError(res.message || "获取进程列表失败");
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setError(errMsg);
      setRawResponse(`Error: ${errMsg}`);
    } finally {
      refreshInFlight.current = false;
      if (!silent) setLoading(false);
    }
  };

  const autoRefresh = useAutoRefresh(refresh, 5000);

  const quickLaunch = async () => {
    setLaunchResult(null);
    try {
      const res = await invoke<CommandResult<Record<string, unknown>>>("quick_launch_helper");
      setLaunchResult(res.message ?? JSON.stringify(res));
      setTimeout(() => void refresh(false), 2000);
    } catch (e: unknown) {
      setLaunchResult(e instanceof Error ? e.message : String(e));
    }
  };

  const killProcess = async (pid: number) => {
    try {
      const res = await invoke<CommandResult<unknown>>("kill_codex_process_by_pid", { pid });
      if (res.status !== "ok") {
        setError(res.message || "终止进程失败");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await refresh(false);
  };

  const killAll = async () => {
    try {
      const res = await invoke<CommandResult<unknown>>("kill_all_codex_processes");
      if (res.status !== "ok") {
        setError(res.message || "清理进程失败");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await refresh(false);
  };

  return (
    <>
      <Panel>
        <CardHead title="进程管理" detail={autoRefresh.detailText} />
        <CardContent>
          <Toolbar>
            <Button onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "加载中..." : "刷新"}
            </Button>
            <Button onClick={autoRefresh.toggleAutoRefresh} variant="outline">
              {autoRefresh.autoRefresh ? "暂停" : "恢复"}自动刷新
            </Button>
            <select
              className="field-select"
              style={{ width: "auto", minHeight: 34, fontSize: 13 }}
              value={autoRefresh.interval}
              onChange={(e) => autoRefresh.setInterval(Number(e.target.value))}
            >
              <option value={500}>0.5s</option>
              <option value={1000}>1s</option>
              <option value={5000}>5s</option>
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1min</option>
            </select>
            <Button onClick={() => void quickLaunch()} variant="outline">
              <Rocket className="h-4 w-4" />
              启动 Helper
            </Button>
            {data && (
              <Button onClick={() => void killAll()} variant="outline" style={{ color: "#ef4444" }}>
                <PowerOff className="h-4 w-4" />
                清理全部
              </Button>
            )}
          </Toolbar>
          {launchResult && (
            <div style={{ marginTop: 8, padding: "6px 12px", background: "hsl(var(--accent) / 0.08)", borderRadius: 8, fontSize: 13 }}>
              {launchResult}
            </div>
          )}
        </CardContent>
      </Panel>

      {data && (
        <>
          <Panel>
            <CardHead
              title="协议代理状态"
              detail={data.helperRunning ? `端口 ${data.helperPort} 运行中` : "未运行"}
            />
            <CardContent>
              <div className="metric-list">
                <Metric label="代理端口" value={String(data.helperPort)} />
                <Metric label="代理状态" value={data.helperRunning ? "运行中" : "未运行"} />
                <Metric label="进程数" value={String(data.processes.length)} />
                <Metric label="端口冲突" value={data.portConflict ? "是" : "否"} />
              </div>
              {data.portConflict && (
                <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 8, color: "#ef4444", fontSize: 13 }}>
                  ⚠️ 端口 {data.helperPort} 被非 Ucodex 进程占用，可能导致启动失败。请清理冲突进程后重试。
                </div>
              )}
            </CardContent>
          </Panel>

          {data.processes.length > 0 ? (
            <Panel fill>
              <CardHead title="进程列表" detail={`${data.processes.length} 个 Codex 相关进程`} />
              <CardContent>
                <div className="session-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>PID</th>
                        <th>角色</th>
                        <th>进程名</th>
                        <th>端口</th>
                        <th>CPU %</th>
                        <th>内存 MB</th>
                        <th>命令</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.processes.map((p) => (
                        <tr key={p.pid}>
                          <td><code>{p.pid}</code></td>
                          <td>
                            <span style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              background: `${roleColors[p.role] ?? "#64748b"}20`,
                              color: roleColors[p.role] ?? "#64748b",
                            }}>
                              {roleLabels[p.role] ?? p.role}
                            </span>
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: 13 }}>{p.name}</td>
                          <td>{p.port ? <code>{p.port}</code> : "—"}</td>
                          <td>{p.cpuPercent > 0 ? `${p.cpuPercent}%` : "—"}</td>
                          <td>{p.memoryMb > 0 ? `${p.memoryMb}` : "—"}</td>
                          <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontFamily: "monospace", opacity: 0.7 }}>
                            {p.command}
                          </td>
                          <td>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void killProcess(p.pid)}
                              style={{ color: "#ef4444", fontSize: 12, padding: "2px 8px" }}
                            >
                              <PowerOff className="h-3 w-3" />
                              终止
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Panel>
          ) : (
            <Panel>
              <CardContent>
                <div className="empty">没有发现 Codex 相关进程。</div>
              </CardContent>
            </Panel>
          )}
        </>
      )}

      {/* 原始返回显示区域 */}
      <Panel>
        <CardHead title="调试输出" detail="命令原始返回" />
        <CardContent>
          {rawResponse ? (
            <pre style={{
              background: "hsl(var(--accent) / 0.05)",
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: 400,
              overflowY: "auto",
            }}>
              {rawResponse}
            </pre>
          ) : (
            <div className="empty" style={{ opacity: 0.5 }}>点击"加载进程列表"后在此显示返回结果</div>
          )}
          {error && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 8, color: "#ef4444", fontSize: 13 }}>
              ❌ {error}
            </div>
          )}
        </CardContent>
      </Panel>
    </>
  );
}

function ConfigEditorScreen({ config, actions }: { config: Record<string, unknown> | null; actions: Actions }) {
  const [editingRaw, setEditingRaw] = useState("");
  const [activeTab, setActiveTab] = useState<"providers" | "features" | "mcp" | "plugins" | "projects" | "notify" | "rootKeys" | "migration" | "raw">("providers");
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<Record<string, string>>({});
  const [migrationStatus, setMigrationStatus] = useState<Record<string, unknown> | null>(null);

  if (!config) return <div className="empty">正在加载 config.toml...</div>;

  const features = (config.features as Record<string, unknown>) ?? {};
  const mcpServers = (config.mcpServers as Record<string, unknown>) ?? {};
  const plugins = (config.plugins as Record<string, unknown>) ?? {};
  const projects = (config.projects as Record<string, unknown>) ?? {};
  const notify = (config.notify as unknown[]) ?? [];
  const modelProviders = (config.modelProviders as Record<string, unknown>) ?? {};
  const rootKeys = (config.rootKeys as Record<string, unknown>) ?? {};

  const tabs = [
    { id: "providers" as const, label: "供应商" },
    { id: "features" as const, label: "Features" },
    { id: "mcp" as const, label: "MCP Servers" },
    { id: "plugins" as const, label: "Plugins" },
    { id: "projects" as const, label: "Projects" },
    { id: "notify" as const, label: "Notify" },
    { id: "rootKeys" as const, label: "根级配置" },
    { id: "migration" as const, label: "版本迁移" },
    { id: "raw" as const, label: "原始 TOML" },
  ];

  const handleToggleFeature = async (key: string, current: boolean) => {
    await invoke("save_codex_feature", { key, value: !current });
    await actions.refreshCodexConfig(true);
  };

  const handleSaveRaw = async () => {
    const result = await invoke("save_codex_raw_toml", { rawToml: editingRaw });
    const r = result as { status: string; message: string };
    if (r.status === "ok") {
      await actions.refreshCodexConfig(true);
    }
    await actions.showMessage("保存 config.toml", r.message, r.status as "ok" | "error");
  };

  const handleDeleteMcpServer = async (serverId: string) => {
    const next = { ...mcpServers };
    delete next[serverId];
    await invoke("save_codex_mcp_servers", { servers: next });
    await actions.refreshCodexConfig(true);
  };

  const handleTogglePlugin = async (pluginId: string, currentEnabled: boolean) => {
    const next = { ...plugins };
    const plugin = next[pluginId] as Record<string, unknown>;
    next[pluginId] = { ...plugin, enabled: !currentEnabled };
    await invoke("save_codex_plugins", { plugins: next });
    await actions.refreshCodexConfig(true);
  };

  const handleDeleteProject = async (projectPath: string) => {
    const next = { ...projects };
    delete next[projectPath];
    await invoke("save_codex_projects", { projects: next });
    await actions.refreshCodexConfig(true);
  };

  // ── 供应商管理 ──
  const handleEditProvider = (id: string) => {
    setEditingProvider(id);
    const p = (modelProviders[id] as Record<string, unknown>) ?? {};
    setProviderDraft({
      name: (p.name as string) ?? id,
      wire_api: (p.wire_api as string) ?? "responses",
      base_url: (p.base_url as string) ?? "",
      experimental_bearer_token: (p.experimental_bearer_token as string) ?? "",
      requires_openai_auth: String(p.requires_openai_auth ?? true),
    });
  };

  const handleNewProvider = () => {
    setEditingProvider("__new__");
    setProviderDraft({
      name: "",
      wire_api: "responses",
      base_url: "",
      experimental_bearer_token: "",
      requires_openai_auth: "true",
    });
  };

  const handleSaveProvider = async () => {
    const id = editingProvider;
    if (!id) return;
    const next = { ...modelProviders };
    const providerId = id === "__new__" ? (providerDraft.name || "custom").toLowerCase().replace(/[^a-z0-9_-]/g, "") : id;
    next[providerId] = {
      name: providerDraft.name || providerId,
      wire_api: providerDraft.wire_api || "responses",
      requires_openai_auth: providerDraft.requires_openai_auth === "true",
      base_url: providerDraft.base_url,
      experimental_bearer_token: providerDraft.experimental_bearer_token,
    };
    await invoke("save_codex_model_providers", { providers: next });
    setEditingProvider(null);
    await actions.refreshCodexConfig(true);
  };

  const handleDeleteProvider = async (id: string) => {
    const next = { ...modelProviders };
    delete next[id];
    await invoke("save_codex_model_providers", { providers: next });
    await actions.refreshCodexConfig(true);
  };

  const handleSaveRootKeys = async (updates: Record<string, unknown>) => {
    await invoke("save_codex_root_keys", { keys: updates });
    await actions.refreshCodexConfig(true);
  };

  const handleLoadMigrationStatus = async () => {
    const result = await invoke("get_config_migration_status");
    const r = result as { status: string; payload: Record<string, unknown> };
    if (r.status === "ok") {
      setMigrationStatus(r.payload);
    }
  };

  const handleRunMigrations = async () => {
    const result = await invoke("run_config_migrations");
    const r = result as { status: string; message: string };
    await actions.showMessage("配置迁移", r.message, r.status as "ok" | "error");
    await handleLoadMigrationStatus();
    await actions.refreshCodexConfig(true);
  };

  const providerFieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
  const providerLabelStyle: React.CSSProperties = { fontSize: 12, opacity: 0.7 };
  const providerInputStyle: React.CSSProperties = { fontFamily: "monospace", fontSize: 13 };

  return (
    <>
      <Panel>
        <CardHead title="config.toml 配置管理" detail="管理 ~/.codex/config.toml 中的所有配置区块" />
        <CardContent>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {tabs.map((t) => (
              <Button
                key={t.id}
                variant={activeTab === t.id ? "default" : "outline"}
                onClick={() => {
                  setActiveTab(t.id);
                  if (t.id === "raw") setEditingRaw((config.rawToml as string) ?? "");
                }}
              >
                {t.label}
              </Button>
            ))}
          </div>

          {/* ── 供应商 Tab ── */}
          {activeTab === "providers" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>自定义 model_providers 配置（API 地址、Key、协议等）</p>

              {editingProvider !== null ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, borderRadius: 8, background: "var(--card)", marginBottom: 16 }}>
                  <strong>{editingProvider === "__new__" ? "新建供应商" : `编辑 ${editingProvider}`}</strong>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={providerFieldStyle}>
                      <label style={providerLabelStyle}>名称 (name)</label>
                      <Input style={providerInputStyle} value={providerDraft.name ?? ""} onChange={(e) => setProviderDraft({ ...providerDraft, name: e.target.value })} placeholder="my-provider" />
                    </div>
                    <div style={providerFieldStyle}>
                      <label style={providerLabelStyle}>协议 (wire_api)</label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button variant={providerDraft.wire_api === "responses" ? "default" : "outline"} onClick={() => setProviderDraft({ ...providerDraft, wire_api: "responses" })}>Responses</Button>
                        <Button variant={providerDraft.wire_api === "chat" ? "default" : "outline"} onClick={() => setProviderDraft({ ...providerDraft, wire_api: "chat" })}>Chat Completions</Button>
                      </div>
                    </div>
                    <div style={providerFieldStyle}>
                      <label style={providerLabelStyle}>Base URL</label>
                      <Input style={providerInputStyle} value={providerDraft.base_url ?? ""} onChange={(e) => setProviderDraft({ ...providerDraft, base_url: e.target.value })} placeholder="https://api.example.com/v1" />
                    </div>
                    <div style={providerFieldStyle}>
                      <label style={providerLabelStyle}>API Key (Bearer Token)</label>
                      <Input style={providerInputStyle} type="password" value={providerDraft.experimental_bearer_token ?? ""} onChange={(e) => setProviderDraft({ ...providerDraft, experimental_bearer_token: e.target.value })} placeholder="sk-..." />
                    </div>
                    <div style={providerFieldStyle}>
                      <label style={providerLabelStyle}>需要 OpenAI Auth</label>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button variant={providerDraft.requires_openai_auth === "true" ? "default" : "outline"} onClick={() => setProviderDraft({ ...providerDraft, requires_openai_auth: "true" })}>是</Button>
                        <Button variant={providerDraft.requires_openai_auth === "false" ? "default" : "outline"} onClick={() => setProviderDraft({ ...providerDraft, requires_openai_auth: "false" })}>否</Button>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button onClick={() => void handleSaveProvider()}>
                      <Save className="h-4 w-4" />
                      保存
                    </Button>
                    <Button variant="outline" onClick={() => setEditingProvider(null)}>取消</Button>
                  </div>
                </div>
              ) : null}

              {editingProvider === null ? (
                <div style={{ marginBottom: 12 }}>
                  <Button onClick={handleNewProvider}>
                    <Plus className="h-4 w-4" />
                    新建供应商
                  </Button>
                </div>
              ) : null}

              {Object.keys(modelProviders).length === 0 ? (
                <div className="empty">无 model_providers 配置</div>
              ) : (
                <div className="session-table-wrap">
                  <table className="session-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>名称</th>
                        <th>协议</th>
                        <th>Base URL</th>
                        <th>API Key</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(modelProviders).map(([id, cfg]) => {
                        const c = cfg as Record<string, unknown>;
                        const key = (c.experimental_bearer_token as string) ?? "";
                        const maskedKey = key.length > 8 ? key.slice(0, 4) + "****" + key.slice(-4) : key ? "****" : "-";
                        return (
                          <tr key={id}>
                            <td><code>{id}</code></td>
                            <td>{(c.name as string) ?? "-"}</td>
                            <td><code>{(c.wire_api as string) ?? "-"}</code></td>
                            <td><code style={{ fontSize: 11 }}>{(c.base_url as string) ?? "-"}</code></td>
                            <td><code style={{ fontSize: 11 }}>{maskedKey}</code></td>
                            <td>
                              <div style={{ display: "flex", gap: 4 }}>
                                <Button variant="outline" onClick={() => void handleEditProvider(id)}>
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" onClick={() => void handleDeleteProvider(id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {/* ── Features Tab ── */}
          {activeTab === "features" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>功能开关：点击切换启用/禁用</p>
              {Object.keys(features).length === 0 ? (
                <div className="empty">无 features 配置</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.entries(features).map(([key, value]) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, background: "var(--card)" }}>
                      <code style={{ minWidth: 160 }}>{key}</code>
                      <Button
                        variant={value ? "default" : "outline"}
                        onClick={() => void handleToggleFeature(key, value as boolean)}
                      >
                        {value ? "已启用 ✓" : "已禁用"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* ── MCP Servers Tab ── */}
          {activeTab === "mcp" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>MCP 工具服务器配置</p>
              {Object.keys(mcpServers).length === 0 ? (
                <div className="empty">无 MCP servers 配置</div>
              ) : (
                <div className="session-table-wrap">
                  <table className="session-table">
                    <thead>
                      <tr>
                        <th>Server ID</th>
                        <th>Command</th>
                        <th>Args</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(mcpServers).map(([id, cfg]) => {
                        const c = cfg as Record<string, unknown>;
                        return (
                          <tr key={id}>
                            <td><code>{id}</code></td>
                            <td><code style={{ fontSize: 12 }}>{(c.command as string) ?? "-"}</code></td>
                            <td><code style={{ fontSize: 12 }}>{Array.isArray(c.args) ? c.args.join(" ") : "-"}</code></td>
                            <td>
                              <Button variant="outline" onClick={() => void handleDeleteMcpServer(id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {/* ── Plugins Tab ── */}
          {activeTab === "plugins" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>插件开关管理</p>
              {Object.keys(plugins).length === 0 ? (
                <div className="empty">无 plugins 配置</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.entries(plugins).map(([id, cfg]) => {
                    const c = cfg as Record<string, unknown>;
                    const enabled = c.enabled === true;
                    return (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, background: "var(--card)" }}>
                        <code style={{ flex: 1 }}>{id}</code>
                        <Button
                          variant={enabled ? "default" : "outline"}
                          onClick={() => void handleTogglePlugin(id, enabled)}
                        >
                          {enabled ? "已启用 ✓" : "已禁用"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {/* ── Projects Tab ── */}
          {activeTab === "projects" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>项目信任级别配置</p>
              {Object.keys(projects).length === 0 ? (
                <div className="empty">无 projects 配置</div>
              ) : (
                <div className="session-table-wrap">
                  <table className="session-table">
                    <thead>
                      <tr>
                        <th>项目路径</th>
                        <th>Trust Level</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(projects).map(([path, cfg]) => {
                        const c = cfg as Record<string, unknown>;
                        return (
                          <tr key={path}>
                            <td><code style={{ fontSize: 12 }}>{path}</code></td>
                            <td>{(c.trust_level as string) ?? "-"}</td>
                            <td>
                              <Button variant="outline" onClick={() => void handleDeleteProject(path)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {/* ── Notify Tab ── */}
          {activeTab === "notify" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>通知命令配置</p>
              {notify.length === 0 ? (
                <div className="empty">无 notify 配置</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {notify.map((item, i) => (
                    <div key={i} style={{ padding: "8px 12px", borderRadius: 8, background: "var(--card)" }}>
                      <code>{String(item)}</code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* ── 根级配置 Tab ── */}
          {activeTab === "rootKeys" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>config.toml 根级键值对（model、model_provider 等）</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {Object.entries(rootKeys).map(([key, value]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 8, background: "var(--card)" }}>
                    <code style={{ minWidth: 200 }}>{key}</code>
                    <Input
                      style={{ flex: 1, fontFamily: "monospace", fontSize: 13 }}
                      defaultValue={String(value ?? "")}
                      onBlur={(e) => {
                        const v = e.target.value;
                        const updates: Record<string, unknown> = {};
                        updates[key] = v === "" ? null : v;
                        void handleSaveRootKeys(updates);
                      }}
                    />
                    <Button variant="outline" onClick={() => void handleSaveRootKeys({ [key]: null })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {Object.keys(rootKeys).length === 0 ? <div className="empty">无根级配置</div> : null}
              </div>
            </div>
          ) : null}

          {/* ── 版本迁移 Tab ── */}
          {activeTab === "migration" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>管理配置文件的版本迁移，确保数据格式兼容性</p>

              <div style={{ marginBottom: 16 }}>
                <Button onClick={() => void handleLoadMigrationStatus()}>
                  <RefreshCw className="h-4 w-4" />
                  检查迁移状态
                </Button>
              </div>

              {migrationStatus ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                    <div style={{ padding: 16, borderRadius: 8, background: "var(--card)" }}>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>当前版本</div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>
                        v{String(migrationStatus.currentVersion ?? 0)}
                      </div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 8, background: "var(--card)" }}>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>最新版本</div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>
                        v{String(migrationStatus.latestVersion ?? 0)}
                      </div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 8, background: "var(--card)" }}>
                      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>状态</div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: migrationStatus.hasPending ? "var(--accent)" : "var(--green)" }}>
                        {migrationStatus.hasPending ? "有待执行的迁移" : "已是最新版本"}
                      </div>
                    </div>
                  </div>

                  {migrationStatus.hasPending ? (
                    <div style={{ padding: 16, borderRadius: 8, background: "var(--card)" }}>
                      <div style={{ marginBottom: 8, fontWeight: 600 }}>待执行的迁移</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        {(migrationStatus.pendingVersions as number[] ?? []).map((v) => (
                          <span key={v} style={{ padding: "4px 12px", borderRadius: 4, background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600 }}>
                            v{v} → v{v + 1}
                          </span>
                        ))}
                      </div>
                      <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
                        迁移过程会自动备份当前配置，数据和键不会丢失。
                      </p>
                      <Button onClick={() => void handleRunMigrations()}>
                        <Play className="h-4 w-4" />
                        执行迁移
                      </Button>
                    </div>
                  ) : (
                    <div style={{ padding: 16, borderRadius: 8, background: "var(--card)", textAlign: "center", opacity: 0.7 }}>
                      配置文件已是最新版本，无需迁移。
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty">点击"检查迁移状态"查看当前配置版本信息</div>
              )}
            </div>
          ) : null}

          {/* ── 原始 TOML Tab ── */}
          {activeTab === "raw" ? (
            <div>
              <p style={{ marginBottom: 12, opacity: 0.7 }}>直接编辑 config.toml 原始文本</p>
              <Textarea
                value={editingRaw}
                onChange={(e) => setEditingRaw(e.target.value)}
                style={{ fontFamily: "monospace", fontSize: 13, minHeight: 400 }}
              />
              <Toolbar>
                <Button onClick={() => void handleSaveRaw()}>
                  <Save className="h-4 w-4" />
                  保存
                </Button>
                <Button variant="outline" onClick={() => void actions.refreshCodexConfig()}>
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </Button>
              </Toolbar>
            </div>
          ) : null}
        </CardContent>
      </Panel>
    </>
  );
}

function routeTitle(route: Route) {
  return routes.find((item) => item.id === route)?.label ?? "概览";
}

function routeSubtitle(route: Route) {
  const subtitles: Record<Route, string> = {
    overview: "检查问题、启动与快速修复",
    relay: "管理 API 供应商、协议、Key 与配置文件",
    sessions: "查看、删除和修复 Codex 本地会话",
    context: "独立管理 MCP、Skills、Plugins",
    enhance: "会话删除、导出、项目移动和脚本能力",
    userScripts: "内置和用户自定义脚本清单",
    proxyStats: "Token 用量、费用估算与缓存命中率",
    processes: "查看和管理 Codex 相关进程、端口冲突检测",
    configEditor: "features、MCP servers、plugins、projects 等配置管理",
    maintenance: "入口安装、修复、Watcher 与手动启动",
    about: "版本信息、项目链接、GitHub Release 更新、日志与诊断",
    settings: "主题、命令包装器和启动参数",
  };
  return subtitles[route];
}

const contextKindOptions: Array<{ kind: ContextKind; label: string; tableName: string }> = [
  { kind: "mcp", label: "MCP", tableName: "mcp_servers" },
  { kind: "skill", label: "Skills", tableName: "skills" },
  { kind: "plugin", label: "插件", tableName: "plugins" },
];

function contextKindLabel(kind: ContextKind) {
  return contextKindOptions.find((option) => option.kind === kind)?.label ?? "扩展项";
}

function contextEntriesFromSettings(settings: BackendSettings): CodexContextEntries {
  const commonConfig = normalizeDuplicateTomlTables(settings.relayContextConfigContents || "");
  return {
    mcpServers: parseContextEntries(commonConfig, "mcp", "mcp_servers"),
    skills: parseContextEntries(commonConfig, "skill", "skills"),
    plugins: parseContextEntries(commonConfig, "plugin", "plugins"),
  };
}

function contextEntriesWithLiveEntries(settings: BackendSettings, liveEntries: CodexContextEntries | null): CodexContextEntries {
  const commonEntries = contextEntriesFromSettings(settings);
  if (!liveEntries) return commonEntries;
  const liveByKind: Record<ContextKind, Map<string, CodexContextEntry>> = {
    mcp: new Map(liveEntries.mcpServers.map((entry) => [entry.id, entry])),
    skill: new Map(liveEntries.skills.map((entry) => [entry.id, entry])),
    plugin: new Map(liveEntries.plugins.map((entry) => [entry.id, entry])),
  };
  return {
    mcpServers: mergeLiveContextEntries(commonEntries.mcpServers, liveByKind.mcp),
    skills: mergeLiveContextEntries(commonEntries.skills, liveByKind.skill),
    plugins: mergeLiveContextEntries(commonEntries.plugins, liveByKind.plugin),
  };
}

function mergeLiveContextEntries(entries: CodexContextEntry[], liveEntries: Map<string, CodexContextEntry>): CodexContextEntry[] {
  const uniqueEntries = dedupeContextEntryList(entries);
  const merged = uniqueEntries.map((entry) => {
    const live = liveEntries.get(entry.id);
    return withLiveEntryState(entry, live);
  });
  const knownIds = new Set(uniqueEntries.map((entry) => entry.id));
  for (const liveEntry of liveEntries.values()) {
    if (!knownIds.has(liveEntry.id)) merged.push(liveEntry);
  }
  return merged;
}

function withLiveEntryState(entry: CodexContextEntry, live?: CodexContextEntry): CodexContextEntry {
  return live ? { ...entry, enabled: live.enabled } : { ...entry, enabled: false };
}

function contextEntriesForProfile(settings: BackendSettings, _profile: RelayProfile): CodexContextEntries {
  return contextEntriesFromSettings(settings);
}

function contextEntriesFromConfig(configContents: string): CodexContextEntries {
  return {
    mcpServers: parseContextEntries(configContents, "mcp", "mcp_servers"),
    skills: parseContextEntries(configContents, "skill", "skills"),
    plugins: parseContextEntries(configContents, "plugin", "plugins"),
  };
}

function mergeContextEntries(primary: CodexContextEntries, secondary: CodexContextEntries): CodexContextEntries {
  return {
    mcpServers: mergeContextEntryList(primary.mcpServers, secondary.mcpServers),
    skills: mergeContextEntryList(primary.skills, secondary.skills),
    plugins: mergeContextEntryList(primary.plugins, secondary.plugins),
  };
}

function mergeContextEntryList(primary: CodexContextEntry[], secondary: CodexContextEntry[]): CodexContextEntry[] {
  return dedupeContextEntryList([...primary, ...secondary]);
}

function dedupeContextEntryList(entries: CodexContextEntry[]): CodexContextEntry[] {
  const byId = new Map<string, CodexContextEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values());
}

function parseContextEntries(commonConfig: string, kind: ContextKind, tableName: string): CodexContextEntry[] {
  const anyHeaderPattern = /^\s*\[[^\]]+\]\s*$/;
  const entries = new Map<string, CodexContextEntry>();
  let currentId: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (!currentId) return;
    const tomlBody = ensureTrailingNewline(body.join("\n").trimEnd());
    entries.set(currentId, {
      id: currentId,
      kind,
      title: currentId,
      summary: contextEntrySummary(tomlBody),
      tomlBody,
      enabled: contextEntryEnabled(tomlBody),
    });
  };

  for (const line of commonConfig.split(/\r?\n/)) {
    const path = tomlTablePathFromLine(line);
    if (path?.[0] === tableName && path.length >= 2) {
      const id = path[1];
      if (currentId === id && path.length > 2) {
        body.push(`[${path.slice(2).map(tomlKey).join(".")}]`);
        continue;
      }
      flush();
      currentId = id;
      body = [];
      continue;
    }
    if (currentId && anyHeaderPattern.test(line)) {
      flush();
      currentId = null;
      body = [];
      continue;
    }
    if (currentId) body.push(line);
  }
  flush();

  return Array.from(entries.values());
}

function tomlTablePathFromLine(line: string): string[] | null {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  if (!match) return null;
  return parseTomlDottedPath(match[1].trim());
}

function parseTomlDottedPath(path: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of path) {
    if (quote) {
      if (quote === '"' && escaping) {
        current += char;
        escaping = false;
      } else if (quote === '"' && char === "\\") {
        escaping = true;
      } else if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ".") {
      if (!current.trim()) return null;
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (quote || escaping || !current.trim()) return null;
  parts.push(current.trim());
  return parts;
}

function contextEntrySummary(tomlBody: string) {
  return tomlBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !/^enabled\s*=/.test(line))
    ?.slice(0, 96) ?? "";
}

function contextEntryEnabled(tomlBody: string) {
  return !tomlBody.split(/\r?\n/).some((line) => /^\s*enabled\s*=\s*false\s*(#.*)?$/i.test(line));
}

function setContextEntryEnabled(tomlBody: string, enabled: boolean) {
  const lines = tomlBody.trimEnd().split(/\r?\n/);
  const nextValue = `enabled = ${enabled ? "true" : "false"}`;
  let replaced = false;
  const next = lines.map((line) => {
    if (/^\s*enabled\s*=/.test(line)) {
      replaced = true;
      return nextValue;
    }
    return line;
  });
  if (!replaced) next.unshift(nextValue);
  return ensureTrailingNewline(next.join("\n").trimEnd());
}

function ensureTrailingNewline(value: string) {
  return value.trim() ? `${value}\n` : "";
}

function unquoteTomlKey(key: string) {
  if (key.length >= 2 && ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))) {
    return key.slice(1, -1);
  }
  return key;
}

function contextEntriesByKind(entries: CodexContextEntries, kind: ContextKind): CodexContextEntry[] {
  if (kind === "mcp") return dedupeContextEntryList(entries.mcpServers);
  if (kind === "skill") return dedupeContextEntryList(entries.skills);
  return dedupeContextEntryList(entries.plugins);
}

function configHasCodexGoalsFeature(configContents: string): boolean {
  let inFeatures = false;
  for (const line of configContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[features\]$/.test(trimmed)) {
      inFeatures = true;
      continue;
    }
    if (inFeatures && /^\[[^\]]+\]$/.test(trimmed)) {
      inFeatures = false;
    }
    if (inFeatures && /^goals\s*=\s*true\b/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function setCodexGoalsFeatureInConfig(configContents: string, enabled: boolean): string {
  const lines = configContents.split(/\r?\n/);
  const next: string[] = [];
  let inFeatures = false;
  let sawFeatures = false;
  let featuresHasGoals = false;

  const maybeInsertGoals = () => {
    if (enabled && sawFeatures && !featuresHasGoals) {
      next.push("goals = true");
      featuresHasGoals = true;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[features\]$/.test(trimmed)) {
      if (inFeatures) maybeInsertGoals();
      inFeatures = true;
      sawFeatures = true;
      featuresHasGoals = false;
      next.push(line);
      continue;
    }
    if (inFeatures && /^\[[^\]]+\]$/.test(trimmed)) {
      maybeInsertGoals();
      inFeatures = false;
    }
    if (inFeatures && /^goals\s*=/.test(trimmed)) {
      if (enabled && !featuresHasGoals) {
        next.push("goals = true");
        featuresHasGoals = true;
      }
      continue;
    }
    next.push(line);
  }

  if (inFeatures) maybeInsertGoals();
  if (enabled && !sawFeatures) {
    const trimmed = ensureTrailingNewline(next.join("\n").trimEnd());
    return joinTomlSections([trimmed, "[features]\ngoals = true"]);
  }

  return ensureTrailingNewline(next.join("\n").trimEnd());
}

function effectiveRelayConfigPreview(profile: RelayProfile, settings: BackendSettings, contextProfile = profile): string {
  const entries = contextEntriesForProfile(settings, contextProfile);
  const isolatedConfig = stripContextEntriesFromConfig(profile.configContents, entries);
  const configWithLimits = applyContextLimitPreview(isolatedConfig, profile);
  return joinTomlSectionsRootFirst([configWithLimits, settings.relayCommonConfigContents || "", selectedContextConfigToml(entries)]);
}

function selectedContextConfigToml(entries: CodexContextEntries): string {
  const sections: string[] = [];
  for (const option of contextKindOptions) {
    for (const entry of dedupeContextEntryList(contextEntriesByKind(entries, option.kind))) {
      if (!entry.enabled) continue;
      sections.push(contextEntryToTomlSection(option.tableName, entry));
    }
  }
  return ensureTrailingNewline(sections.join("\n\n"));
}

function allContextConfigToml(entries: CodexContextEntries): string {
  const sections: string[] = [];
  for (const option of contextKindOptions) {
    for (const entry of dedupeContextEntryList(contextEntriesByKind(entries, option.kind))) {
      sections.push(contextEntryToTomlSection(option.tableName, entry));
    }
  }
  return ensureTrailingNewline(sections.join("\n\n"));
}

function contextEntryToTomlSection(tableName: string, entry: CodexContextEntry): string {
  const parentHeader = `[${tableName}.${tomlKey(entry.id)}]`;
  const body = entry.tomlBody
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => relativeContextSubtableToAbsolute(line, tableName, entry.id))
    .join("\n");
  return `${parentHeader}\n${body}`;
}

function relativeContextSubtableToAbsolute(line: string, tableName: string, id: string): string {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  if (!match) return line;
  const subtable = match[1].trim();
  if (!subtable || subtable.includes(".")) return line;
  return `[${tableName}.${tomlKey(id)}.${tomlKey(subtable)}]`;
}

function syncLiveConfigContextState(liveConfigContents: string, settings: BackendSettings): string {
  const entries = contextEntriesFromSettings(settings);
  const withoutContext = stripAllContextEntriesFromConfig(liveConfigContents);
  return joinTomlSectionsRootFirst([withoutContext, selectedContextConfigToml(entries)]);
}

function relayCombinedCommonConfig(settings: BackendSettings): string {
  return joinTomlSectionsRootFirst([settings.relayCommonConfigContents || "", settings.relayContextConfigContents || ""]);
}

function splitContextConfigText(configContents: string): { common: string; context: string } {
  const entries = contextEntriesFromConfig(configContents);
  return {
    common: stripContextEntriesFromConfig(configContents, entries),
    context: allContextConfigToml(entries),
  };
}

function stripContextEntriesFromConfig(configContents: string, entries: CodexContextEntries): string {
  const knownIds: Record<ContextKind, Set<string>> = {
    mcp: new Set(entries.mcpServers.map((entry) => entry.id)),
    skill: new Set(entries.skills.map((entry) => entry.id)),
    plugin: new Set(entries.plugins.map((entry) => entry.id)),
  };
  const lines = configContents.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const contextHeader = contextHeaderFromLine(line);
    if (contextHeader) {
      skipping = knownIds[contextHeader.kind].has(contextHeader.id);
    } else if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }

  return ensureTrailingNewline(kept.join("\n").trimEnd());
}

function stripAllContextEntriesFromConfig(configContents: string): string {
  const lines = configContents.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const contextHeader = contextHeaderFromLine(line);
    if (contextHeader) {
      skipping = true;
    } else if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }

  return ensureTrailingNewline(kept.join("\n").trimEnd());
}

function stripCommonConfigTextFallback(configContents: string, commonConfig: string): string {
  const anchors = commonConfigAnchors(commonConfig);
  if (!anchors.rootKeys.size && !anchors.tableHeaders.size) return ensureTrailingNewline(configContents.trimEnd());

  const kept: string[] = [];
  let skippingTable = false;

  for (const line of configContents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      skippingTable = anchors.tableHeaders.has(trimmed);
      if (skippingTable) continue;
    }
    if (skippingTable) continue;
    const key = tomlRootKeyFromLine(trimmed);
    if (key && anchors.rootKeys.has(key)) continue;
    kept.push(line);
  }

  return ensureTrailingNewline(kept.join("\n").trimEnd());
}

function commonConfigAnchors(commonConfig: string): { rootKeys: Set<string>; tableHeaders: Set<string> } {
  const rootKeys = new Set<string>();
  const tableHeaders = new Set<string>();
  let inRoot = true;

  for (const line of commonConfig.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+]$/.test(trimmed)) {
      inRoot = false;
      tableHeaders.add(trimmed);
      continue;
    }
    if (inRoot) {
      const key = tomlRootKeyFromLine(trimmed);
      if (key) rootKeys.add(key);
    }
  }

  return { rootKeys, tableHeaders };
}

function tomlRootKeyFromLine(line: string): string | null {
  if (!line || line.startsWith("#")) return null;
  const index = line.indexOf("=");
  if (index < 0) return null;
  const key = line.slice(0, index).trim();
  return key || null;
}

function contextHeaderFromLine(line: string): { kind: ContextKind; id: string } | null {
  const path = tomlTablePathFromLine(line);
  if (!path || path.length !== 2) return null;
  const option = contextKindOptions.find((item) => item.tableName === path[0]);
  return option ? { kind: option.kind, id: path[1] } : null;
}

function applyContextLimitPreview(configContents: string, profile: RelayProfile): string {
  const replacements: Array<[string, string]> = [
    ["model_context_window", profile.contextWindow],
    ["model_auto_compact_token_limit", profile.autoCompactLimit],
  ];
  let lines = configContents.split(/\r?\n/);

  for (const [key, value] of replacements) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    let replaced = false;
    lines = lines.map((line) => {
      if (!replaced && new RegExp(`^\\s*${key}\\s*=`).test(line)) {
        replaced = true;
        return `${key} = ${trimmed}`;
      }
      return line;
    });
    if (!replaced) {
      const firstTable = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
      const insertAt = firstTable >= 0 ? firstTable : lines.length;
      lines.splice(insertAt, 0, `${key} = ${trimmed}`);
    }
  }

  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function removeRootTomlKey(contents: string, key: string): string {
  const lines: string[] = [];
  let inRoot = true;
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) inRoot = false;
    if (inRoot && new RegExp(`^\\s*${key}\\s*=`).test(line)) continue;
    lines.push(line);
  }
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function joinTomlSections(sections: string[]): string {
  return ensureTrailingNewline(
    sections
      .map((section) => section.trim())
      .filter(Boolean)
      .join("\n\n"),
  );
}

function joinTomlSectionsRootFirst(sections: string[]): string {
  const rootParts: string[] = [];
  const tableParts: string[] = [];

  for (const section of sections) {
    const { root, tables } = splitTomlRootAndTables(section);
    if (root.trim()) rootParts.push(root.trim());
    if (tables.trim()) tableParts.push(tables.trim());
  }

  return normalizeDuplicateTomlTables(joinTomlSections([...dedupeTomlRootLines(rootParts), ...tableParts]));
}

function normalizeDuplicateTomlTables(contents: string): string {
  const seenHeaders = new Set<string>();
  const kept: string[] = [];
  let skipping = false;

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      skipping = seenHeaders.has(trimmed);
      seenHeaders.add(trimmed);
      if (skipping) continue;
    }
    if (!skipping) kept.push(line);
  }

  return ensureTrailingNewline(kept.join("\n").trimEnd());
}

function dedupeTomlRootLines(rootParts: string[]): string[] {
  const rootLines = rootParts
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const rootSeen = new Set<string>();
  const kept: string[] = [];

  for (let index = rootLines.length - 1; index >= 0; index -= 1) {
    const line = rootLines[index];
    const key = tomlRootKeyFromLine(line.trim());
    if (key) {
      if (rootSeen.has(key)) continue;
      rootSeen.add(key);
    }
    kept.push(line);
  }

  const normalized = kept.reverse().join("\n").trim();
  return normalized ? [normalized] : [];
}

function splitTomlRootAndTables(section: string): { root: string; tables: string } {
  const lines = section.trim().split(/\r?\n/);
  const firstTable = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
  if (firstTable < 0) return { root: lines.join("\n"), tables: "" };
  return {
    root: lines.slice(0, firstTable).join("\n"),
    tables: lines.slice(firstTable).join("\n"),
  };
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : `"${tomlString(key)}"`;
}

function contextSelectionIds(selection: RelayContextSelection, kind: ContextKind): string[] {
  if (kind === "mcp") return selection.mcpServers;
  if (kind === "skill") return selection.skills;
  return selection.plugins;
}

function setContextSelectionId(selection: RelayContextSelection, kind: ContextKind, id: string, checked: boolean): RelayContextSelection {
  const next = {
    mcpServers: [...selection.mcpServers],
    skills: [...selection.skills],
    plugins: [...selection.plugins],
  };
  const list = contextSelectionIds(next, kind);
  const normalizedId = id.trim();
  const exists = list.includes(normalizedId);
  if (checked && normalizedId && !exists) list.push(normalizedId);
  if (!checked && exists) list.splice(list.indexOf(normalizedId), 1);
  return next;
}

function removeContextSelectionFromSettings(settings: BackendSettings, kind: ContextKind, id: string): BackendSettings {
  return {
    ...settings,
    relayProfiles: settings.relayProfiles.map((profile) => ({
      ...profile,
      contextSelection: setContextSelectionId(profile.contextSelection, kind, id, false),
    })),
  };
}

function contextSelectionForAllEntries(settings: BackendSettings): RelayContextSelection {
  const entries = contextEntriesFromSettings(settings);
  return {
    mcpServers: entries.mcpServers.map((entry) => entry.id),
    skills: entries.skills.map((entry) => entry.id),
    plugins: entries.plugins.map((entry) => entry.id),
  };
}

function relayProfileSourceLabel(profile: RelayProfile) {
  return profile.linkedCcsProviderId ? "cc-switch 联动" : "本地";
}

function relayProfileEditorStatus(profile: RelayProfile, form: BackendSettings, isNew: boolean) {
  if (isNew) return "新建供应商需要先保存到列表";
  if (!form.relayProfilesEnabled) return "供应商配置总开关已关闭；当前只保存配置，不写入 Codex live 文件";
  if (profile.linkedCcsProviderId && form.ccsLinkEnabled) return "联动 cc-switch；保存后会回写外部供应商数据库";
  if (profile.linkedCcsProviderId) return "联动 cc-switch；当前未开启保存回写";
  return profile.id === form.activeRelayId ? "当前正在使用" : "编辑后保存列表，再切换模式时会使用新配置";
}

function providerInitial(name: string) {
  const trimmed = (name || "供应商").trim();
  return Array.from(trimmed)[0]?.toUpperCase() || "供";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    found: "已找到",
    missing: "缺失",
    installed: "已安装",
    ok: "正常",
    running: "运行中",
    failed: "失败",
    archived: "已归档",
    accepted: "已受理",
    not_checked: "未检查",
    not_implemented: "未实现",
    disabled: "已禁用",
    unknown: "未知",
  };
  return labels[status] ?? status;
}

function statusClass(status: string) {
  if (["found", "installed", "ok", "running"].includes(status)) return "good";
  if (["failed", "missing"].includes(status)) return "bad";
  return "warn";
}

function isSuccessStatus(status?: Status) {
  return status === "ok" || status === "accepted";
}

function healthItems(overview: OverviewResult | null) {
  return [
    {
      title: "Codex 应用",
      status: overview?.codex_app.status ?? "not_checked",
      ok: overview?.codex_app.status === "found",
      detail: overview?.codex_app.path || "尚未检查 Codex 应用路径。",
    },
    {
      title: "静默启动入口",
      status: overview?.silent_shortcut.status ?? "not_checked",
      ok: overview?.silent_shortcut.status === "installed",
      detail: overview?.silent_shortcut.path || "缺少 Ucodex 静默启动快捷方式时可在安装维护页修复。",
    },
    {
      title: "管理工具入口",
      status: overview?.management_shortcut.status ?? "not_checked",
      ok: overview?.management_shortcut.status === "installed",
      detail: overview?.management_shortcut.path || "缺少管理工具快捷方式时可在安装维护页修复。",
    },
  ];
}

function normalizeSettings(settings: BackendSettings): BackendSettings {
  const splitCommon = splitContextConfigText(settings.relayCommonConfigContents || "");
  const relayCommonConfigContents = splitCommon.common;
  const relayContextConfigContents = joinTomlSectionsRootFirst([
    settings.relayContextConfigContents || "",
    splitCommon.context,
  ]);
  const defaultContextSelection = contextSelectionForAllEntries({
    ...settings,
    relayCommonConfigContents,
    relayContextConfigContents,
  });
  const profiles =
    settings.relayProfiles?.length
      ? settings.relayProfiles.map((profile) => normalizeRelayProfile(profile, defaultContextSelection))
      : [
          {
            id: settings.activeRelayId || "default",
            linkedCcsProviderId: "",
            name: "默认中转",
            model: "",
            baseUrl: settings.relayBaseUrl || defaultSettings.relayBaseUrl,
            upstreamBaseUrl: settings.relayBaseUrl || defaultSettings.relayBaseUrl,
            apiKey: settings.relayApiKey || "",
            protocol: "responses" as RelayProtocol,
            relayMode: "official" as RelayMode,
            officialMixApiKey: false,
            testModel: "",
            configContents: "",
            authContents: "",
            useCommonConfig: true,
            contextSelection: defaultContextSelection,
            contextSelectionInitialized: true,
            contextWindow: "",
            autoCompactLimit: "",
            modelList: "",
            userAgent: "",
          },
        ];
  const activeRelayId = profiles.some((profile) => profile.id === settings.activeRelayId)
    ? settings.activeRelayId
    : profiles[0]?.id || "default";
  return syncLegacyRelayFields({
    ...defaultSettings,
    ...settings,
    relayProfilesEnabled: settings.relayProfilesEnabled !== false,
    ccsLinkEnabled: settings.ccsLinkEnabled === true,
    relayCommonConfigContents,
    relayContextConfigContents,
    relayProfiles: profiles,
    activeRelayId,
  });
}

function codexExtraArgsToInput(args: string[] | undefined) {
  return (args ?? []).join("\n");
}

function inputToCodexExtraArgs(value: string) {
  return value === "" ? [] : value.split(/\r?\n/);
}

function normalizeRelayProfile(profile: RelayProfile, defaultContextSelection = emptyContextSelection()): RelayProfile {
  const legacyMixedApi = profile.relayMode === "mixedApi";
  let normalized: RelayProfile = {
    ...profile,
    linkedCcsProviderId: profile.linkedCcsProviderId || "",
    model: profile.model || "",
    baseUrl: profile.baseUrl || defaultSettings.relayBaseUrl,
    upstreamBaseUrl: profile.upstreamBaseUrl || profile.baseUrl || "",
    apiKey: profile.apiKey || "",
    protocol: profile.protocol === "chatCompletions" ? "chatCompletions" : "responses",
    relayMode: normalizeRelayMode(profile.relayMode),
    officialMixApiKey: profile.officialMixApiKey === true || legacyMixedApi,
    testModel: profile.testModel || "",
    configContents: profile.configContents || "",
    authContents: profile.authContents || "",
    useCommonConfig: profile.useCommonConfig !== false,
    contextSelection: profile.contextSelectionInitialized
      ? normalizeContextSelection(profile.contextSelection)
      : normalizeContextSelection(undefined, defaultContextSelection),
    contextSelectionInitialized: true,
    contextWindow: profile.contextWindow || "",
    autoCompactLimit: profile.autoCompactLimit || "",
    modelList: profile.modelList || "",
    userAgent: profile.userAgent || "",
  };
  return deriveRelayProfileFromFiles(normalized);
}

function activeRelayProfile(settings: BackendSettings): RelayProfile {
  return (
    settings.relayProfiles.find((profile) => profile.id === settings.activeRelayId) ||
    settings.relayProfiles[0] ||
    defaultSettings.relayProfiles[0]
  );
}

function relayProtocolLabel(protocol: RelayProtocol): string {
  return protocol === "chatCompletions" ? "Chat Completions 转 Responses" : "Responses API";
}

function normalizeRelayMode(mode: RelayMode | undefined): RelayMode {
  if (mode === "pureApi") return mode;
  return "official";
}

function normalizeContextSelection(
  selection?: Partial<RelayContextSelection>,
  fallback: RelayContextSelection = emptyContextSelection(),
): RelayContextSelection {
  if (!selection) {
    return {
      mcpServers: [...fallback.mcpServers],
      skills: [...fallback.skills],
      plugins: [...fallback.plugins],
    };
  }
  return {
    mcpServers: Array.isArray(selection?.mcpServers) ? selection.mcpServers.map(String) : [],
    skills: Array.isArray(selection?.skills) ? selection.skills.map(String) : [],
    plugins: Array.isArray(selection?.plugins) ? selection.plugins.map(String) : [],
  };
}

function relayModeLabel(mode: RelayMode): string {
  if (mode === "pureApi") return "纯 API";
  return "官方登录";
}

function relayProfileConfigBrief(profile: RelayProfile): string {
  if (profile.relayMode === "official") return profile.officialMixApiKey ? "混入 API Key" : "不写 API 文件";
  return profile.baseUrl || "未填写 URL";
}

function relayProfileModeHelp(profile: RelayProfile): string {
  if (profile.relayMode === "official") {
    if (profile.officialMixApiKey) {
      return "此供应商会保留官方登录模式，并把请求混入当前 API Key；页面增强仍使用兼容模式。";
    }
    return "此供应商会切回官方登录模式，使用 ChatGPT 官方账号，不写入 API Key。";
  }
  if (profile.relayMode === "pureApi") {
    return "此供应商会同时写入 config.toml 和 auth.json；API Key 也会注入到 provider bearer token。";
  }
  return "此供应商会保留官方登录模式，并把请求混入当前 API Key；页面增强仍使用兼容模式。";
}

function relayProfileReadinessText(profile: RelayProfile, relay: RelayResult | null): string {
  if (profile.relayMode === "official") {
    if (profile.officialMixApiKey) {
      const hasApiFields = profile.baseUrl.trim() && profile.apiKey.trim();
      if (!relay?.authenticated && !hasApiFields) return "当前未登录官方账号，也未配置混入 API 的 Base URL / Key。";
      if (!relay?.authenticated) return "当前未登录官方账号；官方登录混入 API Key 需要先登录官方账号。";
      if (!hasApiFields) return "当前还没有填写混入 API 的 Base URL / Key。";
      return `官方登录已就绪：${relay.accountLabel || "已登录"}，会混入当前 API Key。`;
    }
    return relay?.authenticated
      ? `官方账号已登录：${relay.accountLabel || relay.authSource || "已检测"}。`
      : "当前未登录官方账号；切到官方登录模式后仍需要先在 Codex/ChatGPT 登录。";
  }
  const hasFiles = profile.configContents.trim() && profile.authContents.trim();
  if (!hasFiles) return "当前供应商还没有完整 config.toml / API Key 存档。";
  if (relay && !relay.configured) return "纯 API 配置未完整写入：请检查此供应商是否有 OPENAI_API_KEY，且 config.toml 是否包含 model_provider / provider / base_url。";
  return "纯 API 就绪：会同时写入 config.toml 和 auth.json。";
}

function relayProfileSwitchCommand(profile: RelayProfile): "clear_relay_injection" | "apply_relay_injection" | "apply_pure_api_injection" {
  if (profile.relayMode === "pureApi") return "apply_pure_api_injection";
  if (profile.relayMode === "official" && !profile.officialMixApiKey) return "clear_relay_injection";
  if (profile.configContents.trim()) return "apply_relay_injection";
  return profile.officialMixApiKey ? "apply_relay_injection" : "clear_relay_injection";
}

function relayProfileModeSwitchedText(profile: RelayProfile): string {
  if (profile.relayMode === "pureApi") return "已按此供应商切换到纯 API；页面增强已设为完整增强。";
  if (profile.officialMixApiKey) return "已按此供应商使用官方登录，并混入 API Key；页面增强已设为兼容增强。";
  return "已按此供应商切回官方登录；页面增强已设为兼容增强。";
}

function withGeneratedRelayFiles(profile: RelayProfile): RelayProfile {
  if (profile.relayMode === "official") {
    return {
      ...profile,
      configContents: profile.officialMixApiKey ? buildRelayConfigToml(profile, { includeBearerToken: true }) : "",
      authContents: profile.authContents || "",
    };
  }
  return {
    ...profile,
    configContents: buildRelayConfigToml(profile, { includeBearerToken: false }),
    authContents: buildRelayAuthJson(profile),
  };
}

function buildRelayConfigToml(
  profile: Pick<RelayProfile, "model" | "baseUrl" | "upstreamBaseUrl" | "apiKey" | "protocol">,
  options: { includeBearerToken: boolean },
): string {
  const baseUrl = profile.protocol === "chatCompletions" ? PROTOCOL_PROXY_BASE_URL : profile.baseUrl.trim();
  const apiKey = profile.apiKey.trim();
  const rootLines = [
    profile.model.trim() ? `model = "${tomlString(profile.model.trim())}"` : null,
    'model_provider = "custom"',
    "",
  ].filter((line): line is string => line !== null);
  return [
    ...rootLines,
    "[model_providers.custom]",
    'name = "custom"',
    'wire_api = "responses"',
    "requires_openai_auth = true",
    `base_url = "${tomlString(baseUrl)}"`,
    options.includeBearerToken && apiKey ? `experimental_bearer_token = "${tomlString(apiKey)}"` : null,
    "",
  ].filter((line): line is string => line !== null).join("\n");
}

function buildRelayAuthJson(profile: Pick<RelayProfile, "apiKey">): string {
  return `${JSON.stringify({ OPENAI_API_KEY: profile.apiKey.trim() }, null, 2)}\n`;
}

function buildOfficialRelayAuthJson(contents: string): string {
  const trimmed = contents.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    delete parsed.OPENAI_API_KEY;
    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return "";
  }
}

function deriveRelayProfileFromFiles(profile: RelayProfile): RelayProfile {
  const configContents = profile.configContents || "";
  const authContents = profile.relayMode === "official" ? buildOfficialRelayAuthJson(profile.authContents || "") : profile.authContents || "";
  const configBaseUrl = codexBaseUrlFromConfig(configContents);
  const chatUpstreamBaseUrl = rootTomlStringValue(configContents, CHAT_UPSTREAM_BASE_URL_KEY);
  const isProxyConfig = configBaseUrl === PROTOCOL_PROXY_BASE_URL;
  const upstreamBaseUrl = profile.upstreamBaseUrl || chatUpstreamBaseUrl || (configBaseUrl && !isProxyConfig ? configBaseUrl : profile.baseUrl || "");
  const configApiKey = codexExperimentalBearerTokenFromConfig(configContents);
  return {
    ...profile,
    model: codexModelFromConfig(configContents),
    baseUrl: upstreamBaseUrl,
    upstreamBaseUrl,
    apiKey: profile.relayMode === "official"
      ? configApiKey || profile.apiKey || ""
      : codexApiKeyFromAuth(authContents) || configApiKey || "",
    contextWindow: codexTopLevelIntFromConfig(configContents, "model_context_window"),
    autoCompactLimit: codexTopLevelIntFromConfig(configContents, "model_auto_compact_token_limit"),
    configContents,
    authContents,
  };
}

function applyRelayProfilePatchToFiles(
  profile: RelayProfile,
  patch: Partial<RelayProfile>,
  options: { allowGenerateFiles?: boolean } = {},
): RelayProfile {
  let next: RelayProfile = { ...profile, ...patch };
  const shouldHaveFiles =
    next.relayMode !== "official" || next.officialMixApiKey || next.configContents.trim() || next.authContents.trim();
  const needsAuthFile = next.relayMode === "pureApi";
  if (options.allowGenerateFiles && shouldHaveFiles && (!next.configContents.trim() || (needsAuthFile && !next.authContents.trim()))) {
    next = withGeneratedRelayFiles(next);
  }

  if ("model" in patch) {
    next.configContents = setRootTomlStringKey(next.configContents, "model", patch.model || "");
  }
  if ("apiKey" in patch) {
    if (next.relayMode === "pureApi") {
      next.authContents = setAuthOpenAiApiKey(next.authContents, patch.apiKey || "");
      next.configContents = removeCodexExperimentalBearerToken(next.configContents);
    } else {
      next.configContents = setCodexExperimentalBearerToken(next.configContents, patch.apiKey || "");
    }
  }
  if ("baseUrl" in patch) {
    next.upstreamBaseUrl = patch.baseUrl || "";
  }
  if ("upstreamBaseUrl" in patch) {
    next.baseUrl = patch.upstreamBaseUrl || "";
  }
  if ("baseUrl" in patch || "upstreamBaseUrl" in patch || "protocol" in patch) {
    const baseUrlForConfig = next.protocol === "chatCompletions" ? PROTOCOL_PROXY_BASE_URL : next.upstreamBaseUrl || next.baseUrl;
    next.configContents = setCodexProviderStringKey(next.configContents, "base_url", baseUrlForConfig);
    next.configContents = removeRootTomlKey(next.configContents, CHAT_UPSTREAM_BASE_URL_KEY);
  }
  if ("contextWindow" in patch) {
    next.configContents = setRootTomlIntKey(next.configContents, "model_context_window", patch.contextWindow || "");
  }
  if ("autoCompactLimit" in patch) {
    next.configContents = setRootTomlIntKey(
      next.configContents,
      "model_auto_compact_token_limit",
      patch.autoCompactLimit || "",
    );
  }
  if ("relayMode" in patch || "officialMixApiKey" in patch) {
    if (next.relayMode === "official" && !next.officialMixApiKey) {
      next.configContents = "";
      next.authContents = buildOfficialRelayAuthJson(next.authContents);
    } else if (options.allowGenerateFiles && (!next.configContents.trim() || (next.relayMode === "pureApi" && !next.authContents.trim()))) {
      next = withGeneratedRelayFiles(next);
    }
  }

  return deriveRelayProfileFromFiles(next);
}

function codexModelFromConfig(contents: string): string {
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) break;
    const match = /^model\s*=\s*(["'])(.*)\1\s*$/.exec(trimmed);
    if (match) return match[2].replace(/\\(["'\\])/g, "$1");
  }
  return "";
}

function codexBaseUrlFromConfig(contents: string): string {
  return codexProviderStringFromConfig(contents, "base_url");
}

function codexExperimentalBearerTokenFromConfig(contents: string): string {
  return codexProviderStringFromConfig(contents, "experimental_bearer_token");
}

function codexProviderStringFromConfig(contents: string, key: string): string {
  const provider = rootTomlStringValue(contents, "model_provider");
  const targetSection = provider ? `model_providers.${provider}` : "";
  const lines = contents.split(/\r?\n/);
  let currentSection = "";
  const matches: string[] = [];

  for (const line of lines) {
    const section = tomlSectionName(line);
    if (section !== null) {
      currentSection = section;
      continue;
    }
    const value = tomlStringAssignmentValue(line, key);
    if (value === null) continue;
    if (targetSection && currentSection === targetSection) return value;
    if (!currentSection || !currentSection.startsWith("model_providers.")) matches.push(value);
  }

  return matches.length === 1 ? matches[0] : "";
}

function codexApiKeyFromAuth(contents: string): string {
  try {
    const parsed = JSON.parse(contents || "{}") as { OPENAI_API_KEY?: unknown };
    return typeof parsed.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY : "";
  } catch {
    return "";
  }
}

function codexTopLevelIntFromConfig(contents: string, key: string): string {
  const topLevel = splitTomlRootAndTables(contents).root;
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`);
  for (const line of topLevel.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match) return match[1];
  }
  return "";
}

function rootTomlStringValue(contents: string, key: string): string {
  const topLevel = splitTomlRootAndTables(contents).root;
  for (const line of topLevel.split(/\r?\n/)) {
    const value = tomlStringAssignmentValue(line, key);
    if (value !== null) return value;
  }
  return "";
}

function tomlSectionName(line: string): string | null {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  return match ? match[1].trim() : null;
}

function tomlStringAssignmentValue(line: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*([\"'])(.*)\\1\\s*(?:#.*)?$`).exec(line.trim());
  if (!match) return null;
  return match[2].replace(/\\(["'\\])/g, "$1");
}

function setAuthOpenAiApiKey(contents: string, apiKey: string): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(contents || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  parsed.OPENAI_API_KEY = apiKey.trim();
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function setRootTomlStringKey(contents: string, key: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return removeRootTomlKey(contents, key);
  return setRootTomlLine(contents, key, `${key} = "${tomlString(trimmed)}"`);
}

function setRootTomlIntKey(contents: string, key: string, value: string): string {
  const trimmed = value.replace(/[^\d]/g, "");
  if (!trimmed) return removeRootTomlKey(contents, key);
  return setRootTomlLine(contents, key, `${key} = ${trimmed}`);
}

function setRootTomlLine(contents: string, key: string, lineText: string): string {
  const lines = contents.split(/\r?\n/);
  const firstTable = lines.findIndex((line) => /^\s*\[[^\]]+\]\s*$/.test(line));
  const rootEnd = firstTable >= 0 ? firstTable : lines.length;
  for (let index = 0; index < rootEnd; index += 1) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = lineText;
      return ensureTrailingNewline(lines.join("\n").trimEnd());
    }
  }
  const insertAt = key === "model" ? 0 : rootEnd;
  lines.splice(insertAt, 0, lineText);
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function setCodexProviderStringKey(contents: string, key: string, value: string): string {
  const provider = rootTomlStringValue(contents, "model_provider") || "custom";
  let next = contents;
  if (!rootTomlStringValue(next, "model_provider")) {
    next = setRootTomlStringKey(next, "model_provider", provider);
  }
  next = ensureCodexProviderDefaults(next, provider);
  return setTomlSectionStringKey(next, `model_providers.${provider}`, key, value);
}

function setCodexExperimentalBearerToken(contents: string, apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed
    ? setCodexProviderStringKey(contents, "experimental_bearer_token", trimmed)
    : removeCodexExperimentalBearerToken(contents);
}

function removeCodexExperimentalBearerToken(contents: string): string {
  const provider = rootTomlStringValue(contents, "model_provider") || "custom";
  return removeTomlSectionKey(contents, `model_providers.${provider}`, "experimental_bearer_token");
}

function ensureCodexProviderDefaults(contents: string, provider: string): string {
  let next = contents;
  const section = `model_providers.${provider}`;
  next = setTomlSectionStringKey(next, section, "name", provider);
  next = setTomlSectionStringKey(next, section, "wire_api", "responses");
  return setTomlSectionBoolKey(next, section, "requires_openai_auth", true);
}

function setTomlSectionBoolKey(contents: string, sectionName: string, key: string, value: boolean): string {
  return setTomlSectionRawKey(contents, sectionName, key, value ? "true" : "false");
}

function setTomlSectionStringKey(contents: string, sectionName: string, key: string, value: string): string {
  return setTomlSectionRawKey(contents, sectionName, key, `"${tomlString(value.trim())}"`);
}

function setTomlSectionRawKey(contents: string, sectionName: string, key: string, value: string): string {
  const lines = contents.split(/\r?\n/);
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const section = tomlSectionName(lines[index]);
    if (section === null) continue;
    if (sectionStart >= 0) {
      sectionEnd = index;
      break;
    }
    if (section === sectionName) sectionStart = index;
  }
  if (sectionStart < 0) {
    const prefix = ensureTrailingNewline(lines.join("\n").trimEnd()).trimEnd();
    return joinTomlSections([prefix, `[${sectionName}]\n${key} = ${value}`]);
  }
  const replacement = `${key} = ${value}`;
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(lines[index])) {
      lines[index] = replacement;
      return ensureTrailingNewline(lines.join("\n").trimEnd());
    }
  }
  let insertAt = sectionEnd;
  while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  lines.splice(insertAt, 0, replacement);
  return ensureTrailingNewline(lines.join("\n").trimEnd());
}

function removeTomlSectionKey(contents: string, sectionName: string, key: string): string {
  const lines = contents.split(/\r?\n/);
  let sectionStart = -1;
  let sectionEnd = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const section = tomlSectionName(lines[index]);
    if (section === null) continue;
    if (sectionStart >= 0) {
      sectionEnd = index;
      break;
    }
    if (section === sectionName) sectionStart = index;
  }
  if (sectionStart < 0) return contents;
  const next = lines.filter((line, index) => {
    if (index <= sectionStart || index >= sectionEnd) return true;
    return !new RegExp(`^\\s*${key}\\s*=`).test(line);
  });
  return ensureTrailingNewline(next.join("\n").trimEnd());
}

function relayProfileSwitchValidation(profile: RelayProfile): string | null {
  if (profile.relayMode === "official" && !profile.officialMixApiKey) return null;
  if (!profile.configContents.trim()) {
    return `供应商「${profile.name || profile.id}」缺少独立 config.toml，已停止切换，避免继续显示上一套配置文件。请先在该供应商详情里保存 config.toml。`;
  }
  if (profile.relayMode !== "official" || !authJsonHasOpenAiApiKey(profile.authContents)) return null;
  return "官方混合 API 不应在 auth.json 中保存 OPENAI_API_KEY。请清理此供应商的 auth.json 后再切换。";
}

function authJsonHasOpenAiApiKey(contents: string): boolean {
  const trimmed = contents.trim();
  if (!trimmed) return false;
  try {
    const value = JSON.parse(trimmed);
    return !!value && typeof value === "object" && typeof value.OPENAI_API_KEY === "string" && value.OPENAI_API_KEY.trim().length > 0;
  } catch {
    return /"OPENAI_API_KEY"\s*:/.test(trimmed);
  }
}

function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function syncLegacyRelayFields(settings: BackendSettings): BackendSettings {
  const relayProfiles = settings.relayProfiles.map(deriveRelayProfileFromFiles);
  const active = activeRelayProfile({ ...settings, relayProfiles });
  return {
    ...settings,
    relayProfiles,
    activeRelayId: active.id,
    relayBaseUrl: active.baseUrl,
    relayApiKey: active.apiKey,
  };
}

function mergeLiveLinkedRelayProfiles(settings: BackendSettings, liveSettings: BackendSettings): BackendSettings {
  const liveLinkedById = new Map(
    liveSettings.relayProfiles
      .filter((profile) => profile.linkedCcsProviderId.trim())
      .map((profile) => [profile.id, profile]),
  );
  if (!liveLinkedById.size) return settings;
  const existingIds = new Set(settings.relayProfiles.map((profile) => profile.id));
  const relayProfiles = [
    ...settings.relayProfiles.map((profile) => liveLinkedById.get(profile.id) ?? profile),
    ...liveSettings.relayProfiles.filter((profile) => profile.linkedCcsProviderId.trim() && !existingIds.has(profile.id)),
  ];
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles,
    activeRelayId: relayProfiles.some((profile) => profile.id === settings.activeRelayId)
      ? settings.activeRelayId
      : liveSettings.activeRelayId,
  });
}

function updateRelayProfile(settings: BackendSettings, id: string, patch: Partial<RelayProfile>): BackendSettings {
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles: settings.relayProfiles.map((profile) => {
      if (profile.id !== id) return profile;
      return deriveRelayProfileFromFiles({ ...profile, ...patch });
    }),
  });
}

function createRelayProfile(settings: BackendSettings): RelayProfile {
  const id = `relay-${Date.now().toString(36)}`;
  const contextSelection = contextSelectionForAllEntries(settings);
  const next = {
    id,
    linkedCcsProviderId: "",
    name: `供应商 ${settings.relayProfiles.length + 1}`,
    model: "",
    baseUrl: defaultSettings.relayBaseUrl,
    upstreamBaseUrl: defaultSettings.relayBaseUrl,
    apiKey: "",
    protocol: "responses" as RelayProtocol,
    relayMode: "official" as RelayMode,
    officialMixApiKey: false,
    testModel: "",
    configContents: "",
    authContents: "",
    useCommonConfig: true,
    contextSelection,
    contextSelectionInitialized: true,
    contextWindow: "",
    autoCompactLimit: "",
    modelList: "",
    userAgent: "",
  };
  return withGeneratedRelayFiles(next);
}

function addRelayProfile(settings: BackendSettings, profile: RelayProfile): BackendSettings {
  const nextWithFiles = deriveRelayProfileFromFiles(
    profile.configContents.trim() || profile.authContents.trim() ? profile : withGeneratedRelayFiles(profile),
  );
  const activeId = settings.relayProfiles.some((item) => item.id === settings.activeRelayId)
    ? settings.activeRelayId
    : activeRelayProfile(settings).id;
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles: [...settings.relayProfiles, nextWithFiles],
    activeRelayId: activeId,
  });
}

function duplicateRelayProfile(settings: BackendSettings, id: string): BackendSettings {
  const sourceIndex = settings.relayProfiles.findIndex((profile) => profile.id === id);
  const source = settings.relayProfiles[sourceIndex] || activeRelayProfile(settings);
  const nextId = `relay-${Date.now().toString(36)}`;
  const next = {
    ...source,
    id: nextId,
    linkedCcsProviderId: "",
    name: `${source.name || "未命名供应商"} 副本`,
  };
  const relayProfiles = [...settings.relayProfiles];
  relayProfiles.splice(sourceIndex >= 0 ? sourceIndex + 1 : relayProfiles.length, 0, next);
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles,
  });
}

function reorderRelayProfiles(settings: BackendSettings, sourceId: string, targetId: string): BackendSettings {
  if (sourceId === targetId) return settings;
  const sourceIndex = settings.relayProfiles.findIndex((profile) => profile.id === sourceId);
  const targetIndex = settings.relayProfiles.findIndex((profile) => profile.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return settings;
  const relayProfiles = [...settings.relayProfiles];
  const [moved] = relayProfiles.splice(sourceIndex, 1);
  relayProfiles.splice(targetIndex, 0, moved);
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles,
  });
}

function removeRelayProfile(settings: BackendSettings, id: string): BackendSettings {
  const profiles = settings.relayProfiles.filter((profile) => profile.id !== id);
  return syncLegacyRelayFields({
    ...settings,
    relayProfiles: profiles.length ? profiles : defaultSettings.relayProfiles,
    activeRelayId: settings.activeRelayId === id ? profiles[0]?.id || "default" : settings.activeRelayId,
  });
}

function numberOrDefault(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitLogLines(text: string) {
  return text.trimEnd().split(/\r?\n/).filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

function formatTime(value: number) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function loadInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  // 迁移旧 key → 新 key
  const legacy = window.localStorage.getItem("codex-plus-theme");
  if (legacy && !window.localStorage.getItem("ucodex-theme")) {
    window.localStorage.setItem("ucodex-theme", legacy);
    window.localStorage.removeItem("codex-plus-theme");
  }
  return window.localStorage.getItem("ucodex-theme") === "light" ? "light" : "dark";
}

function loadInitialRoute(): Route {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  if (params.get("showUpdate") === "1" || window.location.hash === "#about") {
    return "about";
  }
  return "overview";
}


