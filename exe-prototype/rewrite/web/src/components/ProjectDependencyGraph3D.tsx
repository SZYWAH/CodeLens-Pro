import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import * as THREE from "three";
import { ChevronLeft, ChevronRight, FileCode2, X } from "lucide-react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  layoutSpatialLabels,
  spatialLabelLimit
} from "./dependencyGraphLabelLayout";
import {
  layoutDependencyGraphSpatial,
  type DependencySpatialLayout,
  type DependencyGraphEdge,
  type DependencyGraphLevel,
  type DependencyGraphModel,
  type DependencyGraphNode,
  type IdleEdgeMode,
  type Position3D,
  type SpatialCluster,
  type SpatialLodLevel,
  type SpatialNodeRoleFlags
} from "./projectDependencyGraphModel";

const CLICK_MOVEMENT_THRESHOLD = 5;
const MAX_CACHED_VIEWS = 32;
const HOVER_PREVIEW_DELAY = 120;

type CachedCameraView = {
  position: [number, number, number];
  target: [number, number, number];
  near: number;
  far: number;
};

const cameraViewCache = new Map<string, CachedCameraView>();

export type DependencyGraph3DHandle = {
  fitContent: () => void;
  centerSelection: () => void;
  resetView: () => void;
};

type ProjectDependencyGraph3DProps = {
  model: DependencyGraphModel;
  visibleModel: DependencyGraphModel;
  level: DependencyGraphLevel;
  cacheScope: string;
  theme: "dark" | "light";
  focusedNodeId: string | null;
  showSecondHop: boolean;
  idleEdgeMode: IdleEdgeMode;
  sourceInspectorOpen: boolean;
  onFocus: (nodeId: string | null) => void;
  onInspect: (node: DependencyGraphNode) => void;
  onOpenDirectory: (directory: string) => void;
  onFallback: (message: string) => void;
};

type Palette = {
  edge: THREE.Color;
  current: THREE.Color;
  boundary: THREE.Color;
  directory: THREE.Color;
  incoming: THREE.Color;
  outgoing: THREE.Color;
  secondHop: THREE.Color;
  selected: THREE.Color;
  hovered: THREE.Color;
  muted: THREE.Color;
  shell: THREE.Color;
  layer: THREE.Color;
  fog: THREE.Color;
};

type ProjectedLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  focused: boolean;
  hovered: boolean;
};

type TooltipState = {
  node: DependencyGraphNode;
  x: number;
  y: number;
};

type PointerStart = {
  pointerId: number;
  x: number;
  y: number;
};

type RelationshipState = {
  oneHop: Set<string>;
  secondHop: Set<string>;
  incoming: Set<string>;
  outgoing: Set<string>;
  firstEdgeIds: Set<string>;
  secondEdgeIds: Set<string>;
};

type NodeBatch = {
  kind: DependencyGraphNode["kind"];
  active: boolean;
  mesh: THREE.InstancedMesh;
  instanceIds: string[];
};

type ClusterVisual = {
  cluster: SpatialCluster;
  fill: THREE.Mesh;
  outline: THREE.LineLoop;
};

type LayerVisual = {
  nodeIds: Set<string>;
  volumeFill: THREE.Mesh;
  volumeOutline: THREE.LineSegments;
  label: THREE.Sprite;
};

type RenderableEdge = Pick<DependencyGraphEdge, "id" | "source" | "target"> & {
  routeId?: string;
  route?: Position3D[];
  bundleId?: string;
  weight?: number;
  style: "backbone" | "all" | "first" | "second";
};

type SpatialDebugSnapshot = {
  presentation: "3d";
  graphLevel: DependencyGraphLevel["mode"];
  focusedNodeId: string | null;
  webglState: "ready" | "lost" | "disposed";
  activeRafCount: number;
  nodeCount: number;
  totalNodeCount: number;
  edgeCount: number;
  clusterCount: number;
  layerCount: number;
  layoutMs: number;
  firstFrameMs: number;
  p95FrameMs: number;
  axisExtents: [number, number, number];
  volumeRatio: number;
  canvasCount: number;
  runtimeCount: number;
  layoutBuilds: number;
  visibilityUpdates: number;
  lodLevel: SpatialLodLevel;
  idleEdgeMode: IdleEdgeMode;
  bundleCount: number;
  visibleBackboneCount: number;
  fullEdgeCount: number;
  forcedVisibleCount: number;
  relationPanelState: "hidden" | "collapsed" | "expanded" | "source-collapsed";
  fullProjectedCrossings: number;
  visibleProjectedCrossings: number;
  labelCandidateCount: number;
  displayedLabelCount: number;
  collisionHiddenLabelCount: number;
  occlusionHiddenLabelCount: number;
  layerYSpans: number[];
  nonCoplanarLayerCount: number;
  version: string;
  cameraPosition: [number, number, number];
  target: [number, number, number];
  viewport: [number, number];
};

type RelationPanelState = SpatialDebugSnapshot["relationPanelState"];

type GraphRuntime = {
  rebuildLayout: (
    model: DependencyGraphModel,
    level: DependencyGraphLevel,
    cacheScope: string,
    preparedLayout: DependencySpatialLayout,
    preparedLayoutMs: number
  ) => void;
  updateVisibility: (visibleModel: DependencyGraphModel) => void;
  updateAppearance: (options: {
    focusedNodeId: string | null;
    hoveredNodeId: string | null;
    previewNodeId: string | null;
    showSecondHop: boolean;
    idleEdgeMode: IdleEdgeMode;
    relationPanelState: RelationPanelState;
    palette: Palette;
  }) => void;
  pick: (clientX: number, clientY: number) => DependencyGraphNode | null;
  requestRender: () => void;
  fitContent: () => void;
  centerSelection: (focusedNodeId: string | null) => void;
  resetView: () => void;
  dispose: () => void;
};

export const ProjectDependencyGraph3D = forwardRef<
  DependencyGraph3DHandle,
  ProjectDependencyGraph3DProps
