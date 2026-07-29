import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import {
  GTFS_RT_ALERTS,
  GTFS_RT_TRIP_UPDATES,
  GTFS_RT_VEHICLES,
  TRANSIT_DATA_URL,
  TZ,
} from "../config";
import type {
  NextDeparture,
  Service,
  ServiceAlert,
  TransitData,
  Vehicle,
} from "./types";

export async function loadTransitData(): Promise<TransitData> {
  const res = await fetch(TRANSIT_DATA_URL);
  if (!res.ok) throw new Error(`transit data HTTP ${res.status}`);
  const data = await res.json();
  data.fetchedAt = new Date();
  return data;
}

/** Current date and time in the Europe/Paris service day. */
export function parisNow(now = new Date()): {
  dateYmd: string;
  weekday: number; // 0 = Monday .. 6 = Sunday, GTFS calendar order
  seconds: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    dateYmd: `${get("year")}${get("month")}${get("day")}`,
    weekday: weekdayNames.indexOf(get("weekday")),
    seconds:
      Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")),
  };
}

function serviceActiveOn(
  service: Service | undefined,
  exceptions: Record<string, number> | undefined,
  dateYmd: string,
  weekday: number,
): boolean {
  const exception = exceptions?.[dateYmd];
  if (exception === 1) return true;
  if (exception === 2) return false;
  if (!service) return false;
  return (
    service.start <= dateYmd && dateYmd <= service.end && service.days[weekday] === 1
  );
}

/**
 * Next scheduled departures across the given stop ids. When today's service
 * is over, tomorrow's first departures fill the list (marked `tomorrow`).
 * Delay info from GTFS-RT trip updates is merged in for today only.
 */
export function nextDepartures(
  data: TransitData,
  stopIds: string[],
  delays: Map<string, number>,
  count = 6,
  now = new Date(),
): NextDeparture[] {
  const stopNames = new Map(data.stops.map((s) => [s.id, s.name]));
  const nowSeconds = parisNow(now).seconds;
  const out: NextDeparture[] = [];
  for (const dayOffset of [0, 1]) {
    if (out.length >= count) break;
    const ref = new Date(now.getTime() + dayOffset * 86_400_000);
    const { dateYmd, weekday } = parisNow(ref);
    const day: NextDeparture[] = [];
    for (const stopId of stopIds) {
      for (const dep of data.departures[stopId] ?? []) {
        if (
          !serviceActiveOn(
            data.services[dep.service],
            data.serviceExceptions[dep.service],
            dateYmd,
            weekday,
          )
        ) {
          continue;
        }
        const delay = dayOffset === 0 ? (delays.get(dep.trip) ?? null) : null;
        const effectiveSeconds = dep.t + (delay ?? 0);
        if (dayOffset === 0 && effectiveSeconds < nowSeconds - 60) continue;
        const deltaSeconds =
          dayOffset === 0
            ? effectiveSeconds - nowSeconds
            : 86_400 - nowSeconds + effectiveSeconds;
        const route = data.routes[dep.route];
        day.push({
          time: new Date(now.getTime() + deltaSeconds * 1000),
          scheduledSeconds: dep.t,
          trip: dep.trip,
          routeShort: route?.shortName ?? dep.route,
          routeColor: route?.color ?? null,
          headsign: dep.headsign,
          stopName: stopNames.get(stopId) ?? stopId,
          delaySeconds: delay,
          tomorrow: dayOffset === 1,
        });
      }
    }
    day.sort((a, b) => a.time.getTime() - b.time.getTime());
    out.push(...day.slice(0, count - out.length));
  }
  return out;
}

export async function fetchGtfsRtFeed(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GTFS-RT HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
}

const fetchFeed = fetchGtfsRtFeed;

/** trip_id -> current delay in seconds (latest stop_time_update wins). */
export async function fetchTripDelays(): Promise<Map<string, number>> {
  const feed = await fetchFeed(GTFS_RT_TRIP_UPDATES);
  const delays = new Map<string, number>();
  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;
    let delay: number | null =
      typeof tu.delay === "number" && tu.delay !== 0 ? tu.delay : null;
    for (const stu of tu.stopTimeUpdate ?? []) {
      const d = stu.departure?.delay ?? stu.arrival?.delay;
      if (typeof d === "number") delay = d;
    }
    if (delay !== null) delays.set(tripId, delay);
  }
  return delays;
}

export async function fetchVehicles(data: TransitData): Promise<Vehicle[]> {
  const feed = await fetchFeed(GTFS_RT_VEHICLES);
  const out: Vehicle[] = [];
  for (const entity of feed.entity) {
    const v = entity.vehicle;
    const pos = v?.position;
    if (!v || !pos) continue;
    const tripId = v.trip?.tripId ?? "";
    const routeId = v.trip?.routeId ?? data.trips[tripId]?.route ?? "";
    const route = data.routes[routeId];
    out.push({
      id: entity.id ?? tripId,
      tripId,
      lat: pos.latitude,
      lon: pos.longitude,
      routeShort: route?.shortName ?? routeId,
      routeLongName: route?.longName ?? "",
      routeColor: route?.color ?? null,
      headsign: data.trips[tripId]?.headsign ?? "",
      timestamp:
        v.timestamp && Number(v.timestamp) > 0
          ? new Date(Number(v.timestamp) * 1000)
          : null,
    });
  }
  return out;
}

export async function fetchServiceAlerts(): Promise<ServiceAlert[]> {
  const feed = await fetchFeed(GTFS_RT_ALERTS);
  const out: ServiceAlert[] = [];
  const text = (t?: { translation?: { text?: string | null }[] | null } | null) =>
    t?.translation?.find((x) => x.text)?.text ?? "";
  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert) continue;
    const header = text(alert.headerText);
    const description = text(alert.descriptionText);
    if (header || description) out.push({ header, description });
  }
  return out;
}

/** Group stops by display name so one choice covers both directions. */
export function stopGroups(data: TransitData): { name: string; ids: string[] }[] {
  const byName = new Map<string, string[]>();
  for (const s of data.stops) {
    const key = s.name.trim();
    byName.set(key, [...(byName.get(key) ?? []), s.id]);
  }
  return [...byName.entries()]
    .map(([name, ids]) => ({ name, ids }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}
