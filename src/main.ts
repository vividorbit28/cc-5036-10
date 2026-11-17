import "./style.css";
import type { DatasetIndices, SpaceObject } from "./data/dataset";
import { distanceFromOrigin } from "./data/dataset";
import type { GroupId } from "./data/dataset-source";
import type { KeyboardConfig, NavDirection } from "./data/keyboardConfig";
import {
  loadResources,
  loadUiFonts,
  type ResourceStatus,
} from "./data/resources";
import {
  SpaceScene,
  type CameraStrategy,
  type ProjectionEntry,
  type SceneCallbacks,
} from "./scene/SpaceScene";
import {
  jumpList,
  navigateList,
  navigateSpatial,
  type NavMode,
} from "./scene/navigation";

type SortMode = "scene" | "name" | "distance" | "group";

interface AppState {
  focusId: string | null;
  sortMode: SortMode;
  reversed: boolean;
  navMode: NavMode;
  includeHidden: boolean;
  cameraStrategy: CameraStrategy;
}

interface AppContext {
  data: DatasetIndices;
  keyboard: KeyboardConfig;
}

const el = {
  viewport: document.querySelector<HTMLElement>("#viewport")!,
  objectList: document.querySelector<HTMLUListElement>("#object-list")!,
  sortMode: document.querySelector<HTMLSelectElement>("#sort-mode")!,
  navMode: document.querySelector<HTMLSelectElement>("#nav-mode")!,
  reverseButton: document.querySelector<HTMLButtonElement>("#btn-reverse-sort")!,
  cameraStrategy: document.querySelector<HTMLSelectElement>("#camera-strategy")!,
  includeHidden: document.querySelector<HTMLInputElement>("#include-hidden")!,
  resetButton: document.querySelector<HTMLButtonElement>("#btn-reset")!,
  datasetCount: document.querySelector<HTMLElement>("#dataset-count")!,
  visibleCount: document.querySelector<HTMLElement>("#visible-count")!,
  datasetDisclaimer: document.querySelector<HTMLElement>("#dataset-disclaimer")!,
  liveRegion: document.querySelector<HTMLElement>("#live-region")!,
  copyFeedback: document.querySelector<HTMLElement>("#copy-feedback")!,
  inspectorStatus: document.querySelector<HTMLElement>("#inspector-status")!,
  inspectorEmpty: document.querySelector<HTMLElement>("#inspector-empty")!,
  inspectorContent: document.querySelector<HTMLElement>("#inspector-content")!,
  detailName: document.querySelector<HTMLElement>("#detail-name")!,
  detailSentence: document.querySelector<HTMLElement>("#detail-sentence")!,
  detailId: document.querySelector<HTMLElement>("#detail-id")!,
  detailGroup: document.querySelector<HTMLElement>("#detail-group")!,
  detailTrajectory: document.querySelector<HTMLElement>("#detail-trajectory")!,
  detailCoords: document.querySelector<HTMLElement>("#detail-coords")!,
  detailDistance: document.querySelector<HTMLElement>("#detail-distance")!,
  detailSpectral: document.querySelector<HTMLElement>("#detail-spectral")!,
  detailTemp: document.querySelector<HTMLElement>("#detail-temp")!,
  detailLuminosity: document.querySelector<HTMLElement>("#detail-luminosity")!,
  detailVisibility: document.querySelector<HTMLElement>("#detail-visibility")!,
  detailTags: document.querySelector<HTMLUListElement>("#detail-tags")!,
  detailNote: document.querySelector<HTMLElement>("#detail-note")!,
  locateButton: document.querySelector<HTMLButtonElement>("#btn-locate")!,
  toggleHiddenButton: document.querySelector<HTMLButtonElement>("#btn-toggle-hidden")!,
  copyButton: document.querySelector<HTMLButtonElement>("#btn-copy")!,
  overlapSection: document.querySelector<HTMLElement>("#occlusion-section")!,
  overlapSummary: document.querySelector<HTMLElement>("#overlap-summary")!,
  overlapList: document.querySelector<HTMLUListElement>("#overlap-list")!,
  legendList: document.querySelector<HTMLUListElement>("#legend-list")!,
  listRule: document.querySelector<HTMLElement>("#list-rule")!,
  cameraStatus: document.querySelector<HTMLElement>("#camera-status")!,
  bootOverlay: document.querySelector<HTMLElement>("#boot-overlay")!,
  bootTitle: document.querySelector<HTMLElement>("#boot-title")!,
  bootMessage: document.querySelector<HTMLElement>("#boot-message")!,
  bootResourceList: document.querySelector<HTMLUListElement>("#boot-resource-list")!,
  fatalError: document.querySelector<HTMLElement>("#fatal-error")!,
  fatalErrorMessage: document.querySelector<HTMLElement>("#fatal-error-message")!,
  resourceStatusList: document.querySelector<HTMLUListElement>("#resource-status-list")!,
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state: AppState = {
  focusId: null,
  sortMode: "scene",
  reversed: false,
  navMode: "list",
  includeHidden: false,
  cameraStrategy: "fixed",
};

let ctx: AppContext | null = null;
let scene: SpaceScene | null = null;

const callbacks: SceneCallbacks = {
  onSelect: (id) => selectObject(id || null, "picker"),
  onStatus: () => updateCameraStatus(),
  onViewChanged: () => {
    renderList();
    renderInspector();
  },
};

function requireContext(): AppContext {
  if (!ctx) throw new Error("资源尚未加载完成，查看器未就绪。");
  return ctx;
}

function renderBootRow(status: ResourceStatus): void {
  let row = el.bootResourceList.querySelector<HTMLElement>(`[data-resource="${status.key}"]`);
  if (!row) {
    row = document.createElement("li");
    row.dataset.resource = status.key;
    el.bootResourceList.append(row);
  }
  const label = document.createElement("span");
  label.className = "boot-resource-label";
  label.textContent = status.label;
  const stateBadge = document.createElement("span");
  stateBadge.className = `resource-badge resource-badge-${status.state}`;
  stateBadge.textContent =
    status.state === "loading" ? "加载中" : status.state === "ready" ? "就绪" : "异常";
  row.replaceChildren(label, stateBadge);
}

function renderResourcePanel(statuses: ResourceStatus[]): void {
  el.resourceStatusList.replaceChildren();
  for (const status of statuses) {
    const item = document.createElement("li");
    item.dataset.resource = status.key;
    item.dataset.state = status.state;
    item.dataset.testid = `resource-status-${status.key}`;
    const label = document.createElement("span");
    label.className = "resource-label";
    label.textContent = status.label;
    const badge = document.createElement("span");
    badge.className = `resource-badge resource-badge-${status.state}`;
    badge.textContent =
      status.state === "loading" ? "加载中" : status.state === "ready" ? "就绪" : "异常";
    const detail = document.createElement("p");
    detail.className = "resource-detail";
    detail.textContent = status.detail;
    item.append(label, badge, detail);
    el.resourceStatusList.append(item);
  }
}

function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  el.bootTitle.textContent = "资源加载失败";
  el.bootMessage.textContent = "查看器已停止引导，未使用任何内置默认值替代缺失资源。";
  el.fatalErrorMessage.textContent = message;
  el.fatalError.hidden = false;
  el.liveRegion.textContent = `查看器无法启动：${message}`;
  const failedStatus: ResourceStatus = {
    key: "fatal",
    label: "必需资源",
    state: "error",
    detail: message,
  };
  renderBootRow(failedStatus);
}

