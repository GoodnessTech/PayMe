# PayMe: Claude Code prompts (run in order)

Paste ONE phase at a time into the Claude Code extension in VS Code. Don't start the next phase until the current one's "You check" passes.

---

## STEP 0: Setup (you do this by hand, about 20–30 min, all free)

1. Unzip the Bolt project. Move everything inside `project/` into a new folder, e.g. `C:\dev\payme`. Open that folder in VS Code.
2. Put the `CLAUDE.md` file I gave you in the root of that folder (next to `package.json`).
3. Install, if you don't already have them:
   - **Node.js 20 or newer**: nodejs.org (LTS)
   - **Git**: git-scm.com
   - **Visual Studio Build Tools**: visualstudio.microsoft.com/visual-cpp-build-tools. In the installer, tick **"Desktop development with C++"**. Rust needs this on Windows.
   - **Rust**: rustup.rs, download `rustup-init.exe`, accept the defaults.
4. Close and reopen VS Code so the new tools are found.
5. In the VS Code terminal run `git init`, then `npm install`, then `npm run dev`. Open the link and check the site loads.
6. Ask for free NEAR AI Cloud credits (NEAR Builders Telegram: t.me/nearbuilderschat). Phase 2 has a fallback if they haven't arrived yet.

---

## PHASE 1: Smart contract

```
Read CLAUDE.md first.

PHASE 1: build and deploy the PayMe smart contract on NEAR testnet.

1) Tooling (Windows, PowerShell):
   - Run `rustup target add wasm32-unknown-unknown`.
   - Install cargo-near and near-cli-rs using the methods currently recommended in docs.near.org for Windows. Check the docs; don't guess. If cargo-near fails to install, explain the error and propose the fix.
   - Show me the versions installed.

2) Create /contract: a Rust contract using the current stable near-sdk version (check crates.io / docs.near.org).
   State: invoices: map id(String) -> Invoice { id, creator: AccountId, recipient: AccountId, amount_yocto: U128, amount_usd_cents: u64, fingerprint: String (64-char hex), status: Pending|Paid, created_at_ms: u64, paid_at_ms: Option<u64>, payer: Option<AccountId> }, plus an index recipient -> list of invoice ids.
   Methods:
   - create_invoice(id, recipient, amount_yocto, amount_usd_cents, fingerprint) #[payable]: caller pays for the storage it uses (measure storage_usage before/after, require the attached deposit to cover it, refund the excess). Reject duplicate ids, empty/oversized ids (max 64 chars), fingerprints that aren't 64 hex chars, and zero amounts.
   - pay_invoice(id) #[payable]: require status Pending and attached deposit >= amount_yocto; transfer amount_yocto to recipient; refund any excess to the payer; mark Paid with payer + paid_at_ms.
   - Views: get_invoice(id) -> Option<Invoice>; get_invoices_by_recipient(account_id, from_index, limit) -> Vec<Invoice> (newest first).
   - Emit NEP-297 JSON events: standard "payme", version "1.0.0", events "invoice_created" and "invoice_paid".
   - No owner/admin powers over funds. The contract never holds invoice money beyond the single pay transaction.

3) Tests: unit tests for every method and every rejection case (duplicate id, underpayment, paying twice, bad fingerprint, excess refund). If feasible on Windows, add near-workspaces sandbox integration tests for a full create -> pay flow. If the sandbox doesn't run on Windows, say so and keep unit tests only.

4) Add npm scripts in the root package.json that work in PowerShell:
   - contract:test, contract:build (non-reproducible wasm build is fine), contract:deploy (deploys to the account in VITE_CONTRACT_ID).

5) Testnet account + deploy:
   - Ask me what name I want, then create a testnet account for the contract with near-cli-rs, funded by the free faucet (sponsor-by-faucet-service), keys saved in the legacy keychain.
   - Deploy the contract, then do a full smoke test with near-cli-rs: create_invoice, then pay_invoice from a second free testnet account, then get_invoice.
   - Write the contract account and the two transaction hashes into a new file RESULTS.md, with testnet.nearblocks.io links.
   - Add VITE_CONTRACT_ID to .env and .env.example.

6) Write contract/README.md: what each method does and how to build, test and deploy.

When done, give me: test results, the contract account, and the explorer links.
```

**You check:** tests pass, and the explorer links in RESULTS.md open and show the transactions.

---

## PHASE 2: Backend API (NEAR AI Cloud + NEAR Intents)

