import { useCallback, useEffect, useRef, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL as API_BASE } from "../config/api";
import { loadGoogleMapsScript, MAP_STYLES } from "./mapUtils.js";
import { translations } from "../config/i18n";
import WidgetHelp from "./WidgetHelp";
import NavPromptSheet from "./NavPromptSheet";

const REFRESH_MS = 30 * 60 * 1000;
const RAIL_CACHE_KEY = "lhc_rail_stations_v1";
const RAIL_CACHE_TTL = 60 * 60 * 1000; // 1 hour — station list is stable

// Cache OSM station coordinates → HERE station ID across refreshes.
// Persisted to sessionStorage so page reloads don't re-fetch HERE station IDs.
function _loadHereIdCache() {
  try {
    const raw = sessionStorage.getItem("lhc_here_ids_v1");
    return raw ? new Map(JSON.parse(raw)) : new Map();
  } catch { return new Map(); }
}
function _saveHereIdCache(map) {
  try { sessionStorage.setItem("lhc_here_ids_v1", JSON.stringify([...map])); } catch { /* quota */ }
}
const _hereIdCache = _loadHereIdCache();

const RAILWAY_COLORS = {
  rail: "#b84c00",
  halt: "#b84c00",
  tram_stop: "#006d36",
  subway: "#6a0dad",
  light_rail: "#1a5e9c",
  monorail: "#37474f",
  narrow_gauge: "#5c4a1e",
};

function railLabel(railway, t) { return (t.railLabels?.[railway]) ?? t.railLabels?.rail ?? "Rail"; }
function railColor(railway) { return RAILWAY_COLORS[railway] ?? "#546e7a"; }

function fmtDistance(m, imperial) {
  if (imperial) {
    const ft = m * 3.28084;
    if (ft < 528) return `${Math.round(ft)} ft`;
    return `${(m / 1609.34).toFixed(1)} mi`;
  }
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
  return `${m} m`;
}

function driveMins(m) {
  return Math.max(1, Math.round(m / 500));
}

