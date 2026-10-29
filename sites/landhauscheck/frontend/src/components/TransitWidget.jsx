import { useCallback, useEffect, useRef, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL as API_BASE } from "../config/api";
import { translations } from "../config/i18n";
import WidgetHelp from "./WidgetHelp";
import NavPromptSheet from "./NavPromptSheet";

const SEARCH_RADIUS_M = 1000;
const REFRESH_MS = 30 * 60 * 1000;
const RAIL_CACHE_KEY = "lhc_rail_stations_v1";
const RAIL_CACHE_TTL  = 60 * 60 * 1000; // 1 hour — station list is stable
const BUS_CACHE_KEY   = "lhc_bus_stops_v1";
const BUS_CACHE_TTL   = 60 * 60 * 1000; // 1 hour — stop locations are stable

// Rail modes (high-speed, regional, interurban, metro, tram)
const RAIL_MODES = new Set([0, 1, 2, 7, 8]);

const MODE_LABELS = {
  0: "High-Speed Rail",
  1: "Regional Rail",
  2: "Interurban Rail",
  3: "City Bus",
  4: "Bus",
  5: "Night Bus",
  6: "Ferry",
  7: "Metro",
  8: "Tram",
  9: "Cable Car",
  20: "Bike Share",
  21: "Rideshare",
};

const MODE_COLORS = {
  0: "#8e0e00",
  1: "#b84c00",
  2: "#7b5e00",
  3: "#1a5e9c",
  4: "#1a5e9c",
  5: "#2d3f6b",
  6: "#006b6b",
  7: "#6a0dad",
  8: "#006d36",
  9: "#5c4a1e",
  20: "#2e7d32",
  21: "#37474f",
};

function modeLabel(mode) { return MODE_LABELS[mode] ?? `Mode ${mode}`; }
function modeColor(mode) { return MODE_COLORS[mode] ?? "#546e7a"; }
// ── Rail station metadata ──────────────────────────────────────────────────────
const RAILWAY_COLORS = {
  rail: "#b84c00",
  halt: "#b84c00",
  tram_stop: "#006d36",
  subway: "#6a0dad",
  light_rail: "#1a5e9c",
  monorail: "#37474f",
  narrow_gauge: "#5c4a1e",
};

// ── HERE ID cache for rail station resolution (persisted to sessionStorage) ────
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

function railLabel(railway, t) { return t.railLabels?.[railway] ?? t.railLabels?.rail ?? "Rail"; }
function railColor(railway) { return RAILWAY_COLORS[railway] ?? "#546e7a"; }
// Rail modes → car pictogram; short-range → walking

function travelInfo(distance, modes) {
  const isRail = modes.some((m) => RAIL_MODES.has(m));
  if (isRail) {
    // ~30 km/h average urban driving
    return { icon: "🚗", mins: Math.max(1, Math.round(distance / 500)) };
  }
  // ~5 km/h walking
  return { icon: "🚶", mins: Math.max(1, Math.round(distance / 83)) };
}

