import { fetchGtfsRtFeed, parisNow } from "./transit";

const TRAINS_DATA_URL = `${import.meta.env.BASE_URL}data/trains.json`;
const SNCF_RT_TRIP_UPDATES =
  "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates";

interface TrainService {
  days: number[];
  start: string;
  end: string;
}

export interface TrainsData {
  generated: string;
  station: string;
  departures: {
    t: number;
    trip: string;
    service: string;
    dest: string;
    number: string;
    route: string;
  }[];
  services: Record<string, TrainService>;
  serviceExceptions: Record<string, Record<string, number>>;
  fetchedAt?: Date;
}

export interface TrainDeparture {
  time: Date;
  dest: string;
  number: string;
  route: string;
  trip: string;
  delaySeconds: number | null;
  isTgv: boolean;
  tomorrow: boolean;
}

export async function loadTrainsData(): Promise<TrainsData> {
  const res = await fetch(TRAINS_DATA_URL);
  if (!res.ok) throw new Error(`trains data HTTP ${res.status}`);
  const data = await res.json();
  data.fetchedAt = new Date();
  return data;
}

function serviceActive(
  data: TrainsData,
  serviceId: string,
  dateYmd: string,
  weekday: number,
): boolean {
  const exception = data.serviceExceptions[serviceId]?.[dateYmd];
  if (exception === 1) return true;
  if (exception === 2) return false;
  // SNCF publishes calendars almost entirely as exception dates; a service
  // with no base calendar runs only on its exception_type=1 dates.
  const svc = data.services[serviceId];
  if (!svc) return false;
  return svc.start <= dateYmd && dateYmd <= svc.end && svc.days[weekday] === 1;
}

/**
 * Next scheduled trains. When today's service is over, tomorrow's first
 * departures fill the list (marked `tomorrow`). Delay info from GTFS-RT
 * trip updates is merged in for today only.
 */
export function nextTrains(
  data: TrainsData,
  delays: Map<string, number>,
  count = 5,
  now = new Date(),
): TrainDeparture[] {
  const out: TrainDeparture[] = [];
  const nowSeconds = parisNow(now).seconds;

  for (const dayOffset of [0, 1]) {
    if (out.length >= count) break;
    const ref = new Date(now.getTime() + dayOffset * 86_400_000);
    const { dateYmd, weekday } = parisNow(ref);
    const day: TrainDeparture[] = [];

    for (const d of data.departures) {
      if (!serviceActive(data, d.service, dateYmd, weekday)) continue;
      const delay = dayOffset === 0 ? (delays.get(d.trip) ?? null) : null;
      const effectiveSeconds = d.t + (delay ?? 0);

      if (dayOffset === 0 && effectiveSeconds < nowSeconds - 60) continue;

      const deltaSeconds =
        dayOffset === 0
          ? effectiveSeconds - nowSeconds
          : 86_400 - nowSeconds + effectiveSeconds;

      day.push({
        time: new Date(now.getTime() + deltaSeconds * 1000),
        dest: d.dest,
        number: d.number,
        route: d.route,
        trip: d.trip,
        delaySeconds: delay,
        isTgv: /tgv/i.test(d.route),
        tomorrow: dayOffset === 1,
      });
    }

    day.sort((a, b) => a.time.getTime() - b.time.getTime());
    out.push(...day.slice(0, count - out.length));
  }

  return out;
}

/** Delays for our station's trips only; the national feed covers all of France. */
export async function fetchTrainDelays(
  data: TrainsData,
): Promise<Map<string, number>> {
  const ourTrips = new Set(data.departures.map((d) => d.trip));
  const feed = await fetchGtfsRtFeed(SNCF_RT_TRIP_UPDATES);
  const delays = new Map<string, number>();
  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId || !ourTrips.has(tripId)) continue;
    let delay: number | null = typeof tu.delay === "number" ? tu.delay : null;
    for (const stu of tu.stopTimeUpdate ?? []) {
      const d = stu.departure?.delay ?? stu.arrival?.delay;
      if (typeof d === "number") delay = d;
    }
    if (delay !== null) delays.set(tripId, delay);
  }
  return delays;
}
