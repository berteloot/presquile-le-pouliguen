import type { MarineSeries, TideExtreme } from "./types";

/**
 * Detect tide extrema from the modeled sea-level series (15-minute steps).
 * A point is an extreme when it is higher (or lower) than both neighbors;
 * a parabola through the three points refines the time and level below the
 * sampling resolution. The refinement uses the actual sample spacing.
 */
export function findExtrema(series: MarineSeries): TideExtreme[] {
  const { times, seaLevel } = series;
  const out: TideExtreme[] = [];
  for (let i = 1; i < seaLevel.length - 1; i++) {
    const prev = seaLevel[i - 1];
    const cur = seaLevel[i];
    const next = seaLevel[i + 1];
    if (prev == null || cur == null || next == null) continue;
    const isHigh = cur >= prev && cur > next;
    const isLow = cur <= prev && cur < next;
    if (!isHigh && !isLow) continue;
    const stepMs = times[i + 1].getTime() - times[i].getTime();
    const denom = prev - 2 * cur + next;
    const offset = denom !== 0 ? (0.5 * (prev - next)) / denom : 0;
    const refinedLevel = cur - 0.25 * (prev - next) * offset;
    const refinedTime = new Date(times[i].getTime() + offset * stepMs);
    out.push({
      type: isHigh ? "high" : "low",
      time: refinedTime,
      level: refinedLevel,
    });
  }
  return out;
}

export function nextExtremes(extrema: TideExtreme[], now: Date): TideExtreme[] {
  return extrema.filter((e) => e.time.getTime() > now.getTime());
}

export function currentTrend(
  series: MarineSeries,
  now: Date,
): "rising" | "falling" | null {
  const { times, seaLevel } = series;
  let idx = -1;
  for (let i = 0; i < times.length - 1; i++) {
    if (times[i].getTime() <= now.getTime() && now.getTime() < times[i + 1].getTime()) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const a = seaLevel[idx];
  const b = seaLevel[idx + 1];
  if (a == null || b == null) return null;
  return b > a ? "rising" : "falling";
}
