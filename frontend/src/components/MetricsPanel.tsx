import { AlertTriangle, Braces, FileCode2 } from "lucide-react";
import type { ReactNode } from "react";
import type { StaticMetrics } from "../types";

export function MetricsPanel({ metrics }: { metrics: StaticMetrics | null }) {
  if (!metrics) {
    return (
      <div className="tool-panel p-4 text-sm text-[#b8c9e6]">
        静态指标等待分析
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      <Metric icon={<FileCode2 size={18} />} label="有效行" value={metrics.lines} tone="text-teal" />
      <Metric icon={<Braces size={18} />} label="函数" value={metrics.functions.count} tone="text-plum" />
      <Metric icon={<AlertTriangle size={18} />} label="风险" value={metrics.secrets_risk.length} tone="text-coral" />
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
    <div className="tool-panel p-3">
      <div className={`mb-2 ${tone}`}>{icon}</div>
      <div className="text-xs text-[#b8c9e6]">{label}</div>
      <div className="mt-1 text-2xl font-black text-[#f8fbff]">{value}</div>
    </div>
  );
}
