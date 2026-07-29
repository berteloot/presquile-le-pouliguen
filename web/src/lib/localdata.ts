// Road disruptions (live, département), walking and cycling circuits (live,
// Cap Atlantique), defibrillators and EV chargers (build-time JSON).
import { LAT, LON } from "../config";

const LA_BASE =
  "https://data.loire-atlantique.fr/api/explore/v2.1/catalog/datasets";
const CAP_BASE =
  "https://data.capatlantique.fr/api/explore/v2.1/catalog/datasets";

export interface RoadInfo {
  nature: string;
  lines: string[];
  publishedAt: string;
  distanceKm: number;
}

export interface Circuit {
  name: string;
  kind: "rando" | "velo";
  communes: string[];
  km: number | null;
  duration: string | null;
  pdf: string | null;
}

export interface DaePoint {
  lat: number;
  lon: number;
  label: string;
  distanceKm: number;
}

export interface ChargerStation {
  name: string;
  operator: string;
  address: string;
  lat: number;
  lon: number;
  points: number;
  maxPowerKw: number;
  distanceKm: number;
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

/** Live departmental road disruptions within reach of the peninsula. */
export async function fetchRoadInfo(maxKm = 25): Promise<RoadInfo[]> {
  const res = await fetch(
    `${LA_BASE}/224400028_info-route-departementale/records?limit=60`,
  );
  if (!res.ok) throw new Error(`road info HTTP ${res.status}`);
  const rows = (await res.json()).results as Record<string, unknown>[];
  const out: RoadInfo[] = [];
  for (const r of rows) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const distanceKm = haversineKm(LAT, LON, lat, lon);
    if (distanceKm > maxKm) continue;
    const lines = [r.ligne1, r.ligne3, r.ligne4, r.ligne5]
      .flat()
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    out.push({
      nature: String(r.nature ?? ""),
      lines,
      publishedAt: String(r.datepublication ?? ""),
      distanceKm: Math.round(distanceKm * 10) / 10,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

const NEARBY = new Set([
  "LE POULIGUEN",
  "BATZ-SUR-MER",
  "LA BAULE-ESCOUBLAC",
  "LE CROISIC",
  "GUERANDE",
  "GUÉRANDE",
]);

function formatDuration(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  if (/\d+h/i.test(text)) return text.replace(/\s+/g, "");
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

export async function fetchCircuits(): Promise<Circuit[]> {
  const [randoRes, veloRes] = await Promise.all([
    fetch(
      `${CAP_BASE}/244400610_circuits-rando/records?select=nom,commune,kilometre,temps,fiche&limit=60`,
    ),
    fetch(
      `${CAP_BASE}/244400610_itineraires_cyclables/records?select=nom,commune,kilometre,temps,fiche&limit=30`,
    ),
  ]);
  const out: Circuit[] = [];
  if (randoRes.ok) {
    for (const r of ((await randoRes.json()).results ?? []) as Record<string, unknown>[]) {
      const communes = ([] as string[]).concat((r.commune as string[] | string) ?? []);
      if (!communes.some((c) => NEARBY.has(c.toUpperCase()))) continue;
      out.push({
        name: String(r.nom ?? ""),
        kind: "rando",
        communes,
        km: r.kilometre != null ? Math.round(Number(r.kilometre) / 100) / 10 : null,
        duration: formatDuration(r.temps),
        pdf: r.fiche ? String(r.fiche) : null,
      });
    }
  }
  if (veloRes.ok) {
    for (const r of ((await veloRes.json()).results ?? []) as Record<string, unknown>[]) {
      const communes = ([] as string[]).concat((r.commune as string[] | string) ?? []);
      if (!communes.some((c) => NEARBY.has(c.toUpperCase()))) continue;
      out.push({
        name: String(r.nom ?? "").replace(/^\d+_/, ""),
        kind: "velo",
        communes,
        km: r.kilometre != null ? Number(r.kilometre) : null,
        duration: formatDuration(r.temps),
        pdf: r.fiche ? String(r.fiche) : null,
      });
    }
  }
  return out;
}

export interface CircuitTrace {
  name: string;
  kind: "rando" | "velo";
  km: number | null;
  pdf: string | null;
  /** One coordinate list per segment; segments must not be concatenated
      or the map draws straight jump lines between them. */
  segments: [number, number][][];
}

export interface BikeParking {
  street: string;
  commune: string;
  furniture: string;
  covered: boolean;
  capacity: number;
  lat: number;
  lon: number;
  distanceKm: number;
}

export interface BikeSegment {
  name: string;
  commune: string;
  arrangement: string;
  lengthM: number;
  updatedAt: string;
  distanceKm: number;
}

export interface BikeShareStation {
  name: string;
  lat: number;
  lon: number;
  capacity: number;
  bikesAvailable: number;
  docksAvailable: number;
  rentalUrl: string | null;
  distanceKm: number;
}

function extractSegments(geo: unknown): [number, number][][] {
  const g = (geo as { geometry?: { type?: string; coordinates?: unknown } })
    ?.geometry;
  if (!g) return [];
  let lines: unknown[] = [];
  if (g.type === "LineString") lines = [g.coordinates];
  else if (g.type === "MultiLineString") lines = g.coordinates as unknown[];
  const out: [number, number][][] = [];
  for (const line of lines) {
    const pts = line as [number, number][];
    const seg: [number, number][] = [];
    for (let i = 0; i < pts.length; i += 3) {
      seg.push([pts[i][1], pts[i][0]]);
    }
    if (seg.length >= 2) out.push(seg);
  }
  return out;
}

function nearbyWhere(field = "commune"): string {
  return Array.from(NEARBY)
    .map((commune) => `${field}="${commune}"`)
    .join(" OR ");
}

/** Route geometries for the circuits close to town, for the map. */
export async function fetchCircuitTraces(): Promise<CircuitTrace[]> {
  const communes = [
    "LE POULIGUEN",
    "BATZ-SUR-MER",
    "LA BAULE-ESCOUBLAC",
    "GUERANDE",
  ];
  const requests: Promise<Response>[] = [];
  for (const c of communes) {
    const refine = encodeURIComponent(`commune:"${c}"`);
    requests.push(
      fetch(
        `${CAP_BASE}/244400610_circuits-rando/records?select=nom,kilometre,fiche,geo_shape&refine=${refine}&limit=20`,
      ),
      fetch(
        `${CAP_BASE}/244400610_itineraires_cyclables/records?select=nom,kilometre,fiche,geo_shape&refine=${refine}&limit=20`,
      ),
    );
  }
  const responses = await Promise.all(requests);
  const seen = new Set<string>();
  const out: CircuitTrace[] = [];
  for (let i = 0; i < responses.length; i++) {
    const res = responses[i];
    if (!res.ok) continue;
    const kind: "rando" | "velo" = i % 2 === 0 ? "rando" : "velo";
    for (const r of ((await res.json()).results ?? []) as Record<string, unknown>[]) {
      const name = String(r.nom ?? "").replace(/^\d+_/, "");
      if (!name || seen.has(name)) continue;
      const segments = extractSegments(r.geo_shape);
      if (segments.length === 0) continue;
      seen.add(name);
      const rawKm = r.kilometre != null ? Number(r.kilometre) : null;
      out.push({
        name,
        kind,
        // The rando dataset stores metres in its "kilometre" field.
        km:
          rawKm == null
            ? null
            : kind === "rando"
              ? Math.round(rawKm / 100) / 10
              : rawKm,
        pdf: r.fiche ? String(r.fiche) : null,
        segments,
      });
    }
  }
  return out;
}

export async function fetchBikeParking(maxKm = 12): Promise<BikeParking[]> {
  const select = encodeURIComponent("nom_voie,commune,mobilier,couverture,capacite,geo_point_2d");
  const res = await fetch(
    `${CAP_BASE}/244400610_stationnement_velo/records?select=${select}&limit=100`,
  );
  if (!res.ok) throw new Error(`bike parking HTTP ${res.status}`);
  return ((await res.json()).results ?? [])
    .map((r: Record<string, unknown>) => {
      const point = r.geo_point_2d as { lat?: number; lon?: number } | undefined;
      const lat = Number(point?.lat);
      const lon = Number(point?.lon);
      return {
        street: String(r.nom_voie ?? "Stationnement vélo"),
        commune: String(r.commune ?? ""),
        furniture: String(r.mobilier ?? ""),
        covered: /oui/i.test(String(r.couverture ?? "")),
        capacity: Number(r.capacite ?? 0),
        lat,
        lon,
        distanceKm: haversineKm(LAT, LON, lat, lon),
      };
    })
    .filter((p: BikeParking) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.distanceKm <= maxKm)
    .sort((a: BikeParking, b: BikeParking) => a.distanceKm - b.distanceKm);
}

export async function fetchBikeSegments(maxKm = 12): Promise<BikeSegment[]> {
  const where = encodeURIComponent(nearbyWhere());
  const select = encodeURIComponent("nom,commune,longueur,amenagemen,date_maj,geo_point_2d");
  const res = await fetch(
    `${CAP_BASE}/244400610_itineraires_velo/records?select=${select}&where=${where}&limit=100`,
  );
  if (!res.ok) throw new Error(`bike segments HTTP ${res.status}`);
  return ((await res.json()).results ?? [])
    .map((r: Record<string, unknown>) => {
      const point = r.geo_point_2d as { lat?: number; lon?: number } | undefined;
      const lat = Number(point?.lat);
      const lon = Number(point?.lon);
      return {
        name: String(r.nom ?? "Itinéraire vélo"),
        commune: String(r.commune ?? ""),
        arrangement: String(r.amenagemen ?? "aménagement non précisé"),
        lengthM: Number(r.longueur ?? 0),
        updatedAt: String(r.date_maj ?? ""),
        distanceKm: haversineKm(LAT, LON, lat, lon),
      };
    })
    .filter((s: BikeSegment) => Number.isFinite(s.distanceKm) && s.distanceKm <= maxKm)
    .sort((a: BikeSegment, b: BikeSegment) => a.distanceKm - b.distanceKm);
}

export async function fetchBikeShareStations(maxKm = 14): Promise<BikeShareStation[]> {
  const res = await fetch(
    `${CAP_BASE}/21440055800018_ecovelo_velo_baulois_station_information/records?select=name,lat,lon,capacity,joint_num_vehicles_available,joint_num_docks_available,rental_uris&limit=40`,
  );
  if (!res.ok) throw new Error(`bike share HTTP ${res.status}`);
  return ((await res.json()).results ?? [])
    .map((r: Record<string, unknown>) => {
      const lat = Number(r.lat);
      const lon = Number(r.lon);
      let rentalUrl: string | null = null;
      try {
        rentalUrl = JSON.parse(String(r.rental_uris ?? "{}")).web ?? null;
      } catch {
        rentalUrl = null;
      }
      return {
        name: String(r.name ?? "Station Vélo Baulois").replace(/^\[\s*|\s*\]$/g, ""),
        lat,
        lon,
        capacity: Number(r.capacity ?? 0),
        bikesAvailable: Number(r.joint_num_vehicles_available ?? 0),
        docksAvailable: Number(r.joint_num_docks_available ?? 0),
        rentalUrl,
        distanceKm: haversineKm(LAT, LON, lat, lon),
      };
    })
    .filter((s: BikeShareStation) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.distanceKm <= maxKm)
    .sort((a: BikeShareStation, b: BikeShareStation) => a.distanceKm - b.distanceKm);
}

export async function fetchDae(): Promise<DaePoint[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/dae.json`);
  if (!res.ok) throw new Error(`dae HTTP ${res.status}`);
  return (await res.json()).items as DaePoint[];
}

/** Some IRVE records carry raw technical ids as station names. */
export function chargerLabel(c: ChargerStation): string {
  const looksTechnical =
    !c.name || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(c.name);
  return looksTechnical ? c.address || "Borne de recharge" : c.name;
}

export async function fetchChargers(): Promise<ChargerStation[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/chargers.json`);
  if (!res.ok) throw new Error(`chargers HTTP ${res.status}`);
  return (await res.json()).items as ChargerStation[];
}
