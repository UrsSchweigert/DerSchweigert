import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function apiBase({ dev = false, origin, override = "" }) {
  vi.resetModules();
  vi.stubEnv("DEV", dev);
  vi.stubEnv("VITE_API_BASE_URL", override);
  vi.stubGlobal("window", { location: { origin } });
  return (await import("../config/api")).API_BASE_URL;
}

describe("API origin", () => {
  it.each([
    "https://landhauscheck.com",
    "https://www.landhauscheck.com",
    "https://dev.landhauscheck.com",
    "https://example.cloudfront.net",
  ])("keeps every production URL on %s even with a stale build override", async (origin) => {
    const base = await apiBase({ origin, override: "http://localhost:8000" });
    expect(base).toBe(origin);
    for (const path of [
      "/health", "/api/v1/weather/forecast", "/api/v1/waste/upcoming",
      "/api/v1/transit/nearby", "/api/v1/transit/rail-nearby",
      "/api/v1/transit/poi-nearby", "/api/v1/logs",
      "/api/v1/notifications/manifest", "/api/v1/waste/calendar.ics",
    ]) {
      expect(new URL(`${base}${path}`).origin).toBe(origin);
    }
  });

  it("uses the local backend during development by default", async () => {
    expect(await apiBase({ dev: true, origin: "http://localhost:5173" })).toBe("http://localhost:8000");
  });

  it("preserves explicit development backend overrides without trailing slashes", async () => {
    expect(await apiBase({
      dev: true, origin: "http://localhost:5173", override: "http://192.168.1.10:8000/",
    })).toBe("http://192.168.1.10:8000");
  });
});
