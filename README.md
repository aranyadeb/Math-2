# Textbook Graphs

Ask your maths textbook to show you the mathematics.

Open the app → pick a book → tap the microphone → say *“Page 4.33, question 22. Show me every useful graph.”* The app finds the right page of the scanned textbook, locates question 22, has Gemini read the question, and draws interactive graphs with JSXGraph. It also writes an explanation and saves everything, so the same graph opens later on any device.

It's a private, single-user app built with Next.js, Supabase and Google Gemini. It doesn't need a graphing API key: JSXGraph runs entirely in the browser.

## How it works

```
mic ─▶ /api/voice/transcribe (Gemini transcribe model; audio is never stored)
     ─▶ /api/command
          ├─ quick deterministic parser, or Gemini fast model with structured output
          ├─ active book ─▶ page resolver over the semantic page map ─▶ book_pages
          ├─ question_cache hit? ─▶ else Gemini finds the question box (with continuation)
          ├─ question crop (sharp) ─▶ Gemini returns a declarative GraphSpec, never code
          ├─ Zod ─▶ semantic validation ─▶ repair only the invalid objects ─▶ escalate model
          └─ graph_sessions row ─▶ /graph/[id]
/graph/[id]: JSXGraph renderer, sliders, autosave (1 s debounce), follow-ups (patches)
```

| Area | Where |
|---|---|
| Semantic page labels, resolver, sequence inference | `src/lib/books/page-label.ts`, `page-resolver.ts`, `page-resolver-db.ts`, `sequence-inference.ts`, `mapping-service.ts` |
| Client-side PDF ingestion (PDF.js, WebP, resumable) | `src/lib/books/ingestion.ts`, `image-compression.ts` |
| Gemini (server only) | `src/lib/ai/*`: `client.ts`, `models.ts`, `prompts.ts`, `transcribe.ts`, `parse-command.ts`, `detect-page-label.ts`, `detect-question.ts`, `generate-graph-document.ts`, `patch-graph-document.ts`, `repair-graph-object.ts` |
| Command pipeline | `src/lib/commands/*`, `src/lib/pipeline/run-command.ts`, `followup.ts` |
| Graph document and schema | `src/lib/graph/schema.ts` (versioned `GraphDocument`, `GraphPatch`), `versioning.ts`, `validation.ts`, `serializer.ts` |
| Safe maths | `src/lib/graph/parser.ts` (math.js with a whitelist, no `eval`), `math/derivative.ts`, `integrate.ts` (adaptive Simpson), `intersections.ts`, `area-between.ts`, `sampling.ts` |
| Rendering | `src/lib/graph/renderer.ts` plus `renderers/{curves,points-lines,calculus}.ts` |
| UI | `src/app/*` pages, `src/components/*` |
| Database | `supabase/migrations/*.sql` |

### The key data rule

A PDF page index, the printed page label, the chapter, the section, the exercise and the question number are all separate things. They're stored in separate columns and never merged. Page labels are always **text**:
- `"4.33"` means chapter 4, page 33.
- It is never PDF page 433.
- It is never the decimal 4.33.

`"4.30"` stays `"4.30"`.

The resolver (`resolvePageReference`) is deterministic:
1. An exact label wins.
2. `"233"` stays `"233"`.
3. Chapter context turns “chapter four page thirty three” into `"4.33"`.
4. A spoken “four thirty three” resolves only when exactly one of `433` or `4.33` exists. If both exist, the app asks which one you meant instead of guessing.

### Graph documents

Gemini returns declarative JSON only, never JSXGraph code. Each object has a `type` and records where it came from with `source: question | derived | user`. The follow-up `derivation` field explains how a derived object was obtained.

Supported object types:
- function, implicit_curve, parametric_curve, polar_curve
- point, movable_point
- line, segment, ray, vertical_line, horizontal_line
- tangent, normal
- integral, area_between_curves, inequality_region
- slider
- text_annotation, intersection_marker, asymptote

Other rules:
- Objects are grouped into **essential / supporting / exploration**.
- Follow-ups return patches (`add`, `remove`, `update`, `set_visibility`, `set_group_visibility`, `set_slider`, `set_viewport`). A patch never touches objects you created unless you explicitly ask.
- These follow-ups run in code, with no AI call:
  - derivatives and second derivatives (math.js)
  - tangent or normal at x = a
  - intersections
  - removals
  - “only essential”
  - slider ranges

### Model routing and cost

The model IDs are configuration values: `GEMINI_FAST_MODEL`, `GEMINI_REASONING_MODEL` and `GEMINI_TRANSCRIBE_MODEL`.

The fast model is tried first. The request moves to the reasoning model when:
- the fast model's confidence is below `GEMINI_ESCALATION_CONFIDENCE`
- the fast model asks for escalation
- objects still fail validation after targeted repair
- the problem involves loci or families of curves
- the user turns on **Deep Analysis**

`model_used` and `fallback_reason` are saved on each graph session. Every Gemini call writes a row to `ai_usage` with tokens, estimated cost, latency and fallback status. **Settings → Usage** shows the totals.

These are cached:
- the page map
- question boxes, crops and text
- repeated identical queries on the same question, which reopen the saved session instead of calling Gemini again

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

