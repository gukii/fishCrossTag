import { TaggerCompletePayload, TaggerSession } from "../src/workflow";
import { nowIso } from "./http";

const sessions = new Map<string, TaggerSession>();

export function createSession(session: TaggerSession) {
  sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId) ?? null;
}

export function saveSessionDraft(sessionId: string, draft: unknown) {
  const session = getSession(sessionId);
  if (!session) return null;
  const updated = {
    ...session,
    status: "draft" as const,
    draft,
    updatedAt: nowIso(),
  };
  sessions.set(sessionId, updated);
  return updated;
}

export function completeSession(sessionId: string, payload: TaggerCompletePayload) {
  const session = getSession(sessionId);
  if (!session) return null;
  const completedAt = nowIso();
  const result = { ...payload, sessionId, completedAt };
  const updated = {
    ...session,
    status: "completed" as const,
    result,
    completedAt,
    updatedAt: completedAt,
  };
  sessions.set(sessionId, updated);
  return updated;
}

export function saveSessionWebhookStatus(sessionId: string, webhook: NonNullable<TaggerSession["webhook"]>) {
  const session = getSession(sessionId);
  if (!session) return null;
  const updated = {
    ...session,
    webhook,
    updatedAt: nowIso(),
  };
  sessions.set(sessionId, updated);
  return updated;
}
