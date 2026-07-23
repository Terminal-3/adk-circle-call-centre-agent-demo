# Architecture

## Design decision: TEE-as-policy-authority, not TEE-as-signer

The obvious-sounding design is "the contract itself signs and settles the payment inside the
enclave." This demo deliberately does not do that, for two reasons:

1. **Terminal 3's host ABI has `signing` (including `sign-with-wallet`) and `outbox`
   capabilities that would enable this — but they are not yet linked into tenant (`z:`)
   contract worlds.** Both interfaces exist and are used by Terminal 3's own system
   contracts; the tenant linker world's capability surface doesn't expose them yet. Check
   the [ADK reference](https://docs.terminal3.io/developers/adk/reference) for the current
   state before assuming this is still true by the time you're reading this.
2. **Circle's own CLI (`circle services pay`) runs a multi-step x402 protocol dance** —
   discovery, a 402 challenge/response, payment authorization, settlement — that isn't
   something to reimplement inside a sandboxed WASM contract with no subprocess and only
   `http::call`. Wrapping the real, already-correct CLI in a small relay you own is a
   fraction of the engineering risk of reimplementing it.

So: **the contract is the policy authority; a relay you own is the payment executor.**

```
Agent → Terminal 3 contract (pay-for-service) → relay (POST /pay) → circle CLI → Circle/x402
```

The contract enforces every guardrail (host allowlist, per-call cap, session budget,
idempotency) and holds the relay's credentials sealed — the agent process never touches a
Circle credential, ever. The relay's only job is running `circle services pay` (or, in
`MOCK_CIRCLE=1`, returning canned data) — see `services/payment-relay/src/server.ts`.

## The contract (`contract/`)

WIT world `z:guarded-commerce@0.1.0` imports exactly `tenant-context`, `logging`,
`kv-store`, `http` — nothing else, matching Terminal 3's "capabilities come from your WIT
imports" model. Two exported functions:

- **`pay-for-service`** — reads `policy` (KV), checks host allowlist → per-call cap →
  session budget → idempotency-key dedupe, in that order, failing closed before any
  secret is read or any outbound call is made. On pass, reads the relay's URL and shared
  secret from `secrets` (KV, sealed), calls the relay, updates the running total, and
  appends a ledger entry. See `contract/src/pay.rs`.

  Note there are **two different allowlists** here, not one: `policy.host_allowlist` gates
  which **marketplace service** (e.g. `api.tavily.com`) the agent may direct a payment to —
  business logic enforced inside `pay-for-service` itself. The `agent-auth-update` grant
  (`scripts/grant.ts`) separately gates the **contract's own fixed egress** to your relay,
  at the Terminal 3 host-capability layer. Confusing the two — e.g. seeding one allowlist
  with the other's values — is a real, easy mistake; see `docs/GOTCHAS.md`.
- **`get-ledger`** — read-only. Folds the `ledger` map's `entry:NNNNNNNNNN` keys (via
  `kv-store::scan`'s half-open range — there's no `append` primitive in the host ABI, only
  `get`/`put`/`delete`/`scan`; append-log semantics are hand-rolled, see
  `contract/src/ledger.rs`) plus the running total and policy limits into one snapshot.
  This is the dashboard's source of truth, independent of whatever the agent self-reports.

KV maps, each ACL'd to the contract's own `contract_id` (see `scripts/setup.ts`):

| Map | Contents |
|---|---|
| `secrets` | `relay_base_url`, `relay_shared_secret` — sealed, contract-readable only |
| `policy` | one JSON blob: `per_call_cap_usdc`, `session_budget_usdc`, `host_allowlist` |
| `ledger` | `running_total`, `seq` counter, `entry:NNNNNNNNNN` append-log rows, `idem:<key>` dedupe markers |

