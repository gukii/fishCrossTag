import { ChangeEvent, PointerEvent, RefObject, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  Crosshair,
  Download,
  Fingerprint,
  ImagePlus,
  Minus,
  PanelBottomClose,
  PanelBottomOpen,
  Plus,
  RotateCcw,
  Settings,
  Signature,
  Trash2,
  Undo2,
  ZoomIn,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";

type Mode = "tag" | "move";
type PaintMode = "direct" | "crosshair";
type Handle = "nw" | "ne" | "sw" | "se" | "move";
type EditTarget = "auto" | "body" | "fin";

type Point = {
  x: number;
  y: number;
};

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

type KoiTag = {
  id: string;
  bodyLine: Point[];
  finLine?: Point[];
  bbox: Box;
  correctedBBox?: Box;
  correctedBBoxEdited?: boolean;
  correctionRotationDeg?: number;
  correctedPoints?: Point[];
  status: "active" | "done";
  createdAt: string;
  lastPaintedAt: string;
};

type ImageInfo = {
  name: string;
  src: string;
  width: number;
  height: number;
};

type DragState =
  | { type: "stroke"; pointerId: number; points: Point[]; source: "direct" | "crosshair" }
  | { type: "bbox"; pointerId: number; tagId: string; handle: Handle; startBox: Box; startPoint: Point }
  | { type: "rotate"; pointerId: number; tagId: string; startAngle: number; startRotation: number; center: Point }
  | { type: "finishTap"; pointerId: number; tagId: string; startPoint: Point; moved: boolean };

type GestureState = {
  startView: ViewTransform;
  startCentroid: Point;
  startDistance: number;
};

type CorrectedGeometry = {
  rotation: number;
  correctedBox: Box;
};

type CropSettings = {
  marginXByLength: number;
  marginYByLength: number;
  crosshairOffsetPx: number;
  showCrosshairIntro: boolean;
  showExportNumbers: boolean;
};

const MIN_STROKE_POINTS = 3;
const STROKE_PADDING = 0.035;
const MIN_VIEW_SCALE = 0.05;
const MAX_VIEW_SCALE = 8;
const VIEW_ZOOM_STEP = 1.2;
const AUTO_FINISH_AFTER_MS = 2000;
const DEFAULT_CROP_SETTINGS: CropSettings = {
  marginXByLength: 0.1,
  marginYByLength: 0.1,
  crosshairOffsetPx: 50,
  showCrosshairIntro: true,
  showExportNumbers: true,
};
const DEFAULT_IMAGE_SRC = `${import.meta.env.BASE_URL}images/default-koi.jpg`;
const DEFAULT_IMAGE_NAME = "20_0.jpg";
const HMR_TIME_KEY = "koi-tag-last-hot-reload";
const CROP_SETTINGS_KEY = "koi-tag-crop-settings";

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function saveHotReloadTime() {
  const time = formatTime();
  localStorage.setItem(HMR_TIME_KEY, time);
  window.dispatchEvent(new CustomEvent("koi-hmr-time", { detail: time }));
}

if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", saveHotReloadTime);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function loadCropSettings(): CropSettings {
  try {
    const stored = localStorage.getItem(CROP_SETTINGS_KEY);
    if (!stored) return DEFAULT_CROP_SETTINGS;
    const parsed = JSON.parse(stored) as Partial<CropSettings>;
    const storedX = Number(parsed.marginXByLength ?? DEFAULT_CROP_SETTINGS.marginXByLength);
    const storedY = Number(parsed.marginYByLength ?? DEFAULT_CROP_SETTINGS.marginYByLength);
    const storedCrosshairOffset = Number(parsed.crosshairOffsetPx ?? DEFAULT_CROP_SETTINGS.crosshairOffsetPx);
    if (storedX === 0.22 && storedY === 0.04) return DEFAULT_CROP_SETTINGS;

    return {
      marginXByLength: clamp(storedX, 0, 2),
      marginYByLength: clamp(storedY, 0, 2),
      crosshairOffsetPx: storedCrosshairOffset === 84 ? DEFAULT_CROP_SETTINGS.crosshairOffsetPx : clamp(storedCrosshairOffset, 20, 180),
      showCrosshairIntro: parsed.showCrosshairIntro ?? DEFAULT_CROP_SETTINGS.showCrosshairIntro,
      showExportNumbers: parsed.showExportNumbers ?? DEFAULT_CROP_SETTINGS.showExportNumbers,
    };
  } catch {
    return DEFAULT_CROP_SETTINGS;
  }
}

function normalizeBox(box: Box): Box {
  const x1 = clamp(Math.min(box.x, box.x + box.width), 0, 1);
  const y1 = clamp(Math.min(box.y, box.y + box.height), 0, 1);
  const x2 = clamp(Math.max(box.x, box.x + box.width), 0, 1);
  const y2 = clamp(Math.max(box.y, box.y + box.height), 0, 1);

  return {
    x: x1,
    y: y1,
    width: Math.max(0.01, x2 - x1),
    height: Math.max(0.01, y2 - y1),
  };
}

function normalizeFreeBox(box: Box): Box {
  const x1 = Math.min(box.x, box.x + box.width);
  const y1 = Math.min(box.y, box.y + box.height);
  const x2 = Math.max(box.x, box.x + box.width);
  const y2 = Math.max(box.y, box.y + box.height);

  return {
    x: x1,
    y: y1,
    width: Math.max(0.01, x2 - x1),
    height: Math.max(0.01, y2 - y1),
  };
}

function boxFromPoints(points: Point[], padding = STROKE_PADDING): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return normalizeBox({
    x: Math.min(...xs) - padding,
    y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2,
    height: Math.max(...ys) - Math.min(...ys) + padding * 2,
  });
}

function expandBoxToPoints(box: Box, points: Point[]) {
  const pointsBox = boxFromPoints(points, 0.018);
  return normalizeBox({
    x: Math.min(box.x, pointsBox.x),
    y: Math.min(box.y, pointsBox.y),
    width: Math.max(box.x + box.width, pointsBox.x + pointsBox.width) - Math.min(box.x, pointsBox.x),
    height: Math.max(box.y + box.height, pointsBox.y + pointsBox.height) - Math.min(box.y, pointsBox.y),
  });
}

function pointSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function segmentIntersects(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p: Point, q: Point, r: Point) =>
    q.x >= Math.min(p.x, r.x) && q.x <= Math.max(p.x, r.x) && q.y >= Math.min(p.y, r.y) && q.y <= Math.max(p.y, r.y);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const epsilon = 0.000001;

  if (Math.abs(abC) < epsilon && onSegment(a, c, b)) return true;
  if (Math.abs(abD) < epsilon && onSegment(a, d, b)) return true;
  if (Math.abs(cdA) < epsilon && onSegment(c, a, d)) return true;
  if (Math.abs(cdB) < epsilon && onSegment(c, b, d)) return true;

  return abC * abD < 0 && cdA * cdB < 0;
}

function strokesIntersect(a: Point[], b: Point[], tolerance = 0.025) {
  for (let aIndex = 1; aIndex < a.length; aIndex += 1) {
    for (let bIndex = 1; bIndex < b.length; bIndex += 1) {
      const aStart = a[aIndex - 1];
      const aEnd = a[aIndex];
      const bStart = b[bIndex - 1];
      const bEnd = b[bIndex];
      if (segmentIntersects(aStart, aEnd, bStart, bEnd) || segmentDistance(aStart, aEnd, bStart, bEnd) <= tolerance) {
        return true;
      }
    }
  }

  return false;
}

function orderedBoxCorners(box: Box): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

function correctionCenter(tag: KoiTag): Point {
  return tag.bodyLine[0];
}

