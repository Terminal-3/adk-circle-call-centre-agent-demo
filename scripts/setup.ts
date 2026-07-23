// WHAT: One-time tenant provisioning for this demo -- registers your compiled
// contract with Terminal 3, creates its private secrets/policy/ledger maps,
// and seeds the spend policy + relay credentials into them.
// WHEN: Run once when you first set up your own Terminal 3 tenant. Re-run
// only if you bump CONTRACT_VERSION (a fresh contract_id is minted and the
// maps get re-pointed at it automatically).
// RUN: npm run setup --workspace scripts
//
// One-time (or re-run-per-version) tenant provisioning:
//   1. authenticate as the tenant/data-owner (T3N_API_KEY)
//   2. register the built contract WASM -> get a numeric contract_id
//   3. create the secrets / policy / ledger KV maps, ACL'd to that contract_id
//   4. seed policy + relay secrets via the map-entry-set control call
//      (bypasses the maps' writer ACL by design -- see docs/DEVELOPER_BUILD_LOG.md)
//
// Real API surface confirmed against node_modules/@terminal3/t3n-sdk's own
// .d.ts (not just the docs) -- see docs/DEVELOPER_BUILD_LOG.md for how the
// "three different SDKs" confusion resolved: `tenant.tenant.*`, `tenant.maps.*`,
// and `tenant.contracts.*` are all namespaces on the ONE TenantClient class.
import { readFile } from "node:fs/promises";
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const EXPECTED_TENANT_DID = process.env.T3N_TENANT_DID; // optional sanity check, never trusted blindly
const CONTRACT_VERSION = process.env.CONTRACT_VERSION ?? "0.1.3";
const WASM_PATH =
  process.env.WASM_PATH ?? "../contract/target/wasm32-wasip2/release/guarded_commerce.wasm";

const RELAY_BASE_URL = requireEnv("RELAY_BASE_URL"); // e.g. https://72-60-43-195.sslip.io
const RELAY_SHARED_SECRET = requireEnv("RELAY_SHARED_SECRET");
// CUSTOMIZE: PER_CALL_CAP_USDC -- the maximum USDC the agent may spend on any
// SINGLE payment. Anything priced above this is denied by the enclave before
// any money moves. The 0.6 default is a toy/demo value chosen to make this
// demo's "wow moment" (a real service priced just over the cap) trigger
// reliably. Review and set this to whatever ceiling makes sense for a single
// call in YOUR use case before running this anywhere but a toy/demo context.
const PER_CALL_CAP_USDC = Number(process.env.PER_CALL_CAP_USDC ?? "0.6");
// CUSTOMIZE: SESSION_BUDGET_USDC -- the maximum TOTAL USDC the agent may
// spend across an entire session/demo run, regardless of how many
// individual calls stay under the per-call cap. Once this is exhausted,
// every further payment is denied until reset-budget.ts resets it. The 1.0
// default is a toy/demo value -- set a real ceiling for your use case.
const SESSION_BUDGET_USDC = Number(process.env.SESSION_BUDGET_USDC ?? "1.0");

// The hosts of the marketplace SERVICES the agent is allowed to pay -- e.g.
// "api.tavily.com", extracted from a service's own `resource` URL (see
// services/payment-relay/mock-data/services.json). This is NOT the relay's
// own host: the relay's host is a separate dimension, gated by Terminal 3's
// own agent-auth-update grant (scripts/grant.ts), not by this policy field.
// Defaults to the real research/comms providers this demo's task points the
// agent at (Tavily, Parallel.ai, StablePhone -- all independently confirmed
// to support x402 payments). StablePhone's priority-call tier ($0.89/call)
// is itself genuinely over the $0.6 per-call cap, so it doubles as a REAL
// Wow Moment 1 trigger once allowlisted -- no synthetic host needed. The
// x402 marketplace's live inventory drifts over time -- if you hit a fresh
// "not on the allowlist" denial for a host you recognize as a real
// marketplace seller, add it here (or via HOST_ALLOWLIST) rather than
// assuming it's a repeat of the original seeding bug. `api.aisa.one` is one
// such real host, found this way: the live marketplace serves what it calls
// "Tavily search" through this aggregator host, not api.tavily.com directly
// -- the same real host that was in the original crypto scenario's
// allowlist, evidently a general marketplace proxy rather than something
// scenario-specific. `parallelmpp.dev` is the same kind of finding: the
// live marketplace's real "Parallel" deep-research listing resolves there,
// not api.parallel.ai.
// CUSTOMIZE: HOST_ALLOWLIST -- the business-logic allowlist of which
// marketplace SELLERS (hostnames) the agent is permitted to pay at all, on
// top of passing the per-call cap and session budget checks above. This is
// the demo's own default seller list -- before running this for your own
// use case, replace it with the actual hostnames of the services you want
// your agent to be able to pay.
const HOST_ALLOWLIST = (
  process.env.HOST_ALLOWLIST ??
  "api.tavily.com,api.parallel.ai,stablephone.dev,api.aisa.one,parallelmpp.dev"
)
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