**Budget scoping**: `session_budget_usdc` is a per-run budget, explicitly reset via
`scripts/reset-budget.ts`/`/api/reset` between runs — not a rolling calendar-day window.
Terminal 3's `time`/`clock` host interface isn't available to tenant contracts today, so
there's no enclave-native clock source for a true daily window yet — build that at the
application layer if you need it.

**Revocation** is not a contract function. The data owner clears the agent's
`agent-auth-update` grant (`scripts/revoke.ts` / the dashboard's Revoke button, via
`T3nClient.updateAgentAuth(agentDid, { functions: [...], allowedHosts: [] })` — note
`functions` must stay non-empty; see `docs/GOTCHAS.md`), and the next `pay-for-service`
call's outbound call to the relay fails with `host/http.egress_denied` — instant, no
redeploy.

## The relay (`services/payment-relay/`)

The only thing the contract is authorized to call. Two modes, one codebase:

- **Real** (`MOCK_CIRCLE=0`, the default): shells out to the real `circle` CLI via
  `execFile` with an argv array — never a shell string, since `service_url`/`method` are
  seller-controlled fields flowing in from the marketplace. Must run on a host where
  `circle wallet login` has already completed interactively (the CLI session is local to
  the machine, not exportable via an env var).
- **Mock** (`MOCK_CIRCLE=1`): returns canned responses seeded from
  `mock-data/services.json` (real captured marketplace listings, plus one clearly-marked
  illustrative entry priced to reliably trigger a policy denial — see that directory's
  README). Also serves `/mock/search` and `/mock/inspect` so the agent's discovery tools
  don't need a real Circle session either.

`/pay` requires an `X-Relay-Secret` header matching the value sealed in the contract's
`secrets` KV map — the contract is the only legitimate caller.

## The agent (`agent/`)

An OpenAI tool-use loop (`agent/src/loop.ts`) with four tools, deliberately asymmetric:

- `search_services` / `inspect_service` — free, no Terminal 3 involvement, real or mock
  Circle CLI depending on `MOCK_CIRCLE`.
- `pay_for_service` — the only tool that spends money, and the only one that talks to
  Terminal 3 (`agent/src/t3n-client.ts`). This file has **no mock branch** — Terminal 3
  calls are always real once `AGENT_KEY`/`T3N_TENANT_DID` are set, regardless of whether
  Circle itself is mocked. Mocking happens one hop further down, in the relay, not here —
  see `SECURITY.md` for why this boundary is deliberate.
- `get_ledger` — lets the model see its own remaining budget.

The agent process holds an OpenAI key and its own Terminal 3 agent key — nothing else. No
Circle credential, no filesystem/shell tool beyond the CLI shell-outs `search`/`inspect`
explicitly need, no ability to install anything at runtime.

## The dashboard (`dashboard/`)

Next.js App Router. `lib/t3n.ts` is server-side only (API routes call it; it's never
imported by a client component) and holds the tenant's own `T3N_API_KEY` to read
`get-ledger` and run revoke/reset. Four components: `BudgetMeter` (current spend against
the session budget), `PolicyPanel` (current limits + the live Revoke button),
`ActivityFeed` (the agent's self-reported narration), `AuditTrail` (the enclave's ledger —
paid/denied/failed).

**Trust design point**: the dashboard polls `get-ledger` directly as ground truth,
independent of the agent's own event stream. A mismatch between what the agent claims and
what the enclave recorded is the whole thesis of this demo made visible — the two panels
are deliberately shown side by side, not merged into one feed.

**`MOCK_T3N=1`** is a dashboard-local-dev convenience (an in-memory ledger) distinct from
`MOCK_CIRCLE`. It's lower-risk than an equivalent bypass would be in the agent's payment
path, since dashboard reads never move money — but it's still dev-only. A deployed
production dashboard should always have a real `T3N_API_KEY` set.

## If you're customizing this

See [`docs/CUSTOMIZE.md`](docs/CUSTOMIZE.md) for exactly which files are scenario-specific
(safe to change freely) versus core guardrail infrastructure (change only if you understand
the security implications).
