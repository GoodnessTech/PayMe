// POST /api/parse-invoice  { text } -> { draft: InvoiceDraft, attestation: Attestation }
// Parses invoice text privately with NEAR AI Cloud (TEE) and verifies the
// attestation + response signature. Falls back to a clearly labelled local
// regex parser (verified: false) if NEAR AI Cloud is not configured or fails.
// The invoice text is never logged or stored.

import { assertMethod, assertSameOrigin, errorResponse, HttpError, json, readJsonBody } from "./_lib/http.js";
import { fallbackParse, MAX_INVOICE_TEXT } from "./_lib/invoice.js";
import { DEFAULT_NEAR_AI_MODEL, parseWithNearAi, type AttestationResult } from "./_lib/nearai.js";

export const FALLBACK_PROVIDER = "Local fallback (NEAR AI Cloud unavailable)";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    assertMethod(request, "POST");
    const body = await readJsonBody(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new HttpError(400, '"text" is required');
    if (text.length > MAX_INVOICE_TEXT) throw new HttpError(400, `"text" must be at most ${MAX_INVOICE_TEXT} characters`);

    const apiKey = process.env.NEAR_AI_API_KEY?.trim();
    const model = process.env.NEAR_AI_MODEL?.trim() || DEFAULT_NEAR_AI_MODEL;

    if (apiKey) {
      try {
        return json(await parseWithNearAi(text, apiKey, model));
      } catch (err) {
        // Log only the error (never the invoice text), then fall back.
        const why = err instanceof Error ? err.message : String(err);
        console.error("[parse-invoice] NEAR AI Cloud failed:", why);
        return json(fallback(text, model, `NEAR AI Cloud request failed: ${why}`));
      }
    }
    return json(fallback(text, model, "NEAR_AI_API_KEY is not configured on the server"));
  } catch (err) {
    return errorResponse(err);
  }
}

function fallback(text: string, model: string, reason: string): { draft: ReturnType<typeof fallbackParse>; attestation: AttestationResult } {
  return {
    draft: fallbackParse(text),
    attestation: {
      verified: false,
      model: "local-regex-parser",
      signature: "",
      provider: FALLBACK_PROVIDER,
      reason: `${reason}. Parsed locally with regular expressions (no AI, no TEE, nothing to verify). Intended model: ${model}.`,
    },
  };
}

export async function GET(): Promise<Response> {
  return errorResponse(new HttpError(405, "Method not allowed, use POST"));
}