>(function ProjectDependencyGraph3D(
  {
    model,
    visibleModel,
    level,
    cacheScope,
    theme,
    focusedNodeId,
    showSecondHop,
    idleEdgeMode,
    sourceInspectorOpen,
    onFocus,
    onInspect,
    onOpenDirectory,
    onFallback
  },
  ref
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<GraphRuntime | null>(null);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const callbacksRef = useRef({ onFocus, onInspect, onOpenDirectory, onFallback });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [labels, setLabels] = useState<ProjectedLabel[]>([]);
  const [relationPanelExpanded, setRelationPanelExpanded] = useState(() => window.innerWidth >= 980);

  callbacksRef.current = { onFocus, onInspect, onOpenDirectory, onFallback };

  const spatialLayoutBuild = useMemo(() => {
    const startedAt = performance.now();
    const layout = layoutDependencyGraphSpatial(model, level);
    return { layout, layoutMs: performance.now() - startedAt };
  }, [level, model]);
  const spatialLayout = spatialLayoutBuild.layout;
  const nodesById = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node] as const)),
    [model.nodes]
  );
  const visibleNodeIds = useMemo(
    () => new Set(visibleModel.nodes.map((node) => node.id)),
    [visibleModel.nodes]
  );
  const focusedNode = focusedNodeId ? nodesById.get(focusedNodeId) ?? null : null;
  const palette = useMemo(() => createPalette(theme), [theme]);
  const relationPanelState: RelationPanelState = !focusedNode
    ? "hidden"
    : sourceInspectorOpen
      ? "source-collapsed"
      : relationPanelExpanded
        ? "expanded"
        : "collapsed";
  const focusedRelations = useMemo(
    () => focusedNode ? deriveRelationEntries(model, focusedNode.id, visibleNodeIds) : null,
    [focusedNode, model, visibleNodeIds]
  );
  const visibleBackboneCount = useMemo(() => {
    const visibleEdgeIds = new Set(visibleModel.edges.map((edge) => edge.id));
    return spatialLayout.bundles.filter((bundle) =>
      spatialLayout.backboneBundleIds.has(bundle.id)
      && (level.mode !== "overview" || bundle.sourceGroup !== bundle.targetGroup)
      && bundle.edgeIds.some((edgeId) => visibleEdgeIds.has(edgeId))
    ).length;
  }, [level.mode, spatialLayout, visibleModel.edges]);

  useEffect(() => {
    setHoveredNodeId((current) => current && visibleNodeIds.has(current) ? current : null);
    setPreviewNodeId((current) => current && visibleNodeIds.has(current) ? current : null);
    setTooltip((current) => current && nodesById.has(current.node.id) ? current : null);
  }, [nodesById, visibleNodeIds]);

  useEffect(() => {
    if (focusedNodeId || !hoveredNodeId) {
      setPreviewNodeId(null);
      return;
    }
    const timer = window.setTimeout(() => setPreviewNodeId(hoveredNodeId), HOVER_PREVIEW_DELAY);
    return () => window.clearTimeout(timer);
  }, [focusedNodeId, hoveredNodeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = viewportRef.current;
    if (!canvas || !host) return;

    try {
      const runtime = createGraphRuntime({
        canvas,
        host,
        setLabels,
        onFallback: (message) => callbacksRef.current.onFallback(message)
      });
      runtimeRef.current = runtime;
      return () => {
        runtimeRef.current = null;
        runtime.dispose();
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      callbacksRef.current.onFallback(`无法初始化三维图形环境：${detail}`);
    }
  }, []);

  useEffect(() => {
    runtimeRef.current?.rebuildLayout(model, level, cacheScope, spatialLayout, spatialLayoutBuild.layoutMs);
  }, [cacheScope, level, model, spatialLayout, spatialLayoutBuild.layoutMs]);

  useEffect(() => {
    runtimeRef.current?.updateVisibility(visibleModel);
  }, [visibleModel]);

  useEffect(() => {
    runtimeRef.current?.updateAppearance({
      focusedNodeId,
      hoveredNodeId,
      previewNodeId,
      showSecondHop,
      idleEdgeMode,
      relationPanelState,
      palette
    });
  }, [focusedNodeId, hoveredNodeId, idleEdgeMode, palette, previewNodeId, relationPanelState, showSecondHop]);

  useImperativeHandle(
    ref,
    () => ({
      fitContent: () => runtimeRef.current?.fitContent(),
      centerSelection: () => runtimeRef.current?.centerSelection(focusedNodeId),
      resetView: () => runtimeRef.current?.resetView()
    }),
    [focusedNodeId]
  );

  const openNode = (node: DependencyGraphNode) => {
    if (node.kind === "directory" || node.kind === "boundary") {
      const directory = node.directory ?? node.path;
      if (directory) callbacksRef.current.onOpenDirectory(directory);
      return;
    }
    callbacksRef.current.onInspect(node);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    if (event.button !== 0) return;
    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = pointerStartRef.current;
    if (
      start &&
      start.pointerId === event.pointerId &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MOVEMENT_THRESHOLD
    ) {
      setTooltip(null);
      return;
    }

    const node = runtimeRef.current?.pick(event.clientX, event.clientY) ?? null;
    const nextId = node?.id ?? null;
    setHoveredNodeId((current) => (current === nextId ? current : nextId));

    if (!node || !viewportRef.current) {
      setTooltip(null);
      return;
    }
    const bounds = viewportRef.current.getBoundingClientRect();
    setTooltip({
      node,
      x: Math.min(Math.max(event.clientX - bounds.left + 14, 8), Math.max(8, bounds.width - 292)),
      y: Math.min(Math.max(event.clientY - bounds.top + 14, 8), Math.max(8, bounds.height - 116))
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MOVEMENT_THRESHOLD) {
      return;
    }

    const node = runtimeRef.current?.pick(event.clientX, event.clientY) ?? null;
    if (node?.kind === "directory" && level.mode === "overview") {
      openNode(node);
      return;
    }
    callbacksRef.current.onFocus(node?.id ?? null);
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const node = runtimeRef.current?.pick(event.clientX, event.clientY) ?? null;
    if (node) openNode(node);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      callbacksRef.current.onFocus(null);
      return;
    }
    if (event.key !== "Enter") return;

    const node = focusedNode ?? (hoveredNodeId ? nodesById.get(hoveredNodeId) ?? null : null);
    if (!node) return;
    event.preventDefault();
    openNode(node);
  };

  return (
    <div
      className={`dependency-space-v1${focusedNode ? " has-relation-panel" : ""}${relationPanelState === "expanded" ? " is-relation-expanded" : " is-relation-collapsed"}`}
      data-edge-mode={idleEdgeMode}
    >
      <div className="dependency-space-v1__viewport" ref={viewportRef}>
        <canvas
          ref={canvasRef}
          className="dependency-space-v1__canvas"
          tabIndex={0}
          aria-label="三维依赖空间。左键拖拽旋转，右键或 Shift 加左键平移，滚轮缩放，单击节点聚焦，双击或按 Enter 打开。"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            pointerStartRef.current = null;
          }}
          onPointerLeave={() => {
            pointerStartRef.current = null;
            setHoveredNodeId(null);
            setPreviewNodeId(null);
            setTooltip(null);
          }}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
          onContextMenu={(event) => event.preventDefault()}
        />

        <div className="dependency-space-v1__labels" aria-hidden="true">
          {labels.map((label) => (
            <span
              key={label.id}
              className={`dependency-space-v1__label${label.focused ? " is-focused" : ""}${label.hovered ? " is-hovered" : ""}`}
              style={{ left: label.x, top: label.y, transform: "translate(-50%, -50%)" }}
            >
              {label.text}
            </span>
          ))}
        </div>

        {tooltip ? (
          <div className="dependency-space-v1__tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
            <strong>{displayNodeLabel(tooltip.node, model.nodes)}</strong>
            <span>{tooltip.node.path ?? tooltip.node.directory ?? tooltip.node.label}</span>
            <span>
              入度 {tooltip.node.inDegree} · 出度 {tooltip.node.outDegree}
              {tooltip.node.language ? ` · ${tooltip.node.language}` : ""}
            </span>
          </div>
        ) : null}

        <div className="dependency-space-v1__status">
          {visibleModel.nodes.length} 个可见节点 / {model.nodes.length} 个完整节点 · {focusedNodeId || previewNodeId
            ? showSecondHop && focusedNodeId ? "二跳关系" : "一跳关系"
            : idleEdgeMode === "backbone" ? `${visibleBackboneCount} 束结构骨架` : `${visibleModel.edgeCount} 条完整关系`}
        </div>

        <div className="dependency-space-v1__legend" aria-label="图例">
          <span className="dependency-space-v1__legend-item">
            <i className="dependency-space-v1__legend-dot is-current" /> 当前目录
          </span>
          <span className="dependency-space-v1__legend-item">
            <i className="dependency-space-v1__legend-dot is-boundary" /> 跨目录边界
          </span>
          {(focusedNodeId || previewNodeId) ? (
            <>
              <span className="dependency-space-v1__legend-item">
                <i className="dependency-space-v1__legend-dot is-incoming" /> 入向依赖
              </span>
              <span className="dependency-space-v1__legend-item">
                <i className="dependency-space-v1__legend-dot is-outgoing" /> 出向依赖
              </span>
            </>
          ) : null}
        </div>
      </div>

      {focusedNode && focusedRelations ? (
        <RelationInspector
          expanded={relationPanelState === "expanded"}
          focusedNode={focusedNode}
          incoming={focusedRelations.incoming}
          outgoing={focusedRelations.outgoing}
          nodeRoles={spatialLayout.nodeRoles.get(focusedNode.id)}
          onClear={() => callbacksRef.current.onFocus(null)}
          onInspect={() => openNode(focusedNode)}
          onSelect={(nodeId) => callbacksRef.current.onFocus(nodeId)}
          onToggle={() => setRelationPanelExpanded((current) => !current)}
          sourceInspectorOpen={sourceInspectorOpen}
        />
      ) : null}

      <span className="dependency-space-v1__sr" aria-live="polite">
        {focusedNode
          ? `已聚焦 ${focusedNode.label}，入度 ${focusedNode.inDegree}，出度 ${focusedNode.outDegree}`
          : previewNodeId ? "正在预览一跳关系" : "未聚焦节点"}
      </span>
    </div>
  );
});

type RelationEntry = {
  edge: DependencyGraphEdge;
  node: DependencyGraphNode;
  filteredOut: boolean;
};

function RelationInspector({
  expanded,
  focusedNode,
  incoming,
  outgoing,
  nodeRoles,
  onClear,
  onInspect,
  onSelect,
  onToggle,
  sourceInspectorOpen
}: {
  expanded: boolean;
  focusedNode: DependencyGraphNode;
  incoming: RelationEntry[];
  outgoing: RelationEntry[];
  nodeRoles?: SpatialNodeRoleFlags;
  onClear: () => void;
  onInspect: () => void;
  onSelect: (nodeId: string) => void;
  onToggle: () => void;
  sourceInspectorOpen: boolean;
}) {
  const visibleIncoming = incoming.filter((entry) => !entry.filteredOut).length;
  const visibleOutgoing = outgoing.filter((entry) => !entry.filteredOut).length;
  const roles = nodeRoles ? spatialRoleLabels(nodeRoles) : [];

  return (
    <aside
      aria-label="关系检查器"
      className={`dependency-space-v1__inspector${expanded ? " is-expanded" : " is-collapsed"}`}
      data-source-inspector-open={sourceInspectorOpen ? "true" : "false"}
    >
      <button
        aria-label={expanded ? "折叠关系检查器" : "展开关系检查器"}
        className="dependency-space-v1__inspector-toggle"
        disabled={sourceInspectorOpen}
        onClick={onToggle}
        title={sourceInspectorOpen ? "源码查看器打开时关系检查器保持折叠" : expanded ? "折叠关系检查器" : "展开关系检查器"}
        type="button"
      >
        {expanded ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}
        {!expanded ? <span>关系</span> : null}
      </button>

      {expanded ? (
        <div className="dependency-space-v1__inspector-content">
          <header>
            <div>
              <span>关系检查器</span>
              <strong>{focusedNode.label}</strong>
            </div>
            <button aria-label="清除关注" onClick={onClear} title="清除关注" type="button"><X size={15}/></button>
          </header>

          <p className="dependency-space-v1__inspector-path">{focusedNode.path ?? focusedNode.directory ?? focusedNode.label}</p>
          <div className="dependency-space-v1__inspector-meta">
            {focusedNode.language ? <span>{focusedNode.language}</span> : null}
            {roles.map((role) => <span key={role}>{role}</span>)}
          </div>
          <div className="dependency-space-v1__inspector-counts">
            <span><small>真实入度</small><strong>{focusedNode.inDegree}</strong><em>可见 {visibleIncoming}</em></span>
            <span><small>真实出度</small><strong>{focusedNode.outDegree}</strong><em>可见 {visibleOutgoing}</em></span>
          </div>
          {focusedNode.kind === "file" ? (
            <button className="dependency-space-v1__inspect-source" onClick={onInspect} type="button">
              <FileCode2 size={14}/>查看源码
            </button>
          ) : null}

          <RelationList entries={incoming} label="依赖当前文件" onSelect={onSelect}/>
          <RelationList entries={outgoing} label="当前文件依赖" onSelect={onSelect}/>
        </div>
      ) : null}
    </aside>
  );
}

