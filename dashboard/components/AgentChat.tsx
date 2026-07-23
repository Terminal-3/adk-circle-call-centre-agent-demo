// Renders the left-hand "Ask the agent" chat panel (replay mode only): the
// composer that kicks off the scripted run, plus a chat-style rendering of
// the same event stream ActivityFeed.tsx shows as a raw log. Events come
// from lib/replay-data.ts via lib/useReplay.ts; sending a message here
// (start / revoke) is what advances the scripted narrative -- there is no
// real chat backend or LLM behind this input.
"use client";

import { useEffect, useRef } from "react";
import { REPLAY_KICKOFF_PROMPT, type ReplayEvent } from "@/lib/replay-data";

// The human-facing side of the split screen: what someone actually asked
// for, in a chat surface they already know how to read. The dashboard next
// to it is the other half of the story -- the enforcement ground truth the
// chat's own words can't be trusted to represent by themselves.
//
// Nothing plays until a message is actually sent here -- the composer at
// the bottom starts the run, and later doubles as how the operator answers
// the agent's own question about revoking access. Both replies land in the
// shared event stream as "user_reply", so they show up in the Activity Feed
// too, not just this chat.
const HOST_NAMES: Record<string, string> = {
  "api.tavily.com": "Tavily",
  "api.parallel.ai": "Parallel",
  "stablephone.dev": "StablePhone",
};

function providerNameFromUrl(url: string): string {
  try {
    const host = new URL(url).host;
    return HOST_NAMES[host] ?? host;
  } catch {
    return url;
  }
}

function prettyDenyReason(reason: string | undefined): string {
  if (!reason) return "denied";
  if (reason.includes("revoked")) return "access has been revoked.";
  const match = reason.match(/^policy_denied:\s*(.+)$/);
  return match ? match[1] : reason;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

type ChatItem =
  | { kind: "user" | "agent"; ts: string; text: string }
  | { kind: "system"; ts: string; text: string; tone: "neutral" | "good" | "warning" | "critical" };

function buildChatItems(events: ReplayEvent[]): ChatItem[] {
  const items: ChatItem[] = [];

  for (const event of events) {
    if (event.revokedNotice) {
      items.push({ kind: "system", ts: event.ts, tone: "critical", text: "Operator revoked agent access." });
    }

    switch (event.type) {
      case "user_reply":
        items.push({ kind: "user", ts: event.ts, text: String(event.text ?? "") });
        break;
      case "thinking":
        items.push({ kind: "agent", ts: event.ts, text: String(event.text ?? "") });
        break;
      case "comparing_providers": {
        const candidates = event.candidates ?? [];
        const selected = candidates.find((c) => c.host === event.selectedHost);
        items.push({
          kind: "system",
          ts: event.ts,
          tone: "neutral",
          text: `Compared ${candidates.length} providers -- chose ${selected?.provider ?? event.selectedHost} ($${(selected?.price ?? 0).toFixed(4)})`,
        });
        break;
      }
      case "payment_approved":
        items.push({
          kind: "system",
          ts: event.ts,
          tone: "good",
          text: `Paid $${Number(event.amount_usdc).toFixed(4)} -- ${providerNameFromUrl(String(event.service_url))}`,
        });
        break;
      case "payment_denied":
        items.push({
          kind: "system",
          ts: event.ts,
          tone: String(event.reason ?? "").includes("revoked") ? "critical" : "warning",
          text: `Denied -- ${prettyDenyReason(event.reason as string | undefined)}`,
        });
        break;
      default:
        break;
    }
  }

  return items;
}

const TONE_COLOR: Record<Extract<ChatItem, { kind: "system" }>["tone"], string> = {
  neutral: "var(--series-blue)",
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

function Avatar({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: muted ? "var(--page-plane)" : "var(--series-blue-light)",
        color: muted ? "var(--text-secondary)" : "var(--series-blue)",
        border: muted ? "1px solid var(--border)" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}

const COMPOSER_MAX_HEIGHT = 180;

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
}

function ChatComposer({ defaultValue, onSend }: { defaultValue: string; onSend: (text: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Full text visible before sending, not clipped to one line -- grows with
  // content up to a cap, then scrolls internally.
  useEffect(() => {
    if (textareaRef.current) autoGrow(textareaRef.current);
  }, []);

  function submit() {
    const text = textareaRef.current?.value.trim();
    if (!text) return;
    onSend(text);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: "flex", gap: 8, marginTop: 12, flexShrink: 0, alignItems: "flex-end" }}
    >
      <textarea
        ref={textareaRef}
        defaultValue={defaultValue}
        rows={1}
        onInput={(e) => autoGrow(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        style={{
          flex: 1,
          fontSize: 14,
          fontFamily: "inherit",
          lineHeight: 1.4,
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--page-plane)",
          color: "var(--text-primary)",
          resize: "none",
          overflowY: "auto",
          maxHeight: COMPOSER_MAX_HEIGHT,
        }}
      />
      <button
        type="submit"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: "var(--series-blue)",
          border: "none",
          borderRadius: 10,
          padding: "8px 16px",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Send
      </button>
    </form>
  );
}

export function AgentChat({
  events,
  started,
  onStart,
  awaitingRevoke,
  onRevoke,
}: {
  events: ReplayEvent[];
  started: boolean;
  onStart: (text: string) => void;
  awaitingRevoke: boolean;
  onRevoke: (text: string) => void;
}) {
  const items = buildChatItems(events);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items.length, awaitingRevoke]);

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <p className="panel-title">Ask the agent</p>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 4 }}>
        {items.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Send a message below to start the agent&apos;s day.</p>
        )}
        {items.map((item, i) =>
          item.kind === "system" ? (
            <div key={i} style={{ display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: TONE_COLOR[item.tone],
                  background: "var(--page-plane)",
                  border: `1px solid ${TONE_COLOR[item.tone]}`,
                  borderRadius: 999,
                  padding: "4px 12px",
                  maxWidth: "100%",
                }}
              >
                <span className="mono" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                  {formatTime(item.ts)}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.text}</span>
              </div>
            </div>
          ) : (
            <div key={i} style={{ display: "flex", justifyContent: item.kind === "user" ? "flex-end" : "flex-start", gap: 8 }}>
              {item.kind === "agent" && <Avatar label="A" />}
              <div style={{ maxWidth: "82%" }}>
                <div
                  style={{
                    background: item.kind === "user" ? "var(--series-blue-light)" : "var(--page-plane)",
                    border: item.kind === "agent" ? "1px solid var(--border)" : "none",
                    borderRadius: 14,
                    padding: "8px 12px",
                    fontSize: 14,
                    color: "var(--text-primary)",
                  }}
                >
                  {item.text}
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, textAlign: item.kind === "user" ? "right" : "left" }}
                >
                  {formatTime(item.ts)}
                </div>
              </div>
              {item.kind === "user" && <Avatar label="U" muted />}
            </div>
          )
        )}
      </div>
      {!started && <ChatComposer defaultValue={REPLAY_KICKOFF_PROMPT} onSend={onStart} />}
      {started && awaitingRevoke && <ChatComposer defaultValue="Revoke access" onSend={onRevoke} />}
    </div>
  );
}
