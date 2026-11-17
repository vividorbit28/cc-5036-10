export type GroupId = "wing" | "ring" | "cross" | "halo" | "echo";
export type TrajectoryId = "alpha" | "beta" | "gamma" | "theta";

export interface SpaceObject {
  id: string;
  name: string;
  position: [number, number, number];
  group: GroupId;
  trajectoryId: TrajectoryId | null;
  spectralClass: string;
  temperatureK: number;
  luminosity: number;
  tags: string[];
  note: string;
  initiallyHidden?: boolean;
}

export interface Trajectory {
  id: TrajectoryId;
  name: string;
  shortName: string;
  group: GroupId;
  points: [number, number, number][];
  closed: boolean;
  dashed: boolean;
  description: string;
}

export interface GroupMeta {
  id: GroupId;
  label: string;
  color: string;
  description: string;
}

export interface DatasetBundle {
  meta: {
    title: string;
    version: string;
    coordinateUnit: string;
    disclaimer: string;
  };
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  groups: Record<GroupId, GroupMeta>;
  trajectories: Trajectory[];
  objects: SpaceObject[];
}

export const GROUPS: Record<GroupId, GroupMeta> = {
  wing: {
    id: "wing",
    label: "翼流群",
    color: "#f2b45f",
    description: "沿开放曲线分布的合成点群。",
  },
  ring: {
    id: "ring",
    label: "环带群",
    color: "#64d8d2",
    description: "闭合环带上的合成点群。",
  },
  cross: {
    id: "cross",
    label: "穿行群",
    color: "#ef7f9f",
    description: "斜向穿行的开放点群。",
  },
  halo: {
    id: "halo",
    label: "远景群",
    color: "#b19bff",
    description: "用于近远距混合测试的远景点。",
  },
  echo: {
    id: "echo",
    label: "叠影测试组",
    color: "#ffd477",
    description: "沿初始视线排列的遮挡与拾取测试点。",
  },
};

export const DATASET_META = {
  title: "合成示意点集",
  version: "演示数据 v1",
  coordinateUnit: "su",
  disclaimer:
    "所有点、轨迹、坐标与属性均由本工具程序化合成，仅用于三维查询、遮挡与无障碍交互测试；它们不是真实天体，也不代表经过验证的天体测量。",
};

const CAMERA_START: [number, number, number] = [8.5, 6.2, 17];
const ORIGIN_TARGET: [number, number, number] = [0, 0.5, 0];

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// The echo test points sit exactly on the initial camera-target ray. They
// therefore share one screen position while differing in depth.
const ECHO_DIR = normalize([
  CAMERA_START[0] - ORIGIN_TARGET[0],
  CAMERA_START[1] - ORIGIN_TARGET[1],
  CAMERA_START[2] - ORIGIN_TARGET[2],
]);

function echoPoint(k: number): [number, number, number] {
  return [
    ORIGIN_TARGET[0] + ECHO_DIR[0] * k,
    ORIGIN_TARGET[1] + ECHO_DIR[1] * k,
    ORIGIN_TARGET[2] + ECHO_DIR[2] * k,
  ];
}

function makeObject(
  id: string,
  name: string,
  position: [number, number, number],
  group: GroupId,
  trajectoryId: TrajectoryId | null,
  spectralClass: string,
  temperatureK: number,
  luminosity: number,
  tags: string[],
  note: string,
  initiallyHidden = false,
): SpaceObject {
  return {
    id,
    name,
    position,
    group,
    trajectoryId,
    spectralClass,
    temperatureK,
    luminosity,
    tags: ["合成点", GROUPS[group].label, ...tags],
    note,
    initiallyHidden,
  };
}

const WING_POINTS: [number, number, number][] = [
  [-6.2, 2.1, -2.8],
  [-4.8, 3.0, -2.0],
  [-3.3, 3.7, -1.1],
  [-1.7, 4.0, -0.1],
  [0.0, 3.7, 0.9],
  [1.7, 3.0, 1.6],
  [3.3, 2.0, 1.9],
  [4.9, 0.8, 1.6],
];

const RING_POINTS: [number, number, number][] = [
  [4.8, 0.1, 0],
  [3.394, 1.0, 3.394],
  [0, 1.4, 4.8],
  [-3.394, 1.0, 3.394],
  [-4.8, 0.1, 0],
  [-3.394, -0.8, -3.394],
  [0, -1.1, -4.8],
  [3.394, -0.8, -3.394],
];

const CROSS_POINTS: [number, number, number][] = [
  [-5.5, -2.2, -4.8],
  [-3.3, -1.2, -2.9],
  [-1.1, -0.2, -1.0],
  [1.1, 0.8, 0.9],
  [3.3, 1.8, 2.8],
  [5.5, 2.8, 4.7],
];

const HALO_POINTS: [number, number, number][] = [
  [-11.5, 7.0, -13.5],
  [-6.2, 8.8, -16.0],
  [0.8, 9.8, -15.2],
  [7.4, 8.1, -12.0],
  [11.8, 6.4, -8.5],
  // A far shell point deliberately placed behind a near-group cluster, so the
  // near/far mix is exercised by real overlap rather than a separate list.
  [-2.23, -1.63, -6.35],
];

const ECHO_POINTS: [number, number, number][] = [
  echoPoint(11.8),
  echoPoint(9.6),
  echoPoint(7.4),
  echoPoint(5.2),
  echoPoint(3.0),
];

