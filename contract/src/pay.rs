// ==============================================================================
// ANNOTATED FOR THIS DEMO TEMPLATE
// This is the heart of the "guarded" part of guarded agent commerce. It's what
// runs when the agent (via the T3 node) calls `pay-for-service`: it checks
// policy.rs's rules in order, and only if every check passes does it read the
// sealed relay secret and call out to relay_client.rs, which does the actual
// Circle x402 payment. If you're new to this repo, read the checks in
// `pay_for_service_wasm` top to bottom — that order is the whole security story.
// ==============================================================================
//! `pay-for-service` — the policy authority. Enforces host allowlist, per-call
//! cap, session budget, and idempotency dedupe entirely inside the enclave
//! *before* touching secrets or making any outbound call. Only on success does
//! it read the sealed relay credentials and call out.
//!
//! Every *business* outcome (allowed, denied, relay failed) returns `Ok` --
//! never `Err` -- so its ledger entry commits. `Err` is reserved for genuine
//! infrastructure faults (bad input, KV read/write failure) that have nothing
//! meaningful to record anyway. This was a real bug once: returning `Err` for
//! a denial meant the host rolled back the `append_entry` write made just
//! before it, so denied attempts never actually persisted against real
//! infrastructure even though they appeared to locally in mock mode (which
//! has no such rollback semantics). See docs/DEVELOPER_BUILD_LOG.md §3p/§3r.

use crate::ledger::{self, LedgerEntry};
use crate::policy;
use crate::relay_client::{self, RelayPayRequest};
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use crate::host::interfaces::logging;

