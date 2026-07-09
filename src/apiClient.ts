export function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  if (location.port === "5185") return "http://localhost:3000";
  return location.origin;
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
