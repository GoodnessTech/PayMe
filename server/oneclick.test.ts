import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildQuoteRequest,
  clearTokensCache,
  findDestinationUsdc,
  findNearPrice,
  findOriginAsset,
  formatUnits,
  getDryQuote,
  getTokens,
  mapQuoteResponse,
  PLACEHOLDER_REFUND,
  toBaseUnits,
  type OneClickToken,
} from "./oneclick.js";
import { HttpError } from "./http.js";

// Real entries from GET https://1click.chaindefuser.com/v0/tokens (2026-11-13).
const T = (blockchain: string, symbol: string, decimals: number, assetId: string, price = 1): OneClickToken => ({
  blockchain,
  symbol,
  decimals,
  assetId,
  price,
  priceUpdatedAt: "2026-11-13T08:15:01.316Z",
});
const TOKENS: OneClickToken[] = [
  T("near", "wNEAR", 24, "nep141:wrap.near", 3.53),
  T("near", "USDC", 6, "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"),
  T("base", "USDC", 6, "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"),
  T("base", "ETH", 18, "nep141:base.omft.near", 1934.48),
  T("eth", "USDC", 6, "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near"),
  T("eth", "USDT", 6, "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near"),
  T("eth", "ETH", 18, "nep141:eth.omft.near", 1934.48),
  T("sol", "SOL", 9, "nep141:sol.omft.near", 79.8),
  T("sol", "USDC", 6, "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"),
  T("arb", "USDC", 6, "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"),
  T("btc", "BTC", 8, "nep141:btc.omft.near", 68685),
];

