import type { MarineSeries, TideExtreme } from "./types";

const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_JD = 2451550.09766;
const DAY_MS = 86_400_000;
const RAD = Math.PI / 180;

export interface MoonInfo {
  ageDays: number;
  illumination: number;
  phaseFraction: number;
  phaseName: string;
  phaseIcon: string;
  lunationLengthDays: number;
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

function julianDate(date: Date): number {
  return date.getTime() / DAY_MS + 2440587.5;
}

function dateFromJulian(jd: number): Date {
  return new Date((jd - 2440587.5) * DAY_MS);
}

function lunationJulianDate(lunation: number, phase: 0 | 0.5): number {
  const k = lunation + phase;
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const jde =
    KNOWN_NEW_MOON_JD +
    SYNODIC_MONTH_DAYS * k +
    0.00015437 * t2 -
    0.00000015 * t3 +
    0.00000000073 * t4;
  const e = 1 - 0.002516 * t - 0.0000074 * t2;
  const m = (2.5534 + 29.1053567 * k - 0.0000014 * t2 - 0.00000011 * t3) * RAD;
  const mp =
    (201.5643 + 385.81693528 * k + 0.0107582 * t2 + 0.00001238 * t3 - 0.000000058 * t4) *
    RAD;
  const f =
    (160.7108 + 390.67050284 * k - 0.0016118 * t2 - 0.00000227 * t3 + 0.000000011 * t4) *
    RAD;
  const omega = (124.7746 - 1.56375588 * k + 0.0020672 * t2 + 0.00000215 * t3) * RAD;
  const correction =
    -0.4067 * Math.sin(mp) +
    0.1727 * e * Math.sin(m) +
    0.0161 * Math.sin(2 * mp) +
    0.0104 * Math.sin(2 * f) +
    0.0073 * e * Math.sin(mp - m) -
    0.0051 * e * Math.sin(mp + m) +
    0.0021 * e * e * Math.sin(2 * m) -
    0.0011 * Math.sin(mp - 2 * f) -
    0.0006 * Math.sin(mp + 2 * f) +
    0.0006 * e * Math.sin(2 * mp + m) -
    0.0004 * Math.sin(3 * mp) +
    0.0004 * e * Math.sin(m + 2 * f) +
    0.0004 * e * Math.sin(m - 2 * f) -
    0.0002 * e * Math.sin(2 * mp - m) -
    0.0002 * Math.sin(omega);

  return jde + correction - 69 / 86_400;
}

function lunationIndexNear(jd: number): number {
  return Math.floor((jd - KNOWN_NEW_MOON_JD) / SYNODIC_MONTH_DAYS);
}

function lunationAround(jd: number) {
  let k = lunationIndexNear(jd);
  while (lunationJulianDate(k, 0) > jd) k -= 1;
  while (lunationJulianDate(k + 1, 0) <= jd) k += 1;
  return {
    index: k,
    previousNew: lunationJulianDate(k, 0),
    full: lunationJulianDate(k, 0.5),
    nextNew: lunationJulianDate(k + 1, 0),
  };
}

function nextLunarEvent(jd: number, phase: 0 | 0.5): Date {
  const start = lunationIndexNear(jd) - 1;
  for (let i = 0; i < 6; i += 1) {
    const candidate = lunationJulianDate(start + i, phase);
    if (candidate >= jd) return dateFromJulian(candidate);
  }
  return dateFromJulian(lunationJulianDate(start + 6, phase));
}

function strongTideCandidates(jd: number, phase: 0 | 0.5, basis: MoonInfo["strongTideBasis"]) {
  const start = lunationIndexNear(jd) - 2;
  return Array.from({ length: 8 }, (_, i) => ({
    basis,
    time: dateFromJulian(lunationJulianDate(start + i, phase) + 1.5),
  }));
}

function phaseLabel(fraction: number): { name: string; icon: string } {
  if (fraction < 0.02 || fraction >= 0.98) return { name: "nouvelle lune", icon: "●" };
  if (fraction < 0.235) return { name: "premier croissant", icon: "◔" };
  if (fraction < 0.265) return { name: "premier quartier", icon: "◐" };
  if (fraction < 0.48) return { name: "lune gibbeuse croissante", icon: "◕" };
  if (fraction < 0.52) return { name: "pleine lune", icon: "○" };
  if (fraction < 0.735) return { name: "lune gibbeuse décroissante", icon: "◕" };
  if (fraction < 0.765) return { name: "dernier quartier", icon: "◑" };
  if (fraction < 0.98) return { name: "dernier croissant", icon: "◔" };
  return { name: "nouvelle lune", icon: "●" };
}

export function moonInfo(date: Date): MoonInfo {
  const jd = julianDate(date);
  const lunation = lunationAround(jd);
  const lunationLengthDays = lunation.nextNew - lunation.previousNew;
  const ageDays = jd - lunation.previousNew;
  const phaseFraction = ageDays / lunationLengthDays;
  const nextFullMoon = nextLunarEvent(jd, 0.5);
  const nextNewMoon = nextLunarEvent(jd, 0);
  const nextStrong = [
    ...strongTideCandidates(jd, 0.5, "pleine lune"),
    ...strongTideCandidates(jd, 0, "nouvelle lune"),
  ]
    .filter((candidate) => candidate.time.getTime() >= date.getTime())
    .sort((a, b) => a.time.getTime() - b.time.getTime())[0];
  const phase = phaseLabel(phaseFraction);

  return {
    ageDays: Math.round(ageDays * 10) / 10,
    illumination: Math.round(((1 - Math.cos(2 * Math.PI * phaseFraction)) / 2) * 1000) / 10,
    phaseFraction,
    phaseName: phase.name,
    phaseIcon: phase.icon,
    lunationLengthDays: Math.round(lunationLengthDays * 10) / 10,
    nextFullMoon,
    nextNewMoon,
    nextStrongTideWindow: nextStrong.time,
    strongTideBasis: nextStrong.basis,
  };
}
