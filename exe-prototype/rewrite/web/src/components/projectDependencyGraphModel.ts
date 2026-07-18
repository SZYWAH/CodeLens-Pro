import type { ElementDefinition } from "cytoscape";
import type { WorkspaceDetail, WorkspaceFile } from "../types";
import type { ResolvedDependency } from "../utils/projectNavigation";
import {
  normalizeProjectPath,
  projectBasename,
  projectDirname,
  topLevelArea
} from "../utils/projectNavigation";

export type DependencyGraphLevel =
  | { mode: "overview" }
  | { mode: "directory"; directory: string };

export type DependencyGraphNode = {
  id: string;
  label: string;
  kind: "file" | "directory" | "boundary";
  path?: string;
  directory?: string;
  language?: string;
  isolated?: boolean;
  risk?: number;
  fileCount?: number;
  inDegree: number;
  outDegree: number;
  degree: number;
  searchMatch?: boolean;
};

export type DependencyGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "file-edge" | "directory-edge";
  dependencyKind?: string;
  count?: number;
  sourcePath?: string;
  targetPath?: string;
  targetLabel?: string;
  line?: number;
};

export type DependencyGraphModel = {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  fileCount: number;
  totalFileCount: number;
  connectedFileCount: number;
  isolatedFileCount: number;
  edgeCount: number;
  dense: boolean;
};

export type Position3D = {
  x: number;
  y: number;
  z: number;
};

export type SpatialLodLevel = "far" | "mid" | "near";
export type IdleEdgeMode = "backbone" | "all";

export type SpatialNodeRoleFlags = {
  cycle: boolean;
  bridge: boolean;
  hub: boolean;
  leaf: boolean;
  isolated: boolean;
};

export type SpatialEdgeBundle = {
  id: string;
  edgeIds: string[];
  sourceGroup: string;
  targetGroup: string;
  sourceLayer: number;
  targetLayer: number;
  weight: number;
  route: Position3D[];
};

/** Backwards-compatible name used by the original 2D-in-3D renderer. */
export type DependencyGraphPosition = Position3D;

export type SpatialCluster = {
  id: string;
  label: string;
  nodeIds: string[];
  center: Position3D;
  radii: Position3D;
  kind: "directory" | "boundary" | "isolated";
};

export type SpatialLayerVolume = {
  index: number;
  centerY: number;
  minY: number;
  maxY: number;
  nodeIds: string[];
  bounds: SpatialBounds;
};

export type SpatialBounds = {
  min: Position3D;
  max: Position3D;
  center: Position3D;
  size: Position3D;
};

export type DependencySpatialLayout = {
  positions: Map<string, Position3D>;
  clusters: SpatialCluster[];
  layers: SpatialLayerVolume[];
  routes: Map<string, Position3D[]>;
  nodeRoles: Map<string, SpatialNodeRoleFlags>;
  bundles: SpatialEdgeBundle[];
  backboneBundleIds: Set<string>;
  bounds: SpatialBounds;
  diagnostics: {
    layerCount: number;
    clusterCount: number;
    bundleCount: number;
    backboneBundleCount: number;
    fullEdgeCount: number;
    axisExtents: [number, number, number];
    volumeRatio: number;
    layerYSpans: number[];
    nonCoplanarLayerCount: number;
  };
  version: string;
};

const SPATIAL_LAYOUT_VERSION = "spatial-v2.1.0";
const SPATIAL_LAYER_GAP = 80;
const SPATIAL_LAYER_HALF_DEPTH = 24;
const BUNDLE_LANE_GAP = 14;
const MAX_BUNDLE_LANE_OFFSET = 56;

type Component = {
  id: string;
  nodeIds: string[];
  layer: number;
  group: string;
};

/**
 * Build the renderer-neutral dependency graph used by both the 2D and 3D views.
 * Only dependencies resolved at both ends are part of this model.
 */
export function buildDependencyGraphModel(
  workspace: WorkspaceDetail,
  dependencies: ResolvedDependency[],
  level: DependencyGraphLevel,
  showIsolated: boolean
): DependencyGraphModel {
  const internalDependencies = dependencies
    .filter((dependency) => dependency.sourceFile && dependency.targetFile)
    .slice()
    .sort(compareDependencies);

  return level.mode === "overview"
    ? buildDirectoryOverview(workspace, internalDependencies)
    : buildDirectoryFocus(workspace, internalDependencies, level.directory, showIsolated);
}

/**
 * Build the full, renderer-neutral data set used by the volumetric renderer.
 * Unlike the compact 2D overview, the spatial overview retains every real file
 * and every de-duplicated file dependency alongside one core per directory.
 * Search and language filters deliberately do not participate in this build so
 * they can change visibility without changing coordinates.
 */
export function buildDependencySpatialModel(
  workspace: WorkspaceDetail,
  dependencies: ResolvedDependency[],
  level: DependencyGraphLevel,
  showIsolated: boolean
): DependencyGraphModel {
  const internalDependencies = dependencies
    .filter((dependency) => dependency.sourceFile && dependency.targetFile)
    .slice()
    .sort(compareDependencies);

  return level.mode === "overview"
    ? buildSpatialOverview(workspace, internalDependencies)
    : buildDirectoryFocus(workspace, internalDependencies, level.directory, showIsolated);
}

/**
 * Apply the same visibility rules as the Cytoscape view without mutating the
 * source model. Counts intentionally continue to describe the unfiltered level.
 */
export function filterDependencyGraphModel(
  model: DependencyGraphModel,
  query: string,
  language: string,
  mode: DependencyGraphLevel["mode"] | DependencyGraphLevel
): DependencyGraphModel {
  const graphMode = typeof mode === "string" ? mode : mode.mode;
  const needle = query.trim().toLocaleLowerCase();

  if (graphMode === "overview") {
    return {
      ...model,
      nodes: model.nodes.map((node) => node.searchMatch ? { ...node, searchMatch: false } : node)
    };
  }

  const visibleFileIds = new Set<string>();
  const candidateNodes = model.nodes.map((node) => {
    if (node.kind === "boundary") return node;
    const matches = (language === "all" || node.language === language)
      && (!needle || `${node.label} ${node.path || ""}`.toLocaleLowerCase().includes(needle));
    if (matches) visibleFileIds.add(node.id);
    return { ...node, searchMatch: Boolean(needle && matches) };
  });
  const nodeById = new Map(candidateNodes.map((node) => [node.id, node]));
  const visibleEdges = model.edges.filter((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return false;
    const sourceVisible = source.kind === "boundary" || visibleFileIds.has(source.id);
    const targetVisible = target.kind === "boundary" || visibleFileIds.has(target.id);
    return sourceVisible && targetVisible;
  });
  const connectedBoundaryIds = new Set<string>();
  for (const edge of visibleEdges) {
    if (nodeById.get(edge.source)?.kind === "boundary") connectedBoundaryIds.add(edge.source);
    if (nodeById.get(edge.target)?.kind === "boundary") connectedBoundaryIds.add(edge.target);
  }
  const visibleNodes = candidateNodes.filter((node) => node.kind === "boundary"
    ? connectedBoundaryIds.has(node.id)
    : visibleFileIds.has(node.id));

  const visibleFileCount = visibleNodes.filter((node) => node.kind === "file").length;
  return {
    ...model,
    nodes: visibleNodes,
    edges: visibleEdges,
    fileCount: visibleFileCount,
    edgeCount: visibleEdges.length,
    dense: visibleNodes.length > 24
  };
}

/**
 * Produce a deterministic semantic layout. Directed SCC layers map to Z,
 * parent directories form XY groups, cycles form local rings, and isolated
 * files occupy one or more outer rings.
 */
