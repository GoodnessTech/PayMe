# PayMe — repository guide for reviewers and AI agents

PayMe turns an invoice into a private payment link on NEAR. It uses three NEAR technologies, each of which really runs:

1. **NEAR AI Cloud:** parses invoice text inside a TEE. The server verifies the response signature and attestation with 8 checks.
2. **NEAR Intents 1Click API:** live `dry: true` cross-chain quotes and the NEAR/USD price.
3. **A Rust smart contract on NEAR testnet** (`payme-invoices.testnet`): records invoices (fingerprint only, no personal details) and settles real testnet NEAR payments.

Built for the NEAR hackathon (Nov 12–14, 2026). Tracks: Real-World Money, and Privacy & Private AI. Human-facing docs are in [README.md](README.md).

## Architecture

```
Browser (Vite + React)                    Vercel functions (Node, Web Request/Response)
  src/App.tsx      UI (Bolt design)         api/parse-invoice.ts → server/nearai.ts → NEAR AI Cloud
  src/lib/api.ts   the ONLY data layer        └─ server/verify.ts  (ECDSA, Intel TDX via dcap-qvl, NVIDIA NRAS)
  src/lib/near.ts  NEAR Connect + RPC       api/quote.ts         → server/oneclick.ts → 1Click /v0/quote (dry)
  src/lib/link.ts  link + sha256            api/near-price.ts    → server/oneclick.ts → 1Click /v0/tokens
  src/lib/chain.ts pure helpers
        │ wallet-signed create_invoice / pay_invoice, RPC view calls
        ▼
  contract/src/lib.rs  (near-sdk 5.30.1)  deployed at payme-invoices.testnet
```

- `api/` holds **only** the three endpoint files, because Vercel turns every file in `api/` into a function. Shared code and server tests live in `server/`.
- `npm run dev` serves the frontend and `/api` from one Vite process ([`vite-api-plugin.ts`](vite-api-plugin.ts)). No Vercel CLI is needed.

## Where each NEAR integration lives

| Integration | Files | Key functions |
|---|---|---|
| NEAR AI Cloud inference + verification | `server/nearai.ts`, `server/verify.ts`, `api/parse-invoice.ts` | `parseWithNearAi`, `verifyCompletion`, `verifyTdxQuote`, `checkReportData`, `checkComposeHash`, `verifyGpu`, `recoverEcdsaSigner` |
| NEAR Intents 1Click | `server/oneclick.ts`, `api/quote.ts`, `api/near-price.ts` | `getDryQuote`, `buildQuoteRequest`, `findOriginAsset`, `findNearPrice` |
| Smart contract | `contract/src/lib.rs`, `contract/src/tests.rs` | `create_invoice`, `pay_invoice`, `on_payout`, `get_invoice`, `get_invoices_by_recipient` |
| Wallet + RPC | `src/lib/near.ts`, `src/lib/api.ts` | `signIn`, `callContract`, `viewContract`, `patchManifestForTestnet`; `createInvoice`, `getInvoice`, `payOnNear`, `listMyInvoices` |

## Run

```bash
npm ci
npm run dev            # http://localhost:5173 — works with no .env (labelled fallback parser; quotes and price still live)
```

Optional `.env` (see `.env.example`): `NEAR_AI_API_KEY`, `NEAR_AI_MODEL`, `INTENTS_QUOTE_RECIPIENT`, `ONECLICK_JWT`, `VITE_CONTRACT_ID`, `VITE_NEAR_NETWORK=testnet`.

## Test

```bash
npm test               # Vitest, 45 tests, no network or keys (fetch is mocked)
npm run typecheck      # app + api/server + vite config
npm run lint
npm run build
npm run contract:test  # cargo test, 25 tests (Rust toolchain pinned in contract/rust-toolchain.toml)
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of the above on Ubuntu. It also runs a real `vercel build` and calls the built functions with no keys.

## Verify claims

- [docs/CLAIMS.md](docs/CLAIMS.md): every README claim → file/function, test name, or testnet transaction.
- `npm run verify:sample`: offline re-check of the real attestation in `docs/sample-attestation.json`.
- `npm run invoice -- PM-2026-V2PN6V`: reads a paid invoice from the contract over public RPC.
- [RESULTS.md](RESULTS.md): all testnet transactions with nearblocks links.

## Rules for changes

- **Keep `src/lib/api.ts` exports stable.** The UI depends on its exported types and function names.
- **Never fake verification.** `verified` must stay `failed.length === 0` over real checks. A local fallback must say so (`verified: false`, provider "Local fallback …").
- **Privacy:** client name and description must never be sent to the chain or stored server-side, and the server must never log invoice text.
- **Testnet only and zero cost.** No mainnet transactions.
- **Secrets go only in `.env`**, which is gitignored.
- **Keep `api/` to endpoint files only.** Add shared code under `server/`.
- **Commands must work in both PowerShell and bash.**
