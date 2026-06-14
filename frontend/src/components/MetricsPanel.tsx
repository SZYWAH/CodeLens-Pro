import { AlertTriangle, Braces, FileCode2 } from "lucide-react";
import type { ReactNode } from "react";
import type { StaticMetrics } from "../types";

export function MetricsPanel({ metrics }: { metrics: StaticMetrics | null }) {
  if (!metrics) {
    return (
      <div className="metrics-panel-compact metrics-panel-empty">
        <span className="metrics-panel-empty-dot" />
        <span>静态指标等待分析</span>
      </div>
    );
  }

  return (
    <div className="metrics-panel-compact">
      <Metric icon={<FileCode2 size={16} />} label="有效行" value={metrics.lines} tone="metrics-panel-tone-teal" />
      <Metric icon={<Braces size={16} />} label="函数" value={metrics.functions.count} tone="metrics-panel-tone-plum" />
      <Metric icon={<AlertTriangle size={16} />} label="风险" value={metrics.secrets_risk.length} tone="metrics-panel-tone-coral" />
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="metrics-panel-item">
      <span className={`metrics-panel-icon ${tone}`}>{icon}</span>
      <span className="metrics-panel-text">
        <strong>{value}</strong>
        <em>{label}</em>
      </span>
    </div>
  );
}