export function layoutDependencyGraph(
  model: DependencyGraphModel,
  level: DependencyGraphLevel
): Map<string, DependencyGraphPosition> {
  const positions = new Map<string, DependencyGraphPosition>();
  if (!model.nodes.length) return positions;

  const sortedNodes = model.nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
  const nodeById = new Map(sortedNodes.map((node) => [node.id, node]));
  const graphEdges = model.edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));
  const isolatedNodes = sortedNodes.filter((node) => node.isolated);
  const connectedNodes = sortedNodes.filter((node) => !node.isolated);

  const components = buildComponents(connectedNodes, graphEdges, nodeById);
  const grouped = new Map<string, Component[]>();
  for (const component of components) {
    const current = grouped.get(component.group);
    if (current) current.push(component);
    else grouped.set(component.group, [component]);
  }

  const groups = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  const groupRadius = groups.length <= 1 ? 0 : Math.max(105, groups.length * 38);
  const groupCenters = new Map<string, { x: number; y: number }>();
  groups.forEach(([group], index) => {
    if (groups.length === 1) {
      groupCenters.set(group, { x: 0, y: 0 });
      return;
    }
    const angle = -Math.PI / 2 + (index / groups.length) * Math.PI * 2;
    groupCenters.set(group, {
      x: Math.cos(angle) * groupRadius,
      y: Math.sin(angle) * groupRadius
    });
  });

  const maximumLayer = components.reduce((maximum, component) => Math.max(maximum, component.layer), 0);
  const layerCenter = maximumLayer / 2;

  for (const [group, groupComponents] of groups) {
    const center = groupCenters.get(group) || { x: 0, y: 0 };
    groupComponents.sort((left, right) => left.layer - right.layer || left.id.localeCompare(right.id));
    const localByLayer = new Map<number, Component[]>();
    for (const component of groupComponents) {
      const current = localByLayer.get(component.layer);
      if (current) current.push(component);
      else localByLayer.set(component.layer, [component]);
    }

    for (const [layer, layerComponents] of [...localByLayer.entries()].sort(([left], [right]) => left - right)) {
      layerComponents.sort((left, right) => left.id.localeCompare(right.id));
      layerComponents.forEach((component, index) => {
        const anchor = compactSpiralPoint(index, layerComponents.length);
        const anchorX = center.x + anchor.x;
        const anchorY = center.y + anchor.y;
        const z = (layer - layerCenter) * 54;
        const members = component.nodeIds.slice().sort((left, right) => left.localeCompare(right));

        if (members.length === 1) {
          positions.set(members[0], { x: anchorX, y: anchorY, z });
          return;
        }

        const cycleRadius = Math.max(18, members.length * 5.5);
        members.forEach((nodeId, memberIndex) => {
          const angle = -Math.PI / 2 + (memberIndex / members.length) * Math.PI * 2;
          positions.set(nodeId, {
            x: anchorX + Math.cos(angle) * cycleRadius,
            y: anchorY + Math.sin(angle) * cycleRadius,
            z
          });
        });
      });
    }
  }

  if (isolatedNodes.length) {
    const connectedExtent = groups.length <= 1 ? 145 : groupRadius + 130;
    const perRing = 24;
    isolatedNodes.forEach((node, index) => {
      const ring = Math.floor(index / perRing);
      const ringStart = ring * perRing;
      const ringSize = Math.min(perRing, isolatedNodes.length - ringStart);
      const radius = connectedExtent + ring * 42;
      const angle = -Math.PI / 2 + ((index - ringStart) / ringSize) * Math.PI * 2;
      positions.set(node.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: level.mode === "directory" ? -18 : 0
      });
    });
  }

  return positions;
}

/**
 * Deterministic volumetric layout used by the true-3D renderer. Project
 * overviews form directory star clusters; directory views form dependency
 * layers on Y and directory groups across X/Z. This function never mutates the
 * model and contains no simulation state.
 */
export function layoutDependencyGraphSpatial(
  model: DependencyGraphModel,
  level: DependencyGraphLevel
): DependencySpatialLayout {
  const spatial = level.mode === "overview"
    ? layoutSpatialOverview(model)
    : layoutSpatialDirectory(model, level.directory);
  const semantics = buildSpatialSemantics(model, level, spatial);
  const segmentCount = model.nodes.length > 300 || model.edges.length > 1500 ? 4 : 8;
  const routes = buildSpatialRoutes(
    model.edges,
    spatial.positions,
    semantics.bundleByEdgeId,
    semantics.componentByNodeId,
    semantics.componentSizeById,
    segmentCount
  );
  const positionBounds = measureSpatialBounds([...spatial.positions.values()]);
  const bounds = measureSpatialBounds([
    ...spatial.positions.values(),
    ...[...routes.values()].flat()
  ]);
  const axisExtents: [number, number, number] = [positionBounds.size.x, positionBounds.size.y, positionBounds.size.z];
  const maximumExtent = Math.max(...axisExtents);
  const minimumExtent = Math.min(...axisExtents);
  const layerYSpans = spatial.layers.map((layer) => layerVolumeUtilization(layer, spatial.positions));

  return {
    positions: spatial.positions,
    clusters: spatial.clusters,
    layers: spatial.layers,
    routes,
    nodeRoles: semantics.nodeRoles,
    bundles: semantics.bundles,
    backboneBundleIds: semantics.backboneBundleIds,
    bounds,
    diagnostics: {
      layerCount: spatial.layers.length,
      clusterCount: spatial.clusters.filter((cluster) => cluster.kind === "directory").length,
      bundleCount: semantics.bundles.length,
      backboneBundleCount: semantics.backboneBundleIds.size,
      fullEdgeCount: model.edges.length,
      axisExtents,
      volumeRatio: maximumExtent > 0 ? minimumExtent / maximumExtent : 0,
      layerYSpans,
      nonCoplanarLayerCount: layerYSpans.filter((span) => span > 0.001).length
    },
    version: SPATIAL_LAYOUT_VERSION
  };
}

type SpatialLayoutParts = {
  positions: Map<string, Position3D>;
  clusters: SpatialCluster[];
  layers: SpatialLayerVolume[];
};

function layoutSpatialOverview(model: DependencyGraphModel): SpatialLayoutParts {
  const positions = new Map<string, Position3D>();
  const clusters: SpatialCluster[] = [];
  const grouped = new Map<string, DependencyGraphNode[]>();

  for (const node of model.nodes.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const directory = node.directory || node.label;
    const current = grouped.get(directory);
    if (current) current.push(node);
    else grouped.set(directory, [node]);
  }

  const groups = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  const largestCluster = groups.reduce((maximum, [, nodes]) => Math.max(maximum, nodes.length), 1);
  const orbitRadius = groups.length <= 1
    ? 0
    : Math.max(210, Math.sqrt(groups.length) * (115 + Math.cbrt(largestCluster) * 18));

  groups.forEach(([directory, nodes], groupIndex) => {
    const center = groups.length <= 1
      ? { x: 0, y: 0, z: 0 }
      : fibonacciSpherePoint(groupIndex, groups.length, orbitRadius, directory);
    const files = nodes.filter((node) => node.kind === "file").sort((left, right) => left.id.localeCompare(right.id));
    const core = nodes.find((node) => node.kind === "directory");
    const clusterRadius = Math.max(62, 38 + Math.cbrt(Math.max(1, files.length)) * 28);

    if (core) positions.set(core.id, center);
    for (const file of files) {
      const direction = stableUnitVector(file.path || file.id);
      const radialFactor = 0.28 + Math.cbrt(stableUnit(`${file.id}|radius`)) * 0.62;
      positions.set(file.id, {
        x: center.x + direction.x * clusterRadius * radialFactor,
        y: center.y + direction.y * clusterRadius * radialFactor,
        z: center.z + direction.z * clusterRadius * radialFactor
      });
    }

    clusters.push(clusterAround(
      directory,
      directory,
      nodes.map((node) => node.id),
      positions,
      "directory",
      26,
      center
    ));
  });

  const layers = deriveSpatialLayers(model, positions);
  return { positions, clusters, layers };
}

