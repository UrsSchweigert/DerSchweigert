// CloudFront routes API requests on every deployed hostname, including www.
export const API_BASE_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "")
  : window.location.origin;
