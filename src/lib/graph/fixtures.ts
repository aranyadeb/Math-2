import { GraphDocument } from "./schema";

const vp = (xMin: number, xMax: number, yMin: number, yMax: number) => ({ xMin, xMax, yMin, yMax });

/** The specification's mathematical acceptance cases, as GraphDocuments. */
export const GRAPH_FIXTURES: Record<string, GraphDocument> = Object.fromEntries(
  Object.entries({
    "Basic y = x²": { viewport: vp(-4, 4, -1, 10), objects: [{ type: "function", id: "f", expression: "x^2", displayLatex: "y = x²" }] },
    "Rational y = 1/x": { viewport: vp(-5, 5, -5, 5), objects: [
      { type: "function", id: "f", expression: "1/x", displayLatex: "y = 1/x" },
      { type: "asymptote", id: "va", kind: "vertical", value: 0, group: "supporting", source: "derived" },
      { type: "asymptote", id: "ha", kind: "horizontal", value: 0, group: "supporting", source: "derived" },
    ] },
    "Piecewise |x|": { viewport: vp(-4, 4, -1, 4), objects: [{ type: "function", id: "f", expression: "abs(x)", displayLatex: "y = |x|" }] },
    "Implicit circle x²+y²=25": { viewport: { ...vp(-8, 8, -6, 6), keepAspectRatio: true }, objects: [{ type: "implicit_curve", id: "c", expression: "x^2 + y^2 = 25" }] },
    "Ellipse x²/9+y²/4=1": { viewport: { ...vp(-5, 5, -3.5, 3.5), keepAspectRatio: true }, objects: [{ type: "implicit_curve", id: "e", expression: "x^2/9 + y^2/4 = 1" }] },
    "Cycloid": { viewport: vp(-1, 13, -1, 3), objects: [{ type: "parametric_curve", id: "cy", xExpression: "t - sin(t)", yExpression: "1 - cos(t)", parameter: "t", min: 0, max: "4*pi" }] },
    "Cardioid r = 1 + cos θ": { viewport: { ...vp(-1.5, 2.5, -1.5, 1.5), keepAspectRatio: true }, objects: [{ type: "polar_curve", id: "r", expression: "1 + cos(theta)" }] },
    "Integral ∫₀² x² dx": { viewport: vp(-1, 3, -1, 5), objects: [
      { type: "function", id: "f", expression: "x^2", displayLatex: "f(x) = x²" },
      { type: "integral", id: "area1", functionRef: "f", lower: 0, upper: 2, showValue: true, draggableBounds: true },
    ] },
    "Area between y=x and y=x²": { viewport: vp(-0.5, 1.5, -0.5, 1.5), objects: [
      { type: "function", id: "g", expression: "x", displayLatex: "y = x" },
      { type: "function", id: "f", expression: "x^2", displayLatex: "y = x²" },
      { type: "area_between_curves", id: "ab", upperRef: "g", lowerRef: "f", from: 0, to: 1, showValue: true },
      { type: "intersection_marker", id: "m", refA: "g", refB: "f", group: "supporting", source: "derived" },
    ] },
    "Parameter y = x² + ax + 1": { viewport: vp(-6, 6, -4, 10), objects: [
      { type: "slider", id: "sa", name: "a", min: -5, max: 5, step: 0.1, value: 1, group: "exploration" },
      { type: "function", id: "f", expression: "x^2 + a*x + 1", displayLatex: "y = x² + ax + 1" },
    ] },
    "Tangent to y = x² at x = 2": { viewport: vp(-1, 4, -2, 9), objects: [
      { type: "function", id: "f", expression: "x^2" },
      { type: "tangent", id: "t", functionRef: "f", at: 2, draggable: true, source: "derived", group: "supporting" },
      { type: "normal", id: "n", functionRef: "f", at: 2, source: "derived", group: "supporting" },
    ] },
    "f(x)=x³−3x and f′(x)": { viewport: vp(-3, 3, -5, 5), objects: [
      { type: "function", id: "f", expression: "x^3 - 3*x", displayLatex: "f(x) = x³ − 3x" },
      { type: "function", id: "df", expression: "3*x^2 - 3", displayLatex: "f′(x) = 3x² − 3", source: "derived", derivation: "Derivative of f", group: "supporting", dashed: true },
      { type: "intersection_marker", id: "crit", refA: "df", group: "supporting", source: "derived" },
    ] },
    "Inequality y ≥ x²": { viewport: vp(-4, 4, -2, 8), objects: [
      { type: "inequality_region", id: "r", expression: "x^2", operator: ">=", variable: "y" },
      { type: "inequality_region", id: "r2", expression: "2*x + 3", operator: "<=", variable: "y" },
    ] },
  }).map(([k, v]) => [k, GraphDocument.parse({ version: 1, ...v })]),
);
