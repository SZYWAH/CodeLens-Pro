import { Loader2 } from "lucide-react";
import type { ReportDetail, TraceabilitySnapshot } from "../types";
import { ReportReader } from "./ReportReader";

export function ReportPanel({
  report,
  traceability,
  onCopy,
  onExport,
  onGenerateCandidates,
  onCreateAgentPlan,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport
}: {
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  onCopy: () => void;
  onExport: (kind: "md" | "html") => void;
  onGenerateCandidates?: () => void;
  onCreateAgentPlan?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
}) {
  return (
    <ReportReader
      report={report}
      traceability={traceability}
      onCopy={onCopy}
      onExport={onExport}
      onGenerateCandidates={onGenerateCandidates}
      onCreateAgentPlan={onCreateAgentPlan}
      onOpenFindings={onOpenFindings}
      onAddDailyLog={onAddDailyLog}
      onChatAboutReport={onChatAboutReport}
    />
  );
}

export function StreamPanel({ title, value, busy }: { title: string; value: string; busy: boolean }) {
  return (
    <article className="stream-panel">
      <div className="pane-title">
        {busy && <Loader2 className="spin" size={18} />}
        {title}
      </div>
      <pre>{value || "等待第一段内容..."}</pre>
    </article>
  );
}