function boxFromPointsWithMargin(points: Point[], marginX: number, marginY: number): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    x: Math.min(...xs) - marginX,
    y: Math.min(...ys) - marginY,
    width: Math.max(...xs) - Math.min(...xs) + marginX * 2,
    height: Math.max(...ys) - Math.min(...ys) + marginY * 2,
  };
}

function boxCenter(box: Box): Point {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function expandFreeBoxByPixels(box: Box, image: ImageInfo, marginXPx: number, marginYPx: number): Box {
  return {
    x: box.x - marginXPx / image.width,
    y: box.y - marginYPx / image.height,
    width: box.width + (marginXPx * 2) / image.width,
    height: box.height + (marginYPx * 2) / image.height,
  };
}

function ensureMinBoxSizePixels(box: Box, image: ImageInfo, minWidthPx: number, minHeightPx: number): Box {
  const widthPx = box.width * image.width;
  const heightPx = box.height * image.height;
  const addWidthPx = Math.max(0, minWidthPx - widthPx);
  const addHeightPx = Math.max(0, minHeightPx - heightPx);

  return expandFreeBoxByPixels(box, image, addWidthPx / 2, addHeightPx / 2);
}

function simplifyStroke(points: Point[]) {
  if (points.length < 2) return points;

  const kept: Point[] = [];
  points.forEach((point, index) => {
    const previous = kept[kept.length - 1];
    if (!previous) {
      kept.push(point);
      return;
    }

    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (Math.hypot(dx, dy) > 0.004 || index === points.length - 1) {
      kept.push(point);
    }
  });
  return kept;
}

function pathFromPoints(points: Point[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x * 1000} ${point.y * 1000}`)
    .join(" ");
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function rotateImagePoint(point: Point, center: Point, degrees: number, image: ImageInfo): Point {
  const rotated = rotatePoint(
    { x: point.x * image.width, y: point.y * image.height },
    { x: center.x * image.width, y: center.y * image.height },
    degrees,
  );

  return {
    x: rotated.x / image.width,
    y: rotated.y / image.height,
  };
}

function pointerAngle(point: Point, center: Point, image?: ImageInfo) {
  const dx = image ? (point.x - center.x) * image.width : point.x - center.x;
  const dy = image ? (point.y - center.y) * image.height : point.y - center.y;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function verticalLineRotation(points: Point[], image?: ImageInfo) {
  const head = points[0];
  const tail = points[points.length - 1];
  const dx = image ? (head.x - tail.x) * image.width : head.x - tail.x;
  const dy = image ? (head.y - tail.y) * image.height : head.y - tail.y;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return 90 - angle;
}

function bboxStyle(box: Box) {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

function bboxHandleStyle(box: Box, handle: Handle) {
  const x = handle === "nw" || handle === "sw" ? box.x : handle === "move" ? box.x + box.width / 2 : box.x + box.width;
  const y = handle === "nw" || handle === "ne" ? box.y : handle === "move" ? box.y + box.height / 2 : box.y + box.height;

  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
  };
}

function controlScale(viewScale: number) {
  return clamp(1 / viewScale, 0.75, 2.35);
}

function pointHandleStyle(point: Point, viewScale = 1) {
  return {
    left: `${point.x * 100}%`,
    top: `${point.y * 100}%`,
    "--control-scale": controlScale(viewScale),
  };
}

function polygonCenter(points: Point[]): Point {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function polygonPoints(points: Point[]) {
  return points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ");
}

function correctionRotation(tag: KoiTag, image: ImageInfo) {
  return tag.correctionRotationDeg ?? verticalLineRotation(tag.bodyLine, image);
}

function bodyLengthPx(tag: KoiTag, image: ImageInfo) {
  const head = tag.bodyLine[0];
  const tail = tag.bodyLine[tag.bodyLine.length - 1];
  return Math.max(40, Math.hypot((head.x - tail.x) * image.width, (head.y - tail.y) * image.height));
}

function rotatedAnnotationPoints(tag: KoiTag, image: ImageInfo, rotation = correctionRotation(tag, image)) {
  const center = correctionCenter(tag);
  const sourcePoints = tag.finLine ? [...tag.bodyLine, ...tag.finLine] : tag.bodyLine;
  return sourcePoints.map((point) => rotateImagePoint(point, center, rotation, image));
}

function sourceCorrectedBox(tag: KoiTag, image: ImageInfo, rotation = correctionRotation(tag, image)) {
  if (tag.correctedBBoxEdited && tag.correctedBBox) return tag.correctedBBox;

  const rotatedPoints = rotatedAnnotationPoints(tag, image, rotation);
  const fallbackMarginPx = tag.finLine ? 1 : bodyLengthPx(tag, image) * 0.04;
  return boxFromPointsWithMargin(rotatedPoints, fallbackMarginPx / image.width, fallbackMarginPx / image.height);
}

function displayCrop(tag: KoiTag, image: ImageInfo, correctedBox: Box, settings: CropSettings) {
  const lengthPx = bodyLengthPx(tag, image);
  const padded = expandFreeBoxByPixels(correctedBox, image, lengthPx * settings.marginXByLength, lengthPx * settings.marginYByLength);
  return ensureMinBoxSizePixels(padded, image, lengthPx * 0.28, lengthPx * 0.65);
}

function orientedCorrectedBoxPoints(tag: KoiTag, image: ImageInfo) {
  const rotation = correctionRotation(tag, image);
  const center = correctionCenter(tag);
  return orderedBoxCorners(sourceCorrectedBox(tag, image, rotation)).map((point) => rotateImagePoint(point, center, -rotation, image));
}

function controlPosition(box: Box, viewScale = 1) {
  const placeBelow = box.y < 0.16;
  const top = placeBelow ? box.y + box.height + 0.018 : box.y - 0.018;
  const x = clamp(box.x + box.width / 2, 0.22, 0.78);
  const anchor = placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)";
  return {
    left: `${x * 100}%`,
    top: `${clamp(top, 0.04, 0.9) * 100}%`,
    "--control-transform": anchor,
    "--control-scale": controlScale(viewScale),
  };
}

function correctedGeometry(tag: KoiTag, image: ImageInfo): CorrectedGeometry {
  const rotation = correctionRotation(tag, image);
  const correctedBox = sourceCorrectedBox(tag, image, rotation);

  return {
    rotation,
    correctedBox,
  };
}

function coverImageFrame(image: ImageInfo, stage: PixelRect): PixelRect {
  if (stage.width <= 0 || stage.height <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const imageAspect = image.width / image.height;
  const stageAspect = stage.width / stage.height;
  const frame =
    imageAspect > stageAspect
      ? { width: stage.height * imageAspect, height: stage.height }
      : { width: stage.width, height: stage.width / imageAspect };

  return {
    x: (stage.width - frame.width) / 2,
    y: (stage.height - frame.height) / 2,
    width: frame.width,
    height: frame.height,
  };
}

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageTransformRef = useRef<HTMLDivElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const activePointers = useRef<Map<number, Point>>(new Map());
  const aimPointerId = useRef<number | null>(null);
  const gesture = useRef<GestureState | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [stageSize, setStageSize] = useState<PixelRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>("tag");
  const [paintMode, setPaintMode] = useState<PaintMode>("direct");
  const [aimPoint, setAimPoint] = useState<Point | null>(null);
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [tags, setTags] = useState<KoiTag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cropSettings, setCropSettings] = useState<CropSettings>(() => loadCropSettings());
  const [crosshairOffsetInput, setCrosshairOffsetInput] = useState(() => String(loadCropSettings().crosshairOffsetPx));
  const [showCrosshairIntro, setShowCrosshairIntro] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>("auto");
  const [hotReloadTime, setHotReloadTime] = useState(() => localStorage.getItem(HMR_TIME_KEY) ?? formatTime());
  const [hotReloadCopied, setHotReloadCopied] = useState(false);
  const [showOriginalTagId, setShowOriginalTagId] = useState<string | null>(null);

  const activeTag = tags.find((tag) => tag.id === activeTagId) ?? null;
  const editingTag = tags.find((tag) => tag.id === editingTagId) ?? null;
  const activeStroke = drag?.type === "stroke" ? drag.points : [];
  const activeDisplayBox = editingTag?.bbox;
  const activeOrientedPoints = editingTag && image && editingTag.correctionRotationDeg != null ? orientedCorrectedBoxPoints(editingTag, image) : null;
  const imageFrame = image ? coverImageFrame(image, stageSize) : null;

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    localStorage.setItem(CROP_SETTINGS_KEY, JSON.stringify(cropSettings));
  }, [cropSettings]);

  useEffect(() => {
    setCrosshairOffsetInput(String(cropSettings.crosshairOffsetPx));
  }, [cropSettings.crosshairOffsetPx]);

  function commitCrosshairOffsetInput(value = crosshairOffsetInput) {
    const parsed = Number(value);
    const next = Number.isFinite(parsed) ? clamp(parsed, 20, 180) : DEFAULT_CROP_SETTINGS.crosshairOffsetPx;
    setCropSettings((current) => ({
      ...current,
      crosshairOffsetPx: next,
    }));
    setCrosshairOffsetInput(String(next));
  }

  useEffect(() => {
    function updateHotReloadTime(event: Event) {
      setHotReloadTime((event as CustomEvent<string>).detail);
    }

    window.addEventListener("koi-hmr-time", updateHotReloadTime);
    return () => window.removeEventListener("koi-hmr-time", updateHotReloadTime);
  }, []);

  useEffect(() => {
    if (!showCrosshairIntro) return;
    const timeout = window.setTimeout(() => setShowCrosshairIntro(false), 3600);
    return () => window.clearTimeout(timeout);
  }, [showCrosshairIntro]);

  useEffect(() => {
    const probe = new Image();
    probe.onload = () => {
      setImage({
        name: DEFAULT_IMAGE_NAME,
        src: DEFAULT_IMAGE_SRC,
        width: probe.naturalWidth,
        height: probe.naturalHeight,
      });
    };
    probe.src = DEFAULT_IMAGE_SRC;
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    function updateStageSize() {
      const rect = stage.getBoundingClientRect();
      setStageSize({ x: 0, y: 0, width: rect.width, height: rect.height });
    }

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    window.addEventListener("resize", updateStageSize);
    window.addEventListener("orientationchange", updateStageSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateStageSize);
      window.removeEventListener("orientationchange", updateStageSize);
    };
  }, [image]);

  useEffect(() => {
    if (!drag || (drag.type !== "bbox" && drag.type !== "rotate")) return;

    function move(event: globalThis.PointerEvent) {
      const point = pointFromClient(event.clientX, event.clientY, { clampToImage: false });
      if (!point) return;
      if (drag.type === "bbox") {
        updateBboxDrag(drag, point);
        return;
      }

      const angle = pointerAngle(point, drag.center, image ?? undefined);
      updateTagCorrection(drag.tagId, {
        correctionRotationDeg: drag.startRotation + angle - drag.startAngle,
      });
    }

    function finish(event: globalThis.PointerEvent) {
      if (event.pointerId === drag.pointerId) {
        setDrag(null);
      }
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [drag]);

  function loadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const src = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      setImage({
        name: file.name,
        src,
        width: probe.naturalWidth,
        height: probe.naturalHeight,
      });
      setTags([]);
      setActiveTagId(null);
      setEditingTagId(null);
      setDrag(null);
      setDrawerOpen(true);
      setEditTarget("auto");
      setView({ scale: 1, x: 0, y: 0 });
    };
    probe.src = src;
  }

  function pointFromPointer(event: PointerEvent<HTMLElement>, options?: { clampToImage?: boolean }) {
    return pointFromClient(event.clientX, event.clientY, options);
  }

  function crosshairPointFromClient(clientX: number, clientY: number, options?: { clampToImage?: boolean }) {
    return pointFromClient(clientX, clientY - cropSettings.crosshairOffsetPx, options);
  }

  function currentCrosshairPoint(options?: { clampToImage?: boolean }) {
    const pointerId = aimPointerId.current;
    const pointer = pointerId == null ? null : activePointers.current.get(pointerId);
    return pointer ? crosshairPointFromClient(pointer.x, pointer.y, options) : null;
  }

  function pointFromClient(clientX: number, clientY: number, options: { clampToImage?: boolean } = {}) {
    const rect = imageTransformRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (options.clampToImage === false) {
      return { x, y };
    }

    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
    };
  }

  function imagePointToScreen(point: Point) {
    const rect = imageTransformRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: rect.left + point.x * rect.width,
      y: rect.top + point.y * rect.height,
    };
  }

  function isPointNearActiveHarness(point: Point) {
    if (!activeOrientedPoints) return false;

    const screenPoint = imagePointToScreen(point);
    if (!screenPoint) return false;
    const screenPoints = activeOrientedPoints.map(imagePointToScreen);
    if (screenPoints.some((current) => !current)) return false;
    const polygon = screenPoints as Point[];
    const center = imagePointToScreen(polygonCenter(activeOrientedPoints));
    const tolerancePx = 54;

    if (center && Math.hypot(screenPoint.x - center.x, screenPoint.y - center.y) <= tolerancePx) return true;
    if (polygon.some((corner) => Math.hypot(screenPoint.x - corner.x, screenPoint.y - corner.y) <= tolerancePx)) return true;

    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      if (pointSegmentDistance(screenPoint, start, end) <= tolerancePx) return true;
    }

    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const current = polygon[index];
      const last = polygon[previous];
      if ((current.y > screenPoint.y) !== (last.y > screenPoint.y) && screenPoint.x < ((last.x - current.x) * (screenPoint.y - current.y)) / (last.y - current.y) + current.x) {
        inside = !inside;
      }
    }

    return inside;
  }

  function screenPointFromEvent(event: PointerEvent<HTMLElement> | globalThis.PointerEvent): Point {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function pointerCentroid(points: Point[]) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  function pointerDistance(points: Point[]) {
    if (points.length < 2) return 1;
    return Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
  }

  function beginGesture() {
    const points = Array.from(activePointers.current.values());
    if (!points.length) return;
    gesture.current = {
      startView: viewRef.current,
      startCentroid: pointerCentroid(points),
      startDistance: pointerDistance(points),
    };
  }

  function updateGesture() {
    if (!gesture.current) return;
    const points = Array.from(activePointers.current.values());
    if (!points.length) return;
    const stageRect = stageRef.current?.getBoundingClientRect();
    const frame = imageFrame;
    if (!stageRect || !frame) return;

    const centroid = pointerCentroid(points);
    const distance = pointerDistance(points);
    const nextScale = clamp(gesture.current.startView.scale * (distance / gesture.current.startDistance), MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const scaleRatio = nextScale / gesture.current.startView.scale;
    const baseX = stageRect.left + frame.x;
    const baseY = stageRect.top + frame.y;

    setView({
      scale: nextScale,
      x: centroid.x - baseX - (gesture.current.startCentroid.x - baseX - gesture.current.startView.x) * scaleRatio,
      y: centroid.y - baseY - (gesture.current.startCentroid.y - baseY - gesture.current.startView.y) * scaleRatio,
    });
  }

  function zoomAtClientPoint(clientX: number, clientY: number, nextScale: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    const frame = imageFrame;
    if (!rect || !frame) return;
    const currentView = viewRef.current;
    const clampedScale = clamp(nextScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const imageX = (clientX - rect.left - frame.x - currentView.x) / currentView.scale;
    const imageY = (clientY - rect.top - frame.y - currentView.y) / currentView.scale;

    setView({
      scale: clampedScale,
      x: clientX - rect.left - frame.x - imageX * clampedScale,
      y: clientY - rect.top - frame.y - imageY * clampedScale,
    });
  }

  function zoomFromStageCenter(multiplier: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, viewRef.current.scale * multiplier);
  }

  function resetView() {
    setView({ scale: 1, x: 0, y: 0 });
  }

  function drawCorrectedCropToCanvas(canvas: HTMLCanvasElement, photo: HTMLImageElement, tag: KoiTag, crop: Box, rotation: number) {
    const cropWidthPx = Math.max(1, Math.round(crop.width * image!.width));
    const cropHeightPx = Math.max(1, Math.round(crop.height * image!.height));
    canvas.width = cropWidthPx;
    canvas.height = cropHeightPx;

    const context = canvas.getContext("2d");
    if (!context) return;

    const center = correctionCenter(tag);
    const centerX = center.x * image!.width;
    const centerY = center.y * image!.height;
    const cropX = crop.x * image!.width;
    const cropY = crop.y * image!.height;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, cropWidthPx, cropHeightPx);
    context.fillStyle = "#111614";
    context.fillRect(0, 0, cropWidthPx, cropHeightPx);
    context.translate(-cropX, -cropY);
    context.translate(centerX, centerY);
    context.rotate((rotation * Math.PI) / 180);
    context.translate(-centerX, -centerY);
    context.drawImage(photo, 0, 0, image!.width, image!.height);
  }

  function drawExportNumberBadge(canvas: HTMLCanvasElement, number: number) {
    const context = canvas.getContext("2d");
    if (!context) return;

    const radius = clamp(Math.round(canvas.height * 0.075), 28, 72);
    const x = radius + Math.round(radius * 0.35);
    const y = canvas.height - radius - Math.round(radius * 0.35);

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.shadowColor = "rgba(0, 0, 0, 0.72)";
    context.shadowBlur = Math.max(6, Math.round(radius * 0.18));
    context.shadowOffsetY = Math.max(2, Math.round(radius * 0.05));
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(4, Math.round(radius * 0.14));
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.fillStyle = "#ffffff";
    context.font = `900 ${Math.round(radius * 1.08)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(number), x, y + Math.round(radius * 0.03));
    context.restore();
  }

  async function exportCorrectedCrops() {
    if (!image || !tags.length) return;
    const sourceImage = sourceImageRef.current;
    if (!sourceImage) return;
    const exportWindow = window.open("", "_blank");
    exportWindow?.document.write("<title>Koi export</title><body style=\"margin:0;background:#111614;color:white;font-family:sans-serif\">Preparing export...</body>");

    const cropCanvases = tags.map((tag, index) => {
      const geometry = correctedGeometry(tag, image);
      const crop = displayCrop(tag, image, geometry.correctedBox, cropSettings);
      const canvas = document.createElement("canvas");
      drawCorrectedCropToCanvas(canvas, sourceImage, tag, crop, geometry.rotation);
      if (cropSettings.showExportNumbers) {
        drawExportNumberBadge(canvas, index + 1);
      }
      return canvas;
    });
    const targetHeight = Math.max(...cropCanvases.map((canvas) => canvas.height));
    const gap = Math.max(16, Math.round(targetHeight * 0.04));
    const scaledWidths = cropCanvases.map((canvas) => Math.max(1, Math.round((canvas.width / canvas.height) * targetHeight)));
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = scaledWidths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, cropCanvases.length - 1);
    outputCanvas.height = targetHeight;

    const context = outputCanvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#111614";
    context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

    let x = 0;
    cropCanvases.forEach((canvas, index) => {
      context.drawImage(canvas, x, 0, scaledWidths[index], targetHeight);
      x += scaledWidths[index] + gap;
    });

    const blob = await new Promise<Blob | null>((resolve) => outputCanvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    if (exportWindow) {
      exportWindow.location.href = url;
    } else {
      window.open(url, "_blank");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function bringTagIntoView(tag: KoiTag) {
    const stageRect = stageRef.current?.getBoundingClientRect();
    const frame = imageFrame;
    if (!stageRect || !image || !frame) return;

    const drawerRect = document.querySelector<HTMLElement>(".thumb-drawer")?.getBoundingClientRect();
    const coveredBottom = drawerRect ? Math.max(0, stageRect.bottom - drawerRect.top) : 0;
    const visibleHeight = Math.max(80, stageRect.height - coveredBottom);
    const screenPadding = 24;
    const availableWidth = Math.max(80, stageRect.width - screenPadding * 2);
    const availableHeight = Math.max(80, visibleHeight - screenPadding * 2);
    const focusedTag: KoiTag = {
      ...tag,
      correctionRotationDeg: tag.correctionRotationDeg ?? verticalLineRotation(tag.bodyLine, image),
    };
    const focusBox = boxFromPointsWithMargin(orientedCorrectedBoxPoints(focusedTag, image), 0, 0);
    const targetScale = Math.min(
      (availableWidth * 0.8) / Math.max(1, focusBox.width * frame.width),
      (availableHeight * 0.8) / Math.max(1, focusBox.height * frame.height),
    );
    const nextScale = clamp(targetScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const center = boxCenter(focusBox);
    const targetX = stageRect.width / 2;
    const targetY = visibleHeight / 2;

    setView({
      scale: nextScale,
      x: targetX - frame.x - center.x * frame.width * nextScale,
      y: targetY - frame.y - center.y * frame.height * nextScale,
    });
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>) {
    if (mode !== "move") return;
    event.preventDefault();
    const multiplier = event.deltaY < 0 ? VIEW_ZOOM_STEP : 1 / VIEW_ZOOM_STEP;
    zoomAtClientPoint(event.clientX, event.clientY, viewRef.current.scale * multiplier);
  }

  function resetGestureForRemainingPointers() {
    if (activePointers.current.size && mode === "move") {
      beginGesture();
      return;
    }
    gesture.current = null;
  }

  function startStrokeAtPoint(event: PointerEvent<HTMLDivElement>, point: Point, source: "direct" | "crosshair") {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ type: "stroke", pointerId: event.pointerId, points: [point], source });
  }

  function startStroke(event: PointerEvent<HTMLDivElement>) {
    if (!image || mode !== "tag" || (event.target as HTMLElement).closest("[data-no-draw]")) return;
    const point = pointFromPointer(event);
    if (!point) return;

    startStrokeAtPoint(event, point, "direct");
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!image) return;
    if (mode !== "move" && (event.target as HTMLElement).closest("[data-no-draw]")) return;

    activePointers.current.set(event.pointerId, screenPointFromEvent(event));
    event.currentTarget.setPointerCapture(event.pointerId);

    if (mode === "move") {
      setDrag(null);
      beginGesture();
      return;
    }

    if (paintMode === "crosshair") {
      if (aimPointerId.current == null) {
        aimPointerId.current = event.pointerId;
      }
      const point = currentCrosshairPoint() ?? crosshairPointFromClient(event.clientX, event.clientY);
      if (point) setAimPoint(point);

      if (activePointers.current.size < 2) {
        return;
      }

      if (point && !drag) {
        startStrokeAtPoint(event, point, "crosshair");
      }
      return;
    }

    if (activePointers.current.size > 1) {
      return;
    }

    const point = pointFromPointer(event, { clampToImage: false });
    if (point && isPointNearActiveHarness(point)) {
      return;
    }

    startStroke(event);
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (activePointers.current.has(event.pointerId)) {
      activePointers.current.set(event.pointerId, screenPointFromEvent(event));
    }

    if (gesture.current || activePointers.current.size > 1) {
      if (mode === "tag" && paintMode === "crosshair") {
        if (event.pointerId === aimPointerId.current) {
          const point = crosshairPointFromClient(event.clientX, event.clientY);
          if (point) setAimPoint(point);
        }
        continueDrag(event);
        return;
      }
      if (!gesture.current) {
        setDrag(null);
        beginGesture();
      }
      updateGesture();
      return;
    }

    if (mode === "tag" && paintMode === "crosshair") {
      if (event.pointerId === aimPointerId.current) {
        const point = crosshairPointFromClient(event.clientX, event.clientY);
        if (point) setAimPoint(point);
      }
      return;
    }

    continueDrag(event);
  }

  function handleStagePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!gesture.current && !(mode === "tag" && paintMode === "crosshair")) {
      finishDrag(event);
    }

    activePointers.current.delete(event.pointerId);
    if (event.pointerId === aimPointerId.current) {
      aimPointerId.current = activePointers.current.keys().next().value ?? null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (mode === "tag" && paintMode === "crosshair") {
      if (activePointers.current.size < 2 && drag?.type === "stroke") {
        finishDrag(event);
      }
      resetGestureForRemainingPointers();
      return;
    }

    resetGestureForRemainingPointers();
  }

  function continueDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    if (drag.type === "stroke" && drag.source === "crosshair") {
      if (event.pointerId !== aimPointerId.current) return;
    } else if (drag.pointerId !== event.pointerId) {
      return;
    }
    const point =
      drag.type === "stroke" && drag.source === "crosshair"
        ? crosshairPointFromClient(event.clientX, event.clientY, { clampToImage: true })
        : pointFromPointer(event, { clampToImage: drag.type !== "bbox" });
    if (!point) return;

    if (drag.type === "stroke" && drag.source === "crosshair") {
      setAimPoint(point);
    }

    if (drag.type === "finishTap") {
      const moved = drag.moved || Math.hypot(point.x - drag.startPoint.x, point.y - drag.startPoint.y) > 0.01;
      setDrag({ ...drag, moved });
      return;
    }

    if (drag.type === "stroke") {
      setDrag({ ...drag, points: [...drag.points, point] });
      return;
    }

    if (drag.type === "bbox") {
      updateBboxDrag(drag, point);
    }
  }

  function updateBboxDrag(activeDrag: Extract<DragState, { type: "bbox" }>, point: Point) {
    setTags((current) =>
      current.map((tag) => {
        if (tag.id !== activeDrag.tagId) return tag;
        const targetKey: "bbox" | "correctedBBox" = tag.correctionRotationDeg == null ? "bbox" : "correctedBBox";
        const correctedEditPatch = targetKey === "correctedBBox" ? { correctedBBoxEdited: true } : {};
        const normalizeTargetBox = targetKey === "correctedBBox" ? normalizeFreeBox : normalizeBox;
        const dragPoint = targetKey === "correctedBBox" && image ? rotateImagePoint(point, correctionCenter(tag), correctionRotation(tag, image), image) : point;

        if (activeDrag.handle === "move") {
          return {
            ...tag,
            ...correctedEditPatch,
            [targetKey]: normalizeTargetBox({
              ...activeDrag.startBox,
              x: activeDrag.startBox.x + dragPoint.x - activeDrag.startPoint.x,
              y: activeDrag.startBox.y + dragPoint.y - activeDrag.startPoint.y,
            }),
          };
        }

        const x2 = activeDrag.startBox.x + activeDrag.startBox.width;
        const y2 = activeDrag.startBox.y + activeDrag.startBox.height;
        const next =
          activeDrag.handle === "nw"
            ? { x: dragPoint.x, y: dragPoint.y, width: x2 - dragPoint.x, height: y2 - dragPoint.y }
          : activeDrag.handle === "ne"
              ? { x: activeDrag.startBox.x, y: dragPoint.y, width: dragPoint.x - activeDrag.startBox.x, height: y2 - dragPoint.y }
              : activeDrag.handle === "sw"
                ? { x: dragPoint.x, y: activeDrag.startBox.y, width: x2 - dragPoint.x, height: dragPoint.y - activeDrag.startBox.y }
                : {
                    x: activeDrag.startBox.x,
                    y: activeDrag.startBox.y,
                    width: dragPoint.x - activeDrag.startBox.x,
                    height: dragPoint.y - activeDrag.startBox.y,
                  };

        return { ...tag, ...correctedEditPatch, [targetKey]: normalizeTargetBox(next) };
      }),
    );
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.type === "bbox") {
      setDrag(null);
      return;
    }

    if (drag.type === "finishTap") {
      const tagStillActive = activeTag?.id === drag.tagId;
      if (!drag.moved && tagStillActive) {
        finishTag();
      }
      setDrag(null);
      return;
    }

    const stroke = simplifyStroke(drag.points);
    setDrag(null);
    if (stroke.length < MIN_STROKE_POINTS) return;

    if (activeTag && editTarget === "body") {
      const paintedAt = new Date().toISOString();
      setTags((current) =>
        current.map((tag) => {
          if (tag.id !== activeTag.id) return tag;
          const points = [...stroke, ...(tag.finLine ?? [])];
          return {
            ...tag,
            bodyLine: stroke,
            bbox: boxFromPoints(points),
            correctedBBox: undefined,
            correctedBBoxEdited: false,
            correctedPoints: undefined,
            correctionRotationDeg: undefined,
            lastPaintedAt: paintedAt,
          };
        }),
      );
      setEditTarget("auto");
      setEditingTagId(null);
      return;
    }

    if (activeTag && editTarget === "fin") {
      const paintedAt = new Date().toISOString();
      setTags((current) =>
        current.map((tag) =>
          tag.id === activeTag.id
            ? {
                ...tag,
                finLine: stroke,
                bbox: expandBoxToPoints(tag.bbox, stroke),
                correctedBBox: undefined,
                correctedBBoxEdited: false,
                correctedPoints: undefined,
                correctionRotationDeg: undefined,
                lastPaintedAt: paintedAt,
              }
            : tag,
        ),
      );
      setEditTarget("auto");
      setEditingTagId(null);
      return;
    }

    if (activeTag) {
      const now = new Date();
      const isFinLine = strokesIntersect(activeTag.bodyLine, stroke);

      if (!isFinLine) {
        const id = crypto.randomUUID();
        const paintedAt = now.toISOString();
        const previousWasQuiet = now.getTime() - new Date(activeTag.lastPaintedAt).getTime() >= AUTO_FINISH_AFTER_MS;
        setTags((current) => [
          ...current.map((tag) =>
            tag.id === activeTag.id
              ? {
                  ...tag,
                  status: tag.finLine || previousWasQuiet ? "done" : tag.status,
                }
              : tag,
          ),
          {
            id,
            bodyLine: stroke,
            bbox: boxFromPoints(stroke),
            status: "active",
            createdAt: paintedAt,
            lastPaintedAt: paintedAt,
          },
        ]);
        setActiveTagId(id);
        setEditingTagId(null);
        setEditTarget("auto");
        return;
      }

      setTags((current) =>
        current.map((tag) =>
          tag.id === activeTag.id
            ? {
                ...tag,
                finLine: stroke,
                bbox: expandBoxToPoints(tag.bbox, stroke),
                status: "done",
                correctedBBox: undefined,
                correctedBBoxEdited: false,
                correctedPoints: undefined,
                correctionRotationDeg: image ? verticalLineRotation(tag.bodyLine, image) : undefined,
                lastPaintedAt: now.toISOString(),
              }
            : tag,
        ),
      );
      setEditingTagId(null);
      return;
    }

    const id = crypto.randomUUID();
    const paintedAt = new Date().toISOString();
    setTags((current) => [
      ...current,
      {
        id,
        bodyLine: stroke,
        bbox: boxFromPoints(stroke),
        status: "active",
        createdAt: paintedAt,
        lastPaintedAt: paintedAt,
      },
    ]);
    setActiveTagId(id);
    setEditingTagId(null);
    setEditTarget("auto");
  }

  function beginBboxResize(event: PointerEvent<HTMLSpanElement>, tagId: string, handle: Handle) {
    if (mode === "move") return;
    event.stopPropagation();
    const point = pointFromPointer(event, { clampToImage: false });
    const tag = tags.find((current) => current.id === tagId);
    if (!point || !tag) return;
    const startBox = tag.correctionRotationDeg == null || !image ? tag.bbox : correctedGeometry(tag, image).correctedBox;
    const startPoint = tag.correctionRotationDeg == null || !image ? point : rotateImagePoint(point, correctionCenter(tag), correctionRotation(tag, image), image);
    setActiveTagId(tagId);
    setEditingTagId(tagId);
    setShowOriginalTagId(null);
    setDrag({ type: "bbox", pointerId: event.pointerId, tagId, handle, startBox, startPoint });
  }

  function beginCorrectionRotate(event: PointerEvent<HTMLSpanElement>, tagId: string) {
    if (mode === "move") return;
    event.stopPropagation();
    const point = pointFromPointer(event, { clampToImage: false });
    const tag = tags.find((current) => current.id === tagId);
    if (!point || !tag || !image) return;
    const center = correctionCenter(tag);
    const startRotation = tag.correctionRotationDeg ?? verticalLineRotation(tag.bodyLine, image);
    setActiveTagId(tagId);
    setEditingTagId(tagId);
    setShowOriginalTagId(null);
    updateTagCorrection(tagId, {
      correctionRotationDeg: startRotation,
    });
    setDrag({
      type: "rotate",
      pointerId: event.pointerId,
      tagId,
      center,
      startAngle: pointerAngle(point, center, image),
      startRotation,
    });
  }

  function beginBboxMove(event: PointerEvent<HTMLElement>, tagId: string) {
    if (mode === "move") return;
    if (tagId !== editingTagId || !(event.target as HTMLElement).closest(".bbox-move-handle")) return;
    event.stopPropagation();
    const point = pointFromPointer(event, { clampToImage: false });
    const tag = tags.find((current) => current.id === tagId);
    if (!point || !tag) return;
    const startBox = tag.correctionRotationDeg == null || !image ? tag.bbox : correctedGeometry(tag, image).correctedBox;
    const startPoint = tag.correctionRotationDeg == null || !image ? point : rotateImagePoint(point, correctionCenter(tag), correctionRotation(tag, image), image);
    setShowOriginalTagId(null);
    setDrag({ type: "bbox", pointerId: event.pointerId, tagId, handle: "move", startBox, startPoint });
  }

  function finishTag() {
    if (!activeTag) return;
    setTags((current) =>
      current.map((tag) => (tag.id === activeTag.id ? { ...tag, status: "done" } : tag)),
    );
    setActiveTagId(null);
    setEditingTagId(null);
    setShowOriginalTagId(null);
    setDrawerOpen(true);
    setEditTarget("auto");
  }

  function deleteActiveTag() {
    if (!activeTag) return;
    deleteTagById(activeTag.id);
  }

  function undoActiveFinLine() {
    if (!activeTag?.finLine) return;
    setTags((current) =>
      current.map((tag) =>
        tag.id === activeTag.id
          ? {
              ...tag,
              finLine: undefined,
              bbox: boxFromPoints(tag.bodyLine),
              status: "active",
              correctedBBox: undefined,
              correctedBBoxEdited: false,
              correctedPoints: undefined,
              correctionRotationDeg: undefined,
            }
          : tag,
      ),
    );
  }

  function deleteTagById(tagId: string) {
    setTags((current) => current.filter((tag) => tag.id !== tagId));
    if (activeTagId === tagId) {
      setActiveTagId(null);
      setEditingTagId(null);
      setShowOriginalTagId(null);
      setEditTarget("auto");
    }
    if (editingTagId === tagId) {
      setEditingTagId(null);
    }
  }

  function updateTagCorrection(tagId: string, patch: Partial<Pick<KoiTag, "correctedBBox" | "correctionRotationDeg" | "correctedPoints">>) {
    setTags((current) =>
      current.map((tag) => (tag.id === tagId ? { ...tag, ...patch } : tag)),
    );
  }

  function selectTagForEditing(tagId: string) {
    const tag = tags.find((current) => current.id === tagId);
    if (tag) {
      bringTagIntoView(tag);
    }
    setActiveTagId(tagId);
    setEditingTagId(tagId);
    setShowOriginalTagId(null);
    setEditTarget("auto");
    setTags((current) =>
      current.map((tag) => {
        if (tag.id !== tagId) return tag;
        return {
          ...tag,
          status: "active",
          correctionRotationDeg: image ? (tag.correctionRotationDeg ?? verticalLineRotation(tag.bodyLine, image)) : tag.correctionRotationDeg,
        };
      }),
    );
  }

  function toggleTagFromHead(tagId: string) {
    if (activeTagId === tagId) {
      setActiveTagId(null);
      setEditingTagId(null);
      setShowOriginalTagId(null);
      setEditTarget("auto");
      return;
    }

    const tag = tags.find((current) => current.id === tagId);
    setActiveTagId(tagId);
    setEditingTagId(tagId);
    setShowOriginalTagId(tagId);
    setEditTarget("auto");
    setTags((current) =>
      current.map((currentTag) => {
        if (currentTag.id !== tagId) return currentTag;
        if (!image || tag?.correctionRotationDeg != null) {
          return { ...currentTag, status: "active" };
        }
        return {
          ...currentTag,
          status: "active",
          correctionRotationDeg: verticalLineRotation(currentTag.bodyLine, image),
        };
      }),
    );
  }

  async function copyHotReloadTime() {
    await navigator.clipboard.writeText(hotReloadTime);
    setHotReloadCopied(true);
    window.setTimeout(() => setHotReloadCopied(false), 1200);
  }

  return (
    <main className="app-shell">
      <button className="hmr-clock" type="button" onClick={copyHotReloadTime} aria-label="Copy last hot reload time">
        {hotReloadCopied ? "Copied" : `HMR ${hotReloadTime}`}
      </button>
      <section className="workspace" aria-label="Koi tagging workspace">
        <div className="stage-wrap">
          {image ? (
            <div
              className={`image-stage ${mode === "move" ? "move-mode" : "tag-mode"}`}
              ref={stageRef}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerEnd}
              onPointerCancel={handleStagePointerEnd}
              onWheel={handleStageWheel}
            >
              <div
                ref={imageTransformRef}
                className="image-transform"
                style={{
                  width: imageFrame ? `${imageFrame.width}px` : "100%",
                  height: imageFrame ? `${imageFrame.height}px` : "100%",
                  transform: `translate(${(imageFrame?.x ?? 0) + view.x}px, ${(imageFrame?.y ?? 0) + view.y}px) scale(${view.scale})`,
                }}
              >
                <img ref={sourceImageRef} src={image.src} alt={image.name} draggable={false} />

                <svg className="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                  {tags.map((tag, index) => (
                    <g key={tag.id} className={tag.id === activeTagId ? "selected" : ""}>
                      <path d={pathFromPoints(tag.bodyLine)} className="body-line" />
                      {tag.finLine && <path d={pathFromPoints(tag.finLine)} className="fin-line" />}
                      {image && tag.id === editingTagId && tag.correctionRotationDeg != null && (
                        <polygon className="oriented-bbox" points={polygonPoints(orientedCorrectedBoxPoints(tag, image))} />
                      )}
                      {tag.id !== editingTagId && (
                        <>
                          <circle className="head-dot" cx={tag.bodyLine[0].x * 1000} cy={tag.bodyLine[0].y * 1000} r="22" />
                          <text className="tag-number" x={tag.bodyLine[0].x * 1000} y={tag.bodyLine[0].y * 1000} dy="-34">
                            {index + 1}
                          </text>
                        </>
                      )}
                    </g>
                  ))}

                  {activeStroke.length > 0 && (
                    <g>
                      <path d={pathFromPoints(activeStroke)} className="active-body-line" />
                      <circle className="active-head-dot" cx={activeStroke[0].x * 1000} cy={activeStroke[0].y * 1000} r="24" />
                    </g>
                  )}
                </svg>

                {editingTag && activeOrientedPoints && (
                  <>
                    <span
                      className="bbox-move-handle"
                      style={pointHandleStyle(polygonCenter(activeOrientedPoints), view.scale)}
                      data-no-draw
                      aria-hidden="true"
                      onPointerDown={(event) => beginBboxMove(event, editingTag.id)}
                    />
                    {(["nw", "se"] as const).map((handle) => {
                      const point = handle === "nw" ? activeOrientedPoints[0] : activeOrientedPoints[2];
                      return (
                        <span
                          key={handle}
                          className={`bbox-handle resize-handle ${handle}`}
                          style={pointHandleStyle(point, view.scale)}
                          data-no-draw
                          onPointerDown={(event) => beginBboxResize(event, editingTag.id, handle)}
                        />
                      );
                    })}
                    {(["ne", "sw"] as const).map((handle) => {
                      const point = handle === "ne" ? activeOrientedPoints[1] : activeOrientedPoints[3];
                      return (
                        <span
                          key={handle}
                          className={`bbox-handle rotate-handle ${handle}`}
                          style={pointHandleStyle(point, view.scale)}
                          data-no-draw
                          onPointerDown={(event) => beginCorrectionRotate(event, editingTag.id)}
                        />
                      );
                    })}
                  </>
                )}

                {mode === "tag" && paintMode === "crosshair" && aimPoint && (
                  <span className={`aim-crosshair ${drag?.type === "stroke" ? "painting" : ""}`} style={pointHandleStyle(aimPoint)} aria-hidden="true" />
                )}

                {tags.map((tag, index) => (
                  <button
                    key={`${tag.id}-head-select`}
                    className={`head-select ${tag.id === activeTagId ? "active" : ""}`}
                    style={{
                      ...pointHandleStyle(tag.bodyLine[0], view.scale),
                    }}
                    data-no-draw
                    onPointerDown={(event) => {
                      if (mode !== "move") event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (mode === "move") return;
                      toggleTagFromHead(tag.id);
                    }}
                    aria-label={`Select fish ${index + 1}`}
                  />
                ))}

                {activeTag?.finLine && (
                  <Button
                    className="head-undo-button"
                    size="icon"
                    variant="secondary"
                    style={{
                      ...pointHandleStyle(activeTag.bodyLine[0], view.scale),
                    }}
                    data-no-draw
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      undoActiveFinLine();
                    }}
                    aria-label="Undo fin line"
                  >
                    <Undo2 size={17} />
                  </Button>
                )}

                {editingTag && (
                  <div className="fish-actions" style={controlPosition(activeDisplayBox ?? editingTag.bbox, view.scale)} data-no-draw onPointerDown={(event) => event.stopPropagation()}>
                    <Button size="sm" onPointerDown={(event) => event.stopPropagation()} onClick={finishTag}>
                      <Check size={16} />
                      OK
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={deleteActiveTag}
                      aria-label="Delete fish"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                )}
              </div>

              <div className="floating-controls" data-no-draw onPointerDown={(event) => event.stopPropagation()}>
                <label className="source-action-button floating-mode-button" aria-label="Open photo from album">
                  <input type="file" accept="image/*" onChange={loadImage} />
                  <ImagePlus size={19} />
                </label>
                <label className="source-action-button floating-mode-button" aria-label="Take photo with camera">
                  <input type="file" accept="image/*" capture="environment" onChange={loadImage} />
                  <Camera size={19} />
                </label>

                <Button
                  className="floating-mode-button mode-toggle-button"
                  size="icon"
                  variant={mode === "move" ? "default" : "secondary"}
                  onClick={() => setMode((current) => (current === "move" ? "tag" : "move"))}
                  aria-label={mode === "move" ? "Switch to tagging" : "Switch to pan and zoom"}
                >
                  {mode === "move" ? <ZoomIn size={19} /> : <Signature size={19} />}
                </Button>

                <Button
                  className="floating-mode-button paint-tool-button"
                  size="icon"
                  variant={paintMode === "crosshair" ? "default" : "secondary"}
                  onClick={() => {
                    setPaintMode((current) => {
                      const next = current === "crosshair" ? "direct" : "crosshair";
                      if (next === "crosshair" && cropSettings.showCrosshairIntro) {
                        setShowCrosshairIntro(true);
                      }
                      return next;
                    });
                    setAimPoint(null);
                    setDrag(null);
                    aimPointerId.current = null;
                  }}
                  aria-label={paintMode === "crosshair" ? "Use direct finger painting" : "Use crosshair painting"}
                >
                  {paintMode === "crosshair" ? <Crosshair size={18} /> : <Fingerprint size={18} />}
                </Button>

                <Button
                  className="floating-mode-button"
                  size="icon"
                  variant="secondary"
                  onClick={() => zoomFromStageCenter(VIEW_ZOOM_STEP)}
                  aria-label="Zoom in"
                >
                  <Plus size={18} />
                </Button>
                <Button
                  className="floating-mode-button"
                  size="icon"
                  variant="secondary"
                  onClick={() => zoomFromStageCenter(1 / VIEW_ZOOM_STEP)}
                  aria-label="Zoom out"
                >
                  <Minus size={18} />
                </Button>

                <Button
                  className="floating-mode-button"
                  size="icon"
                  variant="secondary"
                  onClick={resetView}
                  aria-label="Reset pan and zoom"
                >
                  <RotateCcw size={18} />
                </Button>

                <Button
                  className="floating-mode-button"
                  size="icon"
                  variant={drawerOpen ? "default" : "secondary"}
                  disabled={!tags.length}
                  onClick={() => setDrawerOpen((open) => !open)}
                  aria-label={drawerOpen ? "Hide tagged fish drawer" : "Show tagged fish drawer"}
                >
                  {drawerOpen ? <PanelBottomClose size={18} /> : <PanelBottomOpen size={18} />}
                </Button>

                <Button
                  className="floating-mode-button"
                  size="icon"
                  variant={settingsOpen ? "default" : "secondary"}
                  onClick={() => setSettingsOpen((open) => !open)}
                  aria-label={settingsOpen ? "Hide settings" : "Show settings"}
                >
                  <Settings size={18} />
                </Button>
              </div>

              {settingsOpen && (
                <>
                  <button
                    className="settings-dismiss"
                    type="button"
                    data-no-draw
                    aria-label="Close settings"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setSettingsOpen(false);
                    }}
                  />
                  <section className="settings-panel" data-no-draw onPointerDown={(event) => event.stopPropagation()} aria-label="Crop settings">
                    <div className="settings-row">
                      <label>
                        <span>Width margin</span>
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.01"
                          value={cropSettings.marginXByLength}
                          onChange={(event) =>
                            setCropSettings((current) => ({
                              ...current,
                              marginXByLength: clamp(Number(event.target.value), 0, 2),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Height margin</span>
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.01"
                          value={cropSettings.marginYByLength}
                          onChange={(event) =>
                            setCropSettings((current) => ({
                              ...current,
                              marginYByLength: clamp(Number(event.target.value), 0, 2),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>Cross offset</span>
                        <input
                          type="number"
                          min="20"
                          max="180"
                          step="1"
                          value={crosshairOffsetInput}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCrosshairOffsetInput(value);
                            const parsed = Number(value);
                            if (value !== "" && Number.isFinite(parsed) && parsed >= 20 && parsed <= 180) {
                              setCropSettings((current) => ({
                                ...current,
                                crosshairOffsetPx: parsed,
                              }));
                            }
                          }}
                          onBlur={() => commitCrosshairOffsetInput()}
                        />
                      </label>
                      <label className="settings-toggle">
                        <span>Show guide</span>
                        <input
                          type="checkbox"
                          checked={cropSettings.showCrosshairIntro}
                          onChange={(event) =>
                            setCropSettings((current) => ({
                              ...current,
                              showCrosshairIntro: event.target.checked,
                            }))
                          }
                        />
                      </label>
                      <label className="settings-toggle">
                        <span>Export numbers</span>
                        <input
                          type="checkbox"
                          checked={cropSettings.showExportNumbers}
                          onChange={(event) =>
                            setCropSettings((current) => ({
                              ...current,
                              showExportNumbers: event.target.checked,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="settings-actions">
                      <Button size="sm" variant="secondary" onClick={() => setCropSettings(DEFAULT_CROP_SETTINGS)}>
                        Reset
                      </Button>
                      <Button size="sm" onClick={exportCorrectedCrops} disabled={!tags.length}>
                        <Download size={16} />
                        Export
                      </Button>
                    </div>
                  </section>
                </>
              )}

              {showCrosshairIntro && (
                <div className="crosshair-intro" aria-hidden="true">
                  <div className="intro-crosshair" />
                  <div className="intro-finger primary" />
                  <div className="intro-finger secondary" />
                  <div className="intro-line" />
                </div>
              )}
            </div>
          ) : (
            <div className="empty-stage">
              <div className="empty-source-actions">
                <label className="source-action-button" aria-label="Open photo from album">
                  <input type="file" accept="image/*" onChange={loadImage} />
                  <ImagePlus size={22} />
                </label>
                <label className="source-action-button" aria-label="Take photo with camera">
                  <input type="file" accept="image/*" capture="environment" onChange={loadImage} />
                  <Camera size={22} />
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      {drawerOpen && image && tags.length > 0 && (
        <CorrectedThumbDrawer
          image={image}
          tags={tags}
          activeTagId={activeTagId}
          cropSettings={cropSettings}
          sourceImageRef={sourceImageRef}
          onClose={() => setDrawerOpen(false)}
          onDelete={deleteTagById}
          onSelect={selectTagForEditing}
        />
      )}
    </main>
  );
}

function RotatedCropCanvas({
  image,
  sourceImageRef,
  tag,
  crop,
  rotation,
  className,
}: {
  image: ImageInfo;
  sourceImageRef: RefObject<HTMLImageElement | null>;
  tag: KoiTag;
  crop: Box;
  rotation: number;
  className: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cropWidthPx = Math.max(1, Math.round(crop.width * image.width));
    const cropHeightPx = Math.max(1, Math.round(crop.height * image.height));
    canvas.width = cropWidthPx;
    canvas.height = cropHeightPx;

    const context = canvas.getContext("2d");
    if (!context) return;

    function draw(photo: HTMLImageElement) {
      const center = correctionCenter(tag);
      const centerX = center.x * image.width;
      const centerY = center.y * image.height;
      const cropX = crop.x * image.width;
      const cropY = crop.y * image.height;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, cropWidthPx, cropHeightPx);
      context.translate(-cropX, -cropY);
      context.translate(centerX, centerY);
      context.rotate((rotation * Math.PI) / 180);
      context.translate(-centerX, -centerY);
      context.drawImage(photo, 0, 0, image.width, image.height);
    }

    const sourceImage = sourceImageRef.current;
    if (sourceImage?.complete && sourceImage.naturalWidth > 0) {
      draw(sourceImage);
      return;
    }

    const fallback = new Image();
    fallback.onload = () => draw(fallback);
    fallback.src = image.src;
  }, [crop, image, rotation, sourceImageRef, tag]);

  return <canvas ref={canvasRef} className={className} />;
}

function CorrectedThumbDrawer({
  image,
  tags,
  activeTagId,
  cropSettings,
  sourceImageRef,
  onClose,
  onDelete,
  onSelect,
}: {
  image: ImageInfo;
  tags: KoiTag[];
  activeTagId: string | null;
  cropSettings: CropSettings;
  sourceImageRef: RefObject<HTMLImageElement | null>;
  onClose: () => void;
  onDelete: (tagId: string) => void;
  onSelect: (tagId: string) => void;
}) {
  return (
    <section className="thumb-drawer" aria-label="Corrected thumbnails">
      <div className="drawer-handle" />
      <Button size="icon" variant="ghost" className="drawer-close" onClick={onClose} aria-label="Close corrected thumbnails">
        <X size={18} />
      </Button>
      <div className="thumb-drawer-content">
        <div className="thumb-list">
          {tags.map((tag) => (
            <CorrectedThumb
              key={tag.id}
              image={image}
              tag={tag}
              active={tag.id === activeTagId}
              cropSettings={cropSettings}
              sourceImageRef={sourceImageRef}
              onDelete={() => onDelete(tag.id)}
              onSelect={() => onSelect(tag.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CorrectedThumb({
  image,
  tag,
  active,
  cropSettings,
  sourceImageRef,
  onDelete,
  onSelect,
}: {
  image: ImageInfo;
  tag: KoiTag;
  active: boolean;
  cropSettings: CropSettings;
  sourceImageRef: RefObject<HTMLImageElement | null>;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => correctedGeometry(tag, image), [image, tag]);
  const thumbCrop = displayCrop(tag, image, geometry.correctedBox, cropSettings);
  const selectionOverlayStyle = {
    left: `${((geometry.correctedBox.x - thumbCrop.x) / thumbCrop.width) * 100}%`,
    top: `${((geometry.correctedBox.y - thumbCrop.y) / thumbCrop.height) * 100}%`,
    width: `${(geometry.correctedBox.width / thumbCrop.width) * 100}%`,
    height: `${(geometry.correctedBox.height / thumbCrop.height) * 100}%`,
  };

  return (
    <button className={`thumb-card ${active ? "active" : ""}`} style={{ aspectRatio: `${thumbCrop.width * image.width} / ${thumbCrop.height * image.height}` }} onClick={onSelect}>
      <div className="thumb-stage">
        <RotatedCropCanvas className="thumb-canvas" image={image} sourceImageRef={sourceImageRef} tag={tag} crop={thumbCrop} rotation={geometry.rotation} />
        <span className="thumb-selection-window" style={selectionOverlayStyle} aria-hidden="true" />
      </div>
      <Button
        size="icon"
        variant="danger"
        className="thumb-delete"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        aria-label="Delete tagged fish"
      >
        <X size={16} />
      </Button>
    </button>
  );
}
