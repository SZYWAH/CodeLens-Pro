import { Moon, Sun } from "lucide-react";
import type { AnalyticsResponse, SettingsResponse } from "../types";
import { StatusPill } from "./StatusPill";

export function TopBar({
  title,
  settings,
  analytics,
  theme,
  onToggleTheme
}: {
  title: string;
  settings: SettingsResponse | null;
  analytics: AnalyticsResponse | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}) {
  const totalTokens = analytics?.token_usage.total_tokens ?? 0;
  const balanceValue = analytics?.api_balance.available
    ? `${analytics.api_balance.currency ? `${analytics.api_balance.currency} ` : ""}${formatBalance(analytics.api_balance.total_balance ?? 0)}`
    : analytics?.api_balance.status ?? "读取中";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5">
      <div className="min-w-0">
        <div className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-[#b8c9e6]">Code Intelligence Workspace</div>
        <h1 className="high-contrast-title mt-0.5 truncate text-xl font-black tracking-normal">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <button className="theme-status-pill" onClick={onToggleTheme} type="button" title="切换页面色调">
          {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
          <span>色调 {theme === "dark" ? "深色" : "亮色"}</span>
        </button>
        <StatusPill ok={Boolean(analytics?.api_balance.available)} label={`实时余额 ${balanceValue}`} subtle />
        <StatusPill ok={Boolean(analytics)} label={`实时Token ${formatNumber(totalTokens)}`} subtle />
        <StatusPill ok={Boolean(settings?.mysql_ok)} label={settings?.mysql_ok ? "MySQL 已连接" : "MySQL 未连接"} />
        <StatusPill ok={Boolean(settings?.llm_key_configured)} label={settings?.llm_key_configured ? "LLM Key 已配置" : "LLM Key 缺失"} />
      </div>
    </header>
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
