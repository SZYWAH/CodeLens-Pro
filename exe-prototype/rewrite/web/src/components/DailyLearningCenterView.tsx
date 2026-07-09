import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Clock3,
  Download,
  Edit3,
  FileText,
  GraduationCap,
  Layers3,
  Loader2,
  RefreshCw,
  Save,
  Sparkles
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { AgentTask, DailyLog, DailySummary, LearningCalendarItem, LearningCard, LearningCenterData } from "../types";

export function DailyLearningCenterView(props: {
  date: string;
  summary: DailySummary | null;
  logs: DailyLog[];
  center: LearningCenterData | null;
  draft: DailyLog | null;
  busy: boolean;
  onDateChange: (value: string) => void;
  onGenerate: () => void;
  onSave: () => void;
  onStartManual: () => void;
  onCopy: () => void;
  onExport: () => void;
  onRefresh: () => void;
  onOpenCard: (id: string) => void;
  onOpenAgent: (id: string) => void;
  onDraftTitleChange: (value: string) => void;
  onDraftContentChange: (value: string) => void;
  onOpenLog: (log: DailyLog) => void;
}) {
  const [dateRailCollapsed, setDateRailCollapsed] = useState(false);
  const reviewCards = props.center?.review_cards || [];
  const recentTasks = props.center?.recent_agent_tasks || [];
  const calendar = props.center?.calendar || [];
  const selectedDay = calendar.find((item) => item.date === props.date) || null;
  const monthStats = buildMonthStats(calendar);
  const summary = props.summary || props.center?.today || null;
  const focusItems = buildFocusItems(summary, reviewCards, recentTasks);
  const selectedMonth = props.date.slice(0, 7);
  const todayKey = new Date().toISOString().slice(0, 10);
  const isFutureDate = props.date > todayKey;
  const hasActivity = Boolean((summary?.activity_count || 0) > 0 || selectedDay?.activity_count);
  const savedLog = props.logs.find((log) => log.date === props.date) || null;

  function changeMonth(delta: number) {
    const [year, month] = selectedMonth.split("-").map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    props.onDateChange(key === todayKey.slice(0, 7) ? todayKey : `${key}-01`);
  }

  return (
    <section className="learning-center-next">
      {dateRailCollapsed ? (
        <button className="daily-log-spine-next" onClick={() => setDateRailCollapsed(false)} type="button" title="展开日期栏">
          <strong>{props.date.slice(5)}</strong>
          <span>{selectedDay?.activity_count || summary?.activity_count || 0} 活动</span>
          <ChevronRight size={16} />
        </button>
      ) : (
        <aside className="learning-rail-next">
          <div className="learning-hero-next">
            <span>每日学习</span>
            <h3>每日学习中心</h3>
            <p>把当天报告、对话、问题、卡片和 Agent 计划整理成可复盘的开发日记，让项目审查进入长期学习闭环。</p>
          </div>

          <section className="daily-month-control-next">
            <button className="mini-button" onClick={() => changeMonth(-1)} type="button"><ChevronLeft size={15} />上个月</button>
            <strong>{formatMonthLabel(selectedMonth)}</strong>
            <button className="mini-button" onClick={() => changeMonth(1)} type="button">下个月<ChevronRight size={15} /></button>
          </section>

          <section className="learning-date-card-next">
            <label>
              日期
              <input type="date" value={props.date} onChange={(event) => props.onDateChange(event.target.value)} />
            </label>
            <div className="button-row wrap">
              <button className="secondary-button" type="button" onClick={() => props.onDateChange(todayKey)}>回到今天</button>
              <button className="secondary-button" type="button" onClick={props.onRefresh}>
                <RefreshCw size={16} />
                刷新
              </button>
            </div>
            <button className="primary-button full" onClick={props.onGenerate} disabled={props.busy || isFutureDate}>
              {props.busy ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              {savedLog ? "重新生成草稿" : "生成日志草稿"}
            </button>
            <button className="secondary-button full" onClick={props.onStartManual} type="button">
              <Edit3 size={16} />
              手动写日志
            </button>
            <div className="learning-day-summary-next">
              <span>{savedLog ? "已保存日志" : hasActivity ? "待整理" : "等待活动"}</span>
              <strong>{selectedDay?.activity_count || summary?.activity_count || 0}</strong>
              <small>当天活动</small>
            </div>
          </section>

          <section className="learning-calendar-next">
            <div className="section-title-next">
              <span><CalendarDays size={15} />活动日历</span>
              <h3>本月学习轨迹</h3>
            </div>
            <div className="learning-month-strip-next">
              <small>活跃天数 <strong>{monthStats.activeDays}</strong></small>
              <small>日志天数 <strong>{monthStats.logDays}</strong></small>
              <small>总活动 <strong>{monthStats.totalActivity}</strong></small>
            </div>
            <div className="calendar-grid calendar-grid-rich-next">
              {calendar.map((item) => {
                const activityLevel = Math.min(4, item.activity_count);
                return (
                  <button className={item.date === props.date ? "calendar-day active" : "calendar-day"} key={item.date} onClick={() => props.onDateChange(item.date)} type="button">
                    <strong>{item.date.slice(8)}</strong>
                    <span>{item.has_log ? "已记录" : item.activity_count ? "待整理" : "空白"}</span>
                    <i>{item.report_count} 报告 · {item.card_count} 卡片</i>
                    <em aria-hidden="true">
                      {Array.from({ length: 4 }).map((_, index) => <b key={index} className={index < activityLevel ? "lit" : ""} />)}
                    </em>
                  </button>
                );
              })}
              {calendar.length === 0 && <p className="muted">暂无日历数据。</p>}
            </div>
          </section>

          <section className="learning-log-list-next">
            <div className="section-title-next">
              <span>历史日志</span>
              <h3>已保存复盘</h3>
            </div>
            <div className="report-list">
              {props.logs.map((log) => (
                <article className={log.date === props.date ? "report-row active" : "report-row"} key={log.id}>
                  <button className="report-main" onClick={() => props.onOpenLog(log)} type="button">
                    <strong>{log.title}</strong>
                    <span>{log.date} · {formatTime(log.updated_at)}</span>
                    <p>{log.content.slice(0, 120)}</p>
                  </button>
                </article>
              ))}
              {props.logs.length === 0 && <div className="empty small">暂无已保存日志。</div>}
            </div>
          </section>

          <button className="daily-log-collapse-next" onClick={() => setDateRailCollapsed(true)} type="button">
            <ChevronLeft size={15} />
            收起日期栏
          </button>
        </aside>
      )}

      <main className="learning-main-next">
        <section className="daily-main-hero-next">
          <div>
            <span>学习闭环</span>
            <h3>{props.date} 复盘工作台</h3>
            <p>{isFutureDate ? "这是未来日期，可以提前手写计划，但不会生成活动汇总。" : "从活动汇总、复习队列和 Agent 计划生成可长期回看的学习日志。"}</p>
          </div>
          <div className="button-row wrap">
            <button className="secondary-button" onClick={props.onCopy} disabled={!props.draft} type="button">
              <Clipboard size={16} />
              复制 Markdown
            </button>
            <button className="secondary-button" onClick={props.onExport} disabled={props.busy} type="button">
              <Download size={16} />
              导出日志
            </button>
            <button className="primary-button" onClick={props.onSave} disabled={props.busy || !props.draft} type="button">
              <Save size={18} />
              保存日志
            </button>
          </div>
        </section>

        {summary && (
          <div className="learning-metrics-next">
            <Metric label="报告" value={summary.report_count} />
            <Metric label="对话" value={summary.chat_message_count} />
            <Metric label="问题" value={summary.finding_count} />
            <Metric label="卡片" value={summary.card_count} />
            <Metric label="Agent" value={summary.agent_task_count} />
            <Metric label="活动" value={summary.activity_count} />
          </div>
        )}

        <section className="daily-flow-next">
          {focusItems.map((item, index) => (
            <article className={item.done ? "done" : ""} key={item.title}>
              <span>{item.icon}</span>
              <strong>{index + 1}. {item.title}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </section>

        <section className="daily-editor-next">
          <div className="report-head">
            <div>
              <h3>{props.draft ? "编辑学习日志" : "学习日志草稿"}</h3>
              <p>草稿可以继续编辑，再保存到本地 SQLite。日志会与报告、卡片、对话、问题和 Agent 计划一起进入活动星图。</p>
            </div>
            <div className="daily-editor-state-next">
              <span>{savedLog ? "已有保存版本" : "未保存"}</span>
              <strong>{props.draft ? `${props.draft.content.length} 字符` : "等待草稿"}</strong>
            </div>
          </div>
          {props.draft ? (
            <>
              <label>
                标题
                <input value={props.draft.title} onChange={(event) => props.onDraftTitleChange(event.target.value)} />
              </label>
              <label>
                内容
                <textarea value={props.draft.content} onChange={(event) => props.onDraftContentChange(event.target.value)} />
              </label>
            </>
          ) : (
            <div className="workbench-empty-next compact">
              <FileText size={34} />
              <h3>还没有日志草稿</h3>
              <p>点击“生成日志草稿”或“手动写日志”，系统会把当天活动整理成可编辑内容。</p>
            </div>
          )}
        </section>

        <div className="learning-side-grid-next">
          <ListPanel title="今日亮点" icon={<Sparkles size={16} />} items={summary?.highlights || []} />
          <CardReviewPanel cards={reviewCards} onOpenCard={props.onOpenCard} />
          <AgentReviewPanel tasks={recentTasks} onOpenAgent={props.onOpenAgent} />
        </div>
      </main>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ListPanel({ title, icon, items }: { title: string; icon: ReactNode; items: string[] }) {
  return (
    <article className="v04-panel daily-panel-next">
      <h3>{icon}{title}</h3>
      <div className="simple-list">
        {items.map((item, index) => <p key={`${item}-${index}`}>{item}</p>)}
        {items.length === 0 && <p className="muted">暂无条目。</p>}
      </div>
    </article>
  );
}

function CardReviewPanel({ cards, onOpenCard }: { cards: LearningCard[]; onOpenCard: (id: string) => void }) {
  return (
    <article className="v04-panel daily-panel-next">
      <h3><GraduationCap size={16} />待复习卡片</h3>
      <div className="simple-list">
        {cards.slice(0, 8).map((card) => (
          <button className="daily-link-row-next" key={card.id} onClick={() => onOpenCard(card.id)} type="button">
            <strong>{cardStatusLabel(card.status)}</strong>
            <span>{card.title}</span>
          </button>
        ))}
        {cards.length === 0 && <p className="muted">暂无待复习卡片。</p>}
      </div>
    </article>
  );
}

function AgentReviewPanel({ tasks, onOpenAgent }: { tasks: AgentTask[]; onOpenAgent: (id: string) => void }) {
  return (
    <article className="v04-panel daily-panel-next">
      <h3><Bot size={16} />近期 Agent 计划</h3>
      <div className="simple-list">
        {tasks.slice(0, 8).map((task) => (
          <button className="daily-link-row-next" key={task.id} onClick={() => onOpenAgent(task.id)} type="button">
            <strong>{taskStatusLabel(task.status)}</strong>
            <span>{task.title}</span>
          </button>
        ))}
        {tasks.length === 0 && <p className="muted">暂无近期 Agent 计划。</p>}
      </div>
    </article>
  );
}

function buildMonthStats(calendar: LearningCalendarItem[]) {
  return calendar.reduce(
    (acc, item) => ({
      activeDays: acc.activeDays + (item.activity_count > 0 ? 1 : 0),
      logDays: acc.logDays + (item.has_log ? 1 : 0),
      totalActivity: acc.totalActivity + item.activity_count
    }),
    { activeDays: 0, logDays: 0, totalActivity: 0 }
  );
}

function buildFocusItems(summary: DailySummary | null, reviewCards: LearningCard[], tasks: AgentTask[]) {
  const reportCount = summary?.report_count || 0;
  const findingCount = summary?.finding_count || 0;
  const cardCount = summary?.card_count || 0;
  const agentCount = summary?.agent_task_count || 0;
  return [
    {
      icon: <FileText size={16} />,
      title: "分析输入",
      detail: reportCount ? `今天产生 ${reportCount} 份报告。` : "还没有报告输入，先完成一次项目分析或代码对比。",
      done: reportCount > 0
    },
    {
      icon: <Layers3 size={16} />,
      title: "问题复盘",
      detail: findingCount ? `今天沉淀 ${findingCount} 个问题。` : "把报告中的风险拆成问题清单，便于追踪。",
      done: findingCount > 0
    },
    {
      icon: <GraduationCap size={16} />,
      title: "学习沉淀",
      detail: cardCount || reviewCards.length ? `今日卡片 ${cardCount} 张，待复习 ${reviewCards.length} 张。` : "从问题或报告生成知识卡片。",
      done: cardCount > 0 || reviewCards.length > 0
    },
    {
      icon: <CheckCircle2 size={16} />,
      title: "改进计划",
      detail: agentCount || tasks.length ? `今日 Agent ${agentCount} 个，近期计划 ${tasks.length} 个。` : "把关键问题转成可确认执行的 Agent 计划。",
      done: agentCount > 0 || tasks.length > 0
    }
  ];
}

function cardStatusLabel(value: string) {
  const map: Record<string, string> = {
    new: "未掌握",
    reviewing: "复习中",
    mastered: "已掌握"
  };
  return map[value] || value;
}

function taskStatusLabel(value: string) {
  const map: Record<string, string> = {
    planned: "已计划",
    pending: "待确认",
    applied: "已应用",
    failed: "失败",
    partial: "部分应用"
  };
  return map[value] || value;
}

function formatTime(value: string) {
  if (!value) return "暂无";
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return value;
  }
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year} 年 ${Number(month)} 月`;
}
