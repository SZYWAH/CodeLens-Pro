import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true }
});

try {
  const {
    buildDependencyGraphModel,
    buildDependencySpatialModel,
    fileNodeId,
    filterDependencyGraphModel,
    layoutDependencyGraph,
    layoutDependencyGraphSpatial
  } = await server.ssrLoadModule("/src/components/projectDependencyGraphModel.ts");
  const {
    layoutSpatialLabels,
    spatialLabelLimit
  } = await server.ssrLoadModule("/src/components/dependencyGraphLabelLayout.ts");

  const workA = file("work/src/a.ts");
  const workB = file("work/src/b.ts");
  const workC = file("work/src/c.ts");
  const workD = file("work/src/d.ts");
  const docsReadme = file("docs/readme.ts", "Markdown");
  const workspace = { files: [workD, docsReadme, workB, workA, workC] };
  const dependencies = [
    dependency("a-b-2", workA, workB, "import", 8),
    dependency("c-docs", workC, docsReadme, "import", 5),
    dependency("b-c", workB, workC, "import", 4),
    dependency("b-a", workB, workA, "import", 3),
    dependency("a-b-1", workA, workB, "import", 2),
    dependency("a-docs", workA, docsReadme, "import", 9)
  ];

  test("deduplicates identical directed file dependencies", () => {
    const model = buildDependencyGraphModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      false
    );
    assert.equal(model.edgeCount, 5);
    assert.equal(model.edges.filter((edge) => edge.source === fileNodeId(workA.path)
      && edge.target === fileNodeId(workB.path)).length, 1);
  });

  test("aggregates the project overview by top-level directory", () => {
    const model = buildDependencyGraphModel(workspace, dependencies, { mode: "overview" }, false);
    assert.equal(model.nodes.length, 2);
    assert.equal(model.edges.length, 1);
    assert.equal(model.edges[0].count, 2);
    assert.deepEqual(
      model.nodes.map((node) => [node.label, node.fileCount]).sort(),
      [["docs", 1], ["work", 4]]
    );
  });

  test("keeps cycle members on one Z layer and places downstream nodes deeper", () => {
    const model = buildDependencyGraphModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      false
    );
    const positions = layoutDependencyGraph(model, { mode: "directory", directory: "work" });
    const a = positions.get(fileNodeId(workA.path));
    const b = positions.get(fileNodeId(workB.path));
    const c = positions.get(fileNodeId(workC.path));
    assert.ok(a && b && c);
    assert.equal(a.z, b.z);
    assert.ok(c.z > a.z);
    assert.notDeepEqual(a, b);
  });

  test("respects the isolated-file switch and places isolated nodes outside", () => {
    const hidden = buildDependencyGraphModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      false
    );
    const shown = buildDependencyGraphModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      true
    );
    assert.equal(hidden.fileCount, 3);
    assert.equal(hidden.isolatedFileCount, 1);
    assert.equal(shown.fileCount, 4);
    const isolated = shown.nodes.find((node) => node.id === fileNodeId(workD.path));
    assert.equal(isolated?.isolated, true);

    const positions = layoutDependencyGraph(shown, { mode: "directory", directory: "work" });
    const isolatedPosition = positions.get(fileNodeId(workD.path));
    const connectedRadii = [workA, workB, workC]
      .map((entry) => positions.get(fileNodeId(entry.path)))
      .filter(Boolean)
      .map((position) => Math.hypot(position.x, position.y));
    assert.ok(isolatedPosition);
    assert.ok(Math.hypot(isolatedPosition.x, isolatedPosition.y) > Math.max(...connectedRadii));
  });

  test("produces stable coordinates regardless of dependency input order", () => {
    const first = buildDependencyGraphModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      true
    );
    const second = buildDependencyGraphModel(
      workspace,
      dependencies.slice().reverse(),
      { mode: "directory", directory: "work" },
      true
    );
    assert.deepEqual(
      serializePositions(layoutDependencyGraph(first, { mode: "directory", directory: "work" })),
      serializePositions(layoutDependencyGraph(second, { mode: "directory", directory: "work" }))
    );
  });

  test("applies search filtering to the shared model", () => {
    const model = buildDependencyGraphModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      false
    );
    const filtered = filterDependencyGraphModel(model, "c.ts", "all", "directory");
    assert.equal(filtered.fileCount, 1);
    assert.equal(filtered.nodes.find((node) => node.kind === "file")?.searchMatch, true);
    assert.equal(filtered.edgeCount, 1);
  });

  test("keeps every real file and de-duplicated file edge in the spatial overview", () => {
    const model = buildDependencySpatialModel(workspace, dependencies, { mode: "overview" }, true);
    const files = model.nodes.filter((node) => node.kind === "file");
    const directories = model.nodes.filter((node) => node.kind === "directory");
    assert.equal(files.length, workspace.files.length);
    assert.equal(directories.length, 2);
    assert.equal(model.edges.length, 5);
    assert.ok(model.edges.every((edge) => edge.kind === "file-edge"));

    const layout = layoutDependencyGraphSpatial(model, { mode: "overview" });
    const workCluster = layout.clusters.find((cluster) => cluster.id === "work");
    const workCore = directories.find((node) => node.directory === "work");
    assert.ok(workCluster && workCore);
    assert.ok(workCluster.nodeIds.includes(workCore.id));
    assert.equal(layout.positions.size, model.nodes.length);
  });

  test("uses Y dependency layers and a tilted volumetric SCC ring", () => {
    const model = buildDependencySpatialModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      false
    );
    const layout = layoutDependencyGraphSpatial(model, { mode: "directory", directory: "work" });
    const a = layout.positions.get(fileNodeId(workA.path));
    const b = layout.positions.get(fileNodeId(workB.path));
    const c = layout.positions.get(fileNodeId(workC.path));
    assert.ok(a && b && c);
    const cycleCenterY = (a.y + b.y) / 2;
    assert.ok(cycleCenterY > c.y);
    assert.notEqual(a.y, b.y);
    assert.notEqual(a.z, b.z);
    assert.equal(layout.layers.length, 2);
    assert.equal(layout.layers[0].centerY - layout.layers[1].centerY, 80);
    assert.equal(layout.layers[0].minY - layout.layers[1].maxY, 32);
    assert.ok(Math.abs(a.y - layout.layers[0].centerY) <= 24);
    assert.ok(Math.abs(b.y - layout.layers[0].centerY) <= 24);
    assert.ok(Math.abs(c.y - layout.layers[1].centerY) <= 24);
    assert.notEqual(c.y, layout.layers[1].centerY);
    assert.equal(layout.diagnostics.nonCoplanarLayerCount, 2);
    assert.ok(layout.diagnostics.layerYSpans.every((span) => span > 0));
  });

  test("produces three-axis volume diagnostics and curved eight-segment routes", () => {
    const model = buildDependencySpatialModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      true
    );
    const layout = layoutDependencyGraphSpatial(model, { mode: "directory", directory: "work" });
    assert.ok(layout.diagnostics.axisExtents.every((extent) => extent > 0));
    assert.ok(layout.diagnostics.volumeRatio >= 0.32);
    assert.equal(layout.version, "spatial-v2.1.0");

    const route = layout.routes.values().next().value;
    assert.ok(route);
    assert.equal(route.length, 9);
    const midpoint = route[4];
    const chordMidpoint = {
      x: (route[0].x + route[8].x) / 2,
      y: (route[0].y + route[8].y) / 2,
      z: (route[0].z + route[8].z) / 2
    };
    assert.ok(Math.hypot(
      midpoint.x - chordMidpoint.x,
      midpoint.y - chordMidpoint.y,
      midpoint.z - chordMidpoint.z
    ) > 1);
  });

  test("places boundaries and isolated files on deterministic outer ellipsoid shells", () => {
    const model = buildDependencySpatialModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      true
    );
    const layout = layoutDependencyGraphSpatial(model, { mode: "directory", directory: "work" });
    const connectedPositions = model.nodes
      .filter((node) => node.kind === "file" && !node.isolated)
      .map((node) => layout.positions.get(node.id));
    const frame = shellFrame(connectedPositions);
    const boundary = model.nodes.find((node) => node.kind === "boundary");
    const isolated = model.nodes.find((node) => node.isolated);
    assert.ok(boundary && isolated);
    assert.ok(Math.abs(normalizedShellRadius(layout.positions.get(boundary.id), frame) - 1.18) < 1e-10);
    assert.ok(Math.abs(normalizedShellRadius(layout.positions.get(isolated.id), frame) - 1.35) < 1e-10);
    assert.equal(layout.clusters.find((cluster) => cluster.kind === "boundary")?.nodeIds.length, 1);
    assert.equal(layout.clusters.find((cluster) => cluster.kind === "isolated")?.nodeIds.length, 1);
  });

  test("keeps connected spatial coordinates stable across input order and isolation visibility", () => {
    const visible = buildDependencySpatialModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      true
    );
    const hidden = buildDependencySpatialModel(
      { files: workspace.files.slice().reverse() },
      dependencies.slice().reverse(),
      { mode: "directory", directory: "work" },
      false
    );
    const visibleLayout = layoutDependencyGraphSpatial(visible, { mode: "directory", directory: "work" });
    const hiddenLayout = layoutDependencyGraphSpatial(hidden, { mode: "directory", directory: "work" });
    for (const entry of [workA, workB, workC]) {
      assert.deepEqual(
        visibleLayout.positions.get(fileNodeId(entry.path)),
        hiddenLayout.positions.get(fileNodeId(entry.path))
      );
    }
    assert.deepEqual(
      serializePositions(visibleLayout.routes),
      serializePositions(layoutDependencyGraphSpatial(
        buildDependencySpatialModel(workspace, dependencies.slice().reverse(), { mode: "directory", directory: "work" }, true),
        { mode: "directory", directory: "work" }
      ).routes)
    );
  });

  test("classifies SCC cycles, self loops, hubs, leaves and articulation bridges", () => {
    const chainFiles = ["a", "b", "c", "d", "loop"].map((name) => file(`work/chain/${name}.ts`));
    const chainWorkspace = { files: chainFiles };
    const chainDependencies = [
      dependency("a-b", chainFiles[0], chainFiles[1], "import", 1),
      dependency("b-c", chainFiles[1], chainFiles[2], "import", 1),
      dependency("c-d", chainFiles[2], chainFiles[3], "import", 1),
      dependency("loop", chainFiles[4], chainFiles[4], "import", 1)
    ];
    const model = buildDependencySpatialModel(
      chainWorkspace,
      chainDependencies,
      { mode: "directory", directory: "work" },
      true
    );
    const layout = layoutDependencyGraphSpatial(model, { mode: "directory", directory: "work" });
    const role = (entry) => layout.nodeRoles.get(fileNodeId(entry.path));
    assert.equal(role(chainFiles[4]).cycle, true);
    assert.equal(role(chainFiles[0]).leaf, true);
    assert.equal(role(chainFiles[1]).bridge, true);
    assert.equal(role(chainFiles[2]).bridge, true);
    assert.equal(role(chainFiles[4]).leaf, false);
  });

  test("builds stable semantic bundles with five control points and bounded lanes", () => {
    const model = buildDependencySpatialModel(
      workspace,
      dependencies,
      { mode: "directory", directory: "work" },
      true
    );
    const layout = layoutDependencyGraphSpatial(model, { mode: "directory", directory: "work" });
    assert.equal(layout.diagnostics.fullEdgeCount, model.edges.length);
    assert.equal(layout.diagnostics.bundleCount, layout.bundles.length);
    assert.equal(layout.diagnostics.backboneBundleCount, layout.backboneBundleIds.size);
    assert.ok(layout.bundles.every((bundle) => bundle.route.length === 5));
    assert.ok(layout.bundles.every((bundle) => {
      const midpoint = {
        x: (bundle.route[0].x + bundle.route[4].x) / 2,
        y: (bundle.route[0].y + bundle.route[4].y) / 2,
        z: (bundle.route[0].z + bundle.route[4].z) / 2
      };
      return Math.hypot(bundle.route[2].x - midpoint.x, bundle.route[2].z - midpoint.z) <= 56.0000001
        && Math.abs(bundle.route[2].y - midpoint.y) <= 18.0000001;
    }));
    assert.ok(layout.bundles.some((bundle) => {
      const midpointY = (bundle.route[0].y + bundle.route[4].y) / 2;
      return Math.abs(bundle.route[2].y - midpointY) > 0.01;
    }));

    const reversed = layoutDependencyGraphSpatial(
      buildDependencySpatialModel(
        { files: workspace.files.slice().reverse() },
        dependencies.slice().reverse(),
        { mode: "directory", directory: "work" },
        true
      ),
      { mode: "directory", directory: "work" }
    );
    assert.deepEqual(serializeBundles(layout.bundles), serializeBundles(reversed.bundles));
    assert.deepEqual([...layout.backboneBundleIds].sort(), [...reversed.backboneBundleIds].sort());
  });

  test("caps a 38-edge directory backbone at twelve bundles", () => {
    const files = Array.from({ length: 39 }, (_, index) => file(`work/flow/f${String(index).padStart(2, "0")}.ts`));
    const edges = files.slice(0, -1).map((source, index) =>
      dependency(`flow-${index}`, source, files[index + 1], "import", index + 1)
    );
    const model = buildDependencySpatialModel(
      { files },
      edges,
      { mode: "directory", directory: "work" },
      false
    );
    const layout = layoutDependencyGraphSpatial(model, { mode: "directory", directory: "work" });
    assert.equal(model.edges.length, 38);
    assert.equal(layout.bundles.length, 38);
    assert.equal(layout.backboneBundleIds.size, 12);
    assert.ok([...layout.backboneBundleIds].every((bundleId) => layout.bundles.some((bundle) => bundle.id === bundleId)));
  });

  test("uses all-file labels through 30 files and semantic LOD caps above it", () => {
    assert.equal(spatialLabelLimit(22, "far"), 22);
    assert.equal(spatialLabelLimit(30, "mid"), 30);
    assert.equal(spatialLabelLimit(31, "far"), 10);
    assert.equal(spatialLabelLimit(31, "mid"), 18);
    assert.equal(spatialLabelLimit(31, "near"), 30);
  });

  test("moves labels through alternate anchors before hiding collisions", () => {
    const labels = [
      { id: "first", x: 100, y: 100, width: 48, height: 16 },
      { id: "second", x: 100, y: 100, width: 48, height: 16 },
      { id: "forced", x: 100, y: 100, width: 48, height: 16, forced: true }
    ];
    const result = layoutSpatialLabels(labels, 240, 200);
    assert.equal(result.placed.length, 3);
    assert.notEqual(result.placed[0].anchorIndex, result.placed[1].anchorIndex);
    assert.equal(result.placed[2].anchorIndex, 0);
    assert.equal(result.collisionHiddenCount, 0);
  });

  console.log("Dependency graph model tests passed.");
} finally {
  await server.close();
}

