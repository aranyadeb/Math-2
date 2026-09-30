import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ZodTypeAny } from "zod";

// Mock the Gemini transport; everything above it (routing, validation, repair) is real.
const calls: { model: string; task: string; fallbackReason?: string | null }[] = [];
let responder: (model: string, task: string) => unknown = () => ({});

vi.mock("@/lib/ai/client", async () => {
  return {
    AIError: class AIError extends Error {},
    textPart: (text: string) => ({ text }),
    imagePart: () => ({ inlineData: { data: "", mimeType: "image/webp" } }),
    generateStructured: async (meta: { model: string; task: string; fallbackReason?: string | null }, opts: { schema: ZodTypeAny }) => {
      calls.push(meta);
      const raw = responder(meta.model, meta.task);
      return { data: opts.schema.parse(raw), raw, model: meta.model, inputTokens: 1, outputTokens: 1, latencyMs: 1 };
    },
  };
});

process.env.GEMINI_API_KEY = "test-key-123456";
process.env.GEMINI_FAST_MODEL = "fast-model";
process.env.GEMINI_REASONING_MODEL = "reasoning-model";
process.env.GEMINI_ESCALATION_CONFIDENCE = "0.7";

const { generateGraphDocument } = await import("@/lib/ai/generate-graph-document");

const input = (over: Record<string, unknown> = {}) => ({
  questionText: "Let f(x) = x^3 - 3x.", questionImage: null, userQuery: "show graphs", requestedActions: [],
  pageLabel: "4.33", questionLabel: "22", exerciseLabel: null, deep: false, ...over,
});
const ctx = { supabase: {} as never, userId: "u" };
const good = (confidence: number, extra: Record<string, unknown> = {}) => ({
  questionSummary: "s", confidence, viewport: { xMin: -3, xMax: 3, yMin: -4, yMax: 4 },
  objects: [{ type: "function", id: "f", expression: "x^3 - 3*x" }], explanation: "e", solutionConnection: "c", ...extra,
});

beforeEach(() => { calls.length = 0; });

describe("model routing", () => {
  it("uses only the fast model when it is confident and valid", async () => {
    responder = () => good(0.95);
    const r = await generateGraphDocument(input(), ctx);
    expect(r.modelUsed).toBe("fast-model");
    expect(r.fallbackReason).toBeNull();
    expect(calls.map((c) => c.model)).toEqual(["fast-model"]);
  });

  it("escalates on low confidence and records the reason", async () => {
    responder = (m) => good(m === "fast-model" ? 0.4 : 0.9);
    const r = await generateGraphDocument(input(), ctx);
    expect(r.modelUsed).toBe("reasoning-model");
    expect(r.fallbackReason).toMatch(/low confidence/);
    expect(calls.at(-1)?.fallbackReason).toMatch(/low confidence/);
  });

  it("escalates when the fast model asks for it", async () => {
    responder = (m) => good(0.9, { needsReasoningFallback: m === "fast-model" });
    expect((await generateGraphDocument(input(), ctx)).fallbackReason).toMatch(/requested escalation/);
  });

  it("escalates when objects fail validation even after repair", async () => {
    responder = (m, task) => task === "repair_graph_object" ? { object: null }
      : m === "fast-model" ? good(0.9, { objects: [{ type: "function", id: "f", expression: "x^^3" }] }) : good(0.9);
    const r = await generateGraphDocument(input(), ctx);
    expect(r.fallbackReason).toMatch(/validation failed/);
    expect(r.document.objects).toHaveLength(1);
    expect(calls.some((c) => c.task === "repair_graph_object")).toBe(true);
  });

  it("goes straight to the reasoning model for Deep Analysis and locus problems", async () => {
    responder = () => good(0.9);
    expect((await generateGraphDocument(input({ deep: true }), ctx)).fallbackReason).toBe("user selected Deep Analysis");
    calls.length = 0;
    const r = await generateGraphDocument(input({ questionText: "Find the locus of the midpoint of chords" }), ctx);
    expect(calls.map((c) => c.model)).toEqual(["reasoning-model"]);
    expect(r.fallbackReason).toMatch(/locus/);
  });
});
