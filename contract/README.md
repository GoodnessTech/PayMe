# PayMe contract (NEAR testnet)

A Rust smart contract (near-sdk 5.30) that records PayMe invoices and settles them with real testnet NEAR.

**Privacy model.** The contract stores only what's needed to settle an invoice: id, creator, recipient, amount, a `fingerprint`, status, timestamps and payer. The client name and description never reach the chain. They live in the payment link after `#`. The `fingerprint` is the lowercase hex sha256 of that link data, so the pay page can detect a tampered link.

**No admin powers.** There is no owner and no withdraw method. Invoice money passes straight through the contract within the payment transaction.

## Methods

### Change methods

| Method | Deposit | What it does |
|---|---|---|
| `create_invoice(id, recipient, amount_yocto, amount_usd_cents, fingerprint) -> Invoice` | storage cost (0.01 NEAR is plenty) | Stores a `Pending` invoice and adds it to the recipient's index. Measures the storage bytes the call used, requires the attached deposit to cover them (`bytes × storage_byte_cost`), and refunds the rest to the caller. Emits `invoice_created`. |
| `pay_invoice(id) -> bool` | ≥ `amount_yocto` | Requires the invoice to be `Pending` and the deposit to be at least `amount_yocto`. Marks it `Paid` with `payer` and `paid_at_ms`, transfers `amount_yocto` to the recipient, and refunds any excess to the payer. Its `on_payout` callback returns `true` and emits `invoice_paid`. If the transfer to the recipient fails (e.g. the account doesn't exist), the callback reopens the invoice, refunds the payer, emits `invoice_payment_reverted`, and returns `false`. |
| `on_payout(id, payer, amount_yocto) -> bool` | — | `#[private]` callback. Only the contract itself can call it. |

`create_invoice` rejects the following:
- a duplicate id
- an empty id
- an id longer than 64 characters
- an id containing anything other than `[A-Za-z0-9_-]`
- a fingerprint that isn't 64 hex characters (uppercase is accepted and stored lowercase)
- `amount_yocto == 0` or `amount_usd_cents == 0`
- a deposit that doesn't cover storage

`pay_invoice` rejects an unknown id, an already-paid invoice, and an underpayment.

### View methods

| Method | Returns |
|---|---|
| `get_invoice(id)` | `Invoice` or `null` |
| `get_invoices_by_recipient(account_id, from_index?, limit?)` | `Invoice[]`, newest first. `from_index` counts from the newest invoice (0 = newest). `limit` defaults to 20, max 100. |
| `get_invoice_count_by_recipient(account_id)` | `number` |

`Invoice` JSON:

```json
{
  "id": "inv-1", "creator": "a.testnet", "recipient": "b.testnet",
  "amount_yocto": "1000000000000000000000000", "amount_usd_cents": 25000,
  "fingerprint": "<64 hex>", "status": "Pending",
  "created_at_ms": 1731400000000, "paid_at_ms": null, "payer": null
}
```

### Events (NEP-297)

Events are logged as `EVENT_JSON:{"standard":"payme","version":"1.0.0","event":"…","data":{…}}`:

| Event | Data fields |
|---|---|
| `invoice_created` | `id`, `creator`, `recipient`, `amount_yocto`, `amount_usd_cents`, `fingerprint` |
| `invoice_paid` | `id`, `payer`, `recipient`, `amount_yocto` |
| `invoice_payment_reverted` | `id`, `payer`, `amount_yocto` (only if forwarding the payment failed) |

## Prerequisites (Windows / macOS / Linux)

Tested with Rust 1.99.1, cargo-near 0.23.0 and near-cli-rs 0.31.1 on Windows 11.

- Rust (via rustup) ≥ 1.95, which near-sdk 5.30 requires, plus `rustup target add wasm32-unknown-unknown`
- Windows only: Visual Studio Build Tools with "Desktop development with C++"
- [cargo-near](https://github.com/near/cargo-near). On Windows: `irm https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.ps1 | iex`, or download `cargo-near-x86_64-pc-windows-msvc.tar.gz` from its GitHub releases and put `cargo-near.exe` on your PATH
- [near-cli-rs](https://github.com/near/near-cli-rs). On Windows: `irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 | iex`, or `npm install -g near-cli-rs@latest`

## Test, build, deploy

Run these from the repo root:

```powershell
npm run contract:test     # cargo test: 25 unit tests -> "test result: ok. 25 passed; 0 failed"
npm run contract:build    # cargo near build non-reproducible-wasm --no-abi -> contract/target/near/payme_contract.wasm (~154 KB)
npm run contract:deploy   # builds, then deploys to VITE_CONTRACT_ID from .env (testnet, legacy keychain)
```

Windows notes. Both are already handled, so you don't need to do anything:
- **`--no-abi`.** cargo-near's optional ABI step links the contract as a native DLL. MSVC rejects that DLL because the NEAR host functions (`log_utf8`, `input`, …) only exist inside the NEAR runtime. Skipping the ABI step doesn't change the deployed contract's behaviour.
- **`contract/.cargo/config.toml`** sets `AWS_LC_SYS_PREBUILT_NASM=1`. near-sdk's unit-testing dependencies build `aws-lc-sys`, which otherwise needs the NASM assembler on Windows. The setting makes it use the prebuilt objects shipped in the crate. The npm scripts `cd contract` so cargo picks up this config.

`contract:deploy` signs with the key that near-cli-rs saved in its legacy keychain (`~/.near-credentials/testnet/<account>.json`). The contract has no init method (it uses `Default`), so the deploy runs without an init call.

### Creating a testnet account and calling the contract by hand

```powershell
# Free testnet account, funded by the faucet, key saved in the legacy keychain
near account create-account sponsor-by-faucet-service my-payme.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create

# Create an invoice (as the freelancer), attaching 0.01 NEAR for storage (excess refunded)
near contract call-function as-transaction payme-invoices.testnet create_invoice json-args '{"id":"inv-1","recipient":"freelancer.testnet","amount_yocto":"100000000000000000000000","amount_usd_cents":50,"fingerprint":"<64 hex>"}' prepaid-gas '30 Tgas' attached-deposit '0.01 NEAR' sign-as freelancer.testnet network-config testnet sign-with-legacy-keychain send

# Pay it (as the client)
near contract call-function as-transaction payme-invoices.testnet pay_invoice json-args '{"id":"inv-1"}' prepaid-gas '50 Tgas' attached-deposit '0.1 NEAR' sign-as client.testnet network-config testnet sign-with-legacy-keychain send

# Read it
near contract call-function as-read-only payme-invoices.testnet get_invoice json-args '{"id":"inv-1"}' network-config testnet now
```

In PowerShell, `json-args` needs care with quotes. If PowerShell strips the inner `"` characters, escape them as `\"`.

## Integration tests

This repo has no sandbox integration tests. NEAR's local sandbox (`near-sandbox-rs`, which near-workspaces uses) only runs on macOS (ARM64) or Linux (x86) according to its README, and PayMe was developed on Windows. Coverage comes from two other places:
- **Unit tests** (`npm run contract:test`) cover every method and every rejection case, including the payout callback's success and failure paths, using near-sdk's mocked blockchain.
- **A live testnet smoke test** covers the real `create_invoice` → `pay_invoice` → `get_invoice` flow with three real accounts. The transactions are linked in [../RESULTS.md](../RESULTS.md).
