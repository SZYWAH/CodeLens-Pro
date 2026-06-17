import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

export type EditorSourceType = "current" | "selection" | "pickedFiles" | "recentFiles" | "workspaceFiles" | "workspaceRules" | "autoWorkspace";
export type FileAttention = "low" | "normal" | "high";

export type EditorFileContext = {
  code: string;
  languageId: string;
  fileName: string;
  filePath: string;
  attention?: FileAttention;
};

export type EditorCodeContext = EditorFileContext & {
  sourceType?: EditorSourceType;
  files?: EditorFileContext[];
};

export type WorkspaceManifestFile = {
  path: string;
  name: string;
  extension: string;
  language: string;
  size: number;
  depth: number;
};

export type ReadContextProgress = {
  index: number;
  total: number;
  path: string;
  status: "reading" | "read" | "summarized" | "skipped";
  bytes?: number;
  chars?: number;
  reason?: string;
};

export type ReadContextOptions = {
  onProgress?: (event: ReadContextProgress) => void | Promise<void>;
};

export function getActiveEditorContext(selectionOnly: boolean): EditorCodeContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const document = editor.document;
  const selectedText = editor.selection.isEmpty ? "" : document.getText(editor.selection);
  const code = selectionOnly && selectedText.trim() ? selectedText : document.getText();

  return {
    code,
    languageId: document.languageId,
    fileName: path.basename(document.fileName),
    filePath: document.uri.fsPath,
    sourceType: selectionOnly && selectedText.trim() ? "selection" : "current",
  };
}

export async function getFileContext(uri: vscode.Uri): Promise<EditorFileContext> {
  const document = await vscode.workspace.openTextDocument(uri);
  return {
    code: document.getText(),
    languageId: document.languageId,
    fileName: path.basename(document.fileName),
    filePath: document.uri.fsPath,
  };
}

async function getLargeFileKeyPointContext(uri: vscode.Uri): Promise<EditorFileContext> {
  const extension = path.extname(uri.fsPath).replace(/^\./, "").toLowerCase();
  const stat = await vscode.workspace.fs.stat(uri);
  const snapshot = await readLargeTextSnapshot(uri.fsPath, stat.size);
  const code = [
    `# 大文件关键点上下文`,
    `# 原始文件：${uri.fsPath}`,
    `# 原始大小：${formatBytes(stat.size)}，已流式扫描字符数约：${snapshot.scannedChars}`,
    `# 说明：该文件超过普通完整上下文上限，插件已流式读取文本并保留头部、中部采样、尾部及关键行，供后端逐文件关键点提取。`,
    "",
    "## 关键行",
    snapshot.keyLines || "未找到明显关键行。",
    "",
    "## 文件头部",
    snapshot.head,
    "",
    "## 文件中部采样",
    snapshot.middle,
    "",
    "## 文件尾部",
    snapshot.tail,
  ].join("\n");
  return {
    code,
    languageId: languageFromExtension(extension),
    fileName: path.basename(uri.fsPath),
    filePath: uri.fsPath,
    attention: "high",
  };
}

async function readLargeTextSnapshot(filePath: string, bytes: number): Promise<{ head: string; middle: string; tail: string; keyLines: string; scannedChars: number }> {
  const headLimit = Math.floor(LARGE_FILE_SLICE_CHARS / 2);
  const tailLimit = Math.floor(LARGE_FILE_SLICE_CHARS / 2);
  const middleLimit = Math.floor(LARGE_FILE_SLICE_CHARS / 3);
  const middleStartByte = Math.max(0, Math.floor(bytes / 2) - Math.floor(MAX_FILE_BYTES / 4));
  const middleEndByte = Math.min(bytes, middleStartByte + Math.floor(MAX_FILE_BYTES / 2));
  let offset = 0;
  let scannedChars = 0;
  let head = "";
  let middle = "";
  let tail = "";
  const keyLines: string[] = [];
  let lineBuffer = "";
  let lineNumber = 1;

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 });
    stream.on("data", (rawChunk: string | Buffer) => {
      const chunk = String(rawChunk);
      scannedChars += chunk.length;
      if (head.length < headLimit) {
        head = (head + chunk).slice(0, headLimit);
      }
      const chunkStart = offset;
      const chunkEnd = offset + Buffer.byteLength(chunk, "utf8");
      if (chunkEnd >= middleStartByte && chunkStart <= middleEndByte && middle.length < middleLimit) {
        middle = (middle + chunk).slice(0, middleLimit);
      }
      tail = (tail + chunk).slice(-tailLimit);
      offset = chunkEnd;

      if (keyLines.length < 260) {
        const lines = (lineBuffer + chunk).split(/\r?\n/);
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          collectKeyLine(line, lineNumber, keyLines);
          lineNumber += 1;
          if (keyLines.length >= 260) break;
        }
      }
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (lineBuffer && keyLines.length < 260) {
        collectKeyLine(lineBuffer, lineNumber, keyLines);
      }
      resolve();
    });
  });

  return {
    head,
    middle,
    tail,
    keyLines: keyLines.join("\n"),
    scannedChars,
  };
}

