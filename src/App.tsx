import { ChangeEvent, PointerEvent, RefObject, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ImagePlus,
  Minus,
  PanelBottomClose,
  PanelBottomOpen,
  Plus,
  RotateCcw,
  Signature,
  Trash2,
  ZoomIn,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";

type Mode = "tag" | "move";
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
};

type ImageInfo = {
  name: string;
  src: string;
  width: number;
  height: number;
};

type DragState =
  | { type: "stroke"; pointerId: number; points: Point[] }
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

const MIN_STROKE_POINTS = 3;
const STROKE_PADDING = 0.035;
const MIN_VIEW_SCALE = 0.05;
const MAX_VIEW_SCALE = 8;
const VIEW_ZOOM_STEP = 1.2;
const THUMB_MARGIN_X_BY_LENGTH = 0.22;
const THUMB_MARGIN_Y_BY_LENGTH = 0.04;
const DEFAULT_IMAGE_SRC = "/images/default-koi.jpg";
const DEFAULT_IMAGE_NAME = "20_0.jpg";
const HMR_TIME_KEY = "koi-tag-last-hot-reload";

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

function pointHandleStyle(point: Point) {
  return {
    left: `${point.x * 100}%`,
    top: `${point.y * 100}%`,
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

function thumbDisplayCrop(tag: KoiTag, image: ImageInfo, correctedBox: Box) {
  const lengthPx = bodyLengthPx(tag, image);
  const padded = expandFreeBoxByPixels(correctedBox, image, lengthPx * THUMB_MARGIN_X_BY_LENGTH, lengthPx * THUMB_MARGIN_Y_BY_LENGTH);
  return ensureMinBoxSizePixels(padded, image, lengthPx * 0.28, lengthPx * 0.65);
}

function orientedCorrectedBoxPoints(tag: KoiTag, image: ImageInfo) {
  const rotation = correctionRotation(tag, image);
  const center = correctionCenter(tag);
  return orderedBoxCorners(sourceCorrectedBox(tag, image, rotation)).map((point) => rotateImagePoint(point, center, -rotation, image));
}

function controlPosition(box: Box) {
  const placeBelow = box.y < 0.16;
  const top = placeBelow ? box.y + box.height + 0.018 : box.y - 0.018;
  const x = clamp(box.x + box.width / 2, 0.22, 0.78);
  return {
    left: `${x * 100}%`,
    top: `${clamp(top, 0.04, 0.9) * 100}%`,
    transform: placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
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

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageTransformRef = useRef<HTMLDivElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const activePointers = useRef<Map<number, Point>>(new Map());
  const gesture = useRef<GestureState | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [mode, setMode] = useState<Mode>("tag");
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [tags, setTags] = useState<KoiTag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [editTarget, setEditTarget] = useState<EditTarget>("auto");
  const [hotReloadTime, setHotReloadTime] = useState(() => localStorage.getItem(HMR_TIME_KEY) ?? formatTime());
  const [hotReloadCopied, setHotReloadCopied] = useState(false);
  const [showOriginalTagId, setShowOriginalTagId] = useState<string | null>(null);

  const activeTag = tags.find((tag) => tag.id === activeTagId) ?? null;
  const activeStroke = drag?.type === "stroke" ? drag.points : [];
  const activeDisplayBox = activeTag?.bbox;
  const activeOrientedPoints = activeTag && image && activeTag.correctionRotationDeg != null ? orientedCorrectedBoxPoints(activeTag, image) : null;

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    function updateHotReloadTime(event: Event) {
      setHotReloadTime((event as CustomEvent<string>).detail);
    }

    window.addEventListener("koi-hmr-time", updateHotReloadTime);
    return () => window.removeEventListener("koi-hmr-time", updateHotReloadTime);
  }, []);

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

    const centroid = pointerCentroid(points);
    const distance = pointerDistance(points);
    const nextScale = clamp(gesture.current.startView.scale * (distance / gesture.current.startDistance), MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const scaleRatio = nextScale / gesture.current.startView.scale;

    setView({
      scale: nextScale,
      x: centroid.x - (gesture.current.startCentroid.x - gesture.current.startView.x) * scaleRatio,
      y: centroid.y - (gesture.current.startCentroid.y - gesture.current.startView.y) * scaleRatio,
    });
  }

  function zoomAtClientPoint(clientX: number, clientY: number, nextScale: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const currentView = viewRef.current;
    const clampedScale = clamp(nextScale, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    const imageX = (clientX - rect.left - currentView.x) / currentView.scale;
    const imageY = (clientY - rect.top - currentView.y) / currentView.scale;

    setView({
      scale: clampedScale,
      x: clientX - rect.left - imageX * clampedScale,
      y: clientY - rect.top - imageY * clampedScale,
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

  function startStroke(event: PointerEvent<HTMLDivElement>) {
    if (!image || mode !== "tag" || (event.target as HTMLElement).closest("[data-no-draw]")) return;
    const point = pointFromPointer(event);
    if (!point) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ type: "stroke", pointerId: event.pointerId, points: [point] });
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!image) return;
    if (mode !== "move" && (event.target as HTMLElement).closest("[data-no-draw]")) return;

    activePointers.current.set(event.pointerId, screenPointFromEvent(event));
    event.currentTarget.setPointerCapture(event.pointerId);

    if (mode === "move" || activePointers.current.size > 1) {
      setDrag(null);
      beginGesture();
      return;
    }

    if (activeTag && activeOrientedPoints) {
      const point = pointFromPointer(event);
      if (!point) return;
      setDrag({ type: "finishTap", pointerId: event.pointerId, tagId: activeTag.id, startPoint: point, moved: false });
      return;
    }

    startStroke(event);
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (activePointers.current.has(event.pointerId)) {
      activePointers.current.set(event.pointerId, screenPointFromEvent(event));
    }

    if (gesture.current || activePointers.current.size > 1) {
      if (!gesture.current) {
        setDrag(null);
        beginGesture();
      }
      updateGesture();
      return;
    }

    continueDrag(event);
  }

  function handleStagePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!gesture.current) {
      finishDrag(event);
    }

    activePointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetGestureForRemainingPointers();
  }

  function continueDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromPointer(event, { clampToImage: drag.type !== "bbox" });
    if (!point) return;

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
          };
        }),
      );
      setEditTarget("auto");
      return;
    }

    if (activeTag && editTarget === "fin") {
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
              }
            : tag,
        ),
      );
      setEditTarget("auto");
      return;
    }

    if (activeTag && activeTag.status === "active") {
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
              }
            : tag,
        ),
      );
      return;
    }

    const id = crypto.randomUUID();
    setTags((current) => [
      ...current,
      {
        id,
        bodyLine: stroke,
        bbox: boxFromPoints(stroke),
        status: "active",
        createdAt: new Date().toISOString(),
      },
    ]);
    setActiveTagId(id);
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
    if (tagId !== activeTagId || !(event.target as HTMLElement).closest(".bbox-move-handle")) return;
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
    setShowOriginalTagId(null);
    setDrawerOpen(true);
    setEditTarget("auto");
  }

  function deleteActiveTag() {
    if (!activeTag) return;
    deleteTagById(activeTag.id);
  }

  function deleteTagById(tagId: string) {
    setTags((current) => current.filter((tag) => tag.id !== tagId));
    if (activeTagId === tagId) {
      setActiveTagId(null);
      setShowOriginalTagId(null);
      setEditTarget("auto");
    }
  }

  function updateTagCorrection(tagId: string, patch: Partial<Pick<KoiTag, "correctedBBox" | "correctionRotationDeg" | "correctedPoints">>) {
    setTags((current) =>
      current.map((tag) => (tag.id === tagId ? { ...tag, ...patch } : tag)),
    );
  }

  function selectTagForEditing(tagId: string) {
    setActiveTagId(tagId);
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
      setShowOriginalTagId(null);
      setEditTarget("auto");
      return;
    }

    const tag = tags.find((current) => current.id === tagId);
    setActiveTagId(tagId);
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
              style={{
                aspectRatio: `${image.width} / ${image.height}`,
                width: `min(100%, calc((100svh - 38px) * ${image.width / image.height}))`,
                maxHeight: "calc(100svh - 38px)",
              }}
            >
              <div
                ref={imageTransformRef}
                className="image-transform"
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                }}
              >
                <img ref={sourceImageRef} src={image.src} alt={image.name} draggable={false} />

                <svg className="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                  {tags.map((tag, index) => (
                    <g key={tag.id} className={tag.id === activeTagId ? "selected" : ""}>
                      <path d={pathFromPoints(tag.bodyLine)} className="body-line" />
                      {tag.finLine && <path d={pathFromPoints(tag.finLine)} className="fin-line" />}
                      {image && tag.id === activeTagId && tag.correctionRotationDeg != null && (
                        <polygon className="oriented-bbox" points={polygonPoints(orientedCorrectedBoxPoints(tag, image))} />
                      )}
                      {tag.correctionRotationDeg == null && (
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

                {activeTag && activeOrientedPoints && (
                  <>
                    <span
                      className="bbox-move-handle"
                      style={pointHandleStyle(polygonCenter(activeOrientedPoints))}
                      data-no-draw
                      aria-hidden="true"
                      onPointerDown={(event) => beginBboxMove(event, activeTag.id)}
                    />
                    {(["nw", "se"] as const).map((handle) => {
                      const point = handle === "nw" ? activeOrientedPoints[0] : activeOrientedPoints[2];
                      return (
                        <span
                          key={handle}
                          className={`bbox-handle resize-handle ${handle}`}
                          style={pointHandleStyle(point)}
                          data-no-draw
                          onPointerDown={(event) => beginBboxResize(event, activeTag.id, handle)}
                        />
                      );
                    })}
                    {(["ne", "sw"] as const).map((handle) => {
                      const point = handle === "ne" ? activeOrientedPoints[1] : activeOrientedPoints[3];
                      return (
                        <span
                          key={handle}
                          className={`bbox-handle rotate-handle ${handle}`}
                          style={pointHandleStyle(point)}
                          data-no-draw
                          onPointerDown={(event) => beginCorrectionRotate(event, activeTag.id)}
                        />
                      );
                    })}
                  </>
                )}

                {tags.map((tag, index) => (
                  <button
                    key={`${tag.id}-head-select`}
                    className={`head-select ${tag.id === activeTagId ? "active" : ""}`}
                    style={{
                      left: `${tag.bodyLine[0].x * 100}%`,
                      top: `${tag.bodyLine[0].y * 100}%`,
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

                {activeTag && (
                  <div className="fish-actions" style={controlPosition(activeDisplayBox ?? activeTag.bbox)} data-no-draw onPointerDown={(event) => event.stopPropagation()}>
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
                  className="floating-mode-button"
                  size="icon"
                  variant={mode === "move" ? "default" : "secondary"}
                  onClick={() => setMode((current) => (current === "move" ? "tag" : "move"))}
                  aria-label={mode === "move" ? "Switch to tagging" : "Switch to pan and zoom"}
                >
                  {mode === "move" ? <Signature size={19} /> : <ZoomIn size={19} />}
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
              </div>
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

      drawCanvasLine(context, tag.bodyLine, image, "#ffd348", 10);
      if (tag.finLine) {
        drawCanvasLine(context, tag.finLine, image, "#55e5ff", 8);
      }
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

function drawCanvasLine(context: CanvasRenderingContext2D, points: Point[], image: ImageInfo, color: string, width: number) {
  if (points.length < 2) return;

  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const x = point.x * image.width;
    const y = point.y * image.height;
    if (index === 0) {
      context.moveTo(x, y);
      return;
    }
    context.lineTo(x, y);
  });
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.shadowColor = "rgba(0, 0, 0, 0.72)";
  context.shadowBlur = 2;
  context.shadowOffsetY = 1;
  context.stroke();
  context.restore();
}

function CorrectedThumbDrawer({
  image,
  tags,
  activeTagId,
  sourceImageRef,
  onClose,
  onDelete,
  onSelect,
}: {
  image: ImageInfo;
  tags: KoiTag[];
  activeTagId: string | null;
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
  sourceImageRef,
  onDelete,
  onSelect,
}: {
  image: ImageInfo;
  tag: KoiTag;
  active: boolean;
  sourceImageRef: RefObject<HTMLImageElement | null>;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => correctedGeometry(tag, image), [image, tag]);
  const thumbCrop = thumbDisplayCrop(tag, image, geometry.correctedBox);

  return (
    <button className={`thumb-card ${active ? "active" : ""}`} style={{ aspectRatio: `${thumbCrop.width * image.width} / ${thumbCrop.height * image.height}` }} onClick={onSelect}>
      <div className="thumb-stage">
        <RotatedCropCanvas className="thumb-canvas" image={image} sourceImageRef={sourceImageRef} tag={tag} crop={thumbCrop} rotation={geometry.rotation} />
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
