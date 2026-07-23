// Renders the "Session budget" progress meter: running total spent vs. the
// session's USDC budget, with the fill color escalating (blue -> warning ->
// critical) as it fills up. `runningTotal` and `sessionBudget` come from the
// ledger snapshot (lib/t3n.ts's LedgerSnapshot, read via /api/ledger in live
// mode or lib/useReplay.ts in replay mode) -- i.e. the enclave's own record
// of spend, not anything the agent self-reports.
"use client";

// A single ratio against a limit -> Meter (dataviz skill, choosing-a-form.md).
// Fill carries severity (accent -> warning -> danger); track is a lighter
// step of the same ramp so state reads across the whole bar.
export function BudgetMeter({ runningTotal, sessionBudget }: { runningTotal: number; sessionBudget: number }) {
  const ratio = sessionBudget > 0 ? Math.min(runningTotal / sessionBudget, 1) : 0;
  const remaining = Math.max(sessionBudget - runningTotal, 0);

  let fillColor = "var(--series-blue)";
  if (ratio >= 0.9) fillColor = "var(--status-critical)";
  else if (ratio >= 0.7) fillColor = "var(--status-warning)";

  return (
    <div className="panel">
      <p className="panel-title">Session budget</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 32, fontWeight: 600, color: "var(--text-primary)" }}>
          ${runningTotal.toFixed(4)}
        </span>
        <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>/ ${sessionBudget.toFixed(2)} USDC</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 12,
          borderRadius: 6,
          background: "var(--series-blue-light)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${ratio * 100}%`,
            background: fillColor,
            borderRadius: 6,
            transition: "width 300ms ease, background 300ms ease",
          }}
        />
      </div>
      <p style={{ margin: "10px 0 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
        ${remaining.toFixed(4)} remaining this session
      </p>
    </div>
  );
}
