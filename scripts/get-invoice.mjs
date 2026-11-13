// Read an invoice straight from the PayMe contract on NEAR testnet (public RPC,
// no keys, no NEAR CLI). Usage: npm run invoice -- PM-2026-V2PN6V
const id = process.argv[2];
const contract = process.env.VITE_CONTRACT_ID || "payme-invoices.testnet";
if (!id) {
  console.error("Usage: npm run invoice -- <invoice id>   e.g. npm run invoice -- PM-2026-V2PN6V");
  process.exit(1);
}
const res = await fetch("https://test.rpc.fastnear.com", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "payme",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contract,
      method_name: "get_invoice",
      args_base64: Buffer.from(JSON.stringify({ id })).toString("base64"),
    },
  }),
  signal: AbortSignal.timeout(15_000),
});
const body = await res.json();
if (body.error || body.result?.error) {
  console.error("RPC error:", JSON.stringify(body.error ?? body.result.error));
  process.exit(1);
}
const invoice = JSON.parse(Buffer.from(body.result.result).toString("utf8"));
if (!invoice) {
  console.log(`No invoice "${id}" on ${contract}.`);
  process.exit(1);
}
const near = (yocto) => (Number(BigInt(yocto) / 10n ** 18n) / 1e6).toString();
console.log(`${contract} get_invoice("${id}"):`);
console.log(JSON.stringify(invoice, null, 2));
console.log(`\n${invoice.status}: ${near(invoice.amount_yocto)} NEAR for $${(invoice.amount_usd_cents / 100).toFixed(2)} to ${invoice.recipient}` + (invoice.payer ? `, paid by ${invoice.payer}` : ""));
console.log("Note: no client name or description is stored on-chain, only the sha256 fingerprint of the link data.");
