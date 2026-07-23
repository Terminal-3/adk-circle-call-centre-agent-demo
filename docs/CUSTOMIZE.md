# Build your own scenario

This repo ships with one worked example — a support/trust-and-safety agent triaging flagged
tickets — so the guardrail pattern (allowlist + per-call cap + session budget + revocation)
has something concrete to demonstrate. Most of that scenario is meant to be replaced.

Every file listed under "Scenario-specific" below also has a `// CUSTOMIZE:` comment at the
exact spot to change. Find them all with:

```bash
grep -rn "CUSTOMIZE:" --include="*.ts" --include="*.rs" --include="*.md" .
```

## Scenario-specific — swap these for your own use case

| File | What it is | What to do |
|---|---|---|
| `agent/src/loop.ts` | The agent's `TASK` / system prompt | Replace with your own agent's goal and persona |
| `agent/src/tools/listFlaggedTickets.ts` | Hardcoded demo "tickets" | Replace with a real data source (a CRM, ticketing API, database query, queue, etc.) — or delete this tool entirely if your scenario doesn't need a discovery step like this |
| `services/payment-relay/mock-data/services.json` | Fake marketplace listings for local dev | Replace with services relevant to your scenario (keep the same shape so `MOCK_CIRCLE=1` still works) |
| `scripts/setup.ts`, `scripts/update-policy.ts` | Default `HOST_ALLOWLIST`, `PER_CALL_CAP_USDC`, `SESSION_BUDGET_USDC` | Set these to match your own sellers and your own real risk tolerance — do not ship the demo defaults to anything real |
| `dashboard/lib/replay-data.ts` | Static scripted data for the credential-free public replay deploy | Replace with a narrative matching your own agent's actual flow |

## Core infrastructure — leave alone unless you know why

| File | Why it's core |
|---|---|
| `contract/src/*.rs` | Policy enforcement, ledger, and relay-calling logic — this is the actual security boundary |
| `services/payment-relay/src/circle-cli.ts` | Wraps the real Circle CLI safely (argv-array `execFile`, chain resolution) |
| The KV map / ACL provisioning pattern in `scripts/setup.ts` | Sets up the sealed-secret and policy storage the contract depends on |

You *can* change these — this is your fork — but each one has a specific reason it's built
the way it is (see [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`SECURITY.md`](../SECURITY.md)).
If you're changing enforcement logic, make sure you understand what you're relaxing and why.

## A few things to decide early

- **What triggers a payment?** The demo triggers on flagged tickets needing verification.
  Yours might trigger on a different signal entirely — pick whatever's natural for your
  agent's job, and update `agent/src/loop.ts` and the tool list to match.
- **What's your actual risk tolerance?** `PER_CALL_CAP_USDC` and `SESSION_BUDGET_USDC` in
  `scripts/setup.ts` are not just demo knobs — they're the real ceiling on how much an
  autonomous process can spend before a human notices. Set them deliberately, not by
  copying the demo's numbers.
- **Do you need the dashboard at all?** It's genuinely useful for building trust in what an
  agent did versus what it claims, but if you're building a backend-only integration you can
  drop `dashboard/` and just read `get-ledger` directly wherever you need an audit trail.

## Before you publish your own fork

- Confirm no `.env` file, real API key, or real private key ever got committed —
  `.gitignore` already excludes `.env`/`.env.local`, but check `git log -p` once before
  making a fork public.
- Confirm you're comfortable with any real wallet addresses or DIDs your own testing
  produces appearing in your repo's history — these aren't secrets (they're meant to be
  public), but it's your call whether you want them visible.
- See [`docs/GOTCHAS.md`](GOTCHAS.md) for the real bugs hit building the original version of
  this demo — worth reading once before you build your own integration on the same stack.
