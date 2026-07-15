import cytoscape, { type Core, type ElementDefinition, type StylesheetCSS } from "cytoscape";
import { ArrowLeft, Focus, List, Network, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceDetail, WorkspaceFile } from "../types";
import type { InspectTarget, ResolvedDependency } from "../utils/projectNavigation";
import { normalizeProjectPath, projectBasename, topLevelArea } from "../utils/projectNavigation";
import { AccessibleListbox } from "./AccessibleListbox";

type GraphLevel = { mode: "overview" } | { mode: "directory"; directory: string };
type GraphPhase = "preparing" | "layout" | "ready" | "empty" | "error";

type GraphModel = {
  elements: ElementDefinition[];
  fileCount: number;
  totalFileCount: number;
  connectedFileCount: number;
  isolatedFileCount: number;
  edgeCount: number;
  dense: boolean;
};

export function ProjectDependencyGraph({
  workspace,
  dependencies,
  selectedPath,
  onInspect,
  onClose
}: {
  workspace: WorkspaceDetail;
  dependencies: ResolvedDependency[];
  selectedPath?: string;
  onInspect: (target: InspectTarget) => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Core | null>(null);
  const [level, setLevel] = useState<GraphLevel>({ mode: "overview" });
  const [phase, setPhase] = useState<GraphPhase>("preparing");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [showIsolated, setShowIsolated] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => document.documentElement.dataset.theme === "light" ? "light" : "dark");

  const internalDependencies = useMemo(
    () => dependencies.filter((item) => item.sourceFile && item.targetFile),
    [dependencies]
  );
  const languages = useMemo(
    () => [...new Set(workspace.files.map((file) => file.language || "文本"))].sort(),
    [workspace.files]
  );
  const model = useMemo(
    () => level.mode === "overview"
      ? buildDirectoryOverview(workspace, internalDependencies)
      : buildDirectoryFocus(workspace, internalDependencies, level.directory, showIsolated),
    [internalDependencies, level, showIsolated, workspace]
  );
  const quickItems = useMemo(() => {
    if (level.mode === "overview") {
      const counts = new Map<string, number>();
      for (const file of workspace.files) {
        const directory = topLevelArea(file.path);
        counts.set(directory, (counts.get(directory) || 0) + 1);
      }
      return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([label, count]) => ({ label, detail: `${count} 文件`, directory: label }));
    }
    return workspace.files
      .filter((file) => topLevelArea(file.path) === level.directory)
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => ({ label: projectBasename(file.path), detail: file.language || "文本", path: file.path }));
  }, [level, workspace.files]);

  useEffect(() => {
    setLevel({ mode: "overview" });
    setQuery("");
    setLanguage("all");
    setShowIsolated(false);
  }, [workspace.summary.id]);

  useEffect(() => {
    setQuery("");
    setLanguage("all");
    setShowIsolated(false);
  }, [level.mode === "directory" ? level.directory : "overview"]);

  useEffect(() => {
    if (!selectedPath) return;
    const file = workspace.files.find((item) => normalizeProjectPath(item.path) === normalizeProjectPath(selectedPath));
    if (file) setLevel({ mode: "directory", directory: topLevelArea(file.path) });
  }, [selectedPath, workspace.files]);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let graph: Core | null = null;
    let cancelled = false;
    let sizeFrame = 0;
    let layoutFrame = 0;
    let sizeAttempts = 0;
    setPhase(model.elements.length ? "preparing" : "empty");

    const createGraph = () => {
      if (cancelled) return;
      if ((host.clientWidth < 40 || host.clientHeight < 40) && sizeAttempts < 24) {
        sizeAttempts += 1;
        sizeFrame = window.requestAnimationFrame(createGraph);
        return;
      }
      if (host.clientWidth < 40 || host.clientHeight < 40) {
        setPhase("error");
        return;
      }

      setPhase("layout");
      layoutFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          graph = cytoscape({
            container: host,
            elements: model.elements,
            minZoom: 0.24,
            maxZoom: 2.6,
            style: graphStyles(theme, model.dense),
            layout: { name: "preset" }
          });
          graphRef.current = graph;
          bindGraphInteractions(graph, level, onInspect, setLevel);

          const layout = level.mode === "overview"
            ? graph.layout({ name: "concentric", animate: false, fit: false, padding: 44, minNodeSpacing: 56, concentric: () => 1, levelWidth: () => 1 })
            : model.dense
              ? graph.layout({
                  name: "grid",
                  animate: false,
                  fit: false,
                  padding: 64,
                  avoidOverlap: true,
                  avoidOverlapPadding: 34,
                  condense: false,
                  cols: denseGridColumns(model.fileCount, host.clientWidth, host.clientHeight)
                })
              : graph.layout({ name: "breadthfirst", animate: false, fit: false, padding: 58, directed: true, circle: false, grid: true, spacingFactor: 1.82 });

          graph.one("layoutstop", () => {
            if (cancelled || !graph) return;
            window.requestAnimationFrame(() => {
              if (cancelled || !graph) return;
              graph.resize();
              applyGraphFilter(graph, query, language, level.mode);
              fitVisible(graph);
              setPhase(graph.nodes().filter((node) => node.visible()).length ? "ready" : "empty");
            });
          });
          layout.run();
        } catch {
          if (!cancelled) setPhase("error");
        }
      });
    };

    sizeFrame = window.requestAnimationFrame(createGraph);
    const resizeObserver = new ResizeObserver(() => {
      if (!graph || cancelled) return;
      window.requestAnimationFrame(() => {
        if (!graph || cancelled) return;
        graph.resize();
        fitVisible(graph);
      });
    });
    resizeObserver.observe(host);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(sizeFrame);
      window.cancelAnimationFrame(layoutFrame);
      resizeObserver.disconnect();
      graph?.destroy();
      if (graphRef.current === graph) graphRef.current = null;
    };
  }, [level, model, onInspect, theme]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || phase === "preparing" || phase === "layout" || phase === "error") return;
    applyGraphFilter(graph, query, language, level.mode);
    fitVisible(graph);
    const nextPhase = graph.nodes().filter((node) => node.visible()).length ? "ready" : "empty";
    if (nextPhase !== phase) setPhase(nextPhase);
  }, [language, level.mode, phase, query]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.nodes().removeClass("is-selected");
    if (!selectedPath) return;
    const node = graph.getElementById(fileNodeId(selectedPath));
    if (node.nonempty()) {
      node.addClass("is-selected");
      graph.animate({ center: { eles: node }, duration: 140 });
    }
  }, [phase, selectedPath]);

  function resetGraph() {
    setQuery("");
    setLanguage("all");
    if (level.mode === "directory") setLevel({ mode: "overview" });
    else window.requestAnimationFrame(() => graphRef.current && fitVisible(graphRef.current));
  }

  const title = level.mode === "overview" ? "目录依赖概览" : level.directory;
  const subtitle = level.mode === "overview"
    ? `${workspace.files.length} 个文件 · ${internalDependencies.length} 条内部依赖`
    : `${model.connectedFileCount} 个关联文件 · ${model.isolatedFileCount} 个无关联文件 · ${model.edgeCount} 条依赖`;

  return (
    <section
      className={`dependency-graph-v1420 dependency-graph-v1420a is-${level.mode}`}
      data-graph-level={level.mode}
      data-graph-phase={phase}
      data-graph-density={model.dense ? "dense" : "normal"}
    >
      <header>
        <div>
          {level.mode === "directory"
            ? <button aria-label="返回目录概览" className="dependency-graph-back-v1420a" onClick={() => setLevel({ mode: "overview" })} type="button"><ArrowLeft size={15}/></button>
            : (
              <Network size={16} />
            )}
          <div><strong>{title}</strong><span>{subtitle}</span></div>
        </div>
        <nav>
          <button className="dependency-graph-list-v1420a" onClick={onClose} title="返回依赖列表" type="button"><List size={14}/>列表</button>
          <button onClick={() => graphRef.current && fitVisible(graphRef.current)} title="适应视口" type="button"><Focus size={14}/>适应</button>
          <button onClick={resetGraph} title="重置图谱" type="button"><RotateCcw size={14}/>重置</button>
        </nav>
      </header>
      {level.mode === "directory" && (
        <div className="dependency-graph-tools-v1420">
          <label><Search size={14}/><input onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            if (value.trim() && model.isolatedFileCount > 0) setShowIsolated(true);
          }} placeholder="搜索当前目录文件" value={query}/></label>
          <AccessibleListbox
            compact
            label="语言"
            onChange={setLanguage}
            options={[{ value: "all", label: "全部语言" }, ...languages.map((value) => ({ value, label: value }))]}
            value={language}
          />
          <label className="dependency-graph-isolated-v1420a" title="无依赖关系的文件默认不进入图谱，仍可在依赖列表和文件索引中查看">
            <input
              checked={showIsolated}
              disabled={model.isolatedFileCount === 0 && !showIsolated}
              onChange={(event) => setShowIsolated(event.target.checked)}
              type="checkbox"
            />
            <span>显示无关联文件</span>
            <strong>{model.isolatedFileCount}</strong>
          </label>
        </div>
      )}
      <nav aria-label={level.mode === "overview" ? "目录快速定位" : "文件快速定位"} className="dependency-graph-quicknav-v1420a">
        <span>{level.mode === "overview" ? "目录" : "文件"}</span>
        <div>
          {quickItems.slice(0, 16).map((item) => {
            const active = "path" in item && selectedPath
              ? normalizeProjectPath(item.path) === normalizeProjectPath(selectedPath)
              : false;
            return (
              <button
                className={active ? "is-active" : ""}
                key={("path" in item ? item.path : item.directory) || item.label}
                onClick={() => {
                  if ("path" in item) onInspect({ path: item.path, title: item.label, source: "graph" });
                  else setLevel({ mode: "directory", directory: item.directory });
                }}
                title={`${item.label} · ${item.detail}`}
                type="button"
              >
                <strong>{item.label}</strong><small>{item.detail}</small>
              </button>
            );
          })}
          {quickItems.length > 16 ? <em>另有 {quickItems.length - 16} 项，可使用搜索或依赖列表查看</em> : null}
        </div>
      </nav>
      <div className="dependency-graph-canvas-wrap-v1420a">
        <div aria-label="项目文件依赖关系图" className="dependency-graph-canvas-v1420" ref={hostRef} role="application"/>
        {phase !== "ready" ? (
          <GraphStatus level={level} phase={phase} onBack={() => setLevel({ mode: "overview" })} />
        ) : null}
      </div>
      <footer>
        <span><i className="file"/>{level.mode === "overview" ? "一级目录" : "当前目录文件"}</span>
        {level.mode === "directory" && <span><i className="boundary"/>跨目录边界</span>}
        <span>{level.mode === "overview" ? "点击目录查看文件关系" : "点击文件查看源码，点击边界切换目录"}</span>
      </footer>
    </section>
  );
}

