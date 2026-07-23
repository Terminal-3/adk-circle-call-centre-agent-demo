// Renders the "Audit trail" table: every payment attempt (paid/denied/
// failed) with amount, remaining budget, and reason. Its `entries` prop
// comes from the ledger snapshot (lib/t3n.ts's LedgerSnapshot.entries) --
// i.e. the Terminal 3 TEE contract's own record, independent of whatever
// the agent itself claims happened in ActivityFeed.tsx. This is the
// "did it actually happen" half of the agent-vs-enclave comparison this
// dashboard is built to expose.
"use client";

import type { LedgerEntry } from "@/lib/t3n";

// Status colors are reserved (good/warning/critical) and never used as
// categorical -- each ships with an icon + label, never color alone.
const STATUS_STYLE: Record<LedgerEntry["status"], { color: string; icon: string; label: string }> = {
  paid: { color: "var(--status-good)", icon: "✓", label: "Paid" },
  denied: { color: "var(--status-warning)", icon: "⚠", label: "Denied" },
  failed: { color: "var(--status-critical)", icon: "✕", label: "Failed" },
};

// Timestamps are stamped onto a fixed mocked day in replay mode (see
// lib/replay-data.ts) -- always rendered in UTC so every visitor sees the
// same 9am-10pm timeline regardless of their own timezone.
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

export function AuditTrail({ entries }: { entries: LedgerEntry[] }) {
  const sorted = [...entries].sort((a, b) => b.seq - a.seq);

  return (
    <div className="panel">
      <p className="panel-title">Audit trail</p>
      {sorted.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No payment attempts yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", borderBottom: "1px solid var(--gridline)" }}>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Time</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Status</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Service</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Amount</th>
                <th style={{ padding: "6px 8px", fontWeight: 500, textAlign: "right" }}>Remaining budget</th>
                <th style={{ padding: "6px 8px", fontWeight: 500 }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => {
                const style = STATUS_STYLE[entry.status];
                return (
                  <tr key={entry.seq} style={{ borderBottom: "1px solid var(--gridline)" }}>
                    <td className="mono" style={{ padding: "8px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {formatTime(entry.ts)}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <span style={{ color: style.color, fontWeight: 600 }}>
                        {style.icon} {style.label}
                      </span>
                    </td>
                    <td style={{ padding: "8px", color: "var(--text-primary)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.service_url}
                    </td>
                    <td className="mono" style={{ padding: "8px", textAlign: "right" }}>
                      ${entry.amount_usdc.toFixed(4)}
                    </td>
                    <td className="mono" style={{ padding: "8px", textAlign: "right", color: "var(--text-secondary)" }}>
                      {entry.remaining_budget !== undefined ? `$${entry.remaining_budget.toFixed(4)}` : "–"}
                    </td>
                    <td style={{ padding: "8px", color: "var(--text-secondary)" }}>{entry.reason ?? "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
