// GET /api/near-price -> { usd, source, fetchedAt }
// NEAR/USD from the wNEAR entry of the 1Click token list (cached 60 s). Used to
// convert an invoice's USD amount into testnet NEAR.

import { assertMethod, assertSameOrigin, errorResponse, json } from "../server/http.js";
import { findNearPrice, getTokens, tokensFetchedAt } from "../server/oneclick.js";

export const PRICE_TTL_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertMethod(request, "GET");
    const { usd, priceUpdatedAt } = findNearPrice(await getTokens(PRICE_TTL_MS));
    return json({
      usd,
      source: "NEAR Intents 1Click token list (wNEAR)",
      fetchedAt: tokensFetchedAt() ?? new Date().toISOString(),
      priceUpdatedAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