function GraphStatus({ level, phase, onBack }: { level: GraphLevel; phase: GraphPhase; onBack: () => void }) {
  const content = phase === "preparing"
    ? ["正在准备关系", "整理当前层级的内部依赖"]
    : phase === "layout"
      ? ["正在布局", "建立稳定的文件关系视图"]
      : phase === "error"
        ? ["图谱暂时无法显示", "可以返回列表继续查看全部依赖"]
        : [level.mode === "overview" ? "没有可展示的目录" : "当前目录没有匹配的文件", "调整筛选条件或返回目录概览"];
  return <div aria-live="polite" className={`dependency-graph-state-v1420a is-${phase}`} role="status"><Network size={22}/><strong>{content[0]}</strong><span>{content[1]}</span>{level.mode === "directory" && (phase === "empty" || phase === "error") ? <button onClick={onBack} type="button"><ArrowLeft size={14}/>返回目录概览</button> : null}</div>;
}

function bindGraphInteractions(
  graph: Core,
  level: GraphLevel,
  onInspect: (target: InspectTarget) => void,
  setLevel: (value: GraphLevel) => void
) {
  graph.on("mouseover", "node", (event) => event.target.addClass("is-hovered"));
  graph.on("mouseout", "node", (event) => event.target.removeClass("is-hovered"));
  graph.on("tap", "node", (event) => {
    const node = event.target;
    const path = node.data("path") as string | undefined;
    if (path) {
      onInspect({ path, title: projectBasename(path), source: "graph" });
      return;
    }
    const directory = node.data("directory") as string | undefined;
    if (directory) setLevel({ mode: "directory", directory });
  });
  graph.on("tap", "edge", (event) => {
    if (level.mode !== "directory") return;
    const edge = event.target;
    const sourcePath = edge.data("sourcePath") as string | undefined;
    if (!sourcePath) return;
    onInspect({
      path: sourcePath,
      line: Number(edge.data("line")) || 1,
      title: `依赖 ${edge.data("targetLabel") as string}`,
      context: edge.data("targetPath") ? `内部依赖：${edge.data("targetPath") as string}` : "跨目录依赖",
      source: "dependency"
    });
  });
}

