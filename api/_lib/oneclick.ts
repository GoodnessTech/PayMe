// NEAR Intents 1Click API client (dry-run quotes only; no funds ever move).
// Docs: https://docs.near-intents.org (1Click API), spec: https://1click.chaindefuser.com/docs/v0/openapi.yaml

import { fetchWithTimeout, HttpError } from "./http.js";

export const ONECLICK_BASE_URL = "https://1click.chaindefuser.com";
export const TOKENS_TTL_MS = 10 * 60_000;
export const SLIPPAGE_BPS = 100; // 1%
export const DEFAULT_QUOTE_RECIPIENT = "intents.near";

export type OneClickToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string | null;
};

/** Same shape as the frontend's Quote type (src/lib/api.ts). */
export type Quote = {
  originChain: string;
  originToken: string;
  amountIn: string;
  amountOutUsdc: string;
  etaSeconds: number;
  route: string;
  preview: boolean;
};

/** UI chain names -> 1Click blockchain ids. */
export const CHAINS: Record<string, string> = {
  Base: "base",
  Ethereum: "eth",
  Solana: "sol",
  Arbitrum: "arb",
  Bitcoin: "btc",
};
export const TOKENS = ["USDC", "USDT", "ETH", "SOL", "BTC"] as const;

/**
 * Placeholder refund addresses, one valid address format per origin chain.
 * DRY RUN ONLY: 1Click requires a syntactically valid `refundTo` on the origin
 * chain even for `dry: true` quotes, but a dry quote returns no deposit
 * address, so nothing can be deposited and nothing is ever refunded here.
 * A real (non-dry) swap must use the payer's own address instead.
 * (0x...dEaD and the Solana System Program id are rejected by 1Click.)
 */
export const PLACEHOLDER_REFUND: Record<string, string> = {
  base: "0x1111111111111111111111111111111111111111",
  eth: "0x1111111111111111111111111111111111111111",
  arb: "0x1111111111111111111111111111111111111111",
  sol: "So11111111111111111111111111111111111111112",
  btc: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
};

let tokensCache: { at: number; tokens: OneClickToken[] } | null = null;

export function clearTokensCache(): void {
  tokensCache = null;
}

/** When the cached token list was fetched from 1Click (ISO), or null. */
export function tokensFetchedAt(): string | null {
  return tokensCache ? new Date(tokensCache.at).toISOString() : null;
}