```
Read CLAUDE.md first. Phase 1 is done (contract deployed).

PHASE 2: build the serverless backend in /api (Vercel-style TypeScript functions). Also make `npm run dev` serve /api and the Vite frontend together with ONE command and no Vercel login (e.g. a small Vite dev-server middleware that loads the /api handlers). It must work on Windows.

Endpoints:

1) POST /api/parse-invoice  { text } -> { draft: InvoiceDraft, attestation: Attestation }
   - Call NEAR AI Cloud's OpenAI-compatible chat completions API with NEAR_AI_API_KEY and NEAR_AI_MODEL. Read docs.near.ai and github.com/nearai/cloud-api first for the current base URL, model list and verification endpoints. Use the models endpoint to choose a sensible default model and put it in .env.example.
   - Ask the model for strict JSON: clientName, description, amountUsd (number), dueDate (ISO yyyy-mm-dd if possible), recipient (a .testnet account if mentioned, else ""). Validate and sanitise the output; never trust it blindly.
   - Verification: following NEAR AI Cloud's docs, fetch the attestation report for the model and the signature for this specific chat completion, then verify what can be verified (at minimum: the signature is over this request/response and it was signed by the address bound to the attestation report). Fill Attestation honestly: verified true only if those checks pass; model = the model used; provider = "NEAR AI Cloud"; signature = the real signature. Also return extra proof fields (signing address, chat id, report nonce) inside an optional `proof` object for the "View proof" modal, without changing the existing Attestation type's required fields.
   - If NEAR_AI_API_KEY is missing or the call fails: use a local regex fallback parser and return verified:false, provider:"Local fallback (NEAR AI Cloud unavailable)". Never pretend.
   - Never log invoice text on the server.

2) POST /api/quote  { amountUsd, chain, token } -> Quote
   - Use the NEAR Intents 1Click API (check docs.near-intents.org for the current base URL and request schema). GET the supported tokens list (cache it for 10 min) and map our UI choices (Base/Ethereum/Solana/Arbitrum/Bitcoin × USDC/USDT/ETH/SOL/BTC) to real assetIds. Return a clear error for combos that don't exist (e.g. SOL on Base).
   - Request a quote with dry: true, swapType EXACT_OUTPUT, destination = USDC on NEAR, amount = amountUsd in USDC base units, recipient = INTENTS_QUOTE_RECIPIENT, refund address = a valid placeholder address for the origin chain (dry run only, explain this in a code comment), short deadline. Use ONECLICK_JWT if set.
   - Map the response into our Quote type: amountIn formatted with the token's decimals, amountOutUsdc, etaSeconds (from the response's time estimate), route "NEAR Intents (1Click)", preview: true.

3) GET /api/near-price -> { usd: number, source, fetchedAt }
   - Use the NEAR price from the 1Click tokens list (wNEAR), cached 60s. Used to convert invoice USD into a NEAR amount for testnet payment.

General: input validation on every endpoint, sensible HTTP status codes, a 10s timeout on external calls, CORS same-origin only. Add unit tests (vitest) for the fallback parser, the token mapping and the response mapping (mock fetch). Update .env.example with every variable plus a comment.

When done, show me example curl (PowerShell Invoke-RestMethod) calls and their real outputs for all three endpoints.
```

**You check:** all three endpoints return real data. parse-invoice shows `verified: true` once your NEAR AI key is in `.env`.

---

## PHASE 3: Wire the frontend to the real backend + wallet

```
Read CLAUDE.md first. Phases 1 and 2 are done.

PHASE 3: replace the mock implementations in src/lib/api.ts with real ones. Keep every exported type and function name exactly the same. Don't change the design in src/App.tsx except for the minimal additions listed below.

1) Wallet: use the NEAR wallet connector currently recommended in docs.near.org for web apps (NEAR Wallet Selector or near-connect; check the docs), on testnet, supporting at least MyNearWallet and Meteor. Put the wallet/RPC code in src/lib/near.ts. connectWallet opens the selector and resolves with the account id; getAccount returns the signed-in account or null; signOut signs out. Handle redirect-based wallets (the page reloads after signing): pending actions must resume and show the right success state.

2) src/lib/link.ts: encodeLink(data), decodeLink(str), fingerprint(str) using Web Crypto sha256 -> hex. Same format as CLAUDE.md.

3) api.ts:
   - parseInvoice -> POST /api/parse-invoice.
   - createInvoice -> build linkData + fingerprint; get the NEAR price from /api/near-price and convert amountUsd to yoctoNEAR (show the rate used); call the contract's create_invoice from the connected wallet with the storage deposit; return the Invoice with the link. Save {id, linkData} in localStorage under the account, so this device's dashboard can show client names. Nothing private goes anywhere else.
   - getInvoice(id, linkData) -> decode linkData, read get_invoice from the contract via RPC, check the fingerprint matches, and merge (status/paidAt/txHash/payer from chain; client details from the link). Throw a clear error if the link is tampered with or the invoice isn't on-chain.
   - getCrossChainQuote -> POST /api/quote using the invoice amount.
   - payOnNear -> call pay_invoice with the on-chain amount_yocto attached; return the real tx hash.
   - listMyInvoices(accountId) -> get_invoices_by_recipient from the contract; merge in client details from localStorage when available; otherwise show "Private invoice" as the client name.

4) Minimal UI additions in App.tsx (match the existing style):
   - On the pay page: a small line "✓ Link verified against on-chain record" (or a red warning if the fingerprint doesn't match), and the NEAR amount ("≈ 41.2 NEAR at $6.07").
   - In the proof modal: show the extra proof fields if present.
   - Explorer links -> https://testnet.nearblocks.io/txns/{hash}.
   - Friendly error toasts for wallet rejections and RPC errors.

5) Remove the unused @supabase/supabase-js dependency. Run typecheck, lint and build, and fix everything.

6) Run the whole flow end to end yourself where possible, and give me a manual test checklist for the parts that need my wallet clicks: create invoice -> open link in another browser -> pay with a second testnet account -> dashboard shows Paid. Add the resulting tx hashes to RESULTS.md.
```

