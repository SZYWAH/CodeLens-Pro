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
exports.CodeLensWebviewViewProvider = exports.CODELENS_VIEW_CONTAINER_ID = exports.CODELENS_VIEW_ID = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const editorContext_1 = require("./editorContext");
const webviewHtml_1 = require("./webviewHtml");
exports.CODELENS_VIEW_ID = "codelensPro.sidebar";
exports.CODELENS_VIEW_CONTAINER_ID = "codelensProContainer";
class CodeLensWebviewViewProvider {
    context;
    backend;
    view = null;
    pendingMessages = [];
    ready = false;
    constructor(context, backend) {
        this.context = context;
        this.backend = backend;
    }
    async resolveWebviewView(webviewView) {
        this.view = webviewView;
        this.ready = false;
        await this.backend.ensureRunning();
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: (0, webviewHtml_1.getWebviewResourceRoots)(this.context.extensionUri),
        };
        webviewView.webview.html = (0, webviewHtml_1.renderCodeLensHtml)(webviewView.webview, this.context.extensionUri, this.backend.apiBase);
        webviewView.onDidDispose(() => {
            this.view = null;
            this.ready = false;
        });
        webviewView.webview.onDidReceiveMessage((message) => {
            if (message?.type === "codelens.webviewReady") {
                this.ready = true;
                this.flush();
            }
            if (message?.type === "codelens.showError") {
                vscode.window.showErrorMessage(message.message);
            }
            if (message?.type === "codelens.requestEditorContext") {
                const editorContext = (0, editorContext_1.getActiveEditorContext)(message.selectionOnly);
                if (!editorContext) {
                    vscode.window.showWarningMessage("请先打开一个代码文件。");
                    return;
                }
                this.post({ type: "codelens.openWorkbench", ...editorContext });
            }
            if (message?.type === "codelens.pickFiles") {
                void this.injectPickedFiles();
            }
            if (message?.type === "codelens.collectRecentFiles") {
                void this.injectRecentFiles();
            }
            if (message?.type === "codelens.pickWorkspaceFiles") {
                void this.injectWorkspaceFiles();
            }
            if (message?.type === "codelens.collectWorkspaceFiles") {
                void this.injectWorkspaceRuleFiles();
            }
            if (message?.type === "codelens.autoCollectWorkspaceFiles") {
                void this.injectAutoWorkspaceFiles();
            }
            if (message?.type === "codelens.applyAgentPlan") {
                void this.applyAgentPlan(message.plan);
            }
        });
    }
    async open(page = "workbench") {
        await this.backend.ensureRunning();
        await this.reveal();
        this.post({ type: "codelens.setApiBase", apiBase: this.backend.apiBase });
        this.post({ type: "codelens.openPage", page });
    }
    async openWorkbench(context) {
        await this.backend.ensureRunning();
        await this.reveal();
        this.post({ type: "codelens.setApiBase", apiBase: this.backend.apiBase });
        this.post({ type: "codelens.openWorkbench", ...context });
    }
    dispose() {
        this.view = null;
        this.pendingMessages = [];
        this.ready = false;
    }
    async reveal() {
        await vscode.commands.executeCommand(`workbench.view.extension.${exports.CODELENS_VIEW_CONTAINER_ID}`);
    }
    post(message) {
        this.pendingMessages.push(message);
        this.flush();
    }
    async injectPickedFiles() {
        const files = await (0, editorContext_1.pickFileContexts)();
        if (!files.length)
            return;
        this.post({ type: "codelens.openWorkbench", ...(0, editorContext_1.buildMultiFileContext)(files, "pickedFiles") });
    }
    async injectRecentFiles() {
        const files = await (0, editorContext_1.getOpenTextFileContexts)(5);
        if (!files.length) {
            vscode.window.showWarningMessage("没有找到可用于分析的最近代码文件。");
            return;
        }
        this.post({ type: "codelens.recentFilesMenu", files: files.map((file) => ({ ...file, sourceType: "recentFiles" })) });
    }
    async injectWorkspaceFiles() {
        const files = await (0, editorContext_1.pickProjectFileContexts)();
        if (!files.length)
            return;
        this.post({ type: "codelens.openWorkbench", ...(0, editorContext_1.buildMultiFileContext)(files, "workspaceFiles") });
    }
    async injectWorkspaceRuleFiles() {
        const files = await (0, editorContext_1.collectWorkspaceRuleContexts)();
        if (!files.length)
            return;
        this.post({ type: "codelens.openWorkbench", ...(0, editorContext_1.buildMultiFileContext)(files, "workspaceRules") });
    }
    async injectAutoWorkspaceFiles() {
        const files = await (0, editorContext_1.autoCollectWorkspaceContexts)();
        if (!files.length) {
            this.post({
                type: "codelens.openWorkbench",
                ...(0, editorContext_1.buildMultiFileContext)([], "autoWorkspace"),
            });
            return;
        }
        this.post({ type: "codelens.openWorkbench", ...(0, editorContext_1.buildMultiFileContext)(files, "autoWorkspace") });
    }
    async applyAgentPlan(plan) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage("请先打开一个工作区，再应用 Agent 计划。");
            await this.reportAgentPlanResult(plan, "failed", "未打开 VS Code 工作区，无法应用计划。");
            return;
        }
        if (plan.workspace_root && !workspaceRootMatches(plan.workspace_root, workspaceFolder.uri.fsPath)) {
            const message = "当前 Web 任务绑定的 VS Code 工作区未在线，或与当前窗口不一致。";
            vscode.window.showWarningMessage(message);
            await this.reportAgentPlanResult(plan, "failed", message);
            return;
        }
        const confirmation = await vscode.window.showWarningMessage(`应用 Agent 计划：${plan.summary || "未命名计划"}。将执行 ${plan.operations.length} 个文件操作。`, { modal: true }, "应用", "取消");
        if (confirmation !== "应用") {
            await this.reportAgentPlanResult(plan, "rejected", "用户取消应用 Agent 计划。");
            return;
        }
        const rootPath = path.resolve(workspaceFolder.uri.fsPath);
        const edit = new vscode.WorkspaceEdit();
        const skipped = [];
        for (const operation of plan.operations) {
            const targetPath = path.resolve(rootPath, operation.path);
            if (!targetPath.startsWith(`${rootPath}${path.sep}`) && targetPath !== rootPath) {
                skipped.push(operation.path);
                continue;
            }
            const targetUri = vscode.Uri.file(targetPath);
            if (operation.type === "create") {
                edit.createFile(targetUri, { overwrite: true, ignoreIfExists: false });
                edit.insert(targetUri, new vscode.Position(0, 0), operation.content ?? "");
            }
            else if (operation.type === "update") {
                const document = await vscode.workspace.openTextDocument(targetUri);
                let nextText = operation.content ?? "";
                if (Array.isArray(operation.edits) && operation.edits.length) {
                    nextText = document.getText();
                    for (const localEdit of operation.edits) {
                        const search = String(localEdit.search || "");
                        if (!search)
                            continue;
                        if (!nextText.includes(search)) {
                            throw new Error(`局部替换片段未在文件中找到：${operation.path}`);
                        }
                        nextText = nextText.replace(search, String(localEdit.replace ?? ""));
                    }
                }
                else if (operation.content === undefined || operation.content === null) {
                    throw new Error(`更新操作缺少 content 或 edits：${operation.path}`);
                }
                const lastLine = document.lineCount > 0 ? document.lineAt(document.lineCount - 1) : undefined;
                const range = lastLine
                    ? new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length)
                    : new vscode.Range(0, 0, 0, 0);
                edit.replace(targetUri, range, nextText);
            }
            else if (operation.type === "delete") {
                edit.deleteFile(targetUri, { recursive: false, ignoreIfNotExists: false });
            }
            else if (operation.type === "rename" && operation.new_path) {
                const nextPath = path.resolve(rootPath, operation.new_path);
                if (!nextPath.startsWith(`${rootPath}${path.sep}`) && nextPath !== rootPath) {
                    skipped.push(operation.new_path);
                    continue;
                }
                edit.renameFile(targetUri, vscode.Uri.file(nextPath), { overwrite: true, ignoreIfExists: false });
            }
        }
        try {
            const applied = await vscode.workspace.applyEdit(edit);
            if (applied) {
                const message = skipped.length
                    ? `Agent 计划已应用，跳过 ${skipped.length} 个工作区外路径：${skipped.join(", ")}`
                    : `Agent 计划已应用：${plan.summary}`;
                vscode.window.showInformationMessage(message);
                await this.reportAgentPlanResult(plan, "applied", message);
            }
            else {
                const message = "Agent 计划未能应用，请检查工作区与文件状态。";
                vscode.window.showWarningMessage(message);
                await this.reportAgentPlanResult(plan, "failed", message);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Agent 计划应用失败。";
            vscode.window.showErrorMessage(message);
            await this.reportAgentPlanResult(plan, "failed", message);
        }
    }
    async reportAgentPlanResult(plan, status, message) {
        const planId = plan.plan_id || plan.id || null;
        const sessionId = plan.session_id || null;
        if (planId) {
            try {
                await fetch(`${this.backend.apiBase}/api/agent/plans/${planId}/apply-result`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status, message }),
                });
            }
            catch (error) {
                console.error("Failed to report Agent plan result", error);
            }
        }
        this.post({ type: "codelens.agentPlanApplied", planId, sessionId, status, message });
    }
    flush() {
        if (!this.view || !this.ready)
            return;
        const messages = [...this.pendingMessages];
        this.pendingMessages = [];
        for (const message of messages) {
            void this.view.webview.postMessage(message);
        }
    }
}
exports.CodeLensWebviewViewProvider = CodeLensWebviewViewProvider;
function normalizeWorkspaceRoot(value) {
    let normalized = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (/^[A-Za-z]:\//.test(normalized)) {
        normalized = normalized.toLowerCase();
    }
    return normalized;
}
function workspaceRootMatches(expectedRoot, actualRoot) {
    return normalizeWorkspaceRoot(expectedRoot) === normalizeWorkspaceRoot(actualRoot);
}
//# sourceMappingURL=webviewView.js.map