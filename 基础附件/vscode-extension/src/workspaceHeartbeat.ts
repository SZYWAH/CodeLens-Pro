import * as path from "path";
import * as vscode from "vscode";
import type { BackendManager } from "./backendManager";

type WorkspaceTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceTreeNode[];
  truncated?: boolean;
};

type WorkspaceTreeBuildState = {
  count: number;
  truncated: boolean;
};

const HEARTBEAT_INTERVAL_MS = 5000;
const WORKSPACE_TREE_REFRESH_MS = 30000;
const WORKSPACE_TREE_MAX_DEPTH = 4;
const WORKSPACE_TREE_MAX_NODES = 300;
const WORKSPACE_EXCLUDED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "node_modules",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".next",
  ".turbo",
]);

export class WorkspaceHeartbeatService implements vscode.Disposable {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disposed = false;
  private lastReadyCheckFailed = false;
  private lastWorkspaceRoot = "";
  private lastWorkspaceTree: WorkspaceTreeNode | null = null;
  private lastWorkspaceTreeAt = 0;
  private lastWorkspaceNodeCount = 0;
  private lastWorkspaceTreeTruncated = false;
  private lastErrorKey = "";
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly backend: BackendManager,
    private readonly pluginVersion: string,
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.invalidateWorkspaceTree();
        void this.flush("workspace-changed", true);
      }),
    );
  }

  start() {
    if (this.timer || this.disposed) return;
    void this.flush("start", true);
    this.timer = setInterval(() => void this.flush("interval"), HEARTBEAT_INTERVAL_MS);
  }

  async flush(reason = "manual", forceTreeRefresh = false) {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      const status = await this.backend.getCachedBackendStatus({
        force: reason === "start" || this.lastReadyCheckFailed,
      });
      if (!status.healthy || !status.agentReady) {
        this.lastReadyCheckFailed = true;
        this.logHeartbeatIssue(
          "backend-not-ready",
          `[CodeLens Pro] Workspace heartbeat skipped (${reason}). API=${this.backend.apiBase}, healthy=${status.healthy}, agentReady=${status.agentReady}`,
        );
        return;
      }
      this.lastReadyCheckFailed = false;

      const payload = await this.buildHeartbeatPayload(forceTreeRefresh);
      await this.postWorkspaceHeartbeat(payload, reason);
      if (this.lastErrorKey) {
        this.backend.appendOutput(`[CodeLens Pro] Workspace heartbeat recovered. API=${this.backend.apiBase}`);
      }
      this.lastErrorKey = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logHeartbeatIssue(
        message,
        `[CodeLens Pro] Workspace heartbeat failed (${reason}). API=${this.backend.apiBase}. ${message}`,
      );
    } finally {
      this.running = false;
    }
  }

  dispose() {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  private async buildHeartbeatPayload(forceTreeRefresh: boolean) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.invalidateWorkspaceTree();
      return {
        workspace_name: "",
        workspace_root: "",
        status: "no_workspace",
        tree: null,
        node_count: 0,
        truncated: false,
        plugin_version: this.pluginVersion,
      };
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const now = Date.now();
    const shouldRefreshTree =
      forceTreeRefresh
      || workspaceRoot !== this.lastWorkspaceRoot
      || !this.lastWorkspaceTree
      || now - this.lastWorkspaceTreeAt > WORKSPACE_TREE_REFRESH_MS;

    if (shouldRefreshTree) {
      try {
        const result = await this.buildWorkspaceTree(workspaceFolder);
        this.lastWorkspaceRoot = workspaceRoot;
        this.lastWorkspaceTree = result.tree;
        this.lastWorkspaceTreeAt = now;
        this.lastWorkspaceNodeCount = result.nodeCount;
        this.lastWorkspaceTreeTruncated = result.truncated;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logHeartbeatIssue(
          `tree-refresh:${message}`,
          `[CodeLens Pro] Workspace tree refresh failed (${message}). Reusing cached tree for heartbeat.`,
        );
      }
    }

    return {
      workspace_name: workspaceFolder.name,
      workspace_root: workspaceRoot,
      status: "connected",
      tree: this.lastWorkspaceTree,
      node_count: this.lastWorkspaceNodeCount || (this.lastWorkspaceTree ? 1 : 0),
      truncated: this.lastWorkspaceTreeTruncated,
      plugin_version: this.pluginVersion,
    };
  }

  private async postWorkspaceHeartbeat(payload: Record<string, unknown>, reason: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${this.backend.apiBase}/api/agent/workspace/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 220)}` : ""}`);
      }
      if (reason !== "interval") {
        this.backend.appendOutput(`[CodeLens Pro] Workspace heartbeat sent (${reason}). API=${this.backend.apiBase}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async buildWorkspaceTree(workspaceFolder: vscode.WorkspaceFolder) {
    const state: WorkspaceTreeBuildState = { count: 1, truncated: false };
    const tree = await this.buildWorkspaceTreeNode(
      workspaceFolder.uri,
      workspaceFolder.name,
      "",
      0,
      state,
    );
    return { tree, nodeCount: state.count, truncated: state.truncated };
  }

  private async buildWorkspaceTreeNode(
    uri: vscode.Uri,
    name: string,
    relativePath: string,
    depth: number,
    state: WorkspaceTreeBuildState,
  ): Promise<WorkspaceTreeNode> {
    const node: WorkspaceTreeNode = {
      name,
      path: relativePath,
      type: "directory",
      children: [],
    };

    if (depth >= WORKSPACE_TREE_MAX_DEPTH) {
      node.truncated = true;
      state.truncated = true;
      return node;
    }

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return node;
    }

    entries = entries
      .filter(([entryName]) => !this.isExcludedWorkspaceEntry(entryName))
      .sort(([leftName, leftType], [rightName, rightType]) => {
        const leftDirectory = leftType === vscode.FileType.Directory ? 0 : 1;
        const rightDirectory = rightType === vscode.FileType.Directory ? 0 : 1;
        return leftDirectory - rightDirectory || leftName.localeCompare(rightName);
      });

    for (const [entryName, entryType] of entries) {
      if (state.count >= WORKSPACE_TREE_MAX_NODES) {
        node.truncated = true;
        state.truncated = true;
        break;
      }

      const childUri = vscode.Uri.joinPath(uri, entryName);
      const childPath = relativePath ? path.posix.join(relativePath, entryName) : entryName;
      state.count += 1;

      if (entryType === vscode.FileType.Directory) {
        node.children?.push(await this.buildWorkspaceTreeNode(childUri, entryName, childPath, depth + 1, state));
      } else {
        node.children?.push({
          name: entryName,
          path: childPath,
          type: "file",
        });
      }
    }

    return node;
  }

  private invalidateWorkspaceTree() {
    this.lastWorkspaceRoot = "";
    this.lastWorkspaceTree = null;
    this.lastWorkspaceTreeAt = 0;
    this.lastWorkspaceNodeCount = 0;
    this.lastWorkspaceTreeTruncated = false;
  }

  private isExcludedWorkspaceEntry(name: string) {
    const normalized = name.toLowerCase();
    return WORKSPACE_EXCLUDED_NAMES.has(normalized) || normalized.endsWith(".pyc") || normalized.endsWith(".map");
  }

  private logHeartbeatIssue(key: string, message: string) {
    if (this.lastErrorKey === key) return;
    this.lastErrorKey = key;
    this.backend.appendOutput(message);
  }
}
