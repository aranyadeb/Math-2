"use client";
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { BBox } from "@/lib/supabase/types";
import { cx } from "../ui/primitives";

type Mode = { kind: "draw"; x0: number; y0: number } | { kind: "move"; dx: number; dy: number } | { kind: "resize"; corner: "nw" | "ne" | "sw" | "se"; anchor: { x: number; y: number } } | null;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Page image + editable normalised bounding box. Drag on empty space to draw,
 * drag the box to move, drag a corner to resize. Works with touch (pointer events).
 */
export function BBoxEditor({ src, value, onChange, others = [], alt }: {
  src: string;
  value: BBox | null;
  onChange: (b: BBox) => void;
  others?: { bbox: BBox; label: string; onClick?: () => void }[];
  alt: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(null);

  const pos = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const fromCorners = (a: { x: number; y: number }, b: { x: number; y: number }): BBox => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(0.005, Math.abs(a.x - b.x)), height: Math.max(0.005, Math.abs(a.y - b.y)),
  });

  const onDown = (e: RPointerEvent) => {
    const p = pos(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const t = (e.target as HTMLElement).dataset;
    if (t.corner && value) {
      const c = t.corner as "nw" | "ne" | "sw" | "se";
      const anchor = { x: c.includes("w") ? value.x + value.width : value.x, y: c.includes("n") ? value.y + value.height : value.y };
      setMode({ kind: "resize", corner: c, anchor });
    } else if (t.box && value) {
      setMode({ kind: "move", dx: p.x - value.x, dy: p.y - value.y });
    } else {
      setMode({ kind: "draw", x0: p.x, y0: p.y });
      onChange({ x: p.x, y: p.y, width: 0.005, height: 0.005 });
    }
    e.preventDefault();
  };
  const onMove = (e: RPointerEvent) => {
    if (!mode) return;
    const p = pos(e);
    if (mode.kind === "draw") onChange(fromCorners({ x: mode.x0, y: mode.y0 }, p));
    else if (mode.kind === "resize") onChange(fromCorners(mode.anchor, p));
    else if (mode.kind === "move" && value) {
      onChange({ ...value, x: clamp01(Math.min(1 - value.width, p.x - mode.dx)), y: clamp01(Math.min(1 - value.height, p.y - mode.dy)) });
    }
  };
  const onUp = () => setMode(null);

  const pct = (n: number) => `${n * 100}%`;
  return (
    <div
      ref={ref}
      className="relative mx-auto w-full max-w-3xl touch-none select-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} draggable={false} className="pointer-events-none block w-full rounded bg-white" />
      {others.map((o, i) => (
        // Existing boxes never block drawing: only their label chip is interactive.
        <div
          key={i}
          className="pointer-events-none absolute border-2 border-dashed border-sky-500/70 bg-sky-500/5"
          style={{ left: pct(o.bbox.x), top: pct(o.bbox.y), width: pct(o.bbox.width), height: pct(o.bbox.height) }}
        >
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={o.onClick}
            className="pointer-events-auto absolute -top-6 left-0 rounded bg-sky-600 px-1.5 py-0.5 text-xs text-white"
            aria-label={`Edit ${o.label}`}
          >
            {o.label} ✎
          </button>
        </div>
      ))}
      {value ? (
        <div
          data-box="1"
          className={cx("absolute cursor-move border-2 border-red-500 bg-red-500/10", mode && "bg-red-500/20")}
          style={{ left: pct(value.x), top: pct(value.y), width: pct(value.width), height: pct(value.height) }}
          aria-label="Question region"
        >
          {(["nw", "ne", "sw", "se"] as const).map((c) => (
            <span
              key={c}
              data-corner={c}
              className="absolute size-5 rounded-full border-2 border-white bg-red-500 shadow"
              style={{ [c.includes("n") ? "top" : "bottom"]: -10, [c.includes("w") ? "left" : "right"]: -10, cursor: `${c}-resize` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
