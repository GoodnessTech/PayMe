import { describe, expect, it } from "vitest";
import { decodeLink, decodeLinkString, encodeLink, fingerprint, type LinkData } from "./link";

// Real link from the Phase 1 testnet smoke test; its fingerprint is stored on-chain
// in payme-invoices.testnet (invoice smoke-mwemw8w4).
const SMOKE_LINK =
  "eyJpZCI6InNtb2tlLW13ZW13OHc0IiwiY2xpZW50TmFtZSI6IkFjbWUgTHRkIiwiZGVzY3JpcHRpb24iOiJMb2dvIGRlc2lnbiAoUGhhc2UgMSBzbW9rZSB0ZXN0KSIsImFtb3VudFVzZCI6MC41LCJkdWVEYXRlIjoiMjAyNi0xMS0zMCIsInJlY2lwaWVudCI6InBheW1lLWZyZWVsYW5jZXItZGVtby50ZXN0bmV0IiwiY3JlYXRlZEF0IjoiMjAyNi0xMS0xM1QwNzowNzowNy4zOTZaIn0";
const SMOKE_FINGERPRINT = "cd265813fd0d0bc7ff886b58b2d52b3284a055c8841a4281e121010aad7b58ca";

const sample: LinkData = {
  id: "PM-2026-ABC234",
  clientName: "Fola Stüdio & Co — 😀",
  description: "Landing page / design",
  amountUsd: 850.5,
  dueDate: "2026-12-12",
  recipient: "amaka.testnet",
  createdAt: "2026-11-13T09:00:00.000Z",
};

describe("link encoding", () => {
  it("matches the on-chain fingerprint of the Phase 1 smoke invoice", async () => {
    expect(await fingerprint(decodeLinkString(SMOKE_LINK))).toBe(SMOKE_FINGERPRINT);
    expect(decodeLink(SMOKE_LINK)).toMatchObject({ id: "smoke-mwemw8w4", recipient: "payme-freelancer-demo.testnet", amountUsd: 0.5 });
  });

  it("round-trips unicode and produces URL-safe output with a fixed key order", () => {
    const encoded = encodeLink(sample);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLink(encoded)).toEqual(sample);
    expect(Object.keys(JSON.parse(decodeLinkString(encoded)))).toEqual(["id", "clientName", "description", "amountUsd", "dueDate", "recipient", "createdAt"]);
    // Same data in a different property order encodes identically.
    const { createdAt, recipient, ...rest } = sample;
    const reordered = { createdAt, recipient, ...rest };
    expect(encodeLink(reordered)).toBe(encoded);
  });

  it("fingerprints the exact decoded string (any change alters it)", async () => {
    const encoded = encodeLink(sample);
    const fp = await fingerprint(decodeLinkString(encoded));
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint(decodeLinkString(encodeLink({ ...sample, amountUsd: 85.05 })))).not.toBe(fp);
    expect(await fingerprint("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("rejects damaged or incomplete links with clear errors", () => {
    expect(() => decodeLink("not base64!")).toThrow(/damaged/);
    expect(() => decodeLink(btoa("{oops").replace(/=+$/, ""))).toThrow(/not valid JSON/);
    expect(() => decodeLink(btoa(JSON.stringify({ id: "x" })).replace(/=+$/, ""))).toThrow(/incomplete/);
  });
});
