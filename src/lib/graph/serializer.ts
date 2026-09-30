import { GraphDocument, type GraphObject } from "./schema";
import { upgradeGraphDocument } from "./versioning";

/** Serialise for storage (JSONB). Stable key order is not required by Postgres. */
export function serializeGraphDocument(doc: GraphDocument): GraphDocument {
  return GraphDocument.parse(doc);
}

/** Restore from storage, upgrading older versions. */
export function restoreGraphDocument(raw: unknown): GraphDocument {
  return upgradeGraphDocument(raw);
}

/** Merge live board state (viewport, slider values, dragged objects) back into the document. */
export function mergeLiveState(
  doc: GraphDocument,
  live: { viewport?: GraphDocument["viewport"]; params?: Record<string, number>; objectChanges?: Record<string, Record<string, unknown>> },
): GraphDocument {
  const objects = doc.objects.map((o): GraphObject => {
    let next = o;
    if (o.type === "slider" && live.params && o.name in live.params) next = { ...o, value: live.params[o.name] };
    const ch = live.objectChanges?.[o.id];
    if (ch) next = { ...next, ...ch } as GraphObject;
    return next;
  });
  return { ...doc, objects, viewport: live.viewport ?? doc.viewport };
}

/** Unique id helper for new objects. */
export function uniqueId(doc: GraphDocument, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([^A-Za-z_])/, "_$1") || "obj";
  if (!doc.objects.some((o) => o.id === clean)) return clean;
  let i = 2;
  while (doc.objects.some((o) => o.id === `${clean}${i}`)) i++;
  return `${clean}${i}`;
}
