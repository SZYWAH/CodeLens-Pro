import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { TopBar } from "./components/TopBar";
import { api } from "./lib/api";
import { ChatPage } from "./pages/ChatPage";
import { DiffPage } from "./pages/DiffPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import type { PageKey } from "./components/Sidebar";
import type { AnalyticsResponse, ReportDetail, SettingsResponse } from "./types";

const defaultCode = `def filter_valid_users(users):
    result = []
    for user in users:
        if user.get("active") and user.get("age", 0) >= 18:
            result.append(user["name"].strip().title())
    return sorted(set(result))`;

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
  const [report, setReport] = useState("");
  const [workbenchReportId, setWorkbenchReportId] = useState<string | null>(null);
  const [workbenchChatSessionId, setWorkbenchChatSessionId] = useState<string | null>(null);
  const [diffRestoreReport, setDiffRestoreReport] = useState<ReportDetail | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    api.settings()
      .then(setSettings)
      .catch((exc) => setSettingsError(exc instanceof Error ? exc.message : "设置加载失败"));
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
    } catch (exc) {
      setAnalyticsError(exc instanceof Error ? exc.message : "数据分析加载失败");
    } finally {
      setAnalyticsLoading(false);
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
      history: "历史报告",
      settings: "统计"
    }[page];
  }, [page]);

  function openReportFromHistory(nextReport: ReportDetail) {
    if (nextReport.report_type === "diff") {
      setDiffRestoreReport(nextReport);
      setPage("diff");
      return;
    }

    setCode(nextReport.code_content ?? "");
    setReport(nextReport.content);
    setWorkbenchReportId(nextReport.id);
    setWorkbenchChatSessionId(nextReport.chat_session_id ?? null);
    setPage("workbench");
  }

  function openChatSession(sessionId: string) {
    setChatSessionId(sessionId);
    setPage("chat");
  }

  return (
    <AppShell active={page} onNavigate={setPage}>
      <TopBar
        title={title}
        settings={settings}
        analytics={analytics}
        theme={theme}
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
          report={report}
          setReport={setReport}
          setCurrentReport={setReport}
          reportId={workbenchReportId}
          setReportId={setWorkbenchReportId}
          contextChatSessionId={workbenchChatSessionId}
          setContextChatSessionId={setWorkbenchChatSessionId}
        />
      ) : null}
      {page === "diff" ? <DiffPage settings={settings} setCurrentReport={setReport} restoreReport={diffRestoreReport} /> : null}
      {page === "chat" ? <ChatPage settings={settings} initialSessionId={chatSessionId} /> : null}
      {page === "history" ? <HistoryPage settings={settings} onOpenReport={openReportFromHistory} onOpenChatSession={openChatSession} /> : null}
      {page === "settings" ? (
        <SettingsPage
          analytics={analytics}
          analyticsError={analyticsError}
          analyticsLoading={analyticsLoading}
          onRefreshAnalytics={loadAnalytics}
        />
      ) : null}
    </AppShell>
  );
}
