import { ChangeEvent, PointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Hand,
  ImagePlus,
  Minus,
  MousePointer2,
  PanelBottomClose,
  PanelBottomOpen,
  Plus,
  RotateCcw,
  Trash2,
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
  | { type: "rotate"; pointerId: number; tagId: string; startAngle: number; startRotation: number; center: Point };

type GestureState = {
  startView: ViewTransform;
  startCentroid: Point;
  startDistance: number;
};

type CorrectedGeometry = {
  crop: Box;
  cropCenter: Point;
  cropBodyLine: Point[];
  cropFinLine?: Point[];
  rotation: number;
  correctedBox: Box;
  cropCorrectedBox: Box;
};

const MIN_STROKE_POINTS = 3;
const STROKE_PADDING = 0.035;
const MIN_VIEW_SCALE = 0.05;
const MAX_VIEW_SCALE = 8;
const VIEW_ZOOM_STEP = 1.2;
const THUMB_MARGIN_X = 0.3;
const THUMB_MARGIN_Y = 0.05;
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

function boxCorners(box: Box): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ];
}

function cropForAnyBoxRotation(box: Box, image: ImageInfo): Box {
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const widthPx = box.width * image.width;
  const heightPx = box.height * image.height;
  const diagonalPx = Math.hypot(widthPx, heightPx) * 1.08;
  const cropWidth = Math.min(1, diagonalPx / image.width);
  const cropHeight = Math.min(1, diagonalPx / image.height);

  return normalizeBox({
    x: clamp(center.x - cropWidth / 2, 0, 1 - cropWidth),
    y: clamp(center.y - cropHeight / 2, 0, 1 - cropHeight),
    width: cropWidth,
    height: cropHeight,
  });
}

function pointToCrop(point: Point, crop: Box): Point {
  return {
    x: (point.x - crop.x) / crop.width,
    y: (point.y - crop.y) / crop.height,
  };
}

function pointFromCrop(point: Point, crop: Box): Point {
  return {
    x: crop.x + point.x * crop.width,
    y: crop.y + point.y * crop.height,
  };
}

function boxToCrop(box: Box, crop: Box): Box {
  return normalizeBox({
    x: (box.x - crop.x) / crop.width,
    y: (box.y - crop.y) / crop.height,
    width: box.width / crop.width,
    height: box.height / crop.height,
  });
}

function boxFromCrop(box: Box, crop: Box): Box {
  return normalizeBox({
    x: crop.x + box.x * crop.width,
    y: crop.y + box.y * crop.height,
    width: box.width * crop.width,
    height: box.height * crop.height,
  });
}

