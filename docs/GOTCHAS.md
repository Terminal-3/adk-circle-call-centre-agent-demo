# Gotchas

Real bugs hit while building this — read before you build your own integration.

## Terminal 3 auth / policy

### Always set `pii_did` explicitly on metered/delegated calls

Every `pay-for-service`/`get-ledger` call that omits the optional `pii_did` field silently
defaults to treating the invocation as a self-call by the **agent's own DID** — the node looks
up `AGENT_AUTH_MAP[agent_did]` (empty, since the agent never granted itself anything) instead of
`AGENT_AUTH_MAP[tenant_did]`, where the real grant actually lives. That resolves to
`allowed=None` and surfaces as `host/http.egress_denied`, which reads exactly like a
misconfigured allowlist — it is actually the wrong lookup subject entirely. Confusingly,
`getAgentAuth()` read-backs look perfect the whole time because diagnostic reads are typically
authenticated as the tenant (the right subject), so they check the right place even while the
invocation itself doesn't. Fix: always pass `pii_did` set to the grant's actual subject (usually
the tenant DID) on every metered call.

### Cap response sizes before decoding into a generic JSON value inside the enclave

Decoding an external HTTP response into a fully generic value type (e.g. `serde_json::Value`)
inside the enclave, with no size limit, is not just a "fails cleanly" risk — a large/deeply
nested body can trigger a WASM-level allocation/stack-pressure trap that aborts execution below
the language's own error-handling model. No amount of `Result`/`?` plumbing in your own guest
code catches this, since the trap happens beneath it, and it surfaces upstream as a bare,
undetailed `Internal error` with no application-level message. Fix: enforce a hard byte-size
ceiling (e.g. 256 KiB) on any response body before handing it to a generic decode, returning a
clean `Err` for anything over the limit instead of ever reaching the deserializer.

### The host KV runtime rolls back writes from a call that returns `Err`

Any state written during a contract call — including an append to an audit ledger — is rolled
back if that call ultimately returns `Err`, even if the write itself succeeded. If your policy
denials (cap exceeded, host not allowlisted, etc.) are implemented as an early `Err` return after
appending a ledger entry, that entry silently vanishes; only ever-successful calls persist. A
mock/in-memory test harness typically has no such rollback concept, so this can pass every local
test and still fail against the real ledger. Fix: treat expected business-logic denials as normal
outcomes — return `Ok(response)` with a `reason`/`denied` field describing the denial, and reserve
`Err` strictly for genuine infrastructure faults that have nothing meaningful to log anyway.

### A contract version bump mints a new `contract_id` — re-ACL, don't just re-register

Registering a new version of an already-registered contract allocates a **new numeric
`contract_id`**, not a stable id carried across versions. Existing KV maps stay ACL'd to the old
id, so a naive "just re-register" flow will find its own maps unreadable/unwritable
post-bump (`map already exists`, but access denied). Fix: on every version bump, explicitly
re-point each map's ACL (readers/writers) at the new `contract_id` — don't assume re-registration
alone carries access forward. Build this into your provisioning script as a standard step, not a
one-off manual fix.

### `functions` must never be empty when revoking access

A revocation flow that tries to set both `functions: []` and `allowedHosts: []` is rejected
outright by the node (`functions must not be empty (use ["*"] for all functions)`). To revoke an
agent's ability to actually move money/spend without disabling the function call entirely, clear
`allowedHosts: []` only, and keep `functions` populated (or `["*"]`). This is arguably the more
precise revocation story anyway: the agent can still invoke the function, it just can no longer
reach any egress host to act on it.

### Agent identities need their own credit balance, and metering charges on every attempt

An agent's DID is a separate identity from the tenant's for metering purposes — it needs its own
credit balance to invoke a metered function, and tokens generally aren't transferable between
identities. There is typically no self-serve path for an agent-only (key-based, no verified
email) identity to acquire its own balance; budget for a manual/administrative grant. Separately,
metering is charge-on-attempt: a call that fails (even with a bare internal error) still consumes
credit, not just a successful call. A debugging session chasing a hard-to-reproduce failure can
burn through a fixed grant much faster than the number of successful payments would suggest.

### Don't conflate the egress-allowlist with the marketplace-service-allowlist

