export const NETWORK_DIAGNOSTIC_EVENT = "lhc-network-diagnostic";

export function diagnosticUrl(input) {
  const value = input instanceof Request ? input.url : String(input);
  if (/^(data|blob):/.test(value)) return `${value.split(":")[0]}:`;
  const url = new URL(value, window.location.href);
  return `${url.origin}${url.pathname}`;
}

function report(message) {
  window.dispatchEvent(new CustomEvent(NETWORK_DIAGNOSTIC_EVENT, { detail: message }));
}

export async function diagnosticFetch(input, init) {
  const url = diagnosticUrl(input);
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  const started = performance.now();
  const context = () =>
    `${method} ${url} (${Math.round(performance.now() - started)} ms; ` +
    `${new URL(url).origin === window.location.origin ? "same-origin" : "cross-origin"}; ` +
    `browser ${navigator.onLine ? "online" : "offline"})`;

  try {
    const response = await globalThis.fetch(input, init);
    if (!response.ok) {
      report(`${context()}: HTTP ${response.status} ${response.statusText}`.trim());
    }
    return response;
  } catch (error) {
    let explanation;
    if (error?.name === "AbortError") {
      explanation = "Request cancelled.";
    } else if (error?.name === "TimeoutError") {
      explanation = "Request timed out.";
    } else if (window.location.protocol === "https:" && new URL(url).protocol === "http:") {
      explanation = "HTTPS page requested an insecure HTTP endpoint (mixed content).";
    } else if (!navigator.onLine) {
      explanation = "Browser reports no network connection.";
    } else {
      explanation = "No HTTP response available to JavaScript. Possible causes: CSP/CORS, DNS, TLS, network filtering or connection failure. The browser does not expose the exact cause; check policy events below or Chrome DevTools.";
    }
    report(`${context()}: ${error?.name || "Error"}: ${error?.message || String(error)}. ${explanation}`);
    throw error;
  }
}
