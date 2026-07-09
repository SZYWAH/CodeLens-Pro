import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ActivityGalaxyData, ActivityNode, ActivitySummary } from "../types";

type StarRuntime = {
  node: ActivityNode;
  base: THREE.Vector3;
  sprite: THREE.Sprite;
  halo: THREE.Sprite;
  phase: number;
  speed: number;
  size: number;
  color: THREE.Color;
};

type ControlState = {
  yaw: number;
  pitch: number;
  yawTarget: number;
  pitchTarget: number;
  distance: number;
  distanceTarget: number;
  pointerDown: boolean;
  dragging: boolean;
  moved: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

const groupColors: Record<string, string> = {
  reports: "#72e4c4",
  workspaces: "#8fb8ff",
  findings: "#ffb86b",
  cards: "#d8b4fe",
  chats: "#f7a8c8",
  agents: "#fde68a",
  logs: "#a7f3d0",
  analysis: "#8fb8ff",
  review: "#ffb86b",
  learning: "#d8b4fe",
  ai: "#f7a8c8",
  agent: "#fde68a"
};

export function ActivityGalaxyCanvas({
  summary,
  galaxy,
  focusedNodeId,
  selectedNodeId,
  onFocusNode,
  onOpenNode
}: {
  summary: ActivitySummary | null;
  galaxy: ActivityGalaxyData | null;
  focusedNodeId?: string | null;
  selectedNodeId?: string | null;
  onFocusNode?: (nodeId: string | null) => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const starsRef = useRef<StarRuntime[]>([]);
  const activeNodeRef = useRef<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const nodes = galaxy?.nodes || [];
  const links = galaxy?.links || [];
  const activeNodeId = focusedNodeId ?? hoveredNodeId ?? selectedNodeId ?? null;
  const focusedNode = nodes.find((node) => node.id === activeNodeId) || nodes[0] || null;
  const focusedLinks = focusedNode
    ? links.filter((link) => link.source === focusedNode.id || link.target === focusedNode.id).slice(0, 5)
    : [];

  useEffect(() => {
    activeNodeRef.current = activeNodeId;
  }, [activeNodeId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostElement = host;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "activity-galaxy-three-next";
    hostElement.appendChild(renderer.domElement);

    const starTexture = createStarTexture();
    const haloTexture = createHaloTexture();
    const galaxyGroup = new THREE.Group();
    galaxyGroup.rotation.order = "YXZ";
    scene.add(galaxyGroup);

    const maxWeight = Math.max(...nodes.map((node) => node.weight), 1);
    const stars = buildStars(nodes, maxWeight, starTexture, haloTexture);
    starsRef.current = stars;
    for (const star of stars) {
      galaxyGroup.add(star.halo);
      galaxyGroup.add(star.sprite);
    }

    const linkGroup = buildLinks(links, stars);
    galaxyGroup.add(linkGroup);

    const dust = buildDustLayer(Math.max(360, Math.min(1100, 420 + (summary?.recent_events.length || 0) * 18)));
    scene.add(dust);

    const hub = buildHub();
    galaxyGroup.add(hub);

    const controls: ControlState = {
      yaw: 0,
      pitch: -0.08,
      yawTarget: 0,
      pitchTarget: -0.08,
      distance: 8.4,
      distanceTarget: 8.4,
      pointerDown: false,
      dragging: false,
      moved: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let width = 1;
    let height = 1;
    let frame = 0;
    let raf = 0;
    let lastTime = performance.now();
    let hoveredId: string | null = null;

    function resize() {
      const rect = hostElement.getBoundingClientRect();
      width = Math.max(360, rect.width);
      height = Math.max(360, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function setCursor(value: string) {
      renderer.domElement.style.cursor = value;
    }

    function findStar(event: PointerEvent | MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(stars.map((star) => star.sprite), false);
      const hit = hits[0]?.object as THREE.Sprite | undefined;
      const id = typeof hit?.userData?.nodeId === "string" ? hit.userData.nodeId : null;
      return id ? stars.find((star) => star.node.id === id) || null : null;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      controls.pointerDown = true;
      controls.dragging = false;
      controls.moved = false;
      controls.startX = event.clientX;
      controls.startY = event.clientY;
      controls.lastX = event.clientX;
      controls.lastY = event.clientY;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      setCursor("grabbing");
    }

    function handlePointerMove(event: PointerEvent) {
      if (controls.pointerDown) {
        const totalX = event.clientX - controls.startX;
        const totalY = event.clientY - controls.startY;
        if (!controls.dragging && Math.hypot(totalX, totalY) > 5) {
          controls.dragging = true;
          controls.moved = true;
        }
        if (controls.dragging) {
          const dx = event.clientX - controls.lastX;
          const dy = event.clientY - controls.lastY;
          controls.yawTarget += dx * 0.0068;
          controls.pitchTarget = clamp(controls.pitchTarget + dy * 0.0038, -1.05, 1.05);
          controls.lastX = event.clientX;
          controls.lastY = event.clientY;
          return;
        }
      }

      const star = findStar(event);
      const nextId = star?.node.id || null;
      if (nextId !== hoveredId) {
        hoveredId = nextId;
        setHoveredNodeId(nextId);
        onFocusNode?.(nextId);
      }
      setCursor(nextId ? "pointer" : "grab");
    }

    function handlePointerUp(event: PointerEvent) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      if (controls.pointerDown && !controls.dragging && !controls.moved) {
        const star = findStar(event);
        if (star) onOpenNode(star.node.id);
      }
      controls.pointerDown = false;
      controls.dragging = false;
      controls.moved = false;
      setCursor(hoveredId ? "pointer" : "grab");
    }

    function handlePointerCancel(event: PointerEvent) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      controls.pointerDown = false;
      controls.dragging = false;
      controls.moved = false;
      setCursor("grab");
    }

    function handlePointerLeave() {
      if (controls.pointerDown) return;
      hoveredId = null;
      setHoveredNodeId(null);
      onFocusNode?.(null);
      setCursor("grab");
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      controls.distanceTarget = clamp(controls.distanceTarget + event.deltaY * 0.006, 5.4, 12.2);
    }

    function animate() {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.033);
      lastTime = now;
      frame += 1;
      const elapsed = now / 1000;
      const activeId = activeNodeRef.current;

      controls.yawTarget += controls.dragging ? 0 : 0.0012;
      controls.yaw = damp(controls.yaw, controls.yawTarget, 5.8, dt);
      controls.pitch = damp(controls.pitch, controls.pitchTarget, 5.2, dt);
      controls.distance = damp(controls.distance, controls.distanceTarget, 6.5, dt);
      galaxyGroup.rotation.set(controls.pitch + Math.sin(elapsed * 0.18) * 0.025, controls.yaw, Math.sin(elapsed * 0.11) * 0.018, "YXZ");
      camera.position.set(0, 0, controls.distance);
      camera.lookAt(0, 0, 0);

      dust.rotation.y += 0.00042;
      dust.rotation.x = Math.sin(elapsed * 0.05) * 0.04;
      hub.rotation.z += 0.003;

      for (const star of stars) {
        const focused = star.node.id === activeId;
        const selected = star.node.id === selectedNodeId;
        const pulse = 1 + Math.sin(elapsed * star.speed + star.phase) * 0.045;
        const targetScale = star.size * pulse * (selected ? 1.58 : focused ? 1.42 : 1);
        const targetHalo = star.size * (selected ? 3.6 : focused ? 3.1 : 2.1);
        star.sprite.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 1 - Math.exp(-8 * dt));
        star.halo.scale.lerp(new THREE.Vector3(targetHalo, targetHalo, targetHalo), 1 - Math.exp(-6 * dt));
        const material = star.sprite.material as THREE.SpriteMaterial;
        const haloMaterial = star.halo.material as THREE.SpriteMaterial;
        material.opacity = damp(material.opacity, focused || selected ? 1 : 0.82, 8, dt);
        haloMaterial.opacity = damp(haloMaterial.opacity, focused || selected ? 0.33 : 0.12, 7, dt);
        star.sprite.position.copy(star.base).multiplyScalar(1 + Math.sin(elapsed * star.speed + star.phase) * 0.012);
        star.halo.position.copy(star.sprite.position);
      }

      updateMarker(markerRef.current, stars.find((star) => star.node.id === activeId), galaxyGroup, camera, renderer.domElement);
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(animate);
    }

    resize();
    setCursor("grab");
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("resize", resize);
    raf = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      disposeObject(galaxyGroup);
      disposeObject(dust);
      starTexture.dispose();
      haloTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      starsRef.current = [];
    };
  }, [links, nodes, onFocusNode, onOpenNode, selectedNodeId, summary?.recent_events.length]);

  return (
    <section className="activity-galaxy-layout-next activity-galaxy-layout-three-next">
      <div className="activity-galaxy-stage-next activity-galaxy-stage-three-next" ref={hostRef}>
        <div className="activity-galaxy-backdrop-next" />
        <div className="activity-galaxy-focus-marker-next" ref={markerRef} aria-hidden="true">
          <span />
          <strong>{focusedNode?.label || "活动星点"}</strong>
        </div>
        {nodes.length === 0 && (
          <div className="activity-galaxy-empty-next">
            <strong>还没有可绘制的活动数据</strong>
            <span>生成报告、对话、卡片或 Agent 计划后，星图会自动生长。</span>
          </div>
        )}
      </div>
      <aside className="activity-galaxy-detail-next">
        <span>当前聚焦</span>
        <h3>{focusedNode ? focusedNode.label : "暂无节点"}</h3>
        <p>{focusedNode ? `类型：${groupLabel(focusedNode.group)}，权重：${focusedNode.weight}` : "暂无活动节点。"}</p>
        <div className="activity-galaxy-focus-links-next">
          <strong>关联路径</strong>
          {focusedLinks.map((link) => (
            <button key={`${link.source}-${link.target}`} type="button" onClick={() => onOpenNode(link.target === focusedNode?.id ? link.source : link.target)}>
              <span>{nodeLabel(nodes, link.source)}</span>
              <small>→</small>
              <span>{nodeLabel(nodes, link.target)}</span>
              <b>{link.weight}</b>
            </button>
          ))}
          {focusedLinks.length === 0 && <p>暂无直接关联路径。</p>}
        </div>
        <div className="activity-galaxy-stat-grid">
          <small>报告 <strong>{summary?.report_count || 0}</strong></small>
          <small>工作区 <strong>{summary?.workspace_count || 0}</strong></small>
          <small>问题 <strong>{summary?.finding_count || 0}</strong></small>
          <small>卡片 <strong>{summary?.card_count || 0}</strong></small>
          <small>对话 <strong>{summary?.chat_count || 0}</strong></small>
          <small>Agent <strong>{summary?.agent_task_count || 0}</strong></small>
        </div>
      </aside>
    </section>
  );
}

