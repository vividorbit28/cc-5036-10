import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { DatasetIndices, GroupId, SpaceObject } from "../data/dataset";

export const HIGHLIGHT_COLOR = "#ffffff";
export const OCCLUDER_COLOR = "#fda4af";

const PICK_RADIUS_PX = 11;
const OCCLUSION_RADIUS_PX = 12;
const MAX_ORBIT_STEP_DEG = 8;
const MAX_PAN_DISTANCE = 3.2;
const CAMERA_DURATION_MS = 620;

export type CameraStrategy = "fixed" | "pan" | "orbit";

export interface ProjectionEntry {
  id: string;
  name: string;
  x: number;
  y: number;
  depth: number;
  onScreen: boolean;
  hidden: boolean;
  group: SpaceObject["group"];
}

export interface OverlapEntry {
  id: string;
  name: string;
  depth: number;
  relation: "nearer" | "farther" | "self";
  hidden: boolean;
}

export interface ScreenInfo {
  projected: ProjectionEntry | null;
  overlapStack: OverlapEntry[];
  occluders: OverlapEntry[];
  occludedBy: number;
  visible: boolean;
  hidden: boolean;
}

export interface CameraStatus {
  strategy: CameraStrategy;
  moving: boolean;
  note: string;
}

export interface SceneCallbacks {
  onSelect(id: string): void;
  onStatus(status: CameraStatus): void;
  onViewChanged(): void;
}

export interface SceneOptions {
  reducedMotion: boolean;
  data: DatasetIndices;
}

