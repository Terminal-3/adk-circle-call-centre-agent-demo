// WHAT THIS FILE DOES: A tiny event bus for the agent's activity log. Every
// tool call, tool result, payment decision, and thinking step gets emitted
// through here -- printed to the console, and optionally POSTed to a
// dashboard URL for a live UI feed. It sits alongside the agent loop
// (loop.ts calls `emit()` at each step); it does not talk to Terminal 3 or
// move money itself.

// Structured activity events for the dashboard's live feed. The ledger
// (read via get-ledger) is the source of truth for money movement; these
// events are the agent's own narration -- what it searched, what it decided,
// what a tool returned -- shown side by side with the ledger so a mismatch
// between "what the agent claims" and "what the enclave recorded" is visible,
// which is the dashboard's whole trust-design point (see the approved plan).
const DASHBOARD_EVENTS_URL = process.env.DASHBOARD_EVENTS_URL;

export type AgentEvent =
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool: string; args: unknown }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "payment_approved"; service_url: string; amount_usdc: number; remaining_budget: number }
  | { type: "payment_denied"; service_url: string; amount_usdc: number; reason: string }
  // Same shape the dashboard chat already emits for an operator's reply
  // (dashboard/lib/useReplay.ts) -- the CLI loop's stdin prompt (loop.ts)
  // emits this too, so a reply typed at the terminal shows up in the
  // dashboard's Activity Feed the same way a dashboard-chat reply does.
  | { type: "user_reply"; text: string };

export async function emit(event: AgentEvent): Promise<void> {
  const stamped = { ...event, ts: new Date().toISOString() };
  console.log(JSON.stringify(stamped));

  if (!DASHBOARD_EVENTS_URL) return;
  try {
    await fetch(DASHBOARD_EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stamped),
    });
  } catch (err) {
    // Dashboard being unreachable should never break the agent loop --
    // the ledger is still the durable record regardless of whether the
    // live feed rendered it.
    console.error("failed to emit event to dashboard:", err instanceof Error ? err.message : err);
  }
}
