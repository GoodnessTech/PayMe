// The ONLY data layer the UI uses. Exported types and function names are kept
// exactly as the Bolt UI expects; the implementations are now real:
//   - parseInvoice      -> POST /api/parse-invoice (NEAR AI Cloud TEE + verification)
//   - createInvoice     -> link + fingerprint, create_invoice on the testnet contract
//   - getInvoice        -> decode link, check its fingerprint against the chain
//   - getCrossChainQuote-> POST /api/quote (NEAR Intents 1Click, dry run)
//   - payOnNear         -> pay_invoice with the on-chain amount attached
//   - listMyInvoices    -> get_invoices_by_recipient + this device's saved link data
// Privacy: client name/description only ever live in the link fragment and in
// this browser's localStorage (for the creator's own dashboard).

import {
  CREATE_GAS,
  CREATE_STORAGE_DEPOSIT_YOCTO,
  PAY_GAS,
  formatNear,
  friendlyError,
  linkMismatch,
  newInvoiceId,
  rateFromChain,
  usdToYocto,
  type ChainInvoice,
} from "./chain";
import { decodeLink, decodeLinkString, encodeLink, fingerprint, type LinkData } from "./link";
import {
  CONTRACT_ID,
  accountExists,
  callContract,
  explorerAccountUrl,
  explorerTxUrl,
  findPaymentTxHash,
  signIn,
  signOutWallet,
  signedInAccount,
  viewContract,
} from "./near";

export type InvoiceDraft = {
  clientName: string;
  description: string;
  amountUsd: number;
  dueDate: string;
  recipient: string;
};

/** One verification step reported by /api/parse-invoice. */
export type VerificationCheck = { name: string; ok: boolean; detail: string };

/** Extra proof returned by /api/parse-invoice when NEAR AI Cloud was used. */
export type AttestationProof = {
  chatId: string;
  signingAddress: string;
  signingAlgo: string;
  signatureKind: string;
  signedText: string;
  requestHash: string;
  responseHash: string;
  reportNonce: string;
  tcbStatus?: string;
  composeHash?: string;
  checks: VerificationCheck[];
};

export type Attestation = {
  verified: boolean;
  model: string;
  signature: string;
  provider: string;
  /** Why verification failed or the local fallback was used (optional). */
  reason?: string;
  /** Proof details + every verification check (optional). */
  proof?: AttestationProof;
};

export type Invoice = InvoiceDraft & {
  id: string;
  status: "pending" | "paid";
  createdAt: string;
  paidAt?: string;
  txHash?: string;
  link: string;
};

export type Quote = {
  originChain: string;
  originToken: string;
  amountIn: string;
  amountOutUsdc: string;
  etaSeconds: number;
  route: string;
  preview: boolean;
};

/** On-chain payment details for an invoice (shown on the pay/success pages). */
export type PaymentDetails = {
  amountYocto: string;
  amountNear: string;
  rateUsd: number;
  payer: string | null;
  contractId: string;
  createTxUrl?: string;
  payerUrl?: string;
};

// ------------------------------------------------------------------ storage

const LINKS_PREFIX = "payme:links:"; // + accountId -> [{ id, linkData }]
const TX_KEY = "payme:tx:v1"; // { [invoiceId]: { create?: hash, pay?: hash } }
const PENDING_KEY = "payme:pending:v1";
const PENDING_MAX_AGE_MS = 30 * 60_000;

type SavedLink = { id: string; linkData: string };
type Pending = { type: "create" | "pay"; id: string; linkData?: string; account: string; startedAt: number };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode): the app still works, minus local history */
  }
}

function saveLink(account: string, id: string, linkData: string): void {
  const list = readJson<SavedLink[]>(LINKS_PREFIX + account, []).filter((l) => l.id !== id);
  writeJson(LINKS_PREFIX + account, [{ id, linkData }, ...list]);
}