function layoutSpatialDirectory(model: DependencyGraphModel, fallbackDirectory: string): SpatialLayoutParts {
  const positions = new Map<string, Position3D>();
  const sortedNodes = model.nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
  const nodeById = new Map(sortedNodes.map((node) => [node.id, node]));
  const connectedFiles = sortedNodes.filter((node) => node.kind === "file" && !node.isolated);
  const isolatedFiles = sortedNodes.filter((node) => node.kind === "file" && node.isolated);
  const boundaryNodes = sortedNodes.filter((node) => node.kind === "boundary");
  const fileIds = new Set(connectedFiles.map((node) => node.id));
  const fileEdges = model.edges.filter((edge) => fileIds.has(edge.source) && fileIds.has(edge.target));
  const components = buildComponents(connectedFiles, fileEdges, nodeById);
  const maximumLayer = components.reduce((maximum, component) => Math.max(maximum, component.layer), 0);
  const layerCenter = maximumLayer / 2;
  const groupNames = [...new Set(connectedFiles.map((node) => spatialDirectoryGroup(node, fallbackDirectory)))]
    .sort((left, right) => left.localeCompare(right));
  const groupRadius = groupNames.length <= 1
    ? 0
    : Math.max(118, Math.sqrt(groupNames.length) * 82);
  const groupCenters = new Map<string, { x: number; z: number }>();

  groupNames.forEach((group, index) => {
    if (groupNames.length <= 1) {
      groupCenters.set(group, { x: 0, z: 0 });
      return;
    }
    const angle = -Math.PI / 2 + (index / groupNames.length) * Math.PI * 2;
    groupCenters.set(group, { x: Math.cos(angle) * groupRadius, z: Math.sin(angle) * groupRadius });
  });

  const componentGroups = new Map<string, Component[]>();
  for (const component of components) {
    const group = component.nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is DependencyGraphNode => Boolean(node))
      .map((node) => spatialDirectoryGroup(node, fallbackDirectory))
      .sort((left, right) => left.localeCompare(right))[0] || fallbackDirectory;
    const key = `${group}\u0000${component.layer}`;
    const current = componentGroups.get(key);
    if (current) current.push(component);
    else componentGroups.set(key, [component]);
  }

  for (const [key, layerComponents] of [...componentGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [group] = key.split("\u0000");
    const groupCenter = groupCenters.get(group) || { x: 0, z: 0 };
    layerComponents.sort((left, right) => left.id.localeCompare(right.id));
    const memberCount = layerComponents.reduce((total, component) => total + component.nodeIds.length, 0);
    const bandRadiusX = Math.max(38, Math.sqrt(Math.max(1, memberCount)) * 30);
    const bandRadiusZ = Math.max(34, Math.sqrt(Math.max(1, memberCount)) * 27);
    layerComponents.forEach((component, componentIndex) => {
      const direction = layerComponents.length === 1
        ? stableUnitVector(`${component.id}|band-direction`)
        : fibonacciUnitVector(componentIndex, layerComponents.length, `${group}|${component.layer}|band`);
      const radialFactor = 0.46 + stableUnit(`${component.id}|band-radius`) * 0.48;
      const anchorX = groupCenter.x + direction.x * bandRadiusX * radialFactor;
      const anchorZ = groupCenter.z + direction.z * bandRadiusZ * radialFactor;
      const layerY = (layerCenter - component.layer) * SPATIAL_LAYER_GAP;
      const members = component.nodeIds.slice().sort((left, right) => left.localeCompare(right));
      if (members.length === 1) {
        positions.set(members[0], {
          x: anchorX,
          y: layerY + stableBandOffset(`${members[0]}|band-y`, SPATIAL_LAYER_HALF_DEPTH - 2),
          z: anchorZ
        });
        return;
      }

      const ringRadius = Math.max(22, members.length * 6);
      const phase = stableUnit(`${component.id}|phase`) * Math.PI * 2;
      const componentYOffset = direction.y * 8;
      const rawY = members.map((_, index) => {
        const angle = -Math.PI / 2 + (index / members.length) * Math.PI * 2;
        return Math.sin(angle + phase) * 8 + Math.sin(angle * 2 + phase * 0.7) * 4;
      });
      const meanY = rawY.reduce((sum, value) => sum + value, 0) / rawY.length;
      members.forEach((nodeId, index) => {
        const angle = -Math.PI / 2 + (index / members.length) * Math.PI * 2;
        positions.set(nodeId, {
          x: anchorX + Math.cos(angle) * ringRadius,
          y: layerY + Math.max(
            -SPATIAL_LAYER_HALF_DEPTH,
            Math.min(SPATIAL_LAYER_HALF_DEPTH, componentYOffset + rawY[index] - meanY)
          ),
          z: anchorZ + Math.sin(angle) * ringRadius
        });
      });
    });
  }

  const connectedPoints = connectedFiles
    .map((node) => positions.get(node.id))
    .filter((position): position is Position3D => Boolean(position));
  const coreBounds = measureSpatialBounds(connectedPoints);
  const coreCenter = connectedPoints.length ? coreBounds.center : { x: 0, y: 0, z: 0 };
  const baseRadii = {
    x: Math.max(90, coreBounds.size.x / 2 + 48),
    y: Math.max(90, coreBounds.size.y / 2 + 48),
    z: Math.max(90, coreBounds.size.z / 2 + 48)
  };

  for (const boundary of boundaryNodes) {
    const direction = stableUnitVector(boundary.id);
    positions.set(boundary.id, {
      x: coreCenter.x + direction.x * baseRadii.x * 1.18,
      y: coreCenter.y + direction.y * baseRadii.y * 1.18,
      z: coreCenter.z + direction.z * baseRadii.z * 1.18
    });
  }

  isolatedFiles.forEach((node, index) => {
    const direction = fibonacciUnitVector(index, isolatedFiles.length, node.id);
    positions.set(node.id, {
      x: coreCenter.x + direction.x * baseRadii.x * 1.35,
      y: coreCenter.y + direction.y * baseRadii.y * 1.35,
      z: coreCenter.z + direction.z * baseRadii.z * 1.35
    });
  });

  const clusters: SpatialCluster[] = [];
  for (const group of groupNames) {
    const nodeIds = connectedFiles
      .filter((node) => spatialDirectoryGroup(node, fallbackDirectory) === group)
      .map((node) => node.id);
    clusters.push(clusterAround(group, group, nodeIds, positions, "directory", 24));
  }
  if (boundaryNodes.length) {
    clusters.push(clusterAround(
      "__boundary__",
      "cross-directory boundary",
      boundaryNodes.map((node) => node.id),
      positions,
      "boundary",
      16
    ));
  }
  if (isolatedFiles.length) {
    clusters.push(clusterAround(
      "__isolated__",
      "isolated files",
      isolatedFiles.map((node) => node.id),
      positions,
      "isolated",
      16
    ));
  }

  const layerMembers = new Map<number, string[]>();
  for (const component of components) {
    const current = layerMembers.get(component.layer);
    if (current) current.push(...component.nodeIds);
    else layerMembers.set(component.layer, component.nodeIds.slice());
  }
  const layers = [...layerMembers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, nodeIds]) => createLayerVolume(
      index,
      (layerCenter - index) * SPATIAL_LAYER_GAP,
      nodeIds,
      positions,
      SPATIAL_LAYER_HALF_DEPTH
    ));

  return { positions, clusters, layers };
}