function fmtDist(m, imperial) {
  if (imperial) {
    const ft = m * 3.28084;
    if (ft < 528) return `${Math.round(ft)} ft`;
    return `${(m / 1609.34).toFixed(1)} mi`;
  }
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// Format an ISO departure time string as countdown or clock
function fmtDep(isoTime) {
  const depMs = new Date(isoTime).getTime();
  const diffMin = Math.round((depMs - Date.now()) / 60000);
  if (diffMin < 1) return null; // caller uses t.now
  if (diffMin < 60) return `${diffMin} min`;
  return new Date(isoTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function normaliseStations(stations, lat, lng) {
  return stations.map((s) => ({
    id: s.place?.id ?? null,
    name: s.place?.name ?? "Unknown stop",
    lat: s.place?.location?.lat ?? null,
    lng: s.place?.location?.lng ?? null,
    distance: haversine(lat, lng, s.place?.location?.lat ?? lat, s.place?.location?.lng ?? lng),
    modes: [],
    departures: [],
  }));
}

function dedupBusStops(enriched) {
  const busOnly = enriched.filter(
    (s) => s.modes.length === 0 || s.modes.some((m) => !RAIL_MODES.has(m)),
  );
  const seenLines = new Set();
  const deduped = [];
  for (const stop of busOnly) {
    const stopLines = stop.departures.map((d) => d.line).filter(Boolean);
    if (stopLines.length === 0) {
      if (deduped.length < 3) deduped.push(stop);
    } else {
      const newLines = stopLines.filter((l) => !seenLines.has(l));
      if (newLines.length > 0) {
        newLines.forEach((l) => seenLines.add(l));
        deduped.push(stop);
      }
    }
    if (deduped.length >= 3) break;
  }
  return deduped;
}

async function fetchNearbyStops(lat, lng) {
  try {
    const cached = sessionStorage.getItem(BUS_CACHE_KEY);
    if (cached) {
      const { ts, lat: cLat, lng: cLng, stops } = JSON.parse(cached);
      const sameCell = Math.abs(cLat - lat) < 0.05 && Math.abs(cLng - lng) < 0.05;
      if (sameCell && Date.now() - ts < BUS_CACHE_TTL) return stops;
    }
  } catch { /* ignore */ }
  const u = new URL(`${API_BASE}/api/v1/transit/nearby`);
  u.searchParams.set("lat", lat);
  u.searchParams.set("lng", lng);
  u.searchParams.set("radius", SEARCH_RADIUS_M);
  const res = await fetch(u);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Server returned ${res.status}`);
  }

  const data = await res.json();
  const stops = normaliseStations(data.stations ?? [], lat, lng)
    .sort((a, b) => a.distance - b.distance);
  try {
    sessionStorage.setItem(BUS_CACHE_KEY, JSON.stringify({ ts: Date.now(), lat, lng, stops }));
  } catch { /* quota */ }
  return stops;
}

async function fetchModes(allStops) {
  const ids = allStops.map((s) => s.id).filter(Boolean);
  if (ids.length === 0) return allStops;

  const url = new URL(`${API_BASE}/api/v1/transit/departures`);
  url.searchParams.set("ids", ids.join(","));

  const res = await fetch(url);
  if (!res.ok) return allStops;

  const data = await res.json();
  // Build a map: stationId → { modes: Set, departures: [] }
  const boardMap = {};
  for (const board of data.boards ?? []) {
    const stationId = board.place?.id;
    if (!stationId) continue;
    const modeSet = new Set();
    const departures = [];
    const sorted = (board.departures ?? []).sort(
      (a, b) => new Date(a.time) - new Date(b.time),
    );
    for (const dep of sorted) {
      if (dep.transport?.mode != null) modeSet.add(dep.transport.mode);
      if (departures.length < 3) {
        departures.push({
          time: dep.time,
          line: dep.transport?.name ?? "",
          headsign: dep.transport?.headsign ?? "",
        });
      }
    }
    boardMap[stationId] = { modes: [...modeSet], departures };
  }

  return allStops.map((s) => ({
    ...s,
    modes: s.id && boardMap[s.id] ? boardMap[s.id].modes : [],
    departures: s.id && boardMap[s.id] ? boardMap[s.id].departures : [],
  }));
}

// ── Rail data fetching ─────────────────────────────────────────────────────────
async function fetchRailStations(lat, lng) {
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
  try {
    sessionStorage.setItem(RAIL_CACHE_KEY, JSON.stringify({ ts: Date.now(), lat, lng, stations }));
  } catch { /* quota */ }
  return stations;
}

async function enrichStationsWithDepartures(osmStations) {
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
        const sorted = (board.departures ?? []).sort((a, b) => new Date(a.time) - new Date(b.time));
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


// ── Sub-components ─────────────────────────────────────────────────────────────
function StopCard({ stop, imperial, onClick }) {
  const travel = travelInfo(stop.distance, stop.modes);
  return (
    <li className="transitStop" onClick={onClick} style={{ cursor: stop.lat ? "pointer" : "default" }}>
      <div className="transitStop__header">
        <span className="transitStop__name">{stop.name}</span>
        <span className="transitStop__dist">{fmtDist(stop.distance, imperial)}</span>
      </div>
      <div className="transitStop__meta">
        <span className="transitStop__travel">
          {travel.icon}{" "}{travel.mins}{" "}min
        </span>
        {stop.modes.length > 0 && (
          <div className="transitStop__modes">
            {stop.modes.map((mode) => (
              <span
                key={mode}
                className="transitStop__badge"
                style={{ background: modeColor(mode) }}
              >
                {modeLabel(mode)}
              </span>
            ))}
          </div>
        )}
      </div>
      {stop.departures.length > 0 && (
        <ul className="transitStop__deps">
          {stop.departures.map((dep, depIdx) => (
            <li key={depIdx} className="transitDep">
              <span className="transitDep__time">{fmtDep(dep.time) ?? "now"}</span>
              {dep.line && <span className="transitDep__line">{dep.line}</span>}
              {dep.headsign && (
                <span className="transitDep__headsign">{"\u2192"}{" "}{dep.headsign}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function RailCard({ station, imperial, t, onClick }) {
  return (
    <li className="railStop" onClick={onClick} style={{ cursor: "pointer" }}>
      <div className="railStop__header">
        <span className="railStop__name">{station.name}</span>
        <span className="railStop__badge" style={{ background: railColor(station.railway) }}>
          {railLabel(station.railway, t)}
        </span>
      </div>
      <div className="railStop__meta">
        <span className="railStop__dist">{fmtDist(station.distance, imperial)}</span>
        <span className="railStop__drive">🚗 {Math.max(1, Math.round(station.distance / 500))} min</span>
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
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────
export default function TransitWidget({
  location, onStatusChange, onCountdown, onError, lang = "de", countryCode = "DE",
}) {
  const imperial = countryCode === "US";
  const t = translations[lang] ?? translations.de;

  const [activeTab, setActiveTab] = useState("bus");

  const [busStops, setBusStops] = useState([]);
  const [busPhase, setBusPhase] = useState("locating");
  const [busMessage, setBusMessage] = useState("");

  const [railStations, setRailStations] = useState([]);
  const [railPhase, setRailPhase] = useState("locating");
  const [railMessage, setRailMessage] = useState("");

  const [navTarget, setNavTarget] = useState(null);
  const coordsRef = useRef(null);
  const countdownRef = useRef(null);
  const activeTabRef = useRef("bus");

  // Mirror the active tab's status to the parent widget frame
  useEffect(() => {
    onStatusChange?.(activeTab === "bus" ? busPhase : railPhase);
  }, [activeTab, busPhase, railPhase, onStatusChange]);

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

  function handleTabSwitch(key) {
    setActiveTab(key);
    activeTabRef.current = key;
    if (key === "rail" && railStations.length > 0 && railStations.every((s) => !s.departures?.length)) {
      enrichStationsWithDepartures(railStations).then((results) => setRailStations(results));
    }
    if (key === "bus" && busStops.length > 0 && busStops.every((s) => s.departures.length === 0)) {
      fetchModes(busStops).then((enriched) => setBusStops(dedupBusStops(enriched)));
    }
  }

  const loadBus = useCallback((lat, lng, fetchDeps = true) => {
    const tCur = translations[lang] ?? translations.de;
    setBusPhase("loading");
    setBusMessage(tCur.searching);
    fetchNearbyStops(lat, lng)
      .then((nearbyStops) => fetchDeps ? fetchModes(nearbyStops) : Promise.resolve(nearbyStops))
      .then((enriched) => {
        const deduped = dedupBusStops(enriched);
        setBusStops(deduped);
        setBusPhase("ok");
        setBusMessage(deduped.length === 0 ? tCur.transitNoStops(SEARCH_RADIUS_M) : "");
      })
      .catch((err) => {
        console.error("[Transit/Bus] load error:", err); // eslint-disable-line no-console
        onError?.(err.message);
        setBusPhase("error");
        setBusMessage(err.message);
      });
  }, [onError, lang]);

  const loadRail = useCallback((lat, lng, fetchDeps = true) => {
    const tCur = translations[lang] ?? translations.de;
    setRailPhase("loading");
    setRailMessage(tCur.searching);
    fetchRailStations(lat, lng)
      .then((osmStations) =>
        fetchDeps
          ? enrichStationsWithDepartures(osmStations)
          : Promise.resolve(osmStations.map((s) => ({ ...s, departures: [] })))
      )
      .then((results) => {
        setRailStations(results);
        setRailPhase("ok");
        setRailMessage(results.length === 0 ? tCur.routingNoStations : "");
      })
      .catch((err) => {
        setRailPhase("error");
        setRailMessage(err.message);
      });
  }, [lang]);

  useEffect(() => {
    if (!location) {
      const msg = (translations[lang] ?? translations.de).locating;
      setBusPhase("locating");
      setBusMessage(msg);
      setRailPhase("locating");
      setRailMessage(msg);
      onStatusChange?.("locating");
      return;
    }
    coordsRef.current = { lat: location.lat, lng: location.lng };
    loadBus(location.lat, location.lng, true);
    loadRail(location.lat, location.lng, false);
    startCountdown((lat, lng) => {
      const tab = activeTabRef.current;
      loadBus(lat, lng, tab === "bus");
      loadRail(lat, lng, tab === "rail");
    });
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      onCountdown?.(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const currentPhase = activeTab === "bus" ? busPhase : railPhase;
  const currentMessage = activeTab === "bus" ? busMessage : railMessage;
  const currentEmpty = activeTab === "bus" ? busStops.length === 0 : railStations.length === 0;

  return (
    <div className="transitWidget">
      <h3 className="transitWidget__title">{t.transitTitle}<WidgetHelp text={t.transitHelp} /></h3>

      <div className="transitWidget__tabs" role="tablist">
        {[
          { key: "bus",  label: t.transitTabBus,  icon: "🚌" },
          { key: "rail", label: t.transitTabRail, icon: "🚆" },
        ].map(({ key, label, icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            className={`transitWidget__tab${activeTab === key ? " transitWidget__tab--active" : ""}`}
            onClick={() => handleTabSwitch(key)}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {(currentPhase === "locating" || currentPhase === "loading") && (
        <p className="transitWidget__hint">{currentMessage}</p>
      )}

      {currentPhase === "error" && (
        <p className="transitWidget__error">{currentMessage}</p>
      )}

      {currentPhase === "ok" && currentEmpty && (
        <p className="transitWidget__hint">{currentMessage}</p>
      )}

      {activeTab === "bus" && busStops.length > 0 && (
        <ul className="transitWidget__list">
          {busStops.map((stop, idx) => (
            <StopCard
              key={stop.id ?? `${stop.name}-${idx}`}
              stop={stop}
              imperial={imperial}
              onClick={() => stop.lat && setNavTarget({ ...stop })}
            />
          ))}
        </ul>
      )}

      {activeTab === "rail" && railStations.length > 0 && (
        <ul className="transitWidget__list">
          {railStations.map((station) => (
            <RailCard
              key={station.id}
              station={station}
              imperial={imperial}
              t={t}
              onClick={() => station.lat && setNavTarget({ ...station, travelMode: "driving" })}
            />
          ))}
        </ul>
      )}

      {navTarget && (
        <NavPromptSheet
          name={navTarget.name}
          lat={navTarget.lat}
          lng={navTarget.lng}
          travelMode={navTarget.travelMode ?? "walking"}
          lang={lang}
          onDismiss={() => setNavTarget(null)}
        />
      )}
    </div>
  );
}
