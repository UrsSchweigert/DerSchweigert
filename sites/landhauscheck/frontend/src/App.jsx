import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClockWidget from "./components/ClockWidget";
import GarbageWidget from "./components/GarbageWidget";
import LocationPicker from "./components/LocationPicker";
import MapWidget from "./components/GoogleMapWidget";
import PoiWidget from "./components/PoiWidget";
import TransitWidget from "./components/TransitWidget";
import AppConsole from "./components/AppConsole";
import { API_BASE_URL } from "./config/api";
import { useLocation } from "./hooks/useLocation";
import { useHealth } from "./hooks/useHealth";
import { useWakeLock } from "./hooks/useWakeLock";
import { useWidgetStatus } from "./hooks/useWidgetStatus";
import { useAppConsole } from "./hooks/useAppConsole";
import { usePushNotifications } from "./hooks/usePushNotifications";
import {
  DEFAULT_WIDGET_LAYOUT_STRATEGY,
  WIDGET_LAYOUT_STRATEGIES,
} from "./config/widgetLayoutConfig";
import { detectLang, persistLang, translations, SUPPORTED_LANGS, LANG_LABELS } from "./config/i18n";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] caught:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "0.8rem", color: "#9b2b2b", fontSize: "0.85rem" }}>
          <strong>Widget crashed:</strong> {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function computeWidgetGridDimensions(widgetCount, strategy) {
  if (widgetCount <= 1) {
    return { columns: 1, rows: 1 };
  }

  switch (strategy) {
    case WIDGET_LAYOUT_STRATEGIES.SINGLE_ROW:
      return { columns: widgetCount, rows: 1 };
    case WIDGET_LAYOUT_STRATEGIES.SINGLE_COLUMN:
      return { columns: 1, rows: widgetCount };
    case WIDGET_LAYOUT_STRATEGIES.TWO_COLUMNS: {
      const columns = Math.min(2, widgetCount);
      return { columns, rows: Math.ceil(widgetCount / columns) };
    }
    case WIDGET_LAYOUT_STRATEGIES.THREE_COLUMNS: {
      const columns = Math.min(3, widgetCount);
      return { columns, rows: Math.ceil(widgetCount / columns) };
    }
    case WIDGET_LAYOUT_STRATEGIES.AUTO_SQUARE:
    default: {
      const columns = Math.ceil(Math.sqrt(widgetCount));
      return { columns, rows: Math.ceil(widgetCount / columns) };
    }
  }
}

// intervalMs = null → always live (clock); set to widget's refresh period otherwise
function LiveBadge({ lastUpdated, status, intervalMs, lang }) {
  const t = translations[lang] || translations.de;
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const isOk = status === "ok" || status === "connected" || status === "no-match";
  let dot, label, color;

  if (status === "error") {
    dot = "●"; color = "#ff453a"; label = t.liveError;
  } else if (!isOk || !lastUpdated) {
    dot = "◌"; color = "#8e8e93"; label = t.liveLoading;
  } else if (intervalMs == null) {
    // No interval — always live (clock ticks every second)
    dot = "●"; color = "#30d158"; label = "live";
  } else {
    const remaining = Math.max(0, intervalMs - (Date.now() - lastUpdated));
    // Show "live" for the first 5% of the interval (min 30s, max 5 min)
    const liveWindow = Math.min(Math.max(intervalMs * 0.05, 30_000), 5 * 60_000);
    if (remaining > intervalMs - liveWindow) {
      dot = "●"; color = "#30d158"; label = "live";
    } else if (remaining < 60_000) {
      dot = "●"; color = "#30d158"; label = t.liveUpdateIn(Math.ceil(remaining / 1000), "s");
    } else {
      const mins = Math.ceil(remaining / 60_000);
      color = remaining < intervalMs * 0.15 ? "#ffd60a" : "#30d158";
      dot = "●"; label = t.liveUpdateIn(mins, "m");
    }
  }

  const isPulsing = color === "#30d158" && label === "live";
  return (
    <span className={`liveBadge${isPulsing ? " liveBadge--pulse" : ""}`} style={{ "--badge-color": color }}>
      <span className="liveBadge__dot">{dot}</span>
      <span className="liveBadge__label">{label}</span>
    </span>
  );
}

// One entry per widget — order determines grid order.
// Add a new widget here + a case in the article renderer below.
const WIDGETS = [
  { id: "garbage", cssClass: "" },
  { id: "clock",   cssClass: "" },
  { id: "map",      cssClass: "widgetCard--map" },
  { id: "transit", cssClass: "" },
  { id: "poi",     cssClass: "" },
];

function App() {
  const apiBaseUrl = API_BASE_URL;

  const [lang, setLang] = useState(() => detectLang());
  const t = translations[lang] || translations.de;
  const changeLang = useCallback((l) => { persistLang(l); setLang(l); }, []);

  const [consoleOpen, setConsoleOpen] = useState(false);

  const {
    location, locationPickerOpen, setLocationPickerOpen, openLocationPicker,
    locationDenied, geoPermState, locationSource, locationAccuracy,
    geoInfo, attemptGPS, handleManualLocation,
  } = useLocation();

  const { healthState } = useHealth(apiBaseUrl);
  const { wakeLockStatus } = useWakeLock();

  const { statuses, errors, countdowns, lastUpdated, on, setError, setCountdown } = useWidgetStatus();
  const { consoleLogs, addLog } = useAppConsole();

  const [tomorrowGarbage, setTomorrowGarbage] = useState([]);
  const [tomorrowDismissed, setTomorrowDismissed] = useState(false);
  const handleTomorrowEvents = useCallback((events) => {
    setTomorrowGarbage(events);
    // Reset dismissal when fresh data arrives (e.g. new day or location change)
    setTomorrowDismissed(false);
  }, []);

  const { isSupported: notifSupported, isEnabled: notifEnabled, isDenied: notifDenied,
    requestPermission, markCalendarExported, calExported } =
    usePushNotifications(location, lang);

  // ── ICS calendar URLs (always absolute so webcal:// scheme works) ─────────
  // An absolute base also keeps webcal:// subscriptions and calendar imports valid.
  const icsUrl = useMemo(() => {
    if (!location) return null;
    return `${apiBaseUrl}/api/v1/waste/calendar.ics?lat=${location.lat}&lng=${location.lng}`;
  }, [location]);

  // ── Bell-button toast ────────────────────────────────────────────────────
  const [notifPending, setNotifPending] = useState(false);
  const [notifToast, setNotifToast] = useState(null); // { key, msg } | null
  const notifToastTimerRef = useRef(null);
  const notifToastKeyRef   = useRef(0);

  // ── Calendar picker modal ─────────────────────────────────────────────────
  const [calPickerOpen, setCalPickerOpen] = useState(false);

  const handleRequestPermission = useCallback(async () => {
    setNotifPending(true);
    try {
      const result = await requestPermission();
      const isIOS = navigator.maxTouchPoints > 1 && /Apple/.test(navigator.vendor);
      let msg;
      if (result === "granted") {
        // Open the calendar picker immediately so the user can choose their
        // preferred app.  The webcal/download action fires from the picker.
        setCalPickerOpen(true);
        msg = isIOS ? t.notifIOSTip : t.notifGrantedToast;
      } else if (result === "denied") {
        msg = t.notifDenied;
      }
      if (msg) {
        clearTimeout(notifToastTimerRef.current);
        setNotifToast({ key: ++notifToastKeyRef.current, msg });
        notifToastTimerRef.current = setTimeout(() => setNotifToast(null), 5000);
      }
    } finally {
      setNotifPending(false);
    }
  }, [requestPermission, t]);
  useEffect(() => () => clearTimeout(notifToastTimerRef.current), []);

  // Cross-hook logging effects
  useEffect(() => {
    if (!healthState.isLoading) addLog(`Health ${healthState.status}: ${healthState.detail}`);
  }, [healthState.status, healthState.detail, healthState.isLoading, addLog]);
  useEffect(() => { addLog(`Map: ${statuses.map}`); }, [statuses.map, addLog]);
  useEffect(() => { addLog(`Routing: ${statuses.routing}`); }, [statuses.routing, addLog]);
  useEffect(() => { if (locationDenied) addLog("Location access denied"); }, [locationDenied, addLog]);

  const [widgetLayoutStrategy] = useState(DEFAULT_WIDGET_LAYOUT_STRATEGY);
  const { columns: widgetGridColumns, rows: widgetGridRows } = useMemo(
    () => computeWidgetGridDimensions(WIDGETS.length, widgetLayoutStrategy),
    [widgetLayoutStrategy],
  );

  return (
    <main className="layout">
      {consoleOpen && (
        <AppConsole
          onClose={() => setConsoleOpen(false)}
          apiBaseUrl={apiBaseUrl}
          healthState={healthState}
          wakeLockStatus={wakeLockStatus}
          geoPermState={geoPermState}
          locationSource={locationSource}
          locationAccuracy={locationAccuracy}
          location={location}
          lang={lang}
          statuses={statuses}
          errors={errors}
          countdowns={countdowns}
          onChangeLocation={() => { setConsoleOpen(false); openLocationPicker(); }}
          consoleLogs={consoleLogs}
        />
      )}
      {locationPickerOpen && (
        <LocationPicker
          gpsDenied={locationDenied}
          lang={lang}
          onLangChange={changeLang}
          onLocation={handleManualLocation}
          onRetryGPS={() => { setLocationPickerOpen(false); attemptGPS(); }}
        />
      )}
      <section className="panel">
        {/* ── Mobile portrait banner — hidden on all other devices/orientations via CSS ── */}
        <div className="appBanner">
          <img className="appBanner__logo" src="/logo.png" alt="" aria-hidden="true" />
          <div className="appBanner__text" aria-hidden="true">
            <span className="appBanner__name">landhauscheck</span>
            <span className="appBanner__sub">{t.bannerTagline}</span>
          </div>
          <a
            href="/help.html"
            target="_blank"
            rel="noopener"
            className="appBanner__helpBtn"
            aria-label={t.help}
          >?</a>
        </div>
        {tomorrowGarbage.length > 0 && !tomorrowDismissed && (
          <div className="garbageTomorrowBanner" role="alert" aria-live="polite">
            <span className="garbageTomorrowBanner__text">
              {t.wasteTomorrowAlert(tomorrowGarbage.map((ev) => ev.summary).join(", "))}
            </span>
            <button
              className="garbageTomorrowBanner__close"
              onClick={() => setTomorrowDismissed(true)}
              aria-label={t.tapToClose}
            >
              ×
            </button>
          </div>
        )}
        <section className="widgetsSection">
          <div
            className="widgetGrid"
            style={{ "--widget-columns": widgetGridColumns, "--widget-rows": widgetGridRows }}
            aria-live="polite"
          >
            {WIDGETS.map(({ id, cssClass }) => (
              <article
                className={`widgetCard${cssClass ? ` ${cssClass}` : ""}`}
                key={id}
                data-widget={id}
              >
                {id === "garbage" ? (
                  <ErrorBoundary>
                    <GarbageWidget
                      location={location} countryCode={geoInfo.countryCode} stateCode={geoInfo.stateCode}
                      onStatusChange={on.garbage} onError={setError.garbage}
                      onTomorrowEvents={handleTomorrowEvents} lang={lang}
                    />
                    <LiveBadge lastUpdated={lastUpdated.garbage} status={statuses.garbage} intervalMs={60 * 60_000} lang={lang} />
                  </ErrorBoundary>
                ) : id === "clock" ? (
                  <>
                    <ClockWidget onOpen={() => setConsoleOpen(true)} location={location} lang={lang} countryCode={geoInfo.countryCode} />
                    <LiveBadge lastUpdated={lastUpdated.clock} status="ok" intervalMs={null} lang={lang} />
                  </>
                ) : id === "map" ? (
                  <ErrorBoundary>
                    <MapWidget
                      location={location} locationSource={locationSource} lang={lang} countryCode={geoInfo?.countryCode || "DE"}
                      onStatusChange={on.map} onCountdown={setCountdown.map} onError={setError.map}
                    />
                    <LiveBadge lastUpdated={lastUpdated.map} status={statuses.map} intervalMs={5 * 60_000} lang={lang} />
                  </ErrorBoundary>
                ) : id === "transit" ? (
                  <ErrorBoundary>
                    <TransitWidget
                      location={location} onStatusChange={on.transit}
                      onCountdown={setCountdown.transit} onError={setError.transit}
                      lang={lang} countryCode={geoInfo.countryCode}
                    />
                    <LiveBadge lastUpdated={lastUpdated.transit} status={statuses.transit} intervalMs={30 * 60_000} lang={lang} />
                  </ErrorBoundary>
                ) : id === "poi" ? (
                  <ErrorBoundary>
                    <PoiWidget
                      location={location} onStatusChange={on.poi}
                      onError={setError.poi}
                      lang={lang} countryCode={geoInfo.countryCode}
                    />
                    <LiveBadge lastUpdated={lastUpdated.poi} status={statuses.poi} intervalMs={120 * 60_000} lang={lang} />
                  </ErrorBoundary>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <footer className="appFooter">
          <div className="appFooter__row">
            <a href="/help.html" target="_blank" rel="noopener" className="appFooter__link">{t.help}</a>
            <span className="appFooter__sep">·</span>
            <a href="/impressum.html" target="_blank" rel="noopener" className="appFooter__link">{t.impressum}</a>
            <span className="appFooter__sep">·</span>
            <a href="/datenschutz.html" target="_blank" rel="noopener" className="appFooter__link">{t.datenschutz}</a>
          </div>
          <div className="appFooter__row">
            <a href="/donate.html" target="_blank" rel="noopener" className="appFooter__link">{t.donate}</a>
            <span className="appFooter__sep">·</span>
            <a href="/release-notes.html" target="_blank" rel="noopener" className="appFooter__link appFooter__version">
              {t.releaseNotes} <span className="appFooter__versionBadge">v{__APP_VERSION__}</span>
            </a>
          </div>
          <div className="appFooter__row">
            <div className="langSwitcher">
              {SUPPORTED_LANGS.map(l => (
                <button
                  key={l}
                  className={`langSwitcher__btn${lang === l ? " langSwitcher__btn--active" : ""}`}
                  onClick={() => changeLang(l)}
                  aria-pressed={lang === l}
                >{LANG_LABELS[l]}</button>
              ))}
            </div>
            <span className="appFooter__sep">·</span>
            <button
              className="appFooter__resetBtn"
              onClick={() => openLocationPicker()}
              title={t.resetBtn}
            >
              📍
            </button>
            {notifSupported && (
              <>
                <span className="appFooter__sep">·</span>
                <button
                  className={`appFooter__resetBtn${notifEnabled ? " appFooter__resetBtn--active" : ""}${notifPending ? " appFooter__resetBtn--pending" : ""}`}
                  onClick={notifEnabled || notifDenied ? undefined : handleRequestPermission}
                  disabled={notifDenied || notifPending}
                  title={notifDenied ? t.notifDenied : notifEnabled ? t.notifEnabled : t.notifEnable}
                  aria-label={notifDenied ? t.notifDenied : notifEnabled ? t.notifEnabled : t.notifEnable}
                >
                  {notifDenied ? "🔕" : "🔔"}
                </button>
                {/* Calendar picker button — always available once notifications
                    are granted.  Opens the CalendarPickerModal so the user can
                    choose Apple Calendar (webcal://) or download the .ics for
                    Google Calendar / Outlook / other apps.  Turns green once
                    any export has been performed for the current location. */}
                {notifEnabled && (
                  <>
                    <span className="appFooter__sep">·</span>
                    <button
                      className={`appFooter__resetBtn${calExported ? " appFooter__resetBtn--active" : ""}`}
                      onClick={() => setCalPickerOpen(true)}
                      title={calExported ? t.calExportedTitle : t.calExportBtn}
                      aria-label={calExported ? t.calExportedTitle : t.calExportBtn}
                    >
                      📅
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          {notifToast && (
            <p key={notifToast.key} className="notifToast">{notifToast.msg}</p>
          )}
        </footer>
      </section>

      {/* ── Calendar picker modal ─────────────────────────────────────── */}
      {calPickerOpen && icsUrl && (
        <div
          className="calPicker__backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t.calPickerTitle}
          onClick={() => setCalPickerOpen(false)}
        >
          <div className="calPicker__sheet" onClick={e => e.stopPropagation()}>
            <p className="calPicker__title">{t.calPickerTitle}</p>

            {/*
              Open the dedicated calendar-import.html page instead of attempting
              any download directly from the modal.

              Why: from a standalone PWA (WKWebView) ANY navigation — whether
              window.open(), window.location.href, or an <a> anchor — stays
              inside the WKWebView sandbox.  WKWebView has no download manager,
              so requests that return Content-Disposition:attachment just show a
              blank stalled page.

              calendar-import.html is a static page served from the same origin.
              Because it is a normal top-level navigation the tab already IS in
              Safari (the user opened the page from the Home Screen, which uses
              the default browser for outbound links from the PWA shell on iOS
              17+).  On that real Safari page the ICS link with
              Content-Disposition:attachment triggers the "Add to Calendar" sheet
              correctly.

              On desktop and Android <a target="_blank"> opens a new tab where
              the download works as expected.
            */}
            <a
              href={`/calendar-import.html?lat=${location.lat}&lng=${location.lng}&lang=${lang}&base=${encodeURIComponent(apiBaseUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="calPicker__option"
              onClick={() => { setCalPickerOpen(false); markCalendarExported(); }}
            >
              <span className="calPicker__option-icon">📅</span>
              <span>
                <div className="calPicker__option-label">{t.calPickerOpenPage}</div>
                <div className="calPicker__option-hint">{t.calPickerOpenPageHint}</div>
              </span>
            </a>

            <button className="calPicker__cancel" onClick={() => setCalPickerOpen(false)}>
              {t.calPickerCancel}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
