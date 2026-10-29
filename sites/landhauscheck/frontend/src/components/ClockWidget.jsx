import { useEffect, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL } from "../config/api";
import { translations } from "../config/i18n";

function pad(n) {
  return String(n).padStart(2, "0");
}

// WMO weather code → emoji for day / night
const WMO_DAY = {
  0:  { e: "☀️",  l: "Klar" },
  1:  { e: "🌤️", l: "Meist klar" },
  2:  { e: "⛅",  l: "Wechselnd" },
  3:  { e: "☁️",  l: "Bedeckt" },
  45: { e: "🌫️", l: "Nebel" },
  48: { e: "🌫️", l: "Nebel" },
  51: { e: "🌦️", l: "Nieselregen" },
  53: { e: "🌦️", l: "Nieselregen" },
  55: { e: "🌦️", l: "Nieselregen" },
  61: { e: "🌧️", l: "Regen" },
  63: { e: "🌧️", l: "Regen" },
  65: { e: "🌧️", l: "Starkregen" },
  71: { e: "❄️",  l: "Schnee" },
  73: { e: "❄️",  l: "Schnee" },
  75: { e: "❄️",  l: "Starker Schnee" },
  77: { e: "🌨️", l: "Graupel" },
  80: { e: "🌦️", l: "Schauer" },
  81: { e: "🌧️", l: "Schauer" },
  82: { e: "⛈️",  l: "Starke Schauer" },
  85: { e: "🌨️", l: "Schneeschauer" },
  86: { e: "🌨️", l: "Schneeschauer" },
  95: { e: "⛈️",  l: "Gewitter" },
  96: { e: "⛈️",  l: "Gewitter" },
  99: { e: "⛈️",  l: "Gewitter" },
};

const WMO_NIGHT = {
  0:  { e: "🌙",  l: "Klar" },
  1:  { e: "🌙",  l: "Meist klar" },
  2:  { e: "🌥️", l: "Wechselnd" },
  3:  { e: "☁️",  l: "Bedeckt" },
  45: { e: "🌫️", l: "Nebel" },
  48: { e: "🌫️", l: "Nebel" },
  51: { e: "🌧️", l: "Nieselregen" },
  53: { e: "🌧️", l: "Nieselregen" },
  55: { e: "🌧️", l: "Nieselregen" },
  61: { e: "🌧️", l: "Regen" },
  63: { e: "🌧️", l: "Regen" },
  65: { e: "🌧️", l: "Starkregen" },
  71: { e: "❄️",  l: "Schnee" },
  73: { e: "❄️",  l: "Schnee" },
  75: { e: "❄️",  l: "Starker Schnee" },
  77: { e: "🌨️", l: "Graupel" },
  80: { e: "🌧️", l: "Schauer" },
  81: { e: "🌧️", l: "Schauer" },
  82: { e: "⛈️",  l: "Starke Schauer" },
  85: { e: "🌨️", l: "Schneeschauer" },
  86: { e: "🌨️", l: "Schneeschauer" },
  95: { e: "⛈️",  l: "Gewitter" },
  96: { e: "⛈️",  l: "Gewitter" },
  99: { e: "⛈️",  l: "Gewitter" },
};

function wmo(code, isDay) {
  const map = isDay ? WMO_DAY : WMO_NIGHT;
  return map[code] ?? (isDay ? { e: "🌡️", l: "–" } : { e: "🌑", l: "–" });
}

// Open-Meteo moonphase: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter
function moonEmoji(phase) {
  if (phase === null || phase === undefined) return "";
  if (phase < 0.0625)  return "🌑";
  if (phase < 0.1875)  return "🌒";
  if (phase < 0.3125)  return "🌓";
  if (phase < 0.4375)  return "🌔";
  if (phase < 0.5625)  return "🌕";
  if (phase < 0.6875)  return "🌖";
  if (phase < 0.8125)  return "🌗";
  if (phase < 0.9375)  return "🌘";
  return "🌑";
}

