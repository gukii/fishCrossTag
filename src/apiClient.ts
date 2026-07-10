const API_BASE_STORAGE_KEY = "fishcross-api-base-url";

function cleanApiBaseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

export function apiBaseUrl() {
  const urlParam = new URLSearchParams(window.location.search).get("apiBase");
  if (urlParam) {
    const nextBase = cleanApiBaseUrl(urlParam);
    localStorage.setItem(API_BASE_STORAGE_KEY, nextBase);
    return nextBase;
  }

  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (configured) return cleanApiBaseUrl(configured);

  const stored = localStorage.getItem(API_BASE_STORAGE_KEY);
  if (stored) return cleanApiBaseUrl(stored);

  if (location.port === "5185") return "http://localhost:3000";
  return location.origin;
}

export function setApiBaseUrlOverride(value: string) {
  const nextBase = cleanApiBaseUrl(value);
  if (nextBase) {
    localStorage.setItem(API_BASE_STORAGE_KEY, nextBase);
  } else {
    localStorage.removeItem(API_BASE_STORAGE_KEY);
  }
  return apiBaseUrl();
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}
