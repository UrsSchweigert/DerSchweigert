import { useCallback, useEffect, useState } from "react";
import { diagnosticUrl, NETWORK_DIAGNOSTIC_EVENT } from "../networkDiagnostics";

export function useAppConsole() {
  const [consoleLogs, setConsoleLogs] = useState([{
    ts: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    message: "App initialized",
  }]);

  const addLog = useCallback((message) => {
    const ts = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setConsoleLogs((prev) => [...prev, { ts, message }].slice(-100));
  }, []);

  useEffect(() => {
    const onRequest = (event) => addLog(event.detail);
    const onPolicy = (event) => {
      const blocked = /^(https?:|data:|blob:)/.test(event.blockedURI)
        ? diagnosticUrl(event.blockedURI)
        : event.blockedURI || "(not supplied)";
      addLog(`CSP ${event.disposition === "report" ? "report only" : "BLOCKED"}: ${event.effectiveDirective}; target ${blocked}. Page origin: ${window.location.origin}`);
    };
    const onOnline = () => addLog("Browser network state: online (does not guarantee API reachability)");
    const onOffline = () => addLog("Browser network state: offline");
    window.addEventListener(NETWORK_DIAGNOSTIC_EVENT, onRequest);
    document.addEventListener("securitypolicyviolation", onPolicy);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener(NETWORK_DIAGNOSTIC_EVENT, onRequest);
      document.removeEventListener("securitypolicyviolation", onPolicy);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [addLog]);

  return { consoleLogs, addLog };
}
