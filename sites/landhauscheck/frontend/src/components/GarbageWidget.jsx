import { useEffect, useState, useCallback, useRef } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";
import { API_BASE_URL as API_BASE } from "../config/api";
import { translations } from "../config/i18n";
import WidgetHelp from "./WidgetHelp";


// ── Apple-style calendar fallback ────────────────────────────────────────────

const DOW_LABELS_BY_LANG = {
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  pt: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"],
};
const DOW_LABELS = DOW_LABELS_BY_LANG.de; // default; component overrides

function buildCells(year, month, holidays) {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  // German week: Monday = 0
  let startDow = first.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1;
  const cells = Array(startDow).fill(null); // leading empties
  for (let d = 1; d <= last.getDate(); d++) {
    const dow     = new Date(year, month, d).getDay();
    const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      day:       d,
      isoDate,
      isWeekend: dow === 0 || dow === 6,
      holiday:   holidays.find((h) => h.date === isoDate)?.name ?? null,
    });
  }
  return cells;
}

function CalendarFallback({ countryCode = "DE", stateCode = null, lang = "de" }) {
  const dowLabels = DOW_LABELS_BY_LANG[lang] ?? DOW_LABELS_BY_LANG.de;
  const [holidays, setHolidays] = useState([]);
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth();

  useEffect(() => {
    const params = new URLSearchParams({ year, country: countryCode });
    if (countryCode === "DE" && stateCode) params.set("state", stateCode);
    fetch(`${API_BASE}/api/v1/holidays?${params}`)
      .then((r) => r.json())
      .then((d) => setHolidays(d.holidays ?? []))
      .catch(() => {});
  }, [year, countryCode, stateCode]);

  const cells = buildCells(year, month, holidays);

  return (
    <div className="calFallback">
      <div className="calFallback__grid">
        {dowLabels.map((d) => (
          <div key={d} className="calFallback__dow">{d}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e${i}`} />;
          const isToday = cell.day === today.getDate();
          const cls = [
            "calFallback__day",
            cell.isWeekend ? "calFallback__day--weekend" : "",
            isToday        ? "calFallback__day--today"   : "",
            cell.holiday   ? "calFallback__day--holiday" : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={cell.isoDate} className={cls}>
              <span className="calFallback__num">{cell.day}</span>
              {cell.holiday && (
                <span className="calFallback__holidayName">{cell.holiday}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Fraction helpers ──────────────────────────────────────────────────────────

const FRACTION_STYLES = {
  "Restmüll":             { bg: "#e8e8e8", color: "#333", label: "R" },
  "Biotonne":             { bg: "#c8e6c9", color: "#1b5e20", label: "G" },
  "Gelbe Tonne":          { bg: "#fff9c4", color: "#f57f17", label: "G" },
  "Papiertonne":          { bg: "#bbdefb", color: "#0d47a1", label: "P" },
  "Papiertonne / Papiersammlung": { bg: "#bbdefb", color: "#0d47a1", label: "P" },
  "Giftmobil Recyclinghof": { bg: "#ffcdd2", color: "#b71c1c", label: "!" },
  "Aktenvernichtung Recyclinghof": { bg: "#f3e5f5", color: "#4a148c", label: "A" },
};

function fractionStyle(summary) {
  for (const [key, style] of Object.entries(FRACTION_STYLES)) {
    if (summary.includes(key)) return style;
  }
  if (/bio/i.test(summary)) return { bg: "#c8e6c9", color: "#1b5e20", label: "G" };
  return { bg: "#f0f4f8", color: "#374151", label: "?" };
}

function formatDate(isoDate, locale = "de-DE") {
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "2-digit" });
}

function daysFromNow(isoDate, t) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + "T00:00:00");
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return t.today;
  if (diff === 1) return t.tomorrow;
  return t.inDays(diff);
}

// ── Shared upload panel for no-match (contribute) and expired (update) ────────

function ContribUploadPanel({ contribState, contribError, prUrl, fileInputRef, onFileChange, onRetry, t, isUpdate = false }) {
  const successMsg = isUpdate ? t.wasteUpdateSuccess : t.wasteContributeSuccess;

  if (contribState === "idle") {
    return (
      <>
        {/* Hidden file input — triggered by the visible button below */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".ics,text/calendar"
          style={{ display: "none" }}
          aria-hidden="true"
          onChange={onFileChange}
        />
        <button
          className="garbageContrib__btn"
          onClick={() => fileInputRef.current?.click()}
        >
          {t.wasteContributeBtn}
        </button>
        <p className="garbageContrib__hint">{t.wasteContributeFiletypeHint}</p>
      </>
    );
  }

  if (contribState === "uploading") {
    return <p className="garbageContrib__status">{t.wasteContributing}</p>;
  }

  if (contribState === "done") {
    return (
      <div className="garbageContrib__success">
        <p>{successMsg}</p>
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="garbageContrib__prLink"
          >
            {t.wasteContributePRLink} →
          </a>
        )}
      </div>
    );
  }

  // contribState === "error"
  return (
    <div className="garbageContrib__error">
      <p>{contribError || t.wasteContributeError}</p>
      <button
        className="garbageContrib__btn garbageContrib__btn--retry"
        onClick={onRetry}
      >
        ↩ {t.back}
      </button>
    </div>
  );
}

export default function GarbageWidget({ location: locProp, countryCode = "DE", stateCode = null, onStatusChange, onError, onTomorrowEvents, lang = "de" }) {
  const t = translations[lang] ?? translations.de;
  const [state, setState] = useState("locating"); // locating | loading | ok | no-match | expired | error
  const [locationLabel, setLocationLabel] = useState(null);
  const [events, setEvents] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");

  // ── Contribution sub-state (visible when state === "no-match" / "expired" / showUpdatePanel) ─
  // idle | uploading | done | error
  const [contribState, setContribState] = useState("idle");
  const [contribError, setContribError] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [showUpdatePanel, setShowUpdatePanel] = useState(false);
  const fileInputRef = useRef(null);

  const updateState = useCallback((s) => {
    setState(s);
    onStatusChange?.(s);
  }, [onStatusChange]);

  const fetchData = useCallback((lat, lng) => {
    updateState("loading");
    fetch(`${API_BASE}/api/v1/waste/upcoming?lat=${lat}&lng=${lng}&count=10`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data.location) {
          setContribState("idle");
          setContribError("");
          setPrUrl("");
          updateState("no-match");
        } else if (data.expired) {
          setLocationLabel(data.location);
          setContribState("idle");
          setContribError("");
          setPrUrl("");
          updateState("expired");
        } else {
          setLocationLabel(data.location);
          setEvents(data.events);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrowEvents = data.events.filter((ev) => {
            const diff = Math.round((new Date(ev.date + "T00:00:00") - today) / 86400000);
            return diff === 1;
          });
          onTomorrowEvents?.(tomorrowEvents);
          updateState("ok");
        }
      })
      .catch((err) => {
        setErrorMsg(err.message);
        onError?.(err.message);
        updateState("error");
      });
  }, [updateState, onError]);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-selected after an error
    e.target.value = "";

    if (!locProp) return;
    setContribState("uploading");
    setContribError("");
    setPrUrl("");

    const form = new FormData();
    form.append("file", file);

    try {
      const r = await fetch(
        `${API_BASE}/api/v1/waste/contribute?lat=${locProp.lat}&lng=${locProp.lng}`,
        { method: "POST", body: form },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const detail = body.detail || `HTTP ${r.status}`;
        // 422 = ICS validation failure; surface the backend message directly
        throw new Error(
          r.status === 422 ? `${t.wasteContributeInvalid} (${detail})` : detail,
        );
      }
      const data = await r.json();
      setPrUrl(data.pr_url ?? "");
      setContribState("done");
    } catch (err) {
      setContribError(err.message);
      setContribState("error");
    }
  }, [locProp, t]);

  useEffect(() => {
    if (!locProp) { updateState("locating"); return; }
    // Reset upload panel whenever the user picks a new location
    setContribState("idle");
    setContribError("");
    setPrUrl("");
    setShowUpdatePanel(false);
    fetchData(locProp.lat, locProp.lng);
    const id = setInterval(() => fetchData(locProp.lat, locProp.lng), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [locProp, fetchData, updateState]);

  return (
    <div className="garbageWidget">
      <h3 className="garbageWidget__title">
        {(state === "no-match" || state === "expired")
          ? new Date().toLocaleDateString(t.dateLocale, { month: "long", year: "numeric" })
          : t.garbageTitle}
        <WidgetHelp text={t.garbageHelp} />
      </h3>

      {state === "locating" && (
        <p className="garbageWidget__msg">{t.locating}</p>
      )}
      {state === "loading" && (
        <p className="garbageWidget__msg">{t.loadingDates}</p>
      )}
      {state === "no-match" && (
        <>
          <CalendarFallback countryCode={countryCode} stateCode={stateCode} lang={lang} />

          {/* ── Calendar contribution panel ─────────────────────────── */}
          <div className="garbageContrib">
            <p className="garbageContrib__title">{t.wasteContributeTitle}</p>
            <p className="garbageContrib__body">{t.wasteContributeBody}</p>
            <ContribUploadPanel
              contribState={contribState}
              contribError={contribError}
              prUrl={prUrl}
              fileInputRef={fileInputRef}
              onFileChange={handleFileChange}
              onRetry={() => setContribState("idle")}
              t={t}
            />
          </div>
        </>
      )}

      {state === "expired" && (
        <>
          <p className="garbageWidget__expired">📅 {locationLabel} — {t.wasteExpiredMsg}</p>

          {/* ── Calendar re-upload panel ────────────────────────────── */}
          <div className="garbageContrib">
            <p className="garbageContrib__title">{t.wasteUpdateTitle}</p>
            <p className="garbageContrib__body">{t.wasteUpdateBody}</p>
            <ContribUploadPanel
              contribState={contribState}
              contribError={contribError}
              prUrl={prUrl}
              fileInputRef={fileInputRef}
              onFileChange={handleFileChange}
              onRetry={() => setContribState("idle")}
              t={t}
              isUpdate
            />
          </div>
        </>
      )}
      {state === "error" && (
        <p className="garbageWidget__msg garbageWidget__msg--error">{errorMsg}</p>
      )}

      {state === "ok" && (
        <>
          <p className="garbageWidget__location">📍 {locationLabel}</p>
          <ul className="garbageWidget__list">
            {events.map((ev) => {
              const style = fractionStyle(ev.summary);
              const isToday = daysFromNow(ev.date, t) === t.today;
              return (
                <li key={ev.date + ev.summary} className={`garbageWidget__item${isToday ? " garbageWidget__item--today" : ""}`}>
                  <span
                    className="garbageWidget__badge"
                    style={{ background: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>
                  <span className="garbageWidget__summary">{ev.summary}</span>
                  <span className="garbageWidget__date">{formatDate(ev.date, t.dateLocale)}</span>
                  <span className="garbageWidget__days">{isToday ? `🗑️ ${t.today}` : daysFromNow(ev.date, t)}</span>
                </li>
              );
            })}
          </ul>

          {/* ── Update calendar panel ───────────────────────────────── */}
          {!showUpdatePanel ? (
            <button
              className="garbageWidget__updateBtn"
              onClick={() => { setShowUpdatePanel(true); setContribState("idle"); }}
            >
              {t.wasteUpdateTriggerBtn}
            </button>
          ) : (
            <div className="garbageContrib">
              <p className="garbageContrib__title">{t.wasteUpdateTitle}</p>
              <p className="garbageContrib__body">{t.wasteUpdateBody}</p>
              <ContribUploadPanel
                contribState={contribState}
                contribError={contribError}
                prUrl={prUrl}
                fileInputRef={fileInputRef}
                onFileChange={handleFileChange}
                onRetry={() => setContribState("idle")}
                t={t}
                isUpdate
              />
              {contribState === "idle" && (
                <button
                  className="garbageWidget__updateBtn garbageWidget__updateBtn--cancel"
                  onClick={() => setShowUpdatePanel(false)}
                >
                  {t.back}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
