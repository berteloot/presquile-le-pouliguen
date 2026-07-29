import { OPEN_METEO_FORECAST, OPEN_METEO_MARINE, openMeteoMarineForDate } from "../config";
import type { MarineSeries, WeatherNow } from "./types";

export async function fetchWeather(): Promise<WeatherNow> {
  const res = await fetch(OPEN_METEO_FORECAST);
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
      tempMax: j.daily.temperature_2m_max[index],
      tempMin: j.daily.temperature_2m_min[index],
      weatherCode: j.daily.weather_code[index],
      uvMax: j.daily.uv_index_max[index],
    })),
    fetchedAt: new Date(),
  };
}

async function fetchMarineUrl(url: string): Promise<MarineSeries> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`marine HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`marine API ${j.reason ?? "error"}`);
  // Sea level rides on the 15-minute series for tide-time precision; waves
  // and water temperature stay hourly. Both series carry their own times.
  return {
    times: j.minutely_15.time.map((t: string) => new Date(t)),
    seaLevel: j.minutely_15.sea_level_height_msl,
    hourlyTimes: j.hourly.time.map((t: string) => new Date(t)),
    waveHeight: j.hourly.wave_height,
    seaTemp: j.hourly.sea_surface_temperature,
    fetchedAt: new Date(),
  };
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
