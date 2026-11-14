// Contact sheet for a clip: frames at given times, laid out in a labelled grid
// (rendered with Playwright because the bundled ffmpeg has no tile filter).
// Usage: node contact-sheet.mjs <clip.mp4> <out.png> <t1,t2,...> [cols]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const [clip, out, list, colsArg] = process.argv.slice(2);
const times = list.split(",").map(Number);
const cols = Number(colsArg || 4);
const ffmpeg = findFfmpeg();
const tmp = resolve("public/_sheet");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const imgs = times.map((t, i) => {
  const p = join(tmp, `f${i}.png`);
  execFileSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", clip, "-frames:v", "1", "-vf", "scale=480:-2", p]);
  return { t, data: readFileSync(p).toString("base64") };
});
const html = `<html><body style="margin:0;background:#111;font:600 15px monospace;color:#fff">
<div style="display:grid;grid-template-columns:repeat(${cols},480px);gap:6px;padding:6px">
${imgs.map((x) => `<div><div style="padding:3px 6px;background:#b7f0a1;color:#111;display:inline-block">t=${x.t}s</div><br><img src="data:image/png;base64,${x.data}" style="width:480px;display:block"></div>`).join("")}
</div></body></html>`;
const b = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
const p = await b.newPage({ viewport: { width: cols * 486 + 6, height: 400 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
rmSync(tmp, { recursive: true, force: true });
console.log("wrote", out);
