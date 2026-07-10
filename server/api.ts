import { jsonResponse, nowIso, optionsResponse } from "./http";
import { createSession, getSession, saveSessionDraft, completeSession, saveSessionWebhookStatus } from "./sessionStore";
import { dashboardSeed, deriveAnnotationBuckets, FishAnnotationPayload, TaggerCompletePayload, TaggerSession } from "../src/workflow";

type RouteHandler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: RouteHandler }> = [];
const sessionEventListeners = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const textEncoder = new TextEncoder();
const SESSION_EVENT_WINDOW_MS = 60_000;
const distDir = `${process.cwd()}/dist`;
const staticMimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function route(method: string, path: string, handler: RouteHandler) {
  const keys = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const pattern = new RegExp(`^${path.replace(/:([A-Za-z0-9_]+)/g, "([^/]+)")}$`);
  routes.push({ method, pattern, keys, handler });
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function encodeSse(event: string, data: unknown) {
  return textEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function notifySessionListeners(sessionId: string, event: string, data: unknown) {
  const listeners = sessionEventListeners.get(sessionId);
  if (!listeners) return;
  const encoded = encodeSse(event, data);
  for (const listener of listeners) {
    try {
      listener.enqueue(encoded);
      listener.close();
    } catch {
      // Client already disconnected.
    }
  }
  sessionEventListeners.delete(sessionId);
}

async function deliverCompletionWebhook(session: TaggerSession) {
  if (!session.webhookUrl || !session.result) return undefined;

  const deliveredAt = nowIso();
  try {
    const response = await globalThis.fetch(session.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "fishcross-tagger/0.1",
      },
      body: JSON.stringify({
        type: "fishcross.session.completed",
        sessionId: session.id,
        image: session.image,
        metadata: session.metadata ?? {},
        result: session.result,
        deliveredAt,
      }),
    });
    return saveSessionWebhookStatus(session.id, {
      delivered: response.ok,
      deliveredAt,
      status: response.status,
      error: response.ok ? undefined : `Webhook returned ${response.status}`,
    });
  } catch (error) {
    return saveSessionWebhookStatus(session.id, {
      delivered: false,
      deliveredAt,
      error: error instanceof Error ? error.message : "Webhook delivery failed",
    });
  }
}

route("GET", "/api/health", () => jsonResponse({ ok: true, at: nowIso() }));

route("POST", "/api/sessions", async (request) => {
  const body = (await request.json()) as {
    image?: {
      id?: string;
      url?: string;
      name?: string;
      width?: number;
      height?: number;
    };
    webhookUrl?: string;
    returnUrl?: string;
    metadata?: Record<string, unknown>;
    options?: Record<string, unknown>;
  };
  if (!body.image?.url) {
    return jsonResponse({ error: "image.url is required" }, { status: 400 });
  }

  const sessionId = id("session");
  const createdAt = nowIso();
  const session = createSession({
    id: sessionId,
    image: {
      id: body.image.id ?? sessionId,
      url: body.image.url,
      name: body.image.name,
      width: body.image.width,
      height: body.image.height,
    },
    status: "open",
    webhookUrl: body.webhookUrl,
    returnUrl: body.returnUrl,
    metadata: body.metadata ?? {},
    options: body.options ?? {},
    createdAt,
    updatedAt: createdAt,
  });
  return jsonResponse(
    {
      session,
      taggerUrl: `/s/${sessionId}`,
    },
    { status: 201 },
  );
});

route("GET", "/api/sessions/:sessionId", (_request, params) => {
  const session = getSession(params.sessionId);
  if (!session) return jsonResponse({ error: "Session not found" }, { status: 404 });
  return jsonResponse(session);
});

