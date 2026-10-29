import { useRef, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL } from "../config/api";
import { translations, SUPPORTED_LANGS, LANG_LABELS } from "../config/i18n";

const CONSENT_KEY = "lhc_consent";

// Each card maps to i18n title + desc keys, plus a colour theme.
// Icons are Liquid Glass SVGs (60×60 viewBox, rendered at 28×28 px) – approved 2025-04.
const FEATURE_CARDS = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="fc-waste-gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b"/><stop offset="100%" stopColor="#92400e"/>
          </linearGradient>
          <radialGradient id="fc-waste-gs" cx="42%" cy="18%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.56)"/>
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </radialGradient>
        </defs>
        <rect width="60" height="60" rx="16" fill="url(#fc-waste-gb)"/>
        <rect width="60" height="60" rx="16" fill="url(#fc-waste-gs)"/>
        <rect x="0.5" y="0.5" width="59" height="59" rx="15.5" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="1"/>
        <g fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M26 11 h8 a3 3 0 0 1 3 3 v3 H23 v-3 a3 3 0 0 1 3-3 z"/>
          <line x1="13" y1="17" x2="47" y2="17"/>
          <path d="M19 22 h22 v21 a5 5 0 0 1-5 5 H24 a5 5 0 0 1-5-5 z"/>
          <line x1="26" y1="27" x2="25.5" y2="41"/>
          <line x1="30" y1="27" x2="30" y2="41"/>
          <line x1="34" y1="27" x2="34.5" y2="41"/>
        </g>
      </svg>
    ),
    titleKey: "garbageTitle", descKey: "featureGarbageDesc", color: "#d97706", bg: "rgba(217,119,6,0.12)",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="fc-clock-gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa"/><stop offset="100%" stopColor="#1e3a8a"/>
          </linearGradient>
          <radialGradient id="fc-clock-gs" cx="42%" cy="18%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.56)"/>
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </radialGradient>
        </defs>
        <rect width="60" height="60" rx="16" fill="url(#fc-clock-gb)"/>
        <rect width="60" height="60" rx="16" fill="url(#fc-clock-gs)"/>
        <rect x="0.5" y="0.5" width="59" height="59" rx="15.5" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="1"/>
        <g fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="30" cy="30" r="17" strokeWidth="2.4"/>
          <line x1="30" y1="13" x2="30" y2="16.5" strokeWidth="2.4"/>
          <line x1="47" y1="30" x2="43.5" y2="30" strokeWidth="2.4"/>
          <line x1="30" y1="47" x2="30" y2="43.5" strokeWidth="2.4"/>
          <line x1="13" y1="30" x2="16.5" y2="30" strokeWidth="2.4"/>
          <line x1="30" y1="30" x2="35" y2="21" strokeWidth="3.0"/>
          <line x1="30" y1="30" x2="30" y2="15" strokeWidth="2.4"/>
          <circle cx="30" cy="30" r="2.2" fill="white" stroke="none"/>
        </g>
      </svg>
    ),
    titleKey: "clockTitle", descKey: "featureClockDesc", color: "#3b82f6", bg: "rgba(59,130,246,0.12)",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="fc-map-gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#065f46"/>
          </linearGradient>
          <radialGradient id="fc-map-gs" cx="42%" cy="18%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.56)"/>
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </radialGradient>
        </defs>
        <rect width="60" height="60" rx="16" fill="url(#fc-map-gb)"/>
        <rect width="60" height="60" rx="16" fill="url(#fc-map-gs)"/>
        <rect x="0.5" y="0.5" width="59" height="59" rx="15.5" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="1"/>
        <g fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12,20 L24,14 L44,14 L48,18 L48,46 L36,42 L24,46 L12,42 Z"/>
          <polyline points="44,14 44,18 48,18"/>
          <line x1="24" y1="14" x2="24" y2="46"/>
          <line x1="36" y1="42" x2="36" y2="18"/>
          <line x1="12" y1="30" x2="48" y2="30"/>
          <circle cx="18" cy="24" r="3" fill="white" stroke="none"/>
          <line x1="18" y1="27" x2="17" y2="32" strokeWidth="2"/>
        </g>
      </svg>
    ),
    titleKey: "mapTitle", descKey: "featureMapDesc", color: "#059669", bg: "rgba(5,150,105,0.12)",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="fc-train-gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa"/><stop offset="100%" stopColor="#4c1d95"/>
          </linearGradient>
          <radialGradient id="fc-train-gs" cx="42%" cy="18%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.56)"/>
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </radialGradient>
        </defs>
        <rect width="60" height="60" rx="16" fill="url(#fc-train-gb)"/>
        <rect width="60" height="60" rx="16" fill="url(#fc-train-gs)"/>
        <rect x="0.5" y="0.5" width="59" height="59" rx="15.5" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="1"/>
        <g fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13,18 h34 a5,5 0 0 1 5,5 V40 H8 V23 a5,5 0 0 1 5-5 z"/>
          <rect x="16" y="22" width="11" height="10" rx="3"/>
          <rect x="33" y="22" width="11" height="10" rx="3"/>
          <line x1="30" y1="18" x2="30" y2="22"/>
          <circle cx="20" cy="37" r="2.5" fill="white" stroke="none"/>
          <circle cx="40" cy="37" r="2.5" fill="white" stroke="none"/>
          <line x1="13" y1="40" x2="47" y2="40"/>
          <circle cx="19" cy="47" r="5"/>
          <circle cx="41" cy="47" r="5"/>
        </g>
      </svg>
    ),
    titleKey: "routingTitle", descKey: "featureRoutingDesc", color: "#7c3aed", bg: "rgba(124,58,237,0.12)",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="fc-bus-gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb923c"/><stop offset="100%" stopColor="#9a3412"/>
          </linearGradient>
          <radialGradient id="fc-bus-gs" cx="42%" cy="18%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.56)"/>
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </radialGradient>
        </defs>
        <rect width="60" height="60" rx="16" fill="url(#fc-bus-gb)"/>
        <rect width="60" height="60" rx="16" fill="url(#fc-bus-gs)"/>
        <rect x="0.5" y="0.5" width="59" height="59" rx="15.5" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="1"/>
        <g fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9,24 L9,40 h42 V24 a7,7 0 0 0-7-7 H16 a7,7 0 0 0-7,7 z"/>
          <path d="M45,17 L51,24 L51,36 L45,36"/>
          <rect x="13" y="22" width="10" height="9" rx="2.5"/>
          <rect x="26" y="22" width="10" height="9" rx="2.5"/>
          <rect x="39" y="22" width="7" height="14" rx="1.5"/>
          <rect x="13" y="13" width="28" height="5" rx="1.5" fill="rgba(255,255,255,0.25)" stroke="none"/>
          <circle cx="18" cy="45" r="5.5"/>
          <circle cx="42" cy="45" r="5.5"/>
        </g>
      </svg>
    ),
    titleKey: "transitTitle", descKey: "featureTransitDesc", color: "#ea580c", bg: "rgba(234,88,12,0.12)",
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="fc-pin-gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f472b6"/><stop offset="100%" stopColor="#9d174d"/>
          </linearGradient>
          <radialGradient id="fc-pin-gs" cx="42%" cy="18%" r="68%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.56)"/>
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)"/>
            <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
          </radialGradient>
        </defs>
        <rect width="60" height="60" rx="16" fill="url(#fc-pin-gb)"/>
        <rect width="60" height="60" rx="16" fill="url(#fc-pin-gs)"/>
        <rect x="0.5" y="0.5" width="59" height="59" rx="15.5" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="1"/>
        <g stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path fill="none" d="M30,10 C 42,10 48,19 48,27 C 48,39 30,52 30,52 C 30,52 12,39 12,27 C 12,19 18,10 30,10 Z"/>
          <circle cx="30" cy="26" r="7" fill="none"/>
        </g>
      </svg>
    ),
    titleKey: "poiTitle", descKey: "featurePoiDesc", color: "#db2777", bg: "rgba(219,39,119,0.12)",
  },
];

