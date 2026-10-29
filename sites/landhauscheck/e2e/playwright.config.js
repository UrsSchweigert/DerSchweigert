import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Grant geolocation permission and use Munich as the default location
    // so widgets always have a location without needing to interact with the picker.
    geolocation: { latitude: 48.137, longitude: 11.575 },
    permissions: ["geolocation"],
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    // Reduce flakiness on CI
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
