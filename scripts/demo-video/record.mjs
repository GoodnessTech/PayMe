// Record PayMe demo clips on the LIVE site with Playwright.
//
// Why not Playwright's built-in recordVideo: it encodes at a low fixed bitrate
// (blurry when zoomed). Instead we use Chrome's screencast (CDP) to capture
// crisp 2560x1440 JPEG frames with timestamps and assemble a constant-30fps
// H.264 clip with ffmpeg. A visible cursor is injected into the page; mouse
// moves and typing run at human speed; every step waits for real UI state.
//
// Usage: node record.mjs [clipName ...]   (default: all clips)
// Output: public/clips/<name>.mp4 + public/clips/<name>.json (event marks),
//         public/shots/*.png (high-res stills for zoom shots)

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const LIVE = "https://payme-opal.vercel.app";
const ROOT = resolve(".");
const CLIPS = join(ROOT, "public", "clips");
const SHOTS = join(ROOT, "public", "shots");
const DOCS_SHOTS = resolve("../../docs/screenshots");
const VIEW = { width: 1440, height: 810 }; // CSS px; DSF makes frames 2560x1440
const DSF = 2560 / 1440;
const invoice = JSON.parse(readFileSync(resolve("../../demo-output/demo-invoice.json"), "utf8"));
const INVOICE_TEXT = "Invoice to Acme Ltd for logo design, $5, due November 30, 2026. Payment to payme-freelancer-demo.testnet.";
const ffmpeg = findFfmpeg();

