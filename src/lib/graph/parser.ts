import { create, all, type MathNode, type EvalFunction } from "mathjs";

/**
 * Controlled expression parser. Model-generated and user-typed mathematics is
 * untrusted: we never use eval/new Function. Expressions are parsed by math.js
 * and every node is checked against a whitelist before compilation.
 */
export const math = create(all, {});

const SAFE_FUNCTIONS = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot", "asin", "acos", "atan", "atan2", "asec", "acsc", "acot",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "sech", "csch", "coth",
  "exp", "log", "log10", "log2", "sqrt", "cbrt", "nthRoot", "abs", "sign", "floor", "ceil", "round", "fix",
  "min", "max", "mod", "pow", "hypot",
]);
const CONSTANTS = new Set(["pi", "e", "PI", "E", "Infinity"]);
const OPERATORS = new Set(["+", "-", "*", "/", "^", "unaryMinus", "unaryPlus", "<", "<=", ">", ">=", "==", "!=", "and", "or", "not", "mod"]);

export class ExpressionError extends Error {
  constructor(message: string, public readonly expression: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

/** Convert common textbook / speech notation into math.js syntax. */
export function normalizeExpression(input: string): string {
  let s = input.trim();
  s = s
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π/g, "pi")
    .replace(/θ/g, "theta")
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/√\s*([A-Za-z0-9.]+)/g, "sqrt($1)")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/⁴/g, "^4")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/\*\*/g, "^")
    .replace(/\bln\s*\(/g, "log(")
    .replace(/\bln\s+([A-Za-z0-9]+)/g, "log($1)")
    .replace(/\barcsin\b/g, "asin")
    .replace(/\barccos\b/g, "acos")
    .replace(/\barctan\b/g, "atan")
    .replace(/\btan\^-1\b/g, "atan")
    .replace(/\bsin\^-1\b/g, "asin")
    .replace(/\bcos\^-1\b/g, "acos");
  // |expr| -> abs(expr) (non-nested, repeated)
  for (let i = 0; i < 5 && /\|[^|]+\|/.test(s); i++) s = s.replace(/\|([^|]+)\|/g, "abs($1)");
  // sin^2(x) -> sin(x)^2
  s = s.replace(/\b(sin|cos|tan|sec|csc|cot)\^(\d+)\s*\(([^()]*)\)/g, "$1($3)^$2");
  return s;
}

function checkNode(node: MathNode, allowedSymbols: Set<string>, expr: string): void {
  node.traverse((n: MathNode, _path: string, parent: MathNode | null) => {
    switch (n.type) {
      case "ConstantNode":
      case "ParenthesisNode":
      case "ConditionalNode":
        return;
      case "OperatorNode": {
        const op = (n as unknown as { fn: string }).fn;
        const o = (n as unknown as { op: string }).op;
        if (!OPERATORS.has(o) && !OPERATORS.has(op)) throw new ExpressionError(`Operator "${o}" is not allowed`, expr);
        return;
      }
      case "FunctionNode": {
        const fn = (n as unknown as { fn: MathNode }).fn;
        const name = fn.type === "SymbolNode" ? (fn as unknown as { name: string }).name : "";
        if (!SAFE_FUNCTIONS.has(name)) throw new ExpressionError(`Function "${name || "?"}" is not allowed`, expr);
        return;
      }
      case "SymbolNode": {
        const name = (n as unknown as { name: string }).name;
        // function names appear as SymbolNodes under FunctionNode.fn
        if (parent && parent.type === "FunctionNode" && (parent as unknown as { fn: MathNode }).fn === n) return;
        if (CONSTANTS.has(name) || allowedSymbols.has(name)) return;
        throw new ExpressionError(`Unknown symbol "${name}"`, expr);
      }
      default:
        throw new ExpressionError(`Unsupported syntax (${n.type})`, expr);
    }
  });
}

export interface CompiledExpression {
  source: string;
  node: MathNode;
  evaluate: (scope: Record<string, number>) => number;
}

const cache = new Map<string, CompiledExpression>();

