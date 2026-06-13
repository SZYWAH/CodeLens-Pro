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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const backendManager_1 = require("./backendManager");
const editorContext_1 = require("./editorContext");
const agentExecutor_1 = require("./agentExecutor");
const webviewPanel_1 = require("./webviewPanel");
const webviewView_1 = require("./webviewView");
const workspaceHeartbeat_1 = require("./workspaceHeartbeat");
function activate(context) {
    const backend = new backendManager_1.BackendManager(context.extensionUri);
    const agentExecutor = new agentExecutor_1.AgentWorkspaceExecutor(backend);
    const workspaceHeartbeat = new workspaceHeartbeat_1.WorkspaceHeartbeatService(backend, String(context.extension.packageJSON?.version ?? "0.1.1"));
    const webviewPanel = new webviewPanel_1.CodeLensWebviewPanel(context, backend);
    const webviewView = new webviewView_1.CodeLensWebviewViewProvider(context, backend);
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusBar.text = "$(sparkle) CodeLens Pro";
    statusBar.tooltip = "打开 CodeLens Pro";
    statusBar.command = "codelensPro.openPanel";
    statusBar.show();
    context.subscriptions.push(statusBar, agentExecutor, workspaceHeartbeat, vscode.window.registerWebviewViewProvider(webviewView_1.CODELENS_VIEW_ID, webviewView, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    }), vscode.commands.registerCommand("codelensPro.openPanel", async () => {
        await webviewPanel.open("workbench");
        void workspaceHeartbeat.flush("open-panel");
    }), vscode.commands.registerCommand("codelensPro.openSidebar", async () => {
        await webviewView.open("workbench");
        void workspaceHeartbeat.flush("open-sidebar");
    }), vscode.commands.registerCommand("codelensPro.openChat", async () => {
        await webviewView.open("chat");
        void workspaceHeartbeat.flush("open-chat");
    }), vscode.commands.registerCommand("codelensPro.openHistory", async () => {
        await webviewView.open("history");
        void workspaceHeartbeat.flush("open-history");
    }), vscode.commands.registerCommand("codelensPro.openStats", async () => {
        await webviewView.open("settings");
        void workspaceHeartbeat.flush("open-stats");
    }), vscode.commands.registerCommand("codelensPro.analyzeCurrentFile", async () => {
        const editorContext = (0, editorContext_1.getActiveEditorContext)(false);
        if (!editorContext) {
            vscode.window.showWarningMessage("请先打开一个代码文件。");
            return;
        }
        await webviewView.openWorkbench(editorContext);
        void workspaceHeartbeat.flush("analyze-current-file");
    }), vscode.commands.registerCommand("codelensPro.analyzeSelection", async () => {
        const editorContext = (0, editorContext_1.getActiveEditorContext)(true);
        if (!editorContext) {
            vscode.window.showWarningMessage("请先打开一个代码文件。");
            return;
        }
        await webviewView.openWorkbench(editorContext);
        void workspaceHeartbeat.flush("analyze-selection");
    }), vscode.commands.registerCommand("codelensPro.analyzeFile", async (uri) => {
        if (!uri) {
            const editorContext = (0, editorContext_1.getActiveEditorContext)(false);
            if (!editorContext) {
                vscode.window.showWarningMessage("请先选择或打开一个代码文件。");
                return;
            }
            await webviewView.openWorkbench(editorContext);
            void workspaceHeartbeat.flush("analyze-file");
            return;
        }
        const fileContext = await (0, editorContext_1.getFileContext)(uri);
        await webviewView.openWorkbench(fileContext);
        void workspaceHeartbeat.flush("analyze-file");
    }), {
        dispose() {
            webviewPanel.dispose();
            webviewView.dispose();
            backend.stop();
            agentExecutor.dispose();
            workspaceHeartbeat.dispose();
        },
    });
    void backend.ensureRunning().then(() => workspaceHeartbeat.start());
    agentExecutor.start();
    void backend.isHealthy().then((healthy) => {
        statusBar.text = healthy ? "$(sparkle) CodeLens Pro" : "$(warning) CodeLens Pro";
        statusBar.tooltip = healthy ? "打开 CodeLens Pro" : "CodeLens Pro 后端未运行，点击尝试启动";
    });
}
function deactivate() {
    // Cleanup is handled by subscriptions registered in activate().
}
//# sourceMappingURL=extension.js.map