#[derive(Debug, Deserialize)]
pub struct PayRequest {
    pub service_url: String,
    pub method: String,
    pub amount_usdc: f64,
    #[serde(default)]
    pub payload: serde_json::Value,
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
pub struct PayResponse {
    pub authorized: bool,
    pub remaining_budget: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_response: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

pub fn pay_for_service(input: &[u8]) -> Result<Vec<u8>, String> {
    let req: PayRequest =
        serde_json::from_slice(input).map_err(|e| format!("pay-for-service: bad input: {e}"))?;

    #[cfg(target_arch = "wasm32")]
    {
        pay_for_service_wasm(req)
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = req;
        Err("pay_for_service is only implemented on the wasm32 target".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
fn pay_for_service_wasm(req: PayRequest) -> Result<Vec<u8>, String> {
    let policy = ledger::read_policy()?;
    // Read this up front, not just for the session-budget check below, so
    // every denial reason can report an accurate remaining_budget.
    let spent = ledger::read_running_total()?;
    let remaining_budget = policy.session_budget_usdc - spent;

    // CUSTOMIZE: The order of the four checks below (host allowlist -> per-call
    // cap -> session budget -> idempotency) is intentional — leave it as-is.
    // Each check here is "cheap" (pure in-memory/KV comparisons, no secrets, no
    // network) and runs before the one truly "expensive/sensitive" step further
    // down (reading the sealed relay secret and making the outbound call). By
    // failing fast on the cheap, safe checks first, a misconfigured or malicious
    // call never gets anywhere near secrets or the network — it's denied before
    // any of that is even reachable.

    // 1. Host allowlist — checked before anything else touches state. This checks
    //    the THIRD-PARTY service's host (e.g. nano.blockrun.ai), not our relay's
    //    host: it's the "which marketplace sellers can this agent pay" dimension,
    //    separate from the agent-auth-update grant that gates the enclave's own
    //    fixed egress to the relay. See policy.rs's Policy::host_allowlist doc.
    let host = policy::extract_host(&req.service_url)?;
    if let Err(reason) = policy::check_host_allowlist(&policy, &host) {
        return deny(&req, &format!("policy_denied: {reason}"), remaining_budget);
    }

    // 2. Per-call cap.
    if let Err(reason) = policy::check_per_call_cap(&policy, req.amount_usdc) {
        return deny(&req, &format!("policy_denied: {reason}"), remaining_budget);
    }

    // 3. Session budget, against the current running total.
    if let Err(reason) = policy::check_session_budget(&policy, spent, req.amount_usdc) {
        return deny(&req, &format!("policy_denied: {reason}"), remaining_budget);
    }

    // 4. Idempotency dedupe — a retried call with the same key must not double-spend.
    if ledger::is_idempotency_key_used(&req.idempotency_key)? {
        return deny(
            &req,
            &format!("policy_denied: duplicate idempotency_key '{}'", req.idempotency_key),
            remaining_budget,
        );
    }

    // All checks passed — only now do we touch secrets or make an outbound call.
    let relay_base_url = ledger::read_secret("relay_base_url")?;
    let relay_shared_secret = ledger::read_secret("relay_shared_secret")?;

    let relay_req = RelayPayRequest {
        service_url: &req.service_url,
        method: &req.method,
        payload: &req.payload,
        idempotency_key: &req.idempotency_key,
    };

    let relay_result = relay_client::call_pay(&relay_base_url, &relay_shared_secret, &relay_req);

    match relay_result {
        Ok(relay_resp) => {
            let new_total = spent + req.amount_usdc;
            ledger::write_running_total(new_total)?;
            ledger::mark_idempotency_key_used(&req.idempotency_key)?;
            let remaining_budget = policy.session_budget_usdc - new_total;
            let _ = logging::info(&format!(
                "paid {} USDC to {} (remaining budget {remaining_budget})",
                req.amount_usdc, req.service_url
            ));
            ledger::append_entry(LedgerEntry {
                seq: 0, // overwritten by append_entry
                ts: 0,  // overwritten by append_entry
                service_url: req.service_url.clone(),
                amount_usdc: req.amount_usdc,
                status: "paid".to_string(),
                reason: None,
                remaining_budget: Some(remaining_budget),
                idempotency_key: req.idempotency_key.clone(),
                relay_ref: Some(relay_resp.relay_ref.clone()),
            })?;
            serde_json::to_vec(&PayResponse {
                authorized: true,
                remaining_budget,
                relay_ref: Some(relay_resp.relay_ref),
                service_response: Some(relay_resp.service_response),
                reason: None,
            })
            .map_err(|e| e.to_string())
        }
        Err(relay_err) => {
            let reason = format!("relay_failed: {relay_err}");
            ledger::append_entry(LedgerEntry {
                seq: 0,
                ts: 0,
                service_url: req.service_url.clone(),
                amount_usdc: req.amount_usdc,
                status: "failed".to_string(),
                reason: Some(reason.clone()),
                remaining_budget: Some(remaining_budget),
                idempotency_key: req.idempotency_key.clone(),
                relay_ref: None,
            })?;
            serde_json::to_vec(&PayResponse {
                authorized: false,
                remaining_budget,
                relay_ref: None,
                service_response: None,
                reason: Some(reason),
            })
            .map_err(|e| e.to_string())
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn deny(req: &PayRequest, reason: &str, remaining_budget: f64) -> Result<Vec<u8>, String> {
    let _ = logging::info(&format!("{reason} (service: {})", req.service_url));
    ledger::append_entry(LedgerEntry {
        seq: 0,
        ts: 0,
        service_url: req.service_url.clone(),
        amount_usdc: req.amount_usdc,
        status: "denied".to_string(),
        reason: Some(reason.to_string()),
        remaining_budget: Some(remaining_budget),
        idempotency_key: req.idempotency_key.clone(),
        relay_ref: None,
    })?;
    serde_json::to_vec(&PayResponse {
        authorized: false,
        remaining_budget,
        relay_ref: None,
        service_response: None,
        reason: Some(reason.to_string()),
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pay_for_service_non_wasm_returns_err() {
        let input = serde_json::to_vec(&serde_json::json!({
            "service_url": "https://relay.example.com/pay",
            "method": "POST",
            "amount_usdc": 0.01,
            "payload": {},
            "idempotency_key": "abc123",
        }))
        .unwrap();
        let result = pay_for_service(&input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("only implemented on the wasm32 target"));
    }

    #[test]
    fn pay_for_service_bad_input_returns_err() {
        let result = pay_for_service(b"not json");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("bad input"));
    }
}
