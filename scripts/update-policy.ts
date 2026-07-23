// WHAT: Updates the tenant's spend-policy KV entry (per-call cap, session
// budget, seller host allowlist) in place, without re-registering the
// contract.
// WHEN: Repeatable -- run it whenever you want to change the policy knobs
// below for an already-provisioned tenant, instead of re-running setup.ts.
// RUN: npm run update-policy --workspace scripts
//
// Update the tenant's `policy` KV entry without re-running the full setup.ts
// (which would try to re-register the contract at the same version and fail
// with "contract version invalid"). Mirrors update-secret.ts's pattern.
//
// Fixes a real bug found while testing against production: setup.ts used to
// seed `host_allowlist` with the RELAY's own host, but pay-for-service checks
// it against the THIRD-PARTY SERVICE's host (extract_host(req.service_url)) --
// meaning every real payment was guaranteed to be denied. Re-run this after
// pulling the fix to correct an already-provisioned tenant's policy in place.
//
// Usage: npm run update-policy --workspace scripts
//   (reads PER_CALL_CAP_USDC / SESSION_BUDGET_USDC / HOST_ALLOWLIST from env,
//   same defaults as setup.ts, so the two never drift apart)
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
// CUSTOMIZE: PER_CALL_CAP_USDC -- the maximum USDC the agent may spend on any
// SINGLE payment. Anything priced above this is denied by the enclave before
// any money moves. The 0.6 default is a toy/demo value -- review and set this
// to whatever ceiling makes sense for a single call in YOUR use case before
// running this anywhere but a toy/demo context. Keep in sync with setup.ts.
const PER_CALL_CAP_USDC = Number(process.env.PER_CALL_CAP_USDC ?? "0.6");
// CUSTOMIZE: SESSION_BUDGET_USDC -- the maximum TOTAL USDC the agent may
// spend across an entire session/demo run, regardless of how many
// individual calls stay under the per-call cap. The 1.0 default is a
// toy/demo value -- set a real ceiling for your use case. Keep in sync with
// setup.ts.
const SESSION_BUDGET_USDC = Number(process.env.SESSION_BUDGET_USDC ?? "1.0");
// CUSTOMIZE: HOST_ALLOWLIST -- the business-logic allowlist of which
// marketplace SELLERS (hostnames) the agent is permitted to pay at all, on
// top of passing the per-call cap and session budget checks above. This is
// the demo's own default seller list -- before running this for your own
// use case, replace it with the actual hostnames of the services you want
// your agent to be able to pay. Keep in sync with setup.ts.
const HOST_ALLOWLIST = (
  process.env.HOST_ALLOWLIST ??
  "api.tavily.com,api.parallel.ai,stablephone.dev,api.aisa.one,parallelmpp.dev"
)
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

async function main() {
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

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

  console.log(`updated policy in z:${tenantDid.slice("did:t3n:".length)}:policy`);
  console.log(policy);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
