import {
  BarChart3,
  ChevronDown,
  Clipboard,
  Download,
  FileCode2,
  FileText,
  GraduationCap,
  ListTree,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Network,
  Pencil,
  Route,
  ShieldAlert,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReportDetail, TraceabilitySnapshot } from "../types";

type ReportHeading = { id: string; level: number; title: string };
type MarkdownBlock =
  | { type: "heading"; id: string; level: number; text: string; lineIndex: number }
  | { type: "paragraph"; lines: string[]; lineIndex: number }
  | { type: "list"; ordered: boolean; items: string[]; lineIndex: number }
  | { type: "quote"; lines: string[]; lineIndex: number }
  | { type: "code"; language: string; code: string; lineIndex: number };

export function ReportReader({
  report,
  traceability,
  onCopy,
  onExport,
  onGenerateCandidates,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport,
  onRename,
  variant = "full",
  loading = false,
  operationBusy = false
}: {
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  onCopy: () => void;
  onExport: (kind: "md" | "html") => void;
  onGenerateCandidates?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
  onRename?: (id: string, title: string) => Promise<void>;
  variant?: "embedded" | "full";
  loading?: boolean;
  operationBusy?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [readingProgress, setReadingProgress] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [showLoadingNotice, setShowLoadingNotice] = useState(false);
  const readerScrollRef = useRef<HTMLElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileToolsRef = useRef<HTMLDivElement | null>(null);
  const outlineMenuRef = useRef<HTMLDivElement | null>(null);
  const outlineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fullscreenTriggerRef = useRef<HTMLButtonElement | null>(null);
  const headings = useMemo(() => extractHeadings(report?.full_report || ""), [report?.full_report]);
  const traceCounts = traceability?.scope_kind === "report" && traceability.scope_id === report?.id ? traceability.counts : null;
  const mainlineActionCount = (traceCounts?.findings || report?.metrics.risk_count || 0)
    + (traceCounts?.cards || 0)
    + (traceCounts?.daily_logs || 0)
    + (traceCounts?.chats || 0);

  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(report?.title || "");
    setTitleSaving(false);
    setTitleError(null);
  }, [report?.id, report?.title]);

  useEffect(() => {
    if (!loading) {
      setShowLoadingNotice(false);
      return;
    }
    const timer = window.setTimeout(() => setShowLoadingNotice(true), 180);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    const container = readerScrollRef.current;
    if (!container || headings.length === 0) {
      setActiveHeadingId(null);
      return;
    }
    const scrollContainer = container;

    function updateActiveHeading() {
      let current = headings[0]?.id || null;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const maxScroll = Math.max(1, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      setReadingProgress(Math.round((scrollContainer.scrollTop / maxScroll) * 100));
      for (const heading of headings) {
        const element = scrollContainer.querySelector<HTMLElement>(`#${cssEscape(heading.id)}`);
        if (!element) continue;
        const top = element.getBoundingClientRect().top - containerTop;
        if (top <= 98) current = heading.id;
        if (top > 98) break;
      }
      setActiveHeadingId(current);
    }

    updateActiveHeading();
    scrollContainer.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);
    return () => {
      scrollContainer.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [headings, report?.id]);

  useEffect(() => {
    setExportOpen(false);
    setOutlineOpen(false);
    setActionsOpen(false);
    setFullscreen(false);
    setReadingProgress(0);
    setActiveHeadingId(headings[0]?.id || null);
    if (readerScrollRef.current) readerScrollRef.current.scrollTop = 0;
  }, [report?.id]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      window.setTimeout(() => fullscreenTriggerRef.current?.focus(), 0);
    };
  }, [fullscreen]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (
        exportMenuRef.current?.contains(event.target as Node)
        || mobileToolsRef.current?.contains(event.target as Node)
        || outlineMenuRef.current?.contains(event.target as Node)
      ) return;
      setExportOpen(false);
      setMobileToolsOpen(false);
      setOutlineOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mobileToolsOpen) {
        setMobileToolsOpen(false);
      } else if (exportOpen) {
        setExportOpen(false);
      } else if (outlineOpen) {
        setOutlineOpen(false);
        window.setTimeout(() => outlineTriggerRef.current?.focus(), 0);
      } else if (actionsOpen) {
        setActionsOpen(false);
      } else if (fullscreen) {
        setFullscreen(false);
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [actionsOpen, exportOpen, fullscreen, mobileToolsOpen, outlineOpen]);

  function jumpToHeading(id: string) {
    const container = readerScrollRef.current;
    const target = container?.querySelector<HTMLElement>(`#${cssEscape(id)}`);
    if (!container || !target) return;
    const containerTop = container.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    setActiveHeadingId(id);
    container.scrollTo({ top: container.scrollTop + targetTop - containerTop - 18, behavior: "smooth" });
  }

  function toggleFullscreen(trigger?: HTMLButtonElement) {
    if (trigger) fullscreenTriggerRef.current = trigger;
    setFullscreen((value) => !value);
  }

  function closeOutline(restoreFocus = false) {
    setOutlineOpen(false);
    if (restoreFocus) window.setTimeout(() => outlineTriggerRef.current?.focus(), 0);
  }

  function drawerAction(action?: () => void) {
    if (!action) return undefined;
    return () => {
      setActionsOpen(false);
      action();
    };
  }

  async function saveTitle() {
    if (!report || !onRename || titleSaving) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleError("报告标题不能为空。");
      return;
    }
    setTitleSaving(true);
    setTitleError(null);
    try {
      await onRename(report.id, nextTitle);
      setEditingTitle(false);
    } catch (error) {
      setTitleError(error instanceof Error ? error.message : "保存报告标题失败。");
    } finally {
      setTitleSaving(false);
    }
  }

  if (!report) {
    return (
      <article className={"report-reader report-reader-v13 empty is-" + variant} aria-busy={loading}>
        {loading ? <Loader2 className="spin" size={20} /> : null}
        <strong>{loading ? "正在恢复报告" : "还没有打开报告"}</strong>
        <span>{loading ? "正在读取报告正文。" : variant === "embedded" ? "在左侧完成配置并生成单文件报告，结果会在这里进入结构化阅读。" : "生成项目分析、代码对比，或从历史报告中打开一份报告后，会在这里进入结构化阅读。"}</span>
      </article>
    );
  }

  return (
    <article className={"report-reader report-reader-v13 is-" + variant + (fullscreen ? " is-fullscreen" : "")} aria-busy={loading || operationBusy}>
      {showLoadingNotice && <div className="report-loading-strip-v143" aria-live="polite"><Loader2 className="spin" size={15} /><span>正在打开报告</span></div>}
      <header className="report-reader-header report-reader-header-v13">
        <div className="report-reader-heading-v131">
          <span>{typeLabel(report.report_type)} / {languageLabel(report.language)} / {sourceLabel(report.analysis_source)}</span>
          <div className="report-title-row-v147">
            {editingTitle ? (
              <div className="report-title-edit-v147">
                <input
                  aria-label="报告标题"
                  autoFocus
                  disabled={titleSaving}
                  maxLength={60}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveTitle();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingTitle(false);
                      setTitleDraft(report.title);
                      setTitleError(null);
                    }
                  }}
                  value={titleDraft}
                />
                <button className="secondary-button" disabled={titleSaving} onClick={() => void saveTitle()} type="button">{titleSaving ? "保存中" : "保存"}</button>
                <button className="icon-button" disabled={titleSaving} onClick={() => { setEditingTitle(false); setTitleDraft(report.title); setTitleError(null); }} title="取消重命名" type="button"><X size={15} /></button>
              </div>
            ) : (
              <>
                <h3>{report.title}</h3>
                {onRename && <button className="report-title-rename-v147" disabled={loading || operationBusy} onClick={() => { setTitleDraft(report.title); setTitleError(null); setEditingTitle(true); }} title="重命名报告" type="button"><Pencil size={14} /></button>}
              </>
            )}
          </div>
          {titleError && <small className="report-title-error-v147" role="alert">{titleError}</small>}
          <p>{formatTime(report.created_at)} · {report.summary}</p>
          <div className="report-meta-strip-v131" aria-label="报告概况">
            <span className={`risk-${report.risk_level}`}><ShieldAlert size={13} /><em>风险</em><strong>{severityLabel(report.risk_level)}</strong></span>
            <span><FileCode2 size={13} /><em>文件</em><strong>{report.file_count}</strong></span>
            <span><BarChart3 size={13} /><em>代码行</em><strong>{report.metrics.total_lines}</strong></span>
            <span><ListChecks size={13} /><em>建议</em><strong>{report.metrics.suggestion_count}</strong></span>
          </div>
          <div className="report-reader-progress-next" aria-label="报告阅读进度">
            <i style={{ width: `${readingProgress}%` }} />
            <strong>{readingProgress}%</strong>
          </div>
        </div>
        <div className="report-reader-actions">
          {headings.length > 1 && (
            <div className="report-outline-menu-v149" ref={outlineMenuRef}>
              <button
                aria-expanded={outlineOpen}
                aria-haspopup="dialog"
                className="report-outline-trigger-v131"
                onClick={() => {
                  setExportOpen(false);
                  setMobileToolsOpen(false);
                  setActionsOpen(false);
                  setOutlineOpen((value) => !value);
                }}
                ref={outlineTriggerRef}
                title="打开报告目录"
                type="button"
              >
                <ListTree size={16} /><span>目录</span>
              </button>
              {outlineOpen && <ReportOutlinePopover headings={headings} activeHeadingId={activeHeadingId} readingProgress={readingProgress} onClose={() => closeOutline(true)} onSelect={jumpToHeading} />}
            </div>
          )}
          <button className="icon-button report-desktop-tool-v143" disabled={loading || operationBusy} onClick={onCopy} title="复制报告"><Clipboard size={18} /></button>
          <div className="report-export-menu-v131" ref={exportMenuRef}>
            <button className="report-toolbar-button-v131 report-desktop-tool-v143" aria-expanded={exportOpen} aria-haspopup="menu" disabled={loading || operationBusy} onClick={() => setExportOpen((value) => !value)} type="button">
              <Download size={16} /><span>导出</span><ChevronDown size={13} />
            </button>
            {exportOpen && (
              <div className="report-export-options-v131" role="menu">
                <button onClick={() => { setExportOpen(false); onExport("md"); }} role="menuitem" type="button"><Download size={14} />Markdown</button>
                <button onClick={() => { setExportOpen(false); onExport("html"); }} role="menuitem" type="button"><FileText size={14} />HTML</button>
              </div>
            )}
          </div>
          <button aria-label={fullscreen ? "退出全屏阅读" : "全屏阅读"} className="icon-button report-desktop-tool-v143" disabled={loading || operationBusy} onClick={(event) => toggleFullscreen(event.currentTarget)} title={fullscreen ? "退出全屏阅读" : "全屏阅读"}>
            {fullscreen ? <X size={18} /> : <Maximize2 size={18} />}
          </button>
          <div className="report-mobile-tools-v143" ref={mobileToolsRef}>
            <button className="icon-button" aria-expanded={mobileToolsOpen} aria-haspopup="menu" disabled={loading || operationBusy} onClick={() => setMobileToolsOpen((value) => !value)} title="更多报告操作" type="button"><MoreHorizontal size={18} /></button>
            {mobileToolsOpen && (
              <div className="report-mobile-tools-menu-v143" role="menu">
                <button onClick={() => { setMobileToolsOpen(false); onCopy(); }} role="menuitem" type="button"><Clipboard size={15} />复制报告</button>
                <button onClick={() => { setMobileToolsOpen(false); onExport("md"); }} role="menuitem" type="button"><Download size={15} />导出 Markdown</button>
                <button onClick={() => { setMobileToolsOpen(false); onExport("html"); }} role="menuitem" type="button"><FileText size={15} />导出 HTML</button>
                <button onClick={(event) => { setMobileToolsOpen(false); toggleFullscreen(event.currentTarget); }} role="menuitem" type="button">{fullscreen ? <X size={15} /> : <Maximize2 size={15} />}{fullscreen ? "退出全屏" : "全屏阅读"}</button>
              </div>
            )}
          </div>
          <button
            className={actionsOpen ? "report-actions-trigger-v131 active" : "report-actions-trigger-v131"}
            aria-expanded={actionsOpen}
            disabled={loading || operationBusy}
            onClick={() => { setExportOpen(false); setOutlineOpen(false); setActionsOpen((value) => !value); }}
            type="button"
          >
            <Route size={16} /><span>后续动作</span>{mainlineActionCount > 0 && <em>{mainlineActionCount}</em>}
          </button>
        </div>
      </header>

      <section className="report-reader-body report-reader-grid-v13">
        <main className="report-document-rich report-document-v13" ref={readerScrollRef}>
          <ReportMarkdownDocument content={report.full_report} />
        </main>

        {actionsOpen && <button className="report-action-scrim-v131" aria-label="关闭后续动作" onClick={() => setActionsOpen(false)} type="button" />}
        <aside className={actionsOpen ? "report-actions-drawer-v131 is-open" : "report-actions-drawer-v131"} aria-hidden={!actionsOpen}>
          <header>
            <div><span><Route size={15} />报告闭环</span><strong>后续动作</strong></div>
            <button className="icon-button" onClick={() => setActionsOpen(false)} title="关闭后续动作" type="button"><X size={16} /></button>
          </header>
          <section className="report-facts-v13">
            <Metric icon={<ShieldAlert size={15} />} label="风险" value={severityLabel(report.risk_level)} tone={report.risk_level} />
            <Metric icon={<FileCode2 size={15} />} label="文件" value={`${report.file_count}`} />
            <Metric icon={<BarChart3 size={15} />} label="代码行" value={`${report.metrics.total_lines}`} />
            <Metric icon={<ListChecks size={15} />} label="建议" value={`${report.metrics.suggestion_count}`} />
          </section>
          <ReportActionBoard
            report={report}
            traceability={traceability}
            onGenerateCandidates={drawerAction(onGenerateCandidates)}
            onOpenFindings={drawerAction(onOpenFindings)}
            onAddDailyLog={drawerAction(onAddDailyLog)}
            onChatAboutReport={drawerAction(onChatAboutReport)}
          />
        </aside>
      </section>
    </article>
  );
}

