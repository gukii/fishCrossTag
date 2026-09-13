import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";

type EmbedGrant = {
  expiresAt: number;
  id: string;
  nonce: string;
  parentOrigin: string;
  userId: string;
};

export function consumeEmbedGrant(token: string, input: { nonce: string; parentOrigin: string }, now = Date.now()): EmbedGrant | null {
  if (token.length > 4_000 || !validNonce(input.nonce) || !validOrigin(input.parentOrigin)) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;
  let supplied: Buffer;
  try { supplied = Buffer.from(encodedSignature, "base64url"); } catch { return null; }
  const signatureValid = acceptedSecrets().some((secret) => {
    const expected = createHmac("sha256", secret).update(encodedPayload).digest();
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  if (!signatureValid) return null;

  try {
    const value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
    const issuedAt = Number(value.iat) * 1000;
    const expiresAt = Number(value.exp) * 1000;
    if (
      value.aud !== "fishcrossline-embed" || value.iss !== "koitag" ||
      typeof value.sub !== "string" || !validId(value.jti) ||
      value.nonce !== input.nonce || value.parentOrigin !== input.parentOrigin ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      issuedAt > now + 30_000 || expiresAt <= now || expiresAt - issuedAt > 2 * 60_000
    ) return null;

    db.query("DELETE FROM embed_grant_exchanges WHERE expires_at <= ?").run(now);
    try {
      db.query("INSERT INTO embed_grant_exchanges(grant_id, user_id, parent_origin, exchanged_at, expires_at) VALUES (?, ?, ?, ?, ?)")
        .run(value.jti, value.sub, input.parentOrigin, new Date(now).toISOString(), expiresAt);
    } catch {
      return null;
    }
    return { expiresAt, id: value.jti, nonce: input.nonce, parentOrigin: input.parentOrigin, userId: value.sub };
  } catch {
    return null;
  }
}

function acceptedSecrets() {
  const current = process.env.FISH_CROSS_LINE_EMBED_SECRET?.trim();
  if (!current || current.length < 32) throw new Error("FISH_CROSS_LINE_EMBED_SECRET must contain at least 32 characters");
  const previous = process.env.FISH_CROSS_LINE_EMBED_SECRET_PREVIOUS?.trim();
  return previous && previous.length >= 32 && previous !== current ? [current, previous] : [current];
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,200}$/.test(value);
}

function validNonce(value: string) {
  return /^[A-Za-z0-9_-]{16,200}$/.test(value);
}

function validOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:"));
  } catch {
    return false;
  }
}
