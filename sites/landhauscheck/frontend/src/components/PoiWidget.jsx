import { useEffect, useMemo, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL as API_BASE } from "../config/api";
import { translations } from "../config/i18n";
import WidgetHelp from "./WidgetHelp";
import NavPromptSheet from "./NavPromptSheet";


const POI_RADIUS = 7000;
const POI_LIMIT  = 20;

// Preferred sort order for category filter chips.
const CATEGORY_ORDER = ["Food & Drink", "Essential Facilities", "Shopping", "Culture"];

// Framed-gradient icons for filter chips — same visual language as mapTabBtn SVGs.
const FILTER_ICONS = {
  all: (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="poi-f-all-gb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b5bdb"/><stop offset="100%" stopColor="#0a1b6b"/>
        </linearGradient>
        <radialGradient id="poi-f-all-gs" cx="42%" cy="18%" r="68%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
          <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-all-gb)"/>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-all-gs)"/>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
      <rect x="6" y="6" width="8.5" height="8.5" rx="2" fill="white"/>
      <rect x="17.5" y="6" width="8.5" height="8.5" rx="2" fill="white"/>
      <rect x="6" y="17.5" width="8.5" height="8.5" rx="2" fill="white"/>
      <rect x="17.5" y="17.5" width="8.5" height="8.5" rx="2" fill="white"/>
    </svg>
  ),
  "Food & Drink": (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="poi-f-food-gb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e05252"/><stop offset="100%" stopColor="#891919"/>
        </linearGradient>
        <radialGradient id="poi-f-food-gs" cx="42%" cy="18%" r="68%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
          <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-food-gb)"/>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-food-gs)"/>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
      <g fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="9" y1="5" x2="9" y2="13"/>
        <line x1="12.5" y1="5" x2="12.5" y2="13"/>
        <path d="M9,13 Q10.75,16.5 12.5,13"/>
        <line x1="10.75" y1="16" x2="10.75" y2="27"/>
        <path d="M21,5 C21,5 24.5,6.5 24.5,14 L21,14 L21,27"/>
      </g>
    </svg>
  ),
  "Essential Facilities": (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="poi-f-ess-gb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9"/><stop offset="100%" stopColor="#0c4a6e"/>
        </linearGradient>
        <radialGradient id="poi-f-ess-gs" cx="42%" cy="18%" r="68%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
          <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-ess-gb)"/>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-ess-gs)"/>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
      <rect x="13" y="7" width="6" height="18" rx="1.5" fill="white"/>
      <rect x="7" y="13" width="18" height="6" rx="1.5" fill="white"/>
    </svg>
  ),
  Shopping: (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="poi-f-shop-gb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb923c"/><stop offset="100%" stopColor="#7c2d12"/>
        </linearGradient>
        <radialGradient id="poi-f-shop-gs" cx="42%" cy="18%" r="68%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
          <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-shop-gb)"/>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-shop-gs)"/>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
      <g fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7,13 L7.5,26.5 Q7.5,27.5 9,27.5 h14 Q24.5,27.5 24.5,26.5 L25,13 Z"/>
        <path d="M12,13 C12,6 20,6 20,13"/>
      </g>
    </svg>
  ),
  Culture: (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="poi-f-cult-gb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a855f7"/><stop offset="100%" stopColor="#5b21b6"/>
        </linearGradient>
        <radialGradient id="poi-f-cult-gs" cx="42%" cy="18%" r="68%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
          <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-cult-gb)"/>
      <rect width="32" height="32" rx="8" fill="url(#poi-f-cult-gs)"/>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
      <g fill="white">
        <polygon points="16,5 27,11 5,11"/>
        <rect x="8" y="13" width="3.5" height="13" rx="0.5"/>
        <rect x="14.25" y="13" width="3.5" height="13" rx="0.5"/>
        <rect x="20.5" y="13" width="3.5" height="13" rx="0.5"/>
        <rect x="5" y="26" width="22" height="2" rx="0.5"/>
      </g>
    </svg>
  ),
};

function genericFilterIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="rgba(84,110,122,0.8)"/>
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
      <path fill="white" d="M16 5C11.6 5 8 8.6 8 13c0 6.5 8 14 8 14s8-7.5 8-14c0-4.4-3.6-8-8-8zm0 10.5c-1.4 0-2.5-1.1-2.5-2.5s1.1-2.5 2.5-2.5 2.5 1.1 2.5 2.5-1.1 2.5-2.5 2.5z"/>
    </svg>
  );
}

const CATEGORY_META = {
  "Food & Drink":          { color: "#c0392b", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1zm15.03-7c0-4.5-6.75-5-6.75-5S2.5 10.5 2.5 14.99H16.03z"/></svg>
  )},
  "Essential Facilities":  { color: "#0369a1", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>
  )},
  Shopping:                { color: "#d35400", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.1 17 7 17h11v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 23.45 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
  )},
  Culture:                 { color: "#7d3c98", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 11V9L12 2 2 9v2h2v9H2v2h20v-2h-2v-9h2zm-10 9H8v-7h4v7zm6 0h-4v-7h4v7zM4 9.9l8-5.55L20 9.9V11H4V9.9z"/></svg>
  )},
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] ?? { color: "#546e7a", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
  )};
}

