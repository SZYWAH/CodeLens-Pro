import {
  AlertCircle,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clipboard,
  Files,
  FolderOpen,
  History,
  KeyRound,
  MessageSquare,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { getApiBase, languageFromVsCodeId, notifyReady, onVsCodeMessage, postToVsCode, setApiBase } from "./runtime";
import { streamPost } from "./stream";
import type {
  AgentPlan,
  AnalyticsResponse,
  ChatSessionListItem,
  ChatMessage,
  EditorFilePayload,
  EditorPayload,
  FileAttention,
  HealthResponse,
  LLMKeyStatusResponse,
  ReportDetail,
  ReportListItem,
  SettingsResponse,
  StaticMetrics,
} from "./types";

type BusyState = "health" | "static" | "report" | "chat" | "agent" | "history" | null;
type ChatMode = "report" | "free" | "agent";
type AgentAction = "chat" | "plan";
type ViewMode = "main" | "history";
type SelectMenu = "modeGroup" | "mode" | "model" | null;

export function App() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [llmKeyStatus, setLlmKeyStatus] = useState<LLMKeyStatusResponse | null>(null);
  const [llmKeyInput, setLlmKeyInput] = useState("");
  const [llmKeyBusy, setLlmKeyBusy] = useState<"" | "save" | "test" | "clear">("");
  const [llmKeyMessage, setLlmKeyMessage] = useState("");
  const [llmKeyOk, setLlmKeyOk] = useState<boolean | null>(null);
  const [context, setContext] = useState<EditorPayload>({
    code: "",
    languageLabel: "多文件",
    languageCode: "text",
    fileName: "未选择文件",
  });
  const [modeGroup, setModeGroup] = useState<"function" | "script">("function");
  const [mode, setMode] = useState("func_comment");
  const [model, setModel] = useState("");
  const [metrics, setMetrics] = useState<StaticMetrics | null>(null);
  const [report, setReport] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ReportListItem[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatSessionListItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("report");
  const [agentAction, setAgentAction] = useState<AgentAction>("chat");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [busy, setBusy] = useState<BusyState>("health");
  const [error, setError] = useState("");
  const [apiReady, setApiReady] = useState(false);
  const [inputHeight, setInputHeight] = useState(74);
  const [openSelect, setOpenSelect] = useState<SelectMenu>(null);
  const [recentFilesMenu, setRecentFilesMenu] = useState<EditorPayload[]>([]);
  const [selectedRecentFiles, setSelectedRecentFiles] = useState<Set<string>>(new Set());
  const [recentFilesOpen, setRecentFilesOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextDetailsOpen, setContextDetailsOpen] = useState(false);
  const [agentPlans, setAgentPlans] = useState<AgentPlan[]>([]);
  const [pendingAutoAgent, setPendingAutoAgent] = useState<{ message: string; action: AgentAction } | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const recentFilesRef = useRef<HTMLDivElement | null>(null);
  const contextDetailsRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const stickToBottomRef = useRef(true);
  const forceNextScrollRef = useRef(false);
  const pendingAutoAgentRef = useRef<{ message: string; action: AgentAction } | null>(null);

  const languages = settings?.languages ?? { Python: "python" };
  const modes = settings?.report_modes?.[modeGroup] ?? [];
  const models = settings?.models ?? {};
  const languageLabel = context.languageLabel ?? "Python";
  const languageCode = context.languageCode ?? languages[languageLabel] ?? "python";
  const selectedModel = model || settings?.default_model_label || Object.keys(models)[0] || "";

  useEffect(() => {
    notifyReady();
    return onVsCodeMessage((message) => {
      if (message.type === "codelens.setApiBase") {
        setApiBase(message.apiBase);
        setApiReady(true);
        void loadBootData();
      }
      if (message.type === "codelens.openWorkbench") {
        const preserveMode = message.sourceType === "pickedFiles"
          || message.sourceType === "recentFiles"
          || message.sourceType === "workspaceFiles"
          || message.sourceType === "workspaceRules"
          || message.sourceType === "autoWorkspace";
        const nextContext = receiveEditorContext(message, { preserveMode });
        const pendingAgent = pendingAutoAgentRef.current;
        if (message.sourceType === "autoWorkspace" && pendingAgent) {
          pendingAutoAgentRef.current = null;
          setPendingAutoAgent(null);
          if (!hasContext(nextContext)) {
            setBusy(null);
            setError("没有自动收集到可分析的项目文件。请打开 VS Code 工作区，或通过“项目文件”手动选择文件。");
            setContextMenuOpen(true);
            return;
          }
          if (pendingAgent.action === "plan") void runAgentPlanWithContext(pendingAgent.message, nextContext);
          else void runAgentChatWithContext(pendingAgent.message, nextContext);
        }
      }
      if (message.type === "codelens.recentFilesMenu") {
        setRecentFilesMenu(message.files ?? []);
        setSelectedRecentFiles(new Set((message.files ?? []).map(recentFileKey)));
        setRecentFilesOpen((message.files ?? []).length > 0);
      }
      if (message.type === "codelens.openPage" && message.page === "history") {
        setViewMode("history");
        void loadHistory();
      }
      if (message.type === "codelens.agentPlanApplied") {
        if (message.sessionId) void refreshAgentSession(message.sessionId, { silent: true });
        void loadHistory();
      }
    });
  }, []);

  useEffect(() => {
    if (getApiBase()) {
      setApiReady(true);
      void loadBootData();
    }
  }, []);

  useEffect(() => {
    if (!apiReady) return;
    const timer = window.setInterval(() => void loadAnalytics(), 60000);
    return () => window.clearInterval(timer);
  }, [apiReady]);

  useEffect(() => {
    if (!apiReady) return;
    void loadPendingAgentTasks();
    const timer = window.setInterval(() => void loadPendingAgentTasks(), 5000);
    return () => window.clearInterval(timer);
  }, [apiReady]);

  useEffect(() => {
    if (settings && !model) setModel(settings.default_model_label);
  }, [settings, model]);

  useEffect(() => {
    if (modes.length && !modes.some((item) => item.id === mode)) setMode(modes[0].id);
  }, [modes, mode]);

  useEffect(() => {
    const panel = reportRef.current;
    if (!panel) return;
    if (forceNextScrollRef.current || stickToBottomRef.current) {
      panel.scrollTo({ top: panel.scrollHeight });
      forceNextScrollRef.current = false;
      stickToBottomRef.current = true;
    }
  }, [report, messages, agentPlans]);

  useEffect(() => {
    if (!apiReady || chatMode !== "agent" || !sessionId) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || busy === "agent" || busy === "chat") return;
      await refreshAgentSession(sessionId, { silent: true });
    };
    const timer = window.setInterval(() => void refresh(), 3000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [apiReady, chatMode, sessionId, busy]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const state = resizeStateRef.current;
      if (!state) return;
      const nextHeight = Math.min(220, Math.max(56, state.startHeight + state.startY - event.clientY));
      setInputHeight(nextHeight);
    }

    function handlePointerUp() {
      resizeStateRef.current = null;
      document.body.classList.remove("is-resizing-composer");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    function closeSelect(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target?.closest(".pill-select")) setOpenSelect(null);
      if (!target?.closest(".recent-files-popover")) setRecentFilesOpen(false);
      if (!target?.closest(".project-context-menu") && !target?.closest(".project-context-trigger")) setContextMenuOpen(false);
      if (!target?.closest(".context-details-popover") && !target?.closest(".context-status-pill")) setContextDetailsOpen(false);
    }

    window.addEventListener("mousedown", closeSelect);
    return () => window.removeEventListener("mousedown", closeSelect);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenSelect(null);
        setRecentFilesOpen(false);
        setContextMenuOpen(false);
        setContextDetailsOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  function receiveEditorContext(payload: EditorPayload, options: { preserveMode?: boolean } = {}) {
    const isMultiFile = payload.sourceType === "pickedFiles"
      || payload.sourceType === "recentFiles"
      || payload.sourceType === "workspaceFiles"
      || payload.sourceType === "workspaceRules"
      || payload.sourceType === "autoWorkspace"
      || Boolean(payload.files?.length);
    const language = isMultiFile
      ? { label: "多文件", code: "text" }
      : payload.languageLabel
      ? { label: payload.languageLabel, code: payload.languageCode ?? "python" }
      : languageFromVsCodeId(payload.languageId);

    const normalizedFiles = payload.files?.map(normalizeContextFile);
    const nextContextBase = { ...payload, languageLabel: language.label, languageCode: language.code, files: normalizedFiles };
    const nextContext = normalizedFiles?.length ? composeContextWithFiles(nextContextBase, normalizedFiles) : nextContextBase;
    setContext(nextContext);
    setMetrics(null);
    setReport("");
    setReportId(null);
    setSessionId(null);
    setMessages([]);
    setChatMode((current) => (options.preserveMode ? current : "report"));
    setError("");
    setRecentFilesOpen(false);
    setContextMenuOpen(false);
    setContextDetailsOpen(false);
    setRecentFilesMenu([]);
    setSelectedRecentFiles(new Set());
    setAgentPlans([]);
    return nextContext;
  }

  async function loadBootData() {
    if (!getApiBase()) {
      setBusy("health");
      setError("正在等待 VS Code 插件注入后端地址...");
      return;
    }

    setBusy((current) => current ?? "health");
    setError("");
    try {
      const [nextHealth, nextSettings, nextLlmKeyStatus] = await Promise.all([
        api.health(),
        api.settings(),
        api.llmKeyStatus(),
      ]);
      setHealth(nextHealth);
      setSettings(nextSettings);
      setLlmKeyStatus(nextLlmKeyStatus);
      setModel((current) => current || nextSettings.default_model_label);
      void loadAnalytics();
      await loadHistory();
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : "插件初始化失败";
      setError(message === "Failed to fetch" ? "无法连接本地 FastAPI 后端，请查看 CodeLens Pro Backend 输出面板。" : message);
    } finally {
      setBusy((current) => (current === "health" ? null : current));
    }
  }

  async function loadAnalytics() {
    try {
      setAnalytics(await api.analytics());
    } catch {
      setAnalytics(null);
    }
  }

  async function saveLlmKey() {
    const value = llmKeyInput.trim();
    if (!value) {
      setLlmKeyMessage("请先填写 DeepSeek 官方 API Key。");
      setLlmKeyOk(false);
      return;
    }
    setLlmKeyBusy("save");
    setLlmKeyMessage("");
    try {
      const result = await api.saveLlmKey(value);
      setLlmKeyMessage(result.detail || result.status);
      setLlmKeyOk(result.ok);
      if (result.ok) {
        setLlmKeyInput("");
        if (result.key_status) setLlmKeyStatus(result.key_status);
        await loadBootData();
        await loadAnalytics();
      }
    } catch (exc) {
      setLlmKeyMessage(exc instanceof Error ? exc.message : "保存失败");
      setLlmKeyOk(false);
    } finally {
      setLlmKeyBusy("");
    }
  }

  async function testLlmKey() {
    setLlmKeyBusy("test");
    setLlmKeyMessage("");
    try {
      const result = await api.testLlmKey(llmKeyInput.trim() || null);
      setLlmKeyMessage(result.detail || result.status);
      setLlmKeyOk(result.ok);
      if (result.key_status) setLlmKeyStatus(result.key_status);
    } catch (exc) {
      setLlmKeyMessage(exc instanceof Error ? exc.message : "测试失败");
      setLlmKeyOk(false);
    } finally {
      setLlmKeyBusy("");
    }
  }

  async function clearLlmKey() {
    setLlmKeyBusy("clear");
    setLlmKeyMessage("");
    try {
      const nextStatus = await api.clearLlmKey();
      setLlmKeyStatus(nextStatus);
      setLlmKeyInput("");
      setLlmKeyMessage(nextStatus.configured ? "已清除页面保存的 Key，当前回退到 .env 配置。" : "已清除页面保存的 Key，当前未配置。");
      setLlmKeyOk(true);
      await loadBootData();
      await loadAnalytics();
    } catch (exc) {
      setLlmKeyMessage(exc instanceof Error ? exc.message : "清除失败");
      setLlmKeyOk(false);
    } finally {
      setLlmKeyBusy("");
    }
  }

  async function loadHistory() {
    try {
      const [reports, sessions] = await Promise.all([api.listReports(), api.listChatSessions()]);
      setHistory(reports.slice(0, 12));
      setChatHistory(sessions.slice(0, 12));
    } catch {
      setHistory([]);
      setChatHistory([]);
    }
  }

  async function loadPendingAgentTasks() {
    try {
      const tasks = await api.pendingAgentTasks();
      if (!tasks.length) return;
      setAgentPlans((previous) => mergeAgentPlans(previous, tasks));
    } catch {
      // Pending Agent tasks are optional; keep the plugin quiet if the backend is unavailable.
    }
  }

  async function refreshAgentSession(nextSessionId: string, options: { silent?: boolean } = {}) {
    if (!options.silent) setBusy("history");
    try {
      const detail = await api.getChatSession(nextSessionId);
      if (detail.context_type !== "agent") return;
      const nextMessages = detail.messages
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({ role: item.role as "user" | "assistant", content: item.content }));
      setSessionId(detail.id);
      setMessages(nextMessages);
      setAgentPlans(detail.agent_plans ?? []);
      setReport("");
      setReportId(null);
      setMetrics(null);
      setChatMode("agent");
      setViewMode("main");
    } catch (exc) {
      if (!options.silent) setError(exc instanceof Error ? exc.message : "Agent 对话加载失败");
    } finally {
      if (!options.silent) setBusy(null);
    }
  }

  function requestPickedFiles() {
    setContextMenuOpen(false);
    postToVsCode({ type: "codelens.pickFiles" });
  }

  function requestEditorContext(selectionOnly: boolean) {
    setContextMenuOpen(false);
    postToVsCode({ type: "codelens.requestEditorContext", selectionOnly });
  }

  function requestWorkspaceFiles() {
    setContextMenuOpen(false);
    postToVsCode({ type: "codelens.pickWorkspaceFiles" });
  }

  function requestWorkspaceRules() {
    setContextMenuOpen(false);
    postToVsCode({ type: "codelens.collectWorkspaceFiles" });
  }

  function requestRecentFiles() {
    setContextMenuOpen(false);
    setContextDetailsOpen(false);
    if (recentFilesOpen) {
      setRecentFilesOpen(false);
      return;
    }
    postToVsCode({ type: "codelens.collectRecentFiles" });
  }

  function requestProjectFilesMenu() {
    setRecentFilesOpen(false);
    setContextDetailsOpen(false);
    setContextMenuOpen((current) => !current);
  }

  function requestAutoAgentContext(message: string, action: AgentAction) {
    pendingAutoAgentRef.current = { message, action };
    setPendingAutoAgent({ message, action });
    setBusy(action === "plan" ? "agent" : "chat");
    setError("正在自动收集当前项目上下文...");
    setQuestion("");
    setContextMenuOpen(false);
    setRecentFilesOpen(false);
    forceNextScrollRef.current = true;
    postToVsCode({ type: "codelens.autoCollectWorkspaceFiles" });
  }

  function resolveContextLanguage(activeContext: EditorPayload) {
    if (activeContext.sourceType === "pickedFiles"
      || activeContext.sourceType === "recentFiles"
      || activeContext.sourceType === "workspaceFiles"
      || activeContext.sourceType === "workspaceRules"
      || activeContext.sourceType === "autoWorkspace"
      || activeContext.files?.length) {
      return { label: "多文件", code: "text" };
    }
    if (activeContext.languageLabel) {
      return {
        label: activeContext.languageLabel,
        code: activeContext.languageCode ?? languages[activeContext.languageLabel] ?? "python",
      };
    }
    return languageFromVsCodeId(activeContext.languageId);
  }

  function toggleRecentFile(key: string) {
    setSelectedRecentFiles((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllRecentFiles() {
    setSelectedRecentFiles(new Set(recentFilesMenu.map(recentFileKey)));
  }

  function selectedRecentFileItems() {
    return recentFilesMenu.filter((item) => selectedRecentFiles.has(recentFileKey(item)) && item.code?.trim());
  }

  function updateContextFileAttention(fileIndex: number, attention: FileAttention) {
    if (!context.files?.length) return;
    setContext((current) => {
      if (!current.files?.length) return current;
      const nextFiles = current.files.map((file, index) => (
        index === fileIndex ? { ...file, attention } : normalizeContextFile(file)
      ));
      return composeContextWithFiles(current, nextFiles);
    });
  }

  function startNewWorkspace() {
    setMetrics(null);
    setReport("");
    setReportId(null);
    setSessionId(null);
    setMessages([]);
    setQuestion("");
    setChatMode("report");
    setAgentAction("chat");
    setViewMode("main");
    setError("");
    setRecentFilesOpen(false);
    setContextDetailsOpen(false);
    setRecentFilesMenu([]);
    setSelectedRecentFiles(new Set());
    setAgentPlans([]);
    reportRef.current?.scrollTo({ top: 0 });
  }

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    resizeStateRef.current = { startY: event.clientY, startHeight: inputHeight };
    document.body.classList.add("is-resizing-composer");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleReportScroll(event: React.UIEvent<HTMLDivElement>) {
    stickToBottomRef.current = isNearBottom(event.currentTarget);
  }

  async function runStaticAnalyze() {
    if (!context.code?.trim()) {
      setError("当前没有可分析的代码。");
      return;
    }

    setBusy("static");
    setError("");
    try {
      setMetrics(await api.staticAnalyze(context.code, languageCode));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "静态分析失败");
    } finally {
      setBusy(null);
    }
  }

  async function generateReport() {
    if (!context.code?.trim()) {
      setError("当前没有可分析的代码。");
      return;
    }

    setBusy("report");
    setError("");
    setReport("");
    setReportId(null);
    setSessionId(null);
    setMessages([]);
    setChatMode("report");
    setAgentPlans([]);
    forceNextScrollRef.current = true;

    try {
      setMetrics(await api.staticAnalyze(context.code, languageCode));
      await streamPost(
        "/api/reports/stream",
        {
          code: context.code,
          mode,
          language_code: languageCode,
          language_label: languageLabel,
          model: selectedModel,
        },
        {
          onDelta: (text) => setReport((previous) => previous + text),
          onDone: (data) => {
            setReportId(String(data.id ?? "") || null);
            setBusy(null);
            void loadHistory();
          },
          onError: (message) => {
            setError(message);
            setBusy(null);
          },
        }
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "生成报告失败");
      setBusy(null);
    }
  }

  async function runAgentPlan() {
    const instruction = question.trim();
    if (!instruction) return;
    if (shouldAutoCollectProjectContext(instruction, context)) {
      requestAutoAgentContext(instruction, "plan");
      return;
    }
    if (!hasContext(context)) {
      setError("请先选择文件或代码片段，再让 Agent 规划。");
      return;
    }
    await runAgentPlanWithContext(instruction, context);
  }

  async function runAgentPlanWithContext(instruction: string, activeContext: EditorPayload) {
    const activeLanguage = resolveContextLanguage(activeContext);
    setBusy("agent");
    setError("");
    setQuestion("");
    forceNextScrollRef.current = true;
    setMessages((previous) => [
      ...previous,
      { role: "user", content: instruction },
      { role: "assistant", content: "正在生成 Agent 计划..." },
    ]);
    try {
      const nextPlan = await api.agentPlan({
        instruction,
        session_id: sessionId,
        code_context: activeContext.code ?? "",
        language_code: activeLanguage.code,
        language_label: activeLanguage.label,
        file_name: activeContext.fileName,
        file_path: activeContext.filePath,
        report_context: report || null,
        files: activeContext.files,
        model: selectedModel,
        source: "plugin",
      });
      setAgentPlans((previous) => [...previous, nextPlan]);
      setReport("");
      setReportId(null);
      setSessionId(nextPlan.session_id ?? sessionId);
      setChatMode("agent");
      setViewMode("main");
      setMessages((previous) => {
        const next = [...previous];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: `Agent 任务已生成。\n\n摘要：${nextPlan.summary}\n状态：${nextPlan.apply_result || "等待网页确认或插件执行。"}`
          };
        }
        return next;
      });
      if (nextPlan.session_id) await refreshAgentSession(nextPlan.session_id, { silent: true });
      void loadHistory();
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : "Agent 计划生成失败";
      const friendlyMessage = message.includes("Not Found") ? "当前 FastAPI 后端版本过旧，缺少 Agent 接口。请重启后端后再试。" : message;
      setError(friendlyMessage);
      setMessages((previous) => {
        const next = [...previous];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, content: `Agent 计划生成失败：${friendlyMessage}` };
        }
        return next;
      });
    } finally {
      setBusy(null);
    }
  }

  async function runAgentChat() {
    const userMessage = question.trim();
    if (!userMessage) return;
    if (shouldAutoCollectProjectContext(userMessage, context)) {
      requestAutoAgentContext(userMessage, "chat");
      return;
    }
    if (!hasContext(context)) {
      setError("请先点击“项目文件”选择当前文件、选中代码、工作区文件或按规则收集项目上下文，再让 Agent 分析。");
      setContextMenuOpen(true);
      return;
    }
    await runAgentChatWithContext(userMessage, context);
  }

  async function runAgentChatWithContext(userMessage: string, activeContext: EditorPayload) {
    setBusy("chat");
    setError("");
    setQuestion("");
    forceNextScrollRef.current = true;
    setMessages((previous) => [...previous, { role: "user", content: userMessage }, { role: "assistant", content: "" }]);

    try {
      await streamPost(
        "/api/agent/chat/stream",
        {
          message: userMessage,
          session_id: sessionId,
          code_context: activeContext.code ?? "",
          report_context: report || null,
          files: activeContext.files ?? [],
          model: selectedModel,
          source: "plugin",
        },
        {
          onDelta: (text) => {
            setMessages((previous) => {
              const next = [...previous];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + text };
              return next;
            });
          },
          onDone: (data) => {
            setSessionId(String(data.session_id ?? sessionId ?? "") || null);
            setChatMode("agent");
            setBusy(null);
            void loadHistory();
          },
          onError: (messageText) => {
            setError(messageText);
            setBusy(null);
          },
        }
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Agent 讨论失败");
      setBusy(null);
    }
  }

  function applyAgentPlan(plan: AgentPlan) {
    if (!plan.operations.length) return;
    postToVsCode({ type: "codelens.applyAgentPlan", plan });
  }

  async function generatePlanForTask(plan: AgentPlan) {
    const instruction = plan.instruction || plan.summary;
    if (!instruction.trim()) return;
    if (!context.code?.trim() && !context.files?.length) {
      setError("请先通过“项目文件”选择工作区上下文，再处理网页端 Agent 任务。");
      return;
    }

    setBusy("agent");
    setError("");
    forceNextScrollRef.current = true;
    try {
      const nextPlan = await api.agentPlan({
        instruction,
        task_id: plan.plan_id ?? plan.id ?? null,
        session_id: plan.session_id ?? sessionId,
        agent_action: "plan",
        code_context: context.code ?? "",
        language_code: languageCode,
        language_label: languageLabel,
        file_name: context.fileName,
        file_path: context.filePath,
        report_context: report || null,
        files: context.files,
        model: selectedModel,
        source: "plugin",
      });
      setAgentPlans((previous) => mergeAgentPlans(previous, [nextPlan]));
      setSessionId(nextPlan.session_id ?? plan.session_id ?? sessionId);
      setChatMode("agent");
      setAgentAction("plan");
      if (nextPlan.session_id) await refreshAgentSession(nextPlan.session_id, { silent: true });
      void loadHistory();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "网页端 Agent 任务处理失败");
    } finally {
      setBusy(null);
    }
  }

  async function sendQuestion() {
    const userMessage = question.trim();
    if (busy === "chat" || busy === "agent") return;
    if (!userMessage) return;
    if (chatMode === "agent") {
      if (agentAction === "plan") await runAgentPlan();
      else await runAgentChat();
      return;
    }
    if (chatMode === "report" && !report && !context.code) {
      setError("请先生成报告或注入代码后再追问。");
      return;
    }

    setBusy("chat");
    setError("");
    setQuestion("");
    forceNextScrollRef.current = true;
    setMessages((previous) => [...previous, { role: "user", content: userMessage }, { role: "assistant", content: "" }]);

    try {
      await streamPost(
        "/api/chat/stream",
        {
          message: userMessage,
          session_id: chatMode === "report" ? sessionId : null,
          report_id: chatMode === "report" ? reportId : null,
          context_type: chatMode === "report" ? "report" : "general",
          code_context: chatMode === "report" ? context.code : null,
          report_context: chatMode === "report" ? report : null,
          model: selectedModel,
        },
        {
          onDelta: (text) => {
            setMessages((previous) => {
              const next = [...previous];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + text };
              return next;
            });
          },
          onDone: (data) => {
            setSessionId(String(data.session_id ?? "") || null);
            setBusy(null);
            void loadHistory();
          },
          onError: (messageText) => {
            setError(messageText);
            setBusy(null);
          },
        }
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "追问失败");
      setBusy(null);
    }
  }

  async function openHistoryReport(id: string) {
    setBusy("history");
    setError("");
    try {
      const detail: ReportDetail = await api.getReport(id);
      setContext({
        code: detail.code_content ?? detail.code_a ?? "",
        languageLabel: detail.language_label,
        languageCode: detail.language_code,
        fileName: detail.title,
      });
      setReport(detail.content);
      setReportId(detail.id);
      setSessionId(detail.chat_session_id ?? null);
      setMetrics(detail.metrics ?? null);
      setMessages([]);
      setChatMode("report");
      setAgentPlans([]);
      setRecentFilesOpen(false);
      setViewMode("main");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "历史报告加载失败");
    } finally {
      setBusy(null);
    }
  }

  async function openChatSession(id: string) {
    setBusy("history");
    setError("");
    try {
      const detail = await api.getChatSession(id);
      const nextMessages = detail.messages
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({ role: item.role as "user" | "assistant", content: item.content }));

      if (detail.context_type === "agent") {
        setReport("");
        setReportId(null);
        setMetrics(null);
        setChatMode("agent");
        setAgentPlans(detail.agent_plans ?? []);
        setRecentFilesOpen(false);
      } else if (detail.report_id) {
        const reportDetail = await api.getReport(detail.report_id);
        setContext({
          code: reportDetail.code_content ?? reportDetail.code_a ?? "",
          languageLabel: reportDetail.language_label,
          languageCode: reportDetail.language_code,
          fileName: reportDetail.title,
        });
        setReport(reportDetail.content);
        setReportId(reportDetail.id);
        setMetrics(reportDetail.metrics ?? null);
        setChatMode("report");
        setAgentPlans([]);
        setRecentFilesOpen(false);
      } else {
        setReport("");
        setReportId(null);
        setMetrics(null);
        setChatMode("free");
        setAgentPlans([]);
        setRecentFilesOpen(false);
      }

      setSessionId(detail.id);
      setMessages(nextMessages);
      setQuestion("");
      setViewMode("main");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "历史对话加载失败");
    } finally {
      setBusy(null);
    }
  }

  const currentModeLabel = useMemo(() => modes.find((item) => item.id === mode)?.label ?? "分析模式", [modes, mode]);
  const currentPanelLabel = chatMode === "agent" ? (agentAction === "plan" ? "Agent 计划修改" : "Agent 讨论") : currentModeLabel;
  const isWorking = busy === "static" || busy === "report" || busy === "chat" || busy === "agent";
  const isIdle = !report && !messages.length && !agentPlans.length && !question.trim() && busy !== "health";
  const contextFiles = context.files ?? [];
  const contextFileCount = context.files?.length ?? (context.code?.trim() ? 1 : 0);
  const contextCharCount = context.files?.reduce((total, item) => total + (item.code?.length ?? 0), 0) ?? (context.code?.length ?? 0);
  const canInspectContextDetails = contextFiles.length > 1;
  const contextSourceLabel = sourceTypeLabel(context.sourceType);
  const contextStatusTitle = canInspectContextDetails
    ? "查看文件上下文并调整当前会话关注度"
    : contextFileCount ? "当前上下文只有一个文件" : "当前没有文件上下文";
  const balanceLabel = analytics?.api_balance.available
    ? `${analytics.api_balance.currency ? `${analytics.api_balance.currency} ` : ""}${formatBalance(analytics.api_balance.total_balance ?? 0)}`
    : analytics?.api_balance.status ?? "--";
  const tokenLabel = analytics ? formatCompactNumber(analytics.token_usage.total_tokens) : "--";
  const llmKeyConfigured = Boolean(llmKeyStatus?.configured ?? health?.llm_key_configured);
  const llmKeySourceLabel = llmKeyStatus?.source === "user" ? "页面保存" : llmKeyStatus?.source === "env" ? ".env 回退" : "未配置";

  return (
    <main className="mini-shell">
      <header className="mini-header">
        <div className="brand-row top-toolbar">
          <div className="brand-mark"><Sparkles size={15} /></div>
          <div className="brand-copy">
            <h1>CodeLens Pro</h1>
            <p title={context.filePath || context.fileName}>{context.fileName || "未选择文件"}</p>
          </div>
          <div className="top-insights">
            <span title={analytics?.api_balance.detail || analytics?.api_balance.status || "API 余额"}>
              余额 <strong>{balanceLabel}</strong>
            </span>
            <span title={analytics?.token_usage.method || "Token 统计"}>
              Token <strong>{tokenLabel}</strong>
            </span>
          </div>
          <div className="top-actions">
            <button className="top-chip project-context-trigger" type="button" onClick={requestProjectFilesMenu} title="选择项目上下文">
              <FolderOpen size={13} /> 项目文件
            </button>
            <button className="top-chip" type="button" onClick={startNewWorkspace} title="开始新的对话">
              <Plus size={13} /> 新对话
            </button>
          </div>
          <div className="top-metrics">
            <span title="函数数量">ƒ {metrics?.functions?.count ?? "-"}</span>
            <span className={(metrics?.secrets_risk?.length ?? 0) > 0 ? "top-risk-warn" : ""} title="安全风险">
              ! {metrics?.secrets_risk?.length ?? "-"}
            </span>
          </div>
          <button className="icon-button" type="button" title="刷新状态" onClick={() => { void loadBootData(); }}>
            <RefreshCw size={15} />
          </button>
          <button className="icon-button" type="button" title="最近对话" onClick={() => { setViewMode("history"); void loadHistory(); }}>
            <History size={15} />
          </button>
        </div>
        <div className="status-row compact-status-row">
          <StatusDot ok={Boolean(health?.mysql_ok)} label="MySQL" />
          <StatusDot ok={llmKeyConfigured} label="Key" />
          <button
            className={`context-status-pill ${canInspectContextDetails ? "context-status-pill-action" : "context-status-pill-muted"}`}
            type="button"
            title={contextStatusTitle}
            aria-expanded={contextDetailsOpen}
            aria-disabled={!canInspectContextDetails}
            onClick={() => {
              if (!canInspectContextDetails) return;
              setContextMenuOpen(false);
              setRecentFilesOpen(false);
              setContextDetailsOpen((current) => !current);
            }}
          >
            {contextSourceLabel} · {contextFileCount} 文件 · {formatCompactNumber(contextCharCount)} 字符
          </button>
          <span className="context-status-pill">{contextFileCount} 文件 · {formatCompactNumber(contextCharCount)} 字符</span>
        </div>
        <div className="mini-llm-key-panel" aria-label="DeepSeek API Key 配置">
          <div className="mini-llm-key-status">
            <KeyRound size={12} />
            <span>{llmKeyConfigured ? (llmKeyStatus?.masked_key || "已配置") : "未配置 Key"}</span>
            <small>{llmKeySourceLabel}</small>
          </div>
          <input
            value={llmKeyInput}
            onChange={(event) => setLlmKeyInput(event.target.value)}
            placeholder="DeepSeek 官方 API Key"
            type="password"
          />
          <button className="mini-llm-key-button mini-llm-key-primary" type="button" disabled={Boolean(llmKeyBusy)} onClick={saveLlmKey}>
            {llmKeyBusy === "save" ? <Loader2 className="spin" size={12} /> : <CheckCircle2 size={12} />}
            保存
          </button>
          <button className="mini-llm-key-button" type="button" disabled={Boolean(llmKeyBusy)} onClick={testLlmKey}>
            {llmKeyBusy === "test" ? <Loader2 className="spin" size={12} /> : <RefreshCw size={12} />}
            测试
          </button>
          <button
            className="mini-llm-key-button"
            type="button"
            disabled={Boolean(llmKeyBusy) || llmKeyStatus?.source !== "user"}
            onClick={clearLlmKey}
            title="清除页面保存的 Key"
          >
            {llmKeyBusy === "clear" ? <Loader2 className="spin" size={12} /> : <Trash2 size={12} />}
          </button>
          {llmKeyMessage ? <div className={`mini-llm-key-message ${llmKeyOk ? "mini-llm-key-message-ok" : "mini-llm-key-message-bad"}`}>{llmKeyMessage}</div> : null}
        </div>
      </header>

      {contextDetailsOpen && canInspectContextDetails ? (
        <div className="context-details-popover" ref={contextDetailsRef}>
          <div className="context-details-head">
            <div>
              <strong>{contextSourceLabel} 文件上下文</strong>
              <span>{contextFiles.length} 个文件 · {formatCompactNumber(contextCharCount)} 字符 · 权重仅对当前会话生效</span>
            </div>
            <button type="button" onClick={() => setContextDetailsOpen(false)} aria-label="关闭文件上下文详情">
              <X size={14} />
            </button>
          </div>
          <div className="context-details-list">
            {contextFiles.map((file, index) => {
              const attention = normalizeAttention(file.attention);
              return (
                <article className={`context-file-card context-file-card-${attention}`} key={`${file.filePath || file.fileName || "file"}-${index}`}>
                  <div className="context-file-main">
                    <strong title={file.filePath || file.fileName}>{file.fileName || `File ${index + 1}`}</strong>
                    <span title={file.filePath || file.languageId}>{file.filePath || file.languageId || "file"}</span>
                    <small>{file.languageId || "text"} · {formatCompactNumber(file.code?.length ?? 0)} 字符</small>
                  </div>
                  <div className="context-file-attention" aria-label="文件关注度">
                    {(["low", "normal", "high"] as FileAttention[]).map((value) => (
                      <button
                        key={value}
                        className={attention === value ? "context-file-attention-active" : ""}
                        type="button"
                        onClick={() => updateContextFileAttention(index, value)}
                      >
                        {attentionLabel(value)}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {contextMenuOpen ? (
        <div className="project-context-menu">
          <div className="project-context-head">
            <strong>项目上下文</strong>
            <span>选择文件后，Agent 讨论与计划修改都会携带这些内容。</span>
          </div>
          <button type="button" onClick={() => requestEditorContext(false)}>
            <Bot size={14} />
            <span><strong>当前文件</strong><small>读取活动编辑器全文</small></span>
          </button>
          <button type="button" onClick={() => requestEditorContext(true)}>
            <Clipboard size={14} />
            <span><strong>选中代码</strong><small>优先读取当前 selection</small></span>
          </button>
          <button type="button" onClick={requestRecentFiles}>
            <Files size={14} />
            <span><strong>最近打开</strong><small>多选最近编辑过的文件</small></span>
          </button>
          <button type="button" onClick={requestPickedFiles}>
            <FolderOpen size={14} />
            <span><strong>本地文件</strong><small>从文件系统选择一个或多个文件</small></span>
          </button>
          <button type="button" onClick={requestWorkspaceFiles}>
            <FolderOpen size={14} />
            <span><strong>工作区文件</strong><small>从项目文件中手动多选</small></span>
          </button>
          <button type="button" onClick={requestWorkspaceRules}>
            <Sparkles size={14} />
            <span><strong>按规则收集</strong><small>当前目录、源码或配置文件</small></span>
          </button>
        </div>
      ) : null}

      {recentFilesOpen ? (
        <div className="recent-files-popover" ref={recentFilesRef}>
          <div className="recent-files-popover-head">
            <div>
              <strong>最近文件</strong>
              <span>选择一个或多个文件作为上下文。</span>
            </div>
            <button type="button" className="recent-files-popover-close" onClick={() => setRecentFilesOpen(false)} aria-label="关闭最近文件菜单">
              <X size={14} />
            </button>
          </div>
          <div className="recent-files-popover-list">
            {recentFilesMenu.length ? recentFilesMenu.map((item) => {
              const key = recentFileKey(item);
              const selected = selectedRecentFiles.has(key);
              return (
              <button
                key={key}
                type="button"
                className={`recent-files-popover-item ${selected ? "recent-files-popover-item-selected" : ""}`}
                title={item.filePath || item.fileName}
                onClick={() => toggleRecentFile(key)}
              >
                <span className="recent-files-check">{selected ? "✓" : ""}</span>
                <span className="recent-files-label">
                  <strong>{item.fileName || "未命名文件"}</strong>
                  <small>{item.filePath || item.languageId || "file"}</small>
                </span>
              </button>
            );}) : <p className="recent-files-popover-empty">没有找到最近打开的文件。</p>}
          </div>
          <div className="recent-files-popover-actions">
            <button type="button" className="recent-files-popover-secondary" onClick={selectAllRecentFiles} disabled={!recentFilesMenu.length}>
              全选
            </button>
            <button type="button" className="recent-files-popover-secondary" onClick={() => setSelectedRecentFiles(new Set())} disabled={!selectedRecentFiles.size}>
              清空
            </button>
            <button
              type="button"
              className="recent-files-popover-merge"
              disabled={!selectedRecentFiles.size}
              onClick={() => {
                const files = selectedRecentFileItems();
                if (!files.length) return;
                const mergedCode = files
                  .map((item, index) => [
                    `## File ${index + 1}: ${item.fileName || `文件 ${index + 1}`}`,
                    `Path: ${item.filePath || "unknown"}`,
                    `Language: ${item.languageId || "text"}`,
                    "",
                    "```" + (item.languageId || "text"),
                    item.code,
                    "```",
                  ].join("\n"))
                  .join("\n\n---\n\n");
                receiveEditorContext({
                  code: mergedCode,
                  languageId: "plaintext",
                  languageLabel: "多文件",
                  languageCode: "text",
                  fileName: `最近文件上下文 · ${files.length} 个文件`,
                  filePath: files.map((item) => item.filePath || "").filter(Boolean).join("; "),
                  sourceType: "recentFiles",
                  files,
                }, { preserveMode: true });
              }}
            >
              加入所选 {selectedRecentFiles.size || ""} 个
            </button>
          </div>
        </div>
      ) : null}

      {viewMode === "history" ? (
        <section className="history-page">
          <div className="section-title history-page-title">
            <span><History size={14} /> 最近对话</span>
            <button type="button" onClick={() => setViewMode("main")}><X size={14} /> 关闭</button>
          </div>
          <div className="history-page-list history-columns">
            <section className="history-group">
              <div className="history-group-title"><Bot size={13} /> 报告</div>
              {history.length ? history.map((item) => (
                <button className="history-card" key={item.id} type="button" onClick={() => openHistoryReport(item.id)}>
                  <span>{item.title}</span>
                  <small>{item.language_label} · {formatDate(item.created_at)}</small>
                </button>
              )) : <p className="empty-text">暂无报告</p>}
            </section>
            <section className="history-group">
              <div className="history-group-title"><MessageSquare size={13} /> AI 对话</div>
              {chatHistory.length ? chatHistory.map((item) => (
                <button className="history-card history-card-chat" key={item.id} type="button" onClick={() => openChatSession(item.id)}>
                  <span>{item.title}</span>
                  <small>{chatTypeLabel(item)} · {formatDate(item.updated_at)}</small>
                </button>
              )) : <p className="empty-text">暂无对话</p>}
            </section>
          </div>
        </section>
      ) : (
        <>
          {error ? <div className="notice"><AlertCircle size={15} /><span>{error}</span></div> : null}

          <section className="report-section">
            <div className="section-title"><span>{chatMode === "report" ? "报告 / 对话" : chatMode === "agent" ? "Agent 工作区" : "自由对话"}</span><small>{busy === "report" ? "正在生成报告..." : busy === "agent" ? "正在生成 Agent 计划..." : currentPanelLabel}</small></div>
            <div className="report-body" ref={reportRef} onScroll={handleReportScroll}>
              {chatMode === "agent" && agentPlans.length ? <div className="agent-plan-stack">{agentPlans.map((plan) => <AgentPlanView plan={plan} key={plan.plan_id ?? plan.id ?? plan.summary} onApply={() => applyAgentPlan(plan)} onGenerate={() => generatePlanForTask(plan)} />)}</div> : null}
              {report ? <Markdown content={report} /> : isIdle ? <IdleSticker chatMode={chatMode} /> : <p className="empty-text">{busy === "health" ? (apiReady ? "正在连接本地服务..." : "正在等待插件连接...") : "报告和对话会显示在这里。"}</p>}
              {messages.length ? <div className="chat-thread">{messages.map((item, index) => <ChatItem item={item} key={`${item.role}-${index}`} />)}</div> : null}
            </div>
          </section>

          <footer className="ask-box">
            <button
              className="composer-resize-handle"
              type="button"
              aria-label="拖拽调整输入框高度"
              onPointerDown={beginResize}
            >
              <span />
            </button>
            <div className="composer-tools">
              <button className={`chip ${chatMode === "report" ? "chip-active" : ""}`} type="button" onClick={() => { setChatMode("report"); }}>
                <Bot size={13} /> 报告
              </button>
              <button className={`chip ${chatMode === "free" ? "chip-active" : ""}`} type="button" onClick={() => { setChatMode("free"); }}>
                <MessageSquare size={13} /> 自由
              </button>
              <button className={`chip ${chatMode === "agent" ? "chip-active" : ""}`} type="button" onClick={() => setChatMode("agent")}>
                <Sparkles size={13} /> Agent
              </button>
              {chatMode === "agent" ? (
                <div className="agent-action-toggle" aria-label="Agent 子模式">
                  <button className={agentAction === "chat" ? "agent-action-active" : ""} type="button" onClick={() => setAgentAction("chat")}>讨论</button>
                  <button className={agentAction === "plan" ? "agent-action-active" : ""} type="button" onClick={() => setAgentAction("plan")}>计划修改</button>
                </div>
              ) : null}
              {chatMode === "report" ? (
                <>
                  <PillSelect
                    id="modeGroup"
                    label={modeGroup === "function" ? "函数" : "脚本"}
                    options={[
                      { label: "函数", value: "function" },
                      { label: "脚本", value: "script" },
                    ]}
                    openSelect={openSelect}
                    setOpenSelect={setOpenSelect}
                    onChange={(value) => setModeGroup(value as "function" | "script")}
                  />
                  <PillSelect
                    id="mode"
                    label={modes.find((item) => item.id === mode)?.label ?? "分析模式"}
                    options={modes.map((item) => ({ label: item.label, value: item.id }))}
                    openSelect={openSelect}
                    setOpenSelect={setOpenSelect}
                    onChange={setMode}
                  />
                </>
              ) : null}
              <PillSelect
                id="model"
                label={selectedModel || "模型"}
                options={Object.keys(models).map((item) => ({ label: item, value: item }))}
                openSelect={openSelect}
                setOpenSelect={setOpenSelect}
                onChange={setModel}
              />
              <button className="tool-button" type="button" disabled={isWorking} onClick={runStaticAnalyze} title="静态分析">
                {busy === "static" ? <Loader2 className="spin" size={13} /> : <ShieldAlert size={13} />}
              </button>
              {chatMode === "report" ? (
              <button className="tool-button tool-button-primary" type="button" disabled={isWorking || !context.code?.trim()} onClick={generateReport} title="生成报告">
                {busy === "report" ? <Loader2 className="spin" size={13} /> : <Bot size={13} />}
              </button>
              ) : null}
            </div>
            <div className="composer-input">
              <textarea
                style={{ height: inputHeight }}
                value={question}
                placeholder={chatMode === "report" ? "围绕当前代码或报告提问..." : chatMode === "agent" ? (agentAction === "plan" ? "描述要修改哪些文件、怎么改..." : "询问项目结构、代码含义或调试思路...") : "自由提问..."}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
              />
              <button className="send-button" type="button" disabled={(busy === "chat" || busy === "agent") || !question.trim()} onClick={sendQuestion} title="发送">
                {busy === "chat" || busy === "agent" ? <Loader2 className="spin" size={15} /> : <ArrowUp size={16} />}
              </button>
            </div>
          </footer>
        </>
      )}
    </main>
  );
}

function IdleSticker({ chatMode }: { chatMode: ChatMode }) {
  return (
    <div className="idle-stage" aria-label="空状态">
      <div className="idle-wordmark">
        <span>CL</span>
        <strong>CodeLens Pro</strong>
      </div>
      <div className="idle-copy">
        <strong>{chatMode === "report" ? "准备分析" : "自由对话"}</strong>
        <span>{chatMode === "report" ? "代码、报告与追问会在这里展开" : "想法、问题与答案会在这里沉淀"}</span>
      </div>
    </div>
  );
}

function AgentPlanView({
  plan,
  onApply,
  onGenerate,
}: {
  plan: AgentPlan;
  onApply: () => void;
  onGenerate: () => void;
}) {
  const status = plan.status ?? "pending";
  const statusText = status === "pending"
    ? "待插件处理"
    : status === "waiting_confirm"
      ? "等待网页确认"
      : status === "confirmed"
        ? "已确认，等待插件应用"
        : status === "applied"
          ? "已应用"
          : status === "failed"
            ? "失败"
            : status === "rejected"
              ? "已拒绝"
              : "待应用";
  const needsPluginPlan = plan.source === "web" && !plan.operations.length && status === "pending";

  return (
    <section className="agent-plan-view" aria-label="Agent 计划预览">
      <div className="agent-plan-head">
        <div>
          <strong>Agent 计划 <span className={`agent-plan-status agent-plan-status-${status}`}>{statusText}</span></strong>
          <span>{plan.summary}</span>
          <small>{plan.source === "web" ? "来自网页端，需在 VS Code 中确认应用" : "来自 VS Code 插件"}</small>
        </div>
        <div className="agent-plan-actions">
          {needsPluginPlan ? (
            <button type="button" className="agent-plan-primary" onClick={onGenerate}>
              生成计划
            </button>
          ) : (
            <button type="button" className="agent-plan-primary" onClick={onApply} disabled={!plan.operations.length || status === "applied"}>
              应用变更
            </button>
          )}
        </div>
      </div>

      {plan.apply_result ? <p className="agent-plan-result">{plan.apply_result}</p> : null}

      {plan.assumptions.length ? (
        <div className="agent-plan-section">
          <span className="agent-plan-label">假设</span>
          <ul>
            {plan.assumptions.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      {plan.warnings.length ? (
        <div className="agent-plan-section agent-plan-section-warn">
          <span className="agent-plan-label">提醒</span>
          <ul>
            {plan.warnings.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="agent-plan-section">
        <span className="agent-plan-label">操作</span>
        <div className="agent-plan-list">
          {plan.operations.length ? plan.operations.map((item, index) => (
            <article className={`agent-plan-operation agent-plan-operation-${item.type}`} key={`${item.path}-${index}`}>
              <div className="agent-plan-operation-head">
                <strong>{item.type.toUpperCase()}</strong>
                <span>{item.path}{item.type === "rename" && item.new_path ? ` → ${item.new_path}` : ""}</span>
              </div>
              {item.reason ? <p>{item.reason}</p> : null}
              {item.content ? (
                <pre>
                  <code>{item.content}</code>
                </pre>
              ) : null}
            </article>
          )) : <p className="empty-text">暂未生成具体操作。</p>}
        </div>
      </div>
    </section>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-dot ${ok ? "status-dot-ok" : "status-dot-bad"}`}>{ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}{label}</span>;
}

function Metric({ label, value, tone = "normal" }: { label: string; value: string | number; tone?: "normal" | "warn" }) {
  return <div className={`metric metric-${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function PillSelect({
  id,
  label,
  options,
  openSelect,
  setOpenSelect,
  onChange,
}: {
  id: Exclude<SelectMenu, null>;
  label: string;
  options: Array<{ label: string; value: string }>;
  openSelect: SelectMenu;
  setOpenSelect: (value: SelectMenu) => void;
  onChange: (value: string) => void;
}) {
  const open = openSelect === id;

  return (
    <div className={["pill-select", id === "model" ? "pill-select-model" : ""].filter(Boolean).join(" ")}>
      <button
        className={`pill-select-trigger ${open ? "pill-select-trigger-open" : ""}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpenSelect(open ? null : id);
        }}
      >
        <span>{label}</span>
      </button>
      {open ? (
        <div className="pill-select-menu">
          {options.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                onChange(item.value);
                setOpenSelect(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChatItem({ item }: { item: ChatMessage }) {
  return (
    <div className={`chat-row chat-row-${item.role}`}>
      <div className={`chat-bubble chat-bubble-${item.role}`}>
        <div className="chat-role">{item.role === "user" ? "你" : "AI"}</div>
        <Markdown content={item.content || (item.role === "assistant" ? "正在回复..." : "")} compact />
      </div>
    </div>
  );
}

function Markdown({ content, compact = false }: { content: string; compact?: boolean }) {
  const blocks = splitMarkdown(content);
  return <div className={`markdown ${compact ? "markdown-compact" : ""}`}>{blocks.map((block, index) => block.type === "code" ? <CodeBlock key={index} code={block.content} language={block.language} /> : renderTextBlock(block.content, index))}</div>;
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const normalizedLanguage = normalizeCodeLanguage(language);

  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{normalizedLanguage || "text"}</span>
        <button type="button" onClick={() => navigator.clipboard.writeText(code)} title="复制代码">
          <Clipboard size={13} />
        </button>
      </div>
      <pre><code>{highlightCode(code, normalizedLanguage)}</code></pre>
    </div>
  );
}

const commonKeywords = new Set([
  "abstract", "and", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default",
  "delete", "do", "elif", "else", "enum", "except", "export", "extends", "false", "False", "finally", "for", "from",
  "function", "if", "implements", "import", "in", "interface", "is", "let", "new", "None", "not", "null", "or", "package",
  "pass", "private", "protected", "public", "raise", "return", "static", "super", "switch", "this", "throw", "true",
  "True", "try", "type", "var", "void", "while", "with", "yield",
]);

const builtinWords = new Set([
  "Array", "Boolean", "Date", "Dict", "Exception", "False", "List", "Map", "Number", "Object", "Promise", "Set",
  "String", "True", "console", "dict", "float", "int", "len", "list", "print", "range", "set", "sorted", "str", "tuple",
]);

function normalizeCodeLanguage(language?: string) {
  const value = (language ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    py: "python",
    python3: "python",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    cxx: "cpp",
    "c++": "cpp",
  };
  return aliases[value] ?? value;
}

function highlightCode(code: string, language?: string) {
  const lines = code.replace(/\s+$/, "").split("\n");
  return lines.map((line, index) => (
    <span className="syntax-line" key={index}>
      {highlightCodeLine(line, language)}
      {index < lines.length - 1 ? "\n" : null}
    </span>
  ));
}

function highlightCodeLine(line: string, language?: string) {
  const parts: JSX.Element[] = [];
  const isHashComment = ["python", "ruby", "shell", "bash", "sh"].includes(language ?? "");
  let index = 0;

  function push(className: string, value: string) {
    parts.push(<span className={className} key={`${index}-${parts.length}`}>{value}</span>);
  }

  while (index < line.length) {
    const rest = line.slice(index);
    const char = line[index];

    if (isHashComment && char === "#") {
      push("syntax-comment", rest);
      break;
    }
    if (!isHashComment && rest.startsWith("//")) {
      push("syntax-comment", rest);
      break;
    }

    if (char === "'" || char === "\"" || char === "`") {
      const quote = char;
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === "\\" && end + 1 < line.length) {
          end += 2;
          continue;
        }
        if (line[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      push("syntax-string", line.slice(index, end));
      index = end;
      continue;
    }

    const numberMatch = rest.match(/^\b\d+(?:\.\d+)?\b/);
    if (numberMatch) {
      push("syntax-number", numberMatch[0]);
      index += numberMatch[0].length;
      continue;
    }

    const wordMatch = rest.match(/^[A-Za-z_$][\w$]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const afterWord = line.slice(index + word.length);
      if (commonKeywords.has(word)) push("syntax-keyword", word);
      else if (builtinWords.has(word)) push("syntax-builtin", word);
      else if (/^\s*\(/.test(afterWord)) push("syntax-function", word);
      else push("syntax-plain", word);
      index += word.length;
      continue;
    }

    const operatorMatch = rest.match(/^[{}()[\].,:;+\-*/%=<>!&|^~@]+/);
    if (operatorMatch) {
      push("syntax-operator", operatorMatch[0]);
      index += operatorMatch[0].length;
      continue;
    }

    push("syntax-plain", char);
    index += 1;
  }

  return parts.length ? parts : <span className="syntax-plain">&nbsp;</span>;
}

function splitMarkdown(content: string) {
  const parts: Array<{ type: "text" | "code"; content: string; language?: string }> = [];
  const pattern = /```([^\n`]*)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content))) {
    if (match.index > lastIndex) parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    parts.push({ type: "code", language: match[1]?.trim(), content: match[2] });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < content.length) parts.push({ type: "text", content: content.slice(lastIndex) });
  return parts;
}

function renderTextBlock(text: string, key: number) {
  const nodes: JSX.Element[] = [];
  const lines = text.split("\n");
  let listItems: string[] = [];
  let listOrdered = false;
  let paragraphLines: string[] = [];

  function flushParagraph(index: number) {
    if (!paragraphLines.length) return;
    nodes.push(<p key={`p-${key}-${index}`}>{inline(paragraphLines.join(" "))}</p>);
    paragraphLines = [];
  }

  function flushList(index: number) {
    if (!listItems.length) return;
    const Tag = listOrdered ? "ol" : "ul";
    nodes.push(<Tag key={`list-${key}-${index}`}>{listItems.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</Tag>);
    listItems = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph(index);
      flushList(index);
      continue;
    }
    if (isTableStart(lines, index)) {
      flushParagraph(index);
      flushList(index);
      const table = readMarkdownTable(lines, index);
      nodes.push(
        <div className="markdown-table-wrap" key={`table-${key}-${index}`}>
          <table>
            <thead>
              <tr>{table.headers.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {table.headers.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      index = table.nextIndex;
      continue;
    }
    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph(index);
      flushList(index);
      const level = trimmed.match(/^#+/)?.[0].length ?? 2;
      const value = trimmed.replace(/^#{1,3}\s+/, "");
      if (level === 1) nodes.push(<h1 key={`h-${key}-${index}`}>{inline(value)}</h1>);
      else if (level === 2) nodes.push(<h2 key={`h-${key}-${index}`}>{inline(value)}</h2>);
      else nodes.push(<h3 key={`h-${key}-${index}`}>{inline(value)}</h3>);
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushParagraph(index);
      flushList(index);
      nodes.push(<blockquote key={`quote-${key}-${index}`}>{inline(trimmed.replace(/^>\s?/, ""))}</blockquote>);
      continue;
    }
    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph(index);
      const ordered = /^\d+\.\s+/.test(trimmed);
      if (listItems.length && ordered !== listOrdered) flushList(index);
      listOrdered = ordered;
      listItems.push(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
      continue;
    }
    flushList(index);
    paragraphLines.push(trimmed);
  }

  flushParagraph(998);
  flushList(999);
  return <div key={key}>{nodes}</div>;
}

function isTableStart(lines: string[], index: number) {
  return isTableLine(lines[index]) && index + 1 < lines.length && isTableSeparator(lines[index + 1]);
}

function isTableLine(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.split("|").length >= 3;
}

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function readMarkdownTable(lines: string[], startIndex: number) {
  const headers = parseTableCells(lines[startIndex]);
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length && isTableLine(lines[index]) && !isTableSeparator(lines[index])) {
    rows.push(parseTableCells(lines[index]));
    index += 1;
  }

  return { headers, rows, nextIndex: index - 1 };
}

function parseTableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((piece, index) => {
    if (piece.startsWith("`") && piece.endsWith("`")) return <code key={index}>{piece.slice(1, -1)}</code>;
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={index}>{piece.slice(2, -2)}</strong>;
    return <span key={index}>{piece}</span>;
  });
}

function normalizeContextFile(file: EditorFilePayload): EditorFilePayload {
  return {
    ...file,
    languageId: file.languageId || "text",
    fileName: file.fileName || fileBaseName(file.filePath) || "Untitled",
    attention: normalizeAttention(file.attention),
  };
}

function composeContextWithFiles(context: EditorPayload, files: EditorFilePayload[]): EditorPayload {
  const orderedFiles = orderContextFiles(files.map(normalizeContextFile));
  return {
    ...context,
    code: composeMultiFileCode(orderedFiles),
    languageId: "plaintext",
    languageLabel: "多文件",
    languageCode: "text",
    fileName: `${sourceTypeLabel(context.sourceType)}上下文 · ${orderedFiles.length} 个文件`,
    filePath: orderedFiles.map((file) => file.filePath || "").filter(Boolean).join("; "),
    files: orderedFiles,
  };
}

function composeMultiFileCode(files: EditorFilePayload[]) {
  return files
    .map((file, index) => [
      `## File ${index + 1}: ${file.fileName || `File ${index + 1}`}`,
      `Path: ${file.filePath || "unknown"}`,
      `Language: ${file.languageId || "text"}`,
      `Attention: ${normalizeAttention(file.attention)}`,
      "",
      "```" + (file.languageId || "text"),
      file.code,
      "```",
    ].join("\n"))
    .join("\n\n---\n\n");
}

function orderContextFiles(files: EditorFilePayload[]) {
  return files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => attentionRank(right.file.attention) - attentionRank(left.file.attention) || left.index - right.index)
    .map((item) => item.file);
}

function normalizeAttention(value?: string): FileAttention {
  return value === "low" || value === "high" ? value : "normal";
}

function attentionRank(value?: string) {
  return { low: 0, normal: 1, high: 2 }[normalizeAttention(value)];
}

function attentionLabel(value: FileAttention) {
  return value === "high" ? "高" : value === "low" ? "低" : "标准";
}

function sourceTypeLabel(value?: EditorPayload["sourceType"]) {
  const labels: Record<NonNullable<EditorPayload["sourceType"]>, string> = {
    current: "当前文件",
    selection: "选中代码",
    pickedFiles: "本地文件",
    recentFiles: "最近文件",
    workspaceFiles: "工作区文件",
    workspaceRules: "规则收集",
    autoWorkspace: "自动项目上下文",
  };
  return value ? labels[value] : "上下文";
}

function fileBaseName(value?: string) {
  const parts = value?.split(/[\\/]/).filter(Boolean) ?? [];
  return parts[parts.length - 1];
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatBalance(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return value;
  }
}

function recentFileKey(item: EditorPayload) {
  return `${item.filePath || item.fileName || "file"}::${item.languageId || item.languageCode || "text"}`;
}

function hasContext(item: EditorPayload) {
  return Boolean(item.code?.trim() || item.files?.some((file) => file.code?.trim()));
}

function isProjectContext(item: EditorPayload) {
  return item.sourceType === "autoWorkspace"
    || item.sourceType === "workspaceFiles"
    || item.sourceType === "workspaceRules"
    || Boolean(item.files && item.files.length > 1);
}

function shouldAutoCollectProjectContext(message: string, item: EditorPayload) {
  if (!isProjectLevelQuestion(message)) return false;
  return !hasContext(item) || !isProjectContext(item);
}

function isProjectLevelQuestion(message: string) {
  return /当前项目|整个项目|项目结构|项目架构|目录结构|工程结构|代码库|workspace|workbench|project structure|repository|repo/i.test(message);
}

function agentPlanKey(plan: AgentPlan) {
  return plan.plan_id || plan.id || `${plan.session_id || "session"}::${plan.instruction || plan.summary}`;
}

function mergeAgentPlans(current: AgentPlan[], incoming: AgentPlan[]) {
  const map = new Map<string, AgentPlan>();
  for (const item of current) map.set(agentPlanKey(item), item);
  for (const item of incoming) map.set(agentPlanKey(item), { ...map.get(agentPlanKey(item)), ...item });
  return Array.from(map.values()).sort((a, b) => {
    const left = new Date(a.updated_at || a.created_at || 0).getTime();
    const right = new Date(b.updated_at || b.created_at || 0).getTime();
    return right - left;
  });
}

function isNearBottom(element: HTMLElement, threshold = 96) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function chatTypeLabel(item: ChatSessionListItem) {
  if (item.context_type === "report") return item.report_title || "报告对话";
  if (item.context_type === "agent") return "Agent 对话";
  return "自由对话";
}