describe("token mapping", () => {
  it("maps every UI chain/token that exists to a real asset id", () => {
    expect(findOriginAsset(TOKENS, "Base", "USDC").assetId).toBe("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near");
    expect(findOriginAsset(TOKENS, "Ethereum", "USDT").assetId).toBe("nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near");
    expect(findOriginAsset(TOKENS, "Solana", "SOL").assetId).toBe("nep141:sol.omft.near");
    expect(findOriginAsset(TOKENS, "Arbitrum", "USDC").assetId).toBe("nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near");
    expect(findOriginAsset(TOKENS, "Bitcoin", "BTC").assetId).toBe("nep141:btc.omft.near");
    expect(findDestinationUsdc(TOKENS).assetId).toBe("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
  });

  it("gives a clear 400 for combos that don't exist", () => {
    expect(() => findOriginAsset(TOKENS, "Base", "SOL")).toThrow("SOL on Base is not available via NEAR Intents. Available on Base: USDC, ETH");
    expect(() => findOriginAsset(TOKENS, "Bitcoin", "USDC")).toThrow(/USDC on Bitcoin is not available/);
    expect(() => findOriginAsset(TOKENS, "Dogecoin", "USDC")).toThrow(/Unsupported chain/);
    expect(() => findOriginAsset(TOKENS, "Base", "DAI")).toThrow(/Unsupported token/);
    try {
      findOriginAsset(TOKENS, "Base", "SOL");
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
    }
  });

  it("reads the NEAR price from wNEAR", () => {
    expect(findNearPrice(TOKENS)).toEqual({ usd: 3.53, priceUpdatedAt: "2026-11-13T08:15:01.316Z" });
    expect(() => findNearPrice(TOKENS.filter((t) => t.symbol !== "wNEAR"))).toThrow(/wNEAR price not found/);
  });
});

describe("unit conversion", () => {
  it("converts exactly", () => {
    expect(toBaseUnits(250, 6)).toBe("250000000");
    expect(toBaseUnits(0.1, 6)).toBe("100000");
    expect(toBaseUnits(1234.56, 6)).toBe("1234560000");
    expect(toBaseUnits(19.99, 24)).toBe("19990000000000000000000000");
    expect(formatUnits("252576020", 6)).toBe("252.57602");
    expect(formatUnits("368869", 8)).toBe("0.00368869");
    expect(formatUnits("130956588678570424", 18)).toBe("0.130956588678570424");
    expect(formatUnits("5000000", 6)).toBe("5");
  });
});

describe("quote request", () => {
  const destination = findDestinationUsdc(TOKENS);
  it("is a dry EXACT_OUTPUT quote for USDC on NEAR with a placeholder refund", () => {
    const origin = findOriginAsset(TOKENS, "Base", "USDC");
    const now = Date.parse("2026-11-13T08:00:00Z");
    expect(buildQuoteRequest({ origin, destination, amountUsd: 250, recipient: "intents.near", now })).toEqual({
      dry: true,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination.assetId,
      amount: "250000000",
      refundTo: PLACEHOLDER_REFUND.base,
      refundType: "ORIGIN_CHAIN",
      recipient: "intents.near",
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-13T08:15:00.000Z",
    });
  });
  it("gives Bitcoin a longer deadline and a Bitcoin refund address", () => {
    const origin = findOriginAsset(TOKENS, "Bitcoin", "BTC");
    const r = buildQuoteRequest({ origin, destination, amountUsd: 10, recipient: "intents.near", now: 0 });
    expect(r.deadline).toBe(new Date(2 * 60 * 60_000).toISOString());
    expect(r.refundTo).toBe("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
  });
});

describe("quote response mapping", () => {
  it("maps 1Click fields into the Quote type", () => {
    const origin = findOriginAsset(TOKENS, "Bitcoin", "BTC");
    const body = { quote: { amountIn: "368869", amountInFormatted: "0.00368869", amountOut: "250000000", amountOutFormatted: "250.0", timeEstimate: 805 } };
    expect(mapQuoteResponse(body, "Bitcoin", "BTC", origin, findDestinationUsdc(TOKENS))).toEqual({
      originChain: "Bitcoin",
      originToken: "BTC",
      amountIn: "0.00368869",
      amountOutUsdc: "250.00",
      etaSeconds: 805,
      route: "NEAR Intents (1Click)",
      preview: true,
    });
  });
  it("rejects a response without amounts", () => {
    const origin = findOriginAsset(TOKENS, "Base", "USDC");
    expect(() => mapQuoteResponse({}, "Base", "USDC", origin, findDestinationUsdc(TOKENS))).toThrow(/without amounts/);
  });
});

describe("getDryQuote with mocked fetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    clearTokensCache();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v0/tokens")) return new Response(JSON.stringify(TOKENS), { status: 200 });
      if (url.endsWith("/v0/quote")) {
        const req = JSON.parse(String(init?.body));
        if (req.originAsset === "nep141:sol.omft.near") return new Response(JSON.stringify({ message: "refundTo is not valid" }), { status: 400 });
        return new Response(
          JSON.stringify({ quote: { amountIn: "252576020", amountOut: req.amount, timeEstimate: 35 }, quoteRequest: req }),
          { status: 201 },
        );
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ONECLICK_JWT;
    delete process.env.INTENTS_QUOTE_RECIPIENT;
  });

  it("requests tokens once (cached), then a dry quote, and maps it", async () => {
    process.env.INTENTS_QUOTE_RECIPIENT = "someone.near";
    const q1 = await getDryQuote(250, "Base", "USDC");
    await getDryQuote(100, "Base", "USDC");
    expect(q1).toEqual({ originChain: "Base", originToken: "USDC", amountIn: "252.57602", amountOutUsdc: "250.00", etaSeconds: 35, route: "NEAR Intents (1Click)", preview: true });
    const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/v0/tokens"));
    expect(tokenCalls).toHaveLength(1);
    const sent = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(sent.dry).toBe(true);
    expect(sent.recipient).toBe("someone.near");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("sends the JWT when ONECLICK_JWT is set", async () => {
    process.env.ONECLICK_JWT = "test-jwt";
    await getDryQuote(5, "Base", "USDC");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer test-jwt");
  });

  it("turns a 1Click 400 into a clear error", async () => {
    await expect(getDryQuote(5, "Solana", "SOL")).rejects.toThrow("NEAR Intents could not quote SOL on Solana: refundTo is not valid");
  });

  it("re-fetches tokens after the cache expires", async () => {
    await getTokens(60_000, 1_000);
    await getTokens(60_000, 30_000);
    await getTokens(60_000, 62_000);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/v0/tokens"))).toHaveLength(2);
  });
});
