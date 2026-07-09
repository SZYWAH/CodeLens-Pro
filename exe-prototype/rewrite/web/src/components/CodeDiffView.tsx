import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  FileText,
  FileWarning,
  GitCompare,
  GraduationCap,
  Loader2,
  MessageSquare,
  Minus,
  Play,
  Plus,
  ShieldAlert,
  Upload
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import type { ReportDetail, TraceabilitySnapshot } from "../types";
import { countLines, languageLabel, languageOptions } from "../utils/display";
import { ReportPanel, StreamPanel } from "./ReportPanel";

export function CodeDiffView(props: {
  title: string;
  language: string;
  beforeLabel: string;
  afterLabel: string;
  beforeCode: string;
  afterCode: string;
  stream: string;
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  busy: boolean;
  onTitleChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onBeforeLabelChange: (value: string) => void;
  onAfterLabelChange: (value: string) => void;
  onBeforeCodeChange: (value: string) => void;
  onAfterCodeChange: (value: string) => void;
  onImportBefore: () => void;
  onImportAfter: () => void;
  onAnalyze: () => void;
  onCopyReport: () => void;
  onExportReport: (kind: "md" | "html") => void;
  onGenerateCandidates: () => void;
  onCreateAgentPlan: () => void;
  onOpenFindings: () => void;
  onAddDailyLog: () => void;
  onChatAboutReport: () => void;
}) {
  const beforeLines = countLines(props.beforeCode);
  const afterLines = countLines(props.afterCode);
  const delta = afterLines - beforeLines;
  const diffStats = useMemo(() => buildDiffStats(props.beforeCode, props.afterCode), [props.afterCode, props.beforeCode]);
  const impactProfile = useMemo(() => buildDiffImpactProfile(diffStats, beforeLines, afterLines, props.report), [afterLines, beforeLines, diffStats, props.report]);
  const focusItems = buildReviewFocus(diffStats, props.language);

  return (
    <section className="diff-page-next">
      <div className="diff-hero-next">
        <div>
          <span>代码对比</span>
          <h3>代码变更审查</h3>
          <p>对比两个版本，生成风险、维护性影响、测试建议和后续 Agent 计划。</p>
        </div>
        <div className="diff-stats-next">
          <small>旧版本 <strong>{beforeLines}</strong></small>
          <small>新版本 <strong>{afterLines}</strong></small>
          <small>变化 <strong>{delta >= 0 ? `+${delta}` : delta}</strong></small>
        </div>
      </div>
      <section className="diff-review-board-next">
        <div className="diff-review-head-next">
          <div>
            <span><GitCompare size={15} />变更审查工作台</span>
            <h4>{diffStats.tone === "empty" ? "等待输入两个版本" : `${diffToneLabel(diffStats.tone)}变更`}</h4>
            <p>先用本地规则查看变更规模、可疑切片和审查重点，再生成完整报告并进入问题、卡片、对话和 Agent 闭环。</p>
          </div>
          <strong>{diffStats.changed + diffStats.added + diffStats.removed}</strong>
        </div>
        <div className="diff-radar-next">
          <DiffRadarCard icon={<Plus size={16} />} label="新增" value={diffStats.added} tone="add" />
          <DiffRadarCard icon={<Minus size={16} />} label="删除" value={diffStats.removed} tone="remove" />
          <DiffRadarCard icon={<Activity size={16} />} label="变更" value={diffStats.changed} tone="change" />
          <DiffRadarCard icon={<CheckCircle2 size={16} />} label="相同" value={diffStats.same} tone="same" />
        </div>
        <div className="diff-review-flow-next">
          {["输入版本", "变更雷达", "风险报告", "闭环沉淀"].map((item, index) => (
            <div key={item}>
              <span>{index + 1}</span>
              <strong>{item}</strong>
              {index < 3 && <ArrowRight size={14} />}
            </div>
          ))}
        </div>
        <div className="diff-focus-next">
          <strong><FileWarning size={15} />审查重点</strong>
          {focusItems.map((item) => <p key={item}>{item}</p>)}
        </div>
      </section>
      <DiffImpactMatrix
        impact={impactProfile}
        report={props.report}
        busy={props.busy}
        canAnalyze={Boolean(props.beforeCode.trim() && props.afterCode.trim())}
        onAnalyze={props.onAnalyze}
        onOpenFindings={props.onOpenFindings}
        onGenerateCandidates={props.onGenerateCandidates}
        onChatAboutReport={props.onChatAboutReport}
        onCreateAgentPlan={props.onCreateAgentPlan}
        onAddDailyLog={props.onAddDailyLog}
      />
      <div className="control-panel">
        <div className="three-fields">
          <label>
            报告标题
            <input value={props.title} onChange={(event) => props.onTitleChange(event.target.value)} />
          </label>
          <label>
            语言
            <select value={props.language} onChange={(event) => props.onLanguageChange(event.target.value)}>
              {languageOptions.map((item) => <option key={item} value={item}>{languageLabel(item)}</option>)}
            </select>
          </label>
          <div className="button-row end">
            <button className="primary-button" disabled={props.busy} onClick={props.onAnalyze}>
              {props.busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              分析差异
            </button>
          </div>
        </div>
      </div>
      <div className="diff-columns diff-columns-next">
        <div className="diff-editor">
          <div className="pane-title">
            <input value={props.beforeLabel} onChange={(event) => props.onBeforeLabelChange(event.target.value)} />
            <button className="mini-button" onClick={props.onImportBefore}><Upload size={16} />导入文件</button>
          </div>
          <textarea value={props.beforeCode} onChange={(event) => props.onBeforeCodeChange(event.target.value)} spellCheck={false} />
        </div>
        <div className="diff-editor">
          <div className="pane-title">
            <input value={props.afterLabel} onChange={(event) => props.onAfterLabelChange(event.target.value)} />
            <button className="mini-button" onClick={props.onImportAfter}><Upload size={16} />导入文件</button>
          </div>
          <textarea value={props.afterCode} onChange={(event) => props.onAfterCodeChange(event.target.value)} spellCheck={false} />
        </div>
      </div>
      <section className="diff-preview-next">
        <div className="section-title-next">
          <span>变更切片</span>
          <h3>对比结果</h3>
        </div>
        <div className="diff-preview-list-next">
          {diffStats.preview.map((item) => (
            <article className={`diff-preview-item-next ${item.kind}`} key={`${item.kind}-${item.line}-${item.text}`}>
              <span>{diffKindIcon(item.kind)}</span>
              <strong>{item.lineLabel}</strong>
              <code>{item.text || "空行"}</code>
            </article>
          ))}
          {diffStats.preview.length === 0 && <p className="muted">两个版本暂无可展示的差异。</p>}
        </div>
      </section>
      {props.busy || props.stream ? (
        <StreamPanel title="正在流式生成对比报告" value={props.stream} busy={props.busy} />
      ) : (
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
      )}
    </section>
  );
}

function DiffRadarCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: string }) {
  return (
    <article className={`diff-radar-card-next ${tone}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DiffImpactMatrix({
  impact,
  report,
  busy,
  canAnalyze,
  onAnalyze,
  onOpenFindings,
  onGenerateCandidates,
  onChatAboutReport,
  onCreateAgentPlan,
  onAddDailyLog
}: {
  impact: DiffImpactProfile;
  report: ReportDetail | null;
  busy: boolean;
  canAnalyze: boolean;
  onAnalyze: () => void;
  onOpenFindings: () => void;
  onGenerateCandidates: () => void;
  onChatAboutReport: () => void;
  onCreateAgentPlan: () => void;
  onAddDailyLog: () => void;
}) {
  const hasReport = Boolean(report);
  const actions = [
    {
      label: hasReport ? "重新生成报告" : "生成对比报告",
      detail: hasReport ? "刷新风险、维护性和测试建议" : "先把本地预判转成正式报告",
      icon: busy ? <Loader2 className="spin" size={15} /> : <Play size={15} />,
      onClick: onAnalyze,
      disabled: busy || !canAnalyze,
      ready: hasReport
    },
    {
      label: "关联问题清单",
      detail: "把变更风险拆成可跟踪项",
      icon: <ShieldAlert size={15} />,
      onClick: onOpenFindings,
      disabled: !hasReport,
      ready: Boolean(report?.metrics.risk_count)
    },
    {
      label: "沉淀知识卡片",
      detail: "记录变更背后的规则和经验",
      icon: <GraduationCap size={15} />,
      onClick: onGenerateCandidates,
      disabled: !hasReport,
      ready: false
    },
    {
      label: "围绕差异对话",
      detail: "追问替代实现和边界条件",
      icon: <MessageSquare size={15} />,
      onClick: onChatAboutReport,
      disabled: !hasReport,
      ready: false
    },
    {
      label: "生成 Agent 计划",
      detail: "把修复和验证拆成步骤",
      icon: <Bot size={15} />,
      onClick: onCreateAgentPlan,
      disabled: !hasReport,
      ready: false
    },
    {
      label: "写入每日日志",
      detail: "把审查结论纳入复盘",
      icon: <FileText size={15} />,
      onClick: onAddDailyLog,
      disabled: !hasReport,
      ready: false
    }
  ];

  return (
    <section className="diff-impact-matrix-next">
      <div className="diff-impact-head-next">
        <div>
          <span><AlertTriangle size={15} />变更影响矩阵</span>
          <h4>{impact.label}</h4>
          <p>{impact.detail}</p>
        </div>
        <div className={`diff-impact-score-next ${impact.tone}`}>
          <strong>{impact.score}</strong>
          <small>影响评分</small>
        </div>
      </div>

      <div className="diff-impact-grid-next">
        {impact.items.map((item) => (
          <article className={item.state} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>

      <div className="diff-impact-checklist-next">
        <strong><FileWarning size={15} />审查检查项</strong>
        {impact.checks.map((item) => (
          <p key={item}><CheckCircle2 size={14} />{item}</p>
        ))}
      </div>

      <div className="diff-impact-actions-next">
        {actions.map((item) => (
          <button className={item.ready ? "ready" : ""} disabled={item.disabled} key={item.label} onClick={item.onClick} type="button">
            <span>{item.icon}</span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

type DiffPreviewItem = {
  kind: "added" | "removed" | "changed";
  line: number;
  lineLabel: string;
  text: string;
};

type DiffStats = {
  added: number;
  removed: number;
  changed: number;
  same: number;
  tone: "empty" | "small" | "medium" | "large";
  preview: DiffPreviewItem[];
};

type DiffImpactProfile = {
  tone: "empty" | "low" | "medium" | "high";
  label: string;
  detail: string;
  score: number;
  items: Array<{ label: string; value: string; detail: string; state: "good" | "warn" | "danger" }>;
  checks: string[];
};

function buildDiffStats(beforeCode: string, afterCode: string): DiffStats {
  const before = splitLines(beforeCode);
  const after = splitLines(afterCode);
  const beforeBag = lineBag(before);
  const afterBag = lineBag(after);
  let added = 0;
  let removed = 0;
  let changed = 0;
  let same = 0;
  const preview: DiffPreviewItem[] = [];
  const max = Math.max(before.length, after.length);

  for (let index = 0; index < max; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left === right && typeof left === "string") {
      same += 1;
      continue;
    }
    if (typeof left === "undefined" && typeof right === "string") {
      added += 1;
      pushPreview(preview, "added", index + 1, `新 ${index + 1}`, right);
      continue;
    }
    if (typeof right === "undefined" && typeof left === "string") {
      removed += 1;
      pushPreview(preview, "removed", index + 1, `旧 ${index + 1}`, left);
      continue;
    }
    if (typeof left === "string" && typeof right === "string") {
      const normalizedLeft = normalizeLine(left);
      const normalizedRight = normalizeLine(right);
      if (normalizedLeft === normalizedRight) {
        same += 1;
      } else if (!beforeBag.has(normalizedRight)) {
        added += 1;
        pushPreview(preview, "added", index + 1, `新 ${index + 1}`, right);
      } else if (!afterBag.has(normalizedLeft)) {
        removed += 1;
        pushPreview(preview, "removed", index + 1, `旧 ${index + 1}`, left);
      } else {
        changed += 1;
        pushPreview(preview, "changed", index + 1, `${index + 1}`, `${left.trim()}  →  ${right.trim()}`);
      }
    }
  }

  const total = added + removed + changed;
  const tone = total === 0 ? "empty" : total >= 24 || Math.abs(after.length - before.length) >= 16 ? "large" : total >= 8 ? "medium" : "small";
  return { added, removed, changed, same, tone, preview };
}

function buildDiffImpactProfile(stats: DiffStats, beforeLines: number, afterLines: number, report: ReportDetail | null): DiffImpactProfile {
  const changedTotal = stats.added + stats.removed + stats.changed;
  const baseLines = Math.max(beforeLines, afterLines, 1);
  const changeRatio = Math.round((changedTotal / baseLines) * 100);
  const lineDelta = afterLines - beforeLines;
  const reportRiskBonus = report?.risk_level === "high" ? 24 : report?.risk_level === "medium" ? 12 : report?.metrics.risk_count ? 8 : 0;
  const score = Math.min(100, Math.round(changeRatio * 0.7 + stats.removed * 1.8 + stats.changed * 1.2 + Math.abs(lineDelta) * 0.9 + reportRiskBonus));
  const tone: DiffImpactProfile["tone"] = changedTotal === 0 ? "empty" : score >= 68 ? "high" : score >= 36 ? "medium" : "low";
  const label = tone === "empty" ? "等待形成可审查变更" : tone === "high" ? "高影响变更" : tone === "medium" ? "中影响变更" : "低影响变更";
  const detail = tone === "empty"
    ? "当前两个版本没有可展示的差异，建议先导入或粘贴真实变更。"
    : tone === "high"
      ? "变更规模或删除比例偏高，建议先生成报告，再拆成问题清单和 Agent 计划。"
      : tone === "medium"
        ? "变更具备一定维护性影响，适合生成报告并补充测试建议。"
        : "变更规模较小，仍建议确认边界条件、回归测试和日志记录。";

  const items: DiffImpactProfile["items"] = [
    {
      label: "变更占比",
      value: `${changeRatio}%`,
      detail: changedTotal > 0 ? `共 ${changedTotal} 行新增、删除或修改。` : "还没有检测到有效变更。",
      state: changeRatio >= 45 ? "danger" : changeRatio >= 18 ? "warn" : "good"
    },
    {
      label: "行数变化",
      value: lineDelta >= 0 ? `+${lineDelta}` : `${lineDelta}`,
      detail: lineDelta > 0 ? "新版本体量增加，重点检查新增路径和异常处理。" : lineDelta < 0 ? "新版本体量减少，重点确认兼容逻辑没有被误删。" : "整体行数稳定，重点检查语义变化。",
      state: Math.abs(lineDelta) >= 16 ? "danger" : Math.abs(lineDelta) >= 6 ? "warn" : "good"
    },
    {
      label: "删除敏感度",
      value: `${stats.removed} 行`,
      detail: stats.removed > 0 ? "删除内容可能影响兼容性、边界条件或旧流程。" : "没有明显删除内容。",
      state: stats.removed >= 10 ? "danger" : stats.removed >= 3 ? "warn" : "good"
    },
    {
      label: "报告闭环",
      value: report ? "已生成" : "未生成",
      detail: report ? `${report.metrics.risk_count} 个风险 / ${report.metrics.suggestion_count} 条建议已进入报告。` : "生成报告后才能继续进入问题、卡片、对话、Agent 和日志。",
      state: report ? "good" : changedTotal > 0 ? "warn" : "good"
    }
  ];

  const checks = [
    stats.added > 0 ? "新增逻辑是否覆盖空值、异常输入和默认路径。" : "确认是否真的没有新增行为入口。",
    stats.removed > 0 ? "删除逻辑是否影响兼容流程、旧配置或已有数据。" : "确认旧版本关键路径是否仍然保留。",
    stats.changed > 0 ? "修改行是否改变返回值、状态更新、权限判断或副作用。" : "如果只是新增/删除，也要确认调用方是否同步调整。",
    report ? "对比报告已生成，可以继续沉淀问题、卡片、对话、Agent 和日志。" : "先生成正式对比报告，再进入审查闭环。"
  ];

  return { tone, label, detail, score, items, checks };
}

function splitLines(value: string) {
  if (!value.trim()) return [];
  return value.replace(/\r\n/g, "\n").split("\n");
}

function lineBag(lines: string[]) {
  return new Set(lines.map(normalizeLine).filter(Boolean));
}

function normalizeLine(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function pushPreview(preview: DiffPreviewItem[], kind: DiffPreviewItem["kind"], line: number, lineLabel: string, text: string) {
  if (preview.length >= 12) return;
  preview.push({ kind, line, lineLabel, text: text.trim() });
}

function buildReviewFocus(stats: DiffStats, language: string) {
  if (stats.tone === "empty") {
    return ["两个版本还没有明显差异，可以导入文件或粘贴代码后再生成审查报告。"];
  }
  const items = [];
  if (stats.added > 0) items.push(`新增 ${stats.added} 行：重点检查输入校验、异常处理和测试覆盖。`);
  if (stats.removed > 0) items.push(`删除 ${stats.removed} 行：确认没有移除必要的边界处理或兼容逻辑。`);
  if (stats.changed > 0) items.push(`修改 ${stats.changed} 行：优先复查控制流、状态更新和返回值变化。`);
  if (stats.tone === "large") items.push("变更规模偏大：建议拆分审查，先看核心路径，再让 Agent 生成分步计划。");
  if (language !== "auto") items.push(`${languageLabel(language)} 场景：报告会结合语言特征补充维护性建议。`);
  return items.slice(0, 5);
}

function diffToneLabel(value: DiffStats["tone"]) {
  const labels: Record<DiffStats["tone"], string> = {
    empty: "无",
    small: "小规模",
    medium: "中等规模",
    large: "大规模"
  };
  return labels[value];
}

function diffKindIcon(kind: DiffPreviewItem["kind"]) {
  if (kind === "added") return <Plus size={14} />;
  if (kind === "removed") return <Minus size={14} />;
  return <AlertTriangle size={14} />;
}
