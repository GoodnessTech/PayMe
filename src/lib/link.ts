// Payment-link encoding (see CLAUDE.md "Link format").
//   link      = {origin}/pay/{id}#{linkData}
//   linkData  = base64url(UTF-8 JSON of {id, clientName, description, amountUsd, dueDate, recipient, createdAt})
//   fingerprint = hex sha256 of the decoded linkData string (the exact JSON text)
// The invoice details only ever live in the link fragment, which browsers never send to servers.

export type LinkData = {
  id: string;
  clientName: string;
  description: string;
  amountUsd: number;
  dueDate: string;
  recipient: string;
  createdAt: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Link data is not valid base64url");
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Encode invoice details into the link fragment. Key order is fixed. */
export function encodeLink(data: LinkData): string {
  const json = JSON.stringify({
    id: data.id,
    clientName: data.clientName,
    description: data.description,
    amountUsd: data.amountUsd,
    dueDate: data.dueDate,
    recipient: data.recipient,
    createdAt: data.createdAt,
  });
  return bytesToBase64Url(new TextEncoder().encode(json));
}

/** The decoded linkData string: exactly the text the fingerprint is computed over. */
export function decodeLinkString(linkData: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(linkData.trim()));
  } catch {
    throw new Error("This payment link is damaged: its invoice details can't be decoded.");
  }
}

/** Decode and validate the link fragment. */
export function decodeLink(linkData: string): LinkData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeLinkString(linkData));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("This payment link")) throw e;
    throw new Error("This payment link is damaged: its invoice details are not valid JSON.");
  }
  const d = parsed as Partial<Record<keyof LinkData, unknown>>;
  const ok =
    d &&
    typeof d.id === "string" &&
    typeof d.clientName === "string" &&
    typeof d.description === "string" &&
    typeof d.amountUsd === "number" &&
    Number.isFinite(d.amountUsd) &&
    typeof d.dueDate === "string" &&
    typeof d.recipient === "string" &&
    typeof d.createdAt === "string";
  if (!ok) throw new Error("This payment link is incomplete: some invoice details are missing.");
  return d as LinkData;
}

/** Hex sha256 (Web Crypto) of a string's UTF-8 bytes. */
export async function fingerprint(str: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
