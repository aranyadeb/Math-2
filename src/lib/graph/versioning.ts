import { GraphDocument } from "./schema";

/**
 * Upgrade any persisted document to the current version. Add a transform per
 * future version (v1 -> v2 ...) here; never assume stored JSON is current.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // 0: legacy/unversioned documents from early development had no groups/metadata.
  0: (doc) => ({ ...doc, version: 1 }),
};

export function upgradeGraphDocument(raw: unknown): GraphDocument {
  if (!raw || typeof raw !== "object") throw new Error("Graph document is not an object");
  let doc = raw as Record<string, unknown>;
  let v = typeof doc.version === "number" ? doc.version : 0;
  while (v < 1) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from graph document version ${v}`);
    doc = m(doc);
    v = doc.version as number;
  }
  return GraphDocument.parse(doc);
}
