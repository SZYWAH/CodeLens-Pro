import cytoscape, { type Core, type StylesheetCSS } from "cytoscape";
import { ArrowLeft, Box, Crosshair, Focus, List, Maximize2, Minimize2, Network, RotateCcw, Search, Workflow } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { isPreviewMode, readPreviewScenario } from "../previewScenario";
import type { WorkspaceDetail } from "../types";
import type { InspectTarget, ResolvedDependency } from "../utils/projectNavigation";
import { normalizeProjectPath, projectBasename, topLevelArea } from "../utils/projectNavigation";
import { AccessibleListbox } from "./AccessibleListbox";
import type { DependencyGraph3DHandle } from "./ProjectDependencyGraph3D";
import {
  buildDependencyGraphModel,
  buildDependencySpatialModel,
  fileNodeId,
  filterDependencyGraphModel,
  toCytoscapeElements,
  type DependencyGraphLevel,
  type DependencyGraphNode,
  type IdleEdgeMode
} from "./projectDependencyGraphModel";

type GraphPhase = "preparing" | "layout" | "ready" | "empty" | "error";
type GraphPresentation = "2d" | "3d";

function initialGraphPresentation(): GraphPresentation {
  return isPreviewMode() && readPreviewScenario().map === "dependencies-3d" ? "3d" : "2d";
}

