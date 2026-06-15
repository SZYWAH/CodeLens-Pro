import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "../lib/api";
import type { ActivityStarItem } from "../types";

type GalaxyPoint = {
  item: ActivityStarItem;
  color: string;
  base: THREE.Vector3;
  phase: number;
  speed: number;
  drift: number;
  stream: number;
  size: number;
  alpha: number;
};

type DustPoint = {
  color: string;
  base: THREE.Vector3;
  phase: number;
  speed: number;
  drift: number;
  stream: number;
  size: number;
  alpha: number;
};

type PointLayer = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  positions: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
};

type FocusStarLayer = {
  group: THREE.Group;
  core: THREE.Sprite;
  halo: THREE.Sprite;
  materials: THREE.SpriteMaterial[];
  textures: THREE.Texture[];
};

type RotationControls = {
  yaw: number;
  pitch: number;
  roll: number;
  yawTarget: number;
  pitchTarget: number;
  rollTarget: number;
  velocityYaw: number;
  velocityPitch: number;
  pointerDown: boolean;
  dragging: boolean;
  moved: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  autoPausedUntil: number;
};

type FocusState = {
  active: boolean;
  selectedIndex: number;
  approach: number;
  targetLocal: THREE.Vector3;
  nearLocal: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  restoreYaw: number;
  restorePitch: number;
  restoreRoll: number;
  restoreDistance: number;
  restoreFov: number;
};

const DEFAULT_CAMERA_FOV = 43;
const DEFAULT_CAMERA_DISTANCE = 8.6;
const FOCUS_CAMERA_DISTANCE = 6.45;
const FOCUS_CAMERA_FOV = 41.4;
const MIN_CAMERA_DISTANCE = 4.8;
const MAX_CAMERA_DISTANCE = 12.5;
const DRAG_THRESHOLD = 5;

