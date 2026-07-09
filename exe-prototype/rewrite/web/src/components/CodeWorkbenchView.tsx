import { AlertTriangle, Bot, CheckCircle2, Clipboard, Eraser, FileCode2, FolderOpen, GraduationCap, Loader2, MessageSquare, Play, Route, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import type { ReportDetail, ReportMetrics, TraceabilitySnapshot } from "../types";
import { ReportPanel } from "./ReportPanel";

const languages = ["auto", "Python", "TypeScript", "JavaScript", "Rust", "Java", "C/C++", "Plain Text"];
const modeGroups = [
  { value: "function", label: "函数分析" },
  { value: "script", label: "脚本分析" }
];
const reportModes: Record<string, Array<{ value: string; label: string; detail: string }>> = {
  function: [
    { value: "func_comment", label: "函数注释与意图解释", detail: "解释输入输出、关键分支和隐含业务规则。" },
    { value: "risk_review", label: "风险审查", detail: "优先检查异常处理、敏感信息和高风险调用。" },
    { value: "refactor", label: "重构建议", detail: "聚焦职责拆分、命名、复用和复杂度控制。" },
    { value: "test_plan", label: "测试建议", detail: "输出边界输入、失败路径和回归测试思路。" }
  ],
  script: [
    { value: "script_review", label: "脚本流程审查", detail: "检查执行顺序、资源释放和失败恢复。" },
    { value: "architecture", label: "结构与职责审查", detail: "识别模块边界、依赖方向和扩展风险。" },
    { value: "risk_review", label: "风险审查", detail: "检查命令执行、输入边界和敏感配置。" },
    { value: "test_plan", label: "测试建议", detail: "把脚本关键路径转成可验证清单。" }
  ]
};

export function CodeWorkbenchView(props: {
  title: string;
  language: string;
  modeGroup: string;
  mode: string;
  generateCards: boolean;
  code: string;
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  busy: boolean;
  onTitleChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onModeGroupChange: (value: string) => void;
  onModeChange: (value: string) => void;
  onGenerateCardsChange: (value: boolean) => void;
  onCodeChange: (value: string) => void;
  onImportFile: () => void;
  onLoadSample: () => void;
  onClear: () => void;
  onAnalyze: () => void;
  onCopyReport: () => void;
  onExportReport: (kind: "md" | "html") => void;
  onGenerateCandidates: () => void;
  onCreateAgentPlan: () => void;
  onOpenFindings: () => void;
  onAddDailyLog: () => void;
  onChatAboutReport: () => void;
}) {
  const metrics = estimateMetrics(props.code);
  const reviewHints = buildReviewHints(props.code, metrics);
  const modes = reportModes[props.modeGroup] || reportModes.function;
  const activeMode = modes.find((item) => item.value === props.mode) || modes[0];
  const readiness = buildSingleReadiness(props.code, metrics, props.report, props.traceability);
  const routeSteps = buildSingleRouteSteps(props.report, props.traceability);

  return (
    <section className="single-workbench-next">
      <aside className="single-workbench-editor-next">
        <div className="workbench-hero-next compact">
          <div>
            <span>单文件分析</span>
            <h3>代码工作台</h3>
            <p>粘贴片段或导入单个文件，先完成本地规则分析，再把报告继续送入问题、卡片、日志、对话和 Agent 闭环。</p>
          </div>
          <button className="primary-button" onClick={props.onAnalyze} disabled={props.busy || !props.code.trim()} type="button">
            {props.busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
            生成报告
          </button>
        </div>

        <div className="single-control-grid-next">
          <label>
            报告标题
            <input value={props.title} onChange={(event) => props.onTitleChange(event.target.value)} placeholder="例如：登录模块异常处理审查" />
          </label>
          <label>
            语言
            <select value={props.language} onChange={(event) => props.onLanguageChange(event.target.value)}>
              {languages.map((item) => <option key={item} value={item}>{item === "auto" ? "自动识别" : item}</option>)}
            </select>
          </label>
          <label>
            分析类型
            <select value={props.modeGroup} onChange={(event) => props.onModeGroupChange(event.target.value)}>
              {modeGroups.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            分析模式
            <select value={props.mode} onChange={(event) => props.onModeChange(event.target.value)}>
              {modes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        <section className="single-mode-card-next">
          <div>
            <span>当前模式</span>
            <strong>{activeMode.label}</strong>
            <p>{activeMode.detail}</p>
          </div>
          <label>
            <input checked={props.generateCards} onChange={(event) => props.onGenerateCardsChange(event.target.checked)} type="checkbox" />
            <span>报告生成后同步提取知识卡片候选</span>
          </label>
        </section>

        <section className="single-command-center-next">
          <article className="single-readiness-next">
            <span>输入成熟度</span>
            <strong>{readiness.score}</strong>
            <p>{readiness.label}</p>
            <div><i style={{ width: `${readiness.score}%` }} /></div>
          </article>
          <div className="single-command-grid-next">
            <CommandCard
              icon={<FileCode2 size={16} />}
              title="输入质量"
              detail={readiness.detail}
              state={props.code.trim() ? "ready" : "missing"}
            />
            <CommandCard
              icon={<ShieldAlert size={16} />}
              title="审查模式"
              detail={`${activeMode.label}：${activeMode.detail}`}
              state="ready"
            />
            <CommandCard
              icon={<GraduationCap size={16} />}
              title="学习沉淀"
              detail={props.generateCards ? "报告完成后会同步提取知识卡片候选。" : "可打开卡片候选开关，把高价值结论沉淀下来。"}
              state={props.generateCards ? "ready" : "warning"}
            />
            <CommandCard
              icon={<Bot size={16} />}
              title="下一步闭环"
              detail={props.report ? "报告已可进入问题、卡片、日志、对话和 Agent。" : "先生成报告，再继续进入项目审查闭环。"}
              state={props.report ? "ready" : "missing"}
            />
          </div>
        </section>

        <section className="single-route-board-next">
          <div className="section-title-next">
            <span><Route size={15} />分析闭环路线</span>
            <small>把一次代码分析推进成可复盘、可学习、可改进的记录</small>
          </div>
          <div className="single-route-steps-next">
            {routeSteps.map((step, index) => (
              <article className={step.done ? "done" : step.active ? "active" : ""} key={step.title}>
                <span>{step.done ? <CheckCircle2 size={15} /> : index + 1}</span>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </article>
            ))}
          </div>
          <div className="single-route-actions-next">
            <button onClick={props.onAnalyze} disabled={props.busy || !props.code.trim()} type="button"><Play size={15} />生成报告</button>
            <button onClick={props.onOpenFindings} disabled={!props.report} type="button"><ShieldAlert size={15} />问题清单</button>
            <button onClick={props.onGenerateCandidates} disabled={!props.report} type="button"><GraduationCap size={15} />卡片候选</button>
            <button onClick={props.onChatAboutReport} disabled={!props.report} type="button"><MessageSquare size={15} />围绕报告对话</button>
            <button onClick={props.onCreateAgentPlan} disabled={!props.report} type="button"><Bot size={15} />Agent 计划</button>
          </div>
        </section>

        <div className="single-editor-toolbar-next">
          <button className="secondary-button" onClick={props.onImportFile} type="button"><FolderOpen size={16} />导入文件</button>
          <button className="secondary-button" onClick={props.onLoadSample} type="button"><RotateCcw size={16} />载入示例</button>
          <button className="secondary-button" onClick={() => navigator.clipboard?.writeText(props.code)} disabled={!props.code.trim()} type="button"><Clipboard size={16} />复制代码</button>
          <button className="secondary-button" onClick={props.onClear} disabled={!props.code.trim()} type="button"><Eraser size={16} />清空</button>
        </div>

        <div className="single-code-frame-next">
          <div className="pane-title"><FileCode2 size={17} />待分析代码</div>
          <textarea
            spellCheck={false}
            value={props.code}
            onChange={(event) => props.onCodeChange(event.target.value)}
            placeholder="在这里粘贴需要分析的代码..."
          />
        </div>

        <div className="single-metric-strip-next">
          <Metric label="总行数" value={metrics.total_lines} />
          <Metric label="有效行" value={metrics.non_empty_lines} />
          <Metric label="注释行" value={metrics.comment_lines} />
          <Metric label="复杂度" value={metrics.complexity_score} />
        </div>

        <section className="single-review-hints-next">
          <span><Sparkles size={15} />本地预判</span>
          {reviewHints.map((hint) => <p key={hint}>{hint}</p>)}
        </section>
      </aside>

      <main className="single-workbench-report-next">
        <ReportPanel
          report={props.report}
          traceability={props.traceability}
          onCopy={props.onCopyReport}
          onExport={props.onExportReport}
          onGenerateCandidates={props.onGenerateCandidates}
          onCreateAgentPlan={props.onCreateAgentPlan}
          onOpenFindings={props.onOpenFindings}
          onAddDailyLog={props.onAddDailyLog}
          onChatAboutReport={props.onChatAboutReport}
        />
      </main>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function CommandCard({ icon, title, detail, state }: { icon: JSX.Element; title: string; detail: string; state: "ready" | "warning" | "missing" }) {
  return (
    <article className={state}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </article>
  );
}

function buildSingleReadiness(code: string, metrics: ReportMetrics, report: ReportDetail | null, traceability: TraceabilitySnapshot | null) {
  if (!code.trim()) {
    return {
      score: 0,
      label: "等待输入代码",
      detail: "粘贴代码或导入文件后，会先计算行数、复杂度和风险词。"
    };
  }
  const sizeScore = Math.min(28, Math.max(8, metrics.non_empty_lines));
  const complexityScore = metrics.complexity_score > 0 ? Math.min(18, metrics.complexity_score * 2) : 6;
  const reportScore = report ? 26 : 0;
  const traceCounts = traceability?.counts;
  const closureScore = traceCounts ? Math.min(28, (traceCounts.findings + traceCounts.cards + traceCounts.chats + traceCounts.daily_logs + traceCounts.agent_tasks) * 6) : 0;
  const score = Math.min(100, Math.round(sizeScore + complexityScore + reportScore + closureScore));
  const label = score >= 80 ? "已形成完整分析闭环" : score >= 55 ? "报告主线已启动" : score >= 28 ? "输入可分析，等待生成报告" : "输入较短，适合快速审查";
  const detail = report
    ? `当前报告包含 ${report.risks.length} 个风险、${report.suggestions.length} 条建议，可继续进入闭环。`
    : `${metrics.non_empty_lines} 行有效代码，复杂度 ${metrics.complexity_score}，建议先生成结构化报告。`;
  return { score, label, detail };
}

function buildSingleRouteSteps(report: ReportDetail | null, traceability: TraceabilitySnapshot | null) {
  const counts = traceability?.counts;
  return [
    {
      title: "输入代码",
      detail: "粘贴片段或导入单文件，先形成本地指标。",
      done: true,
      active: false
    },
    {
      title: "生成报告",
      detail: report ? "当前报告已生成，可以进入阅读和导出。" : "等待生成结构化报告。",
      done: Boolean(report),
      active: !report
    },
    {
      title: "拆成问题",
      detail: counts?.findings ? `${counts.findings} 个问题已关联。` : "把报告中的风险沉淀到问题清单。",
      done: Boolean(counts?.findings),
      active: Boolean(report && !counts?.findings)
    },
    {
      title: "学习与复盘",
      detail: counts ? `${counts.cards} 张卡片 / ${counts.daily_logs} 篇日志。` : "生成卡片并加入每日日志。",
      done: Boolean(counts && (counts.cards > 0 || counts.daily_logs > 0)),
      active: Boolean(report && counts && counts.findings > 0 && counts.cards + counts.daily_logs === 0)
    },
    {
      title: "Agent 改进",
      detail: counts?.agent_tasks ? `${counts.agent_tasks} 个计划已生成。` : "围绕报告生成可确认的改进计划。",
      done: Boolean(counts?.agent_tasks),
      active: Boolean(report && !counts?.agent_tasks)
    }
  ];
}

function estimateMetrics(code: string): ReportMetrics {
  const lines = code.split("\n");
  const normalized = code.toLowerCase();
  const complexityTokens = [" if ", " for ", " while ", " switch ", " match ", " catch ", " except ", "&&", "||", "?"];
  return {
    total_lines: code.trim() ? lines.length : 0,
    non_empty_lines: lines.filter((line) => line.trim()).length,
    comment_lines: lines.filter((line) => {
      const text = line.trimStart();
      return text.startsWith("//") || text.startsWith("#") || text.startsWith("/*") || text.startsWith("*");
    }).length,
    complexity_score: Math.max(0, complexityTokens.reduce((sum, token) => sum + normalized.split(token).length - 1, 0)),
    risk_count: 0,
    suggestion_count: 0
  };
}

function buildReviewHints(code: string, metrics: ReportMetrics) {
  if (!code.trim()) return ["等待输入代码后，会先给出本地复杂度、风险词和审查入口预判。"];
  const lower = code.toLowerCase();
  const hints = [];
  if (metrics.complexity_score > 8) hints.push("分支和控制流较密集，建议优先拆分路径并补充回归测试。");
  if (lower.includes("todo") || lower.includes("fixme")) hints.push("检测到 TODO/FIXME，建议确认是否影响当前交付。");
  if (lower.includes("password") || lower.includes("api_key") || lower.includes("secret")) hints.push("检测到疑似敏感字段，注意不要在日志、报告或仓库中暴露密钥。");
  if (lower.includes("innerhtml") || lower.includes("eval(") || lower.includes("exec(")) hints.push("检测到高风险动态执行或 DOM 写入模式，建议重点审查输入边界。");
  if (hints.length === 0) hints.push("暂未发现明显高风险词，建议继续检查异常处理、边界输入和测试覆盖。");
  return hints.slice(0, 4);
}
