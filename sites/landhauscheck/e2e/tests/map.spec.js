/**
 * E2E tests — Google Maps / Traffic widget.
 * Verifies the map iframe/canvas loads and the live badge goes green.
 */
import { test, expect } from "@playwright/test";
import { acceptConsentAndUseGPS } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await acceptConsentAndUseGPS(page);
});

test("map widget article is present in the DOM", async ({ page }) => {
  const mapArticle = page.locator('article[data-widget="map"]');
  await expect(mapArticle).toBeVisible({ timeout: 10_000 });
});

test("map widget renders a Google Maps canvas or div", async ({ page }) => {
  // Google Maps injects a div with class 'gm-style' when loaded
  const gmStyle = page.locator(".gm-style").first();
  await expect(gmStyle).toBeVisible({ timeout: 30_000 });
});

test("map live badge does not show error", async ({ page }) => {
  const badge = page.locator('article[data-widget="map"] .liveBadge');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).not.toContainText("Fehler");
});
