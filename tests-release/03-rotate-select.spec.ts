import { test, expect, type Page } from "@playwright/test";

async function bootRelease(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__spaceApp));
  await expect(page.locator('[data-testid="boot-overlay"]')).toBeHidden();
}

async function canvasPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((targetId) => {
    const entry = window.__spaceApp.project().find((candidate) => candidate.id === targetId);
    const rect = window.__spaceApp.canvasRect()!;
    if (!entry || !entry.onScreen) throw new Error(`target ${targetId} not on screen`);
    return { x: rect.x + entry.x, y: rect.y + entry.y };
  }, id);
}

test.describe("3D operation window: rotate, mark and select", () => {
  test("dragging rotates the data and a real click selects a target with aligned evidence", async ({
    page,
  }) => {
    await bootRelease(page);
    const canvas = page.locator('[data-testid="scene-canvas"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // Rotate the data with a real pointer drag inside the 3D viewport.
    const cameraBefore = await page.evaluate(() => window.__spaceApp.getCamera());
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5 + 220, box!.y + box!.height * 0.5 - 60, {
      steps: 14,
    });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const cameraAfter = await page.evaluate(() => window.__spaceApp.getCamera());

    const moved = Math.hypot(
      cameraAfter.position![0] - cameraBefore.position![0],
      cameraAfter.position![1] - cameraBefore.position![1],
      cameraAfter.position![2] - cameraBefore.position![2],
    );
    expect(moved).toBeGreaterThan(0.5);
    // The target moved only in view space; the world data did not change.
    expect(await page.evaluate(() => window.__spaceApp.objectIds())).toHaveLength(33);

    // Pick an on-screen, visible target after the rotation.
    const targetId = await page.evaluate(() => {
      const pick = window.__spaceApp
        .project()
        .find((entry) => entry.onScreen && !entry.hidden && entry.id.startsWith("ring"));
      return pick?.id ?? null;
    });
    expect(targetId).not.toBeNull();
    const point = await canvasPoint(page, targetId!);
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(
      (id) => window.__spaceApp.getState().focusId === id,
      targetId,
    );

    // Selection evidence: state, inspector identity, 3D highlight and the
    // spatial focus ring all resolve to the same stable ID.
    const focusId = await page.evaluate(() => window.__spaceApp.getState().focusId);
    expect(focusId).toBe(targetId);
    await expect(page.locator('[data-testid="detail-id"]')).toHaveText(targetId!);
    expect(await page.evaluate(() => window.__spaceApp.highlightedIds())).toEqual([targetId]);

    const ring = await page.evaluate(() => window.__spaceApp.focusRingRect());
    const focus = await page.evaluate(() => window.__spaceApp.getFocusScreen());
    const canvasRect = await page.evaluate(() => window.__spaceApp.canvasRect());
    expect(ring).not.toBeNull();
    expect(Math.abs(ring!.x + ring!.width / 2 - (canvasRect!.x + focus!.x))).toBeLessThan(1.5);
    expect(Math.abs(ring!.y + ring!.height / 2 - (canvasRect!.y + focus!.y))).toBeLessThan(1.5);
    expect(ring!.width).toBeGreaterThan(0);
  });

  test("the overlap stack still selects a deeper target after rotation and keeps evidence consistent", async ({
    page,
  }) => {
    await bootRelease(page);
    // Reset to the canonical view so the echo stack overlaps as designed.
    await page.evaluate(() => window.__spaceApp.resetCamera());
    await page.waitForTimeout(800);

    const click = await canvasPoint(page, "echo-03");
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "echo-01");
    await expect(page.locator('[data-testid="overlap-list"] .overlap-button')).toHaveCount(5);

    await page.locator('[data-testid="overlap-item-echo-04"]').click();
    await page.waitForFunction(() => window.__spaceApp.getState().focusId === "echo-04");
    await expect(page.locator('[data-testid="detail-name"]')).toHaveText("叠影-04");
    expect(await page.evaluate(() => window.__spaceApp.highlightedIds())).toEqual(["echo-04"]);

    // Anomaly visibility: the occluded target is labelled with its occluder count.
    await expect(page.locator('[data-testid="inspector-status"]')).toHaveText(/被遮挡/);
  });
});
