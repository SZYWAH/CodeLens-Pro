import {
  ChevronDown,
  ChevronRight,
  Cpu,
  FileCode2,
  Folder,
  FolderOpen,
  FolderTree,
  Map,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChatPanel } from "../components/ChatPanel";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";
import { getApiBase } from "../lib/runtime";
import { ProjectGuideContent } from "./ProjectGuidePage";
import type { AgentContextMode, ChatSessionListItem, ProjectGuideResponse, SettingsResponse, WorkspaceSnapshot, WorkspaceTreeNode } from "../types";

const MAX_AGENT_CONTEXT_FILES = 20;

export function AgentPage({
  settings,
  selectedSessionId,
  onSelectedSessionIdChange,
  onActivityChanged,
}: {
  settings: SettingsResponse | null;
  selectedSessionId: string | null;
  onSelectedSessionIdChange: (sessionId: string | null) => void;
  onActivityChanged?: () => void;
}) {
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceHoverOpen, setWorkspaceHoverOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [projectGuideOpen, setProjectGuideOpen] = useState(false);
  const [projectGuide, setProjectGuide] = useState<ProjectGuideResponse | null>(null);
  const [projectGuideLoading, setProjectGuideLoading] = useState(false);
  const [projectGuideError, setProjectGuideError] = useState("");
  const workspaceAnchorRef = useRef<HTMLDivElement | null>(null);
  const [workspacePopoverStyle, setWorkspacePopoverStyle] = useState<CSSProperties>({});
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(() => new Set([""]));
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [contextMode, setContextMode] = useState<AgentContextMode>("manual");
  const workspacePanelOpen = workspaceOpen || workspaceHoverOpen;
  const webApiBase = getApiBase() || "同源 /api";
  const workspaceReady = Boolean(workspace?.connected && !workspace.stale && workspace.status !== "no_workspace");

  async function loadSessions() {
    setLoading(true);
    setError("");
    try {
      setSessions(await api.listChatSessions({
        query: query || undefined,
        context_type: "agent",
      }));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Agent 会话加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function removeSession(id: string) {
    await api.deleteChatSession(id);
    if (selectedSessionId === id) onSelectedSessionIdChange(null);
    await loadSessions();
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function loadWorkspace() {
    setWorkspaceLoading(true);
    setWorkspaceError("");
    setWorkspaceNotice("");
    try {
      setWorkspace(await api.currentWorkspace());
    } catch (exc) {
      setWorkspaceError(exc instanceof Error ? exc.message : "当前项目状态加载失败");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function loadProjectGuide() {
    setProjectGuideLoading(true);
    setProjectGuideError("");
    try {
      setProjectGuide(await api.projectGuide());
    } catch (exc) {
      setProjectGuideError(exc instanceof Error ? exc.message : "项目导读加载失败");
    } finally {
      setProjectGuideLoading(false);
    }
  }

  function openProjectGuide() {
    setProjectGuideOpen(true);
    void loadProjectGuide();
  }

  useEffect(() => {
    if (!workspacePanelOpen) return;
    void loadWorkspace();
    const timer = window.setInterval(() => void loadWorkspace(), 5000);
    return () => window.clearInterval(timer);
  }, [workspacePanelOpen]);

  useEffect(() => {
    setExpandedTreePaths(new Set([""]));
    setSelectedFilePaths([]);
  }, [workspace?.workspace_root]);

  useEffect(() => {
    if (!workspacePanelOpen) return;
    const anchor = workspaceAnchorRef.current;
    if (!anchor) return;

    let frame = 0;
    const updatePopoverBounds = () => {
      const rect = anchor.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportTop = window.visualViewport?.offsetTop ?? 0;
      const margin = 16;
      setWorkspacePopoverStyle({
        height: Math.max(260, viewportTop + viewportHeight - margin - rect.bottom - 8),
      });
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updatePopoverBounds);
    };

    updatePopoverBounds();
    const scrollContainer = anchor.closest(".page-scroll");
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);
    scrollContainer?.addEventListener("scroll", scheduleUpdate, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
      scrollContainer?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [workspacePanelOpen]);

  function toggleDirectory(path: string) {
    setExpandedTreePaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function toggleSelectedFile(path: string) {
    if (!path) return;
    if (selectedFilePaths.includes(path)) {
      setWorkspaceNotice("");
      setSelectedFilePaths((current) => current.filter((item) => item !== path));
      return;
    }
    if (selectedFilePaths.length >= MAX_AGENT_CONTEXT_FILES) {
      setWorkspaceNotice(`最多选择 ${MAX_AGENT_CONTEXT_FILES} 个上下文文件。`);
      return;
    }
    setWorkspaceNotice("");
    setSelectedFilePaths((current) => [...current, path]);
  }

  return (
    <div className={["page-scroll chat-page-layout", historyOpen ? "chat-page-layout-open" : "chat-page-layout-closed"].join(" ")}>
      <section className={["tool-panel chat-history-sidebar", historyOpen ? "" : "chat-history-sidebar-collapsed"].filter(Boolean).join(" ")}>
        {historyOpen ? (
          <div className="border-b border-line p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-pine">Agent Workspace</div>
                <h2 className="mt-0.5 truncate text-sm font-black text-[#f8fbff]">Agent 工作区</h2>
              </div>
              <button
                className="icon-button border border-line"
                onClick={() => setHistoryOpen(false)}
                title="收起 Agent 历史"
                type="button"
                aria-expanded={historyOpen}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>

            <div className="mb-2 flex gap-2">
              <div className="relative flex-1">
                <Search className="search-field-icon absolute left-2 top-2.5 text-[#b8c9e6]" size={15} />
                <input
                  className="control-field search-field-input h-9 w-full"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadSessions();
                  }}
                  placeholder="搜索 Agent 任务"
                  value={query}
                />
              </div>
              <button className="icon-button border border-line" onClick={loadSessions} title="刷新" type="button">
                <RefreshCw className={loading ? "animate-spin" : ""} size={16} />
              </button>
            </div>

            <button
              className="btn btn-primary h-9 w-full"
              onClick={() => onSelectedSessionIdChange(null)}
              type="button"
            >
              <MessageSquarePlus size={15} />
              新建 Agent 任务
            </button>

            <div
              className="agent-workspace-anchor"
              ref={workspaceAnchorRef}
              onMouseEnter={() => setWorkspaceHoverOpen(true)}
              onMouseLeave={() => setWorkspaceHoverOpen(false)}
            >
              <button
                className="btn btn-secondary mt-2 h-9 w-full justify-between"
                onClick={() => setWorkspaceOpen((value) => !value)}
                onFocus={() => setWorkspaceHoverOpen(true)}
                onBlur={() => setWorkspaceHoverOpen(false)}
                type="button"
                aria-expanded={workspacePanelOpen}
              >
                <span className="inline-flex items-center gap-2">
                  <FolderTree size={15} />
                  当前项目
                </span>
                <span className={["agent-workspace-dot", workspace?.connected && !workspace.stale ? "agent-workspace-dot-live" : ""].join(" ")} />
              </button>
              {workspacePanelOpen ? (
                <div className="agent-workspace-popover" style={workspacePopoverStyle}>
                  <div className="agent-workspace-head">
                    <div className="min-w-0">
                      <span>{workspaceStatusLabel(workspace)}</span>
                      <strong>{workspace?.workspace_name || "等待 VS Code 插件"}</strong>
                    </div>
                    <div className="agent-workspace-head-actions">
                      <button className="agent-workspace-guide-button" onClick={openProjectGuide} type="button">
                        <Map size={13} />
                        项目导读
                      </button>
                      <button className="icon-button h-7 w-7" onClick={loadWorkspace} type="button" title="刷新项目结构">
                        <RefreshCw className={workspaceLoading ? "animate-spin" : ""} size={13} />
                      </button>
                    </div>
                  </div>
                  {workspace?.workspace_root ? (
                    <div className="agent-workspace-root" title={workspace.workspace_root}>
                      <span>根目录</span>
                      <strong>{workspace.workspace_root}</strong>
                    </div>
                  ) : null}
                  <div className="agent-workspace-diagnostics">
                    <div>
                      <span>Web API</span>
                      <strong>{webApiBase}</strong>
                    </div>
                    <div>
                      <span>最后心跳</span>
                      <strong>{workspace?.updated_at ? formatTime(workspace.updated_at) : "未收到"}</strong>
                    </div>
                    <div>
                      <span>插件版本</span>
                      <strong>{workspace?.plugin_version || "未知"}</strong>
                    </div>
                    <div>
                      <span>状态说明</span>
                      <strong>{workspaceDiagnosticReason(workspace)}</strong>
                    </div>
                  </div>
                  {workspaceNotice ? <div className="agent-workspace-state agent-workspace-notice">{workspaceNotice}</div> : null}
                  {workspaceError ? <div className="agent-workspace-state">{workspaceError}</div> : null}
                  {!workspaceError && workspace?.tree ? (
                    <div className="agent-workspace-tree" role="tree">
                      <WorkspaceTree
                        expandedPaths={expandedTreePaths}
                        node={workspace.tree}
                        depth={0}
                        selectedFilePaths={selectedFilePaths}
                        onToggleDirectory={toggleDirectory}
                        onToggleFile={toggleSelectedFile}
                      />
                    </div>
                  ) : null}
                  {!workspaceError && !workspace?.tree ? (
                    <div className="agent-workspace-state">
                      {workspace?.connected && workspace.status === "no_workspace"
                        ? "VS Code 已连接，但还没有打开项目文件夹。"
                        : "打开 VS Code 插件后，这里会显示当前项目结构。"}
                    </div>
                  ) : null}
                  {workspace?.truncated ? <div className="agent-workspace-state">项目节点较多，已按深度和数量截断。</div> : null}
                </div>
              ) : null}
            </div>

            <div className="agent-workspace-brief">
              <strong>{workspaceReady ? "项目协作链路已就绪" : "项目协作链路待就绪"}</strong>
              <span>Web 端负责下指令、看计划和确认应用；VS Code 插件负责读取工作区并执行文件修改。</span>
              <em>演示建议：先选择 1-3 个核心文件，再让 Agent 生成“小范围重构/补充异常处理/完善说明文案”的计划。</em>
            </div>
            {error ? <div className="mt-2 text-xs text-coral">{error}</div> : null}
          </div>
        ) : (
          <div className="chat-history-rail">
            <button
              className="icon-button border border-line"
              onClick={() => setHistoryOpen(true)}
              title="展开 Agent 历史"
              type="button"
              aria-expanded={historyOpen}
            >
              <PanelLeftOpen size={17} />
            </button>
            <Cpu className="text-pine" size={17} />
            <div className="chat-history-rail-label">Agent</div>
          </div>
        )}

        {historyOpen ? (
          <div className="history-list-scroll">
            {sessions.map((item) => (
              <div
                key={item.id}
                className={[
                  "history-card-shell group",
                  selectedSessionId === item.id ? "history-card-active" : "history-card-idle",
                ].join(" ")}
              >
                <button className="history-card-main" onClick={() => onSelectedSessionIdChange(item.id)} type="button">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="history-card-title">{item.title}</div>
                      <div className="history-card-meta">
                        <span>{formatTime(item.updated_at)}</span>
                        <span className="chat-session-badge">Agent 对话</span>
                      </div>
                    </div>
                  </div>
                </button>
                <button className="history-card-delete icon-button m-2 h-8 w-8 opacity-0 group-hover:opacity-100" onClick={() => removeSession(item.id)} title="删除 Agent 会话" type="button">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {!sessions.length ? <div className="p-4 text-sm text-[#b8c9e6]">暂无 Agent 会话</div> : null}
          </div>
        ) : null}
      </section>

      <ChatPanel
        key={selectedSessionId ?? "new-agent"}
        className="min-h-[520px] xl:min-h-0"
        settings={settings}
        mode="agent"
        title="Agent 工作区"
        emptyText="在这里分析项目、生成修改计划，并从网页端确认插件执行。"
        sessionId={selectedSessionId}
        selectedFilePaths={selectedFilePaths}
        contextMode={contextMode}
        workspace={workspace}
        onSessionIdChange={onSelectedSessionIdChange}
        onSessionSaved={() => {
          void loadSessions();
          onActivityChanged?.();
        }}
        onRemoveSelectedFile={toggleSelectedFile}
        onClearSelectedFiles={() => setSelectedFilePaths([])}
        onContextModeChange={setContextMode}
      />
      {projectGuideOpen ? (
        <ProjectGuideDialog
          error={projectGuideError}
          guide={projectGuide}
          loading={projectGuideLoading}
          workspaceTree={workspace?.tree ?? null}
          onClose={() => setProjectGuideOpen(false)}
          onRefresh={() => void loadProjectGuide()}
        />
      ) : null}
    </div>
  );
}

function ProjectGuideDialog({
  guide,
  loading,
  error,
  workspaceTree,
  onClose,
  onRefresh,
}: {
  guide: ProjectGuideResponse | null;
  loading: boolean;
  error: string;
  workspaceTree: WorkspaceTreeNode | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const dialog = (
    <div className="project-guide-dialog-overlay" role="dialog" aria-modal="true" aria-label="项目导读">
      <section className="project-guide-dialog">
        <div className="project-guide-dialog-head">
          <div>
            <span>Project Guide</span>
            <strong>项目导读</strong>
          </div>
          <button className="icon-button h-8 w-8" onClick={onClose} type="button" title="关闭项目导读">
            <PanelLeftClose size={15} />
          </button>
        </div>
        <div className="project-guide-dialog-body">
          <ProjectGuideContent
            compact
            error={error}
            guide={guide}
            loading={loading}
            onRefresh={onRefresh}
            workspaceTree={workspaceTree}
          />
        </div>
      </section>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

function WorkspaceTree({
  node,
  depth,
  expandedPaths,
  selectedFilePaths,
  onToggleDirectory,
  onToggleFile,
}: {
  node: WorkspaceTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedFilePaths: string[];
  onToggleDirectory: (path: string) => void;
  onToggleFile: (path: string) => void;
}) {
  const children = node.children ?? [];
  const isDirectory = node.type === "directory";
  const expanded = isDirectory && expandedPaths.has(node.path);
  const Icon = isDirectory ? (expanded ? FolderOpen : Folder) : FileCode2;
  const selected = !isDirectory && selectedFilePaths.includes(node.path);

  return (
    <div className="agent-workspace-tree-node" role="treeitem">
      {isDirectory ? (
        <button
          aria-expanded={expanded}
          className="agent-workspace-tree-row agent-workspace-tree-row-directory"
          onClick={() => onToggleDirectory(node.path)}
          style={{ paddingLeft: `${Math.min(depth, 5) * 12}px` }}
          type="button"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Icon size={13} />
          <span title={node.path || node.name}>{node.name}</span>
          {node.truncated ? <em>截断</em> : null}
        </button>
      ) : (
        <label
          className={["agent-workspace-tree-row agent-workspace-tree-row-file", selected ? "agent-workspace-tree-row-selected" : ""].filter(Boolean).join(" ")}
          style={{ paddingLeft: `${Math.min(depth, 5) * 12}px` }}
        >
          <input checked={selected} onChange={() => onToggleFile(node.path)} type="checkbox" />
          <Icon size={13} />
          <span title={node.path || node.name}>{node.name}</span>
          {node.truncated ? <em>截断</em> : null}
        </label>
      )}

      {expanded && children.length ? (
        <div role="group">
          {children.map((child) => (
            <WorkspaceTree
              expandedPaths={expandedPaths}
              key={`${child.type}-${child.path || child.name}`}
              node={child}
              depth={depth + 1}
              selectedFilePaths={selectedFilePaths}
              onToggleDirectory={onToggleDirectory}
              onToggleFile={onToggleFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LegacyWorkspaceTree({ node, depth }: { node: WorkspaceTreeNode; depth: number }) {
  const children = node.children ?? [];
  const Icon = node.type === "directory" ? Folder : FileCode2;
  return (
    <div className="agent-workspace-tree-node" role="treeitem">
      <div className="agent-workspace-tree-row" style={{ paddingLeft: `${Math.min(depth, 5) * 12}px` }}>
        <Icon size={13} />
        <span title={node.path || node.name}>{node.name}</span>
        {node.truncated ? <em>截断</em> : null}
      </div>
      {children.length ? (
        <div role="group">
          {children.map((child) => (
            <LegacyWorkspaceTree key={`${child.type}-${child.path || child.name}`} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function workspaceStatusLabel(snapshot: WorkspaceSnapshot | null) {
  if (!snapshot) return "正在读取心跳";
  if (snapshot.stale || !snapshot.connected) return "未收到插件心跳";
  if (snapshot.status === "no_workspace") return "VS Code 已连接";
  return `${snapshot.node_count || 0} 个节点`;
}

function workspaceDiagnosticReason(snapshot: WorkspaceSnapshot | null) {
  if (!snapshot) return "等待 Web 端读取后端状态";
  if (snapshot.connected && !snapshot.stale && snapshot.status === "connected") return "连接正常";
  if (snapshot.connected && snapshot.status === "no_workspace") return "插件已连接，但 VS Code 尚未打开文件夹";
  if (!snapshot.updated_at) return "后端尚未收到插件心跳";
  if (snapshot.stale) return "心跳超过 20 秒未更新，请确认插件连接的后端端口一致";
  return snapshot.status || "未知状态";
}
