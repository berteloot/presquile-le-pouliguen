import {
  OPEN_METEO_FORECAST,
  OPEN_METEO_MARINE,
  SHOM_TIDES_DATA_URL,
  openMeteoMarineForDate,
} from "../config";
import type { MarineSeries, TideExtreme, WeatherNow } from "./types";
import { fetchWithTimeout } from "./net";

interface ShomTideCache {
  generatedAt: string;
  sourceMode: "not-configured" | "shom-cache";
  harbor: {
    cst: string;
    name: string;
  };
  events: {
    type: "high" | "low";
    time: string;
    heightM?: number | null;
    coefficient?: number | null;
  }[];
}

let shomCachePromise: Promise<ShomTideCache | null> | null = null;

export async function fetchWeather(): Promise<WeatherNow> {
  const res = await fetchWithTimeout(OPEN_METEO_FORECAST);
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  const j = await res.json();
  return {
    temperature: j.current.temperature_2m,
    apparent: j.current.apparent_temperature,
    windSpeed: j.current.wind_speed_10m,
    windGusts: j.current.wind_gusts_10m,
    windDirection: j.current.wind_direction_10m,
    precipitation: j.current.precipitation,
    weatherCode: j.current.weather_code,
    sunrise: new Date(j.daily.sunrise[0]),
    sunset: new Date(j.daily.sunset[0]),
    tempMax: j.daily.temperature_2m_max[0],
    tempMin: j.daily.temperature_2m_min[0],
    uvMax: j.daily.uv_index_max[0],
    daily: j.daily.time.map((time: string, index: number) => ({
      date: new Date(time),
      sunrise: new Date(j.daily.sunrise[index]),
      sunset: new Date(j.daily.sunset[index]),
      tempMax: j.daily.temperature_2m_max[index],
      tempMin: j.daily.temperature_2m_min[index],
      weatherCode: j.daily.weather_code[index],
      uvMax: j.daily.uv_index_max[index],
    })),
    fetchedAt: new Date(),
  };
}

async function fetchMarineUrl(url: string): Promise<MarineSeries> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`marine HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`marine API ${j.reason ?? "error"}`);
  // Sea level rides on the 15-minute series for tide-time precision; waves
  // and water temperature stay hourly. Both series carry their own times.
  const series: MarineSeries = {
    times: j.minutely_15.time.map((t: string) => new Date(t)),
    seaLevel: j.minutely_15.sea_level_height_msl,
    hourlyTimes: j.hourly.time.map((t: string) => new Date(t)),
    waveHeight: j.hourly.wave_height,
    seaTemp: j.hourly.sea_surface_temperature,
    tideSource: "open-meteo",
    tideSourceLabel: "Open-Meteo Marine",
    fetchedAt: new Date(),
  };
  return applyShomTideCache(series);
}

export async function fetchMarine(): Promise<MarineSeries> {
  return fetchMarineUrl(OPEN_METEO_MARINE);
}

export async function fetchMarineForDate(dateYmd: string): Promise<MarineSeries> {
  return fetchMarineUrl(openMeteoMarineForDate(dateYmd));
}

const WMO_LABELS: Record<number, string> = {
  0: "Ciel clair",
  1: "Plutôt dégagé",
  2: "Partiellement nuageux",
  3: "Couvert",
  45: "Brouillard",
  48: "Brouillard givrant",
  51: "Bruine légère",
  53: "Bruine",
  55: "Bruine forte",
  61: "Pluie légère",
  63: "Pluie",
  65: "Pluie forte",
  66: "Pluie verglaçante",
  67: "Pluie verglaçante forte",
  71: "Neige légère",
  73: "Neige",
  75: "Neige forte",
  80: "Averses légères",
  81: "Averses",
  82: "Averses fortes",
  95: "Orage",
  96: "Orage avec grêle",
  99: "Orage avec forte grêle",
};

export function weatherLabel(code: number): string {
  return WMO_LABELS[code] ?? "Conditions inconnues";
}

export function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

const DIRECTIONS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO",
];

export function windDirectionLabel(deg: number): string {
  return DIRECTIONS[Math.round(deg / 22.5) % 16];
}

async function fetchShomTideCache(): Promise<ShomTideCache | null> {
  if (!shomCachePromise) {
    shomCachePromise = fetchWithTimeout(`${SHOM_TIDES_DATA_URL}?t=${Date.now()}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return shomCachePromise;
}

function parisDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function interpolateSeaLevel(series: MarineSeries, time: Date): number | null {
  const target = time.getTime();
  for (let i = 0; i < series.times.length - 1; i++) {
    const aTime = series.times[i].getTime();
    const bTime = series.times[i + 1].getTime();
    if (target < aTime || target > bTime) continue;
    const a = series.seaLevel[i];
    const b = series.seaLevel[i + 1];
    if (a == null || b == null) return null;
    const ratio = (target - aTime) / (bTime - aTime || 1);
    return a + (b - a) * ratio;
  }
  return null;
}

async function applyShomTideCache(series: MarineSeries): Promise<MarineSeries> {
  const cache = await fetchShomTideCache();
  if (!cache || cache.sourceMode !== "shom-cache") return series;

  const availableDays = new Set(series.times.map(parisDateKey));
  const tideExtrema: TideExtreme[] = cache.events
    .map((event) => {
      const time = new Date(event.time);
      return {
        type: event.type,
        time,
        level: interpolateSeaLevel(series, time) ?? event.heightM ?? 0,
        coefficient: event.coefficient ?? null,
        officialHeightM: event.heightM ?? null,
        source: "shom" as const,
      };
    })
    .filter((event) => availableDays.has(parisDateKey(event.time)))
    .sort((a, b) => a.time.getTime() - b.time.getTime());

  if (tideExtrema.length === 0) return series;
  return {
    ...series,
    tideSource: "shom",
    tideSourceLabel: `SHOM ${cache.harbor.name}`,
    tideGeneratedAt: new Date(cache.generatedAt),
    tideExtrema,
  };
}
