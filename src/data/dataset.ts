import type {
  DatasetBundle,
  GroupId,
  GroupMeta,
  SpaceObject,
  Trajectory,
  TrajectoryId,
} from "./dataset-source";

export type {
  DatasetBundle,
  GroupId,
  GroupMeta,
  SpaceObject,
  Trajectory,
  TrajectoryId,
};

export class ResourceError extends Error {
  readonly resource: string;
  constructor(resource: string, message: string) {
    super(`${resource}: ${message}`);
    this.name = "ResourceError";
    this.resource = resource;
  }
}

function isTuple3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number" && Number.isFinite(component))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates the fetched data sample. The viewer never substitutes baked-in
 * defaults: an unusable resource is a hard boot failure reported in the UI.
 */
export function validateDatasetBundle(value: unknown): DatasetBundle {
  if (typeof value !== "object" || value === null) {
    throw new ResourceError("data/dataset.json", "根节点必须是对象。");
  }
  const bundle = value as Partial<DatasetBundle>;

  if (typeof bundle.meta !== "object" || bundle.meta === null) {
    throw new ResourceError("data/dataset.json", "缺少 meta 段。");
  }
  for (const key of ["title", "version", "coordinateUnit", "disclaimer"] as const) {
    if (!isNonEmptyString(bundle.meta[key])) {
      throw new ResourceError("data/dataset.json", `meta.${key} 必须是非空字符串。`);
    }
  }

  const camera = bundle.camera;
  if (
    typeof camera !== "object" ||
    camera === null ||
    !isTuple3(camera.position) ||
    !isTuple3(camera.target) ||
    typeof camera.fov !== "number" ||
    camera.fov <= 0
  ) {
    throw new ResourceError("data/dataset.json", "camera 段不合法。");
  }

  const groups = bundle.groups as Record<string, GroupMeta> | undefined;
  if (typeof groups !== "object" || groups === null) {
    throw new ResourceError("data/dataset.json", "缺少 groups 段。");
  }
  const groupIds = new Set(Object.keys(groups));
  for (const [id, meta] of Object.entries(groups)) {
    if (
      typeof meta !== "object" ||
      meta === null ||
      meta.id !== id ||
      !isNonEmptyString(meta.label) ||
      !/^#[0-9a-fA-F]{6}$/.test(meta.color) ||
      !isNonEmptyString(meta.description)
    ) {
      throw new ResourceError("data/dataset.json", `groups.${id} 不合法。`);
    }
  }

  if (!Array.isArray(bundle.objects) || bundle.objects.length === 0) {
    throw new ResourceError("data/dataset.json", "objects 必须是非空数组。");
  }
  const objectIds = new Set<string>();
  for (const object of bundle.objects) {
    const candidate = object as SpaceObject;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !isNonEmptyString(candidate.id) ||
      !isNonEmptyString(candidate.name) ||
      !isTuple3(candidate.position) ||
      !groupIds.has(candidate.group) ||
      !isNonEmptyString(candidate.spectralClass) ||
      typeof candidate.temperatureK !== "number" ||
      typeof candidate.luminosity !== "number" ||
      !Array.isArray(candidate.tags) ||
      !isNonEmptyString(candidate.note)
    ) {
      throw new ResourceError("data/dataset.json", `对象 ${candidate?.id ?? "?"} 不合法。`);
    }
    if (objectIds.has(candidate.id)) {
      throw new ResourceError("data/dataset.json", `对象 ID 重复：${candidate.id}`);
    }
    objectIds.add(candidate.id);
    if (
      candidate.trajectoryId !== null &&
      candidate.trajectoryId !== undefined &&
      typeof candidate.trajectoryId !== "string"
    ) {
      throw new ResourceError("data/dataset.json", `对象 ${candidate.id} 的轨迹字段不合法。`);
    }
  }

  if (!Array.isArray(bundle.trajectories)) {
    throw new ResourceError("data/dataset.json", "trajectories 必须是数组。");
  }
  const trajectoryIds = new Set<string>();
  for (const trajectory of bundle.trajectories) {
    const candidate = trajectory as Trajectory;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !isNonEmptyString(candidate.id) ||
      !isNonEmptyString(candidate.name) ||
      !groupIds.has(candidate.group) ||
      typeof candidate.closed !== "boolean" ||
      typeof candidate.dashed !== "boolean" ||
      !Array.isArray(candidate.points) ||
      !candidate.points.every(isTuple3)
    ) {
      throw new ResourceError("data/dataset.json", `轨迹 ${candidate?.id ?? "?"} 不合法。`);
    }
    trajectoryIds.add(candidate.id);
  }
  for (const object of bundle.objects) {
    if (object.trajectoryId !== null && !trajectoryIds.has(object.trajectoryId as TrajectoryId)) {
      throw new ResourceError(
        "data/dataset.json",
        `对象 ${object.id} 引用了不存在的轨迹 ${String(object.trajectoryId)}。`,
      );
    }
  }

  return bundle as DatasetBundle;
}

export interface DatasetIndices {
  objects: SpaceObject[];
  groups: Record<GroupId, GroupMeta>;
  trajectories: Trajectory[];
  meta: DatasetBundle["meta"];
  camera: DatasetBundle["camera"];
  objectById: Map<string, SpaceObject>;
  trajectoryById: Map<string, Trajectory>;
  countByGroup: Record<GroupId, number>;
}

export function indexDataset(bundle: DatasetBundle): DatasetIndices {
  const objectById = new Map(bundle.objects.map((object) => [object.id, object]));
  const trajectoryById = new Map(bundle.trajectories.map((trajectory) => [trajectory.id, trajectory]));
  const countByGroup = bundle.objects.reduce(
    (acc, object) => {
      acc[object.group] = (acc[object.group] ?? 0) + 1;
      return acc;
    },
    {} as Record<GroupId, number>,
  );
  return {
    objects: bundle.objects,
    groups: bundle.groups,
    trajectories: bundle.trajectories,
    meta: bundle.meta,
    camera: bundle.camera,
    objectById,
    trajectoryById,
    countByGroup,
  };
}

export function distanceFromOrigin(object: SpaceObject): number {
  return Math.hypot(...object.position);
}
