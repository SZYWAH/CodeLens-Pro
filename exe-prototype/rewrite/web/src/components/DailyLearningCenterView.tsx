import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, Clipboard, Download, Edit3, FileText, GraduationCap, Loader2, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, RefreshCw, Save, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DailyLog, DailySummary, LearningCard, LearningCenterData } from "../types";
import { ProductToolbar } from "./ProductShell";

const collapsedKey = "codelens.logs.collapsed";
type EditorMode = "read" | "edit";
type Confirmation =
  | { kind: "navigate"; date: string }
  | { kind: "regenerate" }
  | { kind: "refresh" }
  | { kind: "discard-edit" };

export function DailyLearningCenterView(props: {
  date: string;
  summary: DailySummary | null;
  logs: DailyLog[];
  center: LearningCenterData | null;
  draft: DailyLog | null;
  busy: boolean;
  onDateChange: (value: string) => Promise<boolean>;
  onGenerate: () => Promise<boolean>;
  onSave: () => Promise<boolean>;
  onStartManual: () => void;
  onCopy: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onRefresh: () => Promise<boolean>;
  onOpenCard: (id: string) => void | Promise<void>;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onOpenLog: (log: DailyLog) => void;
  onDiscardDraft: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(collapsedKey) === "true");
  const [mobileIndex, setMobileIndex] = useState(false);
  const [associationsOpen, setAssociationsOpen] = useState(false);
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>("read");
  const [loadingDate, setLoadingDate] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const confirmActionRef = useRef<HTMLButtonElement | null>(null);

  const calendar = props.center?.calendar || [];
  const reviewCards = props.center?.review_cards || [];
  const savedLog = props.logs.find((log) => log.date === props.date) || null;
  const summary = props.summary || props.center?.today || null;
  const selectedDay = calendar.find((item) => item.date === props.date) || null;
  const historyLogs = useMemo(() => [...props.logs].sort((left, right) => right.date.localeCompare(left.date)), [props.logs]);
  const today = new Date().toISOString().slice(0, 10);
  const isFuture = props.date > today;
  const dirty = Boolean(mode === "edit" && props.draft && (!savedLog || props.draft.title !== savedLog.title || props.draft.content !== savedLog.content));
  const month = props.date.slice(0, 7);
  const activityCount = selectedDay?.activity_count || summary?.activity_count || 0;
  const draftState = props.busy ? "正在处理" : savedLog ? mode === "edit" ? (dirty ? "未保存修改" : "正在编辑") : "已保存" : props.draft ? "草稿" : "未记录";

  useEffect(() => { window.localStorage.setItem(collapsedKey, String(collapsed)); }, [collapsed]);
  useEffect(() => {
    if (props.draft?.date === props.date && !savedLog) setMode("edit");
    if (savedLog && props.draft?.date === props.date && props.draft.title === savedLog.title && props.draft.content === savedLog.content) setMode("read");
  }, [props.date, props.draft?.id, props.draft?.updated_at, savedLog?.id, savedLog?.updated_at]);
  useEffect(() => {
    if (!confirmation) return;
    const frame = window.requestAnimationFrame(() => confirmActionRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmationBusy) {
        event.preventDefault();
        closeConfirmation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmation, confirmationBusy]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirmation) return;
      if (toolbarMoreOpen) {
        event.preventDefault();
        setToolbarMoreOpen(false);
      } else if (associationsOpen) {
        event.preventDefault();
        setAssociationsOpen(false);
      } else if (mobileIndex) {
        event.preventDefault();
        setMobileIndex(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [associationsOpen, confirmation, mobileIndex, toolbarMoreOpen]);

  function closeConfirmation() {
    setConfirmation(null);
    window.requestAnimationFrame(() => restoreFocusRef.current?.focus());
  }

  async function commitDate(value: string) {
    setLoadingDate(value);
    setConfirmation(null);
    try {
      await props.onDateChange(value);
      setMobileIndex(false);
      setAssociationsOpen(false);
    } finally {
      setLoadingDate(null);
    }
  }

  function requestDate(value: string, trigger?: HTMLElement | null) {
    if (props.busy || loadingDate || value === props.date) return;
    if (dirty) {
      restoreFocusRef.current = trigger || null;
      setConfirmation({ kind: "navigate", date: value });
      return;
    }
    void commitDate(value);
  }

  function requestRefresh(trigger?: HTMLElement | null) {
    if (props.busy || loadingDate) return;
    if (dirty) {
      restoreFocusRef.current = trigger || null;
      setConfirmation({ kind: "refresh" });
      return;
    }
    void props.onRefresh();
  }

  function requestGenerate(trigger?: HTMLElement | null) {
    if (props.busy || isFuture) return;
    if (savedLog || dirty) {
      restoreFocusRef.current = trigger || null;
      setConfirmation({ kind: "regenerate" });
      return;
    }
    void generateDraft();
  }

  async function generateDraft() {
    setMode("edit");
    const generated = await props.onGenerate();
    if (!generated && savedLog) setMode("read");
  }

  function discardCurrentDraft() {
    if (savedLog) props.onOpenLog(savedLog);
    else props.onDiscardDraft();
    setMode("read");
  }

  async function confirmAction() {
    if (!confirmation) return;
    setConfirmationBusy(true);
    try {
      if (confirmation.kind === "navigate") {
        const saved = await props.onSave();
        if (saved) await commitDate(confirmation.date);
        return;
      }
      if (confirmation.kind === "regenerate") {
        setConfirmation(null);
        await generateDraft();
        return;
      }
      if (confirmation.kind === "refresh") {
        discardCurrentDraft();
        setConfirmation(null);
        await props.onRefresh();
        return;
      }
      discardCurrentDraft();
      closeConfirmation();
    } finally {
      setConfirmationBusy(false);
    }
  }

  function discardAndContinue() {
    if (!confirmation) return;
    if (confirmation.kind === "navigate") {
      const target = confirmation.date;
      discardCurrentDraft();
      void commitDate(target);
      return;
    }
    if (confirmation.kind === "regenerate") {
      setConfirmation(null);
      void generateDraft();
      return;
    }
    discardCurrentDraft();
    closeConfirmation();
  }

  function changeMonth(delta: number, trigger?: HTMLElement | null) {
    const [year, value] = month.split("-").map(Number);
    const next = new Date(year, value - 1 + delta, 1);
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    requestDate(key === today.slice(0, 7) ? today : `${key}-01`, trigger);
  }

  return <section className={`logs-workspace-v136 ${collapsed ? "is-collapsed" : ""}`}>
    <ProductToolbar>
      <div className="logs-toolbar-context-v136"><span>复盘记录</span><strong>{props.date}</strong><em>{activityCount} 项活动 · {draftState}</em></div>
      <nav className="logs-toolbar-actions-v136">
        {!props.draft && !isFuture && <button className="primary-button" disabled={props.busy} onClick={(event) => requestGenerate(event.currentTarget)} type="button">{props.busy ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}生成草稿</button>}
        {!props.draft && <button disabled={props.busy} onClick={() => { setMode("edit"); props.onStartManual(); }} type="button"><Edit3 size={14} />手动编写</button>}
        {props.draft && mode === "read" && <button className="primary-button" disabled={props.busy} onClick={() => setMode("edit")} type="button"><Edit3 size={14} />编辑</button>}
        {props.draft && mode === "edit" && <button className="primary-button" disabled={props.busy || !props.draft.title.trim()} onClick={() => void props.onSave()} type="button">{props.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存</button>}
        <button className="logs-associations-trigger-v136" onClick={() => setAssociationsOpen(true)} type="button"><BookOpen size={14} />今日关联</button>
        <div className="product-toolbar-overflow-next logs-toolbar-overflow-v136">
          <button aria-expanded={toolbarMoreOpen} aria-label="更多日志操作" onClick={() => setToolbarMoreOpen((value) => !value)} type="button"><MoreHorizontal size={15} /></button>
          {toolbarMoreOpen && <div>
            <button disabled={!props.draft} onClick={() => { setToolbarMoreOpen(false); void props.onCopy(); }} type="button"><Clipboard size={14} />复制 Markdown</button>
            <button disabled={props.busy || !props.draft} onClick={() => { setToolbarMoreOpen(false); void props.onExport(); }} type="button"><Download size={14} />导出 Markdown</button>
          </div>}
        </div>
      </nav>
    </ProductToolbar>

    <button className="logs-mobile-index-v136" onClick={() => setMobileIndex(true)} type="button"><Menu size={15} />选择日期与历史日志</button>
    <div className="logs-layout-v136">
      {mobileIndex && <button className="logs-index-scrim-v136" aria-label="关闭日期索引" onClick={() => setMobileIndex(false)} type="button" />}
      <aside className={`logs-index-v136 ${mobileIndex ? "is-open" : ""}`}>
        <header><div><strong>{collapsed ? props.date.slice(5) : "日期与日志"}</strong>{!collapsed && <span>{historyLogs.length} 篇已保存</span>}</div><button className="logs-mobile-close-v136" aria-label="关闭日期索引" onClick={() => setMobileIndex(false)} type="button"><X size={16} /></button><button className="logs-collapse-v136" aria-label={collapsed ? "展开日期索引" : "收起日期索引"} onClick={() => setCollapsed(!collapsed)} type="button">{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button></header>
        {!collapsed && <>
          <div className="logs-month-v136"><button aria-label="上个月" disabled={Boolean(loadingDate) || props.busy} onClick={(event) => changeMonth(-1, event.currentTarget)} type="button"><ChevronLeft size={15} /></button><strong>{formatMonth(month)}</strong><button aria-label="下个月" disabled={Boolean(loadingDate) || props.busy} onClick={(event) => changeMonth(1, event.currentTarget)} type="button"><ChevronRight size={15} /></button></div>
          <label className="logs-date-input-v136"><CalendarDays size={14} /><input disabled={Boolean(loadingDate) || props.busy} onChange={(event) => requestDate(event.target.value, event.currentTarget)} type="date" value={props.date} /><button disabled={props.date === today || Boolean(loadingDate) || props.busy} onClick={(event) => requestDate(today, event.currentTarget)} type="button">今天</button></label>
          <div className="logs-calendar-v136">{calendar.map((item) => <button aria-current={item.date === props.date ? "date" : undefined} className={item.date === props.date ? "active" : ""} disabled={Boolean(loadingDate) || props.busy} key={item.date} onClick={(event) => requestDate(item.date, event.currentTarget)} title={`${item.activity_count} 项活动`} type="button"><strong>{item.date.slice(8)}</strong><i className={item.has_log ? "has-log" : item.activity_count ? "has-activity" : ""} /></button>)}</div>
          <div className="logs-history-v136"><header><div><strong>历史日志</strong><span>{historyLogs.length} 篇</span></div><button aria-label="刷新日志" disabled={Boolean(loadingDate) || props.busy} onClick={(event) => requestRefresh(event.currentTarget)} type="button"><RefreshCw className={loadingDate ? "spin" : undefined} size={13} /></button></header>{historyLogs.map((log) => <button aria-current={log.date === props.date ? "page" : undefined} className={log.date === props.date ? "active" : ""} disabled={Boolean(loadingDate) || props.busy} key={log.id} onClick={(event) => requestDate(log.date, event.currentTarget)} type="button"><strong>{log.title}</strong><small>{log.date} · {formatTime(log.updated_at)}</small>{loadingDate === log.date && <Loader2 className="spin" size={13} />}</button>)}{!historyLogs.length && <p>暂无已保存日志。</p>}</div>
        </>}
      </aside>

      <main className="log-document-v136" aria-busy={Boolean(loadingDate)}>
        <header className="log-document-head-v136"><div><span>每日复盘</span><strong>{props.date}</strong><p>{isFuture ? "未来日期仅支持手动记录计划。" : activityCount ? `已汇集 ${activityCount} 项本地活动，可整理为一篇复盘。` : "当天没有新增活动，也可以主动沉淀学习记录。"}</p></div><span className={`log-state-badge-v136 ${savedLog ? "saved" : props.draft ? "draft" : "empty"}`}>{draftState}</span></header>
        {summary && <dl className="log-meta-v136"><Meta label="报告" value={summary.report_count} /><Meta label="对话" value={summary.chat_message_count} /><Meta label="问题" value={summary.finding_count} /><Meta label="卡片" value={summary.card_count} /><Meta label="活动" value={summary.activity_count} /></dl>}
        {loadingDate ? <div className="log-loading-v136"><Loader2 className="spin" size={18} /><strong>正在切换到 {loadingDate}</strong><span>同步当天摘要、历史日志与待复习内容。</span></div> : props.draft ? mode === "edit" ? <section className="log-editor-v136"><header><div><strong>编辑日志</strong><span>{dirty ? "有未保存修改" : savedLog ? "与保存版本一致" : "新草稿"}</span></div><button onClick={(event) => { if (dirty) { restoreFocusRef.current = event.currentTarget; setConfirmation({ kind: "discard-edit" }); } else { discardCurrentDraft(); } }} type="button">取消编辑</button></header><label>标题<input onChange={(event) => props.onDraftTitleChange(event.target.value)} value={props.draft.title} /></label><label>Markdown 内容<textarea onChange={(event) => props.onDraftContentChange(event.target.value)} value={props.draft.content} /></label></section> : <article className="log-reader-v136"><header><span>{props.date} · 已保存日志</span><h3>{props.draft.title}</h3><small>最后更新于 {formatTime(props.draft.updated_at)}</small></header><div className="report-document-rich">{props.draft.content.split("\n").map(renderLine)}</div></article> : <div className="log-empty-v136"><div className="log-empty-icon-v136"><FileText size={24} /></div><strong>{isFuture ? "未来日期尚无日志" : activityCount ? "当天活动尚未整理" : "当天暂无日志"}</strong><p>{isFuture ? "可以手动写下计划或预习重点，不会生成活动汇总。" : "从本地活动生成草稿，或从空白日志开始记录。"}</p><div>{!isFuture && <button className="primary-button" onClick={(event) => requestGenerate(event.currentTarget)} type="button"><Sparkles size={14} />生成草稿</button>}<button onClick={() => { setMode("edit"); props.onStartManual(); }} type="button"><Edit3 size={14} />手动编写</button></div></div>}
      </main>
    </div>

    {associationsOpen && <><button className="logs-drawer-scrim-v136" aria-label="关闭今日关联" onClick={() => setAssociationsOpen(false)} type="button" /><aside aria-label="今日关联" className="logs-drawer-v136"><header><div><strong>今日关联</strong><span>{props.date}</span></div><button aria-label="关闭今日关联" onClick={() => setAssociationsOpen(false)} type="button"><X size={17} /></button></header><section><h4>活动摘要</h4><dl><Meta label="报告" value={summary?.report_count || 0} /><Meta label="问题" value={summary?.finding_count || 0} /><Meta label="卡片" value={summary?.card_count || 0} /><Meta label="活动" value={summary?.activity_count || 0} /></dl></section><section><h4>今日亮点</h4>{summary?.highlights?.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}{!summary?.highlights?.length && <p className="muted">暂无亮点记录。</p>}</section><section><h4>待复习卡片</h4>{reviewCards.map((card) => <button className="log-card-link-v136" key={card.id} onClick={() => void props.onOpenCard(card.id)} type="button"><GraduationCap size={14} /><span><strong>{card.title}</strong><small>{cardStatus(card.status)}</small></span></button>)}{!reviewCards.length && <p className="muted">暂无待复习卡片。</p>}</section></aside></>}

    {confirmation && <div className="logs-confirm-layer-v136" role="presentation"><button aria-label="继续编辑" className="logs-confirm-scrim-v136" disabled={confirmationBusy} onClick={closeConfirmation} type="button" /><section aria-labelledby="logs-confirm-title-v136" aria-modal="true" className="logs-confirm-dialog-v136" role="dialog"><header><Edit3 size={18} /><div><strong id="logs-confirm-title-v136">{confirmation.kind === "regenerate" ? "重新生成当天草稿？" : confirmation.kind === "navigate" ? "保存修改后再切换日期？" : confirmation.kind === "refresh" ? "放弃修改并刷新日志？" : "放弃未保存修改？"}</strong><span>{confirmation.kind === "navigate" ? `将从 ${props.date} 切换到 ${confirmation.date}` : "当前编辑内容尚未写入本地日志。"}</span></div></header><p>{confirmation.kind === "regenerate" ? "重新生成会替换当前编辑区中的草稿内容；已保存日志在再次保存前不会被覆盖。" : confirmation.kind === "navigate" ? "可以先保存当前日志，也可以放弃修改后直接切换。" : confirmation.kind === "refresh" ? "刷新会恢复已保存的本地日志，并重新读取当天活动与待复习卡片。" : savedLog ? "将恢复到最近一次保存的日志内容。" : "将放弃当前未保存的草稿。"}</p><footer>{confirmation.kind === "navigate" && <button disabled={confirmationBusy} onClick={discardAndContinue} type="button">放弃修改</button>}<button disabled={confirmationBusy} onClick={closeConfirmation} type="button">继续编辑</button><button className={confirmation.kind === "discard-edit" ? "danger-button" : "primary-button"} disabled={confirmationBusy} onClick={() => void confirmAction()} ref={confirmActionRef} type="button">{confirmationBusy ? <Loader2 className="spin" size={14} /> : null}{confirmation.kind === "navigate" ? "保存后切换" : confirmation.kind === "regenerate" ? "重新生成" : confirmation.kind === "refresh" ? "放弃并刷新" : "放弃修改"}</button></footer></section></div>}
  </section>;
}

function Meta({ label, value }: { label: string; value: number }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function renderLine(line: string, index: number) { const text = line.trim(); if (text.startsWith("# ")) return <h3 key={index}>{text.slice(2)}</h3>; if (text.startsWith("## ")) return <h4 key={index}>{text.slice(3)}</h4>; if (text.startsWith("### ")) return <h5 key={index}>{text.slice(4)}</h5>; if (text.startsWith("- ")) return <p className="doc-list" key={index}>{text}</p>; if (!text) return <div className="doc-gap" key={index} />; return <p key={index}>{line}</p>; }
function formatMonth(value: string) { const [year, month] = value.split("-"); return `${year}年 ${Number(month)}月`; }
function formatTime(value: string) { try { return new Date(value).toLocaleString("zh-CN", { hour12: false }); } catch { return value; } }
function cardStatus(value: string) { return ({ new: "未掌握", reviewing: "复习中", mastered: "已掌握" } as Record<string, string>)[value] || value; }