function RelationList({
  entries,
  label,
  onSelect
}: {
  entries: RelationEntry[];
  label: string;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <section className="dependency-space-v1__relation-list">
      <header><strong>{label}</strong><span>{entries.length}</span></header>
      {entries.length ? (
        <div>
          {entries.map((entry) => (
            <button key={entry.edge.id} onClick={() => onSelect(entry.node.id)} type="button">
              <span>
                <strong>{entry.node.label}</strong>
                <small>{entry.node.path ?? entry.node.directory ?? entry.node.label}</small>
              </span>
              {entry.filteredOut ? <em>筛选外</em> : null}
            </button>
          ))}
        </div>
      ) : <p>无直接关系</p>}
    </section>
  );
}

function deriveRelationEntries(
  model: DependencyGraphModel,
  focusedNodeId: string,
  visibleNodeIds: Set<string>
): { incoming: RelationEntry[]; outgoing: RelationEntry[] } {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node] as const));
  const incoming: RelationEntry[] = [];
  const outgoing: RelationEntry[] = [];
  for (const edge of model.edges) {
    if (edge.target === focusedNodeId) {
      const node = nodeById.get(edge.source);
      if (node) incoming.push({ edge, node, filteredOut: !visibleNodeIds.has(node.id) });
    }
    if (edge.source === focusedNodeId) {
      const node = nodeById.get(edge.target);
      if (node) outgoing.push({ edge, node, filteredOut: !visibleNodeIds.has(node.id) });
    }
  }
  const compare = (left: RelationEntry, right: RelationEntry) =>
    Number(left.filteredOut) - Number(right.filteredOut)
    || left.node.label.localeCompare(right.node.label)
    || left.edge.id.localeCompare(right.edge.id);
  incoming.sort(compare);
  outgoing.sort(compare);
  return { incoming, outgoing };
}

function spatialRoleLabels(roles: SpatialNodeRoleFlags): string[] {
  const labels: string[] = [];
  if (roles.cycle) labels.push("循环");
  if (roles.bridge) labels.push("桥接");
  if (roles.hub) labels.push("核心");
  if (roles.leaf) labels.push("叶节点");
  if (roles.isolated) labels.push("孤立");
  return labels;
}

