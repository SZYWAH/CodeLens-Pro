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
import { FormEvent, Suspense, lazy, useEffect, useMemo, useState } from "react";
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
  ActivityGalaxyData,
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
import { ProjectWorkspaceView } from "./components/ProjectWorkspaceView";
import { ProductShell, type ProductGlobalCommand, type ProductNavGroup } from "./components/ProductShell";
import { ProductOverview } from "./components/ProductOverview";
import { SettingsView } from "./components/SettingsView";

const ActivityGalaxyView = lazy(() =>
  import("./components/ActivityGalaxyView").then((module) => ({ default: module.ActivityGalaxyView }))
);

type View = "overview" | "workbench" | "projects" | "map" | "findings" | "diff" | "chat" | "cards" | "logs" | "guide" | "agent" | "galaxy" | "history" | "settings" | "health";
type BusyArea = "single" | "workspace" | "diff" | "chat" | "settings" | "llm-test" | "cards" | "material" | "daily-log" | "guide" | "agent" | "archive" | null;

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
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceDetail | null>(null);
  const [codeMap, setCodeMap] = useState<CodeMap | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [cards, setCards] = useState<LearningCard[]>([]);
  const [cardMaterials, setCardMaterials] = useState<CardMaterial[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [activeChat, setActiveChat] = useState<ChatSessionDetail | null>(null);
  const [activeReport, setActiveReport] = useState<ReportDetail | null>(null);
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
  const [cardCandidates, setCardCandidates] = useState<LearningCardCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [learningCenter, setLearningCenter] = useState<LearningCenterData | null>(null);
  const [traceability, setTraceability] = useState<TraceabilitySnapshot | null>(null);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([]);

  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceStream, setWorkspaceStream] = useState("");
  const [findingStatus, setFindingStatus] = useState("all");
  const [findingSeverity, setFindingSeverity] = useState("all");
  const [findingReportId, setFindingReportId] = useState<string | null>(null);
  const [cardStatus, setCardStatus] = useState("all");
  const [cardTag, setCardTag] = useState("");
  const [manualCardTitle, setManualCardTitle] = useState("");
  const [manualCardContent, setManualCardContent] = useState("");
  const [manualCardTags, setManualCardTags] = useState("手动,复习");
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [agentGoal, setAgentGoal] = useState("根据当前上下文生成只读改进计划");
  const [agentContext, setAgentContext] = useState("none|");

  const [singleTitle, setSingleTitle] = useState("单文件代码审查");
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setView(nextView: View) {
    setViewState(nextView);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextView === "overview") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", nextView);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    if (!settings) return;
    setApiBase(settings.api_base);
    setModel(settings.model);
    setEnableLlm(settings.enable_llm);
  }, [settings]);

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
    setError(null);
    try {
      const [
        nextHealth,
        nextSettings,
        nextModelProfiles,
        nextReports,
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
        nextTraceability
      ] = await Promise.all([
        getAppHealth(),
        getSettings(),
        listModelProfiles(),
        listReports(historyQuery, reportFilter === "all" ? undefined : reportFilter),
        listWorkspaces(workspaceQuery),
        listChatSessions(chatQuery),
        listFindings(activeWorkspace?.summary.id, findingStatus, findingSeverity, findingReportId || undefined),
        listLearningCards(activeWorkspace?.summary.id, cardStatus, cardTag || undefined),
        getDailySummary(dailyDate),
        listDailyLogs(),
        listAgentTasks(),
        getWorkspaceBridgeStatus(activeWorkspace?.summary.id),
        listWorkspaceBridgeInbox(),
        listLearningCardCandidates("pending", activeReport?.id),
        getLearningCenter(dailyDate, dailyDate.slice(0, 7)),
        getActivitySummary(),
        getActivityGalaxyData(),
        getTraceabilitySnapshot(activeReport ? "report" : activeWorkspace ? "workspace" : "global", activeReport?.id || activeWorkspace?.summary.id)
      ]);
      setHealth(nextHealth);
      setSettings(nextSettings);
      setModelProfiles(nextModelProfiles);
      setReports(nextReports);
      setWorkspaces(nextWorkspaces);
      setChatSessions(nextChats);
      setFindings(nextFindings);
      setCards(nextCards);
      setDailySummary(nextDailySummary);
      setDailyLogs(nextDailyLogs);
      setAgentTasks(nextAgentTasks);
      setWorkspaceBridge(nextBridge);
      setWorkspaceBridgeInbox(nextBridgeInbox);
      setCardCandidates(nextCandidates);
      setLearningCenter(nextLearningCenter);
      setActivitySummary(nextActivitySummary);
      setActivityGalaxy(nextGalaxy);
      setTraceability(nextTraceability);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function refreshWorkspaces() {
    setWorkspaces(await listWorkspaces(workspaceQuery));
  }

  async function refreshReports() {
    setReports(await listReports(historyQuery, reportFilter === "all" ? undefined : reportFilter));
  }

  async function refreshFindings(workspaceId = activeWorkspace?.summary.id, reportId = findingReportId) {
    setFindings(await listFindings(workspaceId, findingStatus, findingSeverity, reportId || undefined));
  }

  async function refreshCards(workspaceId = activeWorkspace?.summary.id) {
    setCards(await listLearningCards(workspaceId, cardStatus, cardTag || undefined));
  }

  async function refreshDaily(date = dailyDate) {
    const [summary, logs, center] = await Promise.all([getDailySummary(date), listDailyLogs(), getLearningCenter(date, date.slice(0, 7))]);
    setDailySummary(summary);
    setDailyLogs(logs);
    setLearningCenter(center);
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
    const [summary, galaxy] = await Promise.all([getActivitySummary(), getActivityGalaxyData()]);
    setActivitySummary(summary);
    setActivityGalaxy(galaxy);
  }

  async function refreshTraceability(scopeKind?: string, scopeId?: string) {
    const resolvedKind = scopeKind || (activeReport ? "report" : activeWorkspace ? "workspace" : "global");
    const resolvedId = scopeId || activeReport?.id || activeWorkspace?.summary.id;
    setTraceability(await getTraceabilitySnapshot(resolvedKind, resolvedId));
  }

  async function handleImportWorkspace() {
    setBusyArea("workspace");
    setError(null);
    setMessage(null);
    try {
      const detail = await importWorkspaceFolder();
      setActiveWorkspace(detail);
      setCodeMap(null);
      setWorkspaceBridge(await getWorkspaceBridgeStatus(detail.summary.id));
      setTraceability(await getTraceabilitySnapshot("workspace", detail.summary.id));
      await Promise.all([refreshWorkspaces(), refreshFindings(detail.summary.id), refreshCards(detail.summary.id)]);
      setMessage(`工作区已导入：${detail.summary.file_count} 个文件，${detail.summary.total_lines} 行。`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleOpenWorkspace(id: string) {
    setError(null);
    try {
      const detail = await getWorkspace(id);
      setActiveWorkspace(detail);
      setCodeMap(null);
      setWorkspaceBridge(await getWorkspaceBridgeStatus(id));
      setTraceability(await getTraceabilitySnapshot("workspace", id));
      await Promise.all([refreshFindings(id), refreshCards(id)]);
      setView("projects");
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleRescanWorkspace() {
    if (!activeWorkspace) return;
    setBusyArea("workspace");
    setError(null);
    setMessage(null);
    try {
      const detail = await rescanWorkspace(activeWorkspace.summary.id);
      setActiveWorkspace(detail);
      setCodeMap(null);
      setWorkspaceBridge(await getWorkspaceBridgeStatus(detail.summary.id));
      setTraceability(await getTraceabilitySnapshot("workspace", detail.summary.id));
      await Promise.all([refreshWorkspaces(), refreshFindings(detail.summary.id), refreshCards(detail.summary.id)]);
      setMessage(`工作区已重新扫描：${detail.summary.file_count} 个文件。`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleDeleteWorkspace(id: string) {
    setError(null);
    try {
      await deleteWorkspace(id);
      if (activeWorkspace?.summary.id === id) {
        setActiveWorkspace(null);
        setCodeMap(null);
        setWorkspaceBridge(await getWorkspaceBridgeStatus());
        setTraceability(await getTraceabilitySnapshot("global"));
      }
      await refreshWorkspaces();
      setMessage("工作区已删除。");
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleAnalyzeWorkspace() {
    if (!activeWorkspace) {
      setError("请先导入或打开一个工作区。");
      return;
    }
    setBusyArea("workspace");
    setWorkspaceStream("");
    setError(null);
    setMessage(null);
    try {
      const response = await analyzeWorkspaceStream(activeWorkspace.summary.id, (chunk) => setWorkspaceStream((value) => value + chunk));
      setActiveReport(response.report);
      await Promise.all([refreshReports(), refreshFindings(activeWorkspace.summary.id), refreshTraceability("report", response.report.id)]);
      setMessage(response.warnings[0] || "工作区审查报告已生成。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleLoadCodeMap() {
    if (!activeWorkspace) {
      setError("请先打开一个工作区，再查看代码地图。");
      return;
    }
    setError(null);
    try {
      setCodeMap(await getCodeMap(activeWorkspace.summary.id));
      setView("map");
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleUpdateFinding(id: string, status: string) {
    setError(null);
    try {
      await updateFindingStatus(id, status);
      await refreshFindings();
    } catch (err) {
      setError(friendlyError(err));
    }
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
      setFindingStatus("all");
      setFindingSeverity("all");
      setFindings(await listFindings(finding.workspace_id || activeWorkspace?.summary.id, "all", "all"));
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
      await Promise.all([refreshCards(), refreshTraceability()]);
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
      setError("请填写知识卡片标题和内容。");
      return;
    }
    setBusyArea("cards");
    setError(null);
    try {
      await createLearningCard({
        finding_id: null,
        workspace_id: activeWorkspace?.summary.id || null,
        title: manualCardTitle.trim(),
        content: manualCardContent.trim(),
        tags: manualCardTags.split(",").map((tag) => tag.trim()).filter(Boolean)
      });
      setManualCardTitle("");
      setManualCardContent("");
      await refreshCards();
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
    try {
      const material = await generateCardMaterial(cardId, true);
      setActiveCardId(cardId);
      setCardMaterials(await listCardMaterials(cardId));
      setMessage(`学习材料已生成：${material.title}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleUpdateCard(id: string, status: string) {
    setError(null);
    try {
      await updateLearningCard(id, status);
      await refreshCards();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleExportLearningCards() {
    setBusyArea("cards");
    setError(null);
    try {
      const path = await exportLearningCardsMarkdown(activeWorkspace?.summary.id, cardStatus, cardTag || undefined);
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
      await refreshCards();
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleGenerateCandidatesFromActiveReport() {
    if (!activeReport) {
      setError("请先生成或打开一份报告。");
      return;
    }
    setBusyArea("cards");
    setError(null);
    try {
      const candidates = await generateCardCandidatesFromReport(activeReport.id);
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
      await Promise.all([refreshCards(), refreshCardCandidates(), refreshTraceability()]);
      setMessage(`已审核通过 ${created.length} 张知识卡片。`);
    } catch (err) {
      setError(friendlyError(err));
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
    }
  }

  async function handleGenerateDailyLog() {
    setBusyArea("daily-log");
    setError(null);
    try {
      const log = await generateDailyLog(dailyDate);
      setDailyDraft(log);
      setMessage("已根据当天活动生成日志草稿。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleSaveDailyLog() {
    if (!dailyDraft) return;
    setBusyArea("daily-log");
    setError(null);
    try {
      const saved = await saveDailyLog(dailyDraft.date, dailyDraft.title, dailyDraft.content);
      setDailyDraft(saved);
      await Promise.all([refreshDaily(saved.date), refreshTraceability()]);
      setMessage("每日日志已保存。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
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
    setBusyArea("daily-log");
    setError(null);
    try {
      if (dailyDraft) {
        await saveDailyLog(dailyDraft.date, dailyDraft.title, dailyDraft.content);
      }
      const path = await exportDailyLogMarkdown(dailyDate);
      await refreshDaily(dailyDate);
      setMessage(`每日日志已导出：${path}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function handleOpenCardFromDaily(id: string) {
    setActiveCardId(id);
    setCardMaterials(await listCardMaterials(id));
    setView("cards");
  }

  async function handleOpenAgentFromDaily(id: string) {
    try {
      setActiveAgentTask(await getAgentTask(id));
      setView("agent");
    } catch (err) {
      setError(friendlyError(err));
    }
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
    if (!activeWorkspace) {
      setError("请先打开一个工作区，再查看项目导览。");
      return;
    }
    setError(null);
    try {
      setProjectGuide(await getProjectGuide(activeWorkspace.summary.id));
      setView("guide");
    } catch (err) {
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
      setMessage("Agent 确认式计划已生成，请审核文件操作后再应用。");
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
      setMessage(`Agent 计划已导出：${path}`);
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
      setMessage(`工作区桥接清单已导出；插件稳定入口：${result.current_manifest_path}`);
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
      setMessage(`已根据桥接收件箱请求生成 Agent 计划：${result.task.title}`);
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
      setError("当前没有待应用的 Agent 文件操作。");
      return;
    }
    setBusyArea("agent");
    setError(null);
    try {
      const result = await applyAgentPlan({ task_id: activeAgentTask.id, operation_ids: operationIds, confirm: true });
      setActiveAgentTask(result.task);
      setSelectedOperationIds(result.task.operations.filter((operation) => operation.status === "pending").map((operation) => operation.id));
      await Promise.all([refreshAgent(), refreshTraceability()]);
      setMessage(`${result.applied_count} 项操作已应用。备份目录：${result.backup_dir}`);
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
      setMessage("Agent 文件操作已回滚。");
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
        title: `Agent 复盘：${activeAgentTask.title.replace(/^Agent 计划：/, "")}`,
        content,
        tags: ["Agent", "执行计划", activeAgentTask.status]
      });
      await Promise.all([refreshCards(), refreshTraceability()]);
      setActiveCardId(card.id);
      setView("cards");
      setMessage("已从 Agent 计划生成知识卡片。");
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
      content: `${base.content}\n\n## 追加 Agent 计划\n- ${activeAgentTask.title}\n  - 状态：${operationStatusLabel(activeAgentTask.status)}\n  - 摘要：${activeAgentTask.summary}\n  - 文件操作：${activeAgentTask.operations.length} 项`
    });
    setView("logs");
    setMessage("已把 Agent 计划加入每日日志草稿。");
  }

  function handleChatAboutAgentTask() {
    if (!activeAgentTask) return;
    setChatContext(`agent_task|${activeAgentTask.id}`);
    setChatDraft(`请围绕 Agent 计划《${activeAgentTask.title}》解释执行顺序、风险、验证方法和下一步改进。`);
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
        setActiveCardId(entityId);
        setCardMaterials(await listCardMaterials(entityId));
        setView("cards");
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
        setFindingStatus("all");
        setFindingSeverity("all");
        setFindings(await listFindings(activeWorkspace?.summary.id, "all", "all"));
        setView("findings");
        setMessage("已打开问题清单，可继续按标题或文件定位该星点关联的问题。");
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

  function handleReportToAgent() {
    if (!activeReport) return;
    setAgentContext(`report|${activeReport.id}`);
    setAgentGoal(`围绕报告《${activeReport.title}》生成可确认执行计划`);
    setView("agent");
  }

  function handleFindingToAgent(finding: Finding) {
    setAgentContext(`finding|${finding.id}`);
    setAgentGoal(`围绕问题《${finding.title}》生成可确认执行计划，先定位影响文件，再给出修复步骤和验证方法`);
    setView("agent");
  }

  async function handleReportToDailyLog() {
    if (!activeReport) return;
    const date = new Date().toISOString().slice(0, 10);
    const base = dailyDraft?.date === date ? dailyDraft : await generateDailyLog(date);
    setDailyDate(date);
    setDailyDraft({
      ...base,
      content: `${base.content}\n\n## 追加报告\n- ${activeReport.title}：${activeReport.summary}`
    });
    setView("logs");
    setMessage("已把当前报告加入每日日志草稿。");
  }

  function handleReportToChat() {
    if (!activeReport) return;
    setChatContext(`report|${activeReport.id}`);
    setChatDraft(`请围绕报告《${activeReport.title}》继续解释关键风险和下一步行动。`);
    setView("chat");
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

  async function handleReportToFindings() {
    if (!activeReport) return;
    setFindingReportId(activeReport.id);
    setFindingStatus("all");
    setFindingSeverity("all");
    setFindings(await listFindings(undefined, "all", "all", activeReport.id));
    setView("findings");
    setMessage(`已切换到报告《${activeReport.title}》关联的问题清单。`);
  }

  async function handleImportSingleAnalysisFile() {
    setError(null);
    try {
      const result = await importSingleCodeFile();
      const file = result.files[0];
      if (!file) throw new Error("没有导入可读取的代码文件。");
      setSingleCode(file.content);
      setSingleTitle(`${file.path} 代码审查`);
      setSingleLanguage(file.language || "auto");
      setMessage(`已导入单文件：${file.path}`);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  async function handleAnalyzeSingleCode() {
    if (!singleCode.trim()) {
      setError("请先粘贴代码或导入一个代码文件。");
      return;
    }
    setBusyArea("single");
    setError(null);
    try {
      const response = await analyzeCode({
        title: singleTitle.trim() || undefined,
        language: singleLanguage,
        mode_group: singleModeGroup,
        mode: singleMode,
        mode_label: singleModeLabel(singleMode),
        code: singleCode,
        use_llm: true
      });
      setActiveReport(response.report);
      if (singleGenerateCards) {
        const candidates = await generateCardCandidatesFromReport(response.report.id);
        setCardCandidates(candidates);
        setSelectedCandidateIds(candidates.map((item) => item.id));
      }
      await Promise.all([refreshReports(), refreshActivity(), refreshTraceability("report", response.report.id)]);
      setMessage(
        response.warnings[0] ||
        (singleGenerateCards ? "单文件报告已生成，并已提取知识卡片候选。" : "单文件代码分析报告已生成。")
      );
    } catch (err) {
      setError(friendlyError(err));
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
      await Promise.all([refreshReports(), refreshTraceability("report", response.report.id)]);
      setMessage(response.warnings[0] || "代码对比报告已生成。");
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
    setActiveReport(await getReport(id));
    setTraceability(await getTraceabilitySnapshot("report", id));
    setView(targetView);
  }

  async function handleDeleteReport(id: string) {
    await deleteReport(id);
    if (activeReport?.id === id) {
      setActiveReport(null);
      setTraceability(await getTraceabilitySnapshot(activeWorkspace ? "workspace" : "global", activeWorkspace?.summary.id));
    }
    await refreshReports();
  }

  async function handleCopyReport() {
    if (!activeReport) return;
    await copyReportText(activeReport.id, activeReport.full_report);
    setMessage("报告已复制到剪贴板。");
  }

  async function handleExportReport(kind: "md" | "html") {
    if (!activeReport) return;
    const path = kind === "md" ? await exportReportMarkdown(activeReport.id) : await exportReportHtml(activeReport.id);
    setMessage(`${kind.toUpperCase()} 已导出：${path}`);
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
      title: "工作主线",
      items: [
        { key: "overview", label: "工作台总览", description: "最近任务和下一步动作", icon: <Activity size={18} />, active: view === "overview", onClick: () => setView("overview") },
        { key: "workbench", label: "代码工作台", description: "单文件粘贴、导入与分析", icon: <FileCode2 size={18} />, active: view === "workbench", onClick: () => setView("workbench") },
        { key: "projects", label: "分析主线", description: "工作区、项目分析、报告生成", icon: <Layers3 size={18} />, active: view === "projects", onClick: () => setView("projects") },
        { key: "guide", label: "项目导览", description: "架构摘要与阅读路线", icon: <Map size={18} />, active: view === "guide", onClick: handleLoadProjectGuide },
        { key: "map", label: "代码地图", description: "符号、依赖与热点文件", icon: <GitBranch size={18} />, active: view === "map", onClick: () => { setView("map"); if (!codeMap) handleLoadCodeMap(); } },
        { key: "findings", label: "问题清单", description: "风险、建议与状态追踪", icon: <ShieldAlert size={18} />, active: view === "findings", onClick: () => setView("findings") }
      ]
    },
    {
      title: "协作增强",
      items: [
        { key: "diff", label: "代码对比", description: "审查两个版本的差异", icon: <Columns3 size={18} />, active: view === "diff", onClick: () => setView("diff") },
        { key: "chat", label: "AI 对话", description: "围绕项目上下文追问", icon: <MessageSquare size={18} />, active: view === "chat", onClick: () => setView("chat") },
        { key: "agent", label: "Agent 工作区", description: "计划、预览、确认与备份", icon: <Bot size={18} />, active: view === "agent", onClick: () => setView("agent") }
      ]
    },
    {
      title: "学习沉淀",
      items: [
        { key: "cards", label: "知识卡片", description: "从报告和问题沉淀知识", icon: <GraduationCap size={18} />, active: view === "cards", onClick: () => setView("cards") },
        { key: "logs", label: "每日日志", description: "记录每日学习与审查活动", icon: <FileText size={18} />, active: view === "logs", onClick: () => { setView("logs"); refreshDaily(); } },
        { key: "galaxy", label: "活动星图", description: "可视化本地学习与项目轨迹", icon: <Activity size={18} />, active: view === "galaxy", onClick: () => { setView("galaxy"); refreshActivity(); } }
      ]
    },
    {
      title: "系统",
      items: [
        { key: "history", label: "历史报告", description: "搜索与恢复所有报告", icon: <History size={18} />, active: view === "history", onClick: () => setView("history") },
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
          label: "围绕当前工作区生成 Agent 计划",
          description: "把当前工作区作为上下文，生成可确认执行方案",
          group: "上下文动作",
          icon: <Bot size={18} />,
          keywords: ["Agent", "修复计划", "工作区", activeWorkspace.summary.name],
          onClick: () => {
            setAgentContext(`workspace|${activeWorkspace.summary.id}`);
            setAgentGoal(`围绕工作区《${activeWorkspace.summary.name}》生成可确认执行计划`);
            setView("agent");
          }
        },
        {
          key: `action:workspace-bridge:${activeWorkspace.summary.id}`,
          label: "导出当前工作区桥接清单",
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
          label: "围绕当前报告生成 Agent 计划",
          description: "把报告风险和建议转成可确认执行方案",
          group: "上下文动作",
          icon: <Bot size={18} />,
          keywords: ["Agent", "报告", "计划", activeReport.title],
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
          label: "从当前 Agent 计划生成知识卡片",
          description: activeAgentTask.title,
          group: "上下文动作",
          icon: <GraduationCap size={18} />,
          keywords: ["Agent", "知识卡片", "复盘", activeAgentTask.summary],
          onClick: handleAgentTaskToLearningCard
        },
        {
          key: `action:agent-log:${activeAgentTask.id}`,
          label: "把当前 Agent 计划加入每日日志",
          description: "记录执行计划、状态和文件操作数量",
          group: "上下文动作",
          icon: <FileText size={18} />,
          keywords: ["Agent", "日志", "复盘", activeAgentTask.title],
          onClick: handleAgentTaskToDailyLog
        },
        {
          key: `action:agent-chat:${activeAgentTask.id}`,
          label: "围绕当前 Agent 计划对话",
          description: "追问步骤、风险、验证方式和回滚点",
          group: "上下文动作",
          icon: <MessageSquare size={18} />,
          keywords: ["Agent", "AI 对话", activeAgentTask.title],
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
      group: "Agent 任务",
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

  return (
    <ProductShell
      activeSubtitle={viewSubtitle(view)}
      activeTitle={viewTitle(view)}
      databaseOk={Boolean(health?.database_ok)}
      error={error}
      globalCommands={globalCommands}
      llmConfigured={Boolean(settings?.api_key_set)}
      message={message}
      navGroups={navGroups}
      onRefresh={refreshAll}
      statusText={statusText}
      version={health?.version || "1.0.0"}
    >

        {view === "overview" && (
          <ProductOverview
            activity={activitySummary}
            agentTasks={agentTasks}
            cards={cards}
            dailySummary={dailySummary}
            findings={findings}
            reports={reports}
            traceability={traceability}
            workspaces={workspaces}
            onNavigate={(target) => setView(target)}
            onRefresh={refreshAll}
          />
        )}

        {view === "workbench" && (
          <CodeWorkbenchView
            title={singleTitle}
            language={singleLanguage}
            modeGroup={singleModeGroup}
            mode={singleMode}
            generateCards={singleGenerateCards}
            code={singleCode}
            report={activeReport}
            traceability={traceability}
            busy={busyArea === "single"}
            onTitleChange={setSingleTitle}
            onLanguageChange={setSingleLanguage}
            onModeGroupChange={(value) => {
              setSingleModeGroup(value);
              setSingleMode(value === "script" ? "script_review" : "risk_review");
            }}
            onModeChange={setSingleMode}
            onGenerateCardsChange={setSingleGenerateCards}
            onCodeChange={setSingleCode}
            onImportFile={handleImportSingleAnalysisFile}
            onLoadSample={() => {
              setSingleCode(sampleSingleCode);
              setSingleTitle("单文件代码审查");
              setSingleLanguage("TypeScript");
              setSingleModeGroup("function");
              setSingleMode("risk_review");
            }}
            onClear={() => setSingleCode("")}
            onAnalyze={handleAnalyzeSingleCode}
            onCopyReport={handleCopyReport}
            onExportReport={handleExportReport}
            onGenerateCandidates={handleGenerateCandidatesFromActiveReport}
            onCreateAgentPlan={handleReportToAgent}
            onOpenFindings={handleReportToFindings}
            onAddDailyLog={handleReportToDailyLog}
            onChatAboutReport={handleReportToChat}
          />
        )}

        {view === "projects" && (
          <ProjectWorkspaceView
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            query={workspaceQuery}
            stream={workspaceStream}
            report={activeReport}
            traceability={traceability}
            busy={busyArea === "workspace"}
            onQueryChange={setWorkspaceQuery}
            onSearch={refreshWorkspaces}
            onImport={handleImportWorkspace}
            onOpen={handleOpenWorkspace}
            onDelete={handleDeleteWorkspace}
            onRescan={handleRescanWorkspace}
            onAnalyze={handleAnalyzeWorkspace}
            onMap={handleLoadCodeMap}
            onCopyReport={handleCopyReport}
            onExportReport={handleExportReport}
            onGenerateCandidates={handleGenerateCandidatesFromActiveReport}
            onCreateAgentPlan={handleReportToAgent}
            onOpenFindings={handleReportToFindings}
            onAddDailyLog={handleReportToDailyLog}
            onChatAboutReport={handleReportToChat}
          />
        )}

        {view === "map" && <CodeMapView activeWorkspace={activeWorkspace} codeMap={codeMap} onRefresh={handleLoadCodeMap} />}

        {view === "guide" && (
          <ProjectGuideView
            activeWorkspace={activeWorkspace}
            guide={projectGuide}
            busy={busyArea === "guide"}
            onGenerate={handleGenerateProjectGuide}
          />
        )}

        {view === "findings" && (
          <FindingsView
            findings={findings}
            status={findingStatus}
            severity={findingSeverity}
            linkedReportTitle={findingReportId && activeReport?.id === findingReportId ? activeReport.title : null}
            busy={busyArea === "cards"}
            onStatusFilter={async (value) => { setFindingStatus(value); setFindings(await listFindings(activeWorkspace?.summary.id, value, findingSeverity, findingReportId || undefined)); }}
            onSeverityFilter={async (value) => { setFindingSeverity(value); setFindings(await listFindings(activeWorkspace?.summary.id, findingStatus, value, findingReportId || undefined)); }}
            onClearReportLink={async () => { setFindingReportId(null); setFindings(await listFindings(activeWorkspace?.summary.id, findingStatus, findingSeverity)); }}
            onUpdate={handleUpdateFinding}
            onCreateCards={handleCreateCards}
            onCreateAgentPlan={handleFindingToAgent}
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
            report={activeReport}
            traceability={traceability}
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
            onCopyReport={handleCopyReport}
            onExportReport={handleExportReport}
            onGenerateCandidates={handleGenerateCandidatesFromActiveReport}
            onCreateAgentPlan={handleReportToAgent}
            onOpenFindings={handleReportToFindings}
            onAddDailyLog={handleReportToDailyLog}
            onChatAboutReport={handleReportToChat}
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
            onNew={() => { setActiveChat(null); setChatStream(""); setPendingUserMessage(null); }}
            onOpen={handleOpenChat}
            onDelete={handleDeleteChat}
            onDraftChange={setChatDraft}
            onContextChange={setChatContext}
            onSubmit={handleSendChat}
          />
        )}

        {view === "cards" && (
          <LearningCardsView
            cards={cards}
            materials={cardMaterials}
            activeCardId={activeCardId}
            status={cardStatus}
            tag={cardTag}
            manualTitle={manualCardTitle}
            manualContent={manualCardContent}
            manualTags={manualCardTags}
            candidates={cardCandidates}
            selectedCandidateIds={selectedCandidateIds}
            onStatusFilter={async (value) => { setCardStatus(value); setCards(await listLearningCards(activeWorkspace?.summary.id, value, cardTag || undefined)); }}
            onTagChange={setCardTag}
            onManualTitleChange={setManualCardTitle}
            onManualContentChange={setManualCardContent}
            onManualTagsChange={setManualCardTags}
            onToggleCandidate={(id, selected) => setSelectedCandidateIds((items) => selected ? Array.from(new Set([...items, id])) : items.filter((item) => item !== id))}
            onApproveCandidates={handleApproveSelectedCandidates}
            onRejectCandidate={handleRejectCandidate}
            onGenerateCandidates={handleGenerateCandidatesFromActiveReport}
            onCreateManual={handleCreateManualCard}
            onSearch={refreshCards}
            onUpdate={handleUpdateCard}
            onDelete={handleDeleteCard}
            onGenerateMaterial={handleGenerateCardMaterial}
            onSelectCard={async (id) => { setActiveCardId(id); setCardMaterials(await listCardMaterials(id)); }}
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
            onDateChange={async (value) => { setDailyDate(value); await refreshDaily(value); }}
            onGenerate={handleGenerateDailyLog}
            onSave={handleSaveDailyLog}
            onStartManual={handleStartManualDailyLog}
            onCopy={handleCopyDailyLog}
            onExport={handleExportDailyLog}
            onRefresh={() => refreshDaily(dailyDate)}
            onOpenCard={handleOpenCardFromDaily}
            onOpenAgent={handleOpenAgentFromDaily}
            onDraftTitleChange={(value) => setDailyDraft((draft) => draft ? { ...draft, title: value } : draft)}
            onDraftContentChange={(value) => setDailyDraft((draft) => draft ? { ...draft, content: value } : draft)}
            onOpenLog={(log) => setDailyDraft(log)}
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
          <Suspense fallback={<div className="workbench-empty-next compact"><Loader2 className="spin" size={22} /><p>正在加载活动星图...</p></div>}>
            <ActivityGalaxyView summary={activitySummary} galaxy={activityGalaxy} onRefresh={refreshActivity} onOpenNode={(nodeId) => { void handleOpenGalaxyNode(nodeId); }} />
          </Suspense>
        )}

        {view === "history" && (
          <HistoryReportsView
            reports={reports}
            query={historyQuery}
            filter={reportFilter}
            activeReport={activeReport}
            traceability={traceability}
            onQueryChange={setHistoryQuery}
            onFilterChange={async (value) => { setReportFilter(value); setReports(await listReports(historyQuery, value === "all" ? undefined : value)); }}
            onSearch={refreshReports}
            onOpenReport={(id) => handleOpenReport(id, "history")}
            onDeleteReport={handleDeleteReport}
            onCopyReport={handleCopyReport}
            onExportReport={handleExportReport}
            onGenerateCandidates={handleGenerateCandidatesFromActiveReport}
            onCreateAgentPlan={handleReportToAgent}
            onOpenFindings={handleReportToFindings}
            onAddDailyLog={handleReportToDailyLog}
            onChatAboutReport={handleReportToChat}
          />
        )}

        {view === "settings" && settings && (
          <SettingsView
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
          />
        )}

        {view === "health" && health && <HealthStatusView activity={activitySummary} busy={busyArea === "archive"} health={health} onExportArchive={handleExportProductArchive} onImportArchive={handleImportProductArchive} onOpenStorage={openStorageDir} onOpenLogs={openLogsDir} />}
    </ProductShell>
  );
}

function viewTitle(view: View) {
  const titles: Record<View, string> = {
    overview: "工作台总览",
    workbench: "代码工作台",
    projects: "分析主线",
    guide: "项目导览",
    map: "代码地图",
    findings: "问题清单",
    diff: "代码对比",
    chat: "AI 对话",
    cards: "知识卡片",
    logs: "每日日志",
    agent: "Agent 工作区",
    galaxy: "活动星图",
    history: "历史报告",
    settings: "设置",
    health: "健康状态"
  };
  return titles[view];
}

function initialViewFromLocation(): View {
  if (typeof window === "undefined") return "overview";
  const requested = new URLSearchParams(window.location.search).get("view");
  const allowed: View[] = ["overview", "workbench", "projects", "map", "findings", "diff", "chat", "cards", "logs", "guide", "agent", "galaxy", "history", "settings", "health"];
  return allowed.includes(requested as View) ? requested as View : "overview";
}

function viewSubtitle(view: View) {
  const subtitles: Record<View, string> = {
    overview: "查看最近工作、待处理问题和下一步动作。",
    workbench: "粘贴代码或导入单个文件，生成可继续进入问题、卡片、日志、对话和 Agent 的单文件报告。",
    projects: "从本地工作区进入项目审查，生成项目级报告并沉淀后续动作。",
    guide: "把代码地图转成架构说明、关键模块和推荐阅读路径。",
    map: "查看语言分布、热点文件、符号和轻量依赖关系。",
    findings: "把分析结果拆成可跟踪的问题、风险和修复建议。",
    diff: "对比两个版本的代码变更，识别风险和维护性影响。",
    chat: "围绕报告、工作区、文件和问题继续追问。",
    cards: "把高价值问题、重构建议和知识点沉淀成长期复习卡片。",
    logs: "按日期汇总报告、对话、卡片、问题和 Agent 计划。",
    agent: "生成可预览、可确认、可备份的 Agent 改进计划。",
    galaxy: "用活动星图复盘本地项目审查和学习沉淀轨迹。",
    history: "检索、打开、导出和删除本地 SQLite 中保存的报告。",
    settings: "配置本地模式、LLM 模型、API Key 和连接测试。",
    health: "查看 SQLite、日志目录、存储目录和当前应用版本。"
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
    applied: "已应用",
    partial: "部分应用",
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
