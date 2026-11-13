use super::*;
use near_sdk::test_utils::{accounts, get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken, PromiseResult};

const FP: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const STORAGE_DEPOSIT: NearToken = NearToken::from_millinear(10);

fn contract_id() -> AccountId {
    "payme.testnet".parse().unwrap()
}

fn ctx(predecessor: &AccountId, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor.clone())
        .attached_deposit(deposit)
        .block_timestamp(1_700_000_000_000_000_000);
    b
}

fn set(predecessor: &AccountId, deposit: NearToken) {
    testing_env!(ctx(predecessor, deposit).build());
}

fn create(c: &mut Contract, id: &str, recipient: &AccountId, amount: u128) -> Invoice {
    set(&accounts(0), STORAGE_DEPOSIT);
    c.create_invoice(id.to_string(), recipient.clone(), U128(amount), 25_000, FP.to_string())
}

/// All plain transfers created in the current mocked execution: (receiver, yocto).
fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::Transfer { deposit, .. } => {
                    Some((receiver.clone(), deposit.as_yoctonear()))
                }
                _ => None,
            })
        })
        .collect()
}

fn function_calls() -> Vec<(String, String)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::FunctionCallWeight { method_name, .. } => {
                    Some((receiver.clone(), String::from_utf8(method_name).unwrap()))
                }
                _ => None,
            })
        })
        .collect()
}

// ---------- create_invoice ----------

#[test]
fn create_invoice_stores_record_and_emits_event() {
    let mut c = Contract::default();
    let inv = create(&mut c, "inv-1", &accounts(1), 2 * ONE_NEAR);

    assert_eq!(inv.id, "inv-1");
    assert_eq!(inv.creator, accounts(0));
    assert_eq!(inv.recipient, accounts(1));
    assert_eq!(inv.amount_yocto, U128(2 * ONE_NEAR));
    assert_eq!(inv.amount_usd_cents, 25_000);
    assert_eq!(inv.fingerprint, FP);
    assert_eq!(inv.status, InvoiceStatus::Pending);
    assert_eq!(inv.created_at_ms, 1_700_000_000_000);
    assert_eq!(inv.paid_at_ms, None);
    assert_eq!(inv.payer, None);
    assert_eq!(c.get_invoice("inv-1".into()), Some(inv));

    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert!(logs[0].starts_with("EVENT_JSON:"));
    let ev: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(&logs[0]["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(ev["standard"], "payme");
    assert_eq!(ev["version"], "1.0.0");
    assert_eq!(ev["event"], "invoice_created");
    // near-sdk emits `data` as an object for struct-like event variants.
    assert_eq!(ev["data"]["id"], "inv-1");
    assert_eq!(ev["data"]["fingerprint"], FP);
}

#[test]
fn create_invoice_charges_storage_and_refunds_excess() {
    // testing_env! resets storage_usage, so measure within one mocked call.
    let mut c = Contract::default();
    set(&accounts(0), STORAGE_DEPOSIT);
    let before = env::storage_usage();
    c.create_invoice("inv-1".into(), accounts(1), U128(ONE_NEAR), 25_000, FP.into());
    let used = env::storage_usage() - before;
    assert!(used > 0);
    let cost = env::storage_byte_cost().as_yoctonear() * u128::from(used);

    let t = transfers();
    assert_eq!(t.len(), 1, "exactly one refund transfer: {t:?}");
    assert_eq!(t[0].0, accounts(0).to_string());
    assert_eq!(t[0].1, STORAGE_DEPOSIT.as_yoctonear() - cost);
}

#[test]
fn create_invoice_exact_storage_deposit_has_no_refund() {
    // Mocked storage persists across testing_env! calls. The 2nd and 3rd invoices
    // for the same recipient (same id length) use the same number of bytes, so
    // measure the 2nd, then pay exactly that for the 3rd.
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), ONE_NEAR);
    set(&accounts(0), STORAGE_DEPOSIT);
    let before = env::storage_usage();
    c.create_invoice("inv-2".into(), accounts(1), U128(ONE_NEAR), 25_000, FP.into());
    let cost = env::storage_byte_cost().as_yoctonear() * u128::from(env::storage_usage() - before);

    set(&accounts(0), NearToken::from_yoctonear(cost));
    c.create_invoice("inv-3".into(), accounts(1), U128(ONE_NEAR), 25_000, FP.into());
    assert!(transfers().is_empty());
}

#[test]
#[should_panic(expected = "does not cover storage cost")]
fn create_invoice_rejects_missing_storage_deposit() {
    let mut c = Contract::default();
    set(&accounts(0), NearToken::from_yoctonear(0));
    c.create_invoice("inv-1".into(), accounts(1), U128(ONE_NEAR), 25_000, FP.into());
}

#[test]
#[should_panic(expected = "Invoice id already exists")]
fn create_invoice_rejects_duplicate_id() {
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), ONE_NEAR);
    create(&mut c, "inv-1", &accounts(2), ONE_NEAR);
}

