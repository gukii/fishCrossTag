import { db, jsonResponse, nowIso, optionsResponse } from "./db";
import { deriveAnnotationBuckets, FishAnnotationPayload, TaggerCompletePayload, TaggerSession } from "../src/workflow";

type RouteHandler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: RouteHandler }> = [];
const sessionEventListeners = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const textEncoder = new TextEncoder();
const SESSION_EVENT_WINDOW_MS = 60_000;

function route(method: string, path: string, handler: RouteHandler) {
  const keys = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const pattern = new RegExp(`^${path.replace(/:([A-Za-z0-9_]+)/g, "([^/]+)")}$`);
  routes.push({ method, pattern, keys, handler });
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function rows<T>(sql: string, params: unknown[] = []) {
  return db.query(sql).all(...params) as T[];
}

function row<T>(sql: string, params: unknown[] = []) {
  return db.query(sql).get(...params) as T | null;
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

type SessionRow = {
  id: string;
  external_image_id: string;
  image_url: string;
  image_name: string | null;
  image_width: number | null;
  image_height: number | null;
  webhook_url: string | null;
  return_url: string | null;
  metadata_json: string | null;
  options_json: string | null;
  draft_json: string | null;
  result_json: string | null;
  status: TaggerSession["status"];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function parseJsonObject(value: string | null) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function sessionFromRow(session: SessionRow): TaggerSession {
  return {
    id: session.id,
    image: {
      id: session.external_image_id,
      url: session.image_url,
      name: session.image_name ?? undefined,
      width: session.image_width ?? undefined,
      height: session.image_height ?? undefined,
    },
    status: session.status,
    webhookUrl: session.webhook_url ?? undefined,
    returnUrl: session.return_url ?? undefined,
    metadata: parseJsonObject(session.metadata_json),
    options: parseJsonObject(session.options_json),
    draft: parseJsonObject(session.draft_json),
    result: session.result_json ? (JSON.parse(session.result_json) as TaggerCompletePayload) : undefined,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    completedAt: session.completed_at ?? undefined,
  };
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
  db.query(
    `insert into tagger_sessions (
      id,
      external_image_id,
      image_url,
      image_name,
      image_width,
      image_height,
      webhook_url,
      return_url,
      metadata_json,
      options_json,
      created_at,
      updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    body.image.id ?? sessionId,
    body.image.url,
    body.image.name ?? null,
    body.image.width ?? null,
    body.image.height ?? null,
    body.webhookUrl ?? null,
    body.returnUrl ?? null,
    JSON.stringify(body.metadata ?? {}),
    JSON.stringify(body.options ?? {}),
    createdAt,
    createdAt,
  );

  const session = sessionFromRow(row<SessionRow>("select * from tagger_sessions where id = ?", [sessionId])!);
  return jsonResponse(
    {
      session,
      taggerUrl: `/s/${sessionId}`,
    },
    { status: 201 },
  );
});

route("GET", "/api/sessions/:sessionId", (_request, params) => {
  const session = row<SessionRow>("select * from tagger_sessions where id = ?", [params.sessionId]);
  if (!session) return jsonResponse({ error: "Session not found" }, { status: 404 });
  return jsonResponse(sessionFromRow(session));
});

route("GET", "/api/sessions/:sessionId/events", (_request, params) => {
  const session = row<SessionRow>("select * from tagger_sessions where id = ?", [params.sessionId]);
  if (!session) return jsonResponse({ error: "Session not found" }, { status: 404 });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (session.status === "completed" && session.result_json) {
        controller.enqueue(
          encodeSse("session.completed", {
            sessionId: params.sessionId,
            result: JSON.parse(session.result_json),
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
  const updatedAt = nowIso();
  const result = db.query("update tagger_sessions set draft_json = ?, status = 'draft', updated_at = ? where id = ?").run(JSON.stringify(draft), updatedAt, params.sessionId);
  if (result.changes === 0) return jsonResponse({ error: "Session not found" }, { status: 404 });
  return jsonResponse({ ok: true, sessionId: params.sessionId, updatedAt });
});

route("POST", "/api/sessions/:sessionId/complete", async (request, params) => {
  const payload = (await request.json()) as TaggerCompletePayload;
  const completedAt = nowIso();
  const completedPayload = { ...payload, sessionId: params.sessionId, completedAt };
  const result = db
    .query("update tagger_sessions set result_json = ?, status = 'completed', completed_at = ?, updated_at = ? where id = ?")
    .run(JSON.stringify(completedPayload), completedAt, completedAt, params.sessionId);
  if (result.changes === 0) return jsonResponse({ error: "Session not found" }, { status: 404 });
  notifySessionListeners(params.sessionId, "session.completed", {
    sessionId: params.sessionId,
    result: completedPayload,
  });
  return jsonResponse({ ok: true, sessionId: params.sessionId, completedAt });
});

route("GET", "/api/dashboard", () => {
  const stats = row<{
    imageBatches: number;
    queuedTasks: number;
    replicatedTasks: number;
    trainingReady: number;
    activeTrainingRuns: number;
    candidateModels: number;
  }>(
    `select
      (select count(*) from image_batches) as imageBatches,
      (select count(*) from annotation_tasks where status = 'queued') as queuedTasks,
      (select count(*) from annotation_tasks where completed_replicates > 0) as replicatedTasks,
      (select count(*) from consensus_annotations where status = 'approved') as trainingReady,
      (select count(*) from training_runs where status in ('queued', 'running')) as activeTrainingRuns,
      (select count(*) from model_versions where status = 'candidate') as candidateModels`,
  );
  const queues = rows(
    `select
      queues.id,
      queues.name,
      queues.description,
      queues.required_replicates as requiredReplicates,
      count(annotation_tasks.id) as taskCount,
      coalesce(sum(annotation_tasks.completed_replicates), 0) as completedReplicates
    from queues
    left join annotation_tasks on annotation_tasks.queue_id = queues.id
    group by queues.id
    order by queues.created_at`,
  );
  const trainingRuns = rows(
    `select
      id,
      dataset_version_id as datasetVersion,
      json_extract(config_json, '$.modelName') as modelName,
      status,
      provider,
      json_extract(config_json, '$.gpu') as gpu,
      created_at as startedAt,
      metrics_json as metricsJson
    from training_runs
    order by created_at desc
    limit 12`,
  ).map((run: any) => ({
    ...run,
    modelName: run.modelName ?? "yolo11n-koi",
    gpu: run.gpu ?? "unassigned",
    metrics: run.metricsJson ? JSON.parse(run.metricsJson) : undefined,
    metricsJson: undefined,
  }));

  return jsonResponse({ stats, queues, trainingRuns });
});

route("POST", "/api/batches", async (request) => {
  const body = (await request.json()) as { name?: string; source?: string };
  const batch = {
    id: id("batch"),
    name: body.name?.trim() || "Untitled batch",
    source: body.source?.trim() || null,
    createdAt: nowIso(),
  };
  db.query("insert into image_batches (id, name, source, created_at) values (?, ?, ?, ?)").run(batch.id, batch.name, batch.source, batch.createdAt);
  return jsonResponse(batch, { status: 201 });
});

route("POST", "/api/tasks/:taskId/results", async (request, params) => {
  const annotation = (await request.json()) as FishAnnotationPayload & { userId?: string };
  const buckets = deriveAnnotationBuckets(annotation);
  const resultId = id("result");
  const createdAt = nowIso();
  db.query(
    `insert into annotation_results (id, task_id, user_id, annotation_json, bucket_json, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(resultId, params.taskId, annotation.userId ?? null, JSON.stringify(annotation), JSON.stringify(buckets), createdAt);
  db.query(
    `update annotation_tasks
     set completed_replicates = completed_replicates + 1, updated_at = ?
     where id = ?`,
  ).run(createdAt, params.taskId);
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
  db.query("insert into dataset_versions (id, status, manifest_json, created_at) values (?, ?, ?, ?)").run(datasetId, "draft", JSON.stringify(manifest), manifest.createdAt);
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
  db.query(
    `insert into training_runs (id, dataset_version_id, base_model_key, config_json, status, provider, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, body.datasetVersionId, body.baseModelKey ?? null, JSON.stringify(config), "queued", body.provider ?? "manual", createdAt, createdAt);
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

export async function fetch(request: Request) {
  if (request.method === "OPTIONS") return optionsResponse();
  const matched = matchRoute(request);
  if (!matched) return jsonResponse({ error: "Not found" }, { status: 404 });

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
