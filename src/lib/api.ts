export type InvoiceDraft = {
  clientName: string;
  description: string;
  amountUsd: number;
  dueDate: string;
  recipient: string;
};

export type Attestation = {
  verified: boolean;
  model: string;
  signature: string;
  provider: string;
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

const WALLET_KEY = "payme-wallet";
const INVOICES_KEY = "payme-invoices";
const pause = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const readInvoices = (): Invoice[] => JSON.parse(localStorage.getItem(INVOICES_KEY) ?? "[]") as Invoice[];
const writeInvoices = (invoices: Invoice[]): void => localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
const encode = (value: unknown): string => btoa(unescape(encodeURIComponent(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (value: string): unknown => JSON.parse(decodeURIComponent(escape(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)))));

export async function connectWallet(): Promise<string> {
  await pause(900);
  const account = localStorage.getItem(WALLET_KEY) ?? "tunde.payme.testnet";
  localStorage.setItem(WALLET_KEY, account);
  return account;
}

export async function getAccount(): Promise<string | null> {
  return localStorage.getItem(WALLET_KEY);
}

export async function signOut(): Promise<void> {
  localStorage.removeItem(WALLET_KEY);
}

export async function parseInvoice(text: string): Promise<{ draft: InvoiceDraft; attestation: Attestation }> {
  await pause(1500);
  const amountMatch = text.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  const recipientMatch = text.match(/(?:to|payment to)\s+([\w.-]+\.testnet)/i);
  const dueMatch = text.match(/due\s+([^,.]+)/i);
  const clientMatch = text.match(/(?:to|for)\s+([A-Z][\w &.-]+?)(?:,| for|,? \$| due|$)/i);
  const descriptionMatch = text.match(/for\s+(.+?)(?:,\s*\$|,\s*due|\s+due|$)/i);
  const draft: InvoiceDraft = {
    clientName: clientMatch?.[1]?.trim() ?? "Acme Ltd",
    description: descriptionMatch?.[1]?.trim() ?? "Brand design and creative services",
    amountUsd: Number(amountMatch?.[1] ?? 250),
    dueDate: dueMatch?.[1]?.trim() ?? "November 30, 2026",
    recipient: recipientMatch?.[1]?.trim() ?? "tunde.payme.testnet",
  };
  return {
    draft,
    attestation: {
      verified: true,
      model: "mock-private-ai-1",
      provider: "NEAR AI Cloud",
      signature: "sig_demo_7f3a...c91e",
    },
  };
}

export async function createInvoice(draft: InvoiceDraft): Promise<Invoice> {
  await pause(1100);
  const id = `PM-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const invoiceWithoutLink = { ...draft, id, status: "pending" as const, createdAt };
  const link = `${window.location.origin}/pay/${id}#${encode(invoiceWithoutLink)}`;
  const invoice: Invoice = { ...invoiceWithoutLink, link };
  writeInvoices([invoice, ...readInvoices()]);
  return invoice;
}

export async function getInvoice(id: string, linkData: string): Promise<Invoice> {
  await pause(700);
  const stored = readInvoices().find((invoice) => invoice.id === id);
  if (stored) return stored;
  const decoded = decode(linkData) as Partial<Invoice>;
  if (decoded.id !== id || typeof decoded.clientName !== "string" || typeof decoded.amountUsd !== "number") throw new Error("This payment link is invalid or incomplete.");
  return { ...(decoded as Invoice), link: window.location.href };
}

export async function getCrossChainQuote(invoiceId: string, chain: string, token: string): Promise<Quote> {
  await pause(1000);
  const invoice = readInvoices().find((item) => item.id === invoiceId);
  const amount = invoice?.amountUsd ?? 250;
  return { originChain: chain, originToken: token, amountIn: (amount * 1.002).toFixed(2), amountOutUsdc: amount.toFixed(2), etaSeconds: chain === "Bitcoin" ? 90 : 20, route: "NEAR Intents", preview: true };
}

export async function payOnNear(invoiceId: string): Promise<{ txHash: string }> {
  await pause(1600);
  const txHash = `demo_${invoiceId.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
  const invoices = readInvoices();
  const updated = invoices.map((invoice) => invoice.id === invoiceId ? { ...invoice, status: "paid" as const, paidAt: new Date().toISOString(), txHash } : invoice);
  writeInvoices(updated);
  return { txHash };
}

export async function listMyInvoices(accountId: string): Promise<Invoice[]> {
  await pause(500);
  return readInvoices().filter((invoice) => invoice.recipient === accountId);
}
