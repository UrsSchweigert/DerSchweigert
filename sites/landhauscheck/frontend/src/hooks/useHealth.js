import { useEffect, useState } from "react";
import { diagnosticFetch as fetch } from "../networkDiagnostics";

export function useHealth(apiBaseUrl) {
  const [healthState, setHealthState] = useState({
    isLoading: true,
    status: "unknown",
    detail: "Checking backend health...",
  });

  useEffect(() => {
    async function fetchHealth() {
      try {
        const response = await fetch(`${apiBaseUrl}/health`);
        if (!response.ok) {
          throw new Error(`Unexpected status code: ${response.status}`);
        }
        const payload = await response.json();
        setHealthState({
          isLoading: false,
          status: payload.status,
          detail: `Backend responded at ${payload.timestamp}`,
        });
      } catch (error) {
        setHealthState({
          isLoading: false,
          status: "error",
          detail: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    fetchHealth();
  }, [apiBaseUrl]);

  return { healthState };
}
