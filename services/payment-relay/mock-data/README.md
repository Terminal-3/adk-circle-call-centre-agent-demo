# Mock marketplace data — provenance

> **CUSTOMIZE:** replace these mock listings with services relevant to your own
> scenario. They exist only to make `MOCK_CIRCLE=1` demos deterministic and
> reproducible on every run -- swap in whatever x402-payable services your own
> demo/agent should be able to discover and pay, and update the descriptions,
> prices, and `resource` URLs in `services.json` to match.

`services.json` seeds the relay's mock mode (`MOCK_CIRCLE=1`) for the current enterprise
support/trust-and-safety scenario (see `agent/src/loop.ts`'s `TASK`). The previous version of
this file (crypto market-sentiment providers) is preserved in git history, not rewritten --
`docs/DEVELOPER_BUILD_LOG.md` documents that phase as it actually happened.

**Provider identity, host, and general x402 support are real and independently verified** for
all four entries:
- **Tavily** (`api.tavily.com`) — confirmed real x402 support, `POST /search`, paid per call in
  USDC on Base (see `docs.tavily.com/documentation/machine-payments/x402`).
- **Parallel** (`api.parallel.ai`) — confirmed real x402/MPP payment support (see
  `parallelmpp.dev`).
- **StablePhone** (`stablephone.dev`) — confirmed real, **$0.54/call is StablePhone's actual
  disclosed price**, not illustrative.

**What's illustrative/reconstructed**, since this project doesn't have live marketplace access
to re-capture the exact JSON the way the original AIsa/BlockRun entries were captured from
`circle services search`: the exact request paths, the `accepts[]` payment details (chain,
asset contract, on-chain amount), and Tavily/Parallel's specific per-call prices. The fourth
entry, **StablePhone's "priority" call with human transfer**, is entirely illustrative -- a
plausible premium tier on the same real provider, since StablePhone's own tiered/escalation
pricing (if any) isn't publicly disclosed. It exists to make Wow Moment 1 (a payment that trips
the per-call cap) reproduce deterministically on every demo take, per `DEMO_SCRIPT.md`'s "don't
rely on emergent LLM behavior" guidance -- the same role the old synthetic "Premium News
Sentiment" entry played.

Disclose the illustrative parts in the blog post / video if the exact service list is shown on
screen -- the point being demonstrated (enclave-enforced spend caps) is real regardless.
