// Optional draft voiceover: synthesise each scene's narration (src/script.json)
// with a Microsoft Edge neural voice, normalise loudness, and make sure each
// line fits its scene. Writes public/vo/<scene>.mp3 + src/generated/vo.json.
// The aligned full track (demo-output/voiceover-draft.mp3) is then rendered by
// Remotion from the PayMeDemoVoiceover composition (see README.md).
//
// Usage: node voiceover.mjs [voice]   default voice: en-NG-AbeoNeural
import msedge from "msedge-tts";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const { MsEdgeTTS, OUTPUT_FORMAT } = msedge;
const VOICE = process.argv[2] || "en-NG-AbeoNeural";
const script = JSON.parse(readFileSync(resolve("src/script.json"), "utf8"));
const ffmpeg = findFfmpeg();
const ffprobe = findFfmpeg("ffprobe");
const outDir = resolve("public/vo");
const tmp = resolve("public/vo/_tmp");
mkdirSync(tmp, { recursive: true });

const duration = (f) => +execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();

const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

const manifest = {};
for (const scene of script.scenes) {
  if (!scene.narration) continue;
  const dir = join(tmp, scene.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { audioFilePath } = await tts.toFile(dir, scene.narration, { rate: "+4%" });
  let len = duration(audioFilePath);
  // voOffset < 0 lets a line start early, over the end of the previous (silent) scene.
  const budget = scene.duration - 0.8 + Math.abs(scene.voOffset ?? 0);
  const tempo = len > budget ? Math.min(1.2, len / budget) : 1;
  const out = join(outDir, `${scene.id}.mp3`);
  // Normalise to -16 LUFS (spoken-word target) and speed up only if needed.
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", audioFilePath, "-af", `${tempo > 1 ? `atempo=${tempo.toFixed(3)},` : ""}loudnorm=I=-16:TP=-1.5:LRA=11`, "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", out]);
  len = duration(out);
  manifest[scene.id] = { file: `vo/${scene.id}.mp3`, seconds: +len.toFixed(2) };
  console.log(`${scene.id.padEnd(13)} ${len.toFixed(2)}s / ${scene.duration}s${tempo > 1 ? `  (sped up ${tempo.toFixed(2)}x)` : ""}${len > budget + 0.5 ? "  !! TOO LONG" : ""}`);
}
rmSync(tmp, { recursive: true, force: true });
mkdirSync(resolve("src/generated"), { recursive: true });
writeFileSync(resolve("src/generated/vo.json"), JSON.stringify(manifest, null, 2));
console.log(`\nVoice: ${VOICE}. Wrote src/generated/vo.json`);