function collectKeyLine(line: string, lineNumber: number, result: string[]) {
  const patterns = [
    /^\s*(def|class|async\s+def)\s+/,
    /^\s*(function|const|let|var)\s+\w+/,
    /^\s*import\s+/,
    /^\s*from\s+\S+\s+import\s+/,
    /print\s*\(/,
    /\blogger\./,
    /\blogging\b/,
    /except\b|catch\s*\(/,
    /TODO|FIXME|ERROR|WARN|warning|exception/i,
  ];
  if (!patterns.some((pattern) => pattern.test(line))) return;
  result.push(`${lineNumber}: ${line.slice(0, 500)}`);
}

export async function pickFileContexts(): Promise<EditorFileContext[]> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
    openLabel: "加入 CodeLens Pro 分析",
    filters: {
      "Code files": ["py", "js", "jsx", "ts", "tsx", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "php", "rb", "swift", "kt", "sql", "json", "yaml", "yml", "md"],
      "All files": ["*"],
    },
  });

  if (!uris?.length) return [];
  const contexts = await Promise.all(uris.map((uri) => getFileContext(uri)));
  return contexts.filter((item) => item.code.trim());
}

export async function getOpenTextFileContexts(limit = 5): Promise<EditorFileContext[]> {
  const candidates: vscode.Uri[] = [];
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") candidates.push(activeUri);

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.scheme === "file") {
        candidates.push(input.uri);
      }
    }
  }

  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme === "file") candidates.push(editor.document.uri);
  }

  const seen = new Set<string>();
  const unique = candidates.filter((uri) => {
    const key = uri.fsPath.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const contexts = await Promise.all(unique.slice(0, limit).map((uri) => getFileContext(uri)));
  return contexts.filter((item) => item.code.trim());
}

const CODE_FILE_EXTENSIONS = [
  "py", "js", "jsx", "ts", "tsx", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "php", "rb", "swift", "kt",
  "sql", "json", "yaml", "yml", "md", "toml", "ini", "cfg", "env", "txt"
];
const WORKSPACE_EXCLUDE = "{**/node_modules/**,**/.git/**,**/.venv/**,**/venv/**,**/dist/**,**/build/**,**/__pycache__/**,**/.next/**,**/.vite/**}";
const MAX_FILE_BYTES = 240_000;
const LARGE_FILE_SLICE_CHARS = 18_000;
const MAX_AUTO_CONTEXT_FILES = 36;

export async function pickProjectFileContexts(): Promise<EditorFileContext[]> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("请先打开一个 VS Code 工作区。");
    return [];
  }

  const uris = await vscode.workspace.findFiles("**/*", WORKSPACE_EXCLUDE, 240);
  const candidates = await filterReadableUris(uris);
  if (!candidates.length) {
    vscode.window.showWarningMessage("没有找到可用于分析的工作区代码文件。");
    return [];
  }

  const rootPath = workspaceFolder.uri.fsPath;
  const selected = await vscode.window.showQuickPick(
    candidates.map((uri) => ({
      label: path.basename(uri.fsPath),
      description: path.relative(rootPath, uri.fsPath),
      uri,
    })),
    {
      canPickMany: true,
      matchOnDescription: true,
      placeHolder: "选择一个或多个项目文件作为 CodeLens Pro 上下文",
    }
  );
  if (!selected?.length) return [];
  return readContextBundle(selected.map((item) => item.uri));
}

