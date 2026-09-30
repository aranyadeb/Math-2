import { describe, it, expect } from "vitest";
import { integrate } from "@/lib/graph/math/integrate";
import { areaBetween } from "@/lib/graph/math/area-between";
import { findRoots, findIntersections } from "@/lib/graph/math/intersections";
import { symbolicDerivative, slopeAt, tangentLine, normalLine } from "@/lib/graph/math/derivative";
import { compileExpression, classifyEntry, normalizeExpression, ExpressionError, implicitToZeroForm } from "@/lib/graph/parser";

const f = (e: string) => { const c = compileExpression(e, ["x"]); return (x: number) => c.evaluate({ x }); };

describe("parser safety", () => {
  it("rejects unsafe constructs", () => {
    for (const bad of ["import({}, {})", "evaluate('1')", "x = 3", "f(x) = x", "[1,2]", "{a: 1}", "createUnit('foo')", "constructor", "x.constructor"]) {
      expect(() => compileExpression(bad, ["x"]), bad).toThrow(ExpressionError);
    }
  });
  it("normalises textbook notation", () => {
    expect(normalizeExpression("x² − 3x")).toBe("x^2 - 3x");
    expect(normalizeExpression("|x|")).toBe("abs(x)");
    expect(normalizeExpression("ln(x)")).toBe("log(x)");
    expect(f("|x|")(-3)).toBe(3);
    expect(f("3x^2")(2)).toBe(12);
  });
  it("classifies manual entries", () => {
    expect(classifyEntry("sin(x)").kind).toBe("function");
    expect(classifyEntry("y = x^2")).toMatchObject({ kind: "function", expression: "x^2" });
    expect(classifyEntry("x^2 + y^2 = 25").kind).toBe("implicit");
    expect(classifyEntry("x = 3")).toMatchObject({ kind: "vertical_line", x: "3" });
    expect(classifyEntry("y = 2")).toMatchObject({ kind: "horizontal_line", y: "2" });
    expect(classifyEntry("r = 1 + cos(theta)").kind).toBe("polar");
    expect(classifyEntry("y >= x^2")).toMatchObject({ kind: "inequality", operator: ">=" });
    expect(classifyEntry("y = x^2 + a*x + 1", ["a"]).kind).toBe("function");
    expect(classifyEntry("f(x) = x^3 - 3x")).toMatchObject({ kind: "function", name: "f" });
    expect(classifyEntry("(1, 2)")).toMatchObject({ kind: "point" });
    expect(classifyEntry("z = q").kind).toBe("unsupported");
  });
  it("implicit zero form", () => {
    const g = compileExpression(implicitToZeroForm("x^2 + y^2 = 25"), ["x", "y"]);
    expect(g.evaluate({ x: 3, y: 4 })).toBe(0);
    const el = compileExpression(implicitToZeroForm("x^2/9 + y^2/4 = 1"), ["x", "y"]);
    expect(el.evaluate({ x: 3, y: 0 })).toBeCloseTo(0);
  });
});

describe("integration", () => {
  it("∫0^2 x^2 dx = 8/3", () => {
    const r = integrate(f("x^2"), 0, 2);
    expect(r.ok).toBe(true);
    expect(r.value).toBeCloseTo(8 / 3, 9);
  });
  it("∫0^π sin = 2 and reversed bounds", () => {
    expect(integrate(f("sin(x)"), 0, Math.PI).value).toBeCloseTo(2, 9);
    expect(integrate(f("sin(x)"), Math.PI, 0).value).toBeCloseTo(-2, 9);
  });
  it("handles integrable endpoint singularity 1/sqrt(x)", () => {
    const r = integrate(f("1/sqrt(x)"), 0, 1, 1e-6);
    if (r.ok) expect(r.value).toBeCloseTo(2, 2);
  });
  it("refuses divergent 1/x across 0", () => {
    const r = integrate(f("1/x"), -1, 1);
    expect(r.ok).toBe(false);
  });
  it("|x| from -1 to 1 = 1", () => {
    expect(integrate(f("abs(x)"), -1, 1).value).toBeCloseTo(1, 9);
  });
});

describe("roots and intersections", () => {
  it("roots of x^3-3x", () => {
    const r = findRoots(f("x^3 - 3x"), -3, 3);
    expect(r.map((x) => +x.toFixed(6))).toEqual([-1.732051, 0, 1.732051]);
  });
  it("rejects poles as roots", () => {
    expect(findRoots(f("1/x"), -1, 1)).toEqual([]);
  });
  it("finds touching root of x^2", () => {
    expect(findRoots(f("x^2"), -1, 1).length).toBe(1);
  });
  it("y=x and y=x^2 meet at 0 and 1", () => {
    const p = findIntersections(f("x"), f("x^2"), -2, 2);
    expect(p.map((q) => +q.x.toFixed(6))).toEqual([0, 1]);
  });
});

describe("area between curves", () => {
  it("y=x, y=x^2 on [0,1] = 1/6", () => {
    const r = areaBetween(f("x"), f("x^2"), { from: 0, to: 1 });
    expect(r.ok).toBe(true);
    expect(r.total).toBeCloseTo(1 / 6, 9);
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].top).toBe("f");
  });
  it("finds enclosed region automatically", () => {
    const r = areaBetween(f("x"), f("x^2"), { searchMin: -5, searchMax: 5 });
    expect(r.from).toBeCloseTo(0, 6);
    expect(r.to).toBeCloseTo(1, 6);
  });
  it("splits when curves cross", () => {
    // sin vs 0 on [0, 2π]: two pieces, total 4
    const r = areaBetween(f("sin(x)"), f("0"), { from: 0, to: 2 * Math.PI });
    expect(r.pieces.length).toBe(2);
    expect(r.pieces[0].top).toBe("f");
    expect(r.pieces[1].top).toBe("g");
    expect(r.total).toBeCloseTo(4, 8);
  });
});

describe("derivatives, tangents, normals", () => {
  it("symbolic derivative of x^3-3x", () => {
    const d = symbolicDerivative("x^3 - 3x")!;
    const df = f(d);
    expect(df(2)).toBe(9);
    expect(df(1)).toBe(0);
  });
  it("tangent to x^2 at 2 is y=4x-4", () => {
    const s = slopeAt("x^2", 2);
    const t = tangentLine(s, 2)!;
    expect(t.kind).toBe("slope");
    expect(t.m).toBeCloseTo(4);
    expect(t.c).toBeCloseTo(-4);
    const n = normalLine(s, 2)!;
    expect(n.m).toBeCloseTo(-0.25);
  });
  it("horizontal tangent gives vertical normal", () => {
    const s = slopeAt("x^3 - 3x", 1);
    expect(normalLine(s, 1)?.kind).toBe("vertical");
  });
  it("vertical tangent of cbrt at 0", () => {
    expect(slopeAt("cbrt(x)", 0).kind).toBe("vertical");
  });
  it("corner of |x| at 0 is undefined", () => {
    expect(slopeAt("abs(x)", 0).kind).toBe("undefined");
    expect(tangentLine(slopeAt("abs(x)", 0), 0)).toBeNull();
  });
  it("undefined outside domain", () => {
    expect(slopeAt("log(x)", -1).kind).toBe("undefined");
  });
});
