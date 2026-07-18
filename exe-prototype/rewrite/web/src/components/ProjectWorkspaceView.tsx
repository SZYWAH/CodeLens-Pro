import {
  CheckCircle2,
  Check,
  Copy,
  FileCode2,
  FileText,
  FolderOpen,
  ListTree,
  Loader2,
  Map,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlayFocus } from "../hooks/useOverlayFocus";
import type { ReportSummary, TraceabilitySnapshot, WorkspaceDetail, WorkspaceFile, WorkspaceSummary } from "../types";
import { formatTime, severityLabel } from "../utils/display";

const workspaceCollapsedKey = "codelens.workspace.collapsed";

export function ProjectWorkspaceView(props: {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceDetail | null;
  recentReports: ReportSummary[];
  traceability: TraceabilitySnapshot | null;
  query: string;
  stream: string;
  opening: boolean;
  rescanning: boolean;
  reportBusy: boolean;
  retryAi?: boolean;
  projectRetryAi?: boolean;
  onQueryChange: (value: string) => void;
  onSearch: (query: string) => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRescan: () => void;
  onAnalyze: () => void;
  onAnalyzeProject: () => void;
  onMap: () => void;
  onGuide: () => void;
  onOpenReport: (id: string) => void;
  onOpenFindings: () => void;
  onOpenCards: () => void;
  onOpenLogs: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(workspaceCollapsedKey) === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [workspaceActionsOpen, setWorkspaceActionsOpen] = useState(false);
  const [menuWorkspaceId, setMenuWorkspaceId] = useState<string | null>(null);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<WorkspaceSummary | null>(null);
  const [pathCopyState, setPathCopyState] = useState<"copied" | "error" | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const scanDetailsTriggerRef = useRef<HTMLButtonElement>(null);
  const scanDetailsDialogRef = useRef<HTMLElement>(null);
  const scanDetailsCloseRef = useRef<HTMLButtonElement>(null);
  const workspace = props.activeWorkspace;
  const scopedTraceability = workspace
    && props.traceability?.scope_kind === "workspace"
    && props.traceability.scope_id === workspace.summary.id
      ? props.traceability
      : null;
  const hotFiles = useMemo(() => workspace ? buildHotFiles(workspace.files) : [], [workspace]);
  const languageCount = useMemo(
    () => workspace ? new Set(workspace.files.map((file) => file.language).filter(Boolean)).size : 0,
    [workspace]
  );
  const workspaceReports = useMemo(
    () => filterWorkspaceReports(props.recentReports, scopedTraceability),
    [props.recentReports, scopedTraceability]
  );
  const projectSteps = buildProjectSteps(Boolean(workspace), scopedTraceability);
  const nextAction = buildProjectNextAction(Boolean(workspace), scopedTraceability, workspaceReports.length > 0);
  const showIndexContent = !collapsed || mobileOpen;
  const showWorkspaceIndex = props.workspaces.length > 0 || Boolean(workspace) || Boolean(props.query.trim());
  const operationBusy = props.opening || props.rescanning || props.reportBusy;

  useEffect(() => {
    window.localStorage.setItem(workspaceCollapsedKey, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
    setMenuWorkspaceId(null);
    setScanOpen(false);
    setWorkspaceActionsOpen(false);
    setConfirmDeleteWorkspace(null);
    setPathCopyState(null);
  }, [workspace?.summary.id]);

  useEffect(() => {
    if (!pathCopyState) return;
    const timeout = window.setTimeout(() => setPathCopyState(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [pathCopyState]);

  useEffect(() => {
    if (confirmDeleteWorkspace) deleteCancelRef.current?.focus();
  }, [confirmDeleteWorkspace]);

  useOverlayFocus({
    active: scanOpen,
    containerRef: scanDetailsDialogRef,
    initialFocusRef: scanDetailsCloseRef,
    returnFocusRef: scanDetailsTriggerRef,
    onRequestClose: () => setScanOpen(false)
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (scanOpen) return;
      if (confirmDeleteWorkspace) {
        setConfirmDeleteWorkspace(null);
        return;
      }
      if (workspaceActionsOpen) {
        setWorkspaceActionsOpen(false);
        return;
      }
      if (mobileOpen) {
        setMobileOpen(false);
        return;
      }
      setMenuWorkspaceId(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDeleteWorkspace, mobileOpen, scanOpen, workspaceActionsOpen]);

  function openWorkspace(id: string) {
    props.onOpen(id);
    setMobileOpen(false);
    setMenuWorkspaceId(null);
  }

  function requestDeleteWorkspace(item: WorkspaceSummary) {
    setMenuWorkspaceId(null);
    setConfirmDeleteWorkspace(item);
  }

  function confirmWorkspaceDeletion() {
    if (!confirmDeleteWorkspace) return;
    props.onDelete(confirmDeleteWorkspace.id);
    setConfirmDeleteWorkspace(null);
  }

  async function copyWorkspacePath() {
    if (!workspace) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(workspace.summary.root_path);
      setPathCopyState("copied");
    } catch {
      setPathCopyState("error");
    }
  }

  function runNextAction() {
    if (nextAction.kind === "analyze") props.onAnalyze();
    if (nextAction.kind === "findings") props.onOpenFindings();
    if (nextAction.kind === "cards") props.onOpenCards();
    if (nextAction.kind === "logs") props.onOpenLogs();
    if (nextAction.kind === "report") {
      if (workspaceReports[0]) props.onOpenReport(workspaceReports[0].id);
      else props.onAnalyze();
    }
  }

  return (
    <section className={`project-workspace-v132 ${showWorkspaceIndex ? "has-workspace-index" : "without-workspace-index"} ${collapsed ? "is-index-collapsed" : ""} ${mobileOpen ? "is-index-mobile-open" : ""}`}>
      {showWorkspaceIndex && <aside aria-hidden={scanOpen} className="workspace-index-v132">
        {!showIndexContent ? (
          <button
            className="workspace-index-spine-v132"
            aria-label={`展开工作区索引，共 ${props.workspaces.length} 个工作区`}
            onClick={() => setCollapsed(false)}
            title="展开工作区索引"
            type="button"
          >
            <FolderOpen size={16} />
            <strong>{props.workspaces.length}</strong>
            <PanelLeftOpen size={15} />
          </button>
        ) : (
          <>
            <header className="workspace-index-head-v132">
              <div><span>本地工作区</span><strong>{props.workspaces.length}</strong></div>
              <div>
                <button className="workspace-index-collapse-v132" onClick={() => setCollapsed(true)} title="收起工作区索引" type="button"><PanelLeftClose size={15} /></button>
                <button className="workspace-index-mobile-close-v132" onClick={() => setMobileOpen(false)} title="关闭工作区索引" type="button"><X size={15} /></button>
              </div>
            </header>

            <form
              className="workspace-index-search-v132"
              onSubmit={(event) => {
                event.preventDefault();
                const submittedQuery = new FormData(event.currentTarget).get("workspace-query");
                props.onSearch(typeof submittedQuery === "string" ? submittedQuery : "");
              }}
            >
              <input name="workspace-query" value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索工作区" />
              <button aria-label="搜索工作区" title="搜索工作区" type="submit"><Search size={14} /></button>
            </form>

            <button className="workspace-index-import-v132" onClick={props.onImport} disabled={operationBusy} type="button">
              {props.opening ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} />}导入工作区
            </button>

            <div className="workspace-index-list-v132">
              {props.workspaces.map((item) => (
                <article className={workspace?.summary.id === item.id ? "active" : ""} key={item.id}>
                  <button className="workspace-index-main-v132" onClick={() => openWorkspace(item.id)} type="button">
                    <FolderOpen size={15} />
                    <span><strong>{item.name}</strong><small>{item.file_count} 个文件 · {item.language_summary || "待扫描"}</small></span>
                  </button>
                  <div
                    className="workspace-index-menu-v132"
                    data-workspace-menu
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuWorkspaceId(null);
                    }}
                  >
                    <button
                      aria-expanded={menuWorkspaceId === item.id}
                      aria-label={`管理工作区 ${item.name}`}
                      onClick={() => setMenuWorkspaceId((current) => current === item.id ? null : item.id)}
                      title="更多操作"
                      type="button"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {menuWorkspaceId === item.id && (
                      <div role="menu">
                        <button onClick={() => requestDeleteWorkspace(item)} role="menuitem" type="button"><Trash2 size={14} />删除工作区</button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {props.workspaces.length === 0 && (
                <div className="workspace-index-empty-v132">
                  <span>{props.query.trim() ? "没有匹配的工作区" : "暂无工作区"}</span>
                  {props.query.trim() && <button onClick={() => { props.onQueryChange(""); props.onSearch(""); }} type="button">清除搜索</button>}
                </div>
              )}
            </div>
          </>
        )}
      </aside>}

      <main aria-hidden={scanOpen} className="workspace-stage-v132">
        {showWorkspaceIndex && <button className="workspace-index-mobile-trigger-v132" onClick={() => setMobileOpen(true)} type="button">
          <PanelLeftOpen size={15} />工作区
        </button>}
        {workspace ? (
          <>
            <header className="workspace-stage-head-v132">
              <div className="workspace-stage-title-v132">
                <span>当前工作区</span>
                <h2>{workspace.summary.name}</h2>
                <div className="workspace-path-v142">
                  <p title={workspace.summary.root_path}>{workspace.summary.root_path}</p>
                  <button aria-label="复制工作区路径" onClick={copyWorkspacePath} title={pathCopyState === "copied" ? "路径已复制" : pathCopyState === "error" ? "复制失败" : "复制路径"} type="button">{pathCopyState === "copied" ? <Check size={14} /> : <Copy size={14} />}</button>
                  <span aria-live="polite">{pathCopyState === "copied" ? "已复制" : pathCopyState === "error" ? "复制失败" : ""}</span>
                </div>
              </div>
              <div className="workspace-stage-actions-v132">
                <button className="workspace-secondary-action-v142" onClick={props.onGuide} disabled={operationBusy} type="button"><ListTree size={15} />项目导览</button>
                <button className="workspace-secondary-action-v142" onClick={props.onMap} disabled={operationBusy} type="button"><Map size={15} />代码地图</button>
                <div
                  className="workspace-actions-menu-v142"
                  onBlur={(event) => {
                    if (!scanOpen && !event.currentTarget.contains(event.relatedTarget as Node | null)) setWorkspaceActionsOpen(false);
                  }}
                >
                  <button className="icon-button" aria-expanded={workspaceActionsOpen} aria-label="更多工作区操作" onClick={() => setWorkspaceActionsOpen((value) => !value)} title="更多操作" type="button"><MoreHorizontal size={16} /></button>
                  {workspaceActionsOpen && <div role="menu">
                    <button disabled={operationBusy} onClick={() => { setWorkspaceActionsOpen(false); props.onRescan(); }} role="menuitem" type="button">{props.rescanning ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}{props.rescanning ? "正在扫描" : "重新扫描"}</button>
                    <button disabled={operationBusy} onClick={() => { setWorkspaceActionsOpen(false); props.onAnalyzeProject(); }} role="menuitem" type="button">
                      <Play size={15} />{props.projectRetryAi ? "重试项目 AI" : "运行项目审查"}
                    </button>
                    <button
                      ref={scanDetailsTriggerRef}
                      aria-controls="workspace-scan-dialog-v145"
                      aria-expanded={scanOpen}
                      onClick={() => setScanOpen(true)}
                      role="menuitem"
                      type="button"
                    >
                      <FileCode2 size={15} />扫描详情
                    </button>
                  </div>}
                </div>
                <button className="primary-button" onClick={props.onAnalyze} disabled={operationBusy} type="button">
                  {props.reportBusy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}{props.reportBusy ? "正在生成" : props.retryAi ? "重试 AI" : "生成工作区报告"}
                </button>
              </div>
            </header>

            <dl className="workspace-stage-metrics-v132">
              <div><dt>文件</dt><dd>{workspace.summary.file_count}</dd></div>
              <div><dt>代码行</dt><dd>{workspace.summary.total_lines}</dd></div>
              <div><dt>语言</dt><dd title={workspace.summary.language_summary}>{workspace.summary.language_summary || `${languageCount} 种`}</dd></div>
              <div><dt>最近更新</dt><dd>{formatTime(workspace.summary.updated_at)}</dd></div>
            </dl>

            {props.opening && (
              <section className="workspace-context-loading-v1420b" aria-live="polite">
                <Loader2 className="spin" size={15} />正在打开工作区并同步关联状态…
              </section>
            )}

            {props.rescanning && (
              <section className="workspace-context-loading-v1420b" aria-live="polite">
                <Loader2 className="spin" size={15} />正在重新扫描项目文件…
              </section>
            )}

            {props.reportBusy && (
              <section className="workspace-generation-v132" aria-live="polite">
                <Loader2 className="spin" size={17} />
                <div><strong>正在生成项目审查报告</strong><span>{latestStreamMessage(props.stream)}</span></div>
              </section>
            )}

            <section className="workspace-progress-v132">
              <header><span><Route size={15} />审查闭环</span><button disabled={!nextAction.kind || operationBusy} onClick={runNextAction} type="button">{nextAction.label}</button></header>
              <ol>
                {projectSteps.map((step, index) => (
                  <li className={step.done ? "done" : step.active ? "active" : ""} key={step.title}>
                    <span>{step.done ? <CheckCircle2 size={14} /> : index + 1}</span>
                    <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="workspace-stage-grid-v132">
              <section className="workspace-hotspots-v132">
                <header><div><ShieldAlert size={15} /><strong>风险与复杂度热点</strong></div><small>{hotFiles.length} 个文件</small></header>
                <div className="workspace-hotspot-table-v132">
                  <div className="workspace-hotspot-columns-v142" aria-hidden="true">
                    <span>文件</span><span>行数</span><span>复杂度</span><span>风险</span>
                  </div>
                  {hotFiles.map((file) => (
                    <div key={file.id}>
                      <span><code title={file.path}>{file.path}</code><small>{file.language || "文本"}</small></span>
                      <span><small>行数</small><strong>{file.metrics.total_lines}</strong></span>
                      <span><small>复杂度</small><strong>{file.metrics.complexity_score}</strong></span>
                      <span className={file.metrics.risk_count ? "has-risk" : ""}><small>风险</small><strong>{file.metrics.risk_count}</strong></span>
                    </div>
                  ))}
                  {hotFiles.length === 0 && <div className="workspace-stage-empty-v132">当前快照没有可展示的文件指标。</div>}
                </div>
              </section>

              <section className="workspace-reports-v132">
                <header><div><FileText size={15} /><strong>当前工作区报告</strong></div><small>{workspaceReports.length ? "最近四份" : "尚无报告"}</small></header>
                <div className="workspace-report-list-v132">
                  {workspaceReports.map((report) => (
                    <button key={report.id} onClick={() => props.onOpenReport(report.id)} type="button">
                      <span className={`risk-${report.risk_level || "info"}`}>{severityLabel(report.risk_level)}</span>
                      <strong>{report.title}</strong>
                      <small>{report.file_count} 个文件 · {report.risk_count} 个风险 · {formatTime(report.created_at)}</small>
                      <FileText size={15} />
                    </button>
                  ))}
                  {workspaceReports.length === 0 && (
                    <div className="workspace-stage-empty-v132"><FileText size={18} /><span>生成第一份项目报告后，会从这里直接进入阅读。</span></div>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="workspace-stage-welcome-v132">
            <FolderOpen size={34} />
            <span>本地项目审查</span>
            <h2>导入一个工作区开始审查</h2>
            <p>项目文件只在本机读取和索引，随后可以生成报告、整理问题并沉淀知识卡片。</p>
            <button className="primary-button" onClick={props.onImport} disabled={operationBusy} type="button">
              {props.opening ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />}{props.opening ? "正在打开工作区" : "导入工作区"}
            </button>
          </div>
        )}
      </main>

      {showWorkspaceIndex && <button className="workspace-index-scrim-v132" aria-label="关闭工作区索引" onClick={() => setMobileOpen(false)} type="button" />}
      <button aria-hidden="true" className={scanOpen ? "workspace-scan-scrim-v132 is-open" : "workspace-scan-scrim-v132"} onClick={() => setScanOpen(false)} tabIndex={-1} type="button" />
      <aside
        ref={scanDetailsDialogRef}
        id="workspace-scan-dialog-v145"
        aria-hidden={!scanOpen}
        aria-labelledby="workspace-scan-title-v145"
        aria-modal="true"
        className={scanOpen ? "workspace-scan-drawer-v132 is-open" : "workspace-scan-drawer-v132"}
        role="dialog"
      >
        <header>
          <div><span id="workspace-scan-title-v145">扫描详情</span><strong>{workspace?.summary.name || "当前工作区"}</strong></div>
          <button ref={scanDetailsCloseRef} className="icon-button" onClick={() => setScanOpen(false)} aria-label="关闭扫描详情" title="关闭" type="button"><X size={16} /></button>
        </header>
        {workspace && (
          <div className="workspace-scan-body-v132">
            <dl>
              <div><dt>项目根目录</dt><dd title={workspace.summary.root_path}>{workspace.summary.root_path}</dd></div>
              <div><dt>索引文件</dt><dd>{workspace.summary.file_count}</dd></div>
              <div><dt>代码行</dt><dd>{workspace.summary.total_lines}</dd></div>
              <div><dt>识别语言</dt><dd>{languageCount}</dd></div>
              <div><dt>跳过项</dt><dd>{workspace.skipped.length}</dd></div>
            </dl>
            <section>
              <header><strong>跳过的文件与目录</strong><small>{workspace.skipped.length}</small></header>
              <div>
                {workspace.skipped.map((item) => <code key={item}>{item}</code>)}
                {workspace.skipped.length === 0 && <p>本次扫描没有记录跳过项。</p>}
              </div>
            </section>
          </div>
        )}
      </aside>

      {confirmDeleteWorkspace && <>
        <button className="workspace-delete-scrim-v146" aria-label="取消删除工作区" onClick={() => setConfirmDeleteWorkspace(null)} type="button" />
        <section aria-describedby="workspace-delete-detail-v146" aria-labelledby="workspace-delete-title-v146" aria-modal="true" className="workspace-delete-dialog-v146" role="dialog">
          <header><Trash2 size={18} /><div><span>删除本地索引</span><strong id="workspace-delete-title-v146">{confirmDeleteWorkspace.name}</strong></div></header>
          <p id="workspace-delete-detail-v146">只会删除 CodeLens 中保存的工作区索引和关联记录，不会删除原项目目录或任何源代码文件。</p>
          <footer><button ref={deleteCancelRef} onClick={() => setConfirmDeleteWorkspace(null)} type="button">取消</button><button className="danger" disabled={operationBusy} onClick={confirmWorkspaceDeletion} type="button"><Trash2 size={14} />确认删除</button></footer>
        </section>
      </>}
    </section>
  );
}

function buildHotFiles(files: WorkspaceFile[]) {
  return [...files]
    .sort((left, right) => right.metrics.risk_count - left.metrics.risk_count
      || right.metrics.complexity_score - left.metrics.complexity_score
      || right.metrics.total_lines - left.metrics.total_lines)
    .slice(0, 10);
}

function filterWorkspaceReports(reports: ReportSummary[], traceability: TraceabilitySnapshot | null) {
  if (!traceability) return [];
  const reportIds = new Set(
    traceability.nodes
      .filter((node) => node.kind === "report" && node.id.startsWith("report:"))
      .map((node) => node.id.slice("report:".length))
  );
  return reports.filter((report) => reportIds.has(report.id)).slice(0, 4);
}

function buildProjectSteps(hasWorkspace: boolean, traceability: TraceabilitySnapshot | null) {
  const counts = traceability?.counts;
  const steps = [
    { title: "工作区", detail: hasWorkspace ? "本地快照已建立" : "导入项目目录", done: hasWorkspace },
    { title: "报告", detail: counts?.reports ? `${counts.reports} 份已保存` : "生成审查报告", done: Boolean(counts?.reports) },
    { title: "问题", detail: counts?.findings ? `${counts.findings} 个已关联` : "整理风险问题", done: Boolean(counts?.findings) },
    { title: "卡片", detail: counts?.cards ? `${counts.cards} 张已沉淀` : "提炼知识卡片", done: Boolean(counts?.cards) },
    { title: "日志", detail: counts?.daily_logs ? `${counts.daily_logs} 篇已记录` : "写入每日复盘", done: Boolean(counts?.daily_logs) }
  ];
  const activeIndex = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({ ...step, active: index === activeIndex }));
}

function buildProjectNextAction(hasWorkspace: boolean, traceability: TraceabilitySnapshot | null, hasReport: boolean): { label: string; kind: "analyze" | "findings" | "cards" | "logs" | "report" | null } {
  if (!hasWorkspace) return { label: "导入工作区", kind: null };
  if (!traceability) return { label: "正在同步关联状态", kind: null };
  const counts = traceability.counts;
  if (!counts.reports) return { label: "生成项目报告", kind: "analyze" };
  if (!counts.findings) return { label: "查看问题清单", kind: "findings" };
  if (!counts.cards) return { label: "进入知识卡片", kind: "cards" };
  if (!counts.daily_logs) return { label: "写入每日日志", kind: "logs" };
  return { label: hasReport ? "打开最近报告" : "继续生成报告", kind: hasReport ? "report" : "analyze" };
}

function latestStreamMessage(stream: string) {
  const lines = stream.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const latest = lines[lines.length - 1] || "正在读取项目结构并整理审查上下文...";
  return latest.replace(/^#{1,6}\s*/, "").slice(0, 180);
}
