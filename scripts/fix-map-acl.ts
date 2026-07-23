// WHAT: Re-points the secrets/policy/ledger maps' ACL at a given contract_id
// without re-registering the contract itself.
// WHEN: Only needed as a recovery step -- if setup.ts's contract-registration
// step succeeded but its map step failed or was skipped for the resulting
// contract_id (e.g. a version bump mid-run). Not part of the normal flow.
// RUN: npm run fix-map-acl --workspace scripts -- <contract_id>
//
// Re-points the secrets/policy/ledger KV maps' ACL at a given contract_id,
// without re-registering the contract (which would fail with "contract
// version invalid" if that version is already registered). Needed whenever
// setup.ts's registration step succeeds but its map step fails/was never
// reached for the resulting contract_id -- e.g. a version bump mid-run where
// registration printed a new contract_id before the old setup.ts's map logic
// (pre-fix) errored out. See docs/DEVELOPER_BUILD_LOG.md §3s.
//
// Usage: npm run fix-map-acl --workspace scripts -- <contract_id>
import { TenantClient, getNodeUrl } from "@terminal3/t3n-sdk";
import { authenticate, requireEnv } from "./lib.js";

const T3N_API_KEY = requireEnv("T3N_API_KEY");
const contractId = Number(process.argv[2]);

if (!Number.isInteger(contractId)) {
  console.error("Usage: npm run fix-map-acl --workspace scripts -- <contract_id>");
  process.exit(1);
}

async function main() {
  const { t3n, did: tenantDid } = await authenticate(T3N_API_KEY);
  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid });

  for (const tail of ["secrets", "policy", "ledger"] as const) {
    await tenant.maps.update(tail, {
      writers: { only: [contractId] },
      readers: { only: [contractId] },
    });
    console.log(`re-ACL'd z:${tenantDid.slice("did:t3n:".length)}:${tail} -> contract ${contractId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
