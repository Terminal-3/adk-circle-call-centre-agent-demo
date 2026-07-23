// Renders the "Policy & delegation" panel: the agent's current spend caps,
// host allowlist, and authorized/revoked status, plus the "Revoke Agent
// Access" / "Reset Budget" controls. In live mode those buttons POST to
// /api/revoke and /api/reset (lib/t3n.ts's revokeAgent()/resetBudget()); in
// replay mode (the `replay` prop) they instead just advance/restart the
// fixed scripted narrative from lib/useReplay.ts -- see the comment below.
"use client";

import { useState } from "react";

// In replay mode there's no live backend to call -- clicking these buttons
// advances/restarts the same fixed, static narrative (see lib/useReplay.ts)
// instead of making a real agent-auth-update call. This is what keeps the
// public site safe to deploy with no server state at all (see
// docs/DEVELOPER_BUILD_LOG.md on why a live "Run Live" button isn't exposed
// to anonymous visitors).
interface ReplayControls {
  awaitingRevoke: boolean;
  onRevoke: () => void;
  onRestart: () => void;
}

export function PolicyPanel({
  perCallCap,
  sessionBudget,
  hostAllowlist,
  revoked,
  onChanged,
  replay,
}: {
  perCallCap: number;
  sessionBudget: number;
  hostAllowlist: string[];
  revoked?: boolean;
  onChanged?: () => void;
  replay?: ReplayControls;
}) {
  const [busy, setBusy] = useState<"revoke" | "reset" | null>(null);

  async function call(path: "/api/revoke" | "/api/reset", which: "revoke" | "reset") {
    setBusy(which);
    try {
      await fetch(path, { method: "POST" });
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  const revokeDisabled = replay ? !replay.awaitingRevoke : busy !== null || revoked;
  const revokeLabel = replay
    ? replay.awaitingRevoke
      ? "Revoke Agent Access"
      : revoked
        ? "Revoked"
        : "Revoke Agent Access (wait for the cue)"
    : busy === "revoke"
      ? "Revoking..."
      : "Revoke Agent Access";

  return (
    <div className="panel">
      <p className="panel-title">Policy &amp; delegation</p>

      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 14 }}>
        <dt style={{ color: "var(--text-secondary)" }}>Per-call cap</dt>
        <dd className="mono" style={{ margin: 0 }}>
          ${perCallCap.toFixed(2)} USDC
        </dd>
        <dt style={{ color: "var(--text-secondary)" }}>Session budget</dt>
        <dd className="mono" style={{ margin: 0 }}>
          ${sessionBudget.toFixed(2)} USDC
        </dd>
        <dt style={{ color: "var(--text-secondary)" }}>Allowed hosts</dt>
        <dd className="mono" style={{ margin: 0 }}>
          {hostAllowlist.join(", ") || "(none)"}
        </dd>
        <dt style={{ color: "var(--text-secondary)" }}>Agent status</dt>
        <dd style={{ margin: 0, fontWeight: 600, color: revoked ? "var(--status-critical)" : "var(--status-good)" }}>
          {revoked ? "Revoked" : "Authorized"}
        </dd>
      </dl>

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button
          onClick={replay ? replay.onRevoke : () => call("/api/revoke", "revoke")}
          disabled={revokeDisabled}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--status-critical)",
            background: "transparent",
            color: "var(--status-critical)",
            fontWeight: 600,
            cursor: revokeDisabled ? "not-allowed" : "pointer",
            opacity: revokeDisabled ? 0.5 : 1,
          }}
        >
          {revokeLabel}
        </button>
        <button
          onClick={replay ? replay.onRestart : () => call("/api/reset", "reset")}
          disabled={!replay && busy !== null}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: !replay && busy ? "not-allowed" : "pointer",
            opacity: !replay && busy ? 0.5 : 1,
          }}
        >
          {replay ? "Replay from start" : busy === "reset" ? "Resetting..." : "Reset Budget"}
        </button>
      </div>
    </div>
  );
}
