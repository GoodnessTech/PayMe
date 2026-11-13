//! PayMe invoice contract (NEAR testnet).
//!
//! Privacy by design: only the data needed to settle an invoice is stored
//! on-chain (id, creator, recipient, amounts, fingerprint, status, timestamps,
//! payer). Client name and description stay in the payment link after `#`;
//! the `fingerprint` (sha256 of that link data) lets the pay page detect a
//! tampered link without revealing its contents.
//!
//! There are no owner/admin powers. The contract never keeps invoice money:
//! `pay_invoice` forwards the amount to the recipient in the same transaction,
//! refunds any excess to the payer, and if the forward fails, the
//! `on_payout` callback refunds the payer and reopens the invoice.

use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, is_promise_success, near, require, AccountId, BorshStorageKey, Gas, NearToken, Promise,
};

/// Maximum invoice id length (bytes).
pub const MAX_ID_LEN: usize = 64;
/// Length of a hex-encoded sha256 digest.
pub const FINGERPRINT_LEN: usize = 64;
/// Default and maximum page size for `get_invoices_by_recipient`.
pub const DEFAULT_PAGE_LIMIT: u32 = 20;
pub const MAX_PAGE_LIMIT: u32 = 100;
/// Gas reserved for the `on_payout` callback.
pub const GAS_FOR_ON_PAYOUT: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Invoices,
    ByRecipient,
    RecipientList { account_hash: Vec<u8> },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InvoiceStatus {
    Pending,
    Paid,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invoice {
    pub id: String,
    pub creator: AccountId,
    pub recipient: AccountId,
    pub amount_yocto: U128,
    pub amount_usd_cents: u64,
    /// Lowercase hex sha256 of the link data (64 chars).
    pub fingerprint: String,
    pub status: InvoiceStatus,
    pub created_at_ms: u64,
    pub paid_at_ms: Option<u64>,
    pub payer: Option<AccountId>,
}

/// NEP-297 events: `EVENT_JSON:{"standard":"payme","version":"1.0.0","event":"invoice_created",...}`
#[near(event_json(standard = "payme"))]
pub enum PaymeEvent {
    #[event_version("1.0.0")]
    InvoiceCreated {
        id: String,
        creator: AccountId,
        recipient: AccountId,
        amount_yocto: U128,
        amount_usd_cents: u64,
        fingerprint: String,
    },
    #[event_version("1.0.0")]
    InvoicePaid {
        id: String,
        payer: AccountId,
        recipient: AccountId,
        amount_yocto: U128,
    },
    /// Emitted only if forwarding the payment to the recipient failed
    /// (e.g. the recipient account does not exist). The payer is refunded.
    #[event_version("1.0.0")]
    InvoicePaymentReverted {
        id: String,
        payer: AccountId,
        amount_yocto: U128,
    },
}

#[near(contract_state)]
pub struct Contract {
    invoices: LookupMap<String, Invoice>,
    by_recipient: LookupMap<AccountId, Vector<String>>,
}

impl Default for Contract {
    fn default() -> Self {
        Self {
            invoices: LookupMap::new(StorageKey::Invoices),
            by_recipient: LookupMap::new(StorageKey::ByRecipient),
        }
    }
}

fn assert_valid_id(id: &str) {
    require!(!id.is_empty(), "Invoice id must not be empty");
    require!(
        id.len() <= MAX_ID_LEN,
        format!("Invoice id must be at most {MAX_ID_LEN} characters")
    );
    require!(
        id.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        "Invoice id may only contain letters, digits, '-' and '_'"
    );
}

fn normalize_fingerprint(fingerprint: &str) -> String {
    require!(
        fingerprint.len() == FINGERPRINT_LEN && fingerprint.bytes().all(|b| b.is_ascii_hexdigit()),
        "Fingerprint must be a 64-character hex sha256 digest"
    );
    fingerprint.to_ascii_lowercase()
}

#[near]
impl Contract {
    /// Register a new invoice. The caller pays for the storage it uses:
    /// attach a deposit (0.01 NEAR is plenty); the unused part is refunded.
    #[payable]
    pub fn create_invoice(
        &mut self,
        id: String,
        recipient: AccountId,
        amount_yocto: U128,
        amount_usd_cents: u64,
        fingerprint: String,
    ) -> Invoice {
        assert_valid_id(&id);
        let fingerprint = normalize_fingerprint(&fingerprint);
        require!(amount_yocto.0 > 0, "amount_yocto must be greater than zero");
        require!(amount_usd_cents > 0, "amount_usd_cents must be greater than zero");
        require!(!self.invoices.contains_key(&id), "Invoice id already exists");

        let creator = env::predecessor_account_id();
        let storage_before = env::storage_usage();

        let invoice = Invoice {
            id: id.clone(),
            creator: creator.clone(),
            recipient: recipient.clone(),
            amount_yocto,
            amount_usd_cents,
            fingerprint: fingerprint.clone(),
            status: InvoiceStatus::Pending,
            created_at_ms: env::block_timestamp_ms(),
            paid_at_ms: None,
            payer: None,
        };
        self.invoices.insert(id.clone(), invoice.clone());
        self.invoices.flush();

        let list = self.by_recipient.entry(recipient.clone()).or_insert_with(|| {
            Vector::new(StorageKey::RecipientList {
                account_hash: env::sha256(recipient.as_bytes()),
            })
        });
        list.push(id.clone());
        list.flush();
        self.by_recipient.flush();

        // `store` collections write lazily; the flushes above make the
        // measurement below include every byte this call adds.
        let bytes_used = env::storage_usage().saturating_sub(storage_before);
        let storage_cost = env::storage_byte_cost().saturating_mul(u128::from(bytes_used));
        let attached = env::attached_deposit();
        require!(
            attached >= storage_cost,
            format!(
                "Attached deposit {} yoctoNEAR does not cover storage cost {} yoctoNEAR ({} bytes)",
                attached.as_yoctonear(),
                storage_cost.as_yoctonear(),
                bytes_used
            )
        );

        let refund = attached.saturating_sub(storage_cost);
        if !refund.is_zero() {
            Promise::new(creator.clone()).transfer(refund).detach();
        }

        PaymeEvent::InvoiceCreated {
            id,
            creator,
            recipient,
            amount_yocto,
            amount_usd_cents,
            fingerprint,
        }
        .emit();

        invoice
    }

    /// Pay a pending invoice with NEAR. Attach at least `amount_yocto`;
    /// the amount goes to the recipient, any excess is refunded to the payer.
    /// Resolves to `true` once the recipient has been paid.
    #[payable]
    pub fn pay_invoice(&mut self, id: String) -> Promise {
        let payer = env::predecessor_account_id();
        let attached = env::attached_deposit();

        let mut invoice = self
            .invoices
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Invoice not found"));
        require!(invoice.status == InvoiceStatus::Pending, "Invoice is already paid");

        let amount = NearToken::from_yoctonear(invoice.amount_yocto.0);
        require!(
            attached >= amount,
            format!(
                "Attached deposit {} yoctoNEAR is less than the invoice amount {} yoctoNEAR",
                attached.as_yoctonear(),
                amount.as_yoctonear()
            )
        );

        invoice.status = InvoiceStatus::Paid;
        invoice.payer = Some(payer.clone());
        invoice.paid_at_ms = Some(env::block_timestamp_ms());
        let recipient = invoice.recipient.clone();
        self.invoices.insert(id.clone(), invoice);

        let excess = attached.saturating_sub(amount);
        if !excess.is_zero() {
            Promise::new(payer.clone()).transfer(excess).detach();
        }

        Promise::new(recipient).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_PAYOUT)
                .on_payout(id, payer, U128(amount.as_yoctonear())),
        )
    }

    /// Callback after forwarding the payment. On failure the invoice is
    /// reopened and the payer refunded, so funds never stay in the contract.
    #[private]
    pub fn on_payout(&mut self, id: String, payer: AccountId, amount_yocto: U128) -> bool {
        let success = is_promise_success();
        let mut invoice = self
            .invoices
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Invoice not found"));

        if success {
            PaymeEvent::InvoicePaid {
                id,
                payer,
                recipient: invoice.recipient,
                amount_yocto,
            }
            .emit();
            return true;
        }

        invoice.status = InvoiceStatus::Pending;
        invoice.payer = None;
        invoice.paid_at_ms = None;
        self.invoices.insert(id.clone(), invoice);
        Promise::new(payer.clone())
            .transfer(NearToken::from_yoctonear(amount_yocto.0))
            .detach();
        PaymeEvent::InvoicePaymentReverted {
            id,
            payer,
            amount_yocto,
        }
        .emit();
        false
    }

    pub fn get_invoice(&self, id: String) -> Option<Invoice> {
        self.invoices.get(&id).cloned()
    }

    /// Invoices for `account_id`, newest first. `from_index` counts from the
    /// newest invoice (0 = newest). `limit` defaults to 20, max 100.
    pub fn get_invoices_by_recipient(
        &self,
        account_id: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<Invoice> {
        let Some(list) = self.by_recipient.get(&account_id) else {
            return vec![];
        };
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT).min(MAX_PAGE_LIMIT) as usize;
        (0..list.len())
            .rev()
            .skip(from)
            .take(limit)
            .filter_map(|i| list.get(i).and_then(|id| self.invoices.get(id)).cloned())
            .collect()
    }

    pub fn get_invoice_count_by_recipient(&self, account_id: AccountId) -> u32 {
        self.by_recipient.get(&account_id).map_or(0, |list| list.len())
    }
}

#[cfg(test)]
mod tests;
