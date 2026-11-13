import { afterEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import {
  checkComposeHash,
  checkReportData,
  expectedSignedText,
  hexToBytes,
  recoverEcdsaSigner,
  sha256Hex,
  verifyGpu,
  type TdxResult,
} from "./verify.js";
import { verifyCompletion, type AttestationReport, type ChatResult, type SignatureResponse } from "./nearai.js";

const MODEL = "Qwen/Qwen3-VL-30B-A3B-Instruct";
const NONCE = "aa".repeat(32);

function reportDataFor(address: string, nonceHex: string): Uint8Array {
  const rd = new Uint8Array(64);
  rd.set(hexToBytes(address), 0);
  rd.set(hexToBytes(nonceHex), 32);
  return rd;
}

const APP_COMPOSE = '{"manifest_version":2,"name":"dstack-test"}';
function mrConfigIdFor(appCompose: string): Uint8Array {
  return hexToBytes("01" + sha256Hex(appCompose) + "00".repeat(15));
}

async function fixture(opts: { wallet?: Wallet; textOverride?: string; kind?: string } = {}) {
  const wallet = opts.wallet ?? Wallet.createRandom();
  const requestBody = JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Invoice Acme $5" }] });
  const responseBody = '{"id":"chat-1","choices":[{"message":{"content":"{}"}}]}';
  const chat: ChatResult = { chatId: "chat-1", content: "{}", requestHash: sha256Hex(requestBody), responseHash: sha256Hex(responseBody) };
  const text = opts.textOverride ?? `${MODEL}:${chat.requestHash}:${chat.responseHash}`;
  const sig: SignatureResponse = {
    text,
    signature: await wallet.signMessage(text),
    signing_address: wallet.address,
    signing_algo: "ecdsa",
    signature_kind: opts.kind ?? "provider_tee",
  };
  const address = wallet.address.toLowerCase();
  const report: AttestationReport = {
    model_attestations: [
      {
        signing_address: address,
        signing_algo: "ecdsa",
        request_nonce: NONCE,
        intel_quote: "00",
        nvidia_payload: JSON.stringify({ nonce: NONCE }),
        info: { tcb_info: { app_compose: APP_COMPOSE } },
      },
    ],
  };
  const tdxOk = async (): Promise<TdxResult> => ({
    status: "UpToDate",
    advisoryIds: [],
    reportData: reportDataFor(address, NONCE),
    mrConfigId: mrConfigIdFor(APP_COMPOSE),
    debug: false,
  });
  const gpuOk = async () => ({ name: "NVIDIA GPU attestation", ok: true, detail: "NRAS: overall attestation result true" });
  return { wallet, chat, sig, report, tdxOk, gpuOk };
}

describe("signed text and ECDSA", () => {
  it("builds the documented text formats", () => {
    expect(expectedSignedText("provider_tee", "m", "a", "b")).toBe("m:a:b");
    expect(expectedSignedText("gateway", "m", "a", "b")).toBe("a:b");
    expect(expectedSignedText(undefined, "m", "a", "b")).toBeNull();
    expect(expectedSignedText("other", "m", "a", "b")).toBeNull();
  });

  it("recovers the EIP-191 signer", async () => {
    const w = Wallet.createRandom();
    expect(recoverEcdsaSigner("hello", await w.signMessage("hello"))).toBe(w.address.toLowerCase());
    expect(recoverEcdsaSigner("hello!", await w.signMessage("hello"))).not.toBe(w.address.toLowerCase());
  });
});

describe("report_data and compose binding", () => {
  const addr = "0x2665cce942fa427ef30d87f4b0bff67fb7645462";
  it("accepts address + nonce", () => {
    expect(checkReportData(reportDataFor(addr, NONCE), addr, NONCE).ok).toBe(true);
  });
  it("rejects wrong nonce, wrong address, wrong length", () => {
    expect(checkReportData(reportDataFor(addr, "bb".repeat(32)), addr, NONCE).ok).toBe(false);
    expect(checkReportData(reportDataFor("0x" + "11".repeat(20), NONCE), addr, NONCE).ok).toBe(false);
    expect(checkReportData(new Uint8Array(32), addr, NONCE).ok).toBe(false);
  });
  it("checks MRCONFIGID against sha256(app_compose)", () => {
    expect(checkComposeHash(mrConfigIdFor(APP_COMPOSE), APP_COMPOSE).ok).toBe(true);
    expect(checkComposeHash(mrConfigIdFor(APP_COMPOSE), APP_COMPOSE + " ").ok).toBe(false);
  });
});

describe("verifyCompletion", () => {
  it("is verified only when every check passes", async () => {
    const f = await fixture();
    const r = await verifyCompletion({ model: MODEL, chat: f.chat, sig: f.sig, report: f.report, nonce: NONCE, verifyTdx: f.tdxOk, verifyGpuEvidence: f.gpuOk });
    expect(r.verified).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.proof.signingAddress).toBe(f.wallet.address.toLowerCase());
    expect(r.proof.checks.map((c) => c.name)).toEqual([
      "signature covers this request/response",
      "ECDSA signature valid",
      "signer is in the attestation report",
      "fresh nonce",
      "Intel TDX quote valid",
      "report_data binding",
      "app compose measured",
      "NVIDIA GPU attestation",
    ]);
  });

  it("fails if the signature is over a different response", async () => {
    const f = await fixture({ textOverride: `${MODEL}:${"0".repeat(64)}:${"1".repeat(64)}` });
    const r = await verifyCompletion({ model: MODEL, chat: f.chat, sig: f.sig, report: f.report, nonce: NONCE, verifyTdx: f.tdxOk, verifyGpuEvidence: f.gpuOk });
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/signature covers this request\/response/);
  });

  it("fails if the claimed signing address did not sign", async () => {
    const f = await fixture();
    f.sig.signature = await Wallet.createRandom().signMessage(f.sig.text!);
    const r = await verifyCompletion({ model: MODEL, chat: f.chat, sig: f.sig, report: f.report, nonce: NONCE, verifyTdx: f.tdxOk, verifyGpuEvidence: f.gpuOk });
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/ECDSA signature valid/);
  });

  it("fails if the signer is not in the attestation report", async () => {
    const f = await fixture();
    f.report.model_attestations![0].signing_address = "0x" + "22".repeat(20);
    const r = await verifyCompletion({ model: MODEL, chat: f.chat, sig: f.sig, report: f.report, nonce: NONCE, verifyTdx: f.tdxOk, verifyGpuEvidence: f.gpuOk });
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/signer is in the attestation report/);
  });

  it("fails on a stale nonce, a failed TDX quote, a debug TD, a failed GPU check, or an unknown signature kind", async () => {
    const run = async (mutate: (f: Awaited<ReturnType<typeof fixture>>) => void, kind?: string) => {
      const f = await fixture({ kind });
      mutate(f);
      return verifyCompletion({ model: MODEL, chat: f.chat, sig: f.sig, report: f.report, nonce: NONCE, verifyTdx: f.tdxOk, verifyGpuEvidence: f.gpuOk });
    };
    expect((await run((f) => (f.report.model_attestations![0].request_nonce = "cc".repeat(32)))).verified).toBe(false);
    expect((await run((f) => (f.tdxOk = async () => Promise.reject(new Error("bad quote")))) ).reason).toMatch(/Intel TDX quote valid \(bad quote\)/);
    const debug = await run((f) => {
      const ok = f.tdxOk;
      f.tdxOk = async () => ({ ...(await ok()), debug: true });
    });
    expect(debug.verified).toBe(false);
    const revoked = await run((f) => {
      const ok = f.tdxOk;
      f.tdxOk = async () => ({ ...(await ok()), status: "Revoked" });
    });
    expect(revoked.verified).toBe(false);
    expect((await run((f) => (f.gpuOk = async () => ({ name: "NVIDIA GPU attestation", ok: false, detail: "x" })))).verified).toBe(false);
    expect((await run(() => {}, "mystery")).verified).toBe(false);
  });
});

describe("verifyGpu (NRAS) with mocked fetch", () => {
  afterEach(() => vi.unstubAllGlobals());
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("passes when NRAS says overall true", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([["JWT", jwt({ "x-nvidia-overall-att-result": true })], {}]))));
    expect((await verifyGpu(JSON.stringify({ nonce: NONCE }), NONCE)).ok).toBe(true);
  });
  it("fails when NRAS says false, on HTTP errors, and on nonce mismatch (without calling NRAS)", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([["JWT", jwt({ "x-nvidia-overall-att-result": false })], {}])));
    vi.stubGlobal("fetch", f);
    expect((await verifyGpu(JSON.stringify({ nonce: NONCE }), NONCE)).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    expect((await verifyGpu(JSON.stringify({ nonce: NONCE }), NONCE)).detail).toBe("NRAS HTTP 500");
    const g = vi.fn();
    vi.stubGlobal("fetch", g);
    expect((await verifyGpu(JSON.stringify({ nonce: "bb".repeat(32) }), NONCE)).ok).toBe(false);
    expect(g).not.toHaveBeenCalled();
  });
});
