import { timingSafeEqual } from "node:crypto";

const publicApiPaths = new Set(["/api/health", "/api/embed/authorize"]);

export function apiRequestIsAuthorized(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/") || publicApiPaths.has(pathname)) return true;
  if (request.method === "OPTIONS") return true;

  const configuredSecret = process.env.FISH_CROSS_LINE_ADMIN_SECRET?.trim();
  if (!configuredSecret) return process.env.NODE_ENV !== "production";
  if (configuredSecret.length < 32) return false;

  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBytes = Buffer.from(configuredSecret);
  const suppliedBytes = Buffer.from(supplied);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}
