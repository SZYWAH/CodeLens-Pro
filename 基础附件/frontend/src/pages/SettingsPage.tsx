import { BarChart3, FileText, LineChart, MessageSquare, PieChart, RefreshCw, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import { StatusPill } from "../components/StatusPill";
import type { AnalyticsDatum, AnalyticsResponse } from "../types";

const palette = ["#60a5fa", "#38bdf8", "#ffc66d", "#a5c261", "#b9a6ff", "#ff8a63", "#cc7832", "#8f8f8f"];

type SettingsPageProps = {
  analytics: AnalyticsResponse | null;
  analyticsError: string;
  analyticsLoading: boolean;
  onRefreshAnalytics: () => void | Promise<void>;
};

export function SettingsPage({ analytics, analyticsError, analyticsLoading, onRefreshAnalytics }: SettingsPageProps) {
  const totals = analytics?.totals ?? {};
  const tokenItems = analytics?.token_usage.items ?? [];
  const daily = analytics?.daily_activity ?? [];
  const totalTokens = analytics?.token_usage.total_tokens ?? 0;
  const tokenMethod = analytics?.token_usage.tokenizer_available ? "DeepSeek tokenizer 精确统计" : "字符估算回退";
  const balanceValue = analytics?.api_balance.available
    ? `${analytics.api_balance.currency ? `${analytics.api_balance.currency} ` : ""}${formatBalance(analytics.api_balance.total_balance ?? 0)}`
    : analytics?.api_balance.status ?? "等待余额数据";

  return (
    <div className="page-scroll">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-pine">Usage Analytics</div>
            <h2 className="mt-1 text-xl font-black text-[#f8fbff]">本地使用数据分析</h2>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary h-9" onClick={onRefreshAnalytics} type="button">
              <RefreshCw className={analyticsLoading ? "animate-spin" : ""} size={15} />
              刷新数据
            </button>
            <StatusPill ok={!analyticsError} label={analyticsError ? "统计异常" : "实时读取 MySQL"} subtle />
          </div>
        </div>
        {analyticsError ? <div className="mb-3 rounded-md border border-[#5c3024] bg-[#241713] p-3 text-sm text-coral">{analyticsError}</div> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricStat icon={<WalletCards size={18} />} label="API余额分析" value={balanceValue} detail={analytics?.api_balance.status ?? "等待余额数据"} />
          <MetricStat icon={<BarChart3 size={18} />} label="Token 统计" value={totalTokens} detail={tokenMethod} />
          <MetricStat icon={<FileText size={18} />} label="历史报告" value={totals.reports ?? 0} detail="工作台 + 代码对比" />
          <MetricStat icon={<MessageSquare size={18} />} label="AI 对话" value={totals.chat_sessions ?? 0} detail={`${totals.chat_messages ?? 0} 条消息`} />
        </div>

        <div className="mt-4">
          <ChartCard icon={<WalletCards size={18} />} title="Token 使用分析" subtitle={tokenMethod}>
            <BarChart items={tokenItems} compact />
          </ChartCard>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard icon={<BarChart3 size={18} />} title="功能使用分布" subtitle="工作台、代码对比、AI 对话">
            <BarChart items={analytics?.tool_usage ?? []} />
          </ChartCard>
          <ChartCard icon={<LineChart size={18} />} title="近 14 天活跃趋势" subtitle="报告生成与 AI 提问">
            <LineTrend items={daily} />
          </ChartCard>
          <ChartCard icon={<PieChart size={18} />} title="对话类型占比" subtitle="报告对话与普通对话">
            <DonutChart items={analytics?.chat_type_counts ?? []} centerLabel={`${totals.chat_sessions ?? 0}`} />
          </ChartCard>
          <ChartCard icon={<BarChart3 size={18} />} title="报告模式排行" subtitle="按生成次数统计">
            <BarChart items={analytics?.report_mode_counts ?? []} compact />
          </ChartCard>
        </div>
      </section>
    </div>
  );
}

function MetricStat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: number | string; detail: string }) {
  const displayValue = typeof value === "number" ? formatNumber(value) : value;

  return (
    <section className="analytics-stat-card">
      <div className="text-pine">{icon}</div>
      <div className="mt-2 text-xs font-bold text-[#b8c9e6]">{label}</div>
      <div className="mt-1 break-words text-2xl font-black text-[#f8fbff]">{displayValue}</div>
      <div className="mt-1 text-xs text-[#c5d7f2]">{detail}</div>
    </section>
  );
}

