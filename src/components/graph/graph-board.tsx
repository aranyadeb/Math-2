"use client";
import { useEffect, useId, useRef, useState } from "react";
import type JXG from "jsxgraph";
import type { GraphDocument } from "@/lib/graph/schema";
import type { RenderHandle } from "@/lib/graph/renderer";
import { Spinner } from "../ui/primitives";

export interface BoardApi {
  handle: RenderHandle | null;
  board: JXG.Board | null;
  zoom: (factor: number) => void;
  reset: () => void;
}

/**
 * Lazily loads JSXGraph and renders a GraphDocument. The board is rebuilt
 * when the document's structure changes; slider value changes only update.
 */
export function GraphBoard({
  doc,
  structureKey,
  params,
  dark,
  onViewportChange,
  onObjectChange,
  onWarnings,
  apiRef,
  className,
}: {
  doc: GraphDocument;
  structureKey: string;
  params: Record<string, number>;
  dark: boolean;
  onViewportChange?: (vp: GraphDocument["viewport"]) => void;
  onObjectChange?: (id: string, changes: Record<string, unknown>) => void;
  onWarnings?: (w: Record<string, string>) => void;
  apiRef?: React.MutableRefObject<BoardApi | null>;
  className?: string;
}) {
  const id = `jxg-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const boardRef = useRef<JXG.Board | null>(null);
  const handleRef = useRef<RenderHandle | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const cbs = useRef({ onViewportChange, onObjectChange, onWarnings });
  cbs.current = { onViewportChange, onObjectChange, onWarnings };
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    let disposed = false;
    let JXGmod: typeof JXG | null = null;
    (async () => {
      try {
        const [mod, renderer] = await Promise.all([import("jsxgraph"), import("@/lib/graph/renderer")]);
        if (disposed) return;
        JXGmod = (mod as unknown as { default?: typeof JXG }).default ?? (mod as unknown as typeof JXG);
        const d = docRef.current;
        if (boardRef.current) JXGmod.JSXGraph.freeBoard(boardRef.current);
        const axisColor = dark ? "#8a8a85" : "#555550";
        const gridColor = dark ? "#2e2e2c" : "#e6e6e3";
        const board = JXGmod.JSXGraph.initBoard(id, {
          boundingbox: [d.viewport.xMin, d.viewport.yMax, d.viewport.xMax, d.viewport.yMin],
          keepaspectratio: !!d.viewport.keepAspectRatio,
          axis: true,
          grid: false,
          showCopyright: false,
          showNavigation: false,
          pan: { enabled: true, needTwoFingers: false, needShift: false },
          zoom: { enabled: true, wheel: true, needShift: false, pinch: true, min: 0.001, max: 1000, factorX: 1.15, factorY: 1.15 },
          defaultAxes: {
            x: { strokeColor: axisColor, highlight: false, ticks: { strokeColor: gridColor, majorHeight: -1, label: { strokeColor: axisColor, fontSize: 11 } } },
            y: { strokeColor: axisColor, highlight: false, ticks: { strokeColor: gridColor, majorHeight: -1, label: { strokeColor: axisColor, fontSize: 11 } } },
          },
        } as unknown as Partial<JXG.BoardAttributes>);
        boardRef.current = board;
        const warnings: Record<string, string> = {};
        handleRef.current = renderer.renderGraphDocument(board, d, {
          dark,
          onObjectChange: (oid, ch) => cbs.current.onObjectChange?.(oid, ch),
          onWarning: (oid, m) => { warnings[oid] = m; },
        });
        Object.assign(handleRef.current.params, params);
        board.update();
        cbs.current.onWarnings?.(warnings);
        let t: ReturnType<typeof setTimeout> | null = null;
        board.on("boundingbox", () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => cbs.current.onViewportChange?.(renderer.readViewport(board)), 300);
        });
        if (apiRef) {
          apiRef.current = {
            handle: handleRef.current,
            board,
            zoom: (f) => (f > 1 ? board.zoomIn() : board.zoomOut()),
            reset: () => {
              const v = docRef.current.viewport;
              board.setBoundingBox([v.xMin, v.yMax, v.xMax, v.yMin], !!v.keepAspectRatio);
            },
          };
        }
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      if (boardRef.current && JXGmod) {
        try { JXGmod.JSXGraph.freeBoard(boardRef.current); } catch { /* ignore */ }
      }
      boardRef.current = null;
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, dark, id]);

  // Live slider updates without rebuilding
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    Object.assign(h.params, params);
    h.update();
  }, [params]);

  return (
    <div className={className ?? "relative h-full w-full"}>
      <div id={id} className="jxgbox h-full w-full" aria-label="Interactive graph" role="img" />
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted"><Spinner /></div>
      ) : null}
      {err ? <div className="absolute inset-x-2 top-2 rounded bg-danger/10 p-2 text-xs text-danger">Graph error: {err}</div> : null}
    </div>
  );
}
