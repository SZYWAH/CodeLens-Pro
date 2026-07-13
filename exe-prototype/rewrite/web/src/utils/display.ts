import type { Finding, ReportSummary, WorkspaceDetail, WorkspaceSummary } from "../types";

export const languageOptions = ["auto", "Python", "TypeScript", "JavaScript", "Rust", "Java", "C/C++", "Go", "Markdown", "Plain Text"];

export function sourceLabel(value: string) {
  const labels: Record<string, string> = { local: "本地分析", local_fallback: "本地兜底", llm: "LLM" };
  return labels[value] || value;
}

export function typeLabel(value: string) {
  const labels: Record<string, string> = { single: "单文件", project: "项目", diff: "代码对比", chat: "对话关联" };
  return labels[value] || value;
}

export function languageLabel(value: string) {
  const labels: Record<string, string> = {
    auto: "自动",
    "Plain Text": "纯文本",
    Markdown: "Markdown"
  };
  return labels[value] || value;
}

export function severityLabel(value: string) {
  const labels: Record<string, string> = { high: "高风险", medium: "中风险", low: "低风险", info: "提示" };
  return labels[value] || value;
}

export function roleLabel(value: string) {
  const labels: Record<string, string> = { user: "我", assistant: "助手", system: "系统" };
  return labels[value] || value;
}

export function formatTime(value: string) {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function countLines(value: string) {
  if (!value.trim()) return 0;
  return value.split(/\r?\n/).length;
}

export function reportLibraryStats(reports: ReportSummary[]) {
  return reports.reduce(
    (stats, report) => {
      stats.total += 1;
      if (report.report_type === "project") stats.project += 1;
      if (report.report_type === "diff") stats.diff += 1;
      if (report.risk_level === "high") stats.high += 1;
      return stats;
    },
    { total: 0, project: 0, diff: 0, high: 0 }
  );
}

export function describeContext(context: string, workspaces: WorkspaceSummary[], workspace: WorkspaceDetail | null, findings: Finding[], reports: ReportSummary[]) {
  const [kind, rawId = ""] = context.split("|", 2);
  if (!kind || kind === "none") return "无上下文，将作为通用开发问答处理";
  if (kind === "workspace") return `工作区：${workspaces.find((item) => item.id === rawId)?.name || "当前工作区"}`;
  if (kind === "file") {
    const path = rawId.includes("::") ? rawId.split("::").slice(1).join("::") : rawId;
    const file = workspace?.files.find((item) => item.path === path);
    return `文件：${file?.path || path || "当前文件"}`;
  }
  if (kind === "finding") return `问题：${findings.find((item) => item.id === rawId)?.title || "当前问题"}`;
  if (kind === "report") return `报告：${reports.find((item) => item.id === rawId)?.title || "当前报告"}`;
  if (kind === "agent_task") return "行动草稿：当前选中任务";
  return context;
}
