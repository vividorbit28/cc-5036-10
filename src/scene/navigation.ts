import type { KeyboardConfig, NavDirection } from "../data/keyboardConfig";
import type { ProjectionEntry } from "./SpaceScene";

export type { NavDirection } from "../data/keyboardConfig";
export type NavMode = "list" | "spatial";

export interface NavigationContext {
  mode: NavMode;
  /** IDs in the order currently rendered by the list, after any sort/reverse. */
  orderedIds: string[];
  /** Projection data produced by the scene for this frame. */
  projections: ProjectionEntry[];
  includeHidden: boolean;
}

/** Angle between a candidate offset and the requested screen direction. */
function directionDelta(dx: number, dy: number, direction: NavDirection): number {
  const axes: Record<NavDirection, [number, number]> = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };
  const [ax, ay] = axes[direction];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return Number.POSITIVE_INFINITY;
  const dot = (dx * ax + dy * ay) / length;
  const clamped = Math.min(1, Math.max(-1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * List mode moves through the displayed list in stable-ID index space, so a
 * re-sort changes only traversal order and never the identity of the focus.
 */
export function navigateList(
  currentId: string | null,
  orderedIds: string[],
  direction: NavDirection,
  config: KeyboardConfig,
): string | null {
  if (orderedIds.length === 0) return null;
  const forward = config.list.forward.includes(keyForDirection(direction));
  const index = currentId ? orderedIds.indexOf(currentId) : -1;
  if (index === -1) {
    return forward ? orderedIds[0] : orderedIds[orderedIds.length - 1];
  }
  const step = forward ? 1 : -1;
  const next = index + step;
  if (next < 0 || next >= orderedIds.length) {
    return currentId;
  }
  return orderedIds[next];
}

export function jumpList(
  orderedIds: string[],
  edge: "start" | "end",
): string | null {
  if (orderedIds.length === 0) return null;
  return edge === "start" ? orderedIds[0] : orderedIds[orderedIds.length - 1];
}

function keyForDirection(direction: NavDirection): string {
  return { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[direction];
}

/**
 * Spatial mode chooses the nearest on-screen point whose bearing is within the
 * configured cone of the arrow direction. Ties break by screen distance,
 * depth, then stable ID. Off-screen points are excluded so each key press is
 * predictable. Hidden points can be included explicitly via the H toggle.
 */
export function navigateSpatial(
  currentId: string | null,
  projections: ProjectionEntry[],
  direction: NavDirection,
  includeHidden: boolean,
  config: KeyboardConfig,
): string | null {
  const maxAngle = config.spatial.maxConeAngleDeg;
  const tieTolerance = config.spatial.tieTolerancePx;
  const pool = projections.filter((entry) => includeHidden || !entry.hidden);
  const onScreen = pool.filter((entry) => entry.onScreen);
  if (onScreen.length === 0) return null;

  const origin = currentId ? onScreen.find((entry) => entry.id === currentId) : undefined;
  if (!origin) {
    // With no focus, pick a deterministic entry point opposite the arrow, so
    // "up" starts from the lowest on-screen point and moves upward.
    const opposite: Record<NavDirection, (a: ProjectionEntry, b: ProjectionEntry) => number> = {
      up: (a, b) => b.y - a.y || a.id.localeCompare(b.id),
      down: (a, b) => a.y - b.y || a.id.localeCompare(b.id),
      left: (a, b) => b.x - a.x || a.id.localeCompare(b.id),
      right: (a, b) => a.x - b.x || a.id.localeCompare(b.id),
    };
    return [...onScreen].sort(opposite[direction])[0]?.id ?? null;
  }

  const candidates = onScreen
    .filter((entry) => entry.id !== origin.id)
    .map((entry) => {
      const dx = entry.x - origin.x;
      const dy = entry.y - origin.y;
      const distance = Math.hypot(dx, dy);
      return {
        entry,
        dx,
        dy,
        distance,
        angle: directionDelta(dx, dy, direction),
      };
    })
    .filter((candidate) => candidate.distance >= 1 && candidate.angle <= maxAngle)
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.entry.depth - b.entry.depth ||
        a.entry.id.localeCompare(b.entry.id),
    );

  if (candidates.length > 0) {
    const nearestDistance = candidates[0].distance;
    // Prefer candidates within the configured tolerance of the nearest so ties
    // resolve by ID, not by sub-pixel noise.
    const tied = candidates.filter((candidate) => candidate.distance <= nearestDistance + tieTolerance);
    tied.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
    return tied[0]?.entry.id ?? null;
  }

  // Cone empty: fall back to the least-wide angle within the forward half
  // plane instead of refusing to move.
  const halfPlane = onScreen
    .filter((entry) => entry.id !== origin.id)
    .map((entry) => {
      const dx = entry.x - origin.x;
      const dy = entry.y - origin.y;
      const distance = Math.hypot(dx, dy);
      return { entry, distance, angle: directionDelta(dx, dy, direction) };
    })
    .filter((candidate) => candidate.angle < 90)
    .sort(
      (a, b) =>
        a.angle - b.angle ||
        a.distance - b.distance ||
        a.entry.id.localeCompare(b.entry.id),
    );
  return halfPlane[0]?.entry.id ?? currentId;
}