export async function readWorkspaceSelectedFileContexts(relativePaths: string[], options: ReadContextOptions = {}): Promise<EditorFileContext[]> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder || !relativePaths.length) return [];

  const rootPath = path.resolve(workspaceFolder.uri.fsPath);
  const seen = new Set<string>();
  const candidates: Array<{ uri: vscode.Uri; relativePath: string }> = [];

  for (const rawPath of relativePaths) {
    const normalized = String(rawPath || "").trim().replace(/\\/g, "/");
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

    const targetPath = path.resolve(rootPath, ...normalized.split("/").filter(Boolean));
    if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${path.sep}`)) continue;

    const key = targetPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ uri: vscode.Uri.file(targetPath), relativePath: normalized });
  }

  return readContextBundleWithProgress(candidates, options);
}

export async function collectWorkspaceManifest(limit = 800): Promise<WorkspaceManifestFile[]> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return [];

  const rootPath = workspaceFolder.uri.fsPath;
  const uris = await vscode.workspace.findFiles("**/*", WORKSPACE_EXCLUDE, limit);
  const readableUris = await filterReadableUris(uris);
  const result: WorkspaceManifestFile[] = [];

  for (const uri of readableUris) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const relativePath = path.relative(rootPath, uri.fsPath).replace(/\\/g, "/");
      const extension = path.extname(uri.fsPath).replace(/^\./, "").toLowerCase();
      result.push({
        path: relativePath,
        name: path.basename(uri.fsPath),
        extension,
        language: languageFromExtension(extension),
        size: stat.size,
        depth: relativePath.split("/").filter(Boolean).length,
      });
    } catch {
      // Ignore files that disappear or become unreadable during manifest collection.
    }
  }

  return result;
}

export async function collectWorkspaceRuleContexts(): Promise<EditorFileContext[]> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "当前目录相关文件", description: "收集当前文件所在目录下的代码与配置文件", rule: "currentDir" },
      { label: "最近打开文件", description: "收集当前活动、可见和最近打开的文本文件", rule: "recent" },
      { label: "Python / TS / JS 源码", description: "收集工作区中的主要脚本源码文件", rule: "source" },
      { label: "配置文件", description: "收集 package、tsconfig、pyproject、env、yaml 等配置文件", rule: "config" },
    ],
    { placeHolder: "选择一种项目上下文收集规则" }
  );
  if (!choice) return [];

  if (choice.rule === "recent") return getOpenTextFileContexts(10);

  let uris: vscode.Uri[] = [];
  if (choice.rule === "currentDir") {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (!activeUri || activeUri.scheme !== "file") {
      vscode.window.showWarningMessage("请先打开一个项目文件，再收集当前目录相关文件。");
      return [];
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    const relativeDir = workspaceFolder ? path.dirname(path.relative(workspaceFolder.uri.fsPath, activeUri.fsPath)).replace(/\\/g, "/") : "";
    const include = relativeDir && relativeDir !== "." ? `${relativeDir}/**/*` : "**/*";
    uris = await vscode.workspace.findFiles(include, WORKSPACE_EXCLUDE, 80);
  } else if (choice.rule === "source") {
    uris = await vscode.workspace.findFiles("**/*.{py,ts,tsx,js,jsx}", WORKSPACE_EXCLUDE, 80);
  } else {
    uris = await vscode.workspace.findFiles(
      "{**/package.json,**/tsconfig*.json,**/vite.config.*,**/pyproject.toml,**/requirements*.txt,**/.env.example,**/*.yaml,**/*.yml,**/*.ini}",
      WORKSPACE_EXCLUDE,
      80
    );
  }

  const contexts = await readContextBundle(await filterReadableUris(uris));
  if (!contexts.length) vscode.window.showWarningMessage("该规则没有收集到可用于分析的文件。");
  return contexts;
}

export async function autoCollectWorkspaceContexts(): Promise<EditorFileContext[]> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage("CodeLens Pro: 请先打开一个 VS Code 工作区。");
    return [];
  }

  const uris: vscode.Uri[] = [];
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file" && vscode.workspace.getWorkspaceFolder(activeUri)) {
    uris.push(activeUri);
  }

  const priorityPatterns = [
    "README.md",
    "README*.md",
    "requirements*.txt",
    "pyproject.toml",
    "package.json",
    "tsconfig*.json",
    "vite.config.*",
    ".env.example",
    "alembic.ini",
    "docker-compose*.yml",
    "Dockerfile",
    "backend/app/main.py",
    "backend/app/models.py",
    "backend/app/schemas.py",
    "backend/app/services/*.py",
    "frontend/src/App.tsx",
    "frontend/src/main.tsx",
    "vscode-extension/package.json",
    "vscode-extension/src/extension.ts",
    "vscode-extension/src/editorContext.ts",
    "vscode-extension/src/webviewView.ts",
    "vscode-extension/src/messageBridge.ts",
    "vscode-extension/webview-mini/src/App.tsx",
  ];

  const broadPatterns = [
    "backend/app/**/*.py",
    "frontend/src/**/*.{ts,tsx,js,jsx}",
    "vscode-extension/src/**/*.ts",
    "vscode-extension/webview-mini/src/**/*.{ts,tsx}",
  ];

  for (const pattern of priorityPatterns) {
    uris.push(...await vscode.workspace.findFiles(pattern, WORKSPACE_EXCLUDE, 8));
  }
  for (const pattern of broadPatterns) {
    uris.push(...await vscode.workspace.findFiles(pattern, WORKSPACE_EXCLUDE, 24));
  }

  const candidates = await filterReadableUris(uris);
  const ranked = rankAutoContextUris(candidates, workspaceFolder.uri.fsPath).slice(0, MAX_AUTO_CONTEXT_FILES);
  const contexts = await readContextBundle(ranked);
  if (!contexts.length) {
    vscode.window.showWarningMessage("CodeLens Pro: 没有找到可用于自动分析的项目文件。");
  }
  return contexts;
}

async function filterReadableUris(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
  const result: vscode.Uri[] = [];
  const seen = new Set<string>();
  for (const uri of uris) {
    const ext = path.extname(uri.fsPath).replace(/^\./, "").toLowerCase();
    if (ext && !CODE_FILE_EXTENSIONS.includes(ext)) continue;
    const key = uri.fsPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      result.push(uri);
    } catch {
      // Ignore unreadable files.
    }
  }
  return result;
}

async function isReadableUri(uri: vscode.Uri): Promise<
  | { ok: true; bytes: number; large: boolean }
  | { ok: false; reason: string; bytes?: number }
> {
  const ext = path.extname(uri.fsPath).replace(/^\./, "").toLowerCase();
  if (ext && !CODE_FILE_EXTENSIONS.includes(ext)) {
    return { ok: false, reason: "文件类型不在可读代码上下文范围内。" };
  }
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) {
      return { ok: true, bytes: stat.size, large: true };
    }
    return { ok: true, bytes: stat.size, large: false };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "文件不存在或无法读取。" };
  }
}

async function readContextBundleWithProgress(
  candidates: Array<{ uri: vscode.Uri; relativePath: string }>,
  options: ReadContextOptions = {},
): Promise<EditorFileContext[]> {
  const contexts: EditorFileContext[] = [];
  const total = candidates.length;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const position = index + 1;
    await options.onProgress?.({
      index: position,
      total,
      path: candidate.relativePath,
      status: "reading",
    });

    const readable = await isReadableUri(candidate.uri);
    if (!readable.ok) {
      await options.onProgress?.({
        index: position,
        total,
        path: candidate.relativePath,
        status: "skipped",
        bytes: readable.bytes,
        reason: readable.reason,
      });
      continue;
    }

    try {
      const context = readable.large
        ? await getLargeFileKeyPointContext(candidate.uri)
        : await getFileContext(candidate.uri);
      if (!context.code.trim()) {
        await options.onProgress?.({
          index: position,
          total,
          path: candidate.relativePath,
          status: "skipped",
          bytes: readable.bytes,
          chars: context.code.length,
          reason: "文件内容为空。",
        });
        continue;
      }

      contexts.push(context);
      await options.onProgress?.({
        index: position,
        total,
        path: candidate.relativePath,
        status: readable.large ? "summarized" : "read",
        bytes: readable.bytes,
        chars: context.code.length,
        reason: readable.large ? "文件较大，已读取文本并提取关键点上下文。" : undefined,
      });
    } catch (error) {
      await options.onProgress?.({
        index: position,
        total,
        path: candidate.relativePath,
        status: "skipped",
        bytes: readable.bytes,
        reason: error instanceof Error ? error.message : "文件读取失败。",
      });
    }
  }

  return contexts;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

function rankAutoContextUris(uris: vscode.Uri[], rootPath: string): vscode.Uri[] {
  return [...uris].sort((left, right) => {
    const leftRelative = path.relative(rootPath, left.fsPath).replace(/\\/g, "/");
    const rightRelative = path.relative(rootPath, right.fsPath).replace(/\\/g, "/");
    return scoreAutoContextPath(rightRelative) - scoreAutoContextPath(leftRelative)
      || leftRelative.localeCompare(rightRelative);
  });
}

function scoreAutoContextPath(relativePath: string): number {
  const normalized = relativePath.replace(/\\/g, "/");
  const fileName = path.basename(normalized).toLowerCase();
  let score = 0;
  if (/^readme/.test(fileName)) score += 100;
  if (["package.json", "requirements.txt", "pyproject.toml", "alembic.ini", ".env.example", "dockerfile"].includes(fileName)) score += 90;
  if (normalized === "backend/app/main.py") score += 85;
  if (normalized === "frontend/src/App.tsx") score += 80;
  if (normalized === "vscode-extension/webview-mini/src/App.tsx") score += 80;
  if (normalized.includes("/services/")) score += 45;
  if (normalized.startsWith("backend/app/")) score += 40;
  if (normalized.startsWith("frontend/src/")) score += 35;
  if (normalized.startsWith("vscode-extension/src/")) score += 30;
  if (normalized.startsWith("vscode-extension/webview-mini/src/")) score += 30;
  return score;
}

function languageFromExtension(extension: string): string {
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    go: "go",
    rs: "rust",
    php: "php",
    rb: "ruby",
    swift: "swift",
    kt: "kotlin",
    sql: "sql",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
  };
  return map[extension] || "text";
}

async function readContextBundle(uris: vscode.Uri[]): Promise<EditorFileContext[]> {
  const contexts: EditorFileContext[] = [];
  for (const uri of uris) {
    const stat = await vscode.workspace.fs.stat(uri);
    const context = stat.size > MAX_FILE_BYTES
      ? await getLargeFileKeyPointContext(uri)
      : await getFileContext(uri);
    if (!context.code.trim()) continue;
    contexts.push(context);
  }
  return contexts;
}

export function buildMultiFileContext(files: EditorFileContext[], sourceType: "pickedFiles" | "recentFiles" | "workspaceFiles" | "workspaceRules" | "autoWorkspace"): EditorCodeContext {
  const labels: Record<string, string> = {
    pickedFiles: "本地文件",
    recentFiles: "最近文件",
    workspaceFiles: "项目文件",
    workspaceRules: "规则收集",
  };
  const label = sourceType === "autoWorkspace" ? "自动项目上下文" : labels[sourceType];
  const code = files
    .map((file, index) => [
      `## File ${index + 1}: ${file.fileName}`,
      `Path: ${file.filePath}`,
      `Language: ${file.languageId}`,
      "",
      "```" + file.languageId,
      file.code,
      "```",
    ].join("\n"))
    .join("\n\n---\n\n");

  return {
    code,
    languageId: "plaintext",
    fileName: `${label}上下文 · ${files.length} 个文件`,
    filePath: files.map((file) => file.filePath).join("; "),
    sourceType,
    files,
  };
}
