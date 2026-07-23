// ==============================================================================
// ANNOTATED FOR THIS DEMO TEMPLATE
// This is the contract's entry point. It wires the WIT world (generated below
// by wit_bindgen::generate!) to the actual Rust logic in pay.rs / policy.rs /
// ledger.rs / relay_client.rs, and implements the two exported functions the
// T3 node calls: `pay-for-service` (the guarded payment flow) and `get-ledger`
// (read-only audit trail for the dashboard). Everything else in this file is
// original project documentation — read on for the full picture.
// ==============================================================================
//! guarded-commerce v0.1.3 — Terminal 3 x Circle "Guarded Agent Commerce" demo.
//!
//! `pay-for-service`: enforces a host allowlist, per-call USDC cap, session
//! budget, and idempotency dedupe inside the enclave before ever touching the
//! sealed relay credentials or making an outbound call. On pass, calls a
//! payment-relay service we own (POST /pay) which executes the real Circle
//! CLI x402 flow — this contract never talks to Circle directly, and never
//! signs anything itself (see docs/DEVELOPER_BUILD_LOG.md §3a for why: the
//! host ABI's `signing`/`outbox` capabilities exist but are not yet linked
//! into tenant worlds).
//!
//! `get-ledger`: read-only fold over the append-log ledger — the dashboard's
//! source of truth, independent of what the agent process self-reports.
//!
//! Revocation is not a function on this contract: the data owner clears the
//! agent's `agent-auth-update` grant for this contract's allowed hosts, and
//! the next `pay-for-service` call's outbound call to the relay fails with
//! `host/http.egress_denied` — the same mechanism `z-tenant-flight` and the
//! prior `curve-demo` both rely on.

pub const CONTRACT_VERSION: &str = "0.1.3";

wit_bindgen::generate!({
    world: "guarded-commerce",
    path: "wit",
    additional_derives: [
        serde::Deserialize,
        serde::Serialize,
    ],
    generate_all,
});

mod ledger;
mod pay;
mod policy;
mod relay_client;

struct Component;

#[cfg(target_arch = "wasm32")]
impl exports::z::guarded_commerce::contracts::Guest for Component {
    fn pay_for_service(
        req: exports::z::guarded_commerce::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.ok_or("pay-for-service: missing input")?;
        pay::pay_for_service(&input)
    }

    fn get_ledger(
        req: exports::z::guarded_commerce::contracts::GenericInput,
    ) -> Result<Vec<u8>, String> {
        let input = req.input.unwrap_or_default();
        ledger::get_ledger(&input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "CONTRACT_VERSION must be MAJOR.MINOR.PATCH");
        for part in parts {
            assert!(part.parse::<u32>().is_ok(), "each part must be a number");
        }
    }
}
