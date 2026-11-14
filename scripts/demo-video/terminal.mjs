// C9: run the repo's real verification commands and save their output as text,
// so the video can show a clean terminal overlay (not a screen recording).
// Output: public/terminal.json
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve("../..");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function run(cmd) {
  console.log(`$ ${cmd}`);
  const out = strip(execSync(cmd, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }));
  return out.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith(">"));
}

const verify = run("npm run verify:sample");
const contract = run("npm run contract:test").filter((l) => /^test |test result: ok\. 25/.test(l));
const result = {
  capturedAt: new Date().toISOString(),
  blocks: [
    { command: "npm run verify:sample", lines: verify },
    { command: "npm run contract:test", lines: contract },
  ],
};
mkdirSync(resolve("public"), { recursive: true });
writeFileSync(resolve("public/terminal.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2).slice(0, 1500));