/** Link data saved on this device for an invoice id (any account), if any. */
function findSavedLink(id: string): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LINKS_PREFIX)) continue;
      const hit = readJson<SavedLink[]>(key, []).find((l) => l.id === id);
      if (hit) return hit.linkData;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveTx(id: string, kind: "create" | "pay", hash: string): void {
  const all = readJson<Record<string, { create?: string; pay?: string }>>(TX_KEY, {});
  all[id] = { ...all[id], [kind]: hash };
  writeJson(TX_KEY, all);
}
function savedTx(id: string): { create?: string; pay?: string } {
  return readJson<Record<string, { create?: string; pay?: string }>>(TX_KEY, {})[id] ?? {};
}

function setPending(p: Pending | null): void {
  if (p) writeJson(PENDING_KEY, p);
  else {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
  }
}
function getPending(): Pending | null {
  const p = readJson<Pending | null>(PENDING_KEY, null);
  if (!p || Date.now() - p.startedAt > PENDING_MAX_AGE_MS) return null;
  return p;
}

/** Redirect-based wallets return with ?transactionHashes=... or ?errorCode=...; read and strip them. */
function consumeWalletRedirect(): { txHash?: string; error?: string } {
  try {
    const url = new URL(window.location.href);
    const txHash = url.searchParams.get("transactionHashes")?.split(",").pop() || undefined;
    const error = url.searchParams.get("errorCode") || undefined;
    if (txHash || error) {
      ["transactionHashes", "errorCode", "errorMessage", "account_id", "all_keys", "public_key"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    return { txHash, error };
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ caches

const details = new Map<string, PaymentDetails>();
const invoiceAmounts = new Map<string, number>();
let priceCache: { at: number; usd: number } | null = null;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

/** NEAR/USD from /api/near-price (cached 60 s in the browser too). */
export async function getNearPrice(): Promise<{ usd: number; fetchedAt: string }> {
  if (priceCache && Date.now() - priceCache.at < 60_000) return { usd: priceCache.usd, fetchedAt: new Date(priceCache.at).toISOString() };
  const res = await fetch("/api/near-price");
  const data = (await res.json().catch(() => ({}))) as { usd?: number; fetchedAt?: string; error?: string };
  if (!res.ok || !(typeof data.usd === "number" && data.usd > 0)) throw new Error(data.error || "Couldn't load the NEAR price.");
  priceCache = { at: Date.now(), usd: data.usd };
  return { usd: data.usd, fetchedAt: data.fetchedAt ?? new Date().toISOString() };
}

function rememberDetails(chain: ChainInvoice): PaymentDetails {
  const tx = savedTx(chain.id);
  const d: PaymentDetails = {
    amountYocto: chain.amount_yocto,
    amountNear: formatNear(chain.amount_yocto),
    rateUsd: rateFromChain(chain),
    payer: chain.payer,
    contractId: CONTRACT_ID,
    createTxUrl: tx.create ? explorerTxUrl(tx.create) : undefined,
    payerUrl: chain.payer ? explorerAccountUrl(chain.payer) : undefined,
  };
  details.set(chain.id, d);
  invoiceAmounts.set(chain.id, chain.amount_usd_cents / 100);
  return d;
}

function linkFor(id: string, linkData: string): string {
  return `${window.location.origin}/pay/${id}#${linkData}`;
}

function fromChain(chain: ChainInvoice, link: LinkData | null, linkData: string | null): Invoice {
  const tx = savedTx(chain.id);
  return {
    id: chain.id,
    clientName: link?.clientName ?? "Private invoice",
    description: link?.description ?? "Details are only in the payment link.",
    amountUsd: chain.amount_usd_cents / 100,
    dueDate: link?.dueDate ?? "",
    recipient: chain.recipient,
    status: chain.status === "Paid" ? "paid" : "pending",
    createdAt: link?.createdAt ?? new Date(chain.created_at_ms).toISOString(),
    paidAt: chain.paid_at_ms ? new Date(chain.paid_at_ms).toISOString() : undefined,
    txHash: tx.pay,
    link: linkData ? linkFor(chain.id, linkData) : `${window.location.origin}/pay/${chain.id}`,
  };
}

// ------------------------------------------------------------------ public API

export async function connectWallet(): Promise<string> {
  try {
    return await signIn();
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

export async function getAccount(): Promise<string | null> {
  try {
    return await signedInAccount();
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  await signOutWallet();
}

export async function parseInvoice(text: string): Promise<{ draft: InvoiceDraft; attestation: Attestation }> {
  const result = await postJson<{ draft: InvoiceDraft; attestation: Attestation }>("/api/parse-invoice", { text });
  getNearPrice().catch(() => undefined); // warm the price cache for createInvoice
  return result;
}

export async function createInvoice(draft: InvoiceDraft): Promise<Invoice> {
  if (!(Number.isFinite(draft.amountUsd) && draft.amountUsd > 0)) throw new Error("Enter an amount greater than $0.");
  if (Math.round(draft.amountUsd * 100) > 100_000_000) throw new Error("Amount is too large for a testnet invoice.");

  const account = (await getAccount()) ?? (await connectWallet());
  const recipient = (draft.recipient.trim() || account).toLowerCase();
  if (!/^(?=.{2,64}$)(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*\.testnet$/.test(recipient)) {
    throw new Error(`"${recipient}" is not a valid .testnet account.`);
  }
  if (!(await accountExists(recipient))) {
    throw new Error(`${recipient} doesn't exist on NEAR testnet, so it couldn't receive the payment. Use your own testnet account (e.g. ${account}).`);
  }

  const { usd: nearUsd } = await getNearPrice();
  const id = newInvoiceId();
  const createdAt = new Date().toISOString();
  const data: LinkData = {
    id,
    clientName: draft.clientName.trim(),
    description: draft.description.trim(),
    amountUsd: Math.round(draft.amountUsd * 100) / 100,
    dueDate: draft.dueDate.trim(),
    recipient,
    createdAt,
  };
  const linkData = encodeLink(data);
  const fp = await fingerprint(decodeLinkString(linkData));
  const amountYocto = usdToYocto(data.amountUsd, nearUsd).toString();

  setPending({ type: "create", id, linkData, account, startedAt: Date.now() });
  try {
    const { txHash } = await callContract(
      "create_invoice",
      { id, recipient, amount_yocto: amountYocto, amount_usd_cents: Math.round(data.amountUsd * 100), fingerprint: fp },
      CREATE_STORAGE_DEPOSIT_YOCTO,
      CREATE_GAS,
    );
    saveTx(id, "create", txHash);
  } catch (e) {
    setPending(null);
    throw new Error(friendlyError(e));
  }
  saveLink(account, id, linkData);
  setPending(null);

  rememberDetails({
    id,
    creator: account,
    recipient,
    amount_yocto: amountYocto,
    amount_usd_cents: Math.round(data.amountUsd * 100),
    fingerprint: fp,
    status: "Pending",
    created_at_ms: Date.parse(createdAt),
    paid_at_ms: null,
    payer: null,
  });
  return { ...data, status: "pending", link: linkFor(id, linkData) };
}

/**
 * After a page reload during wallet signing (redirect wallets, refresh, closed
 * tab), finish a pending create_invoice: if the invoice is on-chain, return it.
 */
export async function resumePendingCreate(): Promise<Invoice | null> {
  const redirect = consumeWalletRedirect();
  const pending = getPending();
  if (!pending || pending.type !== "create" || !pending.linkData) return null;
  if (redirect.error) {
    setPending(null);
    throw new Error("You cancelled the request in your wallet. Nothing was sent.");
  }
  const chain = await viewContract<ChainInvoice | null>("get_invoice", { id: pending.id });
  if (!chain) {
    if (Date.now() - pending.startedAt > 5 * 60_000) setPending(null);
    return null;
  }
  if (redirect.txHash) saveTx(pending.id, "create", redirect.txHash);
  saveLink(pending.account, pending.id, pending.linkData);
  setPending(null);
  rememberDetails(chain);
  return fromChain(chain, decodeLink(pending.linkData), pending.linkData);
}

export async function getInvoice(id: string, linkData: string): Promise<Invoice> {
  const data = linkData || findSavedLink(id);
  if (!data) throw new Error("This link is missing its private invoice details (the part after #). Ask the freelancer for the full link.");
  const decodedString = decodeLinkString(data);
  const link = decodeLink(data);
  if (link.id !== id) throw new Error("This payment link has been altered: its details belong to a different invoice. Do not pay it.");

  const chain = await viewContract<ChainInvoice | null>("get_invoice", { id });
  if (!chain) throw new Error(`Invoice ${id} is not recorded on-chain (${CONTRACT_ID}). Do not pay it.`);
  const fp = await fingerprint(decodedString);
  const mismatch = linkMismatch(link, chain);
  if (fp !== chain.fingerprint || mismatch) {
    throw new Error(
      `This link does not match the on-chain record${mismatch ? ` (${mismatch} differs)` : ""}. It may have been altered. Do not pay it.`,
    );
  }

  // Finish a payment that was interrupted by a redirect/reload.
  const redirect = consumeWalletRedirect();
  const pending = getPending();
  if (pending?.type === "pay" && pending.id === id) {
    if (redirect.txHash) saveTx(id, "pay", redirect.txHash);
    if (chain.status === "Paid" || redirect.error) setPending(null);
  }

  rememberDetails(chain);
  const invoice = fromChain(chain, link, data);
  if (invoice.status === "paid" && !invoice.txHash && chain.payer) {
    const hash = await findPaymentTxHash(id, chain.payer);
    if (hash) {
      saveTx(id, "pay", hash);
      invoice.txHash = hash;
    }
  }
  return invoice;
}

/** On-chain NEAR amount, the USD/NEAR rate used, payer and explorer links (after getInvoice/createInvoice). */
export function getPaymentDetails(invoiceId: string): PaymentDetails | null {
  return details.get(invoiceId) ?? null;
}

export async function getCrossChainQuote(invoiceId: string, chain: string, token: string): Promise<Quote> {
  const amountUsd = invoiceAmounts.get(invoiceId);
  if (!amountUsd) throw new Error("Load the invoice before requesting a quote.");
  return postJson<Quote>("/api/quote", { amountUsd, chain, token });
}

export async function payOnNear(invoiceId: string): Promise<{ txHash: string }> {
  const chain = await viewContract<ChainInvoice | null>("get_invoice", { id: invoiceId });
  if (!chain) throw new Error(`Invoice ${invoiceId} is not recorded on-chain.`);
  if (chain.status === "Paid") throw new Error("This invoice has already been paid.");
  const account = (await getAccount()) ?? (await connectWallet());

  setPending({ type: "pay", id: invoiceId, account, startedAt: Date.now() });
  let result: { txHash: string; returnValue: unknown };
  try {
    result = await callContract("pay_invoice", { id: invoiceId }, chain.amount_yocto, PAY_GAS);
  } catch (e) {
    setPending(null);
    throw new Error(friendlyError(e));
  }
  setPending(null);
  if (result.returnValue === false) {
    throw new Error(`The payment couldn't be delivered to ${chain.recipient}, so it was refunded to you (tx ${result.txHash}).`);
  }
  saveTx(invoiceId, "pay", result.txHash);
  const fresh = await viewContract<ChainInvoice | null>("get_invoice", { id: invoiceId }).catch(() => null);
  if (fresh) rememberDetails(fresh);
  return { txHash: result.txHash };
}

export async function listMyInvoices(accountId: string): Promise<Invoice[]> {
  const onChain = await viewContract<ChainInvoice[]>("get_invoices_by_recipient", { account_id: accountId, from_index: 0, limit: 100 });
  return onChain.map((chain) => {
    rememberDetails(chain);
    const linkData = findSavedLink(chain.id);
    let link: LinkData | null = null;
    if (linkData) {
      try {
        link = decodeLink(linkData);
      } catch {
        link = null;
      }
    }
    return fromChain(chain, link, link ? linkData : null);
  });
}

/** Friendly message for any error thrown by this module, the wallet or the RPC. */
export function describeError(err: unknown): string {
  return friendlyError(err);
}

export { explorerTxUrl };
