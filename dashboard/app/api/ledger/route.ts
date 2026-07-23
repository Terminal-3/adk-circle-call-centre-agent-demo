// Live-mode API route: returns the current ledger snapshot (running total,
// budget, policy, and the full audit-trail entries) by calling
// lib/t3n.ts's readLedger(), which either queries the real Terminal 3 TEE
// contract or, in MOCK_T3N=1 dev mode, an in-memory stand-in. This is the
// "ground truth" the dashboard's BudgetMeter/PolicyPanel/AuditTrail render --
// independent of anything the agent self-reports via /api/events.
import { NextResponse } from "next/server";
import { readLedger } from "@/lib/t3n";

export async function GET() {
  try {
    const ledger = await readLedger();
    return NextResponse.json(ledger);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
