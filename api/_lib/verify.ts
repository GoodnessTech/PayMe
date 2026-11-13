// Verification of NEAR AI Cloud private inference, following docs.near.ai
// ("Verification" > response signatures / model attestation) and the official
// verifier (github.com/nearai/nearai-cloud-verifier). Every check is real; a
// check that cannot run counts as failed (never assumed to pass).

import { createHash } from "node:crypto";
import { verifyMessage } from "ethers";
import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { fetchWithTimeout, withTimeout, EXTERNAL_TIMEOUT_MS } from "./http.js";

export const NRAS_GPU_URL = "https://nras.attestation.nvidia.com/v3/attest/gpu";

/** TCB statuses we accept for a cryptographically valid TDX quote (same policy as
 * the official verifier: genuine, non-revoked platform; OutOfDate is reported). */
export const ACCEPTED_TCB_STATUSES = new Set([
  "UpToDate",
  "SWHardeningNeeded",
  "ConfigurationNeeded",
  "ConfigurationAndSWHardeningNeeded",
  "OutOfDate",
  "OutOfDateConfigurationNeeded",
]);

export type Check = { name: string; ok: boolean; detail: string };

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex");
  return Uint8Array.from(Buffer.from(h, "hex"));
}

export function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

/**
 * The text NEAR AI Cloud signs (docs: response signatures):
 * - provider_tee: "{model}:{sha256(request body)}:{sha256(response body)}"
 * - gateway:      "{sha256(request body)}:{sha256(response body)}"
 * Unknown / missing kinds are not verifiable.
 */
export function expectedSignedText(
  kind: string | undefined,
  model: string,
  requestHash: string,
  responseHash: string,
): string | null {
  if (kind === "provider_tee") return `${model}:${requestHash}:${responseHash}`;
  if (kind === "gateway") return `${requestHash}:${responseHash}`;
  return null;
}

/** EIP-191 personal_sign recovery (ethers.verifyMessage), lowercase address. */
export function recoverEcdsaSigner(text: string, signature: string): string {
  return verifyMessage(Buffer.from(text, "utf8"), signature).toLowerCase();
}

/**
 * NEAR-operated dstack report_data layout (64 bytes, no TLS binding):
 *   [0..32)  = signing address bytes (20 for ECDSA), zero-padded on the right
 *   [32..64) = the raw 32-byte client nonce
 */
export function checkReportData(reportData: Uint8Array, signingAddress: string, nonceHex: string): Check {
  if (reportData.length !== 64) {
    return { name: "report_data binding", ok: false, detail: `report_data is ${reportData.length} bytes, expected 64` };
  }
  const expectedFirst = new Uint8Array(32);
  expectedFirst.set(hexToBytes(signingAddress));
  const first = reportData.slice(0, 32);
  const second = reportData.slice(32, 64);
  const addrOk = Buffer.compare(Buffer.from(first), Buffer.from(expectedFirst)) === 0;
  const nonceOk = bytesToHex(second) === nonceHex.toLowerCase();
  return {
    name: "report_data binding",
    ok: addrOk && nonceOk,
    detail: addrOk && nonceOk
      ? "TDX report_data = signing address + our fresh nonce"
      : `${addrOk ? "" : "signing address not bound in report_data. "}${nonceOk ? "" : "nonce in report_data does not match ours."}`.trim(),
  };
}

/** MRCONFIGID = 0x01 || sha256(app_compose) || zero padding (dstack). */
export function checkComposeHash(mrConfigId: Uint8Array, appCompose: string): Check {
  const composeHash = sha256Hex(appCompose);
  const ok = bytesToHex(mrConfigId).startsWith("01" + composeHash);
  return {
    name: "app compose measured",
    ok,
    detail: ok ? `MRCONFIGID binds compose hash ${composeHash.slice(0, 16)}…` : "MRCONFIGID does not match sha256(app_compose)",
  };
}

export type TdxResult = { status: string; advisoryIds: string[]; reportData: Uint8Array; mrConfigId: Uint8Array; debug: boolean };

/** Verify an Intel TDX quote with dcap-qvl (collateral from Phala's PCCS). */
export async function verifyTdxQuote(quoteHex: string, timeoutMs = EXTERNAL_TIMEOUT_MS): Promise<TdxResult> {
  const verified = await withTimeout(getCollateralAndVerify(hexToBytes(quoteHex)), timeoutMs, "Intel TDX collateral/verification");
  const td = verified.report.asTd10() ?? verified.report.asTd15()?.base ?? verified.report.asTd15Ex()?.base.base ?? null;
  if (!td) throw new Error("quote is not a TDX quote");
  return {
    status: verified.status,
    advisoryIds: verified.advisory_ids ?? [],
    reportData: td.reportData,
    mrConfigId: td.mrConfigId,
    debug: (td.tdAttributes[0] & 1) === 1,
  };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("malformed JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Ask NVIDIA's attestation service (NRAS) to verify the GPU evidence. */
export async function verifyGpu(nvidiaPayload: string, nonceHex: string): Promise<Check> {
  let payload: { nonce?: string };
  try {
    payload = JSON.parse(nvidiaPayload) as { nonce?: string };
  } catch {
    return { name: "NVIDIA GPU attestation", ok: false, detail: "nvidia_payload is not valid JSON" };
  }
  if (String(payload.nonce ?? "").toLowerCase() !== nonceHex.toLowerCase()) {
    return { name: "NVIDIA GPU attestation", ok: false, detail: "GPU evidence nonce does not match ours" };
  }
  const res = await fetchWithTimeout(NRAS_GPU_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: nvidiaPayload,
  });
  if (!res.ok) return { name: "NVIDIA GPU attestation", ok: false, detail: `NRAS HTTP ${res.status}` };
  const body = (await res.json()) as unknown;
  // Response: [["JWT", "<overall token>"], {...per-GPU tokens}]
  const token = Array.isArray(body) && Array.isArray(body[0]) ? body[0][1] : undefined;
  if (typeof token !== "string") return { name: "NVIDIA GPU attestation", ok: false, detail: "unexpected NRAS response" };
  const claims = decodeJwtPayload(token);
  const ok = claims["x-nvidia-overall-att-result"] === true;
  return {
    name: "NVIDIA GPU attestation",
    ok,
    detail: ok ? "NRAS: overall attestation result true" : "NRAS: overall attestation result false",
  };
}
