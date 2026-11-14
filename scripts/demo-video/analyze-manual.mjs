// Find "dead time" in the manual wallet recordings, like ffmpeg's freezedetect:
// decode each clip to tiny grayscale frames, measure frame-to-frame change, and
// print a timeline of active vs static stretches. (Remotion's bundled ffmpeg has
// no freezedetect/select filters, so the comparison is done here.)
// Usage: node analyze-manual.mjs <file.mp4> [more.mp4 ...]
import { execFileSync } from "node:child_process";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const ffmpeg = findFfmpeg();
const W = 48;
const H = 27;
const FPS = 10; // sample rate for analysis

for (const file of process.argv.slice(2)) {
  // -r as an OUTPUT option resamples without needing the fps filter.
  const raw = execFileSync(ffmpeg, ["-v", "error", "-i", file, "-an", "-vf", `scale=${W}:${H},format=gray`, "-r", String(FPS), "-c:v", "rawvideo", "-pix_fmt", "gray", "-f", "image2pipe", "-"], { maxBuffer: 1 << 30 });
  const size = W * H;
  const n = Math.floor(raw.length / size);
  const diffs = [0];
  for (let i = 1; i < n; i++) {
    let sum = 0;
    for (let p = 0; p < size; p++) sum += Math.abs(raw[i * size + p] - raw[(i - 1) * size + p]);
    diffs.push(sum / size);
  }
  // Classify each 0.5 s window as static (< threshold) or active.
  const THRESH = 0.35; // mean abs luma change per sample (0..255)
  const win = FPS / 2;
  const runs = [];
  for (let i = 0; i < n; i += win) {
    const slice = diffs.slice(i, i + win);
    const act = Math.max(...slice);
    const state = act < THRESH ? "static" : "active";
    const t = i / FPS;
    const last = runs[runs.length - 1];
    if (last && last.state === state) {
      last.to = t + win / FPS;
      last.peak = Math.max(last.peak, act);
    } else runs.push({ state, from: t, to: t + win / FPS, peak: act });
  }
  console.log(`\n${file}  (${(n / FPS).toFixed(1)} s analysed)`);
  for (const r of runs) console.log(`  ${r.from.toFixed(1).padStart(5)}–${r.to.toFixed(1).padEnd(5)} ${r.state.padEnd(6)} ${(r.to - r.from).toFixed(1).padStart(4)}s  peak ${r.peak.toFixed(2)}`);
}