const ProjectDependencyGraph3D = lazy(() => import("./ProjectDependencyGraph3D").then((module) => ({ default: module.ProjectDependencyGraph3D })));

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
  const spaceRef = useRef<DependencyGraph3DHandle | null>(null);
  const immersiveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const immersiveExitRef = useRef<HTMLButtonElement | null>(null);
  const wasImmersiveRef = useRef(false);
  const [level, setLevel] = useState<DependencyGraphLevel>({ mode: "overview" });
  const [phase, setPhase] = useState<GraphPhase>("preparing");
  const initialPresentation = useMemo(initialGraphPresentation, []);
  const [presentation, setPresentation] = useState<GraphPresentation>(initialPresentation);
  const [spaceVisited, setSpaceVisited] = useState(initialPresentation === "3d");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [showIsolated, setShowIsolated] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [showSecondHop, setShowSecondHop] = useState(false);
  const [idleEdgeMode, setIdleEdgeMode] = useState<IdleEdgeMode>("backbone");
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [isImmersive, setIsImmersive] = useState(false);
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
    () => buildDependencyGraphModel(workspace, internalDependencies, level, showIsolated),
    [internalDependencies, level, showIsolated, workspace]
  );
  const visibleModel = useMemo(
    () => filterDependencyGraphModel(model, query, language, level.mode),
    [language, level.mode, model, query]
  );
  const spatialLayoutModel = useMemo(
    () => buildDependencySpatialModel(workspace, internalDependencies, level, true),
    [internalDependencies, level, workspace]
  );
  const spatialVisibleBase = useMemo(
    () => buildDependencySpatialModel(workspace, internalDependencies, level, showIsolated),
    [internalDependencies, level, showIsolated, workspace]
  );
  const spatialVisibleModel = useMemo(
    () => filterDependencyGraphModel(spatialVisibleBase, query, language, level.mode),
    [language, level.mode, query, spatialVisibleBase]
  );
  const cytoscapeElements = useMemo(() => toCytoscapeElements(visibleModel), [visibleModel]);
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
    setPresentation(initialPresentation);
    setSpaceVisited(initialPresentation === "3d");
    setQuery("");
    setLanguage("all");
    setShowIsolated(false);
    setFocusedNodeId(null);
    setShowSecondHop(false);
    setIdleEdgeMode("backbone");
    setFallbackNotice(null);
    setIsImmersive(false);
  }, [initialPresentation, workspace.summary.id]);

  useEffect(() => {
    if (!isImmersive) return;
    document.body.classList.add("dependency-graph-immersive-open");
    const focusFrame = window.requestAnimationFrame(() => immersiveExitRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.classList.remove("dependency-graph-immersive-open");
    };
  }, [isImmersive]);

  useEffect(() => {
    if (isImmersive) {
      wasImmersiveRef.current = true;
      return;
    }
    if (!wasImmersiveRef.current) return;
    wasImmersiveRef.current = false;
    const focusFrame = window.requestAnimationFrame(() => immersiveTriggerRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [isImmersive]);

  useEffect(() => {
    if (!isImmersive) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (selectedPath) return;
      event.preventDefault();
      if (focusedNodeId) {
        setFocusedNodeId(null);
        return;
      }
      setIsImmersive(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [focusedNodeId, isImmersive, selectedPath]);

  useEffect(() => {
    setQuery("");
    setLanguage("all");
    setShowIsolated(false);
  }, [level.mode === "directory" ? level.directory : "overview"]);

  useEffect(() => {
    if (!selectedPath) return;
    const file = workspace.files.find((item) => normalizeProjectPath(item.path) === normalizeProjectPath(selectedPath));
    if (file) {
      setLevel({ mode: "directory", directory: topLevelArea(file.path) });
      setFocusedNodeId(fileNodeId(file.path));
    }
  }, [selectedPath, workspace.files]);

  useEffect(() => {
    // Keep a spatial file focus while temporarily visiting the compact 2D
    // overview or hiding it with a visibility filter. Only a real level/model
    // change should invalidate the selection.
    const availableNodes = spatialLayoutModel.nodes;
    if (focusedNodeId && !availableNodes.some((node) => node.id === focusedNodeId)) setFocusedNodeId(null);
  }, [focusedNodeId, spatialLayoutModel.nodes]);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || presentation !== "2d") return;

    let graph: Core | null = null;
    let cancelled = false;
    let sizeFrame = 0;
    let layoutFrame = 0;
    let sizeAttempts = 0;
    setPhase(visibleModel.nodes.length ? "preparing" : "empty");

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
            elements: cytoscapeElements,
            minZoom: 0.24,
            maxZoom: 2.6,
            style: graphStyles(theme, visibleModel.dense),
            layout: { name: "preset" }
          });
          graphRef.current = graph;
          bindGraphInteractions(graph, level, onInspect, setLevel, setFocusedNodeId);

          const layout = level.mode === "overview"
            ? graph.layout({ name: "concentric", animate: false, fit: false, padding: 44, minNodeSpacing: 56, concentric: () => 1, levelWidth: () => 1 })
            : visibleModel.dense
              ? graph.layout({
                  name: "grid",
                  animate: false,
                  fit: false,
                  padding: 64,
                  avoidOverlap: true,
                  avoidOverlapPadding: 34,
                  condense: false,
                  cols: denseGridColumns(visibleModel.fileCount, host.clientWidth, host.clientHeight)
                })
              : graph.layout({ name: "breadthfirst", animate: false, fit: false, padding: 58, directed: true, circle: false, grid: true, spacingFactor: 1.82 });

          graph.one("layoutstop", () => {
            if (cancelled || !graph) return;
            window.requestAnimationFrame(() => {
              if (cancelled || !graph) return;
              graph.resize();
              fitVisible(graph);
              setPhase(graph.nodes().length ? "ready" : "empty");
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
  }, [cytoscapeElements, level, onInspect, presentation, theme, visibleModel.dense, visibleModel.fileCount, visibleModel.nodes.length]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.nodes().removeClass("is-selected");
    const activeNodeId = focusedNodeId || (selectedPath ? fileNodeId(selectedPath) : null);
    if (!activeNodeId) return;
    const node = graph.getElementById(activeNodeId);
    if (node.nonempty()) {
      node.addClass("is-selected");
      graph.animate({ center: { eles: node }, duration: 140 });
    }
  }, [focusedNodeId, phase, selectedPath]);

  function resetGraph() {
    if (presentation === "3d") {
      spaceRef.current?.resetView();
      return;
    }
    setQuery("");
    setLanguage("all");
    setFocusedNodeId(null);
    setShowSecondHop(false);
    if (level.mode === "directory") setLevel({ mode: "overview" });
    else window.requestAnimationFrame(() => graphRef.current && fitVisible(graphRef.current));
  }

  function changePresentation(next: GraphPresentation) {
    if (next === "3d") {
      setSpaceVisited(true);
      setFallbackNotice(null);
    }
    setPresentation(next);
  }

  function fitCurrentPresentation() {
    if (presentation === "3d") spaceRef.current?.fitContent();
    else if (graphRef.current) fitVisible(graphRef.current);
  }

  function inspectSpaceNode(node: DependencyGraphNode) {
    if (node.path) {
      onInspect({ path: node.path, title: projectBasename(node.path), source: "graph" });
      return;
    }
    if (node.directory) setLevel({ mode: "directory", directory: node.directory });
  }

  function returnToOverview() {
    setFocusedNodeId(null);
    setLevel({ mode: "overview" });
  }

  const title = level.mode === "overview"
    ? presentation === "3d" ? "项目依赖星群" : "目录依赖概览"
    : level.directory;
  const subtitle = level.mode === "overview"
    ? `${workspace.files.length} 个文件 · ${internalDependencies.length} 条内部依赖`
    : `${model.connectedFileCount} 个关联文件 · ${model.isolatedFileCount} 个无关联文件 · ${model.edgeCount} 条依赖`;
  const focusedNodeSource = presentation === "3d" ? spatialLayoutModel : model;
  const focusedNode = focusedNodeId ? focusedNodeSource.nodes.find((node) => node.id === focusedNodeId) || null : null;
  const activePath = focusedNode?.path || selectedPath;

  return (
    <section
      className={`dependency-graph-v1420 dependency-graph-v1420a is-${level.mode}${isImmersive ? " is-immersive" : ""}`}
      data-graph-level={level.mode}
      data-graph-phase={presentation === "2d" ? phase : spatialVisibleModel.nodes.length ? "ready" : "empty"}
      data-graph-density={(presentation === "3d" ? spatialVisibleModel : model).dense ? "dense" : "normal"}
      data-graph-immersive={isImmersive ? "true" : "false"}
      data-graph-presentation={presentation}
    >
      <div aria-label="全屏图谱控制栏" className="dependency-graph-immersive-toolbar-v2">
        <div className="dependency-graph-immersive-context-v2">
          {level.mode === "directory" ? (
            <button aria-label="返回目录概览" onClick={returnToOverview} title="返回目录概览" type="button">
              <ArrowLeft size={15}/>
            </button>
          ) : <Network size={16}/>}
          <div><strong>{title}</strong><span>{subtitle}</span></div>
        </div>
        <nav>
          <GraphViewControls
            focusedNodeId={focusedNodeId}
            fullscreenButtonRef={immersiveExitRef}
            idleEdgeMode={idleEdgeMode}
            immersive
            level={level}
            onCenter={() => spaceRef.current?.centerSelection()}
            onClose={onClose}
            onFit={fitCurrentPresentation}
            onReset={resetGraph}
            onToggleFullscreen={() => setIsImmersive(false)}
            onToggleIdleEdgeMode={() => setIdleEdgeMode((current) => current === "backbone" ? "all" : "backbone")}
            onToggleSecondHop={() => setShowSecondHop((current) => !current)}
            onPresentation={changePresentation}
            presentation={presentation}
            showSecondHop={showSecondHop}
          />
        </nav>
      </div>
      <header>
        <div>
          {level.mode === "directory"
            ? <button aria-label="返回目录概览" className="dependency-graph-back-v1420a" onClick={returnToOverview} type="button"><ArrowLeft size={15}/></button>
            : (
              <Network size={16} />
            )}
          <div><strong>{title}</strong><span>{subtitle}</span></div>
        </div>
        <nav>
          <GraphViewControls
            focusedNodeId={focusedNodeId}
            fullscreenButtonRef={immersiveTriggerRef}
            idleEdgeMode={idleEdgeMode}
            level={level}
            onCenter={() => spaceRef.current?.centerSelection()}
            onClose={onClose}
            onFit={fitCurrentPresentation}
            onReset={resetGraph}
            onToggleFullscreen={() => setIsImmersive(true)}
            onToggleIdleEdgeMode={() => setIdleEdgeMode((current) => current === "backbone" ? "all" : "backbone")}
            onToggleSecondHop={() => setShowSecondHop((current) => !current)}
            onPresentation={changePresentation}
            presentation={presentation}
            showSecondHop={showSecondHop}
          />
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
            const active = "path" in item && activePath
              ? normalizeProjectPath(item.path) === normalizeProjectPath(activePath)
              : false;
            return (
              <button
                className={active ? "is-active" : ""}
                key={("path" in item ? item.path : item.directory) || item.label}
                onClick={() => {
                  if ("path" in item) {
                    setFocusedNodeId(fileNodeId(item.path));
                    if (presentation === "2d") onInspect({ path: item.path, title: item.label, source: "graph" });
                  } else {
                    setFocusedNodeId(null);
                    setLevel({ mode: "directory", directory: item.directory });
                  }
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
        {presentation === "2d" ? (
          <>
            <div aria-label="项目文件依赖关系俯视图" className="dependency-graph-canvas-v1420" ref={hostRef} role="application"/>
            {phase !== "ready" ? (
              <GraphStatus level={level} phase={phase} onBack={() => setLevel({ mode: "overview" })} />
            ) : null}
          </>
        ) : null}
        {spaceVisited ? (
          <div hidden={presentation !== "3d"} style={{ position: "absolute", inset: 0 }}>
            <Suspense fallback={<div className="dependency-space-v1-loading"><Network size={22}/><strong>正在建立三维依赖空间</strong></div>}>
              <ProjectDependencyGraph3D
                ref={spaceRef}
                cacheScope={workspace.summary.id}
                focusedNodeId={focusedNodeId}
                idleEdgeMode={idleEdgeMode}
                level={level}
                model={spatialLayoutModel}
                onFallback={(message) => {
                  setFallbackNotice(message);
                  setPresentation("2d");
                  setSpaceVisited(false);
                }}
                onFocus={setFocusedNodeId}
                onInspect={inspectSpaceNode}
                onOpenDirectory={(directory) => {
                  setFocusedNodeId(null);
                  setLevel({ mode: "directory", directory });
                }}
                showSecondHop={showSecondHop}
                sourceInspectorOpen={Boolean(selectedPath)}
                theme={theme}
                visibleModel={spatialVisibleModel}
              />
            </Suspense>
          </div>
        ) : null}
        {fallbackNotice ? (
          <div className="dependency-graph-fallback-v1" role="alert">
            <strong>三维空间暂时不可用</strong>
            <p>{fallbackNotice}</p>
            <button onClick={() => setFallbackNotice(null)} type="button">继续使用俯视图</button>
          </div>
        ) : null}
      </div>
      <footer>
        <span><i className="file"/>{presentation === "3d" && level.mode === "overview" ? "真实文件节点" : level.mode === "overview" ? "一级目录" : "当前目录文件"}</span>
        {presentation === "3d" && level.mode === "overview" ? <span><i className="cluster"/>目录核心与空间簇</span> : null}
        {level.mode === "directory" && <span><i className="boundary"/>跨目录边界</span>}
        <span>{presentation === "3d" ? "左拖旋转 · 右拖或 Shift 平移 · 滚轮缩放 · 单击关注" : level.mode === "overview" ? "点击目录查看文件关系" : "点击文件查看源码，点击边界切换目录"}</span>
      </footer>
    </section>
  );
}

function GraphViewControls({
  focusedNodeId,
  fullscreenButtonRef,
  idleEdgeMode,
  immersive = false,
  level,
  onCenter,
  onClose,
  onFit,
  onPresentation,
  onReset,
  onToggleFullscreen,
  onToggleIdleEdgeMode,
  onToggleSecondHop,
  presentation,
  showSecondHop
}: {
  focusedNodeId: string | null;
  fullscreenButtonRef?: Ref<HTMLButtonElement>;
  idleEdgeMode: IdleEdgeMode;
  immersive?: boolean;
  level: DependencyGraphLevel;
  onCenter: () => void;
  onClose: () => void;
  onFit: () => void;
  onPresentation: (value: GraphPresentation) => void;
  onReset: () => void;
  onToggleFullscreen: () => void;
  onToggleIdleEdgeMode: () => void;
  onToggleSecondHop: () => void;
  presentation: GraphPresentation;
  showSecondHop: boolean;
}) {
  return (
    <>
      <div aria-label="图谱呈现方式" className="dependency-graph-presentation-v1" role="tablist">
        <button aria-selected={presentation === "2d"} className={presentation === "2d" ? "active" : ""} onClick={() => onPresentation("2d")} role="tab" type="button"><Workflow size={14}/>俯视</button>
        <button aria-selected={presentation === "3d"} className={presentation === "3d" ? "active" : ""} onClick={() => onPresentation("3d")} role="tab" type="button"><Box size={14}/>空间</button>
      </div>
      {!immersive ? <button className="dependency-graph-list-v1420a" onClick={onClose} title="返回依赖列表" type="button"><List size={14}/>列表</button> : null}
      {presentation === "3d" && level.mode === "directory" ? (
        <button aria-pressed={showSecondHop} className={`dependency-space-v1-secondary-hop${showSecondHop ? " is-active" : ""}`} onClick={onToggleSecondHop} title="显示或隐藏二跳关系" type="button"><Network size={14}/>二跳</button>
      ) : null}
      {presentation === "3d" && !focusedNodeId ? (
        <button
          aria-pressed={idleEdgeMode === "all"}
          className={`dependency-space-v1-edge-mode${idleEdgeMode === "all" ? " is-active" : ""}`}
          onClick={onToggleIdleEdgeMode}
          title={idleEdgeMode === "backbone" ? "显示全部真实依赖" : "返回结构骨架"}
          type="button"
        ><Workflow size={14}/>{idleEdgeMode === "backbone" ? "全量" : "骨架"}</button>
      ) : null}
      {presentation === "3d" ? <button disabled={!focusedNodeId} onClick={onCenter} title="将关注节点移到视野中心" type="button"><Crosshair size={14}/>归中</button> : null}
      <button onClick={onFit} title="适应视口" type="button"><Focus size={14}/>适应</button>
      <button onClick={onReset} title={presentation === "3d" ? "重置空间视角" : "重置图谱"} type="button"><RotateCcw size={14}/>重置</button>
      <button
        aria-label={immersive ? "退出全屏" : "全屏显示图谱"}
        aria-pressed={immersive}
        className={immersive ? "dependency-graph-immersive-exit-v2" : "dependency-graph-immersive-trigger-v2"}
        onClick={onToggleFullscreen}
        ref={fullscreenButtonRef}
        title={immersive ? "退出全屏" : "全屏显示图谱"}
        type="button"
      >
        {immersive ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
        {immersive ? "退出全屏" : "全屏"}
      </button>
    </>
  );
}

function GraphStatus({ level, phase, onBack }: { level: DependencyGraphLevel; phase: GraphPhase; onBack: () => void }) {
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
  level: DependencyGraphLevel,
  onInspect: (target: InspectTarget) => void,
  setLevel: (value: DependencyGraphLevel) => void,
  onFocus: (nodeId: string | null) => void
) {
  graph.on("mouseover", "node", (event) => event.target.addClass("is-hovered"));
  graph.on("mouseout", "node", (event) => event.target.removeClass("is-hovered"));
  graph.on("tap", "node", (event) => {
    const node = event.target;
    const path = node.data("path") as string | undefined;
    if (path) {
      onFocus(node.id());
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