function formatNumber(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function formatCoords(object: SpaceObject): string {
  return object.position.map((value) => formatNumber(value, 2)).join(", ");
}

function sortObjects(mode: SortMode): SpaceObject[] {
  const { data } = requireContext();
  const copy = [...data.objects];
  if (mode === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN") || a.id.localeCompare(b.id));
  } else if (mode === "distance") {
    copy.sort((a, b) => distanceFromOrigin(a) - distanceFromOrigin(b) || a.id.localeCompare(b.id));
  } else if (mode === "group") {
    const order = Object.keys(data.groups) as GroupId[];
    copy.sort(
      (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.id.localeCompare(b.id),
    );
  }
  // Until the list is reversed this preserves the scene declaration order.
  if (state.reversed) copy.reverse();
  return copy;
}

function currentOrderedObjects(): SpaceObject[] {
  return sortObjects(state.sortMode);
}

function projectionMap(): Map<string, ProjectionEntry> {
  const map = new Map<string, ProjectionEntry>();
  if (!scene) return map;
  for (const entry of scene.projectionEntries()) {
    map.set(entry.id, entry);
  }
  return map;
}

function orderedIds(): string[] {
  return currentOrderedObjects().map((object) => object.id);
}

function announce(message: string): void {
  el.liveRegion.textContent = "";
  // Re-assigning in a later task keeps assistive tech from coalescing updates.
  window.setTimeout(() => {
    el.liveRegion.textContent = message;
  }, 20);
}

function updateCameraStatus(): void {
  if (!scene) return;
  const strategy = scene.getCameraStrategy();
  const label =
    strategy === "fixed" ? "保持视角" : strategy === "pan" ? "轻柔平移" : "限幅环绕";
  el.cameraStatus.dataset.strategy = strategy;
  el.cameraStatus.dataset.moving = String(scene.isCameraAnimating());
  el.cameraStatus.title = `当前相机策略：${label}`;
}

function describeObject(
  object: SpaceObject,
  info: ReturnType<SpaceScene["screenInfoFor"]> | null,
): string {
  const { data } = requireContext();
  const group = data.groups[object.group];
  const trajectory = object.trajectoryId ? data.trajectoryById.get(object.trajectoryId) : null;
  const parts = [
    `${object.name}（稳定 ID ${object.id}）属于${group.label}。`,
    `合成坐标 ${formatCoords(object)} 合成单位，距原点 ${formatNumber(distanceFromOrigin(object))} 合成单位。`,
    trajectory ? `位于轨迹 ${trajectory.name} 上。` : "不属于任何轨迹。",
  ];
  if (info?.hidden) {
    parts.push("此对象当前被隐藏，仅显示轮廓与坐标描述。");
  } else if (info && info.occludedBy > 0) {
    const names = info.occluders.map((entry) => entry.name).join("、");
    parts.push(`当前被 ${info.occludedBy} 个更近对象遮挡：${names}。`);
  } else if (info) {
    parts.push("当前投影位置可见，未被更近对象遮挡。");
  }
  return parts.join("");
}

function renderDatasetHeader(): void {
  const { data } = requireContext();
  el.datasetCount.textContent = `${data.objects.length} 个合成点`;
  el.datasetDisclaimer.textContent = data.meta.disclaimer;
  el.legendList.innerHTML = "";
  for (const group of Object.values(data.groups)) {
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.color = group.color;
    dot.style.background = group.color;
    const count = document.createElement("span");
    count.className = "legend-count";
    count.textContent = String(data.countByGroup[group.id] ?? 0);
    const label = document.createElement("span");
    label.textContent = group.label;
    item.append(dot, label, count);
    el.legendList.append(item);
  }
  const visible = scene ? scene.hiddenCount() : 0;
  el.visibleCount.textContent = `隐藏 ${visible} · 可见 ${data.objects.length - visible}`;
}

function renderList(): void {
  if (!ctx || !scene) return;
  const { data, keyboard } = ctx;
  const objects = currentOrderedObjects();
  const projections = projectionMap();
  const preservedScroll = el.objectList.scrollTop;
  el.objectList.innerHTML = "";
  el.objectList.setAttribute("aria-activedescendant", "");

  for (const object of objects) {
    const projection = projections.get(object.id);
    const hidden = scene?.isHidden(object.id) ?? false;
    const info = scene ? scene.screenInfoFor(object.id) : null;
    const occluded = !hidden && (info?.occludedBy ?? 0) > 0;

    const li = document.createElement("li");
    li.className = "object-item";
    li.id = `object-option-${object.id}`;
    li.dataset.objectId = object.id;
    li.dataset.testid = `object-item-${object.id}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(state.focusId === object.id));
    const hiddenNote = hidden ? "，已隐藏" : occluded ? `，被 ${info?.occludedBy} 个更近对象遮挡` : "";
    li.setAttribute(
      "aria-label",
      `${object.name}，${data.groups[object.group].label}，距原点 ${formatNumber(distanceFromOrigin(object))} 合成单位${hiddenNote}`,
    );
    if (hidden) li.classList.add("is-hidden");
    li.tabIndex = -1;

    const dot = document.createElement("span");
    dot.className = "item-dot";
    dot.style.color = data.groups[object.group].color;
    dot.style.background = data.groups[object.group].color;

    const main = document.createElement("span");
    main.className = "item-main";
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = object.name;
    const sub = document.createElement("span");
    sub.className = "item-sub";
    const depthText = projection ? `d=${formatNumber(projection.depth, 1)} su` : "屏幕外";
    sub.textContent = `${data.groups[object.group].label} · ${depthText}`;
    main.append(name, sub);

    const badges = document.createElement("span");
    badges.className = "item-badges";
    if (hidden) {
      const badge = document.createElement("span");
      badge.className = "badge badge-hidden";
      badge.textContent = "隐藏";
      badges.append(badge);
    } else if (occluded) {
      const badge = document.createElement("span");
      badge.className = "badge badge-occluded";
      badge.textContent = `遮挡 ${info?.occludedBy}`;
      badges.append(badge);
    } else if (projection && !projection.onScreen) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "屏外";
      badges.append(badge);
    }

    li.append(dot, main, badges);
    li.addEventListener("click", () => {
      selectObject(object.id, "list");
      // Keep arrow-key navigation working after a pointer selection.
      el.objectList.focus({ preventScroll: true });
    });
    el.objectList.append(li);
  }

  el.listRule.textContent =
    state.navMode === "list" ? keyboard.help.listRule : keyboard.help.spatialRule;

  if (state.focusId) {
    el.objectList.setAttribute("aria-activedescendant", `object-option-${state.focusId}`);
    scrollListItemIntoView(state.focusId);
  }
  el.objectList.scrollTop = preservedScroll;
  el.visibleCount.textContent = `隐藏 ${scene?.hiddenCount() ?? 0} · 可见 ${data.objects.length - (scene?.hiddenCount() ?? 0)}`;
}

function renderInspector(): void {
  if (!ctx || !scene) return;
  const { data } = ctx;
  const focus = state.focusId ? data.objectById.get(state.focusId) : null;
  if (!focus) {
    el.inspectorEmpty.hidden = false;
    el.inspectorContent.hidden = true;
    el.inspectorStatus.textContent = "未聚焦";
    el.inspectorStatus.dataset.focusId = "";
    return;
  }
  const info = scene.screenInfoFor(focus.id);
  const hidden = scene.isHidden(focus.id);
  const group = data.groups[focus.group];
  const trajectory = focus.trajectoryId ? data.trajectoryById.get(focus.trajectoryId) : null;

  el.inspectorEmpty.hidden = true;
  el.inspectorContent.hidden = false;
  el.inspectorStatus.textContent = hidden ? "已隐藏" : info.occludedBy > 0 ? `被遮挡 ${info.occludedBy}` : "可见";
  el.inspectorStatus.dataset.focusId = focus.id;
  el.inspectorStatus.dataset.occludedBy = String(info.occludedBy);
  el.inspectorStatus.dataset.hidden = String(hidden);

  el.detailName.textContent = focus.name;
  el.detailSentence.textContent = describeObject(focus, info);
  el.detailId.textContent = focus.id;
  el.detailGroup.textContent = `${group.label} · ${group.description}`;
  el.detailTrajectory.textContent = trajectory ? `${trajectory.name} (${trajectory.shortName})` : "无";
  el.detailCoords.textContent = formatCoords(focus);
  el.detailDistance.textContent = `${formatNumber(distanceFromOrigin(focus))} su`;
  el.detailSpectral.textContent = `${focus.spectralClass}（合成）`;
  el.detailTemp.textContent = `${focus.temperatureK.toLocaleString("zh-CN")} K（合成）`;
  el.detailLuminosity.textContent = `${formatNumber(focus.luminosity, 2)}（合成指数）`;

  const visibilityParts: string[] = [];
  if (hidden) {
    visibilityParts.push("当前被隐藏：场景中不绘制该点，鼠标不能选中它；键盘仍可聚焦并显示轮廓。");
  } else if (info.occludedBy > 0) {
    visibilityParts.push(
      `屏幕投影与其他 ${info.occludedBy} 个更近对象重叠，鼠标点击优先选中最近对象；可用下方重叠栈或“受控定位”分离。`,
    );
  } else if (!info.projected?.onScreen) {
    visibilityParts.push("当前在视锥外，键盘焦点仍保留，可使用受控定位把它带回视野。");
  } else {
    visibilityParts.push("当前投影可见，未被更近对象遮挡。");
  }
  el.detailVisibility.textContent = visibilityParts.join("");

  el.detailTags.innerHTML = "";
  for (const tag of focus.tags) {
    const li = document.createElement("li");
    li.textContent = tag;
    el.detailTags.append(li);
  }
  el.detailNote.textContent = focus.note;

  el.toggleHiddenButton.textContent = hidden ? "显示此对象" : "隐藏此对象";
  el.toggleHiddenButton.setAttribute("aria-pressed", String(hidden));
  el.toggleHiddenButton.dataset.objectId = focus.id;

  renderOverlap(focus, info);
}

function renderOverlap(
  focus: SpaceObject,
  info: ReturnType<SpaceScene["screenInfoFor"]>,
): void {
  el.overlapList.innerHTML = "";
  if (info.hidden) {
    el.overlapSummary.textContent = "对象已隐藏，不参与鼠标拾取与遮挡栈；键盘聚焦依旧按稳定 ID 生效。";
    return;
  }
  if (info.overlapStack.length <= 1) {
    el.overlapSummary.textContent = "当前屏幕位置没有其他可见对象重叠。";
    return;
  }
  const relationLabel = {
    nearer: "更近，遮挡焦点",
    farther: "更远，被焦点遮挡",
    self: "焦点本身",
  } as const;
  el.overlapSummary.textContent = `同一屏幕位置有 ${info.overlapStack.length} 个可见对象，按深度由近到远排列：`;
  for (const entry of info.overlapStack) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overlap-button";
    button.dataset.testid = `overlap-item-${entry.id}`;
    button.dataset.overlapId = entry.id;
    button.setAttribute("aria-current", String(entry.id === focus.id));
    const label = document.createElement("span");
    label.textContent = `${entry.name} · ${relationLabel[entry.relation]}`;
    const meta = document.createElement("span");
    meta.className = "overlap-meta";
    meta.textContent = `d=${entry.depth.toFixed(1)}`;
    button.append(label, meta);
    button.addEventListener("click", () => {
      selectObject(entry.id, "overlap");
      objectFocusFeedback(entry.id);
    });
    li.append(button);
    el.overlapList.append(li);
  }
}

function objectFocusFeedback(id: string): void {
  const { data } = requireContext();
  const object = data.objectById.get(id);
  if (!object) return;
  const info = scene?.screenInfoFor(id) ?? null;
  const hidden = scene?.isHidden(id) ?? false;
  const details = info && info.occludedBy > 0 && !hidden
    ? `，被 ${info.occludedBy} 个更近对象遮挡`
    : hidden
      ? "，当前隐藏"
      : "";
  announce(`已聚焦 ${object.name}，稳定 ID ${id}${details}。坐标 ${formatCoords(object)}。`);
}

function updateSelectionUi(): void {
  if (!scene) return;
  const focusId = state.focusId;
  scene.setFocus(focusId);

  if (focusId) {
    const object = requireContext().data.objectById.get(focusId);
    const info = scene.screenInfoFor(focusId);
    const hidden = scene.isHidden(focusId);
    if (object) {
      const meta = hidden
        ? "已隐藏 · 轮廓定位"
        : info.occludedBy > 0
          ? `遮挡 ${info.occludedBy}`
          : "可见";
      const calloutMeta = document.querySelector<HTMLElement>("#focus-callout .callout-meta");
      if (calloutMeta) calloutMeta.textContent = meta;
    }
  }

  for (const item of el.objectList.querySelectorAll<HTMLElement>(".object-item")) {
    const selected = item.dataset.objectId === focusId;
    item.setAttribute("aria-selected", String(selected));
  }
  el.objectList.setAttribute(
    "aria-activedescendant",
    focusId ? `object-option-${focusId}` : "",
  );
  if (focusId) {
    scrollListItemIntoView(focusId);
  }
}

function scrollListItemIntoView(id: string): void {
  const item = document.getElementById(`object-option-${id}`);
  if (!item) return;
  const listRect = el.objectList.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  if (itemRect.top < listRect.top) {
    el.objectList.scrollTop -= listRect.top - itemRect.top;
  } else if (itemRect.bottom > listRect.bottom) {
    el.objectList.scrollTop += itemRect.bottom - listRect.bottom;
  }
}

function selectObject(id: string | null, source: "picker" | "list" | "overlap" | "nav" | "toggle"): void {
  if (id && !requireContext().data.objectById.has(id)) return;
  const changed = state.focusId !== id;
  state.focusId = id;
  updateSelectionUi();
  renderInspector();
  renderList();
  if (id) {
    if (changed || source !== "nav") {
      objectFocusFeedback(id);
    }
  } else {
    announce("已清除焦点。");
  }
  void source;
}

function directionForKey(key: string): NavDirection | null {
  const { keyboard } = requireContext();
  for (const direction of ["up", "down", "left", "right"] as NavDirection[]) {
    if (keyboard.spatial.directions[direction] === key) return direction;
  }
  return null;
}

function moveFocus(direction: NavDirection): void {
  if (!scene || !ctx) return;
  const { keyboard } = ctx;
  const projections = scene.projectionEntries();
  let nextId: string | null = null;
  if (state.navMode === "list") {
    nextId = navigateList(state.focusId, orderedIds(), direction, keyboard);
  } else {
    nextId = navigateSpatial(state.focusId, projections, direction, state.includeHidden, keyboard);
  }
  if (!nextId) {
    if (state.navMode === "spatial") {
      announce("该方向上没有可导航的对象。");
    }
    return;
  }
  if (nextId === state.focusId) {
    return;
  }
  selectObject(nextId, "nav");
}

function handleViewportKey(event: KeyboardEvent): void {
  if (!ctx) return;
  const { keyboard } = ctx;
  const key = event.key;
  const direction = directionForKey(key);
  if (direction) {
    event.preventDefault();
    moveFocus(direction);
    return;
  }
  if (keyboard.list.jumpToStart.includes(key)) {
    event.preventDefault();
    const id = jumpList(orderedIds(), "start");
    if (id) selectObject(id, "nav");
    return;
  }
  if (keyboard.list.jumpToEnd.includes(key)) {
    event.preventDefault();
    const id = jumpList(orderedIds(), "end");
    if (id) selectObject(id, "nav");
    return;
  }
  if (key.toLowerCase() === keyboard.global.locateKey.toLowerCase()) {
    event.preventDefault();
    locateFocused();
    return;
  }
  if (key.toLowerCase() === keyboard.global.hiddenToggleKey.toLowerCase()) {
    event.preventDefault();
    toggleSpatialHidden();
    return;
  }
  if (key.toLowerCase() === keyboard.global.resetKey.toLowerCase()) {
    event.preventDefault();
    scene?.resetCamera();
    announce("视角已重置。");
    return;
  }
  if (keyboard.list.clearFocus.includes(key)) {
    event.preventDefault();
    selectObject(null, "nav");
  }
}

function handleGlobalShortcut(event: KeyboardEvent): void {
  if (!ctx) return;
  const { keyboard } = ctx;
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.closest("input, select, textarea, button") || target.isContentEditable)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === keyboard.global.locateKey.toLowerCase()) {
    if (!state.focusId) return;
    event.preventDefault();
    locateFocused();
    return;
  }
  if (key === keyboard.global.hiddenToggleKey.toLowerCase()) {
    event.preventDefault();
    toggleSpatialHidden();
    return;
  }
  if (key === keyboard.global.resetKey.toLowerCase()) {
    event.preventDefault();
    scene?.resetCamera();
    announce("视角已重置。");
    return;
  }
  if (key === "escape" && state.focusId) {
    event.preventDefault();
    selectObject(null, "nav");
  }
}

function locateFocused(): void {
  if (!state.focusId) {
    announce("尚未聚焦对象，无法定位。");
    return;
  }
  const moved = scene?.focusCamera(state.focusId) ?? false;
  const name = requireContext().data.objectById.get(state.focusId)?.name ?? "";
  announce(
    moved
      ? `已使用${state.cameraStrategy === "pan" ? "轻柔平移" : "限幅环绕"}定位 ${name}。`
      : "当前策略为保持视角，相机没有移动。",
  );
}

function toggleSpatialHidden(): void {
  if (!ctx) return;
  state.includeHidden = !state.includeHidden;
  el.includeHidden.checked = state.includeHidden;
  announce(
    state.includeHidden
      ? "空间导航现在会考虑隐藏对象。"
      : "空间导航现在忽略隐藏对象。",
  );
}

function handleListKey(event: KeyboardEvent): void {
  if (!ctx) return;
  const { keyboard } = ctx;
  const direction = directionForKey(event.key);
  if (direction) {
    event.preventDefault();
    moveFocus(direction);
    return;
  }
  if (
    keyboard.list.jumpToStart.includes(event.key) ||
    keyboard.list.jumpToEnd.includes(event.key)
  ) {
    event.preventDefault();
    const edge = keyboard.list.jumpToStart.includes(event.key) ? "start" : "end";
    const id = jumpList(orderedIds(), edge);
    if (id) selectObject(id, "nav");
    return;
  }
  if (keyboard.list.activate.includes(event.key)) {
    if (!state.focusId) return;
    event.preventDefault();
    const moved = scene?.focusCamera(state.focusId) ?? false;
    announce(moved ? "已执行受控定位。" : "当前相机策略不会移动。");
  }
}

function bindControls(): void {
  el.sortMode.addEventListener("change", () => {
    state.sortMode = el.sortMode.value as SortMode;
    renderList();
    // Re-sorting must not change which stable ID is focused or highlighted.
    updateSelectionUi();
  });

  el.navMode.addEventListener("change", () => {
    state.navMode = el.navMode.value as NavMode;
    renderList();
    announce(
      state.navMode === "list"
        ? "键盘导航切换为列表顺序。"
        : "键盘导航切换为屏幕空间邻接。",
    );
  });

  el.reverseButton.addEventListener("click", () => {
    state.reversed = !state.reversed;
    el.reverseButton.setAttribute("aria-pressed", String(state.reversed));
    renderList();
    updateSelectionUi();
  });

  el.cameraStrategy.addEventListener("change", () => {
    state.cameraStrategy = el.cameraStrategy.value as CameraStrategy;
    scene?.setCameraStrategy(state.cameraStrategy);
    updateCameraStatus();
  });

  el.includeHidden.addEventListener("change", () => {
    state.includeHidden = el.includeHidden.checked;
  });

  el.resetButton.addEventListener("click", () => {
    scene?.resetCamera();
    announce("视角已重置。");
  });

  el.locateButton.addEventListener("click", () => {
    if (!state.focusId) return;
    const moved = scene?.focusCamera(state.focusId) ?? false;
    const object = requireContext().data.objectById.get(state.focusId);
    announce(
      moved
        ? `已使用受控定位聚焦 ${object?.name ?? ""}，相机移动经过缓动并受角度限制。`
        : "当前策略为保持视角，相机没有移动。",
    );
  });

  el.toggleHiddenButton.addEventListener("click", () => {
    if (!state.focusId || !scene) return;
    const nextHidden = !scene.isHidden(state.focusId);
    scene.setHidden(state.focusId, nextHidden);
    renderList();
    renderInspector();
    renderDatasetHeader();
    scene.setFocus(state.focusId);
    const name = requireContext().data.objectById.get(state.focusId)?.name ?? "";
    announce(nextHidden ? `${name} 已隐藏，鼠标不可拾取。` : `${name} 已重新显示。`);
    el.objectList.focus();
  });

  el.copyButton.addEventListener("click", async () => {
    if (!state.focusId || !ctx) return;
    const object = ctx.data.objectById.get(state.focusId);
    if (!object) return;
    const info = scene?.screenInfoFor(object.id) ?? null;
    const text = `${describeObject(object, info)} 稳定 ID：${object.id}；坐标单位：合成单位 su。注意：这是程序化演示数据，不是真实天体测量。`;
    try {
      await navigator.clipboard.writeText(text);
      el.copyFeedback.textContent = "描述已复制到剪贴板。";
    } catch {
      el.copyFeedback.textContent = "无法访问剪贴板，请手动选择详情文本。";
    }
  });

  el.viewport.addEventListener("keydown", handleViewportKey);
  el.objectList.addEventListener("keydown", handleListKey);
  document.addEventListener("keydown", handleGlobalShortcut);
  el.objectList.addEventListener("focus", () => {
    if (!state.focusId) return;
    el.objectList.setAttribute("aria-activedescendant", `object-option-${state.focusId}`);
  });
}

function exposeVerificationSurface(): void {
  if (!ctx || !scene) return;
  const { data, keyboard } = ctx;
  // Expose a narrow, read-only surface for automated verification. It reads
  // the same scene state the UI uses instead of duplicating geometry.
  Object.defineProperty(window, "__spaceApp", {
    value: {
      getState: () => ({
        focusId: state.focusId,
        sortMode: state.sortMode,
        reversed: state.reversed,
        navMode: state.navMode,
        includeHidden: state.includeHidden,
        cameraStrategy: state.cameraStrategy,
        hiddenIds: data.objects.filter((object) => scene!.isHidden(object.id)).map((o) => o.id),
      }),
      getFocusScreen: () => scene?.focusScreenPosition() ?? null,
      highlightedIds: () => scene?.highlightedObjectIds() ?? [],
      isVisible: (id: string) => scene?.isVisible(id) ?? false,
      project: () => scene?.projectionEntries() ?? [],
      focusInfo: () => (state.focusId ? scene?.screenInfoFor(state.focusId) ?? null : null),
      pickStackAtCenter: (x: number, y: number) => scene?.pickStackAt(x, y) ?? [],
      getCamera: () => ({
        position: scene?.getCameraPosition() ?? null,
        target: scene?.getCameraTarget() ?? null,
        moving: scene?.isCameraAnimating() ?? false,
      }),
      resetCamera: () => scene?.resetCamera(),
      objectIds: () => data.objects.map((object) => object.id),
      trajectories: () => data.trajectories.map((trajectory) => trajectory.id),
      keyboardConfig: () => keyboard,
      resourceStatus: () =>
        [...el.resourceStatusList.querySelectorAll<HTMLElement>("li")].map((item) => ({
          resource: item.dataset.resource,
          state: item.dataset.state,
          detail: item.querySelector(".resource-detail")?.textContent ?? "",
        })),
      focusRingRect: () => {
        const ring = document.querySelector<HTMLElement>("#focus-ring");
        if (!ring || ring.hidden) return null;
        const rect = ring.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
      canvasRect: () => {
        const canvas = document.querySelector<HTMLCanvasElement>("#scene-canvas");
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
    },
    configurable: true,
  });
}

function startApp(loaded: AppContext, resourceStatuses: ResourceStatus[]): void {
  ctx = loaded;
  state.includeHidden = loaded.keyboard.spatial.includeHiddenByDefault;
  el.includeHidden.checked = state.includeHidden;

  scene = new SpaceScene(
    el.viewport,
    callbacks,
    { reducedMotion, data: loaded.data },
  );
  renderDatasetHeader();
  renderList();
  renderInspector();
  bindControls();
  updateCameraStatus();
  renderResourcePanel(resourceStatuses);
  exposeVerificationSurface();

  el.bootOverlay.classList.add("is-ready");
  window.setTimeout(() => {
    el.bootOverlay.hidden = true;
  }, 350);
  announce(
    `查看器已就绪：${loaded.data.objects.length} 个合成点，键盘导航配置与字体均已从发布包加载。`,
  );
}

async function boot(): Promise<void> {
  const loadingStatuses: ResourceStatus[] = [
    { key: "dataset", label: "数据样例 data/dataset.json", state: "loading", detail: "正在获取。" },
    { key: "keyboard", label: "键盘导航配置 data/keyboard-nav.json", state: "loading", detail: "正在获取。" },
    { key: "font", label: "界面字体（自托管 WOFF2）", state: "loading", detail: "正在加载。" },
  ];
  for (const status of loadingStatuses) renderBootRow(status);

  let fontStatus: ResourceStatus;
  let loaded: AppContext;
  try {
    // Fonts load in parallel but never gate boot; their failure is reported.
    const [resources, fontResult] = await Promise.all([
      loadResources(),
      loadUiFonts(),
    ]);
    loaded = { data: resources.dataset, keyboard: resources.keyboard };
    fontStatus = fontResult;
  } catch (error) {
    showFatalError(error);
    return;
  }

  const statuses: ResourceStatus[] = [
    {
      key: "dataset",
      label: "数据样例 data/dataset.json",
      state: "ready",
      detail: `${loaded.data.objects.length} 个对象、${loaded.data.trajectories.length} 条轨迹已通过校验。`,
    },
    {
      key: "keyboard",
      label: "键盘导航配置 data/keyboard-nav.json",
      state: "ready",
      detail: `列表与空间键位已加载，空间锥角 ${loaded.keyboard.spatial.maxConeAngleDeg}°。`,
    },
    fontStatus,
  ];
  for (const status of statuses) renderBootRow(status);
  startApp(loaded, statuses);
}

void boot();