function buildDirectoryOverview(workspace: WorkspaceDetail, dependencies: ResolvedDependency[]): GraphModel {
  const directoryFiles = new Map<string, number>();
  for (const file of workspace.files) {
    const directory = topLevelArea(file.path);
    directoryFiles.set(directory, (directoryFiles.get(directory) || 0) + 1);
  }
  const edgeGroups = new Map<string, { source: string; target: string; count: number }>();
  for (const dependency of dependencies) {
    if (!dependency.sourceFile || !dependency.targetFile) continue;
    const source = topLevelArea(dependency.sourceFile.path);
    const target = topLevelArea(dependency.targetFile.path);
    if (source === target) continue;
    const key = `${source}|${target}`;
    const current = edgeGroups.get(key);
    if (current) current.count += 1;
    else edgeGroups.set(key, { source, target, count: 1 });
  }

  const elements: ElementDefinition[] = [...directoryFiles.entries()].map(([directory, fileCount]) => ({
    data: { id: directoryNodeId(directory), label: directory, directory, kind: "directory", fileCount }
  }));
  for (const edge of edgeGroups.values()) {
    elements.push({ data: {
      id: `directory-edge:${hashString(`${edge.source}|${edge.target}`)}`,
      source: directoryNodeId(edge.source),
      target: directoryNodeId(edge.target),
      count: edge.count,
      edgeLabel: edge.count > 1 ? String(edge.count) : "",
      kind: "directory-edge"
    }});
  }
  return {
    elements,
    fileCount: directoryFiles.size,
    totalFileCount: workspace.files.length,
    connectedFileCount: workspace.files.length,
    isolatedFileCount: 0,
    edgeCount: edgeGroups.size,
    dense: directoryFiles.size > 24
  };
}

