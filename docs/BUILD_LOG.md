# Build log

How PayMe was built during the NEAR hackathon (Nov 12–14, 2026).

- **Frontend:** generated with Bolt.new.
- **Backend, verification, contract, wallet wiring and tests:** written with Claude Code, in four phases. The author reviewed and tested each phase, including the manual wallet flow.

## Original build brief

These were the working instructions given to Claude Code during the build. They are kept here for transparency; the current repository guide is [CLAUDE.md](../CLAUDE.md).

> **What this is.** PayMe lets African freelancers turn an invoice into a private payment link their client can pay from any blockchain. Tracks: Real-World Money, Privacy & Private AI.
>
> **Three NEAR technologies, each must really work (no faking):**
> 1. NEAR AI Cloud reads pasted invoice text privately inside a TEE and returns an attestation/signature we verify and show.
> 2. NEAR Intents (1Click API): a live cross-chain quote. Intents is mainnet-only, so we use `dry: true` quotes. No funds move; the UI labels this "preview".
> 3. A NEAR smart contract on testnet records invoices (amount, recipient, fingerprint, status) and processes real testnet NEAR payments.
>
> **Hard rules:**
> - **Zero cost:** testnet only, free NEAR AI hackathon credits.
> - **Don't redesign the Bolt frontend.** All data access goes through `src/lib/api.ts`, with its exported types and names kept.
> - **Privacy by design:** client name and description are never stored on a server or on-chain; they live in the link after `#`.
> - **Never fake verification:** return `verified: false` and say why, and clearly label any local fallback.
> - **No secrets in the repo.**
> - **Commands must work on Windows.**
> - **Check current docs before calling any external API.**
>
> **Link format:** `{origin}/pay/{id}#{linkData}`, where `linkData` = base64url(JSON of `{id, clientName, description, amountUsd, dueDate, recipient, createdAt}`) and `fingerprint` = hex sha256 of the decoded linkData string.
>
> **Definition of done:** a judge can clone the repo, follow the README's "do X, see Y" steps, and see an invoice parsed by NEAR AI Cloud with a real attestation, a live 1Click quote, and a real testnet payment visible on testnet.nearblocks.io.

## Phases

| Phase | What was built | Evidence |
|---|---|---|
| 1. Smart contract | Rust contract (near-sdk 5.30.1), 25 unit tests, deployed to `payme-invoices.testnet`, live smoke test (create → pay with overpayment refund → read, double-pay and private-callback rejections) | [RESULTS.md](../RESULTS.md) Phase 1 |
| 2. Backend | `/api/parse-invoice` (NEAR AI Cloud + 8 verification checks + labelled fallback), `/api/quote` (1Click dry run), `/api/near-price`, one-command dev server, Vitest tests | [docs/sample-attestation.json](sample-attestation.json) |
| 3. Frontend wiring | NEAR Connect wallet (Meteor, MyNearWallet on testnet), payment links with on-chain fingerprint check, real `create_invoice` / `pay_invoice`, proof modal with all checks, honest fallback badge | RESULTS.md Phase 3 (automated + manual wallet run) |
| 4. Ship | Repo guide, claims map, CI (incl. a real `vercel build`), Vercel config, cleanup, history secret scan | This repo |

## Notable decisions

- **Wallet connector:** NEAR Connect (`@hot-labs/near-connect`), because docs.near.org marks Wallet Selector as deprecated. MyNearWallet's official script supports testnet, but the public manifest doesn't flag it, so `src/lib/near.ts` sets that flag.
- **Payout callback:** `pay_invoice` adds an `on_payout` callback. If forwarding to the recipient fails, the payer is refunded and the invoice reopens, so the contract never keeps invoice money.
- **Model:** `Qwen/Qwen3-VL-30B-A3B-Instruct`. It runs in NEAR's own attested TEE, supports structured outputs, is non-reasoning (predictable cost), and is cheap.
- **Building on Windows:**
  - `contract:build` uses `--no-abi`, because ABI generation links a native DLL that MSVC rejects.
  - `contract/.cargo/config.toml` uses aws-lc-sys's prebuilt NASM objects.
- **Integration tests:** `near-sandbox` doesn't run on Windows, so contract coverage is unit tests plus real testnet transactions.
