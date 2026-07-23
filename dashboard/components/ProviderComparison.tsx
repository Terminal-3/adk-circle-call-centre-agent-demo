// Renders the "Marketplace comparison" panel: the list of x402-payable
// service candidates the agent evaluated before picking one, cheapest-first,
// with a brief highlight animation once the choice is "decided". Its
// `comparison` prop is built from a "comparing_providers" event in the
// agent's own event stream (see lib/replay-data.ts's ProviderCandidate /
// lib/useReplay.ts) -- this is the agent explaining its own cost reasoning,
// not an enforcement record.
"use client";

import { useEffect, useState } from "react";
import type { ProviderCandidate } from "@/lib/replay-data";

export interface ComparisonEvent {
  candidates: ProviderCandidate[];
  selectedHost: string;
  reason: string;
}

// Marketplace-listing-style comparison, in the spirit of Circle's own Agent
// Marketplace (agents.circle.com/services): each candidate as a row with a
// provider avatar, category tag, and price, sorted cheapest-first. A short
// "evaluating" beat before the cheapest match gets highlighted is what makes
// the agent's cost-reasoning visible rather than just asserted in a log line.
export function ProviderComparison({ comparison }: { comparison: ComparisonEvent }) {
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    setDecided(false);
    const id = setTimeout(() => setDecided(true), 900);
    return () => clearTimeout(id);
  }, [comparison]);

  const sorted = [...comparison.candidates].sort((a, b) => {
    if (a.ineligible !== b.ineligible) return a.ineligible ? 1 : -1;
    return (a.price ?? 0) - (b.price ?? 0);
  });

  return (
    <div className="panel">
      <p className="panel-title">Marketplace comparison</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map((c) => {
          const isSelected = c.host === comparison.selectedHost;
          const highlight = decided && isSelected;
          const dim = decided && !isSelected && !c.ineligible;
          return (
            <div
              key={c.host}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${highlight ? "var(--status-good)" : "var(--border)"}`,
                background: highlight ? "var(--series-blue-light)" : "transparent",
                opacity: dim ? 0.55 : c.ineligible ? 0.7 : 1,
                transform: highlight ? "scale(1.01)" : "scale(1)",
                transition: "opacity 400ms ease, border-color 400ms ease, background 400ms ease, transform 400ms ease",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--series-blue-light)",
                  color: "var(--series-blue)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                {c.provider[0]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{c.provider}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: c.ineligible ? "var(--status-critical)" : "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.ineligible
                    ? c.ineligibleReason
                    : `${c.category.replace(/_/g, " ").toLowerCase()} · ${c.host}`}
                </div>
              </div>
              {c.ineligible ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--status-critical)",
                    border: "1px solid var(--status-critical)",
                    borderRadius: 999,
                    padding: "2px 8px",
                    flexShrink: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                  }}
                >
                  Ruled out
                </span>
              ) : (
                <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", flexShrink: 0 }}>
                  ${(c.price ?? 0).toFixed(4)}
                </div>
              )}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--status-good)",
                  border: "1px solid var(--status-good)",
                  borderRadius: 999,
                  padding: "2px 8px",
                  flexShrink: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  visibility: highlight ? "visible" : "hidden",
                }}
              >
                Selected
              </span>
            </div>
          );
        })}
      </div>
      <p
        style={{
          margin: "12px 0 0 0",
          fontSize: 13,
          color: "var(--text-secondary)",
          minHeight: 18,
          opacity: decided ? 1 : 0,
          transition: "opacity 300ms ease",
        }}
      >
        {comparison.reason}
      </p>
    </div>
  );
}
