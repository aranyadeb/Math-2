"use client";
import type { GraphDocument, GraphObject, GroupId } from "@/lib/graph/schema";
import { cx } from "../ui/primitives";

function describe(o: GraphObject): string {
  if (o.displayLatex) return o.displayLatex;
  switch (o.type) {
    case "function": return `y = ${o.expression}`;
    case "implicit_curve": return `${o.expression}${o.expression.includes("=") ? "" : " = 0"}`;
    case "parametric_curve": return `(${o.xExpression}, ${o.yExpression})`;
    case "polar_curve": return `r = ${o.expression}`;
    case "tangent": return `Tangent to ${o.functionRef} at x = ${o.at}`;
    case "normal": return `Normal to ${o.functionRef} at x = ${o.at}`;
    case "integral": return `∫ ${o.functionRef} from ${o.lower} to ${o.upper}`;
    case "area_between_curves": return `Area between ${o.upperRef} and ${o.lowerRef}`;
    case "inequality_region": return `${o.variable} ${o.operator} ${o.expression}`;
    case "vertical_line": return `x = ${o.x}`;
    case "horizontal_line": return `y = ${o.y}`;
    case "point": return `(${o.x}, ${o.y})`;
    case "intersection_marker": return o.refB ? `${o.refA} ∩ ${o.refB}` : `Roots of ${o.refA}`;
    case "asymptote": return `${o.kind} asymptote ${o.value ?? o.expression ?? ""}`;
    case "text_annotation": return o.text;
    default: return o.label ?? o.id;
  }
}

export function ObjectPanel({
  doc,
  group,
  warnings,
  onToggle,
  onRemove,
}: {
  doc: GraphDocument;
  group: GroupId;
  warnings: Record<string, string>;
  onToggle: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const items = doc.objects.filter((o) => o.group === group && o.type !== "slider");
  if (!items.length) return <p className="px-1 py-3 text-sm text-muted">Nothing in this group.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((o) => (
        <li key={o.id} className="flex items-start gap-2 py-2">
          <input
            type="checkbox"
            aria-label={`Show ${describe(o)}`}
            checked={o.visible}
            onChange={(e) => onToggle(o.id, e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
          />
          <div className="min-w-0 flex-1">
            <p className={cx("break-words font-mono text-sm", !o.visible && "text-muted line-through")}>{describe(o)}</p>
            <p className="text-xs text-muted">
              {o.source === "user" ? "Added by you" : o.source === "derived" ? (o.derivation ?? "Derived") : "From the question"}
            </p>
            {warnings[o.id] ? <p className="text-xs text-warn">{warnings[o.id]}</p> : null}
          </div>
          <button aria-label={`Remove ${describe(o)}`} onClick={() => onRemove(o.id)} className="rounded px-2 text-muted hover:bg-surface-2 hover:text-danger">✕</button>
        </li>
      ))}
    </ul>
  );
}