function deriveSpatialLayers(
  model: DependencyGraphModel,
  positions: Map<string, Position3D>
): SpatialLayerVolume[] {
  const files = model.nodes.filter((node) => node.kind === "file" && !node.isolated);
  const fileIds = new Set(files.map((node) => node.id));
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const edges = model.edges.filter((edge) => fileIds.has(edge.source) && fileIds.has(edge.target));
  const components = buildComponents(files, edges, nodeById);
  const layerMembers = new Map<number, string[]>();
  for (const component of components) {
    const current = layerMembers.get(component.layer);
    if (current) current.push(...component.nodeIds);
    else layerMembers.set(component.layer, component.nodeIds.slice());
  }
  return [...layerMembers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, nodeIds]) => {
      const sortedNodeIds = nodeIds.sort((left, right) => left.localeCompare(right));
      const visiblePositions = sortedNodeIds
        .map((nodeId) => positions.get(nodeId))
        .filter((position): position is Position3D => Boolean(position));
      const centerY = visiblePositions.length
        ? visiblePositions.reduce((sum, position) => sum + position.y, 0) / visiblePositions.length
        : 0;
      return createLayerVolume(index, centerY, sortedNodeIds, positions);
    });
}

function createLayerVolume(
  index: number,
  centerY: number,
  nodeIds: string[],
  positions: Map<string, Position3D>,
  fixedHalfDepth?: number
): SpatialLayerVolume {
  const sortedNodeIds = nodeIds.slice().sort((left, right) => left.localeCompare(right));
  const points = sortedNodeIds
    .map((nodeId) => positions.get(nodeId))
    .filter((position): position is Position3D => Boolean(position));
  const measured = measureSpatialBounds(points);
  const halfDepth = fixedHalfDepth ?? Math.max(8, measured.size.y / 2 + 6);
  const minX = points.length ? measured.min.x - 28 : -28;
  const maxX = points.length ? measured.max.x + 28 : 28;
  const minZ = points.length ? measured.min.z - 28 : -28;
  const maxZ = points.length ? measured.max.z + 28 : 28;
  const minY = centerY - halfDepth;
  const maxY = centerY + halfDepth;
  return {
    index,
    centerY,
    minY,
    maxY,
    nodeIds: sortedNodeIds,
    bounds: boundsFromExtents(minX, minY, minZ, maxX, maxY, maxZ)
  };
}

function layerVolumeUtilization(
  layer: SpatialLayerVolume,
  positions: Map<string, Position3D>
): number {
  const offsets = layer.nodeIds
    .map((nodeId) => positions.get(nodeId))
    .filter((position): position is Position3D => Boolean(position))
    .map((position) => Math.abs(position.y - layer.centerY));
  return offsets.length ? Math.max(...offsets) * 2 : 0;
}

function clusterAround(
  id: string,
  label: string,
  nodeIds: string[],
  positions: Map<string, Position3D>,
  kind: SpatialCluster["kind"],
  padding: number,
  anchor?: Position3D
): SpatialCluster {
  const sortedNodeIds = nodeIds.slice().sort((left, right) => left.localeCompare(right));
  const points = sortedNodeIds
    .map((nodeId) => positions.get(nodeId))
    .filter((position): position is Position3D => Boolean(position));
  const measured = measureSpatialBounds(points);
  const center = anchor || measured.center;
  const radii = points.reduce((extent, point) => ({
    x: Math.max(extent.x, Math.abs(point.x - center.x) + padding),
    y: Math.max(extent.y, Math.abs(point.y - center.y) + padding),
    z: Math.max(extent.z, Math.abs(point.z - center.z) + padding)
  }), { x: padding, y: padding, z: padding });
  return { id, label, nodeIds: sortedNodeIds, center, radii, kind };
}

type SpatialSemantics = {
  nodeRoles: Map<string, SpatialNodeRoleFlags>;
  bundles: SpatialEdgeBundle[];
  backboneBundleIds: Set<string>;
  bundleByEdgeId: Map<string, SpatialEdgeBundle>;
  componentByNodeId: Map<string, string>;
  componentSizeById: Map<string, number>;
};

