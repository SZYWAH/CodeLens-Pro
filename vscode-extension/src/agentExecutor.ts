import * as path from "path";
import * as vscode from "vscode";
import type { BackendManager } from "./backendManager";
import { autoCollectWorkspaceContexts, buildMultiFileContext, collectWorkspaceManifest, readWorkspaceSelectedFileContexts } from "./editorContext";
import type { ReadContextProgress } from "./editorContext";
import type { AgentPlanPayload } from "./messageBridge";

type AgentContextMode = "manual" | "ai_auto" | "hybrid";

type AgentPlanItem = AgentPlanPayload & {
  id?: string | null;
  plan_id?: string | null;
  session_id?: string | null;
  instruction?: string;
  status?: string;
  source?: string;
  apply_result?: string | null;
  selected_file_paths?: string[];
  context_mode?: AgentContextMode;
  workspace_root?: string | null;
};

type AgentContextSelectResponse = {
  selected_file_paths?: string[];
  reasons?: Array<{ path?: string; reason?: string }>;
  skipped?: Array<{ path?: string; reason?: string }>;
};

type AgentChatContextRequest = {
  request_id: string;
  session_id: string;
  message: string;
  selected_file_paths?: string[];
  context_mode?: AgentContextMode;
  workspace_root?: string | null;
};

export class AgentWorkspaceExecutor implements vscode.Disposable {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disposed = false;
  private processing = new Set<string>();
  private completed = new Set<string>();

  constructor(private readonly backend: BackendManager) {}

