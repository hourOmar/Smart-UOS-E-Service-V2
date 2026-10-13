// Base URL of the Smart UoS E-Service backend. Empty in development: requests go
// to /api on the same origin and the Vite dev server proxies them to the local
// backend. A deployment can set VITE_API_BASE_URL (a public URL, not a secret).
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
