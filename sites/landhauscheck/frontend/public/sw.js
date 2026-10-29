/**
 * Landhauscheck — Service Worker
 *
 * Handles waste-collection notifications at 17:00 and 20:00 local time.
 *
 * Architecture — zero server-side push subscriptions
 * ──────────────────────────────────────────────────
 *  The server publishes a single /api/v1/notifications/manifest endpoint
 *  (CloudFront-cached, 1 h TTL) that lists all ICS calendar locations with
 *  tomorrow's collections.  The client:
 *    1. Stores the user's GPS coordinates locally (Cache API).
 *    2. At 17:00 and 20:00 local time the React page fetches the manifest,
 *       then passes it here via postMessage so no extra network call fires.
 *    3. This SW runs a local haversine check, then calls showNotification()
 *       if the user is within ~3 km of a matching location.
 *    4. A "already notified" guard (keyed on date + slot) prevents duplicates
 *       on page reload or SW restart.
 *
 *  When the page is closed, Periodic Background Sync (Chrome / Android) wakes
 *  this SW roughly once per 12 h; it then fetches the manifest independently.
 *  On iOS (PWA home-screen only) and other platforms the in-page setTimeout
 *  path is the sole notification mechanism.
 *
 * Messages accepted from the page:
 *   { type: "SET_LOCATION", location: { lat, lng }, lang: "de"|"en"|"pt" }
 *     — posted whenever the user's location changes; persisted in Cache API.
 *   { type: "NOTIFY_CHECK", slot: "17h"|"20h", manifest: { tomorrow_date, locations } }
 *     — posted by usePushNotifications at the scheduled time; the page
 *       pre-fetches the manifest so no extra Lambda invocation fires here.
 *
 * Periodic Background Sync tag: "lhc-garbage-check"
 *   — Registered by usePushNotifications (Chrome/Android only).
 */

const CACHE_NAME = "lhc-sw-v1";
const MATCH_RADIUS_M = 3_000; // haversine match limit in metres

// ── Localised notification strings (keep in sync with i18n.js) ───────────────
const NOTIFY_STRINGS = {
  de: {
    title17h: "\uD83D\uDDD1\uFE0F Morgen wird abgeholt",
    title20h: "\uD83D\uDDD1\uFE0F Erinnerung: Morgen wird abgeholt",
  },
  en: {
    title17h: "\uD83D\uDDD1\uFE0F Tomorrow\u2019s collection",
    title20h: "\uD83D\uDDD1\uFE0F Reminder: tomorrow\u2019s collection",
  },
  pt: {
    title17h: "\uD83D\uDDD1\uFE0F Recolha amanh\u00e3",
    title20h: "\uD83D\uDDD1\uFE0F Lembrete: recolha amanh\u00e3",
  },
};

// ── Persistent state (Cache API survives SW sleep / restart) ──────────────────

async function getStored(key) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match(`/__sw_state__/${key}`);
    return resp ? resp.json() : null;
  } catch {
    return null;
  }
}

async function setStored(key, value) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      `/__sw_state__/${key}`,
      new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }),
    );
  } catch { /* non-fatal storage failure */ }
}

// ── Haversine distance in metres ──────────────────────────────────────────────

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ── Duplicate-notification guard ──────────────────────────────────────────────

async function wasAlreadyNotified(tomorrowDate, slot) {
  return !!(await getStored(`notified/${tomorrowDate}/${slot}`));
}

async function markNotified(tomorrowDate, slot) {
  await setStored(`notified/${tomorrowDate}/${slot}`, 1);
}

// ── Core: match manifest → show notification ──────────────────────────────────
/**
 * @param {string}      slot       "17h" | "20h"
 * @param {object|null} manifest   pre-fetched by page, or null for background path
 */
async function checkAndNotify(slot, manifest) {
  const loc = await getStored("location");
  if (!loc) return; // no stored location — user never opened the app

  // In the Periodic Background Sync path the page is closed, so we fetch here.
  if (!manifest) {
    try {
      const r = await fetch("/api/v1/notifications/manifest", { cache: "no-store" });
      if (!r.ok) return;
      manifest = await r.json();
    } catch {
      return; // network unavailable — skip silently
    }
  }

  const { tomorrow_date: tomorrow, locations = [] } = manifest;
  if (!tomorrow || !locations.length) return;

  if (await wasAlreadyNotified(tomorrow, slot)) return;

  const match = locations.find(
    (l) => haversineM(loc.lat, loc.lng, l.lat, l.lng) <= MATCH_RADIUS_M,
  );
  if (!match) return;

  const lang = (await getStored("lang")) || "de";
  const strings = NOTIFY_STRINGS[lang] ?? NOTIFY_STRINGS.de;
  const title = slot === "20h" ? strings.title20h : strings.title17h;
  const body = match.summaries.join(", ");

  await self.registration.showNotification(title, {
    body,
    icon: "/favicon-192.png",
    badge: "/favicon-192.png",
    tag: `lhc-garbage-${tomorrow}-${slot}`,
    renotify: false,
    data: { url: "/" },
  });

  await markNotified(tomorrow, slot);
}

// ── Message handler (messages from the React page) ────────────────────────────

self.addEventListener("message", (event) => {
  const { type, location, lang, slot, manifest } = event.data ?? {};

  if (type === "SET_LOCATION" && location) {
    // Persist location + language preference for background path.
    setStored("location", location);
    if (lang) setStored("lang", lang);
  }

  if (type === "NOTIFY_CHECK" && slot) {
    // Page pre-fetched the manifest and passes it in — no extra Lambda call.
    event.waitUntil(checkAndNotify(slot, manifest ?? null));
  }
});

// ── Periodic Background Sync (Chrome / Android only) ─────────────────────────

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "lhc-garbage-check") return;
  event.waitUntil(
    (async () => {
      const h = new Date().getHours();
      // Only act if it is past the first notification window.
      if (h < 17) return;
      // Use the later reminder slot only if we are past 20:00.
      await checkAndNotify(h >= 20 ? "20h" : "17h", null);
    })(),
  );
});

// ── Notification click → focus or open the app ────────────────────────────────

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        const existing = wins.find((w) => new URL(w.url).origin === self.location.origin);
        if (existing) return existing.focus();
        return clients.openWindow(url);
      }),
  );
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
