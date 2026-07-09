import { Bot, CalendarPlus, CheckCircle2, ClipboardList, FileWarning, GraduationCap, Loader2, MessageSquare, Route, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { Finding } from "../types";
import { severityLabel } from "../utils/display";

export function FindingsView(props: {
  findings: Finding[];
  status: string;
  severity: string;
  linkedReportTitle: string | null;
  busy: boolean;
  onStatusFilter: (value: string) => void;
  onSeverityFilter: (value: string) => void;
  onClearReportLink: () => void;
  onUpdate: (id: string, status: string) => void;
  onCreateCards: (ids?: string[]) => void;
  onCreateAgentPlan: (finding: Finding) => void;
  onChatAboutFinding: (finding: Finding) => void;
  onAddDailyLog: (finding: Finding) => void;
}) {
  const stats = useMemo(() => buildFindingStats(props.findings), [props.findings]);
  const fileGroups = useMemo(() => buildFileGroups(props.findings), [props.findings]);
  const categoryGroups = useMemo(() => buildCategoryGroups(props.findings), [props.findings]);
  const queue = useMemo(
    () => props.findings
      .filter((finding) => finding.status !== "resolved" && finding.status !== "ignored")
      .sort(compareFindingPriority)
      .slice(0, 5),
    [props.findings]
  );

  return (
    <section className="findings-page-next">
      <div className="findings-hero-next">
        <div>
          <span>项目审查闭环</span>
          <h3>问题清单</h3>
          <p>把报告中的风险拆成可筛选、可复查、可沉淀、可交给 Agent 规划的本地审查事项。</p>
        </div>
        <div className="findings-hero-actions-next">
          <button className="primary-button" onClick={() => props.onCreateCards()} disabled={props.busy || props.findings.length === 0}>
            {props.busy ? <Loader2 className="spin" size={18} /> : <GraduationCap size={18} />}
            批量生成卡片
          </button>
        </div>
      </div>

      <section className="findings-dashboard-next">
        <FindingMetric icon={<ClipboardList size={16} />} label="当前问题" value={`${stats.total}`} detail={`待处理 ${stats.open} / 复查中 ${stats.reviewing}`} />
        <FindingMetric icon={<ShieldAlert size={16} />} label="高风险" value={`${stats.high}`} detail={`中风险 ${stats.medium} / 低风险 ${stats.low}`} tone="danger" />
        <FindingMetric icon={<FileWarning size={16} />} label="影响文件" value={`${fileGroups.length}`} detail={fileGroups[0] ? `最热：${fileGroups[0].path}` : "等待项目分析"} />
        <FindingMetric icon={<CheckCircle2 size={16} />} label="已闭环" value={`${stats.resolved}`} detail={`忽略 ${stats.ignored} / 闭环率 ${stats.doneRate}%`} tone="success" />
      </section>

      <section className="findings-flow-next" aria-label="问题处理流程">
        {[
          ["1", "定位问题", "按报告、严重程度、文件路径确认影响面。"],
          ["2", "复查证据", "把误报、真实风险和待验证项区分开。"],
          ["3", "沉淀知识", "生成知识卡片、加入每日日志。"],
          ["4", "进入 Agent", "生成可确认执行的修复计划和补丁说明。"]
        ].map(([step, title, detail]) => (
          <article key={step}>
            <span>{step}</span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      <div className="findings-toolbar-next">
        {props.linkedReportTitle && (
          <div className="notice neutral">
            <ShieldAlert size={18} />
            当前只显示报告《{props.linkedReportTitle}》关联的问题。
            <button className="mini-button" type="button" onClick={props.onClearReportLink}>查看全部问题</button>
          </div>
        )}
        <div className="three-fields">
          <label>
            状态
            <select value={props.status} onChange={(event) => props.onStatusFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="open">待处理</option>
              <option value="reviewing">复查中</option>
              <option value="resolved">已解决</option>
              <option value="ignored">已忽略</option>
            </select>
          </label>
          <label>
            严重程度
            <select value={props.severity} onChange={(event) => props.onSeverityFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <div className="button-row end">
            <button className="primary-button" onClick={() => props.onCreateCards()} disabled={props.busy || props.findings.length === 0}>
              {props.busy ? <Loader2 className="spin" size={18} /> : <GraduationCap size={18} />}
              生成卡片
            </button>
          </div>
        </div>
      </div>

      <section className="findings-grid-next">
        <div className="findings-main-list-next">
          {props.findings.map((finding) => (
            <article className={`finding-row-next ${finding.status}`} key={finding.id}>
              <div className="finding-row-head-next">
                <div>
                  <div className="tag-row">
                    <span className={`risk-tag ${finding.severity}`}>{severityLabel(finding.severity)}</span>
                    <span>{categoryLabel(finding.category)}</span>
                    <span>{findingStatusLabel(finding.status)}</span>
                  </div>
                  <h3>{finding.title}</h3>
                </div>
                <span className="finding-date-next">{formatShortDate(finding.updated_at || finding.created_at)}</span>
              </div>
              <p>{finding.detail}</p>
              <div className="finding-location-next">
                <code>{finding.file_path || "未关联文件"}</code>
                {finding.line_start ? <span>第 {finding.line_start}{finding.line_end && finding.line_end !== finding.line_start ? `-${finding.line_end}` : ""} 行</span> : <span>未记录行号</span>}
              </div>
              <div className="finding-suggestion-next">
                <strong>建议处理</strong>
                <p>{finding.suggestion || "先复查影响范围，再决定是否生成修复计划。"}</p>
              </div>
              <div className="finding-actions-next">
                <button className="mini-button" onClick={() => props.onUpdate(finding.id, "reviewing")}>标记复查</button>
                <button className="mini-button" onClick={() => props.onUpdate(finding.id, "resolved")}>标记解决</button>
                <button className="mini-button" onClick={() => props.onUpdate(finding.id, "ignored")}>忽略</button>
                <button className="mini-button" onClick={() => props.onCreateCards([finding.id])}><GraduationCap size={15} />生成卡片</button>
                <button className="mini-button" onClick={() => props.onChatAboutFinding(finding)}><MessageSquare size={15} />追问</button>
                <button className="mini-button" onClick={() => props.onCreateAgentPlan(finding)}><Bot size={15} />Agent 计划</button>
                <button className="mini-button" onClick={() => props.onAddDailyLog(finding)}><CalendarPlus size={15} />加入日志</button>
              </div>
            </article>
          ))}
          {props.findings.length === 0 && <div className="empty">当前筛选条件下暂无问题。</div>}
        </div>

        <aside className="findings-side-next">
          <section>
            <div className="section-title-next">
              <span><Route size={15} />优先处理队列</span>
              <small>{queue.length} 项</small>
            </div>
            <div className="finding-queue-next">
              {queue.map((finding, index) => (
                <button key={finding.id} onClick={() => props.onChatAboutFinding(finding)} type="button">
                  <span>{index + 1}</span>
                  <strong>{finding.title}</strong>
                  <small>{severityLabel(finding.severity)} · {finding.file_path || "未关联文件"}</small>
                </button>
              ))}
              {queue.length === 0 && <p className="muted">暂无待处理问题。</p>}
            </div>
          </section>

          <section>
            <div className="section-title-next">
              <span><FileWarning size={15} />文件影响面</span>
              <small>{fileGroups.length} 个文件</small>
            </div>
            <div className="finding-file-groups-next">
              {fileGroups.slice(0, 8).map((item) => (
                <p key={item.path}>
                  <code>{item.path}</code>
                  <span>{item.count} 个问题 · 高风险 {item.high}</span>
                </p>
              ))}
              {fileGroups.length === 0 && <p className="muted">生成项目报告后会显示文件影响面。</p>}
            </div>
          </section>

          <section>
            <div className="section-title-next">
              <span><ShieldAlert size={15} />类别分布</span>
              <small>{categoryGroups.length} 类</small>
            </div>
            <div className="finding-category-bars-next">
              {categoryGroups.map((item) => (
                <div key={item.category}>
                  <span>{categoryLabel(item.category)}</span>
                  <strong>{item.count}</strong>
                  <i style={{ width: `${Math.max(8, Math.round((item.count / Math.max(1, stats.total)) * 100))}%` }} />
                </div>
              ))}
              {categoryGroups.length === 0 && <p className="muted">暂无类别数据。</p>}
            </div>
          </section>
        </aside>
      </section>
    </section>
  );
}

function FindingMetric({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone?: "danger" | "success" }) {
  return (
    <article className={tone || ""}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function buildFindingStats(findings: Finding[]) {
  const stats = findings.reduce(
    (next, finding) => {
      next.total += 1;
      if (finding.severity === "high") next.high += 1;
      if (finding.severity === "medium") next.medium += 1;
      if (finding.severity === "low") next.low += 1;
      if (finding.status === "open") next.open += 1;
      if (finding.status === "reviewing") next.reviewing += 1;
      if (finding.status === "resolved") next.resolved += 1;
      if (finding.status === "ignored") next.ignored += 1;
      return next;
    },
    { total: 0, high: 0, medium: 0, low: 0, open: 0, reviewing: 0, resolved: 0, ignored: 0 }
  );
  return {
    ...stats,
    doneRate: stats.total ? Math.round(((stats.resolved + stats.ignored) / stats.total) * 100) : 0
  };
}

function buildFileGroups(findings: Finding[]) {
  const map = new Map<string, { path: string; count: number; high: number }>();
  for (const finding of findings) {
    const path = finding.file_path || "未关联文件";
    const item = map.get(path) || { path, count: 0, high: 0 };
    item.count += 1;
    if (finding.severity === "high") item.high += 1;
    map.set(path, item);
  }
  return Array.from(map.values()).sort((a, b) => b.high - a.high || b.count - a.count || a.path.localeCompare(b.path));
}

function buildCategoryGroups(findings: Finding[]) {
  const map = new Map<string, number>();
  for (const finding of findings) {
    map.set(finding.category, (map.get(finding.category) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function compareFindingPriority(a: Finding, b: Finding) {
  const severityScore: Record<string, number> = { high: 3, medium: 2, low: 1, info: 0 };
  const statusScore: Record<string, number> = { open: 2, reviewing: 1, resolved: 0, ignored: 0 };
  return (severityScore[b.severity] || 0) - (severityScore[a.severity] || 0)
    || (statusScore[b.status] || 0) - (statusScore[a.status] || 0)
    || new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    security: "安全",
    quality: "质量",
    reliability: "可靠性",
    maintainability: "可维护性"
  };
  return labels[value] || value;
}

function findingStatusLabel(value: string) {
  const labels: Record<string, string> = {
    open: "待处理",
    reviewing: "复查中",
    resolved: "已解决",
    ignored: "已忽略"
  };
  return labels[value] || value;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "暂无时间";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}
