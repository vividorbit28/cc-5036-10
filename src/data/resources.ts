import {
  ResourceError,
  indexDataset,
  validateDatasetBundle,
  type DatasetIndices,
} from "./dataset";
import { validateKeyboardConfig, type KeyboardConfig } from "./keyboardConfig";

export type ResourceState = "loading" | "ready" | "error";

export interface ResourceStatus {
  key: string;
  label: string;
  state: ResourceState;
  detail: string;
}

export interface LoadedResources {
  dataset: DatasetIndices;
  keyboard: KeyboardConfig;
}

export const RESOURCE_PATHS = {
  dataset: `${import.meta.env.BASE_URL}data/dataset.json`,
  keyboard: `${import.meta.env.BASE_URL}data/keyboard-nav.json`,
  fontRegular: `${import.meta.env.BASE_URL}fonts/explorer-sans.woff2`,
  fontBold: `${import.meta.env.BASE_URL}fonts/explorer-sans-bold.woff2`,
  fontMono: `${import.meta.env.BASE_URL}fonts/explorer-mono.woff2`,
} as const;

async function fetchJson(path: string, resource: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch (cause) {
    throw new ResourceError(resource, `网络请求失败：${(cause as Error).message}`);
  }
  if (!response.ok) {
    throw new ResourceError(resource, `HTTP ${response.status} ${response.statusText}`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new ResourceError(resource, `JSON 解析失败：${(cause as Error).message}`);
  }
}

/**
 * Fonts are a soft dependency: failure is reported as an anomaly on the
 * resource panel but does not block the viewer (system fonts take over).
 */
export async function loadUiFonts(): Promise<ResourceStatus> {
  const label = "界面字体（自托管 WOFF2）";
  if (!("FontFace" in window) || !document.fonts) {
    return {
      key: "font",
      label,
      state: "error",
      detail: "当前浏览器不支持 FontFace API，已回退到系统字体。",
    };
  }
  const faces: Array<[string, string, string]> = [
    ["ExplorerSans", RESOURCE_PATHS.fontRegular, "normal"],
    ["ExplorerSans", RESOURCE_PATHS.fontBold, "bold"],
    ["ExplorerMono", RESOURCE_PATHS.fontMono, "normal"],
  ];
  const loaded: string[] = [];
  const failures: string[] = [];
  await Promise.all(
    faces.map(async ([family, source, weight]) => {
      try {
        const face = new FontFace(family, `url(${source})`, { weight });
        await face.load();
        document.fonts.add(face);
        loaded.push(source);
      } catch (cause) {
        failures.push(`${source}（${(cause as Error).message}）`);
      }
    }),
  );
  if (failures.length > 0) {
    return {
      key: "font",
      label,
      state: "error",
      detail: `字体资源缺失或无法加载：${failures.join("；")}；界面回退到系统字体。`,
    };
  }
  return {
    key: "font",
    label,
    state: "ready",
    detail: `${loaded.length} 个 WOFF2 字体已加载，发布包不依赖开发机字体目录。`,
  };
}

export async function loadResources(): Promise<LoadedResources> {
  const [datasetRaw, keyboardRaw] = await Promise.all([
    fetchJson(RESOURCE_PATHS.dataset, "data/dataset.json"),
    fetchJson(RESOURCE_PATHS.keyboard, "data/keyboard-nav.json"),
  ]);
  const bundle = validateDatasetBundle(datasetRaw);
  const keyboard = validateKeyboardConfig(keyboardRaw);
  return { dataset: indexDataset(bundle), keyboard };
}
