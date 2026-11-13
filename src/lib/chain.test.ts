import { describe, expect, it } from "vitest";
import { formatNear, friendlyError, linkMismatch, newInvoiceId, rateFromChain, usdToYocto, type ChainInvoice } from "./chain";
import type { LinkData } from "./link";

describe("NEAR conversion", () => {
  it("converts USD to yoctoNEAR at the given price, rounded to 0.00001 NEAR", () => {
    expect(usdToYocto(250, 3.51).toString()).toBe("71225070000000000000000000"); // 71.22507 NEAR
    expect(usdToYocto(0.5, 2.5).toString()).toBe("200000000000000000000000"); // 0.2 NEAR
    expect(usdToYocto(1, 3).toString()).toBe("333330000000000000000000");
    expect(() => usdToYocto(0, 3)).toThrow();
    expect(() => usdToYocto(5, 0)).toThrow();
  });

  it("formats NEAR and recovers the rate used", () => {
    expect(formatNear("71225070000000000000000000")).toBe("71.225");
    expect(formatNear("100000000000000000000000")).toBe("0.1");
    expect(formatNear("1000000000000000000000000")).toBe("1");
    expect(formatNear("71225070000000000000000000", 2)).toBe("71.22");
    expect(rateFromChain({ amount_yocto: usdToYocto(250, 3.51).toString(), amount_usd_cents: 25000 })).toBe(3.51);
    expect(rateFromChain({ amount_yocto: "100000000000000000000000", amount_usd_cents: 50 })).toBe(5);
  });
});

describe("invoice ids", () => {
  it("fit the contract's id rules", () => {
    const id = newInvoiceId(new Date("2026-11-13T00:00:00Z"));
    expect(id).toMatch(/^PM-2026-[A-Z2-9]{6}$/);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("link vs chain consistency", () => {
  const chain: ChainInvoice = {
    id: "PM-2026-AAAAAA",
    creator: "a.testnet",
    recipient: "a.testnet",
    amount_yocto: "1",
    amount_usd_cents: 25000,
    fingerprint: "f".repeat(64),
    status: "Pending",
    created_at_ms: 0,
    paid_at_ms: null,
    payer: null,
  };
  const link: LinkData = { id: chain.id, clientName: "X", description: "Y", amountUsd: 250, dueDate: "", recipient: "a.testnet", createdAt: "" };
  it("flags differing id, recipient or amount", () => {
    expect(linkMismatch(link, chain)).toBeNull();
    expect(linkMismatch({ ...link, amountUsd: 25 }, chain)).toBe("amount");
    expect(linkMismatch({ ...link, recipient: "evil.testnet" }, chain)).toBe("recipient");
    expect(linkMismatch({ ...link, id: "PM-2026-BBBBBB" }, chain)).toBe("invoice id");
  });
});

describe("friendlyError", () => {
  it("explains wallet rejections, balance and network problems", () => {
    expect(friendlyError(new Error("User rejected the request"))).toMatch(/cancelled/);
    expect(friendlyError(new Error("Wallet closed"))).toMatch(/cancelled/);
    expect(friendlyError(new Error("TypeError: Failed to fetch"))).toMatch(/Couldn't reach NEAR testnet/);
    expect(friendlyError(new Error("NotEnoughBalance"))).toMatch(/faucet/);
    expect(friendlyError(new Error("Invoice is already paid"))).toBe("Invoice is already paid");
    expect(friendlyError("x".repeat(400))).toHaveLength(220);
    expect(friendlyError(undefined)).toBe("Something went wrong.");
  });
});