function createGraphRuntime({
  canvas,
  host,
  setLabels,
  onFallback
}: {
  canvas: HTMLCanvasElement;
  host: HTMLDivElement;
  setLabels: (labels: ProjectedLabel[]) => void;
  onFallback: (message: string) => void;
}): GraphRuntime {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 9000);
  camera.position.set(220, 170, 260);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minDistance = 18;
  controls.maxDistance = 9000;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

  const ambient = new THREE.HemisphereLight(0xd5e3e8, 0x111b21, 1.18);
  const keyLight = new THREE.DirectionalLight(0xf1f8fa, 1.56);
  const rimLight = new THREE.DirectionalLight(0x91b5c2, 0.92);
  keyLight.position.set(340, 460, 520);
  rimLight.position.set(-360, 80, -320);
  scene.add(ambient, keyLight, rimLight);

  const graphGroup = new THREE.Group();
  const shellGroup = new THREE.Group();
  const layerGroup = new THREE.Group();
  const edgeGroup = new THREE.Group();
  graphGroup.add(layerGroup, shellGroup, edgeGroup);
  scene.add(graphGroup);

  const raycaster = new THREE.Raycaster();
  const labelRaycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const identityQuaternion = new THREE.Quaternion();
  const scratchMatrix = new THREE.Matrix4();
  const scratchScale = new THREE.Vector3();
  const scratchPosition = new THREE.Vector3();
  const scratchDirection = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const lineMaterials = new Set<LineMaterial>();

  let disposed = false;
  let webglState: SpatialDebugSnapshot["webglState"] = "ready";
  let fallbackSent = false;
  let animationFrame = 0;
  let settleTimer = 0;
  let currentModel: DependencyGraphModel = emptyGraphModel();
  let currentVisibleModel: DependencyGraphModel = emptyGraphModel();
  let currentLevel: DependencyGraphLevel = { mode: "overview" };
  let spatialLayout: DependencySpatialLayout | null = null;
  let positions = new Map<string, THREE.Vector3>();
  let nodesById = new Map<string, DependencyGraphNode>();
  let visibleNodesById = new Map<string, DependencyGraphNode>();
  let baseVisibleNodeIds = new Set<string>();
  let forcedVisibleNodeIds = new Set<string>();
  let nodeBatches: NodeBatch[] = [];
  let clusterVisuals: ClusterVisual[] = [];
  let layerVisuals: LayerVisual[] = [];
  let layerAxis: THREE.LineSegments | null = null;
  let focusedNodeId: string | null = null;
  let hoveredNodeId: string | null = null;
  let previewNodeId: string | null = null;
  let showSecondHop = false;
  let idleEdgeMode: IdleEdgeMode = "backbone";
  let relationPanelState: RelationPanelState = "hidden";
  let lodLevel: SpatialLodLevel = "mid";
  let palette = createPalette("dark");
  let relationshipState = emptyRelationshipState();
  let initialCameraPosition = camera.position.clone();
  let initialTarget = controls.target.clone();
  let initialFitDistance = camera.position.distanceTo(controls.target);
  let currentViewKey: string | null = null;
  let currentLevelKey: string | null = null;
  let pendingInitialView = true;
  let labelsDirty = true;
  let lastLabelProjectionAt = 0;
  let lastCameraMotionAt = 0;
  let pendingFirstFrameAt = 0;
  let layoutMs = 0;
  let firstFrameMs = 0;
  let renderedEdgeCount = 0;
  let visibleBackboneCount = 0;
  let fullProjectedCrossings = 0;
  let visibleProjectedCrossings = 0;
  let labelCandidateCount = 0;
  let displayedLabelCount = 0;
  let collisionHiddenLabelCount = 0;
  let occlusionHiddenLabelCount = 0;
  let renderedRoutes: THREE.Vector3[][] = [];
  let lastCrossingCalculationAt = 0;
  let layoutBuilds = 0;
  let visibilityUpdates = 0;
  let frameTimes: number[] = [];
  let viewTween: {
    startedAt: number;
    fromPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPosition: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;

  const tauriInternals = (window as Window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__;
  const debugEnabled = typeof tauriInternals?.invoke !== "function";
  const debugWindow = window as Window & {
    __CODELENS_DEPENDENCY_SPACE_DEBUG__?: SpatialDebugSnapshot;
    __CODELENS_DEPENDENCY_SPACE_RUNTIME_COUNT__?: number;
  };
  if (debugEnabled) {
    debugWindow.__CODELENS_DEPENDENCY_SPACE_RUNTIME_COUNT__ =
      (debugWindow.__CODELENS_DEPENDENCY_SPACE_RUNTIME_COUNT__ || 0) + 1;
  }

  const effectiveFocusId = () => focusedNodeId && nodesById.has(focusedNodeId) ? focusedNodeId : null;
  const relationshipFocusId = () => effectiveFocusId() || (previewNodeId && nodesById.has(previewNodeId) ? previewNodeId : null);

  const sendFallback = (message: string) => {
    if (fallbackSent || disposed) return;
    fallbackSent = true;
    onFallback(message);
  };

  const nodeBatchMeshes = () => nodeBatches.map((batch) => batch.mesh);

  const findBatchForMesh = (mesh: THREE.Object3D) =>
    nodeBatches.find((batch) => batch.mesh === mesh) || null;

  const updateDebugSnapshot = () => {
    if (!debugEnabled) return;
    const now = performance.now();
    if (spatialLayout && now - lastCrossingCalculationAt > 500) {
      lastCrossingCalculationAt = now;
      const fullRoutes = currentModel.edges
        .map((edge) => spatialLayout?.routes.get(edge.id))
        .filter((route): route is Position3D[] => Boolean(route))
        .map((route) => route.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
      fullProjectedCrossings = countProjectedRouteCrossings(fullRoutes, camera, 220);
      visibleProjectedCrossings = countProjectedRouteCrossings(renderedRoutes, camera, 220);
    }
    const orderedFrames = frameTimes.slice().sort((left, right) => left - right);
    const p95Index = Math.max(0, Math.ceil(orderedFrames.length * 0.95) - 1);
    const diagnostics = spatialLayout?.diagnostics;
    const snapshot: SpatialDebugSnapshot = {
      presentation: "3d",
      graphLevel: currentLevel.mode,
      focusedNodeId: effectiveFocusId(),
      webglState,
      activeRafCount: animationFrame ? 1 : 0,
      nodeCount: currentVisibleModel.nodes.length,
      totalNodeCount: currentModel.nodes.filter((node) => node.kind === "file").length,
      edgeCount: renderedEdgeCount,
      clusterCount: diagnostics?.clusterCount || 0,
      layerCount: diagnostics?.layerCount || 0,
      layoutMs: roundMetric(layoutMs),
      firstFrameMs: roundMetric(firstFrameMs),
      p95FrameMs: roundMetric(orderedFrames[p95Index] || 0),
      axisExtents: diagnostics?.axisExtents || [0, 0, 0],
      volumeRatio: diagnostics?.volumeRatio || 0,
      canvasCount: document.querySelectorAll(".dependency-space-v1__canvas").length,
      runtimeCount: debugWindow.__CODELENS_DEPENDENCY_SPACE_RUNTIME_COUNT__ || 0,
      layoutBuilds,
      visibilityUpdates,
      lodLevel,
      idleEdgeMode,
      bundleCount: diagnostics?.bundleCount || 0,
      visibleBackboneCount,
      fullEdgeCount: diagnostics?.fullEdgeCount || 0,
      forcedVisibleCount: forcedVisibleNodeIds.size,
      relationPanelState,
      fullProjectedCrossings,
      visibleProjectedCrossings,
      labelCandidateCount,
      displayedLabelCount,
      collisionHiddenLabelCount,
      occlusionHiddenLabelCount,
      layerYSpans: diagnostics?.layerYSpans || [],
      nonCoplanarLayerCount: diagnostics?.nonCoplanarLayerCount || 0,
      version: spatialLayout?.version || "uninitialized",
      cameraPosition: camera.position.toArray(),
      target: controls.target.toArray(),
      viewport: [Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1)]
    };
    debugWindow.__CODELENS_DEPENDENCY_SPACE_DEBUG__ = snapshot;
    document.documentElement.dataset.dependencySpaceDebug = JSON.stringify(snapshot);
  };

  const projectLabels = (timestamp: number, cameraMoving: boolean) => {
    if (disposed) return;
    lastLabelProjectionAt = timestamp;
    labelsDirty = false;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    const focusId = relationshipFocusId();
    const displayedNodes = [...visibleNodesById.values()];
    const visibleFileCount = displayedNodes.filter((node) => node.kind === "file").length;
    const labelLimit = spatialLabelLimit(visibleFileCount, lodLevel);
    const stationaryCandidates = visibleFileCount <= 30
      ? [
          ...selectLabelNodes(
            displayedNodes.filter((node) => node.kind === "file"),
            focusId,
            hoveredNodeId,
            relationshipState,
            showSecondHop,
            Math.max(7, visibleFileCount),
            spatialLayout?.nodeRoles
          ),
          ...selectLabelNodes(
            displayedNodes.filter((node) => node.kind !== "file"),
            focusId,
            hoveredNodeId,
            relationshipState,
            showSecondHop,
            Math.max(7, displayedNodes.length - visibleFileCount),
            spatialLayout?.nodeRoles
          )
        ]
      : selectLabelNodes(
          displayedNodes,
          focusId,
          hoveredNodeId,
          relationshipState,
          showSecondHop,
          labelLimit,
          spatialLayout?.nodeRoles
        );
    const candidates = cameraMoving
      ? displayedNodes.filter(
          (node) => node.id === focusId || node.id === hoveredNodeId || Boolean(node.searchMatch)
        )
      : stationaryCandidates;
    labelCandidateCount = candidates.length;
    occlusionHiddenLabelCount = 0;
    const projectable: Array<{
      id: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      forced: boolean;
      focused: boolean;
      hovered: boolean;
    }> = [];
    const meshes = nodeBatchMeshes();

    for (const node of candidates) {
      const world = positions.get(node.id);
      if (!world) continue;
      const point = world.clone().project(camera);
      if (
        point.z < -1 ||
        point.z > 1 ||
        point.x < -1.08 ||
        point.x > 1.08 ||
        point.y < -1.08 ||
        point.y > 1.08
      ) {
        continue;
      }

      const text = displayNodeLabel(node, currentModel.nodes);
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      const forced = node.id === focusId || node.id === hoveredNodeId;
      if (!forced && meshes.length) {
        const direction = world.clone().sub(camera.position);
        const distance = direction.length();
        if (distance > 0.001) {
          labelRaycaster.set(camera.position, direction.normalize());
          labelRaycaster.near = 0;
          labelRaycaster.far = distance + 1;
          const hit = labelRaycaster.intersectObjects(meshes, false)[0];
          if (hit?.instanceId !== undefined) {
            const batch = findBatchForMesh(hit.object);
            if (batch?.instanceIds[hit.instanceId] !== node.id) {
              occlusionHiddenLabelCount += 1;
              continue;
            }
          }
        }
      }

      projectable.push({
        id: node.id,
        text,
        x,
        y,
        width: Math.min(190, Math.max(48, Array.from(text).length * 6.4 + 8)),
        height: forced ? 22 : 16,
        forced,
        focused: node.id === focusId,
        hovered: node.id === hoveredNodeId
      });
    }
    const layout = layoutSpatialLabels(projectable, width, height);
    collisionHiddenLabelCount = layout.collisionHiddenCount;
    const projected: ProjectedLabel[] = layout.placed.map((placed) => {
      const source = projectable.find((candidate) => candidate.id === placed.id);
      return {
        id: placed.id,
        text: source?.text || placed.id,
        x: placed.left,
        y: placed.top,
        focused: Boolean(source?.focused),
        hovered: Boolean(source?.hovered)
      };
    });
    displayedLabelCount = projected.length;
    setLabels(projected);
  };

  const updateCameraTween = (timestamp: number) => {
    if (!viewTween) return false;
    const progress = THREE.MathUtils.clamp((timestamp - viewTween.startedAt) / 260, 0, 1);
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    camera.position.lerpVectors(viewTween.fromPosition, viewTween.toPosition, eased);
    controls.target.lerpVectors(viewTween.fromTarget, viewTween.toTarget, eased);
    camera.updateProjectionMatrix();
    lastCameraMotionAt = performance.now();
    labelsDirty = true;
    if (progress >= 1) viewTween = null;
    return progress < 1;
  };

  const updateLodLevel = () => {
    const ratio = camera.position.distanceTo(controls.target) / Math.max(initialFitDistance, 1);
    let next = lodLevel;
    if (lodLevel === "far") {
      if (ratio < 1.2) next = "mid";
    } else if (lodLevel === "near") {
      if (ratio > 0.68) next = "mid";
    } else if (ratio > 1.35) {
      next = "far";
    } else if (ratio < 0.58) {
      next = "near";
    }
    if (next === lodLevel) return false;
    lodLevel = next;
    updateNodeInstances();
    labelsDirty = true;
    return true;
  };

  const renderFrame = (timestamp: number) => {
    animationFrame = 0;
    if (disposed || document.hidden) return;

    const tweenActive = updateCameraTween(timestamp);
    const controlsChanged = controls.update();
    const lodChanged = updateLodLevel();
    const renderStartedAt = performance.now();
    renderer.render(scene, camera);
    const renderDuration = performance.now() - renderStartedAt;
    if (renderDuration >= 0 && renderDuration < 100) {
      frameTimes.push(renderDuration);
      if (frameTimes.length > 180) frameTimes = frameTimes.slice(-180);
    }
    if (pendingFirstFrameAt) {
      firstFrameMs = performance.now() - pendingFirstFrameAt;
      pendingFirstFrameAt = 0;
    }

    const cameraMoving =
      tweenActive ||
      controlsChanged ||
      lodChanged ||
      performance.now() - lastCameraMotionAt < 120;
    if (
      labelsDirty &&
      (timestamp - lastLabelProjectionAt >= 1000 / 30 || !cameraMoving)
    ) {
      projectLabels(timestamp, cameraMoving);
    }

    updateDebugSnapshot();
    if (
      tweenActive ||
      controlsChanged ||
      (labelsDirty && timestamp - lastLabelProjectionAt < 1000 / 30)
    ) {
      requestRender();
    }
  };

  const requestRender = () => {
    if (disposed || document.hidden || animationFrame) return;
    animationFrame = window.requestAnimationFrame(renderFrame);
  };

  const scheduleSettledLabels = () => {
    if (settleTimer) window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = 0;
      labelsDirty = true;
      requestRender();
    }, 140);
  };

  const handleControlsChange = () => {
    lastCameraMotionAt = performance.now();
    labelsDirty = true;
    requestRender();
    scheduleSettledLabels();
  };
  const handleControlsStart = () => {
    viewTween = null;
    lastCameraMotionAt = performance.now();
    labelsDirty = true;
    requestRender();
  };
  const handleControlsEnd = () => {
    lastCameraMotionAt = performance.now();
    scheduleSettledLabels();
  };
  controls.addEventListener("change", handleControlsChange);
  controls.addEventListener("start", handleControlsStart);
  controls.addEventListener("end", handleControlsEnd);

  const updateSize = () => {
    if (disposed) return;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    for (const material of lineMaterials) material.resolution.set(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    labelsDirty = true;
    requestRender();
  };

  const resizeObserver = new ResizeObserver(updateSize);
  resizeObserver.observe(host);
  updateSize();

  const handleVisibilityChange = () => {
    if (document.hidden && animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      return;
    }
    labelsDirty = true;
    requestRender();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    webglState = "lost";
    updateDebugSnapshot();
    sendFallback(
      "三维图形上下文已丢失，已返回俯视图。请检查显卡驱动或关闭占用显存的程序后重试。"
    );
  };
  canvas.addEventListener("webglcontextlost", handleContextLost, false);

  const clearNodeBatches = () => {
    for (const batch of nodeBatches) {
      graphGroup.remove(batch.mesh);
      batch.mesh.dispose();
      batch.mesh.geometry.dispose();
      const materials = Array.isArray(batch.mesh.material)
        ? batch.mesh.material
        : [batch.mesh.material];
      for (const material of materials) material.dispose();
    }
    nodeBatches = [];
  };

  const clearEdges = () => {
    for (const child of [...edgeGroup.children]) {
      edgeGroup.remove(child);
      disposeRenderable(child);
    }
    lineMaterials.clear();
    renderedEdgeCount = 0;
    visibleBackboneCount = 0;
    renderedRoutes = [];
  };

  const clearSpatialGuides = () => {
    for (const visual of clusterVisuals) {
      shellGroup.remove(visual.fill, visual.outline);
      disposeRenderable(visual.fill);
      disposeRenderable(visual.outline);
    }
    if (layerAxis) {
      layerGroup.remove(layerAxis);
      disposeRenderable(layerAxis);
      layerAxis = null;
    }
    for (const visual of layerVisuals) {
      layerGroup.remove(visual.volumeFill, visual.volumeOutline, visual.label);
      disposeRenderable(visual.volumeFill);
      disposeRenderable(visual.volumeOutline);
      disposeRenderable(visual.label);
    }
    clusterVisuals = [];
    layerVisuals = [];
  };

  const createNodeBatches = () => {
    clearNodeBatches();
    const kinds: DependencyGraphNode["kind"][] = ["file", "directory", "boundary"];
    for (const kind of kinds) {
      const capacity = Math.max(
        1,
        currentModel.nodes.filter((node) => node.kind === kind).length
      );
      for (const active of [true, false]) {
        const geometry =
          kind === "directory"
            ? new THREE.IcosahedronGeometry(1, 1)
            : kind === "boundary"
              ? new THREE.OctahedronGeometry(1, 1)
              : new THREE.SphereGeometry(1, 16, 12);
        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: kind === "directory" ? 0.42 : 0.58,
          metalness: kind === "boundary" ? 0.2 : 0.08,
          emissive: kind === "file" ? palette.current : 0x000000,
          emissiveIntensity: kind === "file" ? (active ? 0.16 : 0.04) : 0,
          transparent: true,
          opacity: active ? 0.98 : 0.1,
          depthWrite: active
        });
        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.renderOrder = active ? 2 : 1;
        mesh.frustumCulled = false;
        graphGroup.add(mesh);
        nodeBatches.push({ kind, active, mesh, instanceIds: [] });
      }
    }
  };

  const createSpatialGuides = () => {
    clearSpatialGuides();
    if (!spatialLayout) return;
    const degraded = currentModel.nodes.length > 300 || currentModel.edges.length > 1500;

    for (const cluster of spatialLayout.clusters) {
      if (cluster.kind !== "directory") continue;
      const sphere = new THREE.SphereGeometry(1, 12, 8);
      const fillMaterial = new THREE.MeshStandardMaterial({
        color: palette.shell,
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const fill = new THREE.Mesh(sphere, fillMaterial);
      fill.position.set(cluster.center.x, cluster.center.y, cluster.center.z);
      fill.scale.set(
        Math.max(cluster.radii.x, 12),
        Math.max(cluster.radii.y, 12),
        Math.max(cluster.radii.z, 12)
      );
      fill.renderOrder = -2;
      fill.userData.clusterId = cluster.id;
      fill.userData.fillDisabled = degraded;

      const contourPoints = Array.from({ length: 65 }, (_, index) => {
        const angle = index / 64 * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      });
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(contourPoints);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: palette.shell,
        transparent: true,
        opacity: 0.2,
        depthWrite: false
      });
      const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
      outline.position.copy(fill.position);
      outline.scale.copy(fill.scale);
      outline.renderOrder = -1;
      shellGroup.add(fill, outline);
      clusterVisuals.push({ cluster, fill, outline });
    }

    if (currentLevel.mode === "directory") {
      const axisX = spatialLayout.bounds.min.x - 30;
      const axisZ = spatialLayout.bounds.min.z - 30;
      const layerCenters = spatialLayout.layers.map((layer) => layer.centerY);
      const axisMinY = Math.min(...layerCenters, spatialLayout.bounds.min.y) - 10;
      const axisMaxY = Math.max(...layerCenters, spatialLayout.bounds.max.y) + 10;
      const axisPositions = [axisX, axisMinY, axisZ, axisX, axisMaxY, axisZ];
      for (const layer of spatialLayout.layers) {
        axisPositions.push(
          axisX - 5, layer.centerY, axisZ,
          axisX + 7, layer.centerY, axisZ
        );
      }
      const axisGeometry = new THREE.BufferGeometry();
      axisGeometry.setAttribute("position", new THREE.Float32BufferAttribute(axisPositions, 3));
      const axisMaterial = new THREE.LineBasicMaterial({
        color: palette.layer,
        transparent: true,
        opacity: 0.28,
        depthWrite: false
      });
      layerAxis = new THREE.LineSegments(axisGeometry, axisMaterial);
      layerAxis.renderOrder = -2;
      layerGroup.add(layerAxis);

      for (const layer of spatialLayout.layers) {
        const volumeGeometry = new THREE.BoxGeometry(
          Math.max(layer.bounds.size.x, 32),
          Math.max(layer.maxY - layer.minY, 48),
          Math.max(layer.bounds.size.z, 32)
        );
        const fillMaterial = new THREE.MeshBasicMaterial({
          color: palette.layer,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        const volumeFill = new THREE.Mesh(volumeGeometry, fillMaterial);
        volumeFill.position.set(layer.bounds.center.x, layer.centerY, layer.bounds.center.z);
        volumeFill.renderOrder = -3;
        volumeFill.userData.fillDisabled = degraded;
        const outlineGeometry = new THREE.EdgesGeometry(volumeGeometry);
        const outlineMaterial = new THREE.LineBasicMaterial({
          color: palette.layer,
          transparent: true,
          opacity: 0,
          depthWrite: false
        });
        const volumeOutline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
        volumeOutline.position.copy(volumeFill.position);
        volumeOutline.renderOrder = -2;
        const label = createLayerLabelSprite(`L${layer.index}`, palette.layer);
        label.position.set(axisX + 17, layer.centerY + 5, axisZ);
        label.renderOrder = -2;
        layerGroup.add(volumeFill, volumeOutline, label);
        layerVisuals.push({
          nodeIds: new Set(layer.nodeIds),
          volumeFill,
          volumeOutline,
          label
        });
      }
    }

    const diagonal = Math.hypot(
      spatialLayout.bounds.size.x,
      spatialLayout.bounds.size.y,
      spatialLayout.bounds.size.z
    );
    scene.fog = new THREE.FogExp2(
      palette.fog,
      0.42 / Math.max(diagonal * 2, 420)
    );
  };

  const updateGuideAppearance = () => {
    if (scene.fog instanceof THREE.FogExp2) scene.fog.color.copy(palette.fog);
    for (const visual of clusterVisuals) {
      const fillMaterial = visual.fill.material as THREE.MeshStandardMaterial;
      const outlineMaterial = visual.outline.material as THREE.LineBasicMaterial;
      fillMaterial.color.copy(palette.shell);
      fillMaterial.opacity = !visual.fill.userData.fillDisabled && visual.cluster.nodeIds.includes(hoveredNodeId || "") ? 0.035 : 0;
      outlineMaterial.color.copy(palette.shell);
    }
    for (const visual of layerVisuals) {
      const fillMaterial = visual.volumeFill.material as THREE.MeshBasicMaterial;
      const outlineMaterial = visual.volumeOutline.material as THREE.LineBasicMaterial;
      const activeNodeId = relationshipFocusId() || hoveredNodeId;
      const active = Boolean(activeNodeId && visual.nodeIds.has(activeNodeId));
      fillMaterial.color.copy(palette.layer);
      fillMaterial.opacity = active && !visual.volumeFill.userData.fillDisabled ? 0.03 : 0;
      outlineMaterial.color.copy(palette.layer);
      outlineMaterial.opacity = active ? 0.12 : 0;
      updateLayerLabelSprite(visual.label, palette.layer);
    }
    if (layerAxis) {
      const material = layerAxis.material as THREE.LineBasicMaterial;
      material.color.copy(palette.layer);
    }
  };

  const updateGuideVisibility = () => {
    const visibleIds = new Set(visibleNodesById.keys());
    for (const visual of clusterVisuals) {
      const visible = visual.cluster.nodeIds.some((nodeId) => visibleIds.has(nodeId));
      visual.fill.visible = visible;
      visual.outline.visible = visible;
    }
    for (const visual of layerVisuals) {
      const visible = [...visual.nodeIds].some((nodeId) => visibleIds.has(nodeId));
      const activeNodeId = relationshipFocusId() || hoveredNodeId;
      const active = Boolean(activeNodeId && visual.nodeIds.has(activeNodeId));
      visual.volumeFill.visible = visible && active;
      visual.volumeOutline.visible = visible && active;
      visual.label.visible = visible;
    }
    if (layerAxis) layerAxis.visible = spatialLayout?.layers.some((layer) =>
      layer.nodeIds.some((nodeId) => visibleIds.has(nodeId))
    ) ?? false;
  };

  const refreshDisplayedNodes = () => {
    forcedVisibleNodeIds = new Set();
    const displayIds = new Set(baseVisibleNodeIds);
    const focusId = relationshipFocusId();
    if (focusId) {
      displayIds.add(focusId);
      for (const nodeId of relationshipState.oneHop) displayIds.add(nodeId);
      if (effectiveFocusId() && showSecondHop) {
        for (const nodeId of relationshipState.secondHop) displayIds.add(nodeId);
      }
    }
    for (const nodeId of displayIds) {
      if (!baseVisibleNodeIds.has(nodeId)) forcedVisibleNodeIds.add(nodeId);
    }
    visibleNodesById = new Map(
      [...displayIds]
        .map((nodeId) => nodesById.get(nodeId))
        .filter((node): node is DependencyGraphNode => Boolean(node))
        .map((node) => [node.id, node] as const)
    );
  };

  const updateNodeInstances = () => {
    const focusId = relationshipFocusId();
    const related = new Set<string>();
    if (focusId) {
      related.add(focusId);
      for (const id of relationshipState.oneHop) related.add(id);
      if (showSecondHop) {
        for (const id of relationshipState.secondHop) related.add(id);
      }
    }

    for (const batch of nodeBatches) {
      batch.mesh.count = 0;
      batch.instanceIds = [];
      const material = batch.mesh.material as THREE.MeshStandardMaterial;
      const emissiveColor = batch.kind === "file"
        ? palette.current
        : batch.kind === "directory"
          ? palette.directory
          : palette.boundary;
      material.emissive.copy(emissiveColor);
      material.emissiveIntensity = batch.kind === "file" ? (batch.active ? 0.16 : 0.04) : 0.025;
      material.opacity = batch.active
        ? 0.98
        : focusId
          ? 0.1
          : lodLevel === "far"
            ? 0.22
            : lodLevel === "mid"
              ? 0.9
              : 0.98;
      material.depthWrite = batch.active;
    }

    for (const node of visibleNodesById.values()) {
      const position = positions.get(node.id);
      if (!position) continue;
      const roles = spatialLayout?.nodeRoles.get(node.id);
      const keyNode = isSpatialKeyNode(node, roles);
      const isActive = focusId
        ? related.has(node.id)
        : lodLevel === "near" || keyNode;
      const batch = nodeBatches.find(
        (candidate) => candidate.kind === node.kind && candidate.active === isActive
      );
      if (!batch || batch.mesh.count >= batch.mesh.instanceMatrix.count) continue;
      const index = batch.mesh.count;
      scratchScale.setScalar(
        nodeScale(node, node.id === focusId, node.id === hoveredNodeId, lodLevel, keyNode)
      );
      scratchMatrix.compose(position, identityQuaternion, scratchScale);
      batch.mesh.setMatrixAt(index, scratchMatrix);
      batch.mesh.setColorAt(
        index,
        nodeColor(node, {
          focusedNodeId: focusId,
          hoveredNodeId,
          relationshipState,
          palette,
          active: focusId ? related.has(node.id) : lodLevel !== "far" || keyNode
        })
      );
      batch.instanceIds.push(node.id);
      batch.mesh.count += 1;
    }

    for (const batch of nodeBatches) {
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
      batch.mesh.computeBoundingSphere();
    }
  };

  const selectRenderableEdges = (): RenderableEdge[] => {
    const focusId = relationshipFocusId();
    if (focusId) {
      return currentModel.edges
        .filter(
          (edge) =>
            relationshipState.firstEdgeIds.has(edge.id) ||
            (effectiveFocusId() && showSecondHop && relationshipState.secondEdgeIds.has(edge.id))
        )
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          routeId: edge.id,
          style: relationshipState.firstEdgeIds.has(edge.id) ? "first" : "second"
        }));
    }
    if (idleEdgeMode === "all") {
      return currentVisibleModel.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        routeId: edge.id,
        style: "all"
      }));
    }
    if (!spatialLayout) return [];
    const visibleEdgeIds = new Set(currentVisibleModel.edges.map((edge) => edge.id));
    const edgeById = new Map(currentModel.edges.map((edge) => [edge.id, edge] as const));
    return spatialLayout.bundles
      .filter((bundle) => spatialLayout?.backboneBundleIds.has(bundle.id))
      .filter((bundle) => currentLevel.mode !== "overview" || bundle.sourceGroup !== bundle.targetGroup)
      .filter((bundle) => bundle.edgeIds.some((edgeId) => visibleEdgeIds.has(edgeId)))
      .flatMap((bundle): RenderableEdge[] => {
        const representative = bundle.edgeIds.map((edgeId) => edgeById.get(edgeId)).find(Boolean);
        return representative ? [{
          id: bundle.id,
          source: representative.source,
          target: representative.target,
          route: bundle.route,
          bundleId: bundle.id,
          weight: bundle.weight,
          style: "backbone" as const
        }] : [];
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  };

  const sampledRoute = (
    edge: RenderableEdge,
    segmentCount: number
  ): THREE.Vector3[] => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return [];

    const route = edge.route ?? (edge.routeId ? spatialLayout?.routes.get(edge.routeId) : undefined);
    if (route && route.length >= 2) {
      const points = route.map((point) => new THREE.Vector3(point.x, point.y, point.z));
      if (points.length === segmentCount + 1) return points;
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      return curve.getPoints(segmentCount);
    }

    const direction = target.clone().sub(source);
    const length = Math.max(direction.length(), 1);
    const normalized = direction.clone().normalize();
    const axis = Math.abs(normalized.y) < 0.82
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    const normal = normalized.clone().cross(axis).normalize();
    const signedLift =
      Math.max(18, length * 0.18) * (stableHashNumber(edge.id) % 2 ? 1 : -1);
    const firstControl = source
      .clone()
      .addScaledVector(direction, 0.34)
      .addScaledVector(normal, signedLift);
    const secondControl = source
      .clone()
      .addScaledVector(direction, 0.68)
      .addScaledVector(normal, signedLift);
    return new THREE.CubicBezierCurve3(
      source,
      firstControl,
      secondControl,
      target
    ).getPoints(segmentCount);
  };

  const updateEdges = () => {
    clearEdges();
    const renderableEdges = selectRenderableEdges();
    if (!renderableEdges.length) {
      updateDebugSnapshot();
      return;
    }

    const focusId = relationshipFocusId();
    const segmentCount =
      currentModel.nodes.length > 300 || currentModel.edges.length > 1500 ? 4 : 8;
    const styleBuffers = new Map<RenderableEdge["style"], { vertices: number[]; colors: number[] }>();
    const arrows: Array<{
      endpoint: THREE.Vector3;
      direction: THREE.Vector3;
      targetId: string;
      color: THREE.Color;
    }> = [];

    for (const edge of renderableEdges) {
      const points = sampledRoute(edge, segmentCount);
      if (points.length < 2) continue;
      renderedRoutes.push(points);
      const color = edge.style === "backbone" ? palette.edge : edgeColor(edge.id, edge.source, edge.target, {
        focusedNodeId: focusId,
        relationshipState,
        palette
      });
      const buffers = styleBuffers.get(edge.style) || { vertices: [], colors: [] };
      styleBuffers.set(edge.style, buffers);
      for (let index = 1; index < points.length; index += 1) {
        const source = points[index - 1];
        const target = points[index];
        buffers.vertices.push(source.x, source.y, source.z, target.x, target.y, target.z);
        buffers.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
      if (focusId) {
        const endpoint = points[points.length - 1];
        const direction = endpoint.clone().sub(points[points.length - 2]);
        if (direction.lengthSq() > 0.01) {
          arrows.push({
            endpoint,
            direction: direction.normalize(),
            targetId: edge.target,
            color
          });
        }
      }
    }

    const lineStyle = {
      backbone: { width: 1, opacity: 0.7 },
      all: { width: 0.8, opacity: 0.46 },
      first: { width: 2, opacity: 0.94 },
      second: { width: 1.25, opacity: 0.68 }
    } satisfies Record<RenderableEdge["style"], { width: number; opacity: number }>;
    for (const [style, buffers] of styleBuffers) {
      if (!buffers.vertices.length) continue;
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(buffers.vertices);
      geometry.setColors(buffers.colors);
      const material = new LineMaterial({
        color: 0xffffff,
        linewidth: lineStyle[style].width,
        vertexColors: true,
        transparent: true,
        opacity: lineStyle[style].opacity,
        depthWrite: false,
        alphaToCoverage: true
      });
      material.resolution.set(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
      lineMaterials.add(material);
      const lines = new LineSegments2(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = 0;
      edgeGroup.add(lines);
    }

    if (focusId && arrows.length) {
      const height = 4.8;
      const geometry = new THREE.ConeGeometry(1.65, height, 8);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.96,
        depthWrite: false
      });
      const arrowMesh = new THREE.InstancedMesh(
        geometry,
        material,
        arrows.length
      );
      let count = 0;
      for (const arrow of arrows) {
        const targetNode = visibleNodesById.get(arrow.targetId);
        const targetRadius = targetNode
          ? nodeScale(
              targetNode,
              targetNode.id === focusId,
              targetNode.id === hoveredNodeId,
              lodLevel,
              isSpatialKeyNode(targetNode, spatialLayout?.nodeRoles.get(targetNode.id))
            )
          : 7;
        scratchPosition
          .copy(arrow.endpoint)
          .addScaledVector(arrow.direction, -(targetRadius + height / 2 + 1));
        scratchQuaternion.setFromUnitVectors(up, arrow.direction);
        scratchScale.setScalar(1);
        scratchMatrix.compose(
          scratchPosition,
          scratchQuaternion,
          scratchScale
        );
        arrowMesh.setMatrixAt(count, scratchMatrix);
        arrowMesh.setColorAt(count, arrow.color);
        count += 1;
      }
      arrowMesh.count = count;
      arrowMesh.instanceMatrix.needsUpdate = true;
      if (arrowMesh.instanceColor) arrowMesh.instanceColor.needsUpdate = true;
      arrowMesh.frustumCulled = false;
      arrowMesh.renderOrder = 3;
      edgeGroup.add(arrowMesh);
    }

    renderedEdgeCount = renderableEdges.length;
    visibleBackboneCount = renderableEdges.filter((edge) => edge.style === "backbone").length;
    updateDebugSnapshot();
  };

  const visiblePositions = () =>
    [...visibleNodesById.values()]
      .map((node) => positions.get(node.id))
      .filter((position): position is THREE.Vector3 => Boolean(position));

  const applyFittedView = (rememberAsInitial: boolean) => {
    viewTween = null;
    const points = visiblePositions();
    if (!points.length) {
      controls.target.set(0, 0, 0);
      camera.position.set(220, 170, 260);
      camera.near = 0.1;
      camera.far = 9000;
      camera.updateProjectionMatrix();
      if (rememberAsInitial) {
        initialCameraPosition = camera.position.clone();
        initialTarget = controls.target.clone();
        initialFitDistance = camera.position.distanceTo(controls.target);
      }
      labelsDirty = true;
      requestRender();
      return;
    }

    const bounds = new THREE.Box3();
    for (const point of points) bounds.expandByPoint(point);
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 36);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspectFactor = Math.min(1, Math.max(camera.aspect, 0.35));
    const distance = Math.max(
      100,
      (radius / Math.sin(fov / 2)) * (1.02 / aspectFactor)
    );
    const direction = new THREE.Vector3(0.92, 0.72, 1.08).normalize();

    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(0.1, distance / 300);
    camera.far = Math.max(9000, distance * 14);
    camera.updateProjectionMatrix();
    controls.update();
    if (rememberAsInitial) {
      initialCameraPosition = camera.position.clone();
      initialTarget = controls.target.clone();
      initialFitDistance = distance;
    }
    labelsDirty = true;
    requestRender();
  };

  const restoreOrFitInitialView = () => {
    if (!pendingInitialView) return;
    pendingInitialView = false;
    const cached = currentViewKey ? cameraViewCache.get(currentViewKey) : undefined;
    if (cached) {
      applyFittedView(true);
      camera.position.fromArray(cached.position);
      controls.target.fromArray(cached.target);
      camera.near = cached.near;
      camera.far = cached.far;
      camera.updateProjectionMatrix();
      controls.update();
      labelsDirty = true;
      requestRender();
      return;
    }
    applyFittedView(true);
  };

  const saveCurrentView = () => {
    if (!currentViewKey) return;
    cameraViewCache.delete(currentViewKey);
    cameraViewCache.set(currentViewKey, {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      near: camera.near,
      far: camera.far
    });
    while (cameraViewCache.size > MAX_CACHED_VIEWS) {
      const oldestKey = cameraViewCache.keys().next().value;
      if (oldestKey === undefined) break;
      cameraViewCache.delete(oldestKey);
    }
  };

  const rebuildLayout = (
    nextModel: DependencyGraphModel,
    level: DependencyGraphLevel,
    cacheScope: string,
    preparedLayout: DependencySpatialLayout,
    preparedLayoutMs: number
  ) => {
    const startedAt = performance.now();
    const nextLevelKey =
      level.mode === "directory" ? "directory:" + level.directory : "overview";
    const preserveView = currentLevelKey === nextLevelKey && currentModel.nodes.length > 0;
    saveCurrentView();

    currentModel = nextModel;
    currentLevel = level;
    currentLevelKey = nextLevelKey;
    currentViewKey = graphViewCacheKey(cacheScope, nextModel, level);
    nodesById = new Map(nextModel.nodes.map((node) => [node.id, node] as const));
    spatialLayout = preparedLayout;
    positions = new Map(
      [...spatialLayout.positions].map(([id, point]) => [
        id,
        new THREE.Vector3(point.x, point.y, point.z)
      ])
    );
    layoutMs = preparedLayoutMs + performance.now() - startedAt;
    pendingFirstFrameAt = startedAt;
    layoutBuilds += 1;
    frameTimes = [];
    firstFrameMs = 0;

    createNodeBatches();
    createSpatialGuides();
    relationshipState = deriveRelationships(
      currentModel,
      relationshipFocusId(),
      Boolean(effectiveFocusId() && showSecondHop)
    );
    refreshDisplayedNodes();
    updateGuideVisibility();
    updateNodeInstances();
    updateEdges();

    pendingInitialView = !preserveView;
    if (preserveView) {
      labelsDirty = true;
      requestRender();
    }
    updateDebugSnapshot();
  };

  const updateVisibility = (nextVisibleModel: DependencyGraphModel) => {
    currentVisibleModel = nextVisibleModel;
    baseVisibleNodeIds = new Set(nextVisibleModel.nodes.map((node) => node.id));
    relationshipState = deriveRelationships(
      currentModel,
      relationshipFocusId(),
      Boolean(effectiveFocusId() && showSecondHop)
    );
    refreshDisplayedNodes();
    visibilityUpdates += 1;
    updateGuideVisibility();
    updateNodeInstances();
    updateEdges();
    labelsDirty = true;
    if (pendingInitialView) restoreOrFitInitialView();
    requestRender();
  };

  const updateAppearance = (options: {
    focusedNodeId: string | null;
    hoveredNodeId: string | null;
    previewNodeId: string | null;
    showSecondHop: boolean;
    idleEdgeMode: IdleEdgeMode;
    relationPanelState: RelationPanelState;
    palette: Palette;
  }) => {
    const relationshipChanged =
      focusedNodeId !== options.focusedNodeId ||
      previewNodeId !== options.previewNodeId ||
      showSecondHop !== options.showSecondHop;
    const edgeModeChanged = idleEdgeMode !== options.idleEdgeMode;
    const paletteChanged = palette !== options.palette;
    focusedNodeId = options.focusedNodeId;
    hoveredNodeId = options.hoveredNodeId;
    previewNodeId = options.previewNodeId;
    showSecondHop = options.showSecondHop;
    idleEdgeMode = options.idleEdgeMode;
    relationPanelState = options.relationPanelState;
    palette = options.palette;
    if (relationshipChanged) {
      relationshipState = deriveRelationships(
        currentModel,
        relationshipFocusId(),
        Boolean(effectiveFocusId() && showSecondHop)
      );
      refreshDisplayedNodes();
    }
    updateGuideVisibility();
    updateGuideAppearance();
    updateNodeInstances();
    if (relationshipChanged || edgeModeChanged || paletteChanged) updateEdges();
    labelsDirty = true;
    requestRender();
  };

  const pick = (clientX: number, clientY: number) => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);

    const nodeHit = raycaster.intersectObjects(nodeBatchMeshes(), false)[0];
    if (nodeHit?.instanceId !== undefined) {
      const batch = findBatchForMesh(nodeHit.object);
      const nodeId = batch?.instanceIds[nodeHit.instanceId];
      if (nodeId) return visibleNodesById.get(nodeId) || null;
    }

    if (currentLevel.mode !== "overview") return null;
    const shellHit = raycaster.intersectObjects(
      clusterVisuals.map((visual) => visual.fill),
      false
    )[0];
    const clusterId =
      shellHit?.object.userData.clusterId as string | undefined;
    if (!clusterId) return null;
    const visual = clusterVisuals.find(
      (candidate) => candidate.cluster.id === clusterId
    );
    if (!visual) return null;
    const directoryNode = visual.cluster.nodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .find((node) => node?.kind === "directory");
    return (
      directoryNode || {
        id: "cluster:" + clusterId,
        label: visual.cluster.label,
        kind: "directory",
        directory: clusterId,
        fileCount: visual.cluster.nodeIds.length,
        inDegree: 0,
        outDegree: 0,
        degree: 0
      }
    );
  };

  const centerSelection = (selectionId: string | null) => {
    const target = selectionId ? positions.get(selectionId) : null;
    if (!target) {
      applyFittedView(false);
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    viewTween = {
      startedAt: performance.now(),
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: target.clone().add(offset),
      toTarget: target.clone()
    };
    lastCameraMotionAt = performance.now();
    labelsDirty = true;
    requestRender();
  };

  const resetView = () => {
    viewTween = null;
    camera.position.copy(initialCameraPosition);
    controls.target.copy(initialTarget);
    camera.updateProjectionMatrix();
    controls.update();
    labelsDirty = true;
    requestRender();
  };

  requestRender();

  return {
    rebuildLayout,
    updateVisibility,
    updateAppearance,
    pick,
    requestRender,
    fitContent: () => applyFittedView(false),
    centerSelection,
    resetView,
    dispose: () => {
      if (disposed) return;
      saveCurrentView();
      disposed = true;
      webglState = "disposed";
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (settleTimer) window.clearTimeout(settleTimer);
      controls.removeEventListener("change", handleControlsChange);
      controls.removeEventListener("start", handleControlsStart);
      controls.removeEventListener("end", handleControlsEnd);
      controls.dispose();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      clearNodeBatches();
      clearEdges();
      clearSpatialGuides();
      renderer.renderLists.dispose();
      renderer.dispose();
      setLabels([]);
      if (debugEnabled) {
        debugWindow.__CODELENS_DEPENDENCY_SPACE_RUNTIME_COUNT__ = Math.max(
          0,
          (debugWindow.__CODELENS_DEPENDENCY_SPACE_RUNTIME_COUNT__ || 1) - 1
        );
        updateDebugSnapshot();
      }
    }
  };
}

