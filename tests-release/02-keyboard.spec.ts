import { test, expect, type Page } from "@playwright/test";

async function bootRelease(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__spaceApp));
  await expect(page.locator('[data-testid="boot-overlay"]')).toBeHidden();
}

test.describe("keyboard traversal and selected identity on the release package", () => {
  test("measured focus order follows the rendered list and identity stays stable across re-sort", async ({
    page,
  }) => {
    await bootRelease(page);
    await page.locator("#object-list").focus();

    // Measure the full focus order with real key presses; each step must match
    // the rendered row order and expose the same stable identity everywhere.
    await page.keyboard.press("Home");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId !== null);

    const renderedOrder = await page.evaluate(() =>
      [...document.querySelectorAll(".object-item")].map((item) =>
        item.getAttribute("data-object-id"),
      ),
    );
    const measuredOrder: string[] = [];
    for (let index = 0; index < renderedOrder.length; index += 1) {
      const focusId = await page.evaluate(() => window.__spaceApp.getState().focusId);
      const activeRow = await page.evaluate(
        () => document.querySelector('[aria-selected="true"]')?.getAttribute("data-object-id"),
      );
      const highlighted = await page.evaluate(() => window.__spaceApp.highlightedIds());
      expect(focusId).toBe(renderedOrder[index]);
      expect(activeRow).toBe(renderedOrder[index]);
      expect(highlighted).toEqual([renderedOrder[index]]);
      measuredOrder.push(focusId!);
      if (index < renderedOrder.length - 1) await page.keyboard.press("ArrowDown");
    }
    expect(measuredOrder).toEqual(renderedOrder);

    // Backward traversal reverses the same measured order.
    const reverseMeasured: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      reverseMeasured.push((await page.evaluate(() => window.__spaceApp.getState().focusId))!);
      await page.keyboard.press("ArrowUp");
    }
    expect(reverseMeasured).toEqual(renderedOrder.slice(-3).reverse());

    // Re-sort changes traversal order but never the focused stable identity.
    const focusedBefore = await page.evaluate(() => window.__spaceApp.getState().focusId);
    await page.selectOption("#sort-mode", "name");
    await page.click("#btn-reverse-sort");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__spaceApp.getState().focusId)).toBe(focusedBefore);
    expect(await page.evaluate(() => window.__spaceApp.highlightedIds())).toEqual([focusedBefore]);
  });

  test("spatial key presses pick the configured-cone neighbour and the live region names the identity", async ({
    page,
  }) => {
    await bootRelease(page);
    await page.selectOption("#nav-mode", "spatial");
    await page.locator("#object-list").focus();

    await page.keyboard.press("ArrowUp");
    const firstId = await page.waitForFunction(() =>
      window.__spaceApp.getState().focusId,
    ).then((handle) => handle.jsonValue() as Promise<string>);
    expect(firstId).not.toBeNull();

    const expectation = await page.evaluate((fromId) => {
      const maxAngle = window.__spaceApp.keyboardConfig().spatial.maxConeAngleDeg;
      const projections = window.__spaceApp
        .project()
        .filter((entry) => entry.onScreen && !entry.hidden);
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
        .filter((entry) => entry.dist >= 1 && entry.angle <= maxAngle)
        .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));
      return candidates[0]?.id ?? fromId;
    }, firstId);

    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(200);
    const nextId = await page.evaluate(() => window.__spaceApp.getState().focusId);
    expect(nextId).toBe(expectation);

    // The selection evidence names the real focused identity out loud.
    const live = await page.locator('[data-testid="live-region"]').textContent();
    expect(live).toContain(nextId);
    expect(await page.evaluate(() => window.__spaceApp.highlightedIds())).toEqual([nextId]);
    await expect(page.locator('[data-testid="detail-id"]')).toHaveText(nextId);
  });

  test("selection cannot report success for an identity absent from the loaded data", async ({
    page,
  }) => {
    await bootRelease(page);
    const unknownId = "ghost-99";
    const known = await page.evaluate((id) => window.__spaceApp.objectIds().includes(id), unknownId);
    expect(known).toBe(false);
    // No rendered row carries the unknown identity, so it can never be selected.
    expect(await page.locator(`[data-testid="object-item-${unknownId}"]`)).toHaveCount(0);

    await page.locator("#object-list").focus();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId !== null);
    const focusId = await page.evaluate(() => window.__spaceApp.getState().focusId);
    expect(focusId).not.toBe(unknownId);
    expect(await page.evaluate(() => window.__spaceApp.objectIds())).toContain(focusId);
  });

  test("tab order reaches every interactive control without a keyboard trap", async ({ page }) => {
    await bootRelease(page);
    const controls = [
      '[data-testid="nav-mode"]',
      '[data-testid="camera-strategy"]',
      '[data-testid="include-hidden"]',
      '[data-testid="btn-reset"]',
      '[data-testid="viewport"]',
      '[data-testid="sort-mode"]',
      '[data-testid="btn-reverse-sort"]',
      '[data-testid="object-list"]',
    ];
    await page.keyboard.press("Tab");
    for (const selector of controls) {
      await page.locator(selector).focus();
      await expect(page.locator(selector)).toBeFocused();
    }
    // Moving focus into the viewport and pressing arrows changes real state.
    await page.locator('[data-testid="viewport"]').focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => window.__spaceApp.getState().focusId !== null);
  });
});
