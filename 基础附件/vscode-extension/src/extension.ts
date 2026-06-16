import * as vscode from "vscode";
import { BackendManager } from "./backendManager";
import { getActiveEditorContext, getFileContext } from "./editorContext";
import { AgentWorkspaceExecutor } from "./agentExecutor";
import { CodeLensWebviewPanel } from "./webviewPanel";
import { CODELENS_VIEW_ID, CodeLensWebviewViewProvider } from "./webviewView";
import { WorkspaceHeartbeatService } from "./workspaceHeartbeat";

export function activate(context: vscode.ExtensionContext) {
  const backend = new BackendManager(context.extensionUri);
  const agentExecutor = new AgentWorkspaceExecutor(backend);
  const workspaceHeartbeat = new WorkspaceHeartbeatService(
    backend,
    String(context.extension.packageJSON?.version ?? "0.1.1"),
  );
  const webviewPanel = new CodeLensWebviewPanel(context, backend);
  const webviewView = new CodeLensWebviewViewProvider(context, backend);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.text = "$(sparkle) CodeLens Pro";
  statusBar.tooltip = "打开 CodeLens Pro";
  statusBar.command = "codelensPro.openPanel";
  statusBar.show();

  context.subscriptions.push(
    statusBar,
    agentExecutor,
    workspaceHeartbeat,
    vscode.window.registerWebviewViewProvider(CODELENS_VIEW_ID, webviewView, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.commands.registerCommand("codelensPro.openPanel", async () => {
      await webviewPanel.open("workbench");
      void workspaceHeartbeat.flush("open-panel");
    }),
    vscode.commands.registerCommand("codelensPro.openSidebar", async () => {
      await webviewView.open("workbench");
      void workspaceHeartbeat.flush("open-sidebar");
    }),
    vscode.commands.registerCommand("codelensPro.openChat", async () => {
      await webviewView.open("chat");
      void workspaceHeartbeat.flush("open-chat");
    }),
    vscode.commands.registerCommand("codelensPro.openHistory", async () => {
      await webviewView.open("history");
      void workspaceHeartbeat.flush("open-history");
    }),
    vscode.commands.registerCommand("codelensPro.openStats", async () => {
      await webviewView.open("settings");
      void workspaceHeartbeat.flush("open-stats");
    }),
    vscode.commands.registerCommand("codelensPro.analyzeCurrentFile", async () => {
      const editorContext = getActiveEditorContext(false);
      if (!editorContext) {
        vscode.window.showWarningMessage("请先打开一个代码文件。");
        return;
      }
      await webviewView.openWorkbench(editorContext);
      void workspaceHeartbeat.flush("analyze-current-file");
    }),
    vscode.commands.registerCommand("codelensPro.analyzeSelection", async () => {
      const editorContext = getActiveEditorContext(true);
      if (!editorContext) {
        vscode.window.showWarningMessage("请先打开一个代码文件。");
        return;
      }
      await webviewView.openWorkbench(editorContext);
      void workspaceHeartbeat.flush("analyze-selection");
    }),
    vscode.commands.registerCommand("codelensPro.analyzeFile", async (uri?: vscode.Uri) => {
      if (!uri) {
        const editorContext = getActiveEditorContext(false);
        if (!editorContext) {
          vscode.window.showWarningMessage("请先选择或打开一个代码文件。");
          return;
        }
        await webviewView.openWorkbench(editorContext);
        void workspaceHeartbeat.flush("analyze-file");
        return;
      }

      const fileContext = await getFileContext(uri);
      await webviewView.openWorkbench(fileContext);
      void workspaceHeartbeat.flush("analyze-file");
    }),
    {
      dispose() {
        webviewPanel.dispose();
        webviewView.dispose();
        backend.stop();
        agentExecutor.dispose();
        workspaceHeartbeat.dispose();
      },
    }
  );

  void backend.ensureRunning().then(() => workspaceHeartbeat.start());
  agentExecutor.start();

  void backend.isHealthy().then((healthy) => {
    statusBar.text = healthy ? "$(sparkle) CodeLens Pro" : "$(warning) CodeLens Pro";
    statusBar.tooltip = healthy ? "打开 CodeLens Pro" : "CodeLens Pro 后端未运行，点击尝试启动";
  });
}

export function deactivate() {
  // Cleanup is handled by subscriptions registered in activate().
}