function deriveRelationships(
  model: DependencyGraphModel,
  focusedNodeId: string | null,
  includeSecondHop: boolean
): RelationshipState {
  const state = emptyRelationshipState();
  if (!focusedNodeId) return state;

  for (const edge of model.edges) {
    if (edge.target === focusedNodeId) {
      state.oneHop.add(edge.source);
      state.incoming.add(edge.source);
      state.firstEdgeIds.add(edge.id);
    }
    if (edge.source === focusedNodeId) {
      state.oneHop.add(edge.target);
      state.outgoing.add(edge.target);
      state.firstEdgeIds.add(edge.id);
    }
  }
  if (!includeSecondHop) return state;

  for (const edge of model.edges) {
    if (state.firstEdgeIds.has(edge.id)) continue;
    const sourceIsFirst = state.oneHop.has(edge.source);
    const targetIsFirst = state.oneHop.has(edge.target);
    if (sourceIsFirst && edge.target !== focusedNodeId && !state.oneHop.has(edge.target)) {
      state.secondHop.add(edge.target);
      state.secondEdgeIds.add(edge.id);
    }
    if (targetIsFirst && edge.source !== focusedNodeId && !state.oneHop.has(edge.source)) {
      state.secondHop.add(edge.source);
      state.secondEdgeIds.add(edge.id);
    }
  }
  return state;
}

