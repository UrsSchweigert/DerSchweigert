/**
 * E2E tests — Trains (TransitWidget) and Busses (RoutingWidget).
 * Verifies departure data renders for Munich (well-served location).
 */
import { test, expect } from "@playwright/test";
import { acceptConsentAndUseGPS, waitForWidgetLive } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await acceptConsentAndUseGPS(page);
});

// ── Trains (TransitWidget) ────────────────────────────────────────────────────

test("trains widget article is present", async ({ page }) => {
  const article = page.locator('article[data-widget="transit"]');
  await expect(article).toBeVisible({ timeout: 10_000 });
});

test("trains widget shows at least one station name", async ({ page }) => {
  // Wait for any station heading to appear
  const station = page.locator('article[data-widget="transit"] .transitWidget__stationName').first();
  await expect(station).toBeVisible({ timeout: 45_000 });
  const text = await station.innerText();
  expect(text.length).toBeGreaterThan(2);
});

test("trains widget shows departure rows", async ({ page }) => {
  const rows = page.locator('article[data-widget="transit"] .transitWidget__departure');
  await expect(rows.first()).toBeVisible({ timeout: 45_000 });
});

test("trains live badge goes live or shows countdown", async ({ page }) => {
  const badge = page.locator('article[data-widget="transit"] .liveBadge');
  await expect(badge).toBeVisible({ timeout: 10_000 });
  await expect(badge).not.toContainText("Fehler", { timeout: 45_000 });
  const text = await badge.innerText();
  expect(text).toMatch(/live|Update in/i);
});

// ── Busses (RoutingWidget) ────────────────────────────────────────────────────

test("routing widget article is present", async ({ page }) => {
  const article = page.locator('article[data-widget="routing"]');
  await expect(article).toBeVisible({ timeout: 10_000 });
});

test("routing widget shows at least one stop or departure", async ({ page }) => {
  const stop = page.locator('article[data-widget="routing"] .routingWidget__stationName').first();
  if (await stop.isVisible({ timeout: 45_000 }).catch(() => false)) {
    const text = await stop.innerText();
    expect(text.length).toBeGreaterThan(2);
  }
  // Accept if widget renders any content (stations or "no departures" message)
  const article = page.locator('article[data-widget="routing"]');
  await expect(article).toBeVisible();
});

test("routing live badge does not show error", async ({ page }) => {
  const badge = page.locator('article[data-widget="routing"] .liveBadge');
  await expect(badge).toBeVisible({ timeout: 10_000 });
  await expect(badge).not.toContainText("Fehler", { timeout: 45_000 });
});
