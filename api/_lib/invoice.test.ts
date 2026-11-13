import { describe, expect, it } from "vitest";
import { fallbackParse, isTestnetAccount, normalizeDate, sanitizeDraft } from "./invoice.js";

describe("fallbackParse (local regex parser)", () => {
  it("parses the three UI examples", () => {
    expect(fallbackParse("Invoice to Acme Ltd for logo design, $250, due November 30, 2026. Payment to tunde.testnet.")).toEqual({
      clientName: "Acme Ltd",
      description: "logo design",
      amountUsd: 250,
      dueDate: "2026-11-30",
      recipient: "tunde.testnet",
    });
    expect(
      fallbackParse("Send an invoice to Fola Studio for landing page design, $850, due December 12, 2026. Payment to amaka.testnet."),
    ).toEqual({ clientName: "Fola Studio", description: "landing page design", amountUsd: 850, dueDate: "2026-12-12", recipient: "amaka.testnet" });
    expect(fallbackParse("Invoice Bright House for brand strategy, $1,200, due December 5, 2026. Payment to tunde.testnet.")).toEqual({
      clientName: "Bright House",
      description: "brand strategy",
      amountUsd: 1200,
      dueDate: "2026-12-05",
      recipient: "tunde.testnet",
    });
  });

  it("handles other amount and date formats", () => {
    const d = fallbackParse("Bill to: Kola Foods. For website hosting, 99.50 USD due 2026-12-01, pay kola-pay.testnet");
    expect(d.amountUsd).toBe(99.5);
    expect(d.dueDate).toBe("2026-12-01");
    expect(d.recipient).toBe("kola-pay.testnet");
    expect(d.clientName).toBe("Kola Foods");
    expect(fallbackParse("Invoice X Co for audit, USD 1,500.25, due 3rd January 2027").amountUsd).toBe(1500.25);
    expect(fallbackParse("Invoice X Co for audit, USD 1,500.25, due 3rd January 2027").dueDate).toBe("2027-01-03");
  });

  it("returns empty fields instead of inventing data", () => {
    expect(fallbackParse("hello there")).toEqual({ clientName: "", description: "", amountUsd: 0, dueDate: "", recipient: "" });
  });

  it("ignores mainnet accounts", () => {
    expect(fallbackParse("Invoice Acme for work, $5. Payment to tunde.near").recipient).toBe("");
  });
});

describe("sanitizeDraft (untrusted model output)", () => {
  it("cleans, bounds and validates every field", () => {
    const d = sanitizeDraft({
      clientName: "  Acme <script>alert(1)</script>\n Ltd ",
      description: "x".repeat(500),
      amountUsd: "1,234.567",
      dueDate: "Nov 30 2026",
      recipient: "Tunde.TESTNET",
    });
    expect(d.clientName).toBe("Acme script alert(1) /script Ltd");
    expect(d.description).toHaveLength(300);
    expect(d.amountUsd).toBe(1234.57);
    expect(d.dueDate).toBe("2026-11-30");
    expect(d.recipient).toBe("tunde.testnet");
  });

  it("rejects bad values", () => {
    expect(sanitizeDraft({ amountUsd: -5 }).amountUsd).toBe(0);
    expect(sanitizeDraft({ amountUsd: 1e12 }).amountUsd).toBe(0);
    expect(sanitizeDraft({ amountUsd: "abc" }).amountUsd).toBe(0);
    expect(sanitizeDraft({ recipient: "evil.near" }).recipient).toBe("");
    expect(sanitizeDraft({ recipient: "a..b.testnet" }).recipient).toBe("");
    expect(sanitizeDraft({ dueDate: "2026-02-30" }).dueDate).toBe("");
    expect(sanitizeDraft(null)).toEqual({ clientName: "", description: "", amountUsd: 0, dueDate: "", recipient: "" });
    expect(sanitizeDraft("not an object").clientName).toBe("");
  });
});

describe("normalizeDate", () => {
  const now = new Date("2026-11-13T00:00:00Z");
  it("accepts unambiguous formats", () => {
    expect(normalizeDate("2026-11-30", now)).toBe("2026-11-30");
    expect(normalizeDate("November 30, 2026", now)).toBe("2026-11-30");
    expect(normalizeDate("30 Nov 2026", now)).toBe("2026-11-30");
    expect(normalizeDate("Dec 5", now)).toBe("2026-12-05");
    expect(normalizeDate("31/12/2026", now)).toBe("2026-12-31");
    expect(normalizeDate("12/31/2026", now)).toBe("2026-12-31");
  });
  it("rejects ambiguous or invalid dates", () => {
    expect(normalizeDate("05/06/2026", now)).toBe("");
    expect(normalizeDate("next Tuesday", now)).toBe("");
    expect(normalizeDate("2026-13-01", now)).toBe("");
  });
});

describe("isTestnetAccount", () => {
  it("follows NEAR account rules", () => {
    expect(isTestnetAccount("payme-invoices.testnet")).toBe(true);
    expect(isTestnetAccount("sub.account.testnet")).toBe(true);
    expect(isTestnetAccount("UPPER.testnet")).toBe(false);
    expect(isTestnetAccount("-bad.testnet")).toBe(false);
    expect(isTestnetAccount("ok.near")).toBe(false);
  });
});