function selectLabelNodes(
  nodes: DependencyGraphNode[],
  focusedNodeId: string | null,
  hoveredNodeId: string | null,
  relationships: RelationshipState,
  showSecondHop: boolean,
  limit: number,
  nodeRoles?: Map<string, SpatialNodeRoleFlags>
): DependencyGraphNode[] {
  return [...nodes]
    .filter((node) => limit > 6
      || isSpatialKeyNode(node, nodeRoles?.get(node.id))
      || node.id === focusedNodeId
      || node.id === hoveredNodeId)
    .map((node) => {
      let priority = node.degree;
      if (isSpatialKeyNode(node, nodeRoles?.get(node.id))) priority += 2_000;
      if (node.searchMatch) priority += 20_000;
      if (relationships.oneHop.has(node.id)) priority += 12_000;
      if (showSecondHop && relationships.secondHop.has(node.id)) priority += 6_000;
      if (node.id === hoveredNodeId) priority += 80_000;
      if (node.id === focusedNodeId) priority += 100_000;
      return { node, priority };
    })
    .sort((left, right) => right.priority - left.priority || left.node.label.localeCompare(right.node.label))
    .slice(0, limit)
    .map(({ node }) => node);
}

function isSpatialKeyNode(node: DependencyGraphNode, roles?: SpatialNodeRoleFlags): boolean {
  return node.kind === "directory"
    || node.kind === "boundary"
    || Boolean(node.searchMatch || roles?.bridge || roles?.hub);
}

