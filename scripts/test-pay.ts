// WHAT: Diagnostic -- calls pay-for-service directly as the agent, bypassing
// the LLM loop entirely, to isolate "does the real Terminal 3 contract ->
// relay call work" from "does the agent loop work."
// WHEN: Repeatable, diagnostic -- not part of the demo itself. Run it any
// time you want to re-verify the payment path in isolation.
// RUN: npm run test-pay --workspace scripts [-- <service_url> <method> <amount_usdc> <payload_json>]
//
// One-off diagnostic: calls pay-for-service directly (as the agent), bypassing
// the LLM loop entirely, to isolate "does the real Terminal 3 contract -> relay
// call work" from "does the agent loop work." Not part of the demo itself --
// a debugging tool, kept here for any future re-verification.
import { getScriptVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const AGENT_KEY = requireEnv("AGENT_KEY");
const TENANT_DID = requireEnv("T3N_TENANT_DID");

// Default matches the current scenario's HOST_ALLOWLIST -- the old
// nano.blockrun.ai default (crypto scenario) is no longer allowlisted since
// the pivot, so running this with no args used to always produce a
// confusing "not on allowlist" denial instead of actually testing anything.
const SERVICE_URL = process.argv[2] ?? "https://api.aisa.one/apis/v2/tavily/search";
const METHOD = process.argv[3] ?? "POST";
const AMOUNT_USDC = Number(process.argv[4] ?? "0.0096");
// Some endpoints require a body/query param to reach the 402 challenge at
// all (see docs/DEVELOPER_BUILD_LOG.md §3f) -- pass a 5th arg as a JSON
// object, e.g. for the default Tavily-via-AIsa search: '{"query":"test"}'
// (its schema requires `query`); for a GET endpoint like the old
// nano.blockrun.ai default: '{"pair":"BTC/USDT"}'.
const PAYLOAD = process.argv[5] ? JSON.parse(process.argv[5]) : { query: "test" };

async function main() {
  const { t3n } = await authenticate(AGENT_KEY);
  const tenantId = TENANT_DID.slice("did:t3n:".length);
  const scriptName = `z:${tenantId}:${CONTRACT_TAIL}`;
  const scriptVersion = await getScriptVersion(getNodeUrl(), scriptName);

  console.log(`calling pay-for-service on ${scriptName}@${scriptVersion}`);
  console.log(`service_url=${SERVICE_URL} method=${METHOD} amount_usdc=${AMOUNT_USDC} payload=${JSON.stringify(PAYLOAD)}`);

  const result = await t3n.executeAndDecode({
    script_name: scriptName,
    script_version: scriptVersion,
    function_name: "pay-for-service",
    // Delegated call -- without this, pii_did defaults to the agent's own
    // DID, so the node checks AGENT_AUTH_MAP[agent_did] (empty) instead of
    // AGENT_AUTH_MAP[tenant_did] (where the grant actually lives), which
    // surfaces as host/http.egress_denied with allowed=None. Root-caused
    // with Terminal 3's backend team -- see docs/DEVELOPER_BUILD_LOG.md §3o.
    pii_did: TENANT_DID,
    input: {
      service_url: SERVICE_URL,
      method: METHOD,
      amount_usdc: AMOUNT_USDC,
      payload: PAYLOAD,
      idempotency_key: `test-pay-${Date.now()}`,
    },
  });

  console.log("result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
