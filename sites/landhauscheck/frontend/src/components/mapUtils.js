/**
 * Shared Google Maps utilities used by GoogleMapWidget, RoutingWidget, and TransitWidget.
 *
 * Keeping these here avoids a circular dependency: all three widgets need
 * loadGoogleMapsScript and MAP_STYLES, but they must not import from each other.
 */

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Singleton promise — the Maps script is loaded exactly once per page load.
let _scriptPromise = null;

/**
 * Load the Google Maps JavaScript API script.
 * Returns the same promise on subsequent calls so the script is not duplicated.
 * @returns {Promise<void>}
 */
export function loadGoogleMapsScript() {
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", resolve);
    script.addEventListener("error", () => {
      _scriptPromise = null;
      reject(new Error("Failed to load Google Maps script"));
    });
    document.head.appendChild(script);
  });
  return _scriptPromise;
}

/** Custom map style palette — applied to all Google Maps instances in this app. */
export const MAP_STYLES = [
  { featureType: "landscape",       elementType: "geometry",           stylers: [{ color: "#eef4fb" }] },
  { featureType: "water",           elementType: "geometry",           stylers: [{ color: "#1450c4" }] },
  { featureType: "water",           elementType: "labels.text.fill",   stylers: [{ color: "#a0d0f8" }] },
  { featureType: "poi.park",        elementType: "geometry",           stylers: [{ color: "#cde2f4" }] },
  { featureType: "poi.park",        elementType: "labels.text.fill",   stylers: [{ color: "#3a6ea5" }] },
  { featureType: "poi",             elementType: "geometry",           stylers: [{ color: "#dce9f6" }] },
  { featureType: "poi",             elementType: "labels.text.fill",   stylers: [{ color: "#5577a8" }] },
  { featureType: "poi",             elementType: "labels.icon",        stylers: [{ visibility: "off" }] },
  { featureType: "road.highway",    elementType: "geometry.fill",      stylers: [{ color: "#1450c4" }] },
  { featureType: "road.highway",    elementType: "geometry.stroke",    stylers: [{ color: "#0e1f8c" }] },
  { featureType: "road.highway",    elementType: "labels.text.fill",   stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway",    elementType: "labels.text.stroke", stylers: [{ color: "#0e1f8c" }] },
  { featureType: "road.arterial",   elementType: "geometry",           stylers: [{ color: "#b8cfe8" }] },
  { featureType: "road.arterial",   elementType: "labels.text.fill",   stylers: [{ color: "#1a3d78" }] },
  { featureType: "road.local",      elementType: "geometry",           stylers: [{ color: "#d5e5f5" }] },
  { featureType: "road.local",      elementType: "labels.text.fill",   stylers: [{ color: "#3060a0" }] },
  { featureType: "transit.line",    elementType: "geometry",           stylers: [{ color: "#30a8fc" }] },
  { featureType: "transit.station", elementType: "labels.text.fill",   stylers: [{ color: "#1a3d78" }] },
  { featureType: "administrative",  elementType: "geometry.stroke",    stylers: [{ color: "#7aaad4" }] },
  { featureType: "administrative",  elementType: "labels.text.fill",   stylers: [{ color: "#0e1f8c" }] },
  { featureType: "all",             elementType: "labels.text.stroke", stylers: [{ color: "#eef4fb" }, { weight: 2 }] },
];

/**
 * Haversine distance between two WGS-84 coordinates in kilometres.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