function expandBoxByPercent(box: Box, marginX: number, marginY: number): Box {
  return normalizeBox({
    x: box.x - box.width * marginX,
    y: box.y - box.height * marginY,
    width: box.width * (1 + marginX * 2),
    height: box.height * (1 + marginY * 2),
  });
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

function pointerAngle(point: Point, center: Point) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function verticalLineRotation(points: Point[]) {
  const head = points[0];
  const tail = points[points.length - 1];
  const angle = (Math.atan2(head.y - tail.y, head.x - tail.x) * 180) / Math.PI;
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
  const crop = cropForAnyBoxRotation(tag.bbox, image);
  const center = {
    x: tag.bbox.x + tag.bbox.width / 2,
    y: tag.bbox.y + tag.bbox.height / 2,
  };
  const cropCenter = pointToCrop(center, crop);
  const cropBodyLine = tag.bodyLine.map((point) => pointToCrop(point, crop));
  const cropFinLine = tag.finLine?.map((point) => pointToCrop(point, crop));
  const rotation = tag.correctionRotationDeg ?? verticalLineRotation(cropBodyLine);
  const cropBboxCorners = boxCorners(tag.bbox).map((point) => pointToCrop(point, crop));
  const rotatedCropBodyLine = cropBodyLine.map((point) => rotatePoint(point, cropCenter, rotation));
  const rotatedCropFinLine = cropFinLine?.map((point) => rotatePoint(point, cropCenter, rotation));
  const correctedCropPoints = tag.finLine
    ? [...rotatedCropBodyLine, ...(rotatedCropFinLine ?? [])]
    : cropBboxCorners.map((point) => rotatePoint(point, cropCenter, rotation));
  const correctedBox = tag.correctedBBox ?? boxFromCrop(boxFromPoints(correctedCropPoints, 0.02), crop);
  const cropCorrectedBox = boxToCrop(correctedBox, crop);

  return {
    crop,
    cropCenter,
    cropBodyLine,
    cropFinLine,
    rotation,
    correctedBox,
    cropCorrectedBox,
  };
}

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null);
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
  const showActiveCorrectionControls = Boolean(activeTag?.finLine || activeTag?.correctionRotationDeg != null);
  const activeDisplayBox =
    activeTag && image && activeTag.correctionRotationDeg != null && showOriginalTagId !== activeTag.id ? correctedGeometry(activeTag, image).correctedBox : activeTag?.bbox;

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
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      if (drag.type === "bbox") {
        updateBboxDrag(drag, point);
        return;
      }

      const angle = pointerAngle(point, drag.center);
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

  function pointFromPointer(event: PointerEvent<HTMLElement>) {
    return pointFromClient(event.clientX, event.clientY);
  }

  function pointFromClient(clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const currentView = viewRef.current;

    return {
      x: clamp((clientX - rect.left - currentView.x) / currentView.scale / rect.width, 0, 1),
      y: clamp((clientY - rect.top - currentView.y) / currentView.scale / rect.height, 0, 1),
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
    const point = pointFromPointer(event);
    if (!point) return;

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

        if (activeDrag.handle === "move") {
          return {
            ...tag,
            [targetKey]: normalizeBox({
              ...activeDrag.startBox,
              x: activeDrag.startBox.x + point.x - activeDrag.startPoint.x,
              y: activeDrag.startBox.y + point.y - activeDrag.startPoint.y,
            }),
          };
        }

        const x2 = activeDrag.startBox.x + activeDrag.startBox.width;
        const y2 = activeDrag.startBox.y + activeDrag.startBox.height;
        const next =
          activeDrag.handle === "nw"
            ? { x: point.x, y: point.y, width: x2 - point.x, height: y2 - point.y }
          : activeDrag.handle === "ne"
              ? { x: activeDrag.startBox.x, y: point.y, width: point.x - activeDrag.startBox.x, height: y2 - point.y }
              : activeDrag.handle === "sw"
                ? { x: point.x, y: activeDrag.startBox.y, width: x2 - point.x, height: point.y - activeDrag.startBox.y }
                : {
                    x: activeDrag.startBox.x,
                    y: activeDrag.startBox.y,
                    width: point.x - activeDrag.startBox.x,
                    height: point.y - activeDrag.startBox.y,
                  };

        return { ...tag, [targetKey]: normalizeBox(next) };
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
    const point = pointFromPointer(event);
    const tag = tags.find((current) => current.id === tagId);
    if (!point || !tag) return;
    const startBox = tag.correctionRotationDeg == null || !image ? tag.bbox : correctedGeometry(tag, image).correctedBox;
    setActiveTagId(tagId);
    setShowOriginalTagId(null);
    setDrag({ type: "bbox", pointerId: event.pointerId, tagId, handle, startBox, startPoint: point });
  }

  function beginCorrectionRotate(event: PointerEvent<HTMLSpanElement>, tagId: string) {
    if (mode === "move") return;
    event.stopPropagation();
    const point = pointFromPointer(event);
    const tag = tags.find((current) => current.id === tagId);
    if (!point || !tag || !image) return;
    const center = {
      x: tag.bbox.x + tag.bbox.width / 2,
      y: tag.bbox.y + tag.bbox.height / 2,
    };
    const crop = cropForAnyBoxRotation(tag.bbox, image);
    const cropBodyLine = tag.bodyLine.map((bodyPoint) => pointToCrop(bodyPoint, crop));
    const startRotation = tag.correctionRotationDeg ?? verticalLineRotation(cropBodyLine);
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
      startAngle: pointerAngle(point, center),
      startRotation,
    });
  }

  function beginBboxMove(event: PointerEvent<HTMLElement>, tagId: string) {
    if (mode === "move") return;
    if (tagId !== activeTagId || !(event.target as HTMLElement).closest(".bbox-move-handle")) return;
    event.stopPropagation();
    const point = pointFromPointer(event);
    const tag = tags.find((current) => current.id === tagId);
    if (!point || !tag) return;
    const startBox = tag.correctionRotationDeg == null || !image ? tag.bbox : correctedGeometry(tag, image).correctedBox;
    setShowOriginalTagId(null);
    setDrag({ type: "bbox", pointerId: event.pointerId, tagId, handle: "move", startBox, startPoint: point });
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
      current.map((tag) => (tag.id === tagId ? { ...tag, status: "active" } : tag)),
    );
  }

  function toggleTagFromHead(tagId: string) {
    if (activeTagId === tagId) {
      setActiveTagId(null);
      setShowOriginalTagId(null);
      setEditTarget("auto");
      return;
    }

    setActiveTagId(tagId);
    setShowOriginalTagId(tagId);
    setEditTarget("auto");
    setTags((current) =>
      current.map((tag) => (tag.id === tagId ? { ...tag, status: "active" } : tag)),
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
              style={{ aspectRatio: `${image.width} / ${image.height}` }}
            >
              <label className="floating-open-button" data-no-draw onPointerDown={(event) => event.stopPropagation()} aria-label="Open koi photo">
                <input type="file" accept="image/*" onChange={loadImage} />
                <ImagePlus size={19} />
              </label>

              <div
                className="image-transform"
                style={{
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                }}
              >
                <img src={image.src} alt={image.name} draggable={false} />

                {activeTag && activeTag.correctionRotationDeg != null && showOriginalTagId !== activeTag.id && <LiveRotatedCrop image={image} tag={activeTag} />}

                <svg className="overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                  {tags.map((tag, index) => (
                    <g key={tag.id} className={tag.id === activeTagId ? "selected" : ""}>
                      <path d={pathFromPoints(tag.bodyLine)} className="body-line" />
                      {tag.finLine && <path d={pathFromPoints(tag.finLine)} className="fin-line" />}
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

                {tags.map((tag) => (
                  <div
                    key={`${tag.id}-bbox`}
                    className={`bbox ${tag.status === "done" ? "done" : ""} ${tag.id === activeTagId ? "active editable" : ""}`}
                    style={bboxStyle(tag.id === activeTagId && activeDisplayBox ? activeDisplayBox : tag.bbox)}
                    aria-hidden="true"
                  />
                ))}

                {activeTag && activeDisplayBox && showActiveCorrectionControls && (
                  <>
                    <span
                      className="bbox-move-handle"
                      style={bboxHandleStyle(activeDisplayBox, "move")}
                      data-no-draw
                      aria-hidden="true"
                      onPointerDown={(event) => beginBboxMove(event, activeTag.id)}
                    />
                    {(["nw", "se"] as const).map((handle) => (
                      <span
                        key={handle}
                        className={`bbox-handle resize-handle ${handle}`}
                        style={bboxHandleStyle(activeDisplayBox, handle)}
                        data-no-draw
                        onPointerDown={(event) => beginBboxResize(event, activeTag.id, handle)}
                      />
                    ))}
                    {(["ne", "sw"] as const).map((handle) => (
                      <span
                        key={handle}
                        className={`bbox-handle rotate-handle ${handle}`}
                        style={bboxHandleStyle(activeDisplayBox, handle)}
                        data-no-draw
                        onPointerDown={(event) => beginCorrectionRotate(event, activeTag.id)}
                      />
                    ))}
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
                <Button
                  className="floating-mode-button"
                  size="icon"
                  variant={mode === "move" ? "default" : "secondary"}
                  onClick={() => setMode((current) => (current === "move" ? "tag" : "move"))}
                  aria-label={mode === "move" ? "Switch to tagging" : "Switch to pan and zoom"}
                >
                  {mode === "move" ? <MousePointer2 size={19} /> : <Hand size={19} />}
                </Button>

                {mode === "move" && (
                  <>
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
                  </>
                )}

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
            <label className="empty-stage">
              <input type="file" accept="image/*" onChange={loadImage} />
              <span className="floating-open-button empty-open-icon">
                <ImagePlus size={22} />
              </span>
            </label>
          )}
        </div>
      </section>

      {drawerOpen && image && tags.length > 0 && (
        <CorrectedThumbDrawer
          image={image}
          tags={tags}
          activeTagId={activeTagId}
          onClose={() => setDrawerOpen(false)}
          onDelete={deleteTagById}
          onSelect={selectTagForEditing}
        />
      )}
    </main>
  );
}