function ReportOutlinePopover({
  headings,
  activeHeadingId,
  readingProgress,
  onClose,
  onSelect
}: {
  headings: ReportHeading[];
  activeHeadingId: string | null;
  readingProgress: number;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const activeIndex = Math.max(0, headings.findIndex((heading) => heading.id === activeHeadingId));
  return (
    <div className="report-outline-popover-v149" role="dialog" aria-label="报告目录">
      <header>
        <div><strong>报告目录</strong><span>第 {activeIndex + 1} 节 · {readingProgress}%</span></div>
        <button onClick={onClose} title="关闭报告目录" type="button"><X size={14} /></button>
      </header>
      {headings.map((heading, index) => (
        <button
          className={activeHeadingId === heading.id || (!activeHeadingId && index === 0) ? "active" : ""}
          key={heading.id}
          onClick={() => {
            onSelect(heading.id);
            onClose();
          }}
          style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}
          type="button"
        >
          <span>{sectionNumberLabel(index + 1, heading.level)}</span>
          <em>{heading.title}</em>
        </button>
      ))}
    </div>
  );
}

function ReportRiskMap({ report }: { report: ReportDetail }) {
  const files = report.files.slice(0, 10);
  const maxRisk = Math.max(...files.map((file) => file.metrics.risk_count), report.metrics.risk_count, 1);
  const topFile = [...files].sort((left, right) => right.metrics.risk_count - left.metrics.risk_count || right.metrics.complexity_score - left.metrics.complexity_score)[0];

  return (
    <section className="report-risk-map-next">
      <div className="report-risk-map-head-next">
        <div>
          <span><FileCode2 size={15} />文件风险热区</span>
          <h4>{topFile ? topFile.path : "暂无文件热区"}</h4>
          <p>{topFile ? `最高风险文件：${topFile.metrics.risk_count} 个风险 / 复杂度 ${topFile.metrics.complexity_score}` : "当前报告没有保存文件明细，可继续查看摘要与正文。"}</p>
        </div>
        <strong>{report.metrics.risk_count}</strong>
      </div>
      <div className="report-risk-bars-next">
        {files.map((file) => (
          <article key={file.id}>
            <div>
              <code>{file.path}</code>
              <span>{file.language} / {file.metrics.total_lines} 行 / 复杂度 {file.metrics.complexity_score}</span>
            </div>
            <i style={{ width: `${Math.max(8, Math.round((file.metrics.risk_count / maxRisk) * 100))}%` }} />
            <strong>{file.metrics.risk_count}</strong>
          </article>
        ))}
        {files.length === 0 && <p>此报告没有文件列表，后续项目报告会在这里显示热区。</p>}
      </div>
    </section>
  );
}

