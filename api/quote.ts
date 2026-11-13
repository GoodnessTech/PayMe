// POST /api/quote  { amountUsd, chain, token } -> Quote
// Live NEAR Intents (1Click) DRY-RUN quote: "pay with <token> on <chain>,
// freelancer receives exactly amountUsd USDC on NEAR". No funds move.

import { assertMethod, assertSameOrigin, errorResponse, HttpError, json, readJsonBody } from "./_lib/http.js";
import { MAX_AMOUNT_USD } from "./_lib/invoice.js";
import { getDryQuote } from "./_lib/oneclick.js";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertMethod(request, "POST");
    const body = await readJsonBody(request);
    const amountUsd = body.amountUsd;
    const chain = body.chain;
    const token = body.token;
    if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > MAX_AMOUNT_USD) {
      throw new HttpError(400, `"amountUsd" must be a number between 0 and ${MAX_AMOUNT_USD}`);
    }
    if (Math.abs(amountUsd * 100 - Math.round(amountUsd * 100)) > 1e-6) {
      throw new HttpError(400, '"amountUsd" must have at most 2 decimal places');
    }
    if (typeof chain !== "string" || typeof token !== "string") throw new HttpError(400, '"chain" and "token" are required strings');
    return json(await getDryQuote(Math.round(amountUsd * 100) / 100, chain, token));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(): Promise<Response> {
  return errorResponse(new HttpError(405, "Method not allowed, use POST"));
}
