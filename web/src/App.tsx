import { useEffect, useMemo, useState } from "react";
import "./App.css";
import BusMap from "./components/BusMap";
import CinemaPax from "./components/CinemaPax";
import ComingDays from "./components/ComingDays";
import DailyBriefing from "./components/DailyBriefing";
import DateSelector from "./components/DateSelector";
import Discover from "./components/Discover";
import LanguageSwitcher from "./components/LanguageSwitcher";
import MoonPhase from "./components/MoonPhase";
import PoiMap from "./components/PoiMap";
import TideChart from "./components/TideChart";
import VisitPlanner from "./components/VisitPlanner";
import {
  EVENTS_DATA_URL,
  TRIP_UPDATES_REFRESH_MS,
  WEATHER_REFRESH_MS,
} from "./config";
import {
  fetchAgendaEvents,
  fetchBeaches,
  fetchGlassPoints,
  fetchNextCollections,
  type AgendaEvent,
  type Beach,
  type GlassPoint,
  type WasteCollection,
} from "./lib/capatlantique";
import { fetchCinemaPax } from "./lib/cinema";
import {
  chargerLabel,
  fetchBikeParking,
  fetchBikeSegments,
  fetchBikeShareStations,
  fetchChargers,
  fetchCircuits,
  fetchCircuitTraces,
  fetchDae,
  fetchRoadInfo,
  type BikeParking,
  type BikeSegment,
  type BikeShareStation,
  type ChargerStation,
  type Circuit,
  type CircuitTrace,
  type DaePoint,
  type RoadInfo,
} from "./lib/localdata";
import {
  fetchMarineForDate,
  fetchWeather,
  weatherLabel,
  windDirectionLabel,
} from "./lib/openmeteo";
import { escapeHtml } from "./lib/html";
import { currentTrend, findExtrema, moonInfo, nextExtremes } from "./lib/tides";
import {
  fetchTrainDelays,
  loadTrainsData,
  nextTrains,
  type TrainsData,
} from "./lib/trains";
import {
  fetchServiceAlerts,
  fetchTripDelays,
  loadTransitData,
  nextDepartures,
  stopGroups,
} from "./lib/transit";
import type {
  CinemaPaxData,
  LocalEvent,
  MarineSeries,
  ServiceAlert,
  TransitData,
  WeatherNow,
} from "./lib/types";

const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
const fmtDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Paris",
});
const fmtDayTime = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});
const fmtShortDateTime = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
});

const STOP_STORAGE_KEY = "plq.stop";
const TRAIN_RT_REFRESH_MS = 120_000;
const ROAD_INFO_REFRESH_MS = 10 * 60_000;
const MUNICIPAL_EVENTS_URL = "https://www.lepouliguen.fr/evenements/";
const DESTINATION_AGENDA_URL = "https://www.labaule-guerande.com/explorer/agenda/";
const AGENDA_CITY_URLS: Record<string, string> = {
  "Le Pouliguen": MUNICIPAL_EVENTS_URL,
  "Le Croisic": "https://lecroisic.fr/fr/ev/748477/agenda-578",
  "Batz-sur-Mer": "https://www.batzsurmer.fr/informations-transversales/agenda",
  "Guérande": DESTINATION_AGENDA_URL,
  "La Baule-Escoublac": "https://www.labaule.fr/evenements/",
  Pornichet: "https://ville-pornichet.fr/je-bouge/agenda-de-pornichet/",
  "Saint-Nazaire": "https://www.saint-nazaire-tourisme.com/agenda/",
};
const BATHING_WATER_URL =
  "https://baignades.sante.gouv.fr/baignades/consultSite.do?annee=2025&dptddass=044&impression=yes&isite=044001738&modeDetailImp=3&plv=04400157991&site=044001738";
const PARKING_URL =
  "https://www.lepouliguen.fr/decouvrir/se-deplacer-et-stationner-au-pouliguen/";
const MONITORED_BEACHES = [
  "Plage du Nau",
  "Plage Benoît",
  "Plage du Général-de-Gaulle",
];
const AGENDA_CITY_FILTERS = [
  "Tous",
  "Le Pouliguen",
  "Le Croisic",
  "Batz-sur-Mer",
  "Guérande",
  "La Baule-Escoublac",
  "Pornichet",
  "Saint-Nazaire",
];
const NAV_LINKS = [
  { href: "#essentiel", label: "L'essentiel" },
  { href: "#deplacer", label: "Se déplacer" },
  { href: "#cote", label: "La côte" },
  { href: "#aujourdhui", label: "Aujourd'hui" },
  { href: "#pratique", label: "Vie pratique" },
  { href: "#/decouvrir", label: "Découvrir" },
];
type CircuitMode = "all" | "rando" | "velo";
type SourceStatusKind = "live" | "partial" | "static" | "unavailable";

function newTabProps(href: string) {
  return /^https?:\/\//.test(href)
    ? { target: "_blank", rel: "noopener noreferrer" }
    : {};
}

function SourceBadge({ kind, children }: { kind: SourceStatusKind; children: string }) {
  return <span className={`source-badge source-badge-${kind}`}>{children}</span>;
}

function SourceHealthLink({
  href,
  kind,
  label,
  status,
}: {
  href: string;
  kind: SourceStatusKind;
  label: string;
  status: string;
}) {
  return (
    <a
      className="source-health-item"
      href={href}
      aria-label={`${label} : ${status}`}
      title={`${label} : ${status}`}
      {...newTabProps(href)}
    >
      <SourceBadge kind={kind}>{label}</SourceBadge>
    </a>
  );
}

function safeAgendaUrl(event: AgendaEvent): string {
  return AGENDA_CITY_URLS[event.city] ?? DESTINATION_AGENDA_URL;
}

