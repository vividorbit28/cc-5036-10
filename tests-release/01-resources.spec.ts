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
      focusInfo(): unknown;
      getCamera(): {
        position: [number, number, number] | null;
        target: [number, number, number] | null;
        moving: boolean;
      };
      objectIds(): string[];
      trajectories(): string[];
      keyboardConfig(): { spatial: { maxConeAngleDeg: number; tieTolerancePx: number } };
      resourceStatus(): Array<{ resource: string; state: string; detail: string }>;
      focusRingRect(): { x: number; y: number; width: number; height: number } | null;
      canvasRect(): { x: number; y: number; width: number; height: number } | null;
    };
  }
}

async function bootRelease(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__spaceApp), { timeout: 15_000 });
  await expect(page.locator('[data-testid="boot-overlay"]')).toBeHidden();
}

test.describe("release package resource lifecycle", () => {
  test("boots from the published package with data, keyboard config and self-hosted fonts ready", async ({
    page,
  }) => {
    await bootRelease(page);

    await expect(page.locator('[data-testid="boot-overlay"]')).toBeHidden();
    await expect(page.locator('[data-testid="fatal-error"]')).toBeHidden();

    const statuses = await page.evaluate(() => window.__spaceApp.resourceStatus());
    const byKey = Object.fromEntries(statuses.map((entry) => [entry.resource, entry]));
    expect(byKey.dataset.state).toBe("ready");
    expect(byKey.keyboard.state).toBe("ready");
    expect(byKey.font.state).toBe("ready");

    // The running viewer is driven by the fetched data sample, not baked-in values.
    expect(await page.evaluate(() => window.__spaceApp.objectIds())).toHaveLength(33);
    expect(await page.evaluate(() => window.__spaceApp.trajectories())).toEqual([
      "alpha",
      "beta",
      "gamma",
      "theta",
    ]);
    const config = await page.evaluate(() => window.__spaceApp.keyboardConfig());
    expect(config.spatial.maxConeAngleDeg).toBe(45);
    expect(config.spatial.tieTolerancePx).toBe(2);

    // The self-hosted font family is actually in use by the rendered document.
    const fontReady = await page.evaluate(async () => document.fonts.check('14px "ExplorerSans"'));
    expect(fontReady).toBe(true);
  });

  test("a missing data sample is a hard failure: no boot, no fake selection, visible error", async ({
    page,
  }) => {
    await page.route("**/data/dataset.json", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/");

    await expect(page.locator('[data-testid="fatal-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="fatal-error-message"]')).toContainText(
      "data/dataset.json",
    );

    // The verification surface must not exist: without data there is no app to
    // report a successful selection against.
    const app = await page.evaluate(() => Boolean(window.__spaceApp));
    expect(app).toBe(false);
    await expect(page.locator('[data-testid="object-list"] li')).toHaveCount(0);
    await expect(page.locator('[data-testid="detail-name"]')).toBeEmpty();
  });

  test("a missing keyboard config blocks boot instead of falling back to default keys", async ({
    page,
  }) => {
    await page.route("**/data/keyboard-nav.json", (route) =>
      route.fulfill({ status: 500, body: "broken" }),
    );
    await page.goto("/");

    await expect(page.locator('[data-testid="fatal-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="fatal-error-message"]')).toContainText(
      "keyboard-nav.json",
    );
    expect(await page.evaluate(() => Boolean(window.__spaceApp))).toBe(false);
  });

  test("a malformed data sample fails validation rather than rendering defaults", async ({ page }) => {
    await page.route("**/data/dataset.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          meta: { title: "t", version: "v", coordinateUnit: "su", disclaimer: "d" },
          camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 42 },
          groups: {},
          objects: [],
          trajectories: [],
        }),
      }),
    );
    await page.goto("/");

    await expect(page.locator('[data-testid="fatal-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="fatal-error-message"]')).toContainText("objects");
    expect(await page.evaluate(() => Boolean(window.__spaceApp))).toBe(false);
  });

  test("a missing font is flagged as an anomaly on the resource panel but does not block the viewer", async ({
    page,
  }) => {
    await page.route("**/fonts/**.woff2", (route) => route.fulfill({ status: 404, body: "" }));
    await bootRelease(page);

    const statuses = await page.evaluate(() => window.__spaceApp.resourceStatus());
    const font = statuses.find((entry) => entry.resource === "font");
    expect(font?.state).toBe("error");
    expect(font?.detail).toContain("字体");

    // Viewer still runs and real selections still work despite the font anomaly.
    await page.locator("#object-list").focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId !== null);
    const focusId = await page.evaluate(() => window.__spaceApp.getState().focusId);
    expect(focusId).toBe("wing-01");
  });
});
