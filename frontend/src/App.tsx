import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { TopBar } from "./components/TopBar";
import { api } from "./lib/api";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import type { PageKey } from "./components/Sidebar";
import type { ActivityItem, ActivityStarItem, AnalyticsResponse, LearningCardItem, ReportDetail, SettingsResponse } from "./types";
import { getVsCodeApi, languageFromVsCodeId, setApiBase, type VsCodeInboundMessage } from "./lib/runtime";

const defaultCode = `def filter_valid_users(users):
    result = []
    for user in users:
        if user.get("active") and user.get("age", 0) >= 18:
            result.append(user["name"].strip().title())
    return sorted(set(result))`;

const ActivityGalaxyPage = lazy(() => import("./pages/ActivityGalaxyPage").then((module) => ({ default: module.ActivityGalaxyPage })));
const AgentPage = lazy(() => import("./pages/AgentPage").then((module) => ({ default: module.AgentPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((module) => ({ default: module.ChatPage })));
const DiffPage = lazy(() => import("./pages/DiffPage").then((module) => ({ default: module.DiffPage })));
const HistoryPage = lazy(() => import("./pages/HistoryPage").then((module) => ({ default: module.HistoryPage })));
const KnowledgeCardsPage = lazy(() => import("./pages/KnowledgeCardsPage").then((module) => ({ default: module.KnowledgeCardsPage })));
const LearningCenterPage = lazy(() => import("./pages/LearningCenterPage").then((module) => ({ default: module.LearningCenterPage })));
const ProjectGuidePage = lazy(() => import("./pages/ProjectGuidePage").then((module) => ({ default: module.ProjectGuidePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

export default function App() {
  const [page, setPage] = useState<PageKey>("workbench");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return window.localStorage.getItem("codelens.theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [code, setCode] = useState(defaultCode);
  const [workbenchLanguageLabel, setWorkbenchLanguageLabel] = useState<string | null>(null);
  const [workbenchReport, setWorkbenchReport] = useState("");
  const [workbenchReportId, setWorkbenchReportId] = useState<string | null>(null);
  const [workbenchChatSessionId, setWorkbenchChatSessionId] = useState<string | null>(null);
  const [diffRestoreReport, setDiffRestoreReport] = useState<ReportDetail | null>(null);
  const [historyRestoreReport, setHistoryRestoreReport] = useState<ReportDetail | null>(null);
  const [knowledgeCardToOpenId, setKnowledgeCardToOpenId] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    getVsCodeApi()?.postMessage({ type: "codelens.webviewReady" });
  }, []);

  useEffect(() => {
    function handleVsCodeMessage(event: MessageEvent<VsCodeInboundMessage>) {
      const message = event.data;
      if (!message || typeof message !== "object") return;

      if (message.type === "codelens.setApiBase") {
        setApiBase(message.apiBase);
        void loadBootstrap();
        void loadAnalytics();
        return;
      }

      if (message.type === "codelens.openPage") {
        setPage(message.page === "learningReview" ? "learning" : message.page);
        return;
      }

      if (message.type === "codelens.openWorkbench") {
        const language = message.languageLabel
          ? { languageLabel: message.languageLabel, languageCode: message.languageCode ?? "" }
          : languageFromVsCodeId(message.languageId);
        setCode(message.code);
        setWorkbenchLanguageLabel(language.languageLabel);
        setWorkbenchReport("");
        setWorkbenchReportId(null);
        setWorkbenchChatSessionId(null);
        setPage("workbench");
        return;
      }

      if (message.type === "codelens.theme") {
        setTheme(message.theme);
      }
    }

    window.addEventListener("message", handleVsCodeMessage);
    return () => window.removeEventListener("message", handleVsCodeMessage);
  }, []);

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("codelens.theme", theme);
    } catch {
      // Theme persistence is optional; the UI still works if storage is unavailable.
    }
  }, [theme]);

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    setAnalyticsError("");
    try {
      setAnalytics(await api.analytics());
      setActivity(await api.recentActivity(14));
    } catch (exc) {
      setAnalyticsError(exc instanceof Error ? exc.message : "数据分析加载失败");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function loadBootstrap() {
    setSettingsError("");
    try {
      const bootstrap = await api.bootstrap();
      setSettings(bootstrap.settings);
      setActivity(await api.recentActivity(14));
    } catch (exc) {
      setSettingsError(exc instanceof Error ? exc.message : "设置加载失败");
      try {
        setSettings(await api.settings());
      } catch {
        // Keep the original bootstrap error visible.
      }
    }
  }

  useEffect(() => {
    void loadAnalytics();
    const refreshTimer = window.setInterval(() => void loadAnalytics(), 60000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  const title = useMemo(() => {
    return {
      workbench: "代码工作台",
      diff: "代码对比",
      chat: "AI 对话",
      agent: "Agent 工作区",
      learning: "每日日志",
      knowledgeCards: "知识卡片",
      projectGuide: "项目导读",
      learningReview: "每日日志",
      history: "历史报告",
      settings: "统计",
      activityGalaxy: "活动星图"
    }[page];
  }, [page]);

  function openReportFromHistory(nextReport: ReportDetail) {
    setAgentSessionId(null);
    if (nextReport.report_type === "diff") {
      setDiffRestoreReport(nextReport);
      setPage("diff");
      return;
    }

    setCode(nextReport.code_content ?? "");
    setWorkbenchReport(nextReport.content);
    setWorkbenchReportId(nextReport.id);
    setWorkbenchChatSessionId(nextReport.chat_session_id ?? null);
    setPage("workbench");
  }

  async function openChatSession(sessionId: string) {
    try {
      const detail = await api.getChatSession(sessionId);
      if (detail.context_type === "agent") {
        setChatSessionId(null);
        setAgentSessionId(sessionId);
        setPage("agent");
        return;
      }
    } catch {
      // Fall back to the normal chat page if the session type cannot be loaded.
    }

    setAgentSessionId(null);
    setChatSessionId(sessionId);
    setPage("chat");
  }

  async function openActivityItem(item: ActivityStarItem) {
    const route = item.route;
    if (item.kind === "report" || route?.page === "report") {
      const detail = await api.getReport(route?.target_id ?? item.target_id);
      openReportFromHistory(detail);
      return;
    }

    if (item.kind === "chat" || route?.page === "chat" || route?.session_id) {
      await openChatSession(route?.session_id ?? item.target_id);
      return;
    }

    if (item.kind === "agent" || route?.page === "agent") {
      if (route?.session_id) {
        await openChatSession(route.session_id);
      } else {
        setAgentSessionId(null);
        setPage("agent");
      }
    }
  }

  function openLearningCard(card: LearningCardItem) {
    setKnowledgeCardToOpenId(card.id);
    setPage("knowledgeCards");
  }

  async function openSourceReport(reportId: string) {
    const detail = await api.getReport(reportId);
    setHistoryRestoreReport(detail);
    setPage("history");
  }

  if (page === "activityGalaxy") {
    return (
      <Suspense fallback={<PageLoading immersive />}>
        <ActivityGalaxyPage
          codeLineCount={analytics?.totals.code_lines || countCodeLines(code)}
          onBack={() => setPage("settings")}
          onOpenActivity={(item) => void openActivityItem(item)}
        />
      </Suspense>
    );
  }

  return (
    <AppShell active={page} onNavigate={setPage}>
      <TopBar
        title={title}
        settings={settings}
        analytics={analytics}
        theme={theme}
        showCodeLegend={page === "workbench" || page === "diff" || page === "history"}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />
      {settingsError ? (
        <div className="m-4 rounded-md border border-[#6e3324] bg-[#241713] p-3 text-sm text-coral">{settingsError}</div>
      ) : null}

      {page === "workbench" ? (
        <WorkbenchPage
          settings={settings}
          code={code}
          setCode={setCode}
          report={workbenchReport}
          setReport={setWorkbenchReport}
          reportId={workbenchReportId}
          setReportId={setWorkbenchReportId}
          externalLanguageLabel={workbenchLanguageLabel}
          contextChatSessionId={workbenchChatSessionId}
          setContextChatSessionId={setWorkbenchChatSessionId}
          onActivityChanged={() => void loadAnalytics()}
          onOpenLearningCard={openLearningCard}
        />
      ) : null}
      <Suspense fallback={<PageLoading />}>
        {page === "diff" ? (
          <DiffPage
            settings={settings}
            restoreReport={diffRestoreReport}
            onActivityChanged={() => void loadAnalytics()}
            onOpenLearningCard={openLearningCard}
          />
        ) : null}
        {page === "chat" ? (
          <ChatPage
            settings={settings}
            selectedSessionId={chatSessionId}
            onSelectedSessionIdChange={setChatSessionId}
            onActivityChanged={() => void loadAnalytics()}
          />
        ) : null}
        {page === "agent" ? (
          <AgentPage
            settings={settings}
            selectedSessionId={agentSessionId}
            onSelectedSessionIdChange={setAgentSessionId}
            onActivityChanged={() => void loadAnalytics()}
          />
        ) : null}
        {page === "learning" ? <LearningCenterPage onNavigate={setPage} /> : null}
        {page === "knowledgeCards" ? (
          <KnowledgeCardsPage
            openCardId={knowledgeCardToOpenId}
            onOpenCardConsumed={() => setKnowledgeCardToOpenId(null)}
            onOpenSourceReport={(reportId) => void openSourceReport(reportId)}
          />
        ) : null}
        {page === "projectGuide" ? <ProjectGuidePage /> : null}
        {page === "history" ? (
          <HistoryPage
            settings={settings}
            restoreReport={historyRestoreReport}
            onOpenReport={openReportFromHistory}
            onOpenChatSession={(sessionId) => void openChatSession(sessionId)}
            onOpenLearningCard={openLearningCard}
          />
        ) : null}
        {page === "settings" ? (
          <SettingsPage
            analytics={analytics}
            activity={activity}
            analyticsError={analyticsError}
            analyticsLoading={analyticsLoading}
            onRefreshAnalytics={loadAnalytics}
            onOpenActivityGalaxy={() => setPage("activityGalaxy")}
          />
        ) : null}
      </Suspense>
    </AppShell>
  );
}

function countCodeLines(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\s+$/g, "");
  return normalized ? normalized.split("\n").length : 0;
}

function PageLoading({ immersive = false }: { immersive?: boolean }) {
  return (
    <div className={immersive ? "page-loading page-loading-immersive" : "page-loading"}>
      <span />
      <strong>正在加载...</strong>
    </div>
  );
}
