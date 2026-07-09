import { Archive, Bot, CheckCircle2, Download, FileCode2, GitBranch, GraduationCap, Inbox, Loader2, MessageSquare, PlayCircle, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Trash2, TriangleAlert, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentTask, Finding, ReportSummary, WorkspaceBridgeInboxRequest, WorkspaceBridgeStatus, WorkspaceDetail, WorkspaceSummary } from "../types";

export function AgentWorkspaceView(props: {
  tasks: AgentTask[];
  activeTask: AgentTask | null;
  goal: string;
  context: string;
  workspaces: WorkspaceSummary[];
  reports: ReportSummary[];
  findings: Finding[];
  activeWorkspace: WorkspaceDetail | null;
  bridgeStatus: WorkspaceBridgeStatus | null;
  bridgeInbox: WorkspaceBridgeInboxRequest[];
  selectedOperationIds: string[];
  busy: boolean;
  onGoalChange: (value: string) => void;
  onContextChange: (value: string) => void;
  onToggleBridgeFile: (path: string, selected: boolean) => void;
  onToggleOperation: (id: string, selected: boolean) => void;
  onApply: () => void;
  onRollbackOperation: (operationId: string) => void;
  onCreateCard: () => void;
  onAddDailyLog: () => void;
  onChatAboutTask: () => void;
  onRefreshBridge: () => void;
  onRefreshBridgeInbox: () => void;
  onExportBridgeManifest: () => void;
  onCreateFromBridgeInbox: (requestId: string) => void;
  onCreate: () => void;
  onOpen: (task: AgentTask) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
}) {
  const [taskQuery, setTaskQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const [expandedOperationId, setExpandedOperationId] = useState<string | null>(null);
  const taskStats = agentTaskStats(props.tasks);
  const operationStatsValue = agentOperationStats(props.activeTask?.operations || []);
  const selectedFiles = props.bridgeStatus?.candidate_files.filter((file) => file.selected) || [];
  const contextText = describeAgentContext(props.context, props.workspaces, props.activeWorkspace, props.findings, props.reports);
  const selectedPendingCount = props.activeTask?.operations.filter((operation) => operation.status === "pending" && props.selectedOperationIds.includes(operation.id)).length || 0;
  const displayedTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    return props.tasks.filter((task) => {
      const matchesStatus = taskFilter === "all" || task.status === taskFilter;
      const matchesQuery = !query || [task.title, task.summary, task.context_kind, task.apply_summary].some((value) => value.toLowerCase().includes(query));
      return matchesStatus && matchesQuery;
    });
  }, [props.tasks, taskFilter, taskQuery]);

  return (
    <section className="agent-page-next">
      <aside className="agent-rail-next">
        <div className="agent-hero-next">
          <span>Agent 工作区</span>
          <h3>确认式 Agent 工作区</h3>
          <p>围绕真实工作区、报告和问题生成可预览、可确认、可备份的改进计划，先审查再执行。</p>
        </div>

        <div className="agent-stats-next">
          <small>
            计划 <strong>{taskStats.total}</strong>
          </small>
          <small>
            待执行 <strong>{taskStats.pending}</strong>
          </small>
          <small>
            已应用 <strong>{taskStats.applied}</strong>
          </small>
        </div>

        <section className="agent-command-next">
          <div className="section-title-next">
            <span>
              <Wand2 size={15} />
              任务编排
            </span>
            <h3>创建可确认计划</h3>
          </div>
          <label>
            任务目标
            <input value={props.goal} onChange={(event) => props.onGoalChange(event.target.value)} placeholder="例如：根据当前问题清单生成分步修复计划" />
          </label>
          <label>
            上下文
            <select value={props.context} onChange={(event) => props.onContextChange(event.target.value)}>
              <option value="none|">自动使用当前工作区</option>
              {props.workspaces.map((item) => <option key={item.id} value={`workspace|${item.id}`}>工作区：{item.name}</option>)}
              {props.activeWorkspace?.files.slice(0, 40).map((file) => <option key={file.id} value={`file|${props.activeWorkspace?.summary.id}::${file.path}`}>文件：{file.path}</option>)}
              {props.findings.map((item) => <option key={item.id} value={`finding|${item.id}`}>问题：{item.title}</option>)}
              {props.reports.map((item) => <option key={item.id} value={`report|${item.id}`}>报告：{item.title}</option>)}
            </select>
          </label>
          <div className="agent-context-next">
            <span>当前上下文</span>
            <strong>{contextText}</strong>
          </div>
          <div className="agent-safety-card-next">
            <ShieldCheck size={18} />
            <div>
              <strong>执行前置约束</strong>
              <p>Agent 只会生成草稿和待确认文件操作，必须人工勾选并确认后才写入 `.codelens-agent`。</p>
            </div>
          </div>
          <button className="primary-button" onClick={props.onCreate} disabled={props.busy}>
            {props.busy ? <Loader2 className="spin" size={18} /> : <Bot size={18} />}
            生成确认式计划
          </button>
          <div className="notice warning">
            <TriangleAlert size={18} />
            当前版本不会自动改业务代码；所有写入都有预览、确认和备份记录。
          </div>
        </section>

        <WorkspaceBridgePanel
          bridgeStatus={props.bridgeStatus}
          selectedFiles={selectedFiles}
          onRefresh={props.onRefreshBridge}
          onExportManifest={props.onExportBridgeManifest}
          onToggleBridgeFile={props.onToggleBridgeFile}
        />

        <WorkspaceBridgeInboxPanel
          requests={props.bridgeInbox}
          busy={props.busy}
          onRefresh={props.onRefreshBridgeInbox}
          onCreatePlan={props.onCreateFromBridgeInbox}
        />

        <section className="agent-task-list-next">
          <div className="section-title-next">
            <span>历史计划</span>
            <h3>Agent 任务</h3>
          </div>
          <div className="agent-task-filter-next">
            <Search size={16} />
            <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="搜索目标、摘要或上下文" />
            <select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="planned">已计划</option>
              <option value="applied">已应用</option>
              <option value="partial">部分应用</option>
              <option value="rolled_back">已回滚</option>
            </select>
          </div>
          <div className="report-list">
            {displayedTasks.map((task) => (
              <article className={props.activeTask?.id === task.id ? "report-row active" : "report-row"} key={task.id}>
                <button className="report-main" onClick={() => props.onOpen(task)}>
                  <strong>{task.title}</strong>
                  <span>{contextKindLabel(task.context_kind)} · {taskStatusLabel(task.status)} · {formatTime(task.updated_at)}</span>
                  <p>{task.summary}</p>
                </button>
                <button className="icon-button danger" onClick={() => props.onDelete(task.id)} aria-label="删除 Agent 计划">
                  <Trash2 size={18} />
                </button>
              </article>
            ))}
            {displayedTasks.length === 0 && <div className="empty">暂无匹配的 Agent 计划。</div>}
          </div>
        </section>
      </aside>

      <article className="agent-detail-next">
        {props.activeTask ? (
          <>
            <div className="agent-detail-hero-next">
              <div>
                <span>{contextKindLabel(props.activeTask.context_kind)} / {taskStatusLabel(props.activeTask.status)}</span>
                <h3>{props.activeTask.title}</h3>
                <p>{props.activeTask.summary}</p>
              </div>
              <div className="button-row wrap">
                <button className="secondary-button" disabled={props.busy} onClick={props.onCreateCard} type="button">
                  <GraduationCap size={18} />
                  生成卡片
                </button>
                <button className="secondary-button" disabled={props.busy} onClick={props.onAddDailyLog} type="button">
                  <Save size={18} />
                  加入日志
                </button>
                <button className="secondary-button" disabled={props.busy} onClick={props.onChatAboutTask} type="button">
                  <MessageSquare size={18} />
                  围绕计划对话
                </button>
                <button className="secondary-button" disabled={props.busy} onClick={props.onExport} type="button">
                  <Download size={18} />
                  导出计划
                </button>
                <button className="primary-button" disabled={props.busy || selectedPendingCount === 0} onClick={props.onApply} type="button">
                  {props.busy ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
                  确认应用选中 {selectedPendingCount ? `(${selectedPendingCount})` : ""}
                </button>
              </div>
            </div>

            <div className="agent-exec-strip-next">
              <small>状态 <strong>{taskStatusLabel(props.activeTask.status)}</strong></small>
              <small>候选文件 <strong>{props.activeTask.selected_file_paths.length}</strong></small>
              <small>步骤 <strong>{props.activeTask.steps.length}</strong></small>
              <small>待确认 <strong>{operationStatsValue.pending}</strong></small>
              <small>已应用 <strong>{operationStatsValue.applied}</strong></small>
              <small>失败 <strong>{operationStatsValue.failed}</strong></small>
            </div>

            <ExecutionFlow task={props.activeTask} selectedPendingCount={selectedPendingCount} operationStats={operationStatsValue} />

            <section className="agent-context-files-next">
              <div className="section-title-next">
                <span>
                  <FileCode2 size={15} />
                  上下文文件
                </span>
                <h3>本次计划引用范围</h3>
              </div>
              <div className="simple-list">
                {props.activeTask.selected_file_paths.map((path) => <p key={path}><code>{path}</code></p>)}
                {props.activeTask.selected_file_paths.length === 0 && <p className="muted">暂无候选文件。</p>}
              </div>
            </section>

            <section className="agent-steps-next">
              <div className="section-title-next">
                <span>
                  <GitBranch size={15} />
                  步骤拆解
                </span>
                <h3>计划执行路线</h3>
              </div>
              {props.activeTask.steps.map((step) => (
                <div className="step-card" key={step.id}>
                  <strong>{step.position}. {step.title}</strong>
                  <p>{step.detail}</p>
                  <p><b>风险：</b>{step.risk}</p>
                  <p><b>建议补丁：</b>{step.suggested_patch}</p>
                </div>
              ))}
              {props.activeTask.steps.length === 0 && <p className="muted">暂无步骤拆解。</p>}
            </section>

            <section className="agent-operations-next">
              <div className="report-head">
                <div>
                  <h4>待确认文件操作</h4>
                  <p>{props.activeTask.apply_summary || "审查每个操作的路径、预览和备份信息后再确认应用。"}</p>
                </div>
                <button className="primary-button" disabled={props.busy || selectedPendingCount === 0} onClick={props.onApply}>
                  {props.busy ? <Loader2 className="spin" size={18} /> : <PlayCircle size={18} />}
                  应用选中操作
                </button>
              </div>
              <div className="simple-list">
                {props.activeTask.operations.map((operation) => (
                  <label className={`operation-card ${operation.status}`} key={operation.id}>
                    <input
                      type="checkbox"
                      disabled={operation.status !== "pending"}
                      checked={props.selectedOperationIds.includes(operation.id)}
                      onChange={(event) => props.onToggleOperation(operation.id, event.target.checked)}
                    />
                    <span>
                      <strong>{operation.title}</strong>
                      <small>{operationTypeLabel(operation.operation)} · {operationStatusLabel(operation.status)} · {operation.path}</small>
                      <p>{operation.preview}</p>
                      <div className="agent-operation-actions-next">
                        <button className="mini-button" type="button" onClick={(event) => { event.preventDefault(); setExpandedOperationId(expandedOperationId === operation.id ? null : operation.id); }}>
                          {expandedOperationId === operation.id ? "收起写入内容" : "查看写入内容"}
                        </button>
                        {operation.status === "applied" && (
                          <button className="mini-button danger" type="button" onClick={(event) => { event.preventDefault(); props.onRollbackOperation(operation.id); }}>
                            <RotateCcw size={14} />
                            回滚
                          </button>
                        )}
                      </div>
                      {expandedOperationId === operation.id && (
                        <pre className="agent-operation-preview-next">{operation.replacement}</pre>
                      )}
                      {operation.backup_path && <p className="muted">备份：{operation.backup_path}</p>}
                      {operation.applied_at && <p className="muted">应用时间：{formatTime(operation.applied_at)}</p>}
                      {operation.error && <p className="muted">错误：{operation.error}</p>}
                    </span>
                  </label>
                ))}
                {props.activeTask.operations.length === 0 && <p className="muted">当前计划没有文件操作。</p>}
              </div>
            </section>
          </>
        ) : (
          <div className="workbench-empty-next">
            <Bot size={38} />
            <h3>生成或打开一个 Agent 计划</h3>
            <p>这里会显示步骤拆解、候选文件、待确认文件操作、备份路径和执行结果。</p>
          </div>
        )}
      </article>
    </section>
  );
}

