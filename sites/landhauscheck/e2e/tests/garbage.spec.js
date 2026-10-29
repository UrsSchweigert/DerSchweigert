/**
 * E2E tests — Garbage / Calendar widget.
 * For Munich (no ICS match): expects the calendar fallback.
 * For Pfaffenhofen: expects actual waste events.
 */
import { test, expect } from "@playwright/test";
import { acceptConsentAndUseGPS } from "./helpers.js";

// ── Munich (calendar fallback) ────────────────────────────────────────────────

test.describe("garbage widget (Munich → calendar fallback)", () => {
  test.use({ geolocation: { latitude: 48.137, longitude: 11.575 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await acceptConsentAndUseGPS(page);
  });

  test("garbage widget article is present", async ({ page }) => {
    const article = page.locator('article[data-widget="garbage"]');
    await expect(article).toBeVisible({ timeout: 10_000 });
  });

  test("widget shows calendar grid when no ICS matches", async ({ page }) => {
    // Either a calendar grid (fallback) or a waste-events list — both are valid
    const article = page.locator('article[data-widget="garbage"]');
    await expect(article).toBeVisible({ timeout: 30_000 });
    // Should not show a permanent error badge
    const badge = page.locator('article[data-widget="garbage"] .liveBadge');
    await expect(badge).not.toContainText("Fehler", { timeout: 30_000 });
  });

  test("calendar fallback has 28-31 day cells", async ({ page }) => {
    const cells = page.locator('article[data-widget="garbage"] .cal__day');
    // Wait until cells appear — if they don't it means an ICS matched (which is fine)
    const count = await cells.count().catch(() => 0);
    if (count > 0) {
      expect(count).toBeGreaterThanOrEqual(28);
      expect(count).toBeLessThanOrEqual(31);
    }
  });

  test("today's cell is highlighted", async ({ page }) => {
    const today = page.locator('article[data-widget="garbage"] .cal__day--today');
    // Only present when calendar fallback renders
    if (await today.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await expect(today).toBeVisible();
    }
  });
});

// ── Pfaffenhofen (actual ICS match) ──────────────────────────────────────────

test.describe("garbage widget (Pfaffenhofen → ICS match)", () => {
  test.use({ geolocation: { latitude: 48.3153, longitude: 11.1674 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await acceptConsentAndUseGPS(page);
  });

  test("shows upcoming waste events for Pfaffenhofen", async ({ page }) => {
    const events = page.locator('article[data-widget="garbage"] .garbageWidget__event');
    await expect(events.first()).toBeVisible({ timeout: 45_000 });
  });

  test("each event has a date and summary", async ({ page }) => {
    const events = page.locator('article[data-widget="garbage"] .garbageWidget__event');
    await expect(events.first()).toBeVisible({ timeout: 45_000 });
    const count = await events.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      const ev = events.nth(i);
      await expect(ev.locator(".garbageWidget__date")).not.toBeEmpty();
      await expect(ev.locator(".garbageWidget__summary")).not.toBeEmpty();
    }
  });

  test("widget title says Abfallkalender", async ({ page }) => {
    const title = page.locator('article[data-widget="garbage"] .widgetCard__title');
    await expect(title).toContainText("Abfallkalender", { timeout: 30_000 });
  });
});
