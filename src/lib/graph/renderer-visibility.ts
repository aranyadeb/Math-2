import type { GraphDocument, GraphObject } from "./schema";

/** Whether an object should be shown given its own and its group's visibility. */
export function isShown(doc: GraphDocument, o: GraphObject): boolean {
  const g = doc.groups.find((x) => x.id === o.group);
  return o.visible && (g ? g.visible : true);
}
