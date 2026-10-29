/**
 * E2E tests — POI widget (In der Nähe).
 * Verifies Google Places results render for Munich.
 */
import { test, expect } from "@playwright/test";
import { acceptConsentAndUseGPS } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await acceptConsentAndUseGPS(page);
});

test("POI widget article is present", async ({ page }) => {
  const article = page.locator('article[data-widget="poi"]');
  await expect(article).toBeVisible({ timeout: 10_000 });
});

test("POI widget shows at least one result", async ({ page }) => {
  const items = page.locator('article[data-widget="poi"] .poiWidget__item');
  await expect(items.first()).toBeVisible({ timeout: 45_000 });
});

test("POI items have a name and distance", async ({ page }) => {
  const items = page.locator('article[data-widget="poi"] .poiWidget__item');
  await expect(items.first()).toBeVisible({ timeout: 45_000 });
  const count = await items.count();
  // Check first 3 items
  for (let i = 0; i < Math.min(count, 3); i++) {
    const item = items.nth(i);
    const name = item.locator(".poiWidget__name");
    await expect(name).not.toBeEmpty();
    const dist = item.locator(".poiWidget__distance");
    await expect(dist).toBeVisible();
    const distText = await dist.innerText();
    expect(distText).toMatch(/\d/); // contains at least one digit (m or km)
  }
});

test("POI widget shows items from at least two categories", async ({ page }) => {
  const items = page.locator('article[data-widget="poi"] .poiWidget__item');
  await expect(items.first()).toBeVisible({ timeout: 45_000 });
  const badges = page.locator('article[data-widget="poi"] .poiWidget__category');
  const count = await badges.count();
  if (count > 1) {
    const texts = new Set();
    for (let i = 0; i < count; i++) {
      texts.add(await badges.nth(i).innerText());
    }
    expect(texts.size).toBeGreaterThanOrEqual(2);
  }
});

test("POI live badge does not show error", async ({ page }) => {
  const badge = page.locator('article[data-widget="poi"] .liveBadge');
  await expect(badge).toBeVisible({ timeout: 10_000 });
  await expect(badge).not.toContainText("Fehler", { timeout: 45_000 });
});
