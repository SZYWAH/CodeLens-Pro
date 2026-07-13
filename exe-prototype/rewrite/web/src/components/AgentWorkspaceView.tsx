import {
  Archive,
  Bot,
  CheckCircle2,
  Download,
  FileCode2,
  GraduationCap,
  Inbox,
  Loader2,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import { useId, useRef, useState, type Ref } from "react";
import { useOverlayFocus } from "../hooks/useOverlayFocus";
import { AccessibleListbox, type ListboxOption } from "./AccessibleListbox";
import { ProductToolbar } from "./ProductShell";
import type {
  AgentTask,
  Finding,
  ReportSummary,
  WorkspaceBridgeInboxRequest,
  WorkspaceBridgeStatus,
  WorkspaceDetail,
  WorkspaceSummary
} from "../types";

type AgentProps = {
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
};

const taskStatusOptions: ListboxOption[] = [
  { value: "all", label: "全部状态" },
  { value: "planned", label: "已计划" },
  { value: "applied", label: "已写入" },
  { value: "partial", label: "部分写入" },
  { value: "rolled_back", label: "已回滚" },
  { value: "failed", label: "失败" }
];

export function AgentWorkspaceView(props: AgentProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [mobileIndexOpen, setMobileIndexOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<"bridge" | "inbox">("bridge");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedOperationId, setExpandedOperationId] = useState<string | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const availableTasks = props.activeTask && !props.tasks.some((task) => task.id === props.activeTask?.id)
    ? [props.activeTask, ...props.tasks]
    : props.tasks;
  const stats = taskStats(availableTasks);
  const operationStats = getOperationStats(props.activeTask?.operations || []);
  const selectedPendingCount = props.activeTask?.operations.filter(
    (operation) => operation.status === "pending" && props.selectedOperationIds.includes(operation.id)
  ).length || 0;
  const contextText = describeContext(props.context, props.workspaces, props.activeWorkspace, props.findings, props.reports);
  const normalizedQuery = query.trim().toLowerCase();
  const displayedTasks = availableTasks.filter((task) => {
    const statusMatches = status === "all" || task.status === status;
    const textMatches = !normalizedQuery || [task.title, task.summary, task.context_kind, task.apply_summary]
      .some((value) => value.toLowerCase().includes(normalizedQuery));
    return statusMatches && textMatches;
  });

  useOverlayFocus({
    active: createOpen || advancedOpen,
    containerRef: drawerRef,
    initialFocusRef: drawerCloseRef,
    returnFocusRef: drawerTriggerRef,
    onRequestClose: () => {
      setCreateOpen(false);
      setAdvancedOpen(false);
    }
  });

  function openTask(task: AgentTask) {
    props.onOpen(task);
    setMobileIndexOpen(false);
  }

  function createTask() {
    props.onCreate();
    setCreateOpen(false);
  }

  return (
    <section className="agent-workspace-v140">
      <ProductToolbar>
        <div className="product-toolbar-context-next">{stats.total} 份草稿 · {stats.pending} 份待确认 · {stats.applied} 份已写入</div>
        <nav className="product-toolbar-actions-next">
          <button type="button" onClick={(event) => { drawerTriggerRef.current = event.currentTarget; setAdvancedOpen(true); }}><MoreHorizontal size={14} />高级</button>
          <button className="primary-button" type="button" onClick={(event) => { drawerTriggerRef.current = event.currentTarget; setCreateOpen(true); }}><Plus size={14} />新建草稿</button>
        </nav>
      </ProductToolbar>

      <button className="agent-mobile-index-v140" type="button" onClick={() => setMobileIndexOpen(true)}>
        <Menu size={15} />草稿列表
      </button>

      <div className="agent-layout-v140">
        {mobileIndexOpen && <button className="agent-index-scrim-v140" aria-label="关闭草稿列表" type="button" onClick={() => setMobileIndexOpen(false)} />}
        <aside className={`agent-index-v140 ${mobileIndexOpen ? "is-open" : ""}`}>
          <header>
            <strong>任务索引</strong>
            <button aria-label="关闭草稿列表" type="button" onClick={() => setMobileIndexOpen(false)}><X size={16} /></button>
          </header>
          <label className="agent-search-v140">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索目标或摘要" />
          </label>
          <div className="agent-filter-v140">
            <AccessibleListbox compact label="状态" value={status} onChange={setStatus} options={taskStatusOptions} />
          </div>
          <div className="agent-task-list-v140">
            {displayedTasks.map((task) => (
              <article className={props.activeTask?.id === task.id ? "active" : ""} key={task.id}>
                <button type="button" onClick={() => openTask(task)}>
                  <strong>{task.title}</strong>
                  <span>{contextLabel(task.context_kind)} · {statusLabel(task.status)}</span>
                  <small>{formatTime(task.updated_at)}</small>
                </button>
                <button aria-label={`删除草稿 ${task.title}`} type="button" onClick={() => setDeleteId(task.id)}><Trash2 size={14} /></button>
                {deleteId === task.id && (
                  <div className="agent-delete-confirm-v140">
                    <span>确认删除这份草稿？</span>
                    <button type="button" onClick={() => { props.onDelete(task.id); setDeleteId(null); }}>删除</button>
                    <button type="button" onClick={() => setDeleteId(null)}>取消</button>
                  </div>
                )}
              </article>
            ))}
            {!displayedTasks.length && <p>没有匹配的行动草稿。</p>}
          </div>
        </aside>

        <main className="agent-detail-v140">
          {props.activeTask ? (
            <>
              <header className="agent-detail-head-v140">
                <div>
                  <span>{contextLabel(props.activeTask.context_kind)} · {statusLabel(props.activeTask.status)}</span>
                  <h3>{props.activeTask.title}</h3>
                  <p>{props.activeTask.summary}</p>
                </div>
                <nav>
                  <button title="生成知识卡片" type="button" disabled={props.busy} onClick={props.onCreateCard}><GraduationCap size={15} /></button>
                  <button title="加入每日日志" type="button" disabled={props.busy} onClick={props.onAddDailyLog}><Save size={15} /></button>
                  <button title="围绕草稿对话" type="button" disabled={props.busy} onClick={props.onChatAboutTask}><MessageSquare size={15} /></button>
                  <button title="导出草稿" type="button" disabled={props.busy} onClick={props.onExport}><Download size={15} /></button>
                  <button className="primary-button" type="button" disabled={props.busy || selectedPendingCount === 0} onClick={props.onApply}>
                    {props.busy ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
                    确认写入{selectedPendingCount ? ` (${selectedPendingCount})` : ""}
                  </button>
                </nav>
              </header>

              <dl className="agent-meta-v140">
                <Meta label="候选文件" value={props.activeTask.selected_file_paths.length} />
                <Meta label="计划步骤" value={props.activeTask.steps.length} />
                <Meta label="待确认" value={operationStats.pending} />
                <Meta label="已写入" value={operationStats.applied} />
                <Meta label="失败" value={operationStats.failed} />
              </dl>

              <section className="agent-section-v140">
                <SectionHead icon={<ShieldCheck size={15} />} title="写入边界" detail={props.activeTask.apply_summary || "逐项检查目标路径和写入内容，确认后才会写入。"} />
                <p className="agent-safety-v140">只允许写入 `.codelens-agent/tasks` 草稿文件；每次应用记录备份路径，并可按操作回滚。</p>
              </section>

              <section className="agent-section-v140">
                <SectionHead icon={<FileCode2 size={15} />} title="上下文文件" detail={`${props.activeTask.selected_file_paths.length} 个文件参与本次草稿`} />
                <div className="agent-file-list-v140">
                  {props.activeTask.selected_file_paths.map((path) => <code key={path}>{path}</code>)}
                  {!props.activeTask.selected_file_paths.length && <p>当前草稿没有绑定候选文件。</p>}
                </div>
              </section>

              <section className="agent-section-v140">
                <SectionHead icon={<Bot size={15} />} title="计划与检查清单" detail="按顺序复核目标、风险和验证方式" />
                <div className="agent-step-list-v140">
                  {props.activeTask.steps.map((step) => (
                    <article key={step.id}>
                      <span>{step.position}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.detail}</p>
                        <small>风险：{step.risk}</small>
                        <small>建议：{step.suggested_patch}</small>
                      </div>
                    </article>
                  ))}
                  {!props.activeTask.steps.length && <p>暂无计划步骤。</p>}
                </div>
              </section>

              <section className="agent-section-v140">
                <SectionHead icon={<Archive size={15} />} title="待确认文件操作" detail={`${selectedPendingCount} 项已选中，${operationStats.applied} 项已写入`} />
                <div className="agent-operation-list-v140">
                  {props.activeTask.operations.map((operation) => (
                    <article className={operation.status} key={operation.id}>
                      <input
                        aria-label={`选择操作 ${operation.title}`}
                        type="checkbox"
                        disabled={operation.status !== "pending"}
                        checked={props.selectedOperationIds.includes(operation.id)}
                        onChange={(event) => props.onToggleOperation(operation.id, event.target.checked)}
                      />
                      <div>
                        <header>
                          <strong>{operation.title}</strong>
                          <span>{operationTypeLabel(operation.operation)} · {operationStatusLabel(operation.status)}</span>
                        </header>
                        <code>{operation.path}</code>
                        <p>{operation.preview}</p>
                        <nav>
                          <button type="button" onClick={() => setExpandedOperationId(expandedOperationId === operation.id ? null : operation.id)}>
                            {expandedOperationId === operation.id ? "收起内容" : "查看内容"}
                          </button>
                          {operation.status === "applied" && <button className="danger" type="button" onClick={() => props.onRollbackOperation(operation.id)}><RotateCcw size={13} />回滚</button>}
                        </nav>
                        {expandedOperationId === operation.id && <pre>{operation.replacement}</pre>}
                        {operation.backup_path && <small>备份：{operation.backup_path}</small>}
                        {operation.error && <small className="error">错误：{operation.error}</small>}
                      </div>
                    </article>
                  ))}
                  {!props.activeTask.operations.length && <p>当前草稿没有文件操作。</p>}
                </div>
              </section>
            </>
          ) : (
            <div className="agent-empty-v140">
              <Bot size={34} />
              <strong>打开或创建一份行动草稿</strong>
              <p>草稿会集中展示计划、检查清单、目标文件、备份和回滚状态。</p>
              <button className="primary-button" type="button" onClick={(event) => { drawerTriggerRef.current = event.currentTarget; setCreateOpen(true); }}><Plus size={14} />新建草稿</button>
            </div>
          )}
        </main>
      </div>

      {createOpen && (
        <Drawer title="新建行动草稿" onClose={() => setCreateOpen(false)} dialogRef={drawerRef} closeButtonRef={drawerCloseRef}>
          <div className="agent-create-v140">
            <label>任务目标<textarea value={props.goal} onChange={(event) => props.onGoalChange(event.target.value)} placeholder="描述要解决的问题、输出和验证目标" /></label>
            <label>上下文<select value={props.context} onChange={(event) => props.onContextChange(event.target.value)}>
              <option value="none|">自动使用当前工作区</option>
              {props.workspaces.map((item) => <option key={item.id} value={`workspace|${item.id}`}>工作区：{item.name}</option>)}
              {props.activeWorkspace?.files.slice(0, 40).map((file) => <option key={file.id} value={`file|${props.activeWorkspace?.summary.id}::${file.path}`}>文件：{file.path}</option>)}
              {props.findings.map((item) => <option key={item.id} value={`finding|${item.id}`}>问题：{item.title}</option>)}
              {props.reports.map((item) => <option key={item.id} value={`report|${item.id}`}>报告：{item.title}</option>)}
            </select></label>
            <div className="agent-context-v140"><span>当前上下文</span><strong>{contextText}</strong></div>
            <div className="agent-create-safety-v140"><ShieldCheck size={17} /><p>本轮只生成确认式草稿文件，不执行 rename、delete 或真实业务代码 patch。</p></div>
            <button className="primary-button" type="button" disabled={props.busy || !props.goal.trim()} onClick={createTask}>
              {props.busy ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}生成草稿
            </button>
          </div>
        </Drawer>
      )}

      {advancedOpen && (
        <Drawer title="高级本地能力" onClose={() => setAdvancedOpen(false)} dialogRef={drawerRef} closeButtonRef={drawerCloseRef} wide>
          <div className="agent-advanced-tabs-v140">
            <button className={advancedTab === "bridge" ? "active" : ""} type="button" onClick={() => setAdvancedTab("bridge")}>工作区清单</button>
            <button className={advancedTab === "inbox" ? "active" : ""} type="button" onClick={() => setAdvancedTab("inbox")}>桥接收件箱</button>
          </div>
          {advancedTab === "bridge"
            ? <BridgePanel status={props.bridgeStatus} onRefresh={props.onRefreshBridge} onExport={props.onExportBridgeManifest} onToggle={props.onToggleBridgeFile} />
            : <InboxPanel requests={props.bridgeInbox} busy={props.busy} onRefresh={props.onRefreshBridgeInbox} onCreate={props.onCreateFromBridgeInbox} />}
        </Drawer>
      )}
    </section>
  );
}

function Drawer({ title, onClose, wide = false, dialogRef, closeButtonRef, children }: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  dialogRef: Ref<HTMLElement>;
  closeButtonRef: Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  const titleId = `agent-drawer-title-${useId().replace(/:/g, "")}`;
  return <><button className="agent-drawer-scrim-v140" aria-label={`关闭${title}`} type="button" onClick={onClose} /><aside aria-labelledby={titleId} aria-modal="true" className={`agent-drawer-v140 ${wide ? "wide" : ""}`} ref={dialogRef} role="dialog"><header><strong id={titleId}>{title}</strong><button aria-label={`关闭${title}`} type="button" onClick={onClose} ref={closeButtonRef}><X size={16} /></button></header><div>{children}</div></aside></>;
}

function BridgePanel({ status, onRefresh, onExport, onToggle }: { status: WorkspaceBridgeStatus | null; onRefresh: () => void; onExport: () => void; onToggle: (path: string, selected: boolean) => void }) {
  const files = status?.candidate_files || [];
  return <section className="agent-advanced-body-v140"><header><div><strong>工作区候选文件</strong><span>{status?.message || "尚未加载桥接状态。"}</span></div><nav><button type="button" onClick={onRefresh}><RefreshCw size={13} />刷新</button><button type="button" disabled={!status?.connected} onClick={onExport}><Download size={13} />导出清单</button></nav></header><p>清单只包含路径和统计信息，不导出源码正文。</p><div className="agent-bridge-files-v140">{files.slice(0, 18).map((file) => <label key={file.path}><input type="checkbox" checked={file.selected} onChange={(event) => onToggle(file.path, event.target.checked)} /><span><strong>{file.path}</strong><small>{file.language} · {file.total_lines} 行 · 风险 {file.risk_count}</small></span></label>)}{!files.length && <p>导入工作区后可在这里选择候选文件。</p>}</div></section>;
}

function InboxPanel({ requests, busy, onRefresh, onCreate }: { requests: WorkspaceBridgeInboxRequest[]; busy: boolean; onRefresh: () => void; onCreate: (id: string) => void }) {
  const pending = requests.filter((item) => item.status !== "processed");
  return <section className="agent-advanced-body-v140"><header><div><strong>桥接收件箱</strong><span>把本地 JSON 请求转换为待确认草稿。</span></div><button type="button" onClick={onRefresh}><RefreshCw size={13} />刷新</button></header><p>仅接收目标、上下文和候选路径；处理后请求会移入 processed 目录。</p><div className="agent-inbox-v140">{pending.map((request) => <article key={request.id}><Inbox size={15} /><div><strong>{request.goal}</strong><span>{request.source} · {contextLabel(request.context_kind)} · {request.selected_file_paths.length} 个文件</span><small>{formatTime(request.created_at)}</small></div><button type="button" disabled={busy || request.status === "invalid"} onClick={() => onCreate(request.id)}>生成草稿</button></article>)}{!pending.length && <p>暂无待处理的外部请求。</p>}</div></section>;
}

function SectionHead({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <header className="agent-section-head-v140"><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div></header>;
}

function Meta({ label, value }: { label: string; value: number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function describeContext(context: string, workspaces: WorkspaceSummary[], workspace: WorkspaceDetail | null, findings: Finding[], reports: ReportSummary[]) {
  const [kind, rawId = ""] = context.split("|", 2);
  if (!kind || kind === "none") return workspace ? `当前工作区：${workspace.summary.name}` : "通用草稿";
  if (kind === "workspace") return `工作区：${workspaces.find((item) => item.id === rawId)?.name || "当前工作区"}`;
  if (kind === "file") return `文件：${rawId.includes("::") ? rawId.split("::").slice(1).join("::") : rawId}`;
  if (kind === "finding") return `问题：${findings.find((item) => item.id === rawId)?.title || "当前问题"}`;
  if (kind === "report") return `报告：${reports.find((item) => item.id === rawId)?.title || "当前报告"}`;
  return context;
}

function taskStats(tasks: AgentTask[]) {
  return { total: tasks.length, pending: tasks.filter((task) => task.status !== "applied").length, applied: tasks.filter((task) => task.status === "applied").length };
}

function getOperationStats(operations: AgentTask["operations"]) {
  return { pending: operations.filter((item) => item.status === "pending").length, applied: operations.filter((item) => item.status === "applied").length, failed: operations.filter((item) => item.status === "failed").length };
}

function contextLabel(value: string) {
  return ({ none: "通用任务", general: "通用任务", workspace: "工作区", file: "文件", finding: "问题", report: "报告", deleted_report: "原报告已删除" } as Record<string, string>)[value] || value;
}

function statusLabel(value: string) {
  return ({ planned: "已计划", pending: "待确认", applied: "已写入", failed: "失败", partial: "部分写入", rolled_back: "已回滚" } as Record<string, string>)[value] || value;
}

function operationStatusLabel(value: string) {
  return ({ pending: "待确认", applied: "已写入", failed: "失败", skipped: "已跳过", rolled_back: "已回滚" } as Record<string, string>)[value] || value;
}

function operationTypeLabel(value: string) {
  return ({ create: "创建", update: "更新", replace: "替换", create_or_replace: "创建或替换", append: "追加", note: "说明" } as Record<string, string>)[value] || value;
}

function formatTime(value: string) {
  if (!value) return "暂无";
  try { return new Date(value).toLocaleString("zh-CN", { hour12: false }); } catch { return value; }
}