  start() {
    if (this.timer || this.disposed) return;
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

  private async tick() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      const status = await this.backend.getBackendStatus();
      if (!status.healthy || !status.agentReady) return;
      if (!currentWorkspaceRoot()) return;
      await this.processPendingChatContexts();
      await this.processPendingTasks();
      await this.processConfirmedPlans();
    } finally {
      this.running = false;
    }
  }

  private async processPendingChatContexts() {
    const requests = await this.fetchJson<AgentChatContextRequest[]>(this.workspaceScopedUrl("/api/agent/chat-context/pending"));
    for (const request of requests) {
      const requestId = request.request_id || "";
      if (!requestId || this.processing.has(requestId)) continue;
      this.processing.add(requestId);
      try {
        await this.handlePendingChatContext(request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent 讨论上下文读取失败";
        await this.reportChatContextResult(requestId, "failed", message).catch(() => undefined);
      } finally {
        this.processing.delete(requestId);
      }
    }
  }

  private async processPendingTasks() {
    const tasks = await this.fetchJson<AgentPlanItem[]>(this.workspaceScopedUrl("/api/agent/pending"));
    for (const task of tasks) {
      const taskId = task.plan_id || task.id || "";
      if (!taskId || this.processing.has(taskId)) continue;
      this.processing.add(taskId);
      try {
        await this.handlePendingTask(task);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent 任务处理失败";
        await this.reportTaskResult(task, "failed", message).catch(() => undefined);
      } finally {
        this.processing.delete(taskId);
      }
    }
  }

  private async processConfirmedPlans() {
    const plans = await this.fetchJson<AgentPlanItem[]>(this.workspaceScopedUrl("/api/agent/confirmed"));
    for (const plan of plans) {
      const planId = plan.plan_id || plan.id || "";
      if (!planId || this.processing.has(planId) || this.completed.has(planId)) continue;
      this.processing.add(planId);
      try {
        await this.applyConfirmedPlan(plan);
        this.completed.add(planId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent 计划应用失败";
        await this.reportPlanResult(plan, "failed", message).catch(() => undefined);
      } finally {
        this.processing.delete(planId);
      }
    }
  }

  private async handlePendingTask(task: AgentPlanItem) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    await this.reportTaskProgress(task, "received", "插件已收到网页端 Agent 计划任务。").catch(() => undefined);
    if (!workspaceFolder) {
      await this.reportTaskResult(task, "failed", "未打开 VS Code 工作区，无法自动收集项目文件。").catch(() => undefined);
      return;
    }
    if (!workspaceMatches(task.workspace_root, workspaceFolder.uri.fsPath)) {
      return;
    }
    await this.reportTaskProgress(task, "workspace_checked", `已确认 VS Code 工作区：${workspaceFolder.name}`).catch(() => undefined);

    const contextMode = normalizeContextMode(task.context_mode);
    const selectedPaths = sanitizeRelativePaths(Array.isArray(task.selected_file_paths) ? task.selected_file_paths : []);
    await this.reportTaskProgress(
      task,
      "context_resolve",
      contextMode === "manual"
        ? `正在读取网页选中的 ${selectedPaths.length} 个上下文文件...`
        : "正在解析项目上下文范围，准备读取相关文件...",
      undefined,
      selectedPaths,
    ).catch(() => undefined);
    const contextPaths = await this.resolveContextPaths(task, contextMode, selectedPaths, task);
    let effectiveContextPaths = contextPaths;
    if (effectiveContextPaths.length) {
      await this.reportTaskProgress(
        task,
        "read_selected_files",
        `正在读取 ${effectiveContextPaths.length} 个工作区文件...`,
        undefined,
        effectiveContextPaths,
      ).catch(() => undefined);
    } else {
      await this.reportTaskProgress(task, "auto_collect", "正在自动收集项目上下文文件...").catch(() => undefined);
    }
    let files = effectiveContextPaths.length
      ? await readWorkspaceSelectedFileContexts(contextPaths, {
          onProgress: (event) => this.reportFileReadProgress(task, event),
        })
      : await autoCollectWorkspaceContexts();
    if (!files.length && contextMode !== "manual") {
      effectiveContextPaths = [];
      await this.reportTaskProgress(task, "auto_collect_retry", "未读取到指定文件，正在改用自动项目上下文收集...").catch(() => undefined);
      files = await autoCollectWorkspaceContexts();
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
    await this.reportTaskProgress(
      task,
      "context_ready",
      `已读取 ${files.length} 个上下文文件，正在打包发送给后端生成计划...`,
      undefined,
      actualPaths,
    ).catch(() => undefined);
    const bundle = buildMultiFileContext(files, effectiveContextPaths.length ? "workspaceFiles" : "autoWorkspace");
    const instruction = task.instruction || task.summary || "请分析当前项目";
    await this.reportTaskProgress(task, "backend_plan", "正在请求后端模型生成可确认的修改计划...", undefined, actualPaths).catch(() => undefined);
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
    await this.reportTaskProgress(task, "done", "后端已生成计划，正在回传网页确认。", undefined, actualPaths).catch(() => undefined);
  }

  private async handlePendingChatContext(request: AgentChatContextRequest) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      await this.reportChatContextResult(request.request_id, "failed", "未打开 VS Code 工作区，无法读取所选文件。").catch(() => undefined);
      return;
    }
    if (!workspaceMatches(request.workspace_root, workspaceFolder.uri.fsPath)) {
      return;
    }

    const contextMode = normalizeContextMode(request.context_mode);
    const selectedPaths = sanitizeRelativePaths(Array.isArray(request.selected_file_paths) ? request.selected_file_paths : []);
    const contextPaths = await this.resolveContextPaths(
      {
        instruction: request.message,
        summary: request.message,
        assumptions: [],
        warnings: [],
        operations: [],
        selected_file_paths: selectedPaths,
        context_mode: contextMode,
      },
      contextMode,
      selectedPaths,
    );
    let effectiveContextPaths = contextPaths;
    let files = effectiveContextPaths.length
      ? await readWorkspaceSelectedFileContexts(effectiveContextPaths)
      : [];
    if (!files.length && contextMode !== "manual") {
      effectiveContextPaths = [];
      files = await autoCollectWorkspaceContexts();
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
    const bundle = buildMultiFileContext(files, effectiveContextPaths.length ? "workspaceFiles" : "autoWorkspace");
    await this.reportChatContextResult(
      request.request_id,
      "ok",
      `已读取 ${bundle.files?.length ?? files.length} 个上下文文件。`,
      bundle.files ?? [],
      actualPaths,
    );
  }

  private async resolveContextPaths(
    task: AgentPlanItem,
    contextMode: AgentContextMode,
    selectedPaths: string[],
    progressPlan?: AgentPlanItem,
  ): Promise<string[]> {
    if (contextMode === "manual") return selectedPaths;

    try {
      if (progressPlan) {
        await this.reportTaskProgress(progressPlan, "manifest_collect", "正在收集项目文件清单，让 AI 选择相关上下文...", undefined, selectedPaths).catch(() => undefined);
      }
      const manifest = await collectWorkspaceManifest();
      if (!manifest.length) return contextMode === "hybrid" ? selectedPaths : [];
      if (progressPlan) {
        await this.reportTaskProgress(progressPlan, "manifest_ready", `已收集 ${manifest.length} 个候选文件，正在选择相关文件...`, undefined, selectedPaths).catch(() => undefined);
      }
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
      if (!response.ok) return contextMode === "hybrid" ? selectedPaths : [];

      const result = await response.json() as AgentContextSelectResponse;
      const aiPaths = sanitizeRelativePaths(Array.isArray(result.selected_file_paths) ? result.selected_file_paths : []);
      if (!aiPaths.length) return contextMode === "hybrid" ? selectedPaths : [];
      if (progressPlan) {
        await this.reportTaskProgress(progressPlan, "context_selected", `已选择 ${aiPaths.length} 个相关文件，准备逐个读取。`, undefined, aiPaths).catch(() => undefined);
      }
      return aiPaths;
    } catch {
      return contextMode === "hybrid" ? selectedPaths : [];
    }
  }

  private async applyConfirmedPlan(plan: AgentPlanItem) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      await this.reportPlanResult(plan, "failed", "未打开 VS Code 工作区，无法应用计划。").catch(() => undefined);
      return;
    }
    if (!workspaceMatches(plan.workspace_root, workspaceFolder.uri.fsPath)) {
      await this.reportPlanResult(plan, "failed", "当前 Web 任务绑定的 VS Code 工作区未在线，或与当前窗口不一致。").catch(() => undefined);
      return;
    }

    const operations = plan.operations || [];
    if (!operations.length) {
      await this.reportPlanResult(plan, "failed", "计划中没有可应用的操作。").catch(() => undefined);
      return;
    }

    const rootPath = path.resolve(workspaceFolder.uri.fsPath);
    const edit = new vscode.WorkspaceEdit();
    const skipped: string[] = [];

    await this.reportPlanResult(plan, "confirmed", `开始执行 Agent 计划，共 ${operations.length} 个文件操作。`).catch(() => undefined);

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const targetPath = path.resolve(rootPath, operation.path);
      await this.reportPlanResult(
        plan,
        "confirmed",
        `正在准备第 ${index + 1}/${operations.length} 个操作：${operation.type} ${operation.path}`,
      ).catch(() => undefined);
      if (!this.isInsideWorkspace(rootPath, targetPath)) {
        skipped.push(operation.path);
        await this.reportPlanResult(
          plan,
          "confirmed",
          `已跳过工作区外路径：${operation.path}`,
        ).catch(() => undefined);
        continue;
      }
      const targetUri = vscode.Uri.file(targetPath);

      if (operation.type === "create") {
        edit.createFile(targetUri, { overwrite: true, ignoreIfExists: false });
        edit.insert(targetUri, new vscode.Position(0, 0), operation.content ?? "");
      } else if (operation.type === "update") {
        const document = await vscode.workspace.openTextDocument(targetUri);
        if (Array.isArray(operation.edits) && operation.edits.length) {
          let nextText = document.getText();
          for (const localEdit of operation.edits) {
            const search = String(localEdit.search || "");
            if (!search) continue;
            if (!nextText.includes(search)) {
              throw new Error(`局部替换片段未在文件中找到：${operation.path}`);
            }
            nextText = nextText.replace(search, String(localEdit.replace ?? ""));
          }
          const lastLine = document.lineCount > 0 ? document.lineAt(document.lineCount - 1) : undefined;
          const range = lastLine
            ? new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length)
            : new vscode.Range(0, 0, 0, 0);
          edit.replace(targetUri, range, nextText);
        } else {
          if (operation.content === undefined || operation.content === null) {
            throw new Error(`更新操作缺少 content 或 edits：${operation.path}`);
          }
          const lastLine = document.lineCount > 0 ? document.lineAt(document.lineCount - 1) : undefined;
          const range = lastLine
            ? new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length)
            : new vscode.Range(0, 0, 0, 0);
          edit.replace(targetUri, range, operation.content ?? "");
        }
      } else if (operation.type === "delete") {
        edit.deleteFile(targetUri, { recursive: false, ignoreIfNotExists: false });
      } else if (operation.type === "rename" && operation.new_path) {
        const nextPath = path.resolve(rootPath, operation.new_path);
        if (!this.isInsideWorkspace(rootPath, nextPath)) {
          skipped.push(operation.new_path);
          continue;
        }
        edit.renameFile(targetUri, vscode.Uri.file(nextPath), { overwrite: true, ignoreIfExists: false });
      }
      await this.reportPlanResult(
        plan,
        "confirmed",
        `已准备第 ${index + 1}/${operations.length} 个操作：${operation.type} ${operation.path}`,
      ).catch(() => undefined);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent 计划应用失败";
      await this.reportPlanResult(plan, "failed", message).catch(() => undefined);
    }
  }

  private async reportTaskResult(plan: AgentPlanItem, status: string, message: string) {
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

  private async reportTaskProgress(
    plan: AgentPlanItem,
    phase: string,
    message: string,
    detail?: string,
    selectedFilePaths: string[] = [],
  ) {
    const planId = plan.plan_id || plan.id;
    if (!planId) return;
    await fetch(`${this.backend.apiBase}/api/agent/tasks/${planId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phase,
        message,
        detail: detail ?? null,
        selected_file_paths: selectedFilePaths,
      }),
    });
  }

  private async reportFileReadProgress(plan: AgentPlanItem, event: ReadContextProgress) {
    const fileName = path.basename(event.path);
    if (event.status === "reading") {
      await this.reportTaskProgress(
        plan,
        "file_reading",
        `正在读取第 ${event.index}/${event.total} 个文件：${fileName}`,
        event.path,
        [event.path],
      ).catch(() => undefined);
      return;
    }
    if (event.status === "read") {
      await this.reportTaskProgress(
        plan,
        "file_read",
        `已完整读取第 ${event.index}/${event.total} 个文件：${fileName}`,
        `${event.path}${event.chars !== undefined ? ` · ${event.chars} 字符` : ""}`,
        [event.path],
      ).catch(() => undefined);
      return;
    }
    if (event.status === "summarized") {
      await this.reportTaskProgress(
        plan,
        "file_summarized",
        `已读取并提取第 ${event.index}/${event.total} 个大文件的关键点：${fileName}`,
        `${event.path}${event.reason ? ` · ${event.reason}` : ""}`,
        [event.path],
      ).catch(() => undefined);
      return;
    }
    await this.reportTaskProgress(
      plan,
      "file_skipped",
      `已跳过第 ${event.index}/${event.total} 个文件：${fileName}`,
      `${event.path}${event.reason ? ` · ${event.reason}` : ""}`,
      [],
    ).catch(() => undefined);
  }

  private async reportChatContextResult(
    requestId: string,
    status: "ok" | "failed",
    message: string,
    files: Array<{ code: string; languageId?: string; fileName?: string; filePath?: string; attention?: "low" | "normal" | "high" }> = [],
    selectedFilePaths: string[] = [],
  ) {
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

  private async reportPlanResult(plan: AgentPlanItem, status: "confirmed" | "applied" | "failed" | "rejected", message: string) {
    await fetch(`${this.backend.apiBase}/api/agent/plans/${plan.plan_id || plan.id}/apply-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, message }),
    });
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json() as Promise<T>;
  }

  private workspaceScopedUrl(pathname: string) {
    const workspaceRoot = currentWorkspaceRoot();
    const url = new URL(pathname, `${this.backend.apiBase}/`);
    if (workspaceRoot) {
      url.searchParams.set("workspace_root", workspaceRoot);
    }
    return url.toString();
  }

  private isInsideWorkspace(rootPath: string, targetPath: string) {
    return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
  }
}