function fmtDep(isoTime) {
  const diffMin = Math.round((new Date(isoTime).getTime() - Date.now()) / 60000);
  if (diffMin < 1) return null; // caller uses t.now
  if (diffMin < 60) return `${diffMin} min`;
  return new Date(isoTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function fetchRailStations(lat, lng) {
  // Check sessionStorage cache first — rail station list changes rarely
  try {
    const cached = sessionStorage.getItem(RAIL_CACHE_KEY);
    if (cached) {
      const { ts, lat: cLat, lng: cLng, stations } = JSON.parse(cached);
      const sameCell = Math.abs(cLat - lat) < 0.05 && Math.abs(cLng - lng) < 0.05;
      if (sameCell && Date.now() - ts < RAIL_CACHE_TTL) return stations;
    }
  } catch { /* ignore */ }

  const u = new URL(`${API_BASE}/api/v1/transit/rail-nearby`);
  u.searchParams.set("lat", lat);
  u.searchParams.set("lng", lng);
  u.searchParams.set("radius", 20000);
  u.searchParams.set("limit", 3);

  const res = await fetch(u);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Server returned ${res.status}`);
  }
  const data = await res.json();
  const stations = data.stations ?? [];

  // Persist to sessionStorage
  try {
    sessionStorage.setItem(RAIL_CACHE_KEY, JSON.stringify({ ts: Date.now(), lat, lng, stations }));
  } catch { /* quota */ }

  return stations;
}

// Resolve a list of OSM stations to HERE IDs (cached), then fetch
// all departures in a single batched request.
async function enrichStationsWithDepartures(osmStations) {
  // 1. Resolve HERE IDs — use cache, only fetch misses
  const misses = osmStations.filter((s) => !_hereIdCache.has(`${s.lat},${s.lng}`));
  await Promise.all(misses.map(async (osmStation) => {
    const nearbyUrl = new URL(`${API_BASE}/api/v1/transit/nearby`);
    nearbyUrl.searchParams.set("lat", osmStation.lat);
    nearbyUrl.searchParams.set("lng", osmStation.lng);
    nearbyUrl.searchParams.set("radius", 400);
    try {
      const res = await fetch(nearbyUrl);
      if (!res.ok) return;
      const data = await res.json();
      const hereId = data.stations?.[0]?.place?.id;
      if (hereId) {
        _hereIdCache.set(`${osmStation.lat},${osmStation.lng}`, hereId);
        _saveHereIdCache(_hereIdCache);
      }
    } catch { /* cache miss — station will have no departures */ }
  }));

  // 2. Batch all known HERE IDs into a single departures request
  const idPairs = osmStations
    .map((s) => ({ station: s, hereId: _hereIdCache.get(`${s.lat},${s.lng}`) }))
    .filter((p) => p.hereId);

  if (idPairs.length === 0) return osmStations.map((s) => ({ ...s, departures: [] }));

  const depUrl = new URL(`${API_BASE}/api/v1/transit/departures`);
  depUrl.searchParams.set("ids", idPairs.map((p) => p.hereId).join(","));

  let boardMap = {};
  try {
    const depRes = await fetch(depUrl);
    if (depRes.ok) {
      const depData = await depRes.json();
      for (const board of depData.boards ?? []) {
        const hereId = board.place?.id;
        if (!hereId) continue;
        const departures = [];
        const sorted = (board.departures ?? []).sort(
          (a, b) => new Date(a.time) - new Date(b.time),
        );
        for (const dep of sorted) {
          if (departures.length >= 3) break;
          departures.push({
            time: dep.time,
            line: dep.transport?.name ?? "",
            headsign: dep.transport?.headsign ?? "",
          });
        }
        boardMap[hereId] = departures;
      }
    }
  } catch { /* departures unavailable — show station without times */ }

  return osmStations.map((s) => {
    const hereId = _hereIdCache.get(`${s.lat},${s.lng}`);
    return { ...s, departures: hereId && boardMap[hereId] ? boardMap[hereId] : [] };
  });
}

// Keep old single-station signature for backward compat with any callers
async function enrichWithDepartures(osmStation) {
  const [result] = await enrichStationsWithDepartures([osmStation]);
  return result;
}

export default function RoutingWidget({ location, onStatusChange, onCountdown, lang = "de", countryCode = "DE" }) {
  const t = translations[lang] ?? translations.de;
  const imperial = countryCode === "US";
  const [stations, setStations] = useState([]);
  const [phase, setPhase] = useState("locating");
  const [message, setMessage] = useState("");
  const [navTarget, setNavTarget] = useState(null);
  const coordsRef = useRef(null);
  const countdownRef = useRef(null);

  function startCountdown(onLoad) {
    if (countdownRef.current) clearInterval(countdownRef.current);
    let secs = Math.floor(REFRESH_MS / 1000);
    onCountdown?.(secs);
    countdownRef.current = setInterval(() => {
      secs -= 1;
      onCountdown?.(secs);
      if (secs <= 0) {
        if (coordsRef.current) onLoad(coordsRef.current.lat, coordsRef.current.lng);
        secs = Math.floor(REFRESH_MS / 1000);
        onCountdown?.(secs);
      }
    }, 1000);
  }

  const load = useCallback((lat, lng) => {
    const tCur = translations[lang] ?? translations.de;
    coordsRef.current = { lat, lng };
    setPhase("loading");
    setMessage(tCur.searching);
    onStatusChange?.("loading");
    fetchRailStations(lat, lng)
      .then((osmStations) => enrichStationsWithDepartures(osmStations))
      .then((results) => {
        setStations(results);
        setPhase("ok");
        setMessage(results.length === 0 ? tCur.routingNoStations : "");
        onStatusChange?.("connected");
      })
      .catch((err) => {
        setPhase("error");
        setMessage(err.message);
        onStatusChange?.("error");
      });
  }, [onStatusChange, lang]);

  useEffect(() => {
    if (!location) {
      setPhase("locating");
      setMessage((translations[lang] ?? translations.de).locating);
      onStatusChange?.("locating");
      return;
    }
    load(location.lat, location.lng);
    startCountdown(load);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      onCountdown?.(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  return (
    <div className="routingWidget">
      <h3 className="routingWidget__title">{t.routingTitle}<WidgetHelp text={t.routingHelp} /></h3>

      {(phase === "locating" || phase === "loading") && (
        <p className="routingWidget__hint">{message}</p>
      )}

      {phase === "ok" && stations.length === 0 && (
        <p className="routingWidget__hint">{message}</p>
      )}

      {stations.length > 0 && (
        <ul className="routingWidget__list">
          {stations.map((station) => (
            <li
              key={station.id}
              className="railStop"
              onClick={() => station.lat && setNavTarget({ ...station })}
              style={{ cursor: "pointer" }}
            >
              <div className="railStop__header">
                <span className="railStop__name">{station.name}</span>
                <span
                  className="railStop__badge"
                  style={{ background: railColor(station.railway) }}
                >
                  {railLabel(station.railway, t)}
                </span>
              </div>
              <div className="railStop__meta">
                <span className="railStop__dist">{fmtDistance(station.distance, imperial)}</span>
                <span className="railStop__drive">🚗 {driveMins(station.distance)} min</span>
              </div>
              {station.departures?.length > 0 && (
                <ul className="transitStop__deps">
                  {station.departures.map((dep, i) => (
                    <li key={i} className="transitDep">
                      <span className="transitDep__time">{fmtDep(dep.time) ?? t.now}</span>
                      {dep.line && <span className="transitDep__line">{dep.line}</span>}
                      {dep.headsign && (
                        <span className="transitDep__headsign">{"\u2192"}{" "}{dep.headsign}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {navTarget && (
        <NavPromptSheet
          name={navTarget.name}
          lat={navTarget.lat}
          lng={navTarget.lng}
          travelMode="driving"
          lang={lang}
          
          onDismiss={() => setNavTarget(null)}
        />
      )}
    </div>
  );
}
