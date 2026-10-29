/**
 * usePushNotifications
 *
 * Manages browser notification permission, service-worker registration, and
 * client-side scheduling of waste-collection reminders at 17:00 and 20:00.
 *
 * Architecture — why this minimises Lambda invocations
 * ─────────────────────────────────────────────────────
 *  The server publishes a single /api/v1/notifications/manifest endpoint that
 *  CloudFront caches for one hour, shared by all clients.  At most one Lambda
 *  invocation fires per hour (cache miss) regardless of how many users have
 *  notifications enabled.  There are no server-side push subscriptions, no
 *  VAPID keys, and no per-user scheduled jobs — all timing logic lives here.
 *
 * When the page is open (all browsers / platforms):
 *   setTimeout fires at the next 17:00 and 20:00 local time.  The hook
 *   fetches the manifest, then passes it to the SW via postMessage so the
 *   SW can run the location match and call showNotification() from SW context
 *   (required on mobile for persistent notifications).
 *
 * When the page is closed (Chrome / Android only):
 *   Periodic Background Sync wakes the SW roughly once per 12 h.  The SW
 *   fetches the manifest itself and shows a notification if appropriate.
 *
 * On iOS the PWA must be added to the Home Screen for any background
 * behaviour; in-page notifications work in foreground for all iOS PWA users.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL as API_BASE } from "../config/api";

// Target hours for notification checks (local time).
const NOTIFY_SLOTS = [
  { hour: 17, key: "17h" },
  { hour: 20, key: "20h" },
];

/** Milliseconds until the next occurrence of `hour`:00:00 local time. */
function msUntilHour(hour) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

/**
 * @param {{ lat: number, lng: number } | null} location  User location from useLocation.
 * @param {string} lang  Active UI language ("de" | "en" | "pt").
 */
export function usePushNotifications(location, lang = "de") {
  const [permState, setPermState] = useState(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  });
  const [swReady, setSwReady] = useState(false);
  const timersRef = useRef([]);

  // ── Calendar-export duplicate guard ───────────────────────────────────────
  // Key is rounded to 3 decimal places (~110 m precision) so a minor GPS
  // jitter between sessions does not repeatedly offer the export.
  function _calKey(loc) {
    return `lhc_cal_${Math.round(loc.lat * 1000)}_${Math.round(loc.lng * 1000)}`;
  }
  const [calExported, setCalExported] = useState(false);
  useEffect(() => {
    if (!location) return;
    setCalExported(!!localStorage.getItem(_calKey(location)));
  }, [location]);

  // ── Register service worker ────────────────────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => setSwReady(true))
      .catch(() => {
        // SW registration failed — notifications unavailable, degrade silently.
      });
  }, []);

  // ── Keep SW informed of the current location + language ───────────────────
  useEffect(() => {
    if (!swReady || !location) return;
    navigator.serviceWorker.ready.then((reg) => {
      reg.active?.postMessage({ type: "SET_LOCATION", location, lang });
    });
  }, [swReady, location, lang]);

  // ── Schedule in-page notification checks via setTimeout ───────────────────
  useEffect(() => {
    if (!swReady || permState !== "granted" || !location) return;

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    NOTIFY_SLOTS.forEach(({ hour, key }) => {
      const schedule = () => {
        const delay = msUntilHour(hour);
        const id = setTimeout(async () => {
          try {
            // Fetch the shared manifest (CloudFront-cached, 1 h TTL).
            // Passing it to the SW avoids a duplicate network request from
            // the SW context, keeping Lambda invocations at O(1) per hour.
            const r = await fetch(`${API_BASE}/api/v1/notifications/manifest`);
            if (!r.ok) return;
            const manifest = await r.json();
            const reg = await navigator.serviceWorker.ready;
            reg.active?.postMessage({ type: "NOTIFY_CHECK", slot: key, manifest });
          } catch {
            // Network unavailable — skip this notification cycle silently.
          }
          schedule(); // re-arm for the same slot tomorrow
        }, delay);
        timersRef.current.push(id);
      };
      schedule();
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [swReady, permState, location]);

  // ── Register Periodic Background Sync (Chrome / Android only) ─────────────
  // This wakes the SW roughly once per 12 h even when the page is closed.
  // Falls back silently on unsupported browsers (iOS, Firefox, etc.).
  useEffect(() => {
    if (!swReady || permState !== "granted") return;
    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        if (!("periodicSync" in reg)) return;
        const status = await navigator.permissions.query({ name: "periodic-background-sync" });
        if (status.state !== "granted") return;
        await reg.periodicSync.register("lhc-garbage-check", {
          minInterval: 12 * 60 * 60 * 1000, // at most twice daily
        });
      } catch {
        // periodicSync not available — in-page setTimeout is the sole path.
      }
    });
  }, [swReady, permState]);

  // ── Permission request ─────────────────────────────────────────────────────
  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "unsupported";
    const result = await Notification.requestPermission();
    setPermState(result);
    return result;
  }, []);

  // ── Calendar export ────────────────────────────────────────────────────────
  // Navigation is handled by the CalendarPickerModal in App.jsx, which uses
  // native <a href="webcal://..."> anchors (direct user gesture) and
  // window.open() so the OS can route the URLs correctly.
  //
  // This function is responsible only for marking the localStorage duplicate-
  // guard and updating the calExported state so the 📅 button turns green.
  // It is called *after* the navigation has been initiated by the picker.
  //
  // The localStorage key is rounded to 3 decimal places (~110 m precision)
  // so minor GPS jitter between sessions does not reset the green state.
  // Calendar apps also deduplicate on VEVENT UID, so re-importing is safe.
  const markCalendarExported = useCallback(() => {
    if (!location) return;
    localStorage.setItem(_calKey(location), "1");
    setCalExported(true);
  }, [location]);

  return {
    /** "granted" | "denied" | "default" | "unsupported" */
    permState,
    /** true once the SW has been registered successfully. */
    swReady,
    /** Notification API exists and SW registered. */
    isSupported: permState !== "unsupported" && "serviceWorker" in navigator,
    /** User granted notification permission. */
    isEnabled: permState === "granted",
    /** User explicitly denied permission — cannot re-prompt programmatically. */
    isDenied: permState === "denied",
    /** Call to show the browser permission dialog. */
    requestPermission,
    /** Mark the calendar as exported for the current location (turns 📅 green).
     *  Call this after the user has confirmed the export in CalendarPickerModal. */
    markCalendarExported,
    /** true when the calendar has already been exported for the current location. */
    calExported,
  };
}
