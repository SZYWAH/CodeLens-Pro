import { FileText, Loader2, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlayFocus } from "../hooks/useOverlayFocus";
import type { ReportDetail, ReportSummary, TraceabilitySnapshot } from "../types";
import { formatTime, languageLabel, severityLabel, typeLabel } from "../utils/display";
import { AccessibleListbox, type ListboxOption } from "./AccessibleListbox";
import { ReportPanel } from "./ReportPanel";

export type ReportFilter = "all" | "single" | "project" | "diff" | "chat";
type DateRange = "all" | "today" | "7d" | "30d" | "custom";
type HistoryFilters = {
  language: string;
  reviewFocus: string;
  dateRange: DateRange;
  startDate: string;
  endDate: string;
};

const historyCollapsedKey = "codelens.history.collapsed";
const emptyFilters: HistoryFilters = { language: "all", reviewFocus: "all", dateRange: "all", startDate: "", endDate: "" };
const reportTypeOptions: ListboxOption[] = [
  { value: "all", label: "全部类型" },
  { value: "single", label: "单文件" },
  { value: "project", label: "项目" },
  { value: "diff", label: "代码对比" },
  { value: "chat", label: "对话关联" }
];

export function HistoryReportsView(props: {
  reports: ReportSummary[];
  query: string;
  filter: ReportFilter;
  activeReport: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  openingReportId: string | null;
  reportOperationBusy: boolean;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: ReportFilter) => void;
  onSearch: () => void;
  onOpenReport: (id: string) => void;
  onDeleteReport: (id: string, replacementId: string | null) => Promise<void>;
  onCopyReport: () => void;
  onExportReport: (kind: "md" | "html") => void;
  onGenerateCandidates: () => void;
  onOpenFindings: () => void;
  onAddDailyLog: () => void;
  onChatAboutReport: () => void;
  onRenameReport: (id: string, title: string) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(historyCollapsedKey) === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<HistoryFilters>(emptyFilters);
  const [deleteTarget, setDeleteTarget] = useState<ReportSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingReportId, setPendingReportId] = useState<string | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteDialogRef = useRef<HTMLElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const showHistoryContent = !collapsed || mobileOpen;
  const languages = useMemo(() => uniqueOptions(props.reports.map((item) => item.language), languageLabel), [props.reports]);
  const reviewFocuses = useMemo(() => uniqueOptions(props.reports.map((item) => item.review_focus || ""), (value) => value), [props.reports]);
  const filteredReports = useMemo(() => props.reports.filter((report) => matchesFilters(report, advancedFilters)), [advancedFilters, props.reports]);
  const groupedReports = useMemo(() => groupReportsByDate(filteredReports), [filteredReports]);
  const activeFilterCount = countActiveFilters(advancedFilters);

  useEffect(() => {
    window.localStorage.setItem(historyCollapsedKey, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (!props.openingReportId) setPendingReportId(props.activeReport?.id || null);
  }, [props.activeReport?.id, props.openingReportId]);

  useEffect(() => {
    if (!filtersOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (filterTriggerRef.current?.contains(target) || filterPanelRef.current?.contains(target)) return;
      setFiltersOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [filtersOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (filtersOpen && !deleteTarget) {
        setFiltersOpen(false);
        filterTriggerRef.current?.focus();
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [deleteTarget, deleting, filtersOpen]);

  useOverlayFocus({
    active: Boolean(deleteTarget),
    containerRef: deleteDialogRef,
    initialFocusRef: deleteCancelRef,
    returnFocusRef: deleteTriggerRef,
    onRequestClose: closeDeleteConfirmation
  });

  function openReport(id: string) {
    setPendingReportId(id);
    setFiltersOpen(false);
    props.onOpenReport(id);
    setMobileOpen(false);
  }

  const selectedReportId = pendingReportId || props.activeReport?.id || null;

  function openDeleteConfirmation(report: ReportSummary, trigger: HTMLButtonElement) {
    deleteTriggerRef.current = trigger;
    setDeleteError(null);
    setDeleteTarget(report);
  }

  function closeDeleteConfirmation() {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    const targetIndex = filteredReports.findIndex((item) => item.id === deleteTarget.id);
    const replacementId = targetIndex >= 0
      ? filteredReports[targetIndex + 1]?.id || filteredReports[targetIndex - 1]?.id || null
      : null;
    setDeleting(true);
    setDeleteError(null);
    try {
      await props.onDeleteReport(deleteTarget.id, replacementId);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除报告失败，请稍后重试。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className={`history-layout history-page-next ${collapsed ? "is-history-collapsed" : ""} ${mobileOpen ? "is-history-mobile-open" : ""}`}>
      <button className="history-mobile-trigger-v131" onClick={() => setMobileOpen(true)} type="button">
        <PanelLeftOpen size={15} />报告库
      </button>

      <aside className="history-list history-list-next history-switcher-v13">
        {!showHistoryContent ? (
          <button className="history-collapsed-spine-v131" aria-label={`展开报告库，${filteredReports.length} 份报告`} onClick={() => setCollapsed(false)} title="展开报告库" type="button">
            <FileText size={16} />
            <strong>{filteredReports.length}</strong>
            <PanelLeftOpen size={15} />
          </button>
        ) : (
          <>
            <header className="history-switcher-head-v13">
              <div>
                <span><FileText size={14} />报告库</span>
                <strong>{filteredReports.length} 份报告</strong>
              </div>
              <div className="history-switcher-head-actions-v131">
                <button className="history-desktop-collapse-v131" onClick={() => setCollapsed(true)} title="收起报告库" type="button"><PanelLeftClose size={15} /></button>
                <button className="history-mobile-close-v131" onClick={() => setMobileOpen(false)} title="关闭报告库" type="button"><X size={15} /></button>
              </div>
            </header>

            <form className="history-switcher-search-v148" onSubmit={(event) => { event.preventDefault(); props.onSearch(); }}>
              <label className="history-search-field-v148">
                <Search size={14} />
                <input aria-label="搜索报告" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索报告" />
              </label>
              <AccessibleListbox compact label="报告类型" value={props.filter} options={reportTypeOptions} onChange={(value) => props.onFilterChange(value as ReportFilter)} />
              <button
                aria-controls="history-advanced-filters-v148"
                aria-expanded={filtersOpen}
                className={filtersOpen ? "history-filter-trigger-v148 is-open" : "history-filter-trigger-v148"}
                onClick={() => setFiltersOpen((value) => !value)}
                ref={filterTriggerRef}
                title="更多筛选"
                type="button"
              >
                <SlidersHorizontal size={14} /><span>筛选</span>{activeFilterCount > 0 && <em>{activeFilterCount}</em>}
              </button>
            </form>

            {filtersOpen && (
              <>
                <button aria-label="关闭筛选" className="history-filter-scrim-v148" onClick={() => setFiltersOpen(false)} type="button" />
                <div className="history-filter-popover-v148" id="history-advanced-filters-v148" ref={filterPanelRef}>
                <header><div><strong>筛选报告</strong><span>按语言、审查重点或日期缩小范围</span></div><button onClick={() => setFiltersOpen(false)} title="关闭筛选" type="button"><X size={15} /></button></header>
                <FilterChipGroup label="语言" options={[{ value: "all", label: "全部" }, ...languages]} value={advancedFilters.language} onChange={(language) => setAdvancedFilters((value) => ({ ...value, language }))} />
                <FilterChipGroup label="审查重点" options={[{ value: "all", label: "全部" }, ...reviewFocuses]} value={advancedFilters.reviewFocus} onChange={(reviewFocus) => setAdvancedFilters((value) => ({ ...value, reviewFocus }))} />
                <FilterChipGroup label="日期" options={[
                  { value: "all", label: "全部" }, { value: "today", label: "今天" }, { value: "7d", label: "近 7 天" }, { value: "30d", label: "近 30 天" }, { value: "custom", label: "自定义" }
                ]} value={advancedFilters.dateRange} onChange={(dateRange) => setAdvancedFilters((value) => ({ ...value, dateRange: dateRange as DateRange }))} />
                {advancedFilters.dateRange === "custom" && <div className="history-filter-dates-v148"><label>开始<input aria-label="开始日期" type="date" value={advancedFilters.startDate} onChange={(event) => setAdvancedFilters((value) => ({ ...value, startDate: event.target.value }))} /></label><label>结束<input aria-label="结束日期" type="date" value={advancedFilters.endDate} onChange={(event) => setAdvancedFilters((value) => ({ ...value, endDate: event.target.value }))} /></label></div>}
                <footer><button className="secondary-button" disabled={activeFilterCount === 0} onClick={() => setAdvancedFilters(emptyFilters)} type="button">清除筛选</button><button className="primary-button" onClick={() => setFiltersOpen(false)} type="button">完成</button></footer>
                </div>
              </>
            )}

            <div className="history-date-report-list-next history-switcher-list-v13">
              {groupedReports.map((group) => (
                <section className="history-date-group-next" key={group.date}>
                  <div className="history-date-title-next"><span>{group.label}</span><strong>{group.items.length}</strong></div>
                  <div className="report-list">
                    {group.items.map((report) => {
                      const isOpening = props.openingReportId === report.id;
                      const rowClassName = ["report-row", selectedReportId === report.id ? "active" : "", isOpening ? "is-opening" : ""].filter(Boolean).join(" ");
                      return (
                      <article className={rowClassName} key={report.id}>
                        <button aria-current={selectedReportId === report.id ? "page" : undefined} className="report-main" disabled={deleting} onClick={() => openReport(report.id)} type="button">
                          <strong>{report.title}</strong>
                          <span className="report-kind-v149">{typeLabel(report.report_type)} · {languageLabel(report.language)}</span>
                          <div className="tag-row">
                            <span className={`risk-tag ${report.risk_level}`}>{severityLabel(report.risk_level)}</span>
                            <span>{formatTime(report.created_at)}</span>
                          </div>
                        </button>
                        {isOpening && <span aria-label="正在打开报告" className="history-opening-v143" role="status"><Loader2 className="spin" size={14} /></span>}
                        <button className="icon-button danger" aria-label={`删除 ${report.title}`} disabled={Boolean(props.openingReportId) || deleting} onClick={(event) => openDeleteConfirmation(report, event.currentTarget)} title="删除报告" type="button"><Trash2 size={15} /></button>
                      </article>
                      );
                    })}
                  </div>
                </section>
              ))}
              {filteredReports.length === 0 && (
                <div className="empty">
                  <span>{props.reports.length ? "没有匹配的历史报告。" : "暂无历史报告。"}</span>
                  {activeFilterCount > 0 && <button onClick={() => setAdvancedFilters(emptyFilters)} type="button">清除筛选</button>}
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      <button className="history-mobile-scrim-v131" aria-label="关闭报告库" onClick={() => setMobileOpen(false)} type="button" />

      <ReportPanel report={props.activeReport} traceability={props.traceability} loading={Boolean(props.openingReportId)} operationBusy={props.reportOperationBusy} variant="full" onCopy={props.onCopyReport} onExport={props.onExportReport} onGenerateCandidates={props.onGenerateCandidates} onOpenFindings={props.onOpenFindings} onAddDailyLog={props.onAddDailyLog} onChatAboutReport={props.onChatAboutReport} onRename={props.onRenameReport} />

      {deleteTarget && <div className="history-delete-layer-v148" role="presentation"><button aria-label="取消删除报告" className="history-delete-scrim-v148" disabled={deleting} onClick={closeDeleteConfirmation} type="button" /><section aria-labelledby="history-delete-title-v148" aria-modal="true" className="history-delete-dialog-v148" ref={deleteDialogRef} role="dialog"><header><Trash2 size={18} /><div><strong id="history-delete-title-v148">删除历史报告？</strong><span>{typeLabel(deleteTarget.report_type)} · {formatTime(deleteTarget.created_at)}</span></div></header><p>将删除“{deleteTarget.title}”及其报告文件快照、待审核知识卡片候选和展示台活动记录。不会删除原项目文件或工作区；问题、已创建卡片、聊天和行动草稿会保留。</p>{deleteError && <small role="alert">{deleteError}</small>}<footer><button className="secondary-button" disabled={deleting} onClick={closeDeleteConfirmation} ref={deleteCancelRef} type="button">取消</button><button className="danger-button" disabled={deleting} onClick={() => void confirmDelete()} type="button">{deleting ? "正在删除" : "确认删除"}</button></footer></section></div>}
    </section>
  );
}

function FilterChipGroup({ label, options, value, onChange }: { label: string; options: ListboxOption[]; value: string; onChange: (value: string) => void }) {
  return <section className="history-filter-group-v148"><strong>{label}</strong><div>{options.map((option) => <button aria-pressed={option.value === value} className={option.value === value ? "active" : ""} key={option.value} onClick={() => onChange(option.value)} type="button">{option.label}</button>)}</div></section>;
}

function uniqueOptions(values: string[], label: (value: string) => string): ListboxOption[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN")).map((value) => ({ value, label: label(value) }));
}

function matchesFilters(report: ReportSummary, filters: HistoryFilters) {
  if (filters.language !== "all" && report.language !== filters.language) return false;
  if (filters.reviewFocus !== "all" && report.review_focus !== filters.reviewFocus) return false;
  const reportDate = dateKey(report.created_at);
  if (filters.dateRange === "today") return reportDate === dateKeyFromDate(new Date());
  if (filters.dateRange === "7d") return reportDate >= dateKeyFromDate(daysAgo(6));
  if (filters.dateRange === "30d") return reportDate >= dateKeyFromDate(daysAgo(29));
  if (filters.dateRange === "custom") {
    if (filters.startDate && reportDate < filters.startDate) return false;
    if (filters.endDate && reportDate > filters.endDate) return false;
  }
  return true;
}

function countActiveFilters(filters: HistoryFilters) {
  return Number(filters.language !== "all") + Number(filters.reviewFocus !== "all") + Number(filters.dateRange !== "all");
}

function daysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

function groupReportsByDate(reports: ReportSummary[]) {
  const groups = new Map<string, ReportSummary[]>();
  reports.forEach((report) => {
    const key = dateKey(report.created_at);
    groups.set(key, [...(groups.get(key) || []), report]);
  });
  return [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0])).map(([date, items]) => ({ date, label: dateLabel(date), items: [...items].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()) }));
}

function dateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) || "unknown" : dateKeyFromDate(date);
}

function dateKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(value: string) {
  const today = dateKeyFromDate(new Date());
  const yesterday = dateKeyFromDate(daysAgo(1));
  if (value === today) return "今天";
  if (value === yesterday) return "昨天";
  return value;
}
