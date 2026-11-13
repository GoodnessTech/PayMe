# PayMe: verifiable results

All transactions are on **NEAR testnet**. Anyone can check them on the explorer.

## Phase 1: smart contract

**Contract account:** [`payme-invoices.testnet`](https://testnet.nearblocks.io/address/payme-invoices.testnet)

| | |
|---|---|
| Source | [`contract/src/lib.rs`](contract/src/lib.rs) (near-sdk 5.30.1, Rust 1.99.1, cargo-near 0.23.0) |
| WASM | `contract/target/near/payme_contract.wasm`, 154,304 bytes |
| WASM sha256 (hex) | `ae0a823f59e470a1d9692f100200ee5ed4a3eac8c879add69eacbafe573e63bc` |
| Code hash (bs58, shown on-chain) | `CiPEYFcGJAGVU6iwn6DkY5xatCR5b81B5hEFiv82b4NF` |
| Deployed | 2026-11-12 |

### Unit tests

`npm run contract:test`: **25 passed, 0 failed**. They cover every method and every rejection case: duplicate id, empty, oversized and invalid ids, bad fingerprint, zero amounts, missing storage deposit, underpayment, paying twice, unknown invoice, the excess refund, the storage refund, the payout callback's success and failure paths, and pagination.

### Live smoke test (create → pay → read)

Accounts used:

| Account | Role |
|---|---|
| `payme-invoices.testnet` | the contract |
| `payme-freelancer-demo.testnet` | invoice creator and recipient |
| `payme-client-demo.testnet` | payer |

All three were created free with near-cli-rs `sponsor-by-faucet-service`.

Invoice `smoke-mwemw8w4`: 0.1 NEAR (`amount_usd_cents: 50`). Its fingerprint, `cd265813fd0d0bc7ff886b58b2d52b3284a055c8841a4281e121010aad7b58ca`, is the sha256 of the link-data JSON (client name and description). That JSON never went on-chain.

| Step | Transaction | Result |
|---|---|---|
| Deploy contract | [`E46WhRrsyekJeWJwc3MnRP4FQHEXHM4pt9WyBnWJoLbY`](https://testnet.nearblocks.io/txns/E46WhRrsyekJeWJwc3MnRP4FQHEXHM4pt9WyBnWJoLbY) | code deployed |
| `create_invoice`, signed by the freelancer, 0.01 NEAR attached for storage | [`Ajb6xQTDL7vDAu9agit4rYvqb5ikA8sBB7saGTUKkFQk`](https://testnet.nearblocks.io/txns/Ajb6xQTDL7vDAu9agit4rYvqb5ikA8sBB7saGTUKkFQk) | `invoice_created` event, status `Pending`, unused storage deposit refunded |
| `pay_invoice`, signed by the client, **0.15 NEAR** attached for a 0.1 NEAR invoice | [`5p9UNXpsny6oUY9WjSHJ5tLccJnREFayWZMxcuVd25J6`](https://testnet.nearblocks.io/txns/5p9UNXpsny6oUY9WjSHJ5tLccJnREFayWZMxcuVd25J6) | 0.1 NEAR sent to the freelancer, 0.05 NEAR refunded to the client, `invoice_paid` event, returned `true` |
| `get_invoice` (view) | — | `status: "Paid"`, `payer: "payme-client-demo.testnet"`, `paid_at_ms: 1794553665552` |

Balances after the test, starting from 10 NEAR each:

| Account | Balance | Explanation |
|---|---|---|
| freelancer | 10.0951 NEAR | +0.1 payment, minus ≈0.0046 NEAR storage for the invoice and gas |
| client | 9.8995 NEAR | −0.1 payment and gas; the 0.05 excess came back |

The contract keeps none of the 0.1 NEAR.

Negative checks run on-chain (both expected to fail):

| Check | Transaction | Result |
|---|---|---|
| Pay the same invoice again | [`9mFAfPuXE4pzM7fLxsRdJhXRnQRXfTzHf3nd6YEw1cw7`](https://testnet.nearblocks.io/txns/9mFAfPuXE4pzM7fLxsRdJhXRnQRXfTzHf3nd6YEw1cw7) | `Smart contract panicked: Invoice is already paid`; the deposit was refunded |
| Call the `#[private]` callback `on_payout` from an outside account | [`GyLv1sUjVWLpsqzhEmFBK9yGLJeKW7u995r7ZAhcCr1P`](https://testnet.nearblocks.io/txns/GyLv1sUjVWLpsqzhEmFBK9yGLJeKW7u995r7ZAhcCr1P) | `Smart contract panicked: Method on_payout is private` |

Reproduce the read yourself:

```powershell
near contract call-function as-read-only payme-invoices.testnet get_invoice json-args '{"id":"smoke-mwemw8w4"}' network-config testnet now
```
