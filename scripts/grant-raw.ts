// WHAT: Diagnostic-only variant of grant.ts -- posts the raw
// `member-delegation-update` document to `tee:authorisations/contracts`
// directly instead of going through the SDK's updateMemberDelegation()
// wrapper, so you can see exactly what the contract receives.
// WHEN: Only if you suspect grant.ts's wrapper isn't behaving as expected --
// not part of the normal setup flow. Unlike grant.ts, this OVERWRITES the
// whole delegation document rather than merging, so only run it when there's
// nothing else in that document to preserve.
// RUN: npm run grant-raw --workspace scripts
//
// Diagnostic: bypass T3nClient.updateMemberDelegation()'s convenience wrapper
// and issue the `member-delegation-update` call directly, the same way
// Terminal 3's own docs show
// (developers/adk/get-started/walkthrough/invoke-contract.mdx). With no wrapper
// in between, the JSON below is literally what the contract sees, which
// separates "the grant is wrong" from "the wrapper built it wrong".
//
// Targets `tee:authorisations/contracts` because that is where the SDK
// dispatches the delegation surface -- matching it is what makes this a
// like-for-like comparison against the wrapper. `tee:user/contracts` exports
// the same function over the same edge store, so either reaches the policy.
//
// NOTE: `member-delegation-update` is a full-document write -- the submitted
// `{ grants, discover_dids }` IS the new state, with no per-field merge. Every
// grant row and every discovery grant not listed below is dropped. Only safe to
// run when there's nothing else to preserve (confirmed true for this project:
// grant.ts has always reported "preserved rows from prior policy: []").
// updateMemberDelegation() differs precisely here: it reads the document first
// and merges, so it preserves the rest.
import { getContractVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const AGENT_KEY = requireEnv("AGENT_KEY");
const RELAY_BASE_URL = requireEnv("RELAY_BASE_URL");

const DELEGATION_CONTRACT = "tee:authorisations/contracts";

function relayHost(url: string): string {
  return new URL(url).host;
}

async function main() {
  const { did: agentDid } = await authenticate(AGENT_KEY);
  console.log(`agent DID: ${agentDid}`);

  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenantId = tenantDid.slice("did:t3n:".length);
  const tenantScript = `z:${tenantId}:${CONTRACT_TAIL}`;

  const delegationVersion = await getContractVersion(getNodeUrl(), DELEGATION_CONTRACT);
  console.log(`${DELEGATION_CONTRACT}@${delegationVersion}`);

  const result = await t3n.executeAndDecode({
    contract_id: DELEGATION_CONTRACT,
    contract_version: delegationVersion,
    function_name: "member-delegation-update",
    input: {
      // Flat snake_case grant rows, one per function. `version_req` is omitted
      // rather than sent as null -- an absent qualifier matches any registered
      // version.
      grants: ["pay-for-service", "get-ledger"].map((fn) => ({
        grantee: agentDid,
        contract_id: tenantScript,
        function: fn,
        scopes: [],
        allowed_hosts: [relayHost(RELAY_BASE_URL)],
      })),
      // Document-level discovery grants. This demo grants none; an empty list
      // persists as empty, which is what clears any that were set before.
      discover_dids: [],
    },
  });

  console.log("raw member-delegation-update result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