function WorkspaceBridgePanel({
  bridgeStatus,
  selectedFiles,
  onRefresh,
  onExportManifest,
  onToggleBridgeFile
}: {
  bridgeStatus: WorkspaceBridgeStatus | null;
  selectedFiles: WorkspaceBridgeStatus["candidate_files"];
  onRefresh: () => void;
  onExportManifest: () => void;
  onToggleBridgeFile: (path: string, selected: boolean) => void;
}) {
  const candidateFiles = bridgeStatus?.candidate_files || [];
  return (
    <section className="agent-bridge-next">
      <div className="report-head">
        <div>
          <h3>工作区桥接</h3>
          <p>{bridgeStatus?.message || "尚未加载工作区桥接状态。"}</p>
        </div>
        <div className="button-row wrap">
          <button className="mini-button" type="button" onClick={onRefresh}>
            <RefreshCw size={16} />
            刷新
          </button>
          <button className="mini-button" type="button" onClick={onExportManifest} disabled={!bridgeStatus?.connected}>
            <Download size={16} />
            导出桥接清单
          </button>
        </div>
      </div>
      <div className="agent-bridge-manifest-next">
        <Archive size={17} />
        <div>
          <strong>面向 VS Code 插件和外部工具的本地清单</strong>
          <p>导出 `manifest.json` 与 `README.md`，并同步到稳定入口 `storage/bridge/current/`；清单只包含路径、语言、行数、复杂度、风险计数和已选上下文，不导出源码正文。</p>
        </div>
      </div>
      <div className="tag-row">
        <span>{bridgeStatus?.connected ? "已连接" : "未连接"}</span>
        <span>{bridgeStatus?.plugin_version || "无插件心跳"}</span>
        <span>{bridgeStatus?.workspace_name || "未选择工作区"}</span>
        <span>心跳：{bridgeStatus?.heartbeat_at ? formatTime(bridgeStatus.heartbeat_at) : "暂无"}</span>
        <span>最近同步：{bridgeStatus?.updated_at ? formatTime(bridgeStatus.updated_at) : "暂无"}</span>
      </div>
      <div className="agent-selected-next">
        <span>已选择 {selectedFiles.length} 个文件作为 Agent 上下文</span>
        {selectedFiles.slice(0, 4).map((file) => <code key={file.path}>{file.path}</code>)}
      </div>
      <div className="simple-list">
        {candidateFiles.slice(0, 12).map((file) => (
          <label className="bridge-file" key={file.path}>
            <input type="checkbox" checked={file.selected} onChange={(event) => onToggleBridgeFile(file.path, event.target.checked)} />
            <span>
              <strong>{file.path}</strong>
              <small>{file.language} · {file.total_lines} 行 · 复杂度 {file.complexity_score} · 风险 {file.risk_count}</small>
            </span>
          </label>
        ))}
        {candidateFiles.length === 0 && <p className="muted">导入工作区后，这里会显示可供 Agent 引用的候选文件。</p>}
      </div>
    </section>
  );
}