A contract that pays third-party services typically has two independent allowlists that answer
different questions: which host can the enclave's outbound HTTP call reach at all (the
agent-auth/egress grant), versus which marketplace seller's URL is this agent policy-permitted to
pay (a business-policy allowlist checked against the request's target service URL). Seeding the
second with a value that belongs to the first (e.g. your own relay's host) guarantees every real
payment is denied, since a real marketplace host will never match your relay's own hostname. Keep
these as two clearly-named, independently-provisioned lists.

### Wrap every tool call consistently in error handling

If one tool wrapper in your agent's tool-use loop catches and returns a structured error/result
object on failure, but a sibling tool wrapper (added later, or just less carefully written)
lets an exception propagate, the entire agent process can crash on that tool's first failure
instead of surfacing it to the model as a recoverable result. Audit every tool wrapper for the
same try/catch-and-return-structured-error pattern, not just the ones you tested most.

## x402 / marketplace

### Real marketplace host drift is common — allowlists need active maintenance

A provider's obvious or marketing-facing domain is not always the actual resource host a live
x402 marketplace serves requests from. Real observed examples include a provider's search brand
being served through a completely different aggregator host than its own domain, and a provider's
listed API domain differing from the host its actual endpoint resolves to. A live marketplace's
inventory also drifts over time — new legitimate sellers appear under keyword searches that
weren't there before. Treat a fresh "host not on allowlist" denial for an unfamiliar-but-clearly-
legitimate host as expected drift to add to your allowlist, not automatically a regression of your
policy code.

### x402 prices arrive as raw on-chain base-unit integers, not a dollar figure

The x402 price field returned by an `inspect`-style call is commonly a raw on-chain base-unit
integer (e.g. USDC's 6-decimal units) with no clean dollar figure alongside it in every response
shape. Passing that raw integer straight through to a payment tool or into an LLM's reasoning as
if it were already a dollar amount can produce an amount that's off by many orders of magnitude —
concretely, a service actually priced at fractions of a cent can be mistakenly submitted as
thousands of dollars. Always compute and pass through a normalized dollar amount (divide by the
currency's decimal base) at the point where a response is inspected, so every consumer downstream
sees the same, already-correct unit.

### Inspect a seller's accepted chains and payment method before paying — and prefer a chain you're actually funded on

Two related mistakes compound here. First, hardcoding a single chain for every payment call
breaks the moment a seller only accepts a different chain. Second, even once you inspect a
seller's accepted-chains list, blindly picking the first entry can still fail — if that chain
happens to be one your wallet isn't funded on, a naive client can hang until its own request
timeout instead of failing fast with a clean "insufficient balance" response. Fix: inspect the
seller's actual accepted chains and payment method (GET vs POST, etc.) before paying, and prefer
your own known-funded default chain whenever a seller's list includes it, falling back to another
listed chain only when it doesn't.

### GET requests need query parameters in the URL, not the request body

Some payment/x402 CLIs do not fold a body payload into a GET request's query string
automatically — omitting a required query parameter (e.g. a `pair`/lookup key) can produce a
generic 400 error from the seller *before* the payment challenge is even reached (which is at
least safe — nothing is charged for a pre-payment-challenge rejection). If a paid GET endpoint
needs parameters, embed them directly in the request URL rather than relying on a generic
"payload" argument to route them correctly.

### Cap and design around what a tool feeds back into the LLM's own context, not just what crosses your enclave boundary

The same "unbounded external response" risk that applies inside a contract also applies to
whatever your agent's tool-use loop stringifies straight into message history: an uncapped
marketplace search or listing response can, on its own, be large enough to blow past a model's
context window well before any long conversation accumulates. Cap the number of items/size of any
tool result that gets appended to conversation history, and include a truncation marker so the
model knows more results exist rather than assuming a partial list is complete.

## Payment / ledger

### A durable ledger's read path must never let one malformed entry fail every future read

If a ledger's read function collects per-entry parse results into a single all-or-nothing
`Result` (e.g. Rust's `.collect::<Result<Vec<_>, _>>()` over a scan of stored entries), a single
malformed stored entry causes the *entire* read to fail — and since nothing typically deletes
ledger entries, this is not a transient failure but a permanent one: every future read of the
ledger fails identically from that point on. This defeats the purpose of a durable/tamper-evident
audit trail. Fix: iterate and accumulate instead of collecting into a single `Result` — skip a
malformed entry, log it, and count it (surfaced back to the caller, e.g. as a
`malformed_entries` count), rather than letting one bad row take down every future read.