function LiveRotatedCrop({ image, tag }: { image: ImageInfo; tag: KoiTag }) {
  const geometry = useMemo(() => correctedGeometry(tag, image), [image, tag]);

  return (
    <div className="live-crop" style={bboxStyle(geometry.crop)} aria-hidden="true">
      <div
        className="live-crop-scene"
        style={{
          transform: `rotate(${geometry.rotation}deg)`,
          transformOrigin: `${geometry.cropCenter.x * 100}% ${geometry.cropCenter.y * 100}%`,
        }}
      >
        <img
          src={image.src}
          alt=""
          draggable={false}
          style={{
            left: `${(-geometry.crop.x / geometry.crop.width) * 100}%`,
            top: `${(-geometry.crop.y / geometry.crop.height) * 100}%`,
            width: `${(1 / geometry.crop.width) * 100}%`,
            height: `${(1 / geometry.crop.height) * 100}%`,
          }}
        />
      </div>
      <div className="live-rotated-bbox" style={bboxStyle(geometry.cropCorrectedBox)} />
    </div>
  );
}

function CorrectedThumbDrawer({
  image,
  tags,
  activeTagId,
  onClose,
  onDelete,
  onSelect,
}: {
  image: ImageInfo;
  tags: KoiTag[];
  activeTagId: string | null;
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
  onDelete,
  onSelect,
}: {
  image: ImageInfo;
  tag: KoiTag;
  active: boolean;
  onDelete: () => void;
  onSelect: () => void;
}) {
  const geometry = useMemo(() => correctedGeometry(tag, image), [image, tag]);
  const thumbCrop = useMemo(() => expandBoxByPercent(geometry.correctedBox, THUMB_MARGIN_X, THUMB_MARGIN_Y), [geometry.correctedBox]);
  const originalCenter = useMemo(
    () => ({
      x: tag.bbox.x + tag.bbox.width / 2,
      y: tag.bbox.y + tag.bbox.height / 2,
    }),
    [tag.bbox],
  );
  const thumbCropCenter = useMemo(() => pointToCrop(originalCenter, thumbCrop), [originalCenter, thumbCrop]);

  return (
    <button className={`thumb-card ${active ? "active" : ""}`} style={{ aspectRatio: `${thumbCrop.width * image.width} / ${thumbCrop.height * image.height}` }} onClick={onSelect}>
      <div className="thumb-stage">
        <div
          className="thumb-scene"
          style={{
            transform: `rotate(${geometry.rotation}deg)`,
            transformOrigin: `${thumbCropCenter.x * 100}% ${thumbCropCenter.y * 100}%`,
          }}
        >
          <img
            src={image.src}
            alt=""
            draggable={false}
            style={{
              left: `${(-thumbCrop.x / thumbCrop.width) * 100}%`,
              top: `${(-thumbCrop.y / thumbCrop.height) * 100}%`,
              width: `${(1 / thumbCrop.width) * 100}%`,
              height: `${(1 / thumbCrop.height) * 100}%`,
            }}
          />
        </div>
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
