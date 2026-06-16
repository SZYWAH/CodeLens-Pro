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
exports.AgentWorkspaceExecutor = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const editorContext_1 = require("./editorContext");
class AgentWorkspaceExecutor {
    backend;
    timer = null;
    running = false;
    disposed = false;
    processing = new Set();
    completed = new Set();
    constructor(backend) {
        this.backend = backend;
    }
    start() {
        if (this.timer || this.disposed)
            return;
        void this.tick();
        this.timer = setInterval(() => void this.tick(), 4000);
    }
    dispose() {
        this.disposed = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.processing.clear();
    }
    async tick() {
        if (this.running || this.disposed)
            return;
        this.running = true;
        try {
            const status = await this.backend.getBackendStatus();
            if (!status.healthy || !status.agentReady)
                return;
            await this.processPendingChatContexts();
            await this.processPendingTasks();
            await this.processConfirmedPlans();
        }
        finally {
            this.running = false;
        }
    }
    async processPendingChatContexts() {
        const requests = await this.fetchJson(`${this.backend.apiBase}/api/agent/chat-context/pending`);
        for (const request of requests) {
            const requestId = request.request_id || "";
            if (!requestId || this.processing.has(requestId))
                continue;
            this.processing.add(requestId);
            try {
                await this.handlePendingChatContext(request);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Agent 讨论上下文读取失败";
                await this.reportChatContextResult(requestId, "failed", message).catch(() => undefined);
            }
            finally {
                this.processing.delete(requestId);
            }
        }
    }
    async processPendingTasks() {
        const tasks = await this.fetchJson(`${this.backend.apiBase}/api/agent/pending`);
        for (const task of tasks) {
            const taskId = task.plan_id || task.id || "";
            if (!taskId || this.processing.has(taskId))
                continue;
            this.processing.add(taskId);
            try {
                await this.handlePendingTask(task);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Agent 任务处理失败";
                await this.reportTaskResult(task, "failed", message).catch(() => undefined);
            }
            finally {
                this.processing.delete(taskId);
            }
        }
    }
    async processConfirmedPlans() {
        const plans = await this.fetchJson(`${this.backend.apiBase}/api/agent/confirmed`);
        for (const plan of plans) {
            const planId = plan.plan_id || plan.id || "";
            if (!planId || this.processing.has(planId) || this.completed.has(planId))
                continue;
            this.processing.add(planId);
            try {
                await this.applyConfirmedPlan(plan);
                this.completed.add(planId);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : "Agent 计划应用失败";
                await this.reportPlanResult(plan, "failed", message).catch(() => undefined);
            }
            finally {
                this.processing.delete(planId);
            }
        }
    }
    async handlePendingTask(task) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await this.reportTaskResult(task, "failed", "未打开 VS Code 工作区，无法自动收集项目文件。").catch(() => undefined);
            return;
        }
        const contextMode = normalizeContextMode(task.context_mode);
        const selectedPaths = sanitizeRelativePaths(Array.isArray(task.selected_file_paths) ? task.selected_file_paths : []);
        const contextPaths = await this.resolveContextPaths(task, contextMode, selectedPaths);
        let effectiveContextPaths = contextPaths;
        let files = effectiveContextPaths.length
            ? await (0, editorContext_1.readWorkspaceSelectedFileContexts)(contextPaths)
            : await (0, editorContext_1.autoCollectWorkspaceContexts)();
        if (!files.length && contextMode !== "manual") {
            effectiveContextPaths = [];
            files = await (0, editorContext_1.autoCollectWorkspaceContexts)();
        }
        if (!files.length && contextMode === "manual" && effectiveContextPaths.length) {
            await this.reportTaskResult(task, "failed", "Selected files from Web could not be read. Please choose smaller readable files.").catch(() => undefined);
            return;
        }
        if (!files.length) {
            await this.reportTaskResult(task, "failed", "未收集到可用的工作区文件，无法生成 Agent 计划。").catch(() => undefined);
            return;
        }
        const actualPaths = effectiveContextPaths.length ? relativePathsFromFiles(files, workspaceFolder.uri.fsPath) : [];
        const bundle = (0, editorContext_1.buildMultiFileContext)(files, effectiveContextPaths.length ? "workspaceFiles" : "autoWorkspace");
        const instruction = task.instruction || task.summary || "请分析当前项目";
        const response = await fetch(`${this.backend.apiBase}/api/agent/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                instruction,
                session_id: task.session_id,
                task_id: task.plan_id || task.id,
                agent_action: "plan",
                defer_to_plugin: true,
                code_context: bundle.code,
                language_code: "text",
                language_label: "多文件",
                file_name: bundle.fileName,
                file_path: bundle.filePath,
                files: bundle.files ?? [],
                selected_file_paths: actualPaths,
                context_mode: contextMode,
                source: "plugin",
                workspace_root: workspaceFolder.uri.fsPath,
            }),
        });
        if (!response.ok) {
            await this.reportTaskResult(task, "failed", await response.text()).catch(() => undefined);
            return;
        }
        await response.json();
    }
    async handlePendingChatContext(request) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await this.reportChatContextResult(request.request_id, "failed", "未打开 VS Code 工作区，无法读取所选文件。").catch(() => undefined);
            return;
        }
        const contextMode = normalizeContextMode(request.context_mode);
        const selectedPaths = sanitizeRelativePaths(Array.isArray(request.selected_file_paths) ? request.selected_file_paths : []);
        const contextPaths = await this.resolveContextPaths({
            instruction: request.message,
            summary: request.message,
            assumptions: [],
            warnings: [],
            operations: [],
            selected_file_paths: selectedPaths,
            context_mode: contextMode,
        }, contextMode, selectedPaths);
        let effectiveContextPaths = contextPaths;
        let files = effectiveContextPaths.length
            ? await (0, editorContext_1.readWorkspaceSelectedFileContexts)(effectiveContextPaths)
            : [];
        if (!files.length && contextMode !== "manual") {
            effectiveContextPaths = [];
            files = await (0, editorContext_1.autoCollectWorkspaceContexts)();
        }
        if (!files.length && contextMode === "manual" && effectiveContextPaths.length) {
            await this.reportChatContextResult(request.request_id, "failed", "所选文件无法读取，请重新选择较小且可访问的文件。").catch(() => undefined);
            return;
        }
        if (!files.length) {
            await this.reportChatContextResult(request.request_id, "failed", "未读取到可用的上下文文件。").catch(() => undefined);
            return;
        }
        const actualPaths = effectiveContextPaths.length ? relativePathsFromFiles(files, workspaceFolder.uri.fsPath) : [];
        const bundle = (0, editorContext_1.buildMultiFileContext)(files, effectiveContextPaths.length ? "workspaceFiles" : "autoWorkspace");
        await this.reportChatContextResult(request.request_id, "ok", `已读取 ${bundle.files?.length ?? files.length} 个上下文文件。`, bundle.files ?? [], actualPaths);
    }
    async resolveContextPaths(task, contextMode, selectedPaths) {
        if (contextMode === "manual")
            return selectedPaths;
        try {
            const manifest = await (0, editorContext_1.collectWorkspaceManifest)();
            if (!manifest.length)
                return contextMode === "hybrid" ? selectedPaths : [];
            const response = await fetch(`${this.backend.apiBase}/api/agent/context/select`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    instruction: task.instruction || task.summary || "",
                    context_mode: contextMode,
                    selected_file_paths: selectedPaths,
                    candidates: manifest,
                }),
            });
            if (!response.ok)
                return contextMode === "hybrid" ? selectedPaths : [];
            const result = await response.json();
            const aiPaths = sanitizeRelativePaths(Array.isArray(result.selected_file_paths) ? result.selected_file_paths : []);
            if (!aiPaths.length)
                return contextMode === "hybrid" ? selectedPaths : [];
            return aiPaths;
        }
        catch {
            return contextMode === "hybrid" ? selectedPaths : [];
        }
    }
    async applyConfirmedPlan(plan) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await this.reportPlanResult(plan, "failed", "未打开 VS Code 工作区，无法应用计划。").catch(() => undefined);
            return;
        }
        const operations = plan.operations || [];
        if (!operations.length) {
            await this.reportPlanResult(plan, "failed", "计划中没有可应用的操作。").catch(() => undefined);
            return;
        }
        const rootPath = path.resolve(workspaceFolder.uri.fsPath);
        const edit = new vscode.WorkspaceEdit();
        const skipped = [];
        for (const operation of operations) {
            const targetPath = path.resolve(rootPath, operation.path);
            if (!this.isInsideWorkspace(rootPath, targetPath)) {
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
                const lastLine = document.lineCount > 0 ? document.lineAt(document.lineCount - 1) : undefined;
                const range = lastLine
                    ? new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length)
                    : new vscode.Range(0, 0, 0, 0);
                edit.replace(targetUri, range, operation.content ?? "");
            }
            else if (operation.type === "delete") {
                edit.deleteFile(targetUri, { recursive: false, ignoreIfNotExists: false });
            }
            else if (operation.type === "rename" && operation.new_path) {
                const nextPath = path.resolve(rootPath, operation.new_path);
                if (!this.isInsideWorkspace(rootPath, nextPath)) {
                    skipped.push(operation.new_path);
                    continue;
                }
                edit.renameFile(targetUri, vscode.Uri.file(nextPath), { overwrite: true, ignoreIfExists: false });
            }
        }
        try {
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                await this.reportPlanResult(plan, "failed", "WorkspaceEdit 未能应用到当前工作区。").catch(() => undefined);
                return;
            }
            const message = skipped.length
                ? `Agent 计划已应用，跳过了 ${skipped.length} 个工作区外路径：${skipped.join(", ")}`
                : `Agent 计划已应用：${plan.summary}`;
            vscode.window.showInformationMessage(message);
            await this.reportPlanResult(plan, "applied", message).catch(() => undefined);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Agent 计划应用失败";
            await this.reportPlanResult(plan, "failed", message).catch(() => undefined);
        }
    }
    async reportTaskResult(plan, status, message) {
        await fetch(`${this.backend.apiBase}/api/agent/tasks/${plan.plan_id || plan.id}/result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status,
                message,
                summary: plan.summary,
                assumptions: plan.assumptions,
                warnings: plan.warnings,
                operations: plan.operations,
            }),
        });
    }
    async reportChatContextResult(requestId, status, message, files = [], selectedFilePaths = []) {
        await fetch(`${this.backend.apiBase}/api/agent/chat-context/${requestId}/result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status,
                message,
                files,
                selected_file_paths: selectedFilePaths,
            }),
        });
    }
    async reportPlanResult(plan, status, message) {
        await fetch(`${this.backend.apiBase}/api/agent/plans/${plan.plan_id || plan.id}/apply-result`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, message }),
        });
    }
    async fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(await response.text());
        }
        return response.json();
    }
    isInsideWorkspace(rootPath, targetPath) {
        return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
    }
}
exports.AgentWorkspaceExecutor = AgentWorkspaceExecutor;
function normalizeContextMode(value) {
    return value === "ai_auto" || value === "hybrid" ? value : "manual";
}
function sanitizeRelativePaths(paths) {
    const result = [];
    const seen = new Set();
    for (const rawPath of paths) {
        const normalized = String(rawPath || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
        if (!normalized
            || normalized.startsWith("/")
            || normalized.startsWith("../")
            || normalized.includes("/../")
            || path.win32.isAbsolute(normalized)
            || path.posix.isAbsolute(normalized)) {
            continue;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(normalized);
        if (result.length >= 20)
            break;
    }
    return result;
}
function relativePathsFromFiles(files, rootPath) {
    const root = path.resolve(rootPath);
    const paths = [];
    for (const file of files) {
        const absolutePath = path.resolve(file.filePath);
        if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`))
            continue;
        paths.push(path.relative(root, absolutePath).replace(/\\/g, "/"));
    }
    return sanitizeRelativePaths(paths);
}
//# sourceMappingURL=agentExecutor.js.map