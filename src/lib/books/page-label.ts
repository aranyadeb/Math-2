/**
 * Semantic page labels are ALWAYS strings. "4.33" is chapter 4 page 33 in
 * books that number that way — never the decimal 4.33 and never PDF page 433.
 */
export type SemanticPageLabel = string;

const ONES: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Normalise a label for comparison: trim, collapse whitespace, lowercase. Keeps the string nature. */
export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").replace(/^page\s+/i, "").replace(/^p\.?\s*/i, "").toLowerCase();
}

export function isNumericLabel(label: string): boolean {
  return /^\d+$/.test(label);
}

/** "4.33" -> { chapter: "4", page: "33" }; anything else -> null. */
export function splitChapterPageLabel(label: string): { chapter: string; page: string } | null {
  const m = /^([0-9a-z]+)[.\-–]([0-9]+)$/i.exec(label.trim());
  return m ? { chapter: m[1], page: m[2] } : null;
}

type Token = { kind: "num"; value: number; words: number } | { kind: "point" };

/**
 * Tokenise spoken number words. Each token is a "spoken group", e.g.
 * "thirty three" -> one number 33; "four" -> 4; "point"/"dot" -> separator.
 */
function tokenizeSpoken(text: string): Token[] | null {
  const words = text.toLowerCase().replace(/[-,]/g, " ").split(/\s+/).filter(Boolean);
  const out: Token[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (w === "point" || w === "dot" || w === ".") {
      out.push({ kind: "point" });
      i++;
      continue;
    }
    if (/^\d+$/.test(w)) {
      out.push({ kind: "num", value: Number(w), words: 1 });
      i++;
      continue;
    }
    if (w in TENS) {
      let v = TENS[w];
      let n = 1;
      const next = words[i + 1];
      if (next && next in ONES && ONES[next] > 0 && ONES[next] < 10) {
        v += ONES[next];
        n = 2;
      }
      out.push({ kind: "num", value: v, words: n });
      i += n;
      continue;
    }
    if (w in ONES) {
      const next = words[i + 1];
      if (next === "hundred") {
        let v = ONES[w] * 100;
        let j = i + 2;
        if (words[j] === "and") j++;
        const rest = tokenizeSpoken(words.slice(j, j + 2).join(" "));
        if (rest && rest[0]?.kind === "num" && rest[0].value < 100) {
          v += rest[0].value;
          j += rest[0].words;
        }
        out.push({ kind: "num", value: v, words: j - i });
        i = j;
        continue;
      }
      out.push({ kind: "num", value: ONES[w], words: 1 });
      i++;
      continue;
    }
    return null; // unknown word — not a pure spoken number
  }
  return out;
}

/**
 * Produce every plausible string label for a spoken or typed page reference.
 * Candidates are ordered by preference but callers MUST check them against
 * the book's real labels; this function never decides alone.
 *
 * "4.33"               -> ["4.33"]
 * "233"                -> ["233"]
 * "four point thirty three" -> ["4.33"]
 * "four thirty three"  -> ["433", "4.33"]
 * "thirty three"       -> ["33"]
 */
export function spokenToLabelCandidates(input: string): string[] {
  const raw = normalizeLabel(input);
  if (!raw) return [];
  // Explicit written label: keep verbatim (after normalisation).
  if (/^[0-9a-z]+([.\-–][0-9a-z]+)*$/i.test(raw) && /\d|^[ivxlcdm]+$/i.test(raw)) {
    return [raw.replace(/–/g, "-")];
  }
  const tokens = tokenizeSpoken(raw);
  if (!tokens || tokens.length === 0) return [raw];

  const hasPoint = tokens.some((t) => t.kind === "point");
  if (hasPoint) {
    const parts: string[] = [];
    let cur = "";
    for (const t of tokens) {
      if (t.kind === "point") {
        parts.push(cur);
        cur = "";
      } else cur += String(t.value);
    }
    parts.push(cur);
    if (parts.some((p) => p === "")) return [];
    return [parts.join(".")];
  }

  const nums = tokens.filter((t): t is Extract<Token, { kind: "num" }> => t.kind === "num");
  const candidates = new Set<string>();
  if (nums.length === 1) {
    candidates.add(String(nums[0].value));
  } else {
    // Concatenated reading: "four thirty three" -> "433"
    candidates.add(nums.map((n) => String(n.value)).join(""));
    // Chapter.page readings at every split point: "four | thirty three" -> "4.33"
    for (let k = 1; k < nums.length; k++) {
      const left = nums.slice(0, k).map((n) => String(n.value)).join("");
      const right = nums.slice(k).map((n) => String(n.value)).join("");
      candidates.add(`${left}.${right}`);
    }
  }
  return [...candidates];
}

/** Parse a chapter reference such as "4", "four", "chapter 4" into a label string. */
export function parseChapterReference(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.toLowerCase().replace(/^chapter\s+/, "").trim();
  if (!s) return null;
  const c = spokenToLabelCandidates(s);
  return c.length === 1 ? c[0] : s;
}

/** Numeric-aware comparator for sorting labels such as "4.9" < "4.10". Never parses as float. */
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
