import type { MarineSeries, TideExtreme } from "./types";

const SYNODIC_MONTH_DAYS = 29.530588853;
const NEW_MOON_EPOCH_UTC = Date.UTC(2000, 0, 6, 18, 14);
const DAY_MS = 86_400_000;

export interface MoonInfo {
  ageDays: number;
  illumination: number;
  phaseName: string;
  phaseIcon: string;
  nextFullMoon: Date;
  nextNewMoon: Date;
  nextStrongTideWindow: Date;
  strongTideBasis: "pleine lune" | "nouvelle lune";
}

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

function daysSinceEpoch(date: Date): number {
  return (date.getTime() - NEW_MOON_EPOCH_UTC) / DAY_MS;
}

function normalizedMoonAge(date: Date): number {
  const age = daysSinceEpoch(date) % SYNODIC_MONTH_DAYS;
  return age < 0 ? age + SYNODIC_MONTH_DAYS : age;
}

function nextMoonMoment(date: Date, targetAge: number): Date {
  const age = normalizedMoonAge(date);
  let daysUntil = targetAge - age;
  if (daysUntil <= 0) daysUntil += SYNODIC_MONTH_DAYS;
  return new Date(date.getTime() + daysUntil * DAY_MS);
}

function strongTideCandidates(date: Date, targetAge: number, basis: MoonInfo["strongTideBasis"]) {
  const age = normalizedMoonAge(date);
  return [-1, 0, 1, 2].map((cycle) => {
    const moonMoment = new Date(
      date.getTime() + (targetAge - age + cycle * SYNODIC_MONTH_DAYS) * DAY_MS,
    );
    return {
      basis,
      time: new Date(moonMoment.getTime() + 36 * 60 * 60 * 1000),
    };
  });
}

function phaseLabel(ageDays: number): { name: string; icon: string } {
  if (ageDays < 1.85) return { name: "nouvelle lune", icon: "●" };
  if (ageDays < 5.54) return { name: "premier croissant", icon: "◔" };
  if (ageDays < 9.23) return { name: "premier quartier", icon: "◐" };
  if (ageDays < 12.92) return { name: "lune gibbeuse croissante", icon: "◕" };
  if (ageDays < 16.61) return { name: "pleine lune", icon: "○" };
  if (ageDays < 20.3) return { name: "lune gibbeuse décroissante", icon: "◕" };
  if (ageDays < 23.99) return { name: "dernier quartier", icon: "◑" };
  if (ageDays < 27.68) return { name: "dernier croissant", icon: "◔" };
  return { name: "nouvelle lune", icon: "●" };
}

export function moonInfo(date: Date): MoonInfo {
  const ageDays = normalizedMoonAge(date);
  const fullAge = SYNODIC_MONTH_DAYS / 2;
  const nextFullMoon = nextMoonMoment(date, fullAge);
  const nextNewMoon = nextMoonMoment(date, 0);
  const nextStrong = [
    ...strongTideCandidates(date, fullAge, "pleine lune"),
    ...strongTideCandidates(date, 0, "nouvelle lune"),
  ]
    .filter((candidate) => candidate.time.getTime() >= date.getTime())
    .sort((a, b) => a.time.getTime() - b.time.getTime())[0];
  const phase = phaseLabel(ageDays);

  return {
    ageDays: Math.round(ageDays * 10) / 10,
    illumination: Math.round(((1 - Math.cos((2 * Math.PI * ageDays) / SYNODIC_MONTH_DAYS)) / 2) * 100),
    phaseName: phase.name,
    phaseIcon: phase.icon,
    nextFullMoon,
    nextNewMoon,
    nextStrongTideWindow: nextStrong.time,
    strongTideBasis: nextStrong.basis,
  };
}
