// WHAT: Diagnostic -- calls get-ledger (as the agent) with no dependency on
// the relay or Circle at all, to isolate whether a failure is specific to
// the http-call code path or something more fundamental like component
// linking.
// WHEN: Repeatable, diagnostic -- run it when pay-for-service is failing and
// you want to know if get-ledger fails the same way.
// RUN: npm run test-get-ledger --workspace scripts
//
// Diagnostic: get-ledger never calls http::call itself, so if it fails with
// the same bare Internal error pay-for-service does, that points at
// component instantiation/linking (which happens once for the whole
// component, not per-function) rather than anything specific to the
// http-call code path. Safe, free, no relay/Circle dependency at all.
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";
import { getScriptVersion, getNodeUrl } from "@terminal3/t3n-sdk";

const AGENT_KEY = requireEnv("AGENT_KEY");
const TENANT_DID = requireEnv("T3N_TENANT_DID");

async function main() {
  const { t3n } = await authenticate(AGENT_KEY);
  const tenantId = TENANT_DID.slice("did:t3n:".length);
  const scriptName = `z:${tenantId}:${CONTRACT_TAIL}`;
  const scriptVersion = await getScriptVersion(getNodeUrl(), scriptName);

  console.log(`calling get-ledger on ${scriptName}@${scriptVersion}`);
  const result = await t3n.executeAndDecode({
    script_name: scriptName,
    script_version: scriptVersion,
    function_name: "get-ledger",
    pii_did: TENANT_DID, // see docs/DEVELOPER_BUILD_LOG.md §3o
    input: {},
  });
  console.log("result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
