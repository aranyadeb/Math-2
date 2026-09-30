// End-to-end smoke test of the whole app in Chromium, against the local
// test-only backend (fake Supabase + scripted Gemini). Usage: npm run test:e2e
// Screenshots are written to e2e-artifacts/.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3210);
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 54329);
const BASE = `http://localhost:${APP_PORT}`;
const OUT = "e2e-artifacts";
mkdirSync(OUT, { recursive: true });
execFileSync("node", ["scripts/e2e/make-test-pdf.mjs", `${OUT}/test-book.pdf`], { stdio: "inherit" });

const procs = [];
const start = (cmd, args, env = {}) => {
  // detached => own process group, so cleanup also stops npx's child (next-server)
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  procs.push(p);
  return p;
};
const cleanup = () => procs.forEach((p) => { try { process.kill(-p.pid, "SIGTERM"); } catch { /* already gone */ } });
process.on("exit", cleanup);

async function waitFor(url, ms = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url, { redirect: "manual" }); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

start("node", ["scripts/e2e/fake-backend.mjs"], { FAKE_PORT: String(FAKE_PORT) });
const useBuild = existsSync(".next/BUILD_ID") && process.env.E2E_DEV !== "1";
start("npx", ["next", useBuild ? "start" : "dev", "-p", String(APP_PORT)], {
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${FAKE_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key-for-local-e2e-only",
  GEMINI_API_KEY: "fake-key-e2e",
  GEMINI_BASE_URL: `http://localhost:${FAKE_PORT}`,
});
await waitFor(`http://localhost:${FAKE_PORT}/__db`);
await waitFor(`${BASE}/login`);
if (useBuild) console.log("note: `next start` inlines NEXT_PUBLIC_* at build time — build with the fake env for E2E, or set E2E_DEV=1");

const failures = [];
const check = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures.push(msg); };

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png` });

try {
  // Sign in (OTP code)
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 180_000 });
  check(page.url().includes("/login"), "unauthenticated users are sent to /login");
  await page.fill("#email", "student@example.com");
  await page.click("button[type=submit]");
  await page.fill("#code", "123456");
  await page.click('button:has-text("Verify code")');
  await page.waitForURL(`${BASE}/`, { timeout: 60_000 });
  await shot("01-dashboard");

  // Add book + import (PDF.js in the browser, WebP upload)
  await page.goto(`${BASE}/books`, { waitUntil: "networkidle" });
  await page.setInputFiles("#pdf", `${OUT}/test-book.pdf`);
  await page.waitForSelector("text=8 pages", { timeout: 60_000 });
  await page.fill("#title", "Cengage Calculus");
  await page.click('button:has-text("Continue to import")');
  await page.waitForURL(/\/import$/);
  await page.click('button:has-text("Start")');
  await page.waitForSelector("text=8 / 8 pages", { timeout: 120_000 });
  await shot("02-import");
  check(true, "PDF imported: 8/8 pages uploaded");

  // Semantic page mapping (AI samples + sequence inference)
  await page.click("text=Next: map page numbers");
  await page.waitForURL(/\/mapping$/);
  await page.click('button:has-text("Detect page numbers")');
  await page.waitForSelector("text=/8\\/8 labelled/", { timeout: 120_000 });
  await page.waitForTimeout(1000);
  const labels = await page.$$eval('input[aria-label^="Page label for PDF page"]', (els) => els.map((e) => e.value));
  check(JSON.stringify(labels) === JSON.stringify(["4.29", "4.30", "4.31", "4.32", "4.33", "4.34", "4.35", "4.36"]), `page map ${labels.join(",")}`);
  check((await page.locator("text=inferred").count()) > 0, "some labels were sequence-inferred (not all AI calls)");
  await shot("03-mapping");

  // Voice → transcription → command → page 4.33 → Q22 → graph
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.click('button[aria-label="Start voice command"]');
  await page.waitForTimeout(2000);
  await page.click('button[aria-label="Stop recording"]');
  await page.waitForURL(/\/graph\//, { timeout: 120_000 });
  await page.waitForSelector(".jxgbox svg", { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const heading = await page.textContent("h1");
  check(/Page 4\.33 · Q22/.test(heading ?? ""), `graph opened for "${heading}"`);
  await shot("04-graph");
  const graphUrl = page.url();

  // Follow-ups: deterministic (math.js) and AI patch
  await page.fill("#cmd-inline", "Show the second derivative too");
  await page.click('button:has-text("Go")');
  await page.waitForSelector("text=/Added f''\\(x\\)/", { timeout: 60_000 });
  check(true, "second derivative added deterministically");
  await page.fill("#cmd-inline", "Explain this geometrically");
  await page.click('button:has-text("Go")');
  await page.waitForSelector("text=/slope of the tangent/", { timeout: 60_000 });
  check(true, "AI follow-up reply shown");
  await page.waitForTimeout(1500); // autosave
  await shot("05-followups");

  // Question the AI can't find → manual crop → graph
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.fill("#cmd-hero", "4.33 Q23");
  await page.click('button:has-text("Go")');
  await page.waitForURL(/\/page\//, { timeout: 60_000 });
  await page.waitForSelector('img[alt^="Textbook page"]');
  await page.evaluate(() => window.scrollBy(0, 520));
  await page.waitForTimeout(300);
  const b = await (await page.$('img[alt^="Textbook page"]')).boundingBox();
  await page.mouse.move(b.x + b.width * 0.08, b.y + b.height * 0.555);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.92, b.y + b.height * 0.595, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('button:has-text("Save & graph")');
  await page.waitForURL(/\/graph\//, { timeout: 120_000 });
  check(/Q23/.test((await page.textContent("h1")) ?? ""), "manual crop → graph for Q23");

  // Untrusted labels must render as text, never HTML
  await page.goto(`${BASE}/lab`, { waitUntil: "networkidle" });
  await page.selectOption("[data-testid=fixture]", "Safety check: hostile labels");
  await page.waitForTimeout(1200);
  const xss = await page.evaluate(() => ({ fired: "__xss" in window, imgs: document.querySelectorAll("main img").length, shown: document.body.innerText.includes("<img src=x") }));
  check(!xss.fired && xss.imgs === 0 && xss.shown, `hostile labels rendered as inert text ${JSON.stringify(xss)}`);

  // History search + cross-device restore (fresh context, phone, dark)
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle" });
  await page.fill("#hs", "4.33 q22");
  await page.waitForTimeout(1200);
  check((await page.locator("main li").count()) === 1, "history search '4.33 q22' finds one graph");
  await shot("06-history");

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await phone.addCookies(await ctx.cookies());
  const m = await phone.newPage();
  m.on("pageerror", (e) => errors.push(e.message));
  await m.goto(graphUrl, { waitUntil: "networkidle" });
  await m.waitForSelector(".jxgbox svg", { timeout: 60_000 });
  await m.evaluate(() => document.querySelector("[role=tablist]")?.scrollIntoView({ block: "center" }));
  await m.click('role=tab[name=/Supporting/]', { timeout: 15_000 });
  check((await m.locator("text=/f''\\(x\\)/").count()) > 0, "device B restores follow-up objects");
  const width = await m.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth));
  check(width <= 391, `no horizontal overflow at 390px (layout width ${width})`);
  await m.screenshot({ path: `${OUT}/07-phone.png`, fullPage: true });
  check(errors.length === 0, `no uncaught page errors ${errors.join(" | ")}`);
} catch (e) {
  failures.push(String(e));
  console.error(e);
  await shot("failure").catch(() => {});
} finally {
  await browser.close();
  cleanup();
}
console.log(failures.length ? `\n${failures.length} E2E check(s) failed` : "\nAll E2E checks passed");
process.exit(failures.length ? 1 : 0);