async function main() {
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);

  // Golden rule (per Terminal 3's own docs): never hardcode/derive the tenant
  // DID -- always read it back from the authenticated session. We only use
  // T3N_TENANT_DID as an out-of-band sanity check, never as the source of truth.
  if (EXPECTED_TENANT_DID && EXPECTED_TENANT_DID !== tenantDid) {
    console.warn(
      `WARNING: authenticated tenantDid ${tenantDid} does not match T3N_TENANT_DID ${EXPECTED_TENANT_DID}. ` +
        `Using the authenticated value -- update T3N_TENANT_DID if this is expected.`
    );
  }
  console.log(`authenticated as tenant ${tenantDid}`);

  const tenant = new TenantClient({
    t3n,
    baseUrl: getNodeUrl(),
    tenantDid,
  });

  // 1. Register the contract -> get the numeric contract_id maps ACL against.
  const wasmBytes = await readFile(WASM_PATH);
  const { name: scriptName, contract_id: contractId } = await tenant.contracts.register({
    tail: CONTRACT_TAIL,
    version: CONTRACT_VERSION,
    wasm: wasmBytes,
  });
  console.log(`registered ${scriptName} as contract id ${contractId}`);

  // 2. Create (or, on a version bump, re-ACL) the three KV maps to this
  //    contract only. `readers` is set explicitly -- the kv-governor
  //    defaults to deny, so omitting it silently makes the contract's own
  //    reads fail.
  //
  //    Registering a NEW VERSION of the same tail mints a NEW numeric
  //    contract_id (confirmed empirically -- re-running setup.ts after a
  //    version bump got a different id than the original registration).
  //    The maps from the previous version still exist, ACL'd to the OLD id,
  //    so `create()` correctly refuses with "map already exists" -- that's
  //    not a bug, it's the expected shape every time CONTRACT_VERSION bumps.
  //    Fall back to `update()` to re-point the ACL at the new contract_id.
  for (const tail of ["secrets", "policy", "ledger"] as const) {
    try {
      await tenant.maps.create({
        tail,
        visibility: "private",
        writers: { only: [contractId] },
        readers: { only: [contractId] },
      });
      console.log(`created map z:${tenantDid.slice("did:t3n:".length)}:${tail}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("already exists")) throw err;
      await tenant.maps.update(tail, {
        writers: { only: [contractId] },
        readers: { only: [contractId] },
      });
      console.log(`re-ACL'd existing map z:${tenantDid.slice("did:t3n:".length)}:${tail} -> contract ${contractId}`);
    }
  }

  // 3. Seed policy + relay secrets via the map-entry-set control call, which
  //    bypasses the maps' writer ACL by design (see docs/adk/tips/seed-api-key.mdx) --
  //    this is how an admin script writes to a map only the contract can write to.
  const policy = {
    per_call_cap_usdc: PER_CALL_CAP_USDC,
    session_budget_usdc: SESSION_BUDGET_USDC,
    host_allowlist: HOST_ALLOWLIST,
  };
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("policy"),
    key: "policy",
    value: JSON.stringify(policy),
  });
  console.log("seeded policy:", policy);

  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key: "relay_base_url",
    value: RELAY_BASE_URL,
  });
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key: "relay_shared_secret",
    value: RELAY_SHARED_SECRET,
  });
  console.log("sealed relay credentials in z:<tid>:secrets -- not visible outside the TEE");

  console.log("\nSetup complete. Next: npm run grant -- (see grant.ts) to authorize the demo agent.");
  console.log(`TENANT_DID=${tenantDid}`);
  console.log(`CONTRACT_TAIL=${CONTRACT_TAIL}`);
  console.log(`CONTRACT_ID=${contractId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