function freshnessLabel(fetchedAt: Date | undefined): string {
  if (!fetchedAt) return "";
  const minutes = Math.floor((Date.now() - fetchedAt.getTime()) / 60_000);
  if (minutes < 1) return "";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

function defaultStopName(groups: { name: string }[]): string {
  const preferred = groups.find((g) => /gare|centre|mairie|port/i.test(g.name));
  return (preferred ?? groups[0])?.name ?? "";
}

function fluxBadgeClass(flux: string): string {
  if (/jaune/i.test(flux)) return "flux-badge flux-jaune";
  if (/vert/i.test(flux)) return "flux-badge flux-vert";
  return "flux-badge";
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateInputValue(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isSameDay(a: Date, b: Date): boolean {
  return toDateInputValue(a) === toDateInputValue(b);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return startOfDay(d);
}

function shortWhenLabel(date: Date, ref: Date): string {
  const minutes = Math.round((date.getTime() - ref.getTime()) / 60_000);
  if (minutes < 0 && minutes > -60) return `il y a ${Math.abs(minutes)} min`;
  if (minutes <= -60 && minutes > -24 * 60) return `il y a ${Math.round(Math.abs(minutes) / 60)} h`;
  if (minutes > 0 && minutes < 60) return `dans ${minutes} min`;
  if (minutes >= 60 && minutes < 24 * 60) return `dans ${Math.round(minutes / 60)} h`;
  if (isSameDay(date, ref)) return "aujourd'hui";
  if (isSameDay(date, addDays(ref, 1))) return "demain";
  return fmtDate.format(date);
}

function sunMomentLabel(weather: WeatherNow, ref: Date): string {
  if (ref < weather.sunrise) return `lever du soleil ${fmtTime.format(weather.sunrise)}`;
  if (ref <= weather.sunset) return `coucher du soleil ${fmtTime.format(weather.sunset)}`;

  const tomorrow = addDays(ref, 1);
  const tomorrowWeather = weather.daily.find((day) => isSameDay(day.date, tomorrow));
  if (tomorrowWeather) {
    return `lever du soleil demain ${fmtTime.format(tomorrowWeather.sunrise)}`;
  }

  return `soleil couché, lever demain`;
}

function dateBoundsFromServices(
  services: Record<string, { start: string; end: string }>,
): { min: string | undefined; max: string | undefined } {
  const ranges = Object.values(services);
  if (ranges.length === 0) return { min: undefined, max: undefined };
  const starts = ranges.map((service) => service.start).filter(Boolean).sort();
  const ends = ranges.map((service) => service.end).filter(Boolean).sort();
  const ymdToInput = (ymd: string) =>
    ymd.length === 8 ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : undefined;

  return {
    min: starts[0] ? ymdToInput(starts[0]) : undefined,
    max: ends[ends.length - 1] ? ymdToInput(ends[ends.length - 1]) : undefined,
  };
}

function dateBoundsFromExceptions(
  exceptions: Record<string, Record<string, number>>,
): { min: string | undefined; max: string | undefined } {
  const dates = Object.values(exceptions)
    .flatMap((serviceDates) =>
      Object.entries(serviceDates)
        .filter(([, type]) => type === 1)
        .map(([date]) => date),
    )
    .sort();
  const ymdToInput = (ymd: string) =>
    ymd.length === 8 ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : undefined;

  return {
    min: dates[0] ? ymdToInput(dates[0]) : undefined,
    max: dates[dates.length - 1] ? ymdToInput(dates[dates.length - 1]) : undefined,
  };
}

function curatedEventToAgenda(event: LocalEvent): AgendaEvent | null {
  if (!event.title) return null;
  return {
    title: event.title,
    dateRange: event.dateRange ?? event.when,
    location: event.location ?? event.where,
    city: event.city ?? "",
    url: event.url ?? event.source ?? null,
  };
}

function mergeAgendaEvents(live: AgendaEvent[], curated: LocalEvent[]): AgendaEvent[] {
  const seen = new Set<string>();
  const out: AgendaEvent[] = [];
  const push = (event: AgendaEvent) => {
    const key = `${event.title}|${event.city}|${event.dateRange}`.toLowerCase();
    if (!event.title || seen.has(key)) return;
    seen.add(key);
    out.push(event);
  };

  live.forEach(push);
  curated.map(curatedEventToAgenda).forEach((event) => {
    if (event) push(event);
  });
  return out;
}

function dateBoundsFromSchedule(
  services: Record<string, { start: string; end: string }>,
  exceptions: Record<string, Record<string, number>>,
): { min: string | undefined; max: string | undefined } {
  const serviceBounds = dateBoundsFromServices(services);
  const exceptionBounds = dateBoundsFromExceptions(exceptions);
  const mins = [serviceBounds.min, exceptionBounds.min].filter((v): v is string => Boolean(v)).sort();
  const maxes = [serviceBounds.max, exceptionBounds.max].filter((v): v is string => Boolean(v)).sort();
  return {
    min: mins[0],
    max: maxes[maxes.length - 1],
  };
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [marine, setMarine] = useState<MarineSeries | null>(null);
  const [transit, setTransit] = useState<TransitData | null>(null);
  const [delays, setDelays] = useState<Map<string, number>>(new Map());
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [trains, setTrains] = useState<TrainsData | null>(null);
  const [trainDelays, setTrainDelays] = useState<Map<string, number>>(new Map());
  const [roadInfo, setRoadInfo] = useState<RoadInfo[] | null>(null);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [circuitTraces, setCircuitTraces] = useState<CircuitTrace[]>([]);
  const [bikeParking, setBikeParking] = useState<BikeParking[] | null>(null);
  const [bikeSegments, setBikeSegments] = useState<BikeSegment[] | null>(null);
  const [bikeShareStations, setBikeShareStations] = useState<BikeShareStation[] | null>(null);
  const [dae, setDae] = useState<DaePoint[]>([]);
  const [chargers, setChargers] = useState<ChargerStation[]>([]);
  const [fallbackEvents, setFallbackEvents] = useState<LocalEvent[]>([]);
  const [agenda, setAgenda] = useState<AgendaEvent[]>([]);
  const [cinema, setCinema] = useState<CinemaPaxData | null>(null);
  const [beaches, setBeaches] = useState<Beach[]>([]);
  const [collections, setCollections] = useState<WasteCollection[]>([]);
  const [glassPoints, setGlassPoints] = useState<GlassPoint[]>([]);
  const [stopName, setStopName] = useState<string>(
    () => localStorage.getItem(STOP_STORAGE_KEY) ?? "",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedCircuit, setSelectedCircuit] = useState<string | null>(null);
  const [circuitMode, setCircuitMode] = useState<CircuitMode>("all");
  const [agendaCity, setAgendaCity] = useState("Tous");
  const [route, setRoute] = useState<string>(() => window.location.hash);
  const [openMaps, setOpenMaps] = useState<Record<string, boolean>>({});
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const selectedDateValue = toDateInputValue(selectedDate);
  const todayValue = toDateInputValue(now);
  const selectedDateIsToday = selectedDateValue === todayValue;
  const selectedDateReference = selectedDateIsToday ? now : selectedDate;
  const selectedMoon = useMemo(() => moonInfo(selectedDateReference), [selectedDateReference]);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const isDiscover = route.startsWith("#/decouvrir");

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [route]);

  useEffect(() => {
    // Coming back from the Découvrir page to an anchor: the section only
    // exists after this render, so scroll on the next frame.
    if (isDiscover || !route || route.startsWith("#/")) return;
    const id = route.slice(1);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    });
  }, [route, isDiscover]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const pushError = (what: string) =>
      setErrors((e) => (e.includes(what) ? e : [...e, what]));
    const load = () => {
      fetchWeather().then(setWeather).catch(() => pushError("météo"));
    };
    load();
    const id = setInterval(load, WEATHER_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMarineForDate(selectedDateValue)
      .then((data) => {
        if (!cancelled) setMarine(data);
      })
      .catch(() => {
        if (!cancelled) setErrors((e) => (e.includes("mer") ? e : [...e, "mer"]));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDateValue]);

  useEffect(() => {
    loadTransitData()
      .then(setTransit)
      .catch(() => setErrors((e) => [...e, "bus"]));
    loadTrainsData()
      .then(setTrains)
      .catch(() => setErrors((e) => [...e, "trains"]));
    Promise.all([
      fetchAgendaEvents().catch(() => []),
      fetch(EVENTS_DATA_URL)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]).then(([liveAgenda, curatedEvents]: [AgendaEvent[], LocalEvent[]]) => {
      setFallbackEvents(curatedEvents);
      setAgenda(mergeAgendaEvents(liveAgenda, curatedEvents));
    });
    fetchBeaches().then(setBeaches).catch(() => {});
    fetchNextCollections().then(setCollections).catch(() => {});
    fetchGlassPoints().then(setGlassPoints).catch(() => {});
    fetchCircuits().then(setCircuits).catch(() => {});
    fetchCircuitTraces().then(setCircuitTraces).catch(() => {});
    fetchBikeParking().then(setBikeParking).catch(() => setBikeParking([]));
    fetchBikeSegments().then(setBikeSegments).catch(() => setBikeSegments([]));
    fetchBikeShareStations().then(setBikeShareStations).catch(() => setBikeShareStations([]));
    fetchDae().then(setDae).catch(() => {});
    fetchChargers().then(setChargers).catch(() => {});
    fetchCinemaPax().then(setCinema).catch(() => setCinema(null));
  }, []);

  useEffect(() => {
    const refresh = () => {
      fetchTripDelays().then(setDelays).catch(() => {});
      fetchServiceAlerts().then(setAlerts).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, TRIP_UPDATES_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!trains) return;
    const refresh = () =>
      fetchTrainDelays(trains).then(setTrainDelays).catch(() => {});
    refresh();
    const id = setInterval(refresh, TRAIN_RT_REFRESH_MS);
    return () => clearInterval(id);
  }, [trains]);

  useEffect(() => {
    const refresh = () => fetchRoadInfo().then(setRoadInfo).catch(() => {});
    refresh();
    const id = setInterval(refresh, ROAD_INFO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const groups = useMemo(() => (transit ? stopGroups(transit) : []), [transit]);

  useEffect(() => {
    if (groups.length > 0 && !groups.some((g) => g.name === stopName)) {
      setStopName(defaultStopName(groups));
    }
  }, [groups, stopName]);

  const transitDateBounds = useMemo(
    () =>
      transit
        ? dateBoundsFromSchedule(transit.services, transit.serviceExceptions)
        : { min: undefined, max: undefined },
    [transit],
  );

  const trainDateBounds = useMemo(
    () =>
      trains
        ? dateBoundsFromSchedule(trains.services, trains.serviceExceptions)
        : { min: undefined, max: undefined },
    [trains],
  );

  const departures = useMemo(() => {
    if (!transit || !stopName) return [];
    const group = groups.find((g) => g.name === stopName);
    if (!group) return [];
    const dateDelays = selectedDateIsToday ? delays : new Map<string, number>();
    return nextDepartures(
      transit,
      group.ids,
      dateDelays,
      8,
      selectedDateReference,
      selectedDateIsToday,
    );
  }, [transit, groups, stopName, delays, selectedDateIsToday, selectedDateReference]);

  const trainDepartures = useMemo(() => {
    if (!trains) return [];
    const dateDelays = selectedDateIsToday ? trainDelays : new Map<string, number>();
    return nextTrains(trains, dateDelays, 8, selectedDateReference, selectedDateIsToday);
  }, [trains, trainDelays, selectedDateIsToday, selectedDateReference]);

  const parisTrainDepartures = useMemo(() => {
    if (!trains) return [];
    const dateDelays = selectedDateIsToday ? trainDelays : new Map<string, number>();
    return nextTrains(trains, dateDelays, 40, selectedDateReference, false)
      .filter((t) => /paris/i.test(t.dest))
      .slice(0, 3);
  }, [trains, trainDelays, selectedDateIsToday, selectedDateReference]);

  const extrema = useMemo(() => (marine ? findExtrema(marine) : []), [marine]);
  const upcoming = useMemo(() => nextExtremes(extrema, now).slice(0, 2), [extrema, now]);

  const selectedDayExtrema = useMemo(
    () => extrema.filter((e) => isSameDay(e.time, selectedDate)),
    [extrema, selectedDate],
  );
  const lowTides = useMemo(
    () => selectedDayExtrema.filter((e) => e.type === "low"),
    [selectedDayExtrema],
  );
  const sortedCircuits = useMemo(() => {
    const localRank = (c: Circuit) =>
      c.communes.some((commune) => /pouliguen/i.test(commune))
        ? 0
        : c.communes.some((commune) => /batz|baule|croisic|gu[eé]rande/i.test(commune))
          ? 1
          : 2;
    return circuits
      .filter((c) => circuitMode === "all" || c.kind === circuitMode)
      .sort((a, b) => localRank(a) - localRank(b) || (a.km ?? 999) - (b.km ?? 999));
  }, [circuits, circuitMode]);
  const featuredCircuit =
    sortedCircuits.find((c) => c.name === selectedCircuit) ??
    sortedCircuits.find((c) => c.communes.some((commune) => /pouliguen/i.test(commune))) ??
    sortedCircuits[0];
  const essentialTide = upcoming[0] ?? selectedDayExtrema[selectedDayExtrema.length - 1] ?? null;
  const essentialTideIsPast = essentialTide
    ? essentialTide.time.getTime() < now.getTime()
    : false;
  const trend = useMemo(() => (marine ? currentTrend(marine, now) : null), [marine, now]);

  const latestBefore = (times: Date[], values: (number | null)[], ref = now) => {
    let best: number | null = null;
    for (let i = 0; i < times.length; i++) {
      if (times[i].getTime() <= ref.getTime() && values[i] != null) {
        best = values[i];
      }
    }
    return best;
  };
  const marineReference = new Date(selectedDate);
  if (selectedDateValue === todayValue) {
    marineReference.setTime(now.getTime());
  } else {
    marineReference.setHours(12, 0, 0, 0);
  }
  const seaTempSelected = marine
    ? latestBefore(marine.hourlyTimes, marine.seaTemp, marineReference)
    : null;
  const waveSelected = marine
    ? latestBefore(marine.hourlyTimes, marine.waveHeight, marineReference)
    : null;
  const bikeSegmentStats = useMemo(() => {
    const stats = new Map<string, { count: number; lengthM: number }>();
    for (const segment of bikeSegments ?? []) {
      const key = segment.arrangement || "Non précisé";
      const current = stats.get(key) ?? { count: 0, lengthM: 0 };
      current.count += 1;
      current.lengthM += Number.isFinite(segment.lengthM) ? segment.lengthM : 0;
      stats.set(key, current);
    }
    return Array.from(stats.entries())
      .map(([label, value]) => ({
        label,
        count: value.count,
        km: Math.round(value.lengthM / 100) / 10,
      }))
      .sort((a, b) => b.km - a.km)
      .slice(0, 4);
  }, [bikeSegments]);
  const bikeMapMarkers = useMemo(
    () => [
      ...(bikeParking ?? []).slice(0, 8).map((p) => ({
        lat: p.lat,
        lon: p.lon,
        label: "P",
        color: "#0b6396",
        title: `${p.capacity} places vélo · ${p.street}`,
        popupHtml:
          `<div class="bus-popup"><h3>${escapeHtml(p.street)}</h3>` +
          `<p>${escapeHtml(p.commune)} · ${p.capacity} place${p.capacity > 1 ? "s" : ""}` +
          (p.furniture ? ` · ${escapeHtml(p.furniture)}` : "") +
          (p.covered ? " · couvert" : "") +
          `</p></div>`,
      })),
      ...(bikeShareStations ?? []).slice(0, 6).map((s) => ({
        lat: s.lat,
        lon: s.lon,
        label: "V",
        color: "#357a38",
        title: `Vélo Baulois · ${s.name}`,
        popupHtml:
          `<div class="bus-popup"><h3>Vélo Baulois · ${escapeHtml(s.name)}</h3>` +
          `<p>${s.bikesAvailable} vélo${s.bikesAvailable > 1 ? "s" : ""} disponible${s.bikesAvailable > 1 ? "s" : ""} · ${s.docksAvailable} attaches libres</p>` +
          (s.rentalUrl
            ? `<a href="${escapeHtml(s.rentalUrl)}" target="_blank" rel="noopener noreferrer">ouvrir la station</a>`
            : "") +
          `</div>`,
      })),
    ],
    [bikeParking, bikeShareStations],
  );
  const agendaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("Tous", agenda.length);
    for (const event of agenda) {
      if (!event.city) continue;
      counts.set(event.city, (counts.get(event.city) ?? 0) + 1);
    }
    return counts;
  }, [agenda]);
  const visibleAgenda = useMemo(
    () => (agendaCity === "Tous" ? agenda : agenda.filter((event) => event.city === agendaCity)),
    [agenda, agendaCity],
  );

  const nearestGlass = glassPoints[0] ?? null;

  const onStopChange = (name: string) => {
    setStopName(name);
    localStorage.setItem(STOP_STORAGE_KEY, name);
  };

  const selectDate = (value: string) => {
    if (!value) return;
    setSelectedDate(startOfDay(fromDateInputValue(value)));
  };

  const shiftSelectedDate = (days: number) => {
    setSelectedDate((date) => addDays(date, days));
  };

  const delayNote = (delaySeconds: number | null) => {
    if (delaySeconds == null) return null;
    if (delaySeconds >= 60)
      return <em className="delay"> +{Math.round(delaySeconds / 60)} min</em>;
    return <em className="ontime"> à l'heure</em>;
  };

  const toggleMap = (key: string) => {
    setOpenMaps((maps) => ({ ...maps, [key]: !maps[key] }));
  };

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#essentiel">
          Le Pouliguen <span>Live</span>
        </a>
        <LanguageSwitcher />
        <button
          type="button"
          className="menu-toggle"
          aria-label={isMobileNavOpen ? "Fermer le menu" : "Ouvrir le menu"}
          aria-controls="main-navigation"
          aria-expanded={isMobileNavOpen}
          onClick={() => setIsMobileNavOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
        <nav
          id="main-navigation"
          className={isMobileNavOpen ? "topnav topnav-open" : "topnav"}
          aria-label="Navigation principale"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={isDiscover && link.href === "#/decouvrir" ? "nav-active" : ""}
              onClick={() => setIsMobileNavOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>

      <header className="hero">
        <span className="hero-pill">La Presqu'île en direct ✺</span>
        <h1>
          Votre journée
          <br />
          au Pouliguen.
        </h1>
        <p className="hero-date">{fmtDate.format(now)}</p>
        {weather && (
          <div className="hero-weather">
            <span className="hero-temp">{Math.round(weather.temperature)}°</span>
            <span className="hero-cond">
              {weatherLabel(weather.weatherCode)}, vent{" "}
              {windDirectionLabel(weather.windDirection)}{" "}
              {Math.round(weather.windSpeed)} km/h (rafales{" "}
              {Math.round(weather.windGusts)})
            </span>
          </div>
        )}
        {weather && (
          <p className="hero-sub">
            {Math.round(weather.tempMin)}° / {Math.round(weather.tempMax)}° · UV max{" "}
            {Math.round(weather.uvMax)} · {sunMomentLabel(weather, now)} ·{" "}
            <a
              href="https://vigilance.meteofrance.fr"
              target="_blank"
              rel="noopener noreferrer"
            >
              vigilance officielle
            </a>
          </p>
        )}
      </header>

      {isDiscover ? (
        <Discover />
      ) : (
        <>
      {errors.length > 0 && (
        <div className="banner-error">
          Données momentanément indisponibles : {errors.join(", ")}.
        </div>
      )}

      <section className="source-health" aria-label="État des sources de données">
        <SourceHealthLink
          href="#cote"
          kind={weather && marine ? "live" : "unavailable"}
          label="météo et mer"
          status={weather && marine ? "données directes" : "source indisponible"}
        />
        <SourceHealthLink
          href="#deplacer"
          kind={transit ? "live" : "unavailable"}
          label="bus"
          status={transit ? "horaires et temps réel" : "source indisponible"}
        />
        <SourceHealthLink
          href="#deplacer"
          kind={trains ? "partial" : "unavailable"}
          label="train"
          status={trains ? "horaires, retards si publiés" : "source indisponible"}
        />
        <SourceHealthLink
          href="#aujourdhui"
          kind={cinema && cinema.sessions.length > 0 ? "static" : "unavailable"}
          label="cinéma"
          status={cinema && cinema.sessions.length > 0 ? "cache officiel" : "cache indisponible"}
        />
        <SourceHealthLink
          href="#aujourdhui"
          kind={agenda.length > 0 ? "partial" : "unavailable"}
          label="agenda"
          status={agenda.length > 0 ? "flux partiel selon les villes" : "source indisponible"}
        />
        <SourceHealthLink
          href="#deplacer"
          kind="static"
          label="parking"
          status="source municipale 2026"
        />
      </section>

      <section className="essentials" id="essentiel" aria-label="L'essentiel maintenant">
        {essentialTide && (
          <div className="essential">
            <span className="essential-kicker">Marée</span>
            <span className="essential-label">
              {essentialTideIsPast
                ? essentialTide.type === "high"
                  ? "Dernière haute mer"
                  : "Dernière basse mer"
                : essentialTide.type === "high"
                  ? "Haute mer"
                  : "Basse mer"}
            </span>
            <span className="essential-value">{fmtTime.format(essentialTide.time)}</span>
            <span className="essential-meta">{shortWhenLabel(essentialTide.time, now)}</span>
          </div>
        )}
        {departures[0] && (
          <div className="essential">
            <span className="essential-kicker">Bus</span>
            <span className="essential-label">
              Arrêt {stopName || "…"}
            </span>
            <span className="essential-value">
              {fmtTime.format(departures[0].time)}
              <small> ligne {departures[0].routeShort}</small>
            </span>
            <span className="essential-meta">{shortWhenLabel(departures[0].time, now)}</span>
          </div>
        )}
        {trainDepartures[0] && (
          <div className="essential">
            <span className="essential-kicker">Train</span>
            <span className="essential-label">
              Vers {trainDepartures[0].dest}
            </span>
            <span className="essential-value">
              {fmtTime.format(trainDepartures[0].time)}
            </span>
            <span className="essential-meta">{shortWhenLabel(trainDepartures[0].time, now)}</span>
          </div>
        )}
        {collections[0] && (
          <div className="essential">
            <span className="essential-kicker">Déchets</span>
            <span className="essential-label">
              {collections[0].flux}
            </span>
            <span className="essential-value essential-value-text">
              {collections[0].dateTxt.replace(/ \d{4}$/, "")}
            </span>
            <span className="essential-meta">
              {shortWhenLabel(fromDateInputValue(collections[0].date), now)}
            </span>
          </div>
        )}
      </section>

      <main>
        <h2 className="section-title" id="deplacer">Se déplacer</h2>
        <div className="cards">

        <section className="card">
          <div className="card-heading">
            <h3>Prochains bus</h3>
            <DateSelector
              value={selectedDateValue}
              min={transitDateBounds.min}
              max={transitDateBounds.max}
              isToday={selectedDateIsToday}
              onChange={selectDate}
              onPrevious={() => shiftSelectedDate(-1)}
              onNext={() => shiftSelectedDate(1)}
              onToday={() => selectDate(todayValue)}
            />
          </div>
          {transit ? (
            <>
              <p className="card-note">
                Réseau de bus Lila Presqu'île. Choisissez votre arrêt :
                {freshnessLabel(transit.fetchedAt) && (
                  <span className="freshness">
                    {" · Données il y a "}{freshnessLabel(transit.fetchedAt)}
                  </span>
                )}
              </p>
              <label className="stop-picker">
                Arrêt de bus
                <select value={stopName} onChange={(e) => onStopChange(e.target.value)}>
                  {groups.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              {departures.length > 0 ? (
                <ul className="departures">
                  {departures.map((d, i) => (
                    <li key={`${d.trip}-${i}`}>
                      <span
                        className="route-badge"
                        style={
                          d.routeColor ? { background: `#${d.routeColor}` } : undefined
                        }
                      >
                        {d.routeShort}
                      </span>
                      <span className="dep-headsign">
                        {d.headsign || "…"}
                        {d.tomorrow && <span className="tomorrow-label"> demain</span>}
                      </span>
                      <span className="dep-time">
                        {fmtTime.format(d.time)}
                        {delayNote(d.delaySeconds)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">
                  Aucun passage trouvé pour cette date à cet arrêt.
                </p>
              )}
              {selectedDateIsToday && alerts.length > 0 && (
                <div className="alerts">
                  {alerts.map((a, i) => (
                    <p key={i}>
                      <strong>{a.header}</strong>
                      {a.description ? ` : ${a.description}` : ""}
                    </p>
                  ))}
                </div>
              )}
              <p className="ticket-links">
                Billets de bus et horaires complets :{" "}
                <a href="https://www.lilapresquile.fr" target="_blank" rel="noopener noreferrer">
                  lilapresquile.fr
                </a>
              </p>
            </>
          ) : (
            <p className="placeholder">Chargement des horaires…</p>
          )}
        </section>

        <section className="card">
          <div className="card-heading">
            <h3>Prochains trains</h3>
            <DateSelector
              value={selectedDateValue}
              min={trainDateBounds.min}
              max={trainDateBounds.max}
              isToday={selectedDateIsToday}
              onChange={selectDate}
              onPrevious={() => shiftSelectedDate(-1)}
              onNext={() => shiftSelectedDate(1)}
              onToday={() => selectDate(todayValue)}
            />
          </div>
          {trains ? (
            <>
              <p className="card-note">
                Départs de la gare du Pouliguen.
                {freshnessLabel(trains.fetchedAt) && (
                  <span className="freshness">
                    {" · Données il y a "}{freshnessLabel(trains.fetchedAt)}
                  </span>
                )}
              </p>
              {trainDepartures.length > 0 ? (
                <ul className="departures">
                  {trainDepartures.map((t, i) => (
                    <li key={`${t.trip}-${i}`}>
                      <span
                        className={
                          t.isTgv ? "route-badge train-badge-tgv" : "route-badge train-badge"
                        }
                      >
                        {t.isTgv ? "TGV" : "TER"}
                      </span>
                      <span className="dep-headsign">
                        {t.dest}
                        {t.number && <small className="train-number"> n° {t.number}</small>}
                        {t.tomorrow && <span className="tomorrow-label"> demain</span>}
                      </span>
                      <span className="dep-time">
                        {fmtTime.format(t.time)}
                        {delayNote(t.delaySeconds)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">Aucun train trouvé pour cette date.</p>
              )}
              {parisTrainDepartures.length > 0 && (
                <div className="train-focus">
                  <strong>Direct Paris</strong>
                  <ul>
                    {parisTrainDepartures.map((t, i) => (
                      <li key={`${t.trip}-paris-${i}`}>
                        <span>
                          {fmtTime.format(t.time)}
                          {t.number && <small className="train-number"> n° {t.number}</small>}
                        </span>
                        {delayNote(t.delaySeconds)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="ticket-links">
                Billets de train :{" "}
                <a href="https://www.sncf-connect.com" target="_blank" rel="noopener noreferrer">
                  SNCF Connect
                </a>
              </p>
            </>
          ) : (
            <p className="placeholder">Chargement des horaires de train…</p>
          )}
        </section>

        <section className="card">
          <h3>Bus en direct sur la carte</h3>
          {transit ? (
            <>
              <button
                type="button"
                className="map-toggle"
                onClick={() => toggleMap("bus")}
                aria-expanded={Boolean(openMaps.bus)}
              >
                {openMaps.bus ? "masquer la carte" : "voir la carte des bus"}
              </button>
              {openMaps.bus && <BusMap data={transit} delays={delays} />}
            </>
          ) : (
            <p className="placeholder">Chargement de la carte…</p>
          )}
        </section>

        <section className="card">
          <h3>Circulation routière</h3>
          {roadInfo === null ? (
            <p className="placeholder">Chargement des infos routes…</p>
          ) : roadInfo.length === 0 ? (
            <p className="placeholder">
              Aucune perturbation signalée sur les routes départementales autour
              de la presqu'île.
            </p>
          ) : (
            <ul className="roadinfo">
              {roadInfo.slice(0, 5).map((r, i) => (
                <li key={i}>
                  <strong>{r.nature}</strong>
                  <span>{r.lines.join(" · ")}</span>
                  <span className="roadinfo-meta">à {r.distanceKm} km</span>
                </li>
              ))}
            </ul>
          )}
          <p className="meta-line">
            Source : Département de Loire-Atlantique, routes départementales
            uniquement.
          </p>
        </section>

        <section className="card">
          <div className="card-heading">
            <h3>Stationnement</h3>
            <SourceBadge kind="static">municipal 2026</SourceBadge>
          </div>
          <ul className="parking-list">
            <li>
              <strong>Gratuit toute l'année</strong>
              <span>
                La mairie conseille de rejoindre les parkings de proximité pour
                stationner sans contrainte de temps.
              </span>
            </li>
            <li>
              <strong>Zones bleues en été</strong>
              <span>
                En juillet et août, certaines rues et parkings restent gratuits
                mais limités à 30 min ou 2 h selon les secteurs.
              </span>
            </li>
            <li>
              <strong>Quai Jules-Sandeau</strong>
              <span>
                La circulation peut être modifiée en saison, avec des créneaux
                piétons les soirs d'été.
              </span>
            </li>
          </ul>
          <p className="meta-line">
            Source officielle :{" "}
            <a href={PARKING_URL} target="_blank" rel="noopener noreferrer">
              mairie du Pouliguen, se déplacer et stationner
            </a>
            .
          </p>
        </section>

        <section className="card">
          <h3>Vélo pratique</h3>
          {bikeParking === null || bikeSegments === null || bikeShareStations === null ? (
            <p className="placeholder">Chargement des données vélo…</p>
          ) : (
            <>
              {bikeMapMarkers.length > 0 && (
                <>
                  <button
                    type="button"
                    className="map-toggle"
                    onClick={() => toggleMap("bike")}
                    aria-expanded={Boolean(openMaps.bike)}
                  >
                    {openMaps.bike ? "masquer la carte" : "voir la carte vélo"}
                  </button>
                  {openMaps.bike && <PoiMap markers={bikeMapMarkers} />}
                </>
              )}
              <div className="bike-practical-grid">
                <div>
                  <span className="bike-metric">{bikeParking.length}</span>
                  <span>stationnements vélo proches</span>
                </div>
                <div>
                  <span className="bike-metric">
                    {bikeParking.reduce((sum, p) => sum + p.capacity, 0)}
                  </span>
                  <span>places recensées</span>
                </div>
                <div>
                  <span className="bike-metric">{bikeShareStations.length}</span>
                  <span>stations Vélo Baulois à portée</span>
                </div>
              </div>
              {bikeShareStations.length > 0 && (
                <ul className="bike-stations">
                  {bikeShareStations.slice(0, 3).map((station) => (
                    <li key={station.name}>
                      <strong>{station.name}</strong>
                      <span>
                        {station.bikesAvailable} vélo{station.bikesAvailable > 1 ? "s" : ""} ·{" "}
                        {station.docksAvailable} attaches libres · à{" "}
                        {station.distanceKm.toFixed(1)} km
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {bikeSegmentStats.length > 0 && (
                <div className="bike-segments">
                  <strong>Aménagements cyclables proches</strong>
                  {bikeSegmentStats.map((segment) => (
                    <span key={segment.label}>
                      {segment.label} · {segment.km} km · {segment.count} tronçon
                      {segment.count > 1 ? "s" : ""}
                    </span>
                  ))}
                </div>
              )}
              <p className="meta-line">
                Sources : Cap Atlantique (stationnements et tronçons vélo),
                Vélo Baulois pour les vélos électriques en libre-service.
              </p>
            </>
          )}
        </section>

        </div>

        <h2 className="section-title" id="cote">La côte</h2>
        <div className="cards">

        <section className="card">
          <div className="card-heading">
            <h3>Mer et marée</h3>
            <DateSelector
              value={selectedDateValue}
              isToday={selectedDateValue === todayValue}
              onChange={selectDate}
              onPrevious={() => shiftSelectedDate(-1)}
              onNext={() => shiftSelectedDate(1)}
              onToday={() => selectDate(todayValue)}
            />
          </div>
          {marine ? (
            <>
              <div className="tide-summary">
                {selectedDayExtrema.length > 0 ? (
                  selectedDayExtrema.map((e, i) => (
                    <div key={i} className="tide-next">
                      <span className="tide-kind">
                        {e.type === "high" ? "Marée haute" : "Marée basse"}
                      </span>
                      <span className="tide-time">{fmtTime.format(e.time)}</span>
                    </div>
                  ))
                ) : (
                  <p className="placeholder tide-placeholder">
                    Aucun horaire de marée disponible pour cette date.
                  </p>
                )}
                {trend && selectedDateValue === todayValue && (
                  <div className="tide-next">
                    <span className="tide-kind">Tendance</span>
                    <span className="tide-time">
                      {trend === "rising" ? "montante ↗" : "descendante ↘"}
                    </span>
                  </div>
                )}
              </div>
              <TideChart marine={marine} extrema={extrema} now={now} date={selectedDate} />
              <MoonPhase moon={selectedMoon} formatDateTime={fmtShortDateTime} />
              <p className="meta-line">
                {seaTempSelected != null && <>Eau {seaTempSelected.toFixed(1)}°C · </>}
                {waveSelected != null && <>vagues {waveSelected.toFixed(1)} m · </>}
                horaires issus d'un modèle océanique (écart possible de 30 à 45
                minutes). Phase lunaire indicative, coefficients officiels à vérifier
                sur les sources maritimes avant navigation.
              </p>
            </>
          ) : (
            <p className="placeholder">Chargement des conditions de mer…</p>
          )}
        </section>

        <section className="card">
          <h3>Plages</h3>
          {beaches.length > 0 ? (
            <>
              <button
                type="button"
                className="map-toggle"
                onClick={() => toggleMap("beaches")}
                aria-expanded={Boolean(openMaps.beaches)}
              >
                {openMaps.beaches ? "masquer la carte" : "voir la carte des plages"}
              </button>
              {openMaps.beaches && (
                <PoiMap
                  markers={beaches.map((b) => ({
                    lat: b.lat,
                    lon: b.lon,
                    label: "P",
                    color: "#0b6396",
                    title: b.name,
                    popupHtml:
                      `<div class="bus-popup"><h3>${escapeHtml(b.name)}</h3>` +
                      `<p>${escapeHtml(b.description.slice(0, 120))}…</p>` +
                      (b.url
                        ? `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer">En savoir plus</a>`
                        : "") +
                      `</div>`,
                  }))}
                />
              )}
              <ul className="beaches">
                {beaches.map((b, i) => (
                  <li key={i}>
                    <strong>{b.name}</strong>
                    <span>
                      {b.description.length > 130
                        ? b.description.slice(0, 130).trimEnd() + "…"
                        : b.description}
                    </span>
                    {b.url && (
                      <a href={b.url} target="_blank" rel="noopener noreferrer">
                        en savoir plus
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <p className="meta-line">
                Qualité officielle des eaux de baignade :{" "}
                <a
                  href="https://baignades.sante.gouv.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  baignades.sante.gouv.fr
                </a>
              </p>
            </>
          ) : (
            <p className="placeholder">Chargement des plages…</p>
          )}
        </section>

        <section className="card">
          <h3>Qualité de l'eau</h3>
          <div className="water-quality">
            <div className="water-highlight">
              <span className="water-badge water-badge-sufficient">
                Baie du Guec · suffisant
              </span>
              <div>
                <strong>Baie du Guec, classement baignade 2025</strong>
                <span>
                  “Suffisant” signifie que l'eau reste classée conforme pour la
                  baignade, mais dans la catégorie la plus basse avant
                  “insuffisant”. Ce label concerne Baie du Guec uniquement.
                </span>
                <a href={BATHING_WATER_URL} target="_blank" rel="noopener noreferrer">
                  Voir la fiche officielle du Ministère de la Santé
                </a>
              </div>
            </div>
            <p className="water-note">
              Autres plages suivies autour du Pouliguen, sans statut affiché ici :
            </p>
            <ul className="water-beach-list" aria-label="Autres plages suivies">
              {MONITORED_BEACHES.map((beach) => (
                <li key={beach}>{beach}</li>
              ))}
            </ul>
            <p className="water-note">
              Elles restent listées pour repère, mais le badge “suffisant” ne
              s'applique pas à toutes.
            </p>
          </div>
          <p className="meta-line">
            Le classement officiel est calculé sur quatre saisons de résultats
            microbiologiques, pas seulement sur le dernier prélèvement.
          </p>
        </section>

        <section className="card">
          <h3>Pêche à pied</h3>
          {marine ? (
            lowTides.length > 0 ? (
              <>
                <p className="peche-intro">
                  Basses mers du jour sélectionné (meilleur créneau environ 1 h 30
                  avant et après) :
                </p>
                <ul className="lowtides">
                  {lowTides.map((e, i) => (
                    <li key={i}>
                      <span className="lowtide-time">{fmtDayTime.format(e.time)}</span>
                      <span className="lowtide-kind">basse mer</span>
                    </li>
                  ))}
                </ul>
                <p className="meta-line">
                  Avant de partir, vérifiez les fermetures sanitaires et les tailles
                  autorisées :{" "}
                  <a
                    href="https://www.pecheapied-responsable.fr"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    pecheapied-responsable.fr
                  </a>{" "}
                  ·{" "}
                  <a
                    href="https://www.loire-atlantique.gouv.fr"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    préfecture de Loire-Atlantique
                  </a>
                </p>
              </>
            ) : (
              <p className="placeholder">
                Aucune basse mer disponible pour cette date.
              </p>
            )
          ) : (
            <p className="placeholder">Chargement des horaires de marée…</p>
          )}
        </section>

        </div>

        <h2 className="section-title" id="aujourdhui">Aujourd'hui</h2>

        <DailyBriefing
          now={now}
          weather={weather}
          marine={marine}
          upcoming={upcoming}
          lowTides={lowTides}
          departures={departures}
          trainDepartures={trainDepartures}
        />

        <VisitPlanner
          now={now}
          weather={weather}
          marine={marine}
          upcoming={upcoming}
          lowTides={lowTides}
          departures={departures}
          trainDepartures={trainDepartures}
          roadInfo={roadInfo}
          agenda={agenda}
        />

        <CinemaPax
          cinema={cinema}
          now={now}
          rainy={Boolean(weather && (weather.precipitation > 0 || weather.weatherCode >= 51))}
        />

        <section className="card card-wide">
          <div className="event-heading">
            <div>
              <h3>En ce moment sur la presqu'île</h3>
              {agenda.length > 0 && (
                <p className="event-summary">
                  {agenda.length} idées sorties, de la plage aux visites urbaines.
                </p>
              )}
            </div>
            <div className="event-source-links">
              <a href={MUNICIPAL_EVENTS_URL} target="_blank" rel="noopener noreferrer">
                Pouliguen
              </a>
              <a
                href="https://lecroisic.fr/fr/ev/748477/agenda-578"
                target="_blank"
                rel="noopener noreferrer"
              >
                Croisic
              </a>
              <a
                href={DESTINATION_AGENDA_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                destination
              </a>
            </div>
          </div>
          {agenda.length > 0 && (
            <div className="event-filters" role="tablist" aria-label="Filtrer les événements par ville">
              {AGENDA_CITY_FILTERS.filter((city) => {
                const count = agendaCounts.get(city) ?? 0;
                return city === "Tous" || count > 0 || agendaCity === city;
              }).map((city) => {
                const count = agendaCounts.get(city) ?? 0;
                return (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={agendaCity === city}
                    className={agendaCity === city ? "event-filter is-active" : "event-filter"}
                    key={city}
                    onClick={() => setAgendaCity(city)}
                    disabled={count === 0}
                  >
                    <span>{city}</span>
                    <em>{count}</em>
                  </button>
                );
              })}
            </div>
          )}
          {visibleAgenda.length > 0 ? (
            <ul className="events">
              {visibleAgenda.map((e, i) => (
                <li key={i}>
                  <div className="event-title-row">
                    {e.city && <span className="event-city">{e.city}</span>}
                    <a href={safeAgendaUrl(e)} target="_blank" rel="noopener noreferrer">
                      {e.title}
                    </a>
                  </div>
                  <div className="event-meta">
                    <span>{e.dateRange}</span>
                    {e.location && <span>{e.location}</span>}
                    <span>agenda officiel</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : fallbackEvents.length > 0 ? (
            <ul className="events">
              {fallbackEvents.map((e, i) => (
                <li key={i}>
                  <strong>{e.title}</strong>
                  <span>{e.when}</span>
                  <span>{e.where}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder">
              Aucun événement trouvé pour cette ville dans le flux actuel. Voir{" "}
              <a href={MUNICIPAL_EVENTS_URL} target="_blank" rel="noopener noreferrer">
                l'agenda municipal du Pouliguen
              </a>
              .
            </p>
          )}
        </section>

        <ComingDays
          now={selectedDate}
          weather={weather}
          agenda={agenda}
          extrema={extrema}
        />

        <h2 className="section-title" id="pratique">Vie pratique</h2>
        <div className="cards">

        <section className="card">
          <h3>Collecte des déchets</h3>
          {collections.length > 0 ? (
            <>
              <ul className="collections">
                {collections.map((c, i) => (
                  <li key={i}>
                    <span className={fluxBadgeClass(c.flux)}>{c.flux}</span>
                    <span className="collection-date">{c.dateTxt}</span>
                  </li>
                ))}
              </ul>
              {nearestGlass && (
                <p className="meta-line">
                  Colonne à verre la plus proche du centre : {nearestGlass.site}{" "}
                  ({(nearestGlass.distanceKm * 1000).toFixed(0)} m) ·{" "}
                  {glassPoints.length} points verre dans la commune.
                </p>
              )}
              <p className="meta-line">
                Toute la commune est en secteur unique : ces dates valent pour
                chaque adresse du Pouliguen (source Cap Atlantique).
              </p>
            </>
          ) : (
            <p className="placeholder">Chargement du calendrier de collecte…</p>
          )}
        </section>

        <section className="card">
          <div className="card-heading">
            <h3>Balades à pied et à vélo</h3>
            <div className="circuit-tabs" aria-label="Filtrer les balades">
              {[
                ["all", "Toutes"],
                ["rando", "À pied"],
                ["velo", "Vélo"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={circuitMode === mode ? "circuit-tab circuit-tab-active" : "circuit-tab"}
                  onClick={() => setCircuitMode(mode as CircuitMode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {featuredCircuit && (
            <div className="circuit-feature">
              <span className="circuit-kind">
                {featuredCircuit.kind === "velo" ? "vélo" : "à pied"}
              </span>
              <div>
                <strong>{featuredCircuit.name}</strong>
                <span>
                  {[featuredCircuit.km != null ? `${featuredCircuit.km} km` : null, featuredCircuit.duration]
                    .filter(Boolean)
                    .join(" · ")}
                  {featuredCircuit.communes.length > 0
                    ? ` · ${featuredCircuit.communes[0]}`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                className="circuit-map-btn"
                onClick={() => setSelectedCircuit(featuredCircuit.name)}
              >
                voir sur la carte
              </button>
            </div>
          )}
          {circuitTraces.length > 0 && selectedCircuit && (
            <PoiMap
              selectedLine={selectedCircuit}
              lines={circuitTraces
                .filter((t) => circuitMode === "all" || t.kind === circuitMode)
                .map((t) => ({
                  segments: t.segments,
                  color: t.kind === "velo" ? "#0b6396" : "#7a4a24",
                  title: t.name,
                  popupHtml:
                    `<div class="bus-popup"><h3>${escapeHtml(t.name)}</h3>` +
                    `<p>${t.kind === "velo" ? "Circuit vélo" : "Randonnée"}` +
                    (t.km != null ? ` · ${t.km} km` : "") +
                    `</p>` +
                    (t.pdf
                      ? `<a href="${escapeHtml(t.pdf)}" target="_blank" rel="noopener noreferrer">Fiche PDF du circuit</a>`
                      : "") +
                    `</div>`,
                }))}
            />
          )}
          {sortedCircuits.length > 0 ? (
            <ul className="circuits">
              {sortedCircuits.slice(0, 8).map((c, i) => (
                <li key={i}>
                  <span className="circuit-kind">
                    {c.kind === "velo" ? "vélo" : "à pied"}
                  </span>
                  <span className="circuit-name">
                    <button
                      type="button"
                      className="circuit-btn"
                      onClick={() => setSelectedCircuit(c.name)}
                    >
                      {c.name}
                    </button>
                    <span>
                      {[c.km != null ? `${c.km} km` : null, c.duration].filter(Boolean).join(" · ")}
                      {c.communes.length > 0 ? ` · ${c.communes[0]}` : ""}
                    </span>
                  </span>
                  {c.pdf && (
                    <a href={c.pdf} target="_blank" rel="noopener noreferrer">
                      fiche PDF
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder">Chargement des circuits…</p>
          )}
        </section>

        <section className="card">
          <h3>Urgences et défibrillateurs</h3>
          <p className="card-note emergency-lead">
            En cas d'urgence vitale, appelez d'abord le 15 ou le 112.
          </p>
          <div className="emergency-grid" aria-label="Numéros et lieux utiles en urgence">
            <a href="tel:15">
              <strong>15</strong>
              <span>SAMU · urgence médicale</span>
            </a>
            <a href="tel:112">
              <strong>112</strong>
              <span>urgence européenne</span>
            </a>
            <a href="tel:18">
              <strong>18</strong>
              <span>pompiers · incendie, accident</span>
            </a>
            <a href="tel:196">
              <strong>196</strong>
              <span>urgence en mer · CROSS / SNSM</span>
            </a>
            <a href="tel:0241482121">
              <strong>02 41 48 21 21</strong>
              <span>centre antipoison · Angers</span>
            </a>
            <a
              href="https://www.sante.fr/centre-hospitalier-ch/saint-nazaire/ch-saint-nazaire-cite-sanitaire/urgences-medicales"
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>Urgences hospitalières</strong>
              <span>CH Saint-Nazaire · 11 bd Georges Charpak</span>
            </a>
          </div>
          <p className="emergency-note">
            Plongée / suspicion d'accident de désaturation : appelez le 15 ou
            le 112, ou le 196 depuis le littoral pour une alerte en mer. Demandez
            une régulation médicale vers une prise en charge hyperbare.
          </p>
          {dae.length > 0 ? (
            <>
              <ul className="dae-list">
                {dae.slice(0, 5).map((d, i) => (
                  <li key={i}>
                    <strong>{d.label || "Défibrillateur"}</strong>
                    <span>à {(d.distanceKm * 1000).toFixed(0)} m du centre</span>
                  </li>
                ))}
              </ul>
              <p className="meta-line">
                {dae.length} défibrillateurs recensés dans la commune (source
                OpenStreetMap, liste non exhaustive).
              </p>
            </>
          ) : (
            <p className="placeholder">Chargement des défibrillateurs…</p>
          )}
        </section>

        <section className="card">
          <h3>Recharge de voiture électrique</h3>
          {chargers.length > 0 ? (
            <>
              <button
                type="button"
                className="map-toggle"
                onClick={() => toggleMap("chargers")}
                aria-expanded={Boolean(openMaps.chargers)}
              >
                {openMaps.chargers ? "masquer la carte" : "voir la carte des bornes"}
              </button>
              {openMaps.chargers && (
                <PoiMap
                  markers={chargers.slice(0, 25).map((c) => ({
                    lat: c.lat,
                    lon: c.lon,
                    label: "R",
                    color: "#1d6b43",
                    title: chargerLabel(c),
                    popupHtml:
                      `<div class="bus-popup"><h3>${escapeHtml(chargerLabel(c))}</h3>` +
                      (c.address ? `<p>${escapeHtml(c.address)}</p>` : "") +
                      `<p>${c.points} point${c.points > 1 ? "s" : ""} de charge` +
                      (c.maxPowerKw > 0 ? `, jusqu'à ${Math.round(c.maxPowerKw)} kW` : "") +
                      `</p>` +
                      (c.operator ? `<p class="pop-meta">${escapeHtml(c.operator)}</p>` : "") +
                      `</div>`,
                  }))}
                />
              )}
              <ul className="chargers">
                {chargers.slice(0, 5).map((c, i) => (
                  <li key={i}>
                    <strong>{chargerLabel(c)}</strong>
                    <span>
                      {c.points} point{c.points > 1 ? "s" : ""} ·{" "}
                      {c.maxPowerKw > 0 ? `jusqu'à ${Math.round(c.maxPowerKw)} kW · ` : ""}
                      à {c.distanceKm} km
                    </span>
                    <span className="charger-op">{c.operator}</span>
                  </li>
                ))}
              </ul>
              <p className="meta-line">
                Bornes publiques recensées au fichier national IRVE. La
                disponibilité en temps réel n'est pas publiée.
              </p>
            </>
          ) : (
            <p className="placeholder">Chargement des bornes de recharge…</p>
          )}
        </section>
        </div>
      </main>
        </>
      )}

      <footer>
        <p className="footer-legal">
          <strong>Clause de non-responsabilité</strong> : Les informations
          présentées (horaires, conditions météo, marée, événements) sont
          fournies à titre indicatif uniquement et ne dispensent pas de consulter
          les sources officielles (Météo-France, SHOM, transporteurs, autorités
          locales). En cas de situation dangereuse ou d'urgence, contactez
          les services compétents (15 ou 112).
        </p>
        <p className="footer-credits">
          Développé avec amour au Pouliguen par{" "}
          <a href="https://www.linkedin.com/in/berteloot/" target="_blank" rel="noopener noreferrer">
            Stan Berteloot
          </a>
          .
          Données : Open-Meteo (météo, mer), Lila Presqu'île et SNCF via
          transport.data.gouv.fr (bus, trains, temps réel), Cap Atlantique
          (plages, déchets, circuits, agenda), Département de
          Loire-Atlantique (info routes), OpenStreetMap (défibrillateurs),
          fichier national IRVE (bornes de recharge).
        </p>
      </footer>
    </div>
  );
}
