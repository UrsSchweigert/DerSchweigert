import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticFetch, diagnosticUrl } from "../networkDiagnostics";
import { useAppConsole } from "../hooks/useAppConsole";
import { useHealth } from "../hooks/useHealth";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("network diagnostics", () => {
  it("preserves successful responses, request arguments and response bodies", async () => {
    const { result } = renderHook(() => useAppConsole());
    const response = new Response('{"status":"ok"}');
    fetch.mockResolvedValue(response);
    const init = { headers: { Accept: "application/json" } };

    expect(await diagnosticFetch("/health", init)).toBe(response);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/health", init);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(result.current.consoleLogs).toHaveLength(1);
  });

  it("records HTTP failures without converting them into rejected fetches", async () => {
    const { result } = renderHook(() => useAppConsole());
    const response = new Response("unavailable", { status: 503, statusText: "Service Unavailable" });
    fetch.mockResolvedValue(response);

    await act(async () => {
      expect(await diagnosticFetch("/api/v1/weather?lat=48&token=secret")).toBe(response);
    });

    const message = result.current.consoleLogs.at(-1).message;
    expect(message).toContain("GET http://localhost:3000/api/v1/weather");
    expect(message).toContain("same-origin");
    expect(message).toContain("HTTP 503 Service Unavailable");
    expect(message).not.toContain("secret");
    expect(await response.text()).toBe("unavailable");
  });

  it("records endpoint and honest uncertainty while preserving the original rejection", async () => {
    const { result } = renderHook(() => useAppConsole());
    const error = new TypeError("Failed to fetch");
    fetch.mockRejectedValue(error);
    const request = new Request("https://landhauscheck.com/api/v1/waste?lat=48", { method: "POST" });

    await act(async () => {
      await expect(diagnosticFetch(request)).rejects.toBe(error);
    });

    const message = result.current.consoleLogs.at(-1).message;
    expect(message).toContain("POST https://landhauscheck.com/api/v1/waste");
    expect(message).toMatch(/\d+ ms; cross-origin; browser online/);
    expect(message).toContain("TypeError: Failed to fetch");
    expect(message).toContain("does not expose the exact cause");
    expect(message).not.toContain("?lat");
  });

  it.each([
    ["AbortError", "Request cancelled."],
    ["TimeoutError", "Request timed out."],
  ])("distinguishes %s", async (name, detail) => {
    const { result } = renderHook(() => useAppConsole());
    const error = new DOMException("Request stopped", name);
    fetch.mockRejectedValue(error);

    await act(async () => {
      await expect(diagnosticFetch("/health")).rejects.toBe(error);
    });

    expect(result.current.consoleLogs.at(-1).message).toContain(detail);
  });

  it("reports the browser's offline state without claiming server failure", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useAppConsole());
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await act(async () => {
      await expect(diagnosticFetch("/health")).rejects.toThrow("Failed to fetch");
    });

    expect(result.current.consoleLogs.at(-1).message).toContain("browser offline");
    expect(result.current.consoleLogs.at(-1).message).toContain("Browser reports no network connection");
  });

  it.each(["enforce", "report"])("captures %s CSP violations and removes sensitive URL parts", (disposition) => {
    const { result } = renderHook(() => useAppConsole());
    const event = new Event("securitypolicyviolation", { bubbles: true });
    Object.assign(event, {
      blockedURI: "https://user:password@landhauscheck.com/api/v1/weather?lat=48#secret",
      effectiveDirective: "connect-src",
      disposition,
    });

    act(() => document.dispatchEvent(event));

    const message = result.current.consoleLogs.at(-1).message;
    expect(message).toContain(disposition === "enforce" ? "CSP BLOCKED" : "CSP report only");
    expect(message).toContain("connect-src; target https://landhauscheck.com/api/v1/weather");
    expect(message).toContain(`Page origin: ${window.location.origin}`);
    expect(message).not.toMatch(/password|secret|lat=48/);
  });

  it("keeps only 100 events and removes listeners on unmount", () => {
    const { result, unmount } = renderHook(() => useAppConsole());
    act(() => {
      for (let i = 0; i < 110; i++) result.current.addLog(`event ${i}`);
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.consoleLogs).toHaveLength(100);
    expect(result.current.consoleLogs.at(-2).message).toContain("offline");
    expect(result.current.consoleLogs.at(-1).message).toContain("online");

    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeDocument = vi.spyOn(document, "removeEventListener");
    unmount();
    expect(removeWindow).toHaveBeenCalledWith("lhc-network-diagnostic", expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith("securitypolicyviolation", expect.any(Function));
  });

  it("captures initial health failures even before the console overlay is opened", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => {
      const health = useHealth("https://landhauscheck.com");
      const console = useAppConsole();
      return { ...health, ...console };
    });
    await act(async () => {});
    expect(result.current.healthState.status).toBe("error");
    expect(result.current.consoleLogs.at(-1).message).toContain("GET https://landhauscheck.com/health");
  });

  it("redacts query, fragment, credentials and data/blob payloads", () => {
    expect(diagnosticUrl("https://user:pass@example.com/api?key=secret#fragment")).toBe("https://example.com/api");
    expect(diagnosticUrl("data:text/plain,secret")).toBe("data:");
    expect(diagnosticUrl("blob:https://example.com/private")).toBe("blob:");
  });
});
