export function formatTime(value: string) {
  const trimmed = value.trim();
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const hasTimePart = /(?:T|\s+\d{2}:\d{2})/.test(trimmed);
  const normalized = hasTimePart && !hasTimeZone ? `${trimmed.replace(/\s+/, "T")}Z` : trimmed;

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(normalized));
}

export function modeLabel(mode: string) {
  const labels: Record<string, string> = {
    func_comment: "注释解析",
    func_design: "设计思路",
    func_optimize: "优化建议",
    func_knowledge: "知识点提炼",
    func_trace: "代码运行推演",
    script_structure: "结构分析",
    script_api: "接口整理",
    script_complexity: "复杂度分析",
    script_security: "安全检查",
    diff_overview: "整体对比",
    diff_approach: "实现思路",
    diff_performance: "性能对比",
    diff_quality: "质量对比"
  };
  return labels[mode] ?? mode;
}
