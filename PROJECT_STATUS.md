# Project status

## Completed
- **Foundation.** Next.js 15, React 19, TypeScript, Tailwind v4, light and dark themes. Supabase SSR auth (magic link and email OTP) with middleware gating. Security headers.
- **Database.** Deterministic migration with all tables from the spec plus `ai_usage`. Indexes include `(book_id, pdf_page_index)`, `(book_id, page_label)` and `(book_id, chapter_label)`, plus full-text search over sessions. RLS on every table, ownership triggers, private buckets with per-user folder policies.
- **Book import.**
  - PDF.js legacy build (polyfilled for mobile Safari and Android).
  - Pages render 1–4 at a time, sized to the device's cores and memory.
  - Compressed to WebP, with a JPEG fallback when the browser can't encode WebP, plus separate thumbnails.
  - Economy, Balanced and High clarity presets, with a storage estimator.
  - Resumable: already-uploaded pages are skipped. Pause, resume, retry failed pages, progress and failure counts. Recovers after a refresh once the same file is picked again, checked by file name, size and page count.
  - Page labels embedded in the PDF itself are imported when present.
- **Semantic mapping.**
  - Gemini reads the header and footer strips of sampled pages. It retries on the full page when unsure and never invents a label.
  - Sampling and gap probing, sequence inference (integers, chapter.page and roman numerals, resetting per chapter), and a fixed deterministic set of inferred pages sent back for verification.
  - Duplicate-label detection and a review queue.
  - Mapping screen with a virtualised table, thumbnails, label and chapter editing, verify, re-detect, bulk patterns and a link to the full page. Manual edits are authoritative.
- **Page resolver.** Deterministic and tested, covering exact matches, integers, spoken numbers, ambiguity and chapter context, plus aliases.
- **Voice.** MediaRecorder capture, then Gemini transcription with a maths vocabulary and code-switching hints. Audio is never stored.
- **Commands.** A deterministic fast path handles common commands. Gemini structured output handles the rest. All intents from the spec are supported, plus `SHOW_ONLY_ESSENTIAL`.
- **Questions.**
  - Found lazily and cached, including when the same number appears under several exercises (you pick one).
  - Questions that continue onto the next page are stitched into one image.
  - Server-side crops with sharp.
  - Manual box drawing and correction (stored as `manually_corrected`) and a reset option.
- **Graph engine.**
  - Versioned `GraphDocument` with upgrade functions, and `GraphPatch`.
  - A safe math.js parser and classifier for typed expressions.
  - Renderers for all 20 object types.
  - Symbolic derivatives, and tangents and normals that handle vertical, horizontal and undefined slopes.
  - Adaptive Simpson integration that reports divergence.
  - Area between curves split at every crossing, with a numeric intersection finder.
  - Inequality regions.
  - Sliders that update the graph live.
  - Draggable integral bounds and tangent points.
- **AI graph pipeline.** JSON → Zod → deterministic fixes (missing sliders) → semantic validation → repair of only the invalid objects (bounded retries) → escalation to the reasoning model. `model_used` and `fallback_reason` are recorded.
- **Persistence.** Autosave with a 1 s debounce plus a save when the page is hidden. Covers viewport, sliders, dragged objects, visibility, user objects and follow-ups. Restoring never calls Gemini again.
- **History.** Search by page, question, exercise, transcript or explanation text, filter by book. Lightweight SVG previews with no board created.
- **Dashboard, graph workspace (desktop and mobile), settings and usage, PWA** (manifest, icons, app-shell service worker), graph lab.

## In progress
- Nothing in progress.

## Externally blocked
- **Real Supabase project and real Gemini API key.** No credentials were available in the build environment. The integrations are complete and the environment variables are validated. The whole flow was run end to end against the local test backend (`npm run test:e2e`) with scripted Gemini replies. It has not yet been run against live Gemini. The first real run should confirm the configured model IDs exist for your key, especially the transcription model name.

## Tests
- `npm test`: 89 unit and integration tests. They cover:
  - page labels and the resolver, including every case in the spec
  - sequence inference
  - command parsing, and the command → resolution acceptance cases
  - parser safety
  - integration, roots, area splitting, derivatives, tangents and normals
  - GraphDocument and GraphPatch schemas, serialisation and restore, versioning
  - the AI validation and repair pipeline, deterministic follow-ups, model routing and escalation
  - sharp image processing
  - SQL migrations and RLS on PGlite
- `npm run test:e2e`: 13 browser checks covering the full user flow, cross-device restore, the 390 px phone layout and HTML injection.
- `npm run lint`, `npm run typecheck` and `npm run build` all pass.

## Known limitations
- Graph previews in History are drawn on the fly as SVG from the saved document. The `graph-previews` bucket exists but isn't used yet.
- Page aliases are resolved but have no UI for adding them. Ambiguous aliases are never added automatically.
- Implicit curves use JSXGraph `implicitcurve`, which can miss very thin features at coarse resolutions. Zooming in re-samples.
- Inequalities support `y ⋚ f(x)` and `x ⋚ g(y)`, not general `F(x,y) ⋚ 0`.
- No offline AI. The service worker caches only the app shell and static assets.
- The cost figures on the Usage screen are estimates from the configured per-token prices.
