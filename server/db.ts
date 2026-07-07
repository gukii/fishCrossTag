import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const defaultDbPath = resolve(process.cwd(), "data/koi-tag-line.sqlite");
const dbPath = process.env.SQLITE_PATH ?? defaultDbPath;

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.exec(readFileSync(resolve(process.cwd(), "server/schema.sql"), "utf8"));

export function nowIso() {
  return new Date().toISOString();
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      ...init.headers,
    },
  });
}
