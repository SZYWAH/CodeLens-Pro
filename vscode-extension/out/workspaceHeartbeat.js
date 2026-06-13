"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceHeartbeatService = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
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
class WorkspaceHeartbeatService {
    backend;
    pluginVersion;
    timer = null;
    running = false;
    disposed = false;
    lastWorkspaceRoot = "";
    lastWorkspaceTree = null;
    lastWorkspaceTreeAt = 0;
    lastWorkspaceNodeCount = 0;
    lastWorkspaceTreeTruncated = false;
    lastErrorKey = "";
    subscriptions = [];
    constructor(backend, pluginVersion) {
        this.backend = backend;
        this.pluginVersion = pluginVersion;
        this.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.invalidateWorkspaceTree();
            void this.flush("workspace-changed", true);
        }));
    }
    start() {
        if (this.timer || this.disposed)
            return;
        void this.flush("start", true);
        this.timer = setInterval(() => void this.flush("interval"), HEARTBEAT_INTERVAL_MS);
    }
    async flush(reason = "manual", forceTreeRefresh = false) {
        if (this.running || this.disposed)
            return;
        this.running = true;
        try {
            const status = await this.backend.getBackendStatus();
            if (!status.healthy || !status.agentReady) {
                this.logHeartbeatIssue("backend-not-ready", `[CodeLens Pro] Workspace heartbeat skipped (${reason}). API=${this.backend.apiBase}, healthy=${status.healthy}, agentReady=${status.agentReady}`);
                return;
            }
            const payload = await this.buildHeartbeatPayload(forceTreeRefresh);
            await this.postWorkspaceHeartbeat(payload, reason);
            if (this.lastErrorKey) {
                this.backend.appendOutput(`[CodeLens Pro] Workspace heartbeat recovered. API=${this.backend.apiBase}`);
            }
            this.lastErrorKey = "";
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logHeartbeatIssue(message, `[CodeLens Pro] Workspace heartbeat failed (${reason}). API=${this.backend.apiBase}. ${message}`);
        }
        finally {
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
    async buildHeartbeatPayload(forceTreeRefresh) {
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
        const shouldRefreshTree = forceTreeRefresh
            || workspaceRoot !== this.lastWorkspaceRoot
            || !this.lastWorkspaceTree
            || now - this.lastWorkspaceTreeAt > WORKSPACE_TREE_REFRESH_MS;
        if (shouldRefreshTree) {
            const result = await this.buildWorkspaceTree(workspaceFolder);
            this.lastWorkspaceRoot = workspaceRoot;
            this.lastWorkspaceTree = result.tree;
            this.lastWorkspaceTreeAt = now;
            this.lastWorkspaceNodeCount = result.nodeCount;
            this.lastWorkspaceTreeTruncated = result.truncated;
        }
        return {
            workspace_name: workspaceFolder.name,
            workspace_root: workspaceRoot,
            status: "connected",
            tree: this.lastWorkspaceTree,
            node_count: this.lastWorkspaceNodeCount,
            truncated: this.lastWorkspaceTreeTruncated,
            plugin_version: this.pluginVersion,
        };
    }
    async postWorkspaceHeartbeat(payload, reason) {
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
        }
        finally {
            clearTimeout(timer);
        }
    }
    async buildWorkspaceTree(workspaceFolder) {
        const state = { count: 1, truncated: false };
        const tree = await this.buildWorkspaceTreeNode(workspaceFolder.uri, workspaceFolder.name, "", 0, state);
        return { tree, nodeCount: state.count, truncated: state.truncated };
    }
    async buildWorkspaceTreeNode(uri, name, relativePath, depth, state) {
        const node = {
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
        let entries;
        try {
            entries = await vscode.workspace.fs.readDirectory(uri);
        }
        catch {
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
            }
            else {
                node.children?.push({
                    name: entryName,
                    path: childPath,
                    type: "file",
                });
            }
        }
        return node;
    }
    invalidateWorkspaceTree() {
        this.lastWorkspaceRoot = "";
        this.lastWorkspaceTree = null;
        this.lastWorkspaceTreeAt = 0;
        this.lastWorkspaceNodeCount = 0;
        this.lastWorkspaceTreeTruncated = false;
    }
    isExcludedWorkspaceEntry(name) {
        const normalized = name.toLowerCase();
        return WORKSPACE_EXCLUDED_NAMES.has(normalized) || normalized.endsWith(".pyc") || normalized.endsWith(".map");
    }
    logHeartbeatIssue(key, message) {
        if (this.lastErrorKey === key)
            return;
        this.lastErrorKey = key;
        this.backend.appendOutput(message);
    }
}
exports.WorkspaceHeartbeatService = WorkspaceHeartbeatService;
//# sourceMappingURL=workspaceHeartbeat.js.map