function nodeScale(
  node: DependencyGraphNode,
  focused: boolean,
  hovered: boolean,
  lodLevel: SpatialLodLevel,
  keyNode: boolean
): number {
  const kindScale = node.kind === "directory" ? 8.4 : node.kind === "boundary" ? 7.4 : 6.8;
  const degreeScale = Math.min(2.8, Math.log2(node.degree + 1) * 0.62);
  const interactionScale = focused ? 1.3 : hovered ? 1.16 : node.isolated ? 0.88 : 1;
  const lodScale = lodLevel === "far" && !keyNode ? 0.68 : 1;
  return (kindScale + degreeScale) * interactionScale * lodScale;
}

function nodeColor(
  node: DependencyGraphNode,
  options: {
    focusedNodeId: string | null;
    hoveredNodeId: string | null;
    relationshipState: RelationshipState;
    palette: Palette;
    active: boolean;
  }
): THREE.Color {
  const { focusedNodeId, hoveredNodeId, relationshipState, palette, active } = options;
  if (!active) return palette.muted;
  if (node.id === focusedNodeId) return palette.selected;
  if (node.id === hoveredNodeId) return palette.hovered;
  if (relationshipState.incoming.has(node.id)) return palette.incoming;
  if (relationshipState.outgoing.has(node.id)) return palette.outgoing;
  if (relationshipState.secondHop.has(node.id)) return palette.secondHop;
  if (node.kind === "directory") return palette.directory;
  if (node.kind === "boundary") return palette.boundary;
  return palette.current;
}

