import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Hand, Minus, MousePointer2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";

type PixelPoint = {
  x: number;
  y: number;
};

type PixelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type View = {
  scale: number;
  x: number;
  y: number;
};

type DrawMode = "draw" | "pan";

const DEFAULT_IMAGE_SRC = "/images/default-koi.jpg";
const ZOOM_STEP = 1.2;
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rotatePoint(point: PixelPoint, pivot: PixelPoint, radians: number): PixelPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;

  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

function linePath(points: PixelPoint[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function boxFromPoints(points: PixelPoint[], marginX: number, marginY: number): PixelBox {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX - marginX,
    y: minY - marginY,
    width: maxX - minX + marginX * 2,
    height: maxY - minY + marginY * 2,
  };
}

function correctionFor(bodyLine: PixelPoint[], finLine: PixelPoint[] | null) {
  if (bodyLine.length < 2) return null;

  const head = bodyLine[0];
  const tail = bodyLine[bodyLine.length - 1];
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const rotation = Math.PI / 2 - Math.atan2(dy, dx);
  const pivot = head;
  const rotatedBody = bodyLine.map((point) => rotatePoint(point, pivot, rotation));
  const rotatedFin = finLine?.map((point) => rotatePoint(point, pivot, rotation)) ?? [];
  const length = Math.max(40, Math.hypot(dx, dy));
  const crop = boxFromPoints([...rotatedBody, ...rotatedFin], length * 0.22, length * 0.04);

  return {
    crop,
    pivot,
    rotation,
  };
}

function drawCorrectedCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  bodyLine: PixelPoint[],
  finLine: PixelPoint[] | null,
  crop: PixelBox,
  pivot: PixelPoint,
  rotation: number,
) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(crop.width));
  const height = Math.max(1, Math.round(crop.height));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.aspectRatio = `${width} / ${height}`;

  const context = canvas.getContext("2d");
  if (!context) return;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.translate(-crop.x, -crop.y);
  context.translate(pivot.x, pivot.y);
  context.rotate(rotation);
  context.translate(-pivot.x, -pivot.y);
  context.drawImage(image, 0, 0);
  drawLine(context, bodyLine, "#ffd348", 10);
  if (finLine) drawLine(context, finLine, "#55e5ff", 8);
}

function drawLine(context: CanvasRenderingContext2D, points: PixelPoint[], color: string, width: number) {
  if (points.length < 2) return;

  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = "rgba(0, 0, 0, 0.7)";
  context.shadowBlur = 2;
  context.shadowOffsetY = 1;
  context.stroke();
  context.restore();
}

export default function AffinePrototype() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const panStart = useRef<{ point: PixelPoint; view: View } | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [mode, setMode] = useState<DrawMode>("draw");
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [bodyLine, setBodyLine] = useState<PixelPoint[]>([]);
  const [finLine, setFinLine] = useState<PixelPoint[] | null>(null);
  const [draft, setDraft] = useState<PixelPoint[]>([]);
  const [drawing, setDrawing] = useState(false);

  const correction = useMemo(() => correctionFor(bodyLine, finLine), [bodyLine, finLine]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !correction) return;
    drawCorrectedCanvas(canvas, image, bodyLine, finLine, correction.crop, correction.pivot, correction.rotation);
  }, [bodyLine, correction, finLine, imageReady]);

  function imagePointFromClient(clientX: number, clientY: number) {
    const rect = stageRef.current?.getBoundingClientRect();
    const image = imageRef.current;
    if (!rect || !image) return null;

    return {
      x: clamp(((clientX - rect.left) / rect.width) * image.naturalWidth, 0, image.naturalWidth),
      y: clamp(((clientY - rect.top) / rect.height) * image.naturalHeight, 0, image.naturalHeight),
    };
  }

  function startPointer(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);

    if (mode === "pan") {
      panStart.current = {
        point: { x: event.clientX, y: event.clientY },
        view,
      };
      return;
    }

    const point = imagePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    setDraft([point]);
    setDrawing(true);
  }

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    if (mode === "pan" && panStart.current) {
      setView({
        scale: panStart.current.view.scale,
        x: panStart.current.view.x + event.clientX - panStart.current.point.x,
        y: panStart.current.view.y + event.clientY - panStart.current.point.y,
      });
      return;
    }

    if (!drawing) return;
    const point = imagePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    setDraft((current) => [...current, point]);
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panStart.current = null;

    if (!drawing) return;
    setDrawing(false);
    if (draft.length < 3) {
      setDraft([]);
      return;
    }
    if (!bodyLine.length) setBodyLine(draft);
    else setFinLine(draft);
    setDraft([]);
  }

  function zoom(multiplier: number) {
    const nextScale = clamp(view.scale * multiplier, MIN_SCALE, MAX_SCALE);
    setView((current) => ({ ...current, scale: nextScale }));
  }

  function reset() {
    setBodyLine([]);
    setFinLine(null);
    setDraft([]);
  }

  const imageWidth = imageRef.current?.naturalWidth ?? 1;
  const imageHeight = imageRef.current?.naturalHeight ?? 1;

  return (
    <main className="affine-page">
      <section className="affine-workspace">
        <div
          ref={stageRef}
          className={`affine-stage ${mode === "pan" ? "pan-mode" : "draw-mode"}`}
          style={{ width: imageWidth, height: imageHeight, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          onPointerDown={startPointer}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        >
          <img ref={imageRef} src={DEFAULT_IMAGE_SRC} draggable={false} onLoad={() => setImageReady(true)} />
          <svg className="affine-overlay" viewBox={`0 0 ${imageWidth} ${imageHeight}`} preserveAspectRatio="none">
            {bodyLine.length > 0 && <path className="affine-body-line" d={linePath(bodyLine)} />}
            {finLine && <path className="affine-fin-line" d={linePath(finLine)} />}
            {draft.length > 0 && <path className={bodyLine.length ? "affine-fin-line" : "affine-body-line"} d={linePath(draft)} />}
          </svg>
        </div>
      </section>

      <div className="affine-controls">
        <Button size="icon" variant={mode === "pan" ? "default" : "secondary"} onClick={() => setMode((current) => (current === "pan" ? "draw" : "pan"))}>
          {mode === "pan" ? <MousePointer2 size={18} /> : <Hand size={18} />}
        </Button>
        <Button size="icon" variant="secondary" onClick={() => zoom(ZOOM_STEP)}>
          <Plus size={18} />
        </Button>
        <Button size="icon" variant="secondary" onClick={() => zoom(1 / ZOOM_STEP)}>
          <Minus size={18} />
        </Button>
        <Button size="icon" variant="secondary" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          <RotateCcw size={18} />
        </Button>
        <Button size="icon" variant="danger" onClick={reset}>
          <Trash2 size={18} />
        </Button>
      </div>

      {correction && (
        <aside className="affine-thumb">
          <canvas ref={canvasRef} />
        </aside>
      )}
    </main>
  );
}
