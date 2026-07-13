import {
  Activity,
  Bot,
  Columns3,
  Database,
  FileCode2,
  FileText,
  GitBranch,
  GraduationCap,
  History,
  Layers3,
  Loader2,
  Map,
  MessageSquare,
  Settings as SettingsIcon,
  ShieldAlert
} from "lucide-react";
import { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeDiffStream,
  analyzeCode,
  analyzeWorkspaceStream,
  applyAgentPlan,
  approveLearningCardCandidates,
  copyReportText,
  createAgentPlan,
  createAgentPlanFromBridgeInbox,
  createCardsFromFindings,
  createLearningCard,
  deleteAgentTask,
  deleteChatSession,
  deleteLearningCard,
  deleteReport,
  deleteWorkspace,
  exportDailyLogMarkdown,
  exportReportHtml,
  exportAgentTaskMarkdown,
  exportLearningCardsMarkdown,
  exportReportMarkdown,
  exportProductArchive,
  exportWorkspaceBridgeManifest,
  generateCardMaterial,
  generateCardCandidatesFromReport,
  generateDailyLog,
  generateProjectGuide,
  getAgentTask,
  getActivityConstellation,
  getActivityGalaxyData,
  getActivitySummary,
  getAppHealth,
  getDailySummary,
  getLearningCenter,
  getProjectGuide,
  getChatSession,
  getCodeMap,
  getReport,
  getSettings,
  getTraceabilitySnapshot,
  getWorkspace,
  getWorkspaceBridgeStatus,
  importProductArchive,
  importSingleCodeFile,
  importWorkspaceFolder,
  listModelProfiles,
  listWorkspaceBridgeInbox,
  listChatSessions,
  listAgentTasks,
  listCardMaterials,
  listLearningCardCandidates,
  listDailyLogs,
  listFindings,
  listLearningCards,
  listReports,
  listWorkspaces,
  openLogsDir,
  openStorageDir,
  rejectLearningCardCandidate,
  renameReport,
  rollbackAgentOperation,
  saveDailyLog,
  saveModelProfile,
  rescanWorkspace,
  saveSettings,
  sendChatMessageStream,
  testLlmConnection,
  updateWorkspaceBridgeSelection,
  updateFindingStatus,
  updateLearningCard,
  deleteModelProfile
} from "./api";
import type {
  ActivityConstellationData,
  ActivityGalaxyData,
  ActivityStarItem,
  ActivitySummary,
  AgentTask,
  AppHealth,
  CardMaterial,
  ChatMessageItem,
  ChatSessionDetail,
  ChatSessionSummary,
  CodeMap,
  DailyLog,
  DailySummary,
  Finding,
  LearningCard,
  LearningCardCandidate,
  LearningCenterData,
  ModelProfile,
  ProjectGuide,
  ReportDetail,
  ReportSummary,
  Settings,
  TraceabilitySnapshot,
  WorkspaceBridgeInboxRequest,
  WorkspaceBridgeStatus,
  WorkspaceDetail,
  WorkspaceSummary
} from "./types";
import { AgentWorkspaceView } from "./components/AgentWorkspaceView";
import { AiChatView } from "./components/AiChatView";
import { CodeWorkbenchView } from "./components/CodeWorkbenchView";
import { CodeDiffView } from "./components/CodeDiffView";
import { CodeMapView } from "./components/CodeMapView";
import { DailyLearningCenterView } from "./components/DailyLearningCenterView";
import { FindingsView } from "./components/FindingsView";
import { HistoryReportsView, type ReportFilter } from "./components/HistoryReportsView";
import { HealthStatusView } from "./components/HealthStatusView";
import { LearningCardsView } from "./components/LearningCardsView";
import { ProjectGuideView } from "./components/ProjectGuideView";
import { ProductShell, type ProductGlobalCommand, type ProductNavGroup } from "./components/ProductShell";
import { SettingsView } from "./components/SettingsView";

const ActivityGalaxyView = lazy(() =>
  import("./components/ActivityGalaxyView").then((module) => ({ default: module.ActivityGalaxyView }))
);

type View = "overview" | "workbench" | "projects" | "map" | "findings" | "diff" | "chat" | "cards" | "logs" | "guide" | "agent" | "galaxy" | "history" | "settings" | "health";
type GalaxyMode = "entry" | "explore";
type WorkbenchMode = "project" | "single";
export type AppTheme = "dark" | "light";
type BusyArea = "single" | "workspace" | "diff" | "chat" | "settings" | "llm-test" | "cards" | "material" | "daily-log" | "guide" | "agent" | "archive" | null;
type NoticeScope = "global" | "workbench-project" | "workbench-single" | "report";
type ReportOperation = "copy" | "export" | null;

const sampleBefore = `function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}`;

const sampleAfter = `function calculateTotal(items, taxRate = 0) {
  if (!Array.isArray(items)) {
    return 0;
  }

  const subtotal = items.reduce((sum, item) => {
    return sum + Number(item.price || 0);
  }, 0);

  return subtotal * (1 + taxRate);
}`;

const sampleSingleCode = `async function loadUserProfile(userId: string, token: string) {
  if (!userId) {
    throw new Error("missing userId");
  }

  const response = await fetch("/api/users/" + userId, {
    headers: { Authorization: "Bearer " + token }
  });

  if (!response.ok) {
    console.log("profile failed", response.status);
    return null;
  }

  const data = await response.json();
  document.querySelector("#profile")!.innerHTML = data.html;
  return data;
}`;

