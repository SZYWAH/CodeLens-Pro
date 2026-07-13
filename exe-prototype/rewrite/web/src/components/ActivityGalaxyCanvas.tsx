import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ActivityStarItem } from "../types";

type GalaxyMode = "entry" | "explore";

type ShowcaseCard = ActivityStarItem & {
  guide?: boolean;
};

type CrystalUniforms = {
  uActivity: THREE.IUniform<number>;
  uSceneColor: THREE.IUniform<THREE.Texture>;
  uEnvironmentMap: THREE.IUniform<THREE.CubeTexture>;
  uEnvironmentGain: THREE.IUniform<number>;
  uBackDepth: THREE.IUniform<THREE.Texture>;
  uResolution: THREE.IUniform<THREE.Vector2>;
  uNearFar: THREE.IUniform<THREE.Vector2>;
  uCameraWorld: THREE.IUniform<THREE.Vector3>;
  uTint: THREE.IUniform<THREE.Color>;
  uHighlightShift: THREE.IUniform<number>;
  uHalfExtents: THREE.IUniform<THREE.Vector3>;
  uStageDim: THREE.IUniform<number>;
};

type CrystalMaterial = THREE.ShaderMaterial & {
  uniforms: CrystalUniforms;
};

type SpineRuntime = {
  index: number;
  id: string;
  group: THREE.Group;
  contactShadow: THREE.Sprite;
  spine: THREE.Mesh<RoundedBoxGeometry, CrystalMaterial>;
  baseX: number;
  baseScreenX: number;
  baseScreenTop: number;
  baseScreenBottom: number;
  baseScreenHalfWidth: number;
  visualScreenX: number;
  visualScreenTop: number;
  visualScreenBottom: number;
  visualScreenHalfWidth: number;
};

type PointerDockState = {
  clientX: number;
  clientY: number;
};

type ResolvedPointer = {
  directRuntime: SpineRuntime | null;
  waveStrength: number;
  x: number;
  y: number;
};

type ClickCandidate = {
  runtimeId: string | null;
  source: "direct" | "gap" | "outside";
};

type RuntimeMotionTarget = {
  activity: number;
  hoverInfluence: number;
  selectedInfluence: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetScaleX: number;
  targetScaleY: number;
};

type HeroPhase = "idle" | "selected" | "opening" | "open" | "closing" | "switching";

type HeroPresentation = {
  cardId: string;
  phase: HeroPhase;
};

const MAX_CARDS = 18;
const SPINE_WIDTH = 0.105;
const SPINE_HEIGHT = 1.02;
const SPINE_DEPTH = 0.46;
const SPINE_RADIUS = 0.045;
const SPINE_SPACING = 0.38;
const SPINE_YAW = THREE.MathUtils.degToRad(11.5);
const CAMERA_FOV = 38;
const CAMERA_DISTANCE = 12.6;
const DOCK_Y = -5.06;
const POINTER_ACTIVATION_DISTANCE = 100;
const DIRECT_HIT_MARGIN = 14;
const DIRECT_CLICK_MARGIN = 6;
const CLICK_LANE_MARGIN = 16;
const CLICK_TIE_EPSILON = 0.75;
const HOVER_INTENT_DELAY = 40;
const TAP_MOVE_THRESHOLD = 8;
const HOVER_SCALE_X_GAIN = 0.22;
const HOVER_SCALE_Y_GAIN = 0.34;
const HOVER_LIFT = 0.56;
const HOVER_FORWARD = 0.44;
const SELECTED_SCALE_X_GAIN = 0.18;
const SELECTED_SCALE_Y_GAIN = 0.28;
const SELECTED_LIFT = 0.48;
const SELECTED_FORWARD = 0.38;
const SELECTED_MATERIAL_STRENGTH = 0.88;
const HOVER_NEIGHBOR_PUSH = 0.22;
const SELECTED_NEIGHBOR_PUSH = 0.2;
const MAX_COMBINED_PUSH = 0.3;
const MIN_DUAL_FOCUS_GAP_PX = 14;
const HERO_WIDTH = 4.6;
const HERO_HEIGHT = 1.35;
const HERO_DEPTH = 0.12;
const HERO_RADIUS = 0.08;
const HERO_Y = -1.52;
const HERO_Z = 0.54;
const HERO_YAW = THREE.MathUtils.degToRad(8);
const HERO_PITCH = THREE.MathUtils.degToRad(-4);
const HERO_OPEN_DURATION = 290;
const HERO_CLOSE_DURATION = 220;
const HERO_REDUCED_DURATION = 120;
const HERO_DOCK_DIM = 0.45;
const HERO_DOCK_MOTION = 0.4;
const WAVE_WEIGHTS = [1, 0.47, 0.17, 0.04, 0] as const;

