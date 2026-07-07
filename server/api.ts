import { db, jsonResponse, nowIso } from "./db";
import { deriveAnnotationBuckets, FishAnnotationPayload } from "../src/workflow";

type RouteHandler = (request: Request, params: Record<string, string>) => Response | Promise<Response>;

const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: RouteHandler }> = [];

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

route("GET", "/api/health", () => jsonResponse({ ok: true, at: nowIso() }));

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
  if (request.method === "OPTIONS") return jsonResponse({});
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
