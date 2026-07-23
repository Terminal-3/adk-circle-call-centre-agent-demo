// ==============================================================================
// ANNOTATED FOR THIS DEMO TEMPLATE
// This is the contract's ONLY outbound network call: after pay.rs has passed
// every policy check and pulled the sealed relay credentials, it calls
// `call_pay` here, which POSTs to our own payment-relay service (a small
// server outside the enclave that actually runs the Circle CLI x402 flow).
// This file never talks to Circle directly — that's the relay's job.
// ==============================================================================
//! The contract's one and only outbound call: POST to our own payment-relay,
//! authenticated with a shared secret sealed in `z:<tid>:secrets`. Revoking
//! the calling agent's `agent-auth-update` grant on this host is what makes
//! this call start failing with `host/http.egress_denied` — the same,
//! already-proven revocation path `curve-demo` used.

use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use crate::host::interfaces::http as http_iface;
#[cfg(target_arch = "wasm32")]
use crate::host::interfaces::logging;

#[derive(Debug, Serialize)]
pub struct RelayPayRequest<'a> {
    pub service_url: &'a str,
    pub method: &'a str,
    pub payload: &'a serde_json::Value,
    pub idempotency_key: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RelayPayResponse {
    pub relay_ref: String,
    pub service_response: serde_json::Value,
}

// Real marketplace responses vary wildly in size depending on the service
// (a single price quote vs. a full market listing) -- cap how much we'll
// attempt to fully deserialize into a generic serde_json::Value tree, so an
// unexpectedly large body degrades to a clean error instead of risking a
// WASM-level trap (allocation failure / stack pressure) that no Result-based
// error handling in this file could ever catch. Root-caused via Terminal3's
// own server-side trace showing a guest-side trap immediately after a slow,
// real relay round-trip -- see docs/DEVELOPER_BUILD_LOG.md §3q.
const MAX_RELAY_RESPONSE_BYTES: usize = 256 * 1024;

#[cfg(target_arch = "wasm32")]
pub fn call_pay(
    relay_base_url: &str,
    relay_shared_secret: &str,
    req: &RelayPayRequest,
) -> Result<RelayPayResponse, String> {
    let url = format!("{}/pay", relay_base_url.trim_end_matches('/'));
    let body = serde_json::to_vec(req).map_err(|e| e.to_string())?;

    let _ = logging::info("relay_client: dispatching http::call to relay");
    let resp = http_iface::call(&http_iface::Request {
        method: http_iface::Verb::Post,
        url,
        headers: Some(vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("X-Relay-Secret".to_string(), relay_shared_secret.to_string()),
        ]),
        payload: Some(body),
    })
    .map_err(|e| format!("relay call failed: {e}"))?;
    let _ = logging::info(&format!(
        "relay_client: http::call returned code={} bytes={}",
        resp.code,
        resp.payload.len()
    ));

    if resp.code != 200 {
        let body = String::from_utf8_lossy(&resp.payload);
        return Err(format!("relay returned HTTP {}: {body}", resp.code));
    }

    if resp.payload.len() > MAX_RELAY_RESPONSE_BYTES {
        return Err(format!(
            "relay response too large: {} bytes (max {MAX_RELAY_RESPONSE_BYTES})",
            resp.payload.len()
        ));
    }

    serde_json::from_slice(&resp.payload).map_err(|e| format!("relay response malformed: {e}"))
}