function WorkspaceBridgeInboxPanel({
  requests,
  busy,
  onRefresh,
  onCreatePlan
}: {
  requests: WorkspaceBridgeInboxRequest[];
  busy: boolean;
  onRefresh: () => void;
  onCreatePlan: (requestId: string) => void;
}) {
  const pendingRequests = requests.filter((item) => item.status !== "processed");
  return (
    <section className="agent-bridge-next bridge-inbox-next">
      <div className="report-head">
        <div>
          <h3>桥接收件箱</h3>
          <p>外部编辑器或本地脚本可以把 JSON 请求写入 `storage/bridge/inbox/`，这里会把请求转换成需要人工确认的 Agent 计划。</p>
        </div>
        <button className="mini-button" type="button" onClick={onRefresh}>
          <RefreshCw size={16} />
          刷新收件箱
        </button>
      </div>
      <div className="agent-bridge-manifest-next">
        <Inbox size={17} />
        <div>
          <strong>双向本地桥接入口</strong>
          <p>收件箱只接收目标、上下文和候选文件路径，不要求外部工具写入源码正文；处理后的请求会移动到 `storage/bridge/processed/`。</p>
        </div>
      </div>
      <div className="simple-list">
        {pendingRequests.map((request) => (
          <article className={`bridge-inbox-card ${request.status}`} key={request.id}>
            <div>
              <strong>{request.goal}</strong>
              <small>{request.source} · {contextKindLabel(request.context_kind)} · {request.selected_file_paths.length} 个文件 · {formatTime(request.created_at)}</small>
              <p>
                上下文：<code>{request.context_id}</code>
              </p>
              {request.selected_file_paths.length > 0 && (
                <div className="agent-selected-next compact">
                  {request.selected_file_paths.slice(0, 4).map((path) => <code key={path}>{path}</code>)}
                </div>
              )}
              {request.error && <p className="muted">解析错误：{request.error}</p>}
            </div>
            <button
              className="mini-button"
              type="button"
              disabled={busy || request.status === "invalid"}
              onClick={() => onCreatePlan(request.id)}
            >
              <Bot size={15} />
              生成计划
            </button>
          </article>
        ))}
        {pendingRequests.length === 0 && (
          <div className="empty">
            暂无外部请求。后续 VS Code 插件或本地脚本可以向 `storage/bridge/inbox/` 写入 JSON 来唤起 Agent 计划。
          </div>
        )}
      </div>
    </section>
  );
}

