import { z } from "zod";

/** A numeric value or a constant expression such as "2*pi" (evaluated by the safe parser). */
export const NumOrExpr = z.union([z.number(), z.string().min(1).max(200)]);
export type NumOrExpr = z.infer<typeof NumOrExpr>;

export const GroupId = z.enum(["essential", "supporting", "exploration"]);
export type GroupId = z.infer<typeof GroupId>;

export const Source = z.enum(["question", "derived", "user"]);
export type Source = z.infer<typeof Source>;

const Expr = z.string().min(1).max(500);
const Id = z.string().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "id must be an identifier");

const base = {
  id: Id,
  label: z.string().max(120).optional(),
  displayLatex: z.string().max(300).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  group: GroupId.default("essential"),
  visible: z.boolean().default(true),
  source: Source.default("question"),
  derivation: z.string().max(300).optional(),
};

const Domain = z.object({ min: NumOrExpr, max: NumOrExpr }).nullable().optional();

export const FunctionObj = z.object({ ...base, type: z.literal("function"), expression: Expr, variable: z.string().default("x"), domain: Domain, dashed: z.boolean().optional() });
export const ImplicitObj = z.object({ ...base, type: z.literal("implicit_curve"), expression: Expr });
export const ParametricObj = z.object({ ...base, type: z.literal("parametric_curve"), xExpression: Expr, yExpression: Expr, parameter: z.string().default("t"), min: NumOrExpr, max: NumOrExpr });
export const PolarObj = z.object({ ...base, type: z.literal("polar_curve"), expression: Expr, parameter: z.string().default("theta"), min: NumOrExpr.default(0), max: NumOrExpr.default("2*pi") });
export const PointObj = z.object({ ...base, type: z.literal("point"), x: NumOrExpr, y: NumOrExpr });
export const MovablePointObj = z.object({ ...base, type: z.literal("movable_point"), x: z.number(), y: z.number(), onFunctionRef: Id.optional() });
const TwoPoint = { p1: z.tuple([NumOrExpr, NumOrExpr]), p2: z.tuple([NumOrExpr, NumOrExpr]) };
export const LineObj = z.object({ ...base, type: z.literal("line"), ...TwoPoint });
export const SegmentObj = z.object({ ...base, type: z.literal("segment"), ...TwoPoint });
export const RayObj = z.object({ ...base, type: z.literal("ray"), ...TwoPoint });
export const VerticalLineObj = z.object({ ...base, type: z.literal("vertical_line"), x: NumOrExpr, dashed: z.boolean().optional() });
export const HorizontalLineObj = z.object({ ...base, type: z.literal("horizontal_line"), y: NumOrExpr, dashed: z.boolean().optional() });
export const TangentObj = z.object({ ...base, type: z.literal("tangent"), functionRef: Id, at: NumOrExpr, draggable: z.boolean().optional() });
export const NormalObj = z.object({ ...base, type: z.literal("normal"), functionRef: Id, at: NumOrExpr, draggable: z.boolean().optional() });
export const IntegralObj = z.object({ ...base, type: z.literal("integral"), functionRef: Id, lower: NumOrExpr, upper: NumOrExpr, showValue: z.boolean().default(true), draggableBounds: z.boolean().default(false) });
export const AreaBetweenObj = z.object({ ...base, type: z.literal("area_between_curves"), upperRef: Id, lowerRef: Id, from: NumOrExpr.optional(), to: NumOrExpr.optional(), showValue: z.boolean().default(true) });
export const InequalityObj = z.object({ ...base, type: z.literal("inequality_region"), expression: Expr, operator: z.enum([">", ">=", "<", "<="]), variable: z.enum(["y", "x"]).default("y") });
export const SliderObj = z.object({ ...base, type: z.literal("slider"), name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), min: z.number(), max: z.number(), step: z.number().positive().default(0.1), value: z.number() });
export const TextObj = z.object({ ...base, type: z.literal("text_annotation"), x: NumOrExpr, y: NumOrExpr, text: z.string().min(1).max(300) });
export const IntersectionObj = z.object({ ...base, type: z.literal("intersection_marker"), refA: Id, refB: Id.optional(), from: NumOrExpr.optional(), to: NumOrExpr.optional() });
export const AsymptoteObj = z.object({ ...base, type: z.literal("asymptote"), kind: z.enum(["vertical", "horizontal", "oblique"]), value: NumOrExpr.optional(), expression: Expr.optional() });

export const GraphObject = z.discriminatedUnion("type", [
  FunctionObj, ImplicitObj, ParametricObj, PolarObj, PointObj, MovablePointObj, LineObj, SegmentObj, RayObj,
  VerticalLineObj, HorizontalLineObj, TangentObj, NormalObj, IntegralObj, AreaBetweenObj, InequalityObj,
  SliderObj, TextObj, IntersectionObj, AsymptoteObj,
]);
export type GraphObject = z.infer<typeof GraphObject>;
export type GraphObjectInput = z.input<typeof GraphObject>;
export type GraphObjectType = GraphObject["type"];
export type ObjOf<T extends GraphObjectType> = Extract<GraphObject, { type: T }>;

export const Viewport = z
  .object({ xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number(), keepAspectRatio: z.boolean().optional() })
  .refine((v) => v.xMax > v.xMin && v.yMax > v.yMin, "viewport min must be < max");
export type Viewport = z.infer<typeof Viewport>;

export const GraphGroup = z.object({ id: GroupId, title: z.string(), visible: z.boolean().default(true) });
export type GraphGroup = z.infer<typeof GraphGroup>;

export const GRAPH_DOCUMENT_VERSION = 1 as const;

export const GraphDocument = z.object({
  version: z.literal(1),
  viewport: Viewport,
  objects: z.array(GraphObject).max(80),
  groups: z.array(GraphGroup).default([
    { id: "essential", title: "Essential", visible: true },
    { id: "supporting", title: "Supporting", visible: true },
    { id: "exploration", title: "Explore", visible: true },
  ]),
  metadata: z
    .object({ title: z.string().max(200).optional(), pageLabel: z.string().optional(), questionLabel: z.string().optional() })
    .default({}),
});
export type GraphDocument = z.infer<typeof GraphDocument>;

export const DEFAULT_GROUPS: GraphGroup[] = [
  { id: "essential", title: "Essential", visible: true },
  { id: "supporting", title: "Supporting", visible: true },
  { id: "exploration", title: "Explore", visible: true },
];

export function emptyDocument(meta: GraphDocument["metadata"] = {}): GraphDocument {
  return { version: 1, viewport: { xMin: -10, xMax: 10, yMin: -7, yMax: 7 }, objects: [], groups: DEFAULT_GROUPS.map((g) => ({ ...g })), metadata: meta };
}

// ---------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------
export const PatchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), object: GraphObject }),
  z.object({ op: z.literal("remove"), id: Id }),
  z.object({ op: z.literal("update"), id: Id, changes: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("set_visibility"), id: Id, visible: z.boolean() }),
  z.object({ op: z.literal("set_group_visibility"), group: GroupId, visible: z.boolean() }),
  z.object({ op: z.literal("set_slider"), name: z.string(), value: z.number().optional(), min: z.number().optional(), max: z.number().optional(), step: z.number().positive().optional() }),
  z.object({ op: z.literal("set_viewport"), viewport: Viewport }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const GraphPatch = z.object({ operations: z.array(PatchOp).max(40) });
export type GraphPatch = z.infer<typeof GraphPatch>;
