import { useEffect, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";

function fmtCountdown(s) {
  if (s === null || s === undefined) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function AppConsole({
  onClose,
  apiBaseUrl,
  healthState,
  wakeLockStatus,
  geoPermState,
  locationSource,
  locationAccuracy,
  location,
  lang,
  statuses,
  errors,
  countdowns,
  onChangeLocation,
  consoleLogs,
}) {
  const [awsLogs, setAwsLogs] = useState([]);
  const [awsLogsLoading, setAwsLogsLoading] = useState(false);
  const [awsLogsError, setAwsLogsError] = useState("");

  // Fetch CloudWatch logs on mount (console is only rendered when open)
  useEffect(() => {
    setAwsLogsLoading(true);
    setAwsLogsError("");
    fetch(`${apiBaseUrl}/api/v1/logs?minutes=10`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((data) => setAwsLogs(data))
      .catch((error) => {
        setAwsLogs([]);
        setAwsLogsError(`CloudWatch logs unavailable: ${error.message}. See App events for request details.`);
      })
      .finally(() => setAwsLogsLoading(false));
  }, [apiBaseUrl]);

  void lang; // passed for future i18n use in console labels

  return (
    <div className="consoleOverlay" role="dialog" aria-modal="true" aria-label="System Console">
      <div className="consoleOverlay__card">
        <div className="consoleOverlay__header">
          <span className="consoleOverlay__title">Diagnostics Console</span>
          <button className="consoleOverlay__close" onClick={onClose} aria-label="Close console">✕</button>
        </div>
        <div className="consoleOverlay__body">
          <div className="consoleOverlay__status">
            {/* ── System ── */}
            <div className="consoleOverlay__sectionInline">System</div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Page origin</span>
              <span style={{ overflowWrap: "anywhere" }}>{window.location.origin}</span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">API</span>
              <span>{apiBaseUrl}</span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Health</span>
              <span style={{ color: healthState.status === "ok" ? "#30d158" : healthState.isLoading ? "#ffd60a" : "#ff453a" }}>
                {healthState.isLoading ? "checking…" : `${healthState.status} — ${healthState.detail}`}
                {healthState.status === "error" && " — See App events below for request and browser policy details."}
              </span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Protocol</span>
              <span style={{ color: window.location.protocol === "https:" ? "#30d158" : "#ff453a" }}>
                {window.location.protocol}{window.location.protocol !== "https:" ? " ⚠ geolocation requires HTTPS" : " ✓"}
              </span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Build</span>
              <span>{import.meta.env.MODE}</span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Wake Lock</span>
              <span style={{ color: wakeLockStatus === "active" ? "#30d158" : wakeLockStatus === "unsupported" ? "#8e8e93" : "#ff453a" }}>
                {wakeLockStatus === "active"       ? "active — display will stay on ✓"
                  : wakeLockStatus === "unsupported" ? "not supported by this browser"
                  : wakeLockStatus === "denied"      ? "denied by browser/OS ✗"
                  : wakeLockStatus}
              </span>
            </div>

            {/* ── Browser ── */}
            <div className="consoleOverlay__sectionInline">Browser</div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Network state</span>
              <span>{navigator.onLine ? "Online (API reachability not guaranteed)" : "Offline"}</span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Language</span>
              <span>{navigator.language}</span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Screen</span>
              <span>{screen.width}×{screen.height} @ {window.devicePixelRatio}x</span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Connection</span>
              <span>
                {navigator.connection
                  ? `${navigator.connection.effectiveType ?? "?"}${navigator.connection.type ? ` (${navigator.connection.type})` : ""}`
                  : "API not available"}
              </span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">User-Agent</span>
              <span style={{ wordBreak: "break-all", fontSize: "0.65rem" }}>{navigator.userAgent}</span>
            </div>

            {/* ── Location ── */}
            <div className="consoleOverlay__sectionInline">Location</div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Geolocation API</span>
              <span style={{ color: navigator.geolocation ? "#30d158" : "#ff453a" }}>
                {navigator.geolocation ? "available ✓" : "not supported ✗"}
              </span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Permission</span>
              <span style={{ color: geoPermState === "granted" ? "#30d158" : geoPermState === "denied" ? "#ff453a" : "#ffd60a" }}>
                {geoPermState}
              </span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Source</span>
              <span>
                {locationSource === "gps"
                  ? `GPS${locationAccuracy !== null ? ` (±${locationAccuracy} m)` : ""}`
                  : locationSource === "manual" ? "Manual entry"
                  : "—"}
              </span>
            </div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Koordinaten</span>
              <span>
                {location
                  ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${location.label ? ` · ${location.label}` : ""}`
                  : "nicht ermittelt"}
                {" "}
                <button className="consoleOverlay__changeBtn" onClick={onChangeLocation}>ändern</button>
              </span>
            </div>

            {/* ── Widgets ── */}
            <div className="consoleOverlay__sectionInline">Widgets</div>
            {[
              { label: "🗺 Karte",       status: statuses.map,     error: errors.map,     extra: countdowns.map     !== null ? `· nächste: ${fmtCountdown(countdowns.map)}`     : "" },
              { label: "🗑 Abfall",       status: statuses.garbage,  error: errors.garbage, extra: "" },
              { label: "🚉 Bahnhöfe",    status: statuses.transit,  error: errors.transit, extra: "" },
              { label: "📍 In der Nähe", status: statuses.poi,      error: errors.poi,     extra: "" },
              { label: "🧭 Routing",     status: statuses.routing,  error: "",             extra: countdowns.routing !== null ? `· nächste: ${fmtCountdown(countdowns.routing)}` : "" },
            ].map(({ label, status, error, extra }) => {
              const col = status === "ok" ? "#30d158"
                : status === "error" || status === "no-match" ? "#ff453a"
                : status === "loading" ? "#ffd60a"
                : "#8e8e93";
              return (
                <div key={label} className="consoleOverlay__statusRow">
                  <span className="consoleOverlay__statusKey">{label}</span>
                  <span style={{ color: col }}>
                    {status}{extra ? ` ${extra}` : ""}
                    {error ? <span style={{ color: "#ff453a", marginLeft: "0.5rem" }}>— {error}</span> : null}
                  </span>
                </div>
              );
            })}

            {/* ── Keys ── */}
            <div className="consoleOverlay__sectionInline">API Keys</div>
            <div className="consoleOverlay__statusRow">
              <span className="consoleOverlay__statusKey">Google Maps</span>
              <span style={{ color: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? "#30d158" : "#ff453a" }}>
                {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? "present ✓" : "MISSING ✗"}
              </span>
            </div>
          </div>

          {/* AWS CloudWatch logs */}
          <div className="consoleOverlay__sectionLabel">
            ☁ CloudWatch — last 10 min
            {awsLogsLoading && <span className="consoleOverlay__spinner"> loading…</span>}
          </div>
          <div className="consoleOverlay__logs consoleOverlay__logs--aws" aria-live="polite">
            {awsLogsError && (
              <div className="consoleOverlay__logEntry" role="alert">
                <span className="consoleOverlay__logMsg">{awsLogsError}</span>
              </div>
            )}
            {!awsLogsLoading && !awsLogsError && awsLogs.length === 0 && (
              <div className="consoleOverlay__logEntry consoleOverlay__logEntry--muted">
                <span className="consoleOverlay__logMsg">No entries (not running in AWS or no recent logs)</span>
              </div>
            )}
            {awsLogs.map((entry, i) => (
              <div key={i} className="consoleOverlay__logEntry consoleOverlay__logEntry--aws">
                <span className="consoleOverlay__logTs">{entry.ts}</span>
                <span className="consoleOverlay__logStream">{entry.stream?.split("/").pop()}</span>
                <span className="consoleOverlay__logMsg">{entry.message}</span>
              </div>
            ))}
          </div>

          {/* Frontend / app logs */}
          <div className="consoleOverlay__sectionLabel">⚡ App events</div>
          <p style={{ fontSize: "0.75rem" }}>
            Failed requests include endpoint, timing and network context. CSP events identify
            browser policy blocks when reported. Other network failures may require Chrome
            DevTools to distinguish CORS, DNS, TLS or filtering. URL queries are omitted.
            Most recent 100 events shown, newest first.
          </p>
          <div className="consoleOverlay__logs" aria-live="polite">
            {[...consoleLogs].reverse().map((entry, i) => (
              <div key={i} className="consoleOverlay__logEntry">
                <span className="consoleOverlay__logTs">{entry.ts}</span>
                <span className="consoleOverlay__logMsg">{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