function buildStars(nodes: ActivityNode[], maxWeight: number, starTexture: THREE.Texture, haloTexture: THREE.Texture) {
  const groupOrder = ["workspaces", "reports", "findings", "cards", "chats", "agents", "logs", "analysis", "review", "learning", "ai", "agent"];
  return nodes.map((node, index) => {
    const color = new THREE.Color(groupColors[node.group] || "#93c5fd");
    const base = galaxyPosition(node, index, groupOrder);
    const normalized = Math.sqrt(Math.max(1, node.weight) / maxWeight);
    const size = 0.16 + normalized * (isEntityNode(node.id) ? 0.18 : 0.28);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color,
      map: starTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.82
    }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      color,
      map: haloTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.12
    }));
    sprite.position.copy(base);
    halo.position.copy(base);
    sprite.scale.setScalar(size);
    halo.scale.setScalar(size * 2.1);
    sprite.userData.nodeId = node.id;
    return {
      node,
      base,
      sprite,
      halo,
      phase: seeded(`${node.id}:phase`) * Math.PI * 2,
      speed: 0.65 + seeded(`${node.id}:speed`) * 0.72,
      size,
      color
    };
  });
}

function buildLinks(links: ActivityGalaxyData["links"], stars: StarRuntime[]) {
  const group = new THREE.Group();
  const starMap = new Map(stars.map((star) => [star.node.id, star]));
  for (const link of links) {
    const source = starMap.get(link.source);
    const target = starMap.get(link.target);
    if (!source || !target) continue;
    const midpoint = source.base.clone().add(target.base).multiplyScalar(0.5);
    const lift = midpoint.clone().normalize().multiplyScalar(0.38 + Math.min(0.42, link.weight * 0.03));
    const curve = new THREE.QuadraticBezierCurve3(source.base, midpoint.add(lift), target.base);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(28));
    const material = new THREE.LineBasicMaterial({
      color: source.color.clone().lerp(target.color, 0.5),
      transparent: true,
      opacity: Math.min(0.42, 0.12 + link.weight * 0.035),
      blending: THREE.AdditiveBlending
    });
    group.add(new THREE.Line(geometry, material));
  }
  return group;
}

