# Claims → evidence

Every claim in the [README](../README.md), with where to check it. "Test" means a test that runs in `npm test` (Vitest) or `npm run contract:test` (cargo), with no keys and no network. "Tx" means a real NEAR testnet transaction.

## Privacy

| Claim | Evidence |
|---|---|
| Invoice details (client name, description, due date) are never stored on-chain | Code: the contract's `Invoice` struct holds only `id, creator, recipient, amount_yocto, amount_usd_cents, fingerprint, status, created_at_ms, paid_at_ms, payer` ([`contract/src/lib.rs`](../contract/src/lib.rs)). Check it yourself: `npm run invoice -- PM-2026-V2PN6V` prints the full on-chain record. |
| …and never stored on a server: there is no database | Code: [`api/`](../api) and [`server/`](../server) contain no database or storage code; `/api/parse-invoice` only returns a response ([`api/parse-invoice.ts`](../api/parse-invoice.ts)). |
| Invoice text is never logged on the server | Test: `server/parse-invoice.test.ts › falls back (verified: false) and never logs the invoice text when NEAR AI Cloud fails`. Code: `console.error` in [`api/parse-invoice.ts`](../api/parse-invoice.ts) logs only the error message. |
| The details travel in the link fragment (after `#`) | Code: `encodeLink` / `decodeLink` in [`src/lib/link.ts`](../src/lib/link.ts) and `linkFor` in [`src/lib/api.ts`](../src/lib/api.ts). Browsers never send the fragment to servers (it isn't part of HTTP requests). |
| Dashboard client names only appear on the creating device | Code: `saveLink` / `findSavedLink` (localStorage) and `fromChain` ("Private invoice" when there's no local link data) in [`src/lib/api.ts`](../src/lib/api.ts). |

## NEAR AI Cloud (private AI)

| Claim | Evidence |
|---|---|
| Invoices are parsed by NEAR AI Cloud's OpenAI-compatible API with structured JSON output | Code: `chatCompletion` in [`server/nearai.ts`](../server/nearai.ts) calls `https://cloud-api.near.ai/v1/chat/completions` with a `json_schema` response format. The model output is sanitised by `sanitizeDraft` in [`server/invoice.ts`](../server/invoice.ts) (Test: `server/invoice.test.ts › sanitizeDraft …`). |
| `verified` is true **only** if all 8 checks pass | Code: `verified: failed.length === 0` in `verifyCompletion`, [`server/nearai.ts`](../server/nearai.ts). Test: `server/verify.test.ts › verifyCompletion › is verified only when every check passes`, plus 4 failure tests (different response, wrong signer, signer not attested; stale nonce / bad TDX / debug TD / revoked TCB / failed GPU / unknown kind). |
| The signature covers this exact request and response | Code: `sha256Hex(requestBody)` and `sha256Hex(responseBytes)` (raw bytes, uncompressed) in `chatCompletion`; `expectedSignedText` in [`server/verify.ts`](../server/verify.ts). Test: `fails if the signature is over a different response`. |
| ECDSA (EIP-191) signature recovers to the attested signing address | Code: `recoverEcdsaSigner` (ethers `verifyMessage`) in [`server/verify.ts`](../server/verify.ts). Test: `recovers the EIP-191 signer`, `fails if the claimed signing address did not sign`. Offline: `npm run verify:sample`. |
| Fresh nonce per request, bound into the TDX quote | Code: `randomBytes(32)` in `parseWithNearAi`; `checkReportData` in [`server/verify.ts`](../server/verify.ts). Test: `report_data and compose binding › accepts address + nonce` / `rejects wrong nonce, wrong address, wrong length`. |
| The Intel TDX quote is cryptographically verified | Code: `verifyTdxQuote` uses `getCollateralAndVerify` from `@phala/dcap-qvl`, rejects debug TDs, accepted statuses in `ACCEPTED_TCB_STATUSES` ([`server/verify.ts`](../server/verify.ts)). Real run: `docs/sample-attestation.json` → `"dcap-qvl: TCB UpToDate"`. |
| The signing key is bound to the measured app compose | Code: `checkComposeHash` (MRCONFIGID = `01 ‖ sha256(app_compose)`). Test: `checks MRCONFIGID against sha256(app_compose)`. |
| NVIDIA GPU evidence is checked with NVIDIA NRAS | Code: `verifyGpu` posts to `https://nras.attestation.nvidia.com/v3/attest/gpu` and requires `x-nvidia-overall-att-result: true` and a matching nonce. Test: `verifyGpu (NRAS) with mocked fetch › …`. **Limitation:** the NRAS JWT's own signature isn't verified. |
| A real request passed all 8 checks | Evidence: [`docs/sample-attestation.json`](sample-attestation.json) (captured 2026-11-13). `npm run verify:sample` re-checks the signed text format and the ECDSA recovery offline. Screenshot: [`docs/screenshots/proof-modal.png`](screenshots/proof-modal.png). |
| Without a key, or on failure, a clearly labelled local parser is used and it's never marked verified | Code: `fallback()` in [`api/parse-invoice.ts`](../api/parse-invoice.ts) (`verified: false`, provider `"Local fallback (NEAR AI Cloud unavailable)"`). UI: amber "Local fallback: not private" badge in [`src/App.tsx`](../src/App.tsx). Test: `server/parse-invoice.test.ts › uses the labelled local fallback …`. CI: `scripts/check-vercel-build.mjs` checks the same on the built Vercel function. |

## NEAR Intents (1Click)

| Claim | Evidence |
|---|---|
| Quotes are real 1Click API dry runs | Code: `buildQuoteRequest` (`dry: true`, `swapType: "EXACT_OUTPUT"`, destination USDC on NEAR) and `getDryQuote` calling `https://1click.chaindefuser.com/v0/quote` in [`server/oneclick.ts`](../server/oneclick.ts). Test: `quote request › is a dry EXACT_OUTPUT quote for USDC on NEAR …`. Live: the CI job `vercel-build` calls the built `/api/quote` function. |
| No funds move from the cross-chain card | Code: `dry: true`. A dry quote returns no deposit address, so there is nothing to send to. Placeholder refund addresses are documented in `PLACEHOLDER_REFUND`. |
| UI chain/token choices map to real asset ids; impossible combos give a clear error | Code: `findOriginAsset` in [`server/oneclick.ts`](../server/oneclick.ts). Test: `token mapping › maps every UI chain/token…`, `gives a clear 400 for combos that don't exist`. |
| NEAR/USD price comes from the 1Click token list (wNEAR), cached 60 s | Code: `findNearPrice` + `getTokens(PRICE_TTL_MS)` in [`api/near-price.ts`](../api/near-price.ts). Test: `reads the NEAR price from wNEAR`, `re-fetches tokens after the cache expires`. |

## Smart contract (NEAR testnet)

| Claim | Evidence |
|---|---|
| Deployed at `payme-invoices.testnet` | Tx: deploy [`E46WhRrs…`](https://testnet.nearblocks.io/txns/E46WhRrsyekJeWJwc3MnRP4FQHEXHM4pt9WyBnWJoLbY) ([RESULTS.md](../RESULTS.md)) |
| Caller pays storage; the excess is refunded | Code: `create_invoice` measures `storage_usage` before/after. Test: `create_invoice_charges_storage_and_refunds_excess`, `create_invoice_exact_storage_deposit_has_no_refund`, `create_invoice_rejects_missing_storage_deposit`. |
| Rejects duplicate / empty / oversized ids, bad fingerprints, zero amounts | Tests: `create_invoice_rejects_duplicate_id`, `…_empty_id`, `…_oversized_id`, `…_id_with_invalid_characters`, `…_short_fingerprint`, `…_non_hex_fingerprint`, `…_zero_yocto`, `…_zero_usd_cents` ([`contract/src/tests.rs`](../contract/src/tests.rs)) |
| `pay_invoice` forwards the amount to the recipient and refunds overpayment | Test: `pay_invoice_exact_amount_marks_paid_and_forwards_funds`, `pay_invoice_refunds_excess_to_payer`. Tx: [`5p9UNXps…`](https://testnet.nearblocks.io/txns/5p9UNXpsny6oUY9WjSHJ5tLccJnREFayWZMxcuVd25J6) (0.15 NEAR sent for a 0.1 NEAR invoice; 0.05 refunded) |
| Rejects underpayment, paying twice, unknown invoices | Tests: `pay_invoice_rejects_underpayment`, `…_paying_twice`, `…_unknown_invoice`. Tx: double-pay rejected [`9mFAfPuX…`](https://testnet.nearblocks.io/txns/9mFAfPuXE4pzM7fLxsRdJhXRnQRXfTzHf3nd6YEw1cw7) |
| The contract never keeps invoice money: if the forward fails, the payer is refunded | Code: `on_payout` callback. Test: `on_payout_failure_reopens_invoice_and_refunds_payer`. |
| The callback can't be called by outsiders | Code: `#[private]`. Tx: [`GyLv1sUj…`](https://testnet.nearblocks.io/txns/GyLv1sUjVWLpsqzhEmFBK9yGLJeKW7u995r7ZAhcCr1P) → "Method on_payout is private" |
| No owner/admin powers | Code: no owner field and no withdraw or admin method in [`contract/src/lib.rs`](../contract/src/lib.rs) |
| NEP-297 events `invoice_created`, `invoice_paid` | Test: `create_invoice_stores_record_and_emits_event`, `on_payout_success_emits_invoice_paid`. Tx logs in RESULTS.md. |
| A real payment made from the app is visible on testnet.nearblocks.io | Tx: create [`3mfbpFWA…`](https://testnet.nearblocks.io/txns/3mfbpFWAzhhkD5NMHAfyxKaVAMBYNATK593wQDUC4daA) → pay [`7cb2bMzX…`](https://testnet.nearblocks.io/txns/7cb2bMzX9spEjXmKKmDZRcHCKgVXL7K4q3guVUpbd5dy) (made by clicking through the app with Meteor and MyNearWallet). Check: `npm run invoice -- PM-2026-V2PN6V`. |

## Payment links

| Claim | Evidence |
|---|---|
| The fingerprint detects tampered links | Code: `getInvoice` in [`src/lib/api.ts`](../src/lib/api.ts) recomputes `sha256` of the decoded fragment, compares it with the on-chain `fingerprint` and `linkMismatch` (id/recipient/amount), and throws "…Do not pay it." Tests: `src/lib/link.test.ts › matches the on-chain fingerprint of the Phase 1 smoke invoice`, `fingerprints the exact decoded string (any change alters it)`; `src/lib/chain.test.ts › flags differing id, recipient or amount`. Screenshot: [`pay-tampered.png`](screenshots/pay-tampered.png). The judge steps in the README walk through it. |
| The pay page shows "✓ Link verified against on-chain record" only after that check | Code: [`src/App.tsx`](../src/App.tsx) renders it only once `getInvoice` has resolved, and `getInvoice` throws on any mismatch. |
| The NEAR amount and the rate used are shown | Code: `getPaymentDetails` / `rateFromChain` (from the on-chain `amount_yocto` and `amount_usd_cents`). Test: `formats NEAR and recovers the rate used`. |

## Engineering

| Claim | Evidence |
|---|---|
| Tests need no keys or network | All `fetch` calls in Vitest tests are stubbed (`vi.stubGlobal("fetch", …)`); contract tests use near-sdk's mocked blockchain. CI runs them on a clean Ubuntu runner ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). |
| `npm run dev` works with no `.env` | Code: defaults in `server/nearai.ts` (fallback), `server/oneclick.ts` (`DEFAULT_QUOTE_RECIPIENT`), `src/lib/near.ts` (`DEFAULT_CONTRACT_ID`). |
| 10 s timeout on every external call; same-origin API | Code: `fetchWithTimeout` / `withTimeout` and `assertSameOrigin` in [`server/http.ts`](../server/http.ts). Tests: `validates input` (403 for a foreign Origin); `server/http.test.ts › turns upstream timeouts … into a 504`. |
| Testnet only | Code: [`src/lib/near.ts`](../src/lib/near.ts) throws unless `VITE_NEAR_NETWORK` is `testnet`; [`scripts/deploy-contract.mjs`](../scripts/deploy-contract.mjs) refuses other networks. |
| Deploys to Vercel as-is | CI job `vercel-build`: real `vercel build`, then [`scripts/check-vercel-build.mjs`](../scripts/check-vercel-build.mjs) calls the three built functions. |