export function ActivityGalaxyCanvas({
  items,
  mode,
  onBack,
  onOpenActivity
}: {
  codeLineCount: number;
  items: ActivityStarItem[];
  mode: GalaxyMode;
  onBack: () => void;
  onBlankClick?: () => void;
  onOpenActivity: (item: ActivityStarItem) => void | Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const heroOverlayRef = useRef<HTMLDivElement | null>(null);
  const heroActionRef = useRef<(() => void) | null>(null);
  const onOpenActivityRef = useRef(onOpenActivity);
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [heroPresentation, setHeroPresentation] = useState<HeroPresentation | null>(null);
  const [heroActionPending, setHeroActionPending] = useState(false);
  const cards = useMemo(() => buildShowcaseCards(items), [items]);
  const selected = selectedId ? cards.find((item) => item.id === selectedId) || null : null;
  const hovered = hoveredId ? cards.find((item) => item.id === hoveredId) || null : null;
  const active = hovered || selected;
  const heroCard = heroPresentation
    ? cards.find((item) => item.id === heroPresentation.cardId) || null
    : null;
  const heroActionReady = heroPresentation?.phase === "open" && !heroActionPending;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  useEffect(() => {
    onOpenActivityRef.current = onOpenActivity;
  }, [onOpenActivity]);

  useEffect(() => {
    setSelectedId((current) => (current && cards.some((item) => item.id === current) ? current : null));
    setHeroPresentation(null);
    setHeroActionPending(false);
  }, [cards]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyMinWidth = document.body.style.minWidth;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.style.minWidth = "0";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.minWidth = previousBodyMinWidth;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const hostElement = host;

    const cardsScene = new THREE.Scene();
    const backgroundScene = new THREE.Scene();
    const backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const backdropGeometry = new THREE.PlaneGeometry(2, 2);
    const backdropMaterial = createStaticBackdropMaterial();
    backdropMaterial.toneMapped = false;
    const backdropMesh = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdropMesh.frustumCulled = false;
    backgroundScene.add(backdropMesh);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
    camera.position.set(0, 0.24, CAMERA_DISTANCE);
    camera.lookAt(0, -1.6, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x020403, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.autoClear = false;
    renderer.domElement.className = "activity-showcase-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "活动玻璃展示台");
    renderer.domElement.dataset.showcaseRenderer = "screen-transmission-crystal";
    hostElement.appendChild(renderer.domElement);
    const diagnosticsEnabled = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
    const supportsHalfFloatTarget = Boolean(renderer.getContext().getExtension("EXT_color_buffer_float"));
    const packedBackDepth = !supportsHalfFloatTarget;
    renderer.domElement.dataset.showcaseDepthMode = packedBackDepth ? "packed-rgba" : "half-float";
    const studioEnvironment = createStudioEnvironment();
    const studioTarget = createStudioCubeTarget();
    const studioCamera = new THREE.CubeCamera(0.1, 40, studioTarget);
    studioCamera.position.set(0, DOCK_Y, 0);
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    studioCamera.update(renderer, studioEnvironment.scene);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(null);
    const environmentTarget = createTransmissionRenderTarget(
      supportsHalfFloatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType,
      THREE.LinearFilter
    );
    environmentTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const backDepthTarget = createTransmissionRenderTarget(
      supportsHalfFloatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType,
      THREE.NearestFilter
    );
    const backfaceDepthMaterial = createBackfaceDepthMaterial(camera, packedBackDepth);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cardsDockGroup = new THREE.Group();
    cardsScene.add(cardsDockGroup);

    const spineGeometry = new RoundedBoxGeometry(SPINE_WIDTH, SPINE_HEIGHT, SPINE_DEPTH, 10, SPINE_RADIUS);
    const spineHalfExtents = new THREE.Vector3(SPINE_WIDTH * 0.5, SPINE_HEIGHT * 0.5, SPINE_DEPTH * 0.5);
    const totalWidth = Math.max(1, (cards.length - 1) * SPINE_SPACING + SPINE_WIDTH);
    const contactShadowTexture = createContactShadowTexture();
    const neutralGlowColor = new THREE.Color("#70a99b");

    const runtimes = cards.map((card, index) => {
      const baseX = (index - (cards.length - 1) / 2) * SPINE_SPACING;
      const group = new THREE.Group();
      group.rotation.y = SPINE_YAW;
      const color = new THREE.Color(colorForKind(card.kind));
      const contactShadowMaterial = new THREE.SpriteMaterial({
        map: contactShadowTexture,
        color: new THREE.Color("#4c5d58"),
        transparent: true,
        opacity: 0.014,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      contactShadowMaterial.toneMapped = false;
      const contactShadow = new THREE.Sprite(contactShadowMaterial);
      contactShadow.position.set(0, -SPINE_HEIGHT * 0.56, 0.02);
      contactShadow.scale.set(0.32, 0.065, 1);
      contactShadow.renderOrder = 1;
      const spine = new THREE.Mesh(
        spineGeometry,
        createCrystalMaterial(
          color,
          environmentTarget.texture,
          studioTarget.texture,
          backDepthTarget.texture,
          camera,
          packedBackDepth,
          spineHalfExtents
        )
      );
      spine.userData.cardId = card.id;
      spine.renderOrder = 2;

      group.position.set(baseX, DOCK_Y, 0);
      group.add(contactShadow);
      group.add(spine);
      cardsDockGroup.add(group);

      return {
        index,
        id: card.id,
        group,
        contactShadow,
        spine,
        baseX,
        baseScreenX: 0,
        baseScreenTop: 0,
        baseScreenBottom: 0,
        baseScreenHalfWidth: 0,
        visualScreenX: 0,
        visualScreenTop: 0,
        visualScreenBottom: 0,
        visualScreenHalfWidth: 0
      };
    });

    const heroGeometry = new RoundedBoxGeometry(HERO_WIDTH, HERO_HEIGHT, HERO_DEPTH, 12, HERO_RADIUS);
    const heroMaterial = createCrystalMaterial(
      neutralGlowColor,
      environmentTarget.texture,
      studioTarget.texture,
      backDepthTarget.texture,
      camera,
      packedBackDepth,
      new THREE.Vector3(HERO_WIDTH * 0.5, HERO_HEIGHT * 0.5, HERO_DEPTH * 0.5),
      0.34
    );
    const heroMesh = new THREE.Mesh(heroGeometry, heroMaterial);
    heroMesh.renderOrder = 3;
    const heroGroup = new THREE.Group();
    heroGroup.visible = false;
    heroGroup.add(heroMesh);
    cardsScene.add(heroGroup);

    let latestPointer: PointerDockState | null = null;
    let resolvedPointer: ResolvedPointer | null = null;
    let directRuntime: SpineRuntime | null = null;
    let hoverIntentRuntime: SpineRuntime | null = null;
    let hoverIntentStartedAt = 0;
    let pointerDown = false;
    let dragging = false;
    let pressedClickCandidate: ClickCandidate | null = null;
    let pressedOnHero = false;
    let startX = 0;
    let startY = 0;
    let frame = 0;
    let lastFrameAt = performance.now();
    let visibleWidth = 10;
    let dockScale = 1;
    let viewportWidth = 1;
    let viewportHeight = 1;
    let focusX = 0;
    let focusStrength = 0;
    let highlightVelocity = 0;
    let heroPhase: HeroPhase = "idle";
    let heroCardId: string | null = null;
    let pendingHeroId: string | null = null;
    let pendingNavigationCardId: string | null = null;
    let heroNavigationInFlight = false;
    let heroPhaseStartedAt = 0;
    let heroProgress = 0;
    let heroCloseStartProgress = 1;
    let heroViewportScale = 1;
    const heroStartPosition = new THREE.Vector3();
    const heroStartScale = new THREE.Vector3(0.02, 0.75, 5.2);
    const heroTargetPosition = new THREE.Vector3(0, HERO_Y, HERO_Z);
    const heroBounds = { left: 0, right: 0, top: 0, bottom: 0 };
    let focusInitialized = false;
    let diagnosticWarmupFrames = 0;
    const diagnosticFrameTimes: number[] = [];
    const drawingBufferSize = new THREE.Vector2();
    const projectionPoint = new THREE.Vector3();
    const projectedCenter = new THREE.Vector2();
    const projectedTop = new THREE.Vector2();
    const projectedBottom = new THREE.Vector2();
    const projectedLeft = new THREE.Vector2();
    const projectedRight = new THREE.Vector2();

    function resize() {
      const rect = hostElement.getBoundingClientRect();
      const width = Math.max(320, rect.width);
      const height = Math.max(320, rect.height);
      viewportWidth = width;
      viewportHeight = height;
      const pixelRatioCap = width <= 760 ? 1.25 : 1.5;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      visibleWidth = 2 * CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * camera.aspect;
      dockScale = Math.min(1, Math.max(0.42, (visibleWidth - 0.55) / Math.max(totalWidth, 1)));
      cardsDockGroup.scale.setScalar(dockScale);
      updateScreenAnchors(width, height);
      renderer.getDrawingBufferSize(drawingBufferSize);
      environmentTarget.setSize(drawingBufferSize.x, drawingBufferSize.y);
      backDepthTarget.setSize(drawingBufferSize.x, drawingBufferSize.y);
      for (const runtime of runtimes) {
        runtime.spine.material.uniforms.uResolution.value.copy(drawingBufferSize);
        runtime.spine.material.uniforms.uNearFar.value.set(camera.near, camera.far);
        runtime.spine.material.uniforms.uCameraWorld.value.copy(camera.position);
      }
      heroMaterial.uniforms.uResolution.value.copy(drawingBufferSize);
      heroMaterial.uniforms.uNearFar.value.set(camera.near, camera.far);
      heroMaterial.uniforms.uCameraWorld.value.copy(camera.position);
      const projectedHeroWidth = HERO_WIDTH * height
        / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * CAMERA_DISTANCE);
      const maximumHeroWidth = width <= 760 ? width - 28 : Math.min(720, width * 0.64);
      heroViewportScale = Math.min(1, maximumHeroWidth / Math.max(1, projectedHeroWidth));
      if (heroPhase === "open") {
        const openRuntime = runtimeForId(heroCardId);
        if (openRuntime) captureHeroOrigin(openRuntime);
      }
      if (!focusInitialized) {
        focusX = width * 0.5;
        focusInitialized = true;
      }
    }

    function updateScreenAnchors(width: number, height: number) {
      camera.updateMatrixWorld();
      cardsDockGroup.updateMatrixWorld(true);

      for (const runtime of runtimes) {
        projectFrom(cardsDockGroup, runtime.baseX, DOCK_Y, SPINE_DEPTH * 0.5, width, height, projectedCenter);
        projectFrom(cardsDockGroup, runtime.baseX, DOCK_Y + SPINE_HEIGHT * 0.5, SPINE_DEPTH * 0.5, width, height, projectedTop);
        projectFrom(cardsDockGroup, runtime.baseX, DOCK_Y - SPINE_HEIGHT * 0.5, SPINE_DEPTH * 0.5, width, height, projectedBottom);
        projectFrom(cardsDockGroup, runtime.baseX - SPINE_WIDTH * 0.5, DOCK_Y, SPINE_DEPTH * 0.5, width, height, projectedLeft);
        projectFrom(cardsDockGroup, runtime.baseX + SPINE_WIDTH * 0.5, DOCK_Y, SPINE_DEPTH * 0.5, width, height, projectedRight);
        runtime.baseScreenX = projectedCenter.x;
        runtime.baseScreenTop = Math.min(projectedTop.y, projectedBottom.y);
        runtime.baseScreenBottom = Math.max(projectedTop.y, projectedBottom.y);
        runtime.baseScreenHalfWidth = Math.max(2, Math.abs(projectedRight.x - projectedLeft.x) * 0.5);
      }
      updateVisualBounds(width, height);
    }

    function updateVisualBounds(width: number, height: number) {
      camera.updateMatrixWorld();
      cardsDockGroup.updateMatrixWorld(true);
      for (const runtime of runtimes) {
        projectFrom(runtime.group, 0, 0, SPINE_DEPTH * 0.5, width, height, projectedCenter);
        projectFrom(runtime.group, 0, SPINE_HEIGHT * 0.5, SPINE_DEPTH * 0.5, width, height, projectedTop);
        projectFrom(runtime.group, 0, -SPINE_HEIGHT * 0.5, SPINE_DEPTH * 0.5, width, height, projectedBottom);
        projectFrom(runtime.group, -SPINE_WIDTH * 0.5, 0, SPINE_DEPTH * 0.5, width, height, projectedLeft);
        projectFrom(runtime.group, SPINE_WIDTH * 0.5, 0, SPINE_DEPTH * 0.5, width, height, projectedRight);
        runtime.visualScreenX = projectedCenter.x;
        runtime.visualScreenTop = Math.min(projectedTop.y, projectedBottom.y);
        runtime.visualScreenBottom = Math.max(projectedTop.y, projectedBottom.y);
        runtime.visualScreenHalfWidth = Math.max(2, Math.abs(projectedRight.x - projectedLeft.x) * 0.5);
      }
    }

    function projectFrom(
      object: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      width: number,
      height: number,
      target: THREE.Vector2
    ) {
      projectionPoint.set(x, y, z);
      object.localToWorld(projectionPoint);
      projectionPoint.project(camera);
      target.set((projectionPoint.x * 0.5 + 0.5) * width, (-projectionPoint.y * 0.5 + 0.5) * height);
    }

    function runtimeForId(id: string | null) {
      return id ? runtimes.find((runtime) => runtime.id === id) ?? null : null;
    }

    function captureHeroOrigin(runtime: SpineRuntime) {
      cardsDockGroup.updateMatrixWorld(true);
      runtime.group.updateMatrixWorld(true);
      runtime.group.getWorldPosition(heroStartPosition);
      const worldScale = new THREE.Vector3();
      runtime.spine.getWorldScale(worldScale);
      heroStartScale.set(
        Math.max(0.012, SPINE_WIDTH * worldScale.x / HERO_WIDTH),
        Math.max(0.2, SPINE_HEIGHT * worldScale.y / HERO_HEIGHT),
        Math.max(1, SPINE_DEPTH * worldScale.z / HERO_DEPTH)
      );
    }

    function beginHeroOpening(cardId: string, now = performance.now()) {
      const runtime = runtimeForId(cardId);
      const card = cards.find((item) => item.id === cardId);
      if (!runtime || !card) return;
      captureHeroOrigin(runtime);
      heroCardId = cardId;
      pendingHeroId = null;
      pendingNavigationCardId = null;
      heroPhase = "opening";
      heroPhaseStartedAt = now;
      heroProgress = 0;
      heroMaterial.uniforms.uTint.value.set(colorForKind(card.kind));
      heroMaterial.uniforms.uActivity.value = SELECTED_MATERIAL_STRENGTH;
      heroMaterial.uniforms.uStageDim.value = 1;
      heroGroup.position.copy(heroStartPosition);
      heroGroup.scale.copy(heroStartScale);
      heroGroup.rotation.set(0, 0, 0);
      heroGroup.visible = true;
      setHeroPresentation({ cardId, phase: "opening" });
      setHeroActionPending(false);
    }

    function beginHeroClosing(now = performance.now(), switchToId: string | null = null) {
      if (!heroCardId || (heroPhase !== "open" && heroPhase !== "opening")) return;
      pendingHeroId = switchToId && switchToId !== heroCardId ? switchToId : null;
      heroPhase = pendingHeroId ? "switching" : "closing";
      heroPhaseStartedAt = now;
      heroCloseStartProgress = heroProgress;
      setHeroPresentation({ cardId: heroCardId, phase: heroPhase });
    }

    function isHeroInputLocked() {
      return heroPhase === "opening"
        || heroPhase === "closing"
        || heroPhase === "switching"
        || pendingNavigationCardId !== null
        || heroNavigationInFlight;
    }

    function finishHeroNavigation(cardId: string) {
      const card = cards.find((item) => item.id === cardId);
      pendingNavigationCardId = null;
      if (!card) {
        setHeroActionPending(false);
        return;
      }
      heroNavigationInFlight = true;
      void Promise.resolve(onOpenActivityRef.current(card))
        .catch(() => undefined)
        .finally(() => {
          heroNavigationInFlight = false;
          setHeroActionPending(false);
        });
    }

    function requestHeroNavigation() {
      if (heroPhase !== "open" || !heroCardId || isHeroInputLocked()) return;
      pendingNavigationCardId = heroCardId;
      setHeroActionPending(true);
      beginHeroClosing();
    }

    heroActionRef.current = requestHeroNavigation;

    function updateHeroTransition(now: number) {
      const openDuration = reducedMotion ? HERO_REDUCED_DURATION : HERO_OPEN_DURATION;
      const closeDuration = reducedMotion ? HERO_REDUCED_DURATION : HERO_CLOSE_DURATION;

      if (heroPhase === "opening") {
        const rawProgress = clamp((now - heroPhaseStartedAt) / openDuration, 0, 1);
        heroProgress = smootherstep(rawProgress);
        if (rawProgress >= 1) {
          heroProgress = 1;
          heroPhase = "open";
          if (heroCardId) setHeroPresentation({ cardId: heroCardId, phase: "open" });
        }
      } else if (heroPhase === "closing" || heroPhase === "switching") {
        const rawProgress = clamp((now - heroPhaseStartedAt) / closeDuration, 0, 1);
        heroProgress = heroCloseStartProgress * (1 - smootherstep(rawProgress));
        if (rawProgress >= 1) {
          const nextId = heroPhase === "switching" ? pendingHeroId : null;
          const navigationId = nextId ? null : pendingNavigationCardId;
          const previousRuntime = runtimeForId(heroCardId);
          if (previousRuntime) previousRuntime.spine.visible = true;
          heroGroup.visible = false;
          heroProgress = 0;
          if (nextId) {
            selectedIdRef.current = nextId;
            setSelectedId(nextId);
            beginHeroOpening(nextId, now);
          } else {
            heroCardId = null;
            pendingHeroId = null;
            heroPhase = selectedIdRef.current ? "selected" : "idle";
            setHeroPresentation(null);
            if (navigationId) finishHeroNavigation(navigationId);
          }
        }
      } else if (heroPhase === "open") {
        heroProgress = 1;
      }

      const heroRuntime = runtimeForId(heroCardId);
      if (heroRuntime && heroGroup.visible) {
        const targetScale = new THREE.Vector3(heroViewportScale, heroViewportScale, heroViewportScale);
        heroGroup.position.lerpVectors(heroStartPosition, heroTargetPosition, heroProgress);
        heroGroup.scale.lerpVectors(heroStartScale, targetScale, heroProgress);
        heroGroup.rotation.set(HERO_PITCH * heroProgress, HERO_YAW * heroProgress, 0);
        heroRuntime.spine.visible = heroProgress <= 0.1;
      }
    }

    function updateHeroOverlay() {
      const overlay = heroOverlayRef.current;
      if (!overlay || !heroGroup.visible || !heroCardId) return;
      projectFrom(heroGroup, -HERO_WIDTH * 0.5, HERO_HEIGHT * 0.5, HERO_DEPTH * 0.5, viewportWidth, viewportHeight, projectedTop);
      projectFrom(heroGroup, HERO_WIDTH * 0.5, -HERO_HEIGHT * 0.5, HERO_DEPTH * 0.5, viewportWidth, viewportHeight, projectedBottom);
      projectFrom(heroGroup, -HERO_WIDTH * 0.5, 0, HERO_DEPTH * 0.5, viewportWidth, viewportHeight, projectedLeft);
      projectFrom(heroGroup, HERO_WIDTH * 0.5, 0, HERO_DEPTH * 0.5, viewportWidth, viewportHeight, projectedRight);
      heroBounds.left = Math.min(projectedLeft.x, projectedRight.x);
      heroBounds.right = Math.max(projectedLeft.x, projectedRight.x);
      heroBounds.top = Math.min(projectedTop.y, projectedBottom.y);
      heroBounds.bottom = Math.max(projectedTop.y, projectedBottom.y);
      overlay.style.left = `${heroBounds.left}px`;
      overlay.style.top = `${heroBounds.top}px`;
      overlay.style.width = `${Math.max(1, heroBounds.right - heroBounds.left)}px`;
      overlay.style.height = `${Math.max(1, heroBounds.bottom - heroBounds.top)}px`;
      overlay.style.opacity = `${smoothstep(0.42, 0.74, heroProgress)}`;
    }

    function isPointInsideHero(x: number, y: number, margin = 8) {
      return heroGroup.visible
        && x >= heroBounds.left - margin
        && x <= heroBounds.right + margin
        && y >= heroBounds.top - margin
        && y <= heroBounds.bottom + margin;
    }

    function updateHoverIntent(nextRuntime: SpineRuntime | null) {
      if (hoverIntentRuntime?.id === nextRuntime?.id) return;
      hoverIntentRuntime = nextRuntime;
      hoverIntentStartedAt = performance.now();
      if (!nextRuntime && hoveredIdRef.current) {
        hoveredIdRef.current = null;
        setHoveredId(null);
      }
    }

    function nearestRuntimeAt(x: number) {
      let nearest: SpineRuntime | null = null;
      let distance = Number.POSITIVE_INFINITY;
      for (const runtime of runtimes) {
        const nextDistance = Math.abs(runtime.baseScreenX - x);
        if (nextDistance < distance) {
          nearest = runtime;
          distance = nextDistance;
        }
      }
      return { runtime: nearest, distance };
    }

    function verticalDistance(runtime: SpineRuntime, y: number) {
      if (y < runtime.baseScreenTop) return runtime.baseScreenTop - y;
      if (y > runtime.baseScreenBottom) return y - runtime.baseScreenBottom;
      return 0;
    }

    function visualHitScore(runtime: SpineRuntime, x: number, y: number, margin = DIRECT_HIT_MARGIN) {
      const left = Math.min(
        runtime.baseScreenX - runtime.baseScreenHalfWidth,
        runtime.visualScreenX - runtime.visualScreenHalfWidth
      ) - margin;
      const right = Math.max(
        runtime.baseScreenX + runtime.baseScreenHalfWidth,
        runtime.visualScreenX + runtime.visualScreenHalfWidth
      ) + margin;
      const top = Math.min(runtime.baseScreenTop, runtime.visualScreenTop) - margin;
      const bottom = Math.max(runtime.baseScreenBottom, runtime.visualScreenBottom) + margin;
      if (x < left || x > right || y < top || y > bottom) return Number.POSITIVE_INFINITY;
      const verticalOffset = y < runtime.visualScreenTop
        ? runtime.visualScreenTop - y
        : y > runtime.visualScreenBottom
          ? y - runtime.visualScreenBottom
          : 0;
      return Math.abs(x - runtime.visualScreenX) + verticalOffset * 0.35;
    }

    function nearestVisualRuntimeAt(x: number, y: number, margin = DIRECT_HIT_MARGIN) {
      let runtime: SpineRuntime | null = null;
      let score = Number.POSITIVE_INFINITY;
      for (const candidate of runtimes) {
        const nextScore = visualHitScore(candidate, x, y, margin);
        if (nextScore < score) {
          runtime = candidate;
          score = nextScore;
        }
      }
      return { runtime, score };
    }

    function isWithinDockSelectionLane(x: number, y: number) {
      if (!runtimes.length) return false;
      const spacing = runtimes.length > 1
        ? Math.abs(runtimes[1].baseScreenX - runtimes[0].baseScreenX)
        : 36;
      const firstX = runtimes[0].baseScreenX - spacing * 0.5;
      const lastX = runtimes[runtimes.length - 1].baseScreenX + spacing * 0.5;
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const runtime of runtimes) {
        top = Math.min(top, runtime.baseScreenTop, runtime.visualScreenTop);
        bottom = Math.max(bottom, runtime.baseScreenBottom, runtime.visualScreenBottom);
      }
      return x >= firstX
        && x <= lastX
        && y >= top - CLICK_LANE_MARGIN
        && y <= bottom + CLICK_LANE_MARGIN;
    }

    function nearestRuntimeForGapClick(x: number) {
      let nearest: SpineRuntime | null = null;
      let distance = Number.POSITIVE_INFINITY;
      const selectedRuntimeId = selectedIdRef.current;
      for (const runtime of runtimes) {
        const nextDistance = Math.abs(runtime.baseScreenX - x);
        if (nextDistance < distance - CLICK_TIE_EPSILON) {
          nearest = runtime;
          distance = nextDistance;
          continue;
        }
        if (Math.abs(nextDistance - distance) > CLICK_TIE_EPSILON || !nearest) continue;
        if (runtime.id === selectedRuntimeId) {
          nearest = runtime;
        } else if (nearest.id !== selectedRuntimeId && runtime.index < nearest.index) {
          nearest = runtime;
        }
      }
      return nearest;
    }

    function resolveClickCandidate(x: number, y: number): ClickCandidate {
      const direct = nearestVisualRuntimeAt(x, y, DIRECT_CLICK_MARGIN).runtime;
      if (direct) return { runtimeId: direct.id, source: "direct" };
      if (isWithinDockSelectionLane(x, y)) {
        return { runtimeId: nearestRuntimeForGapClick(x)?.id ?? null, source: "gap" };
      }
      return { runtimeId: null, source: "outside" };
    }

    function storePointer(event: PointerEvent) {
      latestPointer = { clientX: event.clientX, clientY: event.clientY };
    }

    function resolveLatestPointer(): ResolvedPointer | null {
      if (!latestPointer) {
        resolvedPointer = null;
        if (directRuntime) {
          directRuntime = null;
          updateHoverIntent(null);
        }
        renderer.domElement.style.cursor = "default";
        return null;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const x = latestPointer.clientX - rect.left;
      const y = latestPointer.clientY - rect.top;
      const nearest = nearestRuntimeAt(x);
      const spacing = runtimes.length > 1 ? Math.abs(runtimes[1].baseScreenX - runtimes[0].baseScreenX) : 36;
      const firstX = runtimes[0]?.baseScreenX ?? 0;
      const lastX = runtimes[runtimes.length - 1]?.baseScreenX ?? 0;
      const withinDockWidth = x >= firstX - spacing * 0.55 && x <= lastX + spacing * 0.55;
      const distanceY = nearest.runtime ? verticalDistance(nearest.runtime, y) : Number.POSITIVE_INFINITY;
      const waveStrength = withinDockWidth && distanceY <= POINTER_ACTIVATION_DISTANCE
        ? 1 - smoothstep(18, POINTER_ACTIVATION_DISTANCE, distanceY)
        : 0;

      const visualCandidate = nearestVisualRuntimeAt(x, y);
      let nextDirect = visualCandidate.runtime;

      if (directRuntime && nextDirect?.id !== directRuntime.id) {
        const currentScore = visualHitScore(directRuntime, x, y, DIRECT_HIT_MARGIN + 8);
        if (Number.isFinite(currentScore) && (!nextDirect || currentScore <= visualCandidate.score + 6)) {
          nextDirect = directRuntime;
        }
      }

      if (directRuntime?.id !== nextDirect?.id) {
        directRuntime = nextDirect;
        updateHoverIntent(directRuntime);
      }
      resolvedPointer = {
        x,
        y,
        directRuntime,
        waveStrength
      };
      renderer.domElement.style.cursor = directRuntime ? "pointer" : "default";
      return resolvedPointer;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      renderer.domElement.focus({ preventScroll: true });
      pointerDown = true;
      dragging = false;
      pressedOnHero = false;
      startX = event.clientX;
      startY = event.clientY;
      renderer.domElement.setPointerCapture?.(event.pointerId);
      storePointer(event);
      const pointer = resolveLatestPointer();
      const transitionLocked = isHeroInputLocked();
      if (transitionLocked || !pointer) {
        pressedClickCandidate = null;
      } else if (heroPhase === "open" && isPointInsideHero(pointer.x, pointer.y)) {
        pressedOnHero = true;
        pressedClickCandidate = null;
      } else {
        pressedClickCandidate = resolveClickCandidate(pointer.x, pointer.y);
      }
    }

    function handlePointerMove(event: PointerEvent) {
      storePointer(event);
      if (!pointerDown) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > TAP_MOVE_THRESHOLD) {
        dragging = true;
      }
    }

    function handlePointerUp(event: PointerEvent) {
      renderer.domElement.releasePointerCapture?.(event.pointerId);
      storePointer(event);
      const releasePointer = resolveLatestPointer();
      const releaseInSelectionLane = releasePointer
        ? isWithinDockSelectionLane(releasePointer.x, releasePointer.y)
        : false;
      if (pointerDown && !dragging) {
        const transitionLocked = isHeroInputLocked();
        if (transitionLocked) {
          // Ignore repeated input until the physical transition reaches a stable endpoint.
        } else if (heroPhase === "open") {
          if (pressedOnHero && releasePointer && isPointInsideHero(releasePointer.x, releasePointer.y)) {
            // The first version of the hero card is informational only.
          } else if (pressedClickCandidate?.runtimeId && releaseInSelectionLane) {
            if (pressedClickCandidate.runtimeId !== heroCardId) {
              beginHeroClosing(performance.now(), pressedClickCandidate.runtimeId);
            }
          } else {
            beginHeroClosing();
          }
        } else if (pressedClickCandidate?.runtimeId && releaseInSelectionLane) {
          const candidate = pressedClickCandidate;
          const candidateId = candidate.runtimeId as string;
          if (candidate.source === "direct" && selectedIdRef.current === candidateId) {
            heroPhase = "selected";
            beginHeroOpening(candidateId);
          } else {
            selectedIdRef.current = candidateId;
            setSelectedId(candidateId);
            heroPhase = "selected";
          }
        } else {
          selectedIdRef.current = null;
          setSelectedId(null);
          heroPhase = "idle";
        }
      }
      pointerDown = false;
      dragging = false;
      pressedClickCandidate = null;
      pressedOnHero = false;
      if (event.pointerType !== "mouse") clearPointer();
    }

    function clearPointer() {
      latestPointer = null;
      resolvedPointer = null;
      directRuntime = null;
      updateHoverIntent(null);
      if (hoveredIdRef.current) {
        hoveredIdRef.current = null;
        setHoveredId(null);
      }
      renderer.domElement.style.cursor = "default";
    }

    function handlePointerLeave() {
      clearPointer();
    }

    function handlePointerCancel() {
      pointerDown = false;
      dragging = false;
      pressedClickCandidate = null;
      pressedOnHero = false;
      clearPointer();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Enter" && heroPhase === "open" && !isHeroInputLocked()) {
        event.preventDefault();
        requestHeroNavigation();
        return;
      }
      if (
        event.key === "Enter"
        && selectedIdRef.current
        && (heroPhase === "selected" || heroPhase === "idle")
        && !isHeroInputLocked()
      ) {
        event.preventDefault();
        heroPhase = "selected";
        beginHeroOpening(selectedIdRef.current);
        return;
      }
      if (event.key !== "Escape") return;
      if (heroNavigationInFlight || pendingNavigationCardId) {
        event.preventDefault();
        return;
      }
      if (heroPhase === "opening" || heroPhase === "open") {
        event.preventDefault();
        beginHeroClosing();
      } else if (heroPhase === "switching") {
        event.preventDefault();
        pendingHeroId = null;
        heroPhase = "closing";
        setHeroPresentation(heroCardId ? { cardId: heroCardId, phase: "closing" } : null);
      } else if (heroPhase === "selected" && selectedIdRef.current) {
        event.preventDefault();
        selectedIdRef.current = null;
        setSelectedId(null);
        heroPhase = "idle";
      }
    }

    function animate() {
      const now = performance.now();
      const rawFrameTime = Math.max(0, now - lastFrameAt);
      const dt = Math.min(rawFrameTime / 1000, 0.033);
      lastFrameAt = now;
      updateHeroTransition(now);
      const dockMotionFactor = 1 - heroProgress * (1 - HERO_DOCK_MOTION);
      const motionScale = reducedMotion ? 0 : dockMotionFactor;
      const pointer = resolveLatestPointer();
      const selectedRuntime = runtimes.find((item) => item.id === selectedIdRef.current) ?? null;
      const firstX = runtimes[0]?.baseScreenX ?? focusX;
      const lastX = runtimes[runtimes.length - 1]?.baseScreenX ?? focusX;
      const spacing = runtimes.length > 1
        ? Math.max(1, Math.abs(runtimes[1].baseScreenX - runtimes[0].baseScreenX))
        : 36;
      const hasPointerWave = pointer != null && pointer.waveStrength > 0;
      const targetFocusX = hasPointerWave
        ? clamp(pointer.x, firstX, lastX)
        : selectedRuntime?.baseScreenX ?? focusX;
      const targetFocusStrength = hasPointerWave ? pointer.waveStrength : selectedRuntime ? SELECTED_MATERIAL_STRENGTH : 0;
      const hoverRuntime = hasPointerWave
        ? pointer.directRuntime || nearestRuntimeAt(targetFocusX).runtime
        : null;
      const previousFocusX = focusX;
      focusX = dampTowards(focusX, targetFocusX, reducedMotion ? 0.07 : 0.12, dt);
      focusStrength = dampTowards(focusStrength, targetFocusStrength, reducedMotion ? 0.07 : 0.12, dt);
      const focusPixelsPerSecond = dt > 0 ? (focusX - previousFocusX) / dt : 0;
      const velocityTarget = reducedMotion
        ? 0
        : clamp(focusPixelsPerSecond / Math.max(120, spacing * 7), -1, 1);
      const velocitySettleTime = Math.abs(velocityTarget) > 0.02 ? 0.14 : 0.22;
      highlightVelocity = dampTowards(highlightVelocity, velocityTarget, velocitySettleTime, dt);

      if (hoverIntentRuntime && now - hoverIntentStartedAt >= HOVER_INTENT_DELAY && hoveredIdRef.current !== hoverIntentRuntime.id) {
        hoveredIdRef.current = hoverIntentRuntime.id;
        setHoveredId(hoverIntentRuntime.id);
      }

      const motionTargets: RuntimeMotionTarget[] = runtimes.map((runtime) => {
        const hoverDistance = Math.abs(runtime.baseScreenX - focusX) / spacing;
        const selectedDistance = selectedRuntime
          ? Math.abs(runtime.baseScreenX - selectedRuntime.baseScreenX) / spacing
          : Number.POSITIVE_INFINITY;
        const hoverInfluence = hasPointerWave ? waveFalloff(hoverDistance) * focusStrength : 0;
        const selectedInfluence = selectedRuntime ? waveFalloff(selectedDistance) : 0;
        const sharedFocus = hoverRuntime?.id === selectedRuntime?.id;
        const hoverPushInfluence = sharedFocus
          ? Math.max(hoverInfluence, selectedInfluence)
          : hoverInfluence;
        const hoverPush = hoverRuntime && hoverRuntime.id !== runtime.id
          ? Math.sign(runtime.index - hoverRuntime.index) * hoverPushInfluence * HOVER_NEIGHBOR_PUSH
          : 0;
        const selectedPush = selectedRuntime
          && selectedRuntime.id !== runtime.id
          && selectedRuntime.id !== hoverRuntime?.id
          ? Math.sign(runtime.index - selectedRuntime.index) * selectedInfluence * SELECTED_NEIGHBOR_PUSH
          : 0;
        const magnetRatio = hoverRuntime?.id === runtime.id && hasPointerWave
          ? clamp(((pointer?.x ?? runtime.baseScreenX) - runtime.baseScreenX) / spacing, -1, 1)
          : 0;
        const targetX = runtime.baseX + (
          clamp(hoverPush + selectedPush, -MAX_COMBINED_PUSH, MAX_COMBINED_PUSH)
          + magnetRatio * 0.04
        ) * motionScale;
        const targetY = DOCK_Y + Math.max(
          hoverInfluence * HOVER_LIFT,
          selectedInfluence * SELECTED_LIFT
        ) * motionScale;
        const targetZ = Math.max(
          hoverInfluence * HOVER_FORWARD,
          selectedInfluence * SELECTED_FORWARD
        ) * motionScale;
        const targetScaleX = 1 + Math.max(
          hoverInfluence * HOVER_SCALE_X_GAIN,
          selectedInfluence * SELECTED_SCALE_X_GAIN
        ) * motionScale;
        const targetScaleY = 1 + Math.max(
          hoverInfluence * HOVER_SCALE_Y_GAIN,
          selectedInfluence * SELECTED_SCALE_Y_GAIN
        ) * motionScale;
        const activity = clamp(Math.max(
          hoverInfluence,
          selectedInfluence * SELECTED_MATERIAL_STRENGTH
        ), 0, 1);

        return {
          activity,
          hoverInfluence,
          selectedInfluence,
          targetX,
          targetY,
          targetZ,
          targetScaleX,
          targetScaleY
        };
      });

      if (
        selectedRuntime
        && hoverRuntime
        && selectedRuntime.id !== hoverRuntime.id
        && Math.abs(selectedRuntime.index - hoverRuntime.index) === 1
      ) {
        const leftRuntime = selectedRuntime.index < hoverRuntime.index ? selectedRuntime : hoverRuntime;
        const rightRuntime = leftRuntime.id === selectedRuntime.id ? hoverRuntime : selectedRuntime;
        const leftTarget = motionTargets[leftRuntime.index];
        const rightTarget = motionTargets[rightRuntime.index];
        const pixelsPerWorldUnit = spacing / SPINE_SPACING;
        const plannedDistancePx = Math.abs(rightTarget.targetX - leftTarget.targetX) * pixelsPerWorldUnit;
        const minimumDistancePx = leftRuntime.baseScreenHalfWidth * leftTarget.targetScaleX
          + rightRuntime.baseScreenHalfWidth * rightTarget.targetScaleX
          + MIN_DUAL_FOCUS_GAP_PX;
        if (plannedDistancePx < minimumDistancePx) {
          const adjustment = (minimumDistancePx - plannedDistancePx) / pixelsPerWorldUnit / 2;
          leftTarget.targetX -= adjustment;
          rightTarget.targetX += adjustment;
        }
      }

      for (const runtime of runtimes) {
        const target = motionTargets[runtime.index];

        runtime.group.position.set(
          dampTowards(runtime.group.position.x, target.targetX, 0.16, dt),
          dampTowards(runtime.group.position.y, target.targetY, 0.16, dt),
          dampTowards(runtime.group.position.z, target.targetZ, 0.16, dt)
        );
        runtime.group.scale.set(
          dampTowards(runtime.group.scale.x, target.targetScaleX, 0.16, dt),
          dampTowards(runtime.group.scale.y, target.targetScaleY, 0.16, dt),
          dampTowards(runtime.group.scale.z, 1, 0.16, dt)
        );
        runtime.spine.material.uniforms.uActivity.value = dampTowards(
          runtime.spine.material.uniforms.uActivity.value,
          target.activity,
          reducedMotion ? 0.08 : 0.14,
          dt
        );
        runtime.spine.material.uniforms.uHighlightShift.value = dampTowards(
          runtime.spine.material.uniforms.uHighlightShift.value,
          reducedMotion ? 0 : highlightVelocity * target.activity,
          Math.abs(highlightVelocity) > 0.02 ? 0.14 : 0.22,
          dt
        );
        runtime.spine.material.uniforms.uStageDim.value = dampTowards(
          runtime.spine.material.uniforms.uStageDim.value,
          1 - heroProgress * (1 - HERO_DOCK_DIM),
          reducedMotion ? 0.08 : 0.14,
          dt
        );
        const contactMaterial = runtime.contactShadow.material as THREE.SpriteMaterial;
        const contactStrength = (0.012 + target.activity * 0.018) * (1 - heroProgress * 0.65);
        contactMaterial.opacity = dampTowards(contactMaterial.opacity, contactStrength, 0.16, dt);
        runtime.contactShadow.scale.x = dampTowards(runtime.contactShadow.scale.x, 0.3 + target.activity * 0.11, 0.16, dt);
        runtime.contactShadow.scale.y = dampTowards(runtime.contactShadow.scale.y, 0.058 + target.activity * 0.018, 0.16, dt);
      }
      updateVisualBounds(viewportWidth, viewportHeight);
      updateHeroOverlay();

      renderer.setRenderTarget(environmentTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.render(backgroundScene, backgroundCamera);

      renderer.setRenderTarget(backDepthTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      cardsScene.overrideMaterial = backfaceDepthMaterial;
      renderer.render(cardsScene, camera);
      cardsScene.overrideMaterial = null;

      renderer.setRenderTarget(null);
      renderer.setClearColor(0x020403, 1);
      renderer.clear(true, true, true);
      renderer.render(backgroundScene, backgroundCamera);
      renderer.clearDepth();
      renderer.render(cardsScene, camera);

      if (diagnosticsEnabled) {
        const diagnosticRuntime = pointer?.directRuntime || hoverRuntime || selectedRuntime;
        const diagnosticNeighbor = diagnosticRuntime
          ? runtimes[diagnosticRuntime.index < runtimes.length - 1 ? diagnosticRuntime.index + 1 : diagnosticRuntime.index - 1]
          : null;
        const currentClickCandidate = pointer
          ? resolveClickCandidate(pointer.x, pointer.y)
          : { runtimeId: null, source: "outside" as const };
        renderer.domElement.dataset.showcaseHighlightVelocity = highlightVelocity.toFixed(3);
        renderer.domElement.dataset.showcaseFocusStrength = focusStrength.toFixed(3);
        renderer.domElement.dataset.showcaseActiveScaleX = diagnosticRuntime?.group.scale.x.toFixed(3) || "1.000";
        renderer.domElement.dataset.showcaseActiveScaleY = diagnosticRuntime?.group.scale.y.toFixed(3) || "1.000";
        renderer.domElement.dataset.showcaseNeighborScaleX = diagnosticNeighbor?.group.scale.x.toFixed(3) || "1.000";
        renderer.domElement.dataset.showcaseActiveBaseX = diagnosticRuntime?.baseScreenX.toFixed(2) || "0.00";
        renderer.domElement.dataset.showcaseActiveVisualX = diagnosticRuntime?.visualScreenX.toFixed(2) || "0.00";
        renderer.domElement.dataset.showcaseActiveVisualTop = diagnosticRuntime?.visualScreenTop.toFixed(2) || "0.00";
        renderer.domElement.dataset.showcaseActiveVisualBottom = diagnosticRuntime?.visualScreenBottom.toFixed(2) || "0.00";
        renderer.domElement.dataset.showcaseActiveVisualHalfWidth = diagnosticRuntime?.visualScreenHalfWidth.toFixed(2) || "0.00";
        renderer.domElement.dataset.showcasePointerX = pointer?.x.toFixed(2) || "0.00";
        renderer.domElement.dataset.showcaseDirectId = pointer?.directRuntime?.id || "";
        renderer.domElement.dataset.showcaseHoveredId = hoveredIdRef.current || "";
        renderer.domElement.dataset.showcaseSelectedId = selectedRuntime?.id || "";
        renderer.domElement.dataset.showcaseSelectedScaleX = selectedRuntime?.group.scale.x.toFixed(3) || "1.000";
        renderer.domElement.dataset.showcaseSelectedScaleY = selectedRuntime?.group.scale.y.toFixed(3) || "1.000";
        renderer.domElement.dataset.showcaseHoverScaleX = hoverRuntime?.group.scale.x.toFixed(3) || "1.000";
        renderer.domElement.dataset.showcaseHoverScaleY = hoverRuntime?.group.scale.y.toFixed(3) || "1.000";
        renderer.domElement.dataset.showcaseClickCandidateId = currentClickCandidate.runtimeId || "";
        renderer.domElement.dataset.showcaseClickCandidateSource = currentClickCandidate.source;
        renderer.domElement.dataset.showcaseHeroPhase = heroPhase;
        renderer.domElement.dataset.showcaseHeroId = heroCardId || "";
        renderer.domElement.dataset.showcaseHeroPendingId = pendingHeroId || "";
        renderer.domElement.dataset.showcaseHeroProgress = heroProgress.toFixed(3);
        renderer.domElement.dataset.showcaseHeroActionPending = pendingNavigationCardId || heroNavigationInFlight
          ? "true"
          : "false";
        renderer.domElement.dataset.showcaseActiveLift = diagnosticRuntime
          ? (diagnosticRuntime.group.position.y - DOCK_Y).toFixed(3)
          : "0.000";
        diagnosticWarmupFrames += 1;
        if (diagnosticWarmupFrames > 30) diagnosticFrameTimes.push(rawFrameTime);
        if (diagnosticFrameTimes.length >= 180) {
          const sorted = [...diagnosticFrameTimes].sort((a, b) => a - b);
          const average = diagnosticFrameTimes.reduce((sum, value) => sum + value, 0) / diagnosticFrameTimes.length;
          const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
          renderer.domElement.dataset.showcaseFrameAverageMs = average.toFixed(2);
          renderer.domElement.dataset.showcaseFrameP95Ms = p95.toFixed(2);
          diagnosticFrameTimes.length = 0;
        }
      }

      frame = window.requestAnimationFrame(animate);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostElement);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("keydown", handleKeyDown);
    resize();
    animate();

    return () => {
      heroActionRef.current = null;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("keydown", handleKeyDown);
      spineGeometry.dispose();
      heroGeometry.dispose();
      for (const runtime of runtimes) {
        runtime.spine.visible = true;
        runtime.spine.material.dispose();
        (runtime.contactShadow.material as THREE.SpriteMaterial).dispose();
      }
      heroMaterial.dispose();
      contactShadowTexture.dispose();
      backdropGeometry.dispose();
      backdropMaterial.dispose();
      disposeObject(studioEnvironment.scene);
      studioTarget.dispose();
      backfaceDepthMaterial.dispose();
      environmentTarget.dispose();
      backDepthTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [cards]);

  return (
    <div className="activity-showcase-page">
      <div className="activity-showcase-backdrop" />
      <div className="activity-showcase-stage" ref={hostRef} />
      <div className="activity-showcase-vignette" />
      <button className="activity-showcase-back" onClick={onBack} type="button" aria-label="进入代码工作台">
        <ArrowLeft size={16} />
        <span>进入代码工作台</span>
      </button>
      <div className="activity-showcase-copy" aria-hidden="true">
        <span>{mode === "entry" ? "活动展示台" : "本地活动展示台"}</span>
      </div>
      {heroCard ? (
        <div
          ref={heroOverlayRef}
          className={[
            "activity-showcase-hero-copy",
            `is-${heroPresentation?.phase || "opening"}`,
            heroActionPending ? "is-action-pending" : ""
          ].filter(Boolean).join(" ")}
          aria-live="polite"
        >
          <div className="activity-showcase-hero-body">
            <div className="activity-showcase-hero-meta">
              <span>{heroCard.kind_label || "活动"}</span>
              <time>{formatActivityTime(heroCard.created_at)}</time>
              <em>{heroCard.status || "本地"}</em>
            </div>
            <strong>{heroCard.title}</strong>
            <p>{compactSubtitle(heroCard)}</p>
          </div>
          <button
            className="activity-showcase-hero-action"
            type="button"
            disabled={!heroActionReady}
            aria-busy={heroActionPending}
            onClick={() => heroActionRef.current?.()}
          >
            <span>{heroCard.guide ? "进入功能页" : "打开关联内容"}</span>
            <ArrowUpRight size={15} />
          </button>
        </div>
      ) : null}
      <div className={["activity-showcase-info", active && !heroCard ? "is-visible" : ""].join(" ")} aria-live="polite">
        <span>{active?.kind_label || "活动"}</span>
        <strong>{active?.title || "靠近侧脊查看活动"}</strong>
        <small>{active ? compactSubtitle(active) : "点击侧脊锁定；点击空白清除选择。"}</small>
      </div>
    </div>
  );
}

function buildShowcaseCards(items: ActivityStarItem[]): ShowcaseCard[] {
  const realCards = items.slice(0, MAX_CARDS).map((item) => ({ ...item, guide: false }));
  return realCards.length ? realCards : guideCards();
}

function guideCards(): ShowcaseCard[] {
  const now = new Date().toISOString();
  return [
    ["guide:workbench", "代码工作台", "粘贴代码或导入单个文件，生成第一份本地审查报告。", "workbench"],
    ["guide:projects", "项目审查", "导入真实工作区，生成项目报告和问题清单。", "projects"],
    ["guide:history", "历史报告", "重新打开最近报告，继续阅读、导出和沉淀。", "history"],
    ["guide:findings", "问题清单", "跟踪风险、修复建议和后续学习卡片。", "findings"],
    ["guide:cards", "知识卡片", "把高价值问题沉淀成长期复习材料。", "cards"],
    ["guide:logs", "每日日志", "把报告、问题、对话和行动草稿写入当天复盘。", "logs"]
  ].map(([id, title, subtitle, page], index) => ({
    id,
    kind: "guide",
    kind_label: "入口",
    title,
    subtitle,
    status: index === 0 ? "ready" : "idle",
    target_id: "",
    created_at: now,
    route: { page, target_id: null, session_id: null, plan_id: null, context_type: "入口" },
    weight: 1,
    guide: true
  }));
}

function createStaticBackdropMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      varying vec2 vUv;

      void main() {
        vec2 uv = vUv;
        float vignette = smoothstep(0.14, 0.92, length((uv - 0.5) * vec2(0.82, 1.16)));
        float dockDepth = exp(
          -pow((uv.x - 0.5) / 0.29, 2.0)
          -pow((uv.y - 0.14) / 0.31, 2.0)
        );
        float verticalAtmosphere = exp(
          -pow((uv.x - 0.47) / 0.19, 2.0)
          -pow((uv.y - 0.2) / 0.42, 2.0)
        ) * 0.58 + exp(
          -pow((uv.x - 0.59) / 0.24, 2.0)
          -pow((uv.y - 0.18) / 0.46, 2.0)
        ) * 0.32;
        float studioColumns = exp(
          -pow((uv.x - 0.43) / 0.075, 2.0)
          -pow((uv.y - 0.19) / 0.36, 2.0)
        ) * 0.38 + exp(
          -pow((uv.x - 0.51) / 0.085, 2.0)
          -pow((uv.y - 0.2) / 0.4, 2.0)
        ) * 0.3 + exp(
          -pow((uv.x - 0.595) / 0.072, 2.0)
          -pow((uv.y - 0.17) / 0.34, 2.0)
        ) * 0.34;
        vec3 color = vec3(0.00135, 0.00155, 0.0015);
        color += vec3(0.0098, 0.0105, 0.0101) * dockDepth;
        color += vec3(0.0024, 0.0027, 0.0026) * verticalAtmosphere;
        color += vec3(0.0052, 0.0059, 0.0057) * studioColumns;
        color *= 1.0 - vignette * 0.38;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
}

function createStudioEnvironment() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#020302");
  const softboxTexture = createStudioSoftboxTexture();

  const addSoftbox = (
    position: THREE.Vector3,
    rotation: THREE.Euler,
    width: number,
    height: number,
    color: string,
    opacity: number
  ) => {
    const material = new THREE.MeshBasicMaterial({
      map: softboxTexture,
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    material.toneMapped = false;
    const softbox = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    softbox.position.copy(position);
    softbox.rotation.copy(rotation);
    scene.add(softbox);
  };

  addSoftbox(
    new THREE.Vector3(-4.9, DOCK_Y + 1.15, -3.4),
    new THREE.Euler(0, Math.PI * 0.34, 0),
    3.1,
    6.2,
    "#dddcd7",
    0.72
  );
  addSoftbox(
    new THREE.Vector3(4.5, DOCK_Y - 0.2, -2.7),
    new THREE.Euler(0, -Math.PI * 0.31, 0),
    2.5,
    4.9,
    "#aeb7b3",
    0.46
  );
  addSoftbox(
    new THREE.Vector3(0.75, DOCK_Y + 5.0, -3.1),
    new THREE.Euler(Math.PI / 2, 0, 0),
    4.4,
    2.6,
    "#c8ceca",
    0.28
  );
  return { scene, softboxTexture };
}

function createStudioCubeTarget() {
  const target = new THREE.WebGLCubeRenderTarget(128, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  return target;
}

function createStudioSoftboxTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  const glow = context.createRadialGradient(256, 256, 12, 256, 256, 256);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.42, "rgba(255, 255, 255, 0.72)");
  glow.addColorStop(0.78, "rgba(255, 255, 255, 0.12)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createTransmissionRenderTarget(type: THREE.TextureDataType, filter: THREE.MagnificationTextureFilter) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type,
    minFilter: filter,
    magFilter: filter,
    depthBuffer: true,
    stencilBuffer: false
  });
  target.texture.generateMipmaps = false;
  return target;
}

function createBackfaceDepthMaterial(camera: THREE.PerspectiveCamera, packedDepth: boolean) {
  return new THREE.ShaderMaterial({
    defines: { PACKED_BACK_DEPTH: packedDepth ? 1 : 0 },
    uniforms: {
      uNearFar: { value: new THREE.Vector2(camera.near, camera.far) }
    },
    vertexShader: `
      varying float vViewDepth;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      #include <packing>

      uniform vec2 uNearFar;
      varying float vViewDepth;

      void main() {
        float depth = clamp((vViewDepth - uNearFar.x) / max(0.0001, uNearFar.y - uNearFar.x), 0.0, 1.0);
        #if PACKED_BACK_DEPTH == 1
          gl_FragColor = packDepthToRGBA(depth);
        #else
          gl_FragColor = vec4(depth, 0.0, 0.0, 1.0);
        #endif
      }
    `,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NoBlending,
    toneMapped: false
  });
}

function createContactShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  const contact = context.createRadialGradient(128, 64, 2, 128, 64, 120);
  contact.addColorStop(0, "rgba(255, 255, 255, 0.72)");
  contact.addColorStop(0.38, "rgba(255, 255, 255, 0.2)");
  contact.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = contact;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createCrystalMaterial(
  kindColor: THREE.Color,
  sceneColorTexture: THREE.Texture,
  environmentTexture: THREE.CubeTexture,
  backDepthTexture: THREE.Texture,
  camera: THREE.PerspectiveCamera,
  packedDepth: boolean,
  halfExtents: THREE.Vector3,
  environmentGain = 1
) {
  const tint = kindColor.clone();
  const material = new THREE.ShaderMaterial({
    defines: { PACKED_BACK_DEPTH: packedDepth ? 1 : 0 },
    uniforms: {
      uActivity: { value: 0 },
      uSceneColor: { value: sceneColorTexture },
      uEnvironmentMap: { value: environmentTexture },
      uEnvironmentGain: { value: environmentGain },
      uBackDepth: { value: backDepthTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNearFar: { value: new THREE.Vector2(camera.near, camera.far) },
      uCameraWorld: { value: camera.position.clone() },
      uTint: { value: tint },
      uHighlightShift: { value: 0 },
      uHalfExtents: { value: halfExtents.clone() },
      uStageDim: { value: 1 }
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      varying vec3 vLocalNormal;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vLocalPosition = position;
        vViewNormal = normalize(normalMatrix * normal);
        vViewPosition = viewPosition.xyz;
        vLocalNormal = normalize(normal);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      precision highp float;
      #include <packing>

      uniform float uActivity;
      uniform sampler2D uSceneColor;
      uniform samplerCube uEnvironmentMap;
      uniform float uEnvironmentGain;
      uniform sampler2D uBackDepth;
      uniform vec2 uResolution;
      uniform vec2 uNearFar;
      uniform vec3 uCameraWorld;
      uniform vec3 uTint;
      uniform float uHighlightShift;
      uniform vec3 uHalfExtents;
      uniform float uStageDim;

      varying vec3 vLocalPosition;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      varying vec3 vLocalNormal;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;

      float readBackDepth(vec2 uv) {
        vec4 sampleValue = texture2D(uBackDepth, uv);
        #if PACKED_BACK_DEPTH == 1
          return unpackRGBAToDepth(sampleValue);
        #else
          return sampleValue.r;
        #endif
      }

      vec3 hiddenOpticsColor(vec2 uv) {
        float leftPanel = exp(
          -pow((uv.x - 0.442) / 0.052, 2.0)
          -pow((uv.y - 0.18) / 0.42, 2.0)
        );
        float rightPanel = exp(
          -pow((uv.x - 0.558) / 0.064, 2.0)
          -pow((uv.y - 0.16) / 0.46, 2.0)
        );
        float lowPanel = exp(
          -pow((uv.x - 0.51) / 0.2, 2.0)
          -pow((uv.y - 0.09) / 0.11, 2.0)
        );
        return vec3(0.3, 0.33, 0.315) * leftPanel
          + vec3(0.055, 0.24, 0.18) * rightPanel
          + vec3(0.052, 0.063, 0.058) * lowPanel;
      }

      float refractiveStudioSignal(vec2 uv) {
        return dot(hiddenOpticsColor(uv), vec3(0.2126, 0.7152, 0.0722));
      }

      void main() {
        vec2 screenUv = clamp(gl_FragCoord.xy / max(uResolution, vec2(1.0)), vec2(0.002), vec2(0.998));
        vec2 pixel = 1.0 / max(uResolution, vec2(1.0));
        float horizontal = clamp(vLocalPosition.x / max(0.0001, uHalfExtents.x), -1.0, 1.0);
        float vertical = clamp(vLocalPosition.y / max(0.0001, uHalfExtents.y), -1.0, 1.0);
        float longitudinal = clamp(vLocalPosition.z / max(0.0001, uHalfExtents.z), -1.0, 1.0);
        float fullWidth = max(0.02, uHalfExtents.x * 2.0);
        float fullDepth = max(0.02, uHalfExtents.z * 2.0);
        float widthProfile = pow(max(0.0, 1.0 - horizontal * horizontal), 0.56);
        float depthProfile = pow(max(0.0, 1.0 - longitudinal * longitudinal), 0.56);
        float analyticThickness = max(fullDepth * widthProfile, fullWidth * depthProfile)
          * mix(1.0, 0.72, smoothstep(0.74, 0.99, abs(vertical)));
        float frontViewDepth = -vViewPosition.z;
        float frontDepth = clamp(
          (frontViewDepth - uNearFar.x) / max(0.0001, uNearFar.y - uNearFar.x),
          0.0,
          1.0
        );
        float backDepth = readBackDepth(screenUv);
        float measuredThickness = max(0.0, (backDepth - frontDepth) * (uNearFar.y - uNearFar.x));
        float hasMeasuredThickness = step(0.001, measuredThickness)
          * step(measuredThickness, max(0.82, fullDepth * 2.0));
        float pathLength = mix(analyticThickness, measuredThickness, hasMeasuredThickness);
        float opticalThickness = max(0.02, min(fullWidth, fullDepth));
        float pathRatio = clamp(pathLength / opticalThickness, 0.0, 1.25);

        vec3 viewNormal = normalize(vViewNormal);
        vec3 viewDirection = normalize(-vViewPosition);
        float facing = clamp(abs(dot(viewNormal, viewDirection)), 0.0, 1.0);
        float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
        float edgeRoll = smoothstep(0.64, 0.98, abs(horizontal));
        float endRoll = smoothstep(0.73, 0.98, abs(vertical));
        float interaction = smoothstep(0.1, 0.92, uActivity);
        float refractionPixels = mix(7.5, 14.5, interaction) * (0.38 + pathRatio * 0.56);
        float lensCurvePixels = longitudinal
          * (4.8 + pathRatio * 5.6)
          * (0.9 + interaction * 0.24)
          * (1.0 - endRoll * 0.32);
        vec2 bend = vec2(
          viewNormal.x * refractionPixels + lensCurvePixels + horizontal * (0.24 + pathRatio * 0.42) + uHighlightShift * (0.52 + interaction * 0.84),
          viewNormal.y * refractionPixels + vertical * (0.16 + endRoll * 0.42)
        ) * pixel;

        vec2 refractedUv = clamp(screenUv + bend, vec2(0.002), vec2(0.998));
        float dispersion = mix(1.008, 1.038, interaction);
        vec3 redSample = texture2D(uSceneColor, clamp(screenUv + bend * dispersion, vec2(0.002), vec2(0.998))).rgb;
        vec3 greenSample = texture2D(uSceneColor, refractedUv).rgb;
        vec3 blueSample = texture2D(uSceneColor, clamp(screenUv + bend * (2.0 - dispersion), vec2(0.002), vec2(0.998))).rgb;
        vec3 refracted = vec3(redSample.r, greenSample.g, blueSample.b);
        vec3 reverseSample = texture2D(uSceneColor, clamp(screenUv - bend * 0.62, vec2(0.002), vec2(0.998))).rgb;
        vec2 hiddenSampleUv = clamp(
          refractedUv + vec2(
            longitudinal * (0.018 + pathRatio * 0.014) + uHighlightShift * interaction * 0.004,
            vertical * 0.0025
          ),
          vec2(0.002),
          vec2(0.998)
        );
        vec3 hiddenBase = hiddenOpticsColor(screenUv);
        vec3 hiddenBent = hiddenOpticsColor(hiddenSampleUv);
        vec3 hiddenDifference = hiddenBent - hiddenBase;
        vec3 hiddenLens = abs(hiddenDifference) * 0.62
          + max(hiddenDifference, vec3(0.0)) * 0.38;
        float hiddenLensLuminance = dot(hiddenLens, vec3(0.2126, 0.7152, 0.0722));
        vec3 hiddenLensColor = mix(vec3(hiddenLensLuminance), hiddenLens, interaction * 0.42);

        vec3 worldNormal = normalize(vWorldNormal);
        vec3 localNormal = normalize(vLocalNormal);
        float flatAxis = max(abs(localNormal.x), max(abs(localNormal.y), abs(localNormal.z)));
        float roundedSurface = smoothstep(0.015, 0.23, 1.0 - flatAxis);
        float endCap = smoothstep(0.92, 0.995, abs(localNormal.y));
        float sidePlane = smoothstep(0.9, 0.995, abs(localNormal.x));
        float frontPlane = smoothstep(0.9, 0.995, abs(localNormal.z));
        float verticalFace = max(sidePlane, frontPlane) * (1.0 - endCap);
        float faceCoordinate = (
          longitudinal * sidePlane + horizontal * frontPlane
        ) / max(0.001, sidePlane + frontPlane);
        float capRim = endCap * smoothstep(0.62, 0.96, max(abs(horizontal), abs(longitudinal)));
        float polishedContour = clamp(roundedSurface + capRim * 0.38, 0.0, 1.0);
        float pearlSweep = 0.32 + 0.68 * clamp(
          exp(-pow((longitudinal + 0.74) / 0.4, 2.0)) * 0.72
          + exp(-pow((longitudinal - 0.84) / 0.3, 2.0)) * 0.24,
          0.0,
          1.0
        );
        vec3 worldViewDirection = normalize(uCameraWorld - vWorldPosition);
        vec3 incidentDirection = -worldViewDirection;
        vec3 reflectionDirection = reflect(incidentDirection, worldNormal);
        vec3 reflectionLeft = textureCube(
          uEnvironmentMap,
          normalize(reflectionDirection + vec3(-0.1, 0.025, 0.0))
        ).rgb;
        vec3 reflectionRight = textureCube(
          uEnvironmentMap,
          normalize(reflectionDirection + vec3(0.1, -0.025, 0.0))
        ).rgb;
        vec3 environmentReflection = (
          textureCube(uEnvironmentMap, reflectionDirection).rgb * 0.36
          + reflectionLeft * 0.32
          + reflectionRight * 0.32
        ) * uEnvironmentGain;
        float studioLobeLeft = exp(
          -pow((reflectionDirection.x + 0.3) / 0.46, 2.0)
          -pow((reflectionDirection.y - 0.08) / 0.72, 2.0)
        );
        float studioLobeRight = exp(
          -pow((reflectionDirection.x - 0.48) / 0.58, 2.0)
          -pow((reflectionDirection.y + 0.16) / 0.82, 2.0)
        );
        vec3 studioReflection = vec3(0.31, 0.32, 0.3)
          * (studioLobeLeft * 0.82 + studioLobeRight * 0.34)
          * uEnvironmentGain;
        environmentReflection = max(environmentReflection, studioReflection);

        vec3 absorption = vec3(0.0012, 0.0011, 0.00115);
        vec3 transmittance = exp(-absorption * pathLength * 0.2);
        vec3 sceneBase = texture2D(uSceneColor, screenUv).rgb;
        float refractionContrast = 1.9 + pathRatio * 2.1 + interaction * 0.35;
        vec3 crystal = max(sceneBase + (refracted - sceneBase) * refractionContrast, vec3(0.0));
        crystal *= transmittance;

        vec3 sceneDelta = abs(refracted - reverseSample);
        float caustic = dot(sceneDelta, vec3(0.2126, 0.7152, 0.0722));
        float opticsBase = refractiveStudioSignal(screenUv);
        float opticsBent = refractiveStudioSignal(clamp(screenUv + bend * 6.0, vec2(0.002), vec2(0.998)));
        float opticsDelta = abs(opticsBent - opticsBase);
        float internalCaustic = smoothstep(0.025, 0.28, opticsDelta)
          * (0.4 + pathRatio * 0.6)
          * (0.72 + edgeRoll * 0.28);
        float polishedEdge = polishedContour * (1.0 - endRoll * 0.22) + endRoll * 0.12;
        float centerClearWindow = 1.0 - smoothstep(0.18, 0.52, abs(horizontal));
        float reflectionMask = 0.018 + polishedContour * (0.78 + fresnel * 0.22);
        float environmentReflectionWeight = reflectionMask
          * (0.28 + interaction * (0.08 + polishedEdge * 0.08));
        environmentReflectionWeight *= 1.0 - centerClearWindow * 0.42;
        environmentReflectionWeight *= 0.55 + pearlSweep * 0.45;
        crystal += environmentReflection * environmentReflectionWeight;
        crystal += vec3(0.09, 0.104, 0.1)
          * polishedContour
          * pearlSweep
          * (0.46 + interaction * 0.06);
        float faceReflection = exp(-pow((faceCoordinate + 0.22 + uHighlightShift * 0.24) / 0.62, 2.0))
          * verticalFace;
        crystal += vec3(0.045, 0.055, 0.052)
          * faceReflection
          * (0.1 + interaction * 0.08);
        crystal += hiddenLensColor
          * (0.42 + interaction * 0.28)
          * (1.0 - endCap * 0.55);
        float liquidWindowCoordinate = faceCoordinate
          + vertical * 0.11
          + uHighlightShift * interaction * 0.18;
        float liquidWindow = exp(-pow((liquidWindowCoordinate + 0.36) / 0.42, 2.0))
          * verticalFace
          * smoothstep(0.04, 0.22, 1.0 - abs(vertical));
        float hiddenLuminance = dot(hiddenBent, vec3(0.2126, 0.7152, 0.0722));
        vec3 liquidTransmission = mix(
          vec3(hiddenLuminance),
          mix(hiddenBent, uTint * hiddenLuminance * 1.35, 0.32),
          interaction * 0.48
        );
        crystal += liquidTransmission
          * liquidWindow
          * (0.045 + pathRatio * 0.035 + interaction * 0.045);
        float flowingCoordinate = faceCoordinate
          + sin(vertical * 2.25) * 0.1
          + uHighlightShift * interaction * 0.16;
        float pearlCaustic = exp(-pow((flowingCoordinate + 0.46) / 0.3, 2.0))
          * verticalFace
          * (0.76 + (1.0 - abs(vertical)) * 0.24);
        float tealCaustic = exp(-pow((flowingCoordinate - 0.46) / 0.24, 2.0))
          * verticalFace
          * (0.7 + (1.0 - abs(vertical)) * 0.3);
        float transparentCore = exp(-pow((flowingCoordinate + 0.02) / 0.58, 2.0))
          * verticalFace
          * (0.62 + (1.0 - abs(vertical)) * 0.38);
        crystal += vec3(0.08, 0.092, 0.088)
          * pearlCaustic
          * (0.72 + pathRatio * 0.28);
        crystal += uTint
          * transparentCore
          * (0.075 + pathRatio * 0.035 + interaction * 0.055);
        crystal += uTint
          * tealCaustic
          * (0.14 + interaction * 0.1)
          * (0.68 + pathRatio * 0.32);
        crystal += sceneDelta * (0.022 + polishedContour * 0.05 + interaction * 0.045);
        float causticVisibility = internalCaustic
          * (0.06 + polishedContour * 0.42 + interaction * 0.42);
        crystal += vec3(0.075, 0.085, 0.082) * causticVisibility;
        crystal += uTint * causticVisibility * interaction * 0.026;

        float sweepCenter = clamp(0.34 + uHighlightShift * 1.25, -0.62, 0.72);
        float pointerSweep = exp(-pow((horizontal - sweepCenter) / 0.22, 2.0)) * interaction;
        vec3 shiftedReflectionDirection = normalize(reflectionDirection + vec3((0.08 + uHighlightShift * 0.12), 0.0, 0.0));
        vec3 shiftedReflection = (
          textureCube(uEnvironmentMap, normalize(shiftedReflectionDirection + vec3(-0.07, 0.02, 0.0))).rgb
          + textureCube(uEnvironmentMap, shiftedReflectionDirection).rgb
          + textureCube(uEnvironmentMap, normalize(shiftedReflectionDirection + vec3(0.07, -0.02, 0.0))).rgb
        ) * (uEnvironmentGain / 3.0);
        crystal += shiftedReflection * pointerSweep * 0.055;
        crystal += uTint * pointerSweep * interaction * (0.055 + caustic * 0.065);
        crystal = mix(sceneBase, crystal, clamp(uStageDim, 0.0, 1.0));
        crystal = min(crystal, vec3(2.0));

        gl_FragColor = vec4(crystal, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    toneMapped: false
  }) as CrystalMaterial;
  return material;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
    maybeMesh.geometry?.dispose();
    const material = maybeMesh.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
}

function disposeMaterial(material: THREE.Material) {
  const materialWithMap = material as THREE.Material & { map?: THREE.Texture | null };
  materialWithMap.map?.dispose();
  material.dispose();
}

function colorForKind(kind: string) {
  void kind;
  return "#70a99b";
}

function compactSubtitle(card: ShowcaseCard) {
  const source = card.subtitle || card.status || card.route?.context_type || "本地活动";
  return source.length > 38 ? `${source.slice(0, 38)}...` : source;
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "本地活动";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function waveFalloff(distance: number) {
  if (distance >= WAVE_WEIGHTS.length - 1) return 0;
  const lowerIndex = Math.floor(Math.max(0, distance));
  const upperIndex = Math.min(WAVE_WEIGHTS.length - 1, lowerIndex + 1);
  const fraction = smoothstep(0, 1, distance - lowerIndex);
  return THREE.MathUtils.lerp(WAVE_WEIGHTS[lowerIndex], WAVE_WEIGHTS[upperIndex], fraction);
}

function dampTowards(current: number, target: number, settleTime: number, delta: number) {
  const lambda = 4.2 / Math.max(0.04, settleTime);
  return THREE.MathUtils.damp(current, target, lambda, delta);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function smootherstep(value: number) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * normalized * (normalized * (normalized * 6 - 15) + 10);
}
