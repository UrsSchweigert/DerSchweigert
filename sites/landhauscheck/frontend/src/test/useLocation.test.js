/**
 * Unit tests for useLocation hook.
 *
 * The hook gates its behaviour on localStorage and the browser Geolocation API,
 * both of which are faked here without any network calls.
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "../hooks/useLocation.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockGeolocation({ success = true, lat = 48.137, lng = 11.575, error = null } = {}) {
  const getCurrentPosition = vi.fn((onSuccess, onError) => {
    if (success) {
      onSuccess({ coords: { latitude: lat, longitude: lng, accuracy: 10 } });
    } else {
      onError(error ?? { code: 1, message: "denied" });
    }
  });
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition, watchPosition: vi.fn(() => 0), clearWatch: vi.fn() },
    writable: true,
    configurable: true,
  });
  return { getCurrentPosition };
}

beforeEach(() => {
  localStorage.clear();
  // Silence the BigDataCloud reverse-geocode fetch — not the focus of these tests.
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ countryCode: "DE", principalSubdivisionCode: "DE-BY" }) })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useLocation — initial state without consent", () => {
  it("opens the location picker when no consent cookie is set", () => {
    // No localStorage.lhc_consent → picker should open
    const { result } = renderHook(() => useLocation());
    expect(result.current.locationPickerOpen).toBe(true);
  });

  it("location is null on first render", () => {
    const { result } = renderHook(() => useLocation());
    expect(result.current.location).toBeNull();
  });

  it("geoPermState starts as 'unknown'", () => {
    const { result } = renderHook(() => useLocation());
    expect(result.current.geoPermState).toBe("unknown");
  });
});

describe("useLocation — GPS granted with consent", () => {
  it("calls GPS and sets location when consent is stored", async () => {
    localStorage.setItem("lhc_consent", "1");
    mockGeolocation({ lat: 48.137, lng: 11.575 });

    const { result } = renderHook(() => useLocation());

    await act(async () => {});

    expect(result.current.location).toEqual({ lat: 48.137, lng: 11.575 });
    expect(result.current.locationSource).toBe("gps");
    expect(result.current.geoPermState).toBe("granted");
    expect(result.current.locationPickerOpen).toBe(false);
  });

  it("sets locationAccuracy from coords.accuracy", async () => {
    localStorage.setItem("lhc_consent", "1");
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: 1, longitude: 2, accuracy: 42 } })),
        watchPosition: vi.fn(() => 0),
        clearWatch: vi.fn(),
      },
      writable: true, configurable: true,
    });

    const { result } = renderHook(() => useLocation());
    await act(async () => {});

    expect(result.current.locationAccuracy).toBe(42);
  });
});

describe("useLocation — GPS denied", () => {
  it("sets geoPermState to 'denied' and opens picker on error code 1", async () => {
    localStorage.setItem("lhc_consent", "1");
    mockGeolocation({ success: false, error: { code: 1 } });

    const { result } = renderHook(() => useLocation());
    await act(async () => {});

    expect(result.current.geoPermState).toBe("denied");
    expect(result.current.locationDenied).toBe(true);
    expect(result.current.locationPickerOpen).toBe(true);
  });

  it("sets geoPermState to 'unavailable' on non-permission errors", async () => {
    localStorage.setItem("lhc_consent", "1");
    mockGeolocation({ success: false, error: { code: 2 } });

    const { result } = renderHook(() => useLocation());
    await act(async () => {});

    expect(result.current.geoPermState).toBe("unavailable");
  });
});

describe("useLocation — geolocation not supported", () => {
  it("sets geoPermState to 'unsupported' when navigator.geolocation is absent", async () => {
    localStorage.setItem("lhc_consent", "1");
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useLocation());
    await act(async () => {});

    expect(result.current.geoPermState).toBe("unsupported");
    expect(result.current.locationPickerOpen).toBe(true);
  });
});

describe("useLocation — handleManualLocation", () => {
  it("sets location and source to 'manual'", async () => {
    const { result } = renderHook(() => useLocation());

    await act(async () => {
      result.current.handleManualLocation({ lat: 48.0, lng: 11.0 });
    });

    expect(result.current.location).toEqual({ lat: 48.0, lng: 11.0 });
    expect(result.current.locationSource).toBe("manual");
    expect(result.current.locationPickerOpen).toBe(false);
  });

  it("applies countryCode from geocode result immediately", async () => {
    // The reverse-geocode fetch must also echo "FR" so its async resolution
    // doesn't overwrite the value that handleManualLocation applied synchronously.
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ countryCode: "FR", principalSubdivisionCode: "FR-75" }) })
    );
    const { result } = renderHook(() => useLocation());

    await act(async () => {
      result.current.handleManualLocation({ lat: 48.0, lng: 11.0, countryCode: "FR" });
    });

    expect(result.current.geoInfo.countryCode).toBe("FR");
  });

  it("sets locationAccuracy to null for manual location", async () => {
    const { result } = renderHook(() => useLocation());

    await act(async () => {
      result.current.handleManualLocation({ lat: 1, lng: 2 });
    });

    expect(result.current.locationAccuracy).toBeNull();
  });
});
