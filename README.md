# ADK × Circle Call-Centre Agent Demo

**A starter template for building AI agents that spend real money safely, using
[Terminal 3's Agent Developer Kit (ADK)](https://docs.terminal3.io/developers/adk/overview/what-is-adk)
and [Circle's](https://www.circle.com/) x402 USDC payment marketplace.**

This repo is both:
1. **A working reference implementation** you can clone, run, and learn from.
2. **A template** — swap out the call-centre scenario for your own agent idea, and keep the
   guardrail infrastructure underneath it.

> New to Terminal 3 or agent auth in general? Start with
> [`docs/CUSTOMIZE.md`](docs/CUSTOMIZE.md) once you've got the demo running — it's a map of
> exactly what to change to make this *your* agent, not this one.

## What this demo actually does

Picture a customer-support "trust & safety" agent whose job is to triage flagged support
tickets. Some tickets need it to spend real money to get more information — running a paid
web-research lookup, or placing a real phone-verification call — before it can act. That's a
genuinely risky thing to let an autonomous agent do unsupervised: if it holds a funded wallet
with no spending limits, nothing stops it from paying too much, paying the wrong service, or
just being wrong in a way nobody notices until the money's gone.

This demo shows the guardrail pattern for doing this safely:

- The agent (a plain TypeScript/Node.js **OpenAI tool-use loop** — nothing exotic, just
  function-calling) can *look up* and *inspect* paid services on Circle's marketplace for
  free, no restrictions.
- To actually **pay**, it has to go through a **Terminal 3 TEE (confidential-compute)
  contract** — small Rust code that runs inside a hardware-sealed enclave. That contract is
  the only thing that holds the real payment credentials, and it will not spend a cent
  without first checking, in this order:
  1. Is this seller on the **allowlist**?
  2. Is this single payment under the **per-call spend cap**?
  3. Is there enough left in the **session budget**?
  4. Has this exact payment already been made (idempotency check)?
- Every attempt — paid or denied — is written to a tamper-evident ledger the agent cannot
  edit, so there's always an honest record of what actually happened, independent of
  whatever the agent itself claims happened.
- An operator (you) can hit **Revoke** at any time and the agent's ability to pay is cut off
  instantly — no redeploy, no code change.

The result: an agent that can act autonomously and still can't overspend, pay the wrong
party, or hide what it did.

## Architecture at a glance

```
Your agent (OpenAI tool-use loop, agent/)
  │  search_services / inspect_service    ← free, no money moves, no Terminal 3 involved
  ▼
Circle's x402 marketplace (real paid APIs)
  │
  │  pay_for_service tool call
  ▼
Terminal 3 ADK — T3nClient.executeAndDecode({ function_name: "pay-for-service", ... })
  ▼
┌──────────────── Terminal 3 TEE enclave (contract/) ────────────────┐
│ 1. read policy (allowlist / per-call cap / session budget) from KV  │
│ 2. check allowlist → per-call cap → session budget → idempotency — │
│    any failure denies WITHOUT touching secrets or calling out      │
│ 3. read the sealed payment-relay credentials from KV               │
│ 4. call the payment relay (the ONLY outbound call this contract    │
│    makes — this is exactly what a Revoke cuts off)                 │
│ 5. append an entry to the tamper-evident ledger (paid/denied)      │
└──────────────────────────────────────────────────────────────────────┘
  ▼
services/payment-relay (wraps the real Circle CLI, or mock data for local dev)
  ▼
Circle's x402 marketplace → the real paid API gets called
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design rationale (including *why* a
relay exists instead of the contract paying directly).

## Repo layout

| Path | What it is | Should you touch it? |
|---|---|---|
| `agent/` | The autonomous OpenAI tool-use loop | **Yes** — this is your agent's brain and task |
| `agent/src/tools/listFlaggedTickets.ts` | Hardcoded demo "tickets" | **Yes** — replace with your real data source |
| `scripts/setup.ts`, `scripts/update-policy.ts` | Where the allowlist/cap/budget are set | **Yes** — these are your policy knobs |
| `services/payment-relay/mock-data/services.json` | Fake marketplace data for local dev | **Yes** — swap in services relevant to you |
| `contract/` | The Rust → WASM TEE policy contract | Usually no — this is the enforcement core |
| `services/payment-relay/src/circle-cli.ts` | Wraps the real Circle CLI | Usually no |
| `dashboard/` | Next.js activity/audit dashboard | Optional — customize the UI, not the safety model |

Full guidance on what to change (and what to leave alone, and why) is in
[`docs/CUSTOMIZE.md`](docs/CUSTOMIZE.md).

## Quickstart

This template is written assuming you'll run it for real — with your own Terminal 3
developer account and your own Circle wallet — since that's the only way to see the actual
guardrail enforcement (allowlist/cap/budget checks, live revocation) happen for real. Full
walkthrough: **[`GETTING_STARTED.md`](GETTING_STARTED.md)**.

**Just want to see the UI and flow first, with zero accounts?** Every piece of this demo also
runs in **mock mode** (`MOCK_CIRCLE=1` / `MOCK_T3N=1`) — no Terminal 3 account, no Circle
wallet, no real money, running in about 5 minutes:

```bash
npm install

# terminal 1 — the payment relay, mocked
RELAY_SHARED_SECRET=dev-secret MOCK_CIRCLE=1 PORT=8787 \
  npm run start --workspace services/payment-relay

# terminal 2 — the dashboard, also mocked
cd dashboard
MOCK_T3N=1 SESSION_BUDGET_USDC=1.0 PER_CALL_CAP_USDC=0.6 RELAY_BASE_URL=http://localhost:8787 \
  npm run dev
```

Open `http://localhost:3000`, then see [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) for how to drive it,
or jump straight to **[`GETTING_STARTED.md`](GETTING_STARTED.md)** to set up real
credentials.

## Make this yours

Building your own agent on Terminal 3's ADK? Read
**[`docs/CUSTOMIZE.md`](docs/CUSTOMIZE.md)** — it lists, file by file, exactly what's
specific to this call-centre scenario (swap freely) versus what's core guardrail
infrastructure (leave alone unless you know why you're changing it). Every one of those
spots is also marked in the code itself with a `// CUSTOMIZE:` comment, so you can just grep
for it:

```bash
grep -rn "CUSTOMIZE:" --include="*.ts" --include="*.rs" .
```

## Learn more — Terminal 3 docs

| Doc | What it covers |
|---|---|
| [What is ADK?](https://docs.terminal3.io/developers/adk/overview/what-is-adk) | The concepts behind Terminal 3's Agent Developer Kit |
| [ADK Quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart) | Your first authenticated ADK call, in under 10 minutes |
| [Agent Auth](https://docs.terminal3.io/developers/adk/overview/agent-auth-adk) | The grants/scopes model behind the allowlist this demo uses |
| [SDK & API Reference](https://docs.terminal3.io/developers/adk/reference) | Every `@terminal3/t3n-sdk` method and WIT interface |
| [Common errors](https://docs.terminal3.io/developers/adk/tips/common-errors) | Solutions to the errors you're most likely to hit |
| [Payroll agent use case](https://docs.terminal3.io/developers/adk/use-cases/payroll-agent) | Another worked example of an agent with real spend guardrails |

Also see this repo's own [`docs/GOTCHAS.md`](docs/GOTCHAS.md) for the concrete bugs/pitfalls
hit while building this specific demo — worth reading before you build your own integration.

## Security

Read **[`SECURITY.md`](SECURITY.md)** before running this against a funded wallet — it lays
out exactly which credentials this demo touches, where they're allowed to live, and why the
agent process itself is deliberately never trusted with a payment credential.

## Contributing

Found a bug, or got your own version of this working differently? Issues and PRs are
welcome — a precise bug report (exact command, exact error, exact environment) is the most
useful contribution.

## License

[MIT](LICENSE) © Terminal 3
