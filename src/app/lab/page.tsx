"use client";
import { useMemo, useState } from "react";
import { GraphBoard } from "@/components/graph/graph-board";
import { ExpressionEditor } from "@/components/graph/expression-editor";
import { ObjectPanel } from "@/components/graph/object-panel";
import { SliderPanel } from "@/components/graph/slider-panel";
import { Card, Select } from "@/components/ui/primitives";
import { GRAPH_FIXTURES } from "@/lib/graph/fixtures";
import { emptyDocument, type GraphDocument, type GraphObject } from "@/lib/graph/schema";
import { applyPatch } from "@/lib/graph/validation";

/** Scratch graphing (no book, no AI) + the built-in example gallery. */
export default function LabPage() {
  const names = Object.keys(GRAPH_FIXTURES);
  const [name, setName] = useState<string>("");
  const [doc, setDoc] = useState<GraphDocument>(() => emptyDocument({ title: "Scratch" }));
  const [params, setParams] = useState<Record<string, number>>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const key = useMemo(() => JSON.stringify({ o: doc.objects.map((o) => (o.type === "slider" ? { ...o, value: 0 } : o)), g: doc.groups, v: name }), [doc, name]);
  const load = (n: string) => {
    setName(n);
    const d = n ? GRAPH_FIXTURES[n] : emptyDocument({ title: "Scratch" });
    setDoc(d);
    setParams(Object.fromEntries(d.objects.filter((o) => o.type === "slider").map((o) => [(o as { name: string }).name, (o as { value: number }).value])));
  };
  const add = (o: GraphObject) => setDoc((d) => applyPatch(d, { operations: [{ op: "add", object: o }] }, { allowUserChanges: true }));
  return (
    <div className="mx-auto grid max-w-6xl gap-3 p-3 lg:grid-cols-[2fr_1fr]">
      <Card className="h-[60vh] overflow-hidden lg:h-[80vh]">
        <GraphBoard doc={doc} structureKey={key} params={params} dark={false} onWarnings={setWarnings} />
      </Card>
      <Card className="space-y-3 p-3">
        <h1 className="font-semibold">Graph lab</h1>
        <Select aria-label="Example" value={name} onChange={(e) => load(e.target.value)} className="w-full" data-testid="fixture">
          <option value="">Scratch</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <SliderPanel doc={doc} params={params} onChange={(n, v) => setParams((p) => ({ ...p, [n]: v }))} />
        {(["essential", "supporting", "exploration"] as const).map((g) => (
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
