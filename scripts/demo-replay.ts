// WHAT: Drives the dashboard's mock ledger through a paced, scripted replay
// of the whole demo narrative (research -> payments -> cap denial ->
// revocation), so you can record a clean demo video without depending on a
// live end-to-end payment path.
// WHEN: Repeatable -- run it any time you want to record or rehearse the
// demo video against the dashboard's mock mode (MOCK_T3N=1).
// RUN: npm run demo-replay --workspace scripts
// (see the in-file Usage block below for the full pre-recording checklist)
//
// Drives the dashboard's MOCK_T3N=1 mock ledger with a realistic, paced
// sequence of events -- for recording the demo video while real end-to-end
// payment execution is blocked on an open Terminal 3 platform issue (see
// STATUS.md). Mirrors DEMO_SCRIPT.md's narrative beat for beat, using the
// SAME real captured marketplace data as services/payment-relay/mock-data/,
// plus the one clearly-synthetic cap-trip entry ("Premium News Sentiment" --
// disclose this on screen/in the post if the service list is shown, per
// mock-data/README.md).
//
// Does NOT touch agent/src/t3n-client.ts or add any mock branch there --
// that boundary stays untouched by design (see SECURITY.md). This script
// only ever talks to the dashboard's own HTTP API, exactly like a human
// clicking around would, just scripted for repeatable pacing.
//
// Usage:
//   1. Start the relay in mock mode and the dashboard with MOCK_T3N=1 (see
//      README.md's mock quickstart / GETTING_STARTED.md §8).
//   2. Open http://localhost:3000 in the browser you're recording.
//   3. npm run demo-replay --workspace scripts
//   4. When the script pauses and says "Now click Revoke Agent Access in the
//      dashboard", do that on camera, then press Enter in this terminal to
//      continue.
import * as readline from "node:readline/promises";

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://localhost:3000";

type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool: string; args: unknown }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "payment_approved"; service_url: string; amount_usdc: number; remaining_budget: number }
  | { type: "payment_denied"; service_url: string; amount_usdc: number; reason: string };

async function emit(event: AgentEvent): Promise<void> {
  console.log(`  -> ${event.type}` + ("tool" in event ? ` (${event.tool})` : ""));
  await fetch(`${DASHBOARD_URL}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function beat(narration: string, events: AgentEvent[], pauseAfterMs = 2500): Promise<void> {
  console.log(`\n[narration] ${narration}`);
  for (const event of events) {
    await emit(event);
    await sleep(600);
  }
  await sleep(pauseAfterMs);
}

const AISA_URL = "https://aisa.one/apis/v2/coingecko/simple/token_price/{id}";
const BLOCKRUN_URL = "https://nano.blockrun.ai/api/v1/surf/exchange/price";
const PREMIUM_NEWS_URL = "https://premium-news.example.com/api/v1/crypto/sentiment"; // synthetic -- see mock-data/README.md

async function main() {
  console.log(`Driving dashboard at ${DASHBOARD_URL}. Make sure it's open and recording before continuing.`);

  await beat(
    "The agent starts researching BTC/ETH market sentiment -- searching Circle's x402 marketplace. No money moves yet.",
    [
      { type: "thinking", text: "I'll start by searching the marketplace for crypto market sentiment data services." },
      { type: "tool_call", tool: "search_services", args: { keyword: "crypto market sentiment" } },
      {
        type: "tool_result",
        tool: "search_services",
        result: { data: { items: [{ resource: AISA_URL, metadata: { provider: { name: "AIsa API" }, amount_usdc: 0.008 } }] } },
      },
    ]
  );

  await beat(
    "It inspects the first result to confirm price and method before paying anything.",
    [
      { type: "tool_call", tool: "inspect_service", args: { service_url: AISA_URL } },
      { type: "tool_result", tool: "inspect_service", result: { data: { status: "payable", price: { formatted: "$0.008 USDC" }, method: "GET" } } },
    ]
  );

  await beat(
    "First real payment: $0.008 to AIsa's CoinGecko price feed. Watch the Budget Meter and Audit Trail update live.",
    [
      { type: "tool_call", tool: "pay_for_service", args: { service_url: AISA_URL, method: "GET", amount_usdc: 0.008 } },
      { type: "payment_approved", service_url: AISA_URL, amount_usdc: 0.008, remaining_budget: 0.992 },
    ]
  );

  await beat(
    "Second source: BlockRun.AI's Surf exchange price feed -- $0.0075.",
    [
      { type: "tool_call", tool: "search_services", args: { keyword: "exchange price" } },
      { type: "tool_result", tool: "search_services", result: { data: { items: [{ resource: BLOCKRUN_URL, metadata: { provider: { name: "BlockRun.AI" }, amount_usdc: 0.0075 } }] } } },
      { type: "tool_call", tool: "pay_for_service", args: { service_url: BLOCKRUN_URL, method: "GET", amount_usdc: 0.0075 } },
      { type: "payment_approved", service_url: BLOCKRUN_URL, amount_usdc: 0.0075, remaining_budget: 0.9845 },
    ]
  );

  await beat(
    "WOW MOMENT 1: the agent finds a third service -- 'Premium News Sentiment' -- priced at $0.06, above the $0.05 per-call cap. It tries to pay anyway.",
    [
      { type: "tool_call", tool: "inspect_service", args: { service_url: PREMIUM_NEWS_URL } },
      { type: "tool_result", tool: "inspect_service", result: { data: { status: "payable", price: { formatted: "$0.06 USDC" }, method: "GET" } } },
      { type: "thinking", text: "This one is pricier, but it looks like a good third source. I'll attempt payment." },
      { type: "tool_call", tool: "pay_for_service", args: { service_url: PREMIUM_NEWS_URL, method: "GET", amount_usdc: 0.06 } },
    ],
    500
  );
  await emit({
    type: "payment_denied",
    service_url: PREMIUM_NEWS_URL,
    amount_usdc: 0.06,
    reason: "policy_denied: 0.06 exceeds per-call cap 0.05",
  });
  console.log("\n  >>> Enclave denied the payment BEFORE any money moved or secrets were touched. <<<");
  console.log("  Point the camera at the red 'Denied' row in the Audit Trail now.");
  await sleep(4000);

  await beat(
    "The agent adapts -- reports the denial honestly instead of pretending it succeeded.",
    [{ type: "thinking", text: "That payment was denied by the spend policy. I have two verified sources so far; I'll report what I found and note the third was blocked by the cap." }]
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n=== WOW MOMENT 2 ===");
  console.log("Now click 'Revoke Agent Access' in the Policy Panel, live on camera.");
  await rl.question("Press Enter here once you've clicked it... ");
  rl.close();

  console.log("\n[narration] The agent tries one more payment immediately after revocation.");
  await emit({ type: "tool_call", tool: "pay_for_service", args: { service_url: AISA_URL, method: "GET", amount_usdc: 0.008 } });
  await sleep(600);
  await emit({
    type: "payment_denied",
    service_url: AISA_URL,
    amount_usdc: 0.008,
    reason: "host/http.egress_denied: agent access has been revoked",
  });
  console.log("\n  >>> Instant, real, verifiable control -- no redeploy, no code change. <<<");
  console.log("\nDone. Close on the full Audit Trail (paid + denied rows) and cut.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
