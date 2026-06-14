import { BarChart3, FileText, MessageSquare, RefreshCw, ShieldAlert, WalletCards } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ActivityFeed } from "../components/ActivityFeed";
import type { ActivityItem, AnalyticsDatum, AnalyticsResponse } from "../types";
import { Button, Metric, Surface } from "../ui";

const palette = ["#5d8cff", "#35d0ff", "#f7c96b", "#74d69a", "#b9a6ff", "#ff8a8a"];

type SettingsPageProps = {
  analytics: AnalyticsResponse | null;
  activity: ActivityItem[];
  analyticsError: string;
  analyticsLoading: boolean;
  onRefreshAnalytics: () => void | Promise<void>;
  onOpenActivityGalaxy: () => void;
};

export function SettingsPage({
  analytics,
  activity,
  analyticsError,
  analyticsLoading,
  onRefreshAnalytics,
  onOpenActivityGalaxy,
}: SettingsPageProps) {
  const totals = analytics?.totals ?? {};
  const daily = analytics?.daily_activity ?? [];
  const toolUsage = analytics?.tool_usage ?? [];
  const chatTypes = analytics?.chat_type_counts ?? [];
  const totalTokens = analytics?.token_usage.total_tokens ?? 0;
  const balanceValue = analytics?.api_balance.available
    ? `${analytics.api_balance.currency ? `${analytics.api_balance.currency} ` : ""}${formatBalance(analytics.api_balance.total_balance ?? 0)}`
    : analytics?.api_balance.status ?? "等待余额数据";
  const tokenMethod = analytics?.token_usage.tokenizer_available ? "DeepSeek tokenizer" : "字符估算";
  const tokenDetail = analytics?.token_usage.refreshed_at
    ? `${tokenMethod} · ${formatTimeOnly(analytics.token_usage.refreshed_at)} 刷新`
    : tokenMethod;

  return (
    <div className="page-scroll analytics-cockpit analytics-cockpit-redesign">
      <section className="analytics-header">
        <div>
          <span>Usage Overview</span>
          <h2>复盘看板</h2>
          <p>作为演示收尾层，汇总报告、知识沉淀、Agent 任务与 Token 使用情况。</p>
        </div>
        <Button onClick={onRefreshAnalytics} type="button" tone="primary">
          <RefreshCw className={analyticsLoading ? "animate-spin" : ""} size={16} />
          刷新
        </Button>
      </section>

      {analyticsError ? <div className="mb-3 rounded-md border border-[#5c3024] bg-[#241713] p-3 text-sm text-coral">{analyticsError}</div> : null}

      <div className="analytics-layout">
        <main className="analytics-main">
          <div className="analytics-metric-grid">
            <Metric icon={<WalletCards size={18} />} label="API 余额" value={balanceValue} detail={analytics?.api_balance.status ?? "等待余额数据"} tone="blue" />
            <Metric icon={<BarChart3 size={18} />} label="Token" value={formatNumber(totalTokens)} detail={tokenDetail} tone="cyan" />
            <Metric icon={<FileText size={18} />} label="历史报告" value={totals.reports ?? 0} detail="工作台 + 代码对比" tone="violet" />
            <Metric icon={<MessageSquare size={18} />} label="AI 会话" value={totals.chat_sessions ?? 0} detail={`${totals.chat_messages ?? 0} 条消息`} tone="amber" />
          </div>

          <Surface className="analytics-trend-panel">
            <ChartHeader title="近 14 天学习与协作趋势" subtitle="报告生成、AI 提问和 Agent 任务的总体活跃度" />
            <div className="analytics-trend-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient id="activityGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#5d8cff" stopOpacity={0.42} />
                      <stop offset="100%" stopColor="#5d8cff" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} stroke="var(--chart-axis)" fontSize={12} />
                  <YAxis stroke="var(--chart-axis)" fontSize={12} width={32} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="total" stroke="#5d8cff" strokeWidth={3} fill="url(#activityGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Surface>

          <div className="analytics-distribution-grid">
            <Surface className="analytics-distribution-panel">
              <ChartHeader title="主线入口使用排行" subtitle="分析、沉淀、协作入口的使用频次" />
              <DistributionList items={toolUsage} emptyText="暂无功能使用数据" />
            </Surface>
            <Surface className="analytics-distribution-panel">
              <ChartHeader title="对话类型分布" subtitle="普通问答、报告追问与 Agent 协作" />
              <DistributionList items={chatTypes} emptyText="暂无对话类型数据" />
            </Surface>
          </div>
        </main>

        <aside className="analytics-side">
          <ActivityFeed items={activity} onOpenGalaxy={onOpenActivityGalaxy} />
          <Surface className="analytics-risk-panel">
            <ShieldAlert size={18} />
            <strong>{totals.security_risks ?? 0} 个风险提示</strong>
            <span>{totals.code_lines ?? 0} 行代码已进入本地分析记录</span>
          </Surface>
        </aside>
      </div>
    </div>
  );
}

function ChartHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="analytics-chart-head">
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  );
}

function DistributionList({ items, emptyText }: { items: AnalyticsDatum[]; emptyText: string }) {
  const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const max = Math.max(...items.map((item) => item.value ?? 0), 1);

  if (!items.length) {
    return <div className="analytics-data-empty">{emptyText}</div>;
  }

  return (
    <div className="analytics-data-list">
      {items.map((item, index) => {
        const value = item.value ?? 0;
        const color = palette[index % palette.length];
        return (
          <div className="analytics-data-row" key={item.label ?? index}>
            <div className="analytics-data-row-head">
              <span className="analytics-data-name">
                <i style={{ background: color }} />
                {item.label ?? "未命名"}
              </span>
              <span className="analytics-data-value">
                <strong>{formatNumber(value)}</strong>
                <small>{formatPercent(value, total)}</small>
              </span>
            </div>
            <div className="analytics-data-track">
              <span style={{ width: `${Math.max(4, (value / max) * 100)}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--chart-tooltip-bg)",
  border: "1px solid var(--chart-tooltip-border)",
  borderRadius: "10px",
  color: "var(--chart-tooltip-text)",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatTimeOnly(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(`${value.replace(/\s+/, "T")}Z`));
}

function formatPercent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatBalance(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(value);
}
