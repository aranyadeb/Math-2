import { describe, it, expect } from "vitest";
import { resolvePageReferenceInMemory, type PageRecordLite } from "@/lib/books/page-resolver";
import { spokenToLabelCandidates, parseChapterReference, compareLabels } from "@/lib/books/page-label";

const pages = (labels: string[], start = 185): PageRecordLite[] =>
  labels.map((l, i) => ({ id: `p${start + i}`, pdf_page_index: start + i, page_label: l, chapter_label: l.includes(".") ? l.split(".")[0] : null }));

describe("page-label", () => {
  it("keeps labels as strings", () => {
    expect(spokenToLabelCandidates("4.33")).toEqual(["4.33"]);
    expect(spokenToLabelCandidates("233")).toEqual(["233"]);
    expect(spokenToLabelCandidates("4.30")).toEqual(["4.30"]); // not 4.3
    expect(spokenToLabelCandidates("xiv")).toEqual(["xiv"]);
  });
  it("parses spoken numbers", () => {
    expect(spokenToLabelCandidates("four point thirty three")).toEqual(["4.33"]);
    expect(spokenToLabelCandidates("four thirty three").sort()).toEqual(["4.33", "433"]);
    expect(spokenToLabelCandidates("thirty three")).toEqual(["33"]);
    expect(spokenToLabelCandidates("two hundred thirty three")).toEqual(["233"]);
  });
  it("parses chapter references", () => {
    expect(parseChapterReference("chapter four")).toBe("4");
    expect(parseChapterReference("4")).toBe("4");
  });
  it("sorts labels numerically without floats", () => {
    expect(["4.10", "4.9", "4.2"].sort(compareLabels)).toEqual(["4.2", "4.9", "4.10"]);
  });
});

describe("resolvePageReference", () => {
  it("Case 1: exact explicit label", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "4.33" }, pages(["4.32", "4.33", "4.34"]));
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.label).toBe("4.33");
  });
  it("Case 2: integer labels remain integers", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "233" }, pages(["232", "233", "2.33"]));
    expect(r.status === "resolved" && r.label).toBe("233");
  });
  it("Case 3: spoken four thirty three with only 4.33", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "four thirty three" }, pages(["4.32", "4.33"]));
    expect(r.status === "resolved" && r.label).toBe("4.33");
  });
  it("Case 4: ambiguous when both 433 and 4.33 exist", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "four thirty three" }, [...pages(["4.33"]), ...pages(["433"], 500)]);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates.map((c) => c.label).sort()).toEqual(["4.33", "433"]);
  });
  it("Case 5: chapter context", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "thirty three", chapterReference: "4" }, pages(["4.33"]));
    expect(r.status === "resolved" && r.label).toBe("4.33");
  });
  it("chapter four page thirty three (words)", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "thirty three", chapterReference: "chapter four" }, [...pages(["33"], 40), ...pages(["4.33"])]);
    expect(r.status === "resolved" && r.label).toBe("4.33");
  });
  it("Acceptance 91: page 4.33 -> PDF 187, never 433", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "4.33" }, pages(["4.31", "4.32", "4.33", "4.34"]));
    expect(r.status === "resolved" && r.page.pdf_page_index).toBe(187);
  });
  it("not found lists tried labels", () => {
    const r = resolvePageReferenceInMemory({ pageReference: "9.99" }, pages(["4.33"]));
    expect(r.status).toBe("not_found");
  });
  it("uses aliases", () => {
    const p = pages(["4.33"]);
    const r = resolvePageReferenceInMemory({ pageReference: "intro page" }, p, [{ alias: "intro page", book_page_id: p[0].id }]);
    expect(r.status === "resolved" && r.via).toBe("alias");
  });
});
