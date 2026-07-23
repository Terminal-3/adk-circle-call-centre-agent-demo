// WHAT: Read-only check -- prints exactly what the tenant's agent-auth
// policy says right now, as recorded by the node.
// WHEN: Repeatable, diagnostic -- run it any time you want to confirm
// grant.ts / revoke.ts actually landed the way you expect.
// RUN: npm run test-agent-auth --workspace scripts
//
// Read-only sanity check: what does the tenant's agent-auth policy actually say
// right now, as recorded by the node? Confirms (or refutes) whether the grant
// from scripts/grant.ts landed the way we expect -- independent of reasoning
// about error message shapes.
import { authenticate, requireEnv } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");

async function main() {
  const { t3n } = await authenticate(T3N_API_KEY);
  const agents = await t3n.getAgentAuth();
  console.log(JSON.stringify(agents, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