export default function LocationPicker({ onLocation, onRetryGPS, gpsDenied, lang, onLangChange }) {
  const t = translations[lang] || translations.de;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(() => !!localStorage.getItem(CONSENT_KEY));
  const inputRef = useRef(null);

  const gpsAvailable = !!navigator.geolocation;

  function handleConsent(e) {
    const checked = e.target.checked;
    setConsent(checked);
    if (checked) localStorage.setItem(CONSENT_KEY, "1");
    else localStorage.removeItem(CONSENT_KEY);
  }

  async function search() {
    const q = query.trim();
    if (!q || !consent) return;
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.status !== "OK" || !data.results?.length) {
        setError(t.noResult);
      } else if (data.results.length === 1) {
        const { lat, lng, formatted_address, countryCode } = data.results[0];
        onLocation({ lat, lng, label: formatted_address, countryCode });
      } else {
        setResults(data.results);
      }
    } catch {
      setError(t.searchError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="locPicker" role="dialog" aria-modal="true" aria-label={t.pickerAriaLabel}>
      <div className="locPicker__card">

        {/* ── Header ── */}
        <div className="locPicker__appHeader">
          <img className="locPicker__appLogo" src="/logo.png" alt="Landhauscheck" />
          <div className="locPicker__appText">
            <span className="locPicker__appName">landhauscheck</span>
            <span className="locPicker__appTagline">{t.bannerTagline}</span>
          </div>
          <div className="langSwitcher locPicker__langSwitch">
            {SUPPORTED_LANGS.map(l => (
              <button
                key={l}
                className={`langSwitcher__btn${lang === l ? " langSwitcher__btn--active" : ""}`}
                onClick={() => onLangChange(l)}
                aria-pressed={lang === l}
              >{LANG_LABELS[l]}</button>
            ))}
          </div>
        </div>

        {/* ── Intro paragraph ── */}
        <p className="locPicker__appDesc">{t.appDesc}</p>

        {/* ── Feature showcase ── */}
        <div className="locPicker__features">
          <p className="locPicker__featuresTitle">{t.welcomeGetTitle}</p>
          <div className="locPicker__featureGrid">
            {FEATURE_CARDS.map(({ icon, titleKey, descKey, color, bg }) => (
              <div
                key={titleKey}
                className="locPicker__featureCard"
                style={{ "--fc-color": color, "--fc-bg": bg }}
              >
                <span className="locPicker__featureIcon">{icon}</span>
                <span className="locPicker__featureTitle">{t[titleKey]}</span>
                <span className="locPicker__featureDesc">{t[descKey]}</span>
              </div>
            ))}
          </div>
          <p className="locPicker__soloNote">
            {t.soloProjectNote}<a href="/donate.html" target="_blank" rel="noopener" className="locPicker__link">{t.soloProjectCoffee}</a>.
          </p>
        </div>

        <div className="locPicker__divider" />

        {/* ── Location section ── */}
        <div className="locPicker__locationSection">
          <div className="locPicker__icon">📍</div>
          <h2 className="locPicker__title">{t.welcomeShareTitle}</h2>
          <p className="locPicker__body">
            {gpsDenied ? t.pickerBodyDenied : t.welcomeShareBody}
          </p>
        </div>

        {/* ── Consent ── */}
        <label className="locPicker__consentLabel">
          <input
            type="checkbox"
            className="locPicker__consentCheck"
            checked={consent}
            onChange={handleConsent}
          />
          <span>
            {t.consentText}{" "}
            <a href="/datenschutz.html" target="_blank" rel="noopener" className="locPicker__link">
              {t.privacyLink}
            </a>
            {t.consentSuffix ? " " + t.consentSuffix : ""}
          </span>
        </label>

        {gpsAvailable && !gpsDenied && (
          <button className="locPicker__gpsBtn" onClick={onRetryGPS} disabled={!consent}>
            {t.gpsBtn}
          </button>
        )}

        <div className="locPicker__searchRow">
          <input
            ref={inputRef}
            className="locPicker__input"
            type="text"
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            autoComplete="off"
            disabled={!consent}
          />
          <button
            className="locPicker__searchBtn"
            onClick={search}
            disabled={loading || !query.trim() || !consent}
          >
            {loading ? "…" : t.searchBtn}
          </button>
        </div>

        {!consent && (
          <p className="locPicker__consentHint">{t.consentHint}</p>
        )}

        {error && <p className="locPicker__error">{error}</p>}

        {results.length > 0 && (
          <ul className="locPicker__results" role="listbox">
            {results.map((r, i) => (
              <li
                key={i}
                className="locPicker__result"
                role="option"
                tabIndex={0}
                onClick={() => onLocation({ lat: r.lat, lng: r.lng, label: r.formatted_address, countryCode: r.countryCode })}
                onKeyDown={(e) => e.key === "Enter" && onLocation({ lat: r.lat, lng: r.lng, label: r.formatted_address, countryCode: r.countryCode })}
              >
                {r.formatted_address}
              </li>
            ))}
          </ul>
        )}

        {/* ── Legal footer ── */}
        <div className="locPicker__legalFooter">
          <div className="locPicker__legalLinks">
            <a href="/impressum.html" target="_blank" rel="noopener" className="locPicker__link">{t.impressum}</a>
            <span className="locPicker__legalSep">·</span>
            <a href="/datenschutz.html" target="_blank" rel="noopener" className="locPicker__link">{t.datenschutz}</a>
          </div>
        </div>

      </div>
    </div>
  );
}
