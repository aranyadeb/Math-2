import { spokenToLabelCandidates } from "../books/page-label";
import { emptyCommand, type Intent, type ParsedCommand } from "./schema";

/**
 * Deterministic fast path for common typed/spoken commands so ordinary
 * requests ("4.33 Q22", "page 4.33 question 22 show all graphs",
 * "show the derivative") need no AI call. Returns null when unsure —
 * the caller then uses the Gemini command parser.
 */
const NUMWORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|and|point|dot)";
const LABEL = `([0-9]+(?:[.\\-][0-9]+)*[a-z]?|[ivxlcdm]+|${NUMWORD}(?:[\\s-]+${NUMWORD})*)`;

const SMALLNUM = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point)";
const NUM = `(?:minus\\s+|negative\\s+|-)?(?:[0-9]+(?:\\.[0-9]+)?|${SMALLNUM}(?:\\s+${SMALLNUM})*)`;

/** "minus five" -> -5, "two point five" -> 2.5, "3" -> 3. */
export function spokenNumber(s: string): number | null {
  const t = s.trim().toLowerCase();
  const neg = /^(minus|negative)\s+|^-/.test(t);
  const body = t.replace(/^(minus|negative)\s+|^-/, "");
  let v: number;
  if (/^[0-9]+(\.[0-9]+)?$/.test(body)) v = Number(body);
  else {
    const c = spokenToLabelCandidates(body);
    if (c.length !== 1 || !/^[0-9]+(\.[0-9]+)?$/.test(c[0])) return null;
    v = Number(c[0]);
  }
  return neg ? -v : v;
}

function actionIntents(t: string): Intent[] {
  const a: Intent[] = [];
  if (/\b(every|all)\b.*\bgraphs?\b|\buseful graphs?\b|\ball graphs\b/.test(t)) a.push("GRAPH_ALL_USEFUL");
  if (/\bsecond derivative\b|f''|f double prime/.test(t)) a.push("SHOW_SECOND_DERIVATIVE");
  else if (/\bderivative\b|f'\(|f prime/.test(t)) a.push("SHOW_DERIVATIVE");
  if (/\btangent\b/.test(t)) a.push("SHOW_TANGENT");
  if (/\bnormal\b/.test(t)) a.push("SHOW_NORMAL");
  if (/\barea between\b/.test(t)) a.push("SHOW_AREA");
  else if (/\bintegral\b|\barea under\b/.test(t)) a.push("SHOW_INTEGRAL");
  if (/\bintersect(ion|ions|s)?\b|\bwhere .* meet\b/.test(t)) a.push("SHOW_INTERSECTION");
  if (/\bsolve\b|\bsolution\b/.test(t)) a.push("SOLVE");
  if (/\bexplain\b/.test(t)) a.push("EXPLAIN");
  if (/\bonly (show )?(the )?essential\b/.test(t)) a.push("SHOW_ONLY_ESSENTIAL");
  return a;
}

export function quickParse(input: string): ParsedCommand | null {
  const t = input.toLowerCase().replace(/[“”"]/g, "").replace(/[?!]+$/g, "").trim();
  if (!t) return null;

  if (/^(open |show )?(my )?history$/.test(t)) return { ...emptyCommand("OPEN_HISTORY") };

  // "4.33 Q22", "4.33/22", "p 4.33 q 22"
  const m = /^(?:p(?:age|g)?\.?\s*)?([0-9]+(?:[.\-][0-9]+)*|[ivxlcdm]+)\s*(?:[,/]\s*|\s+)(?:q(?:uestion|n)?\.?\s*|#)?([0-9]+[a-z]?(?:\s*\([a-z0-9]+\))?)$/.exec(t);
  if (m && /q|#|\/|,|\s/.test(t)) {
    return { ...emptyCommand("GRAPH_ALL_USEFUL"), page_reference: m[1], question_reference: m[2].replace(/\s+/g, ""), requested_actions: ["GRAPH_ALL_USEFUL"] };
  }

  // "... page <label> ... question <n> ..."
  const pageRe = new RegExp(`\\bpage\\s+(?:number\\s+)?${LABEL}`);
  const qRe = new RegExp(`\\b(?:question|q|problem|number)\\.?\\s*(?:number\\s+)?([0-9]+[a-z]?|${NUMWORD}(?:[\\s-]+${NUMWORD})*)\\b`);
  const chapRe = new RegExp(`\\bchapter\\s+${LABEL}`);
  const exRe = /\bexercise\s+([0-9a-z]+(?:\.[0-9a-z]+)*)\b/;

  const pm = pageRe.exec(t);
  if (pm) {
    let page = pm[1].trim();
    // strip trailing filler words that the lazy regex may have captured
    page = page.replace(/\s+(and|question.*)$/, "").trim();
    const qm = qRe.exec(t.slice(pm.index + pm[0].length)) ?? qRe.exec(t);
    const cm = chapRe.exec(t);
    const em = exRe.exec(t);
    const actions = actionIntents(t);
    const intent: Intent = actions[0] ?? (qm ? "GRAPH_ALL_USEFUL" : "OPEN_PAGE");
    // Spoken number words for question -> digits handled by the resolver's number parser later; keep as spoken if not digits.
    return {
      ...emptyCommand(intent),
      page_reference: page,
      chapter_reference: cm && cm.index < pm.index ? cm[1].trim() : null,
      exercise_reference: em ? em[1] : null,
      question_reference: qm ? qm[1].trim() : null,
      requested_actions: actions.length ? actions : qm ? ["GRAPH_ALL_USEFUL"] : [],
      deep_analysis: /\bdeep analysis\b|\bthink hard\b/.test(t),
    };
  }

  // Follow-ups without page reference
  const actions = actionIntents(t);
  const tangentAt = new RegExp(`\\b(tangent|normal)\\b.*?\\bx\\s*(?:=|equals|is)\\s*(${NUM})`).exec(t);
  if (tangentAt) {
    const x = spokenNumber(tangentAt[2]);
    if (x !== null) {
      const intent: Intent = tangentAt[1] === "tangent" ? "SHOW_TANGENT" : "SHOW_NORMAL";
      return { ...emptyCommand(intent), x_value: String(x), requested_actions: [intent] };
    }
  }
  const remove = /^(remove|hide|delete)\s+(the\s+)?(.+)$/.exec(t);
  if (remove) return { ...emptyCommand("REMOVE_GRAPH"), target: remove[3], requested_actions: ["REMOVE_GRAPH"] };
  const range = new RegExp(`\\b(?:let\\s+)?([a-z])\\s+(?:vary|range|go)\\s+from\\s+(${NUM})\\s+to\\s+(${NUM})`).exec(t);
  if (range) {
    const lo = spokenNumber(range[2]), hi = spokenNumber(range[3]);
    if (lo !== null && hi !== null && hi > lo) {
      return { ...emptyCommand("CHANGE_PARAMETER"), parameter_name: range[1], parameter_min: lo, parameter_max: hi, requested_actions: ["CHANGE_PARAMETER"] };
    }
  }
  const slider = /\badd (?:a )?slider (?:for )?([a-z])\b/.exec(t);
  if (slider) return { ...emptyCommand("CHANGE_PARAMETER"), parameter_name: slider[1], requested_actions: ["CHANGE_PARAMETER"] };
  if (actions.length === 1 && ["SHOW_DERIVATIVE", "SHOW_SECOND_DERIVATIVE", "SHOW_ONLY_ESSENTIAL", "SHOW_INTERSECTION"].includes(actions[0])) {
    return { ...emptyCommand(actions[0]), requested_actions: actions };
  }
  return null;
}