route("GET", "/api/sessions/:sessionId/events", (_request, params) => {
  const session = getSession(params.sessionId);
  if (!session) return jsonResponse({ error: "Session not found" }, { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (session.status === "completed" && session.result) {
        controller.enqueue(
          encodeSse("session.completed", {
            sessionId: params.sessionId,
            result: session.result,
          }),
        );
        controller.close();
        return;
      }

      let listeners = sessionEventListeners.get(params.sessionId);
      if (!listeners) {
        listeners = new Set();
        sessionEventListeners.set(params.sessionId, listeners);
      }
      listeners.add(controller);
      controller.enqueue(encodeSse("session.open", { sessionId: params.sessionId }));

      const timeout = setTimeout(() => {
        listeners?.delete(controller);
        if (listeners?.size === 0) sessionEventListeners.delete(params.sessionId);
        try {
          controller.enqueue(encodeSse("session.timeout", { sessionId: params.sessionId }));
          controller.close();
        } catch {
          // Client already disconnected.
        }
      }, SESSION_EVENT_WINDOW_MS);

      _request.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        listeners?.delete(controller);
        if (listeners?.size === 0) sessionEventListeners.delete(params.sessionId);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
});

route("POST", "/api/sessions/:sessionId/draft", async (request, params) => {
  const draft = await request.json();
  const session = saveSessionDraft(params.sessionId, draft);
  if (!session) return jsonResponse({ error: "Session not found" }, { status: 404 });
  return jsonResponse({ ok: true, sessionId: params.sessionId, updatedAt: session.updatedAt });
});

route("POST", "/api/sessions/:sessionId/complete", async (request, params) => {
  const payload = (await request.json()) as TaggerCompletePayload;
  let session = completeSession(params.sessionId, payload);
  if (!session?.result) return jsonResponse({ error: "Session not found" }, { status: 404 });
  session = (await deliverCompletionWebhook(session)) ?? session;
  notifySessionListeners(params.sessionId, "session.completed", {
    sessionId: params.sessionId,
    result: session.result,
  });
  return jsonResponse({ ok: true, sessionId: params.sessionId, completedAt: session.completedAt, webhook: session.webhook });
});

route("GET", "/api/dashboard", () => {
  return jsonResponse(dashboardSeed);
});

route("POST", "/api/batches", async (request) => {
  const body = (await request.json()) as { name?: string; source?: string };
  const batch = {
    id: id("batch"),
    name: body.name?.trim() || "Untitled batch",
    source: body.source?.trim() || null,
    createdAt: nowIso(),
  };
  return jsonResponse(batch, { status: 201 });
});

route("POST", "/api/tasks/:taskId/results", async (request, params) => {
  const annotation = (await request.json()) as FishAnnotationPayload & { userId?: string };
  const buckets = deriveAnnotationBuckets(annotation);
  const resultId = id("result");
  const createdAt = nowIso();
  return jsonResponse({ id: resultId, taskId: params.taskId, buckets, createdAt }, { status: 201 });
});

route("POST", "/api/datasets", async (request) => {
  const body = (await request.json()) as { name?: string };
  const datasetId = body.name?.trim() || id("dataset");
  const manifest = {
    version: datasetId,
    createdAt: nowIso(),
    source: "sqlite-consensus",
    status: "draft",
  };
  return jsonResponse({ id: datasetId, manifest }, { status: 201 });
});

route("POST", "/api/training-runs", async (request) => {
  const body = (await request.json()) as {
    datasetVersionId: string;
    baseModelKey?: string;
    provider?: string;
    modelName?: string;
    gpu?: string;
    imgsz?: number;
    epochs?: number;
  };
  const runId = id("run");
  const createdAt = nowIso();
  const config = {
    modelName: body.modelName ?? "yolo11n-koi",
    gpu: body.gpu ?? "RTX 4090",
    imgsz: body.imgsz ?? 640,
    epochs: body.epochs ?? 80,
  };
  return jsonResponse({ id: runId, config, status: "queued", createdAt }, { status: 201 });
});

function matchRoute(request: Request) {
  const url = new URL(request.url);
  for (const candidate of routes) {
    if (candidate.method !== request.method) continue;
    const match = candidate.pattern.exec(url.pathname);
    if (!match) continue;
    return {
      handler: candidate.handler,
      params: Object.fromEntries(candidate.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])])),
    };
  }
  return null;
}

async function staticResponse(request: Request) {
  const url = new URL(request.url);
  const safePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const filePath = safePath && !safePath.includes("..") ? `${distDir}/${safePath}` : `${distDir}/index.html`;
  const file = Bun.file(filePath);

  if (await file.exists()) {
    const extension = filePath.match(/\.[^.]+$/)?.[0] ?? ".html";
    return new Response(file, {
      headers: {
        "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
        "Content-Type": staticMimeTypes[extension] ?? "application/octet-stream",
      },
    });
  }

  const index = Bun.file(`${distDir}/index.html`);
  if (await index.exists()) {
    return new Response(index, {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  return jsonResponse({ error: "Not found" }, { status: 404 });
}

export async function fetch(request: Request) {
  if (request.method === "OPTIONS") return optionsResponse();
  const matched = matchRoute(request);
  if (!matched) return staticResponse(request);

  try {
    return await matched.handler(request, matched.params);
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "Internal server error" }, { status: 500 });
  }
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  Bun.serve({ port, fetch });
  console.log(`Koi Tag API listening on :${port}`);
}