#[test]
#[should_panic(expected = "Invoice id must not be empty")]
fn create_invoice_rejects_empty_id() {
    let mut c = Contract::default();
    create(&mut c, "", &accounts(1), ONE_NEAR);
}

#[test]
#[should_panic(expected = "at most 64 characters")]
fn create_invoice_rejects_oversized_id() {
    let mut c = Contract::default();
    create(&mut c, &"a".repeat(65), &accounts(1), ONE_NEAR);
}

#[test]
fn create_invoice_accepts_64_char_id() {
    let mut c = Contract::default();
    let id = "a".repeat(64);
    create(&mut c, &id, &accounts(1), ONE_NEAR);
    assert!(c.get_invoice(id).is_some());
}

#[test]
#[should_panic(expected = "may only contain")]
fn create_invoice_rejects_id_with_invalid_characters() {
    let mut c = Contract::default();
    create(&mut c, "inv/1#x", &accounts(1), ONE_NEAR);
}

#[test]
#[should_panic(expected = "64-character hex")]
fn create_invoice_rejects_short_fingerprint() {
    let mut c = Contract::default();
    set(&accounts(0), STORAGE_DEPOSIT);
    c.create_invoice("inv-1".into(), accounts(1), U128(ONE_NEAR), 100, "abc123".into());
}

#[test]
#[should_panic(expected = "64-character hex")]
fn create_invoice_rejects_non_hex_fingerprint() {
    let mut c = Contract::default();
    set(&accounts(0), STORAGE_DEPOSIT);
    let bad = format!("{}zz", &FP[..62]);
    c.create_invoice("inv-1".into(), accounts(1), U128(ONE_NEAR), 100, bad);
}

#[test]
fn create_invoice_normalizes_uppercase_fingerprint() {
    let mut c = Contract::default();
    set(&accounts(0), STORAGE_DEPOSIT);
    let inv = c.create_invoice(
        "inv-1".into(),
        accounts(1),
        U128(ONE_NEAR),
        100,
        FP.to_ascii_uppercase(),
    );
    assert_eq!(inv.fingerprint, FP);
}

#[test]
#[should_panic(expected = "amount_yocto must be greater than zero")]
fn create_invoice_rejects_zero_yocto() {
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), 0);
}

#[test]
#[should_panic(expected = "amount_usd_cents must be greater than zero")]
fn create_invoice_rejects_zero_usd_cents() {
    let mut c = Contract::default();
    set(&accounts(0), STORAGE_DEPOSIT);
    c.create_invoice("inv-1".into(), accounts(1), U128(ONE_NEAR), 0, FP.into());
}

// ---------- pay_invoice ----------

#[test]
fn pay_invoice_exact_amount_marks_paid_and_forwards_funds() {
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), 2 * ONE_NEAR);

    let mut b = ctx(&accounts(2), NearToken::from_yoctonear(2 * ONE_NEAR));
    b.block_timestamp(1_700_000_500_000_000_000);
    testing_env!(b.build());
    let _ = c.pay_invoice("inv-1".into());

    let inv = c.get_invoice("inv-1".into()).unwrap();
    assert_eq!(inv.status, InvoiceStatus::Paid);
    assert_eq!(inv.payer, Some(accounts(2)));
    assert_eq!(inv.paid_at_ms, Some(1_700_000_500_000));

    // Only the forward to the recipient; no refund when paying the exact amount.
    assert_eq!(transfers(), vec![(accounts(1).to_string(), 2 * ONE_NEAR)]);
    assert_eq!(
        function_calls(),
        vec![(contract_id().to_string(), "on_payout".to_string())]
    );
}

#[test]
fn pay_invoice_refunds_excess_to_payer() {
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), 2 * ONE_NEAR);

    set(&accounts(2), NearToken::from_yoctonear(3 * ONE_NEAR + 7));
    let _ = c.pay_invoice("inv-1".into());

    let mut t = transfers();
    t.sort();
    let mut expected = vec![
        (accounts(1).to_string(), 2 * ONE_NEAR),
        (accounts(2).to_string(), ONE_NEAR + 7),
    ];
    expected.sort();
    assert_eq!(t, expected);
}

#[test]
#[should_panic(expected = "is less than the invoice amount")]
fn pay_invoice_rejects_underpayment() {
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), 2 * ONE_NEAR);
    set(&accounts(2), NearToken::from_yoctonear(2 * ONE_NEAR - 1));
    let _ = c.pay_invoice("inv-1".into());
}

#[test]
#[should_panic(expected = "Invoice is already paid")]
fn pay_invoice_rejects_paying_twice() {
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), ONE_NEAR);
    set(&accounts(2), NearToken::from_yoctonear(ONE_NEAR));
    let _ = c.pay_invoice("inv-1".into());
    set(&accounts(3), NearToken::from_yoctonear(ONE_NEAR));
    let _ = c.pay_invoice("inv-1".into());
}