function buildHub() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 32, 32),
    new THREE.MeshBasicMaterial({ color: "#72e4c4", transparent: true, opacity: 0.86 })
  );
  const ringMaterial = new THREE.MeshBasicMaterial({ color: "#8fb8ff", transparent: true, opacity: 0.22, side: THREE.DoubleSide });
  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58 + index * 0.24, 0.006, 8, 96), ringMaterial.clone());
    ring.rotation.x = Math.PI / 2 + index * 0.32;
    ring.rotation.y = index * 0.54;
    group.add(ring);
  }
  group.add(core);
  return group;
}

function buildDustLayer(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorA = new THREE.Color("#8fb8ff");
  const colorB = new THREE.Color("#72e4c4");
  const colorC = new THREE.Color("#f8fbff");
  for (let index = 0; index < count; index += 1) {
    const point = spherePosition(`dust:${index}`, 5.6 + seeded(`dust:${index}:r`) * 3.8);
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
    const color = (index % 13 === 0 ? colorC : index % 5 === 0 ? colorB : colorA).clone();
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.018,
    transparent: true,
    opacity: 0.58,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Points(geometry, material);
}

function galaxyPosition(node: ActivityNode, index: number, groupOrder: string[]) {
  const groupIndex = groupOrder.includes(node.group) ? groupOrder.indexOf(node.group) % 6 : index % 6;
  const baseAngle = (Math.PI * 2 * groupIndex) / 6 - Math.PI / 2;
  const entity = isEntityNode(node.id);
  const local = seeded(`${node.id}:local`) * 2 - 1;
  const radius = entity ? 2.65 + seeded(`${node.id}:radius`) * 0.82 : 1.35 + seeded(`${node.id}:radius`) * 0.74;
  const angle = baseAngle + local * (entity ? 0.38 : 0.25);
  const height = (seeded(`${node.id}:height`) * 2 - 1) * (entity ? 1.35 : 0.76);
  return new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
}

function spherePosition(seed: string, radius: number) {
  const z = seeded(`${seed}:z`) * 2 - 1;
  const theta = seeded(`${seed}:theta`) * Math.PI * 2;
  const spread = Math.sqrt(Math.max(0, 1 - z * z));
  return new THREE.Vector3(Math.cos(theta) * spread * radius, z * radius * 0.86, Math.sin(theta) * spread * radius);
}

function updateMarker(
  marker: HTMLDivElement | null,
  star: StarRuntime | undefined,
  galaxyGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement
) {
  if (!marker || !star) {
    marker?.style.setProperty("--focus-opacity", "0");
    return;
  }
  galaxyGroup.updateMatrixWorld(true);
  const point = star.sprite.position.clone();
  galaxyGroup.localToWorld(point);
  point.project(camera);
  if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.1 || Math.abs(point.y) > 1.1) {
    marker.style.setProperty("--focus-opacity", "0");
    return;
  }
  const rect = canvas.getBoundingClientRect();
  marker.style.setProperty("--focus-x", `${((point.x + 1) * 0.5) * rect.width}px`);
  marker.style.setProperty("--focus-y", `${((1 - point.y) * 0.5) * rect.height}px`);
  marker.style.setProperty("--focus-opacity", "1");
}

