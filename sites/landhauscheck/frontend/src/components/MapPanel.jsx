/**
 * MapPanel — the inline panel shown for the Fuel, Charger, Toilet, and ATM tabs
 * (tab indices 1-4) inside GoogleMapWidget.
 *
 * The mini-map div is rendered here but initialised and controlled by the parent
 * via the forwarded `fuelMapDivRef` ref, so the map instance lifecycle stays in
 * one place alongside the marker-update effects.
 */
import { forwardRef } from "react";

/**
 * @param {{
 *   tab: number,
 *   fuelStations: object[],
 *   chargers: object[],
 *   toilets: object[],
 *   atms: object[],
 *   fuelLoading: boolean,
 *   isUS: boolean,
 *   isDE: boolean,
 *   t: object,
 *   fmtDist: (km: number|null) => string|null,
 *   onNavigate: (item: object, mode: string) => void,
 * }} props
 * @param {React.Ref} ref — forwarded onto the mini-map container div
 */
const MapPanel = forwardRef(function MapPanel(
  { tab, fuelStations, chargers, toilets, atms, fuelLoading, isUS, isDE, t, fmtDist, onNavigate, style },
  ref,
) {
  return (
    <div className="fuelPanel" style={style}>
      {/* Shared mini-map — initialised by the parent's useEffect via the forwarded ref */}
      <div ref={ref} className="fuelPanel__map" />

      {/* Card list */}
      <div className="fuelPanel__list">
        {fuelLoading ? (
          <p className="fuelPanel__empty">…</p>
        ) : tab === 1 ? (
          fuelStations.length === 0 ? (
            <p className="fuelPanel__empty">{t.fuelNoStations}</p>
          ) : fuelStations.map((s, i) => (
            <div
              key={s.id || i}
              className={`fuelOverlay__card fuelOverlay__card--tappable${s.isOpen ? "" : " fuelOverlay__card--closed"}`}
              onClick={() => onNavigate(s, "driving")}
            >
              <span className="fuelOverlay__rank">{i + 1}</span>
              <div className="fuelOverlay__info">
                <span className="fuelOverlay__name">{s.brand || s.name}</span>
                <span className="fuelOverlay__status">
                  {s.isOpen ? t.fuelOpen : t.fuelClosed}
                  {fmtDist(s.distKm) && (
                    <span className="fuelOverlay__dist">&nbsp;&middot;&nbsp;{fmtDist(s.distKm)}</span>
                  )}
                </span>
              </div>
              <div className="fuelOverlay__prices">
                {isDE ? (
                  <>
                    {s.diesel != null && (
                      <span className="fuelOverlay__price fuelOverlay__price--d">
                        <b>D</b>&thinsp;{s.diesel.toFixed(3)}
                      </span>
                    )}
                    {s.e10 != null
                      ? <span className="fuelOverlay__price fuelOverlay__price--e10"><b>E10</b>&thinsp;{s.e10.toFixed(3)}</span>
                      : s.e5 != null
                        ? <span className="fuelOverlay__price fuelOverlay__price--e5"><b>E5</b>&thinsp;{s.e5.toFixed(3)}</span>
                        : null}
                  </>
                ) : (
                  <span className="fuelOverlay__price fuelOverlay__price--noprice">⛽</span>
                )}
              </div>
            </div>
          ))
        ) : tab === 2 ? (
          chargers.length === 0 ? (
            <p className="fuelPanel__empty">{t.chargerNoStations}</p>
          ) : chargers.map((s, i) => (
            <div
              key={s.id || i}
              className={`fuelOverlay__card fuelOverlay__card--charger fuelOverlay__card--tappable${s.isOpen === false ? " fuelOverlay__card--closed" : ""}`}
              onClick={() => onNavigate(s, "driving")}
            >
              <span className="fuelOverlay__rank fuelOverlay__rank--charger">{i + 1}</span>
              <div className="fuelOverlay__info">
                <span className="fuelOverlay__name">{s.name}</span>
                <span className="fuelOverlay__status">
                  {s.isOpen !== false ? t.fuelOpen : t.fuelClosed}
                  {fmtDist(s.distKm) && (
                    <span className="fuelOverlay__dist">&nbsp;&middot;&nbsp;{fmtDist(s.distKm)}</span>
                  )}
                </span>
              </div>
              <div className="fuelOverlay__prices">
                <span className="fuelOverlay__price fuelOverlay__price--ev">⚡</span>
              </div>
            </div>
          ))
        ) : tab === 3 ? (
          toilets.length === 0 ? (
            <p className="fuelPanel__empty">{t.toiletNoResults}</p>
          ) : toilets.map((s, i) => (
            <div
              key={s.id || i}
              className={`fuelOverlay__card fuelOverlay__card--tappable${s.isOpen === false ? " fuelOverlay__card--closed" : ""}`}
              onClick={() => onNavigate(s, "walking")}
            >
              <span className="fuelOverlay__rank fuelOverlay__rank--toilet">{i + 1}</span>
              <div className="fuelOverlay__info">
                <span className="fuelOverlay__name">{s.name}</span>
                <span className="fuelOverlay__status">
                  {s.isOpen !== false ? t.fuelOpen : t.fuelClosed}
                  {fmtDist(s.distKm) && (
                    <span className="fuelOverlay__dist">&nbsp;&middot;&nbsp;{fmtDist(s.distKm)}</span>
                  )}
                </span>
              </div>
              <div className="fuelOverlay__prices">
                <span className="fuelOverlay__price fuelOverlay__price--toilet">🚻</span>
              </div>
            </div>
          ))
        ) : (
          /* tab === 4 — ATMs */
          atms.length === 0 ? (
            <p className="fuelPanel__empty">{t.atmNoResults}</p>
          ) : atms.map((s, i) => (
            <div
              key={s.id || i}
              className={`fuelOverlay__card fuelOverlay__card--tappable${s.isOpen === false ? " fuelOverlay__card--closed" : ""}`}
              onClick={() => onNavigate(s, "walking")}
            >
              <span className="fuelOverlay__rank fuelOverlay__rank--atm">{i + 1}</span>
              <div className="fuelOverlay__info">
                <span className="fuelOverlay__name">{s.name}</span>
                <span className="fuelOverlay__status">
                  {s.isOpen !== false ? t.fuelOpen : t.fuelClosed}
                  {fmtDist(s.distKm) && (
                    <span className="fuelOverlay__dist">&nbsp;&middot;&nbsp;{fmtDist(s.distKm)}</span>
                  )}
                </span>
              </div>
              <div className="fuelOverlay__prices">
                <span className="fuelOverlay__price fuelOverlay__price--atm">🏧</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default MapPanel;
