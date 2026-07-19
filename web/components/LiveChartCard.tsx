"use client";

import { useMemo, useState } from "react";
import { LineAreaChart, type ChartPoint } from "./LineAreaChart";

const RANGES: { label: string; seconds: number | null }[] = [
  { label: "1H", seconds: 60 * 60 },
  { label: "24H", seconds: 24 * 60 * 60 },
  { label: "7D", seconds: 7 * 24 * 60 * 60 },
  { label: "30D", seconds: 30 * 24 * 60 * 60 },
  { label: "All", seconds: null },
];

/// Trims the series to the selected window. If everything predates the window,
/// the last known value is carried forward from the window's left edge so the
/// line still reads as "flat at the current level" rather than vanishing.
function clampToRange(points: ChartPoint[], seconds: number | null): ChartPoint[] {
  if (seconds === null || points.length === 0) return points;
  const cutoff = Math.floor(Date.now() / 1000) - seconds;
  const inRange = points.filter((p) => p.timestamp >= cutoff);
  const before = points.filter((p) => p.timestamp < cutoff);
  const anchor = before.length > 0 ? [{ timestamp: cutoff, value: before[before.length - 1].value }] : [];
  return [...anchor, ...inRange];
}

interface LiveChartCardProps {
  label: string;
  value: string;
  points: ChartPoint[];
  formatValue: (value: number) => string;
  emptyLabel: string;
  ariaLabel: string;
}

export function LiveChartCard({ label, value, points, formatValue, emptyLabel, ariaLabel }: LiveChartCardProps) {
  const [rangeSeconds, setRangeSeconds] = useState<number | null>(null);
  const filtered = useMemo(() => clampToRange(points, rangeSeconds), [points, rangeSeconds]);

  return (
    <div className="rounded-xl border border-neutral-200 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-neutral-500">{label}</p>
          <p className="mt-1 text-3xl font-semibold text-neutral-900">{value}</p>
        </div>
        <div className="flex rounded-lg border border-neutral-200 p-0.5" role="group" aria-label="Chart time range">
          {RANGES.map((range) => {
            const selected = range.seconds === rangeSeconds;
            return (
              <button
                key={range.label}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  selected ? "bg-blue-600 text-white" : "text-neutral-500 hover:text-neutral-900"
                }`}
                aria-pressed={selected}
                onClick={() => setRangeSeconds(range.seconds)}
              >
                {range.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4">
        <LineAreaChart points={filtered} formatValue={formatValue} emptyLabel={emptyLabel} ariaLabel={ariaLabel} />
      </div>
    </div>
  );
}
