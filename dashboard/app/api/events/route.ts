// Live-mode API route: a simple in-memory event log the agent posts its own
// self-reported activity to (thinking steps, tool calls, payment
// approvals/denials), and the dashboard's ActivityFeed polls via GET. This
// is the agent's *own account* of what happened -- deliberately kept
// separate from the independently-sourced ledger in lib/t3n.ts / the
// AuditTrail, so a mismatch between the two is visible rather than papered
// over.
import { NextRequest, NextResponse } from "next/server";
import { mockAppendEntry } from "@/lib/t3n";

// In-memory event log. Fine for a single-process demo dashboard; a
// multi-instance production deployment would need a real pub/sub or DB --
// out of scope for this demo (see ARCHITECTURE.md).
interface StoredEvent {
  ts: string;
  [key: string]: unknown;
}

const MAX_EVENTS = 200;

// globalThis, not a module-scoped array -- Next.js dev mode re-evaluates
// route modules per request often enough that a plain top-level `const`
// does not reliably survive between calls (same gotcha as lib/t3n.ts's
// mock ledger state; see the comment there for the full explanation).
declare global {
  // eslint-disable-next-line no-var
  var __guardedCommerceEvents: StoredEvent[] | undefined;
}
function getEvents(): StoredEvent[] {
  if (!globalThis.__guardedCommerceEvents) globalThis.__guardedCommerceEvents = [];
  return globalThis.__guardedCommerceEvents;
}

export async function GET() {
  return NextResponse.json({ events: getEvents() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<StoredEvent>;
  // Server stamps/overwrites `ts` -- authoritative and a fallback for any
  // caller (like a manual curl test) that omits it.
  const event: StoredEvent = { ...body, ts: new Date().toISOString() };
  const events = getEvents();
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();

  // Mock-mode bridge: mirror the agent's self-reported payment outcomes into
  // the in-memory mock ledger, so mock mode has something to render in the
  // AuditTrail/BudgetMeter without a real T3N contract. No-op when MOCK_T3N
  // isn't set (mockAppendEntry checks internally).
  if (event.type === "payment_approved" || event.type === "payment_denied") {
    mockAppendEntry({
      seq: events.length,
      ts: Date.now(),
      service_url: String(event.service_url ?? ""),
      amount_usdc: Number(event.amount_usdc ?? 0),
      status: event.type === "payment_approved" ? "paid" : "denied",
      reason: event.reason ? String(event.reason) : undefined,
      remaining_budget: event.remaining_budget !== undefined ? Number(event.remaining_budget) : undefined,
      idempotency_key: `evt-${events.length}`,
    });
  }

  return NextResponse.json({ ok: true });
}