export default function ClockWidget({ onOpen, location, lang = "de", countryCode = "DE" }) {
  const t = translations[lang] ?? translations.de;
  const imperial = countryCode === "US";
  const [now, setNow] = useState(() => new Date());
  const [forecast, setForecast] = useState(null);
  const [moonphase, setMoonphase] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch forecast on mount, on location change, and every 30 min
  useEffect(() => {
    if (!location) return;
    const base = API_BASE_URL;
    const doFetch = () => {
      const unitParam = imperial ? "&units=imperial" : "";
      fetch(`${base}/api/v1/weather/forecast?lat=${location.lat}&lng=${location.lng}${unitParam}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data?.slots) return;
          // Open-Meteo returns local-time strings ("2026-04-07T11:00") when
          // timezone=auto.  Bright Sky returns UTC ISO-8601 strings
          // ("2026-04-07T09:00:00+00:00") and tags the response with
          // utc_timestamps:true.  In that case we normalise each slot's time
          // to a local-time string via the browser's Date so the same
          // startsWith prefix matching works for both sources.
          const slots = data.utc_timestamps
            ? data.slots.map((s) => {
                const d = new Date(s.time);
                const local =
                  `${d.getFullYear()}-` +
                  `${String(d.getMonth() + 1).padStart(2, "0")}-` +
                  `${String(d.getDate()).padStart(2, "0")}T` +
                  `${String(d.getHours()).padStart(2, "0")}:00`;
                return { ...s, time: local };
              })
            : data.slots;
          // Use local clock components — NOT toISOString() which is UTC.
          const n = new Date();
          const localPrefix =
            `${n.getFullYear()}-` +
            `${String(n.getMonth() + 1).padStart(2, "0")}-` +
            `${String(n.getDate()).padStart(2, "0")}T` +
            `${String(n.getHours()).padStart(2, "0")}`;
          const idx = slots.findIndex((s) => s.time.startsWith(localPrefix));
          const start = idx >= 0 ? idx : 0;
          const five = slots.slice(start, start + 5);
          // Pad to always show exactly 5 tiles (safety net for edge cases)
          while (five.length < 5 && five.length > 0) five.push(five[five.length - 1]);
          setForecast(five);
          if (data.moonphase !== undefined) setMoonphase(data.moonphase);
        })
        .catch(() => {});
    };
    doFetch();
    const id = setInterval(doFetch, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [location]);

  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());

  const dateStr = now.toLocaleDateString(t.dateLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div
      className="clockWidget"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-label="Open system console"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen?.(); }}
      style={{ cursor: "pointer" }}
    >
      <div className="clockWidget__digital">
        <span className="clockWidget__hhmm">{hh}:{mm}</span>
        <span className="clockWidget__ss">{ss}</span>
      </div>
      <div className="clockWidget__date">
        {dateStr}
        {moonphase !== null && (
          <span className="clockWidget__moon" title={`${t.moonPhaseLabel}: ${Math.round(moonphase * 100)}%`}>
            {moonEmoji(moonphase)}
          </span>
        )}
      </div>

      {forecast && (
        <div className="clockWidget__weather">
          {forecast.map((slot, i) => {
            const { e } = wmo(slot.code, slot.is_day !== 0);
            const hour = slot.time.slice(11, 16); // "14:00"
            return (
              <div key={i} className={`clockWidget__weatherSlot${i === 0 ? " clockWidget__weatherSlot--now" : ""}`}>
                <span className="clockWidget__weatherHour">{i === 0 ? t.now.charAt(0).toUpperCase() + t.now.slice(1) : hour}</span>
                <span className="clockWidget__weatherIcon">{e}</span>
                <span className="clockWidget__weatherTemp">{Math.round(slot.temp)}{imperial ? "°F" : "°"}</span>
                <span className={`clockWidget__weatherPrecip${slot.precip === 0 ? " clockWidget__weatherPrecip--dry" : ""}`}>💧{slot.precip ?? 0}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