function ChartCard({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="tool-panel p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#f8fbff]">
            <span className="text-pine">{icon}</span>
            <h3 className="text-sm font-black">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-[#b8c9e6]">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function BarChart({ items, compact = false }: { items: AnalyticsDatum[]; compact?: boolean }) {
  const max = Math.max(1, ...items.map((item) => item.value ?? 0));

  if (!items.length) {
    return <div className="empty-state min-h-[180px]">暂无统计数据</div>;
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {items.map((item, index) => {
        const value = item.value ?? 0;
        const percent = Math.max(4, (value / max) * 100);
        return (
          <div key={`${item.label}-${index}`} className="analytics-bar-row">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-bold text-[#eaf2ff]">{item.label}</span>
              <span className="font-mono text-[#b8c9e6]">{formatNumber(value)}</span>
            </div>
            <div className="analytics-bar-track">
              <div className="analytics-bar-fill" style={{ width: `${percent}%`, background: palette[index % palette.length] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({ items, centerLabel }: { items: AnalyticsDatum[]; centerLabel: string }) {
  const total = items.reduce((sum, item) => sum + (item.value ?? 0), 0);
  let cursor = 0;
  const gradient = total
    ? items.map((item, index) => {
        const start = cursor;
        cursor += ((item.value ?? 0) / total) * 100;
        return `${palette[index % palette.length]} ${start}% ${cursor}%`;
      }).join(", ")
    : "#1e2a44 0% 100%";

  return (
    <div className="analytics-donut-wrap">
      <div className="analytics-donut" style={{ background: `conic-gradient(${gradient})` }}>
        <div>
          <div className="text-xl font-black text-[#f8fbff]">{centerLabel}</div>
          <div className="text-[0.66rem] font-bold text-[#b8c9e6]">会话</div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: palette[index % palette.length] }} />
              <span className="truncate font-bold text-[#eaf2ff]">{item.label}</span>
            </div>
            <span className="font-mono text-xs text-[#b8c9e6]">{formatNumber(item.value ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineTrend({ items }: { items: AnalyticsDatum[] }) {
  const width = 560;
  const height = 190;
  const padding = 24;
  const max = Math.max(1, ...items.map((item) => item.total ?? 0));
  const points = items.map((item, index) => {
    const x = padding + (index / Math.max(1, items.length - 1)) * (width - padding * 2);
    const y = height - padding - ((item.total ?? 0) / max) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="analytics-line-wrap">
      <svg className="analytics-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近 14 天活跃趋势">
        <path d={`M ${padding} ${height - padding} H ${width - padding}`} className="analytics-axis" />
        <path d={`M ${padding} ${padding} V ${height - padding}`} className="analytics-axis" />
        <polyline points={points} className="analytics-line" />
        {items.map((item, index) => {
          const [x, y] = points.split(" ")[index].split(",").map(Number);
          return <circle key={`${item.date}-${index}`} cx={x} cy={y} r="3.5" className="analytics-dot" />;
        })}
      </svg>
      <div className="grid grid-cols-3 gap-2 text-xs text-[#b8c9e6]">
        <span>{items[0]?.date?.slice(5) ?? "-"}</span>
        <span className="text-center">峰值 {formatNumber(max)}</span>
        <span className="text-right">{items[items.length - 1]?.date?.slice(5) ?? "-"}</span>
      </div>
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatBalance(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(value);
}
