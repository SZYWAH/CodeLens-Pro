import { CalendarPlus, Check, ChevronLeft, Copy, FileText, GraduationCap, Loader2, MessageSquare, Search, ShieldAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding, ReportSummary } from "../types";
import { formatTime, severityLabel } from "../utils/display";
import { useOverlayFocus } from "../hooks/useOverlayFocus";
import { AccessibleListbox, type ListboxOption } from "./AccessibleListbox";
import { ProductToolbar } from "./ProductShell";

const statusOptions: ListboxOption[] = [
  { value: "all", label: "全部状态" },
  { value: "open", label: "待处理" },
  { value: "reviewing", label: "复查中" },
  { value: "resolved", label: "已解决" },
  { value: "ignored", label: "已忽略" }
];

const severityOptions: ListboxOption[] = [
  { value: "all", label: "全部级别" },
  { value: "high", label: "高风险" },
  { value: "medium", label: "中风险" },
  { value: "low", label: "低风险" }
];

export function FindingsView(props: {
  findings: Finding[];
  reports: ReportSummary[];
  status: string;
  severity: string;
  linkedReportTitle: string | null;
  activeFindingId: string | null;
  busy: boolean;
  onSelectFinding: (id: string | null) => void;
  onStatusFilter: (value: string) => Promise<void>;
  onSeverityFilter: (value: string) => Promise<void>;
  onClearReportLink: () => Promise<void>;
  onResetFilters: () => Promise<void>;
  onUpdate: (id: string, status: string) => Promise<unknown>;
  onCreateCards: (ids?: string[]) => void;
  onChatAboutFinding: (finding: Finding) => void;
  onAddDailyLog: (finding: Finding) => void;
}) {
  const [query, setQuery] = useState("");
  const [mobileIndexOpen, setMobileIndexOpen] = useState(false);
  const [filterBusy, setFilterBusy] = useState(false);
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [ignoreTarget, setIgnoreTarget] = useState<Finding | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const mobileIndexTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileIndexRef = useRef<HTMLElement | null>(null);
  const mobileIndexCloseRef = useRef<HTMLButtonElement | null>(null);
  const ignoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const ignoreDialogRef = useRef<HTMLElement | null>(null);
  const ignoreCancelRef = useRef<HTMLButtonElement | null>(null);

  const reportTitles = useMemo(() => new Map(props.reports.map((report) => [report.id, report.title])), [props.reports]);
  const effectiveStatus = (finding: Finding) => statusOverrides[finding.id] || finding.status;
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return props.findings;
    return props.findings.filter((item) => `${item.title} ${item.file_path} ${item.detail} ${item.suggestion}`.toLowerCase().includes(normalizedQuery));
  }, [props.findings, query]);
  const selected = visible.find((item) => item.id === props.activeFindingId) || visible[0] || null;
  const stats = useMemo(() => ({
    high: props.findings.filter((item) => item.severity === "high").length,
    open: props.findings.filter((item) => effectiveStatus(item) === "open").length,
    closed: props.findings.filter((item) => ["resolved", "ignored"].includes(effectiveStatus(item))).length
  }), [props.findings, statusOverrides]);

  useEffect(() => {
    const nextId = selected?.id || null;
    if (nextId !== props.activeFindingId) props.onSelectFinding(nextId);
  }, [props.activeFindingId, props.onSelectFinding, selected?.id]);

  useEffect(() => {
    setStatusOverrides((current) => {
      let changed = false;
      const next = { ...current };
      for (const finding of props.findings) {
        if (next[finding.id] === finding.status) {
          delete next[finding.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.findings]);

  useOverlayFocus({
    active: mobileIndexOpen,
    containerRef: mobileIndexRef,
    initialFocusRef: mobileIndexCloseRef,
    returnFocusRef: mobileIndexTriggerRef,
    onRequestClose: () => setMobileIndexOpen(false)
  });
  useOverlayFocus({
    active: Boolean(ignoreTarget),
    containerRef: ignoreDialogRef,
    initialFocusRef: ignoreCancelRef,
    returnFocusRef: ignoreTriggerRef,
    onRequestClose: () => setIgnoreTarget(null)
  });

  async function runFilter(action: () => Promise<void>) {
    if (filterBusy) return;
    setFilterBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "筛选问题失败，请稍后重试。");
    } finally {
      setFilterBusy(false);
    }
  }

  async function commitStatus(finding: Finding, nextStatus: string) {
    if (pendingStatusId || effectiveStatus(finding) === nextStatus) return;
    const previousStatus = effectiveStatus(finding);
    setPendingStatusId(finding.id);
    setActionError(null);
    setStatusOverrides((current) => ({ ...current, [finding.id]: nextStatus }));
    try {
      await props.onUpdate(finding.id, nextStatus);
    } catch (error) {
      setStatusOverrides((current) => ({ ...current, [finding.id]: previousStatus }));
      setActionError(error instanceof Error ? error.message : "更新问题状态失败，请稍后重试。");
    } finally {
      setPendingStatusId(null);
    }
  }

  async function copyPath(path: string) {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      window.setTimeout(() => setCopiedPath((value) => value === path ? null : value), 1400);
    } catch {
      setActionError("复制文件路径失败，请检查系统剪贴板权限。");
    }
  }

  function selectFinding(id: string) {
    props.onSelectFinding(id);
    setMobileIndexOpen(false);
  }

  const selectedStatus = selected ? effectiveStatus(selected) : "open";
  const selectedReportTitle = selected?.report_id ? reportTitles.get(selected.report_id) || "关联报告" : "未关联报告";
  const selectedLocation = selected?.line_start
    ? `第 ${selected.line_start}${selected.line_end && selected.line_end !== selected.line_start ? `-${selected.line_end}` : ""} 行`
    : "未记录行号";

  return <section className="findings-workspace-v134" aria-busy={filterBusy || Boolean(pendingStatusId) || props.busy}>
    <ProductToolbar>
      <div className="findings-toolbar-context-v141"><span>问题清单</span><strong>{props.findings.length} 项</strong><em>高风险 {stats.high} · 待处理 {stats.open} · 已闭环 {stats.closed}</em></div>
      <div className="findings-toolbar-actions-v141">
        {filterBusy && <span className="findings-toolbar-loading-v141"><Loader2 className="spin" size={14} />正在更新</span>}
        <button aria-label={`生成当前 ${visible.length} 项知识卡片`} className="primary-button" disabled={props.busy || !visible.length} onClick={() => props.onCreateCards(visible.map((item) => item.id))} title={`生成当前 ${visible.length} 项知识卡片`} type="button"><GraduationCap size={15} /><span>生成当前 {visible.length} 项卡片</span></button>
      </div>
    </ProductToolbar>

    {props.linkedReportTitle && <div className="findings-report-filter-v134"><span><FileText size={14} />当前报告：{props.linkedReportTitle}</span><button disabled={filterBusy} onClick={() => void runFilter(props.onClearReportLink)} type="button"><X size={14} />查看全部</button></div>}
    <button className="findings-mobile-index-v134" onClick={() => setMobileIndexOpen(true)} ref={mobileIndexTriggerRef} type="button"><ShieldAlert size={15} />问题索引 · {visible.length}</button>

    <div className="findings-layout-v134">
      {mobileIndexOpen && <button className="findings-index-scrim-v134" aria-label="关闭问题索引" onClick={() => setMobileIndexOpen(false)} type="button" />}
      <aside aria-label="问题索引" className={`findings-index-v134 ${mobileIndexOpen ? "is-open" : ""}`} ref={mobileIndexRef}>
        <header><div><strong>问题索引</strong><span>{visible.length} 项</span></div><button aria-label="关闭问题索引" onClick={() => setMobileIndexOpen(false)} ref={mobileIndexCloseRef} type="button"><ChevronLeft size={16} /></button></header>
        <label className="findings-search-v134"><Search size={14} /><input aria-label="搜索问题" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、文件或内容" /></label>
        <div className="findings-filters-v134">
          <AccessibleListbox compact disabled={filterBusy} label="状态" onChange={(value) => void runFilter(() => props.onStatusFilter(value))} options={statusOptions} value={props.status} />
          <AccessibleListbox compact disabled={filterBusy} label="风险" onChange={(value) => void runFilter(() => props.onSeverityFilter(value))} options={severityOptions} value={props.severity} />
        </div>
        <div className="findings-list-v134">
          {visible.map((item) => {
            const itemStatus = effectiveStatus(item);
            return <button aria-current={selected?.id === item.id ? "page" : undefined} className={selected?.id === item.id ? "active" : ""} key={item.id} onClick={() => selectFinding(item.id)} type="button"><span className={`risk-dot-v134 ${item.severity}`} /><strong>{item.title}</strong><small>{severityLabel(item.severity)} · {statusLabel(itemStatus)}</small><span className="findings-list-path-v144" title={item.file_path || "未关联文件"}>{item.file_path || "未关联文件"}</span></button>;
          })}
          {!visible.length && <div className="finding-empty-v134"><strong>没有匹配的问题</strong><span>可清空搜索或放宽筛选范围。</span><button disabled={filterBusy} onClick={() => { setQuery(""); void runFilter(props.onResetFilters); }} type="button">重置筛选</button></div>}
        </div>
      </aside>

      <main className="finding-detail-v134">
        {selected ? <>
          <header className="finding-detail-header-v141">
            <div className="finding-detail-labels-v141"><span className={`risk-pill-v134 ${selected.severity}`}>{severityLabel(selected.severity)}</span><span>{categoryLabel(selected.category)}</span><span>{statusLabel(selectedStatus)}</span></div>
            <h3>{selected.title}</h3>
            <dl className="finding-context-grid-v141">
              <div><dt>来源报告</dt><dd title={selectedReportTitle}>{selectedReportTitle}</dd></div>
              <div className="finding-path-context-v141"><dt>关联文件</dt><dd><code title={selected.file_path || "未关联文件"}>{selected.file_path || "未关联文件"}</code>{selected.file_path && <button aria-label="复制文件路径" onClick={() => void copyPath(selected.file_path)} title={copiedPath === selected.file_path ? "已复制" : "复制文件路径"} type="button"><Copy size={14} /></button>}</dd></div>
              <div><dt>定位</dt><dd>{selectedLocation}</dd></div>
              <div><dt>最后更新</dt><dd>{formatTime(selected.updated_at)}</dd></div>
            </dl>
          </header>

          <section className="finding-detail-section-v141"><span>问题说明</span><p>{selected.detail}</p></section>
          <section className="finding-detail-section-v141"><span>建议处理</span><p>{selected.suggestion || "复查影响范围，确认风险后再处理。"}</p></section>

          <section className="finding-disposition-v141" aria-label="问题处置">
            <div><span>处置状态</span><p>状态会保留在本地审查记录中，不会修改原项目文件。</p></div>
            <div className="finding-status-actions-v134" role="group" aria-label="更新问题状态">
              <button aria-pressed={selectedStatus === "open"} disabled={Boolean(pendingStatusId)} onClick={() => void commitStatus(selected, "open")} type="button">待处理</button>
              <button aria-pressed={selectedStatus === "reviewing"} disabled={Boolean(pendingStatusId)} onClick={() => void commitStatus(selected, "reviewing")} type="button">复查中</button>
              <button aria-pressed={selectedStatus === "resolved"} disabled={Boolean(pendingStatusId)} onClick={() => void commitStatus(selected, "resolved")} type="button"><Check size={14} />已解决</button>
              <button aria-pressed={selectedStatus === "ignored"} disabled={Boolean(pendingStatusId)} onClick={() => setIgnoreTarget(selected)} ref={ignoreTriggerRef} type="button">忽略</button>
            </div>
          </section>

          <footer className="finding-next-actions-v134">
            <button disabled={props.busy || Boolean(pendingStatusId)} onClick={() => props.onCreateCards([selected.id])} type="button"><GraduationCap size={15} />生成知识卡片</button>
            <button disabled={Boolean(pendingStatusId)} onClick={() => props.onAddDailyLog(selected)} type="button"><CalendarPlus size={15} />加入每日日志</button>
            <button disabled={Boolean(pendingStatusId)} onClick={() => props.onChatAboutFinding(selected)} type="button"><MessageSquare size={15} />围绕问题对话</button>
          </footer>
          {actionError && <p className="finding-action-error-v141" role="alert">{actionError}</p>}
        </> : <div className="finding-empty-v134 finding-detail-empty-v141"><ShieldAlert size={20} /><strong>选择一个问题开始处置</strong><span>从报告风险、关联文件和建议中继续推进。</span></div>}
      </main>
    </div>

    {ignoreTarget && <div className="finding-ignore-layer-v141" role="presentation"><button aria-label="取消忽略问题" className="finding-ignore-scrim-v141" onClick={() => setIgnoreTarget(null)} type="button" /><section aria-labelledby="finding-ignore-title-v141" aria-modal="true" className="finding-ignore-dialog-v141" ref={ignoreDialogRef} role="dialog"><header><ShieldAlert size={18} /><div><strong id="finding-ignore-title-v141">忽略这个问题？</strong><span>{severityLabel(ignoreTarget.severity)} · {ignoreTarget.title}</span></div></header><p>此操作会保留问题记录及其来源，只将状态标记为“已忽略”。</p><footer><button className="secondary-button" onClick={() => setIgnoreTarget(null)} ref={ignoreCancelRef} type="button">取消</button><button className="danger-button" onClick={() => { setIgnoreTarget(null); void commitStatus(ignoreTarget, "ignored"); }} type="button">确认忽略</button></footer></section></div>}
  </section>;
}

function statusLabel(value: string) { return ({ open: "待处理", reviewing: "复查中", resolved: "已解决", ignored: "已忽略" } as Record<string, string>)[value] || value; }
function categoryLabel(value: string) { return ({ security: "安全", quality: "质量", reliability: "可靠性", maintainability: "可维护性" } as Record<string, string>)[value] || value; }
