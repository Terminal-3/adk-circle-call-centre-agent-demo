// WHAT: Resets the session's running spend total back to 0, without
// touching the ledger's audit-trail history.
// WHEN: Repeatable -- run it between demo takes/rehearsals so the session
// budget "wow moment" (budget exhaustion -> policy_denied) reproduces
// reliably each time.
// RUN: npm run reset-budget --workspace scripts
//
// Resets the session budget between demo takes so the "wow moment" (budget
// exhaustion -> policy_denied) reproduces reliably on every rehearsal.
//
// Deliberately does NOT clear ledger entries: the audit trail is meant to be
// a permanent, tamper-evident record. Wiping history between takes would
// undercut the exact thing this demo is proving. Only `running_total` resets.
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");

async function main() {
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("ledger"),
    key: "running_total",
    value: "0",
  });

  console.log(`reset running_total to 0 for z:${tenantDid.slice("did:t3n:".length)}:${CONTRACT_TAIL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
