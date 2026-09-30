"use client";
import type { GraphDocument, GraphObject } from "@/lib/graph/schema";

type Slider = Extract<GraphObject, { type: "slider" }>;

export function SliderPanel({ doc, params, onChange }: { doc: GraphDocument; params: Record<string, number>; onChange: (name: string, value: number) => void }) {
  const sliders = doc.objects.filter((o): o is Slider => o.type === "slider");
  if (!sliders.length) return null;
  return (
    <div className="space-y-3">
      {sliders.map((s) => {
        const v = params[s.name] ?? s.value;
        return (
          <div key={s.id}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <label htmlFor={`sl-${s.id}`} className="font-mono">{s.name} = {Number(v.toFixed(4))}</label>
              <span className="text-xs text-muted">{s.min} … {s.max}</span>
            </div>
            <input
              id={`sl-${s.id}`}
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={v}
              onChange={(e) => onChange(s.name, Number(e.target.value))}
              className="h-8 w-full accent-[var(--accent)]"
            />
          </div>
        );
      })}
    </div>
  );
}
