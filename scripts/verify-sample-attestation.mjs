// Offline re-check of docs/sample-attestation.json (no keys, no network):
//  1. the signed text is "<model>:<sha256 request>:<sha256 response>" for this model
//  2. the ECDSA (EIP-191) signature recovers to the reported TEE signing address
//  3. all 8 server-side checks are recorded as passed
// The TDX quote / NVIDIA checks themselves need the live attestation report; run
// the app with a NEAR AI key to see them re-done for a fresh request.
import { readFileSync } from "node:fs";
import { verifyMessage } from "ethers";

const { attestation } = JSON.parse(readFileSync(new URL("../docs/sample-attestation.json", import.meta.url), "utf8"));
const p = attestation.proof;
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

const hex64 = /^[0-9a-f]{64}$/;
const expected = `${attestation.model}:${p.requestHash}:${p.responseHash}`;
check(
  "signed text = model:sha256(request):sha256(response)",
  p.signedText === expected && hex64.test(p.requestHash) && hex64.test(p.responseHash),
  attestation.model,
);
const recovered = verifyMessage(p.signedText, attestation.signature).toLowerCase();
check("ECDSA signature recovers to the TEE signing address", recovered === p.signingAddress.toLowerCase(), recovered);
check("all server-side verification checks passed", p.checks.length === 8 && p.checks.every((c) => c.ok), `${p.checks.filter((c) => c.ok).length}/${p.checks.length}`);
check("verified flag is true", attestation.verified === true);

if (failed) process.exit(1);
console.log("\nSample attestation re-verified offline.");
