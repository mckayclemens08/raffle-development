"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

/// Tobique's responsible-gambling rules require session-time alerts at defined
/// intervals and an enforced break after four continuous hours of play.
///
/// The break is a client-side interruption: it can't stop someone calling the
/// contract directly, and it isn't meant to. Its job is to interrupt the person
/// who has lost track of time, and that person is using the website.
const ALERT_INTERVAL_MS = 60 * 60 * 1000; // hourly reality check
const MAX_SESSION_MS = 4 * 60 * 60 * 1000; // hard stop
const BREAK_MS = 15 * 60 * 1000; // required break length
const IDLE_RESET_MS = 30 * 60 * 1000; // away this long and it's a new session

const KEY_START = "session.startedAt";
const KEY_SEEN = "session.lastSeenAt";
const KEY_ALERTED = "session.alertedAt";
const KEY_BREAK = "session.breakUntil";

function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SessionGuard() {
  const { isConnected } = useAccount();
  const [elapsed, setElapsed] = useState(0);
  const [showAlert, setShowAlert] = useState(false);
  const [breakUntil, setBreakUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isConnected) return;

    function tick() {
      const t = Date.now();
      setNow(t);

      const storedBreak = Number(localStorage.getItem(KEY_BREAK) ?? 0);
      if (storedBreak > t) {
        setBreakUntil(storedBreak);
        return;
      }
      if (storedBreak && storedBreak <= t) {
        // Break served — start a fresh session.
        localStorage.removeItem(KEY_BREAK);
        localStorage.removeItem(KEY_ALERTED);
        localStorage.setItem(KEY_START, String(t));
        setBreakUntil(0);
      }

      const lastSeen = Number(localStorage.getItem(KEY_SEEN) ?? 0);
      let start = Number(localStorage.getItem(KEY_START) ?? 0);

      // A long gap counts as having stopped playing.
      if (!start || (lastSeen && t - lastSeen > IDLE_RESET_MS)) {
        start = t;
        localStorage.setItem(KEY_START, String(start));
        localStorage.removeItem(KEY_ALERTED);
      }
      localStorage.setItem(KEY_SEEN, String(t));

      const played = t - start;
      setElapsed(played);

      if (played >= MAX_SESSION_MS) {
        const until = t + BREAK_MS;
        localStorage.setItem(KEY_BREAK, String(until));
        setBreakUntil(until);
        return;
      }

      const alerted = Number(localStorage.getItem(KEY_ALERTED) ?? 0);
      const dueAt = Math.floor(played / ALERT_INTERVAL_MS);
      if (dueAt >= 1 && dueAt > alerted) {
        localStorage.setItem(KEY_ALERTED, String(dueAt));
        setShowAlert(true);
      }
    }

    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [isConnected]);

  if (!isConnected) return null;

  if (breakUntil > now) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/70 p-4">
        <div className="max-w-md rounded-xl bg-white p-6 text-center shadow-2xl">
          <h2 className="text-xl font-bold text-neutral-900">Time for a break</h2>
          <p className="mt-2 text-sm text-neutral-600">
            You&apos;ve been playing for four hours straight, so we&apos;re pausing your session — this is a
            requirement of our licence, not a suggestion.
          </p>
          <p className="mt-4 font-mono text-2xl font-semibold text-neutral-900">
            {fmtDuration(breakUntil - now)}
          </p>
          <p className="mt-1 text-xs text-neutral-500">until you can play again</p>
          <p className="mt-5 text-xs text-neutral-500">
            If gambling has stopped being fun,{" "}
            <a className="text-blue-600 underline" href="/responsible-gambling">
              here&apos;s where to get help
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  if (showAlert) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white p-4 shadow-lg">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-neutral-700">
            You&apos;ve been playing for <strong>{fmtDuration(elapsed)}</strong>. Still enjoying yourself?
          </p>
          <div className="flex gap-2">
            <a
              href="/responsible-gambling"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-100"
            >
              Set limits
            </a>
            <button
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"
              onClick={() => setShowAlert(false)}
            >
              Keep playing
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
