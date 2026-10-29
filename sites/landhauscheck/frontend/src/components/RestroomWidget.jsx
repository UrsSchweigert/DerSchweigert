import { useEffect, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL as API_BASE } from "../config/api";
import { translations } from "../config/i18n";
import WidgetHelp from "./WidgetHelp";
import NavPromptSheet from "./NavPromptSheet";

const RESTROOM_RADIUS = 1500; // metres
const RESTROOM_LIMIT  = 5;

// WC icon
const WcIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16 2c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zM8 2C5.24 2 3 4.24 3 7s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8C6.34 10 5 8.66 5 7s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm8 2c-3 0-9 1.51-9 4.5V20h18v-3.5C25 13.51 19 12 16 12zm-7 6v-1.5c0-.98 3.27-2.5 7-2.5s7 1.52 7 2.5V18H9zM8 12C5 12 0 13.51 0 16.5V20h7v-3.5c0-1.08.68-1.99 1.63-2.68C7.6 13.1 6.92 12 8 12z"/>
  </svg>
);

// Wheelchair icon
const WheelchairIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: "0.85em", height: "0.85em" }}>
    <circle cx="12" cy="4" r="2"/>
    <path d="M19 13v-2h-6l-2.09-3.99L9 9.06V13h2V9.94l1.22-1.05L14.17 13H8v8h2v-6h6v6h2v-6h1v-2h-1z"/>
  </svg>
);

function fmtDistance(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
  return `${m} m`;
}

/** Merge two restroom lists. OSM entries replace matching Google entries
 *  (same location within 50 m) so richer data (fee/hours/wheelchair) wins.
 *  New entries from the second list are appended. Result sorted by distance. */
function mergeRestrooms(base, incoming) {
  const merged = [...base];
  for (const r of incoming) {
    const idx = merged.findIndex(
      (b) => Math.hypot((b.lat - r.lat) * 111320, (b.lng - r.lng) * 78580) < 50
    );
    if (idx >= 0) {
      // Prefer the richer entry: OSM has fee/hours/wheelchair; Google has better names sometimes
      merged[idx] = {
        ...merged[idx],
        ...r,
        // Keep non-null fields from whichever source has them
        name: r.name ?? merged[idx].name,
        subtitle: r.subtitle ?? merged[idx].subtitle,
        fee: r.fee !== null ? r.fee : merged[idx].fee,
        opening_hours: r.opening_hours ?? merged[idx].opening_hours,
        wheelchair: r.wheelchair !== null ? r.wheelchair : merged[idx].wheelchair,
        walk_min: r.walk_min ?? merged[idx].walk_min,
      };
    } else {
      merged.push(r);
    }
  }
  return merged.sort((a, b) => a.distance - b.distance).slice(0, RESTROOM_LIMIT);
}

