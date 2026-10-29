import { useCallback, useState } from "react";

export function useWidgetStatus() {
  const [statuses, setStatuses] = useState({
    map: "locating", garbage: "locating", transit: "locating", routing: "locating", poi: "locating",
  });
  const [errors, setErrors] = useState({ map: "", garbage: "", transit: "", poi: "" });
  const [countdowns, setCountdowns] = useState({ map: null, routing: null });
  const [lastUpdated, setLastUpdated] = useState({
    clock: Date.now(), map: null, garbage: null, transit: null, routing: null, poi: null,
  });

  const markUpdated = useCallback((key) => {
    setLastUpdated((prev) => ({ ...prev, [key]: Date.now() }));
  }, []);

  // Stable callbacks for widget props — MUST be useCallback to avoid re-render loops.
  // Inline arrow functions create new references every render, causing child useEffects
  // with these callbacks in their dep arrays to re-run every render → infinite loop.
  const onMapStatus = useCallback((s) => {
    setStatuses((p) => ({ ...p, map: s }));
    if (s === "ok" || s === "connected") markUpdated("map");
  }, [markUpdated]);

  const onGarbageStatus = useCallback((s) => {
    setStatuses((p) => ({ ...p, garbage: s }));
    if (s === "ok" || s === "no-match") markUpdated("garbage");
  }, [markUpdated]);

  const onTransitStatus = useCallback((s) => {
    setStatuses((p) => ({ ...p, transit: s }));
    if (s === "ok") markUpdated("transit");
  }, [markUpdated]);

  const onRoutingStatus = useCallback((s) => {
    setStatuses((p) => ({ ...p, routing: s }));
    if (s === "ok" || s === "connected") markUpdated("routing");
  }, [markUpdated]);

  const onPoiStatus = useCallback((s) => {
    setStatuses((p) => ({ ...p, poi: s }));
    if (s === "ok") markUpdated("poi");
  }, [markUpdated]);

  const setMapError      = useCallback((e) => setErrors((p) => ({ ...p, map: e })), []);
  const setGarbageError  = useCallback((e) => setErrors((p) => ({ ...p, garbage: e })), []);
  const setTransitError  = useCallback((e) => setErrors((p) => ({ ...p, transit: e })), []);
  const setPoiError      = useCallback((e) => setErrors((p) => ({ ...p, poi: e })), []);

  const setMapCountdown     = useCallback((v) => setCountdowns((p) => ({ ...p, map: v })), []);
  const setRoutingCountdown = useCallback((v) => setCountdowns((p) => ({ ...p, routing: v })), []);

  return {
    statuses,
    errors,
    countdowns,
    lastUpdated,
    on: {
      map:     onMapStatus,
      garbage: onGarbageStatus,
      transit: onTransitStatus,
      routing: onRoutingStatus,
      poi:     onPoiStatus,
    },
    setError: {
      map:     setMapError,
      garbage: setGarbageError,
      transit: setTransitError,
      poi:     setPoiError,
    },
    setCountdown: {
      map:     setMapCountdown,
      routing: setRoutingCountdown,
    },
  };
}
