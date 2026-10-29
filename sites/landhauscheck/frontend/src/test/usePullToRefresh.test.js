/**
 * Unit tests for usePullToRefresh hook.
 *
 * The hook installs touchstart / touchmove / touchend listeners and triggers
 * window.location.reload() after a pull distance > 70 px when scrollY === 0.
 *
 * Strategy: spy on document.addEventListener to capture the actual handler
 * functions, then call them directly with plain event-like objects.  This
 * avoids relying on jsdom's incomplete Touch/TouchEvent constructors and the
 * non-redefinable window.location.reload property.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePullToRefresh } from "../hooks/usePullToRefresh.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render the hook while spying on addEventListener, then return helper
 * functions that invoke the captured handlers directly.
 */
function setup({ scrollY = 0 } = {}) {
  Object.defineProperty(window, "scrollY", { value: scrollY, configurable: true, writable: true });

  const handlers = {};
  const addSpy = vi.spyOn(document, "addEventListener").mockImplementation((type, fn) => {
    handlers[type] = fn;
  });
  const removeSpy = vi.spyOn(document, "removeEventListener");

  const { unmount } = renderHook(() => usePullToRefresh());

  /** Simulate a touch event by calling the captured listener. */
  function fire(type, clientY) {
    handlers[type]?.({ touches: [{ clientY }] });
  }

  return { unmount, addSpy, removeSpy, fire, handlers };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

let reloadSpy;

beforeEach(() => {
  // jsdom marks window.location.reload as non-configurable, so vi.spyOn fails.
  // vi.stubGlobal replaces the whole location object, which works reliably.
  reloadSpy = vi.fn();
  vi.stubGlobal("location", { reload: reloadSpy });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.getElementById("ptr-indicator")?.remove();
  document.getElementById("ptr-style")?.remove();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("usePullToRefresh — listener lifecycle", () => {
  it("registers touchstart, touchmove, and touchend on mount", () => {
    const { addSpy } = setup();
    const types = addSpy.mock.calls.map(([type]) => type);
    expect(types).toContain("touchstart");
    expect(types).toContain("touchmove");
    expect(types).toContain("touchend");
  });

  it("removes all three listeners on unmount", () => {
    const { unmount, removeSpy } = setup();
    unmount();
    const types = removeSpy.mock.calls.map(([type]) => type);
    expect(types).toContain("touchstart");
    expect(types).toContain("touchmove");
    expect(types).toContain("touchend");
  });

  it("injects the ptr-style keyframe element on mount", () => {
    // Use real addEventListener so the useEffect body runs fully.
    renderHook(() => usePullToRefresh());
    expect(document.getElementById("ptr-style")).not.toBeNull();
  });
});

describe("usePullToRefresh — pull below threshold", () => {
  it("does NOT call reload when pull distance is 50 px", () => {
    const { fire } = setup();
    fire("touchstart", 100);
    fire("touchmove", 150); // 50 px
    fire("touchend", 150);
    vi.runAllTimers();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("does NOT call reload when pull is exactly 70 px", () => {
    const { fire } = setup();
    fire("touchstart", 0);
    fire("touchmove", 70);
    fire("touchend", 70);
    vi.runAllTimers();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

describe("usePullToRefresh — pull above threshold", () => {
  it("calls reload after 200 ms when pull > 70 px at scrollY === 0", () => {
    const { fire } = setup({ scrollY: 0 });
    fire("touchstart", 0);
    fire("touchmove", 100); // 100 px pull
    fire("touchend", 100);

    vi.advanceTimersByTime(199);
    expect(reloadSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(reloadSpy).toHaveBeenCalledOnce();
  });
});

describe("usePullToRefresh — not eligible when scrolled down", () => {
  it("does NOT call reload when scrollY > 0 at touchstart", () => {
    const { fire } = setup({ scrollY: 50 });
    fire("touchstart", 0);
    fire("touchmove", 200);
    fire("touchend", 200);
    vi.runAllTimers();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

describe("usePullToRefresh — indicator element", () => {
  it("creates the ptr-indicator element when a positive pull is detected", () => {
    const { fire } = setup();
    fire("touchstart", 0);
    fire("touchmove", 40);
    expect(document.getElementById("ptr-indicator")).not.toBeNull();
  });

  it("removes the ptr-indicator on touchend", () => {
    const { fire } = setup();
    fire("touchstart", 0);
    fire("touchmove", 40);
    fire("touchend", 40);
    expect(document.getElementById("ptr-indicator")).toBeNull();
  });
});
