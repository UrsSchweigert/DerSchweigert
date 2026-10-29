/**
 * Shared helpers for Landhauscheck E2E tests.
 *
 * Every test starts from the main page with geolocation already granted
 * (Munich 48.137, 11.575) so the location picker is bypassed and
 * widgets start loading immediately.
 */
import { expect } from "@playwright/test";

/**
 * Wait for the consent checkbox to appear + accept it, then click
 * the "Standort automatisch ermitteln" button so GPS kicks in and
 * widgets load. Falls back gracefully if consent was already given
 * (e.g. localStorage was seeded by a previous test).
 */
export async function acceptConsentAndUseGPS(page) {
  // If the consent modal is visible, tick it and confirm
  const consentBox = page.locator('input[type="checkbox"]').first();
  if (await consentBox.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await consentBox.check();
    // Click "Standort automatisch ermitteln"
    const gpsBtn = page.getByRole("button", { name: /Standort automatisch/i });
    if (await gpsBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await gpsBtn.click();
    }
  }
}

/**
 * Wait until a LiveBadge for a widget transitions to the "live" or
 * "Update in" state (meaning the widget has received data successfully).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} widgetDataAttr - value of data-widget attribute on the article
 * @param {number} timeoutMs
 */
export async function waitForWidgetLive(page, widgetDataAttr, timeoutMs = 45_000) {
  const badge = page.locator(`article[data-widget="${widgetDataAttr}"] .liveBadge`);
  await expect(badge).not.toContainText("lädt", { timeout: timeoutMs });
  await expect(badge).not.toContainText("Fehler", { timeout: 1_000 });
}
