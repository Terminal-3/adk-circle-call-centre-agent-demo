// WHAT: The "wow moment" script -- instantly clears the demo agent's
// outbound-call authorization for this contract, so its next payment attempt
// fails live, with no redeploy or code change.
// WHEN: Repeatable -- run it any time during a demo/rehearsal to show
// revocation, then re-run grant.ts to restore access for the next take.
// RUN: npm run revoke --workspace scripts
//
// NOTE on the two layers of access control (a common point of confusion):
//   - THIS script (member-delegation-update, via updateMemberDelegation)
//     controls whether the AGENT IDENTITY itself is allowed to invoke given
//     functions on a given contract, and which HOSTS the contract's outbound
//     egress may reach on this agent's behalf. It's Terminal 3 platform-level
//     identity + network authorization -- this is the layer being revoked here.
//   - The `host_allowlist` inside the POLICY blob (seeded by setup.ts /
//     update-policy.ts) is a completely different, business-logic layer: it's
//     the contract's own rule about which marketplace SELLERS it's willing
//     to pay. Revoking here does NOT touch that policy blob at all.
//
// The "wow moment" script: instantly clears the demo agent's outbound-call
// authorization for this contract. `updateMemberDelegation` replaces the rows
// matching `(grantee, contract_id, function)` and preserves every other row, so
// other agents and other contracts are left alone. The next `pay-for-service`
// call the agent attempts fails with `host/http.egress_denied` -- no redeploy,
// no code change, just a revoked grant.
//
// NOTE: this rewrites the same two function rows with an empty
// `allowed_hosts` rather than removing them, so the agent can still call
// `pay-for-service` -- only its outbound call to the relay fails. That is the
// more precise story for this demo anyway ("the agent can still try; it can no
// longer move money" rather than "the agent can't even attempt the function at
// all"). Removing the rows outright is a blunter revocation and needs a
// different call: `updateMemberDelegation` only ever adds or replaces rows.
import { TenantClient, getNodeUrl, type BoundGrant } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const AGENT_KEY = requireEnv("AGENT_KEY");

async function main() {
  const { did: agentDid } = await authenticate(AGENT_KEY);
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });
  const tenantScript = tenant.canonicalName(CONTRACT_TAIL);

  // Same rows grant.ts wrote, with the egress allowance emptied. Both in one
  // call: `updateMemberDelegation` read-merge-writes the whole document, so
  // per-row calls would race against each other.
  const grants: BoundGrant[] = ["pay-for-service", "get-ledger"].map((fn) => ({
    grantee: agentDid,
    contract_id: tenantScript,
    function: fn,
    scopes: [],
    allowed_hosts: [],
  }));

  await t3n.updateMemberDelegation(grants);

  console.log(`revoked ${agentDid} -> ${tenantScript} (cleared allowed_hosts)`);
  console.log("next pay-for-service call from this agent will fail with host/http.egress_denied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
