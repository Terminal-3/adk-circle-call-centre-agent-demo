// WHAT: Diagnostic -- reads back whatever the contract logged via
// logging::info/debug/error before it failed.
// WHEN: Repeatable, diagnostic -- run it whenever you need to see what the
// contract logged during a failed call. Requires log_max_entries > 0 for
// your tenant (off by default).
// RUN: npm run test-contract-logs --workspace scripts
//
// Diagnostic: read back whatever the contract logged via logging::info/debug/error
// before failing. Requires the tenant's log_max_entries quota to be non-zero
// (off by default per the SDK's own docs) -- may return empty even if logging
// is disabled entirely, which is itself useful information.
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv, CONTRACT_TAIL } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");

async function main() {
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

  const logs = await tenant.contracts.logs(CONTRACT_TAIL, { limit: 50 });
  console.log(JSON.stringify(logs, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