function createStarTexture() {
  return createRadialTexture([
    [0, "rgba(255,255,255,1)"],
    [0.22, "rgba(255,255,255,0.92)"],
    [0.5, "rgba(255,255,255,0.28)"],
    [1, "rgba(255,255,255,0)"]
  ]);
}

function createHaloTexture() {
  return createRadialTexture([
    [0, "rgba(255,255,255,0.28)"],
    [0.32, "rgba(255,255,255,0.16)"],
    [0.72, "rgba(255,255,255,0.05)"],
    [1, "rgba(255,255,255,0)"]
  ]);
}

function createRadialTexture(stops: Array<[number, string]>) {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const radius = size / 2;
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;
    const geometry = "geometry" in mesh ? mesh.geometry : undefined;
    if (geometry) geometry.dispose();
    const material = "material" in mesh ? mesh.material : undefined;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function nodeLabel(nodes: ActivityNode[], id: string) {
  return nodes.find((node) => node.id === id)?.label || id;
}

function isEntityNode(nodeId: string) {
  return nodeId.includes(":") || nodeId.startsWith("event:");
}

function groupLabel(value: string) {
  const labels: Record<string, string> = {
    reports: "报告",
    workspaces: "工作区",
    findings: "问题",
    cards: "知识卡片",
    chats: "AI 对话",
    agents: "Agent 任务",
    logs: "学习日志",
    analysis: "项目分析",
    review: "审查闭环",
    learning: "学习沉淀",
    ai: "AI 对话",
    agent: "Agent 任务"
  };
  return labels[value] || value;
}

function seeded(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function damp(current: number, target: number, lambda: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
