// ==============================================================================
// ANNOTATED FOR THIS DEMO TEMPLATE
// This file is the contract's storage layer: it reads the Policy struct and
// relay secrets out of the TEE's key-value store, and implements the append-
// only ledger that pay.rs writes an entry to on every paid/denied/failed
// attempt. `get_ledger` (called from lib.rs) folds that log into the snapshot
// the demo dashboard reads to show spend history — independent of whatever
// the agent process itself claims happened.
// ==============================================================================
//! KV-backed ledger + secrets/policy readers.
//!
//! The real `kv-store` host interface has no `append` primitive — only
//! `get` / `put` / `delete` / `scan` (confirmed by reading the vendored
//! `host-interfaces-2.1.0/package.wit`, not assumed). Append-log semantics
//! are built manually here: a `seq` counter plus zero-padded `entry:NNNNNNNNNN`
//! keys, enumerated back out with `scan`'s half-open range.

use crate::policy::Policy;
use serde::{Deserialize, Serialize};

#[cfg(target_arch = "wasm32")]
use crate::host::{
    interfaces::{kv_store, logging},
    tenant::tenant_context,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LedgerEntry {
    pub seq: u64,
    pub ts: u64,
    pub service_url: String,
    pub amount_usdc: f64,
    pub status: String, // "paid" | "denied"
    pub reason: Option<String>,
    pub remaining_budget: Option<f64>,
    pub idempotency_key: String,
    pub relay_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LedgerSnapshot {
    pub running_total: f64,
    pub session_budget: f64,
    pub per_call_cap: f64,
    pub host_allowlist: Vec<String>,
    pub entries: Vec<LedgerEntry>,
    // Count of stored "entry:*" keys that failed to parse as a LedgerEntry --
    // see read_all_entries()'s comment for why this exists and why it's
    // surfaced rather than silently dropped.
    pub malformed_entries: u32,
}

const ENTRY_SCAN_LIMIT: u32 = 500;

#[cfg(target_arch = "wasm32")]
fn tenant_map_name(tail: &str) -> String {
    let tid = tenant_context::tenant_did();
    format!("z:{}:{tail}", hex::encode(&tid))
}

#[cfg(target_arch = "wasm32")]
pub fn read_policy() -> Result<Policy, String> {
    let map = tenant_map_name("policy");
    let bytes = kv_store::get(&map, b"policy")
        .map_err(|e| format!("kv read policy: {e}"))?
        .ok_or("policy not found in z:<tid>:policy — populate it via scripts/setup.ts")?;
    serde_json::from_slice(&bytes).map_err(|e| format!("policy JSON malformed: {e}"))
}

#[cfg(target_arch = "wasm32")]
pub fn read_secret(key: &str) -> Result<String, String> {
    let map = tenant_map_name("secrets");
    let bytes = kv_store::get(&map, key.as_bytes())
        .map_err(|e| format!("kv read secret {key}: {e}"))?
        .ok_or_else(|| format!("{key} not found in z:<tid>:secrets — populate it via scripts/setup.ts"))?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
pub fn read_running_total() -> Result<f64, String> {
    let map = tenant_map_name("ledger");
    match kv_store::get(&map, b"running_total").map_err(|e| format!("kv read running_total: {e}"))? {
        Some(bytes) => String::from_utf8(bytes)
            .map_err(|e| e.to_string())?
            .parse::<f64>()
            .map_err(|e| format!("running_total not a number: {e}")),
        None => Ok(0.0),
    }
}

#[cfg(target_arch = "wasm32")]
pub fn write_running_total(new_total: f64) -> Result<(), String> {
    let map = tenant_map_name("ledger");
    kv_store::put(&map, b"running_total", new_total.to_string().as_bytes())
        .map_err(|e| format!("kv write running_total: {e}"))
}

#[cfg(target_arch = "wasm32")]
fn next_seq() -> Result<u64, String> {
    let map = tenant_map_name("ledger");
    let current = match kv_store::get(&map, b"seq").map_err(|e| format!("kv read seq: {e}"))? {
        Some(bytes) => String::from_utf8(bytes)
            .map_err(|e| e.to_string())?
            .parse::<u64>()
            .map_err(|e| format!("seq not a number: {e}"))?,
        None => 0,
    };
    let next = current + 1;
    kv_store::put(&map, b"seq", next.to_string().as_bytes())
        .map_err(|e| format!("kv write seq: {e}"))?;
    Ok(next)
}

#[cfg(target_arch = "wasm32")]
pub fn append_entry(mut entry: LedgerEntry) -> Result<LedgerEntry, String> {
    let seq = next_seq()?;
    entry.seq = seq;
    entry.ts = tenant_context::cluster_timestamp_secs();
    let map = tenant_map_name("ledger");
    let key = format!("entry:{seq:010}");
    let value = serde_json::to_vec(&entry).map_err(|e| e.to_string())?;
    kv_store::put(&map, key.as_bytes(), &value).map_err(|e| format!("kv write entry: {e}"))?;
    Ok(entry)
}

#[cfg(target_arch = "wasm32")]
pub fn is_idempotency_key_used(key: &str) -> Result<bool, String> {
    let map = tenant_map_name("ledger");
    let idk_key = format!("idem:{key}");
    Ok(kv_store::get(&map, idk_key.as_bytes())
        .map_err(|e| format!("kv read idem: {e}"))?
        .is_some())
}

#[cfg(target_arch = "wasm32")]
pub fn mark_idempotency_key_used(key: &str) -> Result<(), String> {
    let map = tenant_map_name("ledger");
    let idk_key = format!("idem:{key}");
    kv_store::put(&map, idk_key.as_bytes(), b"1").map_err(|e| format!("kv write idem: {e}"))
}

// Returns (entries, count of stored "entry:*" keys that failed to parse).
//
// Confirmed as a real bug against production: this used to `.collect()` into
// a single `Result`, so ONE malformed stored entry made every future
// `get-ledger` call fail outright -- not just for that one entry, for the
// entire ledger, permanently (nothing here ever deletes a bad entry). That's
// the opposite of what a durable audit trail is for. Skip and count instead,
// same principle as payForService.ts's catch block or relay_client.rs's
// size cap: one bad thing shouldn't take down everything else that's fine.
#[cfg(target_arch = "wasm32")]
pub fn read_all_entries() -> Result<(Vec<LedgerEntry>, u32), String> {
    let map = tenant_map_name("ledger");
    // Half-open range covering every "entry:*" key: ':' (0x3A) is followed by
    // ';' (0x3B) in ASCII, so "entry;" as the exclusive end catches exactly
    // the "entry:" prefix and nothing past it.
    let pairs = kv_store::scan(&map, b"entry:", b"entry;", ENTRY_SCAN_LIMIT)
        .map_err(|e| format!("kv scan entries: {e}"))?;
    let mut entries = Vec::with_capacity(pairs.len());
    let mut malformed = 0u32;
    for (key, value) in pairs {
        match serde_json::from_slice::<LedgerEntry>(&value) {
            Ok(entry) => entries.push(entry),
            Err(e) => {
                malformed += 1;
                let _ = logging::info(&format!(
                    "read_all_entries: skipping malformed entry at key {}: {e}",
                    String::from_utf8_lossy(&key)
                ));
            }
        }
    }
    Ok((entries, malformed))
}

#[cfg(target_arch = "wasm32")]
pub fn get_ledger(_input: &[u8]) -> Result<Vec<u8>, String> {
    let policy = read_policy()?;
    let running_total = read_running_total()?;
    let (entries, malformed_entries) = read_all_entries()?;
    let snapshot = LedgerSnapshot {
        running_total,
        session_budget: policy.session_budget_usdc,
        per_call_cap: policy.per_call_cap_usdc,
        host_allowlist: policy.host_allowlist.clone(),
        entries,
        malformed_entries,
    };
    serde_json::to_vec(&snapshot).map_err(|e| e.to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn get_ledger(_input: &[u8]) -> Result<Vec<u8>, String> {
    Err("get_ledger is only implemented on the wasm32 target".to_string())
}
