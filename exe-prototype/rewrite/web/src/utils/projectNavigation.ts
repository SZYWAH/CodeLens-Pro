import type { FileDependency, WorkspaceDetail, WorkspaceFile } from "../types";

export type InspectSource = "guide" | "hotspot" | "symbol" | "dependency" | "graph";

export type InspectTarget = {
  path: string;
  line?: number;
  endLine?: number;
  title?: string;
  context?: string;
  source: InspectSource;
};

export type ResolvedDependency = FileDependency & {
  sourceFile: WorkspaceFile | null;
  targetFile: WorkspaceFile | null;
  external: boolean;
};

type WorkspaceFileLookup = {
  exact: Map<string, WorkspaceFile>;
  suffix: Map<string, WorkspaceFile | null>;
};

const workspaceFileLookupCache = new WeakMap<WorkspaceDetail, WorkspaceFileLookup>();

export function normalizeProjectPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .toLocaleLowerCase();
}

export function projectBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || value;
}

export function projectDirname(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function topLevelArea(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : "根目录";
}

export function createWorkspaceFileIndex(workspace: WorkspaceDetail): Map<string, WorkspaceFile> {
  return new Map(workspace.files.map((file) => [normalizeProjectPath(file.path), file]));
}

export function findWorkspaceFile(workspace: WorkspaceDetail, path: string): WorkspaceFile | null {
  return findFromLookup(createWorkspaceFileLookup(workspace), path);
}

export function resolveWorkspaceDependencies(
  workspace: WorkspaceDetail,
  dependencies: FileDependency[]
): ResolvedDependency[] {
  const lookup = createWorkspaceFileLookup(workspace);
  return dependencies.map((dependency) => {
    const sourceFile = findFromLookup(lookup, dependency.source_path);
    const targetFile = sourceFile
      ? resolveDependencyTarget(lookup, sourceFile, dependency.target, dependency.kind)
      : null;
    return {
      ...dependency,
      sourceFile,
      targetFile,
      external: targetFile === null
    };
  });
}

function resolveDependencyTarget(
  lookup: WorkspaceFileLookup,
  sourceFile: WorkspaceFile,
  rawTarget: string,
  kind: string
): WorkspaceFile | null {
  const target = cleanTarget(rawTarget);
  if (!target) return null;

  const sourcePath = sourceFile.path.replace(/\\/g, "/");
  const sourceDir = projectDirname(sourcePath);
  const language = sourceFile.language.toLocaleLowerCase();
  const candidates = new Set<string>();

  addDirectCandidates(candidates, target);

  if (target.startsWith(".")) {
    addDirectCandidates(candidates, joinProjectPath(sourceDir, target));
  }

  if (language.includes("type") || language.includes("java") || /\.(tsx?|jsx?)$/i.test(sourcePath)) {
    const base = target.startsWith(".") ? joinProjectPath(sourceDir, target) : target;
    for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]) {
      candidates.add(base + extension);
      candidates.add(joinProjectPath(base, "index" + extension));
    }
  }

  if (language.includes("python") || /\.py$/i.test(sourcePath)) {
    const relativeDots = target.match(/^\.+/)?.[0].length || 0;
    const dotted = target.replace(/^\.+/, "").replace(/\./g, "/");
    let baseDir = sourceDir;
    for (let index = 1; index < relativeDots; index += 1) baseDir = projectDirname(baseDir);
    const base = relativeDots ? joinProjectPath(baseDir, dotted) : dotted;
    candidates.add(base + ".py");
    candidates.add(joinProjectPath(base, "__init__.py"));
  }

  if (language.includes("rust") || /\.rs$/i.test(sourcePath) || kind === "use") {
    const rustTarget = target.replace(/^::/, "").replace(/::/g, "/");
    const sourceModuleDir = projectBasename(sourcePath) === "mod.rs" ? sourceDir : projectDirname(sourcePath);
    const base = rustTarget
      .replace(/^crate\//, "src/")
      .replace(/^self\//, sourceModuleDir ? sourceModuleDir + "/" : "")
      .replace(/^super\//, projectDirname(sourceModuleDir) ? projectDirname(sourceModuleDir) + "/" : "");
    candidates.add(base + ".rs");
    candidates.add(joinProjectPath(base, "mod.rs"));
  }

  if (kind === "include" || /\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(sourcePath)) {
    addDirectCandidates(candidates, joinProjectPath(sourceDir, target));
    for (const prefix of ["include", "src"]) addDirectCandidates(candidates, joinProjectPath(prefix, target));
  }

  for (const candidate of candidates) {
    const found = findFromLookup(lookup, candidate);
    if (found) return found;
  }
  return null;
}

function addDirectCandidates(candidates: Set<string>, value: string) {
  const normalized = collapseProjectPath(value);
  candidates.add(normalized);
  if (!/\.[a-z0-9]+$/i.test(normalized)) {
    for (const extension of [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".json", ".h", ".hpp"]) {
      candidates.add(normalized + extension);
    }
  }
}

function createWorkspaceFileLookup(workspace: WorkspaceDetail): WorkspaceFileLookup {
  const cached = workspaceFileLookupCache.get(workspace);
  if (cached) return cached;

  const exact = createWorkspaceFileIndex(workspace);
  const suffix = new Map<string, WorkspaceFile | null>();
  for (const file of workspace.files) {
    const parts = normalizeProjectPath(file.path).split("/").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const key = parts.slice(index).join("/");
      const current = suffix.get(key);
      if (current === undefined) suffix.set(key, file);
      else if (current?.path !== file.path) suffix.set(key, null);
    }
  }
  const lookup = { exact, suffix };
  workspaceFileLookupCache.set(workspace, lookup);
  return lookup;
}

function findFromLookup(lookup: WorkspaceFileLookup, candidate: string): WorkspaceFile | null {
  const normalized = normalizeProjectPath(collapseProjectPath(candidate));
  const exact = lookup.exact.get(normalized);
  if (exact) return exact;
  const suffix = lookup.suffix.get(normalized);
  if (suffix) return suffix;

  for (const [path, file] of lookup.exact) {
    if (normalized.endsWith("/" + path)) return file;
  }
  return null;
}

function cleanTarget(value: string): string {
  return value.trim().replace(/^[<'"`]+|[>'"`;]+$/g, "").split(/[?#]/, 1)[0];
}

function joinProjectPath(left: string, right: string): string {
  return collapseProjectPath([left, right].filter(Boolean).join("/"));
}

function collapseProjectPath(value: string): string {
  const result: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}
