import { Moon, Sun } from "lucide-react";
import type { AnalyticsResponse, SettingsResponse } from "../types";
import { StatusPill } from "./StatusPill";

export function TopBar({
  title,
  settings,
  analytics,
  theme,
  onToggleTheme,
  showCodeLegend = false
}: {
  title: string;
  settings: SettingsResponse | null;
  analytics: AnalyticsResponse | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  showCodeLegend?: boolean;
}) {
  const totalTokens = analytics?.token_usage.total_tokens ?? 0;
  const balanceValue = analytics?.api_balance.available
    ? `${analytics.api_balance.currency ? `${analytics.api_balance.currency} ` : ""}${formatBalance(analytics.api_balance.total_balance ?? 0)}`
    : analytics?.api_balance.status ?? "读取中";

  return (
    <header className="glass-panel m-4 mb-0 flex h-14 items-center justify-between gap-4 rounded-md px-4">
      <div className="min-w-0">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-pine">CodeLens Pro</div>
        <h1 className="truncate text-base font-black text-[#f8fbff]">{title}</h1>
      </div>
      {showCodeLegend ? <InlineCodeLegend /> : <div className="topbar-spacer" aria-hidden="true" />}
      <div className="flex shrink-0 items-center gap-2">
        <button className="theme-status-pill" onClick={onToggleTheme} type="button" title="切换页面色调">
          {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
          <span>{theme === "dark" ? "深色" : "亮色"}</span>
        </button>
        <StatusPill ok={Boolean(analytics?.api_balance.available)} label={balanceValue} subtle />
        <StatusPill ok={Boolean(analytics)} label={`Token ${formatNumber(totalTokens)}`} subtle />
        <StatusPill ok={Boolean(settings?.mysql_ok)} label={settings?.mysql_ok ? "MySQL 已连接" : "MySQL 未连接"} />
        <StatusPill ok={Boolean(settings?.llm_key_configured)} label={settings?.llm_key_configured ? "LLM 已配置" : "LLM 未配置"} />
      </div>
    </header>
  );
}

function InlineCodeLegend() {
  const items = [
    ["inline-code-call", "函数/流程类"],
    ["inline-code-state", "状态变量类"],
    ["inline-code-expression", "表达式"],
    ["inline-code-string", "字符串"],
    ["inline-code-symbol", "普通标识符"]
  ];

  return (
    <div className="topbar-code-legend" aria-label="报告行内代码颜色图例">
      {items.map(([className, label]) => (
        <code className={`markdown-inline-code ${className}`} key={className}>
          {label}
        </code>
      ))}
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