function ExecutionFlow({
  task,
  selectedPendingCount,
  operationStats
}: {
  task: AgentTask;
  selectedPendingCount: number;
  operationStats: ReturnType<typeof agentOperationStats>;
}) {
  const items = [
    { icon: <Bot size={16} />, title: "生成计划", detail: task.steps.length ? `已生成 ${task.steps.length} 个步骤` : "等待步骤拆解", done: task.steps.length > 0 },
    { icon: <FileCode2 size={16} />, title: "选择上下文", detail: task.selected_file_paths.length ? `${task.selected_file_paths.length} 个文件参与计划` : "未绑定文件", done: task.selected_file_paths.length > 0 },
    { icon: <ShieldCheck size={16} />, title: "人工确认", detail: selectedPendingCount ? `已选中 ${selectedPendingCount} 个待应用操作` : "勾选需要应用的操作", done: selectedPendingCount > 0 || operationStats.applied > 0 },
    { icon: <Archive size={16} />, title: "备份追踪", detail: operationStats.applied ? `已应用 ${operationStats.applied} 个操作` : "应用后记录备份与结果", done: operationStats.applied > 0 }
  ];

  return (
    <section className="agent-flow-next">
      {items.map((item, index) => (
        <article className={item.done ? "done" : ""} key={item.title}>
          <span>{item.icon}</span>
          <strong>{index + 1}. {item.title}</strong>
          <p>{item.detail}</p>
        </article>
      ))}
    </section>
  );
}

