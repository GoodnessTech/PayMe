// Collect everything the Remotion edit needs into src/generated/assets.json:
// recorded clip marks, which manual wallet recordings exist (+ durations),
// terminal output, the tamper diff, and the demo invoice's on-chain state.
// Run after `node record.mjs` and `node terminal.mjs`, before rendering.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findFfmpeg } from "./ffmpeg-path.mjs";

const pub = resolve("public");
const out = resolve("src/generated");
mkdirSync(out, { recursive: true });
mkdirSync(join(pub, "manual"), { recursive: true });
const ffprobe = findFfmpeg("ffprobe");

const probe = (file) => {
  const j = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8" }));
  const v = j.streams.find((s) => s.codec_type === "video");
  return { duration: +(+j.format.duration).toFixed(3), width: v?.width ?? 0, height: v?.height ?? 0 };
};

// Frame-verified marks override the recorder's wall-clock marks (see mark-fixes.json).
const fixes = existsSync(resolve("mark-fixes.json")) ? JSON.parse(readFileSync(resolve("mark-fixes.json"), "utf8")) : {};
const clips = {};
for (const f of readdirSync(join(pub, "clips")).filter((f) => f.endsWith(".json") && f !== "tamper.json")) {
  const meta = JSON.parse(readFileSync(join(pub, "clips", f), "utf8"));
  const mp4 = join(pub, "clips", `${meta.name}.mp4`);
  if (existsSync(mp4)) clips[meta.name] = { ...meta, marks: { ...meta.marks, ...(fixes[meta.name] ?? {}) }, ...probe(mp4), src: `clips/${meta.name}.mp4` };
}

const manual = {};
for (const name of ["manual-create", "manual-pay", "manual-dashboard", "manual-nearblocks"]) {
  // Prefer the trimmed version (see trim-manual.mjs) and its cut/speed metadata.
  const trimmed = resolve("../../demo-output", `${name}-trimmed.mp4`);
  const src = existsSync(trimmed) ? trimmed : resolve("../../demo-output", `${name}.mp4`);
  const sidecar = resolve("../../demo-output", `${name}-trimmed.json`);
  const trim = existsSync(trimmed) && existsSync(sidecar) ? JSON.parse(readFileSync(sidecar, "utf8")) : null;
  if (!existsSync(src)) {
    console.log(`MISSING ${name}.mp4 -> scene uses its fallback`);
    continue;
  }
  copyFileSync(src, join(pub, "manual", `${name}.mp4`));
  manual[name] = { ...probe(src), src: `manual/${name}.mp4`, trimmed: Boolean(trim), cuts: trim?.cuts ?? [], sped: trim?.sped ?? [] };
  console.log(`found ${name}.mp4 (${manual[name].duration}s, ${manual[name].width}x${manual[name].height})`);
}

const invoice = JSON.parse(readFileSync(resolve("../../demo-output/demo-invoice.json"), "utf8"));
// Live on-chain read for the dashboard fallback card.
const rpc = await fetch("https://test.rpc.fastnear.com", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "payme-invoices.testnet", method_name: "get_invoice", args_base64: Buffer.from(JSON.stringify({ id: invoice.id })).toString("base64") } }),
}).then((r) => r.json());
const onChain = JSON.parse(Buffer.from(rpc.result.result).toString("utf8"));

// The real pay_invoice transaction, from NEAR RPC (fallback when no nearblocks recording).
const txRes = await fetch("https://test.rpc.fastnear.com", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: invoice.payTx, sender_account_id: "payme-client-demo.testnet", wait_until: "FINAL" } }),
}).then((r) => r.json());
const tx = txRes.result;
const events = tx.receipts_outcome.flatMap((r) => r.outcome.logs).filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice(11)));
const payTxInfo = {
  hash: invoice.payTx,
  signer: tx.transaction.signer_id,
  receiver: tx.transaction.receiver_id,
  method: tx.transaction.actions[0]?.FunctionCall?.method_name,
  args: JSON.parse(Buffer.from(tx.transaction.actions[0]?.FunctionCall?.args ?? "", "base64").toString("utf8") || "{}"),
  deposit: tx.transaction.actions[0]?.FunctionCall?.deposit,
  success: "SuccessValue" in (tx.status ?? {}),
  returnValue: tx.status?.SuccessValue ? Buffer.from(tx.status.SuccessValue, "base64").toString() : null,
  events,
};

const assets = {
  generatedAt: new Date().toISOString(),
  clips,
  manual,
  terminal: existsSync(join(pub, "terminal.json")) ? JSON.parse(readFileSync(join(pub, "terminal.json"), "utf8")) : null,
  tamper: JSON.parse(readFileSync(join(pub, "clips", "tamper.json"), "utf8")),
  invoice: { id: invoice.id, payTx: invoice.payTx, createTx: invoice.createTx, onChain },
  payTxInfo,
};
writeFileSync(join(out, "assets.json"), JSON.stringify(assets, null, 2));
console.log(`clips: ${Object.keys(clips).join(", ")}`);
console.log(`manual: ${Object.keys(manual).join(", ") || "none"}`);
console.log(`on-chain ${invoice.id}: ${onChain.status}, payer ${onChain.payer}`);
