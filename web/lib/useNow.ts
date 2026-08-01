"use client";

import { useEffect, useState } from "react";

/// A clock that is safe to read during render.
///
/// Calling `Date.now()` in a component body makes the render impure: the server
/// and the client compute different values, so anything derived from it — a
/// countdown, a progress bar, "now" on a chart — hydrates mismatched. This
/// keeps the wall clock in state instead, so the first server render and the
/// first client render agree, and the value only advances on a tick.
///
/// Returns `null` until the first client tick; callers should render a neutral
/// placeholder for that frame rather than guessing a time.
export function useNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // Deliberately not called synchronously here — setting state in the effect
    // body triggers a cascading render. A zero-delay timeout lands in the same
    // frame for the user but keeps the effect body pure.
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [intervalMs]);

  return now;
}
