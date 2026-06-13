import * as path from "path";
import * as vscode from "vscode";
import type { BackendManager } from "./backendManager";
import {
  autoCollectWorkspaceContexts,
  buildMultiFileContext,
  collectWorkspaceRuleContexts,
  getActiveEditorContext,
  getOpenTextFileContexts,
  pickFileContexts,
  pickProjectFileContexts,
  type EditorCodeContext,
} from "./editorContext";
import type { AgentPlanPayload, ExtensionToWebviewMessage, WebviewPage, WebviewToExtensionMessage } from "./messageBridge";
import { getWebviewResourceRoots, renderCodeLensHtml } from "./webviewHtml";

export class CodeLensWebviewPanel {
  private panel: vscode.WebviewPanel | null = null;
  private pendingMessages: ExtensionToWebviewMessage[] = [];
  private ready = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly backend: BackendManager
  ) {}

  async open(page: WebviewPage = "workbench") {
    await this.backend.ensureRunning();
    this.createOrReveal();
    this.post({ type: "codelens.setApiBase", apiBase: this.backend.apiBase });
    this.post({ type: "codelens.openPage", page });
  }

  async openWorkbench(context: EditorCodeContext) {
    await this.backend.ensureRunning();
    this.createOrReveal();
    this.post({ type: "codelens.setApiBase", apiBase: this.backend.apiBase });
    this.post({ type: "codelens.openWorkbench", ...context });
  }

  dispose() {
    this.panel?.dispose();
    this.panel = null;
  }

  private createOrReveal() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "codelensPro",
      "CodeLens Pro",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: getWebviewResourceRoots(this.context.extensionUri),
      }
    );

    this.panel.webview.html = renderCodeLensHtml(this.panel.webview, this.context.extensionUri, this.backend.apiBase);
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.ready = false;
    });
    this.panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      if (message?.type === "codelens.webviewReady") {
        this.ready = true;
        this.flush();
      }
      if (message?.type === "codelens.showError") {
        vscode.window.showErrorMessage(message.message);
      }
      if (message?.type === "codelens.requestEditorContext") {
        const editorContext = getActiveEditorContext(message.selectionOnly);
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

  private post(message: ExtensionToWebviewMessage) {
    if (!this.panel) return;
    this.pendingMessages.push(message);
    this.flush();
  }

  private async injectPickedFiles() {
    const files = await pickFileContexts();
    if (!files.length) return;
    this.post({ type: "codelens.openWorkbench", ...buildMultiFileContext(files, "pickedFiles") });
  }

  private async injectRecentFiles() {
    const files = await getOpenTextFileContexts(5);
    if (!files.length) {
      vscode.window.showWarningMessage("没有找到可用于分析的最近代码文件。");
      return;
    }
    this.post({ type: "codelens.recentFilesMenu", files: files.map((file) => ({ ...file, sourceType: "recentFiles" })) });
  }

  private async injectWorkspaceFiles() {
    const files = await pickProjectFileContexts();
    if (!files.length) return;
    this.post({ type: "codelens.openWorkbench", ...buildMultiFileContext(files, "workspaceFiles") });
  }

  private async injectWorkspaceRuleFiles() {
    const files = await collectWorkspaceRuleContexts();
    if (!files.length) return;
    this.post({ type: "codelens.openWorkbench", ...buildMultiFileContext(files, "workspaceRules") });
  }

  private async injectAutoWorkspaceFiles() {
    const files = await autoCollectWorkspaceContexts();
    if (!files.length) {
      this.post({
        type: "codelens.openWorkbench",
        ...buildMultiFileContext([], "autoWorkspace"),
      });
      return;
    }
    this.post({ type: "codelens.openWorkbench", ...buildMultiFileContext(files, "autoWorkspace") });
  }

  private async applyAgentPlan(plan: AgentPlanPayload) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage("请先打开一个工作区，再应用 Agent 计划。");
      await this.reportAgentPlanResult(plan, "failed", "未打开 VS Code 工作区，无法应用计划。");
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `应用 Agent 计划：${plan.summary || "未命名计划"}。将执行 ${plan.operations.length} 个文件操作。`,
      { modal: true },
      "应用",
      "取消"
    );
    if (confirmation !== "应用") {
      await this.reportAgentPlanResult(plan, "rejected", "用户取消应用 Agent 计划。");
      return;
    }

    const rootPath = path.resolve(workspaceFolder.uri.fsPath);
    const edit = new vscode.WorkspaceEdit();
    const skipped: string[] = [];
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
      } else if (operation.type === "update") {
        const document = await vscode.workspace.openTextDocument(targetUri);
        const lastLine = document.lineCount > 0 ? document.lineAt(document.lineCount - 1) : undefined;
        const range = lastLine
          ? new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length)
          : new vscode.Range(0, 0, 0, 0);
        edit.replace(targetUri, range, operation.content ?? "");
      } else if (operation.type === "delete") {
        edit.deleteFile(targetUri, { recursive: false, ignoreIfNotExists: false });
      } else if (operation.type === "rename" && operation.new_path) {
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
      } else {
        const message = "Agent 计划未能应用，请检查工作区与文件状态。";
        vscode.window.showWarningMessage(message);
        await this.reportAgentPlanResult(plan, "failed", message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent 计划应用失败。";
      vscode.window.showErrorMessage(message);
      await this.reportAgentPlanResult(plan, "failed", message);
    }
  }

  private async reportAgentPlanResult(
    plan: AgentPlanPayload,
    status: "applied" | "failed" | "rejected",
    message: string
  ) {
    const planId = plan.plan_id || plan.id || null;
    const sessionId = plan.session_id || null;
    if (planId) {
      try {
        await fetch(`${this.backend.apiBase}/api/agent/plans/${planId}/apply-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, message }),
        });
      } catch (error) {
        console.error("Failed to report Agent plan result", error);
      }
    }
    this.post({ type: "codelens.agentPlanApplied", planId, sessionId, status, message });
  }

  private flush() {
    if (!this.panel || !this.ready) return;
    const messages = [...this.pendingMessages];
    this.pendingMessages = [];
    for (const message of messages) {
      void this.panel.webview.postMessage(message);
    }
  }

}