function fmtDistance(m, imperial) {
  if (imperial) {
    const ft = m * 3.28084;
    if (ft < 528) return `${Math.round(ft)} ft`;
    return `${(m / 1609.34).toFixed(1)} mi`;
  }
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
  return `${m} m`;
}

// ---------------------------------------------------------------------------

export default function PoiWidget({ location, onStatusChange, onError, lang = "de", countryCode = "DE" }) {
  const t = translations[lang] ?? translations.de;
  const imperial = countryCode === "US";
  const [allPois, setAllPois] = useState([]);
  const [activeFilter, setActiveFilter] = useState("Food & Drink");
  const [phase, setPhase] = useState("locating");
  const [navTarget, setNavTarget] = useState(null);

  useEffect(() => {
    if (!location) { setPhase("locating"); setAllPois([]); onStatusChange?.("locating"); return; }
    setAllPois([]); // clear stale data immediately when location changes

    const doFetch = () => {
      setPhase("loading");
      onStatusChange?.("loading");
      const u = new URL(`${API_BASE}/api/v1/transit/poi-nearby`);
      u.searchParams.set("lat", location.lat);
      u.searchParams.set("lng", location.lng);
      u.searchParams.set("radius", POI_RADIUS);
      u.searchParams.set("limit", POI_LIMIT);
      u.searchParams.set("lang", lang);
      fetch(u)
        .then((r) => {
          if (!r.ok) throw new Error(`Server ${r.status}`);
          return r.json();
        })
        .then((d) => {
          setAllPois(d.pois ?? []);
          setPhase("ok");
          onStatusChange?.("ok");
        })
        .catch((err) => {
          setPhase("error");
          onStatusChange?.("error");
          onError?.(err.message);
        });
    };
    doFetch();
    const id = setInterval(doFetch, 120 * 60 * 1000); // 2 h refresh
    return () => clearInterval(id);
  }, [location, onStatusChange, onError, lang]);

  // Labels used for aria-label / title on icon-only chips.
  const CATEGORY_LABELS = {
    "Food & Drink":         t.poiFilterFoodDrink,
    "Essential Facilities": t.poiFilterEssential,
    Shopping:               t.poiFilterShopping,
    Culture:                t.poiFilterCulture,
  };

  // Derive categories present in the data, preserving CATEGORY_ORDER; append any unknowns.
  const availableCategories = useMemo(() => {
    if (allPois.length === 0) return CATEGORY_ORDER;
    const seen = new Set(allPois.map(p => p.category));
    const ordered = CATEGORY_ORDER.filter(c => seen.has(c));
    const extras  = [...seen].filter(c => !CATEGORY_ORDER.includes(c));
    return [...ordered, ...extras];
  }, [allPois]);

  const visiblePois = activeFilter === "all"
    ? allPois
    : allPois.filter((p) => p.category === activeFilter);

  return (
    <div className="poiWidget">
      {navTarget && (
        <NavPromptSheet
          name={navTarget.name}
          lat={navTarget.lat}
          lng={navTarget.lng}
          travelMode="walking"
          lang={lang}
          
          onDismiss={() => setNavTarget(null)}
        />
      )}
      <h3 className="poiWidget__title">{t.poiTitle}<WidgetHelp text={t.poiHelp} /></h3>

      {/* Category filter chips — icon-only, same framed-gradient style as map widget tab bar */}
      {phase !== "locating" && (
        <div className="poiWidget__filters" role="group" aria-label={t.poiTitle}>
          <button
            type="button"
            className={`poiWidget__chip${activeFilter === "all" ? " poiWidget__chip--active" : ""}`}
            onClick={() => setActiveFilter("all")}
            aria-label={t.poiFilterAll}
            title={t.poiFilterAll}
          >
            {FILTER_ICONS.all}
          </button>
          {availableCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`poiWidget__chip${activeFilter === cat ? " poiWidget__chip--active" : ""}`}
              onClick={() => setActiveFilter(cat)}
              aria-label={CATEGORY_LABELS[cat] ?? cat}
              title={CATEGORY_LABELS[cat] ?? cat}
            >
              {FILTER_ICONS[cat] ?? genericFilterIcon()}
            </button>
          ))}
        </div>
      )}

      {(phase === "locating" || phase === "loading") && (
        <p className="poiWidget__hint">
          {phase === "locating" ? t.locating : t.searching}
        </p>
      )}

      {phase === "ok" && visiblePois.length === 0 && (
        <p className="poiWidget__hint">{t.poiNoPlaces((POI_RADIUS / 1000).toLocaleString(t.dateLocale))}</p>
      )}

      {visiblePois.length > 0 && (
        <ul className="poiWidget__list">
          {visiblePois.map((poi) => {
          const meta = getCategoryMeta(poi.category);
          return (
            <li
              key={poi.id}
              className="poiItem poiItem--clickable"
              onClick={() => setNavTarget({ ...poi })}
            >
              <span
                className="poiItem__icon"
                style={{ color: meta.color, background: meta.color + "22" }}
                title={poi.category}
              >
                {meta.icon}
              </span>
              <span className="poiItem__name">{poi.name}</span>
              <span className="poiItem__meta">
                {fmtDistance(poi.distance, imperial)}&ensp;&bull;&ensp;🚴 {poi.bike_min}&thinsp;min
              </span>
            </li>
          );
        })}
        </ul>
      )}
    </div>
  );
}