Requires Node 20 or newer (tested with Node 22).

### 2. Supabase

1. Create a Supabase project.
2. Apply the migrations. Either run `supabase db push` with the Supabase CLI linked to your project, or paste `supabase/migrations/20260930000001_init.sql` into the SQL editor and run it.

The migration creates:
- all tables and indexes
- `updated_at` triggers and ownership triggers
- **RLS on every table** (`user_id = auth.uid()`)
- the **private** storage buckets `book-pages`, `question-crops` and `graph-previews`
- storage policies that limit each user to their own `<user_id>/…` folder

3. Under **Auth → Providers**, enable Email. Under **Auth → URL Configuration**, add `http://localhost:3000/auth/callback` and your production `https://…/auth/callback` to the redirect URLs.
4. Optional: to sign in with a typed code as well as the magic link, add `{{ .Token }}` to the Magic Link email template.
5. Copy the project URL and anon key into `.env.local`. The app doesn't use the service-role key. It's listed only for admin scripts and must never be exposed to the browser.

### 3. Gemini

Create an API key in Google AI Studio and set `GEMINI_API_KEY`. You can change the model IDs through the environment at any time.

### 4. Environment

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | no | server-only; not used by the app |
| `GEMINI_API_KEY` | yes | server-only |
| `GEMINI_FAST_MODEL` | no | default `gemini-3.1-flash-lite` |
| `GEMINI_REASONING_MODEL` | no | default `gemini-3.8-flash` |
| `GEMINI_TRANSCRIBE_MODEL` | no | default `gemini-3.5-transcribe` |
| `GEMINI_ESCALATION_CONFIDENCE` | no | default `0.7` |
| `GEMINI_*_PRICE_IN/OUT` | no | USD per 1M tokens, used for the cost estimate |
| `GEMINI_BASE_URL` | no | API base URL override (proxies, local E2E backend) |

No Desmos, GeoGebra or Plotly key is used.

## Commands

```bash
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test           # unit + integration: resolver, parser, maths, schemas, AI pipeline, model routing, migrations/RLS (PGlite)
npm run test:e2e   # full browser flow against a local test-only backend (needs Playwright's Chromium)
npm run build && npm start
```

`npm run test:e2e` starts two things:
- `scripts/e2e/fake-backend.mjs`: a local stand-in for Supabase Auth, PostgREST and Storage, plus scripted Gemini replies
- the app, pointed at that backend

It then drives the whole flow in Chromium: sign-in → PDF import → page mapping → voice command → graph → follow-ups → manual crop → history → restore on a second “device” at phone size. It also checks that untrusted labels can't inject HTML. Screenshots go to `e2e-artifacts/`. The fake backend is test infrastructure only. The app always uses real Supabase and Gemini when they're configured.

## Deployment (Vercel)

1. Import the repository and set the environment variables above.
2. The API routes use the Node runtime (needed for `sharp`). Long AI routes set `maxDuration` (60–120 s), so use a plan that allows it.
3. PDFs are **never** uploaded through a server request. The browser renders pages with PDF.js and uploads compressed WebP images straight to private Supabase Storage.

## Using the app

1. Sign in with a magic link or a one-time code.
2. **Books → Add a book.** Choose the scanned PDF and a quality preset (Economy, Balanced or High clarity). The app estimates the storage size first. You can pause and resume the import. After a refresh, pick the same file again and the import continues where it stopped.
3. **Page mapping.** Gemini reads only the header and footer strips of sampled pages. Obvious runs are filled by sequence inference (marked `inferred`). You only need to check the pages flagged **Needs review**. You can edit labels, apply a pattern such as “PDF 157–190 starts at 4.1”, verify pages or re-run detection. Manual edits always win.
4. **Ask.** Tap the mic, or type `4.33 Q22`.
   - If the AI can't find the question, the page opens and you draw a box around it. Your box is kept and reused.
   - Follow-ups include “show the derivative too”, “add tangent at x equals 2”, “let a vary from minus five to five”, “only show the essential graphs” and “explain this geometrically”.
5. **History** restores the saved graph exactly as you left it: objects, viewport, slider values, visibility, explanation and transcript. It doesn't call Gemini again.
6. **Graph lab** is a scratch graphing page with no book and no AI. It includes the spec's example cases.

## Security notes

- RLS is enabled on every table. Ownership triggers stop anyone attaching rows to another user's book or session. `tests/migration-rls.test.ts` checks this on a real Postgres engine.
- Storage buckets are private and the app only uses short-lived signed URLs. Object paths are prefixed with the owner's user ID, and the storage policies enforce that prefix.
- `GEMINI_API_KEY` and the service-role key are only read in server code (`server-only` modules).
- Model output is treated as untrusted:
  - It is validated with strict Zod schemas.
  - Expressions are parsed by math.js against a whitelist of functions, symbols and syntax. `eval` and `new Function` are never used.
  - The model never produces JavaScript.
  - Explanations render as React-escaped text.
  - JSXGraph labels and text are forced to plain SVG text (`display: "internal"`, `parse: false`).
- Security headers are set in `next.config.ts`, and microphone access is limited to this site.

## Known limitations

See `PROJECT_STATUS.md`.