function authHeaders(): Record<string, string> {
  const jwt = process.env.ONECLICK_JWT?.trim();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

/** GET /v0/tokens, cached (10 min for asset mapping; callers needing fresher prices pass a shorter maxAge). */
export async function getTokens(maxAgeMs = TOKENS_TTL_MS, now = Date.now()): Promise<OneClickToken[]> {
  if (tokensCache && now - tokensCache.at < maxAgeMs) return tokensCache.tokens;
  const res = await fetchWithTimeout(`${ONECLICK_BASE_URL}/v0/tokens`, { headers: { Accept: "application/json", ...authHeaders() } });
  if (!res.ok) throw new HttpError(502, `1Click tokens request failed (HTTP ${res.status})`);
  const tokens = (await res.json()) as OneClickToken[];
  if (!Array.isArray(tokens)) throw new HttpError(502, "1Click tokens response was not a list");
  tokensCache = { at: now, tokens };
  return tokens;
}

/** Map a UI (chain, token) choice to a real 1Click asset, or explain why it doesn't exist. */
export function findOriginAsset(tokens: OneClickToken[], chain: string, token: string): OneClickToken {
  const blockchain = CHAINS[chain];
  if (!blockchain) throw new HttpError(400, `Unsupported chain "${chain}". Use one of: ${Object.keys(CHAINS).join(", ")}`);
  if (!(TOKENS as readonly string[]).includes(token)) {
    throw new HttpError(400, `Unsupported token "${token}". Use one of: ${TOKENS.join(", ")}`);
  }
  const asset = tokens.find((t) => t.blockchain === blockchain && t.symbol.toUpperCase() === token);
  if (!asset) {
    const available = tokens.filter((t) => t.blockchain === blockchain && (TOKENS as readonly string[]).includes(t.symbol.toUpperCase())).map((t) => t.symbol.toUpperCase());
    throw new HttpError(400, `${token} on ${chain} is not available via NEAR Intents.${available.length ? ` Available on ${chain}: ${[...new Set(available)].join(", ")}` : ""}`);
  }
  return asset;
}

/** USDC on NEAR (the freelancer's payout asset). */
export function findDestinationUsdc(tokens: OneClickToken[]): OneClickToken {
  const usdc = tokens.find((t) => t.blockchain === "near" && t.symbol === "USDC");
  if (!usdc) throw new HttpError(502, "USDC on NEAR not found in the 1Click token list");
  return usdc;
}

/** Native NEAR price in USD, from wNEAR in the 1Click token list. */
export function findNearPrice(tokens: OneClickToken[]): { usd: number; priceUpdatedAt: string } {
  const wnear = tokens.find((t) => t.blockchain === "near" && t.assetId === "nep141:wrap.near");
  if (!wnear || !(wnear.price > 0)) throw new HttpError(502, "wNEAR price not found in the 1Click token list");
  return { usd: wnear.price, priceUpdatedAt: wnear.priceUpdatedAt };
}

/** USD (dollars) -> smallest units of a token with `decimals` decimals, exact via strings. */
export function toBaseUnits(amount: number, decimals: number): string {
  const [whole, frac = ""] = amount.toFixed(Math.min(decimals, 6)).split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

/** Smallest units -> human-readable decimal string (trailing zeros trimmed). */
export function formatUnits(amount: string, decimals: number): string {
  const v = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function buildQuoteRequest(params: {
  origin: OneClickToken;
  destination: OneClickToken;
  amountUsd: number;
  recipient: string;
  now?: number;
}) {
  const { origin, destination, amountUsd, recipient } = params;
  const now = params.now ?? Date.now();
  // Bitcoin deposits need longer to confirm; everything else gets a short deadline.
  const deadlineMs = origin.blockchain === "btc" ? 2 * 60 * 60_000 : 15 * 60_000;
  return {
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: destination.assetId,
    amount: toBaseUnits(amountUsd, destination.decimals), // exact USDC the freelancer receives
    refundTo: PLACEHOLDER_REFUND[origin.blockchain],
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + deadlineMs).toISOString(),
  };
}

type OneClickQuoteResponse = {
  quote?: {
    amountIn?: string;
    amountInFormatted?: string;
    amountOut?: string;
    amountOutFormatted?: string;
    timeEstimate?: number;
  };
  message?: string;
};

export function mapQuoteResponse(
  body: OneClickQuoteResponse,
  chain: string,
  token: string,
  origin: OneClickToken,
  destination: OneClickToken,
): Quote {
  const q = body.quote;
  if (!q?.amountIn || !q.amountOut) throw new HttpError(502, "1Click returned a quote without amounts");
  return {
    originChain: chain,
    originToken: token,
    amountIn: formatUnits(q.amountIn, origin.decimals),
    amountOutUsdc: Number(formatUnits(q.amountOut, destination.decimals)).toFixed(2),
    etaSeconds: typeof q.timeEstimate === "number" ? q.timeEstimate : 0,
    route: "NEAR Intents (1Click)",
    preview: true,
  };
}

export async function getDryQuote(amountUsd: number, chain: string, token: string): Promise<Quote> {
  const tokens = await getTokens();
  const origin = findOriginAsset(tokens, chain, token);
  const destination = findDestinationUsdc(tokens);
  const recipient = process.env.INTENTS_QUOTE_RECIPIENT?.trim() || DEFAULT_QUOTE_RECIPIENT;
  const requestBody = buildQuoteRequest({ origin, destination, amountUsd, recipient });

  const res = await fetchWithTimeout(`${ONECLICK_BASE_URL}/v0/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...authHeaders() },
    body: JSON.stringify(requestBody),
  });
  const body = (await res.json().catch(() => ({}))) as OneClickQuoteResponse;
  if (!res.ok) {
    const msg = body.message && body.message !== "Internal server error" ? body.message : `HTTP ${res.status}`;
    throw new HttpError(res.status >= 500 ? 502 : 422, `NEAR Intents could not quote ${token} on ${chain}: ${msg}`);
  }
  return mapQuoteResponse(body, chain, token, origin, destination);
}
