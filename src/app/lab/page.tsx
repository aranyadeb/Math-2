"use client";
import { useMemo, useState } from "react";
import { GraphBoard } from "@/components/graph/graph-board";
import { ExpressionEditor } from "@/components/graph/expression-editor";
import { ObjectPanel } from "@/components/graph/object-panel";
import { SliderPanel } from "@/components/graph/slider-panel";
import { Card, Select } from "@/components/ui/primitives";
import { GRAPH_FIXTURES } from "@/lib/graph/fixtures";
import { GraphDocument as GraphDocumentSchema, emptyDocument, type GraphDocument, type GraphObject } from "@/lib/graph/schema";

// Development-only regression fixture: model-supplied text must never become HTML.
const HOSTILE = '<img src=x onerror="window.__xss=1">';
const DEV_FIXTURES: Record<string, GraphDocument> = process.env.NODE_ENV === "production" ? {} : {
  "Safety check: hostile labels": GraphDocumentSchema.parse({
    version: 1,
    viewport: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
    objects: [
      { type: "point", id: "p", x: 1, y: 1, label: HOSTILE },
      { type: "text_annotation", id: "t", x: -2, y: 2, text: HOSTILE },
      { type: "function", id: "f", expression: "x", label: HOSTILE, displayLatex: HOSTILE },
      { type: "intersection_marker", id: "m", refA: "f" },
    ],
  }),
};
const FIXTURES = { ...GRAPH_FIXTURES, ...DEV_FIXTURES };
import { applyPatch } from "@/lib/graph/validation";
import { usePrefersDark } from "@/hooks/use-prefers-dark";

/** Scratch graphing (no book, no AI) + the built-in example gallery. */
export default function LabPage() {
  const names = Object.keys(FIXTURES);
  const [name, setName] = useState<string>("");
  const [doc, setDoc] = useState<GraphDocument>(() => emptyDocument({ title: "Scratch" }));
  const [params, setParams] = useState<Record<string, number>>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const dark = usePrefersDark();
  const key = useMemo(() => JSON.stringify({ o: doc.objects.map((o) => (o.type === "slider" ? { ...o, value: 0 } : o)), g: doc.groups, v: name }), [doc, name]);
  const load = (n: string) => {
    setName(n);
    const d = n ? FIXTURES[n] : emptyDocument({ title: "Scratch" });
    setDoc(d);
    setParams(Object.fromEntries(d.objects.filter((o) => o.type === "slider").map((o) => [(o as { name: string }).name, (o as { value: number }).value])));
  };
  const add = (o: GraphObject) => setDoc((d) => applyPatch(d, { operations: [{ op: "add", object: o }] }, { allowUserChanges: true }));
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="h-[60vh] overflow-hidden lg:h-[80vh]">
        <GraphBoard doc={doc} structureKey={key} params={params} dark={dark} onWarnings={setWarnings} />
      </Card>
      <Card className="space-y-3 p-3">
        <h1 className="font-semibold">Graph lab</h1>
        <Select aria-label="Example" value={name} onChange={(e) => load(e.target.value)} className="w-full" data-testid="fixture">
          <option value="">Scratch</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <SliderPanel doc={doc} params={params} onChange={(n, v) => setParams((p) => ({ ...p, [n]: v }))} />
        {(["essential", "supporting", "exploration"] as const).filter((g) => doc.objects.some((o) => o.group === g && o.type !== "slider")).map((g) => (
          <ObjectPanel key={g} doc={doc} group={g} warnings={warnings}
            onToggle={(id, visible) => setDoc((d) => applyPatch(d, { operations: [{ op: "set_visibility", id, visible }] }))}
            onRemove={(id) => setDoc((d) => applyPatch(d, { operations: [{ op: "remove", id }] }, { allowUserChanges: true }))} />
        ))}
        <ExpressionEditor doc={doc} onAdd={add} />
        {Object.keys(warnings).length ? <pre data-testid="warnings" className="whitespace-pre-wrap text-xs text-warn">{JSON.stringify(warnings, null, 1)}</pre> : null}
      </Card>
    </div>
  );
}
