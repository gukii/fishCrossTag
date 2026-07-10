export type WorkflowPoint = {
  x: number;
  y: number;
};

export type WorkflowBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FinMode = "none" | "one-sided-visible" | "two-sided-visible";

export type AnnotationBucket =
  | "has_fin_line"
  | "no_fin_line"
  | "one_sided_fin"
  | "two_sided_fin"
  | "bent_body"
  | "straight_body"
  | "edge_cut"
  | "small_fish"
  | "large_fish"
  | "wide_crop_needed";

export type FishAnnotationPayload = {
  bodyLine: WorkflowPoint[];
  finLine?: WorkflowPoint[];
  finMode?: FinMode;
  correctedPolygon?: WorkflowPoint[];
  correctedBox?: WorkflowBox;
  imageWidth: number;
  imageHeight: number;
};

export type TaggerSessionImage = {
  id: string;
  url: string;
  name?: string;
  width?: number;
  height?: number;
};

export type TaggerAnnotationResult = FishAnnotationPayload & {
  fishId: string;
  buckets: AnnotationBucket[];
  preview?: {
    dataUrl: string;
    width: number;
    height: number;
    mimeType: "image/jpeg";
  };
  cropSettings?: {
    marginXByLength: number;
    marginYByLength: number;
    applyVignette: boolean;
  };
};

export type TaggerCompletePayload = {
  sessionId?: string;
  imageId: string;
  annotations: TaggerAnnotationResult[];
  metadata?: Record<string, unknown>;
  completedAt: string;
};

export type TaggerSession = {
  id: string;
  image: TaggerSessionImage;
  status: "open" | "draft" | "completed" | "cancelled";
  returnUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
  options?: Record<string, unknown>;
  draft?: unknown;
  result?: TaggerCompletePayload;
  webhook?: {
    delivered: boolean;
    deliveredAt?: string;
    status?: number;
    error?: string;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type WorkflowStats = {
  imageBatches: number;
  queuedTasks: number;
  replicatedTasks: number;
  trainingReady: number;
  activeTrainingRuns: number;
  candidateModels: number;
};

export type QueueSummary = {
  id: string;
  name: string;
  description: string;
  taskCount: number;
  requiredReplicates: number;
  completedReplicates: number;
};

export type TrainingRunSummary = {
  id: string;
  datasetVersion: string;
  modelName: string;
  status: "queued" | "running" | "finished" | "failed";
  provider: "manual" | "runpod" | "vast";
  gpu: string;
  startedAt: string;
  metrics?: {
    map50?: number;
    finRecall?: number;
    edgeCutRecall?: number;
  };
};

export function bodyLengthPx(annotation: Pick<FishAnnotationPayload, "bodyLine" | "imageWidth" | "imageHeight">) {
  const head = annotation.bodyLine[0];
  const tail = annotation.bodyLine[annotation.bodyLine.length - 1];
  if (!head || !tail) return 0;
  return Math.hypot((head.x - tail.x) * annotation.imageWidth, (head.y - tail.y) * annotation.imageHeight);
}

export function centerlineLengthPx(annotation: Pick<FishAnnotationPayload, "bodyLine" | "imageWidth" | "imageHeight">) {
  return annotation.bodyLine.slice(1).reduce((sum, point, index) => {
    const previous = annotation.bodyLine[index];
    return sum + Math.hypot((point.x - previous.x) * annotation.imageWidth, (point.y - previous.y) * annotation.imageHeight);
  }, 0);
}

export function deriveFinMode(annotation: Pick<FishAnnotationPayload, "bodyLine" | "finLine" | "finMode">): FinMode {
  if (annotation.finMode) return annotation.finMode;
  if (!annotation.finLine?.length) return "none";

  const head = annotation.bodyLine[0];
  const tail = annotation.bodyLine[annotation.bodyLine.length - 1];
  const start = annotation.finLine[0];
  const end = annotation.finLine[annotation.finLine.length - 1];
  if (!head || !tail || !start || !end) return "none";

  const sideOfBody = (point: WorkflowPoint) => (tail.x - head.x) * (point.y - head.y) - (tail.y - head.y) * (point.x - head.x);
  const startSide = sideOfBody(start);
  const endSide = sideOfBody(end);
  return startSide * endSide < 0 ? "two-sided-visible" : "one-sided-visible";
}

export function deriveAnnotationBuckets(annotation: FishAnnotationPayload): AnnotationBucket[] {
  const buckets = new Set<AnnotationBucket>();
  const lengthPx = bodyLengthPx(annotation);
  const curveLengthPx = centerlineLengthPx(annotation);
  const bendRatio = lengthPx > 0 ? curveLengthPx / lengthPx : 1;
  const finMode = deriveFinMode(annotation);

  buckets.add(finMode === "none" ? "no_fin_line" : "has_fin_line");
  if (finMode === "one-sided-visible") buckets.add("one_sided_fin");
  if (finMode === "two-sided-visible") buckets.add("two_sided_fin");
  buckets.add(bendRatio >= 1.18 ? "bent_body" : "straight_body");
  if (lengthPx > 0 && lengthPx < 220) buckets.add("small_fish");
  if (lengthPx >= 700) buckets.add("large_fish");

  const box = annotation.correctedBox;
  if (box) {
    if (box.x <= 0.01 || box.y <= 0.01 || box.x + box.width >= 0.99 || box.y + box.height >= 0.99) {
      buckets.add("edge_cut");
    }
    const widthPx = box.width * annotation.imageWidth;
    if (lengthPx > 0 && widthPx / lengthPx > 0.32) {
      buckets.add("wide_crop_needed");
    }
  }

  return [...buckets];
}

export const dashboardSeed = {
  stats: {
    imageBatches: 4,
    queuedTasks: 186,
    replicatedTasks: 42,
    trainingReady: 318,
    activeTrainingRuns: 1,
    candidateModels: 2,
  } satisfies WorkflowStats,
  queues: [
    {
      id: "needs-first-pass",
      name: "Needs first pass",
      description: "Fresh uploads and model pre-labels waiting for human correction.",
      taskCount: 118,
      requiredReplicates: 1,
      completedReplicates: 0,
    },
    {
      id: "needs-second-pass",
      name: "Needs second pass",
      description: "Hard cases replicated by another user before review.",
      taskCount: 46,
      requiredReplicates: 2,
      completedReplicates: 1,
    },
    {
      id: "disagreement-review",
      name: "Disagreement review",
      description: "Annotations with line, fin, or crop geometry disagreement.",
      taskCount: 22,
      requiredReplicates: 3,
      completedReplicates: 2,
    },
  ] satisfies QueueSummary[],
  trainingRuns: [
    {
      id: "run-017",
      datasetVersion: "dataset-v17",
      modelName: "yolo11n-koi",
      status: "running",
      provider: "runpod",
      gpu: "RTX 4090",
      startedAt: "Tonight 01:30",
    },
    {
      id: "run-016",
      datasetVersion: "dataset-v16",
      modelName: "yolo11s-koi",
      status: "finished",
      provider: "vast",
      gpu: "RTX 4090",
      startedAt: "Yesterday 01:30",
      metrics: {
        map50: 0.84,
        finRecall: 0.61,
        edgeCutRecall: 0.72,
      },
    },
  ] satisfies TrainingRunSummary[],
};
