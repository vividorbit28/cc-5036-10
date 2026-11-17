import { test, expect, type Page } from "@playwright/test";

type Projection = {
  id: string;
  name: string;
  x: number;
  y: number;
  depth: number;
  onScreen: boolean;
  hidden: boolean;
  group: string;
};

type FocusInfo = {
  projected: Projection | null;
  overlapStack: Array<{ id: string; name: string; depth: number; relation: string }>;
  occluders: Array<{ id: string; name: string; depth: number; relation: string }>;
  occludedBy: number;
  visible: boolean;
  hidden: boolean;
};

declare global {
  interface Window {
    __spaceApp: {
      getState(): {
        focusId: string | null;
        sortMode: string;
        reversed: boolean;
        navMode: string;
        includeHidden: boolean;
        cameraStrategy: string;
        hiddenIds: string[];
      };
      getFocusScreen(): { x: number; y: number; depth: number } | null;
      highlightedIds(): string[];
      isVisible(id: string): boolean;
      project(): Projection[];
      focusInfo(): FocusInfo | null;
      pickStackAtCenter(x: number, y: number): Projection[];
      getCamera(): {
        position: [number, number, number] | null;
        target: [number, number, number] | null;
        moving: boolean;
      };
      resetCamera(): void;
      objectIds(): string[];
      trajectories(): string[];
      focusRingRect(): { x: number; y: number; width: number; height: number } | null;
      canvasRect(): { x: number; y: number; width: number; height: number } | null;
    };
  }
}

async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__spaceApp));
  await page.waitForTimeout(450);
}

async function canvasCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const projection = await page.evaluate((targetId) => {
    const entry = window.__spaceApp.project().find((candidate) => candidate.id === targetId);
    const rect = window.__spaceApp.canvasRect()!;
    if (!entry) throw new Error(`missing projection for ${targetId}`);
    return { x: rect.x + entry.x, y: rect.y + entry.y };
  }, id);
  return projection;
}