function edgeColor(
  edgeId: string,
  sourceId: string,
  targetId: string,
  options: {
    focusedNodeId: string | null;
    relationshipState: RelationshipState;
    palette: Palette;
  }
): THREE.Color {
  const { focusedNodeId, relationshipState, palette } = options;
  if (!focusedNodeId) return palette.edge;
  if (relationshipState.secondEdgeIds.has(edgeId)) return palette.secondHop;
  if (targetId === focusedNodeId) return palette.incoming;
  if (sourceId === focusedNodeId) return palette.outgoing;
  return palette.edge;
}

function createPalette(theme: "dark" | "light"): Palette {
  if (theme === "light") {
    return {
      edge: new THREE.Color("#8B9AA5"),
      current: new THREE.Color("#456A7D"),
      boundary: new THREE.Color("#9A672F"),
      directory: new THREE.Color("#475F70"),
      incoming: new THREE.Color("#1D827B"),
      outgoing: new THREE.Color("#AC662A"),
      secondHop: new THREE.Color("#8B9AA5"),
      selected: new THREE.Color("#145E7C"),
      hovered: new THREE.Color("#287C99"),
      muted: new THREE.Color("#C8D0D5"),
      shell: new THREE.Color("#8B9AA5"),
      layer: new THREE.Color("#8B9AA5"),
      fog: new THREE.Color("#F2F5F6")
    };
  }
  return {
    edge: new THREE.Color("#3F5360"),
    current: new THREE.Color("#92AFBE"),
    boundary: new THREE.Color("#B98D60"),
    directory: new THREE.Color("#A8BBC5"),
    incoming: new THREE.Color("#5EB8AD"),
    outgoing: new THREE.Color("#D79A5C"),
    secondHop: new THREE.Color("#667A86"),
    selected: new THREE.Color("#E6F6FC"),
    hovered: new THREE.Color("#B9DCE7"),
    muted: new THREE.Color("#25313A"),
    shell: new THREE.Color("#526773"),
    layer: new THREE.Color("#526773"),
    fog: new THREE.Color("#091117")
  };
}

function stableHashNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function displayNodeLabel(node: DependencyGraphNode, nodes: DependencyGraphNode[]): string {
  const duplicateCount = nodes.reduce(
    (count, candidate) => count + (candidate.label.toLocaleLowerCase() === node.label.toLocaleLowerCase() ? 1 : 0),
    0
  );
  if (duplicateCount < 2) return node.label;
  const location = node.path ?? node.directory;
  if (!location) return node.label;
  const segments = location.replace(/\\/g, "/").split("/").filter(Boolean);
  const parent = segments.length > 1 ? segments[segments.length - 2] : "根目录";
  return parent ? `${node.label} · ${parent}` : node.label;
}

function createLayerLabelSprite(text: string, color: THREE.Color): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 44;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.72, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(30, 13.75, 1);
  sprite.userData.layerLabel = { canvas, context, texture, text };
  updateLayerLabelSprite(sprite, color);
  return sprite;
}

function updateLayerLabelSprite(sprite: THREE.Sprite, color: THREE.Color): void {
  const state = sprite.userData.layerLabel as {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D | null;
    texture: THREE.CanvasTexture;
    text: string;
  } | undefined;
  if (!state?.context) return;
  state.context.clearRect(0, 0, state.canvas.width, state.canvas.height);
  state.context.font = "600 24px ui-monospace, SFMono-Regular, Consolas, monospace";
  state.context.textAlign = "center";
  state.context.textBaseline = "middle";
  state.context.fillStyle = color.getStyle();
  state.context.fillText(state.text, state.canvas.width / 2, state.canvas.height / 2);
  state.texture.needsUpdate = true;
}

function countProjectedRouteCrossings(
  routes: THREE.Vector3[][],
  camera: THREE.Camera,
  maximumRoutes: number
): number {
  if (routes.length > maximumRoutes) return -1;
  const projected = routes.map((route) => route.map((point) => {
    const value = point.clone().project(camera);
    return { x: value.x, y: value.y, z: value.z };
  }));
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < projected.length; leftIndex += 1) {
    const left = projected[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < projected.length; rightIndex += 1) {
      const right = projected[rightIndex];
      for (let leftSegment = 1; leftSegment < left.length; leftSegment += 1) {
        if (left[leftSegment - 1].z < -1 || left[leftSegment - 1].z > 1 || left[leftSegment].z < -1 || left[leftSegment].z > 1) continue;
        for (let rightSegment = 1; rightSegment < right.length; rightSegment += 1) {
          if (right[rightSegment - 1].z < -1 || right[rightSegment - 1].z > 1 || right[rightSegment].z < -1 || right[rightSegment].z > 1) continue;
          if (segmentsIntersect2D(left[leftSegment - 1], left[leftSegment], right[rightSegment - 1], right[rightSegment])) crossings += 1;
        }
      }
    }
  }
  return crossings;
}

function segmentsIntersect2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number }
): boolean {
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < -1e-8 && cdA * cdB < -1e-8;
}

function disposeRenderable(object: THREE.Object3D): void {
  const renderable = object as THREE.Object3D & {
    geometry?: THREE.BufferGeometry;
    material?: THREE.Material | THREE.Material[];
  };
  if (object instanceof THREE.InstancedMesh) object.dispose();
  const labelTexture = object.userData.layerLabel?.texture as THREE.Texture | undefined;
  labelTexture?.dispose();
  renderable.geometry?.dispose();
  const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
  for (const material of materials) material?.dispose();
}

function emptyRelationshipState(): RelationshipState {
  return {
    oneHop: new Set(),
    secondHop: new Set(),
    incoming: new Set(),
    outgoing: new Set(),
    firstEdgeIds: new Set(),
    secondEdgeIds: new Set()
  };
}

function emptyGraphModel(): DependencyGraphModel {
  return {
    nodes: [],
    edges: [],
    fileCount: 0,
    totalFileCount: 0,
    connectedFileCount: 0,
    isolatedFileCount: 0,
    edgeCount: 0,
    dense: false
  };
}

function graphViewCacheKey(cacheScope: string, model: DependencyGraphModel, level: DependencyGraphLevel): string {
  let hash = 2166136261;
  const nodeIds = model.nodes.map((node) => node.id).sort();
  for (const nodeId of nodeIds) {
    for (let index = 0; index < nodeId.length; index += 1) {
      hash ^= nodeId.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  const levelKey = level.mode === "directory" ? `directory:${level.directory}` : "overview";
  return `${cacheScope}:${levelKey}:${model.nodes.length}:${model.edgeCount}:${(hash >>> 0).toString(36)}`;
}
