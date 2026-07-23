# Security

This demo's entire thesis is "an AI agent should not have unguarded access to money." That
has to be true of the demo's own engineering, not just its pitch — and it should stay true
in whatever you build on top of this template.

## Why this document exists

Payment-provider agent tooling in general (Circle's included — see
`docs/circle-skills-reviewed/` for the specific docs this project reviewed) commonly
instructs a calling AI agent to run with broad standing permissions and to act on payments
without extra confirmation, in order to reduce friction. That's a real, demonstrable
ambient-authority gap: an agent holding a funded wallet with no built-in spend caps or audit
trail. This demo — and this template — takes the opposite approach everywhere it touches
money:

## Rules

- **The agent process's tool list is hard-limited** to `search_services`, `inspect_service`,
  `pay_for_service`, `get_ledger` (`agent/src/loop.ts`). No filesystem tool, no shell tool,
  no ability to install anything at runtime, no wallet-login/terms-acceptance capability of
  any kind. If you add tools for your own scenario, keep this principle: the agent gets the
  narrowest tool surface that can do its job, nothing more.
- **The agent never holds a Circle credential.** `agent/src/t3n-client.ts` holds only the
  agent's own Terminal 3 key (`AGENT_KEY`). Circle credentials live only in two places:
  sealed in the contract's `secrets` KV map (readable only inside the enclave), and
  transiently in the payment relay's process memory on the machine where `circle wallet
  login` was run interactively by a human.
- **`circle terms accept` and the login/OTP flow must be run once, manually, by a human**,
  in their own interactive terminal — never scripted, never automated, never run by an agent
  on a human's behalf.
- **`@circle-fin/cli` should be installed once, manually, by a human** on your relay host —
  never auto-installed by any script in this repo.
- **Review every third-party agent-skill doc before trusting its instructions.** See
  `docs/circle-skills-reviewed/` for an example of annotated review, and what risky
  instructions found there are overridden by, here.
- **Secrets hygiene**: `RELAY_SHARED_SECRET` and the Circle CLI session should live only on
  your relay host (env var + local CLI session state) and sealed in Terminal 3 KV — never in
  git, never logged, never in the agent process's environment. `AGENT_KEY`/`T3N_API_KEY`
  should be generated/obtained once and stored as deployment secrets (GitHub Secrets, your
  host's own env, a secrets manager) — never committed, never pasted into a shared chat
  transcript as a persistent record.
- **The enclave's policy, not a confirmation prompt, is what makes autonomy safe.** This is
  the actual point of this template: removing friction by skipping confirmation is only
  safe if there's a spend cap and a host allowlist enforced somewhere the agent genuinely
  cannot touch — not friction removed with no guardrail underneath it.

## If you're extending this demo

- Do not add a "mock" bypass to `agent/src/t3n-client.ts`. If you need to test the agent
  loop without live Terminal 3 credentials, inject a fake at the test level or mock
  `services/payment-relay` instead — never let the agent process itself hold or fake its way
  past the Terminal 3 boundary. (`dashboard/lib/t3n.ts`'s `MOCK_T3N` flag is lower-risk and
  acceptable because dashboard reads never move money — the same reasoning does not extend
  to the agent's payment path.)
- Any new outbound call the contract makes must go through the same host-allowlist + cap +
  budget checks as `pay-for-service` — do not add a second, unguarded egress path.
- If you add real mainnet spend to CI or an automated pipeline, cap it explicitly and treat
  it as production financial infrastructure, not a test fixture.
- Before publishing or sharing your fork publicly, double-check you haven't committed a
  `.env` file, a real API key, or a real private key anywhere in history — `.gitignore`
  already excludes `.env`/`.env.local`, but a `git log -p` sanity check costs you two minutes
  and can save you a credential rotation.
