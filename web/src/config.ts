// Le Pouliguen, port entrance area.
export const LAT = 47.2769;
export const LON = -2.4292;
export const TZ = "Europe/Paris";

export const OPEN_METEO_FORECAST =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code` +
  `&hourly=temperature_2m,precipitation_probability,weather_code` +
  `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,uv_index_max` +
  `&timezone=${encodeURIComponent(TZ)}&forecast_days=2`;

export const OPEN_METEO_MARINE =
  `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}` +
  `&hourly=wave_height,sea_surface_temperature` +
  `&minutely_15=sea_level_height_msl` +
  `&cell_selection=sea` +
  `&timezone=${encodeURIComponent(TZ)}&past_days=1&forecast_days=2`;

export function openMeteoMarineForDate(dateYmd: string): string {
  return (
    `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}` +
    `&hourly=wave_height,sea_surface_temperature` +
    `&minutely_15=sea_level_height_msl` +
    `&cell_selection=sea` +
    `&timezone=${encodeURIComponent(TZ)}` +
    `&start_date=${dateYmd}&end_date=${dateYmd}`
  );
}

const RT_BASE = "https://proxy.transport.data.gouv.fr/resource";
export const GTFS_RT_VEHICLES = `${RT_BASE}/lila-presquile-cap-atlantique-gtfs-rt-vehicle-position`;
export const GTFS_RT_TRIP_UPDATES = `${RT_BASE}/lila-presquile-cap-atlantique-gtfs-rt-trip-update`;
export const GTFS_RT_ALERTS = `${RT_BASE}/lila-presquile-cap-atlantique-gtfs-rt-service-alert`;

export const TRANSIT_DATA_URL = `${import.meta.env.BASE_URL}data/transit.json`;
export const EVENTS_DATA_URL = `${import.meta.env.BASE_URL}data/events.json`;

export const VEHICLES_REFRESH_MS = 20_000;
export const TRIP_UPDATES_REFRESH_MS = 30_000;
export const WEATHER_REFRESH_MS = 10 * 60_000;
