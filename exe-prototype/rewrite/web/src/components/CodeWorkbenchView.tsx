import { Check, Clipboard, Columns3, Eraser, FileCode2, FolderOpen, Loader2, Play, RotateCcw } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ReportDetail, ReportMetrics, TraceabilitySnapshot } from "../types";
import { AccessibleListbox } from "./AccessibleListbox";
import { ReportPanel } from "./ReportPanel";
import { ProductToolbar } from "./ProductShell";
import { WorkbenchCommandBar, WorkbenchEditorSurface, WorkbenchGenerationStrip, WorkbenchMetricStrip } from "./WorkbenchPrimitives";

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
  workbenchMode: "single" | "diff";
  diffContent: ReactNode;
  language: string;
  modeGroup: string;
  mode: string;
  generateCards: boolean;
  code: string;
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  singleBusy: boolean;
  reportOperationBusy: boolean;
  onWorkbenchModeChange: (value: "single" | "diff") => void;
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
  onOpenFindings: () => void;
  onAddDailyLog: () => void;
  onChatAboutReport: () => void;
  onRenameReport: (id: string, title: string) => Promise<void>;
}) {
  const [singleMobilePane, setSingleMobilePane] = useState<"code" | "report">("code");
  const [codeCopyState, setCodeCopyState] = useState<"copied" | "error" | null>(null);
  const metrics = estimateMetrics(props.code);
  const modes = reportModes[props.modeGroup] || reportModes.function;
  const activeMode = modes.find((item) => item.value === props.mode) || modes[0];

  useEffect(() => {
    setSingleMobilePane(props.report ? "report" : "code");
  }, [props.report?.id]);

  useEffect(() => {
    if (!codeCopyState) return;
    const timeout = window.setTimeout(() => setCodeCopyState(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [codeCopyState]);

  function changeWorkbenchMode(value: "single" | "diff") {
    props.onWorkbenchModeChange(value);
  }

  function analyzeSingleFile() {
    props.onAnalyze();
  }

  async function copyCode() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(props.code);
      setCodeCopyState("copied");
    } catch {
      setCodeCopyState("error");
    }
  }

  function handleTabsKeyDown<T extends string>(
    event: KeyboardEvent<HTMLButtonElement>,
    values: readonly T[],
    current: T,
    onChange: (value: T) => void
  ) {
    const currentIndex = values.indexOf(current);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % values.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + values.length) % values.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = values.length - 1;
    else return;
    const next = values[nextIndex];
    onChange(next);
    const tabList = event.currentTarget.closest('[role="tablist"]');
    const nextTab = tabList?.querySelector<HTMLButtonElement>('[data-tab-value="' + next + '"]');
    nextTab?.focus();
    event.preventDefault();
  }

  return (
    <section className="code-workbench-v12">
      <ProductToolbar>
        <div className="product-toolbar-context-next">{props.workbenchMode === "single" ? "单文件快速分析" : "双版本差异审查"}</div>
        <div className="workbench-mode-switch-v12" role="tablist" aria-label="工作台模式">
          <button aria-controls="workbench-panel-single" className={props.workbenchMode === "single" ? "active" : ""} data-tab-value="single" id="workbench-tab-single-desktop" onClick={() => changeWorkbenchMode("single")} onKeyDown={(event) => handleTabsKeyDown(event, ["single", "diff"] as const, props.workbenchMode, changeWorkbenchMode)} role="tab" aria-selected={props.workbenchMode === "single"} tabIndex={props.workbenchMode === "single" ? 0 : -1} type="button"><FileCode2 size={15} />单文件</button>
          <button aria-controls="workbench-panel-diff" className={props.workbenchMode === "diff" ? "active" : ""} data-tab-value="diff" id="workbench-tab-diff-desktop" onClick={() => changeWorkbenchMode("diff")} onKeyDown={(event) => handleTabsKeyDown(event, ["single", "diff"] as const, props.workbenchMode, changeWorkbenchMode)} role="tab" aria-selected={props.workbenchMode === "diff"} tabIndex={props.workbenchMode === "diff" ? 0 : -1} type="button"><Columns3 size={15} />代码对比</button>
        </div>
      </ProductToolbar>

      <div className="workbench-mobile-mode-v142" role="tablist" aria-label="工作台模式">
        <button aria-controls="workbench-panel-single" className={props.workbenchMode === "single" ? "active" : ""} data-tab-value="single" id="workbench-tab-single-mobile" onClick={() => changeWorkbenchMode("single")} onKeyDown={(event) => handleTabsKeyDown(event, ["single", "diff"] as const, props.workbenchMode, changeWorkbenchMode)} role="tab" aria-selected={props.workbenchMode === "single"} tabIndex={props.workbenchMode === "single" ? 0 : -1} type="button"><FileCode2 size={15} />单文件</button>
        <button aria-controls="workbench-panel-diff" className={props.workbenchMode === "diff" ? "active" : ""} data-tab-value="diff" id="workbench-tab-diff-mobile" onClick={() => changeWorkbenchMode("diff")} onKeyDown={(event) => handleTabsKeyDown(event, ["single", "diff"] as const, props.workbenchMode, changeWorkbenchMode)} role="tab" aria-selected={props.workbenchMode === "diff"} tabIndex={props.workbenchMode === "diff" ? 0 : -1} type="button"><Columns3 size={15} />代码对比</button>
      </div>

      <section
        aria-label="单文件分析"
        className={`single-workbench-v12 ${props.report ? "has-report" : "no-report"} show-${singleMobilePane}`}
        hidden={props.workbenchMode !== "single"}
        id="workbench-panel-single"
        role="tabpanel"
      >
        <WorkbenchCommandBar
          action={(
            <button className="primary-button" onClick={analyzeSingleFile} disabled={props.singleBusy || !props.code.trim()} type="button">
              {props.singleBusy ? <Loader2 className="spin" size={17} /> : <Play size={17} />}{props.singleBusy ? "正在生成" : props.report?.analysis_source === "local_fallback" ? "重试 AI" : "生成报告"}
            </button>
          )}
          ariaLabel="单文件分析配置"
          className="single-commandbar-v1419"
          description={`${activeMode.label} · ${activeMode.detail}`}
          icon={<FileCode2 size={16} />}
          title="单文件分析"
        >
          <AccessibleListbox label="语言" value={props.language} onChange={props.onLanguageChange} options={languages.map((item) => ({ value: item, label: item === "auto" ? "自动识别" : item }))} disabled={props.singleBusy} />
          <AccessibleListbox label="分析类型" value={props.modeGroup} onChange={props.onModeGroupChange} options={modeGroups} disabled={props.singleBusy} />
          <AccessibleListbox label="审查重点" value={props.mode} onChange={props.onModeChange} options={modes.map(({ value, label }) => ({ value, label }))} disabled={props.singleBusy} />
          <label className="single-card-candidate-toggle-v147" title="报告完成后额外提取可保存的知识卡片候选，默认不会增加生成步骤。">
            <input checked={props.generateCards} disabled={props.singleBusy} onChange={(event) => props.onGenerateCardsChange(event.target.checked)} type="checkbox" />
            <span>生成后提取知识卡片候选</span>
          </label>
        </WorkbenchCommandBar>

        {props.singleBusy && <WorkbenchGenerationStrip title="正在生成单文件报告" detail="完成后将在右侧打开，不会清空当前代码。" />}

        <WorkbenchMetricStrip items={[
          { label: "总行数", value: metrics.total_lines },
          { label: "有效行", value: metrics.non_empty_lines },
          { label: "注释行", value: metrics.comment_lines },
          { label: "复杂度", value: metrics.complexity_score }
        ]} />

        {props.report && <div className="single-mobile-tabs-v142" role="tablist" aria-label="单文件工作区">
          <button aria-controls="single-pane-code" className={singleMobilePane === "code" ? "active" : ""} data-tab-value="code" id="single-tab-code" onClick={() => setSingleMobilePane("code")} onKeyDown={(event) => handleTabsKeyDown(event, ["code", "report"] as const, singleMobilePane, setSingleMobilePane)} role="tab" aria-selected={singleMobilePane === "code"} tabIndex={singleMobilePane === "code" ? 0 : -1} type="button"><FileCode2 size={15} />代码</button>
          <button aria-controls="single-pane-report" className={singleMobilePane === "report" ? "active" : ""} data-tab-value="report" id="single-tab-report" onClick={() => setSingleMobilePane("report")} onKeyDown={(event) => handleTabsKeyDown(event, ["code", "report"] as const, singleMobilePane, setSingleMobilePane)} role="tab" aria-selected={singleMobilePane === "report"} tabIndex={singleMobilePane === "report" ? 0 : -1} type="button"><Play size={15} />报告</button>
        </div>}

        <div className="single-workbench-stage-v1419">
          <aside aria-label="待分析代码" className="single-workbench-editor-next single-workbench-editor-v12 single-code-pane-v142" id="single-pane-code" role="tabpanel">
            <WorkbenchEditorSurface
              actions={(
                <nav className="single-editor-toolbar-next single-toolbar-v12" aria-label="代码编辑操作">
                  <button aria-label="导入代码文件" className="secondary-button" disabled={props.singleBusy} onClick={props.onImportFile} title="导入代码文件" type="button"><FolderOpen size={15} /><span>导入</span></button>
                  <button aria-label="载入示例代码" className="secondary-button" disabled={props.singleBusy} onClick={props.onLoadSample} title="载入示例代码" type="button"><RotateCcw size={15} /><span>示例</span></button>
                  <button aria-label={codeCopyState === "error" ? "复制代码失败，请重试" : "复制代码"} className="secondary-button" onClick={copyCode} disabled={props.singleBusy || !props.code.trim()} title={codeCopyState === "error" ? "复制失败，请重试" : "复制代码"} type="button">{codeCopyState === "copied" ? <Check size={15} /> : <Clipboard size={15} />}<span>{codeCopyState === "copied" ? "已复制" : codeCopyState === "error" ? "复制失败" : "复制"}</span></button>
                  <button aria-label="清空代码" className="secondary-button danger" onClick={props.onClear} disabled={props.singleBusy || !props.code.trim()} title="清空代码" type="button"><Eraser size={15} /><span>清空</span></button>
                </nav>
              )}
              ariaLabel="单文件代码编辑器"
              className="single-code-frame-next single-code-frame-v12"
              title={<><FileCode2 size={16} /><span>待分析代码</span></>}
            >
              <textarea
                aria-label="待分析代码"
                className="workbench-editor-textarea-v1419"
                spellCheck={false}
                disabled={props.singleBusy}
                value={props.code}
                onChange={(event) => props.onCodeChange(event.target.value)}
                placeholder="在这里粘贴需要分析的代码..."
              />
            </WorkbenchEditorSurface>
          </aside>

          {props.report && <main aria-label="单文件审查报告" className="single-workbench-report-next single-workbench-report-v12 single-report-pane-v142" id="single-pane-report" role="tabpanel">
            <ReportPanel
              report={props.report}
              traceability={props.traceability}
              variant="embedded"
              operationBusy={props.reportOperationBusy}
              onCopy={props.onCopyReport}
              onExport={props.onExportReport}
              onGenerateCandidates={props.onGenerateCandidates}
              onOpenFindings={props.onOpenFindings}
              onAddDailyLog={props.onAddDailyLog}
              onChatAboutReport={props.onChatAboutReport}
              onRename={props.onRenameReport}
            />
          </main>}
        </div>
      </section>

      <div
        aria-labelledby="workbench-tab-diff-desktop"
        className="workbench-diff-panel-v1417"
        hidden={props.workbenchMode !== "diff"}
        id="workbench-panel-diff"
        role="tabpanel"
      >
        {props.diffContent}
      </div>
    </section>
  );
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