function buildDirectoryFocus(workspace: WorkspaceDetail, dependencies: ResolvedDependency[], directory: string, showIsolated: boolean): GraphModel {
  const files = workspace.files.filter((file) => topLevelArea(file.path) === directory);
  const filePaths = new Set(files.map((file) => normalizeProjectPath(file.path)));
  const connectedPaths = new Set<string>();
  const edgeElements: ElementDefinition[] = [];
  const boundaryDirectories = new Set<string>();
  const edgeKeys = new Set<string>();
  let edgeCount = 0;

  for (const dependency of dependencies) {
    if (!dependency.sourceFile || !dependency.targetFile) continue;
    const sourceInside = filePaths.has(normalizeProjectPath(dependency.sourceFile.path));
    const targetInside = filePaths.has(normalizeProjectPath(dependency.targetFile.path));
    if (!sourceInside && !targetInside) continue;

    if (sourceInside) connectedPaths.add(normalizeProjectPath(dependency.sourceFile.path));
    if (targetInside) connectedPaths.add(normalizeProjectPath(dependency.targetFile.path));

    const sourceDirectory = topLevelArea(dependency.sourceFile.path);
    const targetDirectory = topLevelArea(dependency.targetFile.path);
    if (!sourceInside) boundaryDirectories.add(sourceDirectory);
    if (!targetInside) boundaryDirectories.add(targetDirectory);

    const sourceId = sourceInside ? fileNodeId(dependency.sourceFile.path) : boundaryNodeId(sourceDirectory);
    const targetId = targetInside ? fileNodeId(dependency.targetFile.path) : boundaryNodeId(targetDirectory);
    const key = `${sourceId}|${targetId}|${dependency.kind}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edgeCount += 1;
    edgeElements.push({ data: {
      id: `edge:${hashString(key)}`,
      source: sourceId,
      target: targetId,
      sourcePath: dependency.sourceFile.path,
      targetPath: dependency.targetFile.path,
      targetLabel: dependency.target,
      line: dependency.line,
      kind: "file-edge"
    }});
  }

  const visibleFiles = showIsolated
    ? files
    : files.filter((file) => connectedPaths.has(normalizeProjectPath(file.path)));
  const elements: ElementDefinition[] = visibleFiles.map((file) => fileElement(
    file,
    !connectedPaths.has(normalizeProjectPath(file.path))
  ));
  elements.push(...edgeElements);

  for (const boundary of boundaryDirectories) {
    elements.push({ data: {
      id: boundaryNodeId(boundary),
      label: boundary,
      directory: boundary,
      kind: "boundary"
    }});
  }
  const isolatedFileCount = Math.max(0, files.length - connectedPaths.size);
  return {
    elements,
    fileCount: visibleFiles.length,
    totalFileCount: files.length,
    connectedFileCount: connectedPaths.size,
    isolatedFileCount,
    edgeCount,
    dense: visibleFiles.length + boundaryDirectories.size > 24
  };
}

function fileElement(file: WorkspaceFile, isolated = false): ElementDefinition {
  return { data: {
    id: fileNodeId(file.path),
    label: projectBasename(file.path),
    path: file.path,
    language: file.language || "文本",
    kind: "file",
    isolated,
    risk: file.metrics.risk_count
  }};
}

function applyGraphFilter(graph: Core, query: string, language: string, mode: GraphLevel["mode"]) {
  const needle = query.trim().toLocaleLowerCase();
  graph.batch(() => {
    graph.nodes().forEach((node) => {
      if (mode === "overview" || node.data("kind") === "boundary") {
        node.style("display", "element");
        return;
      }
      const matches = (language === "all" || node.data("language") === language)
        && (!needle || `${node.data("label")} ${node.data("path")}`.toLocaleLowerCase().includes(needle));
      node.style("display", matches ? "element" : "none");
      if (needle && matches) node.addClass("is-search-match");
      else node.removeClass("is-search-match");
    });
    graph.edges().forEach((edge) => {
      edge.style("display", edge.source().visible() && edge.target().visible() ? "element" : "none");
    });
    if (mode === "directory") {
      graph.nodes("[kind = 'boundary']").forEach((node) => {
        node.style("display", node.connectedEdges().filter(":visible").length ? "element" : "none");
      });
    }
  });
}

function fitVisible(graph: Core) {
  const visible = graph.elements().filter((element) => element.visible());
  if (visible.length) graph.fit(visible, 42);
}

function graphStyles(theme: "dark" | "light", dense: boolean): StylesheetCSS[] {
  const palette = theme === "light" ? {
    node: "#dceaf0", nodeBorder: "#78909c", text: "#24333d", directory: "#d6e9f0",
    boundary: "#eee5cc", boundaryBorder: "#a38e57", risk: "#c86f52", selected: "#2f9fc2",
    selectedBorder: "#0e5770", edge: "#9eb4bf", arrow: "#78929f", edgeSelected: "#207f9f"
  } : {
    node: "#1c303b", nodeBorder: "#6a8794", text: "#dce8ed", directory: "#18313b",
    boundary: "#4e4736", boundaryBorder: "#9a8d66", risk: "#d58c72", selected: "#5abbd7",
    selectedBorder: "#d5f5ff", edge: "#3c5865", arrow: "#587684", edgeSelected: "#79cde5"
  };
  return [
    { selector: "node", css: { "background-color": palette.node, "border-color": palette.nodeBorder, "border-width": 1, color: palette.text, label: dense ? "" : "data(label)", "font-size": 10, "text-valign": "bottom", "text-margin-y": 7, "text-wrap": "ellipsis", "text-max-width": "112px", width: 20, height: 20 } },
    { selector: "node[kind = 'directory']", css: { "background-color": palette.directory, "border-color": palette.nodeBorder, "border-width": 1.5, "font-size": 11, "font-weight": "bold", "text-halign": "center", "text-valign": "center", "text-margin-y": 0, "text-wrap": "ellipsis", "text-max-width": "74px", width: 82, height: 42, shape: "round-rectangle" } },
    { selector: "node[kind = 'boundary']", css: { "background-color": palette.boundary, "border-color": palette.boundaryBorder, "border-width": 1.5, "font-size": 9, label: "data(label)", "text-valign": "bottom", shape: "diamond", width: 28, height: 28 } },
    { selector: "node[isolated]", css: { opacity: 0.42, "border-style": "dashed" } },
    { selector: "node.is-hovered, node.is-selected, node.is-search-match", css: { label: "data(label)", "text-background-opacity": 0.86, "text-background-color": theme === "light" ? "#f5f8fa" : "#0b1116", "text-background-padding": "3px", "z-index": 22 } },
    { selector: "node[risk > 0]", css: { "border-color": palette.risk, "border-width": 2 } },
    { selector: "node.is-selected", css: { "background-color": palette.selected, "border-color": palette.selectedBorder, "border-width": 2, width: 27, height: 27, "z-index": 20 } },
    { selector: "edge", css: { width: 1.2, "line-color": palette.edge, "target-arrow-color": palette.arrow, "target-arrow-shape": "triangle", "curve-style": "bezier", opacity: 0.68, "arrow-scale": 0.72 } },
    { selector: "edge[edgeLabel]", css: { color: palette.text, label: "data(edgeLabel)", "font-size": 8, "text-background-opacity": 0.7, "text-background-color": theme === "light" ? "#f5f8fa" : "#0b1116", "text-background-padding": "2px" } },
    { selector: "edge[count >= 2]", css: { width: "mapData(count, 2, 30, 1.5, 5)" } },
    { selector: "edge:selected", css: { width: 2.2, "line-color": palette.edgeSelected, "target-arrow-color": palette.edgeSelected, opacity: 1 } }
  ];
}

function denseGridColumns(nodeCount: number, width: number, height: number): number {
  if (nodeCount <= 1) return 1;
  const aspect = Math.max(0.7, Math.min(2.8, width / Math.max(height, 1)));
  return Math.max(2, Math.ceil(Math.sqrt(nodeCount * aspect)));
}

function directoryNodeId(directory: string): string {
  return `directory:${hashString(directory.toLocaleLowerCase())}`;
}

function boundaryNodeId(directory: string): string {
  return `boundary:${hashString(directory.toLocaleLowerCase())}`;
}

function fileNodeId(path: string): string {
  return `file:${hashString(normalizeProjectPath(path))}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
