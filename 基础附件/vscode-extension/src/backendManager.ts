import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export class BackendManager {
  private process: cp.ChildProcessWithoutNullStreams | null = null;
  private output = vscode.window.createOutputChannel("CodeLens Pro Backend");
  private agentReadyCache: { healthy: boolean; agentReady: boolean; checkedAt: number } | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get projectRoot() {
    const devRoot = path.resolve(this.extensionUri.fsPath, "..");
    if (fs.existsSync(path.join(devRoot, "backend", "app", "main.py"))) {
      return devRoot;
    }
    return this.extensionUri.fsPath;
  }

  get port() {
    return vscode.workspace.getConfiguration("codelens").get<number>("backendPort", 8000);
  }

  get apiBase() {
    return `http://127.0.0.1:${this.port}`;
  }

  appendOutput(message: string) {
    this.output.appendLine(message);
  }

  async ensureRunning() {
    const status = await this.getBackendStatus();
    if (status.healthy && status.agentReady) return;
    if (status.healthy && !status.agentReady) {
      vscode.window.showWarningMessage(
        `CodeLens Pro 后端正在运行，但缺少 Agent 接口。请重启 FastAPI 后端或停止占用 ${this.port} 端口的旧进程。`
      );
      return;
    }

    const autoStart = vscode.workspace.getConfiguration("codelens").get<boolean>("autoStartBackend", true);
    if (!autoStart) {
      vscode.window.showWarningMessage(`CodeLens Pro 后端未运行，请先启动 FastAPI 服务：${this.apiBase}`);
      return;
    }

    await this.start();
  }

  async isHealthy() {
    const status = await this.getBackendStatus();
    return status.healthy;
  }

  async getHealthStatus(timeoutMs = 1200) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${this.apiBase}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      return { healthy: response.ok };
    } catch {
      return { healthy: false };
    }
  }

  async getCachedBackendStatus(options: { force?: boolean; maxAgeMs?: number } = {}) {
    const maxAgeMs = options.maxAgeMs ?? 60000;
    const now = Date.now();
    if (!options.force && this.agentReadyCache && now - this.agentReadyCache.checkedAt < maxAgeMs) {
      const health = await this.getHealthStatus();
      if (health.healthy) {
        return {
          healthy: true,
          agentReady: this.agentReadyCache.agentReady,
        };
      }
      this.agentReadyCache = { healthy: false, agentReady: false, checkedAt: now };
      return { healthy: false, agentReady: false };
    }

    const status = await this.getBackendStatus();
    this.agentReadyCache = { ...status, checkedAt: now };
    return status;
  }

  async getBackendStatus() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const response = await fetch(`${this.apiBase}/api/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return { healthy: false, agentReady: false };

      const openapiController = new AbortController();
      const openapiTimer = setTimeout(() => openapiController.abort(), 1200);
      const openapiResponse = await fetch(`${this.apiBase}/openapi.json`, { signal: openapiController.signal });
      clearTimeout(openapiTimer);
      if (!openapiResponse.ok) return { healthy: true, agentReady: false };
      const openapi = await openapiResponse.json() as { paths?: Record<string, unknown> };
      const paths = openapi.paths ?? {};
      return {
        healthy: true,
        agentReady: Boolean(
          paths["/api/agent/plan"]
          && paths["/api/agent/chat/stream"]
          && paths["/api/agent/pending"]
          && paths["/api/agent/confirmed"]
          && paths["/api/agent/workspace/heartbeat"]
          && paths["/api/agent/workspace/current"]
        ),
      };
    } catch {
      return { healthy: false, agentReady: false };
    }
  }

  async start() {
    if (this.process) return;

    const configuredPythonPath = vscode.workspace.getConfiguration("codelens").get<string>("pythonPath", "python");
    const pythonPath = this.resolvePythonPath(configuredPythonPath);
    const args = [
      "-m",
      "uvicorn",
      "backend.app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(this.port),
    ];

    this.output.appendLine(`[CodeLens Pro] Starting backend: ${pythonPath} ${args.join(" ")}`);
    this.output.appendLine(`[CodeLens Pro] cwd=${this.projectRoot}`);

    this.process = cp.spawn(pythonPath, args, {
      cwd: this.projectRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    this.process.stdout.on("data", (chunk) => this.output.append(chunk.toString()));
    this.process.stderr.on("data", (chunk) => this.output.append(chunk.toString()));
    this.process.on("exit", (code) => {
      this.output.appendLine(`[CodeLens Pro] Backend exited with code ${code ?? "unknown"}`);
      this.process = null;
    });

    const started = await this.waitUntilHealthy(12000);
    if (!started) {
      this.output.show(true);
      vscode.window.showErrorMessage(
        `CodeLens Pro 后端启动失败。请检查 Python 路径、依赖、MySQL 配置或端口 ${this.port} 是否被占用。`
      );
      return;
    }

    vscode.window.showInformationMessage(`CodeLens Pro 后端已启动：${this.apiBase}`);
  }

  stop() {
    this.process?.kill();
    this.process = null;
    this.output.dispose();
  }

  private async waitUntilHealthy(timeoutMs: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return false;
  }

  private resolvePythonPath(configuredPythonPath: string) {
    if (configuredPythonPath && configuredPythonPath !== "python") {
      return configuredPythonPath;
    }

    const venvPython = path.join(this.projectRoot, ".venv", "Scripts", "python.exe");
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }

    return configuredPythonPath || "python";
  }
}