const WING_OBJECTS = WING_POINTS.map((position, i) =>
  makeObject(
    `wing-${String(i + 1).padStart(2, "0")}`,
    `翼流-${String(i + 1).padStart(2, "0")}`,
    position,
    "wing",
    "alpha",
    `S-W${i + 1}`,
    4300 + i * 210,
    0.7 + i * 0.09,
    i < 3 ? ["近景", "开放曲线"] : ["开放曲线", "中层"],
    `开放翼流曲线上的第 ${i + 1} 个合成采样点，用于列表与空间导航测试。`,
  ),
);

const RING_OBJECTS = RING_POINTS.map((position, i) =>
  makeObject(
    `ring-${String(i + 1).padStart(2, "0")}`,
    `环带-${String(i + 1).padStart(2, "0")}`,
    position,
    "ring",
    "beta",
    `S-R${i + 1}`,
    5900 + i * 160,
    1.1 + i * 0.12,
    ["闭合环", i >= 4 ? "远侧" : "近侧"],
    `闭合环带上的第 ${i + 1} 个合成采样点，环绕原点分布。`,
  ),
);

const CROSS_OBJECTS = CROSS_POINTS.map((position, i) =>
  makeObject(
    `cross-${String(i + 1).padStart(2, "0")}`,
    `穿行-${String(i + 1).padStart(2, "0")}`,
    position,
    "cross",
    "gamma",
    `S-C${i + 1}`,
    7100 + i * 190,
    2.0 + i * 0.2,
    ["斜向穿行", i === 3 ? "初始隐藏测试" : "开放曲线"],
    i === 3
      ? "初始即隐藏的合成点；用于检查隐藏对象的轮廓定位与鼠标不可拾取状态。"
      : `斜向穿行曲线上的第 ${i + 1} 个合成采样点。`,
    i === 3,
  ),
);

const HALO_OBJECTS = HALO_POINTS.map((position, i) =>
  makeObject(
    `halo-${String(i + 1).padStart(2, "0")}`,
    i === 5 ? "远景-06" : `远景-${String(i + 1).padStart(2, "0")}`,
    position,
    "halo",
    i === 5 ? null : "theta",
    `S-H${i + 1}`,
    9800 + i * 420,
    8.0 + i * 1.5,
    ["远景", "近远混合", ...(i === 5 ? ["遮挡测试"] : [])],
    i === 5
      ? "位于远景壳层、投影上与穿行-04 重叠的合成点，用于验证近远混合遮挡。"
      : `位于远景壳层上的第 ${i + 1} 个合成采样点，用于近远距投影与拾取测试。`,
  ),
);

const ECHO_NAMES = ["叠影-01", "叠影-02", "叠影-03", "叠影-04", "叠影-05"];
const ECHO_OBJECTS = ECHO_POINTS.map((position, i) =>
  makeObject(
    `echo-${String(i + 1).padStart(2, "0")}`,
    ECHO_NAMES[i],
    position,
    "echo",
    null,
    `S-E${i + 1}`,
    6200 + i * 320,
    0.9 + i * 0.35,
    ["同视线", "遮挡测试", i === 0 ? "最近" : i === 4 ? "最远" : "中层"],
    "沿初始相机视线排列的合成叠影点；与其他叠影点共享屏幕投影，但深度不同。",
  ),
);

export const OBJECTS: SpaceObject[] = [
  ...WING_OBJECTS,
  ...RING_OBJECTS,
  ...CROSS_OBJECTS,
  ...HALO_OBJECTS,
  ...ECHO_OBJECTS,
];

export const TRAJECTORIES: Trajectory[] = [
  {
    id: "alpha",
    name: "翼流开放轨迹",
    shortName: "α",
    group: "wing",
    points: WING_POINTS,
    closed: false,
    dashed: false,
    description: "连接翼流群采样点的开放折线。",
  },
  {
    id: "beta",
    name: "环带闭合轨迹",
    shortName: "β",
    group: "ring",
    points: RING_POINTS,
    closed: true,
    dashed: false,
    description: "连接环带群采样点的闭合轨迹。",
  },
  {
    id: "gamma",
    name: "穿行斜向轨迹",
    shortName: "γ",
    group: "cross",
    points: CROSS_POINTS,
    closed: false,
    dashed: true,
    description: "连接穿行群采样点的斜向虚线轨迹。",
  },
  {
    id: "theta",
    name: "远景弧线",
    shortName: "θ",
    group: "halo",
    points: HALO_POINTS,
    closed: false,
    dashed: true,
    description: "连接远景群采样点的稀疏虚线弧。",
  },
];

export const DATASET_CAMERA = {
  position: CAMERA_START,
  target: ORIGIN_TARGET,
  fov: 42,
} as const;

export function buildDatasetBundle(): DatasetBundle {
  return {
    meta: {
      title: DATASET_META.title,
      version: DATASET_META.version,
      coordinateUnit: DATASET_META.coordinateUnit,
      disclaimer: DATASET_META.disclaimer,
    },
    camera: {
      position: [...DATASET_CAMERA.position] as [number, number, number],
      target: [...DATASET_CAMERA.target] as [number, number, number],
      fov: DATASET_CAMERA.fov,
    },
    groups: GROUPS,
    trajectories: TRAJECTORIES,
    objects: OBJECTS,
  };
}
