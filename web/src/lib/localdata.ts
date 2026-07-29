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
        duration: null,
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
        duration: r.temps ? String(r.temps) : null,
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
