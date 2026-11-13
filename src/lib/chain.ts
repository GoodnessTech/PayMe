// Pure helpers shared by api.ts: on-chain record types, NEAR unit conversion,
// merging chain + link data, and user-facing error messages. No network/wallet code.

import type { LinkData } from "./link";

export const YOCTO_PER_NEAR = 10n ** 24n;
/** Storage deposit attached to create_invoice; the contract refunds what it doesn't use. */
export const CREATE_STORAGE_DEPOSIT_YOCTO = (10n ** 22n).toString(); // 0.01 NEAR
export const CREATE_GAS = "30000000000000"; // 30 Tgas
export const PAY_GAS = "50000000000000"; // 50 Tgas (transfer + on_payout callback)

/** Invoice as returned by the contract's get_invoice / get_invoices_by_recipient. */
export type ChainInvoice = {
  id: string;
  creator: string;
  recipient: string;
  amount_yocto: string;
  amount_usd_cents: number;
  fingerprint: string;
  status: "Pending" | "Paid";
  created_at_ms: number;
  paid_at_ms: number | null;
  payer: string | null;
};

/**
 * USD -> yoctoNEAR at a USD/NEAR price. Exact integer math; the result is
 * rounded to 0.00001 NEAR so amounts display cleanly.
 */
export function usdToYocto(amountUsd: number, nearUsd: number): bigint {
  if (!(amountUsd > 0) || !(nearUsd > 0)) throw new Error("Amount and NEAR price must be positive");
  const cents = BigInt(Math.round(amountUsd * 100));
  const priceMicros = BigInt(Math.round(nearUsd * 1_000_000)); // USD per NEAR * 1e6
  // NEAR = (cents / 100) / (priceMicros / 1e6) = cents * 1e4 / priceMicros
  const step = 10n ** 19n; // 0.00001 NEAR
  const yocto = (cents * 10_000n * YOCTO_PER_NEAR) / priceMicros;
  const rounded = ((yocto + step / 2n) / step) * step;
  return rounded > 0n ? rounded : step;
}

/** yoctoNEAR -> human NEAR string with up to `maxDecimals` decimals (trailing zeros trimmed). */
export function formatNear(yocto: string | bigint, maxDecimals = 4): string {
  const v = BigInt(yocto);
  const whole = v / YOCTO_PER_NEAR;
  const frac = (v % YOCTO_PER_NEAR).toString().padStart(24, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** The USD/NEAR rate that was used when the invoice was created (from the on-chain record). */
export function rateFromChain(inv: Pick<ChainInvoice, "amount_yocto" | "amount_usd_cents">): number {
  const near = Number(BigInt(inv.amount_yocto) / 10n ** 18n) / 1e6; // micro-NEAR precision
  return near > 0 ? Math.round((inv.amount_usd_cents / 100 / near) * 100) / 100 : 0;
}

export function newInvoiceId(now = new Date()): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `PM-${now.getFullYear()}-${suffix}`;
}

/**
 * Check that a decoded link agrees with the on-chain record beyond the
 * fingerprint: same id, recipient and amount. Returns a problem or null.
 */
export function linkMismatch(link: LinkData, chain: ChainInvoice): string | null {
  if (link.id !== chain.id) return "invoice id";
  if (link.recipient !== chain.recipient) return "recipient";
  if (Math.round(link.amountUsd * 100) !== chain.amount_usd_cents) return "amount";
  return null;
}

/** Map a raw error (wallet, RPC, API) to a short friendly message. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const msg = raw || "Something went wrong.";
  if (/reject|cancel|denied|declined|closed|user abort|not approved/i.test(msg)) return "You cancelled the request in your wallet. Nothing was sent.";
  if (/popup|blocked/i.test(msg)) return "Your browser blocked the wallet window. Allow pop-ups for this site and try again.";
  if (/not enough balance|NotEnoughBalance|LackBalanceForState|insufficient/i.test(msg)) return "Your testnet account doesn't have enough NEAR for this. Get free testnet NEAR from the faucet and retry.";
  if (/failed to fetch|networkerror|load failed|timed out|timeout|ECONN|429|rate limit/i.test(msg)) {
    return "Couldn't reach NEAR testnet right now. Check your connection and try again.";
  }
  return msg.length > 220 ? `${msg.slice(0, 217)}...` : msg;
}
