// Deploys contract/target/near/payme_contract.wasm to the account in
// VITE_CONTRACT_ID (read from .env or the environment) on NEAR testnet,
// signing with the near-cli-rs legacy keychain. Cross-platform (PowerShell OK).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");

const contractId = process.env.VITE_CONTRACT_ID;
const network = process.env.VITE_NEAR_NETWORK || "testnet";
const wasm = resolve("contract/target/near/payme_contract.wasm");

if (!contractId) {
  console.error("VITE_CONTRACT_ID is not set (add it to .env, e.g. VITE_CONTRACT_ID=payme-invoices.testnet).");
  process.exit(1);
}
if (network !== "testnet") {
  console.error(`Refusing to deploy to "${network}": this project deploys to testnet only.`);
  process.exit(1);
}
if (!existsSync(wasm)) {
  console.error(`WASM not found at ${wasm}. Run "npm run contract:build" first.`);
  process.exit(1);
}

const args = [
  "contract", "deploy", contractId,
  "use-file", wasm,
  "without-init-call",
  "network-config", network,
  "sign-with-legacy-keychain",
  "send",
];
console.log(`> near ${args.join(" ")}`);
const result = spawnSync("near", args, { stdio: "inherit" });
if (result.error) {
  console.error(`Could not run near-cli-rs ("near"): ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
