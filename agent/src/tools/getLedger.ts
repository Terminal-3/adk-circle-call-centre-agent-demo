// WHAT THIS FILE DOES: Thin wrapper exposing t3n-client.ts's getLedger() as
// an agent tool (get_ledger in loop.ts). Free/read-only -- lets the model
// check its remaining session budget and payment history so far.
import { getLedger as t3nGetLedger, type LedgerSnapshot } from "../t3n-client.js";

export async function getLedger(): Promise<LedgerSnapshot | { error: string }> {
  try {
    return await t3nGetLedger();
  } catch (err) {
    // Same pattern as payForService.ts -- surface as a tool result the model
    // can reason about (e.g. InsufficientCreditError), not a crash that kills
    // the whole agent loop.
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
