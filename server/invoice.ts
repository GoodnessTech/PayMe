// Invoice draft validation/sanitisation and the local fallback parser.
// Shapes match src/lib/api.ts (InvoiceDraft) exactly.

export type InvoiceDraft = {
  clientName: string;
  description: string;
  amountUsd: number;
  dueDate: string;
  recipient: string;
};

export const MAX_INVOICE_TEXT = 4_000;
export const MAX_AMOUNT_USD = 1_000_000;

// NEAR account id rules (lowercase, separators - _ ., 2-64 chars), restricted to .testnet.
const TESTNET_ACCOUNT_RE = /^(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*\.testnet$/;
const TESTNET_ACCOUNT_IN_TEXT_RE = /\b((?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*\.testnet)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** 1-12 for a full or abbreviated English month name, else 0. */
function monthNumber(name: string): number {
  const n = name.toLowerCase();
  const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const i = full.findIndex((f) => f === n);
  if (i >= 0) return i + 1;
  return MONTHS[n] ?? 0;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    // eslint-disable-next-line no-control-regex -- deliberately strips control characters
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function isTestnetAccount(value: string): boolean {
  return TESTNET_ACCOUNT_RE.test(value);
}

function isoDate(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return dt.toISOString().slice(0, 10);
}

/** Normalise a date to yyyy-mm-dd. Returns "" if it can't be read unambiguously. */
export function normalizeDate(value: unknown, now = new Date()): string {
  if (typeof value !== "string") return "";
  const s = value.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  // "November 30 2026", "Nov 30"
  m = s.match(/^([a-z]{3,9})\.? (\d{1,2})(?: (\d{4}))?$/i);
  if (m && monthNumber(m[1])) return isoDate(m[3] ? +m[3] : now.getUTCFullYear(), monthNumber(m[1]), +m[2]);
  // "30 November 2026", "30 Nov"
  m = s.match(/^(\d{1,2}) ([a-z]{3,9})\.?(?: (\d{4}))?$/i);
  if (m && monthNumber(m[2])) return isoDate(m[3] ? +m[3] : now.getUTCFullYear(), monthNumber(m[2]), +m[1]);
  // Numeric d/m/y vs m/d/y is ambiguous; only accept when one reading is impossible.
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return isoDate(y, b, a);
    if (b > 12 && a <= 12) return isoDate(y, a, b);
  }
  return "";
}

/** Validate and sanitise an untrusted draft (from the model or the fallback). */
export function sanitizeDraft(raw: unknown): InvoiceDraft {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let amount = typeof o.amountUsd === "number" ? o.amountUsd : typeof o.amountUsd === "string" ? Number(o.amountUsd.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT_USD) amount = 0;
  const recipient = cleanText(o.recipient, 64).toLowerCase();
  return {
    clientName: cleanText(o.clientName, 100),
    description: cleanText(o.description, 300),
    amountUsd: Math.round(amount * 100) / 100,
    dueDate: normalizeDate(o.dueDate),
    recipient: isTestnetAccount(recipient) ? recipient : "",
  };
}

/**
 * LOCAL FALLBACK PARSER: plain regular expressions, no AI, no TEE.
 * Used only when NEAR AI Cloud is not configured or fails; responses that use
 * it are labelled provider "Local fallback (NEAR AI Cloud unavailable)" and
 * verified: false.
 */
export function fallbackParse(text: string): InvoiceDraft {
  const t = text.replace(/\s+/g, " ").trim();

  const amountMatch =
    t.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/) ??
    t.match(/\b(?:USD|US\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i) ??
    t.match(/\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(?:USD|dollars?)\b/i);
  const amountUsd = amountMatch ? Number(amountMatch[1].replace(/,/g, "") + (amountMatch[2] ? "." + amountMatch[2] : "")) : 0;

  const dueMatch = t.match(/\bdue(?: on| by| date:?)?\s+([A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}(?:st|nd|rd|th)? [A-Za-z]{3,9},? \d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4}|[A-Za-z]{3,9}\.? \d{1,2}(?:st|nd|rd|th)?)/i);

  const recipientMatch = t.match(TESTNET_ACCOUNT_IN_TEXT_RE);

  // Keywords are case-insensitive; names must start with a capital letter.
  const name = "([A-Z][\\w&'-]*(?: [A-Z][\\w&'-]*){0,4}?)";
  const clientMatch =
    t.match(new RegExp(`\\b(?:[Bb]ill [Tt]o|[Cc]lient|[Cc]ustomer)\\s*:?\\s+${name}(?=[.,]|\\s+[Ff]or\\b|$)`)) ??
    t.match(new RegExp(`\\b[Ii]nvoice(?: [Tt]o)?\\s+${name}(?=\\s+[Ff]or\\b|,|$)`)) ??
    t.match(new RegExp(`\\b[Tt]o\\s+${name}(?=\\s+[Ff]or\\b|,)`));

  const descriptionMatch = t.match(/\bfor\s+(.+?)(?:,\s*(?:\$|USD|US\$|due\b|\d)|\s+due\b|\.\s|$)/i);

  return sanitizeDraft({
    clientName: clientMatch?.[1] ?? "",
    description: descriptionMatch?.[1] ?? "",
    amountUsd,
    dueDate: dueMatch?.[1] ?? "",
    recipient: recipientMatch?.[1]?.toLowerCase() ?? "",
  });
}
