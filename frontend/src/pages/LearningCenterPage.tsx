import {
  BookOpenText,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  Loader2,
  PenLine,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownDocument } from "../components/MarkdownDocument";
import type { PageKey } from "../components/Sidebar";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";
import { streamPost } from "../lib/stream";
import type { DailyWorkLogCalendarItem, DailyWorkLogItem } from "../types";

export function LearningCenterPage({ onNavigate: _onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const todayKey = useMemo(() => formatDateKey(), []);
  const [days, setDays] = useState<DailyWorkLogCalendarItem[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(() => todayKey.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(() => todayKey);
  const [log, setLog] = useState<DailyWorkLogItem | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [loadingLog, setLoadingLog] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [dateRailCollapsed, setDateRailCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedSlot = useMemo(
    () => days.find((item) => item.date === selectedDate) ?? null,
    [days, selectedDate],
  );

  const activeStats = log?.source_stats ?? selectedSlot?.stats ?? {};
  const hasActivity = Boolean(log?.has_activity ?? selectedSlot?.has_activity);
  const hasLog = Boolean(log?.has_log ?? selectedSlot?.has_log);
  const isFutureDate = selectedDate > todayKey;

  async function loadCalendar() {
    setLoadingCalendar(true);
    setError("");
    try {
      const nextDays = await api.dailyLogCalendarMonth(selectedMonth);
      setDays(nextDays);
      if (!nextDays.some((item) => item.date === selectedDate)) {
        const fallback = nextDays.find((item) => item.date === todayKey) ?? nextDays[0];
        if (fallback) setSelectedDate(fallback.date);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "每日日志日历加载失败");
    } finally {
      setLoadingCalendar(false);
    }
  }

  async function loadLog(date = selectedDate) {
    setLoadingLog(true);
    setError("");
    try {
      const nextLog = await api.dailyLog(date);
      setLog(nextLog);
      setDraftTitle(nextLog.title);
      setDraftContent(nextLog.content_markdown);
      setEditing(false);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "日志详情加载失败");
    } finally {
      setLoadingLog(false);
    }
  }

  async function generateLog() {
    if (isFutureDate) return;
    const previousLog = log;
    const previousTitle = draftTitle;
    const previousContent = draftContent;
    const previousEditing = editing;
    let completed = false;
    let streamError = "";
    setGenerating(true);
    setError("");
    setNotice("");
    setEditing(false);
    setDraftTitle(`${selectedDate} 工作日志`);
    setDraftContent("");
    try {
      await streamPost(`/api/daily-logs/${selectedDate}/generate/stream`, { model: null }, {
        onDelta: (text) => {
          setDraftContent((current) => current + text);
        },
        onDone: (data) => {
          const nextLog = data.item as DailyWorkLogItem | undefined;
          if (!nextLog) return;
          completed = true;
          setLog(nextLog);
          setDraftTitle(nextLog.title);
          setDraftContent(nextLog.content_markdown);
          setEditing(false);
          setNotice("日志已生成。");
          void loadCalendar();
        },
        onError: (message) => {
          streamError = message;
        },
      });
      if (!completed) {
        setLog(previousLog);
        setDraftTitle(previousTitle);
        setDraftContent(previousContent);
        setEditing(previousEditing);
        setError(streamError || "生成日志失败");
      }
    } catch (exc) {
      setLog(previousLog);
      setDraftTitle(previousTitle);
      setDraftContent(previousContent);
      setEditing(previousEditing);
      setError(exc instanceof Error ? exc.message : "生成日志失败");
    } finally {
      setGenerating(false);
    }
  }

  async function saveLog() {
    setError("");
    setNotice("");
    if (!draftContent.trim()) {
      setError("日志正文不能为空。");
      return;
    }
    try {
      const nextLog = await api.updateDailyLog(selectedDate, {
        title: draftTitle,
        content_markdown: draftContent,
      });
      setLog(nextLog);
      setDraftTitle(nextLog.title);
      setDraftContent(nextLog.content_markdown);
      setEditing(false);
      setNotice("日志已保存。");
      await loadCalendar();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "保存日志失败");
    }
  }

  function startManualLog() {
    setDraftTitle(log?.title || `${selectedDate} 日记`);
    setDraftContent(log?.content_markdown || "");
    setEditing(true);
    setNotice("");
    setError("");
  }

  async function copyLog() {
    if (!log?.content_markdown) return;
    await navigator.clipboard.writeText(log.content_markdown);
    setNotice("已复制 Markdown。");
  }

  function changeMonth(delta: number) {
    setSelectedMonth((current) => shiftMonth(current, delta));
  }

  function goToday() {
    setSelectedMonth(todayKey.slice(0, 7));
    setSelectedDate(todayKey);
  }

  useEffect(() => {
    void loadCalendar();
  }, [selectedMonth]);

  useEffect(() => {
    void loadLog(selectedDate);
  }, [selectedDate]);

  return (
    <div className="page-scroll daily-log-page">
      <section className="daily-log-hero">
        <div>
          <span className="learning-kicker"><BookOpenText size={14} /> Daily Journal</span>
          <h2>每日工作日志</h2>
          <p>作为学习闭环的收尾，把报告、追问、Agent 实践、知识卡片和手写记录整理成可回看的开发日记。</p>
        </div>
        <div className="daily-log-hero-actions">
          <button className="btn btn-secondary" onClick={() => changeMonth(-1)} type="button">
            <ChevronLeft size={15} />
            上个月
          </button>
          <button className="btn btn-secondary" onClick={goToday} type="button">
            回到今天
          </button>
          <button className="btn btn-secondary" onClick={() => changeMonth(1)} type="button">
            下个月
            <ChevronRight size={15} />
          </button>
          <button className="btn btn-secondary" onClick={loadCalendar} disabled={loadingCalendar} type="button">
            <RefreshCw className={loadingCalendar ? "animate-spin" : ""} size={15} />
            刷新日期
          </button>
          <button className="btn btn-primary" onClick={generateLog} disabled={generating || !hasActivity || isFutureDate} type="button">
            {generating ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
            {hasLog ? "重新生成" : "生成日志"}
          </button>
        </div>
      </section>

      {error ? <div className="chat-panel-error">{error}</div> : null}
      {notice ? <div className="learning-notice">{notice}</div> : null}

      <div className={["daily-log-layout", dateRailCollapsed ? "daily-log-layout-collapsed" : ""].filter(Boolean).join(" ")}>
        {dateRailCollapsed ? (
          <button
            className="daily-log-spine"
            onClick={() => setDateRailCollapsed(false)}
            type="button"
            aria-label="展开日志日期栏"
            title="展开日志日期栏"
          >
            <span className="daily-log-spine-date">{selectedDate.slice(5)}</span>
            <span className="daily-log-spine-week">{selectedSlot?.weekday ?? ""}</span>
            <span className="daily-log-spine-dots" aria-hidden="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <i key={index} className={index < Math.min(4, selectedSlot?.activity_score ?? 0) ? "lit" : ""} />
              ))}
            </span>
            <ChevronRight size={16} />
          </button>
        ) : (
          <aside className="daily-log-index" aria-label="日志日期索引">
            <div className="daily-log-index-head">
              <span><CalendarDays size={16} /> {formatMonthLabel(selectedMonth)}</span>
              <button className="daily-log-collapse-button" onClick={() => setDateRailCollapsed(true)} type="button" title="收起日期栏" aria-label="收起日期栏">
                <ChevronLeft size={15} />
              </button>
            </div>
            <div className="daily-log-index-list">
              {days.map((item) => {
                const status = item.has_log ? "已记录" : item.has_activity ? "待整理" : "空白";
                const title = item.has_log ? item.title : item.has_activity ? "有记录，待生成" : item.date > todayKey ? "可提前写日记" : "无使用记录";
                const statusClass = item.has_log ? "status-ready" : item.has_activity ? "status-pending" : "status-empty";
                return (
                  <button
                    aria-current={item.date === selectedDate ? "date" : undefined}
                    className={[
                      "daily-log-index-day",
                      item.date === selectedDate ? "active" : "",
                      item.has_activity ? "has-activity" : "empty-day",
                      item.has_log ? "has-log" : "",
                    ].filter(Boolean).join(" ")}
                    key={item.date}
                    onClick={() => setSelectedDate(item.date)}
                    type="button"
                  >
                    <span className="daily-log-index-date">
                      <strong>{item.date.slice(8)}</strong>
                      <span>{item.date.slice(5, 7)}月</span>
                    </span>
                    <span className="daily-log-index-main">
                      <span className="daily-log-index-row">
                        <span className="daily-log-index-week">{item.weekday}</span>
                        <span className={["daily-log-index-status", statusClass].join(" ")}>{status}</span>
                      </span>
                      <span className="daily-log-index-title">{title}</span>
                      <span className="daily-log-index-meta">
                        {(item.stats.reports ?? 0)} 报告 · {(item.stats.messages ?? 0)} 对话 · {(item.stats.agent_tasks ?? 0)} Agent
                      </span>
                    </span>
                    <span className="daily-log-index-energy" aria-hidden="true">
                      {Array.from({ length: 5 }).map((_, dotIndex) => (
                        <i key={dotIndex} className={dotIndex < Math.min(5, item.activity_score) ? "lit" : ""} />
                      ))}
                    </span>
                    <span className="sr-only">{item.date} {item.weekday}，{status}，{title}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        <main className="daily-log-card">
          <div className="daily-log-card-head">
            <div>
              <span>{selectedDate} · {selectedSlot?.weekday ?? ""}</span>
              <h3>{editing ? "编辑日记" : generating ? draftTitle : log?.title || `${selectedDate} 工作日志`}</h3>
            </div>
            <section className="daily-log-head-stats" aria-label="Daily activity stats">
              <span><strong>{activeStats.reports ?? 0}</strong>报告</span>
              <span><strong>{activeStats.messages ?? 0}</strong>对话</span>
              <span><strong>{activeStats.agent_tasks ?? 0}</strong>Agent</span>
              <span><strong>{activeStats.learning_cards ?? 0}</strong>卡片</span>
            </section>
            <div className="daily-log-card-actions">
              {hasLog ? (
                <>
                  <button className="btn btn-secondary" onClick={copyLog} type="button"><Copy size={15} /> 复制</button>
                  {editing ? (
                    <>
                      <button className="btn btn-secondary" onClick={() => loadLog(selectedDate)} type="button">取消</button>
                      <button className="btn btn-primary" onClick={saveLog} type="button"><Save size={15} /> 保存</button>
                    </>
                  ) : (
                    <button className="btn btn-secondary" onClick={() => setEditing(true)} type="button"><Edit3 size={15} /> 编辑</button>
                  )}
                </>
              ) : editing ? (
                <>
                  <button className="btn btn-secondary" onClick={() => loadLog(selectedDate)} type="button">取消</button>
                  <button className="btn btn-primary" onClick={saveLog} type="button"><Save size={15} /> 保存</button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={startManualLog} type="button">
                  <PenLine size={15} /> {hasActivity ? "手动记录" : "写日记"}
                </button>
              )}
            </div>
          </div>

          <section className="daily-log-stats">
            <span><strong>{activeStats.reports ?? 0}</strong>报告</span>
            <span><strong>{activeStats.messages ?? 0}</strong>对话</span>
            <span><strong>{activeStats.agent_tasks ?? 0}</strong>Agent</span>
            <span><strong>{activeStats.learning_cards ?? 0}</strong>卡片</span>
          </section>

          {isFutureDate && !editing ? (
            <div className="learning-notice daily-log-future-note">未来日期可以提前写日记，但暂不支持基于平台活动生成日志。</div>
          ) : null}

          {loadingLog ? (
            <div className="daily-log-empty"><Loader2 className="animate-spin" size={18} /> 正在加载日志...</div>
          ) : generating ? (
            <section className="daily-log-generating-sheet" aria-live="polite">
              {draftContent.trim() ? (
                <article className="daily-log-document daily-log-document-streaming">
                  {renderDailyMarkdown(cleanDailyMarkdown(draftContent), selectedDate)}
                </article>
              ) : (
                <div className="daily-log-empty daily-log-stream-empty">
                  <Loader2 className="animate-spin" size={18} />
                  正在整理当天记录...
                </div>
              )}
            </section>
          ) : editing ? (
            <section className="daily-log-editor-sheet">
              <div className="daily-log-editor-title-row">
                <span>{selectedDate} · {selectedSlot?.weekday ?? ""}</span>
                <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder={`${selectedDate} 日记`} />
              </div>
              <textarea
                ref={editorRef}
                className="daily-log-editor"
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                placeholder="写下今天的学习、想法、问题，或任何值得留住的片段..."
              />
            </section>
          ) : log?.content_markdown ? (
            <article className="daily-log-document">
              {renderDailyMarkdown(log.content_markdown, selectedDate)}
            </article>
          ) : (
            <div className="daily-log-empty">
              <PenLine size={22} />
              {hasActivity ? (
                <>
                  <strong>这一天有使用记录，但还没有生成日志。</strong>
                  <span>可以点击“生成日志”让 LLM 整理，也可以手动写下自己的记录。</span>
                  <div className="daily-log-empty-actions">
                    <button className="btn btn-secondary" onClick={startManualLog} type="button"><PenLine size={15} /> 手动记录</button>
                    <button className="btn btn-primary" onClick={generateLog} disabled={generating || isFutureDate} type="button"><Sparkles size={15} /> 生成日志</button>
                  </div>
                </>
              ) : (
                <>
                  <strong>{isFutureDate ? "这一天还没有到来。" : "这一天是空白日期。"}</strong>
                  <span>没有平台使用记录也没关系，可以把这里当成一本安静的日记。</span>
                  <div className="daily-log-empty-actions">
                    <button className="btn btn-primary" onClick={startManualLog} type="button"><PenLine size={15} /> 写一篇日记</button>
                  </div>
                </>
              )}
            </div>
          )}

          {hasLog ? (
            <footer className="daily-log-footer">
              <span>{log?.model ? `模型：${log.model}` : "手写日记"}</span>
              <span>{log?.updated_at ? `更新：${formatTime(log.updated_at)}` : ""}</span>
            </footer>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function renderDailyMarkdown(content: string, selectedDate: string) {
  const nodes: JSX.Element[] = [];
  let sectionLines: string[] = [];
  let sectionTitle = "";
  let sectionIndex = 0;

  function flushSection() {
    const sectionMarkdown = sectionLines.join("\n").trim();
    if (!sectionTitle && !sectionMarkdown) return;
    nodes.push(
      <section className="daily-log-section-page" key={`section-${sectionIndex}`}>
        {sectionTitle ? <h2>{sectionTitle}</h2> : null}
        <MarkdownDocument content={sectionMarkdown} className="daily-log-markdown" />
      </section>,
    );
    sectionLines = [];
    sectionTitle = "";
    sectionIndex += 1;
  }

  const normalizedContent = cleanDailyMarkdown(content);

  normalizedContent.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith("# ")) {
      flushSection();
      nodes.push(
        <header className="daily-log-document-cover" key={`cover-${index}`}>
          <span>{selectedDate}</span>
          <h1>{line.replace(/^#\s+/, "")}</h1>
        </header>,
      );
      return;
    }
    if (line.startsWith("## ")) {
      flushSection();
      sectionTitle = line.replace(/^##\s+/, "");
      return;
    }
    sectionLines.push(raw);
  });
  flushSection();
  return nodes;
}

function cleanDailyMarkdown(content: string) {
  let text = content.trim();
  for (let index = 0; index < 2; index += 1) {
    const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(text);
    if (!fenced) break;
    text = fenced[1].trim();
  }
  const lines = text.split(/\r?\n/);
  if (/^```(?:markdown|md)?\s*$/i.test(lines[0]?.trim() ?? "")) {
    lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") lines.pop();
    text = lines.join("\n").trim();
  }
  return text;
}

function formatDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year} 年 ${month} 月`;
}
