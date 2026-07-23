// WHAT: Updates a single key in the tenant's `secrets` KV map (e.g. rotating
// the relay's shared secret) without re-registering the contract.
// WHEN: Repeatable -- run it any time you need to rotate a credential for an
// already-provisioned tenant.
// RUN: npm run update-secret --workspace scripts -- <key> <value>
//
// Update a single key in the tenant's `secrets` KV map without re-running the
// full setup.ts (which would try to re-register the contract at the same
// version and fail). Useful for credential rotation.
//
// Usage: npm run update-secret --workspace scripts -- <key> <value>
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const [key, value] = process.argv.slice(2);

if (!key || !value) {
  console.error("Usage: npm run update-secret --workspace scripts -- <key> <value>");
  process.exit(1);
}

async function main() {
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("secrets"),
    key,
    value,
  });

  console.log(`updated ${key} in z:${tenantDid.slice("did:t3n:".length)}:secrets`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