function buildSpatialSemantics(
  model: DependencyGraphModel,
  level: DependencyGraphLevel,
  spatial: SpatialLayoutParts
): SpatialSemantics {
  const sortedNodes = model.nodes.slice().sort((left, right) => left.id.localeCompare(right.id));
  const sortedEdges = model.edges.slice().sort((left, right) => left.id.localeCompare(right.id));
  const nodeById = new Map(sortedNodes.map((node) => [node.id, node] as const));
  const components = buildComponents(sortedNodes, sortedEdges, nodeById);
  const componentByNodeId = new Map<string, string>();
  const componentSizeById = new Map<string, number>();
  for (const component of components) {
    componentSizeById.set(component.id, component.nodeIds.length);
    for (const nodeId of component.nodeIds) componentByNodeId.set(nodeId, component.id);
  }

  const selfLoopIds = new Set(
    sortedEdges.filter((edge) => edge.source === edge.target).map((edge) => edge.source)
  );
  const articulationIds = findArticulationPoints(sortedNodes, sortedEdges);
  const degreeCandidates = sortedNodes
    .filter((node) => node.kind !== "directory")
    .map((node) => node.degree)
    .sort((left, right) => left - right);
  const degreeP80 = degreeCandidates.length
    ? degreeCandidates[Math.max(0, Math.ceil(degreeCandidates.length * 0.8) - 1)]
    : Infinity;
  const crossGroupIds = new Set<string>();
  for (const edge of sortedEdges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    if (spatialNodeGroup(source, level) !== spatialNodeGroup(target, level)) {
      crossGroupIds.add(source.id);
      crossGroupIds.add(target.id);
    }
  }

  const nodeRoles = new Map<string, SpatialNodeRoleFlags>();
  for (const node of sortedNodes) {
    const componentId = componentByNodeId.get(node.id);
    const eligible = node.kind !== "directory";
    const isolated = Boolean(node.isolated);
    nodeRoles.set(node.id, {
      cycle: eligible && (Boolean(componentId && (componentSizeById.get(componentId) || 0) > 1) || selfLoopIds.has(node.id)),
      bridge: eligible && (articulationIds.has(node.id) || crossGroupIds.has(node.id)),
      hub: eligible && node.degree >= 3 && node.degree >= degreeP80,
      leaf: eligible && !isolated && node.degree <= 1,
      isolated
    });
  }

  const layerByNodeId = new Map<string, number>();
  for (const layer of spatial.layers) {
    for (const nodeId of layer.nodeIds) layerByNodeId.set(nodeId, layer.index);
  }
  const layerForNode = (node: DependencyGraphNode) => {
    const explicit = layerByNodeId.get(node.id);
    if (explicit !== undefined) return explicit;
    const position = spatial.positions.get(node.id);
    if (!position || !spatial.layers.length) return 0;
    return spatial.layers.reduce((closest, candidate) =>
      Math.abs(candidate.centerY - position.y) < Math.abs(closest.centerY - position.y) ? candidate : closest
    ).index;
  };

  type BundleDraft = Omit<SpatialEdgeBundle, "route"> & {
    sourcePoints: Position3D[];
    targetPoints: Position3D[];
  };
  const draftByKey = new Map<string, BundleDraft>();
  for (const edge of sortedEdges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const sourcePoint = spatial.positions.get(edge.source);
    const targetPoint = spatial.positions.get(edge.target);
    if (!sourceNode || !targetNode || !sourcePoint || !targetPoint) continue;
    const sourceGroup = spatialNodeGroup(sourceNode, level);
    const targetGroup = spatialNodeGroup(targetNode, level);
    const sourceLayer = layerForNode(sourceNode);
    const targetLayer = layerForNode(targetNode);
    const key = [sourceGroup, sourceLayer, targetGroup, targetLayer].join("\u0000");
    const current = draftByKey.get(key);
    if (current) {
      current.edgeIds.push(edge.id);
      current.sourcePoints.push(sourcePoint);
      current.targetPoints.push(targetPoint);
      current.weight += 1;
    } else {
      draftByKey.set(key, {
        id: `bundle:${hashString(key)}`,
        edgeIds: [edge.id],
        sourceGroup,
        targetGroup,
        sourceLayer,
        targetLayer,
        weight: 1,
        sourcePoints: [sourcePoint],
        targetPoints: [targetPoint]
      });
    }
  }

  const drafts = [...draftByKey.values()].sort((left, right) => left.id.localeCompare(right.id));
  const draftsByLayerPair = new Map<string, BundleDraft[]>();
  for (const draft of drafts) {
    const key = `${draft.sourceLayer}\u0000${draft.targetLayer}`;
    const current = draftsByLayerPair.get(key);
    if (current) current.push(draft);
    else draftsByLayerPair.set(key, [draft]);
  }

  const bundles: SpatialEdgeBundle[] = [];
  for (const [layerPair, pairDrafts] of [...draftsByLayerPair.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    pairDrafts.sort((left, right) => left.id.localeCompare(right.id));
    const angle = stableUnit(`${layerPair}|lane-angle`) * Math.PI * 2;
    pairDrafts.forEach((draft, index) => {
      const lane = Math.max(
        -MAX_BUNDLE_LANE_OFFSET,
        Math.min(MAX_BUNDLE_LANE_OFFSET, (index - (pairDrafts.length - 1) / 2) * BUNDLE_LANE_GAP)
      );
      const source = averagePoint(draft.sourcePoints);
      const target = averagePoint(draft.targetPoints);
      const midpoint = lerp3(source, target, 0.5);
      const verticalLane = (stableUnit(`${draft.id}|lane-y`) * 2 - 1) * (8 + Math.min(10, Math.abs(lane) * 0.18));
      const corridor = {
        x: midpoint.x + Math.cos(angle) * lane,
        y: midpoint.y + verticalLane,
        z: midpoint.z + Math.sin(angle) * lane
      };
      const sourceExit = lerp3(source, corridor, 0.34);
      const targetEntry = lerp3(corridor, target, 0.66);
      bundles.push({
        id: draft.id,
        edgeIds: draft.edgeIds.slice().sort((left, right) => left.localeCompare(right)),
        sourceGroup: draft.sourceGroup,
        targetGroup: draft.targetGroup,
        sourceLayer: draft.sourceLayer,
        targetLayer: draft.targetLayer,
        weight: draft.weight,
        route: [source, sourceExit, corridor, targetEntry, target]
      });
    });
  }
  bundles.sort((left, right) => left.id.localeCompare(right.id));

  const bundleByEdgeId = new Map<string, SpatialEdgeBundle>();
  for (const bundle of bundles) {
    for (const edgeId of bundle.edgeIds) bundleByEdgeId.set(edgeId, bundle);
  }
  const backboneBundleIds = selectBackboneBundles(
    model,
    bundles,
    bundleByEdgeId,
    nodeRoles,
    nodeById
  );

  return {
    nodeRoles,
    bundles,
    backboneBundleIds,
    bundleByEdgeId,
    componentByNodeId,
    componentSizeById
  };
}

function selectBackboneBundles(
  model: DependencyGraphModel,
  bundles: SpatialEdgeBundle[],
  bundleByEdgeId: Map<string, SpatialEdgeBundle>,
  nodeRoles: Map<string, SpatialNodeRoleFlags>,
  nodeById: Map<string, DependencyGraphNode>
): Set<string> {
  const limit = model.edges.length < 6
    ? model.edges.length
    : Math.min(24, Math.max(6, Math.ceil(model.edges.length * 0.3)));
  if (!limit || !bundles.length) return new Set();

  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge] as const));
  const compare = (left: SpatialEdgeBundle, right: SpatialEdgeBundle) => {
    const leftCross = left.sourceGroup !== left.targetGroup ? 1 : 0;
    const rightCross = right.sourceGroup !== right.targetGroup ? 1 : 0;
    const leftRole = bundleRoleWeight(left, edgeById, nodeRoles);
    const rightRole = bundleRoleWeight(right, edgeById, nodeRoles);
    return rightCross - leftCross
      || right.weight - left.weight
      || rightRole - leftRole
      || left.id.localeCompare(right.id);
  };
  const ranked = bundles.slice().sort(compare);
  const weakComponentByNode = buildWeakComponentIndex(model.nodes, model.edges);
  const bundlesByComponent = new Map<string, SpatialEdgeBundle[]>();
  for (const edge of model.edges) {
    const bundle = bundleByEdgeId.get(edge.id);
    const component = weakComponentByNode.get(edge.source);
    if (!bundle || !component) continue;
    const current = bundlesByComponent.get(component);
    if (current) {
      if (!current.some((candidate) => candidate.id === bundle.id)) current.push(bundle);
    } else {
      bundlesByComponent.set(component, [bundle]);
    }
  }

  const selected = new Set<string>();
  const componentCandidates = [...bundlesByComponent.values()]
    .map((entries) => entries.slice().sort(compare)[0])
    .filter((bundle): bundle is SpatialEdgeBundle => Boolean(bundle))
    .sort(compare);
  for (const bundle of componentCandidates) {
    if (selected.size >= limit) break;
    selected.add(bundle.id);
  }
  for (const bundle of ranked) {
    if (selected.size >= limit) break;
    selected.add(bundle.id);
  }

  // Keep the lookup deterministic even when a model contains directory cores
  // without real edges. The map access also documents that scoring is based on
  // real endpoints rather than display-only cluster nodes.
  void nodeById;
  return selected;
}

function bundleRoleWeight(
  bundle: SpatialEdgeBundle,
  edgeById: Map<string, DependencyGraphEdge>,
  nodeRoles: Map<string, SpatialNodeRoleFlags>
): number {
  const nodeIds = new Set<string>();
  for (const edgeId of bundle.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) continue;
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  let weight = 0;
  for (const nodeId of nodeIds) {
    const role = nodeRoles.get(nodeId);
    if (!role) continue;
    if (role.bridge) weight += 4;
    if (role.hub) weight += 3;
    if (role.cycle) weight += 2;
  }
  return weight;
}

function spatialNodeGroup(node: DependencyGraphNode, level: DependencyGraphLevel): string {
  if (level.mode === "overview") return node.directory || (node.path ? topLevelArea(node.path) : node.label);
  return node.path ? projectDirname(node.path) || node.directory || level.directory : node.directory || node.label;
}

