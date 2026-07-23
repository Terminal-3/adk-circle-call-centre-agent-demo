// Renders the scrolling "Agent activity" panel: a chronological list of
// everything the agent did or thought, newest first. The `events` prop is
// the agent's own self-reported stream -- in replay mode it comes from
// lib/replay-data.ts via lib/useReplay.ts; in live mode it's polled from
// the /api/events route (app/api/events/route.ts). This is intentionally
// the agent's account of events, not the enforcement ledger (see
// AuditTrail.tsx for that).
"use client";

interface AgentEvent {
  ts: string;
  type: "thinking" | "tool_call" | "tool_result" | "comparing_providers" | "payment_approved" | "payment_denied" | "user_reply";
  [key: string]: unknown;
}

const DOT_COLOR: Record<AgentEvent["type"], string> = {
  thinking: "var(--text-muted)",
  tool_call: "var(--series-blue)",
  tool_result: "var(--series-blue)",
  comparing_providers: "var(--series-blue)",
  payment_approved: "var(--status-good)",
  payment_denied: "var(--status-warning)",
  user_reply: "var(--text-primary)",
};

// Timestamps are stamped onto a fixed mocked day (see lib/replay-data.ts) --
// always rendered in UTC so every visitor sees the same 9am-10pm timeline
// regardless of their own timezone.
function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function describe(event: AgentEvent): string {
  switch (event.type) {
    case "thinking":
      return String(event.text ?? "");
    case "tool_call":
      return `called ${event.tool}(${JSON.stringify(event.args)})`;
    case "tool_result":
      return `${event.tool} returned`;
    case "comparing_providers": {
      const candidates = (event.candidates as { host: string; price: number }[] | undefined) ?? [];
      const selected = candidates.find((c) => c.host === event.selectedHost);
      const price = selected ? `$${selected.price.toFixed(4)}` : "";
      return `compared ${candidates.length} marketplace providers -- selected ${event.selectedHost} (${price})`;
    }
    case "payment_approved":
      return `paid $${Number(event.amount_usdc).toFixed(4)} to ${event.service_url}`;
    case "payment_denied":
      return `denied: ${event.reason}`;
    case "user_reply":
      return `operator replied: "${event.text}"`;
    default:
      return JSON.stringify(event);
  }
}

export function ActivityFeed({ events }: { events: AgentEvent[] }) {
  const recent = [...events].reverse();

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <p className="panel-title">Agent activity</p>
      <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        {recent.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Waiting for the agent to start...</p>
        ) : (
          recent.map((event, i) => (
            <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "flex-start" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: DOT_COLOR[event.type] ?? "var(--text-muted)",
                  marginTop: 5,
                  flexShrink: 0,
                }}
              />
              <div>
                <span className="mono" style={{ color: "var(--text-muted)", marginRight: 8 }}>
                  {formatTime(event.ts)}
                </span>
                <span style={{ color: "var(--text-primary)" }}>{describe(event)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