export default function RestroomWidget({ location, onStatusChange, onError, lang = "de" }) {
  const t = translations[lang] ?? translations.de;
  const [restrooms, setRestrooms] = useState([]);
  const [phase, setPhase] = useState("locating");
  const [navTarget, setNavTarget] = useState(null);

  useEffect(() => {
    if (!location) {
      setPhase("locating");
      setRestrooms([]);
      onStatusChange?.("locating");
      return;
    }

    // Clear stale data immediately when location changes
    setRestrooms([]);
    let cancelled = false;

    const buildUrl = (src) => {
      const u = new URL(`${API_BASE}/api/v1/transit/restrooms-nearby`);
      u.searchParams.set("lat", location.lat);
      u.searchParams.set("lng", location.lng);
      u.searchParams.set("radius", RESTROOM_RADIUS);
      u.searchParams.set("limit", RESTROOM_LIMIT);
      u.searchParams.set("source", src);
      return u;
    };

    const doFetch = () => {
      setPhase("loading");
      onStatusChange?.("loading");

      let firstArrived = false;

      // Google: fast (~500 ms), sparse (no fee/hours/wheelchair)
      fetch(buildUrl("google"))
        .then((r) => r.ok ? r.json() : Promise.reject(new Error(`Server ${r.status}`)))
        .then((d) => {
          if (cancelled) return;
          const items = d.restrooms ?? [];
          if (!firstArrived && items.length > 0) {
            firstArrived = true;
            setRestrooms(items);
            setPhase("ok");
            onStatusChange?.("ok");
          }
        })
        .catch(() => {}); // OSM may still succeed — don't set error yet

      // OSM: slower (~1–8 s), richer (fee/hours/wheelchair + real routing)
      fetch(buildUrl("osm"))
        .then((r) => r.ok ? r.json() : Promise.reject(new Error(`Server ${r.status}`)))
        .then((d) => {
          if (cancelled) return;
          const items = d.restrooms ?? [];
          if (items.length > 0) {
            firstArrived = true;
            // Merge: OSM upgrades matching Google entries with richer fields
            setRestrooms((prev) => mergeRestrooms(prev.length ? prev : items, items));
            setPhase("ok");
            onStatusChange?.("ok");
          } else if (!firstArrived) {
            // Both returned empty
            setPhase("ok");
            onStatusChange?.("ok");
          }
        })
        .catch((err) => {
          if (cancelled) return;
          if (!firstArrived) {
            setPhase("error");
            onStatusChange?.("error");
            onError?.(err.message);
          }
          // If Google already rendered something, swallow the OSM error silently
        });
    };

    doFetch();
    const id = setInterval(doFetch, 30 * 60 * 1000); // 30 min refresh
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [location, onStatusChange, onError]);

  return (
    <div className="restroomWidget">
      {navTarget && (
        <NavPromptSheet
          name={navTarget.name ?? t.restroomPublicToilet}
          lat={navTarget.lat}
          lng={navTarget.lng}
          travelMode="walking"
          lang={lang}
          onDismiss={() => setNavTarget(null)}
        />
      )}

      <h3 className="restroomWidget__title">
        {t.restroomTitle}
        <WidgetHelp text={t.restroomHelp} />
      </h3>

      {(phase === "locating" || phase === "loading") && (
        <p className="restroomWidget__hint">
          {phase === "locating" ? t.locating : t.searching}
        </p>
      )}

      {phase === "error" && (
        <p className="restroomWidget__hint restroomWidget__hint--error">{t.genericError}</p>
      )}

      {phase === "ok" && restrooms.length === 0 && (
        <p className="restroomWidget__hint">
          {t.restroomNoResults((RESTROOM_RADIUS / 1000).toLocaleString())}
        </p>
      )}

      {restrooms.length > 0 && (
        <ul className="restroomWidget__list">
          {restrooms
            .slice() // Defensive copy
            .sort((a, b) => a.distance - b.distance)
            .map((r) => {
              // Prefer name, then operator, then address, then street, then fallback
              const label = r.name?.trim() || r.operator?.trim() || r.address?.trim() || r.street?.trim() || t.restroomPublicToilet;
              return (
                <li
                  key={r.id}
                  className="restroomItem restroomItem--clickable"
                  onClick={() => setNavTarget(r)}
                >
                  <span className="restroomItem__icon">
                    <WcIcon />
                  </span>
                  <span className="restroomItem__body">
                    <span className="restroomItem__name">{label}</span>
                    {r.subtitle && (
                      <span className="restroomItem__subtitle">{r.subtitle}</span>
                    )}
                    <span className="restroomItem__badges">
                      {r.wheelchair && (
                        <span className="restroomItem__badge restroomItem__badge--wc">
                          <WheelchairIcon />
                        </span>
                      )}
                      {r.fee !== null && r.fee !== undefined && (
                        r.fee
                          ? <span className="restroomItem__badge restroomItem__badge--fee">{t.restroomFee}</span>
                          : <span className="restroomItem__badge restroomItem__badge--free">{t.restroomFree}</span>
                      )}
                      {r.opening_hours && (
                        <span className="restroomItem__hours">{r.opening_hours}</span>
                      )}
                    </span>
                  </span>
                  <span className="restroomItem__dist">
                    {fmtDistance(r.distance)}&ensp;·&ensp;🚶 {r.walk_min}&thinsp;min
                  </span>
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
