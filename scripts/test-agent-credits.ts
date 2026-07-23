// WHAT: Diagnostic -- tries the one documented self-serve way for an agent
// identity to get testnet credits, since tokens aren't transferable and the
// tenant can't just send the agent some.
// WHEN: Only if the agent identity is hitting InsufficientCreditError on
// pay-for-service and you need testnet credits. Not part of normal setup;
// outcome is genuinely unverified for a non-tenant agent identity.
// RUN: npm run test-agent-credits --workspace scripts
//
// Diagnostic: the agent DID has zero T3N credits (InsufficientCreditError on
// pay-for-service) and tokens are non-transferable today, so the tenant can't
// just send it some. This tries the one documented self-serve mechanism --
// T3nClient.submitUserInput({ becomeDevTenant: true }), which the SDK's own
// types say mints "operator-configured welcome credits" on testnet self-admit.
// Not guaranteed to apply to a non-tenant agent identity -- this is genuinely
// unverified territory, see docs/DEVELOPER_BUILD_LOG.md.
import { authenticate, requireEnv } from "./lib.js";

const AGENT_KEY = requireEnv("AGENT_KEY");

async function main() {
  const { t3n, did } = await authenticate(AGENT_KEY);
  console.log(`authenticated as agent ${did}`);

  const result = await t3n.submitUserInput({
    profile: {},
    becomeDevTenant: true,
  });

  console.log("result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
