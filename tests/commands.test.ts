import { describe, it, expect } from "vitest";
import { quickParse } from "@/lib/commands/quick-parse";
import { ParsedCommand } from "@/lib/commands/schema";
import { resolvePageReferenceInMemory, type PageRecordLite } from "@/lib/books/page-resolver";

describe("quickParse", () => {
  it("parses the compact form", () => {
    const c = quickParse("4.33 Q22")!;
    expect(c.page_reference).toBe("4.33");
    expect(c.question_reference).toBe("22");
    expect(c.intent).toBe("GRAPH_ALL_USEFUL");
  });
  it("keeps labels as strings (4.30 not 4.3)", () => {
    expect(quickParse("4.30 q5")!.page_reference).toBe("4.30");
  });
  it("parses 'Page 4.33, question 22. Show me every useful graph.'", () => {
    const c = quickParse("Page 4.33, question 22. Show me every useful graph.")!;
    expect(c).toMatchObject({ page_reference: "4.33", question_reference: "22", intent: "GRAPH_ALL_USEFUL" });
  });
  it("parses the spoken acceptance command", () => {
    const c = quickParse("Show me every useful graph for page four point thirty three question twenty two.")!;
    expect(c.page_reference).toBe("four point thirty three");
    expect(c.question_reference).toBe("twenty two");
    expect(c.requested_actions).toContain("GRAPH_ALL_USEFUL");
  });
  it("parses page 233 question 14", () => {
    expect(quickParse("page 233 question 14")).toMatchObject({ page_reference: "233", question_reference: "14" });
  });
  it("parses chapter context", () => {
    const c = quickParse("chapter four page thirty three question 2")!;
    expect(c.chapter_reference).toBe("four");
    expect(c.page_reference).toBe("thirty three");
  });
  it("parses follow-ups", () => {
    expect(quickParse("Show the derivative too")!.intent).toBe("SHOW_DERIVATIVE");
    expect(quickParse("show the second derivative")!.intent).toBe("SHOW_SECOND_DERIVATIVE");
    expect(quickParse("Add tangent at x equals 2")).toMatchObject({ intent: "SHOW_TANGENT", x_value: "2" });
    expect(quickParse("add normal at x = -1")).toMatchObject({ intent: "SHOW_NORMAL", x_value: "-1" });
    expect(quickParse("Remove the second derivative")).toMatchObject({ intent: "REMOVE_GRAPH", target: "second derivative" });
    expect(quickParse("Let a vary from minus five to five")).toMatchObject({ intent: "CHANGE_PARAMETER", parameter_name: "a", parameter_min: -5, parameter_max: 5 });
    expect(quickParse("Only show the essential graphs")!.intent).toBe("SHOW_ONLY_ESSENTIAL");
    expect(quickParse("history")!.intent).toBe("OPEN_HISTORY");
  });
  it("returns null for things it doesn't understand (→ Gemini)", () => {
    expect(quickParse("Explain this geometrically")).toBeNull();
    expect(quickParse("Now solve the question analytically")).toBeNull();
  });
  it("schema rejects numeric page labels from the model", () => {
    expect(ParsedCommand.safeParse({ intent: "SHOW_GRAPH", page_reference: 4.33 }).success).toBe(false);
  });
});

describe("integration: command → page resolution", () => {
  const book: PageRecordLite[] = [
    { id: "a", pdf_page_index: 185, page_label: "4.31", chapter_label: "4" },
    { id: "b", pdf_page_index: 186, page_label: "4.32", chapter_label: "4" },
    { id: "c", pdf_page_index: 187, page_label: "4.33", chapter_label: "4" },
    { id: "d", pdf_page_index: 188, page_label: "4.34", chapter_label: "4" },
  ];
  it("Acceptance 91: 'Page 4.33 question 22' → PDF 187, Q22", () => {
    const c = quickParse("Page 4.33 question 22")!;
    const r = resolvePageReferenceInMemory({ pageReference: c.page_reference, chapterReference: c.chapter_reference }, book);
    expect(r.status === "resolved" && r.page.pdf_page_index).toBe(187);
    expect(c.question_reference).toBe("22");
  });
  it("Acceptance 92: spoken 'four point thirty three' → 4.33", () => {
    const c = quickParse("Show me every useful graph for page four point thirty three question twenty two.")!;
    const r = resolvePageReferenceInMemory({ pageReference: c.page_reference }, book);
    expect(r.status === "resolved" && r.label).toBe("4.33");
  });
  it("chapter four page thirty three", () => {
    const c = quickParse("chapter four page thirty three question 1")!;
    const r = resolvePageReferenceInMemory({ pageReference: c.page_reference, chapterReference: c.chapter_reference }, book);
    expect(r.status === "resolved" && r.label).toBe("4.33");
  });
  it("ambiguous four thirty three asks instead of guessing", () => {
    const c = quickParse("page four thirty three question 1")!;
    const r = resolvePageReferenceInMemory({ pageReference: c.page_reference }, [...book, { id: "z", pdf_page_index: 450, page_label: "433", chapter_label: null }]);
    expect(r.status).toBe("ambiguous");
  });
});