function test(name, run) {
  run();
  console.log(`\u2713 ${name}`);
}

function file(filePath, language = "TypeScript") {
  return {
    id: filePath,
    path: filePath,
    language,
    metrics: { risk_count: 0 }
  };
}

function dependency(id, sourceFile, targetFile, kind, line) {
  return {
    id,
    source_path: sourceFile.path,
    target: targetFile.path,
    kind,
    line,
    sourceFile,
    targetFile
  };
}

function serializePositions(positions) {
  return [...positions.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function serializeBundles(bundles) {
  return bundles.map((bundle) => ({
    ...bundle,
    edgeIds: bundle.edgeIds.slice(),
    route: bundle.route.map((point) => ({ ...point }))
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function shellFrame(points) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of points) {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
    max.z = Math.max(max.z, point.z);
  }
  return {
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2
    },
    radii: {
      x: Math.max(90, (max.x - min.x) / 2 + 48),
      y: Math.max(90, (max.y - min.y) / 2 + 48),
      z: Math.max(90, (max.z - min.z) / 2 + 48)
    }
  };
}

function normalizedShellRadius(point, frame) {
  return Math.hypot(
    (point.x - frame.center.x) / frame.radii.x,
    (point.y - frame.center.y) / frame.radii.y,
    (point.z - frame.center.z) / frame.radii.z
  );
}
