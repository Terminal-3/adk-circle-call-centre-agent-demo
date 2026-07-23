// WHAT: Diagnostic -- calls an unrelated pre-existing example contract
// ("process-payment", surfaced by the T3N dashboard's own delegate-access
// flow) as a control, to check whether agent delegation works at all
// platform-wide, independent of this project's own contract.
// WHEN: Only if you're trying to isolate whether an egress_denied error is
// specific to this project's `guarded-commerce` contract or a general
// platform-wide issue. Not part of the demo itself.
// RUN: npm run test-process-payment --workspace scripts
//
// Diagnostic only -- NOT part of the demo. `process-payment` is a pre-existing
// example contract surfaced by the T3N dashboard's "New agent" delegate-access
// flow (docs/t3n/data-owner-guide/delegate-access.mdx), unrelated to this
// project's own `guarded-commerce` contract. Testing it as a control: if this
// agent can successfully invoke it (or at least fail with something other than
// egress_denied), that isolates our own egress_denied blocker to something
// specific to `guarded-commerce`'s own grant/contract, rather than a general
// platform-wide inability to authorize a delegated agent's outbound call.
import { getScriptVersion, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv } from "./lib.js";

const AGENT_KEY = requireEnv("AGENT_KEY");
const SCRIPT_NAME = "process-payment";
const FUNCTION_NAME = "process-payment";

async function main() {
  const { t3n } = await authenticate(AGENT_KEY);
  const scriptVersion = await getScriptVersion(getNodeUrl(), SCRIPT_NAME);

  console.log(`calling ${FUNCTION_NAME} on ${SCRIPT_NAME}@${scriptVersion}`);
  const result = await t3n.executeAndDecode({
    script_name: SCRIPT_NAME,
    script_version: scriptVersion,
    function_name: FUNCTION_NAME,
    input: {},
  });
  console.log("result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
