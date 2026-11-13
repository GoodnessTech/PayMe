// After `vercel build`, load each built function from .vercel/output and call it
// with a Web Request, the way Vercel's Node runtime would. Needs no API keys:
// parse-invoice must answer with the labelled local fallback (verified: false);
// quote and near-price call the public NEAR Intents 1Click API.
// Used by CI (.github/workflows/ci.yml, job "vercel-build").
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = resolve(".vercel/output");
const config = JSON.parse(readFileSync(join(out, "config.json"), "utf8"));
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

const routes = JSON.stringify(config.routes ?? []);
check("SPA rewrite to /index.html is configured", routes.includes("/index.html"));
check("static index.html built", existsSync(join(out, "static", "index.html")));

async function load(fn) {
  const dir = join(out, "functions", "api", `${fn}.func`);
  const vc = JSON.parse(readFileSync(join(dir, ".vc-config.json"), "utf8"));
  check(`${fn}: runtime ${vc.runtime}, maxDuration ${vc.maxDuration ?? "default"}`, String(vc.runtime).startsWith("nodejs"));
  return import(pathToFileURL(join(dir, vc.handler)).href);
}

const host = { host: "example.vercel.app" };

const parse = await load("parse-invoice");
const res1 = await parse.POST(
  new Request("https://example.vercel.app/api/parse-invoice", {
    method: "POST",
    headers: { "content-type": "application/json", ...host },
    body: JSON.stringify({ text: "Invoice to Acme Ltd for logo design, $250, due November 30, 2026. Payment to tunde.testnet." }),
  }),
);
const b1 = await res1.json();
check(
  "parse-invoice without a key -> labelled fallback, verified false",
  res1.status === 200 && b1.attestation?.verified === false && /Local fallback/.test(b1.attestation?.provider ?? ""),
  JSON.stringify(b1.draft),
);

const price = await load("near-price");
const res2 = await price.GET(new Request("https://example.vercel.app/api/near-price", { headers: host }));
const b2 = await res2.json();
check("near-price returns a live NEAR/USD price", res2.status === 200 && b2.usd > 0, `$${b2.usd}`);

const quote = await load("quote");
const res3 = await quote.POST(
  new Request("https://example.vercel.app/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json", ...host },
    body: JSON.stringify({ amountUsd: 25, chain: "Base", token: "USDC" }),
  }),
);
const b3 = await res3.json();
check(
  "quote returns a live 1Click dry-run quote",
  res3.status === 200 && b3.preview === true && b3.amountOutUsdc === "25.00",
  `${b3.amountIn} ${b3.originToken}`,
);

// The Intel TDX quote verifier must be bundled with parse-invoice and load (pure JS).
const tdxEntry = join(out, "functions", "api", "parse-invoice.func", "node_modules", "@phala", "dcap-qvl", "src", "index.js");
const tdx = existsSync(tdxEntry) ? await import(pathToFileURL(tdxEntry).href) : null;
check("dcap-qvl (Intel TDX verifier) is bundled and loads", typeof (tdx?.getCollateralAndVerify ?? tdx?.default?.getCollateralAndVerify) === "function");

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Vercel build checks passed.");
