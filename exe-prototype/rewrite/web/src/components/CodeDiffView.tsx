import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  FileWarning,
  GitCompare,
  ListChecks,
  Loader2,
  Minus,
  Play,
  Plus,
  Upload
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { countLines, languageLabel, languageOptions } from "../utils/display";
import { ProductToolbar } from "./ProductShell";

const diffSplitStorageKey = "codelens.diff.editorSplit";

export function CodeDiffView(props: {
  title: string;
  language: string;
  beforeLabel: string;
  afterLabel: string;
  beforeCode: string;
  afterCode: string;
  stream: string;
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
}) {
  const splitRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef({ clientX: 0, splitPercent: 50 });
  const summaryId = useId().replace(/:/g, "");
  const summaryToggleId = `diff-summary-toggle-${summaryId}`;
  const summaryBodyId = `diff-summary-body-${summaryId}`;
  const [splitPercent, setSplitPercent] = useState(() => {
    if (typeof window === "undefined") return 50;
    const stored = Number(window.localStorage.getItem(diffSplitStorageKey));
    return Number.isFinite(stored) ? clampSplit(stored) : 50;
  });
  const [resizing, setResizing] = useState(false);
  const [mobilePane, setMobilePane] = useState<"before" | "after">("before");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const beforeLines = countLines(props.beforeCode);
  const afterLines = countLines(props.afterCode);
  const diffStats = useMemo(() => buildDiffStats(props.beforeCode, props.afterCode), [props.afterCode, props.beforeCode]);
  const impact = useMemo(() => buildDiffImpactProfile(diffStats, beforeLines, afterLines), [afterLines, beforeLines, diffStats]);
  const focusItems = useMemo(() => buildReviewFocus(diffStats, props.language), [diffStats, props.language]);
  const changedTotal = diffStats.added + diffStats.removed + diffStats.changed;
  const canAnalyze = Boolean(props.beforeCode.trim() && props.afterCode.trim());

  useEffect(() => {
    window.localStorage.setItem(diffSplitStorageKey, String(splitPercent));
  }, [splitPercent]);

  useEffect(() => {
    if (!resizing) return;

    function onPointerMove(event: PointerEvent) {
      const container = splitRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (!rect.width) return;
      const deltaPercent = ((event.clientX - dragStartRef.current.clientX) / rect.width) * 100;
      setSplitPercent(clampSplit(dragStartRef.current.splitPercent + deltaPercent));
    }

    function stopResizing() {
      setResizing(false);
    }

    document.body.classList.add("is-resizing-diff-v133");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      document.body.classList.remove("is-resizing-diff-v133");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [resizing]);

  function swapVersions() {
    if (props.busy) return;
    const nextBeforeLabel = props.afterLabel;
    const nextBeforeCode = props.afterCode;
    props.onAfterLabelChange(props.beforeLabel);
    props.onAfterCodeChange(props.beforeCode);
    props.onBeforeLabelChange(nextBeforeLabel);
    props.onBeforeCodeChange(nextBeforeCode);
  }

  function adjustSplit(delta: number) {
    setSplitPercent((current) => clampSplit(current + delta));
  }

  const splitStyle = { "--diff-editor-split": `${splitPercent}%` } as CSSProperties;

  return (
    <section className={`diff-workspace-v133 ${summaryOpen ? "is-summary-open" : ""}`}>
      <ProductToolbar>
        <div className="diff-toolbar-title-v133 product-toolbar-field-next">
          <GitCompare size={16} />
          <label>
            <span>报告标题</span>
            <input value={props.title} onChange={(event) => props.onTitleChange(event.target.value)} disabled={props.busy} />
          </label>
        </div>
        <div className="diff-toolbar-actions-v133 product-toolbar-actions-next">
          <label>
            <span>语言</span>
            <select value={props.language} onChange={(event) => props.onLanguageChange(event.target.value)} disabled={props.busy}>
              {languageOptions.map((item) => <option key={item} value={item}>{languageLabel(item)}</option>)}
            </select>
          </label>
          <button className="icon-button" onClick={swapVersions} disabled={props.busy} aria-label="交换旧版和新版" title="交换版本" type="button"><ArrowLeftRight size={16} /></button>
          <button className="primary-button" disabled={props.busy || !canAnalyze} onClick={props.onAnalyze} type="button">
            {props.busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}{props.busy ? "正在生成" : "生成对比报告"}
          </button>
        </div>
      </ProductToolbar>

      <div className="diff-mobile-config-v151" aria-label="代码对比配置">
        <label>
          <span>报告标题</span>
          <input value={props.title} onChange={(event) => props.onTitleChange(event.target.value)} disabled={props.busy} />
        </label>
        <label>
          <span>语言</span>
          <select value={props.language} onChange={(event) => props.onLanguageChange(event.target.value)} disabled={props.busy}>
            {languageOptions.map((item) => <option key={item} value={item}>{languageLabel(item)}</option>)}
          </select>
        </label>
      </div>

      {props.busy && (
        <section className="diff-generation-v133" aria-live="polite">
          <Loader2 className="spin" size={16} />
          <div><strong>正在生成代码对比报告</strong><span>{latestStreamMessage(props.stream)}</span></div>
        </section>
      )}

      <dl className="diff-status-v133">
        <StatusMetric label="旧版行数" value={beforeLines} />
        <StatusMetric label="新版行数" value={afterLines} />
        <StatusMetric label="新增" value={diffStats.added} tone="add" />
        <StatusMetric label="删除" value={diffStats.removed} tone="remove" />
        <StatusMetric label="修改" value={diffStats.changed} tone="change" />
        <StatusMetric label="影响" value={impact.label} tone={impact.tone} />
      </dl>

      <div className="diff-mobile-tabs-v133" role="tablist" aria-label="代码版本">
        <button className={mobilePane === "before" ? "active" : ""} onClick={() => setMobilePane("before")} role="tab" aria-selected={mobilePane === "before"} type="button">旧版本</button>
        <button className={mobilePane === "after" ? "active" : ""} onClick={() => setMobilePane("after")} role="tab" aria-selected={mobilePane === "after"} type="button">新版本</button>
      </div>

      <div className="diff-editor-split-v133" ref={splitRef} style={splitStyle}>
        <DiffEditor
          active={mobilePane === "before"}
          code={props.beforeCode}
          disabled={props.busy}
          label={props.beforeLabel}
          side="before"
          onCodeChange={props.onBeforeCodeChange}
          onImport={props.onImportBefore}
          onLabelChange={props.onBeforeLabelChange}
        />
        <button
          className="diff-editor-resizer-v133"
          aria-label="调整旧版和新版编辑器宽度"
          aria-orientation="vertical"
          aria-valuemax={68}
          aria-valuemin={32}
          aria-valuenow={Math.round(splitPercent)}
          onDoubleClick={() => setSplitPercent(50)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              adjustSplit(-2);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              adjustSplit(2);
            } else if (event.key === "Home") {
              event.preventDefault();
              setSplitPercent(50);
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            dragStartRef.current = { clientX: event.clientX, splitPercent };
            setResizing(true);
          }}
          role="separator"
          title="拖拽调整宽度，双击恢复等宽"
          type="button"
        ><span /></button>
        <DiffEditor
          active={mobilePane === "after"}
          code={props.afterCode}
          disabled={props.busy}
          label={props.afterLabel}
          side="after"
          onCodeChange={props.onAfterCodeChange}
          onImport={props.onImportAfter}
          onLabelChange={props.onAfterLabelChange}
        />
      </div>

      <section className="diff-summary-v133">
        <button
          aria-controls={summaryBodyId}
          aria-expanded={summaryOpen}
          className="diff-summary-toggle-v133"
          id={summaryToggleId}
          onClick={() => setSummaryOpen((current) => !current)}
          type="button"
        >
          <span><ChevronDown size={15} /><strong>本地变更摘要</strong><small>{changedTotal ? `${changedTotal} 行变化 · ${impact.label}` : "暂未检测到变化"}</small></span>
          <span><small>{summaryOpen ? "收起" : "展开"}</small><strong>{impact.score}</strong></span>
        </button>
        <div
          aria-labelledby={summaryToggleId}
          className="diff-summary-body-v133"
          hidden={!summaryOpen}
          id={summaryBodyId}
          role="region"
          tabIndex={summaryOpen ? 0 : -1}
        >
          <section className="diff-summary-preview-v133">
            <header><FileWarning size={15} /><strong>变更切片</strong><small>最多 12 条</small></header>
            <div>
              {diffStats.preview.map((item) => (
                <div className={item.kind} key={`${item.kind}-${item.line}-${item.text}`}>
                  <span>{diffKindIcon(item.kind)}</span><strong>{item.lineLabel}</strong><code>{item.text || "空行"}</code>
                </div>
              ))}
              {diffStats.preview.length === 0 && <p>两个版本暂无可展示的差异。</p>}
            </div>
          </section>
          <section className="diff-summary-review-v133">
            <div className="diff-summary-focus-v133">
              <header><AlertTriangle size={15} /><strong>审查重点</strong></header>
              {focusItems.map((item) => <p key={item}>{item}</p>)}
            </div>
            <dl className="diff-summary-impact-v133">
              {impact.items.map((item) => <div className={item.state} key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd><small>{item.detail}</small></div>)}
            </dl>
            <div className="diff-summary-checks-v133">
              <header><ListChecks size={15} /><strong>检查项</strong></header>
              {impact.checks.map((item) => <p key={item}><CheckCircle2 size={13} />{item}</p>)}
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}

function DiffEditor({
  active,
  code,
  disabled,
  label,
  side,
  onCodeChange,
  onImport,
  onLabelChange
}: {
  active: boolean;
  code: string;
  disabled: boolean;
  label: string;
  side: "before" | "after";
  onCodeChange: (value: string) => void;
  onImport: () => void;
  onLabelChange: (value: string) => void;
}) {
  const versionName = side === "before" ? "旧版本" : "新版本";
  return (
    <section className={`diff-editor-v133 ${side} ${active ? "is-mobile-active" : ""}`}>
      <header>
        <span>{side === "before" ? <Minus size={14} /> : <Plus size={14} />}{versionName}</span>
        <input aria-label={`${versionName}标签`} value={label} onChange={(event) => onLabelChange(event.target.value)} disabled={disabled} />
        <button className="icon-button" onClick={onImport} disabled={disabled} aria-label={`导入${versionName}文件`} title={`导入${versionName}文件`} type="button"><Upload size={15} /></button>
      </header>
      <textarea aria-label={`${versionName}代码`} value={code} onChange={(event) => onCodeChange(event.target.value)} disabled={disabled} spellCheck={false} />
    </section>
  );
}

function StatusMetric({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return <div className={tone}><dt>{label}</dt><dd>{value}</dd></div>;
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

function buildDiffImpactProfile(stats: DiffStats, beforeLines: number, afterLines: number): DiffImpactProfile {
  const changedTotal = stats.added + stats.removed + stats.changed;
  const baseLines = Math.max(beforeLines, afterLines, 1);
  const changeRatio = Math.round((changedTotal / baseLines) * 100);
  const lineDelta = afterLines - beforeLines;
  const score = Math.min(100, Math.round(changeRatio * 0.72 + stats.removed * 1.8 + stats.changed * 1.2 + Math.abs(lineDelta) * 0.9));
  const tone: DiffImpactProfile["tone"] = changedTotal === 0 ? "empty" : score >= 68 ? "high" : score >= 36 ? "medium" : "low";
  const label = tone === "empty" ? "等待变更" : tone === "high" ? "高影响" : tone === "medium" ? "中影响" : "低影响";
  const detail = tone === "empty"
    ? "当前两个版本没有可展示的差异。"
    : tone === "high"
      ? "变更规模或删除比例偏高，建议生成正式报告后逐项复查。"
      : tone === "medium"
        ? "变更具备一定维护性影响，适合补充测试和边界检查。"
        : "变更规模较小，仍需确认边界条件和回归测试。";
  const items: DiffImpactProfile["items"] = [
    { label: "变更占比", value: `${changeRatio}%`, detail: changedTotal ? `共 ${changedTotal} 行新增、删除或修改。` : "还没有检测到有效变更。", state: changeRatio >= 45 ? "danger" : changeRatio >= 18 ? "warn" : "good" },
    { label: "行数变化", value: lineDelta >= 0 ? `+${lineDelta}` : `${lineDelta}`, detail: lineDelta > 0 ? "重点检查新增路径和异常处理。" : lineDelta < 0 ? "确认兼容逻辑没有被误删。" : "整体行数稳定，重点检查语义变化。", state: Math.abs(lineDelta) >= 16 ? "danger" : Math.abs(lineDelta) >= 6 ? "warn" : "good" },
    { label: "删除敏感度", value: `${stats.removed} 行`, detail: stats.removed ? "删除内容可能影响兼容性和旧流程。" : "没有明显删除内容。", state: stats.removed >= 10 ? "danger" : stats.removed >= 3 ? "warn" : "good" },
    { label: "审查准备", value: changedTotal ? "可生成" : "待输入", detail: changedTotal ? "本地摘要已形成，可以生成正式报告。" : "先提供两个存在差异的版本。", state: changedTotal ? "good" : "warn" }
  ];
  const checks = [
    stats.added > 0 ? "新增逻辑是否覆盖空值、异常输入和默认路径。" : "确认是否真的没有新增行为入口。",
    stats.removed > 0 ? "删除逻辑是否影响兼容流程、旧配置或已有数据。" : "确认旧版本关键路径是否仍然保留。",
    stats.changed > 0 ? "修改行是否改变返回值、状态更新、权限判断或副作用。" : "如果只是新增或删除，也要确认调用方同步调整。"
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
  if (stats.tone === "empty") return ["两个版本还没有明显差异，可以导入文件或粘贴代码后再生成报告。"];
  const items = [];
  if (stats.added > 0) items.push(`新增 ${stats.added} 行：重点检查输入校验、异常处理和测试覆盖。`);
  if (stats.removed > 0) items.push(`删除 ${stats.removed} 行：确认没有移除必要的边界处理或兼容逻辑。`);
  if (stats.changed > 0) items.push(`修改 ${stats.changed} 行：优先复查控制流、状态更新和返回值变化。`);
  if (stats.tone === "large") items.push("变更规模偏大：建议拆分审查，先处理核心路径。");
  if (language !== "auto") items.push(`${languageLabel(language)} 场景：正式报告会结合语言特征补充维护性建议。`);
  return items.slice(0, 5);
}

function diffKindIcon(kind: DiffPreviewItem["kind"]) {
  if (kind === "added") return <Plus size={13} />;
  if (kind === "removed") return <Minus size={13} />;
  return <Activity size={13} />;
}

function clampSplit(value: number) {
  return Math.min(68, Math.max(32, Number(value.toFixed(1))));
}

function latestStreamMessage(stream: string) {
  const lines = stream.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const latest = lines[lines.length - 1] || "正在整理两个版本的差异和风险上下文...";
  return latest.replace(/^#{1,6}\s*/, "").slice(0, 180);
}