mkdirSync(CLIPS, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ------------------------------------------------------------------ cursor

const CURSOR_SCRIPT = `
(() => {
  if (window.__demoCursor) return;
  window.__demoCursor = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.2 3.9 7.5-3.1 1.6-3.9-7.6L4 20z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', width: '26px', height: '26px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))', transition: 'none' });
    document.documentElement.appendChild(c);
    const pos = window.__demoCursorPos || { x: 720, y: 405 };
    c.style.left = pos.x + 'px'; c.style.top = pos.y + 'px';
    document.addEventListener('mousemove', (e) => { window.__demoCursorPos = { x: e.clientX, y: e.clientY }; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: (e.clientX - 18) + 'px', top: (e.clientY - 18) + 'px', width: '36px', height: '36px', borderRadius: '50%', border: '3px solid rgba(183,240,161,.95)', background: 'rgba(183,240,161,.25)', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out', transform: 'scale(.4)', opacity: '1' });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.6)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
})();`;

// ------------------------------------------------------------------ recorder

class Recorder {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.frames = [];
    this.marks = {};
    this.boxes = {};
  }
  /** Save an element's on-screen box (normalized 0..1 of the viewport) for camera targeting. */
  async box(label, locator) {
    const bb = await locator.first().boundingBox();
    if (!bb) return;
    this.boxes[label] = { x: +((bb.x + bb.width / 2) / VIEW.width).toFixed(4), y: +((bb.y + bb.height / 2) / VIEW.height).toFixed(4), w: +(bb.width / VIEW.width).toFixed(4), h: +(bb.height / VIEW.height).toFixed(4) };
  }
  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async (f) => {
      this.frames.push({ data: f.data, ts: f.metadata.timestamp });
      try {
        await this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
      } catch {
        /* session closed */
      }
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 2560, maxHeight: 1440, everyNthFrame: 1 });
    this.t0 = Date.now() / 1000;
    // Force an initial frame even if nothing repaints.
    await this.page.evaluate(() => document.body && (document.body.style.outline = "0px solid transparent"));
    console.log(`[${this.name}] recording`);
  }
  mark(label) {
    this.marks[label] = +(Date.now() / 1000 - this.t0).toFixed(3);
    console.log(`[${this.name}] mark ${label} @ ${this.marks[label]}s`);
  }
  async stop() {
    const tEnd = Date.now() / 1000;
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await this.cdp.detach().catch(() => {});
    if (!this.frames.length) throw new Error(`[${this.name}] no frames captured`);
    const dir = join(CLIPS, `_${this.name}_frames`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // Frames arrive only when the page repaints: hold each one until the next.
    const first = this.frames[0].ts;
    const lines = [];
    this.frames.forEach((f, i) => {
      const file = join(dir, `f${String(i).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      const next = i + 1 < this.frames.length ? this.frames[i + 1].ts : first + (tEnd - this.t0);
      const dur = Math.max(1 / 60, next - f.ts);
      lines.push(`file '${file.replace(/\\/g, "/")}'`, `duration ${dur.toFixed(4)}`);
    });
    lines.push(`file '${join(dir, `f${String(this.frames.length - 1).padStart(6, "0")}.jpg`).replace(/\\/g, "/")}'`);
    writeFileSync(join(dir, "list.txt"), lines.join("\n"));
    const out = join(CLIPS, `${this.name}.mp4`);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", "scale=2560:1440:flags=lanczos,format=yuv420p", "-r", "30", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-movflags", "+faststart", out]);
    // Marks are relative to the first frame (that's t=0 in the clip).
    const offset = first - this.t0;
    const marks = Object.fromEntries(Object.entries(this.marks).map(([k, v]) => [k, +(v - offset).toFixed(3)]));
    const duration = +(tEnd - first).toFixed(3);
    writeFileSync(join(CLIPS, `${this.name}.json`), JSON.stringify({ name: this.name, duration, frames: this.frames.length, marks, boxes: this.boxes }, null, 2));
    rmSync(dir, { recursive: true, force: true });
    console.log(`[${this.name}] saved ${out} (${duration}s, ${this.frames.length} frames)`);
  }
}

// ------------------------------------------------------------------ human helpers

async function moveTo(page, target, { duration = 700 } = {}) {
  const box = typeof target === "object" && "x" in target ? target : await target.boundingBox();
  if (!box) throw new Error("moveTo: element not visible");
  const to = { x: box.x + (box.width ?? 0) / 2, y: box.y + (box.height ?? 0) / 2 };
  const from = (await page.evaluate(() => window.__demoCursorPos)) || { x: VIEW.width / 2, y: VIEW.height / 2 };
  const steps = Math.max(12, Math.round(duration / 16));
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await sleep(duration / steps);
  }
  return to;
}

async function click(page, locator, opts) {
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  await moveTo(page, locator, opts);
  await sleep(180);
  await locator.click();
}

async function smoothScroll(page, deltaY, ms = 1800, selector = null) {
  await page.evaluate(
    ({ deltaY, ms, selector }) =>
      new Promise((done) => {
        const el = selector ? document.querySelector(selector) : null;
        const start = el ? el.scrollTop : window.scrollY;
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const y = start + deltaY * ease(t);
          if (el) el.scrollTop = y;
          else window.scrollTo(0, y);
          if (t < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    { deltaY, ms, selector },
  );
}

async function scrollToText(page, text, { offset = 140, ms = 1800 } = {}) {
  const loc = page.getByText(text, { exact: false }).first();
  await loc.waitFor();
  const y = await loc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const current = await page.evaluate(() => window.scrollY);
  await smoothScroll(page, y - offset - current, ms);
}

/** Wait until web fonts (Manrope, DM Mono) have loaded so recordings never show fallback fonts. */
async function fontsReady(page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.evaluate(async () => { await document.fonts.ready; });
}

const waitText = (page, text, timeout = 90_000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });

async function newPage(browser) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DSF, colorScheme: "light", locale: "en-US" });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return page;
}

async function still(page, name, { css = false, docs = false } = {}) {
  await sleep(400);
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, scale: "device" });
  if (docs) {
    await page.screenshot({ path: join(DOCS_SHOTS, `${name}.png`), scale: "css" });
  }
  console.log(`  still ${name}${docs ? " (+docs)" : ""}`);
}

// ------------------------------------------------------------------ clips

const tampered = (() => {
  const json = Buffer.from(invoice.linkData, "base64url").toString("utf8");
  const changed = json.replace('"amountUsd":5,', '"amountUsd":500,');
  if (changed === json) throw new Error("could not tamper amount");
  return { json, changed, linkData: Buffer.from(changed, "utf8").toString("base64url") };
})();
writeFileSync(join(CLIPS, "tamper.json"), JSON.stringify({ original: tampered.json, tampered: tampered.changed }, null, 2));

const clips = {
  async c1_landing(browser) {
    const page = await newPage(browser);
    await page.goto(LIVE + "/");
    await fontsReady(page);
    await waitText(page, "Get paid from any chain");
    await page.mouse.move(980, 520);
    const rec = new Recorder(page, "c1_landing");
    await rec.start();
    await sleep(2200);
    rec.mark("scrollStatement");
    await scrollToText(page, "Your work deserves better ways to get paid", { ms: 2600, offset: 180 });
    await sleep(2200);
    rec.mark("scrollHow");
    await scrollToText(page, "How PayMe works", { ms: 2200, offset: 120 });
    await sleep(2400);
    await rec.stop();
    await page.context().close();
  },

  async c2_c3_create_and_proof(browser) {
    const page = await newPage(browser);
    await page.goto(LIVE + "/new");
    await fontsReady(page);
    await waitText(page, "Read with private AI");
    const box = page.locator("textarea");
    await page.mouse.move(1100, 300);
    const rec = new Recorder(page, "c2_create");
    await rec.start();
    await rec.box("textarea", box);
    await rec.box("readButton", page.getByRole("button", { name: /Read with private AI/ }));
    await sleep(900);
    await click(page, box, { duration: 800 });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await sleep(300);
    rec.mark("typeStart");
    await page.keyboard.type(INVOICE_TEXT, { delay: 38 });
    rec.mark("typeEnd");
    await sleep(600);
    await click(page, page.getByRole("button", { name: /Read with private AI/ }), { duration: 750 });
    rec.mark("aiStart");
    await waitText(page, "Check the details", 120_000);
    rec.mark("aiEnd");
    await sleep(900);
    await scrollToText(page, "Check the details", { ms: 1800, offset: 60 });
    rec.mark("fields");
    await rec.box("fieldsCard", page.getByText("Check the details").locator("xpath=ancestor::div[contains(@class,'rounded-[22px]')][1]"));
    await sleep(2200);
    await scrollToText(page, "Processed privately", { ms: 1500, offset: 380 });
    rec.mark("badge");
    await rec.box("badge", page.getByText("Processed privately"));
    await sleep(2000);
    await rec.stop();
    await still(page, "c2_fields");

    // C3: proof modal, slow scroll through all 8 checks
    const view = page.getByRole("button", { name: "View proof" });
    const rec3 = new Recorder(page, "c3_proof");
    await rec3.start();
    await sleep(600);
    await click(page, view, { duration: 700 });
    await waitText(page, "Signing address");
    rec3.mark("modalOpen");
    await rec3.box("modal", page.locator("div.overflow-y-auto"));
    await sleep(2000);
    await still(page, "c3_modal_top");
    const modal = "div.overflow-y-auto";
    const scrollMax = await page.evaluate((s) => { const el = document.querySelector(s); return el ? el.scrollHeight - el.clientHeight : 0; }, modal);
    rec3.mark("scrollStart");
    await smoothScroll(page, scrollMax, 9000, modal);
    rec3.mark("scrollEnd");
    await sleep(2500);
    await still(page, "c3_modal_checks", { docs: false });
    await rec3.stop();
    // README still: whole modal incl. 8 checks at CSS scale
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollTop = 0; }, modal);
    await sleep(500);
    await page.screenshot({ path: join(DOCS_SHOTS, "demo-proof-checks.png"), scale: "css" });
    console.log("  still docs/screenshots/demo-proof-checks.png");
    await page.context().close();
  },

  async c4_verified_paid(browser) {
    const page = await newPage(browser);
    await page.goto(invoice.link);
    await fontsReady(page);
    await waitText(page, "Link verified against on-chain record");
    await waitText(page, "Payment successful");
    await page.mouse.move(1150, 200);
    const rec = new Recorder(page, "c4_verified");
    await rec.start();
    await sleep(2200);
    rec.mark("verifiedLine");
    await rec.box("verified", page.getByText("Link verified against on-chain record"));
    await rec.box("amount", page.getByText("Amount due"));
    await moveTo(page, page.getByText("Link verified against on-chain record").first(), { duration: 900 });
    await sleep(1800);
    await scrollToText(page, "Choose how to pay", { ms: 1800, offset: 300 });
    rec.mark("paidBox");
    await rec.box("paid", page.getByText("Payment successful"));
    await moveTo(page, page.locator("a[href*='nearblocks.io/txns']").first(), { duration: 900 });
    await sleep(2400);
    await rec.stop();
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await page.screenshot({ path: join(DOCS_SHOTS, "demo-pay-verified.png"), scale: "css", fullPage: true });
    console.log("  still docs/screenshots/demo-pay-verified.png");
    await still(page, "c4_top");
    await page.context().close();
  },

  async c5_break_it(browser) {
    const page = await newPage(browser);
    await page.goto(LIVE + `/pay/${invoice.id}#${tampered.linkData}`);
    await fontsReady(page);
    await waitText(page, "Do not pay");
    await page.mouse.move(1100, 560);
    const rec = new Recorder(page, "c5_tampered");
    await rec.start();
    await sleep(1000);
    await moveTo(page, page.getByText("Do not pay", { exact: false }).first(), { duration: 1100 });
    rec.mark("warning");
    await rec.box("warning", page.getByText("Do not pay", { exact: false }));
    await sleep(3500);
    await rec.stop();
    await still(page, "c5_warning");

    // Back to the original, untouched link: verified again.
    await page.goto(invoice.link);
    await fontsReady(page);
    await waitText(page, "Link verified against on-chain record");
    const rec2 = new Recorder(page, "c5_original");
    await rec2.start();
    await sleep(800);
    await moveTo(page, page.getByText("Link verified against on-chain record").first(), { duration: 900 });
    rec2.mark("verified");
    await rec2.box("verified", page.getByText("Link verified against on-chain record"));
    await sleep(3000);
    await rec2.stop();
    await page.context().close();
  },

  async c6_quotes(browser) {
    const page = await newPage(browser);
    await page.goto(invoice.link);
    await fontsReady(page);
    await waitText(page, "Link verified against on-chain record");
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("h2")].find((h) => h.textContent.includes("Choose how to pay"));
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120);
    });
    await page.mouse.move(900, 420);
    const rec = new Recorder(page, "c6_quotes");
    await rec.start();
    await sleep(1200);
    await click(page, page.getByRole("button", { name: /Preview route/ }), { duration: 900 });
    rec.mark("baseRequested");
    await waitText(page, "Freelancer receives", 40_000);
    rec.mark("baseQuote");
    await rec.box("quoteCard", page.getByText("Pay from another chain").locator("xpath=ancestor::div[contains(@class,'rounded-[22px]')][1]"));
    await sleep(3000);
    await still(page, "c6_base_quote");
    const [chainSel, tokenSel] = [page.locator("select").nth(0), page.locator("select").nth(1)];
    await moveTo(page, chainSel, { duration: 700 });
    await sleep(250);
    await chainSel.selectOption("Solana");
    await page.getByText("Freelancer receives").first().waitFor({ timeout: 40_000 });
    await sleep(900);
    await moveTo(page, tokenSel, { duration: 600 });
    await sleep(250);
    await tokenSel.selectOption("SOL");
    rec.mark("solRequested");
    await page.waitForFunction(() => document.body.innerText.includes("SOL") && /≈ [0-9.]+ SOL/.test(document.body.innerText), null, { timeout: 40_000 });
    rec.mark("solQuote");
    await sleep(3200);
    await rec.stop();
    await page.screenshot({ path: join(DOCS_SHOTS, "demo-live-quote.png"), scale: "css" });
    console.log("  still docs/screenshots/demo-live-quote.png");
    await still(page, "c6_sol_quote");
    await page.context().close();
  },

  async c7_nearblocks(browser) {
    const page = await newPage(browser);
    await page.goto(`https://testnet.nearblocks.io/txns/${invoice.payTx}`, { waitUntil: "domcontentloaded" });
    await fontsReady(page);
    await page.waitForFunction(() => /pay_invoice/i.test(document.body.innerText) && /success/i.test(document.body.innerText), null, { timeout: 60_000 });
    await sleep(1500);
    await page.mouse.move(1000, 300);
    const rec = new Recorder(page, "c7_nearblocks");
    await rec.start();
    await sleep(1500);
    const status = page.getByText(/^Success$/i).first();
    if (await status.count()) await moveTo(page, status, { duration: 900 });
    rec.mark("status");
    await sleep(1600);
    await smoothScroll(page, 380, 2200);
    rec.mark("scrolled");
    await sleep(2600);
    await rec.stop();
    await still(page, "c7_nearblocks");
    await page.context().close();
  },
};

const only = process.argv.slice(2);
const launchOpts = { headless: true, args: ["--hide-scrollbars", "--disable-blink-features=AutomationControlled"] };
// Prefer the installed Google Chrome (no 200 MB download); fall back to Playwright Chromium.
const browser = await chromium.launch({ ...launchOpts, channel: "chrome" }).catch(() => chromium.launch(launchOpts));
try {
  for (const [name, fn] of Object.entries(clips)) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    console.log(`\n=== ${name}`);
    await fn(browser);
  }
} finally {
  await browser.close();
}
console.log("\nDone.");
