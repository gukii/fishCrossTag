import { createHmac, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, test } from "bun:test";

const currentSecret = "fish-cross-line-current-test-secret-123456789";
const previousSecret = "fish-cross-line-previous-test-secret-12345678";
const origin = "https://koitag.example";

process.env.NODE_ENV = "production";
process.env.SQLITE_PATH = join(tmpdir(), `fish-cross-line-embed-auth-${process.pid}-${Date.now()}.sqlite`);
process.env.FISH_CROSS_LINE_EMBED_SECRET = currentSecret;
process.env.FISH_CROSS_LINE_EMBED_SECRET_PREVIOUS = previousSecret;

let consumeEmbedGrant: typeof import("./embedAuth").consumeEmbedGrant;
let apiRequestIsAuthorized: typeof import("./apiAuth").apiRequestIsAuthorized;
let apiFetch: typeof import("./api").fetch;

beforeAll(async () => {
  ({ consumeEmbedGrant } = await import("./embedAuth"));
  ({ apiRequestIsAuthorized } = await import("./apiAuth"));
  ({ fetch: apiFetch } = await import("./api"));
});

afterEach(() => {
  delete process.env.FISH_CROSS_LINE_ADMIN_SECRET;
});

function token(input: { nonce?: string; secret?: string; issuedAt?: number; expiresAt?: number; origin?: string } = {}) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    aud: "fishcrossline-embed",
    iss: "koitag",
    sub: "user_test_123456",
    jti: randomUUID(),
    iat: Math.floor((input.issuedAt ?? now) / 1000),
    exp: Math.floor((input.expiresAt ?? now + 60_000) / 1000),
    nonce: input.nonce ?? "nonce_1234567890123456",
    parentOrigin: input.origin ?? origin,
  })).toString("base64url");
  const signature = createHmac("sha256", input.secret ?? currentSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

test("accepts a valid embed grant exactly once", () => {
  const nonce = "nonce_1234567890123456";
  const grant = token({ nonce });
  expect(consumeEmbedGrant(grant, { nonce, parentOrigin: origin })).not.toBeNull();
  expect(consumeEmbedGrant(grant, { nonce, parentOrigin: origin })).toBeNull();
});

test("accepts the previous rotation secret but rejects the wrong origin", () => {
  const nonce = "nonce_previous_12345678";
  const grant = token({ nonce, secret: previousSecret });
  expect(consumeEmbedGrant(grant, { nonce, parentOrigin: "https://attacker.example" })).toBeNull();
  expect(consumeEmbedGrant(grant, { nonce, parentOrigin: origin })).not.toBeNull();
});

test("rejects expired and overly long grants", () => {
  const nonce = "nonce_expired_123456789";
  const now = Date.now();
  expect(consumeEmbedGrant(token({ nonce, issuedAt: now - 120_000, expiresAt: now - 60_000 }), { nonce, parentOrigin: origin }, now)).toBeNull();
  expect(consumeEmbedGrant(token({ nonce, issuedAt: now, expiresAt: now + 121_000 }), { nonce, parentOrigin: origin }, now)).toBeNull();
});

test("protects non-embed production APIs with their own administrator secret", () => {
  const request = new Request("https://fishcrossline.example/api/dashboard");
  expect(apiRequestIsAuthorized(request)).toBe(false);
  process.env.FISH_CROSS_LINE_ADMIN_SECRET = "fish-cross-line-admin-test-secret-123456789";
  expect(apiRequestIsAuthorized(new Request(request.url, { headers: { authorization: `Bearer ${process.env.FISH_CROSS_LINE_ADMIN_SECRET}` } }))).toBe(true);
  expect(apiRequestIsAuthorized(new Request("https://fishcrossline.example/api/embed/authorize"))).toBe(true);
});

test("bounds and validates the public embed authorization body", async () => {
  const nonce = "nonce_endpoint_123456789";
  const body = JSON.stringify({ grant: token({ nonce }), nonce, parentOrigin: origin });
  const accepted = await apiFetch(new Request("https://fishcrossline.example/api/embed/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
  expect(accepted.status).toBe(200);

  const wrongType = await apiFetch(new Request("https://fishcrossline.example/api/embed/authorize", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body,
  }));
  expect(wrongType.status).toBe(415);

  const oversized = await apiFetch(new Request("https://fishcrossline.example/api/embed/authorize", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "8193" },
    body: "{}",
  }));
  expect(oversized.status).toBe(413);
});
