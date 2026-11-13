// NEAR wallet + RPC for PayMe (testnet only).
// Wallet: NEAR Connect (@hot-labs/near-connect), the connector docs.near.org
// currently recommends (Wallet Selector is deprecated). RPC reads use the
// public FastNEAR testnet endpoint listed in docs.near.org/api/rpc/providers.

import { NearConnector, type NearWalletBase, type WalletManifest } from "@hot-labs/near-connect";

export const NETWORK = "testnet" as const;
export const RPC_URL = "https://test.rpc.fastnear.com";
export const EXPLORER_URL = "https://testnet.nearblocks.io";
const NEARBLOCKS_API = "https://api-testnet.nearblocks.io/v3";
const RPC_TIMEOUT_MS = 10_000;

export const CONTRACT_ID = (import.meta.env.VITE_CONTRACT_ID ?? "").trim();
if ((import.meta.env.VITE_NEAR_NETWORK ?? "testnet") !== "testnet") {
  throw new Error("PayMe is testnet-only: set VITE_NEAR_NETWORK=testnet");
}

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/txns/${hash}`;
}
export function explorerAccountUrl(accountId: string): string {
  return `${EXPLORER_URL}/address/${accountId}`;
}

function requireContract(): string {
  if (!CONTRACT_ID) throw new Error("VITE_CONTRACT_ID is not set. Add it to .env (see .env.example).");
  return CONTRACT_ID;
}

// ---------------------------------------------------------------- wallet

// Same manifest URL NEAR Connect loads by default.
const MANIFEST_URL = "https://raw.githubusercontent.com/hot-dao/near-selector/refs/heads/main/repository/manifest.json";
const MNW_TESTNET_ORIGIN = "https://testnet.mynearwallet.com";

/**
 * The official manifest doesn't flag MyNearWallet as testnet-capable, although
 * its official executor script (repository/mnw.js) already contains a testnet
 * connector for testnet.mynearwallet.com. We only declare that capability and
 * allow the executor to open the testnet wallet URL; the wallet code is unchanged.
 */
export function patchManifestForTestnet(manifest: { wallets: WalletManifest[]; version: string }) {
  return {
    ...manifest,
    wallets: manifest.wallets.map((w) => {
      if (w.id !== "mynearwallet") return w;
      const allowsOpen = Array.from(new Set([...(w.permissions?.allowsOpen ?? []), MNW_TESTNET_ORIGIN]));
      return {
        ...w,
        features: { ...w.features, testnet: true },
        permissions: { ...w.permissions, allowsOpen },
      } as WalletManifest;
    }),
  };
}

let connectorPromise: Promise<NearConnector> | null = null;

function getConnector(): Promise<NearConnector> {
  if (!connectorPromise) {
    connectorPromise = (async () => {
      let manifest: { wallets: WalletManifest[]; version: string } | undefined;
      try {
        const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
        if (res.ok) manifest = patchManifestForTestnet((await res.json()) as { wallets: WalletManifest[]; version: string });
      } catch {
        manifest = undefined; // fall back to NEAR Connect's default manifest loading
      }
      const connector = new NearConnector({ network: NETWORK, manifest, providers: { testnet: [RPC_URL] } });
      await connector.whenManifestLoaded;
      return connector;
    })();
  }
  return connectorPromise;
}

async function currentWallet(): Promise<{ wallet: NearWalletBase; accountId: string } | null> {
  const connector = await getConnector();
  try {
    const { wallet, accounts } = await connector.getConnectedWallet();
    const accountId = accounts[0]?.accountId;
    return accountId ? { wallet, accountId } : null;
  } catch {
    return null;
  }
}

/** Open the wallet picker (Meteor, MyNearWallet, ...) and resolve with the account id. */
export async function signIn(): Promise<string> {
  const existing = await currentWallet();
  if (existing) return existing.accountId;
  const connector = await getConnector();
  const wallet = await connector.connect();
  const accounts = await wallet.getAccounts({ network: NETWORK });
  const accountId = accounts[0]?.accountId;
  if (!accountId) throw new Error("The wallet didn't return an account. Please try again.");
  return accountId;
}

export async function signedInAccount(): Promise<string | null> {
  return (await currentWallet())?.accountId ?? null;
}

export async function signOutWallet(): Promise<void> {
  const current = await currentWallet();
  if (!current) return;
  const connector = await getConnector();
  await connector.disconnect(current.wallet);
}

type Outcome = {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  status?: { SuccessValue?: string; Failure?: unknown } | string;
};

/** Sign and send one FunctionCall to the PayMe contract. Returns the tx hash and decoded return value. */
export async function callContract(
  methodName: string,
  args: Record<string, unknown>,
  depositYocto: string,
  gas: string,
): Promise<{ txHash: string; returnValue: unknown }> {
  const contractId = requireContract();
  const current = await currentWallet();
  if (!current) throw new Error("Connect a NEAR wallet first.");
  const outcome = (await current.wallet.signAndSendTransaction({
    network: NETWORK,
    signerId: current.accountId,
    receiverId: contractId,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit: depositYocto } }],
  })) as Outcome;
  const txHash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? "";
  if (!txHash) throw new Error("The wallet did not return a transaction hash.");
  const status = outcome.status;
  if (status && typeof status === "object" && "Failure" in status && status.Failure) {
    throw new Error(`Transaction failed on-chain: ${describeFailure(status.Failure)} (tx ${txHash})`);
  }
  let returnValue: unknown = undefined;
  if (status && typeof status === "object" && typeof status.SuccessValue === "string" && status.SuccessValue) {
    try {
      returnValue = JSON.parse(atob(status.SuccessValue));
    } catch {
      returnValue = undefined;
    }
  }
  return { txHash, returnValue };
}

function describeFailure(failure: unknown): string {
  const text = JSON.stringify(failure);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  return panic ? panic[1] : text.slice(0, 160);
}

// ---------------------------------------------------------------- RPC

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "payme", method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NEAR RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T & { error?: string }; error?: { cause?: { name?: string }; data?: string; message?: string } };
  if (body.error) {
    const e = new Error(`NEAR RPC error: ${body.error.cause?.name ?? body.error.data ?? body.error.message ?? "unknown"}`);
    (e as Error & { cause?: unknown }).cause = body.error.cause?.name;
    throw e;
  }
  if (body.result && typeof body.result === "object" && "error" in body.result && body.result.error) {
    throw new Error(`NEAR RPC error: ${body.result.error}`);
  }
  return body.result as T;
}

/** Call a view method on the PayMe contract. */
export async function viewContract<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
  const result = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: requireContract(),
    method_name: methodName,
    args_base64: btoa(JSON.stringify(args)),
  });
  const text = new TextDecoder().decode(Uint8Array.from(result.result));
  return JSON.parse(text) as T;
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
    return true;
  } catch (e) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(e instanceof Error ? e.message + String((e as Error & { cause?: unknown }).cause) : "")) return false;
    throw e;
  }
}

// ---------------------------------------------------------------- explorer lookup (display only)

/**
 * Best-effort lookup of the successful pay_invoice transaction for an invoice
 * via the nearblocks indexer, for devices that didn't send the payment. Used
 * only to show an explorer link; never for verification. Returns null on any problem.
 */
export async function findPaymentTxHash(invoiceId: string, payer: string): Promise<string | null> {
  try {
    const list = await fetch(`${NEARBLOCKS_API}/accounts/${encodeURIComponent(requireContract())}/txns?per_page=25`, {
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!list.ok) return null;
    const { data } = (await list.json()) as {
      data?: { transaction_hash: string; signer_account_id: string; outcomes?: { status?: boolean }; actions?: { method?: string }[] }[];
    };
    const candidates = (data ?? []).filter(
      (t) => t.signer_account_id === payer && t.outcomes?.status && t.actions?.some((a) => a.method === "pay_invoice"),
    );
    for (const t of candidates.slice(0, 3)) {
      const res = await fetch(`${NEARBLOCKS_API}/txns/${t.transaction_hash}`, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
      if (!res.ok) continue;
      const body = (await res.json()) as { data?: { actions?: { args?: { args_json?: { id?: string } } }[] } };
      if (body.data?.actions?.some((a) => a.args?.args_json?.id === invoiceId)) return t.transaction_hash;
    }
    return null;
  } catch {
    return null;
  }
}
