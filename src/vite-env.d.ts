/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed PayMe contract on NEAR testnet, e.g. payme-invoices.testnet */
  readonly VITE_CONTRACT_ID?: string;
  /** Must be "testnet": this project never touches mainnet funds. */
  readonly VITE_NEAR_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
