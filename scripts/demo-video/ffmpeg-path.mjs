// Locate ffmpeg/ffprobe: system install (e.g. winget Gyan.FFmpeg) first,
// then the copy bundled with Remotion's compositor.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function onPath(bin) {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" });
    return bin;
  } catch {
    return null;
  }
}

function wingetCandidate(bin) {
  const base = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet");
  const links = join(base, "Links", `${bin}.exe`);
  if (existsSync(links)) return links;
  const pkgs = join(base, "Packages");
  if (!existsSync(pkgs)) return null;
  for (const dir of readdirSync(pkgs).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
    const root = join(pkgs, dir);
    for (const sub of readdirSync(root)) {
      const p = join(root, sub, "bin", `${bin}.exe`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function remotionCandidate(bin) {
  const p = join("node_modules", "@remotion", "compositor-win32-x64-msvc", `${bin}.exe`);
  return existsSync(p) ? p : null;
}

export function findFfmpeg(bin = "ffmpeg") {
  const found = onPath(bin) ?? wingetCandidate(bin) ?? remotionCandidate(bin);
  if (!found) throw new Error(`${bin} not found. Install it: winget install Gyan.FFmpeg`);
  return found;
}