async function focusById(page: Page, id: string): Promise<void> {
  await page.locator(`[data-testid="object-item-${id}"]`).click();
  await page.waitForFunction((target) => window.__spaceApp.getState().focusId === target, id);
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test.describe("synthetic 3D explorer", () => {
  test("draws a real scene with points, trajectories and a clear data disclaimer", async ({ page }) => {
    await boot(page);
    await expect(page.locator("h1")).toHaveText("三维合成点集浏览器");
    await expect(page.locator('[data-testid="dataset-count"]')).toHaveText("33 个合成点");
    await expect(page.locator('[data-testid="dataset-disclaimer"]')).toContainText(
      "程序化合成",
    );
    await expect(page.locator('[data-testid="dataset-disclaimer"]')).toContainText(
      "不代表经过验证的天体测量",
    );
    await expect(page.locator(".data-warning")).toContainText("不是真实天体测量");

    const trajectories = await page.evaluate(() => window.__spaceApp.trajectories());
    expect(trajectories).toEqual(["alpha", "beta", "gamma", "theta"]);

    const projections = await page.evaluate(() => window.__spaceApp.project());
    expect(projections).toHaveLength(33);
    expect(projections.filter((entry) => entry.onScreen).length).toBeGreaterThan(20);

    // Point meshes are actually rasterized: sample the canvas for non-background pixels.
    const drawn = await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>("#scene-canvas")!;
      const gl = canvas.getContext("webgl2");
      if (!gl) return { nonBackground: 0, renderer: "" };
      const width = 160;
      const height = 120;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let nonBackground = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 40) nonBackground += 1;
      }
      return { nonBackground, renderer: String(gl.getParameter(gl.RENDERER)) };
    });
    expect(drawn.nonBackground).toBeGreaterThan(0);
  });

  test("clicking overlapping points selects the nearest layer and exposes the stack", async ({ page }) => {
    await boot(page);
    const echo = await page.evaluate(() =>
      window.__spaceApp.project().filter((entry) => entry.id.startsWith("echo")),
    );
    expect(echo).toHaveLength(5);
    // Echo points share one screen coordinate but differ in depth.
    const xs = new Set(echo.map((entry) => entry.x.toFixed(1)));
    const ys = new Set(echo.map((entry) => entry.y.toFixed(1)));
    expect(xs.size).toBe(1);
    expect(ys.size).toBe(1);
    expect(new Set(echo.map((entry) => entry.depth.toFixed(2))).size).toBe(5);

    const click = await canvasCenter(page, "echo-03");
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction(() => window.__spaceApp.getState().focusId !== null);

    const state = await page.evaluate(() => window.__spaceApp.getState());
    expect(state.focusId).toBe("echo-01");
    await expect(page.locator('[data-testid="detail-name"]')).toHaveText("叠影-01");
    await expect(page.locator('[data-testid="overlap-list"] .overlap-button')).toHaveCount(5);

    await page.locator('[data-testid="overlap-item-echo-05"]').click();
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "echo-05");
    await expect(page.locator('[data-testid="detail-name"]')).toHaveText("叠影-05");
    await expect(page.locator('[data-testid="inspector-status"]')).toHaveText("被遮挡 4");
    await expect(page.locator('[data-testid="detail-visibility"]')).toContainText("投影");

    const info = await page.evaluate(() => window.__spaceApp.focusInfo());
    expect(info?.occludedBy).toBe(4);
    expect(info?.overlapStack.map((entry) => entry.id)).toEqual([
      "echo-01",
      "echo-02",
      "echo-03",
      "echo-04",
      "echo-05",
    ]);
    // Only the focused identity carries highlight styling.
    expect(await page.evaluate(() => window.__spaceApp.highlightedIds())).toEqual(["echo-05"]);
    // The focus ring is centred on the object's real projection.
    const ring = await page.evaluate(() => window.__spaceApp.focusRingRect());
    const focus = await page.evaluate(() => window.__spaceApp.getFocusScreen());
    const canvas = await page.evaluate(() => window.__spaceApp.canvasRect());
    expect(ring).not.toBeNull();
    expect(Math.abs(ring!.x + ring!.width / 2 - (canvas!.x + focus!.x))).toBeLessThan(1.5);
    expect(Math.abs(ring!.y + ring!.height / 2 - (canvas!.y + focus!.y))).toBeLessThan(1.5);
  });

  test("a nearer cluster hides a distant point and the overlap browser reveals it", async ({ page }) => {
    await boot(page);
    const mixed = await page.evaluate(() => {
      const all = window.__spaceApp.project();
      const near = all.find((entry) => entry.id === "cross-04")!;
      const far = all.find((entry) => entry.id === "halo-06")!;
      return {
        near,
        far,
        separation: Math.hypot(near.x - far.x, near.y - far.y),
      };
    });
    expect(mixed.separation).toBeLessThan(2);
    expect(mixed.far.depth).toBeGreaterThan(mixed.near.depth + 5);

    await focusById(page, "cross-04");
    await page.locator('[data-testid="btn-toggle-hidden"]').click();
    await page.waitForTimeout(250);
    const info = await page.evaluate(() => window.__spaceApp.focusInfo()!);
    expect(info.occludedBy).toBe(0);
    expect(info.overlapStack.map((entry) => entry.id)).toEqual(["cross-04", "halo-06"]);
    await expect(page.locator('[data-testid="overlap-item-halo-06"]')).toContainText("更远");

    await page.locator('[data-testid="overlap-item-halo-06"]').click();
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "halo-06");
    await expect(page.locator('[data-testid="detail-name"]')).toHaveText("远景-06");
    await expect(page.locator('[data-testid="inspector-status"]')).toHaveText("被遮挡 1");
    await expect(page.locator('[data-testid="detail-visibility"]')).toContainText("1 个更近对象");
  });

  test("re-sorting and reversing never changes which stable ID is focused or highlighted", async ({ page }) => {
    await boot(page);
    await focusById(page, "wing-02");
    await expect(page.locator('[data-testid="detail-name"]')).toHaveText("翼流-02");

    const before = await page.evaluate(() => {
      const state = window.__spaceApp.getState();
      return {
        focusId: state.focusId,
        highlighted: window.__spaceApp.highlightedIds(),
        screen: window.__spaceApp.getFocusScreen(),
        active: document.querySelector('[aria-selected="true"]')?.getAttribute("data-object-id"),
        detail: document.querySelector('[data-testid="detail-name"]')?.textContent,
      };
    });
    expect(before.focusId).toBe("wing-02");
    expect(before.highlighted).toEqual(["wing-02"]);
    expect(before.active).toBe("wing-02");

    for (const sortMode of ["name", "distance", "group", "scene"]) {
      await page.selectOption("#sort-mode", sortMode);
      await page.click("#btn-reverse-sort");
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => {
        const state = window.__spaceApp.getState();
        return {
          focusId: state.focusId,
          highlighted: window.__spaceApp.highlightedIds(),
          screen: window.__spaceApp.getFocusScreen(),
          active: document.querySelector('[aria-selected="true"]')?.getAttribute("data-object-id"),
          detail: document.querySelector('[data-testid="detail-name"]')?.textContent,
          ring: window.__spaceApp.focusRingRect(),
          canvas: window.__spaceApp.canvasRect(),
        };
      });
      expect(after.focusId).toBe("wing-02");
      expect(after.highlighted).toEqual(["wing-02"]);
      expect(after.active).toBe("wing-02");
      expect(after.detail).toBe("翼流-02");
      expect(after.screen!.x).toBeCloseTo(before.screen!.x, 1);
      expect(after.screen!.y).toBeCloseTo(before.screen!.y, 1);
      expect(Math.abs(after.ring!.x + after.ring!.width / 2 - (after.canvas!.x + after.screen!.x))).toBeLessThan(1.5);
    }
  });

  test("list navigation follows the displayed order and wraps between neighbours", async ({ page }) => {
    await boot(page);
    await page.locator("#object-list").focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "wing-01");

    const order = await page.evaluate(() =>
      [...document.querySelectorAll(".object-item")].map((item) => item.getAttribute("data-object-id")),
    );
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "wing-02");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "wing-03");
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "wing-02");

    await page.selectOption("#sort-mode", "name");
    await page.click("#btn-reverse-sort");
    await page.waitForTimeout(120);
    const reversedOrder = await page.evaluate(() =>
      [...document.querySelectorAll(".object-item")].map((item) => item.getAttribute("data-object-id")),
    );
    expect(reversedOrder).not.toEqual(order);
    // Focus identity survives the reorder; the active list row moved with it.
    expect(await page.evaluate(() => window.__spaceApp.getState().focusId)).toBe("wing-02");

    await page.locator("#object-list").focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    const moved = await page.evaluate(() => window.__spaceApp.getState().focusId);
    const index = reversedOrder.indexOf("wing-02");
    expect(moved).toBe(reversedOrder[index + 1]);
  });

  test("spatial navigation follows a 45 degree screen-adjacency rule and reports its target", async ({ page }) => {
    await boot(page);
    await page.selectOption("#nav-mode", "spatial");
    await page.locator("#object-list").focus();

    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);
    const firstId = await page.evaluate(() => window.__spaceApp.getState().focusId);
    expect(firstId).not.toBeNull();

    // From the focus, ArrowUp must land on the nearest point within the
    // upward cone, never behind the current point.
    const check = await page.evaluate((fromId) => {
      const projections = window.__spaceApp.project().filter((entry) => entry.onScreen && !entry.hidden);
      const origin = projections.find((entry) => entry.id === fromId)!;
      const candidates = projections
        .filter((entry) => entry.id !== fromId)
        .map((entry) => {
          const dx = entry.x - origin.x;
          const dy = entry.y - origin.y;
          const dist = Math.hypot(dx, dy);
          const dot = (dx * 0 + dy * -1) / (dist || 1);
          const angle = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
          return { id: entry.id, dist, angle };
        })
        .filter((entry) => entry.dist >= 1 && entry.angle <= 45)
        .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));
      return { origin: origin.id, expected: candidates[0]?.id ?? null };
    }, firstId);

    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);
    const nextId = await page.evaluate(() => window.__spaceApp.getState().focusId);
    if (check.expected) {
      expect(nextId).toBe(check.expected);
    } else {
      expect(nextId).toBe(check.origin);
    }

    // Every spatial move announces a readable description of the new focus.
    const live = await page.locator('[data-testid="live-region"]').textContent();
    expect(live).toContain("已聚焦");
  });

  test("hidden objects are identifiable, excluded from pointer picking and reachable by keyboard", async ({ page }) => {
    await boot(page);
    const state = await page.evaluate(() => window.__spaceApp.getState());
    expect(state.hiddenIds).toEqual(["cross-04"]);

    await expect(page.locator('[data-testid="visible-count"]')).toContainText("隐藏 1");
    const item = page.locator('[data-testid="object-item-cross-04"]');
    await expect(item).toContainText("隐藏");

    // A click at the hidden point's projected position must not select it.
    const hiddenProjection = await page.evaluate(() =>
      window.__spaceApp.project().find((entry) => entry.id === "cross-04")!,
    );
    const canvas = await page.evaluate(() => window.__spaceApp.canvasRect());
    await page.mouse.click(canvas!.x + hiddenProjection.x, canvas!.y + hiddenProjection.y);
    await page.waitForTimeout(200);
    const afterClick = await page.evaluate(() => window.__spaceApp.getState().focusId);
    expect(afterClick).not.toBe("cross-04");
    expect(await page.evaluate(() => window.__spaceApp.isVisible("cross-04"))).toBe(false);

    // Keyboard focus can still reach it via the list, with an explicit hidden state.
    await item.click();
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "cross-04");
    await expect(page.locator('[data-testid="inspector-status"]')).toHaveText("已隐藏");
    await expect(page.locator('[data-testid="detail-visibility"]')).toContainText("鼠标不能选中");
    const ringClass = await page.locator("#focus-ring").getAttribute("class");
    expect(ringClass).toContain("is-hidden");

    // Unhide, and mouse picking becomes possible again.
    await page.locator('[data-testid="btn-toggle-hidden"]').click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__spaceApp.isVisible("cross-04"))).toBe(true);
    await page.locator("#object-list").focus();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.mouse.click(canvas!.x + hiddenProjection.x, canvas!.y + hiddenProjection.y);
    await page.waitForFunction(() => window.__spaceApp.getState().focusId !== null);
    expect(await page.evaluate(() => window.__spaceApp.getState().focusId)).toBe("cross-04");
  });

  test("camera focus strategies are configurable and bounded", async ({ page }) => {
    await boot(page);
    await focusById(page, "ring-05");
    const fixedBefore = await page.evaluate(() => window.__spaceApp.getCamera());
    await page.keyboard.press("f");
    await page.waitForTimeout(750);
    const fixedAfter = await page.evaluate(() => window.__spaceApp.getCamera());
    expect(distance(fixedBefore.position!, fixedAfter.position!)).toBeLessThan(0.001);

    await page.selectOption("#camera-strategy", "pan");
    await page.keyboard.press("f");
    await page.waitForTimeout(80);
    const midPan = await page.evaluate(() => window.__spaceApp.getCamera());
    await page.waitForTimeout(900);
    const panAfter = await page.evaluate(() => window.__spaceApp.getCamera());
    expect(distance(fixedAfter.position!, panAfter.position!)).toBeGreaterThan(0.001);
    expect(distance(fixedAfter.position!, panAfter.position!)).toBeLessThan(3.5);
    expect(midPan.moving).toBe(true);

    await page.selectOption("#camera-strategy", "orbit");
    const beforeOrbit = await page.evaluate(() => window.__spaceApp.getCamera());
    await page.keyboard.press("f");
    await page.waitForTimeout(80);
    const midOrbit = await page.evaluate(() => window.__spaceApp.getCamera());
    await page.waitForTimeout(900);
    const orbitAfter = await page.evaluate(() => window.__spaceApp.getCamera());
    expect(midOrbit.moving).toBe(true);
    // Bounded rotation: the view direction changes by no more than 8 degrees.
    const dirBefore = norm(sub(beforeOrbit.position!, beforeOrbit.target!));
    const dirAfter = norm(sub(orbitAfter.position!, orbitAfter.target!));
    const angle = (Math.acos(Math.min(1, dot(dirBefore, dirAfter))) * 180) / Math.PI;
    expect(angle).toBeLessThan(8.5);
    expect(angle).toBeGreaterThan(0);
    // The point itself is not teleported by re-focusing; only the camera moves.
    const projection = await page.evaluate(() => window.__spaceApp.project().find((entry) => entry.id === "ring-05")!);
    expect(projection.onScreen).toBe(true);
  });

  test("the same scene keeps focus, text and highlight aligned across pixel ratios", async ({ browser }) => {
    const results: Array<{
      scale: number;
      focusId: string;
      detail: string;
      highlighted: string[];
      deltaX: number;
      deltaY: number;
      drawnDelta: number;
      drawnPixels: number;
      clickId: string;
    }> = [];

    for (const scale of [1, 1.5, 2]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 820 },
        deviceScaleFactor: scale,
      });
      const page = await context.newPage();
      await boot(page);
      await focusById(page, "echo-04");
      const snapshot = await page.evaluate(() => {
        const ring = window.__spaceApp.focusRingRect()!;
        const focus = window.__spaceApp.getFocusScreen()!;
        const canvasRect = window.__spaceApp.canvasRect()!;
        // Read back the rasterised glow so the check covers the actual drawn
        // point, not only the DOM ring around it.
        const canvas = document.querySelector<HTMLCanvasElement>("#scene-canvas")!;
        const box = canvas.getBoundingClientRect();
        const scaleX = box.width / canvas.width;
        const scaleY = box.height / canvas.height;
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        const context = copy.getContext("2d")!;
        context.drawImage(canvas, 0, 0);
        const cx = Math.round(focus.x / scaleX);
        const cy = Math.round(focus.y / scaleY);
        const radius = Math.round(7 / scaleX);
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const px = cx + dx;
            const py = cy + dy;
            if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
            const [r, g, b] = context.getImageData(px, py, 1, 1).data;
            if (r * 0.299 + g * 0.587 + b * 0.114 > 200) {
              sumX += px;
              sumY += py;
              count += 1;
            }
          }
        }
        const drawn = count > 0 ? { x: (sumX / count) * scaleX, y: (sumY / count) * scaleY } : null;
        return {
          focusId: window.__spaceApp.getState().focusId!,
          detail: document.querySelector('[data-testid="detail-name"]')?.textContent ?? "",
          highlighted: window.__spaceApp.highlightedIds(),
          deltaX: Math.abs(ring.x + ring.width / 2 - (canvasRect.x + focus.x)),
          deltaY: Math.abs(ring.y + ring.height / 2 - (canvasRect.y + focus.y)),
          drawnDelta: drawn ? Math.hypot(drawn.x - focus.x, drawn.y - focus.y) : 99,
          drawnPixels: count,
        };
      });
      const click = await canvasCenter(page, "echo-04");
      await page.mouse.click(click.x, click.y);
      await page.waitForTimeout(200);
      const clickId = await page.evaluate(() => window.__spaceApp.getState().focusId!);
      results.push({ scale, ...snapshot, clickId });
      await context.close();
    }

    for (const result of results) {
      expect(result.focusId).toBe("echo-04");
      expect(result.detail).toBe("叠影-04");
      expect(result.highlighted).toEqual(["echo-04"]);
      expect(result.deltaX).toBeLessThan(1.5);
      expect(result.deltaY).toBeLessThan(1.5);
      expect(result.drawnPixels).toBeGreaterThan(10);
      expect(result.drawnDelta).toBeLessThan(2.5);
      // Nearest-layer picking is independent of device pixel ratio.
      expect(result.clickId).toBe("echo-01");
    }
  });

  test("re-focusing does not change camera on selection; only explicit locate moves it", async ({ page }) => {
    await boot(page);
    await page.selectOption("#camera-strategy", "pan");
    const before = await page.evaluate(() => window.__spaceApp.getCamera());
    await focusById(page, "halo-03");
    await page.locator("#object-list").focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__spaceApp.getCamera());
    expect(distance(before.position!, after.position!)).toBeLessThan(0.001);
    await expect(page.locator('[data-testid="camera-status"]')).toContainText("轻柔平移");
  });
});

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(a: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
