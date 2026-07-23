// WHAT: Diagnostic-only variant of grant.ts -- calls the low-level
// `tee:user/contracts` agent-auth-update function directly instead of going
// through the SDK's updateAgentAuth() wrapper, to rule out a wrapper bug.
// WHEN: Only if you suspect grant.ts's wrapper isn't behaving as expected --
// not part of the normal setup flow. Unlike grant.ts, this OVERWRITES the
// entire agents array rather than merging, so only run it when there's
// nothing else in that array to preserve.
// RUN: npm run grant-raw --workspace scripts
//
// Diagnostic: bypass T3nClient.updateAgentAuth()'s convenience wrapper and
// issue the raw `tee:user/contracts` / `agent-auth-update` call directly, the
// same way Terminal 3's own docs show
// (developers/adk/get-started/walkthrough/invoke-contract.mdx) and the same
// way another developer reported working around a similar host/http.egress_denied
// bug. Tests whether the wrapper has a bug that getAgentAuth()'s read-back
// doesn't surface -- the SDK's own .d.ts says updateAgentAuth() does a
// "read-merge-write" internally, so this SHOULD be equivalent for our
// single-entry case, but a raw call rules out a wrapper-specific bug.
//
// NOTE: unlike updateAgentAuth(), this does NOT read-merge-write -- it
// overwrites the full `agents` array with exactly the one entry below. Only
// safe to run when there's nothing else to preserve (confirmed true for this
// project: grant.ts has always reported "preserved rows from prior policy: []").
import { getScriptVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const AGENT_KEY = requireEnv("AGENT_KEY");
const RELAY_BASE_URL = requireEnv("RELAY_BASE_URL");

function relayHost(url: string): string {
  return new URL(url).host;
}

async function main() {
  const { did: agentDid } = await authenticate(AGENT_KEY);
  console.log(`agent DID: ${agentDid}`);

  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenantId = tenantDid.slice("did:t3n:".length);
  const tenantScript = `z:${tenantId}:${CONTRACT_TAIL}`;

  const userContractVersion = await getScriptVersion(getNodeUrl(), "tee:user/contracts");
  console.log(`tee:user/contracts@${userContractVersion}`);

  const result = await t3n.executeAndDecode({
    script_name: "tee:user/contracts",
    script_version: userContractVersion,
    function_name: "agent-auth-update",
    input: {
      agents: [
        {
          agentDid,
          scripts: [
            {
              scriptName: tenantScript,
              versionReq: null,
              functions: ["pay-for-service", "get-ledger"],
              allowedHosts: [relayHost(RELAY_BASE_URL)],
            },
          ],
        },
      ],
    },
  });

  console.log("raw agent-auth-update result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