function findArticulationPoints(
  nodes: DependencyGraphNode[],
  edges: DependencyGraphEdge[]
): Set<string> {
  const adjacency = buildUndirectedAdjacency(nodes, edges);
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const articulation = new Set<string>();
  let time = 0;

  const visit = (nodeId: string) => {
    discovery.set(nodeId, time);
    low.set(nodeId, time);
    time += 1;
    let children = 0;
    for (const neighbor of adjacency.get(nodeId) || []) {
      if (!discovery.has(neighbor)) {
        parent.set(neighbor, nodeId);
        children += 1;
        visit(neighbor);
        low.set(nodeId, Math.min(low.get(nodeId) as number, low.get(neighbor) as number));
        if (parent.get(nodeId) === null && children > 1) articulation.add(nodeId);
        if (parent.get(nodeId) !== null && (low.get(neighbor) as number) >= (discovery.get(nodeId) as number)) {
          articulation.add(nodeId);
        }
      } else if (neighbor !== parent.get(nodeId)) {
        low.set(nodeId, Math.min(low.get(nodeId) as number, discovery.get(neighbor) as number));
      }
    }
  };

  for (const nodeId of [...adjacency.keys()].sort((left, right) => left.localeCompare(right))) {
    if (discovery.has(nodeId)) continue;
    parent.set(nodeId, null);
    visit(nodeId);
  }
  return articulation;
}

function buildWeakComponentIndex(
  nodes: DependencyGraphNode[],
  edges: DependencyGraphEdge[]
): Map<string, string> {
  const adjacency = buildUndirectedAdjacency(nodes, edges);
  const componentByNode = new Map<string, string>();
  for (const start of [...adjacency.keys()].sort((left, right) => left.localeCompare(right))) {
    if (componentByNode.has(start)) continue;
    const pending = [start];
    const members: string[] = [];
    componentByNode.set(start, start);
    while (pending.length) {
      const nodeId = pending.shift() as string;
      members.push(nodeId);
      for (const neighbor of adjacency.get(nodeId) || []) {
        if (componentByNode.has(neighbor)) continue;
        componentByNode.set(neighbor, start);
        pending.push(neighbor);
      }
    }
    const componentId = members.sort((left, right) => left.localeCompare(right))[0];
    for (const member of members) componentByNode.set(member, componentId);
  }
  return componentByNode;
}

function buildUndirectedAdjacency(
  nodes: DependencyGraphNode[],
  edges: DependencyGraphEdge[]
): Map<string, string[]> {
  const adjacencySets = new Map(nodes.map((node) => [node.id, new Set<string>()] as const));
  for (const edge of edges) {
    if (!adjacencySets.has(edge.source) || !adjacencySets.has(edge.target)) continue;
    if (edge.source !== edge.target) {
      adjacencySets.get(edge.source)?.add(edge.target);
      adjacencySets.get(edge.target)?.add(edge.source);
    }
  }
  return new Map([...adjacencySets].map(([nodeId, neighbors]) => [
    nodeId,
    [...neighbors].sort((left, right) => left.localeCompare(right))
  ]));
}

function buildSpatialRoutes(
  edges: DependencyGraphEdge[],
  positions: Map<string, Position3D>,
  bundleByEdgeId: Map<string, SpatialEdgeBundle>,
  componentByNodeId: Map<string, string>,
  componentSizeById: Map<string, number>,
  segments: number
): Map<string, Position3D[]> {
  const routes = new Map<string, Position3D[]>();
  for (const edge of edges.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) continue;
    const componentId = componentByNodeId.get(edge.source);
    const localCycle = edge.source === edge.target || (
      componentId !== undefined
      && componentId === componentByNodeId.get(edge.target)
      && (componentSizeById.get(componentId) || 0) > 1
    );
    if (localCycle) {
      routes.set(edge.id, sampleLocalCycleRoute(source, target, edge.id, segments));
      continue;
    }

    const bundle = bundleByEdgeId.get(edge.id);
    if (!bundle || bundle.route.length < 5) {
      routes.set(edge.id, sampleQuarticRoute([
        source,
        lerp3(source, target, 0.25),
        lerp3(source, target, 0.5),
        lerp3(source, target, 0.75),
        target
      ], segments));
      continue;
    }
    const sourceDelta = subtract3(source, bundle.route[0]);
    const targetDelta = subtract3(target, bundle.route[4]);
    routes.set(edge.id, sampleQuarticRoute([
      source,
      add3(bundle.route[1], scale3(sourceDelta, 0.42)),
      bundle.route[2],
      add3(bundle.route[3], scale3(targetDelta, 0.42)),
      target
    ], segments));
  }
  return routes;
}

function sampleLocalCycleRoute(
  source: Position3D,
  target: Position3D,
  seed: string,
  segments: number
): Position3D[] {
  const direction = subtract3(target, source);
  const distance = Math.hypot(direction.x, direction.y, direction.z);
  const reference = stableUnitVector(`${seed}|cycle-axis`);
  const normalized = distance > 0.001 ? scale3(direction, 1 / distance) : stableUnitVector(`${seed}|loop-direction`);
  let normal = cross3(normalized, reference);
  let normalLength = Math.hypot(normal.x, normal.y, normal.z);
  if (normalLength < 0.05) {
    normal = cross3(normalized, { x: 0, y: 1, z: 0 });
    normalLength = Math.hypot(normal.x, normal.y, normal.z);
  }
  normal = scale3(normal, 1 / Math.max(normalLength, 0.001));
  const tangent = cross3(normalized, normal);
  const radius = Math.max(22, distance * 0.65);
  const midpoint = lerp3(source, target, 0.5);
  const loopTarget = distance < 0.001 ? source : target;
  return sampleQuarticRoute([
    source,
    add3(midpoint, scale3(normal, radius)),
    add3(midpoint, scale3(tangent, radius * 0.72)),
    add3(midpoint, scale3(normal, -radius)),
    loopTarget
  ], segments);
}

function sampleQuarticRoute(controls: Position3D[], segments: number): Position3D[] {
  const [p0, p1, p2, p3, p4] = controls;
  const points: Position3D[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const inverse = 1 - t;
    const b0 = inverse ** 4;
    const b1 = 4 * inverse ** 3 * t;
    const b2 = 6 * inverse ** 2 * t ** 2;
    const b3 = 4 * inverse * t ** 3;
    const b4 = t ** 4;
    points.push({
      x: p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3 + p4.x * b4,
      y: p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3 + p4.y * b4,
      z: p0.z * b0 + p1.z * b1 + p2.z * b2 + p3.z * b3 + p4.z * b4
    });
  }
  return points;
}

function averagePoint(points: Position3D[]): Position3D {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  const sum = points.reduce((current, point) => ({
    x: current.x + point.x,
    y: current.y + point.y,
    z: current.z + point.z
  }), { x: 0, y: 0, z: 0 });
  return scale3(sum, 1 / points.length);
}

function lerp3(source: Position3D, target: Position3D, amount: number): Position3D {
  return {
    x: source.x + (target.x - source.x) * amount,
    y: source.y + (target.y - source.y) * amount,
    z: source.z + (target.z - source.z) * amount
  };
}

function add3(left: Position3D, right: Position3D): Position3D {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract3(left: Position3D, right: Position3D): Position3D {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale3(point: Position3D, amount: number): Position3D {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}

function measureSpatialBounds(points: Position3D[]): SpatialBounds {
  const finitePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  if (!finitePoints.length) {
    const origin = { x: 0, y: 0, z: 0 };
    return { min: origin, max: origin, center: origin, size: origin };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of finitePoints) {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
    max.z = Math.max(max.z, point.z);
  }
  return {
    min,
    max,
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }
  };
}

function boundsFromExtents(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number
): SpatialBounds {
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ }
  };
}

function spatialDirectoryGroup(node: DependencyGraphNode, fallback: string): string {
  return node.path ? projectDirname(node.path) || fallback : node.directory || fallback;
}

function fibonacciSpherePoint(index: number, count: number, radius: number, seed: string): Position3D {
  const direction = fibonacciUnitVector(index, count, seed);
  return { x: direction.x * radius, y: direction.y * radius, z: direction.z * radius };
}

