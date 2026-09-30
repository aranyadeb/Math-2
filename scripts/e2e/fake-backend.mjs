// TEST-ONLY local stand-in for Supabase (Auth / PostgREST / Storage subset)
// and Gemini (scripted responses). Used by the end-to-end smoke test so the
// whole app can be exercised without real credentials. Never used in
// production: the app talks to real Supabase/Gemini when configured.
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.FAKE_PORT ?? 54329);
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "student@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };

// ---------------------------------------------------------------- tables
const now = () => new Date().toISOString();
const COLS = {
  profiles: { pk: ["id"], d: { email: null } },
  books: { pk: ["id"], d: { author: null, edition: null, subject: null, source_filename: null, source_size_bytes: null, pdf_page_count: 0, ingestion_status: "pending", page_mapping_status: "pending", image_quality: "balanced", uploaded_bytes: 0, cover_path: null, last_opened_at: null } },
  book_pages: { pk: ["id"], d: { page_label: null, chapter_label: null, chapter_title: null, section_label: null, section_title: null, thumbnail_path: null, size_bytes: null, mapping_source: null, mapping_confidence: null, manually_verified: false, upload_status: "pending", width: null, height: null } },
  page_aliases: { pk: ["id"], d: { source: "manual" } },
  question_cache: { pk: ["id"], d: { exercise_label: null, bbox: null, question_text: null, question_image_path: null, continues_to_next_page: false, continuation_page_ids: null, continuation_bbox: null, confidence: null, manually_corrected: false } },
  voice_queries: { pk: ["id"], d: { book_id: null, parsed_command: null, duration_ms: null, transcription_model: null } },
  graph_sessions: { pk: ["id"], d: { question_cache_id: null, voice_query_id: null, question_label: null, exercise_label: null, transcript: null, fallback_reason: null, ai_explanation: null, ai_solution: null, question_summary: null, confidence: null, last_opened_at: null } },
  graph_messages: { pk: ["id"], d: { structured_payload: null } },
  user_preferences: { pk: ["user_id"], d: { active_book_id: null, graph_preferences: {}, voice_preferences: {}, ui_preferences: {} } },
  ai_usage: { pk: ["id"], d: { input_tokens: null, output_tokens: null, estimated_cost_usd: null, latency_ms: null, fallback: false, fallback_reason: null, success: true, error: null } },
};
const db = Object.fromEntries(Object.keys(COLS).map((t) => [t, []]));
db.profiles.push({ id: USER.id, email: USER.email, created_at: now(), updated_at: now() });
const files = new Map(); // bucket/path -> {buf, type}

function withDefaults(table, row) {
  const c = COLS[table];
  const r = { ...structuredClone(c.d), ...row };
  if (c.pk[0] === "id" && !r.id) r.id = randomUUID();
  if (table !== "profiles" && !("user_id" in row)) r.user_id = USER.id;
  r.created_at ??= now();
  r.updated_at = now();
  if (table === "graph_sessions") r.last_opened_at ??= now();
  return r;
}

