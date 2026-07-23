# Demo script

A runbook for showing this off live (to a teammate, on a call, at a meetup) once you have
your own instance running. Assumes you've already completed
[`GETTING_STARTED.md`](GETTING_STARTED.md).

## Setup (once, before any run)

1. `cd contract && cargo build --target wasm32-wasip2 --release && cd ..`
2. `npm run setup --workspace scripts` — registers the contract, creates KV maps, seeds
   policy + relay secrets. Note the printed `CONTRACT_ID`.
3. `npm run grant --workspace scripts` — authorizes your agent for
   `pay-for-service`/`get-ledger`, scoped to the relay's host only.
4. Confirm the relay is running with `MOCK_CIRCLE=0` and a logged-in `circle` CLI session,
   reachable at `RELAY_BASE_URL`.
5. Fund the wallet with enough USDC to comfortably cover the run (this scenario's real
   per-call prices range from a couple of cents for a research lookup up to ~$0.54 for a
   real phone call).
6. `npm run reset-budget --workspace scripts` (or the dashboard's Reset Budget button) so the
   session budget starts clean.

## Walkthrough

1. **~10-second architecture recap** (see `README.md`): agent → Terminal 3 TEE → relay →
   Circle. One sentence: "credentials sealed, agent never touches them."
2. **Kick off the agent**: `npm run start --workspace agent`, with the dashboard open at
   `http://localhost:3000` (or your deployed URL). The task (see `agent/src/loop.ts`) has the
   agent triage today's flagged support tickets — verifying details via paid research
   services, then a real phone call when warranted.
3. Dashboard shows, live: search/inspect calls in the Activity Feed (free, no money), then a
   `pay_for_service` call → Budget Meter ticks down → Audit Trail gets a green **Paid** row.
   Repeat for a second real service, then the real phone-verification call (within the
   per-call cap).
4. **Policy denial.** Have the agent attempt (or script a nudge toward) a service priced
   above `per_call_cap_usdc`. The payment is denied inside the enclave — a red/amber
   **Denied** row appears in the Audit Trail in real time, with the exact reason (e.g.
   `policy_denied: 0.89 exceeds per-call cap 0.6`), even though the agent "wanted" to spend.
5. **Live revocation.** Click **Revoke Agent Access** in the Policy Panel (or run
   `npm run revoke --workspace scripts`). Have the agent attempt one more payment
   immediately after — it fails with `host/http.egress_denied`. No redeploy, no code
   change, just a cleared grant.
6. **Close** on the full Audit Trail (a tamper-evident record — every entry, paid and
   denied).

## Between runs

`npm run reset-budget --workspace scripts` (or the dashboard's Reset Budget button) zeroes
`running_total` only — ledger entries are never cleared (that would undercut the
tamper-evident record). If the agent was revoked in a previous run, re-run
`npm run grant --workspace scripts` before the next one.

## Checklist

- [ ] Dry run at least once end-to-end before showing it live, timing both the denial and
      the revocation.
- [ ] Confirm the relay's `circle` CLI session hasn't expired.
- [ ] Confirm the wallet balance is comfortably above what the run will spend.
- [ ] Confirm the Activity Feed and Audit Trail are both visible on screen — the
      agreement/mismatch between them is the point.
