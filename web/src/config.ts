// Le Pouliguen, port entrance area.
export const LAT = 47.2769;
export const LON = -2.4292;
export const TZ = "Europe/Paris";

export const OPEN_METEO_FORECAST =
  `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
  `&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code` +
  `&hourly=temperature_2m,precipitation_probability,weather_code` +
  `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code,uv_index_max` +
  `&timezone=${encodeURIComponent(TZ)}&forecast_days=8`;

export const OPEN_METEO_MARINE =
  `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}` +
  `&hourly=wave_height,sea_surface_temperature` +
  `&minutely_15=sea_level_height_msl` +
  `&cell_selection=sea` +
  `&timezone=${encodeURIComponent(TZ)}&past_days=1&forecast_days=2`;

/** Day after `dateYmd`, computed in UTC so a DST boundary cannot shift it. */
function nextYmd(dateYmd: string): string {
  const [year, month, day] = dateYmd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function openMeteoMarineForDate(dateYmd: string): string {
  // The window runs through the following day so the evening still has a next
  // tide to show. SHOM events are filtered down to the days this series covers,
  // and nextExtremes returns nothing once the day's last tide has passed, so a
  // single-day window left the headline tide card showing a past tide from
  // roughly 21:00 until midnight.
  return (
    `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}` +
    `&hourly=wave_height,sea_surface_temperature` +
    `&minutely_15=sea_level_height_msl` +
    `&cell_selection=sea` +
    `&timezone=${encodeURIComponent(TZ)}` +
    `&start_date=${dateYmd}&end_date=${nextYmd(dateYmd)}`
  );
}

const RT_BASE = "https://proxy.transport.data.gouv.fr/resource";
export const GTFS_RT_VEHICLES = `${RT_BASE}/lila-presquile-cap-atlantique-gtfs-rt-vehicle-position`;
export const GTFS_RT_TRIP_UPDATES = `${RT_BASE}/lila-presquile-cap-atlantique-gtfs-rt-trip-update`;
export const GTFS_RT_ALERTS = `${RT_BASE}/lila-presquile-cap-atlantique-gtfs-rt-service-alert`;

export const TRANSIT_DATA_URL = `${import.meta.env.BASE_URL}data/transit.json`;
export const EVENTS_DATA_URL = `${import.meta.env.BASE_URL}data/events.json`;
export const CINEMA_PAX_DATA_URL = `${import.meta.env.BASE_URL}data/cinema-pax.json`;
export const SHOM_TIDES_DATA_URL = `${import.meta.env.BASE_URL}data/shom-tides.json`;

export const VEHICLES_REFRESH_MS = 20_000;
export const TRIP_UPDATES_REFRESH_MS = 30_000;
export const WEATHER_REFRESH_MS = 10 * 60_000;
