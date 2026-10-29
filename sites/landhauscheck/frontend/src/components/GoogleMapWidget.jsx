import { useCallback, useEffect, useRef, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL } from "../config/api";
import { translations } from "../config/i18n.js";
import NavPromptSheet from "./NavPromptSheet";
import MapPanel from "./MapPanel";
import { loadGoogleMapsScript, MAP_STYLES, haversineKm } from "./mapUtils.js";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const FUEL_CACHE_TTL = 15 * 60 * 1000;

export default function GoogleMapWidget({ location, locationSource = "gps", lang = "de", countryCode = "DE", onStatusChange, onCountdown, onError }) {
  // Traffic map refs
  const mapRef           = useRef(null);
  const mapInstanceRef   = useRef(null);
  const trafficMarkerRef = useRef(null);
  const watchIdRef       = useRef(null);
  const trafficRORef     = useRef(null);
  // Always-current ref so the watchPosition callback can read locationSource without
  // needing it in the effect deps (which would force a map re-init on every change).
  const locationSourceRef = useRef(locationSource);
  locationSourceRef.current = locationSource;

  // Fuel/charger/toilet/ATM inline panel refs
  const fuelMapDivRef        = useRef(null);
  const fuelMapInstanceRef   = useRef(null);
  const fuelMarkersRef       = useRef([]);
  // Track whether the panel has been opened at least once so it can stay mounted
  // (hidden via display:none) rather than being unmounted — keeps fuelMapInstanceRef
  // bound to a live DOM node across tab switches.
  const panelEverOpenedRef   = useRef(false);

  // Cache (15-min TTL, cleared on location change >0.5 km)
  const fuelCacheRef    = useRef({ data: null, ts: 0 });
  const chargerCacheRef = useRef({ data: null, ts: 0 });
  const toiletCacheRef  = useRef({ data: null, ts: 0 });
  const atmCacheRef     = useRef({ data: null, ts: 0 });
  const fuelFetchedRef  = useRef(false);

  // State
  const [tab,          setTab]          = useState(0); // 0=traffic 1=fuel 2=charger 3=toilet 4=atm
  const [fuelStations, setFuelStations] = useState([]);
  const [chargers,     setChargers]     = useState([]);
  const [toilets,      setToilets]      = useState([]);
  const [atms,         setAtms]         = useState([]);
  const [fuelLoading,  setFuelLoading]  = useState(false);
  const [navTarget,    setNavTarget]    = useState(null);
  const [message,      setMessage]      = useState("");

  const t    = translations[lang] || translations.de;
  const isDE = countryCode === "DE";
  const isUS = countryCode === "US";

  const report = useCallback(
    (status, msg) => {
      if (msg !== undefined) setMessage(msg);
      onStatusChange?.(status);
      if ((status === "error" || status === "blocked") && msg !== undefined) onError?.(msg);
    },
    [onStatusChange, onError],
  );

  // ── Traffic map init ────────────────────────────────────────────────────
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      report("error", "Google Maps API key is not configured.");
      return;
    }
    if (!location) {
      report("locating", "Standort wird ermittelt\u2026");
      return;
    }

    let cancelled = false;
    const { lat, lng } = location;

    async function attachMap() {
      if (cancelled || !mapRef.current) return;
      try {
        await loadGoogleMapsScript();
      } catch {
        if (!cancelled) report("error", "Failed to load Google Maps. Check the API key.");
        return;
      }
      if (cancelled || !mapRef.current) return;

      if (!mapInstanceRef.current) {
        const map = new window.google.maps.Map(mapRef.current, {
          center: { lat, lng },
          zoom: 9,
          mapTypeId: "roadmap",
          styles: MAP_STYLES,
          disableDefaultUI: true,
          gestureHandling: "none",
          draggable: false,
          scrollwheel: false,
          disableDoubleClickZoom: true,
          clickableIcons: false,
          keyboardShortcuts: false,
        });
        new window.google.maps.TrafficLayer().setMap(map);

        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map,
          title: "Ihr Standort",
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: "#4285F4",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2.5,
          },
          zIndex: 999,
        });

        mapInstanceRef.current   = map;
        trafficMarkerRef.current = marker;

        trafficRORef.current = new ResizeObserver(() => {
          window.google.maps.event.trigger(map, "resize");
        });
        trafficRORef.current.observe(mapRef.current);

        if (navigator.geolocation && watchIdRef.current === null && locationSourceRef.current !== "manual") {
          watchIdRef.current = navigator.geolocation.watchPosition(
            ({ coords: { latitude: la, longitude: lo } }) => {
              // Ignore GPS updates when the user has manually set a location
              if (locationSourceRef.current === "manual") return;
              trafficMarkerRef.current?.setPosition({ lat: la, lng: lo });
              mapInstanceRef.current?.setCenter({ lat: la, lng: lo });
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 30000 },
          );
        }
      } else {
        mapInstanceRef.current.setCenter({ lat, lng });
        trafficMarkerRef.current?.setPosition({ lat, lng });
        return;
      }

      report("connected");
      setMessage("");
      onCountdown?.(null);
    }

    attachMap();
    return () => { cancelled = true; };
  }, [location, report, onCountdown]);

  // Trigger resize when switching back to traffic tab (was display:none)
  useEffect(() => {
    if (tab === 0 && mapInstanceRef.current) {
      setTimeout(() => {
        window.google?.maps?.event?.trigger(mapInstanceRef.current, "resize");
      }, 50);
    }
  }, [tab]);

  // Cleanup
  useEffect(() => {
    return () => {
      trafficRORef.current?.disconnect();
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // Stop GPS tracking immediately when the user switches to a manual location so the
  // traffic map marker and centre stay fixed on the manually chosen place.
  useEffect(() => {
    if (locationSource === "manual" && watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, [locationSource]);

  // Heartbeat
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const id = setInterval(() => {
      if (mapInstanceRef.current) onStatusChange?.("connected");
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [onStatusChange]);

  // ── Reset fuel cache when location changes significantly (>0.5 km) ──────
  const lastFuelLocRef = useRef(null);
  useEffect(() => {
    if (!location) return;
    const prev = lastFuelLocRef.current;
    if (prev) {
      const dist = haversineKm(prev.lat, prev.lng, location.lat, location.lng);
      if (dist > 0.5) {
        fuelFetchedRef.current = false;
        fuelCacheRef.current    = { data: null, ts: 0 };
        chargerCacheRef.current = { data: null, ts: 0 };
        toiletCacheRef.current  = { data: null, ts: 0 };
        atmCacheRef.current     = { data: null, ts: 0 };
        setFuelStations([]);
        setChargers([]);
        setToilets([]);
        setAtms([]);
      }
    }
    lastFuelLocRef.current = location;
  }, [location]);

  // ── Init fuel map when first switching to tab 1 or 2 ───────────────────
  useEffect(() => {
    if (tab === 0 || !location) return;
    if (fuelMapInstanceRef.current) {
      // Already initialized — trigger resize (was display:none)
      setTimeout(() => {
        window.google?.maps?.event?.trigger(fuelMapInstanceRef.current, "resize");
      }, 50);
      return;
    }

    let isMounted = true;
    loadGoogleMapsScript().then(() => {
      if (!isMounted || !fuelMapDivRef.current) return;
      const { maps } = window.google;
      const map = new maps.Map(fuelMapDivRef.current, {
        center: { lat: location.lat, lng: location.lng },
        zoom: 13,
        styles: MAP_STYLES,
        disableDefaultUI: true,
        gestureHandling: "cooperative",
        clickableIcons: false,
        keyboardShortcuts: false,
      });
      fuelMapInstanceRef.current = map;
      new maps.Marker({
        position: { lat: location.lat, lng: location.lng },
        map,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#4285F4",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2.5,
        },
        zIndex: 999,
      });
    });
    return () => { isMounted = false; };
  }, [tab, location, isDE]); // eslint-disable-line

  // ── Fetch fuel + charger + toilet + ATM data once when first leaving traffic tab ──
  useEffect(() => {
    if (tab === 0 || !location || fuelFetchedRef.current) return;
    fuelFetchedRef.current = true;

    let isMounted = true;
    setFuelLoading(true);

    const now = Date.now();
    const cachedFuel     = now - fuelCacheRef.current.ts    < FUEL_CACHE_TTL ? fuelCacheRef.current.data    : null;
    const cachedChargers = now - chargerCacheRef.current.ts < FUEL_CACHE_TTL ? chargerCacheRef.current.data : null;
    const cachedToilets  = now - toiletCacheRef.current.ts  < FUEL_CACHE_TTL ? toiletCacheRef.current.data  : null;
    const cachedAtms     = now - atmCacheRef.current.ts     < FUEL_CACHE_TTL ? atmCacheRef.current.data     : null;

    if (cachedFuel)     setFuelStations(cachedFuel);
    if (cachedChargers) setChargers(cachedChargers);
    if (cachedToilets)  setToilets(cachedToilets);
    if (cachedAtms)     setAtms(cachedAtms);

    const fetches = [];

    if (!cachedFuel) fetches.push(
      (isDE
        ? fetch(`${API_BASE_URL}/api/v1/fuel?lat=${location.lat}&lng=${location.lng}&radius=5`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (!data || !isMounted) return;
              const sorted = (data.stations || [])
                .filter(s => s.diesel != null)
                .sort((a, b) => a.diesel - b.diesel)
                .slice(0, 4)
                .map(s => ({ ...s, distKm: haversineKm(location.lat, location.lng, s.lat, s.lng) }));
              fuelCacheRef.current = { data: sorted, ts: Date.now() };
              if (isMounted) setFuelStations(sorted);
            })
        : fetch(`${API_BASE_URL}/api/v1/chargers?lat=${location.lat}&lng=${location.lng}&radius=5&poi_type=gas`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (!data || !isMounted) return;
              const sorted = (data.stations || [])
                .slice(0, 4)
                .map(s => ({ ...s, distKm: haversineKm(location.lat, location.lng, s.lat, s.lng) }));
              fuelCacheRef.current = { data: sorted, ts: Date.now() };
              if (isMounted) setFuelStations(sorted);
            })
      )
    );

    if (!cachedChargers) fetches.push(
      fetch(`${API_BASE_URL}/api/v1/chargers?lat=${location.lat}&lng=${location.lng}&radius=5`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || !isMounted) return;
          const sorted = (data.stations || [])
            .slice(0, 4)
            .map(s => ({ ...s, distKm: haversineKm(location.lat, location.lng, s.lat, s.lng) }));
          chargerCacheRef.current = { data: sorted, ts: Date.now() };
          if (isMounted) setChargers(sorted);
        })
    );

    if (!cachedToilets) fetches.push(
      fetch(`${API_BASE_URL}/api/v1/chargers?lat=${location.lat}&lng=${location.lng}&radius=3&poi_type=toilet`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || !isMounted) return;
          const sorted = (data.stations || [])
            .slice(0, 8)
            .map(s => ({ ...s, distKm: s.distKm ?? haversineKm(location.lat, location.lng, s.lat, s.lng) }));
          toiletCacheRef.current = { data: sorted, ts: Date.now() };
          if (isMounted) setToilets(sorted);
        })
    );

    if (!cachedAtms) fetches.push(
      fetch(`${API_BASE_URL}/api/v1/chargers?lat=${location.lat}&lng=${location.lng}&radius=2&poi_type=atm`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data || !isMounted) return;
          const sorted = (data.stations || [])
            .slice(0, 8)
            .map(s => ({ ...s, distKm: s.distKm ?? haversineKm(location.lat, location.lng, s.lat, s.lng) }));
          atmCacheRef.current = { data: sorted, ts: Date.now() };
          if (isMounted) setAtms(sorted);
        })
    );

    Promise.allSettled(fetches).then(() => {
      if (isMounted) setFuelLoading(false);
    });

    return () => { isMounted = false; };
  }, [tab, location, isDE]); // eslint-disable-line

  // ── Update markers when tab or data changes ─────────────────────────────
  useEffect(() => {
    if (tab === 0 || !fuelMapInstanceRef.current || fuelLoading) return;
    const { maps } = window.google;

    fuelMarkersRef.current.forEach(m => m.setMap(null));
    fuelMarkersRef.current = [];

    const items =
      tab === 1 ? fuelStations :
      tab === 2 ? chargers :
      tab === 3 ? toilets :
      atms;
    const color =
      tab === 1 ? "#0e1f8c" :
      tab === 2 ? "#1a7a3c" :
      tab === 3 ? "#7c3aed" :
      "#c07c00";
    const bounds = new maps.LatLngBounds();
    bounds.extend({ lat: location.lat, lng: location.lng });

    items.forEach((item, i) => {
      const pos    = { lat: item.lat, lng: item.lng };
      const isOpen = item.isOpen !== false;
      const marker = new maps.Marker({
        position: pos,
        map: fuelMapInstanceRef.current,
        label: { text: String(i + 1), color: "#fff", fontSize: "11px", fontWeight: "bold" },
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 13,
          fillColor: isOpen ? color : "#888888",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 100 - i,
      });
      fuelMarkersRef.current.push(marker);
      bounds.extend(pos);
    });

    if (items.length > 0) {
      fuelMapInstanceRef.current.fitBounds(bounds, { top: 24, right: 24, bottom: 24, left: 24 });
    }
  }, [tab, fuelStations, chargers, toilets, atms, fuelLoading]); // eslint-disable-line

  // ── Helpers ──────────────────────────────────────────────────────────────
  const switchTab = (next) => {
    setTab(next);
    setNavTarget(null);
  };

  const fmtDist = (km) => {
    if (km == null) return null;
    if (isUS) {
      const mi = km / 1.60934;
      if (mi < 0.1) return `${Math.round(km * 1000 * 3.28084)} ft`;
      return `${mi.toFixed(1)} mi`;
    }
    return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="mapContainer">
      {/* Tab bar — icon-only buttons so all five tabs fit on one line */}
      <div className="mapTabBar">
        {[
          {
            idx: 0, label: t.tabTraffic,
            icon: (
              <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                  <linearGradient id="mt-traffic-gb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b5bdb"/><stop offset="100%" stopColor="#0a1b6b"/>
                  </linearGradient>
                  <radialGradient id="mt-traffic-gs" cx="42%" cy="18%" r="68%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
                    <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
                    <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
                  </radialGradient>
                </defs>
                <rect width="32" height="32" rx="8" fill="url(#mt-traffic-gb)"/>
                <rect width="32" height="32" rx="8" fill="url(#mt-traffic-gs)"/>
                <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
                <g fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="11" y="4" width="10" height="22" rx="4" strokeWidth="1.8"/>
                  <circle cx="16" cy="10" r="3" fill="white" stroke="none"/>
                  <circle cx="16" cy="16" r="2.5" strokeWidth="1.5"/>
                  <circle cx="16" cy="22" r="2.5" strokeWidth="1.5"/>
                  <line x1="16" y1="26" x2="16" y2="30" strokeWidth="1.8"/>
                  <line x1="12" y1="30" x2="20" y2="30" strokeWidth="1.8"/>
                </g>
              </svg>
            ),
          },
          {
            idx: 1, label: t.swipeHintFuel,
            icon: (
              <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                  <linearGradient id="mt-fuel-gb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b5bdb"/><stop offset="100%" stopColor="#0a1b6b"/>
                  </linearGradient>
                  <radialGradient id="mt-fuel-gs" cx="42%" cy="18%" r="68%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
                    <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
                    <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
                  </radialGradient>
                </defs>
                <rect width="32" height="32" rx="8" fill="url(#mt-fuel-gb)"/>
                <rect width="32" height="32" rx="8" fill="url(#mt-fuel-gs)"/>
                <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
                <g fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="5" width="13" height="22" rx="2.5"/>
                  <rect x="9" y="8" width="7" height="5" rx="1" fill="rgba(255,255,255,0.22)" strokeWidth="1.4"/>
                  <path d="M19,11 L25,11 L25,20"/>
                  <path d="M23,20 h4 a1,1 0 0 1 1,1 v2 H23"/>
                  <line x1="5" y1="27" x2="20" y2="27"/>
                </g>
              </svg>
            ),
          },
          {
            idx: 2, label: t.swipeHintCharger,
            icon: (
              <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                  <linearGradient id="mt-ev-gb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34a853"/><stop offset="100%" stopColor="#0a4523"/>
                  </linearGradient>
                  <radialGradient id="mt-ev-gs" cx="42%" cy="18%" r="68%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
                    <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
                    <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
                  </radialGradient>
                </defs>
                <rect width="32" height="32" rx="8" fill="url(#mt-ev-gb)"/>
                <rect width="32" height="32" rx="8" fill="url(#mt-ev-gs)"/>
                <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
                <path fill="white" d="M20,3 L10,18 L17,18 L12,29 L22,14 L15,14 Z"/>
              </svg>
            ),
          },
          {
            idx: 3, label: t.swipeHintToilet,
            icon: (
              <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                  <linearGradient id="mt-wc-gb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6"/><stop offset="100%" stopColor="#4c1d95"/>
                  </linearGradient>
                  <radialGradient id="mt-wc-gs" cx="42%" cy="18%" r="68%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
                    <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
                    <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
                  </radialGradient>
                </defs>
                <rect width="32" height="32" rx="8" fill="url(#mt-wc-gb)"/>
                <rect width="32" height="32" rx="8" fill="url(#mt-wc-gs)"/>
                <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
                <g fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="16" y1="5" x2="16" y2="28" strokeWidth="1.2" strokeOpacity="0.45"/>
                  <circle cx="9" cy="8" r="2.5" strokeWidth="1.6"/>
                  <line x1="9" y1="10.5" x2="9" y2="20" strokeWidth="1.6"/>
                  <line x1="6" y1="15" x2="12" y2="15" strokeWidth="1.6"/>
                  <line x1="9" y1="20" x2="6.5" y2="27" strokeWidth="1.6"/>
                  <line x1="9" y1="20" x2="11.5" y2="27" strokeWidth="1.6"/>
                  <circle cx="23" cy="8" r="2.5" strokeWidth="1.6"/>
                  <line x1="23" y1="10.5" x2="23" y2="14" strokeWidth="1.6"/>
                  <path d="M19,15 h8 L25.5,27 H20.5 Z" strokeWidth="1.6"/>
                </g>
              </svg>
            ),
          },
          {
            idx: 4, label: t.swipeHintAtm,
            icon: (
              <svg width="22" height="22" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <defs>
                  <linearGradient id="mt-atm-gb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fbbf24"/><stop offset="100%" stopColor="#78350f"/>
                  </linearGradient>
                  <radialGradient id="mt-atm-gs" cx="42%" cy="18%" r="68%">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.52)"/>
                    <stop offset="55%" stopColor="rgba(255,255,255,0.06)"/>
                    <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
                  </radialGradient>
                </defs>
                <rect width="32" height="32" rx="8" fill="url(#mt-atm-gb)"/>
                <rect width="32" height="32" rx="8" fill="url(#mt-atm-gs)"/>
                <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
                <rect x="5" y="9" width="22" height="14" rx="2.5" fill="none" stroke="white" strokeWidth="1.7"/>
                <rect x="5" y="13" width="22" height="3" fill="rgba(255,255,255,0.55)" stroke="none"/>
                <rect x="9" y="18" width="5" height="3.5" rx="1" fill="none" stroke="white" strokeWidth="1.4"/>
                <path d="M21,22 A2,2,0,0,1,21,18" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M21,24 A4,4,0,0,1,21,16" fill="none" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M21,26 A6,6,0,0,1,21,14" fill="none" stroke="white" strokeWidth="1.0" strokeLinecap="round"/>
              </svg>
            ),
          },
        ].map(({ idx, icon, label }) => (
          <button
            key={idx}
            className={`mapTabBtn${tab === idx ? " mapTabBtn--active" : ""}`}
            onClick={() => switchTab(idx)}
            aria-label={label}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>

      {message && <p className="mapMessage">{message}</p>}

      {/* Traffic map — always mounted, hidden when on panel tab */}
      <div
        ref={mapRef}
        className="mapCanvas"
        style={tab !== 0 ? { display: "none" } : {}}
      />

      {/* Panel (Fuel / Charger / Toilet / ATM) — kept mounted after first visit,
           hidden via display:none when on the traffic tab so the map instance
           stays bound to the same DOM node across tab switches. */}
      {(tab > 0 ? (panelEverOpenedRef.current = true) : panelEverOpenedRef.current) && (
        <MapPanel
          ref={fuelMapDivRef}
          tab={tab}
          style={tab === 0 ? { display: "none" } : undefined}
          fuelStations={fuelStations}
          chargers={chargers}
          toilets={toilets}
          atms={atms}
          fuelLoading={fuelLoading}
          isUS={isUS}
          isDE={isDE}
          t={t}
          fmtDist={fmtDist}
          onNavigate={(item, mode) => setNavTarget({ ...item, mode })}
        />
      )}

      {navTarget && (
        <NavPromptSheet
          name={navTarget.brand || navTarget.name}
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