#[test]
#[should_panic(expected = "Invoice not found")]
fn pay_invoice_rejects_unknown_invoice() {
    let mut c = Contract::default();
    set(&accounts(2), NearToken::from_yoctonear(ONE_NEAR));
    let _ = c.pay_invoice("nope".into());
}

// ---------- on_payout callback ----------

fn set_callback(result: PromiseResult) {
    testing_env!(
        ctx(&contract_id(), NearToken::from_yoctonear(0)).build(),
        near_sdk::test_vm_config(),
        near_parameters::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn paid_contract() -> Contract {
    let mut c = Contract::default();
    create(&mut c, "inv-1", &accounts(1), 2 * ONE_NEAR);
    set(&accounts(2), NearToken::from_yoctonear(2 * ONE_NEAR));
    let _ = c.pay_invoice("inv-1".into());
    c
}

#[test]
fn on_payout_success_emits_invoice_paid() {
    let mut c = paid_contract();
    set_callback(PromiseResult::Successful(vec![]));
    assert!(c.on_payout("inv-1".into(), accounts(2), U128(2 * ONE_NEAR)));

    assert_eq!(c.get_invoice("inv-1".into()).unwrap().status, InvoiceStatus::Paid);
    assert!(transfers().is_empty());
    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert!(logs[0].contains(r#""event":"invoice_paid""#), "{}", logs[0]);
    assert!(logs[0].contains(r#""standard":"payme""#));
}

#[test]
fn on_payout_failure_reopens_invoice_and_refunds_payer() {
    let mut c = paid_contract();
    set_callback(PromiseResult::Failed);
    assert!(!c.on_payout("inv-1".into(), accounts(2), U128(2 * ONE_NEAR)));

    let inv = c.get_invoice("inv-1".into()).unwrap();
    assert_eq!(inv.status, InvoiceStatus::Pending);
    assert_eq!(inv.payer, None);
    assert_eq!(inv.paid_at_ms, None);
    assert_eq!(transfers(), vec![(accounts(2).to_string(), 2 * ONE_NEAR)]);
    assert!(get_logs()[0].contains(r#""event":"invoice_payment_reverted""#));
}

// #[private] is enforced by the generated wasm entry point, which unit tests
// bypass; it is verified on testnet instead (see RESULTS.md).

// ---------- views ----------

#[test]
fn get_invoice_returns_none_for_unknown_id() {
    let c = Contract::default();
    assert_eq!(c.get_invoice("missing".into()), None);
}

#[test]
fn get_invoices_by_recipient_is_newest_first_and_paginated() {
    let mut c = Contract::default();
    for i in 0..5 {
        create(&mut c, &format!("a-{i}"), &accounts(1), ONE_NEAR);
    }
    create(&mut c, "b-0", &accounts(2), ONE_NEAR);

    let ids = |v: Vec<Invoice>| v.into_iter().map(|i| i.id).collect::<Vec<_>>();
    assert_eq!(
        ids(c.get_invoices_by_recipient(accounts(1), None, None)),
        vec!["a-4", "a-3", "a-2", "a-1", "a-0"]
    );
    assert_eq!(
        ids(c.get_invoices_by_recipient(accounts(1), Some(1), Some(2))),
        vec!["a-3", "a-2"]
    );
    assert_eq!(
        ids(c.get_invoices_by_recipient(accounts(1), Some(4), Some(10))),
        vec!["a-0"]
    );
    assert!(c.get_invoices_by_recipient(accounts(1), Some(5), None).is_empty());
    assert_eq!(ids(c.get_invoices_by_recipient(accounts(2), None, None)), vec!["b-0"]);
    assert!(c.get_invoices_by_recipient(accounts(3), None, None).is_empty());
    assert_eq!(c.get_invoice_count_by_recipient(accounts(1)), 5);
    assert_eq!(c.get_invoice_count_by_recipient(accounts(3)), 0);
}

#[test]
fn get_invoices_by_recipient_caps_limit() {
    let mut c = Contract::default();
    for i in 0..(MAX_PAGE_LIMIT + 5) {
        create(&mut c, &format!("x-{i}"), &accounts(1), ONE_NEAR);
    }
    assert_eq!(
        c.get_invoices_by_recipient(accounts(1), None, Some(1000)).len(),
        MAX_PAGE_LIMIT as usize
    );
    assert_eq!(
        c.get_invoices_by_recipient(accounts(1), None, None).len(),
        DEFAULT_PAGE_LIMIT as usize
    );
}

#[test]
fn views_reflect_paid_status() {
    let mut c = paid_contract();
    set_callback(PromiseResult::Successful(vec![]));
    c.on_payout("inv-1".into(), accounts(2), U128(2 * ONE_NEAR));
    let list = c.get_invoices_by_recipient(accounts(1), None, None);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].status, InvoiceStatus::Paid);
    assert_eq!(list[0].payer, Some(accounts(2)));
}
