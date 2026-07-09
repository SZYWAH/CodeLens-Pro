import {
  Activity,
  ArrowRight,
  Bot,
  FileText,
  GitBranch,
  GraduationCap,
  Layers3,
  Network,
  Route,
  ShieldAlert
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  ActivitySummary,
  AgentTask,
  DailySummary,
  Finding,
  LearningCard,
  ReportSummary,
  TraceabilitySnapshot,
  WorkspaceSummary
} from "../types";

type OverviewTarget =
  | "workbench"
  | "projects"
  | "guide"
  | "map"
  | "findings"
  | "diff"
  | "history"
  | "chat"
  | "cards"
  | "logs"
  | "agent"
  | "galaxy"
  | "settings"
  | "health";

export function ProductOverview({
  activity,
  agentTasks,
  cards,
  dailySummary,
  findings,
  reports,
  traceability,
  workspaces,
  onNavigate,
  onRefresh
}: {
  activity: ActivitySummary | null;
  agentTasks: AgentTask[];
  cards: LearningCard[];
  dailySummary: DailySummary | null;
  findings: Finding[];
  reports: ReportSummary[];
  traceability: TraceabilitySnapshot | null;
  workspaces: WorkspaceSummary[];
  onNavigate: (target: OverviewTarget) => void;
  onRefresh: () => void;
}) {
  const unresolvedFindings = findings.filter((item) => item.status !== "resolved").length;
  const reviewCards = cards.filter((item) => item.status !== "mastered").length;
  const activeAgentTasks = agentTasks.filter((item) => item.status !== "applied").length;
  const maturitySteps = [
    Boolean(activity?.workspace_count),
    Boolean(activity?.report_count),
    Boolean(activity?.finding_count),
    Boolean(activity?.card_count),
    Boolean(activity?.agent_task_count),
    Boolean(dailySummary?.activity_count)
  ];
  const maturity = Math.round((maturitySteps.filter(Boolean).length / maturitySteps.length) * 100);
  const nextActions = traceability?.next_actions.length
    ? traceability.next_actions.slice(0, 4)
    : [
        "导入或打开一个本地项目工作区。",
        "生成项目分析报告，并把风险拆成问题清单。",
        "从高价值问题生成知识卡片和 Agent 改进计划。"
      ];

  return (
    <section className="overview-page-next">
      <div className="overview-hero-next">
        <div>
          <span>工作台总览</span>
          <h3>从最近工作继续推进项目审查</h3>
          <p>
            最近工作区、报告、问题、卡片、日志和 Agent 任务集中在这里，优先显示下一步能直接点击的动作。
          </p>
        </div>
        <button className="primary-button" type="button" onClick={onRefresh}>
          <Activity size={18} />
          刷新总览
        </button>
      </div>

      <div className="overview-metrics-next">
        <OverviewMetric icon={<Layers3 size={18} />} label="工作区" value={activity?.workspace_count || 0} hint={`${workspaces.length} 个最近项目`} />
        <OverviewMetric icon={<FileText size={18} />} label="报告" value={activity?.report_count || 0} hint={`${reports.length} 份可检索`} />
        <OverviewMetric icon={<ShieldAlert size={18} />} label="未解决问题" value={unresolvedFindings || activity?.finding_count || 0} hint="风险与建议入口" />
        <OverviewMetric icon={<GraduationCap size={18} />} label="待复习卡片" value={reviewCards || activity?.card_count || 0} hint="学习沉淀入口" />
        <OverviewMetric icon={<Bot size={18} />} label="Agent 任务" value={activeAgentTasks || activity?.agent_task_count || 0} hint="可确认执行计划" />
      </div>

      <ProductAlignmentBoard
        activity={activity}
        dailySummary={dailySummary}
        unresolvedFindings={unresolvedFindings}
        reviewCards={reviewCards}
        activeAgentTasks={activeAgentTasks}
        onNavigate={onNavigate}
      />

      <div className="overview-main-grid-next">
        <section className="overview-progress-next">
          <div className="overview-section-title-next">
            <span>闭环成熟度</span>
            <strong>{maturity}%</strong>
          </div>
          <div className="overview-progress-track-next">
            <span style={{ width: `${maturity}%` }} />
          </div>
          <div className="overview-pipeline-next">
            {[
              ["项目", "projects"],
              ["报告", "history"],
              ["问题", "findings"],
              ["卡片", "cards"],
              ["日志", "logs"],
              ["Agent", "agent"]
            ].map(([label, target], index) => (
              <button key={label} type="button" onClick={() => onNavigate(target as OverviewTarget)}>
                <span className={maturitySteps[index] ? "done" : ""}>{index + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <div className="overview-next-actions-next">
            <span>下一步建议</span>
            {nextActions.map((action) => (
              <p key={action}>
                <ArrowRight size={15} />
                {action}
              </p>
            ))}
          </div>
        </section>

        <section className="overview-actions-next">
          <div className="overview-section-title-next">
            <span>主线入口</span>
            <small>按真实项目工作流排列</small>
          </div>
          <OverviewAction icon={<FileText size={18} />} title="打开代码工作台" detail="粘贴片段或导入单文件，快速生成结构化报告" onClick={() => onNavigate("workbench")} />
          <OverviewAction icon={<Layers3 size={18} />} title="进入项目工作区" detail="导入、重扫、分析多文件项目" onClick={() => onNavigate("projects")} />
          <OverviewAction icon={<GitBranch size={18} />} title="查看代码地图" detail="语言分布、热点文件、符号与依赖" onClick={() => onNavigate("map")} />
          <OverviewAction icon={<ShieldAlert size={18} />} title="处理问题清单" detail="筛选风险、生成卡片和修复计划" onClick={() => onNavigate("findings")} />
          <OverviewAction icon={<Activity size={18} />} title="打开活动星图" detail="复盘分析、学习和 Agent 轨迹" onClick={() => onNavigate("galaxy")} />
        </section>
      </div>

      <OverviewTraceabilityMap traceability={traceability} onNavigate={onNavigate} />

      <div className="overview-bottom-grid-next">
        <OverviewList
          title="最近报告"
          empty="还没有报告，先从项目工作区生成一份。"
          items={reports.slice(0, 5).map((item) => `${reportTypeLabel(item.report_type)} · ${item.title}`)}
          onOpen={() => onNavigate("history")}
        />
        <OverviewList
          title="最近活动"
          empty="还没有活动记录。"
          items={(activity?.recent_events || []).slice(0, 5).map((item) => `${activityLabel(item.event_type)} · ${item.title}`)}
          onOpen={() => onNavigate("galaxy")}
        />
        <OverviewList
          title="学习中心"
          empty="今日还没有学习沉淀。"
          items={[
            `今日报告：${dailySummary?.report_count || 0}`,
            `今日卡片：${dailySummary?.card_count || 0}`,
            `今日 Agent：${dailySummary?.agent_task_count || 0}`
          ]}
          onOpen={() => onNavigate("logs")}
        />
      </div>
    </section>
  );
}

function ProductAlignmentBoard({
  activity,
  dailySummary,
  unresolvedFindings,
  reviewCards,
  activeAgentTasks,
  onNavigate
}: {
  activity: ActivitySummary | null;
  dailySummary: DailySummary | null;
  unresolvedFindings: number;
  reviewCards: number;
  activeAgentTasks: number;
  onNavigate: (target: OverviewTarget) => void;
}) {
  const lanes = [
    {
      title: "分析主线",
      target: "projects" as OverviewTarget,
      icon: <Layers3 size={18} />,
      detail: "从工作台、项目导览、代码地图、问题清单、历史报告和代码对比继续推进。",
      stats: [
        `工作区 ${activity?.workspace_count || 0}`,
        `报告 ${activity?.report_count || 0}`,
        `问题 ${unresolvedFindings || activity?.finding_count || 0}`
      ],
      entries: [
        ["代码工作台", "workbench"],
        ["项目导览", "guide"],
        ["代码地图", "map"],
        ["代码对比", "diff"]
      ]
    },
    {
      title: "学习沉淀",
      target: "cards" as OverviewTarget,
      icon: <GraduationCap size={18} />,
      detail: "让报告、问题、对话和 Agent 任务继续沉淀成知识卡片、学习材料和每日日志。",
      stats: [
        `卡片 ${activity?.card_count || 0}`,
        `待复习 ${reviewCards || 0}`,
        `今日活动 ${dailySummary?.activity_count || 0}`
      ],
      entries: [
        ["知识卡片", "cards"],
        ["每日日志", "logs"],
        ["历史报告", "history"]
      ]
    },
    {
      title: "Agent 协作",
      target: "agent" as OverviewTarget,
      icon: <Bot size={18} />,
      detail: "围绕上下文选择、计划草稿、确认执行、备份与回滚记录推进。",
      stats: [
        `Agent ${activity?.agent_task_count || 0}`,
        `待推进 ${activeAgentTasks || 0}`,
        `对话 ${activity?.chat_count || 0}`
      ],
      entries: [
        ["Agent 工作区", "agent"],
        ["AI 对话", "chat"],
        ["问题清单", "findings"]
      ]
    },
    {
      title: "复盘与系统",
      target: "galaxy" as OverviewTarget,
      icon: <Activity size={18} />,
      detail: "以活动星图为核心，把本地数据统计、关系追踪、导出备份和模型管理收束到长期使用体验。",
      stats: [
        `活动 ${activity?.recent_events.length || 0}`,
        `今日 ${dailySummary?.activity_count || 0}`,
        "SQLite 本地"
      ],
      entries: [
        ["活动星图", "galaxy"],
        ["设置中心", "settings"],
        ["状态中心", "health"]
      ]
    }
  ];

  const acceptanceSteps = [
    {
      label: "导入工作区",
      done: Boolean(activity?.workspace_count),
      target: "projects" as OverviewTarget,
      detail: activity?.workspace_count ? `${activity.workspace_count} 个工作区可继续审查` : "等待导入真实项目文件夹"
    },
    {
      label: "生成审查报告",
      done: Boolean(activity?.report_count),
      target: "history" as OverviewTarget,
      detail: activity?.report_count ? `${activity.report_count} 份报告已保存` : "从工作区生成第一份项目报告"
    },
    {
      label: "处理问题清单",
      done: Boolean(activity?.finding_count),
      target: "findings" as OverviewTarget,
      detail: activity?.finding_count ? `${unresolvedFindings || activity.finding_count} 个问题待复查` : "报告生成后自动形成问题入口"
    },
    {
      label: "沉淀知识卡片",
      done: Boolean(activity?.card_count),
      target: "cards" as OverviewTarget,
      detail: activity?.card_count ? `${reviewCards || activity.card_count} 张卡片待复习` : "从问题或报告生成卡片"
    },
    {
      label: "确认 Agent 草稿",
      done: Boolean(activity?.agent_task_count),
      target: "agent" as OverviewTarget,
      detail: activity?.agent_task_count ? `${activeAgentTasks || activity.agent_task_count} 个计划可推进` : "先生成只写入 .codelens-agent 的草稿"
    },
    {
      label: "写入每日日志",
      done: Boolean(dailySummary?.activity_count),
      target: "logs" as OverviewTarget,
      detail: dailySummary?.activity_count ? `今日已有 ${dailySummary.activity_count} 条活动` : "把审查、卡片和 Agent 结果沉淀到今天"
    }
  ];

  return (
    <section className="overview-alignment-next">
      <div className="overview-alignment-head-next">
        <div>
          <span><Route size={16} />今日工作主线</span>
          <h3>先处理可行动的项目审查，再沉淀学习记录</h3>
          <p>首页直接呈现四条工作线：项目分析、学习沉淀、Agent 协作、复盘与系统状态。每个入口都指向当前可继续推进的任务。</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => onNavigate("galaxy")}>
          <Activity size={16} />
          查看活动星图
        </button>
      </div>

      <div className="overview-alignment-lanes-next">
        {lanes.map((lane) => (
          <article key={lane.title}>
            <button className="overview-lane-title-next" type="button" onClick={() => onNavigate(lane.target)}>
              <span>{lane.icon}</span>
              <strong>{lane.title}</strong>
              <ArrowRight size={16} />
            </button>
            <p>{lane.detail}</p>
            <div className="overview-lane-stats-next">
              {lane.stats.map((item) => <em key={item}>{item}</em>)}
            </div>
            <div className="overview-lane-entries-next">
              {lane.entries.map(([label, target]) => (
                <button key={label} type="button" onClick={() => onNavigate(target as OverviewTarget)}>{label}</button>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="overview-version-road-next" aria-label="今日验收链路">
        {acceptanceSteps.map((step, index) => (
          <article className={step.done ? "active" : ""} key={step.label}>
            <span>{step.done ? "已完成" : `第 ${index + 1} 步`}</span>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
            <button className="mini-button" type="button" onClick={() => onNavigate(step.target)}>
              进入
              <ArrowRight size={14} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function OverviewTraceabilityMap({
  traceability,
  onNavigate
}: {
  traceability: TraceabilitySnapshot | null;
  onNavigate: (target: OverviewTarget) => void;
}) {
  const counts = traceability?.counts;
  const visibleNodes = traceability?.nodes.slice(0, 10) || [];
  const visibleLinks = traceability?.links.slice(0, 9) || [];
  const gaps = traceability?.gaps.length
    ? traceability.gaps.slice(0, 4)
    : ["当前还没有足够的闭环缺口数据，先生成报告、问题、卡片或 Agent 任务。"];
  const nextActions = traceability?.next_actions.length
    ? traceability.next_actions.slice(0, 4)
    : ["从真实项目工作区开始，生成项目报告，再沉淀问题、卡片和 Agent 计划。"];

  return (
    <section className="overview-traceability-next">
      <div className="overview-traceability-head-next">
        <div>
          <span><Network size={16} />本地闭环关系图谱</span>
          <h3>{traceability?.title || "本地工作闭环总览"}</h3>
          <p>把工作区、报告、问题、知识卡片、对话、每日日志和 Agent 计划放在同一个关系面板里，避免功能页面各自孤立。</p>
        </div>
        <div className="overview-traceability-counts-next">
          <TraceCount label="工作区" value={counts?.workspaces || 0} />
          <TraceCount label="报告" value={counts?.reports || 0} />
          <TraceCount label="问题" value={counts?.findings || 0} />
          <TraceCount label="卡片" value={counts?.cards || 0} />
          <TraceCount label="对话" value={counts?.chats || 0} />
          <TraceCount label="日志" value={counts?.daily_logs || 0} />
          <TraceCount label="Agent" value={counts?.agent_tasks || 0} />
        </div>
      </div>

      <div className="overview-traceability-body-next">
        <div className="overview-trace-node-grid-next">
          {visibleNodes.map((node) => (
            <button key={node.id} type="button" onClick={() => onNavigate(traceNodeTarget(node.kind))}>
              <span>{traceKindLabel(node.kind)}</span>
              <strong>{node.title}</strong>
              <small>{node.subtitle || traceStatusLabel(node.status)}</small>
              <em>{node.weight}</em>
            </button>
          ))}
          {visibleNodes.length === 0 && <p>暂无关系节点。导入工作区并生成报告后，这里会显示完整闭环链路。</p>}
        </div>

        <div className="overview-trace-side-next">
          <article>
            <span><Route size={15} />关键链路</span>
            <div className="overview-trace-links-next">
              {visibleLinks.map((link) => (
                <button key={`${link.source}-${link.target}-${link.label}`} type="button" onClick={() => onNavigate("galaxy")}>
                  <strong>{link.label}</strong>
                  <small>{shortTraceNode(link.source)} → {shortTraceNode(link.target)}</small>
                  <em>{link.weight}</em>
                </button>
              ))}
              {visibleLinks.length === 0 && <p>暂无链路。生成问题、卡片、日志或 Agent 计划后会自动串联。</p>}
            </div>
          </article>

          <article>
            <span>闭环缺口</span>
            {gaps.map((item) => <p key={item}>{item}</p>)}
          </article>

          <article>
            <span>推进动作</span>
            {nextActions.map((item) => <p key={item}>{item}</p>)}
          </article>
        </div>
      </div>
    </section>
  );
}

function TraceCount({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function OverviewMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number; hint: string }) {
  return (
    <article>
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}

function OverviewAction({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
      <ArrowRight size={16} />
    </button>
  );
}

function OverviewList({ title, empty, items, onOpen }: { title: string; empty: string; items: string[]; onOpen: () => void }) {
  return (
    <section className="overview-list-next">
      <div className="overview-section-title-next">
        <span>{title}</span>
        <button type="button" onClick={onOpen}>打开</button>
      </div>
      {items.length ? items.map((item) => <p key={item}>{item}</p>) : <p>{empty}</p>}
    </section>
  );
}

function reportTypeLabel(value: string) {
  const labels: Record<string, string> = {
    single: "单文件",
    project: "项目分析",
    diff: "代码对比"
  };
  return labels[value] || "报告";
}

function activityLabel(value: string) {
  const labels: Record<string, string> = {
    report: "报告",
    workspace: "工作区",
    finding: "问题",
    card: "卡片",
    daily_log: "日志",
    guide: "导览",
    agent: "Agent",
    chat: "对话",
    export: "导出",
    import: "导入"
  };
  return labels[value] || "活动";
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
    linked: "已关联",
    summary: "汇总"
  };
  return labels[value] || value;
}

function traceNodeTarget(kind: string): OverviewTarget {
  const targets: Record<string, OverviewTarget> = {
    workspace: "projects",
    report: "history",
    finding: "findings",
    card: "cards",
    chat: "chat",
    daily_log: "logs",
    agent: "agent",
    activity: "galaxy"
  };
  return targets[kind] || "galaxy";
}

function shortTraceNode(value: string) {
  const [kind] = value.split(":");
  return traceKindLabel(kind);
}
