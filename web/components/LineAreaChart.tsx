"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useNow } from "@/lib/useNow";

// Chart chrome tokens (light surface) — series color validated against #ffffff.
const SERIES = "#2a78d6";
const GRID = "#e1e0d9";
const BASELINE = "#c3c2b7";
const MUTED = "#898781";
const INK = "#0b0b0b";
const SECONDARY = "#52514e";

export interface ChartPoint {
  /** Unix seconds. */
  timestamp: number;
  /** Value in display units (already divided out of token decimals). */
  value: number;
}

interface LineAreaChartProps {
  points: ChartPoint[];
  /** Extends the last value flat to "now" so the line reads as current. */
  extendToNow?: boolean;
  height?: number;
  formatValue: (value: number) => string;
  emptyLabel: string;
  ariaLabel: string;
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max * 1.001; v += step) ticks.push(v);
  return ticks;
}

function formatClock(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const PAD = { top: 14, right: 56, bottom: 22, left: 8 };

export function LineAreaChart({
  points,
  extendToNow = true,
  height = 180,
  formatValue,
  emptyLabel,
  ariaLabel,
}: LineAreaChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 640; // viewBox units; SVG scales to its container

  const now = useNow(30_000);

  const series = useMemo<ChartPoint[]>(() => {
    if (points.length === 0) return [];
    // Before the clock ticks, plot only real data rather than inventing a
    // "now" the server and client would disagree about.
    if (now === null) return points;
    const nowSec = Math.floor(now / 1000);
    const last = points[points.length - 1];
    if (extendToNow && nowSec > last.timestamp) {
      return [...points, { timestamp: nowSec, value: last.value }];
    }
    return points;
  }, [points, extendToNow, now]);

  const geometry = useMemo(() => {
    if (series.length === 0) return null;
    const t0 = series[0].timestamp;
    const t1 = series[series.length - 1].timestamp;
    const span = Math.max(1, t1 - t0);
    const maxValue = Math.max(...series.map((p) => p.value));
    const ticks = niceTicks(maxValue);
    const yMax = Math.max(ticks[ticks.length - 1], maxValue) || 1;

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const x = (ts: number) => PAD.left + ((ts - t0) / span) * plotW;
    const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

    // Continuous line through every point, stock-chart style.
    let d = `M ${x(series[0].timestamp)} ${y(series[0].value)}`;
    for (let i = 1; i < series.length; i++) {
      d += ` L ${x(series[i].timestamp)} ${y(series[i].value)}`;
    }
    const baselineY = PAD.top + plotH;
    const area = `${d} V ${baselineY} H ${x(series[0].timestamp)} Z`;

    return { x, y, ticks, yMax, plotW, plotH, baselineY, path: d, area, t0, t1 };
  }, [series, height]);

  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!geometry || !svgRef.current || series.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * width;
      // Snap the crosshair to the nearest data x — readers aim at a time, not a 2px line.
      let nearest = 0;
      let best = Infinity;
      series.forEach((p, i) => {
        const dx = Math.abs(geometry.x(p.timestamp) - px);
        if (dx < best) {
          best = dx;
          nearest = i;
        }
      });
      setHoverIndex(nearest);
    },
    [geometry, series]
  );

  if (!geometry || series.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-neutral-200 text-sm text-neutral-400"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const hover = hoverIndex !== null ? series[Math.min(hoverIndex, series.length - 1)] : null;
  const last = series[series.length - 1];

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={handlePointer}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {geometry.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right + 8}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              stroke={tick === 0 ? BASELINE : GRID}
              strokeWidth={1}
            />
            <text
              x={width - PAD.right + 12}
              y={geometry.y(tick) + 3.5}
              fontSize={11}
              fill={MUTED}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        <path d={geometry.area} fill={SERIES} fillOpacity={0.1} />
        <path d={geometry.path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* Current-value end marker: 8px dot with a 2px surface ring */}
        <circle cx={geometry.x(last.timestamp)} cy={geometry.y(last.value)} r={6} fill="#ffffff" />
        <circle cx={geometry.x(last.timestamp)} cy={geometry.y(last.value)} r={4} fill={SERIES} />

        {hover && (
          <g>
            <line
              x1={geometry.x(hover.timestamp)}
              x2={geometry.x(hover.timestamp)}
              y1={PAD.top}
              y2={geometry.baselineY}
              stroke={BASELINE}
              strokeWidth={1}
            />
            <circle cx={geometry.x(hover.timestamp)} cy={geometry.y(hover.value)} r={6} fill="#ffffff" />
            <circle cx={geometry.x(hover.timestamp)} cy={geometry.y(hover.value)} r={4} fill={SERIES} />
          </g>
        )}

        <text x={PAD.left} y={height - 6} fontSize={11} fill={MUTED}>
          {formatClock(geometry.t0)}
        </text>
        <text x={width - PAD.right} y={height - 6} fontSize={11} fill={MUTED} textAnchor="end">
          now
        </text>
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm"
          style={{
            left: `${(geometry.x(hover.timestamp) / width) * 100}%`,
            transform: geometry.x(hover.timestamp) > width * 0.6 ? "translateX(-108%)" : "translateX(8px)",
          }}
        >
          <p className="text-sm font-semibold" style={{ color: INK }}>
            {formatValue(hover.value)}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: SECONDARY }}>
            {formatClock(hover.timestamp)}
          </p>
        </div>
      )}
    </div>
  );
}
