import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, FALLBACK_PROVIDER } from "../api/parse-invoice.js";

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:5173/api/parse-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost:5173", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const SAMPLE = "Invoice to Acme Ltd for logo design, $250, due November 30, 2026. Payment to tunde.testnet.";

describe("POST /api/parse-invoice", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.NEAR_AI_API_KEY;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.NEAR_AI_API_KEY;
    else process.env.NEAR_AI_API_KEY = savedKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the labelled local fallback (verified: false) when no key is configured", async () => {
    delete process.env.NEAR_AI_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(req({ text: SAMPLE }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: unknown; attestation: { verified: boolean; provider: string; signature: string; reason: string } };
    expect(body.draft).toEqual({ clientName: "Acme Ltd", description: "logo design", amountUsd: 250, dueDate: "2026-11-30", recipient: "tunde.testnet" });
    expect(body.attestation.verified).toBe(false);
    expect(body.attestation.provider).toBe(FALLBACK_PROVIDER);
    expect(body.attestation.signature).toBe("");
    expect(body.attestation.reason).toMatch(/NEAR_AI_API_KEY is not configured/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back (verified: false) and never logs the invoice text when NEAR AI Cloud fails", async () => {
    process.env.NEAR_AI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid or expired API key" } }), { status: 401 })));
    const res = await POST(req({ text: SAMPLE }));
    const body = (await res.json()) as { draft: unknown; attestation: { verified: boolean; provider: string; signature: string; reason: string } };
    expect(body.attestation.verified).toBe(false);
    expect(body.attestation.provider).toBe(FALLBACK_PROVIDER);
    expect(body.attestation.reason).toMatch(/HTTP 401 \(Invalid or expired API key\)/);
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged).not.toContain("Acme");
    expect(logged).not.toContain("tunde");
  });

  it("validates input", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ text: "   " }))).status).toBe(400);
    expect((await POST(req({ text: "x".repeat(4001) }))).status).toBe(400);
    expect((await POST(req("{not json"))).status).toBe(400);
    expect((await POST(req({ text: 5 }))).status).toBe(400);
    expect((await POST(req({ text: SAMPLE }, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(req({ text: SAMPLE }, { Origin: "https://evil.example" }))).status).toBe(403);
  });
});