function fibonacciUnitVector(index: number, count: number, seed: string): Position3D {
  const safeCount = Math.max(1, count);
  const y = 1 - 2 * ((index + 0.5) / safeCount);
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * Math.PI * (3 - Math.sqrt(5)) + stableUnit(`${seed}|rotation`) * Math.PI * 2;
  return { x: Math.cos(theta) * radial, y, z: Math.sin(theta) * radial };
}

function stableUnitVector(seed: string): Position3D {
  const y = stableUnit(`${seed}|y`) * 2 - 1;
  const radial = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = stableUnit(`${seed}|theta`) * Math.PI * 2;
  return { x: Math.cos(theta) * radial, y, z: Math.sin(theta) * radial };
}

function stableUnit(seed: string): number {
  return parseInt(hashString(seed), 36) / 0xffffffff;
}

function stableBandOffset(seed: string, maximum: number): number {
  const normalized = stableUnit(seed) * 2 - 1;
  const sign = normalized < 0 ? -1 : 1;
  return sign * (4 + Math.abs(normalized) * Math.max(0, maximum - 4));
}

function cross3(left: Position3D, right: Position3D): Position3D {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x
  };
}

export function toCytoscapeElements(model: DependencyGraphModel): ElementDefinition[] {
  const nodes: ElementDefinition[] = model.nodes.map((node) => ({
    classes: node.searchMatch ? "is-search-match" : undefined,
    data: {
      id: node.id,
      label: node.label,
      kind: node.kind,
      path: node.path,
      directory: node.directory,
      language: node.language,
      isolated: node.isolated,
      risk: node.risk,
      fileCount: node.fileCount,
      inDegree: node.inDegree,
      outDegree: node.outDegree,
      degree: node.degree,
      searchMatch: node.searchMatch
    }
  }));
  const edges: ElementDefinition[] = model.edges.map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      dependencyKind: edge.dependencyKind,
      count: edge.count,
      edgeLabel: edge.count && edge.count > 1 ? String(edge.count) : "",
      sourcePath: edge.sourcePath,
      targetPath: edge.targetPath,
      targetLabel: edge.targetLabel,
      line: edge.line
    }
  }));
  return [...nodes, ...edges];
}

export function fileNodeId(path: string): string {
  return `file:${hashString(normalizeProjectPath(path))}`;
}

function buildDirectoryOverview(
  workspace: WorkspaceDetail,
  dependencies: ResolvedDependency[]
): DependencyGraphModel {
  const directoryFiles = new Map<string, number>();
  for (const file of workspace.files) {
    const directory = topLevelArea(file.path);
    directoryFiles.set(directory, (directoryFiles.get(directory) || 0) + 1);
  }

  const edgeGroups = new Map<string, { source: string; target: string; count: number }>();
  for (const dependency of dependencies) {
    const sourceFile = dependency.sourceFile;
    const targetFile = dependency.targetFile;
    if (!sourceFile || !targetFile) continue;
    const source = topLevelArea(sourceFile.path);
    const target = topLevelArea(targetFile.path);
    if (source === target) continue;
    const key = `${source}|${target}`;
    const current = edgeGroups.get(key);
    if (current) current.count += 1;
    else edgeGroups.set(key, { source, target, count: 1 });
  }

  const nodes: DependencyGraphNode[] = [...directoryFiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([directory, fileCount]) => ({
      id: directoryNodeId(directory),
      label: directory,
      directory,
      kind: "directory",
      fileCount,
      inDegree: 0,
      outDegree: 0,
      degree: 0
    }));
  const edges: DependencyGraphEdge[] = [...edgeGroups.values()]
    .sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target))
    .map((edge) => {
      const source = directoryNodeId(edge.source);
      const target = directoryNodeId(edge.target);
      return {
        id: `directory-edge:${hashString(`${edge.source}|${edge.target}`)}`,
        source,
        target,
        count: edge.count,
        kind: "directory-edge"
      };
    });
  applyDegrees(nodes, edges);

  return {
    nodes,
    edges,
    fileCount: directoryFiles.size,
    totalFileCount: workspace.files.length,
    connectedFileCount: workspace.files.length,
    isolatedFileCount: 0,
    edgeCount: edges.length,
    dense: directoryFiles.size > 24
  };
}

function buildSpatialOverview(
  workspace: WorkspaceDetail,
  dependencies: ResolvedDependency[]
): DependencyGraphModel {
  const fileByPath = new Map<string, WorkspaceFile>();
  for (const file of workspace.files) {
    const normalizedPath = normalizeProjectPath(file.path);
    if (!fileByPath.has(normalizedPath)) fileByPath.set(normalizedPath, file);
  }
  const files = [...fileByPath.values()]
    .sort((left, right) => normalizeProjectPath(left.path).localeCompare(normalizeProjectPath(right.path)));
  const directoryFiles = new Map<string, WorkspaceFile[]>();
  for (const file of files) {
    const directory = topLevelArea(file.path);
    const current = directoryFiles.get(directory);
    if (current) current.push(file);
    else directoryFiles.set(directory, [file]);
  }

  const edgeByKey = new Map<string, DependencyGraphEdge>();
  const connectedPaths = new Set<string>();
  for (const dependency of dependencies) {
    const sourceFile = dependency.sourceFile;
    const targetFile = dependency.targetFile;
    if (!sourceFile || !targetFile) continue;
    const sourcePath = normalizeProjectPath(sourceFile.path);
    const targetPath = normalizeProjectPath(targetFile.path);
    if (!fileByPath.has(sourcePath) || !fileByPath.has(targetPath)) continue;
    connectedPaths.add(sourcePath);
    connectedPaths.add(targetPath);
    const source = fileNodeId(sourcePath);
    const target = fileNodeId(targetPath);
    const key = `${source}|${target}|${dependency.kind}`;
    if (edgeByKey.has(key)) continue;
    edgeByKey.set(key, {
      id: `edge:${hashString(key)}`,
      source,
      target,
      kind: "file-edge",
      dependencyKind: dependency.kind,
      sourcePath: sourceFile.path,
      targetPath: targetFile.path,
      targetLabel: dependency.target,
      line: dependency.line
    });
  }

  const nodes: DependencyGraphNode[] = [];
  for (const [directory, directoryEntries] of [...directoryFiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    nodes.push({
      id: directoryNodeId(directory),
      label: directory,
      directory,
      kind: "directory",
      fileCount: directoryEntries.length,
      inDegree: 0,
      outDegree: 0,
      degree: 0
    });
    for (const file of directoryEntries) {
      nodes.push(fileNode(file, directory, !connectedPaths.has(normalizeProjectPath(file.path))));
    }
  }
  const edges = [...edgeByKey.values()].sort((left, right) => left.id.localeCompare(right.id));
  applyDegrees(nodes, edges);

  return {
    nodes,
    edges,
    fileCount: files.length,
    totalFileCount: files.length,
    connectedFileCount: connectedPaths.size,
    isolatedFileCount: Math.max(0, files.length - connectedPaths.size),
    edgeCount: edges.length,
    dense: nodes.length > 24
  };
}

function buildDirectoryFocus(
  workspace: WorkspaceDetail,
  dependencies: ResolvedDependency[],
  directory: string,
  showIsolated: boolean
): DependencyGraphModel {
  const files = workspace.files
    .filter((file) => topLevelArea(file.path) === directory)
    .slice()
    .sort((left, right) => normalizeProjectPath(left.path).localeCompare(normalizeProjectPath(right.path)));
  const filePaths = new Set(files.map((file) => normalizeProjectPath(file.path)));
  const connectedPaths = new Set<string>();
  const boundaryDirectories = new Set<string>();
  const edgeByKey = new Map<string, DependencyGraphEdge>();

  for (const dependency of dependencies) {
    const sourceFile = dependency.sourceFile;
    const targetFile = dependency.targetFile;
    if (!sourceFile || !targetFile) continue;
    const normalizedSource = normalizeProjectPath(sourceFile.path);
    const normalizedTarget = normalizeProjectPath(targetFile.path);
    const sourceInside = filePaths.has(normalizedSource);
    const targetInside = filePaths.has(normalizedTarget);
    if (!sourceInside && !targetInside) continue;

    if (sourceInside) connectedPaths.add(normalizedSource);
    if (targetInside) connectedPaths.add(normalizedTarget);

    const sourceDirectory = topLevelArea(sourceFile.path);
    const targetDirectory = topLevelArea(targetFile.path);
    if (!sourceInside) boundaryDirectories.add(sourceDirectory);
    if (!targetInside) boundaryDirectories.add(targetDirectory);

    const source = sourceInside ? fileNodeId(sourceFile.path) : boundaryNodeId(sourceDirectory);
    const target = targetInside ? fileNodeId(targetFile.path) : boundaryNodeId(targetDirectory);
    const key = `${source}|${target}|${dependency.kind}`;
    if (edgeByKey.has(key)) continue;
    edgeByKey.set(key, {
      id: `edge:${hashString(key)}`,
      source,
      target,
      kind: "file-edge",
      dependencyKind: dependency.kind,
      sourcePath: sourceFile.path,
      targetPath: targetFile.path,
      targetLabel: dependency.target,
      line: dependency.line
    });
  }

  const visibleFiles = showIsolated
    ? files
    : files.filter((file) => connectedPaths.has(normalizeProjectPath(file.path)));
  const nodes: DependencyGraphNode[] = visibleFiles.map((file) => fileNode(
    file,
    directory,
    !connectedPaths.has(normalizeProjectPath(file.path))
  ));
  for (const boundary of [...boundaryDirectories].sort((left, right) => left.localeCompare(right))) {
    nodes.push({
      id: boundaryNodeId(boundary),
      label: boundary,
      directory: boundary,
      kind: "boundary",
      inDegree: 0,
      outDegree: 0,
      degree: 0
    });
  }
  const edges = [...edgeByKey.values()].sort((left, right) => left.id.localeCompare(right.id));
  applyDegrees(nodes, edges);

  return {
    nodes,
    edges,
    fileCount: visibleFiles.length,
    totalFileCount: files.length,
    connectedFileCount: connectedPaths.size,
    isolatedFileCount: Math.max(0, files.length - connectedPaths.size),
    edgeCount: edges.length,
    dense: visibleFiles.length + boundaryDirectories.size > 24
  };
}

function fileNode(file: WorkspaceFile, directory: string, isolated: boolean): DependencyGraphNode {
  return {
    id: fileNodeId(file.path),
    label: projectBasename(file.path),
    path: file.path,
    directory,
    language: file.language || "文本",
    kind: "file",
    isolated,
    risk: file.metrics.risk_count,
    inDegree: 0,
    outDegree: 0,
    degree: 0
  };
}

function applyDegrees(nodes: DependencyGraphNode[], edges: DependencyGraphEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source) source.outDegree += 1;
    if (target) target.inDegree += 1;
  }
  for (const node of nodes) node.degree = node.inDegree + node.outDegree;
}

