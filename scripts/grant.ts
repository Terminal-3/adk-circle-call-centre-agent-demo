// WHAT: Authorizes the demo agent to call this contract's pay-for-service
// and get-ledger functions, and to reach the relay's host over egress.
// WHEN: Run once after setup.ts, and again any time you need to re-grant
// (e.g. after revoke.ts, or after rotating RELAY_BASE_URL).
// RUN: npm run grant --workspace scripts
//
// NOTE on the two layers of access control (a common point of confusion):
//   - THIS script (member-delegation-update, via updateMemberDelegation)
//     controls whether the AGENT IDENTITY itself is allowed to invoke given
//     functions on a given contract, and which HOSTS the contract's outbound
//     egress may reach on this agent's behalf. It's Terminal 3 platform-level
//     identity + network authorization.
//   - The `host_allowlist` inside the POLICY blob (seeded by setup.ts /
//     update-policy.ts) is a completely different, business-logic layer: it's
//     the contract's own rule about which marketplace SELLERS it's willing
//     to pay, checked in addition to (not instead of) this grant.
//   Both must allow a call for a payment to go through.
//
// Grant the demo agent a scoped, revocable delegation: it may call
// `pay-for-service` and `get-ledger` on our contract, and the CONTRACT's
// outbound egress (to the relay only) is authorized for this agent.
//
// Must be run as the TENANT/data-owner (T3N_API_KEY) -- `updateMemberDelegation`
// requires the caller be "the delegating user, authenticated as themselves"
// (see node_modules/@terminal3/t3n-sdk's own .d.ts docstring).
import { TenantClient, getNodeUrl, type BoundGrant } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const AGENT_KEY = requireEnv("AGENT_KEY");
const RELAY_BASE_URL = requireEnv("RELAY_BASE_URL");

function relayHost(url: string): string {
  return new URL(url).host;
}

async function main() {
  // 1. Authenticate as the agent once, purely to resolve its DID (opaque,
  //    minted on first sign-in -- never derivable from the key alone).
  const { did: agentDid } = await authenticate(AGENT_KEY);
  console.log(`agent DID: ${agentDid}`);

  // 2. Authenticate as the tenant/data-owner and grant that DID access.
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });
  const tenantScript = tenant.canonicalName(CONTRACT_TAIL);

  // One grant row per function: a row authorizes exactly one function, so the
  // egress allowance is repeated on each. Omitting `version_req` matches any
  // registered version of the contract.
  const grants: BoundGrant[] = ["pay-for-service", "get-ledger"].map((fn) => ({
    grantee: agentDid,
    contract_id: tenantScript,
    function: fn,
    scopes: [],
    allowed_hosts: [relayHost(RELAY_BASE_URL)],
  }));

  // Both rows go in ONE call. `updateMemberDelegation` is a read-merge-write of
  // the whole delegation document, so calling it once per row races against
  // itself: the second call's read can start before the first call's write
  // lands, and its merge then drops that row.
  const result = await t3n.updateMemberDelegation(grants);

  console.log(`granted ${agentDid} -> ${tenantScript} (pay-for-service, get-ledger)`);
  console.log(`allowed host: ${relayHost(RELAY_BASE_URL)}`);
  console.log("preserved rows from prior policy:", result.preservedRows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