export function ActivityGalaxyPage({
  codeLineCount,
  onBack,
  onOpenActivity,
}: {
  codeLineCount: number;
  onBack: () => void;
  onOpenActivity: (item: ActivityStarItem) => void | Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusMarkerRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [items, setItems] = useState<ActivityStarItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => (selectedId ? items.find((item) => item.id === selectedId) ?? null : null),
    [items, selectedId],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadConstellation = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextItems = await api.activityConstellation(300);
      setItems(nextItems);
      setSelectedId((current) => (current && nextItems.some((item) => item.id === current) ? current : null));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "活动星图加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConstellation();
  }, [loadConstellation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const hostElement: HTMLDivElement = container;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA_FOV, 1, 0.1, 100);
    camera.position.set(0, 0, DEFAULT_CAMERA_DISTANCE);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = "activity-galaxy-canvas";
    hostElement.appendChild(renderer.domElement);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dataStars = buildGalaxyPoints(items);
    const dustCount = normalizeDustCount(codeLineCount);
    const backgroundDustCount = Math.floor(dustCount * 0.18);
    const ambientDust = buildAmbientDust(dustCount - backgroundDustCount);
    const backgroundDust = buildBackgroundDust(backgroundDustCount);

    const dataLayer = createPointLayer(dataStars, 1.55);
    const ambientLayer = createPointLayer(ambientDust, 0.98);
    const backgroundLayer = createPointLayer(backgroundDust, 0.58);

    const galaxyGroup = new THREE.Group();
    galaxyGroup.rotation.order = "YXZ";
    const ambientStarField = new THREE.Points(ambientLayer.geometry, ambientLayer.material);
    const dataStarField = new THREE.Points(dataLayer.geometry, dataLayer.material);
    const backgroundStarField = new THREE.Points(backgroundLayer.geometry, backgroundLayer.material);
    const focusStarLayer = createFocusStarLayer();
    backgroundStarField.rotation.order = "YXZ";
    ambientStarField.renderOrder = 1;
    dataStarField.renderOrder = 2;
    focusStarLayer.group.renderOrder = 3;
    backgroundStarField.renderOrder = 0;
    galaxyGroup.add(ambientStarField, dataStarField, focusStarLayer.group);
    scene.add(backgroundStarField, galaxyGroup);

    const controls: RotationControls = {
      yaw: 0,
      pitch: 0,
      roll: 0,
      yawTarget: 0,
      pitchTarget: 0,
      rollTarget: 0,
      velocityYaw: 0,
      velocityPitch: 0,
      pointerDown: false,
      dragging: false,
      moved: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      autoPausedUntil: 0,
    };

    const focusState: FocusState = {
      active: false,
      selectedIndex: -1,
      approach: 0,
      targetLocal: new THREE.Vector3(),
      nearLocal: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      roll: 0,
      restoreYaw: 0,
      restorePitch: 0,
      restoreRoll: 0,
      restoreDistance: DEFAULT_CAMERA_DISTANCE,
      restoreFov: DEFAULT_CAMERA_FOV,
    };

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.19;
    const pointer = new THREE.Vector2();
    let cameraDistanceTarget = DEFAULT_CAMERA_DISTANCE;
    let frameId = 0;
    let elapsed = 0;
    let lastFrameAt = performance.now();
    let hoveredIndex = -1;

    function resize() {
      const rect = hostElement.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(320, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      dataLayer.material.uniforms.uPixelRatio.value = ratio;
      ambientLayer.material.uniforms.uPixelRatio.value = ratio;
      backgroundLayer.material.uniforms.uPixelRatio.value = ratio;
    }

    function findPointIndex(event: PointerEvent | MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(dataStarField, false)[0];
      return typeof hit?.index === "number" ? hit.index : -1;
    }

    function setCanvasCursor(nextHoveredIndex = hoveredIndex) {
      if (controls.dragging) {
        renderer.domElement.style.cursor = "grabbing";
      } else if (nextHoveredIndex >= 0) {
        renderer.domElement.style.cursor = "pointer";
      } else {
        renderer.domElement.style.cursor = "grab";
      }
    }

    function focusStar(index: number) {
      const point = dataStars[index];
      if (!point) return;

      const targetDirection = new THREE.Vector3(0.18, 0.02, 1).normalize();
      const sourceDirection = point.base.clone().normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(sourceDirection, targetDirection);
      const targetEuler = new THREE.Euler().setFromQuaternion(quaternion, "YXZ");

      focusState.active = true;
      focusState.selectedIndex = index;
      focusState.restoreYaw = controls.yawTarget;
      focusState.restorePitch = controls.pitchTarget;
      focusState.restoreRoll = controls.rollTarget;
      focusState.restoreDistance = cameraDistanceTarget;
      focusState.restoreFov = camera.fov;
      focusState.targetLocal.copy(point.base);
      focusState.nearLocal.copy(point.base);
      focusState.approach = 0;
      focusState.yaw = nearestAngle(targetEuler.y, controls.yawTarget);
      focusState.pitch = clamp(targetEuler.x, -1.1, 1.1);
      focusState.roll = nearestAngle(targetEuler.z, controls.rollTarget);

      controls.yawTarget = focusState.yaw;
      controls.pitchTarget = focusState.pitch;
      controls.rollTarget = focusState.roll;
      controls.velocityYaw = 0;
      controls.velocityPitch = 0;
      controls.autoPausedUntil = performance.now() + 9000;
      cameraDistanceTarget = FOCUS_CAMERA_DISTANCE;
      hoveredIndex = index;
      setSelectedId(point.item.id);
      setCanvasCursor(index);
    }

    function releaseFocusIfNeeded() {
      if (selectedIdRef.current) return;
      if (!focusState.active && focusState.approach <= 0.001 && Math.abs(cameraDistanceTarget - focusState.restoreDistance) < 0.01) return;
      controls.yawTarget = focusState.restoreYaw;
      controls.pitchTarget = focusState.restorePitch;
      controls.rollTarget = focusState.restoreRoll;
      cameraDistanceTarget = focusState.restoreDistance;
      focusState.active = false;
      controls.autoPausedUntil = performance.now() + 1600;
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
      controls.velocityYaw = 0;
      controls.velocityPitch = 0;
      controls.autoPausedUntil = performance.now() + 3000;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      setCanvasCursor();
    }

    function handlePointerMove(event: PointerEvent) {
      if (controls.pointerDown) {
        const totalX = event.clientX - controls.startX;
        const totalY = event.clientY - controls.startY;
        const movedDistance = Math.hypot(totalX, totalY);
        if (!controls.dragging && movedDistance > DRAG_THRESHOLD) {
          controls.dragging = true;
          controls.moved = true;
          focusState.active = false;
          if (selectedIdRef.current) setSelectedId(null);
        }

        if (controls.dragging) {
          const dx = event.clientX - controls.lastX;
          const dy = event.clientY - controls.lastY;
          controls.yawTarget += dx * 0.0066;
          controls.pitchTarget = clamp(controls.pitchTarget + dy * 0.0034, -1.1, 1.1);
          controls.rollTarget = damp(controls.rollTarget, 0, 8, 1 / 60);
          controls.velocityYaw = dx * 0.052;
          controls.velocityPitch = dy * 0.019;
          controls.lastX = event.clientX;
          controls.lastY = event.clientY;
          controls.autoPausedUntil = performance.now() + 4000;
          setCanvasCursor();
          return;
        }
      }

      hoveredIndex = findPointIndex(event);
      setCanvasCursor(hoveredIndex);
    }

    function handlePointerUp(event: PointerEvent) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      if (controls.pointerDown && !controls.dragging && !controls.moved) {
        const index = findPointIndex(event);
        if (index >= 0) focusStar(index);
      }
      controls.pointerDown = false;
      controls.dragging = false;
      controls.moved = false;
      setCanvasCursor();
    }

    function handlePointerCancel(event: PointerEvent) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      controls.pointerDown = false;
      controls.dragging = false;
      controls.moved = false;
      controls.velocityYaw = 0;
      controls.velocityPitch = 0;
      setCanvasCursor();
    }

    function handlePointerLeave() {
      if (controls.pointerDown) return;
      hoveredIndex = -1;
      setCanvasCursor();
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const scale = event.ctrlKey ? 0.012 : 0.006;
      cameraDistanceTarget = clamp(cameraDistanceTarget + event.deltaY * scale, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
      if (focusState.active) {
        controls.autoPausedUntil = performance.now() + 4000;
      }
    }

    function render() {
      const now = performance.now();
      const dt = Math.min((now - lastFrameAt) / 1000, 0.033);
      lastFrameAt = now;
      elapsed += dt;
      releaseFocusIfNeeded();

      const motionScale = reducedMotion ? 0.08 : 1;
      const shouldAutoDrift = !controls.dragging && !focusState.active && now > controls.autoPausedUntil;
      const focusTarget = focusState.active ? 1 : 0;
      focusState.approach = damp(focusState.approach, focusTarget, focusState.active ? 2.7 : 4.8, dt);
      if (!focusState.active && focusState.approach < 0.018) {
        focusState.approach = 0;
        focusState.selectedIndex = -1;
      }
      const focusEase = easeOutCubic(focusState.approach);
      const focusRush = reducedMotion ? focusEase * 0.08 : focusEase * 0.34;

      if (!controls.dragging && !focusState.active) {
        controls.yawTarget += controls.velocityYaw * dt;
        controls.pitchTarget = clamp(controls.pitchTarget + controls.velocityPitch * dt, -1.1, 1.1);
        controls.velocityYaw *= Math.exp(-3.2 * dt);
        controls.velocityPitch *= Math.exp(-3.8 * dt);
        if (Math.abs(controls.velocityYaw) < 0.0008) controls.velocityYaw = 0;
        if (Math.abs(controls.velocityPitch) < 0.0008) controls.velocityPitch = 0;
      }

      const autoYaw = shouldAutoDrift ? (
        Math.sin(elapsed * 0.095) * 0.14
        + Math.sin(elapsed * 0.031 + 1.7) * 0.08
      ) * motionScale : 0;
      const autoPitch = shouldAutoDrift ? (
        Math.sin(elapsed * 0.055 + 0.4) * 0.045
        + Math.sin(elapsed * 0.021 + 2.2) * 0.03
      ) * motionScale : 0;
      const autoRoll = shouldAutoDrift ? Math.sin(elapsed * 0.039 + 1.1) * 0.018 * motionScale : 0;

      const targetYaw = focusState.active ? focusState.yaw : controls.yawTarget + autoYaw;
      const targetPitch = focusState.active ? focusState.pitch : clamp(controls.pitchTarget + autoPitch, -1.1, 1.1);
      const targetRoll = focusState.active ? focusState.roll : controls.rollTarget + autoRoll;
      controls.yaw = damp(controls.yaw, targetYaw, focusState.active ? 4.5 : 5.2, dt);
      controls.pitch = damp(controls.pitch, targetPitch, focusState.active ? 4.2 : 4.8, dt);
      controls.roll = damp(controls.roll, targetRoll, focusState.active ? 4.2 : 3.6, dt);
      galaxyGroup.rotation.set(controls.pitch, controls.yaw, controls.roll, "YXZ");

      const targetX = selectedIdRef.current ? -0.38 : 0;
      galaxyGroup.position.x = damp(galaxyGroup.position.x, targetX, 6.2, dt);
      camera.position.z = damp(camera.position.z, cameraDistanceTarget, 7.4, dt);
      camera.fov = damp(camera.fov, focusState.active ? FOCUS_CAMERA_FOV : focusState.restoreFov, 4.6, dt);
      camera.updateProjectionMatrix();

      backgroundStarField.rotation.y = Math.sin(elapsed * 0.018) * 0.025 * motionScale - focusRush * 0.035;
      backgroundStarField.rotation.x = Math.cos(elapsed * 0.014) * 0.018 * motionScale + focusRush * 0.02;
      backgroundStarField.position.z = damp(backgroundStarField.position.z, -focusRush * 0.7, 5.4, dt);
      ambientStarField.position.z = damp(ambientStarField.position.z, focusRush * 0.08, 5.4, dt);

      updatePointPositions(dataStars, dataLayer.positions, elapsed, motionScale, 0.6, focusRush * 0.08);
      updatePointPositions(ambientDust, ambientLayer.positions, elapsed, motionScale, 0.28, focusRush * 0.18);
      updatePointPositions(backgroundDust, backgroundLayer.positions, elapsed, motionScale, 0.18, focusRush * 0.36);
      updateDataStarHighlights(dataStars, dataLayer, hoveredIndex, focusState.selectedIndex, dt);
      updateFocusStarLayer(focusStarLayer, focusState, dataStars[focusState.selectedIndex], elapsed, dt);
      updateFocusMarker(
        focusMarkerRef.current,
        dataStars[focusState.selectedIndex],
        focusState,
        galaxyGroup,
        camera,
        renderer.domElement,
        focusEase,
      );
      dataLayer.geometry.attributes.position.needsUpdate = true;
      ambientLayer.geometry.attributes.position.needsUpdate = true;
      backgroundLayer.geometry.attributes.position.needsUpdate = true;

      dataLayer.material.uniforms.uTime.value = elapsed;
      ambientLayer.material.uniforms.uTime.value = elapsed * 0.72;
      backgroundLayer.material.uniforms.uTime.value = elapsed * 0.36;
      ambientLayer.material.uniforms.uOpacity.value = 0.98 - focusEase * 0.08;
      backgroundLayer.material.uniforms.uOpacity.value = 0.58 - focusEase * 0.04;

      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(render);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostElement);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
    resize();
    setCanvasCursor();
    render();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      dataLayer.geometry.dispose();
      ambientLayer.geometry.dispose();
      backgroundLayer.geometry.dispose();
      dataLayer.material.dispose();
      ambientLayer.material.dispose();
      backgroundLayer.material.dispose();
      disposeFocusStarLayer(focusStarLayer);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [codeLineCount, items]);

  return (
    <div className={["activity-galaxy-page", selected ? "activity-galaxy-page-detail-open" : ""].join(" ")}>
      <div className="activity-galaxy-backdrop" />
      <div className="activity-galaxy-stage" ref={containerRef} />
      <div className="activity-galaxy-focus-marker" ref={focusMarkerRef} aria-hidden="true">
        <span className="activity-galaxy-focus-marker-ring" />
        <span className="activity-galaxy-focus-marker-core" />
      </div>
      <div className="activity-galaxy-vignette" />

      <button className="activity-galaxy-back" onClick={onBack} type="button" aria-label="返回统计页">
        <ArrowLeft size={16} />
        <span>返回</span>
      </button>

      {loading ? <div className="activity-galaxy-loading">正在聚合星图</div> : null}
      {error ? <div className="activity-galaxy-error">{error}</div> : null}
      {!items.length && !loading && !error ? <div className="activity-galaxy-empty">暂无活动数据</div> : null}

      <aside className={["activity-galaxy-detail", selected ? "activity-galaxy-detail-open" : ""].join(" ")} aria-label="活动详情" aria-hidden={!selected}>
        {selected ? (
          <>
            <button className="activity-galaxy-detail-close" onClick={() => setSelectedId(null)} type="button" aria-label="关闭信息栏">
              <X size={15} />
            </button>
            <div className="activity-galaxy-detail-kicker">{kindLabel(selected.kind)}</div>
            <h2>{selected.title}</h2>
            {selected.subtitle ? <p>{selected.subtitle}</p> : null}
            <dl>
              <div>
                <dt>活动类型</dt>
                <dd>{kindLabel(selected.kind)}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{selected.status || "active"}</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{formatFullDateTime(selected.created_at)}</dd>
              </div>
              <div>
                <dt>活动 ID</dt>
                <dd>{shortId(selected.id)}</dd>
              </div>
              <div>
                <dt>关联目标</dt>
                <dd>{routeLabel(selected)}</dd>
              </div>
              <div>
                <dt>目标 ID</dt>
                <dd>{shortId(selected.target_id)}</dd>
              </div>
            </dl>
            <button
              className="activity-galaxy-open"
              disabled={!canOpenActivity(selected)}
              onClick={() => canOpenActivity(selected) && void onOpenActivity(selected)}
              type="button"
            >
              <ExternalLink size={14} />
              {canOpenActivity(selected) ? "打开关联内容" : "暂无关联入口"}
            </button>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function createPointLayer<T extends { color: string; base: THREE.Vector3; size: number; alpha?: number; phase: number }>(points: T[], opacity: number): PointLayer {
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  const sizes = new Float32Array(points.length);
  const phases = new Float32Array(points.length);
  const alphas = new Float32Array(points.length);

  points.forEach((point, index) => {
    positions[index * 3] = point.base.x;
    positions[index * 3 + 1] = point.base.y;
    positions[index * 3 + 2] = point.base.z;
    const color = new THREE.Color(point.color);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    sizes[index] = point.size;
    phases[index] = point.phase;
    alphas[index] = point.alpha ?? 1;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("pointSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("alphaBase", new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float pointSize;
      attribute float phase;
      attribute float alphaBase;
      uniform float uPixelRatio;
      uniform float uTime;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;

      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float depthScale = clamp(8.4 / max(1.0, -mvPosition.z), 0.54, 1.72);
        float twinkle = 0.88 + sin(uTime * 1.45 + phase) * 0.12;
        gl_PointSize = pointSize * uPixelRatio * depthScale * twinkle;
        vDepth = smoothstep(10.5, 2.2, -mvPosition.z);
        vAlpha = alphaBase;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDepth;
      uniform float uOpacity;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        float core = smoothstep(0.16, 0.0, d);
        float edge = smoothstep(0.24, 0.14, d) * 0.035;
        float alpha = (core * 1.14 + edge) * vAlpha * uOpacity * (0.62 + vDepth * 0.56);
        if (alpha < 0.018) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });

  return { geometry, material, positions, sizes, alphas };
}

function createFocusStarLayer(): FocusStarLayer {
  const coreTexture = createRadialTexture([
    { stop: 0, color: "rgba(255,255,255,0)" },
    { stop: 1, color: "rgba(255,255,255,0)" },
  ]);
  const haloTexture = createRadialTexture([
    { stop: 0, color: "rgba(255,255,255,0)" },
    { stop: 0.2, color: "rgba(174,211,255,0.045)" },
    { stop: 0.52, color: "rgba(90,146,231,0.018)" },
    { stop: 1, color: "rgba(140,191,255,0)" },
  ]);

  const coreMaterial = new THREE.SpriteMaterial({
    map: coreTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const haloMaterial = new THREE.SpriteMaterial({
    map: haloTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const group = new THREE.Group();
  const halo = new THREE.Sprite(haloMaterial);
  const core = new THREE.Sprite(coreMaterial);
  halo.renderOrder = 4;
  core.renderOrder = 5;
  group.visible = false;
  group.add(halo, core);

  return {
    group,
    core,
    halo,
    materials: [coreMaterial, haloMaterial],
    textures: [coreTexture, haloTexture],
  };
}

function createRadialTexture(stops: Array<{ stop: number; color: string }>) {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  const radius = size / 2;
  const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
  stops.forEach((item) => gradient.addColorStop(item.stop, item.color));
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function updateFocusStarLayer(
  layer: FocusStarLayer,
  focusState: FocusState,
  point: GalaxyPoint | undefined,
  elapsed: number,
  delta: number,
) {
  const approach = easeOutCubic(focusState.approach);
  if (!point || approach <= 0.001) {
    layer.group.visible = false;
    layer.materials.forEach((material) => {
      material.opacity = 0;
    });
    return;
  }

  const pulse = 1 + Math.sin(elapsed * 1.8 + point.phase) * 0.012;
  const nextPosition = focusState.targetLocal.clone();
  nextPosition.x += Math.sin(elapsed * 0.34 + point.phase) * 0.006 * approach;
  nextPosition.y += Math.sin(elapsed * 0.62 + point.phase) * 0.008 * approach;

  layer.group.visible = true;
  layer.group.position.lerp(nextPosition, 1 - Math.exp(-10 * delta));

  const color = new THREE.Color(point.color);
  layer.halo.material.color.lerp(color, 0.22);

  const baseScale = (0.22 + approach * 0.14) * pulse;
  layer.core.scale.setScalar(baseScale);
  layer.halo.scale.setScalar(baseScale * 2.45);
  layer.core.material.opacity = 0;
  layer.halo.material.opacity = Math.min(0.085, approach * 0.07);
}

function disposeFocusStarLayer(layer: FocusStarLayer) {
  layer.materials.forEach((material) => material.dispose());
  layer.textures.forEach((texture) => texture.dispose());
}

function updateFocusMarker(
  marker: HTMLDivElement | null,
  point: GalaxyPoint | undefined,
  focusState: FocusState,
  galaxyGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  focusEase: number,
) {
  if (!marker) return;
  if (!point || focusState.approach <= 0.001) {
    marker.style.setProperty("--focus-opacity", "0");
    marker.dataset.active = "false";
    return;
  }

  galaxyGroup.updateMatrixWorld(true);
  const worldPosition = point.base.clone();
  galaxyGroup.localToWorld(worldPosition);
  worldPosition.project(camera);
  const inView = worldPosition.z > -1 && worldPosition.z < 1 && Math.abs(worldPosition.x) < 1.08 && Math.abs(worldPosition.y) < 1.08;
  if (!inView) {
    marker.style.setProperty("--focus-opacity", "0");
    marker.dataset.active = "false";
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const screenX = ((worldPosition.x + 1) * 0.5) * rect.width;
  const screenY = ((1 - worldPosition.y) * 0.5) * rect.height;
  const markerScale = clamp(0.84 + focusEase * 0.18, 0.82, 1.02);
  const markerOpacity = clamp(0.12 + focusEase * 0.58, 0, 0.7);

  marker.style.setProperty("--focus-x", `${screenX}px`);
  marker.style.setProperty("--focus-y", `${screenY}px`);
  marker.style.setProperty("--focus-scale", markerScale.toFixed(3));
  marker.style.setProperty("--focus-opacity", markerOpacity.toFixed(3));
  marker.dataset.active = markerOpacity > 0.02 ? "true" : "false";
}

function updateDataStarHighlights(
  points: GalaxyPoint[],
  layer: PointLayer,
  hoveredIndex: number,
  selectedIndex: number,
  delta: number,
) {
  for (let index = 0; index < points.length; index += 1) {
    const selected = index === selectedIndex;
    const hovered = index === hoveredIndex;
    const targetSize = points[index].size * (selected ? 2.18 : hovered ? 1.18 : 1);
    const targetAlpha = points[index].alpha * (selected ? 1.82 : hovered ? 1.14 : 1);
    layer.sizes[index] = damp(layer.sizes[index], targetSize, selected ? 13 : 8, delta);
    layer.alphas[index] = damp(layer.alphas[index], targetAlpha, selected ? 13 : 8, delta);
  }
  layer.geometry.attributes.pointSize.needsUpdate = true;
  layer.geometry.attributes.alphaBase.needsUpdate = true;
}

function buildGalaxyPoints(items: ActivityStarItem[]): GalaxyPoint[] {
  return items.map((item, index) => {
    const seed = `${item.kind}:${item.id}:${index}`;
    return {
      item,
      color: item.kind === "agent" ? "#d8d0ff" : item.kind === "chat" ? "#c3f2ff" : "#d8e6ff",
      base: spherePosition(seed, 3.05),
      phase: seeded(`${seed}:phase`) * Math.PI * 2,
      speed: 0.25 + seeded(`${seed}:speed`) * 0.38,
      drift: 0.005 + seeded(`${seed}:drift`) * 0.014,
      stream: 0.18 + seeded(`${seed}:stream`) * 0.28,
      size: 12.2 + seeded(`${seed}:size`) * 4.6 + Math.min(item.weight ?? 0, 5) * 0.68,
      alpha: 1,
    };
  });
}

function normalizeDustCount(codeLineCount: number) {
  if (!Number.isFinite(codeLineCount) || codeLineCount <= 0) return 0;
  return Math.max(Math.round(codeLineCount), 0);
}

function buildAmbientDust(count: number): DustPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = `ambient:${index}`;
    const warmth = seeded(`${seed}:warmth`);
    return {
      color: warmth > 0.86 ? "#f4e6c6" : warmth > 0.5 ? "#d7e6ff" : "#a9d8ff",
      base: spherePosition(seed, 3.2),
      phase: seeded(`${seed}:phase`) * Math.PI * 2,
      speed: 0.12 + seeded(`${seed}:speed`) * 0.24,
      drift: 0.002 + seeded(`${seed}:drift`) * 0.007,
      stream: 0.2 + seeded(`${seed}:stream`) * 0.42,
      size: 2.15 + seeded(`${seed}:size`) * 2.4,
      alpha: 0.42 + seeded(`${seed}:alpha`) * 0.58,
    };
  });
}

function buildBackgroundDust(count: number): DustPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = `background:${index}`;
    const angle = seeded(`${seed}:theta`) * Math.PI * 2;
    const height = seeded(`${seed}:height`) * 2 - 1;
    const radius = 5.4 + seeded(`${seed}:radius`) * 4.6;
    const spread = Math.sqrt(Math.max(0, 1 - height * height));
    return {
      color: seeded(`${seed}:warm`) > 0.88 ? "#efe0bf" : "#bfd9ff",
      base: new THREE.Vector3(Math.cos(angle) * spread * radius, height * radius * 0.8, Math.sin(angle) * spread * radius - 1.8),
      phase: seeded(`${seed}:phase`) * Math.PI * 2,
      speed: 0.04 + seeded(`${seed}:speed`) * 0.12,
      drift: 0.001 + seeded(`${seed}:drift`) * 0.004,
      stream: 0.3 + seeded(`${seed}:stream`) * 0.58,
      size: 1.1 + seeded(`${seed}:size`) * 1.55,
      alpha: 0.22 + seeded(`${seed}:alpha`) * 0.38,
    };
  });
}

function updatePointPositions<T extends { base: THREE.Vector3; speed: number; phase: number; drift: number; stream: number }>(
  points: T[],
  positions: Float32Array,
  elapsed: number,
  motionScale: number,
  travel: number,
  rush = 0,
) {
  points.forEach((point, index) => {
    const offset = point.drift * motionScale * travel;
    const radial = 1 + Math.sin(elapsed * point.speed + point.phase) * 0.006 * motionScale * travel + rush * 0.05;
    const stream = rush * point.stream;
    positions[index * 3] = point.base.x * radial + Math.sin(elapsed * 0.21 + point.phase) * offset;
    positions[index * 3 + 1] = point.base.y * radial + Math.cos(elapsed * 0.17 + point.phase * 0.7) * offset;
    positions[index * 3 + 2] = point.base.z * radial + Math.sin(elapsed * 0.19 + point.phase * 1.3) * offset + stream;
  });
}

function spherePosition(seed: string, maxRadius: number) {
  const z = seeded(`${seed}:z`) * 2 - 1;
  const theta = seeded(`${seed}:theta`) * Math.PI * 2;
  const radiusAtZ = Math.sqrt(Math.max(0, 1 - z * z));
  const radius = Math.cbrt(0.045 + seeded(`${seed}:radius`) * 0.955) * maxRadius;
  return new THREE.Vector3(
    Math.cos(theta) * radiusAtZ * radius,
    z * radius,
    Math.sin(theta) * radiusAtZ * radius,
  );
}

function selectedRoutePage(item: ActivityStarItem) {
  return item.route?.page || (item.kind === "report" ? "report" : item.kind === "chat" ? "chat" : item.kind === "agent" ? "agent" : "");
}

function canOpenActivity(item: ActivityStarItem) {
  return Boolean(item.target_id || item.route?.target_id || item.route?.session_id || item.route?.plan_id);
}

function routeLabel(item: ActivityStarItem) {
  const page = selectedRoutePage(item);
  if (page === "report") return "历史报告";
  if (page === "chat") return "普通对话";
  if (page === "agent") return "Agent 工作区";
  return item.route?.context_type || "本地活动";
}

function shortId(value?: string | null) {
  if (!value) return "无";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
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

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function nearestAngle(target: number, current: number) {
  return current + THREE.MathUtils.euclideanModulo(target - current + Math.PI, Math.PI * 2) - Math.PI;
}

function kindLabel(kind: string) {
  if (kind === "report") return "报告";
  if (kind === "chat") return "对话";
  if (kind === "agent") return "Agent";
  return "活动";
}

function formatFullDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
