import { ResourceError } from "./dataset";

export type NavMode = "list" | "spatial";
export type NavDirection = "up" | "down" | "left" | "right";

export interface KeyboardConfig {
  version: number;
  list: {
    forward: string[];
    backward: string[];
    jumpToStart: string[];
    jumpToEnd: string[];
    activate: string[];
    clearFocus: string[];
  };
  spatial: {
    directions: Record<NavDirection, string>;
    maxConeAngleDeg: number;
    tieTolerancePx: number;
    hiddenToggleKey: string;
    includeHiddenByDefault: boolean;
  };
  global: {
    locateKey: string;
    resetKey: string;
    hiddenToggleKey: string;
    ignoredModifiers: string[];
  };
  help: {
    listRule: string;
    spatialRule: string;
  };
}

const RESOURCE = "data/keyboard-nav.json";
const DIRECTIONS: NavDirection[] = ["up", "down", "left", "right"];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string");
}

/**
 * Validates the fetched keyboard navigation config. No hard-coded keymap is
 * used as a fallback: a broken config blocks boot like a broken data sample.
 */
export function validateKeyboardConfig(value: unknown): KeyboardConfig {
  if (typeof value !== "object" || value === null) {
    throw new ResourceError(RESOURCE, "根节点必须是对象。");
  }
  const config = value as Partial<KeyboardConfig>;
  if (typeof config.version !== "number") {
    throw new ResourceError(RESOURCE, "缺少 version。");
  }
  const list = config.list;
  if (
    typeof list !== "object" ||
    list === null ||
    !isStringArray(list.forward) ||
    !isStringArray(list.backward) ||
    !isStringArray(list.jumpToStart) ||
    !isStringArray(list.jumpToEnd) ||
    !isStringArray(list.activate) ||
    !isStringArray(list.clearFocus)
  ) {
    throw new ResourceError(RESOURCE, "list 键位段不合法。");
  }
  const spatial = config.spatial;
  if (
    typeof spatial !== "object" ||
    spatial === null ||
    typeof spatial.directions !== "object" ||
    spatial.directions === null ||
    DIRECTIONS.some((direction) => typeof spatial.directions[direction] !== "string") ||
    typeof spatial.maxConeAngleDeg !== "number" ||
    spatial.maxConeAngleDeg <= 0 ||
    spatial.maxConeAngleDeg > 90 ||
    typeof spatial.tieTolerancePx !== "number" ||
    spatial.tieTolerancePx < 0 ||
    typeof spatial.hiddenToggleKey !== "string" ||
    typeof spatial.includeHiddenByDefault !== "boolean"
  ) {
    throw new ResourceError(RESOURCE, "spatial 键位段不合法。");
  }
  const globalSection = config.global;
  if (
    typeof globalSection !== "object" ||
    globalSection === null ||
    !isStringArray([globalSection.locateKey]) ||
    !isStringArray([globalSection.resetKey]) ||
    !isStringArray([globalSection.hiddenToggleKey]) ||
    !Array.isArray(globalSection.ignoredModifiers)
  ) {
    throw new ResourceError(RESOURCE, "global 键位段不合法。");
  }
  if (
    typeof config.help !== "object" ||
    config.help === null ||
    typeof config.help.listRule !== "string" ||
    typeof config.help.spatialRule !== "string"
  ) {
    throw new ResourceError(RESOURCE, "help 文案段不合法。");
  }
  return config as KeyboardConfig;
}