/** Parse + whitelist-check + compile. Throws ExpressionError on anything unsafe or malformed. */
export function compileExpression(expression: string, allowedSymbols: Iterable<string>): CompiledExpression {
  const allowed = new Set(allowedSymbols);
  const src = normalizeExpression(expression);
  const key = `${src}\u0000${[...allowed].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let node: MathNode;
  try {
    node = math.parse(src);
  } catch (e) {
    throw new ExpressionError(`Could not parse "${expression}": ${(e as Error).message}`, expression);
  }
  checkNode(node, allowed, expression);
  let code: EvalFunction;
  try {
    code = node.compile();
  } catch (e) {
    throw new ExpressionError(`Could not compile "${expression}": ${(e as Error).message}`, expression);
  }
  const compiled: CompiledExpression = {
    source: src,
    node,
    evaluate: (scope) => {
      try {
        const v = code.evaluate({ ...scope });
        if (typeof v === "number") return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (v && typeof v === "object" && "re" in v) return Number.NaN; // complex -> not real
        return Number(v);
      } catch {
        return Number.NaN;
      }
    },
  };
  if (cache.size > 2000) cache.clear();
  cache.set(key, compiled);
  return compiled;
}

/** Evaluate a numeric-or-constant-expression field ("2*pi", 3, "a+1"). */
export function evalNum(v: number | string, scope: Record<string, number> = {}): number {
  if (typeof v === "number") return v;
  const c = compileExpression(v, Object.keys(scope));
  return c.evaluate(scope);
}

/** Collect the free symbols (excluding constants and function names). */
export function freeSymbols(expression: string): string[] {
  const node = math.parse(normalizeExpression(expression));
  const out = new Set<string>();
  node.traverse((n: MathNode, _p: string, parent: MathNode | null) => {
    if (n.type !== "SymbolNode") return;
    if (parent && parent.type === "FunctionNode" && (parent as unknown as { fn: MathNode }).fn === n) return;
    const name = (n as unknown as { name: string }).name;
    if (!CONSTANTS.has(name)) out.add(name);
  });
  return [...out];
}

// ---------------------------------------------------------------------------
// Manual-entry classification
// ---------------------------------------------------------------------------
export type EntryClassification =
  | { kind: "function"; expression: string; name?: string }
  | { kind: "implicit"; expression: string }
  | { kind: "vertical_line"; x: string }
  | { kind: "horizontal_line"; y: string }
  | { kind: "polar"; expression: string }
  | { kind: "inequality"; expression: string; operator: ">" | ">=" | "<" | "<="; variable: "y" | "x" }
  | { kind: "point"; x: string; y: string }
  | { kind: "unsupported"; reason: string };

function onlySymbols(expr: string, allowed: string[]): boolean {
  try {
    return freeSymbols(expr).every((s) => allowed.includes(s));
  } catch {
    return false;
  }
}

/**
 * Decide what a typed entry is, without AI.
 * "sin(x)" -> function, "y = x^2" -> function, "x^2+y^2=25" -> implicit,
 * "x = 3" -> vertical line, "y = 2" -> horizontal line, "r = 1+cos(theta)" -> polar,
 * "y >= x^2" -> inequality, "(1, 2)" -> point.
 */
export function classifyEntry(raw: string, params: string[] = []): EntryClassification {
  const s = normalizeExpression(raw).replace(/\s+/g, " ").trim();
  if (!s) return { kind: "unsupported", reason: "Empty expression" };

  const pt = /^\(\s*([^,()]+(?:\([^()]*\))?[^,()]*)\s*,\s*([^,()]+(?:\([^()]*\))?[^,()]*)\s*\)$/.exec(s);
  if (pt && onlySymbols(pt[1], params) && onlySymbols(pt[2], params)) return { kind: "point", x: pt[1].trim(), y: pt[2].trim() };

  const ineq = /^(.*?)(>=|<=|>|<)(.*)$/.exec(s);
  if (ineq && !s.includes("==")) {
    const [, lhs, op, rhs] = ineq;
    const L = lhs.trim(), R = rhs.trim();
    const flip: Record<string, ">" | ">=" | "<" | "<="> = { ">": "<", ">=": "<=", "<": ">", "<=": ">=" };
    if (L === "y" && onlySymbols(R, ["x", ...params])) return { kind: "inequality", expression: R, operator: op as ">", variable: "y" };
    if (R === "y" && onlySymbols(L, ["x", ...params])) return { kind: "inequality", expression: L, operator: flip[op], variable: "y" };
    if (L === "x" && onlySymbols(R, ["y", ...params])) return { kind: "inequality", expression: R, operator: op as ">", variable: "x" };
    return { kind: "unsupported", reason: "Only inequalities of the form y ≥ f(x) or x ≥ g(y) are supported" };
  }

  const eq = s.split("=");
  if (eq.length > 2) return { kind: "unsupported", reason: "More than one '=' sign" };
  if (eq.length === 1) {
    if (onlySymbols(s, ["x", ...params])) return { kind: "function", expression: s };
    if (onlySymbols(s, ["x", "y", ...params])) return { kind: "implicit", expression: s };
    return { kind: "unsupported", reason: "Expression uses variables other than x and y" };
  }
  const L = eq[0].trim(), R = eq[1].trim();
  if (!L || !R) return { kind: "unsupported", reason: "Incomplete equation" };

  const fnDef = /^([A-Za-z]\w*)\s*\(\s*x\s*\)$/.exec(L);
  if (fnDef && onlySymbols(R, ["x", ...params])) return { kind: "function", expression: R, name: fnDef[1] };
  if (L === "y" && onlySymbols(R, ["x", ...params])) {
    return onlySymbols(R, params) ? { kind: "horizontal_line", y: R } : { kind: "function", expression: R };
  }
  if (R === "y" && onlySymbols(L, ["x", ...params])) {
    return onlySymbols(L, params) ? { kind: "horizontal_line", y: L } : { kind: "function", expression: L };
  }
  if (L === "x" && onlySymbols(R, params)) return { kind: "vertical_line", x: R };
  if (R === "x" && onlySymbols(L, params)) return { kind: "vertical_line", x: L };
  if (L === "r" && onlySymbols(R, ["theta", ...params])) return { kind: "polar", expression: R };
  if (onlySymbols(L, ["x", "y", ...params]) && onlySymbols(R, ["x", "y", ...params])) {
    return { kind: "implicit", expression: `(${L}) - (${R})` };
  }
  return { kind: "unsupported", reason: "Could not recognise this equation" };
}

/** Normalise an implicit equation "F = G" to "F - G" (for F(x,y)=0). */
export function implicitToZeroForm(expr: string): string {
  const s = normalizeExpression(expr);
  const parts = s.split("=");
  if (parts.length === 1) return s;
  if (parts.length !== 2) throw new ExpressionError("Implicit equation must contain exactly one '='", expr);
  return `(${parts[0].trim()}) - (${parts[1].trim()})`;
}
