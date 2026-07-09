import { FileCode2, FolderOpen, GitBranch, Layers3, Loader2, Map, Play, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import type { ReportDetail, TraceabilitySnapshot, WorkspaceDetail, WorkspaceFile, WorkspaceSummary } from "../types";
import { ReportPanel, StreamPanel } from "./ReportPanel";

export function ProjectWorkspaceView(props: {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceDetail | null;
  query: string;
  stream: string;
  report: ReportDetail | null;
  traceability: TraceabilitySnapshot | null;
  busy: boolean;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onImport: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRescan: () => void;
  onAnalyze: () => void;
  onMap: () => void;
  onCopyReport: () => void;
  onExportReport: (kind: "md" | "html") => void;
  onGenerateCandidates: () => void;
  onCreateAgentPlan: () => void;
  onOpenFindings: () => void;
  onAddDailyLog: () => void;
  onChatAboutReport: () => void;
}) {
  const workspace = props.activeWorkspace;
  const hotFiles = workspace ? buildHotFiles(workspace.files) : [];
  const riskFiles = workspace ? workspace.files.filter((file) => file.metrics.risk_count > 0).sort((left, right) => right.metrics.risk_count - left.metrics.risk_count).slice(0, 6) : [];
  const languageCount = workspace ? new Set(workspace.files.map((file) => file.language).filter(Boolean)).size : 0;

  return (
    <section className="workbench-page-next">
      <aside className="workbench-rail-next">
        <form
          className="compact-search"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSearch();
          }}
        >
          <Search size={17} />
          <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索工作区" />
        </form>
        <button className="primary-button full" onClick={props.onImport} disabled={props.busy}>
          {props.busy ? <Loader2 className="spin" size={18} /> : <FolderOpen size={18} />}
          导入工作区
        </button>
        <div className="rail-section-title">本地工作区</div>
        <div className="session-list">
          {props.workspaces.map((item) => (
            <div className={props.activeWorkspace?.summary.id === item.id ? "session-row active" : "session-row"} key={item.id}>
              <button onClick={() => props.onOpen(item.id)}>
                <strong>{item.name}</strong>
                <span>{item.file_count} 个文件 · {item.language_summary || "待扫描"}</span>
              </button>
              <button className="icon-button danger" onClick={() => props.onDelete(item.id)} title="删除工作区">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {props.workspaces.length === 0 && <div className="empty small">暂无工作区。</div>}
        </div>
      </aside>

      <section className="workbench-main-next">
        {workspace ? (
          <>
            <div className="workbench-hero-next">
              <div>
                <span>分析主线</span>
                <h3>{workspace.summary.name}</h3>
                <p>{workspace.summary.root_path}</p>
              </div>
              <div className="button-row wrap">
                <button className="secondary-button" onClick={props.onRescan}>
                  <RefreshCw size={17} />
                  重新扫描
                </button>
                <button className="secondary-button" onClick={props.onMap}>
                  <Map size={17} />
                  打开代码地图
                </button>
                <button className="primary-button" onClick={props.onAnalyze} disabled={props.busy}>
                  {props.busy ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                  生成项目审查
                </button>
              </div>
            </div>

            <div className="workspace-metric-strip-next">
              <Metric label="文件" value={workspace.summary.file_count} />
              <Metric label="行数" value={workspace.summary.total_lines} />
              <Metric label="语言" value={languageCount} />
              <Metric label="跳过" value={workspace.skipped.length} />
              <Metric label="风险文件" value={riskFiles.length} />
            </div>

            <section className="workspace-insight-grid-next">
              <InsightCard icon={<FolderOpen size={16} />} title="只读导入" detail="只读取你主动选择的文件夹，不扫描全盘，也不修改项目源文件。" />
              <InsightCard icon={<GitBranch size={16} />} title="结构建模" detail="提取语言分布、热点文件、符号、依赖和复杂度线索。" />
              <InsightCard icon={<ShieldAlert size={16} />} title="问题闭环" detail="项目报告可继续生成问题清单、知识卡片、每日日志和 Agent 计划。" />
            </section>

            <div className="workspace-flow-next">
              <article>
                <span>1</span>
                <strong>导入或重扫</strong>
                <small>建立当前项目快照，记录跳过项和文件指标。</small>
              </article>
              <article>
                <span>2</span>
                <strong>代码地图</strong>
                <small>查看语言分布、符号、依赖与复杂度热点。</small>
              </article>
              <article>
                <span>3</span>
                <strong>项目审查</strong>
                <small>生成报告、问题清单、卡片和 Agent 改进计划。</small>
              </article>
            </div>

            <div className="workbench-content-next">
              <aside className="workspace-file-panel-next">
                <div className="pane-title"><FileCode2 size={17} />文件热点</div>
                <div className="workspace-hotspot-list-next">
                  {hotFiles.map((file) => (
                    <div className="file-row static" key={file.id}>
                      <strong>{file.path}</strong>
                      <span>{file.language || "文本"} · {file.metrics.total_lines} 行 · 复杂度 {file.metrics.complexity_score} · 风险 {file.metrics.risk_count}</span>
                    </div>
                  ))}
                  {hotFiles.length === 0 && <div className="empty small">暂无文件快照。</div>}
                </div>

                {riskFiles.length > 0 && (
                  <section className="workspace-risk-files-next">
                    <div className="pane-title"><ShieldAlert size={17} />风险入口</div>
                    {riskFiles.map((file) => (
                      <p key={file.id}><code>{file.path}</code><span>{file.metrics.risk_count} 个风险</span></p>
                    ))}
                  </section>
                )}

                {workspace.skipped.length > 0 && (
                  <details className="skipped-files-next">
                    <summary>查看跳过项（{workspace.skipped.length}）</summary>
                    {workspace.skipped.slice(0, 30).map((item) => <code key={item}>{item}</code>)}
                  </details>
                )}
              </aside>

              {props.busy || props.stream ? (
                <StreamPanel title="正在流式生成工作区审查报告" value={props.stream} busy={props.busy} />
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
            </div>
          </>
        ) : (
          <div className="workbench-empty-next">
            <FolderOpen size={38} />
            <h3>打开一个真实项目，开始本地审查闭环</h3>
            <p>导入工作区后，可以生成代码地图、项目导览、问题清单、知识卡片和 Agent 改进计划。</p>
            <button className="primary-button" onClick={props.onImport} disabled={props.busy}>
              {props.busy ? <Loader2 className="spin" size={18} /> : <FolderOpen size={18} />}
              导入工作区
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InsightCard({ icon, title, detail }: { icon: JSX.Element; title: string; detail: string }) {
  return (
    <article>
      <span>{icon}{title}</span>
      <p>{detail}</p>
    </article>
  );
}

function buildHotFiles(files: WorkspaceFile[]) {
  return [...files]
    .sort((left, right) => right.metrics.complexity_score - left.metrics.complexity_score || right.metrics.risk_count - left.metrics.risk_count || right.metrics.total_lines - left.metrics.total_lines)
    .slice(0, 8);
}
