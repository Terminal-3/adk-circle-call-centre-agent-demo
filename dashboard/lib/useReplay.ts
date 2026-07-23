// The replay "engine": a React hook that steps through REPLAY_BEATS (from
// lib/replay-data.ts) on a timer, entirely in local browser state -- no
// fetch calls, no server. This is what app/page.tsx's ReplayHome calls to
// get the events/ledger/narration it renders, and what AgentChat's
// start()/onRevoke() hooks into to advance the script. See replay-data.ts
// if you want to change what actually plays back.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REPLAY_BEATS, REPLAY_KICKOFF_TS, REPLAY_POLICY, ledgerEntryFromEvent, type ProviderCandidate, type ReplayEvent } from "./replay-data";
import type { LedgerEntry, LedgerSnapshot } from "./t3n";

const EVENT_STEP_MS = 700;

export interface ReplayComparison {
  candidates: ProviderCandidate[];
  selectedHost: string;
  reason: string;
}

export interface ReplayState {
  ledger: LedgerSnapshot;
  events: ReplayEvent[];
  narration: string;
  comparison: ReplayComparison | null;
  started: boolean;
  awaitingRevoke: boolean;
  finished: boolean;
  start: (text: string) => void;
  triggerRevoke: (replyText?: string) => void;
  restart: () => void;
}

/**
 * Steps through REPLAY_BEATS on a timer, entirely in local React state.
 * No fetch calls, no server state -- safe on Vercel's serverless functions,
 * where the previous MOCK_T3N globalThis approach isn't guaranteed to
 * persist across invocations.
 */
export function useReplay(): ReplayState {
  const [beatIndex, setBeatIndex] = useState(0);
  const [eventIndex, setEventIndex] = useState(0);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [comparison, setComparison] = useState<ReplayComparison | null>(null);
  const [started, setStarted] = useState(false);
  const [awaitingRevoke, setAwaitingRevoke] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [finished, setFinished] = useState(false);
  const seqRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const restart = useCallback(() => {
    clearTimer();
    setBeatIndex(0);
    setEventIndex(0);
    setEvents([]);
    setEntries([]);
    setComparison(null);
    setStarted(false);
    setAwaitingRevoke(false);
    setRevoked(false);
    setFinished(false);
    seqRef.current = 0;
  }, [clearTimer]);

  // Nothing plays until the visitor sends this -- it's what they typed (or
  // left as the pre-filled suggestion) in the chat panel's composer.
  const start = useCallback((text: string) => {
    setEvents([{ ts: REPLAY_KICKOFF_TS, type: "user_reply", text }]);
    setStarted(true);
  }, []);

  // A reply typed in the chat panel while paused also lands in the shared
  // event stream (as "user_reply") -- so it shows up in the Activity Feed
  // too, not just the chat. The plain dashboard button calls this with no
  // text, which skips adding a reply bubble.
  const triggerRevoke = useCallback((replyText?: string) => {
    if (replyText) {
      setEvents((prev) => [...prev, { ts: prev[prev.length - 1]?.ts ?? REPLAY_KICKOFF_TS, type: "user_reply", text: replyText }]);
    }
    setRevoked(true);
    setAwaitingRevoke(false);
    setBeatIndex((i) => i + 1);
    setEventIndex(0);
  }, []);

  useEffect(() => {
    if (!started || awaitingRevoke || finished) return;
    const beat = REPLAY_BEATS[beatIndex];
    if (!beat) {
      setFinished(true);
      return;
    }

    if (eventIndex < beat.events.length) {
      timeoutRef.current = setTimeout(() => {
        const event = beat.events[eventIndex];
        setEvents((prev) => [...prev, event]);
        if (event.type === "comparing_providers" && event.candidates && event.selectedHost) {
          setComparison({ candidates: event.candidates, selectedHost: event.selectedHost, reason: String(event.reason ?? "") });
        }
        const entry = ledgerEntryFromEvent(event, ++seqRef.current);
        if (entry) setEntries((prev) => [...prev, entry]);
        setEventIndex((i) => i + 1);
      }, EVENT_STEP_MS);
      return clearTimer;
    }

    // All events for this beat have played -- hold, then advance or pause.
    timeoutRef.current = setTimeout(() => {
      if (beat.pauseForRevoke) {
        setAwaitingRevoke(true);
      } else {
        setBeatIndex((i) => i + 1);
        setEventIndex(0);
      }
    }, beat.holdMs);
    return clearTimer;
  }, [started, beatIndex, eventIndex, awaitingRevoke, finished, clearTimer]);

  const runningTotal = entries.filter((e) => e.status === "paid").reduce((sum, e) => sum + e.amount_usdc, 0);
  const currentBeat = REPLAY_BEATS[Math.min(beatIndex, REPLAY_BEATS.length - 1)];

  return {
    ledger: {
      running_total: runningTotal,
      session_budget: REPLAY_POLICY.session_budget,
      per_call_cap: REPLAY_POLICY.per_call_cap,
      host_allowlist: REPLAY_POLICY.host_allowlist,
      entries,
      revoked,
    },
    events,
    narration: currentBeat?.narration ?? "",
    comparison,
    started,
    awaitingRevoke,
    finished,
    start,
    triggerRevoke,
    restart,
  };
}
