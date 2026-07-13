import { Loader2 } from "lucide-react";
import type { ReportDetail, TraceabilitySnapshot } from "../types";
import { ReportReader } from "./ReportReader";

export function ReportPanel({
  report,
  traceability,
  onCopy,
  onExport,
  onGenerateCandidates,
  onOpenFindings,
  onAddDailyLog,
  onChatAboutReport,
  onRename,
  variant = "full",
  loading = false,
  operationBusy = false
}: {
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  onCopy: () => void;
  onExport: (kind: "md" | "html") => void;
  onGenerateCandidates?: () => void;
  onOpenFindings?: () => void;
  onAddDailyLog?: () => void;
  onChatAboutReport?: () => void;
  onRename?: (id: string, title: string) => Promise<void>;
  variant?: "embedded" | "full";
  loading?: boolean;
  operationBusy?: boolean;
}) {
  return (
    <ReportReader
      report={report}
      traceability={traceability}
      onCopy={onCopy}
      onExport={onExport}
      onGenerateCandidates={onGenerateCandidates}
      onOpenFindings={onOpenFindings}
      onAddDailyLog={onAddDailyLog}
      onChatAboutReport={onChatAboutReport}
      onRename={onRename}
      variant={variant}
      loading={loading}
      operationBusy={operationBusy}
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
