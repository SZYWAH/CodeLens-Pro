import {
  Archive,
  BarChart3,
  CheckCircle2,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  KeyRound,
  Layers3,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload
} from "lucide-react";
import type { ReactNode } from "react";
import type { ActivityEvent, ActivitySummary, AppHealth } from "../types";
import { formatTime } from "../utils/display";

type AssetStat = {
  key: string;
  label: string;
  value: number;
  detail: string;
};

export function HealthStatusView({
  activity,
  busy,
  health,
  onExportArchive,
  onImportArchive,
  onOpenStorage,
  onOpenLogs
}: {
  activity: ActivitySummary | null;
  busy: boolean;
  health: AppHealth;
  onExportArchive: () => void;
  onImportArchive: () => void;
  onOpenStorage: () => void;
  onOpenLogs: () => void;
}) {
  const assetStats = buildAssetStats(activity);
  const localAssetCount = assetStats.reduce((sum, item) => sum + item.value, 0);
  const trendDays = buildTrendDays(activity?.daily_counts || []);
  const recentActivityCount = trendDays.reduce((sum, item) => sum + item.count, 0);
  const eventDistribution = buildEventDistribution(activity?.recent_events || []);
  const maturity = buildMaturityScore(health, activity, recentActivityCount);
  const llmStatus = health.llm_enabled ? (health.llm_configured ? "已启用并已配置" : "已启用，缺少 API Key") : "未启用";

  return (
    <section className="health-page-next">
      <section className="health-command-center-next">
        <div>
          <span className="health-kicker-next">本地运行状态</span>
          <h3>把环境、数据、闭环成熟度放在同一个控制台里</h3>
          <p>
            这里不只是健康检查，而是 CodeLens Pro Next 的本地数据驾驶舱：确认 SQLite、模型配置、活动积累、
            本地档案和长期使用准备度。
          </p>
        </div>
        <div className="health-score-card-next">
          <span>闭环成熟度</span>
          <strong>{maturity.score}%</strong>
          <div className="health-score-track-next">
            <i style={{ width: `${maturity.score}%` }} />
          </div>
          <p>{maturity.message}</p>
        </div>
      </section>

      <div className="health-overview-next">
        <HealthItem icon={<Database size={20} />} label="SQLite" value={health.database_message} ok={health.database_ok} />
        <HealthItem icon={<KeyRound size={20} />} label="LLM" value={llmStatus} ok={!health.llm_enabled || health.llm_configured} />
        <InfoBlock label="版本" value={health.version} />
      </div>

      <section className="health-readiness-next">
        <ReadinessCard icon={<ShieldCheck size={17} />} title="本地可用性" value={health.database_ok ? "正常" : "需要检查"} detail="SQLite 正常时，报告、卡片、日志、对话和 Agent 任务都能持久化。" />
        <ReadinessCard icon={<HardDrive size={17} />} title="本地资产" value={`${localAssetCount}`} detail="统计报告、工作区、问题、卡片、对话和 Agent 任务。" />
        <ReadinessCard icon={<BarChart3 size={17} />} title="近 14 天活动" value={`${recentActivityCount}`} detail="来自本地 activity_events 聚合，不依赖云端服务。" />
        <ReadinessCard icon={<Archive size={17} />} title="迁移能力" value="可导出" detail="本地档案包含 index.md 与 manifest.json，不包含 API Key 明文。" />
      </section>

      <section className="health-analytics-grid-next">
        <TrendPanel days={trendDays} />
        <DistributionPanel title="主线数据分布" subtitle="衡量工作闭环是否已经沉淀真实资产" items={assetStats.map((item) => ({ label: item.label, value: item.value, detail: item.detail }))} />
        <DistributionPanel title="活动类型分布" subtitle="最近活动在分析、学习、对话和 Agent 之间的占比" items={eventDistribution} />
      </section>

      <section className="local-data-stats-next">
        {assetStats.map((item) => (
          <Metric key={item.key} label={item.label} value={item.value} detail={item.detail} />
        ))}
      </section>

      <section className="health-checklist-next">
        {maturity.checks.map((item) => (
          <article key={item.label} className={item.ok ? "ok" : "warn"}>
            <CheckCircle2 size={18} />
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="health-grid health-storage-map-next">
        <InfoBlock label="应用目录" value={health.app_home} actionLabel="打开存储" onAction={onOpenStorage} />
        <InfoBlock label="存储目录" value={health.storage_dir} actionLabel="打开" onAction={onOpenStorage} />
        <InfoBlock label="日志目录" value={health.logs_dir} actionLabel="打开" onAction={onOpenLogs} />
        <InfoBlock label="数据库路径" value={health.database_path} />
      </section>

      <section className="archive-export-panel-next">
        <div>
          <span>本地档案</span>
          <h3>导出可阅读、可迁移的本地数据快照</h3>
          <p>
            生成 index.md 和 manifest.json，包含报告、工作区、问题、卡片、日志、对话、Agent 计划、活动摘要和关联洞察；
            API Key 只保留“是否配置”的状态，不写入明文。
          </p>
          <div className="archive-checks-next">
            {archiveChecklist(assetStats).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
        <div className="archive-actions-next">
          <button className="primary-button" onClick={onExportArchive} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <FileText size={18} />}
            导出本地档案
          </button>
          <button className="ghost-button" onClick={onImportArchive} disabled={busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
            导入本地档案
          </button>
        </div>
      </section>

      <section className="health-bottom-grid-next">
        <ListPanel title="最近本地活动" events={activity?.recent_events.slice(0, 8) || []} />
        <DiagnosticPanel health={health} activity={activity} recentActivityCount={recentActivityCount} />
      </section>
    </section>
  );
}

function TrendPanel({ days }: { days: { date: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((item) => item.count));

  return (
    <article className="health-panel-next trend-panel-next">
      <div className="health-panel-title-next">
        <span><BarChart3 size={16} />近 14 天活跃趋势</span>
        <small>报告、对话、卡片、日志和 Agent 操作都会沉淀为本地活动</small>
      </div>
      <div className="health-trend-bars-next">
        {days.map((item) => (
          <div key={item.date} className={item.count > 0 ? "active" : ""} title={`${item.date}：${item.count} 次活动`}>
            <i style={{ height: `${Math.max(8, (item.count / max) * 100)}%` }} />
            <span>{item.date.slice(5)}</span>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function DistributionPanel({
  title,
  subtitle,
  items
}: {
  title: string;
  subtitle: string;
  items: { label: string; value: number; detail?: string }[];
}) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <article className="health-panel-next distribution-panel-next">
      <div className="health-panel-title-next">
        <span><Layers3 size={16} />{title}</span>
        <small>{subtitle}</small>
      </div>
      <div className="health-distribution-list-next">
        {items.map((item) => (
          <div key={item.label}>
            <header>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </header>
            <div className="health-bar-track-next">
              <i style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }} />
            </div>
            {item.detail && <small>{item.detail}</small>}
          </div>
        ))}
      </div>
    </article>
  );
}

function DiagnosticPanel({
  health,
  activity,
  recentActivityCount
}: {
  health: AppHealth;
  activity: ActivitySummary | null;
  recentActivityCount: number;
}) {
  const suggestions = [
    !health.database_ok ? "优先检查 SQLite 数据库路径和写入权限。" : "",
    (activity?.workspace_count || 0) === 0 ? "下一步建议导入一个真实项目工作区，形成代码地图和问题清单。" : "",
    (activity?.report_count || 0) === 0 ? "建议至少生成一份项目分析报告，让历史、卡片和 Agent 有可追溯来源。" : "",
    (activity?.card_count || 0) === 0 ? "可以从高风险 finding 或报告建议生成知识卡片，补齐学习沉淀。" : "",
    (activity?.agent_task_count || 0) === 0 ? "可以围绕工作区或 finding 生成一个 Agent 计划，验证改进闭环。" : "",
    recentActivityCount === 0 ? "近 14 天还没有活动趋势，持续使用后星图和统计会更有价值。" : ""
  ].filter(Boolean);

  return (
    <article className="health-panel-next diagnostic-panel-next">
      <div className="health-panel-title-next">
        <span><Sparkles size={16} />诊断建议</span>
        <small>基于本地数据完整度生成，不上传任何项目内容</small>
      </div>
      <div className="simple-list">
        {(suggestions.length ? suggestions : ["本地闭环已经具备基础数据，可以继续补强项目导览、Agent 执行记录和学习复盘。"]).map((item, index) => (
          <p key={`${item}-${index}`}>{item}</p>
        ))}
      </div>
    </article>
  );
}

function ListPanel({ title, events }: { title: string; events: ActivityEvent[] }) {
  return (
    <article className="health-panel-next recent-activity-panel-next">
      <div className="health-panel-title-next">
        <span><FileText size={16} />{title}</span>
        <small>最近写入 SQLite 的本地活动</small>
      </div>
      <div className="health-event-list-next">
        {events.map((event) => (
          <article key={event.id}>
            <strong>{event.title}</strong>
            <span>{formatTime(event.created_at)} · {activityLabel(event.event_type)}</span>
            {event.detail && <p>{event.detail}</p>}
          </article>
        ))}
        {events.length === 0 && <p className="muted">暂无本地活动。导入工作区、生成报告或创建卡片后会出现在这里。</p>}
      </div>
    </article>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="metric stat-card-next">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function HealthItem({ icon, label, value, ok }: { icon: ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <article className={ok ? "health-card ok" : "health-card warn"}>
      {icon}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function ReadinessCard({ icon, title, value, detail }: { icon: ReactNode; title: string; value: string; detail: string }) {
  return (
    <article>
      <span>{icon}{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function InfoBlock({ label, value, actionLabel, onAction }: { label: string; value: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <article className="info-block">
      <div>
        <span>{label}</span>
        <code>{value}</code>
      </div>
      {onAction && <button className="mini-button" onClick={onAction}><FolderOpen size={16} />{actionLabel}</button>}
    </article>
  );
}

function buildAssetStats(activity: ActivitySummary | null): AssetStat[] {
  return [
    { key: "report", label: "报告", value: activity?.report_count || 0, detail: "分析与对比产物" },
    { key: "workspace", label: "工作区", value: activity?.workspace_count || 0, detail: "已导入项目" },
    { key: "finding", label: "问题", value: activity?.finding_count || 0, detail: "结构化审查项" },
    { key: "card", label: "卡片", value: activity?.card_count || 0, detail: "学习沉淀" },
    { key: "chat", label: "对话", value: activity?.chat_count || 0, detail: "AI 追问记录" },
    { key: "agent", label: "Agent", value: activity?.agent_task_count || 0, detail: "改进计划" }
  ];
}

function buildTrendDays(dailyCounts: { date: string; count: number }[]) {
  const counts = new Map(dailyCounts.map((item) => [item.date, item.count]));
  const today = new Date();

  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (13 - index));
    const key = toLocalDateKey(date);
    return { date: key, count: counts.get(key) || 0 };
  });
}

function buildEventDistribution(events: ActivityEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const label = activityLabel(event.event_type);
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const items = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([label, value]) => ({ label, value, detail: "最近活动" }));

  return items.length ? items : [{ label: "暂无活动", value: 0, detail: "开始使用后自动统计" }];
}

function buildMaturityScore(health: AppHealth, activity: ActivitySummary | null, recentActivityCount: number) {
  const checks = [
    { label: "数据库可写", ok: health.database_ok, detail: health.database_ok ? "SQLite 已可用" : "需要检查数据库初始化或权限" },
    { label: "工作区资产", ok: (activity?.workspace_count || 0) > 0, detail: "有工作区后才能形成项目级代码地图" },
    { label: "分析报告", ok: (activity?.report_count || 0) > 0, detail: "报告是卡片、日志和 Agent 的主要来源" },
    { label: "问题清单", ok: (activity?.finding_count || 0) > 0, detail: "结构化 finding 支撑审查闭环" },
    { label: "知识卡片", ok: (activity?.card_count || 0) > 0, detail: "把问题沉淀为可复习知识" },
    { label: "AI 对话", ok: (activity?.chat_count || 0) > 0, detail: "围绕报告、文件和任务继续追问" },
    { label: "Agent 计划", ok: (activity?.agent_task_count || 0) > 0, detail: "形成可确认执行的改进方案" },
    { label: "持续活动", ok: recentActivityCount > 0, detail: "近 14 天有本地活动记录" }
  ];
  const score = Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
  const message = score >= 80 ? "主线闭环已经比较完整，可以继续打磨页面和 Agent 执行体验。" : score >= 50 ? "核心数据链路已启动，下一步应补齐缺口页面与真实项目记录。" : "当前仍偏初始化状态，建议先导入真实项目并生成报告。";

  return { score, message, checks };
}

function archiveChecklist(assetStats: AssetStat[]) {
  const summary = assetStats.map((item) => `${item.label} ${item.value}`);
  return [...summary, "每日学习日志", "活动索引", "模型配置状态", "不导出 Key 明文"];
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function activityLabel(value: string) {
  const labels: Record<string, string> = {
    workspace: "工作区",
    report: "报告",
    finding: "问题",
    card: "知识卡片",
    card_candidate: "卡片候选",
    daily_log: "每日日志",
    guide: "项目导览",
    agent: "Agent",
    chat: "对话"
  };
  return labels[value] || "活动";
}