export default function App() {
  const [view, setViewState] = useState<View>(() => initialViewFromLocation());
  const [theme, setTheme] = useState<AppTheme>(() => initialTheme());
  const [galaxyMode, setGalaxyMode] = useState<GalaxyMode>(() => initialGalaxyModeFromLocation());
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>("project");
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [workspaceReports, setWorkspaceReports] = useState<ReportSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceDetail | null>(null);
  const [codeMap, setCodeMap] = useState<CodeMap | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [cardMaterials, setCardMaterials] = useState<CardMaterial[]>([]);
  const [activeCardSourceFinding, setActiveCardSourceFinding] = useState<Finding | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [activeChat, setActiveChat] = useState<ChatSessionDetail | null>(null);
  const [activeReport, setActiveReport] = useState<ReportDetail | null>(null);
  const [singleReport, setSingleReport] = useState<ReportDetail | null>(null);
  const [singleTraceability, setSingleTraceability] = useState<TraceabilitySnapshot | null>(null);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [dailyDraft, setDailyDraft] = useState<DailyLog | null>(null);
  const [projectGuide, setProjectGuide] = useState<ProjectGuide | null>(null);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [activeAgentTask, setActiveAgentTask] = useState<AgentTask | null>(null);
  const [workspaceBridge, setWorkspaceBridge] = useState<WorkspaceBridgeStatus | null>(null);
  const [workspaceBridgeInbox, setWorkspaceBridgeInbox] = useState<WorkspaceBridgeInboxRequest[]>([]);
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>([]);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [activityGalaxy, setActivityGalaxy] = useState<ActivityGalaxyData | null>(null);
  const [activityConstellation, setActivityConstellation] = useState<ActivityConstellationData | null>(null);
  const [cardCandidates, setCardCandidates] = useState<LearningCardCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [learningCenter, setLearningCenter] = useState<LearningCenterData | null>(null);
  const [traceability, setTraceability] = useState<TraceabilitySnapshot | null>(null);
  const [workspaceTraceability, setWorkspaceTraceability] = useState<TraceabilitySnapshot | null>(null);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("codelens.theme", theme);
    } catch {
      // Theme persistence is optional when storage is unavailable.
    }
  }, [theme]);

  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceStream, setWorkspaceStream] = useState("");
  const [findingStatus, setFindingStatus] = useState("all");
  const [findingSeverity, setFindingSeverity] = useState("all");
  const [findingReportId, setFindingReportId] = useState<string | null>(null);
  const [findingWorkspaceId, setFindingWorkspaceId] = useState<string | null>(null);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [cardStatus, setCardStatus] = useState("all");
  const [cardQuery, setCardQuery] = useState("");
  const [cardWorkspaceId, setCardWorkspaceId] = useState<string | null>(null);
  const [manualCardTitle, setManualCardTitle] = useState("");
  const [manualCardContent, setManualCardContent] = useState("");
  const [manualCardTags, setManualCardTags] = useState("手动,复习");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [agentGoal, setAgentGoal] = useState("根据当前上下文生成确认式行动草稿");
  const [agentContext, setAgentContext] = useState("none|");

  const [singleSourceLabel, setSingleSourceLabel] = useState<string | null>(null);
  const [singleLanguage, setSingleLanguage] = useState("auto");
  const [singleModeGroup, setSingleModeGroup] = useState("function");
  const [singleMode, setSingleMode] = useState("risk_review");
  const [singleGenerateCards, setSingleGenerateCards] = useState(false);
  const [singleCode, setSingleCode] = useState(sampleSingleCode);

  const [diffTitle, setDiffTitle] = useState("代码变更审查");
  const [diffLanguage, setDiffLanguage] = useState("auto");
  const [beforeLabel, setBeforeLabel] = useState("旧版本");
  const [afterLabel, setAfterLabel] = useState("新版本");
  const [beforeCode, setBeforeCode] = useState(sampleBefore);
  const [afterCode, setAfterCode] = useState(sampleAfter);
  const [diffStream, setDiffStream] = useState("");

  const [chatDraft, setChatDraft] = useState("");
  const [chatQuery, setChatQuery] = useState("");
  const [chatContext, setChatContext] = useState("none|");
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [chatStream, setChatStream] = useState("");

  const [historyQuery, setHistoryQuery] = useState("");
  const [reportFilter, setReportFilter] = useState<ReportFilter>("all");
  const [apiBase, setApiBase] = useState("https://api.deepseek.com/v1");
  const [model, setModel] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [enableLlm, setEnableLlm] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileNote, setProfileNote] = useState("");
  const [profileDefault, setProfileDefault] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<string | null>(null);

  const [busyArea, setBusyArea] = useState<BusyArea>(null);
  const [initialDataReady, setInitialDataReady] = useState(false);
  const [message, setMessageState] = useState<string | null>(null);
  const [messageScope, setMessageScope] = useState<NoticeScope>("global");
  const [error, setErrorState] = useState<string | null>(null);
  const [errorScope, setErrorScope] = useState<NoticeScope>("global");
  const [openingReportId, setOpeningReportId] = useState<string | null>(null);
  const [reportOperation, setReportOperation] = useState<ReportOperation>(null);
  const reportOpenVersionRef = useRef(0);
  const cardSelectionVersionRef = useRef(0);
  const dailyLoadVersionRef = useRef(0);
  const dailyOperationVersionRef = useRef(0);
  const projectGuideLoadVersionRef = useRef(0);
  const projectViewBootstrapRef = useRef<string | null>(null);

  function setMessage(value: string | null, scope: NoticeScope = "global") {
    setMessageState(value);
    if (value) setMessageScope(scope);
  }

  function setError(value: string | null, scope: NoticeScope = "global") {
    setErrorState(value);
    if (value) setErrorScope(scope);
  }

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => {
      setMessageState((current) => current === message ? null : current);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [message, messageScope]);

  function changeWorkbenchMode(value: WorkbenchMode) {
    setWorkbenchMode(value);
    const targetScope: NoticeScope = value === "project" ? "workbench-project" : "workbench-single";
    if (message && messageScope !== "global" && messageScope !== targetScope) setMessage(null);
    if (error && errorScope !== "global" && errorScope !== targetScope) setError(null);
  }

  function setView(nextView: View, nextGalaxyMode?: GalaxyMode) {
    const resolvedView: View = nextView === "projects" || nextView === "overview" ? "workbench" : nextView;
    const resolvedGalaxyMode = resolvedView === "galaxy" ? nextGalaxyMode || "explore" : galaxyMode;
    if (resolvedView === "workbench") changeWorkbenchMode("project");
    if (resolvedView === "galaxy") {
      setGalaxyMode(resolvedGalaxyMode);
    }
    setViewState(resolvedView);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (resolvedView === "galaxy" && resolvedGalaxyMode === "entry") {
      url.searchParams.delete("view");
      url.searchParams.delete("galaxy");
    } else {
      url.searchParams.set("view", resolvedView);
      if (resolvedView === "galaxy") url.searchParams.set("galaxy", resolvedGalaxyMode);
      else url.searchParams.delete("galaxy");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    projectGuideLoadVersionRef.current += 1;
    setProjectGuide((current) => current?.workspace_id === activeWorkspace?.summary.id ? current : null);
  }, [activeWorkspace?.summary.id]);

  useEffect(() => {
    if (!initialDataReady || activeWorkspace || (view !== "guide" && view !== "map")) {
      if (view !== "guide" && view !== "map") projectViewBootstrapRef.current = null;
      return;
    }
    const bootstrapKey = `${view}:${workspaces.map((workspace) => workspace.id).join(",")}`;
    if (projectViewBootstrapRef.current === bootstrapKey) return;
    projectViewBootstrapRef.current = bootstrapKey;
    if (view === "guide") void handleLoadProjectGuide();
    else void handleLoadCodeMap();
  }, [activeWorkspace, initialDataReady, view, workspaces]);

  useEffect(() => {
    if (!settings) return;
    setApiBase(settings.api_base);
    setModel(settings.model);
    setEnableLlm(settings.enable_llm);
  }, [settings]);

  useEffect(() => {
    if (view !== "workbench" || workbenchMode !== "project" || !activeWorkspace) return;
    let cancelled = false;
    getTraceabilitySnapshot("workspace", activeWorkspace.summary.id)
      .then((snapshot) => {
        if (!cancelled) setWorkspaceTraceability(snapshot);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.summary.id, view, workbenchMode]);

  const statusText = useMemo(() => {
    if (!health) return "正在检查本地状态";
    if (!health.database_ok) return "SQLite 异常";
    if (health.llm_enabled && !health.llm_configured) return "等待配置 API Key";
    return health.llm_enabled ? "LLM 已就绪" : "本地审查已就绪";
  }, [health]);

  const displayedChatMessages = useMemo<ChatMessageItem[]>(() => {
    const now = new Date().toISOString();
    const temp: ChatMessageItem[] = [];
    if (pendingUserMessage) {
      temp.push({ id: "pending-user", session_id: activeChat?.id || "new", role: "user", content: pendingUserMessage, created_at: now });
    }
    if (chatStream) {
      temp.push({ id: "streaming-assistant", session_id: activeChat?.id || "new", role: "assistant", content: chatStream, created_at: now });
    }
    return [...(activeChat?.messages || []), ...temp];
  }, [activeChat, chatStream, pendingUserMessage]);

  async function refreshAll() {
    const dailyRequestVersion = ++dailyLoadVersionRef.current;
    setError(null);
    try {
      const [
        nextHealth,
        nextSettings,
        nextModelProfiles,
        nextReports,
        nextWorkspaceReports,
        nextWorkspaces,
        nextChats,
        nextFindings,
        nextCards,
        nextDailySummary,
        nextDailyLogs,
        nextAgentTasks,
        nextBridge,
        nextBridgeInbox,
        nextCandidates,
        nextLearningCenter,
        nextActivitySummary,
        nextGalaxy,
        nextConstellation,
        nextTraceability,
        nextWorkspaceTraceability
      ] = await Promise.all([
        getAppHealth(),
        getSettings(),
        listModelProfiles(),
        listReports(historyQuery, reportFilter === "all" ? undefined : reportFilter),
        listReports(),
        listWorkspaces(workspaceQuery),
        listChatSessions(chatQuery),
        listFindings(activeWorkspace?.summary.id, findingStatus, findingSeverity, findingReportId || undefined),
        listLearningCards(cardWorkspaceId || activeWorkspace?.summary.id, cardStatus),
        getDailySummary(dailyDate),
        listDailyLogs(),
        listAgentTasks(),
        getWorkspaceBridgeStatus(activeWorkspace?.summary.id),
        listWorkspaceBridgeInbox(),
        listLearningCardCandidates("pending", activeReport?.id),
        getLearningCenter(dailyDate, dailyDate.slice(0, 7)),
        getActivitySummary(),
        getActivityGalaxyData(),
        getActivityConstellation(300),
        getTraceabilitySnapshot(activeReport ? "report" : activeWorkspace ? "workspace" : "global", activeReport?.id || activeWorkspace?.summary.id),
        activeWorkspace ? getTraceabilitySnapshot("workspace", activeWorkspace.summary.id) : Promise.resolve(null)
      ]);
      setHealth(nextHealth);
      setSettings(nextSettings);
      setModelProfiles(nextModelProfiles);
      setReports(nextReports);
      setWorkspaceReports(nextWorkspaceReports);
      setWorkspaces(nextWorkspaces);
      setInitialDataReady(true);
      setChatSessions(nextChats);
      setFindings(nextFindings);
      setCards(nextCards);
      if (dailyRequestVersion === dailyLoadVersionRef.current) {
        setDailySummary(nextDailySummary);
        setDailyLogs(nextDailyLogs);
        setLearningCenter(nextLearningCenter);
        setDailyDraft(nextDailyLogs.find((log) => log.date === dailyDate) || null);
      }
      setAgentTasks(nextAgentTasks);
      setWorkspaceBridge(nextBridge);
      setWorkspaceBridgeInbox(nextBridgeInbox);
      setCardCandidates(nextCandidates);
      setActivitySummary(nextActivitySummary);
      setActivityGalaxy(nextGalaxy);
      setActivityConstellation(nextConstellation);
      setTraceability(nextTraceability);
      setWorkspaceTraceability(nextWorkspaceTraceability);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function refreshWorkspaces(query = workspaceQuery) {
    setWorkspaces(await listWorkspaces(query));
  }

  async function refreshReports() {
    setReports(await listReports(historyQuery, reportFilter === "all" ? undefined : reportFilter));
  }

  async function refreshWorkspaceReports() {
    setWorkspaceReports(await listReports());
  }

  async function refreshFindings(workspaceId = findingWorkspaceId, reportId = findingReportId) {
    setFindings(await listFindings(workspaceId || undefined, findingStatus, findingSeverity, reportId || undefined));
  }

  async function refreshCards(workspaceId = cardWorkspaceId, status = cardStatus) {
    setCards(await listLearningCards(workspaceId || undefined, status));
  }

  async function resolveCardSourceFinding(card: LearningCard): Promise<Finding | null> {
    if (!card.finding_id) return null;
    const cached = findings.find((finding) => finding.id === card.finding_id);
    if (cached) return cached;
    const allFindings = await listFindings(undefined, "all", "all");
    return allFindings.find((finding) => finding.id === card.finding_id) || null;
  }

  async function selectCard(card: LearningCard) {
    const requestVersion = ++cardSelectionVersionRef.current;
    setActiveCardId(card.id);
    setCardMaterials([]);
    setActiveCardSourceFinding(null);
    const [materialsResult, sourceResult] = await Promise.allSettled([
      listCardMaterials(card.id),
      resolveCardSourceFinding(card)
    ]);
    if (requestVersion !== cardSelectionVersionRef.current) return;
    if (materialsResult.status === "fulfilled") {
      setCardMaterials(materialsResult.value);
    } else {
      setError(`学习材料读取失败：${friendlyError(materialsResult.reason)}`);
    }
    if (sourceResult.status === "fulfilled") {
      setActiveCardSourceFinding(sourceResult.value);
    }
  }

  async function openCardById(id: string) {
    try {
      const allCards = await listLearningCards(undefined, "all");
      const target = allCards.find((card) => card.id === id);
      if (!target) {
        setError("没有找到要打开的知识卡片。");
        return;
      }
      const workspaceId = target.workspace_id || null;
      const scopedCards = workspaceId ? allCards.filter((card) => card.workspace_id === workspaceId) : allCards;
      setCardWorkspaceId(workspaceId);
      setCardStatus("all");
      setCardQuery("");
      setCards(scopedCards);
      setView("cards");
      await selectCard(target);
    } catch (err) {
      setError(`知识卡片读取失败：${friendlyError(err)}`);
    }
  }

  async function openCardsForWorkspace(workspaceId = activeWorkspace?.summary.id) {
    try {
      const resolvedWorkspaceId = workspaceId || null;
      const nextCards = await listLearningCards(resolvedWorkspaceId || undefined, "all");
      setCardWorkspaceId(resolvedWorkspaceId);
      setCardStatus("all");
      setCardQuery("");
      setCards(nextCards);
      setView("cards");
      const current = nextCards.find((card) => card.id === activeCardId) || nextCards[0] || null;
      if (current) {
        await selectCard(current);
      } else {
        ++cardSelectionVersionRef.current;
        setActiveCardId(null);
        setCardMaterials([]);
        setActiveCardSourceFinding(null);
      }
    } catch (err) {
      setError(`知识卡片读取失败：${friendlyError(err)}`);
    }
  }

  async function handleCardStatusFilter(status: string) {
    setCardStatus(status);
    const nextCards = await listLearningCards(cardWorkspaceId || undefined, status);
    setCards(nextCards);
    const current = nextCards.find((card) => card.id === activeCardId) || nextCards[0] || null;
    if (current && current.id !== activeCardId) await selectCard(current);
    if (!current) {
      ++cardSelectionVersionRef.current;
      setActiveCardId(null);
      setCardMaterials([]);
      setActiveCardSourceFinding(null);
    }
  }

  async function loadDaily(date: string, syncDraft: boolean) {
    const requestVersion = ++dailyLoadVersionRef.current;
    const [summary, logs, center] = await Promise.all([
      getDailySummary(date),
      listDailyLogs(),
      getLearningCenter(date, date.slice(0, 7))
    ]);
    if (requestVersion !== dailyLoadVersionRef.current) return false;
    setDailySummary(summary);
    setDailyLogs(logs);
    setLearningCenter(center);
    if (syncDraft) setDailyDraft(logs.find((log) => log.date === date) || null);
    return true;
  }

  async function refreshDaily(date = dailyDate) {
    return loadDaily(date, false);
  }

  async function selectDailyDate(date: string) {
    if (date === dailyDate) return refreshDaily(date);
    ++dailyOperationVersionRef.current;
    setDailyDate(date);
    setDailyDraft(dailyLogs.find((log) => log.date === date) || null);
    return loadDaily(date, true);
  }

  async function refreshAgent() {
    setAgentTasks(await listAgentTasks());
  }

  async function refreshBridge(workspaceId = activeWorkspace?.summary.id) {
    const [nextBridge, nextInbox] = await Promise.all([
      getWorkspaceBridgeStatus(workspaceId),
      listWorkspaceBridgeInbox()
    ]);
    setWorkspaceBridge(nextBridge);
    setWorkspaceBridgeInbox(nextInbox);
  }

  async function refreshBridgeInbox() {
    setWorkspaceBridgeInbox(await listWorkspaceBridgeInbox());
  }

  async function refreshCardCandidates(reportId = activeReport?.id) {
    setCardCandidates(await listLearningCardCandidates("pending", reportId));
    setSelectedCandidateIds([]);
  }

  async function refreshActivity() {
    const [summary, galaxy, constellation] = await Promise.all([
      getActivitySummary(),
      getActivityGalaxyData(),
      getActivityConstellation(300)
    ]);
    setActivitySummary(summary);
    setActivityGalaxy(galaxy);
    setActivityConstellation(constellation);
  }

  async function refreshTraceability(scopeKind?: string, scopeId?: string) {
    const resolvedKind = scopeKind || (activeReport ? "report" : activeWorkspace ? "workspace" : "global");
    const resolvedId = scopeId || activeReport?.id || activeWorkspace?.summary.id;
    const snapshot = await getTraceabilitySnapshot(resolvedKind, resolvedId);
    setTraceability(snapshot);
    if (snapshot.scope_kind === "workspace") setWorkspaceTraceability(snapshot);
  }

  async function refreshWorkspaceTraceability(workspaceId = activeWorkspace?.summary.id) {
    if (!workspaceId) {
      setWorkspaceTraceability(null);
      return null;
    }
    const snapshot = await getTraceabilitySnapshot("workspace", workspaceId);
    setWorkspaceTraceability(snapshot);
    return snapshot;
  }

  async function handleImportWorkspace() {
    setBusyArea("workspace");
    setError(null, "workbench-project");
    setMessage(null, "workbench-project");
    try {
      const detail = await importWorkspaceFolder();
      setActiveWorkspace(detail);
      setCodeMap(null);
      setWorkspaceBridge(await getWorkspaceBridgeStatus(detail.summary.id));
      const snapshot = await getTraceabilitySnapshot("workspace", detail.summary.id);
      setTraceability(snapshot);
      setWorkspaceTraceability(snapshot);
      await Promise.all([refreshWorkspaces(), refreshFindings(detail.summary.id), refreshCards(detail.summary.id)]);
      setMessage(`工作区已导入：${detail.summary.file_count} 个文件，${detail.summary.total_lines} 行。`, "workbench-project");
      setView("workbench");
    } catch (err) {
      setError(friendlyError(err), "workbench-project");
    } finally {
      setBusyArea(null);
    }
  }

  async function activateWorkspaceContext(id: string) {
    const detail = await getWorkspace(id);
    setActiveWorkspace(detail);
    setCodeMap(null);
    setWorkspaceBridge(await getWorkspaceBridgeStatus(id));
    const snapshot = await getTraceabilitySnapshot("workspace", id);
    setTraceability(snapshot);
    setWorkspaceTraceability(snapshot);
    await Promise.all([refreshFindings(id), refreshCards(id)]);
    return detail;
  }

  async function handleOpenWorkspace(id: string) {
    setError(null, "workbench-project");
    try {
      await activateWorkspaceContext(id);
      setView("projects");
    } catch (err) {
      setError(friendlyError(err), "workbench-project");
    }
  }

  async function resolveWorkspaceForProjectView(action: "项目导览" | "代码地图") {
    if (activeWorkspace) return activeWorkspace;
    if (workspaces.length === 1) {
      setBusyArea("workspace");
      try {
        return await activateWorkspaceContext(workspaces[0].id);
      } catch (err) {
        setView("workbench");
        setError(`工作区打开失败：${friendlyError(err)}`, "workbench-project");
        return null;
      } finally {
        setBusyArea(null);
      }
    }
    setView("workbench");
    setError(
      workspaces.length > 1
        ? `请先在审查工作台选择一个工作区，再查看${action}。`
        : `请先在审查工作台导入一个项目，再查看${action}。`,
      "workbench-project"
    );
    return null;
  }

  async function handleRescanWorkspace() {
    if (!activeWorkspace) return;
    setBusyArea("workspace");
    setError(null, "workbench-project");
    setMessage(null, "workbench-project");
    try {
      const detail = await rescanWorkspace(activeWorkspace.summary.id);
      setActiveWorkspace(detail);
      setCodeMap(null);
      setWorkspaceBridge(await getWorkspaceBridgeStatus(detail.summary.id));
      const snapshot = await getTraceabilitySnapshot("workspace", detail.summary.id);
      setTraceability(snapshot);
      setWorkspaceTraceability(snapshot);
      await Promise.all([refreshWorkspaces(), refreshFindings(detail.summary.id), refreshCards(detail.summary.id)]);
      setMessage(`工作区已重新扫描：${detail.summary.file_count} 个文件。`, "workbench-project");
    } catch (err) {
      setError(friendlyError(err), "workbench-project");
    } finally {
      setBusyArea(null);
    }
  }

  async function handleDeleteWorkspace(id: string) {
    setError(null, "workbench-project");
    try {
      await deleteWorkspace(id);
      if (activeWorkspace?.summary.id === id) {
        setActiveWorkspace(null);
        setCodeMap(null);
        setWorkspaceBridge(await getWorkspaceBridgeStatus());
        setTraceability(await getTraceabilitySnapshot("global"));
        setWorkspaceTraceability(null);
      }
      await refreshWorkspaces();
      setMessage("工作区已删除。", "workbench-project");
    } catch (err) {
      setError(friendlyError(err), "workbench-project");
    }
  }

  async function handleAnalyzeWorkspace() {
    if (!activeWorkspace) {
      setError("请先导入或打开一个工作区。", "workbench-project");
      return;
    }
    setBusyArea("workspace");
    setWorkspaceStream("");
    setError(null, "workbench-project");
    setMessage(null, "workbench-project");
    try {
      const response = await analyzeWorkspaceStream(activeWorkspace.summary.id, (chunk) => setWorkspaceStream((value) => value + chunk));
      setActiveReport(response.report);
      const [nextReports, nextWorkspaceReports, nextFindings, reportSnapshot, workspaceSnapshot] = await Promise.all([
        listReports(historyQuery, reportFilter === "all" ? undefined : reportFilter),
        listReports(),
        listFindings(activeWorkspace.summary.id, "all", "all"),
        getTraceabilitySnapshot("report", response.report.id),
        getTraceabilitySnapshot("workspace", activeWorkspace.summary.id)
      ]);
      setReports(nextReports);
      setWorkspaceReports(nextWorkspaceReports);
      setFindingWorkspaceId(activeWorkspace.summary.id);
      setFindingReportId(null);
      setFindingStatus("all");
      setFindingSeverity("all");
      setActiveFindingId(nextFindings[0]?.id || null);
      setFindings(nextFindings);
      setTraceability(reportSnapshot);
      setWorkspaceTraceability(workspaceSnapshot);
      setMessage(response.warnings[0] || "工作区审查报告已生成。", "workbench-project");
      setView("history");
    } catch (err) {
      setError(friendlyError(err), "workbench-project");
    } finally {
      setBusyArea(null);
    }
  }

  async function handleLoadCodeMap() {
    const workspace = await resolveWorkspaceForProjectView("代码地图");
    if (!workspace) return;
    setError(null, view === "workbench" ? "workbench-project" : "global");
    try {
      setCodeMap(await getCodeMap(workspace.summary.id));
      setView("map");
    } catch (err) {
      setError(friendlyError(err), view === "workbench" ? "workbench-project" : "global");
    }
  }

  async function handleUpdateFinding(id: string, status: string) {
    setError(null);
    try {
      const updated = await updateFindingStatus(id, status);
      await refreshFindings();
      return updated;
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    }
  }

  async function handleFindingStatusFilter(status: string) {
    setFindingStatus(status);
    setFindings(await listFindings(findingWorkspaceId || undefined, status, findingSeverity, findingReportId || undefined));
  }

  async function handleFindingSeverityFilter(severity: string) {
    setFindingSeverity(severity);
    setFindings(await listFindings(findingWorkspaceId || undefined, findingStatus, severity, findingReportId || undefined));
  }

  async function handleClearFindingReportLink() {
    setFindingReportId(null);
    setFindings(await listFindings(findingWorkspaceId || undefined, findingStatus, findingSeverity));
  }

  async function handleResetFindingFilters() {
    const workspaceId = activeWorkspace?.summary.id || null;
    setFindingWorkspaceId(workspaceId);
    setFindingReportId(null);
    setFindingStatus("all");
    setFindingSeverity("all");
    setFindings(await listFindings(workspaceId || undefined, "all", "all"));
  }

  async function handleOpenFinding(finding: Finding) {
    setError(null);
    try {
      if (finding.workspace_id && activeWorkspace?.summary.id !== finding.workspace_id) {
        const detail = await getWorkspace(finding.workspace_id);
        setActiveWorkspace(detail);
        setCodeMap(null);
        setWorkspaceBridge(await getWorkspaceBridgeStatus(finding.workspace_id));
      }
      setFindingReportId(null);
      setFindingWorkspaceId(finding.workspace_id || null);
      setFindingStatus("all");
      setFindingSeverity("all");
      setActiveFindingId(finding.id);
      setFindings(await listFindings(finding.workspace_id || undefined, "all", "all"));
      setTraceability(await getTraceabilitySnapshot("workspace", finding.workspace_id || activeWorkspace?.summary.id));
      setView("findings");
      setMessage(`已打开问题清单，并定位到：${finding.title}`);
    } catch (err) {
      setError(friendlyError(err));
      setView("findings");
    }
  }

  async function handleCreateCards(findingIds?: string[]) {
    setBusyArea("cards");
    setError(null);
    setMessage(null);
    try {
      const sourceIds = findingIds?.length ? findingIds : findings.map((item) => item.id);
      const created = await createCardsFromFindings(sourceIds);
      const workspaceId = sourceIds.length === 1 ? created[0]?.workspace_id || null : null;
      const nextCards = await listLearningCards(workspaceId || undefined, "all");
      setCardWorkspaceId(workspaceId);
      setCardStatus("all");
      setCardQuery("");
      setCards(nextCards);
      await refreshTraceability();
      if (created[0]) {
        setView("cards");
        await selectCard(created[0]);
      }
      setMessage(`已生成 ${created.length} 张学习卡片。`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleCreateManualCard(event: FormEvent) {
    event.preventDefault();
    if (!manualCardTitle.trim() || !manualCardContent.trim()) {
      const validationError = new Error("请填写知识卡片标题和内容。");
      setError(validationError.message);
      throw validationError;
    }
    setBusyArea("cards");
    setError(null);
    try {
      const created = await createLearningCard({
        finding_id: null,
        workspace_id: activeWorkspace?.summary.id || null,
        title: manualCardTitle.trim(),
        content: manualCardContent.trim(),
        tags: manualCardTags.split(",").map((tag) => tag.trim()).filter(Boolean)
      });
      setManualCardTitle("");
      setManualCardContent("");
      setManualCardTags("");
      const workspaceId = created.workspace_id || null;
      const nextCards = await listLearningCards(workspaceId || undefined, "all");
      setCardWorkspaceId(workspaceId);
      setCardStatus("all");
      setCardQuery("");
      setCards(nextCards);
      await selectCard(created);
      setMessage("知识卡片已创建。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleGenerateCardMaterial(cardId: string) {
    setBusyArea("material");
    setError(null);
    const requestVersion = cardSelectionVersionRef.current;
    try {
      const material = await generateCardMaterial(cardId, true);
      const materials = await listCardMaterials(cardId);
      if (requestVersion === cardSelectionVersionRef.current && activeCardId === cardId) {
        setCardMaterials(materials);
      }
      setMessage(`学习材料已生成：${material.title}`);
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    } finally {
      setBusyArea(null);
    }
  }

  async function handleUpdateCard(id: string, status: string) {
    setError(null);
    try {
      const updated = await updateLearningCard(id, status);
      await refreshCards();
      return updated;
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    }
  }

  async function handleExportLearningCards() {
    setBusyArea("cards");
    setError(null);
    try {
      const path = await exportLearningCardsMarkdown(cardWorkspaceId || undefined, cardStatus);
      setMessage(`知识卡片组已导出：${path}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleDeleteCard(id: string) {
    setError(null);
    try {
      await deleteLearningCard(id);
      const nextCards = await listLearningCards(cardWorkspaceId || undefined, cardStatus);
      setCards(nextCards);
      const replacement = nextCards.find((card) => card.id !== id) || null;
      if (replacement) {
        await selectCard(replacement);
      } else {
        ++cardSelectionVersionRef.current;
        setActiveCardId(null);
        setCardMaterials([]);
        setActiveCardSourceFinding(null);
      }
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    }
  }

  async function handleGenerateCandidatesForReport(report: ReportDetail | null) {
    if (!report) {
      setError("请先生成或打开一份报告。");
      return;
    }
    setBusyArea("cards");
    setError(null);
    try {
      const candidates = await generateCardCandidatesFromReport(report.id);
      setCardCandidates(candidates);
      setSelectedCandidateIds(candidates.map((item) => item.id));
      setView("cards");
      setMessage(`已生成 ${candidates.length} 个知识卡片候选，等待人工审核。`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleGenerateCandidatesFromActiveReport() {
    await handleGenerateCandidatesForReport(activeReport);
  }

  async function handleApproveSelectedCandidates() {
    const ids = selectedCandidateIds.length ? selectedCandidateIds : cardCandidates.map((item) => item.id);
    if (ids.length === 0) {
      setError("当前没有可审核通过的知识卡片候选。");
      return;
    }
    setBusyArea("cards");
    setError(null);
    try {
      const created = await approveLearningCardCandidates(ids);
      const workspaceId = ids.length === 1 ? created[0]?.workspace_id || null : null;
      const nextCards = await listLearningCards(workspaceId || undefined, "all");
      setCardWorkspaceId(workspaceId);
      setCardStatus("all");
      setCardQuery("");
      setCards(nextCards);
      await Promise.all([refreshCardCandidates(), refreshTraceability()]);
      if (created[0]) {
        await selectCard(created[0]);
      }
      setMessage(`已审核通过 ${created.length} 张知识卡片。`);
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    } finally {
      setBusyArea(null);
    }
  }

  async function handleRejectCandidate(id: string) {
    setError(null);
    try {
      await rejectLearningCardCandidate(id);
      await refreshCardCandidates();
      setSelectedCandidateIds((items) => items.filter((item) => item !== id));
    } catch (err) {
      setError(friendlyError(err));
      throw err;
    }
  }

  async function handleGenerateDailyLog() {
    const targetDate = dailyDate;
    const operationVersion = ++dailyOperationVersionRef.current;
    setBusyArea("daily-log");
    setError(null);
    try {
      const log = await generateDailyLog(targetDate);
      if (operationVersion !== dailyOperationVersionRef.current || targetDate !== dailyDate) return false;
      setDailyDraft(log);
      setMessage("已根据当天活动生成日志草稿。");
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      if (operationVersion === dailyOperationVersionRef.current) setBusyArea(null);
    }
  }

  async function handleSaveDailyLog() {
    const draft = dailyDraft;
    if (!draft || !draft.title.trim()) return false;
    const operationVersion = ++dailyOperationVersionRef.current;
    setBusyArea("daily-log");
    setError(null);
    try {
      const saved = await saveDailyLog(draft.date, draft.title.trim(), draft.content);
      if (operationVersion !== dailyOperationVersionRef.current) return false;
      if (dailyDate === saved.date) setDailyDraft(saved);
      await Promise.all([refreshDaily(saved.date), refreshTraceability()]);
      setMessage("每日日志已保存。");
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      if (operationVersion === dailyOperationVersionRef.current) setBusyArea(null);
    }
  }

  function handleStartManualDailyLog() {
    const existing = dailyLogs.find((log) => log.date === dailyDate);
    const now = new Date().toISOString();
    setDailyDraft(existing || {
      id: `draft-${dailyDate}`,
      date: dailyDate,
      title: `${dailyDate} 学习日志`,
      content: `# ${dailyDate} 学习日志\n\n## 今日目标\n\n## 关键活动\n\n## 学到的内容\n\n## 明日行动\n`,
      created_at: now,
      updated_at: now
    });
    setMessage("已创建可编辑日志草稿。");
  }

  async function handleCopyDailyLog() {
    if (!dailyDraft) return;
    try {
      await navigator.clipboard.writeText(`# ${dailyDraft.title}\n\n${dailyDraft.content}`);
      setMessage("日志 Markdown 已复制。");
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleExportDailyLog() {
    const draft = dailyDraft;
    const targetDate = dailyDate;
    const operationVersion = ++dailyOperationVersionRef.current;
    setBusyArea("daily-log");
    setError(null);
    try {
      if (draft) {
        await saveDailyLog(draft.date, draft.title, draft.content);
      }
      const path = await exportDailyLogMarkdown(targetDate);
      if (operationVersion !== dailyOperationVersionRef.current) return;
      await refreshDaily(targetDate);
      setMessage(`每日日志已导出：${path}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      if (operationVersion === dailyOperationVersionRef.current) setBusyArea(null);
    }
  }

  async function handleOpenCardFromDaily(id: string) {
    await openCardById(id);
  }

  async function handleGenerateProjectGuide() {
    if (!activeWorkspace) {
      setError("请先打开一个工作区，再生成项目导览。");
      return;
    }
    setBusyArea("guide");
    setError(null);
    try {
      setProjectGuide(await generateProjectGuide(activeWorkspace.summary.id));
      setMessage("项目导览已生成。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleLoadProjectGuide() {
    const workspace = await resolveWorkspaceForProjectView("项目导览");
    if (!workspace) return;
    const workspaceId = workspace.summary.id;
    const requestVersion = ++projectGuideLoadVersionRef.current;
    setProjectGuide((current) => current?.workspace_id === workspaceId ? current : null);
    setError(null);
    setView("guide");
    try {
      const guide = await getProjectGuide(workspaceId);
      if (requestVersion !== projectGuideLoadVersionRef.current) return;
      setProjectGuide(guide);
    } catch (err) {
      if (requestVersion !== projectGuideLoadVersionRef.current) return;
      if (isMissingProjectGuideError(err)) {
        setProjectGuide(null);
        return;
      }
      setError(friendlyError(err));
    }
  }

  async function handleCreateAgentPlan() {
    const [contextKind, contextId] = agentContext.split("|", 2);
    const resolvedKind = contextKind === "none" ? (activeWorkspace ? "workspace" : "general") : contextKind;
    const resolvedId = contextKind === "none" ? (activeWorkspace?.summary.id || "general") : contextId;
    const selectedFiles = workspaceBridge?.selected_file_paths.length
      ? workspaceBridge.selected_file_paths
      : activeWorkspace?.files.slice(0, 5).map((file) => file.path) || [];
    setBusyArea("agent");
    setError(null);
    try {
      const task = await createAgentPlan({
        context_kind: resolvedKind,
        context_id: resolvedId,
        goal: agentGoal,
        selected_file_paths: selectedFiles
      });
      setActiveAgentTask(task);
      setSelectedOperationIds(task.operations.map((operation) => operation.id));
      await refreshAgent();
      await refreshTraceability();
      setMessage("确认式行动草稿已生成，请审核文件操作后再写入。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleDeleteAgentTask(id: string) {
    await deleteAgentTask(id);
    if (activeAgentTask?.id === id) setActiveAgentTask(null);
    await refreshAgent();
  }

  async function handleExportAgentTask() {
    if (!activeAgentTask) return;
    setBusyArea("agent");
    setError(null);
    try {
      const path = await exportAgentTaskMarkdown(activeAgentTask.id);
      await refreshActivity();
      setMessage(`行动草稿已导出：${path}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleExportWorkspaceBridgeManifest() {
    const workspaceId = workspaceBridge?.workspace_id || activeWorkspace?.summary.id;
    if (!workspaceId) {
      setError("请先导入或打开一个工作区，再导出桥接清单。");
      return;
    }
    setBusyArea("agent");
    setError(null);
    try {
      const result = await exportWorkspaceBridgeManifest(workspaceId);
      await Promise.all([refreshBridge(workspaceId), refreshActivity()]);
      setMessage(`工作区桥接清单已导出；高级桥接稳定入口：${result.current_manifest_path}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleCreateAgentPlanFromBridgeInbox(requestId: string) {
    setBusyArea("agent");
    setError(null);
    try {
      const result = await createAgentPlanFromBridgeInbox(requestId);
      setActiveAgentTask(result.task);
      setSelectedOperationIds(result.task.operations.map((operation) => operation.id));
      await Promise.all([
        refreshAgent(),
        refreshBridge(),
        refreshActivity(),
        refreshTraceability(result.task.context_kind, result.task.context_id)
      ]);
      setMessage(`已根据桥接收件箱请求生成行动草稿：${result.task.title}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleToggleBridgeFile(path: string, selected: boolean) {
    const workspaceId = workspaceBridge?.workspace_id || activeWorkspace?.summary.id;
    if (!workspaceId) return;
    const current = workspaceBridge?.selected_file_paths || [];
    const next = selected
      ? Array.from(new Set([...current, path]))
      : current.filter((item) => item !== path);
    setWorkspaceBridge(await updateWorkspaceBridgeSelection(workspaceId, next));
  }

  async function handleApplyAgentPlan() {
    if (!activeAgentTask) return;
    const operationIds = selectedOperationIds.length
      ? selectedOperationIds
      : activeAgentTask.operations.filter((operation) => operation.status === "pending").map((operation) => operation.id);
    if (operationIds.length === 0) {
      setError("当前没有待写入的行动草稿文件操作。");
      return;
    }
    setBusyArea("agent");
    setError(null);
    try {
      const result = await applyAgentPlan({ task_id: activeAgentTask.id, operation_ids: operationIds, confirm: true });
      setActiveAgentTask(result.task);
      setSelectedOperationIds(result.task.operations.filter((operation) => operation.status === "pending").map((operation) => operation.id));
      await Promise.all([refreshAgent(), refreshTraceability()]);
      setMessage(`${result.applied_count} 项操作已写入。备份目录：${result.backup_dir}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleRollbackAgentOperation(operationId: string) {
    if (!activeAgentTask) return;
    setBusyArea("agent");
    setError(null);
    try {
      const task = await rollbackAgentOperation(activeAgentTask.id, operationId);
      setActiveAgentTask(task);
      setSelectedOperationIds(task.operations.filter((operation) => operation.status === "pending").map((operation) => operation.id));
      await Promise.all([refreshAgent(), refreshTraceability()]);
      setMessage("行动草稿文件操作已回滚。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleAgentTaskToLearningCard() {
    if (!activeAgentTask) return;
    setBusyArea("cards");
    setError(null);
    try {
      const content = [
        activeAgentTask.summary,
        "",
        "## 步骤",
        ...activeAgentTask.steps.map((step) => `${step.position}. ${step.title}：${step.detail}`),
        "",
        "## 文件操作",
        ...activeAgentTask.operations.map((operation) => `- ${operationStatusLabel(operation.status)}：${operation.path}`)
      ].join("\n");
      const card = await createLearningCard({
        finding_id: null,
        workspace_id: activeWorkspace?.summary.id || null,
        title: `行动草稿复盘：${activeAgentTask.title.replace(/^[^：]+：/, "")}`,
        content,
        tags: ["行动草稿", "确认计划", activeAgentTask.status]
      });
      const workspaceId = card.workspace_id || null;
      const nextCards = await listLearningCards(workspaceId || undefined, "all");
      setCardWorkspaceId(workspaceId);
      setCardStatus("all");
      setCardQuery("");
      setCards(nextCards);
      await refreshTraceability();
      setView("cards");
      await selectCard(card);
      setMessage("已从行动草稿生成知识卡片。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleAgentTaskToDailyLog() {
    if (!activeAgentTask) return;
    const date = new Date().toISOString().slice(0, 10);
    const base = dailyDraft?.date === date ? dailyDraft : await generateDailyLog(date);
    setDailyDate(date);
    setDailyDraft({
      ...base,
      content: `${base.content}\n\n## 追加行动草稿\n- ${activeAgentTask.title}\n  - 状态：${operationStatusLabel(activeAgentTask.status)}\n  - 摘要：${activeAgentTask.summary}\n  - 文件操作：${activeAgentTask.operations.length} 项`
    });
    setView("logs");
    setMessage("已把行动草稿加入每日日志草稿。");
  }

  function handleChatAboutAgentTask() {
    if (!activeAgentTask) return;
    setChatContext(`agent_task|${activeAgentTask.id}`);
    setChatDraft(`请围绕行动草稿《${activeAgentTask.title}》解释执行顺序、风险、验证方法和下一步改进。`);
    setView("chat");
  }

  function handleOpenAgentTask(task: AgentTask) {
    setActiveAgentTask(task);
    setSelectedOperationIds(task.operations.filter((operation) => operation.status === "pending").map((operation) => operation.id));
  }

  async function handleOpenGalaxyNode(nodeId: string) {
    const separator = nodeId.indexOf(":");
    const kind = separator >= 0 ? nodeId.slice(0, separator) : nodeId;
    const entityId = separator >= 0 ? nodeId.slice(separator + 1) : "";
    setError(null);
    try {
      if (kind === "report" && entityId) {
        await handleOpenReport(entityId, "history");
        return;
      }
      if (kind === "workspace" && entityId) {
        await handleOpenWorkspace(entityId);
        return;
      }
      if ((kind === "card" || kind === "learning_card") && entityId) {
        await openCardById(entityId);
        return;
      }
      if (kind === "card_material") {
        setView("cards");
        setMessage("已打开知识卡片页，可在卡片详情中查看学习材料。");
        return;
      }
      if (kind === "chat" && entityId) {
        setActiveChat(await getChatSession(entityId));
        setView("chat");
        return;
      }
      if (kind === "agent_task" && entityId) {
        const task = await getAgentTask(entityId);
        handleOpenAgentTask(task);
        setView("agent");
        return;
      }
      if (kind === "finding" && entityId) {
        setFindingReportId(null);
        setFindingWorkspaceId(null);
        setFindingStatus("all");
        setFindingSeverity("all");
        setActiveFindingId(entityId);
        setFindings(await listFindings(undefined, "all", "all"));
        setView("findings");
        setMessage("已打开问题清单，可继续按标题或文件定位该卡片关联的问题。");
        return;
      }
      if (kind === "daily_log") {
        setView("logs");
        return;
      }
      setView(nodeToView(nodeId));
    } catch (err) {
      setError(friendlyError(err));
      setView(nodeToView(nodeId));
    }
  }

  async function handleOpenActivityStar(item: ActivityStarItem) {
    const page = item.route?.page || nodeToView(item.id);
    const targetId = item.route?.target_id || item.route?.session_id || item.route?.plan_id || item.target_id;
    setError(null);
    try {
      if (page === "history" && targetId) {
        await handleOpenReport(targetId, "history");
        return;
      }
      if (page === "projects" && targetId) {
        await handleOpenWorkspace(targetId);
        return;
      }
      if (page === "cards" && targetId && !item.id.startsWith("card_material:")) {
        await openCardById(targetId);
        return;
      }
      if (page === "cards") {
        setView("cards");
        setMessage("已打开知识卡片页，可继续查看卡片和学习材料。");
        return;
      }
      if (page === "chat" && targetId) {
        setActiveChat(await getChatSession(targetId));
        setView("chat");
        return;
      }
      if (page === "agent" && targetId) {
        const task = await getAgentTask(targetId);
        handleOpenAgentTask(task);
        setView("agent");
        return;
      }
      if (page === "findings") {
        setFindingReportId(null);
        setFindingWorkspaceId(null);
        setFindingStatus("all");
        setFindingSeverity("all");
        setActiveFindingId(targetId || null);
        setFindings(await listFindings(undefined, "all", "all"));
        setView("findings");
        return;
      }
      if (page === "logs") {
        setView("logs");
        return;
      }
      if (page === "workbench" || page === "projects" || page === "history") {
        setView(page);
        return;
      }
      await handleOpenGalaxyNode(item.id);
    } catch (err) {
      setError(friendlyError(err));
      setView(nodeToView(item.id));
    }
  }

  function handleReportToAgent() {
    if (!activeReport) return;
    setAgentContext(`report|${activeReport.id}`);
    setAgentGoal(`围绕报告《${activeReport.title}》生成确认式行动草稿`);
    setView("agent");
  }

  function handleFindingToAgent(finding: Finding) {
    setAgentContext(`finding|${finding.id}`);
    setAgentGoal(`围绕问题《${finding.title}》生成确认式行动草稿，先定位影响文件，再给出修复步骤和验证方法`);
    setView("agent");
  }

  async function addReportToDailyLog(report: ReportDetail | null) {
    if (!report) return;
    const date = new Date().toISOString().slice(0, 10);
    const base = dailyDraft?.date === date ? dailyDraft : await generateDailyLog(date);
    setDailyDate(date);
    setDailyDraft({
      ...base,
      content: `${base.content}\n\n## 追加报告\n- ${report.title}：${report.summary}`
    });
    setView("logs");
    setMessage("已把当前报告加入每日日志草稿。");
  }

  async function handleReportToDailyLog() {
    await addReportToDailyLog(activeReport);
  }

  function openReportChat(report: ReportDetail | null) {
    if (!report) return;
    setChatContext(`report|${report.id}`);
    setChatDraft(`请围绕报告《${report.title}》继续解释关键风险和下一步行动。`);
    setView("chat");
  }

  function handleReportToChat() {
    openReportChat(activeReport);
  }

  function handleFindingToChat(finding: Finding) {
    setChatContext(`finding|${finding.id}`);
    setChatDraft(`请围绕问题《${finding.title}》分析原因、影响范围、验证方法和修复建议。`);
    setView("chat");
  }

  async function handleFindingToDailyLog(finding: Finding) {
    const date = new Date().toISOString().slice(0, 10);
    const base = dailyDraft?.date === date ? dailyDraft : await generateDailyLog(date);
    setDailyDate(date);
    setDailyDraft({
      ...base,
      content: `${base.content}\n\n## 追加问题\n- ${finding.title}：${finding.detail}\n  - 文件：${finding.file_path || "未关联文件"}\n  - 建议：${finding.suggestion || "继续复查影响范围"}`
    });
    setView("logs");
    setMessage("已把当前问题加入每日日志草稿。");
  }

  async function openReportFindings(report: ReportDetail | null) {
    if (!report) return;
    setFindingReportId(report.id);
    setFindingWorkspaceId(null);
    setFindingStatus("all");
    setFindingSeverity("all");
    const linkedFindings = await listFindings(undefined, "all", "all", report.id);
    setFindings(linkedFindings);
    setActiveFindingId(linkedFindings[0]?.id || null);
    setView("findings");
    setMessage(`已切换到报告《${report.title}》关联的问题清单。`);
  }

  async function openWorkspaceFindings() {
    const workspaceId = activeWorkspace?.summary.id;
    if (!workspaceId) return;
    setFindingReportId(null);
    setFindingWorkspaceId(workspaceId);
    setFindingStatus("all");
    setFindingSeverity("all");
    const workspaceFindings = await listFindings(workspaceId, "all", "all");
    setFindings(workspaceFindings);
    setActiveFindingId(workspaceFindings[0]?.id || null);
    setView("findings");
  }

  async function openWorkspaceCards() {
    await openCardsForWorkspace(activeWorkspace?.summary.id);
  }

  async function openWorkspaceLogs() {
    await refreshDaily();
    setView("logs");
  }

  async function handleReportToFindings() {
    await openReportFindings(activeReport);
  }

  async function handleImportSingleAnalysisFile() {
    setError(null, "workbench-single");
    try {
      const result = await importSingleCodeFile();
      const file = result.files[0];
      if (!file) throw new Error("没有导入可读取的代码文件。");
      setSingleCode(file.content);
      setSingleSourceLabel(file.path);
      setSingleLanguage(file.language || "auto");
      setSingleReport(null);
      setSingleTraceability(null);
      setMessage(`已导入单文件：${file.path}`, "workbench-single");
    } catch (err) {
      setError(friendlyError(err), "workbench-single");
    }
  }

  async function handleAnalyzeSingleCode() {
    if (!singleCode.trim()) {
      setError("请先粘贴代码或导入一个代码文件。", "workbench-single");
      return;
    }
    setBusyArea("single");
    setError(null, "workbench-single");
    try {
      const response = await analyzeCode({
        source_label: singleSourceLabel || undefined,
        language: singleLanguage,
        mode_group: singleModeGroup,
        mode: singleMode,
        mode_label: singleModeLabel(singleMode),
        code: singleCode,
        use_llm: true
      });
      setSingleReport(response.report);
      if (singleGenerateCards) {
        const candidates = await generateCardCandidatesFromReport(response.report.id);
        setCardCandidates(candidates);
        setSelectedCandidateIds(candidates.map((item) => item.id));
      }
      const [, , snapshot] = await Promise.all([refreshReports(), refreshActivity(), getTraceabilitySnapshot("report", response.report.id)]);
      setSingleTraceability(snapshot);
      setMessage(
        response.warnings[0] ||
        (singleGenerateCards ? "单文件报告已生成，并已提取知识卡片候选。" : "单文件代码分析报告已生成。"),
        "workbench-single"
      );
    } catch (err) {
      setError(friendlyError(err), "workbench-single");
    } finally {
      setBusyArea(null);
    }
  }

  async function handleImportDiffFile(side: "before" | "after") {
    setError(null);
    try {
      const result = await importSingleCodeFile();
      const file = result.files[0];
      if (!file) throw new Error("没有导入可读取的文件。");
      if (side === "before") {
        setBeforeLabel(file.path);
        setBeforeCode(file.content);
      } else {
        setAfterLabel(file.path);
        setAfterCode(file.content);
      }
      if (file.language) setDiffLanguage(file.language);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleAnalyzeDiff() {
    if (!beforeCode.trim() || !afterCode.trim()) {
      setError("请同时提供旧版本和新版本代码。");
      return;
    }
    setBusyArea("diff");
    setDiffStream("");
    setError(null);
    try {
      const response = await analyzeDiffStream(
        {
          title: diffTitle.trim() || undefined,
          language: diffLanguage,
          before_label: beforeLabel.trim() || "旧版本",
          before_code: beforeCode,
          after_label: afterLabel.trim() || "新版本",
          after_code: afterCode,
          use_llm: true
        },
        (chunk) => setDiffStream((value) => value + chunk)
      );
      setActiveReport(response.report);
      const [nextReports, nextWorkspaceReports, reportSnapshot] = await Promise.all([
        listReports(historyQuery, reportFilter === "all" ? undefined : reportFilter),
        listReports(),
        getTraceabilitySnapshot("report", response.report.id)
      ]);
      setReports(nextReports);
      setWorkspaceReports(nextWorkspaceReports);
      setTraceability(reportSnapshot);
      setMessage(response.warnings[0] || "代码对比报告已生成。");
      setView("history");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleSendChat(event: FormEvent) {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text) return;
    const [contextKind, contextId] = chatContext.split("|", 2);
    setBusyArea("chat");
    setChatDraft("");
    setPendingUserMessage(text);
    setChatStream("");
    setError(null);
    try {
      const session = await sendChatMessageStream(
        {
          session_id: activeChat?.id || null,
          message: text,
          context_report_id: contextKind === "report" ? contextId : null,
          context_kind: contextKind === "none" ? null : contextKind,
          context_id: contextKind === "none" ? null : contextId
        },
        (chunk) => setChatStream((value) => value + chunk)
      );
      setActiveChat(session);
      setChatSessions(await listChatSessions(chatQuery));
    } catch (err) {
      setError(friendlyError(err));
      setChatDraft(text);
    } finally {
      setPendingUserMessage(null);
      setChatStream("");
      setBusyArea(null);
    }
  }

  async function handleOpenChat(id: string) {
    setActiveChat(await getChatSession(id));
  }

  async function handleDeleteChat(id: string) {
    await deleteChatSession(id);
    if (activeChat?.id === id) setActiveChat(null);
    setChatSessions(await listChatSessions(chatQuery));
  }

  async function handleOpenReport(id: string, targetView: View = "history") {
    const requestVersion = ++reportOpenVersionRef.current;
    const failureScope: NoticeScope = view === "workbench"
      ? (workbenchMode === "project" ? "workbench-project" : "workbench-single")
      : targetView === "history"
        ? "report"
        : "global";
    setOpeningReportId(id);
    setError(null, failureScope);
    try {
      const report = await getReport(id);
      if (requestVersion !== reportOpenVersionRef.current) return;
      setActiveReport(report);
      setTraceability(null);
      setView(targetView);

      void getTraceabilitySnapshot("report", id)
        .then((snapshot) => {
          if (requestVersion !== reportOpenVersionRef.current) return;
          setTraceability(snapshot);
        })
        .catch(() => {
          // The report remains fully readable when its optional closure data is unavailable.
        });
    } catch (err) {
      if (requestVersion === reportOpenVersionRef.current) {
        setError(`报告恢复失败：${friendlyError(err)}`, failureScope);
      }
    } finally {
      if (requestVersion === reportOpenVersionRef.current) setOpeningReportId(null);
    }
  }

  async function handleDeleteReport(id: string, replacementId: string | null) {
    const deletedWasActive = activeReport?.id === id;
    ++reportOpenVersionRef.current;
    setOpeningReportId(null);
    setError(null, "report");
    await deleteReport(id);
    const [nextReports, nextWorkspaceReports, workspaceSnapshot] = await Promise.all([
      listReports(historyQuery, reportFilter === "all" ? undefined : reportFilter),
      listReports(),
      refreshWorkspaceTraceability()
    ]);
    setReports(nextReports);
    setWorkspaceReports(nextWorkspaceReports);
    const survivingCandidateIds = new Set(cardCandidates.filter((item) => item.report_id !== id).map((item) => item.id));
    setCardCandidates((items) => items.filter((item) => item.report_id !== id));
    setSelectedCandidateIds((items) => items.filter((candidateId) => survivingCandidateIds.has(candidateId)));
    if (singleReport?.id === id) {
      setSingleReport(null);
      setSingleTraceability(null);
    }
    if (deletedWasActive) {
      setActiveReport(null);
      setTraceability(workspaceSnapshot || await getTraceabilitySnapshot("global"));
    }
    await Promise.all([refreshAgent(), refreshActivity()]);
    setMessage("历史报告已删除。", "report");
    if (deletedWasActive && replacementId && nextReports.some((item) => item.id === replacementId)) {
      await handleOpenReport(replacementId, "history");
    }
  }

  async function handleRenameReport(id: string, title: string) {
    const updated = await renameReport(id, title);
    const updateSummary = (items: ReportSummary[]) => items.map((item) => item.id === id ? { ...item, title: updated.title } : item);
    setReports(updateSummary);
    setWorkspaceReports(updateSummary);
    if (activeReport?.id === id) {
      setActiveReport(updated);
      setTraceability(await getTraceabilitySnapshot("report", id));
    }
    if (singleReport?.id === id) {
      setSingleReport(updated);
      setSingleTraceability(await getTraceabilitySnapshot("report", id));
    }
    setMessage("报告标题已更新。", activeReport?.id === id ? "report" : "workbench-single");
  }

  async function copySpecificReport(report: ReportDetail | null, scope: NoticeScope) {
    if (!report || reportOperation) return;
    setReportOperation("copy");
    setError(null, scope);
    try {
      await copyReportText(report.id, report.full_report);
      setMessage("报告已复制到剪贴板。", scope);
    } catch (err) {
      setError(`复制报告失败：${friendlyError(err)}`, scope);
    } finally {
      setReportOperation(null);
    }
  }

  async function exportSpecificReport(report: ReportDetail | null, kind: "md" | "html", scope: NoticeScope) {
    if (!report || reportOperation) return;
    setReportOperation("export");
    setError(null, scope);
    try {
      const path = kind === "md" ? await exportReportMarkdown(report.id) : await exportReportHtml(report.id);
      setMessage(`${kind.toUpperCase()} 已导出：${path}`, scope);
    } catch (err) {
      setError(`导出报告失败：${friendlyError(err)}`, scope);
    } finally {
      setReportOperation(null);
    }
  }

  async function handleCopyReport() {
    await copySpecificReport(activeReport, "report");
  }

  async function handleExportReport(kind: "md" | "html") {
    await exportSpecificReport(activeReport, kind, "report");
  }

  async function handleExportProductArchive() {
    setBusyArea("archive");
    setError(null);
    setMessage(null);
    try {
      const archive = await exportProductArchive();
      setMessage(`本地档案已导出：${archive.index_path}`);
      await refreshActivity();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleImportProductArchive() {
    setBusyArea("archive");
    setError(null);
    setMessage(null);
    try {
      const result = await importProductArchive();
      const warningText = result.warnings.length ? `，提示：${result.warnings.join("；")}` : "";
      setMessage(`本地档案已导入，导入前备份：${result.backup_path}${warningText}`);
      await refreshAll();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    setBusyArea("settings");
    setError(null);
    try {
      const nextSettings = await saveSettings({
        enable_llm: enableLlm,
        api_base: apiBase,
        model,
        api_key: apiKey || undefined,
        clear_api_key: clearApiKey
      });
      setSettings(nextSettings);
      setApiKey("");
      setClearApiKey(false);
      setHealth(await getAppHealth());
      setMessage("设置已保存。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleTestLlm() {
    setBusyArea("llm-test");
    setError(null);
    setLlmTestResult(null);
    try {
      const result = await testLlmConnection(apiKey || undefined);
      setLlmTestResult(`${result.ok ? "连接成功" : "连接失败"}：${result.message}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleSaveModelProfile() {
    const name = profileName.trim() || `${model || "模型"} 配置`;
    setBusyArea("settings");
    setError(null);
    try {
      await saveModelProfile({
        id: null,
        name,
        api_base: apiBase,
        model,
        note: profileNote || "用户自定义模型档案。",
        is_default: profileDefault
      });
      setModelProfiles(await listModelProfiles());
      setProfileName("");
      setProfileNote("");
      setProfileDefault(false);
      setMessage("模型档案已保存。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleApplyModelProfile(profile: ModelProfile) {
    setApiBase(profile.api_base);
    setModel(profile.model);
    setEnableLlm(true);
    setMessage(`已应用模型档案：${profile.name}，保存设置后生效。`);
  }

  async function handleDeleteModelProfile(id: string) {
    setBusyArea("settings");
    setError(null);
    try {
      setModelProfiles(await deleteModelProfile(id));
      setMessage("模型档案已删除。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  const navGroups: ProductNavGroup[] = [
    {
      title: "审查主线",
      items: [
        { key: "workbench", label: "审查工作台", description: "项目审查与单文件分析", icon: <FileCode2 size={18} />, active: view === "workbench", onClick: () => setView("workbench") },
        { key: "history", label: "历史报告", description: "阅读与导出审查报告", icon: <History size={18} />, active: view === "history", onClick: () => setView("history") },
        { key: "findings", label: "问题清单", description: "跟踪风险与修复建议", icon: <ShieldAlert size={18} />, active: view === "findings", onClick: () => setView("findings") }
      ]
    },
    {
      title: "项目视图",
      items: [
        { key: "guide", label: "项目导览", description: "架构摘要与阅读路线", icon: <Map size={18} />, active: view === "guide", onClick: handleLoadProjectGuide },
        { key: "map", label: "代码地图", description: "符号、依赖与热点文件", icon: <GitBranch size={18} />, active: view === "map", onClick: handleLoadCodeMap },
        { key: "diff", label: "代码对比", description: "审查两个版本差异", icon: <Columns3 size={18} />, active: view === "diff", onClick: () => setView("diff") }
      ]
    },
    {
      title: "沉淀复盘",
      items: [
        { key: "galaxy", label: "活动展示台", description: "浏览本地活动卡片", icon: <Activity size={18} />, active: view === "galaxy", onClick: () => { setView("galaxy", "explore"); refreshActivity(); } },
        { key: "cards", label: "知识卡片", description: "从报告和问题沉淀知识", icon: <GraduationCap size={18} />, active: view === "cards", onClick: () => { void openCardsForWorkspace(); } },
        { key: "logs", label: "每日日志", description: "记录学习与审查活动", icon: <FileText size={18} />, active: view === "logs", onClick: () => { setView("logs"); refreshDaily(); } },
        { key: "chat", label: "AI 对话", description: "围绕报告继续追问", icon: <MessageSquare size={18} />, active: view === "chat", onClick: () => setView("chat") },
        { key: "agent", label: "行动草稿", description: "可选确认式草稿", icon: <Bot size={18} />, active: view === "agent", onClick: () => setView("agent") }
      ]
    },
    {
      title: "系统",
      items: [
        { key: "settings", label: "设置", description: "模型、Key 与偏好", icon: <SettingsIcon size={18} />, active: view === "settings", onClick: () => setView("settings") },
        { key: "health", label: "状态", description: "本地存储与运行状态", icon: <Database size={18} />, active: view === "health", onClick: () => setView("health") }
      ]
    }
  ];

  const globalCommands = useMemo<ProductGlobalCommand[]>(() => {
    const actionCommands: ProductGlobalCommand[] = [];

    if (activeWorkspace) {
      actionCommands.push(
        {
          key: `action:workspace-analyze:${activeWorkspace.summary.id}`,
          label: "分析当前工作区",
          description: `${activeWorkspace.summary.name} / 生成项目级审查报告`,
          group: "上下文动作",
          icon: <Layers3 size={18} />,
          keywords: ["项目分析", "工作区审查", "生成报告", activeWorkspace.summary.name],
          onClick: handleAnalyzeWorkspace
        },
        {
          key: `action:workspace-map:${activeWorkspace.summary.id}`,
          label: "查看当前工作区代码地图",
          description: "语言分布、热点文件、符号与依赖关系",
          group: "上下文动作",
          icon: <GitBranch size={18} />,
          keywords: ["代码地图", "依赖", "符号", activeWorkspace.summary.name],
          active: view === "map",
          onClick: handleLoadCodeMap
        },
        {
          key: `action:workspace-guide:${activeWorkspace.summary.id}`,
          label: "生成当前项目导览",
          description: "架构摘要、关键文件和推荐阅读路线",
          group: "上下文动作",
          icon: <Map size={18} />,
          keywords: ["项目导览", "架构", "阅读路线", activeWorkspace.summary.name],
          active: view === "guide",
          onClick: handleGenerateProjectGuide
        },
        {
          key: `action:workspace-agent:${activeWorkspace.summary.id}`,
          label: "围绕当前工作区生成行动草稿",
          description: "把当前工作区作为上下文，生成可确认行动草稿",
          group: "上下文动作",
          icon: <Bot size={18} />,
          keywords: ["行动草稿", "修复计划", "工作区", activeWorkspace.summary.name],
          onClick: () => {
            setAgentContext(`workspace|${activeWorkspace.summary.id}`);
            setAgentGoal(`围绕工作区《${activeWorkspace.summary.name}》生成确认式行动草稿`);
            setView("agent");
          }
        },
        {
          key: `action:workspace-bridge:${activeWorkspace.summary.id}`,
          label: "高级：导出当前工作区桥接清单",
          description: "同步到 storage/bridge/current，供外部编辑器读取",
          group: "上下文动作",
          icon: <FileCode2 size={18} />,
          keywords: ["桥接", "VS Code", "manifest", activeWorkspace.summary.name],
          onClick: handleExportWorkspaceBridgeManifest
        }
      );
    }

    if (activeReport) {
      actionCommands.push(
        {
          key: `action:report-card:${activeReport.id}`,
          label: "从当前报告生成知识卡片候选",
          description: activeReport.title,
          group: "上下文动作",
          icon: <GraduationCap size={18} />,
          keywords: ["知识卡片", "候选", "学习", activeReport.summary],
          onClick: handleGenerateCandidatesFromActiveReport
        },
        {
          key: `action:report-agent:${activeReport.id}`,
          label: "围绕当前报告生成行动草稿",
          description: "把报告风险和建议转成确认式行动草稿",
          group: "上下文动作",
          icon: <Bot size={18} />,
          keywords: ["行动草稿", "报告", "计划", activeReport.title],
          onClick: handleReportToAgent
        },
        {
          key: `action:report-chat:${activeReport.id}`,
          label: "围绕当前报告对话",
          description: "继续追问关键风险、修复顺序和测试建议",
          group: "上下文动作",
          icon: <MessageSquare size={18} />,
          keywords: ["AI 对话", "报告解释", activeReport.title],
          onClick: handleReportToChat
        },
        {
          key: `action:report-log:${activeReport.id}`,
          label: "把当前报告加入每日日志",
          description: "沉淀到今日学习与审查记录",
          group: "上下文动作",
          icon: <FileText size={18} />,
          keywords: ["每日日志", "学习记录", activeReport.title],
          onClick: handleReportToDailyLog
        },
        {
          key: `action:report-findings:${activeReport.id}`,
          label: "查看当前报告关联问题",
          description: "切换到问题清单并按报告筛选",
          group: "上下文动作",
          icon: <ShieldAlert size={18} />,
          keywords: ["问题清单", "风险", activeReport.title],
          onClick: handleReportToFindings
        }
      );
    }

    if (activeAgentTask) {
      actionCommands.push(
        {
          key: `action:agent-card:${activeAgentTask.id}`,
          label: "从当前行动草稿生成知识卡片",
          description: activeAgentTask.title,
          group: "上下文动作",
          icon: <GraduationCap size={18} />,
          keywords: ["行动草稿", "知识卡片", "复盘", activeAgentTask.summary],
          onClick: handleAgentTaskToLearningCard
        },
        {
          key: `action:agent-log:${activeAgentTask.id}`,
          label: "把当前行动草稿加入每日日志",
          description: "记录执行计划、状态和文件操作数量",
          group: "上下文动作",
          icon: <FileText size={18} />,
          keywords: ["行动草稿", "日志", "复盘", activeAgentTask.title],
          onClick: handleAgentTaskToDailyLog
        },
        {
          key: `action:agent-chat:${activeAgentTask.id}`,
          label: "围绕当前行动草稿对话",
          description: "追问步骤、风险、验证方式和回滚点",
          group: "上下文动作",
          icon: <MessageSquare size={18} />,
          keywords: ["行动草稿", "AI 对话", activeAgentTask.title],
          onClick: handleChatAboutAgentTask
        }
      );
    }

    if (activeCardId) {
      const activeCard = cards.find((card) => card.id === activeCardId);
      if (activeCard) {
        actionCommands.push({
          key: `action:card-material:${activeCard.id}`,
          label: "为当前知识卡片生成学习材料",
          description: activeCard.title,
          group: "上下文动作",
          icon: <GraduationCap size={18} />,
          keywords: ["学习材料", "知识卡片", activeCard.content, ...activeCard.tags],
          onClick: () => handleGenerateCardMaterial(activeCard.id)
        });
      }
    }

    const reportCommands = reports.slice(0, 16).map((report) => ({
      key: `report:${report.id}`,
      label: report.title,
      description: `${reportTypeLabel(report.report_type)} / ${riskLabel(report.risk_level)} / ${report.summary}`,
      group: "报告",
      icon: <FileText size={18} />,
      keywords: [report.id, report.language, report.analysis_source, report.report_type, report.risk_level, report.summary],
      active: activeReport?.id === report.id,
      onClick: () => handleOpenReport(report.id, "history")
    }));

    const workspaceCommands = workspaces.slice(0, 12).map((workspace) => ({
      key: `workspace:${workspace.id}`,
      label: workspace.name,
      description: `${workspace.file_count} 个文件 / ${workspace.total_lines} 行 / ${workspace.language_summary}`,
      group: "工作区",
      icon: <Layers3 size={18} />,
      keywords: [workspace.id, workspace.root_path, workspace.language_summary],
      active: activeWorkspace?.summary.id === workspace.id,
      onClick: () => handleOpenWorkspace(workspace.id)
    }));

    const findingCommands = findings.slice(0, 18).map((finding) => ({
      key: `finding:${finding.id}`,
      label: finding.title,
      description: `${severityLabel(finding.severity)} / ${finding.status} / ${finding.file_path}`,
      group: "问题",
      icon: <ShieldAlert size={18} />,
      keywords: [finding.id, finding.category, finding.detail, finding.suggestion, finding.file_path, finding.status],
      active: view === "findings",
      onClick: () => handleOpenFinding(finding)
    }));

    const cardCommands = cards.slice(0, 16).map((card) => ({
      key: `card:${card.id}`,
      label: card.title,
      description: `${card.status} / ${card.tags.join("、") || "未设置标签"}`,
      group: "知识卡片",
      icon: <GraduationCap size={18} />,
      keywords: [card.id, card.content, card.status, ...card.tags],
      active: activeCardId === card.id,
      onClick: () => handleOpenCardFromDaily(card.id)
    }));

    const chatCommands = chatSessions.slice(0, 10).map((session) => ({
      key: `chat:${session.id}`,
      label: session.title,
      description: `${session.message_count} 条消息 / ${formatTime(session.updated_at)}`,
      group: "AI 对话",
      icon: <MessageSquare size={18} />,
      keywords: [session.id, session.context_report_id || ""],
      active: activeChat?.id === session.id,
      onClick: async () => {
        setActiveChat(await getChatSession(session.id));
        setView("chat");
      }
    }));

    const agentCommands = agentTasks.slice(0, 12).map((task) => ({
      key: `agent:${task.id}`,
      label: task.title,
      description: `${agentTaskStatusLabel(task.status)} / ${task.summary}`,
      group: "行动草稿",
      icon: <Bot size={18} />,
      keywords: [task.id, task.context_kind, task.context_id, task.apply_summary, ...task.selected_file_paths],
      active: activeAgentTask?.id === task.id,
      onClick: () => {
        handleOpenAgentTask(task);
        setView("agent");
      }
    }));

    const dailyLogCommands = dailyLogs.slice(0, 10).map((log) => ({
      key: `daily-log:${log.id}`,
      label: log.title,
      description: `${log.date} / 每日学习记录`,
      group: "每日日志",
      icon: <FileText size={18} />,
      keywords: [log.id, log.date, log.content],
      active: dailyDraft?.id === log.id,
      onClick: () => {
        setDailyDate(log.date);
        setDailyDraft(log);
        setView("logs");
      }
    }));

    return [
      ...actionCommands,
      ...workspaceCommands,
      ...reportCommands,
      ...findingCommands,
      ...cardCommands,
      ...chatCommands,
      ...agentCommands,
      ...dailyLogCommands
    ];
  }, [
    activeAgentTask?.id,
    activeAgentTask?.summary,
    activeAgentTask?.title,
    activeCardId,
    activeChat?.id,
    activeReport?.id,
    activeReport?.summary,
    activeReport?.title,
    activeWorkspace?.summary.id,
    activeWorkspace?.summary.name,
    agentTasks,
    cards,
    chatSessions,
    dailyDraft?.id,
    dailyLogs,
    findings,
    reports,
    view,
    workspaces
  ]);

  const activeNoticeScope: NoticeScope = view === "workbench"
    ? (workbenchMode === "project" ? "workbench-project" : "workbench-single")
    : view === "history"
      ? "report"
      : "global";
  const visibleMessage = message && (messageScope === "global" || messageScope === activeNoticeScope) ? message : null;
  const visibleError = error && (errorScope === "global" || errorScope === activeNoticeScope) ? error : null;

  if (view === "galaxy" && galaxyMode === "entry") {
    return (
      <Suspense fallback={<div className="galaxy-entry-loading-next"><Loader2 className="spin" size={24} /><p>正在加载活动展示台...</p></div>}>
        <ActivityGalaxyView
          mode="entry"
          constellation={activityConstellation}
          onRefresh={refreshActivity}
          onEnterWorkbench={() => setView("workbench")}
          onOpenActivity={handleOpenActivityStar}
        />
      </Suspense>
    );
  }

  return (
    <ProductShell
      activeSubtitle={viewSubtitle(view)}
      activeTitle={viewTitle(view)}
      databaseOk={Boolean(health?.database_ok)}
      error={visibleError}
      globalCommands={globalCommands}
      llmConfigured={Boolean(settings?.api_key_set)}
      message={visibleMessage}
      onDismissMessage={() => setMessage(null)}
      onDismissError={() => setError(null)}
      navGroups={navGroups}
      onRefresh={refreshAll}
      statusText={statusText}
      theme={theme}
      onToggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")}
      version={health?.version || "1.0.0"}
    >

        {view === "workbench" && (
          <CodeWorkbenchView
            workbenchMode={workbenchMode}
            language={singleLanguage}
            modeGroup={singleModeGroup}
            mode={singleMode}
            generateCards={singleGenerateCards}
            code={singleCode}
            report={singleReport}
            traceability={singleTraceability}
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            recentReports={workspaceReports}
            workspaceTraceability={workspaceTraceability}
            workspaceQuery={workspaceQuery}
            workspaceStream={workspaceStream}
            singleBusy={busyArea === "single"}
            reportOperationBusy={reportOperation !== null}
            workspaceBusy={busyArea === "workspace"}
            onWorkbenchModeChange={changeWorkbenchMode}
            onLanguageChange={setSingleLanguage}
            onModeGroupChange={(value) => {
              setSingleModeGroup(value);
              setSingleMode(value === "script" ? "script_review" : "risk_review");
            }}
            onModeChange={setSingleMode}
            onGenerateCardsChange={setSingleGenerateCards}
            onCodeChange={(value) => {
              setSingleCode(value);
              if (singleReport) {
                setSingleReport(null);
                setSingleTraceability(null);
              }
            }}
            onImportFile={handleImportSingleAnalysisFile}
            onLoadSample={() => {
              setSingleCode(sampleSingleCode);
              setSingleSourceLabel(null);
              setSingleLanguage("TypeScript");
              setSingleModeGroup("function");
              setSingleMode("risk_review");
              setSingleReport(null);
              setSingleTraceability(null);
            }}
            onClear={() => {
              setSingleCode("");
              setSingleSourceLabel(null);
              setSingleReport(null);
              setSingleTraceability(null);
            }}
            onAnalyze={handleAnalyzeSingleCode}
            onCopyReport={() => copySpecificReport(singleReport, "workbench-single")}
            onExportReport={(kind) => exportSpecificReport(singleReport, kind, "workbench-single")}
            onGenerateCandidates={() => handleGenerateCandidatesForReport(singleReport)}
            onOpenFindings={() => openReportFindings(singleReport)}
            onAddDailyLog={() => addReportToDailyLog(singleReport)}
            onChatAboutReport={() => openReportChat(singleReport)}
            onRenameReport={handleRenameReport}
            onImportWorkspace={handleImportWorkspace}
            onAnalyzeWorkspace={handleAnalyzeWorkspace}
            onWorkspaceQueryChange={setWorkspaceQuery}
            onSearchWorkspaces={refreshWorkspaces}
            onOpenWorkspace={handleOpenWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
            onRescanWorkspace={handleRescanWorkspace}
            onOpenCodeMap={handleLoadCodeMap}
            onOpenProjectGuide={handleLoadProjectGuide}
            onOpenReport={(id) => handleOpenReport(id, "history")}
            onOpenWorkspaceFindings={openWorkspaceFindings}
            onOpenWorkspaceCards={openWorkspaceCards}
            onOpenWorkspaceLogs={openWorkspaceLogs}
          />
        )}

        {view === "map" && <CodeMapView activeWorkspace={activeWorkspace} codeMap={codeMap} onRefresh={handleLoadCodeMap} onBack={() => setView("workbench")} onOpenGuide={handleLoadProjectGuide} />}

        {view === "guide" && (
          <ProjectGuideView
            activeWorkspace={activeWorkspace}
            guide={projectGuide}
            busy={busyArea === "guide"}
            onGenerate={handleGenerateProjectGuide}
            onBack={() => setView("workbench")}
            onOpenCodeMap={handleLoadCodeMap}
          />
        )}

        {view === "findings" && (
          <FindingsView
            findings={findings}
            reports={workspaceReports.length ? workspaceReports : reports}
            status={findingStatus}
            severity={findingSeverity}
            linkedReportTitle={findingReportId
              ? activeReport?.id === findingReportId
                ? activeReport.title
                : workspaceReports.find((report) => report.id === findingReportId)?.title || reports.find((report) => report.id === findingReportId)?.title || "关联报告"
              : null}
            activeFindingId={activeFindingId}
            busy={busyArea === "cards"}
            onSelectFinding={setActiveFindingId}
            onStatusFilter={handleFindingStatusFilter}
            onSeverityFilter={handleFindingSeverityFilter}
            onClearReportLink={handleClearFindingReportLink}
            onResetFilters={handleResetFindingFilters}
            onUpdate={handleUpdateFinding}
            onCreateCards={handleCreateCards}
            onChatAboutFinding={handleFindingToChat}
            onAddDailyLog={handleFindingToDailyLog}
          />
        )}

        {view === "diff" && (
          <CodeDiffView
            title={diffTitle}
            language={diffLanguage}
            beforeLabel={beforeLabel}
            afterLabel={afterLabel}
            beforeCode={beforeCode}
            afterCode={afterCode}
            stream={diffStream}
            busy={busyArea === "diff"}
            onTitleChange={setDiffTitle}
            onLanguageChange={setDiffLanguage}
            onBeforeLabelChange={setBeforeLabel}
            onAfterLabelChange={setAfterLabel}
            onBeforeCodeChange={setBeforeCode}
            onAfterCodeChange={setAfterCode}
            onImportBefore={() => handleImportDiffFile("before")}
            onImportAfter={() => handleImportDiffFile("after")}
            onAnalyze={handleAnalyzeDiff}
          />
        )}

        {view === "chat" && (
          <AiChatView
            sessions={chatSessions}
            messages={displayedChatMessages}
            reports={reports}
            workspaces={workspaces}
            workspace={activeWorkspace}
            findings={findings}
            activeChat={activeChat}
            query={chatQuery}
            draft={chatDraft}
            context={chatContext}
            busy={busyArea === "chat"}
            llmReady={Boolean(settings?.enable_llm && settings.api_key_set)}
            onQueryChange={setChatQuery}
            onSearch={async () => setChatSessions(await listChatSessions(chatQuery))}
            onNew={() => { setActiveChat(null); setChatDraft(""); setChatStream(""); setPendingUserMessage(null); }}
            onOpen={handleOpenChat}
            onDelete={handleDeleteChat}
            onDraftChange={setChatDraft}
            onContextChange={setChatContext}
            onSubmit={handleSendChat}
            onOpenSettings={() => setView("settings")}
          />
        )}

        {view === "cards" && (
          <LearningCardsView
            cards={cards}
            materials={cardMaterials}
            activeCardId={activeCardId}
            status={cardStatus}
            query={cardQuery}
            manualTitle={manualCardTitle}
            manualContent={manualCardContent}
            manualTags={manualCardTags}
            candidates={cardCandidates}
            selectedCandidateIds={selectedCandidateIds}
            sourceFinding={activeCardSourceFinding}
            sourceReportTitle={activeCardSourceFinding?.report_id
              ? activeReport?.id === activeCardSourceFinding.report_id
                ? activeReport.title
                : workspaceReports.find((report) => report.id === activeCardSourceFinding.report_id)?.title || reports.find((report) => report.id === activeCardSourceFinding.report_id)?.title || "关联报告"
              : null}
            onStatusFilter={handleCardStatusFilter}
            onQueryChange={setCardQuery}
            onManualTitleChange={setManualCardTitle}
            onManualContentChange={setManualCardContent}
            onManualTagsChange={setManualCardTags}
            onToggleCandidate={(id, selected) => setSelectedCandidateIds((items) => selected ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id))}
            onApproveCandidates={handleApproveSelectedCandidates}
            onRejectCandidate={handleRejectCandidate}
            onGenerateCandidates={handleGenerateCandidatesFromActiveReport}
            onCreateManual={handleCreateManualCard}
            onUpdate={handleUpdateCard}
            onDelete={handleDeleteCard}
            onGenerateMaterial={handleGenerateCardMaterial}
            onSelectCard={async (id) => {
              if (!id) {
                ++cardSelectionVersionRef.current;
                setActiveCardId(null);
                setCardMaterials([]);
                setActiveCardSourceFinding(null);
                return;
              }
              const card = cards.find((item) => item.id === id);
              if (card) await selectCard(card);
            }}
            onOpenSourceFinding={activeCardSourceFinding ? () => void handleOpenFinding(activeCardSourceFinding) : undefined}
            onOpenSourceReport={activeCardSourceFinding?.report_id ? () => void handleOpenReport(activeCardSourceFinding.report_id!, "history") : undefined}
            onExportCards={handleExportLearningCards}
            busy={busyArea === "cards" || busyArea === "material"}
          />
        )}

        {view === "logs" && (
          <DailyLearningCenterView
            date={dailyDate}
            summary={dailySummary}
            logs={dailyLogs}
            center={learningCenter}
            draft={dailyDraft}
            busy={busyArea === "daily-log"}
            onDateChange={selectDailyDate}
            onGenerate={handleGenerateDailyLog}
            onSave={handleSaveDailyLog}
            onStartManual={handleStartManualDailyLog}
            onCopy={handleCopyDailyLog}
            onExport={handleExportDailyLog}
            onRefresh={() => refreshDaily(dailyDate)}
            onOpenCard={handleOpenCardFromDaily}
            onDraftTitleChange={(value) => setDailyDraft((draft) => draft ? { ...draft, title: value } : draft)}
            onDraftContentChange={(value) => setDailyDraft((draft) => draft ? { ...draft, content: value } : draft)}
            onOpenLog={(log) => setDailyDraft(log)}
            onDiscardDraft={() => setDailyDraft((draft) => draft?.date === dailyDate ? null : draft)}
          />
        )}

        {view === "agent" && (
          <AgentWorkspaceView
            tasks={agentTasks}
            activeTask={activeAgentTask}
            goal={agentGoal}
            context={agentContext}
            workspaces={workspaces}
            reports={reports}
            findings={findings}
            activeWorkspace={activeWorkspace}
            bridgeStatus={workspaceBridge}
            bridgeInbox={workspaceBridgeInbox}
            selectedOperationIds={selectedOperationIds}
            busy={busyArea === "agent"}
            onGoalChange={setAgentGoal}
            onContextChange={setAgentContext}
            onToggleBridgeFile={handleToggleBridgeFile}
            onToggleOperation={(id, selected) => setSelectedOperationIds((items) => selected ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id))}
            onApply={handleApplyAgentPlan}
            onRollbackOperation={handleRollbackAgentOperation}
            onCreateCard={handleAgentTaskToLearningCard}
            onAddDailyLog={handleAgentTaskToDailyLog}
            onChatAboutTask={handleChatAboutAgentTask}
            onRefreshBridge={() => refreshBridge()}
            onRefreshBridgeInbox={refreshBridgeInbox}
            onExportBridgeManifest={handleExportWorkspaceBridgeManifest}
            onCreateFromBridgeInbox={handleCreateAgentPlanFromBridgeInbox}
            onCreate={handleCreateAgentPlan}
            onOpen={handleOpenAgentTask}
            onDelete={handleDeleteAgentTask}
            onExport={handleExportAgentTask}
          />
        )}

        {view === "galaxy" && (
          <Suspense fallback={<div className="workbench-empty-next compact"><Loader2 className="spin" size={22} /><p>正在加载活动展示台...</p></div>}>
            <ActivityGalaxyView
              mode="explore"
              constellation={activityConstellation}
              onRefresh={refreshActivity}
              onEnterWorkbench={() => setView("workbench")}
              onOpenActivity={handleOpenActivityStar}
            />
          </Suspense>
        )}

        {view === "history" && (
          <HistoryReportsView
            reports={reports}
            query={historyQuery}
            filter={reportFilter}
            activeReport={activeReport}
            traceability={traceability}
            openingReportId={openingReportId}
            reportOperationBusy={reportOperation !== null}
            onQueryChange={setHistoryQuery}
            onFilterChange={async (value) => { setReportFilter(value); setReports(await listReports(historyQuery, value === "all" ? undefined : value)); }}
            onSearch={refreshReports}
            onOpenReport={(id) => handleOpenReport(id, "history")}
            onDeleteReport={handleDeleteReport}
            onCopyReport={handleCopyReport}
            onExportReport={handleExportReport}
            onGenerateCandidates={handleGenerateCandidatesFromActiveReport}
            onOpenFindings={handleReportToFindings}
            onAddDailyLog={handleReportToDailyLog}
            onChatAboutReport={handleReportToChat}
            onRenameReport={handleRenameReport}
          />
        )}

        {view === "settings" && settings && (
          <SettingsView
            theme={theme}
            settings={settings}
            enableLlm={enableLlm}
            apiBase={apiBase}
            model={model}
            apiKey={apiKey}
            clearApiKey={clearApiKey}
            modelProfiles={modelProfiles}
            profileName={profileName}
            profileNote={profileNote}
            profileDefault={profileDefault}
            busy={busyArea}
            testResult={llmTestResult}
            onEnableLlmChange={setEnableLlm}
            onApiBaseChange={setApiBase}
            onModelChange={setModel}
            onApiKeyChange={setApiKey}
            onClearApiKeyChange={setClearApiKey}
            onProfileNameChange={setProfileName}
            onProfileNoteChange={setProfileNote}
            onProfileDefaultChange={setProfileDefault}
            onSaveProfile={handleSaveModelProfile}
            onApplyProfile={handleApplyModelProfile}
            onDeleteProfile={handleDeleteModelProfile}
            onSubmit={handleSaveSettings}
            onTest={handleTestLlm}
            onOpenHealth={() => setView("health")}
            onThemeChange={setTheme}
          />
        )}

        {view === "health" && health && <HealthStatusView activity={activitySummary} busy={busyArea === "archive"} health={health} onExportArchive={handleExportProductArchive} onImportArchive={handleImportProductArchive} onOpenStorage={openStorageDir} onOpenLogs={openLogsDir} onOpenSettings={() => setView("settings")} />}
    </ProductShell>
  );
}

function viewTitle(view: View) {
  const titles: Record<View, string> = {
    overview: "工作台总览",
    workbench: "审查工作台",
    projects: "分析主线",
    guide: "项目导览",
    map: "代码地图",
    findings: "问题清单",
    diff: "代码对比",
    chat: "AI 对话",
    cards: "知识卡片",
    logs: "每日日志",
    agent: "行动草稿",
    galaxy: "活动展示台",
    history: "历史报告",
    settings: "设置",
    health: "运行状态"
  };
  return titles[view];
}

function initialViewFromLocation(): View {
  if (typeof window === "undefined") return "galaxy";
  const url = new URL(window.location.href);
  const requested = url.searchParams.get("view");
  const allowed: View[] = ["overview", "workbench", "projects", "map", "findings", "diff", "chat", "cards", "logs", "guide", "agent", "galaxy", "history", "settings", "health"];
  if (requested === "projects" || requested === "overview") {
    url.searchParams.set("view", "workbench");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return "workbench";
  }
  return allowed.includes(requested as View) ? requested as View : "galaxy";
}

function initialGalaxyModeFromLocation(): GalaxyMode {
  if (typeof window === "undefined") return "entry";
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  const requestedMode = params.get("galaxy");
  if (requestedMode === "entry" || requestedMode === "explore") return requestedMode;
  return requestedView ? "explore" : "entry";
}

function initialTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem("codelens.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function viewSubtitle(view: View) {
  const subtitles: Record<View, string> = {
    overview: "查看最近工作、待处理问题和下一步动作。",
    workbench: "从本地工作区完成项目审查，或切换到单文件快速分析。",
    projects: "从本地工作区进入项目审查，生成项目级报告并沉淀后续动作。",
    guide: "把代码地图转成架构说明、关键模块和推荐阅读路径。",
    map: "查看语言分布、热点文件、符号和轻量依赖关系。",
    findings: "把分析结果拆成可跟踪的问题、风险和修复建议。",
    diff: "对比两个版本的代码变更，识别风险和维护性影响。",
    chat: "围绕报告、工作区、文件和问题继续追问。",
    cards: "把高价值问题、重构建议和知识点沉淀成长期复习卡片。",
    logs: "按日期汇总报告、对话、卡片、问题和行动草稿。",
    agent: "生成可审查、可确认、可备份的确认式行动草稿。",
    galaxy: "用 3D 卡片展示台浏览本地项目审查和学习沉淀轨迹。",
    history: "检索、打开、导出和删除本地 SQLite 中保存的报告。",
    settings: "配置本地模式、LLM 模型、API Key 和连接测试。",
    health: "诊断 SQLite、LLM、本地路径、数据资产和档案迁移。"
  };
  return subtitles[view];
}

function nodeToView(nodeId: string): View {
  if (nodeId.includes(":")) {
    const kind = nodeId.slice(0, nodeId.indexOf(":"));
    const entityMap: Record<string, View> = {
      report: "history",
      workspace: "projects",
      finding: "findings",
      card: "cards",
      learning_card: "cards",
      card_material: "cards",
      chat: "chat",
      chat_session: "chat",
      daily_log: "logs",
      agent_task: "agent"
    };
    return entityMap[kind] || "galaxy";
  }
  const map: Record<string, View> = {
    reports: "history",
    workspaces: "projects",
    findings: "findings",
    cards: "cards",
    chats: "chat",
    agent: "agent",
    logs: "logs",
    activity: "galaxy"
  };
  return map[nodeId] || "galaxy";
}

function singleModeLabel(value: string) {
  const labels: Record<string, string> = {
    func_comment: "函数注释与意图解释",
    risk_review: "风险审查",
    refactor: "重构建议",
    test_plan: "测试建议",
    script_review: "脚本流程审查",
    architecture: "结构与职责审查"
  };
  return labels[value] || value;
}

function operationStatusLabel(value: string) {
  const labels: Record<string, string> = {
    planned: "已计划",
    pending: "待确认",
    applied: "已写入",
    partial: "部分写入",
    failed: "失败",
    rolled_back: "已回滚"
  };
  return labels[value] || value;
}

function reportTypeLabel(value: string) {
  const labels: Record<string, string> = {
    single: "单文件报告",
    project: "项目报告",
    diff: "代码对比",
    chat: "对话关联"
  };
  return labels[value] || value;
}

function riskLabel(value: string) {
  const labels: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
    info: "提示"
  };
  return labels[value] || value;
}

function severityLabel(value: string) {
  return riskLabel(value);
}

function agentTaskStatusLabel(value: string) {
  return operationStatusLabel(value);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function friendlyError(err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  return `操作失败：${detail}`;
}

function isMissingProjectGuideError(err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  return detail.includes("还没有项目导览") || detail.includes("请先生成导览");
}