function buildComponents(
  nodes: DependencyGraphNode[],
  edges: DependencyGraphEdge[],
  nodeById: Map<string, DependencyGraphNode>
): Component[] {
  if (!nodes.length) return [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => left.localeCompare(right));
    for (let index = neighbors.length - 1; index > 0; index -= 1) {
      if (neighbors[index] === neighbors[index - 1]) neighbors.splice(index, 1);
    }
  }

  const rawComponents = tarjan([...nodeIds].sort((left, right) => left.localeCompare(right)), adjacency)
    .map((members) => members.sort((left, right) => left.localeCompare(right)))
    .sort((left, right) => left[0].localeCompare(right[0]));
  const componentIndexByNode = new Map<string, number>();
  rawComponents.forEach((members, componentIndex) => {
    members.forEach((nodeId) => componentIndexByNode.set(nodeId, componentIndex));
  });

  const outgoing = rawComponents.map(() => new Set<number>());
  const incomingCount = rawComponents.map(() => 0);
  for (const edge of edges) {
    const source = componentIndexByNode.get(edge.source);
    const target = componentIndexByNode.get(edge.target);
    if (source === undefined || target === undefined || source === target || outgoing[source].has(target)) continue;
    outgoing[source].add(target);
    incomingCount[target] += 1;
  }

  const componentKeys = rawComponents.map((members) => members[0]);
  const ready = incomingCount
    .map((count, index) => ({ count, index }))
    .filter(({ count }) => count === 0)
    .map(({ index }) => index)
    .sort((left, right) => componentKeys[left].localeCompare(componentKeys[right]));
  const layers = rawComponents.map(() => 0);
  while (ready.length) {
    const source = ready.shift() as number;
    const targets = [...outgoing[source]].sort((left, right) => componentKeys[left].localeCompare(componentKeys[right]));
    for (const target of targets) {
      layers[target] = Math.max(layers[target], layers[source] + 1);
      incomingCount[target] -= 1;
      if (incomingCount[target] === 0) {
        ready.push(target);
        ready.sort((left, right) => componentKeys[left].localeCompare(componentKeys[right]));
      }
    }
  }

  return rawComponents.map((members, index) => ({
    id: members[0],
    nodeIds: members,
    layer: layers[index],
    group: componentGroup(members, nodeById)
  }));
}

function tarjan(nodeIds: string[], adjacency: Map<string, string[]>): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (nodeId: string) => {
    indices.set(nodeId, nextIndex);
    lowLinks.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const target of adjacency.get(nodeId) || []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) as number, lowLinks.get(target) as number));
      } else if (onStack.has(target)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) as number, indices.get(target) as number));
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop() as string;
      onStack.delete(member);
      component.push(member);
    } while (member !== nodeId);
    components.push(component);
  };

  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) visit(nodeId);
  }
  return components;
}

function componentGroup(members: string[], nodeById: Map<string, DependencyGraphNode>): string {
  const groups = members.map((nodeId) => {
    const node = nodeById.get(nodeId);
    if (!node) return "";
    if (node.kind === "file" && node.path) return projectDirname(node.path) || node.directory || "根目录";
    return `${node.kind}:${node.directory || node.label}`;
  });
  groups.sort((left, right) => left.localeCompare(right));
  return groups[0] || "根目录";
}

function compactSpiralPoint(index: number, count: number): { x: number; y: number } {
  if (count <= 1 || index === 0) return { x: 0, y: 0 };
  const angle = index * 2.399963229728653;
  const radius = 34 * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function compareDependencies(left: ResolvedDependency, right: ResolvedDependency): number {
  const leftSource = normalizeProjectPath(left.sourceFile?.path || left.source_path);
  const rightSource = normalizeProjectPath(right.sourceFile?.path || right.source_path);
  const leftTarget = normalizeProjectPath(left.targetFile?.path || left.target);
  const rightTarget = normalizeProjectPath(right.targetFile?.path || right.target);
  return leftSource.localeCompare(rightSource)
    || leftTarget.localeCompare(rightTarget)
    || left.kind.localeCompare(right.kind)
    || left.line - right.line
    || left.id.localeCompare(right.id);
}

function directoryNodeId(directory: string): string {
  return `directory:${hashString(directory.toLocaleLowerCase())}`;
}

function boundaryNodeId(directory: string): string {
  return `boundary:${hashString(directory.toLocaleLowerCase())}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
