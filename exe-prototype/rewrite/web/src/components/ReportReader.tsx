import {
  ArrowRight,
  BarChart3,
  Bot,
  Clipboard,
  Download,
  FileCode2,
  FileText,
  GraduationCap,
  ListChecks,
  Maximize2,
  MessageSquare,
  Network,
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
  onCreateAgentPlan,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport
}: {
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  onCopy: () => void;
  onExport: (kind: "md" | "html") => void;
  onGenerateCandidates?: () => void;
  onCreateAgentPlan?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [readingProgress, setReadingProgress] = useState(0);
  const readerScrollRef = useRef<HTMLElement | null>(null);
  const headings = useMemo(() => extractHeadings(report?.full_report || ""), [report?.full_report]);
  const risks = report?.risks.slice(0, 6) || [];
  const suggestions = report?.suggestions.slice(0, 5) || [];
  const files = report?.files.slice(0, 8) || [];

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

  function jumpToHeading(id: string) {
    const container = readerScrollRef.current;
    const target = container?.querySelector<HTMLElement>(`#${cssEscape(id)}`);
    if (!container || !target) return;
    const containerTop = container.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    setActiveHeadingId(id);
    container.scrollTo({ top: container.scrollTop + targetTop - containerTop - 18, behavior: "smooth" });
  }

  if (!report) {
    return (
      <article className="report-reader empty">
        <strong>还没有打开报告</strong>
        <span>生成项目分析、代码对比，或从历史报告中打开一份报告后，会在这里进入结构化阅读。</span>
      </article>
    );
  }

  return (
    <article className={fullscreen ? "report-reader is-fullscreen" : "report-reader"}>
      <header className="report-reader-header report-reader-hero-next">
        <div>
          <span>{typeLabel(report.report_type)} / {languageLabel(report.language)} / {sourceLabel(report.analysis_source)}</span>
          <h3>{report.title}</h3>
          <p>{formatTime(report.created_at)} · {report.summary}</p>
          <div className="report-reader-progress-next" aria-label="报告阅读进度">
            <i style={{ width: `${readingProgress}%` }} />
            <strong>{readingProgress}%</strong>
          </div>
        </div>
        <div className="report-reader-actions">
          <button className="icon-button" onClick={onCopy} title="复制报告"><Clipboard size={18} /></button>
          <button className="icon-button" onClick={() => onExport("md")} title="导出 Markdown"><Download size={18} /></button>
          <button className="icon-button" onClick={() => onExport("html")} title="导出 HTML"><FileText size={18} /></button>
          <button className="icon-button" onClick={() => setFullscreen((value) => !value)} title={fullscreen ? "退出全屏阅读" : "全屏阅读"}>
            {fullscreen ? <X size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </header>

      <section className="report-reader-toolbar">
        {onGenerateCandidates && <button className="mini-button" onClick={onGenerateCandidates}><GraduationCap size={16} />生成知识卡片</button>}
        {onOpenFindings && <button className="mini-button" onClick={onOpenFindings}><ShieldAlert size={16} />关联问题清单</button>}
        {onCreateAgentPlan && <button className="mini-button" onClick={onCreateAgentPlan}><Bot size={16} />生成 Agent 计划</button>}
        {onAddDailyLog && <button className="mini-button" onClick={onAddDailyLog}><FileText size={16} />加入每日日志</button>}
        {onChatAboutReport && <button className="mini-button" onClick={onChatAboutReport}><MessageSquare size={16} />围绕报告对话</button>}
      </section>

      <section className="report-reader-meta">
        <Metric icon={<ShieldAlert size={17} />} label="风险等级" value={severityLabel(report.risk_level)} tone={report.risk_level} />
        <Metric icon={<FileCode2 size={17} />} label="文件数量" value={`${report.file_count}`} />
        <Metric icon={<BarChart3 size={17} />} label="总代码行" value={`${report.metrics.total_lines}`} />
        <Metric icon={<ListChecks size={17} />} label="建议数量" value={`${report.metrics.suggestion_count}`} />
      </section>

      <ReportActionBoard
        report={report}
        traceability={traceability}
        onGenerateCandidates={onGenerateCandidates}
        onCreateAgentPlan={onCreateAgentPlan}
        onOpenFindings={onOpenFindings}
        onAddDailyLog={onAddDailyLog}
        onChatAboutReport={onChatAboutReport}
      />

      <ReportInsightDeck report={report} traceability={traceability} headingCount={headings.length} />

      <ReportEvidenceMatrix
        report={report}
        traceability={traceability}
        headingCount={headings.length}
        onGenerateCandidates={onGenerateCandidates}
        onCreateAgentPlan={onCreateAgentPlan}
        onOpenFindings={onOpenFindings}
        onAddDailyLog={onAddDailyLog}
        onChatAboutReport={onChatAboutReport}
      />

      <ReportRiskMap report={report} />

      <section className="report-reader-body report-reader-grid-next">
        <aside className="report-outline report-reader-side-next">
          <section className="report-side-block-next">
            <strong>阅读路线</strong>
            {buildReaderSteps(report, headings.length).map((step) => <p key={step}>{step}</p>)}
          </section>

          <section className="report-side-block-next">
            <strong>报告目录</strong>
            {headings.length === 0 && <span>暂无标题结构</span>}
            {headings.map((heading) => (
              <button
                className={activeHeadingId === heading.id ? "active" : ""}
                key={heading.id}
                onClick={() => jumpToHeading(heading.id)}
                style={{ paddingLeft: `${6 + (heading.level - 1) * 10}px` }}
                type="button"
              >
                {heading.title}
              </button>
            ))}
          </section>

          <section className="report-side-block-next">
            <strong>风险摘录</strong>
            {risks.length ? risks.map((risk) => <p key={risk}>{risk}</p>) : <span>当前报告没有显式风险项。</span>}
          </section>

          <section className="report-side-block-next">
            <strong>文件概览</strong>
            {files.length ? files.map((file) => (
              <button type="button" className="report-file-chip-next" key={file.id} title={file.path}>
                <FileCode2 size={14} />
                <span>{file.path}</span>
                <small>{file.metrics.total_lines} 行 / {file.metrics.risk_count} 风险</small>
              </button>
            )) : <span>此报告没有保存文件明细。</span>}
          </section>
        </aside>

        <main className="report-document-rich report-document-next" ref={readerScrollRef}>
          <ReportSectionRail headings={headings} activeHeadingId={activeHeadingId} onSelect={jumpToHeading} />
          <section className="report-summary-card report-reader-brief-next">
            <div>
              <span><Sparkles size={15} />报告摘要</span>
              <p>{report.summary}</p>
            </div>
            <div className="report-brief-suggestions-next">
              <strong>优先建议</strong>
              {suggestions.length ? suggestions.map((suggestion) => <p key={suggestion}>{suggestion}</p>) : <p>暂无单独建议，可继续查看完整报告正文。</p>}
            </div>
          </section>

          <TraceabilityPanel snapshot={traceability} reportId={report.id} />

          <ReportMarkdownDocument content={report.full_report} />
        </main>
      </section>
    </article>
  );
}

function ReportSectionRail({ headings, activeHeadingId, onSelect }: { headings: ReportHeading[]; activeHeadingId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (headings.length < 2) return null;

  return (
    <div className="report-section-rail-next" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="report-section-bars-next" aria-label="报告章节定位">
        {headings.map((heading, index) => (
          <button
            aria-label={`定位到章节：${heading.title}`}
            className={activeHeadingId === heading.id || (!activeHeadingId && index === 0) ? "active" : ""}
            key={heading.id}
            onClick={() => onSelect(heading.id)}
            style={{ height: `${Math.max(18, 30 - heading.level * 3)}px` }}
            type="button"
          />
        ))}
      </div>
      {open && (
        <div className="report-section-popover-next">
          <strong>章节定位</strong>
          {headings.map((heading, index) => (
            <button
              className={activeHeadingId === heading.id || (!activeHeadingId && index === 0) ? "active" : ""}
              key={`${heading.id}-option`}
              onClick={() => onSelect(heading.id)}
              style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
              type="button"
            >
              <span>{sectionNumberLabel(index + 1, heading.level)}</span>
              <em>{heading.title}</em>
            </button>
          ))}
        </div>
      )}
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
  const closedLoopCount = (counts?.findings || 0) + (counts?.cards || 0) + (counts?.chats || 0) + (counts?.agent_tasks || 0) + (counts?.daily_logs || 0);
  const riskHint = report.metrics.risk_count > 0
    ? `发现 ${report.metrics.risk_count} 个风险点，建议先处理高影响文件。`
    : "暂未发现显式风险，可以重点检查架构一致性和测试覆盖。";
  const fileHint = report.file_count > 1
    ? `覆盖 ${report.file_count} 个文件，适合按文件热区分段阅读。`
    : "单文件报告，适合先读摘要再进入建议和代码片段。";
  const loopHint = closedLoopCount > 0
    ? `已关联 ${closedLoopCount} 个闭环资产，可继续追踪问题、卡片、日志、对话和 Agent 计划。`
    : "还没有形成闭环资产，建议从问题清单或知识卡片开始沉淀。";

  const items = [
    { label: "阅读重点", value: severityLabel(report.risk_level), detail: riskHint, icon: <ShieldAlert size={16} /> },
    { label: "覆盖范围", value: `${report.file_count} 文件`, detail: fileHint, icon: <FileCode2 size={16} /> },
    { label: "文档结构", value: `${headingCount} 节`, detail: headingCount > 0 ? "目录可跳转，适合按章节审查。" : "报告没有 Markdown 标题，建议后续生成结构化报告。", icon: <ListChecks size={16} /> },
    { label: "闭环资产", value: `${closedLoopCount} 项`, detail: loopHint, icon: <Network size={16} /> }
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
  onCreateAgentPlan,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport
}: {
  report: ReportDetail;
  traceability: TraceabilitySnapshot | null;
  headingCount: number;
  onGenerateCandidates?: () => void;
  onCreateAgentPlan?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
}) {
  const counts = traceability?.scope_kind === "report" && traceability.scope_id === report.id ? traceability.counts : null;
  const closedLoopCount = (counts?.findings || 0) + (counts?.cards || 0) + (counts?.chats || 0) + (counts?.agent_tasks || 0) + (counts?.daily_logs || 0);
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
      value: `${closedLoopCount} 项`,
      complete: closedLoopCount > 0,
      detail: closedLoopCount > 0 ? `已关联问题、卡片、对话、日志或 Agent 计划共 ${closedLoopCount} 项。` : "还没有把阅读结果沉淀到问题、卡片、日志、对话或 Agent。"
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
    { label: "围绕报告对话", detail: "追问设计取舍、替代方案和边界条件", icon: <MessageSquare size={15} />, onClick: onChatAboutReport, ready: Boolean(counts?.chats) },
    { label: "生成 Agent 计划", detail: "拆成可确认执行的改进步骤", icon: <Bot size={15} />, onClick: onCreateAgentPlan, ready: Boolean(counts?.agent_tasks) },
    { label: "加入每日日志", detail: "把这次审查写入学习复盘", icon: <FileText size={15} />, onClick: onAddDailyLog, ready: Boolean(counts?.daily_logs) }
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
  onCreateAgentPlan,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport
}: {
  report: ReportDetail;
  traceability: TraceabilitySnapshot | null;
  onGenerateCandidates?: () => void;
  onCreateAgentPlan?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
}) {
  const counts = traceability?.scope_kind === "report" && traceability.scope_id === report.id ? traceability.counts : null;
  const closedLoopCount = (counts?.findings || 0) + (counts?.cards || 0) + (counts?.chats || 0) + (counts?.agent_tasks || 0) + (counts?.daily_logs || 0);
  const actionItems = [
    { key: "findings", label: "问题清单", value: counts?.findings || report.metrics.risk_count, hint: "把风险拆成可跟踪事项", icon: <ShieldAlert size={16} />, onClick: onOpenFindings },
    { key: "cards", label: "知识卡片", value: counts?.cards || 0, hint: "沉淀可复习知识点", icon: <GraduationCap size={16} />, onClick: onGenerateCandidates },
    { key: "chat", label: "围绕报告对话", value: counts?.chats || 0, hint: "继续追问设计与风险", icon: <MessageSquare size={16} />, onClick: onChatAboutReport },
    { key: "agent", label: "Agent 计划", value: counts?.agent_tasks || 0, hint: "生成确认式改进方案", icon: <Bot size={16} />, onClick: onCreateAgentPlan },
    { key: "log", label: "每日日志", value: counts?.daily_logs || 0, hint: "写入学习复盘链路", icon: <FileText size={16} />, onClick: onAddDailyLog }
  ];

  return (
    <section className="report-action-board-next">
      <div className="report-action-board-head-next">
        <div>
          <span><Route size={15} />报告闭环行动台</span>
          <h4>{closedLoopCount > 0 ? "这份报告已经进入本地审查闭环" : "从这份报告启动审查闭环"}</h4>
          <p>围绕当前报告继续推进问题、卡片、对话、Agent 和每日复盘，让阅读结果沉淀成可跟踪资产。</p>
        </div>
        <strong>{closedLoopCount}</strong>
      </div>
      <div className="report-action-lane-next">
        {actionItems.map((item, index) => (
          <button
            className={item.value > 0 ? "has-data" : ""}
            disabled={!item.onClick}
            key={item.key}
            onClick={item.onClick}
            type="button"
          >
            <span>{item.icon}</span>
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
            <em>{item.value}</em>
            {index < actionItems.length - 1 && <ArrowRight className="report-action-arrow-next" size={15} />}
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
      ? `最后按 ${headingCount} 个目录章节沉淀问题、卡片或 Agent 计划。`
      : "最后把可执行事项加入问题、卡片或 Agent 计划。"
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
          <p>把报告、问题、卡片、日志、对话和 Agent 计划放在同一条本地闭环里查看。</p>
        </div>
        <div className="traceability-counts">
          <small>问题 <strong>{snapshot.counts.findings}</strong></small>
          <small>卡片 <strong>{snapshot.counts.cards}</strong></small>
          <small>对话 <strong>{snapshot.counts.chats}</strong></small>
          <small>Agent <strong>{snapshot.counts.agent_tasks}</strong></small>
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
    agent: "Agent",
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