function normalizeContextMode(value: unknown): AgentContextMode {
  return value === "ai_auto" || value === "hybrid" ? value : "manual";
}

function currentWorkspaceRoot(): string {
  return normalizeWorkspaceRoot(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "");
}

function normalizeWorkspaceRoot(value: unknown): string {
  let normalized = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function workspaceMatches(expectedRoot: unknown, actualRoot: string): boolean {
  const expected = normalizeWorkspaceRoot(expectedRoot);
  if (!expected) return true;
  return expected === normalizeWorkspaceRoot(actualRoot);
}

function sanitizeRelativePaths(paths: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawPath of paths) {
    const normalized = String(rawPath || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (
      !normalized
      || normalized.startsWith("/")
      || normalized.startsWith("../")
      || normalized.includes("/../")
      || path.win32.isAbsolute(normalized)
      || path.posix.isAbsolute(normalized)
    ) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= 20) break;
  }
  return result;
}

function relativePathsFromFiles(files: Array<{ filePath: string }>, rootPath: string): string[] {
  const root = path.resolve(rootPath);
  const paths: string[] = [];
  for (const file of files) {
    const absolutePath = path.resolve(file.filePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) continue;
    paths.push(path.relative(root, absolutePath).replace(/\\/g, "/"));
  }
  return sanitizeRelativePaths(paths);
}