interface PointVisual {
  object: SpaceObject;
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
}

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.92)");
  gradient.addColorStop(0.42, "rgba(255,255,255,0.26)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeHiddenOutlineTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.strokeStyle = "#e2e8f0";
  context.lineWidth = 5;
  context.setLineDash([13, 9]);
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class SpaceScene {
  private readonly data: DatasetIndices;
  private readonly groupColors: Record<GroupId, THREE.Color>;
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: SceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly pointVisuals = new Map<string, PointVisual>();
  private readonly glowTexture: THREE.Texture;
  private readonly focusRing: HTMLDivElement;
  private readonly occluderRing: HTMLDivElement;
  private readonly focusCallout: HTMLElement;
  private readonly hiddenOutline: THREE.Sprite;
  private readonly cameraStatusEl: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion: boolean;
  private readonly initialCamera: THREE.Vector3;
  private readonly initialTarget: THREE.Vector3;
  private readonly projectionScratch = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();

  private hiddenIds = new Set<string>();
  private focusId: string | null = null;
  private cameraStrategy: CameraStrategy = "fixed";
  private animation: {
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    startedAt: number;
    duration: number;
    strategy: CameraStrategy;
    note: string;
  } | null = null;
  private frameHandle = 0;
  private disposed = false;
  private lastStatusKey = "";
  private readonly highlightedIds = new Set<string>();

  constructor(container: HTMLElement, callbacks: SceneCallbacks, options: SceneOptions) {
    this.data = options.data;
    this.groupColors = Object.fromEntries(
      (Object.keys(this.data.groups) as GroupId[]).map((key) => [
        key,
        new THREE.Color(this.data.groups[key].color),
      ]),
    ) as Record<GroupId, THREE.Color>;
    this.canvas = container.querySelector<HTMLCanvasElement>("#scene-canvas")!;
    this.callbacks = callbacks;
    this.reducedMotion = options.reducedMotion;
    this.focusRing = document.querySelector<HTMLDivElement>("#focus-ring")!;
    this.occluderRing = document.querySelector<HTMLDivElement>("#occluder-ring")!;
    this.focusCallout = document.querySelector<HTMLElement>("#focus-callout")!;
    this.cameraStatusEl = document.querySelector<HTMLElement>("#camera-status")!;

    this.initialCamera = new THREE.Vector3(...this.data.camera.position);
    this.initialTarget = new THREE.Vector3(...this.data.camera.target);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(this.data.camera.fov, 1, 0.1, 400);
    this.camera.position.copy(this.initialCamera);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(this.initialTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.7;
    this.controls.panSpeed = 0.5;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 90;
    this.controls.addEventListener("start", () => this.cancelAnimation());
    this.controls.addEventListener("end", () => this.notifyViewChanged());
    this.controls.update();

    this.scene.background = null;
    this.glowTexture = makeGlowTexture();
    this.addEnvironment();
    this.buildObjects();
    this.buildTrajectories();
    this.hiddenOutline = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeHiddenOutlineTexture(),
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0.92,
      }),
    );
    this.hiddenOutline.scale.setScalar(1.5);
    this.hiddenOutline.renderOrder = 15;
    this.hiddenOutline.visible = false;
    this.scene.add(this.hiddenOutline);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("click", this.handleClick);

    this.animate();
    this.publishStatus("已就绪", true);
    for (const object of this.data.objects) {
      if (object.initiallyHidden) {
        this.hiddenIds.add(object.id);
        this.applyVisibility(object.id);
      }
    }
  }

  private addEnvironment(): void {
    this.scene.add(new THREE.AmbientLight(0xdce8ff, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(6, 9, 12);
    const rim = new THREE.DirectionalLight(0x7387ff, 1.4);
    rim.position.set(-9, -4, -8);
    this.scene.add(key, rim);

    const grid = new THREE.GridHelper(44, 22, 0x2b4463, 0x152238);
    grid.position.y = -5.4;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.5;
      material.depthWrite = false;
    }
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(2.6);
    const axesMaterials = Array.isArray(axes.material) ? axes.material : [axes.material];
    for (const material of axesMaterials) {
      material.transparent = true;
      material.opacity = 0.55;
      material.depthWrite = false;
    }
    axes.position.set(-8.6, -5.3, 7.4);
    this.scene.add(axes);

    const starCount = 320;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const radius = 46 + (i % 7) * 9;
      const phi = Math.acos(1 - 2 * (((i * 37) % 101) / 101));
      const theta = i * 2.399963;
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi) * 0.72;
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.scene.add(
      new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
          color: 0x93b5dd,
          size: 1.7,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      ),
    );
  }

  private buildObjects(): void {
    for (const object of this.data.objects) {
      const baseColor = this.groupColors[object.group] ?? this.groupColors.echo;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 20, 16),
        new THREE.MeshStandardMaterial({
          color: baseColor.clone(),
          emissive: baseColor.clone().multiplyScalar(0.42),
          roughness: 0.38,
          metalness: 0.08,
        }),
      );
      mesh.position.set(...object.position);
      mesh.userData.objectId = object.id;

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: baseColor.clone(),
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.position.copy(mesh.position);
      glow.scale.setScalar(1.05);
      glow.userData.objectId = object.id;

      this.scene.add(mesh, glow);
      this.pointVisuals.set(object.id, { object, mesh, glow });
    }
  }

  private buildTrajectories(): void {
    for (const trajectory of this.data.trajectories) {
      const geometry = new LineGeometry();
      const points = trajectory.closed
        ? [...trajectory.points, trajectory.points[0]]
        : [...trajectory.points];
      geometry.setPositions(points.flatMap((point) => [...point]));

      const material = new LineMaterial({
        color: new THREE.Color(this.data.groups[trajectory.group].color).multiplyScalar(0.78),
        linewidth: trajectory.dashed ? 1.15 : 1.8,
        transparent: true,
        opacity: trajectory.dashed ? 0.56 : 0.74,
        dashed: trajectory.dashed,
        dashSize: 0.34,
        gapSize: 0.22,
        depthWrite: false,
      });
      material.resolution.set(1, 1);

      const line = new Line2(geometry, material);
      line.computeLineDistances();
      line.userData.trajectoryId = trajectory.id;
      this.scene.add(line);
    }
  }

  private resize(): void {
    // Use the canvas box, not the container border box: sizing from the
    // container would stretch the backing store by the border width and shift
    // drawn points away from their projected CSS coordinates.
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.scene.traverse((node) => {
      if (node instanceof Line2) {
        (node.material as LineMaterial).resolution.copy(drawing);
      }
    });
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.animate);
    if (this.animation) {
      this.stepCameraAnimation();
    } else {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
    this.projectFocusFrame();
  };

  private stepCameraAnimation(): void {
    if (!this.animation) return;
    const { fromPos, fromTarget, toPos, toTarget, startedAt, duration, note } = this.animation;
    const raw = Math.min(1, (performance.now() - startedAt) / duration);
    const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    this.camera.position.lerpVectors(fromPos, toPos, eased);
    this.controls.target.lerpVectors(fromTarget, toTarget, eased);
    this.camera.lookAt(this.controls.target);
    if (raw >= 1) {
      this.animation = null;
      this.controls.enabled = true;
      this.publishStatus(note, true);
      this.callbacks.onViewChanged();
    }
  }

  private cancelAnimation(): void {
    if (!this.animation) return;
    this.animation = null;
    this.controls.enabled = true;
    this.publishStatus("相机移动被手动操作中断", true);
  }

  private onViewChangedTimer = 0;

  /**
   * Wheel and drag changes alter overlap relationships, so list badges and the
   * inspector refresh once the interaction settles rather than every frame.
   */
  private notifyViewChanged(): void {
    window.clearTimeout(this.onViewChangedTimer);
    this.onViewChangedTimer = window.setTimeout(() => {
      this.refreshOccluderStyles();
      this.callbacks.onViewChanged();
    }, 120);
  }

  private publishStatus(note: string, force = false): void {
    const key = `${this.cameraStrategy}|${note}|${Boolean(this.animation)}`;
    if (!force && key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    this.cameraStatusEl.textContent = `相机 · ${this.strategyLabel()} · ${note}`;    this.callbacks.onStatus({
      strategy: this.cameraStrategy,
      moving: Boolean(this.animation),
      note,
    });
  }

  private strategyLabel(): string {
    if (this.cameraStrategy === "fixed") return "保持视角";
    if (this.cameraStrategy === "pan") return "轻柔平移";
    return "限幅环绕";
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const hit = this.pickAt(event.clientX, event.clientY, PICK_RADIUS_PX);
    this.canvas.classList.toggle("is-over-object", Boolean(hit));
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
  };

  private handlePointerLeave = (): void => {
    this.canvas.classList.remove("is-over-object");
  };

  private pointerDownAt: { x: number; y: number } | null = null;

  private handleClick = (event: MouseEvent): void => {
    if (this.pointerDownAt) {
      const moved = Math.hypot(event.clientX - this.pointerDownAt.x, event.clientY - this.pointerDownAt.y);
      this.pointerDownAt = null;
      if (moved > 5) return;
    }
    const hit = this.pickAt(event.clientX, event.clientY, PICK_RADIUS_PX);
    if (hit) {
      this.callbacks.onSelect(hit.id);
    }
  };

  /**
   * Projects every object into CSS pixels. Picking and keyboard geometry both
   * branch from this single projection, so a point's drawn position, its hit
   * target and its focus ring cannot drift apart.
   */
  projectionEntries(): ProjectionEntry[] {
    this.camera.updateMatrixWorld();
    const rect = this.canvas.getBoundingClientRect();
    const cameraPos = this.camera.position;
    this.camera.getWorldDirection(this.cameraDirection);
    const entries: ProjectionEntry[] = [];
    for (const object of this.data.objects) {
      const world = new THREE.Vector3(...object.position);
      const toPoint = world.clone().sub(cameraPos);
      const inFront = this.cameraDirection.dot(toPoint) > 0;
      this.projectionScratch.copy(world).project(this.camera);
      const x = ((this.projectionScratch.x + 1) / 2) * rect.width;
      const y = ((1 - this.projectionScratch.y) / 2) * rect.height;
      entries.push({
        id: object.id,
        name: object.name,
        x,
        y,
        depth: cameraPos.distanceTo(world),
        onScreen:
          inFront &&
          Math.abs(this.projectionScratch.x) <= 1 &&
          Math.abs(this.projectionScratch.y) <= 1,
        hidden: this.hiddenIds.has(object.id),
        group: object.group,
      });
    }
    return entries;
  }

  private stackAt(
    entries: ProjectionEntry[],
    screenX: number,
    screenY: number,
    radius: number,
    includeHidden: boolean,
  ): ProjectionEntry[] {
    return entries
      .filter(
        (entry) =>
          (!entry.hidden || includeHidden) &&
          entry.onScreen &&
          Math.hypot(entry.x - screenX, entry.y - screenY) <= radius,
      )
      .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  }

  /** Nearest pickable object within the radius; hidden points never intercept. */
  pickAt(clientX: number, clientY: number, radius = PICK_RADIUS_PX): ProjectionEntry | null {
    const rect = this.canvas.getBoundingClientRect();
    const entries = this.projectionEntries();
    const stack = this.stackAt(
      entries,
      clientX - rect.left,
      clientY - rect.top,
      radius,
      false,
    );
    return stack[0] ?? null;
  }

  /** All visible points at a screen coordinate, nearest first. Used by the overlap browser. */
  pickStackAt(clientX: number, clientY: number, radius = OCCLUSION_RADIUS_PX): ProjectionEntry[] {
    const rect = this.canvas.getBoundingClientRect();
    return this.stackAt(
      this.projectionEntries(),
      clientX - rect.left,
      clientY - rect.top,
      radius,
      false,
    );
  }

  screenInfoFor(id: string): ScreenInfo {
    const entries = this.projectionEntries();
    const self = entries.find((entry) => entry.id === id);
    if (!self) {
      return {
        projected: null,
        overlapStack: [],
        occluders: [],
        occludedBy: 0,
        visible: false,
        hidden: true,
      };
    }
    const hidden = this.hiddenIds.has(id);
    const target = this.pointVisuals.get(id)?.object;
    const stack = hidden
      ? []
      : this.stackAt(entries, self.x, self.y, OCCLUSION_RADIUS_PX, false);
    const overlapStack: OverlapEntry[] = stack.map((entry) => ({
      id: entry.id,
      name: entry.name,
      depth: entry.depth,
      relation:
        entry.id === id
          ? "self"
          : entry.depth < self.depth - 1e-4
            ? "nearer"
            : "farther",
      hidden: false,
    }));
    const occluders = overlapStack.filter((entry) => entry.relation === "nearer");
    void target;
    return {
      projected: self,
      overlapStack,
      occluders,
      occludedBy: occluders.length,
      visible: !hidden,
      hidden,
    };
  }

  private projectFocusFrame(): void {
    if (!this.focusId) {
      this.hideFocusChrome();
      return;
    }
    const visual = this.pointVisuals.get(this.focusId);
    if (!visual) {
      this.hideFocusChrome();
      return;
    }
    const info = this.screenInfoFor(this.focusId);
    const projected = info.projected;
    if (!projected || !projected.onScreen) {
      this.hideFocusChrome();
      return;
    }
    const occluded = !info.hidden && info.occludedBy > 0;
    const x = projected.x;
    const y = projected.y;
    this.updateHiddenOutline(info.hidden && projected.onScreen);
    this.focusRing.hidden = false;
    this.occluderRing.hidden = !occluded;
    this.focusRing.style.left = `${x}px`;
    this.focusRing.style.top = `${y}px`;
    this.occluderRing.style.left = `${x}px`;
    this.occluderRing.style.top = `${y}px`;
    this.focusRing.classList.toggle("is-hidden", info.hidden);
    this.focusRing.classList.toggle("is-occluded", occluded);
    this.focusRing.dataset.focusId = this.focusId;
    this.focusRing.dataset.screenX = x.toFixed(2);
    this.focusRing.dataset.screenY = y.toFixed(2);
    this.focusCallout.hidden = false;
    const rect = this.canvas.getBoundingClientRect();
    const calloutHalf = 76;
    const clampedX = THREE.MathUtils.clamp(x, calloutHalf, Math.max(calloutHalf, rect.width - calloutHalf));
    this.focusCallout.style.left = `${clampedX}px`;
    this.focusCallout.style.top = `${y}px`;
    this.focusCallout.classList.toggle("below", y < 96);
    this.focusCallout.classList.toggle("is-hidden", info.hidden);
    this.focusCallout.classList.toggle("is-occluded", occluded);
    const nameEl = this.focusCallout.querySelector<HTMLElement>(".callout-name");
    const metaEl = this.focusCallout.querySelector<HTMLElement>(".callout-meta");
    const object = visual.object;
    const status = info.hidden
      ? "已隐藏 · 轮廓定位"
      : occluded
        ? `被 ${info.occludedBy} 个更近对象遮挡`
        : "可见 · 无遮挡";
    if (nameEl) nameEl.textContent = object.name;
    if (metaEl) {
      metaEl.textContent = `${this.data.groups[object.group].label} · d=${projected.depth.toFixed(1)} su · ${status}`;
    }
    this.focusCallout.dataset.focusId = this.focusId;
  }

  private updateHiddenOutline(show: boolean): void {
    this.hiddenOutline.visible = show;
    if (!show || !this.focusId) return;
    const object = this.pointVisuals.get(this.focusId)?.object;
    if (!object) return;
    this.hiddenOutline.position.set(...object.position);
  }

  private hideFocusChrome(): void {
    this.focusRing.hidden = true;
    this.occluderRing.hidden = true;
    this.focusCallout.hidden = true;
    this.hiddenOutline.visible = false;
    delete this.focusRing.dataset.focusId;
    delete this.focusCallout.dataset.focusId;
  }

  setFocus(id: string | null): void {
    this.focusId = id && this.pointVisuals.has(id) ? id : null;
    this.refreshFocusStyles();
    this.refreshOccluderStyles();
    if (!this.focusId) {
      this.hideFocusChrome();
    }
  }

  /** Recompute which visible points sit in front of the focus and tint them. */
  private refreshOccluderStyles(): void {
    for (const visual of this.pointVisuals.values()) {
      const material = visual.mesh.material as THREE.MeshStandardMaterial;
      const glowMaterial = visual.glow.material as THREE.SpriteMaterial;
      if (visual.object.id === this.focusId) continue;
      const base = this.groupColors[visual.object.group] ?? this.groupColors.echo;
      material.color.copy(base);
      material.emissive.copy(base).multiplyScalar(0.42);
      glowMaterial.color.copy(base);
      glowMaterial.opacity = 0.5;
      visual.glow.scale.setScalar(1.05);
      visual.mesh.scale.setScalar(1);
    }
    if (!this.focusId) return;
    const info = this.screenInfoFor(this.focusId);
    if (info.hidden) return;
    for (const entry of info.occluders) {
      const visual = this.pointVisuals.get(entry.id);
      if (!visual) continue;
      const material = visual.mesh.material as THREE.MeshStandardMaterial;
      const glowMaterial = visual.glow.material as THREE.SpriteMaterial;
      material.emissive.copy(new THREE.Color(OCCLUDER_COLOR)).multiplyScalar(0.4);
      glowMaterial.opacity = 0.68;
    }
  }

  getFocusId(): string | null {
    return this.focusId;
  }

  /** Ids whose meshes are currently drawn in focus styling, for verification. */
  highlightedObjectIds(): string[] {
    return [...this.highlightedIds];
  }

  isVisible(id: string): boolean {
    return this.pointVisuals.has(id) && !this.hiddenIds.has(id);
  }

  private refreshFocusStyles(): void {
    this.highlightedIds.clear();
    for (const [id, visual] of this.pointVisuals) {
      const material = visual.mesh.material as THREE.MeshStandardMaterial;
      const glowMaterial = visual.glow.material as THREE.SpriteMaterial;
      const base = this.groupColors[visual.object.group] ?? this.groupColors.echo;
      const isFocus = id === this.focusId;
      if (isFocus) {
        this.highlightedIds.add(id);
        material.color.copy(base).lerp(new THREE.Color(HIGHLIGHT_COLOR), 0.92);
        material.emissive.copy(new THREE.Color(HIGHLIGHT_COLOR)).multiplyScalar(0.58);
        glowMaterial.color.copy(new THREE.Color(HIGHLIGHT_COLOR));
        glowMaterial.opacity = 0.95;
        visual.glow.scale.setScalar(1.9);
        visual.mesh.scale.setScalar(1.55);
      } else {
        material.color.copy(base);
        material.emissive.copy(base).multiplyScalar(0.42);
        glowMaterial.color.copy(base);
        glowMaterial.opacity = 0.5;
        visual.glow.scale.setScalar(1.05);
        visual.mesh.scale.setScalar(1);
      }
    }
  }

  setHidden(id: string, hidden: boolean): void {
    if (!this.pointVisuals.has(id)) return;
    if (hidden) {
      this.hiddenIds.add(id);
    } else {
      this.hiddenIds.delete(id);
    }
    this.applyVisibility(id);
  }

  private applyVisibility(id: string): void {
    const visual = this.pointVisuals.get(id);
    if (!visual) return;
    const hidden = this.hiddenIds.has(id);
    visual.mesh.visible = !hidden;
    visual.glow.visible = !hidden;
  }

  isHidden(id: string): boolean {
    return this.hiddenIds.has(id);
  }

  hiddenCount(): number {
    return this.hiddenIds.size;
  }

  setCameraStrategy(strategy: CameraStrategy): void {
    this.cameraStrategy = strategy;
    this.publishStatus("策略已切换", true);
  }

  getCameraStrategy(): CameraStrategy {
    return this.cameraStrategy;
  }

  getCameraPosition(): [number, number, number] {
    return [this.camera.position.x, this.camera.position.y, this.camera.position.z];
  }

  getCameraTarget(): [number, number, number] {
    return [this.controls.target.x, this.controls.target.y, this.controls.target.z];
  }

  isCameraAnimating(): boolean {
    return Boolean(this.animation);
  }

  /**
   * Bounded reframing. pan translates without changing view orientation; orbit
   * rotates the view direction by at most MAX_ORBIT_STEP_DEG per invocation;
   * fixed does nothing. Every strategy is eased, never a single-frame jump.
   */
  focusCamera(id: string): boolean {
    const object = this.pointVisuals.get(id)?.object;
    if (!object) return false;
    const strategy = this.cameraStrategy;
    if (strategy === "fixed") {
      this.publishStatus("保持视角 · 未移动相机", true);
      return false;
    }

    this.animation = null;
    this.controls.enabled = false;
    const target = new THREE.Vector3(...object.position);
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    let toTarget: THREE.Vector3;
    let toPos: THREE.Vector3;

    if (strategy === "pan") {
      const offset = fromPos.clone().sub(fromTarget);
      const shift = target.clone().sub(fromTarget);
      // Cap translation so a distant point cannot fling the whole scene away.
      if (shift.length() > MAX_PAN_DISTANCE) {
        shift.setLength(MAX_PAN_DISTANCE);
      }
      toTarget = fromTarget.clone().add(shift);
      toPos = toTarget.clone().add(offset);
    } else {
      const offset = fromPos.clone().sub(fromTarget);
      const distance = THREE.MathUtils.clamp(offset.length(), 5.5, 34);
      const currentDir = offset.clone().normalize();
      const desiredDir = target.clone().sub(fromTarget);
      if (desiredDir.lengthSq() < 1e-6) {
        desiredDir.set(0, 0.25, 1);
      }
      desiredDir.normalize();
      const angle = currentDir.angleTo(desiredDir);
      const maxAngle = THREE.MathUtils.degToRad(MAX_ORBIT_STEP_DEG);
      const applied = Math.min(angle, maxAngle);
      let newDir: THREE.Vector3;
      const axis = new THREE.Vector3().crossVectors(currentDir, desiredDir);
      if (axis.lengthSq() < 1e-8) {
        newDir = currentDir.clone();
      } else {
        newDir = currentDir.clone().applyAxisAngle(axis.normalize(), applied);
      }
      toTarget = fromTarget.clone().lerp(target, 0.4);
      const targetShift = toTarget.clone().sub(fromTarget);
      if (targetShift.length() > MAX_PAN_DISTANCE) {
        toTarget = fromTarget.clone().add(targetShift.setLength(MAX_PAN_DISTANCE));
      }
      toPos = toTarget.clone().addScaledVector(newDir, distance);
    }

    const duration = this.reducedMotion ? 0 : CAMERA_DURATION_MS;
    const note = strategy === "pan" ? "轻柔平移完成" : "限幅环绕完成";
    if (duration === 0) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      this.camera.lookAt(toTarget);
      this.controls.enabled = true;
      this.controls.update();
      this.publishStatus(note, true);
      this.callbacks.onViewChanged();
      return true;
    }
    this.animation = {
      fromPos,
      fromTarget,
      toPos,
      toTarget,
      startedAt: performance.now(),
      duration,
      strategy,
      note,
    };
    this.publishStatus(strategy === "pan" ? "轻柔平移中" : "限幅环绕中", true);
    return true;
  }

  resetCamera(): void {
    this.animation = null;
    if (this.reducedMotion) {
      this.camera.position.copy(this.initialCamera);
      this.controls.target.copy(this.initialTarget);
      this.camera.lookAt(this.initialTarget);
      this.controls.enabled = true;
      this.controls.update();
      this.publishStatus("视角已重置", true);
      this.callbacks.onViewChanged();
      return;
    }
    this.controls.enabled = false;
    this.animation = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: this.initialCamera.clone(),
      toTarget: this.initialTarget.clone(),
      startedAt: performance.now(),
      duration: 680,
      strategy: this.cameraStrategy,
      note: "视角已重置",
    };
    this.publishStatus("视角重置中", true);
  }

  focusScreenPosition(): { x: number; y: number; depth: number } | null {
    if (!this.focusId) return null;
    const info = this.screenInfoFor(this.focusId);
    if (!info.projected) return null;
    return { x: info.projected.x, y: info.projected.y, depth: info.projected.depth };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("click", this.handleClick);
    this.controls.dispose();
    this.renderer.dispose();
    this.glowTexture.dispose();
  }
}
