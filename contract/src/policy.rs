// ==============================================================================
// ANNOTATED FOR THIS DEMO TEMPLATE
// This file holds the pure, side-effect-free policy rules the contract
// enforces before it ever spends money: is the target host allowed, is this
// single call under the per-call cap, and is the running session total still
// under budget. Nothing here talks to the network or reads secrets — that's
// deliberate, so the whole file is testable with plain `cargo test` and so
// pay.rs can call these checks cheaply before doing anything riskier.
// ==============================================================================
//! Pure policy checks — no host calls, natively unit-testable with `cargo test`.

use serde::{Deserialize, Serialize};

// CUSTOMIZE: These three fields are the actual knobs for YOUR scenario — set
// per_call_cap_usdc / session_budget_usdc / host_allowlist to whatever your
// agent should be allowed to spend and where. The check_* functions below,
// however, are the enforcement logic itself; leave those alone unless you
// understand the security implications of changing them.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Policy {
    pub per_call_cap_usdc: f64,
    pub session_budget_usdc: f64,
    /// Hosts of the **third-party marketplace services** the agent is allowed to
    /// direct a payment to (e.g. `nano.blockrun.ai`) — extracted from `req.service_url`.
    /// This is a distinct dimension from Terminal 3's own `agent-auth-update` grant,
    /// which separately gates the *contract's* fixed outbound call to our own relay
    /// (see `scripts/grant.ts` / `ARCHITECTURE.md`). Conflating the two was a real bug
    /// here once: seeding this list with the relay's own host guarantees every real
    /// payment gets denied, since the relay is never the thing `extract_host` reads
    /// off of `service_url`.
    pub host_allowlist: Vec<String>,
}

/// Extract the host from a URL without pulling in a full URL-parsing crate.
/// Handles `scheme://host[:port][/path]` — good enough for the allowlist check;
/// callers pass a URL that already came from the marketplace's own service
/// listing, not untrusted freeform text.
pub fn extract_host(url: &str) -> Result<String, String> {
    let after_scheme = url
        .split("://")
        .nth(1)
        .ok_or_else(|| format!("bad url: missing scheme: {url}"))?;
    let host_and_maybe_more = after_scheme.split('/').next().unwrap_or(after_scheme);
    let host = host_and_maybe_more.split(':').next().unwrap_or(host_and_maybe_more);
    if host.is_empty() {
        return Err(format!("bad url: empty host: {url}"));
    }
    Ok(host.to_string())
}

// CUSTOMIZE: check_host_allowlist / check_per_call_cap / check_session_budget
// below are core enforcement logic, not scenario config — the numbers/hosts
// they check against come from the Policy struct above (that's what you tune).
// Changing the logic itself changes what "guarded" means for every agent call,
// so only touch these functions if you understand the security implications.
pub fn check_host_allowlist(policy: &Policy, host: &str) -> Result<(), String> {
    if policy.host_allowlist.iter().any(|h| h == host) {
        Ok(())
    } else {
        Err(format!("host '{host}' is not on the allowlist"))
    }
}

pub fn check_per_call_cap(policy: &Policy, amount_usdc: f64) -> Result<(), String> {
    if amount_usdc <= policy.per_call_cap_usdc {
        Ok(())
    } else {
        Err(format!(
            "{amount_usdc} exceeds per-call cap {}",
            policy.per_call_cap_usdc
        ))
    }
}

pub fn check_session_budget(policy: &Policy, spent: f64, amount_usdc: f64) -> Result<(), String> {
    let new_total = spent + amount_usdc;
    if new_total <= policy.session_budget_usdc {
        Ok(())
    } else {
        Err(format!(
            "session budget exhausted ({spent}/{}, this call needs {amount_usdc})",
            policy.session_budget_usdc
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> Policy {
        Policy {
            per_call_cap_usdc: 0.05,
            session_budget_usdc: 1.0,
            host_allowlist: vec!["relay.example.com".to_string()],
        }
    }

    #[test]
    fn extract_host_basic() {
        assert_eq!(
            extract_host("https://relay.example.com/pay").unwrap(),
            "relay.example.com"
        );
    }

    #[test]
    fn extract_host_with_port() {
        assert_eq!(
            extract_host("https://relay.example.com:8787/pay").unwrap(),
            "relay.example.com"
        );
    }

    #[test]
    fn extract_host_no_path() {
        assert_eq!(
            extract_host("https://relay.example.com").unwrap(),
            "relay.example.com"
        );
    }

    #[test]
    fn extract_host_missing_scheme_errors() {
        assert!(extract_host("relay.example.com/pay").is_err());
    }

    #[test]
    fn host_allowlist_passes_for_allowed_host() {
        assert!(check_host_allowlist(&policy(), "relay.example.com").is_ok());
    }

    #[test]
    fn host_allowlist_rejects_other_host() {
        let err = check_host_allowlist(&policy(), "evil.example.com").unwrap_err();
        assert!(err.contains("not on the allowlist"));
    }

    // Regression test using the EXACT real-world data from a live debugging session
    // (see docs/DEVELOPER_BUILD_LOG.md §3p) -- ruling out a host-matching bug
    // (case sensitivity, scheme/port/path leaking into the comparison, hidden
    // characters) as the cause of a real dispatch failure, rather than assuming
    // the generic fixtures above cover it.
    #[test]
    fn real_blockrun_url_extracts_and_matches_real_allowlist() {
        let real_policy = Policy {
            per_call_cap_usdc: 0.05,
            session_budget_usdc: 1.0,
            host_allowlist: vec![
                "aisa.one".to_string(),
                "nano.blockrun.ai".to_string(),
                "x402-data-tools.prd.arrays.org".to_string(),
                "premium-news.example.com".to_string(),
            ],
        };
        let real_url = "https://nano.blockrun.ai/api/v1/surf/exchange/markets";
        let host = extract_host(real_url).unwrap();
        assert_eq!(host, "nano.blockrun.ai");
        assert_eq!(host.len(), "nano.blockrun.ai".len(), "no hidden/extra characters");
        assert!(
            check_host_allowlist(&real_policy, &host).is_ok(),
            "extracted host {host:?} should match the real allowlist"
        );
    }

    #[test]
    fn per_call_cap_passes_at_exactly_the_cap() {
        assert!(check_per_call_cap(&policy(), 0.05).is_ok());
    }

    #[test]
    fn per_call_cap_rejects_over_cap() {
        let err = check_per_call_cap(&policy(), 0.06).unwrap_err();
        assert!(err.contains("exceeds per-call cap"));
    }

    #[test]
    fn session_budget_passes_when_under() {
        assert!(check_session_budget(&policy(), 0.90, 0.05).is_ok());
    }

    #[test]
    fn session_budget_passes_at_exactly_the_limit() {
        assert!(check_session_budget(&policy(), 0.95, 0.05).is_ok());
    }

    #[test]
    fn session_budget_rejects_over_limit() {
        let err = check_session_budget(&policy(), 0.98, 0.05).unwrap_err();
        assert!(err.contains("session budget exhausted"));
    }
}
