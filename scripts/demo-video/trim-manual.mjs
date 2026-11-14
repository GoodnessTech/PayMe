// Trim the manual wallet recordings: keep the key moments at normal speed,
// speed up waits, hard-cut long dead time. Writes demo-output/<name>-trimmed.mp4
// plus <name>-trimmed.json (cut points + sped-up ranges, used by the edit to
// add quick crossfades and the "SPED UP" chip). Originals are left untouched.
//
// The bundled ffmpeg has no setpts/xfade filters, so each segment is cut, then
// retimed with -itsscale (input timestamp scaling) and re-sampled to 30 fps;
// segments are joined with the concat demuxer.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const ffmpeg = findFfmpeg();
const ffprobe = findFfmpeg("ffprobe");
const OUT = resolve("../../demo-output");

// Source filenames as saved by the recorder (two have a doubled extension).
const PLANS = {
  "manual-create": {
    src: "manual-create.mp4",
    crop: null,
    segments: [
      { from: 9.0, to: 10.9, rate: 1, why: "TEE badge, Create payment link click" },
      { from: 10.9, to: 15.0, rate: 8, why: "Creating private link, waiting for wallet" },
      { from: 15.0, to: 19.5, rate: 8, why: "wallet popup loading" },
      { cut: true, from: 19.5, to: 29.2, why: "7 s black popup + approval screen loading" },
      { from: 29.2, to: 31.2, rate: 1, why: "Meteor Approve Transaction screen + Approve click" },
      { from: 31.2, to: 34.0, rate: 6, why: "Executing transaction" },
      { from: 34.0, to: 37.6, rate: 1, why: "payment link + QR appear and hold" },
    ],
  },
  "manual-pay": {
    src: "manual-pay.mp4.mp4",
    crop: "1376:640:0:88", // remove Chrome tab strip + address bar
    segments: [
      { from: 0.3, to: 2.6, rate: 1, why: "link opens: Link verified against on-chain record" },
      { from: 2.6, to: 4.4, rate: 1, why: "scroll to Pay with NEAR" },
      { from: 4.4, to: 6.3, rate: 1, why: "Pay click, Processing payment" },
      { from: 6.3, to: 7.5, rate: 4, why: "waiting for wallet" },
      { from: 7.5, to: 8.5, rate: 1, why: "Meteor Connect: Continue in Meteor Web" },
      { cut: true, from: 8.5, to: 37.4, why: "29 s unchanged dialog (approval in separate window)" },
      { from: 37.4, to: 41.8, rate: 1, why: "back on page, Payment successful + tx hash" },
    ],
  },
  "manual-dashboard": {
    src: "manual-dashboard.mp4.mp4",
    crop: "1376:640:0:88",
    segments: [
      { from: 6.5, to: 7.7, rate: 2, why: "scroll from stats to invoice list" },
      { from: 7.7, to: 10.1, rate: 1, why: "Paid out $11.00 + paid invoice rows" },
    ],
  },
};

const probeDur = (f) => +execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();

for (const [name, plan] of Object.entries(PLANS)) {
  const src = join(OUT, plan.src);
  if (!existsSync(src)) {
    console.log(`skip ${name}: ${plan.src} not found`);
    continue;
  }
  const tmp = join(OUT, `_trim_${name}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const list = [];
  const meta = { name, source: plan.src, crop: plan.crop, segments: [], cuts: [], sped: [] };
  let at = 0;
  let pendingCut = false;
  plan.segments.forEach((s, i) => {
    if (s.cut) {
      pendingCut = true;
      meta.segments.push({ srcFrom: s.from, srcTo: s.to, cut: true, why: s.why });
      return;
    }
    const raw = join(tmp, `s${i}_raw.mp4`);
    const seg = join(tmp, `s${i}.mp4`);
    const vf = [plan.crop ? `crop=${plan.crop}` : null, "format=yuv420p"].filter(Boolean).join(",");
    execFileSync(ffmpeg, ["-y", "-v", "error", "-ss", String(s.from), "-to", String(s.to), "-i", src, "-an", "-vf", vf, "-r", "30", "-c:v", "libx264", "-crf", "16", "-preset", "medium", raw]);
    if (s.rate > 1) {
      execFileSync(ffmpeg, ["-y", "-v", "error", "-itsscale", String(1 / s.rate), "-i", raw, "-an", "-r", "30", "-c:v", "libx264", "-crf", "16", "-preset", "medium", seg]);
    } else {
      execFileSync(ffmpeg, ["-y", "-v", "error", "-i", raw, "-an", "-c", "copy", seg]);
    }
    const d = probeDur(seg);
    if (pendingCut) meta.cuts.push(+at.toFixed(3));
    pendingCut = false;
    if (s.rate > 1) meta.sped.push({ from: +at.toFixed(3), to: +(at + d).toFixed(3), rate: s.rate });
    meta.segments.push({ srcFrom: s.from, srcTo: s.to, rate: s.rate, outFrom: +at.toFixed(3), outTo: +(at + d).toFixed(3), why: s.why });
    at += d;
    list.push(`file '${seg.replace(/\\/g, "/")}'`);
  });
  writeFileSync(join(tmp, "list.txt"), list.join("\n"));
  const out = join(OUT, `${name}-trimmed.mp4`);
  execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(tmp, "list.txt"), "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-r", "30", "-movflags", "+faststart", out]);
  meta.duration = +probeDur(out).toFixed(3);
  writeFileSync(join(OUT, `${name}-trimmed.json`), JSON.stringify(meta, null, 2));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${name}-trimmed.mp4  ${meta.duration}s  (source ${probeDur(src).toFixed(1)}s)`);
  for (const s of meta.segments) {
    console.log(s.cut ? `  CUT     ${s.srcFrom}–${s.srcTo}s  ${s.why}` : `  ${s.rate > 1 ? `SPED ${s.rate}x` : "normal "}  ${s.srcFrom}–${s.srcTo}s -> ${s.outFrom}–${s.outTo}s  ${s.why}`);
  }
}