// ---------------------------------------------------------------- PostgREST subset
function parseVal(v) {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}
function match(row, key, expr) {
  const neg = expr.startsWith("not.");
  const e = neg ? expr.slice(4) : expr;
  const dot = e.indexOf(".");
  const op = e.slice(0, dot), raw = decodeURIComponent(e.slice(dot + 1));
  const v = row[key];
  let ok;
  switch (op) {
    case "eq": ok = v !== null && v !== undefined && String(v) === raw; break;
    case "neq": ok = String(v) !== raw; break;
    case "is": ok = raw === "null" ? v === null || v === undefined : v === parseVal(raw); break;
    case "gte": ok = v >= raw; break;
    case "lte": ok = v <= raw; break;
    case "ilike": { const re = new RegExp("^" + raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*") + "$", "i"); ok = v != null && re.test(String(v)); break; }
    case "in": ok = raw.replace(/^\(|\)$/g, "").split(",").includes(String(v)); break;
    default:
      if (op.startsWith("wfts") || op.startsWith("fts") || op.startsWith("plfts")) {
        const hay = ["page_label", "question_label", "exercise_label", "original_user_query", "transcript", "ai_explanation", "question_summary"].map((k) => row[k] ?? "").join(" ").toLowerCase();
        ok = raw.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
      } else ok = true;
  }
  return neg ? !ok : ok;
}
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function applyFilters(rows, params) {
  let out = rows.filter((r) => r.user_id === undefined || r.user_id === USER.id || r.id === USER.id); // "RLS"
  for (const [k, v] of params) if (!RESERVED.has(k)) out = out.filter((r) => match(r, k, v));
  return out;
}
function project(rows, select) {
  if (!select || select === "*") return rows;
  const cols = select.split(",").map((s) => s.trim()).filter(Boolean);
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
}
function order(rows, spec) {
  if (!spec) return rows;
  const parts = spec.split(",").map((p) => p.split("."));
  return [...rows].sort((a, b) => {
    for (const [col, dir = "asc", nulls] of parts) {
      const x = a[col], y = b[col];
      if (x === y) continue;
      if (x == null) return nulls === "nullsfirst" ? -1 : 1;
      if (y == null) return nulls === "nullsfirst" ? 1 : -1;
      const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y));
      return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
function send(res, status, data, headers = {}) {
  const isBuf = Buffer.isBuffer(data);
  res.writeHead(status, { "Content-Type": isBuf ? headers["Content-Type"] ?? "application/octet-stream" : "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", ...headers });
  res.end(isBuf ? data : data === undefined ? "" : JSON.stringify(data));
}

async function rest(req, res, table, url) {
  if (!COLS[table]) return send(res, 404, { message: `unknown table ${table}` });
  const params = [...url.searchParams.entries()];
  const prefer = req.headers.prefer ?? "";
  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const finish = (rows, status = 200) => {
    const sel = url.searchParams.get("select");
    const out = project(rows, sel);
    if (single) {
      if (out.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${out.length} rows` });
      return send(res, status, out[0]);
    }
    return send(res, status, prefer.includes("return=representation") || req.method === "GET" ? out : undefined);
  };
  if (req.method === "GET" || req.method === "HEAD") {
    let rows = order(applyFilters(db[table], params), url.searchParams.get("order"));
    const total = rows.length;
    const off = Number(url.searchParams.get("offset") ?? 0), lim = url.searchParams.get("limit");
    rows = rows.slice(off, lim ? off + Number(lim) : undefined);
    const headers = { "Content-Range": `${off}-${off + rows.length - 1}/${total}` };
    if (req.method === "HEAD") { res.writeHead(200, { ...headers, "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range" }); return res.end(); }
    const sel = url.searchParams.get("select");
    const out = project(rows, sel);
    if (single) return out.length === 1 ? send(res, 200, out[0], headers) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
    return send(res, 200, out, headers);
  }
  if (req.method === "POST") {
    const payload = JSON.parse((await body(req)).toString() || "[]");
    const list = Array.isArray(payload) ? payload : [payload];
    const upsert = prefer.includes("resolution=merge-duplicates");
    const conflict = (url.searchParams.get("on_conflict") ?? COLS[table].pk.join(",")).split(",");
    const out = [];
    for (const item of list) {
      if (item.user_id && item.user_id !== USER.id) return send(res, 403, { message: "new row violates row-level security policy" });
      const existing = upsert ? db[table].find((r) => conflict.every((c) => item[c] !== undefined && String(r[c]) === String(item[c]))) : null;
      if (existing) { Object.assign(existing, item, { updated_at: now() }); out.push(existing); }
      else { const r = withDefaults(table, item); db[table].push(r); out.push(r); }
    }
    return finish(out, 201);
  }
  if (req.method === "PATCH") {
    const patch = JSON.parse((await body(req)).toString() || "{}");
    const rows = applyFilters(db[table], params);
    for (const r of rows) Object.assign(r, patch, { updated_at: now() });
    return finish(rows);
  }
  if (req.method === "DELETE") {
    const rows = applyFilters(db[table], params);
    db[table] = db[table].filter((r) => !rows.includes(r));
    if (table === "books") for (const t of ["book_pages", "question_cache", "graph_sessions"]) db[t] = db[t].filter((r) => !rows.some((b) => b.id === r.book_id));
    return finish(rows);
  }
  send(res, 405, { message: "method" });
}

// ---------------------------------------------------------------- Storage subset
async function storage(req, res, rest) {
  const url = new URL(req.url, "http://x");
  let m;
  if (req.method === "POST" && (m = /^object\/sign\/([^/]+)\/(.+)$/.exec(rest))) {
    const key = `${m[1]}/${decodeURIComponent(m[2])}`;
    if (!files.has(key)) return send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
    return send(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=fake` });
  }
  if (req.method === "POST" && (m = /^object\/sign\/([^/]+)$/.exec(rest))) {
    const { paths } = JSON.parse((await body(req)).toString());
    return send(res, 200, paths.map((p) => ({ path: p, error: files.has(`${m[1]}/${p}`) ? null : "not found", signedURL: files.has(`${m[1]}/${p}`) ? `/object/sign/${m[1]}/${p}?token=fake` : null })));
  }
  if (req.method === "GET" && (m = /^object\/(?:sign\/|authenticated\/)?([^/]+)\/(.+)$/.exec(rest))) {
    const f = files.get(`${m[1]}/${decodeURIComponent(m[2])}`);
    if (!f) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    return send(res, 200, f.buf, { "Content-Type": f.type, "Cache-Control": "private, max-age=60" });
  }
  if ((req.method === "POST" || req.method === "PUT") && (m = /^object\/([^/]+)\/(.+)$/.exec(rest))) {
    const path = decodeURIComponent(m[2]);
    if (!path.startsWith(`${USER.id}/`)) return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    const buf = await body(req);
    let data = buf, type = req.headers["content-type"] ?? "application/octet-stream";
    if (type.startsWith("multipart/form-data")) {
      // storage-js sends Blobs as multipart (a cacheControl field, then the file part)
      const boundary = "--" + /boundary=(.+)$/.exec(type)[1];
      const s = buf.toString("latin1");
      const parts = s.split(boundary).slice(1, -1);
      const filePart = parts.find((p) => /Content-Type:/i.test(p.slice(0, p.indexOf("\r\n\r\n")))) ?? parts[parts.length - 1];
      const headerEnd = filePart.indexOf("\r\n\r\n");
      const ct = /Content-Type: ([^\r\n]+)/i.exec(filePart.slice(0, headerEnd));
      data = Buffer.from(filePart.slice(headerEnd + 4, filePart.length - 2), "latin1");
      type = ct ? ct[1] : "application/octet-stream";
    }
    files.set(`${m[1]}/${path}`, { buf: data, type });
    return send(res, 200, { Key: `${m[1]}/${path}`, Id: randomUUID() });
  }
  if (req.method === "DELETE" && (m = /^object\/([^/]+)$/.exec(rest))) {
    const { prefixes } = JSON.parse((await body(req)).toString());
    for (const p of prefixes) files.delete(`${m[1]}/${p}`);
    return send(res, 200, prefixes.map((name) => ({ name })));
  }
  void url;
  send(res, 404, { message: `storage route ${req.method} ${rest}` });
}

// ---------------------------------------------------------------- Auth subset
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, email: USER.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400, session_id: "s1" })}.sig`;
  return { access_token, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "fake-refresh", user: USER };
}
async function auth(req, res, rest) {
  if (rest === "otp") { await body(req); return send(res, 200, {}); }
  if (rest === "verify" || rest.startsWith("token")) { await body(req); return send(res, 200, session()); }
  if (rest === "user") return req.headers.authorization ? send(res, 200, USER) : send(res, 401, { message: "no token" });
  if (rest.startsWith("logout")) return send(res, 204);
  send(res, 404, { message: `auth route ${rest}` });
}

// ---------------------------------------------------------------- Gemini (scripted)
// Fake book: PDF page i shows "4.(28+i)" in its footer; question 22 is on "4.33".
const labelFor = (pdfIndex) => `4.${28 + pdfIndex}`;
function geminiReply(system, text) {
  if (/transcribe short voice commands/.test(system + " " + text)) return "Show me every useful graph for page four point thirty three question twenty two.";
  if (/printed page number/.test(system)) {
    const idx = Number(/PDF page (\d+)/.exec(text)?.[1] ?? 0);
    return JSON.stringify({ visible_page_label: labelFor(idx), chapter_label: "4", chapter_title: "Applications of Derivatives", section_label: null, confidence: 0.97, evidence_region: "bottom-right" });
  }
  if (/locate a specific numbered question/.test(system)) {
    const q = /Find question "([^"]+)"/.exec(text)?.[1];
    if (q !== "22" || !/page "4\.33"/.test(text)) return JSON.stringify({ matches: [] });
    return JSON.stringify({ matches: [{ question_label: "22", exercise_label: "Exercise 4.3", box_2d: [405, 80, 505, 920], continues_to_next_page: false, question_text: "22. Let f(x) = x^3 - 3x. Find the intervals where f is increasing and decreasing, and its local extrema.", confidence: 0.96 }] });
  }
  if (/design the set of graphs/.test(system)) {
    return JSON.stringify({
      questionSummary: "Monotonicity and local extrema of f(x) = x³ − 3x",
      confidence: 0.94,
      needsReasoningFallback: false,
      viewport: { xMin: -3, xMax: 3, yMin: -4, yMax: 4 },
      objects: [
        { type: "function", id: "f", expression: "x^3 - 3*x", displayLatex: "f(x) = x³ − 3x", group: "essential", source: "question" },
        { type: "function", id: "df", expression: "3*x^2 - 3", displayLatex: "f′(x) = 3x² − 3", group: "supporting", source: "derived", derivation: "Derivative of f(x) = x³ − 3x", dashed: true },
        { type: "intersection_marker", id: "crit", refA: "df", group: "supporting", source: "derived", derivation: "Critical points: f′(x) = 0" },
        { type: "point", id: "max", x: -1, y: 2, label: "local max (−1, 2)", group: "essential", source: "derived", derivation: "f(−1) = 2" },
        { type: "point", id: "min", x: 1, y: -2, label: "local min (1, −2)", group: "essential", source: "derived", derivation: "f(1) = −2" },
        { type: "tangent", id: "tan", functionRef: "f", at: 1, draggable: true, group: "exploration", source: "derived", derivation: "Drag to see the slope change sign" },
      ],
      explanation: "The solid curve is f(x) = x³ − 3x. The dashed curve is its derivative f′(x) = 3x² − 3, which is zero at x = −1 and x = 1 (marked). Where f′ is positive (x < −1 or x > 1) f is increasing; where f′ is negative (−1 < x < 1) f is decreasing. Drag the tangent point to watch the slope change sign exactly at the critical points.",
      solutionConnection: "f′ changes sign from + to − at x = −1 (local maximum 2) and from − to + at x = 1 (local minimum −2).",
      solution: null,
    });
  }
  if (/modify an existing interactive graph/.test(system)) {
    return JSON.stringify({ operations: [], reply: "Geometrically, f′(x) is the slope of the tangent. The slope is zero at the turning points x = ±1, positive outside them and negative between them — which is why f rises, falls, then rises again.", confidence: 0.9 });
  }
  if (/convert a user's command/.test(system)) {
    return JSON.stringify({ intent: "EXPLAIN", page_reference: null, chapter_reference: null, exercise_reference: null, question_reference: null, book_reference: null, requested_actions: ["EXPLAIN"], x_value: null, parameter_name: null, parameter_min: null, parameter_max: null, expression: null, target: null, deep_analysis: false });
  }
  return JSON.stringify({});
}
async function gemini(req, res) {
  const b = JSON.parse((await body(req)).toString());
  const system = (b.systemInstruction?.parts ?? []).map((p) => p.text ?? "").join(" ") + (b.systemInstruction?.text ?? "");
  const text = (b.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? "").join("\n");
  const out = geminiReply(system, text);
  send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text: out }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 800 + text.length, candidatesTokenCount: out.length / 4 | 0, totalTokenCount: 0 } });
}

// ---------------------------------------------------------------- server
http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Expose-Headers": "Content-Range" });
      return res.end();
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    if (p.startsWith("/rest/v1/")) return await rest(req, res, p.slice(9), url);
    if (p.startsWith("/storage/v1/")) return await storage(req, res, p.slice(12));
    if (p.startsWith("/auth/v1/")) return await auth(req, res, p.slice(9));
    if (/generateContent$/.test(p)) return await gemini(req, res);
    if (p === "/__db") return send(res, 200, Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length])));
    send(res, 404, { message: `no route ${p}` });
  } catch (e) {
    console.error(e);
    send(res, 500, { message: String(e) });
  }
}).listen(PORT, () => console.log(`fake backend on :${PORT}`));
