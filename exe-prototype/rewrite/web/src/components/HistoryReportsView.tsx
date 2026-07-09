import { AlertTriangle, ArrowUpRight, Bot, CalendarDays, CheckCircle2, Clock3, FileText, Filter, GitCompare, GraduationCap, Layers3, MessageSquare, Route, Search, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReportDetail, ReportSummary, TraceabilityCounts, TraceabilitySnapshot } from "../types";
import { formatTime, languageLabel, reportLibraryStats, severityLabel, sourceLabel, typeLabel } from "../utils/display";
import { ReportPanel } from "./ReportPanel";

export type ReportFilter = "all" | "single" | "project" | "diff" | "chat";
type RiskFilter = "all" | "high" | "medium" | "low" | "info";
type DateFilter = "all" | "today" | "7d" | string;
type ReportQueueKind = "risk" | "project" | "diff" | "closure";
type QueueReportRef = {
  id: string;
  title: string;
  report_type: string;
  risk_level: string;
  created_at: string;
  file_count: number;
  risk_count?: number;
};

type ReportQueueItem = {
  kind: ReportQueueKind;
  label: string;
  title: string;
  detail: string;
  meta: string;
  report: QueueReportRef | null;
};

export function HistoryReportsView(props: {
  reports: ReportSummary[];
  query: string;
  filter: ReportFilter;
  activeReport: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: ReportFilter) => void;
  onSearch: () => void;
  onOpenReport: (id: string) => void;
  onDeleteReport: (id: string) => void;
  onCopyReport: () => void;
  onExportReport: (kind: "md" | "html") => void;
  onGenerateCandidates: () => void;
  onCreateAgentPlan: () => void;
  onOpenFindings: () => void;
  onAddDailyLog: () => void;
  onChatAboutReport: () => void;
}) {
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const stats = reportLibraryStats(props.reports);
  const visibleReports = useMemo(
    () => props.reports.filter((report) => reportMatchesLocalFilters(report, riskFilter, dateFilter)),
    [dateFilter, props.reports, riskFilter]
  );
  const visibleStats = reportLibraryStats(visibleReports);
  const groupedReports = useMemo(() => groupReportsByDate(visibleReports), [visibleReports]);
  const dateOptions = useMemo(() => buildDateOptions(props.reports), [props.reports]);
  const typeBreakdown = useMemo(() => buildTypeBreakdown(visibleReports), [visibleReports]);
  const activeTrace = props.traceability?.scope_kind === "report" && props.traceability.scope_id === props.activeReport?.id
    ? props.traceability
    : null;
  const activeTraceCounts = activeTrace?.counts ?? null;
  const workQueue = useMemo(
    () => buildReportWorkQueue(visibleReports, props.activeReport, activeTraceCounts, activeTrace?.gaps ?? []),
    [activeTrace, activeTraceCounts, props.activeReport, visibleReports]
  );

  function resetLocalFilters() {
    setRiskFilter("all");
    setDateFilter("all");
  }

  return (
    <section className="history-layout history-page-next">
      <div className="history-list history-list-next">
        <div className="history-hero-next">
          <div>
            <span>报告库</span>
            <h3>历史报告</h3>
            <p>从报告继续进入问题清单、知识卡片、每日日志、AI 对话和 Agent 计划。</p>
          </div>
          <div className="history-stats-next">
            <small>总数 <strong>{stats.total}</strong></small>
            <small>项目 <strong>{stats.project}</strong></small>
            <small>对比 <strong>{stats.diff}</strong></small>
            <small>高风险 <strong>{stats.high}</strong></small>
          </div>
        </div>

        <section className="history-insight-next">
          <article>
            <span><Sparkles size={15} />当前视图</span>
            <strong>{visibleStats.total} 份报告</strong>
            <p>项目 {visibleStats.project} / 对比 {visibleStats.diff} / 高风险 {visibleStats.high}</p>
          </article>
          <article>
            <span><FileText size={15} />当前报告</span>
            <strong>{props.activeReport ? props.activeReport.title : "尚未选择"}</strong>
            <p>{props.activeReport ? `${typeLabel(props.activeReport.report_type)} · ${severityLabel(props.activeReport.risk_level)}` : "选择报告后可查看闭环状态。"}</p>
          </article>
          <article>
            <span><ShieldAlert size={15} />闭环状态</span>
            <strong>{activeTraceCounts ? `${activeTraceCounts.findings} 问题 / ${activeTraceCounts.cards} 卡片` : "等待报告"}</strong>
            <p>{activeTraceCounts ? `${activeTraceCounts.chats} 对话 / ${activeTraceCounts.agent_tasks} Agent / ${activeTraceCounts.daily_logs} 日志` : "打开报告后显示关联数据。"}</p>
          </article>
        </section>

        <section className="history-work-queue-next">
          <div className="section-title-next">
            <span><Clock3 size={15} />报告库工作队列</span>
            <small>按风险、项目、变更和闭环缺口自动排序</small>
          </div>
          <div className="history-work-queue-grid-next">
            {workQueue.map((item) => (
              <button
                className={`history-work-queue-card-next ${item.kind}${item.report ? "" : " empty"}`}
                disabled={!item.report}
                key={item.kind}
                onClick={() => item.report && props.onOpenReport(item.report.id)}
                type="button"
              >
                <span className="history-work-queue-icon-next">{queueIcon(item.kind)}</span>
                <strong>{item.label}</strong>
                <p>{item.title}</p>
                <small>{item.detail}</small>
                <em>{item.meta}{item.report && <ArrowUpRight size={13} />}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="history-route-board-next">
          <div className="history-route-head-next">
            <span><Route size={15} />报告闭环路径</span>
            <strong>{props.activeReport ? "当前报告可继续推进" : "先选中一份报告"}</strong>
          </div>
          <div className="history-route-grid-next">
            <ActionStep icon={<FileText size={16} />} title="结构化阅读" detail="打开报告正文、目录和风险摘要。" active={Boolean(props.activeReport)} />
            <ActionStep icon={<ShieldAlert size={16} />} title="拆成问题" detail="进入问题清单追踪状态和影响文件。" active={Boolean(activeTraceCounts?.findings)} />
            <ActionStep icon={<GraduationCap size={16} />} title="沉淀卡片" detail="从报告和问题生成可复习知识点。" active={Boolean(activeTraceCounts?.cards)} />
            <ActionStep icon={<Bot size={16} />} title="Agent 计划" detail="生成可确认的修复计划和补丁说明。" active={Boolean(activeTraceCounts?.agent_tasks)} />
          </div>
          {props.activeReport && (
            <div className="history-action-strip-next">
              <button onClick={props.onOpenFindings} type="button"><ShieldAlert size={15} />关联问题</button>
              <button onClick={props.onGenerateCandidates} type="button"><GraduationCap size={15} />生成卡片候选</button>
              <button onClick={props.onChatAboutReport} type="button"><MessageSquare size={15} />围绕报告对话</button>
              <button onClick={props.onCreateAgentPlan} type="button"><Bot size={15} />生成 Agent 计划</button>
            </div>
          )}
        </section>

        <section className="history-library-map-next">
          <div className="section-title-next">
            <span><Layers3 size={15} />报告类型分布</span>
            <small>{visibleReports.length} 份</small>
          </div>
          <div className="history-type-bars-next">
            {typeBreakdown.map((item) => (
              <div key={item.type}>
                <span>{typeLabel(item.type)}</span>
                <strong>{item.count}</strong>
                <i style={{ width: `${Math.max(8, Math.round((item.count / Math.max(1, visibleReports.length)) * 100))}%` }} />
              </div>
            ))}
          </div>
        </section>

        <form
          className="searchbar"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSearch();
          }}
        >
          <Search size={18} />
          <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索标题、语言、摘要" />
          <select value={props.filter} onChange={(event) => props.onFilterChange(event.target.value as ReportFilter)}>
            <option value="all">全部类型</option>
            <option value="single">单文件</option>
            <option value="project">项目</option>
            <option value="diff">代码对比</option>
            <option value="chat">对话关联</option>
          </select>
          <button type="submit">搜索</button>
        </form>

        <section className="history-local-filter-next" aria-label="历史报告本地筛选">
          <div className="history-filter-line-next">
            <span><Filter size={14} />风险</span>
            {(["all", "high", "medium", "low", "info"] as RiskFilter[]).map((item) => (
              <button className={riskFilter === item ? "active" : ""} key={item} onClick={() => setRiskFilter(item)} type="button">
                {item === "all" ? "全部" : severityLabel(item)}
              </button>
            ))}
          </div>
          <div className="history-filter-line-next">
            <span><CalendarDays size={14} />日期</span>
            <button className={dateFilter === "all" ? "active" : ""} onClick={() => setDateFilter("all")} type="button">全部</button>
            <button className={dateFilter === "today" ? "active" : ""} onClick={() => setDateFilter("today")} type="button">今天</button>
            <button className={dateFilter === "7d" ? "active" : ""} onClick={() => setDateFilter("7d")} type="button">近 7 天</button>
            {dateOptions.slice(0, 5).map((item) => (
              <button className={dateFilter === item.date ? "active" : ""} key={item.date} onClick={() => setDateFilter(item.date)} type="button">
                {item.label}<strong>{item.count}</strong>
              </button>
            ))}
            {(riskFilter !== "all" || dateFilter !== "all") && <button className="reset" onClick={resetLocalFilters} type="button"><X size={13} />清除</button>}
          </div>
        </section>

        <div className="history-date-report-list-next">
          {groupedReports.map((group) => (
            <section className="history-date-group-next" key={group.date}>
              <div className="history-date-title-next">
                <span>{group.label}</span>
                <strong>{group.items.length} 份</strong>
              </div>
              <div className="report-list">
                {group.items.map((report) => (
                  <article className={props.activeReport?.id === report.id ? "report-row active" : "report-row"} key={report.id}>
                    <button className="report-main" onClick={() => props.onOpenReport(report.id)} type="button">
                      <strong>{report.title}</strong>
                      <span>{typeLabel(report.report_type)} · {languageLabel(report.language)} · {formatTime(report.created_at)}</span>
                      <p>{report.summary}</p>
                      <div className="tag-row">
                        <span className={`risk-tag ${report.risk_level}`}>{severityLabel(report.risk_level)}</span>
                        <span>{report.file_count} 个文件</span>
                        <span>{sourceLabel(report.analysis_source)}</span>
                        <span>{report.risk_count} 个风险</span>
                        {report.report_type === "diff" && <span><GitCompare size={12} />对比</span>}
                      </div>
                    </button>
                    <button className="icon-button danger" onClick={() => props.onDeleteReport(report.id)} type="button"><Trash2 size={18} /></button>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {visibleReports.length === 0 && <div className="empty">当前筛选条件下暂无报告。</div>}
        </div>
      </div>
      <ReportPanel
        report={props.activeReport}
        traceability={props.traceability}
        onCopy={props.onCopyReport}
        onExport={props.onExportReport}
        onGenerateCandidates={props.onGenerateCandidates}
        onCreateAgentPlan={props.onCreateAgentPlan}
        onOpenFindings={props.onOpenFindings}
        onAddDailyLog={props.onAddDailyLog}
        onChatAboutReport={props.onChatAboutReport}
      />
    </section>
  );
}

function ActionStep({ icon, title, detail, active }: { icon: JSX.Element; title: string; detail: string; active: boolean }) {
  return (
    <article className={active ? "active" : ""}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </article>
  );
}

function queueIcon(kind: ReportQueueKind) {
  if (kind === "risk") return <AlertTriangle size={16} />;
  if (kind === "project") return <Layers3 size={16} />;
  if (kind === "diff") return <GitCompare size={16} />;
  return <CheckCircle2 size={16} />;
}

function buildReportWorkQueue(
  reports: ReportSummary[],
  activeReport: ReportDetail | null,
  activeTraceCounts: TraceabilityCounts | null,
  activeTraceGaps: string[]
): ReportQueueItem[] {
  const highRisk = newestFirst(reports.filter((report) => report.risk_level === "high" || (report.risk_level === "medium" && report.risk_count > 0)))[0];
  const project = newestFirst(reports.filter((report) => report.report_type === "project"))[0];
  const diff = newestFirst(reports.filter((report) => report.report_type === "diff"))[0];
  const closureTarget = toQueueReport(activeReport) || toQueueReport(newestFirst(reports)[0]);

  return [
    {
      kind: "risk",
      label: "高风险优先",
      title: highRisk?.title || "当前筛选下暂无高风险报告",
      detail: highRisk ? `${severityLabel(highRisk.risk_level)} · ${highRisk.risk_count} 个风险点 · ${formatTime(highRisk.created_at)}` : "生成或筛选出高风险报告后，这里会优先推送复盘入口。",
      meta: highRisk ? "打开复盘" : "队列空闲",
      report: toQueueReport(highRisk)
    },
    {
      kind: "project",
      label: "项目报告复盘",
      title: project?.title || "暂无项目级报告",
      detail: project ? `${project.file_count} 个文件 · ${languageLabel(project.language)} · ${formatTime(project.created_at)}` : "导入项目并生成项目报告后，可从这里回到项目审查主线。",
      meta: project ? "回到项目报告" : "等待项目分析",
      report: toQueueReport(project)
    },
    {
      kind: "diff",
      label: "对比变更复核",
      title: diff?.title || "暂无代码对比报告",
      detail: diff ? `${severityLabel(diff.risk_level)} · ${diff.risk_count} 个风险点 · ${formatTime(diff.created_at)}` : "完成代码对比后，这里会沉淀需要复核的变更报告。",
      meta: diff ? "打开对比报告" : "等待代码对比",
      report: toQueueReport(diff)
    },
    {
      kind: "closure",
      label: "闭环补全",
      title: closureTarget?.title || "暂无可推进报告",
      detail: closureDetail(activeTraceCounts, activeTraceGaps, Boolean(activeReport)),
      meta: closureTarget ? "查看闭环状态" : "等待报告",
      report: closureTarget
    }
  ];
}

function newestFirst<T extends { created_at: string }>(items: T[]) {
  return [...items].sort((left, right) => timeValue(right.created_at) - timeValue(left.created_at));
}

function toQueueReport(report: ReportSummary | ReportDetail | null | undefined): QueueReportRef | null {
  if (!report) return null;
  return {
    id: report.id,
    title: report.title,
    report_type: report.report_type,
    risk_level: report.risk_level,
    created_at: report.created_at,
    file_count: report.file_count,
    risk_count: "risk_count" in report ? report.risk_count : report.metrics?.risk_count
  };
}

function closureDetail(counts: TraceabilityCounts | null, gaps: string[], hasActiveReport: boolean) {
  if (!hasActiveReport) return "先选择一份报告，系统会展示它和问题、卡片、日志、对话、Agent 任务的关联缺口。";
  if (!counts) return "正在等待当前报告的关联快照。";
  if (gaps.length > 0) return gaps.slice(0, 2).join("；");
  const totalLinks = counts.findings + counts.cards + counts.chats + counts.daily_logs + counts.agent_tasks;
  return totalLinks > 0 ? "当前报告已经建立主要闭环关联，可继续阅读、导出或复盘。" : "当前报告尚未沉淀到问题、卡片、日志或 Agent 计划。";
}

function timeValue(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function reportMatchesLocalFilters(report: ReportSummary, riskFilter: RiskFilter, dateFilter: DateFilter) {
  if (riskFilter !== "all" && report.risk_level !== riskFilter) return false;
  if (dateFilter === "all") return true;
  const reportDate = new Date(report.created_at);
  if (Number.isNaN(reportDate.getTime())) return true;
  const dayKey = dateKey(report.created_at);
  if (dateFilter === "today") return dayKey === dateKey(new Date().toISOString());
  if (dateFilter === "7d") {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    cutoff.setHours(0, 0, 0, 0);
    return reportDate >= cutoff;
  }
  return dayKey === dateFilter;
}

function groupReportsByDate(reports: ReportSummary[]) {
  const grouped = new Map<string, ReportSummary[]>();
  for (const report of reports) {
    const key = dateKey(report.created_at);
    grouped.set(key, [...(grouped.get(key) || []), report]);
  }
  return Array.from(grouped.entries()).map(([date, items]) => ({
    date,
    label: dateLabel(date),
    items
  }));
}

function buildDateOptions(reports: ReportSummary[]) {
  const counts = new Map<string, number>();
  for (const report of reports) {
    const key = dateKey(report.created_at);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([date, count]) => ({
    date,
    count,
    label: dateLabel(date)
  }));
}

function buildTypeBreakdown(reports: ReportSummary[]) {
  const order = ["project", "diff", "single", "chat"];
  const counts = new Map<string, number>();
  for (const report of reports) {
    counts.set(report.report_type, (counts.get(report.report_type) || 0) + 1);
  }
  return order
    .map((type) => ({ type, count: counts.get(type) || 0 }))
    .filter((item) => item.count > 0);
}

function dateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "unknown";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(value: string) {
  const today = dateKey(new Date().toISOString());
  if (value === today) return "今天";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (value === dateKey(yesterday.toISOString())) return "昨天";
  return value;
}