**You check:** do the full flow yourself with two testnet accounts (one freelancer, one client). The payment shows on testnet.nearblocks.io and the dashboard says Paid.

---

## PHASE 4: Ship it (README for judges, deploy, repo hygiene)

```
Read CLAUDE.md first. Phases 1–3 are done and the full flow works.

PHASE 4: make the repo judge-ready. The judges include AI judges (Claude Code and Codex) that clone the repo, try to run it, and check the README's claims. Write for both humans and machines. No marketing fluff.

1) README.md with these sections:
   - One bold sentence: what PayMe is.
   - Live demo link (Vercel) + demo post on X (placeholder I'll fill in) + contract account link on nearblocks.
   - The problem (freelancers in Africa: high remittance fees around 8–9% for $200 into Sub-Saharan Africa, cross-chain friction, AI tools leaking private business data). Keep it short and factual.
   - How it works: numbered end-to-end flow, plus a mermaid architecture diagram (browser -> /api -> NEAR AI Cloud TEE; browser -> /api -> 1Click; browser -> wallet -> payme contract on testnet).
   - "How NEAR is used" table: NEAR AI Cloud (TEE inference + attestation verification, which file), NEAR Intents 1Click (dry-run quotes, which file), the smart contract (methods, which file), NEAR named accounts + wallet (which file).
   - Privacy model: what is stored where (link vs chain vs server: nothing).
   - "Try it in 3 minutes" for judges with "do X, see Y" steps: (a) open live demo, paste the sample invoice, click Read with private AI -> see TEE verified badge; (b) create link -> see link + QR; (c) open link in an incognito window -> see invoice + "Link verified against on-chain record"; (d) Pay from another chain tab -> see a live NEAR Intents quote; (e) Pay on NEAR with a testnet wallet -> see Paid + explorer link.
   - Run locally (Windows/Mac/Linux): prerequisites, .env setup, npm install, npm run dev, contract test/build/deploy, with the expected output for each.
   - Tests: how to run them and what they cover.
   - Known limitations (be honest): cross-chain quotes are dry-run because NEAR Intents is mainnet-only and this project is zero-cost/testnet; NEAR price conversion uses the live rate; dashboard client names only show on the device that created the invoice (by design); contract not audited.
   - Built during the hackathon: the frontend was generated with Bolt.new and the backend/contract written with Claude Code (AI-assisted), all within Nov 12–14, 2026. List main libraries.
   - License: MIT.

2) LICENSE (MIT, my name), a complete .env.example, .gitignore covering .env, target/, dist/ and node_modules/.

3) Deploy the frontend + /api to Vercel (free Hobby plan): give me exact steps (vercel CLI or dashboard), including which env vars to add. After deploy, test the live URL's 3 endpoints.

4) Git: commit everything with clear messages. Create tag `hackathon-submission`. Check that no secret is committed (scan for keys). Then give me the commands to push to my public GitHub repo.

5) Final self-check, as a judge would: fresh clone into a temp folder, npm install, npm run build, npm run contract:test, and walk through every README step. Fix anything that fails. Give me a short report.
```

**You check:** the live site works, the repo is public, and the README steps work in an incognito window.

---

## If something breaks (use any time)

```
Read CLAUDE.md. This error happened while doing [what you were doing]:

[paste the full error]

Find the root cause, fix it properly (no hacks or fake data), re-run the relevant tests/build, and tell me in 3 lines what was wrong and what you changed.
```

---

## Suggested timeline (Lagos time)
- **Thu afternoon/evening:** Step 0 + Phase 1
- **Thu night / Fri morning:** Phase 2
- **Fri:** Phase 3 (full flow working by Fri night)
- **Sat morning:** Phase 4 + deploy
- **Sat afternoon:** record demo video, post on X, submit the form
- **Hard deadline:** Sun 15 Nov, 12:59 AM Lagos (14 Nov 23:59 UTC). Aim to submit by Sat 9 PM.
