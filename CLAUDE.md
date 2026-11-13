# PayMe — project guide for Claude Code

## What this is
PayMe lets African freelancers turn an invoice into a private payment link their client can pay from any blockchain. Built for the NEAR HACKATHON (deadline 2026-11-14 23:59 UTC). Tracks: Real-World Money, Privacy & Private AI.

Three NEAR technologies, each must really work (no faking):
1. **NEAR AI Cloud**: reads pasted invoice text privately inside a TEE and returns an attestation/signature we verify and show.
2. **NEAR Intents (1Click API)**: live cross-chain quote ("pay with USDC on Base → freelancer gets USDC on NEAR"). Intents is mainnet-only, so we use `dry: true` quotes. No funds move. The UI already labels this "preview".
3. **NEAR smart contract on testnet**: records invoices (amount, recipient, fingerprint, status) and processes real testnet NEAR payments.

## Hard rules
- **Zero cost.** Testnet only for transactions. NEAR AI Cloud uses the free hackathon credits. Never require the user to spend money.
- **Don't redesign the frontend.** `src/App.tsx` (UI, built in Bolt) stays visually the same. You may only make small changes there when wiring is impossible otherwise (e.g. wallet redirect handling, a "fingerprint verified" line). All data access goes through `src/lib/api.ts`. Keep its exported types and function names EXACTLY as they are.
- **Privacy by design.** Invoice details (client name, description) are NEVER stored on a server or on-chain. They live in the payment link after `#`. On-chain we store only: id, recipient, amount, fingerprint (sha256 of the link data), status, timestamps, payer.
- **Never fake verification.** If NEAR AI Cloud is unavailable or attestation can't be verified, return `verified: false` and say why. A clearly labelled local fallback parser is OK.
- **No secrets in the repo.** Keys go in `.env` (gitignored). Keep `.env.example` updated.
- **Windows dev machine.** Commands must work in PowerShell. Use cross-platform npm scripts (no `rm -rf`, no bash-only syntax).
- Before calling any external API, check its current docs (docs.near.org, docs.near.ai, github.com/nearai/cloud-api, docs.near-intents.org). Don't guess endpoints, contract addresses or SDK versions.

## Folder layout
```
/                 Vite + React + TS + Tailwind frontend (from Bolt)
  src/App.tsx     all UI pages (Landing, /new, /pay/:id, /dashboard)
  src/lib/api.ts  the ONLY data layer the UI uses
  src/lib/*.ts    helpers you add (near.ts wallet/RPC, link.ts encode/fingerprint)
/api              serverless functions (Vercel format), TypeScript
/contract         Rust NEAR smart contract (near-sdk) + tests
README.md  RESULTS.md  LICENSE (MIT)  .env.example  CLAUDE.md
```

## Link format
`{origin}/pay/{id}#{linkData}`, where `linkData` = base64url(JSON of `{id, clientName, description, amountUsd, dueDate, recipient, createdAt}`).
`fingerprint` = hex sha256 of the decoded linkData string. The pay page recomputes it and compares it with the on-chain record to detect tampered links.

## Env vars (see .env.example)
- `NEAR_AI_API_KEY`: NEAR AI Cloud key (server only)
- `NEAR_AI_MODEL`: model id for invoice parsing
- `ONECLICK_JWT`: optional
- `INTENTS_QUOTE_RECIPIENT`: a mainnet NEAR account used only as the recipient in dry-run quotes
- `VITE_CONTRACT_ID`: deployed testnet contract, e.g. `payme-xyz.testnet`
- `VITE_NEAR_NETWORK=testnet`

## Commands (keep these working)
- `npm run dev`: frontend + /api together, one command, no Vercel login needed
- `npm run build`, `npm run typecheck`
- `npm run contract:test`, `npm run contract:build`, `npm run contract:deploy`

## Definition of done
A judge can clone the repo, follow the README's "do X, see Y" steps, and see: invoice parsed by NEAR AI Cloud with a real attestation, a live 1Click quote, and a real testnet payment visible on testnet.nearblocks.io.