function ReportInsightDeck({ report, traceability, headingCount }: { report: ReportDetail; traceability: TraceabilitySnapshot | null; headingCount: number }) {
  const counts = traceability?.scope_kind === "report" && traceability.scope_id === report.id ? traceability.counts : null;
  const mainlineCount = (counts?.findings || 0) + (counts?.cards || 0) + (counts?.daily_logs || 0);
  const optionalCount = (counts?.chats || 0) + (counts?.agent_tasks || 0);
  const riskHint = report.metrics.risk_count > 0
    ? `发现 ${report.metrics.risk_count} 个风险点，建议先处理高影响文件。`
    : "暂未发现显式风险，可以重点检查架构一致性和测试覆盖。";
  const fileHint = report.file_count > 1
    ? `覆盖 ${report.file_count} 个文件，适合按文件热区分段阅读。`
    : "单文件报告，适合先读摘要再进入建议和代码片段。";
  const loopHint = mainlineCount > 0
    ? `已关联 ${mainlineCount} 个主线资产，可继续追踪问题、卡片和日志。${optionalCount ? `另有 ${optionalCount} 个辅助资产。` : ""}`
    : "还没有形成闭环资产，建议从问题清单或知识卡片开始沉淀。";

  const items = [
    { label: "阅读重点", value: severityLabel(report.risk_level), detail: riskHint, icon: <ShieldAlert size={16} /> },
    { label: "覆盖范围", value: `${report.file_count} 文件`, detail: fileHint, icon: <FileCode2 size={16} /> },
    { label: "文档结构", value: `${headingCount} 节`, detail: headingCount > 0 ? "目录可跳转，适合按章节审查。" : "报告没有 Markdown 标题，建议后续生成结构化报告。", icon: <ListChecks size={16} /> },
    { label: "闭环资产", value: `${mainlineCount} 项`, detail: loopHint, icon: <Network size={16} /> }
  ];

  return (
    <section className="report-insight-deck-next">
      {items.map((item) => (
        <article key={item.label}>
          <span>{item.icon}{item.label}</span>
          <strong>{item.value}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </section>
  );
}

function ReportEvidenceMatrix({
  report,
  traceability,
  headingCount,
  onGenerateCandidates,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport
}: {
  report: ReportDetail;
  traceability: TraceabilitySnapshot | null;
  headingCount: number;
  onGenerateCandidates?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
}) {
  const counts = traceability?.scope_kind === "report" && traceability.scope_id === report.id ? traceability.counts : null;
  const mainlineCount = (counts?.findings || 0) + (counts?.cards || 0) + (counts?.daily_logs || 0);
  const topFile = [...report.files].sort((left, right) => right.metrics.risk_count - left.metrics.risk_count || right.metrics.complexity_score - left.metrics.complexity_score)[0];
  const evidenceItems = [
    {
      key: "risk",
      label: "风险证据",
      value: `${report.metrics.risk_count} 个风险`,
      complete: report.metrics.risk_count > 0 || report.risk_level !== "high",
      detail: report.metrics.risk_count > 0 ? `优先复查 ${severityLabel(report.risk_level)}，从风险摘录和热区文件进入。` : "没有显式风险，建议把重点放在测试覆盖、边界条件和架构一致性。"
    },
    {
      key: "file",
      label: "文件证据",
      value: `${report.file_count} 个文件`,
      complete: report.file_count > 0 && report.files.length > 0,
      detail: topFile ? `代表文件：${topFile.path}，风险 ${topFile.metrics.risk_count}，复杂度 ${topFile.metrics.complexity_score}。` : "当前报告缺少文件明细，后续项目分析应保留文件级快照。"
    },
    {
      key: "structure",
      label: "阅读结构",
      value: `${headingCount} 个章节`,
      complete: headingCount > 0,
      detail: headingCount > 0 ? "目录、章节定位和正文滚动进度可支撑长报告阅读。" : "正文缺少 Markdown 标题，建议生成更结构化的报告。"
    },
    {
      key: "loop",
      label: "闭环资产",
      value: `${mainlineCount} 项`,
      complete: mainlineCount > 0,
      detail: mainlineCount > 0 ? `已关联问题、卡片或日志共 ${mainlineCount} 项。` : "还没有把阅读结果沉淀到问题、卡片或日志。"
    }
  ];
  const completeCount = evidenceItems.filter((item) => item.complete).length;
  const integrity = Math.round((completeCount / evidenceItems.length) * 100);
  const priority = report.risk_level === "high" || report.metrics.risk_count >= 5
    ? "高优先级复查"
    : report.risk_level === "medium" || report.metrics.suggestion_count >= 3
      ? "中优先级推进"
      : "常规沉淀";
  const nextActions = [
    { label: "复查问题清单", detail: report.metrics.risk_count > 0 ? "把风险点转成可跟踪状态" : "检查是否需要补充手动问题", icon: <ShieldAlert size={15} />, onClick: onOpenFindings, ready: report.metrics.risk_count > 0 || Boolean(counts?.findings) },
    { label: "生成知识卡片", detail: "把建议和风险沉淀为复习材料", icon: <GraduationCap size={15} />, onClick: onGenerateCandidates, ready: Boolean(counts?.cards) },
    { label: "加入每日日志", detail: "把这次审查写入学习复盘", icon: <FileText size={15} />, onClick: onAddDailyLog, ready: Boolean(counts?.daily_logs) },
    { label: "围绕报告对话", detail: "辅助追问设计取舍和边界条件", icon: <MessageSquare size={15} />, onClick: onChatAboutReport, ready: Boolean(counts?.chats) }
  ];

  return (
    <section className="report-evidence-matrix-next">
      <div className="report-evidence-head-next">
        <div>
          <span><Route size={15} />报告审查证据矩阵</span>
          <h4>{priority}</h4>
          <p>把当前报告拆成“风险、文件、结构、闭环”四类证据，帮助判断这份报告是否已经从阅读结果进入可追踪的项目审查流程。</p>
        </div>
        <div className="report-evidence-score-next">
          <strong>{integrity}%</strong>
          <small>{completeCount}/{evidenceItems.length} 类证据已具备</small>
        </div>
      </div>

      <div className="report-evidence-grid-next">
        {evidenceItems.map((item) => (
          <article className={item.complete ? "complete" : "missing"} key={item.key}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>

      <div className="report-evidence-actions-next">
        {nextActions.map((item) => (
          <button className={item.ready ? "ready" : ""} disabled={!item.onClick} key={item.label} onClick={item.onClick} type="button">
            <span>{item.icon}</span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ReportActionBoard({
  report,
  traceability,
  onGenerateCandidates,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport
}: {
  report: ReportDetail;
  traceability: TraceabilitySnapshot | null;
  onGenerateCandidates?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
}) {
  const counts = traceability?.scope_kind === "report" && traceability.scope_id === report.id ? traceability.counts : null;
  const mainlineCount = (counts?.findings || 0) + (counts?.cards || 0) + (counts?.daily_logs || 0);
  const actionItems = [
    { key: "findings", label: "问题清单", value: counts?.findings || report.metrics.risk_count, hint: "把风险拆成可跟踪事项", icon: <ShieldAlert size={16} />, onClick: onOpenFindings },
    { key: "cards", label: "知识卡片", value: counts?.cards || 0, hint: "沉淀可复习知识点", icon: <GraduationCap size={16} />, onClick: onGenerateCandidates },
    { key: "log", label: "每日日志", value: counts?.daily_logs || 0, hint: "写入学习复盘链路", icon: <FileText size={16} />, onClick: onAddDailyLog },
    { key: "chat", label: "报告对话", value: counts?.chats || 0, hint: "辅助追问设计与风险", icon: <MessageSquare size={16} />, onClick: onChatAboutReport }
  ];

  return (
    <section className="report-action-board-next">
      <div className="report-action-board-head-next">
        <span><Route size={15} />后续动作</span>
        <strong>{mainlineCount}</strong>
      </div>
      <div className="report-action-lane-next">
        {actionItems.map((item) => (
          <button
            className={item.value > 0 ? "has-data" : ""}
            disabled={!item.onClick}
            key={item.key}
            onClick={item.onClick}
            title={item.hint}
            type="button"
          >
            <span>{item.icon}</span>
            <strong>{item.label}</strong>
            <em>{item.value}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function buildReaderSteps(report: ReportDetail, headingCount: number) {
  const steps = [
    `先确认报告类型：${typeLabel(report.report_type)}，分析来源：${sourceLabel(report.analysis_source)}。`,
    report.metrics.risk_count > 0
      ? `优先查看风险摘录和 ${report.metrics.risk_count} 个风险点。`
      : "先阅读摘要与建议，确认是否需要补充测试或重构。",
    report.file_count > 1
      ? `再按文件概览定位 ${report.file_count} 个相关文件。`
      : "再进入正文，核对单文件中的关键代码段。",
    headingCount > 0
      ? `最后按 ${headingCount} 个目录章节沉淀问题、卡片或每日日志。`
      : "最后把可执行事项加入问题、卡片或每日日志。"
  ];
  return steps;
}

function TraceabilityPanel({ snapshot, reportId }: { snapshot: TraceabilitySnapshot | null; reportId: string }) {
  if (!snapshot || snapshot.scope_kind !== "report" || snapshot.scope_id !== reportId) {
    return (
      <section className="traceability-panel compact">
        <div>
          <span><Network size={15} />关联洞察</span>
          <p>正在等待当前报告的闭环关系数据。</p>
        </div>
      </section>
    );
  }

  const visibleNodes = snapshot.nodes.slice(0, 9);
  return (
    <section className="traceability-panel">
      <div className="traceability-head">
        <div>
          <span><Network size={15} />关联洞察</span>
          <h4>{snapshot.title}</h4>
          <p>把报告、问题、卡片、日志、对话和行动草稿放在同一条本地闭环里查看。</p>
        </div>
        <div className="traceability-counts">
          <small>问题 <strong>{snapshot.counts.findings}</strong></small>
          <small>卡片 <strong>{snapshot.counts.cards}</strong></small>
          <small>日志 <strong>{snapshot.counts.daily_logs}</strong></small>
          <small>对话 <strong>{snapshot.counts.chats}</strong></small>
          <small>草稿 <strong>{snapshot.counts.agent_tasks}</strong></small>
        </div>
      </div>
      <div className="traceability-flow">
        {visibleNodes.map((node) => (
          <article key={node.id} className={`trace-node ${node.kind}`}>
            <small>{traceKindLabel(node.kind)} / {traceStatusLabel(node.status)}</small>
            <strong>{node.title}</strong>
            <span>{node.subtitle}</span>
          </article>
        ))}
        {visibleNodes.length === 0 && <p className="muted">暂无可展示的关联节点。</p>}
      </div>
      <div className="traceability-footer">
        <div>
          <strong>闭环缺口</strong>
          {(snapshot.gaps.length ? snapshot.gaps : ["当前报告的主要闭环已经建立。"]).slice(0, 4).map((item) => <p key={item}>{item}</p>)}
        </div>
        <div>
          <strong>下一步动作</strong>
          {(snapshot.next_actions.length ? snapshot.next_actions : ["继续复查未解决问题，或把报告加入每日学习记录。"]).slice(0, 4).map((item) => <p key={item}>{item}</p>)}
        </div>
      </div>
      <div className="traceability-links">
        {snapshot.links.slice(0, 8).map((link) => <span key={`${link.source}-${link.target}-${link.label}`}>{link.label} / {link.weight}</span>)}
      </div>
    </section>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className={tone ? `report-reader-metric ${tone}` : "report-reader-metric"}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function extractHeadings(content: string): ReportHeading[] {
  return content
    .split("\n")
    .map((line, index) => {
      const match = /^(#{1,4})\s+(.+)$/.exec(line.trim());
      if (!match) return null;
      const title = match[2].trim();
      return { id: headingId(title, index), level: match[1].length, title };
    })
    .filter(Boolean) as ReportHeading[];
}

function ReportMarkdownDocument({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  if (blocks.length === 0) {
    return <section className="report-document-content-next empty">报告正文为空。</section>;
  }

  return (
    <section className="report-document-content-next report-markdown-document-next">
      {blocks.map((block) => renderMarkdownBlock(block))}
    </section>
  );
}

function renderMarkdownBlock(block: MarkdownBlock) {
  if (block.type === "heading") {
    const content = renderInlineText(block.text);
    if (block.level === 1) return <h2 id={block.id} key={block.id}>{content}</h2>;
    if (block.level === 2) return <h3 id={block.id} key={block.id}>{content}</h3>;
    if (block.level === 3) return <h4 id={block.id} key={block.id}>{content}</h4>;
    return <h5 id={block.id} key={block.id}>{content}</h5>;
  }

  if (block.type === "code") {
    return (
      <figure className="report-md-code-next" key={`code-${block.lineIndex}`}>
        <figcaption>
          <span>代码片段</span>
          <strong>{block.language || "text"}</strong>
        </figcaption>
        <pre><code>{block.code}</code></pre>
      </figure>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className="report-md-list-next" key={`list-${block.lineIndex}`}>
        {block.items.map((item, index) => <li key={`${block.lineIndex}-${index}`}>{renderInlineText(item)}</li>)}
      </ListTag>
    );
  }

  if (block.type === "quote") {
    return (
      <blockquote className="report-md-quote-next" key={`quote-${block.lineIndex}`}>
        {block.lines.map((line, index) => <p key={`${block.lineIndex}-${index}`}>{renderInlineText(line)}</p>)}
      </blockquote>
    );
  }

  return (
    <p key={`paragraph-${block.lineIndex}`}>
      {renderInlineText(block.lines.join(" "))}
    </p>
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = /^```([\w.+-]*)\s*$/.exec(trimmed);
    if (fence) {
      const startIndex = index;
      const language = fence[1] || "text";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, code: codeLines.join("\n"), lineIndex: startIndex });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const text = heading[2].trim();
      blocks.push({ type: "heading", id: headingId(text, index), level: heading[1].length, text, lineIndex: index });
      index += 1;
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      const startIndex = index;
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const match = /^>\s?(.*)$/.exec(lines[index].trim());
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "quote", lines: quoteLines, lineIndex: startIndex });
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      const startIndex = index;
      const listItems: string[] = [];
      const isOrdered = Boolean(ordered);
      while (index < lines.length) {
        const itemMatch = isOrdered
          ? /^\d+[.)]\s+(.+)$/.exec(lines[index].trim())
          : /^[-*]\s+(.+)$/.exec(lines[index].trim());
        if (!itemMatch) break;
        listItems.push(itemMatch[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items: listItems, lineIndex: startIndex });
      continue;
    }

    const startIndex = index;
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current) break;
      if (/^```/.test(current) || /^(#{1,4})\s+/.test(current) || /^>\s?/.test(current) || /^[-*]\s+/.test(current) || /^\d+[.)]\s+/.test(current)) break;
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraphLines, lineIndex: startIndex });
  }

  return blocks;
}

function renderInlineText(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function headingId(title: string, index: number) {
  return `report-${index}-${slugify(title)}`;
}

function slugify(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return `${Math.abs(hash)}-${value.replace(/\s+/g, "-").slice(0, 24)}`;
}

function sourceLabel(value: string) {
  const labels: Record<string, string> = { local: "本地分析", local_fallback: "本地兜底", llm: "LLM 增强" };
  return labels[value] || value;
}

function typeLabel(value: string) {
  const labels: Record<string, string> = { single: "单文件报告", project: "项目报告", diff: "代码对比", chat: "对话关联" };
  return labels[value] || value;
}

function languageLabel(value: string) {
  return value === "auto" ? "自动识别" : value;
}

function severityLabel(value: string) {
  const labels: Record<string, string> = { high: "高风险", medium: "中风险", low: "低风险", info: "提示" };
  return labels[value] || value;
}

function traceKindLabel(value: string) {
  const labels: Record<string, string> = {
    workspace: "工作区",
    report: "报告",
    finding: "问题",
    card: "卡片",
    chat: "对话",
    daily_log: "日志",
    agent: "行动草稿",
    activity: "活动"
  };
  return labels[value] || value;
}

function traceStatusLabel(value: string) {
  const labels: Record<string, string> = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
    open: "待处理",
    reviewing: "复查中",
    resolved: "已解决",
    ignored: "已忽略",
    new: "未掌握",
    mastered: "已掌握",
    planned: "已计划",
    applied: "已应用",
    partial: "部分应用",
    linked: "已关联",
    recorded: "已记录"
  };
  return labels[value] || value;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function sectionNumberLabel(index: number, level: number) {
  if (level === 1) return `主章 ${index}`;
  if (level === 2) return `小节 ${index}`;
  return `细节 ${index}`;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
