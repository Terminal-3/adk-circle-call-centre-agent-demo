// WHAT: The "wow moment" script -- instantly clears the demo agent's
// outbound-call authorization for this contract, so its next payment attempt
// fails live, with no redeploy or code change.
// WHEN: Repeatable -- run it any time during a demo/rehearsal to show
// revocation, then re-run grant.ts to restore access for the next take.
// RUN: npm run revoke --workspace scripts
//
// NOTE on the two layers of access control (a common point of confusion):
//   - THIS script (agent-auth-update, via updateAgentAuth) controls whether
//     the AGENT IDENTITY itself is allowed to invoke given functions on a
//     given contract, and which HOSTS the contract's outbound egress may
//     reach on this agent's behalf. It's Terminal 3 platform-level identity
//     + network authorization -- this is the layer being revoked here.
//   - The `host_allowlist` inside the POLICY blob (seeded by setup.ts /
//     update-policy.ts) is a completely different, business-logic layer: it's
//     the contract's own rule about which marketplace SELLERS it's willing
//     to pay. Revoking here does NOT touch that policy blob at all.
//
// The "wow moment" script: instantly clears the demo agent's outbound-call
// authorization for this contract. `updateAgentAuth` replaces the entry
// matching this scriptName (per the SDK's own merge semantics), leaving
// other agents/scripts alone. The next `pay-for-service` call the agent
// attempts fails with `host/http.egress_denied` -- no redeploy, no code
// change, just a revoked grant.
//
// NOTE: `functions: []` (revoking the ability to even invoke the contract at
// all) is REJECTED by the node with a real validation error --
// "functions must not be empty (use [\"*\"] for all functions)" -- confirmed
// against live infrastructure. So this clears `allowedHosts` only, keeping
// `functions` valid: the agent can still call `pay-for-service`, but its
// outbound call to the relay fails, which is actually the more precise story
// for this demo anyway ("the agent can still try; it can no longer move
// money" rather than "the agent can't even attempt the function at all").
// See docs/DEVELOPER_BUILD_LOG.md §3t.
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const AGENT_KEY = requireEnv("AGENT_KEY");

async function main() {
  const { did: agentDid } = await authenticate(AGENT_KEY);
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });
  const tenantScript = tenant.canonicalName(CONTRACT_TAIL);

  await t3n.updateAgentAuth(agentDid, {
    scriptName: tenantScript,
    versionReq: null,
    functions: ["pay-for-service", "get-ledger"],
    allowedHosts: [],
  });

  console.log(`revoked ${agentDid} -> ${tenantScript} (cleared allowedHosts)`);
  console.log("next pay-for-service call from this agent will fail with host/http.egress_denied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
