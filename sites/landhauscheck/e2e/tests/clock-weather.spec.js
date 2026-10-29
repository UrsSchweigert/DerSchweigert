/**
 * E2E tests — Clock & Weather widget.
 * Verifies: time renders, 5 weather tiles present, moon phase shown.
 */
import { test, expect } from "@playwright/test";
import { acceptConsentAndUseGPS } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await acceptConsentAndUseGPS(page);
});

test("clock shows a valid HH:MM time", async ({ page }) => {
  const time = page.locator(".clockWidget__time");
  await expect(time).toBeVisible({ timeout: 10_000 });
  const text = await time.innerText();
  expect(text).toMatch(/^\d{1,2}:\d{2}/);
});

test("clock shows today's date", async ({ page }) => {
  const date = page.locator(".clockWidget__date");
  await expect(date).toBeVisible({ timeout: 10_000 });
  const text = await date.innerText();
  // Should contain at least a month name
  expect(text.length).toBeGreaterThan(5);
});

test("weather strip shows exactly 5 tiles", async ({ page }) => {
  const tiles = page.locator(".weatherTile");
  await expect(tiles).toHaveCount(5, { timeout: 20_000 });
});

test("each weather tile has a temperature", async ({ page }) => {
  const tiles = page.locator(".weatherTile");
  await expect(tiles).toHaveCount(5, { timeout: 20_000 });
  for (const tile of await tiles.all()) {
    const temp = await tile.locator(".weatherTile__temp").innerText();
    expect(temp).toMatch(/−?\d+°/);
  }
});

test("each weather tile has a rain probability", async ({ page }) => {
  const tiles = page.locator(".weatherTile");
  await expect(tiles).toHaveCount(5, { timeout: 20_000 });
  for (const tile of await tiles.all()) {
    const rain = await tile.locator(".weatherTile__rain").innerText();
    expect(rain).toMatch(/\d+%/);
  }
});

test("moon phase emoji is displayed next to date", async ({ page }) => {
  const moon = page.locator(".clockWidget__moon");
  await expect(moon).toBeVisible({ timeout: 20_000 });
});

test("live badge shows live or update countdown", async ({ page }) => {
  const badge = page.locator('article[data-widget="clock"] .liveBadge');
  await expect(badge).toBeVisible({ timeout: 10_000 });
  const text = await badge.innerText();
  expect(text).toMatch(/live|Update in/i);
});
