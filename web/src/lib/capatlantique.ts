// Live queries against the Cap Atlantique open data portal (OpenDataSoft
// Explore v2.1 API, CORS open). Everything is filtered server-side so the
// responses stay small.
import { LAT, LON } from "../config";

const BASE = "https://data.capatlantique.fr/api/explore/v2.1/catalog/datasets";
const COMMUNE = "Le Pouliguen";
const AGENDA_CITIES = [
  "Le Pouliguen",
  "Le Croisic",
  "Batz-sur-Mer",
  "Guérande",
  "La Baule-Escoublac",
  "Pornichet",
  "Saint-Nazaire",
];

export interface WasteCollection {
  date: string; // YYYY-MM-DD
  dateTxt: string;
  flux: string; // "Bac vert" | "Bac jaune" | ...
}

export interface GlassPoint {
  site: string;
  lat: number;
  lon: number;
  distanceKm: number;
}

export interface Beach {
  name: string;
  description: string;
  url: string | null;
  lat: number;
  lon: number;
}

export interface AgendaEvent {
  title: string;
  dateRange: string;
  location: string;
  city: string;
  url: string | null;
  startAt?: string;
  endAt?: string;
}

async function ods(dataset: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/${dataset}/records?${qs}`);
  if (!res.ok) throw new Error(`ODS ${dataset} HTTP ${res.status}`);
  return (await res.json()).results as Record<string, unknown>[];
}

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(),
  );
}

export async function fetchNextCollections(): Promise<WasteCollection[]> {
  const rows = await ods("244400610_calendrier_collecte_pap", {
    refine: `commune:"${COMMUNE}"`,
    where: `date_collecte>=date'${todayYmd()}'`,
    order_by: "date_collecte",
    select: "date_collecte,date_txt,flux",
    limit: "10",
  });
  const seen = new Set<string>();
  const out: WasteCollection[] = [];
  for (const r of rows) {
    const key = `${r.date_collecte}|${r.flux}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      date: String(r.date_collecte),
      dateTxt: String(r.date_txt),
      flux: String(r.flux),
    });
  }
  return out.slice(0, 6);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export async function fetchGlassPoints(): Promise<GlassPoint[]> {
  const rows = await ods("244400610_pav_col", {
    refine: `commune:"${COMMUNE}"`,
    where: `flux="Verre"`,
    select: "site,lat,long",
    limit: "50",
  });
  return rows
    .map((r) => ({
      site: String(r.site ?? ""),
      lat: Number(r.lat),
      lon: Number(r.long),
      distanceKm: haversineKm(LAT, LON, Number(r.lat), Number(r.long)),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export async function fetchBeaches(): Promise<Beach[]> {
  const rows = await ods("244400610_sites_baignade", {
    refine: `ville:"${COMMUNE}"`,
    select: "nom,descriptif,lien_site,latitude,longitude",
    limit: "10",
  });
  return rows.map((r) => ({
    name: String(r.nom ?? ""),
    description: String(r.descriptif ?? ""),
    url: r.lien_site ? String(r.lien_site) : null,
    lat: Number(r.latitude),
    lon: Number(r.longitude),
  }));
}

export async function fetchAgendaEvents(): Promise<AgendaEvent[]> {
  const rowsByCity = await Promise.all(
    AGENDA_CITIES.map((city) =>
      ods("244400610_publicevents_openagenda", {
        where: `lastdate_end>=now() AND location_city="${city}"`,
        order_by: "firstdate_begin",
        select: "title_fr,daterange_fr,location_name,location_city,canonicalurl,firstdate_begin,lastdate_end",
        limit: "8",
      }),
    ),
  );
  const seen = new Set<string>();
  const perCity = rowsByCity.map((rows) => {
    const events: AgendaEvent[] = [];
    for (const r of rows) {
      const title = String(r.title_fr ?? "");
      const city = String(r.location_city ?? "");
      const key = `${title}|${city}|${r.daterange_fr}`;
      if (!title || seen.has(key)) continue;
      seen.add(key);
      events.push({
        title,
        dateRange: String(r.daterange_fr ?? ""),
        location: String(r.location_name ?? ""),
        city,
        url: r.canonicalurl ? String(r.canonicalurl) : null,
        startAt: r.firstdate_begin ? String(r.firstdate_begin) : undefined,
        endAt: r.lastdate_end ? String(r.lastdate_end) : undefined,
      });
    }
    return events;
  });
  const out: AgendaEvent[] = [];
  for (let i = 0; i < 8; i++) {
    for (const events of perCity) {
      if (events[i]) out.push(events[i]);
    }
  }
  return out;
}
