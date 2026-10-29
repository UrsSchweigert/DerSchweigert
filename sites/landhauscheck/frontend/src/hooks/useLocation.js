import { useCallback, useEffect, useRef, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";

export function useLocation() {
  const [location, setLocation] = useState(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [geoPermState, setGeoPermState] = useState("unknown");
  const [locationSource, setLocationSource] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(null);
  const [geoInfo, setGeoInfo] = useState({ countryCode: "DE", stateCode: "BY" });
  const gpsAttemptRef = useRef(0);

  // ── Scroll lock ─────────────────────────────────────────────────────────
  // In portrait mode .layout is the sole scroll container (overflow-y: auto).
  // Without a lock, iOS Safari can shift .layout.scrollTop while the picker's
  // address keyboard is open; when the picker closes widgets reappear at that
  // shifted position, making the background look broken.
  // Setting overflowY = "hidden" on .layout is the reliable scroll-lock for
  // this scroll-container-based layout — no position:fixed trickery needed.
  useEffect(() => {
    if (!locationPickerOpen) return;

    const layout = document.querySelector(".layout");
    if (!layout) return;
    layout.style.overflowY = "hidden";

    return () => {
      layout.style.overflowY = "";
      // Picking a new location means fresh widget data — always start from top.
      layout.scrollTop = 0;
    };
  }, [locationPickerOpen]);

  const attemptGPS = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoPermState("unsupported");
      setLocationPickerOpen(true);
      return;
    }
    const attempt = ++gpsAttemptRef.current;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (attempt !== gpsAttemptRef.current) return;
        setLocation({ lat: coords.latitude, lng: coords.longitude });
        setGeoPermState("granted");
        setLocationDenied(false);
        // Do NOT call setLocationPickerOpen(false) here.
        // onRetryGPS (GPS button) closes the picker before calling attemptGPS,
        // so the picker is already closed when this succeeds via the button flow.
        // If GPS resolves while the picker is user-intentionally open, closing it
        // automatically would be unexpected — the user must close it via an action.
        setLocationSource("gps");
        setLocationAccuracy(Math.round(coords.accuracy));
      },
      (err) => {
        if (attempt !== gpsAttemptRef.current) return;
        if (err.code === 1) {
          setGeoPermState("denied");
          setLocationDenied(true);
        } else {
          setGeoPermState("unavailable");
        }
        setLocationPickerOpen(true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  // Show consent/location picker immediately if user has not yet consented.
  // Only attempt GPS automatically when consent is already stored.
  useEffect(() => {
    const hasConsent = !!localStorage.getItem("lhc_consent");
    if (!hasConsent) {
      setLocationPickerOpen(true);
    } else {
      attemptGPS();
    }
  }, [attemptGPS]);

  // Reverse-geocode to get country + state whenever location changes
  useEffect(() => {
    if (!location) return;
    fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${location.lat}&longitude=${location.lng}&localityLanguage=en`
    )
      .then((r) => r.json())
      .then((data) => {
        const cc = data.countryCode || "DE";
        // principalSubdivisionCode is e.g. "DE-BY", "FR-75", "AT-1"
        const sub = data.principalSubdivisionCode?.split("-")[1] || null;
        setGeoInfo({ countryCode: cc, stateCode: cc === "DE" ? sub : null });
      })
      .catch(() => {}); // fail silently — default DE remains
  }, [location]);

  const handleManualLocation = useCallback((loc) => {
    setLocation(loc);
    setLocationSource("manual");
    setLocationAccuracy(null);
    setLocationPickerOpen(false);
    // Immediately apply countryCode from geocode result so unit system
    // (°F/km vs °C/km) switches without waiting for the BigDataCloud round-trip
    if (loc.countryCode) {
      setGeoInfo((prev) => ({ ...prev, countryCode: loc.countryCode }));
    }
  }, []);

  // Exposed setter for user-initiated opens (📍 button, AppConsole change-location).
  // Invalidates any pending GPS call so its success callback cannot dismiss the picker
  // the user just manually opened (race condition: GPS resolves 4–15 s after mount).
  const openLocationPicker = useCallback(() => {
    gpsAttemptRef.current++; // stale any in-flight getCurrentPosition
    setLocationPickerOpen(true);
  }, []);

  return {
    location,
    locationPickerOpen,
    openLocationPicker,
    setLocationPickerOpen,
    locationDenied,
    geoPermState,
    locationSource,
    locationAccuracy,
    geoInfo,
    attemptGPS,
    handleManualLocation,
  };
}
