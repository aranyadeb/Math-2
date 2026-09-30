"use client";
import { useState } from "react";
import { objectFromEntry } from "@/lib/graph/manual-entry";
import type { GraphDocument, GraphObject } from "@/lib/graph/schema";
import { validateDocument } from "@/lib/graph/validation";
import { Button, Input, Notice } from "../ui/primitives";

/** Manual graph entry — parsed locally, no AI. */
export function ExpressionEditor({ doc, onAdd }: { doc: GraphDocument; onAdd: (o: GraphObject) => void }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const r = objectFromEntry(doc, value);
        if (!r.ok) return setErr(r.reason);
        const issues = validateDocument({ ...doc, objects: [...doc.objects, r.object] }).filter((i) => i.objectId === r.object.id);
        if (issues.length) return setErr(issues.map((i) => i.message).join("; "));
        onAdd(r.object);
        setValue("");
        setErr(null);
      }}
    >
      <label htmlFor="expr" className="sr-only">Add expression</label>
      <div className="flex gap-2">
        <Input id="expr" value={value} onChange={(e) => setValue(e.target.value)} placeholder="sin(x), x^2+y^2=25, y>=x^2" autoComplete="off" className="font-mono" />
        <Button type="submit" disabled={!value.trim()}>Add</Button>
      </div>
      {err ? <Notice tone="warn">{err}</Notice> : null}
    </form>
  );
}