function describeAgentContext(context: string, workspaces: WorkspaceSummary[], workspace: WorkspaceDetail | null, findings: Finding[], reports: ReportSummary[]) {
  const [kind, rawId = ""] = context.split("|", 2);
  if (!kind || kind === "none") return "无指定上下文，将作为通用开发任务处理";
  if (kind === "workspace") return `工作区：${workspaces.find((item) => item.id === rawId)?.name || "当前工作区"}`;
  if (kind === "file") {
    const path = rawId.includes("::") ? rawId.split("::").slice(1).join("::") : rawId;
    const file = workspace?.files.find((item) => item.path === path);
    return `文件：${file?.path || path || "当前文件"}`;
  }
  if (kind === "finding") return `问题：${findings.find((item) => item.id === rawId)?.title || "当前问题"}`;
  if (kind === "report") return `报告：${reports.find((item) => item.id === rawId)?.title || "当前报告"}`;
  return context;
}

function agentTaskStats(tasks: AgentTask[]) {
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status !== "applied").length,
    applied: tasks.filter((task) => task.status === "applied").length
  };
}

function agentOperationStats(operations: AgentTask["operations"]) {
  return {
    pending: operations.filter((operation) => operation.status === "pending").length,
    applied: operations.filter((operation) => operation.status === "applied").length,
    failed: operations.filter((operation) => operation.status === "failed").length
  };
}

function contextKindLabel(value: string) {
  const labels: Record<string, string> = {
    none: "通用任务",
    workspace: "工作区",
    file: "文件",
    finding: "问题",
    report: "报告"
  };
  return labels[value] || value;
}

function taskStatusLabel(value: string) {
  const labels: Record<string, string> = {
    planned: "已计划",
    pending: "待确认",
    applied: "已应用",
    failed: "失败",
    partial: "部分应用",
    rolled_back: "已回滚"
  };
  return labels[value] || value;
}

function operationStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "待确认",
    applied: "已应用",
    failed: "失败",
    skipped: "已跳过",
    rolled_back: "已回滚"
  };
  return labels[value] || value;
}

function operationTypeLabel(value: string) {
  const labels: Record<string, string> = {
    create: "创建",
    update: "更新",
    replace: "替换",
    create_or_replace: "创建或替换",
    append: "追加",
    note: "说明"
  };
  return labels[value] || value;
}

function formatTime(value: string) {
  if (!value) return "暂无";
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return value;
  }
}
