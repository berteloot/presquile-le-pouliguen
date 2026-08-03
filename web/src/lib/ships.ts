import { LAT, LON } from "../config";

const SHIPS_DATA_URL = "/data/offshore-ships.json";

export type ShipStatusGroup = "Anchored" | "Underway" | "Working" | "Moored";
export type ShipTypeGroup = "Cargo" | "Tanker" | "Passenger" | "Fishing" | "Service" | "Other";

export interface ShipPortCall {
  name: string;
  country: string;
  unlocode?: string;
  departedAt?: string;
}

export interface OffshoreShip {
  mmsi: string;
  imo: string;
  name: string;
  callSign?: string;
  flagCountry: string;
  flagCode: string;
  vesselType: string;
  vesselTypeGroup: ShipTypeGroup;
  lengthM: number;
  beamM?: number;
  grossTonnage: number;
  deadweightTons?: number;
  speedKnots: number;
  headingDeg: number;
  courseDeg?: number;
  navStatus: string;
  statusGroup: ShipStatusGroup;
  destination: string;
  lastDeparturePort: ShipPortCall;
  eta?: string;
  anchorStartedAt?: string | null;
  position: {
    lat: number;
    lon: number;
  };
  updatedAt: string;
  areaName: string;
  cargoContext?: string;
  sourceConfidence: "high" | "medium" | "low";
}

export interface OffshoreShipCache {
  generatedAt: string;
  sourceMode: "static-cache" | "api-cache";
  coverageLabel: string;
  center: {
    lat: number;
    lon: number;
  };
  notes: string[];
  ships: OffshoreShip[];
}

export interface EnrichedShip extends OffshoreShip {
  flagEmoji: string;
  flagCountryLabel: string;
  distanceFromLePouliguenKm: number;
  distanceFromLaBauleKm: number;
  timeAtAnchorHours: number | null;
  voyageHours: number | null;
  isHorizonTarget: boolean;
  horizonScore: number;
  destinationLabel: string;
  destinationCodeLabel: string;
  aiSummary: string;
  whyHere: string;
  fact: string;
  coordinateLabel: string;
}

export interface OffshoreShipStats {
  count: number;
  anchoredCount: number;
  movingCount: number;
  averageWaitHours: number | null;
  largestShip: EnrichedShip | null;
  biggestTonnage: EnrichedShip | null;
}

const LA_BAULE = { lat: 47.2867, lon: -2.3908 };
const MERCHANT_NAME_HINT =
  /\b(abbey|aegean|arklow|atlantic|bomar|eagle|fighter|harbour|mimer|moraime|pioneer|tanker|uhl)\b/i;
const MERCHANT_DESTINATION_HINT = /\b(donges|donges|nantes|montoir|stm|frdon|frsmr|fr\s?mtx)\b/i;
const AIS_LOCATION_LABELS = new Map([
  ["NLAMS", "Amsterdam"],
  ["FRBOD", "Bordeaux"],
  ["FRDON", "Donges"],
  ["FRNTE", "Nantes"],
  ["FR MTX", "Montoir-de-Bretagne"],
  ["FRMTX", "Montoir-de-Bretagne"],
  ["FRSNR", "Saint-Nazaire"],
  ["DONGES", "Donges"],
  ["MONTOIR", "Montoir-de-Bretagne"],
  ["NANTES", "Nantes"],
  ["SAINT NAZAIRE", "Saint-Nazaire"],
  ["SAINT-NAZAIRE", "Saint-Nazaire"],
  ["SAINTNAZAIRE", "Saint-Nazaire"],
  ["ST NAZAIRE", "Saint-Nazaire"],
  ["STNAZAIRE", "Saint-Nazaire"],
  ["STNAZ", "Saint-Nazaire"],
  ["BREST", "Brest"],
  ["HOUAT", "Houat"],
  ["LA_TURBALLE", "La Turballe"],
  ["PBG OWF", "Parc éolien du banc de Guérande"],
  ["PBG WIND FARM", "Parc éolien du banc de Guérande"],
  ["PBG WINDFARM", "Parc éolien du banc de Guérande"],
  ["LOIRE ANCHORAGE", "Mouillage de Loire"],
  ["FOR ORDERS", "En attente d'ordres"],
  ["SEA TRIAL", "Essais en mer"],
  ["SAU", "Sauzon"],
  ["QUIB", "Quiberon"],
  ["HOU", "Houat"],
  ["HOE", "Hoedic"],
]);
const AIS_COUNTRY_PREFIXES = new Map([
  ["BE", "Belgique"],
  ["DE", "Allemagne"],
  ["DK", "Danemark"],
  ["ES", "Espagne"],
  ["FR", "France"],
  ["GB", "Royaume-Uni"],
  ["IE", "Irlande"],
  ["IT", "Italie"],
  ["NL", "Pays-Bas"],
  ["NO", "Norvège"],
  ["PT", "Portugal"],
  ["SE", "Suède"],
  ["US", "États-Unis"],
]);
const FLAG_COUNTRY_LABELS = new Map([
  ["Belgium", "Belgique"],
  ["Finland", "Finlande"],
  ["France", "France"],
  ["Germany", "Allemagne"],
  ["Greece", "Grèce"],
  ["Inconnu", "non transmis"],
  ["Ireland", "Irlande"],
  ["Malta", "Malte"],
  ["Netherlands", "Pays-Bas"],
  ["Portugal", "Portugal"],
  ["Singapore", "Singapour"],
  ["United Kingdom", "Royaume-Uni"],
]);

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursBetween(start: Date | null, end: Date): number | null {
  if (!start) return null;
  return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
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

function flagEmoji(code: string): string {
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "⚑";
  return String.fromCodePoint(
    ...cc.split("").map((char) => 127397 + char.charCodeAt(0)),
  );
}

function flagCountryLabel(country: string): string {
  return FLAG_COUNTRY_LABELS.get(country.trim()) ?? country;
}

export function formatHours(hours: number | null): string {
  if (hours == null) return "non connu";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  if (days <= 0) return `${Math.round(hours)} h`;
  if (rest === 0) return `${days} j`;
  return `${days} j ${rest} h`;
}

export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "non connue";
  return date.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

export function statusLabel(status: ShipStatusGroup): string {
  if (status === "Anchored") return "au mouillage";
  if (status === "Underway") return "en route";
  if (status === "Working") return "en opération";
  return "à quai";
}

function voyageLabel(hours: number | null): string {
  if (hours == null) return "depuis un port non confirmé";
  return `parti il y a ${formatHours(hours)}`;
}

function knownText(value: string | null | undefined): boolean {
  if (!value) return false;
  return !/^(undefined|null|non connu.*|non confirm.*|non déclar.*|unknown|n\/a)$/i.test(
    value.trim(),
  );
}

function normalizeAisLocation(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function displayAisLocation(value: string): string {
  return value.trim().replace(/_/g, " ").replace(/\s+/g, " ");
}

function decodeAisLocation(value: string): string {
  const clean = displayAisLocation(value);
  const normalized = normalizeAisLocation(clean);
  const directLabel = AIS_LOCATION_LABELS.get(normalized);
  if (directLabel) return directLabel;

  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  const compactLabel = AIS_LOCATION_LABELS.get(compact);
  if (compactLabel) return compactLabel;

  if (/^[A-Z]{2}[A-Z0-9]{3}$/.test(compact)) {
    const country = AIS_COUNTRY_PREFIXES.get(compact.slice(0, 2));
    return country ? `${compact} (${country})` : compact;
  }

  return clean;
}

export function decodeAisRoute(destination: string): string | null {
  const clean = destination.trim().replace(/\s+/g, " ");
  if (!knownText(clean)) return null;

  const separator =
    clean.includes("<>")
      ? "<>"
      : clean.includes(">")
        ? ">"
        : /^[A-Z0-9]{3,5}(?:-[A-Z0-9]{3,5})+$/.test(clean)
          ? "-"
          : null;
  if (!separator) return null;

  const route = clean
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
  if (route.length < 2) return null;

  return route.map(decodeAisLocation).join(" -> ");
}

export function decodeAisDestination(destination: string): string {
  const clean = destination.trim().replace(/\s+/g, " ");
  if (!knownText(clean)) return "destination non déclarée";
  return decodeAisRoute(clean) ?? decodeAisLocation(clean);
}

export function decodeAisDestinationWithCode(destination: string): string {
  const clean = destination.trim().replace(/\s+/g, " ");
  if (!knownText(clean)) return "destination non déclarée";

  const decoded = decodeAisDestination(clean);
  const readableCode = displayAisLocation(clean);
  if (decoded.toUpperCase() === readableCode.toUpperCase()) return decoded;

  return `${decoded} (${readableCode})`;
}

function destinationLabel(destination: string): string {
  return decodeAisDestination(destination);
}

function destinationContext(ship: OffshoreShip): string | null {
  if (!knownText(ship.destination)) return null;
  const destination = destinationLabel(ship.destination);
  if (/donges|frdon/i.test(destination)) {
    return "Donges concentre une partie des escales pétrolières de l'estuaire, avec des créneaux dépendants des quais, des marées et des pilotes.";
  }
  if (/montoir/i.test(destination)) {
    return "Montoir reçoit du vrac, du fret industriel et des marchandises spécialisées ; les navires attendent souvent leur fenêtre d'entrée dans l'estuaire.";
  }
  if (/éolien|eolien|wind/i.test(destination)) {
    return "Le parc éolien en mer de Saint-Nazaire crée un trafic de service : relève d'équipes, maintenance, matériel et inspections.";
  }
  if (/saint-nazaire|nantes|mouillage de loire/i.test(destination)) {
    return "L'accès à Nantes Saint-Nazaire se fait par un chenal piloté où la météo, la marée et la disponibilité des quais rythment les entrées.";
  }
  return null;
}

function buildSummary(ship: OffshoreShip, now: Date, distanceKm: number, wait: number | null) {
  const voyageHours = hoursBetween(toDate(ship.lastDeparturePort.departedAt), now);
  const departure = knownText(ship.lastDeparturePort.name)
    ? ` ${voyageLabel(voyageHours)} de ${ship.lastDeparturePort.name} (${ship.lastDeparturePort.country}).`
    : "";
  const destination = knownText(ship.destination)
    ? `, destination AIS ${destinationLabel(ship.destination)}`
    : "";
  const movement =
    ship.statusGroup === "Underway"
      ? `avance à ${ship.speedKnots.toFixed(1)} noeuds`
      : ship.statusGroup === "Working"
        ? `opère à ${ship.speedKnots.toFixed(1)} noeuds dans la zone`
        : wait == null
          ? "a un temps d'attente au mouillage non confirmé"
          : `attend au mouillage depuis ${formatHours(wait)}`;
  return (
    `${ship.name}, ${ship.vesselType.toLowerCase()} sous pavillon ${flagCountryLabel(ship.flagCountry)}, ` +
    `observé par AIS à environ ${distanceKm.toFixed(1)} km du Pouliguen.` +
    departure +
    ` Il ${movement}, cap ${Math.round(ship.headingDeg)}°${destination}.`
  );
}

function buildWhy(ship: OffshoreShip, wait: number | null) {
  const context = destinationContext(ship);
  if (!context) {
    if (ship.statusGroup === "Underway") {
      return "L'AIS indique un navire en route, mais sa destination n'est pas assez précise pour expliquer son passage avec certitude.";
    }
    if (ship.statusGroup === "Working") {
      return "L'AIS indique une opération dans la zone, sans destination ou mission assez détaillée pour confirmer le contexte.";
    }
    const waitText =
      wait != null ? ` depuis ${formatHours(wait)}` : "";
    return `L'AIS le montre au mouillage${waitText}, mais sans destination déclarée fiable. Le motif exact reste donc non confirmé.`;
  }
  const action =
    ship.statusGroup === "Underway"
      ? "Il est en approche et suit probablement la file d'entrée vers l'estuaire."
      : ship.statusGroup === "Working"
        ? "Il ne fait pas une simple escale commerciale : son statut indique une opération ou une manoeuvre spécialisée."
        : "";
  const waitText =
    wait != null && wait >= 12
      ? ` Son attente de ${formatHours(wait)} suggère une planification portuaire plutôt qu'un simple passage rapide.`
      : "";
  return `${action ? `${action} ` : ""}${context}${waitText}`;
}

function buildFact(ship: OffshoreShip, distanceKm: number, wait: number | null) {
  if (ship.grossTonnage >= 40000) {
    return `${ship.name} est le plus impressionnant à l'oeil nu : ${ship.lengthM} m et ${ship.grossTonnage.toLocaleString("fr-FR")} GT.`;
  }
  if (wait != null && wait >= 24) {
    const destination = knownText(ship.destination)
      ? `, destination AIS ${destinationLabel(ship.destination)}`
      : "";
    return `${ship.name} attend au mouillage depuis ${formatHours(wait)}, à ${distanceKm.toFixed(1)} km du Pouliguen${destination}.`;
  }
  if (ship.statusGroup === "Working") {
    return `${ship.name} raconte l'autre trafic de la baie : les navires de service liés au parc éolien.`;
  }
  if (!knownText(ship.destination)) {
    return `${ship.name} n'émet pas de destination AIS exploitable ; son contexte reste donc à confirmer.`;
  }
  return `${ship.name} déclare ${destinationLabel(ship.destination)} côté AIS, à ${distanceKm.toFixed(1)} km du Pouliguen.`;
}

function horizonScore(ship: OffshoreShip, distanceKm: number, distanceFromLaBauleKm: number): number {
  if (ship.statusGroup !== "Anchored") return 0;
  if (distanceKm < 8 || distanceKm > 32) return 0;
  if (ship.vesselTypeGroup === "Fishing" || ship.vesselTypeGroup === "Passenger") return 0;
  if (/sailing|pleasure/i.test(ship.vesselType)) return 0;

  let score = 30;
  if (distanceKm >= 12 && distanceKm <= 30) score += 10;
  if (ship.vesselTypeGroup === "Tanker") score += 80;
  if (ship.vesselTypeGroup === "Cargo") score += 58;
  if (ship.lengthM >= 140) score += 55;
  else if (ship.lengthM >= 100) score += 42;
  else if (ship.lengthM === 0 && ship.flagCode !== "FR") score += 22;
  if (MERCHANT_NAME_HINT.test(ship.name)) score += 24;
  if (MERCHANT_DESTINATION_HINT.test(ship.destination)) score += 20;
  score += Math.min(10, Math.max(0, Math.round(distanceFromLaBauleKm / 4)));
  if (ship.speedKnots <= 0.5) score += 10;
  return score;
}

export function enrichShip(ship: OffshoreShip, cacheTime: Date): EnrichedShip {
  const wait = hoursBetween(toDate(ship.anchorStartedAt), cacheTime);
  const voyageHours = hoursBetween(toDate(ship.lastDeparturePort.departedAt), cacheTime);
  const distanceFromLePouliguenKm = haversineKm(
    LAT,
    LON,
    ship.position.lat,
    ship.position.lon,
  );
  const distanceFromLaBauleKm = haversineKm(
    LA_BAULE.lat,
    LA_BAULE.lon,
    ship.position.lat,
    ship.position.lon,
  );
  const score = horizonScore(ship, distanceFromLePouliguenKm, distanceFromLaBauleKm);
  return {
    ...ship,
    flagEmoji: flagEmoji(ship.flagCode),
    flagCountryLabel: flagCountryLabel(ship.flagCountry),
    distanceFromLePouliguenKm,
    distanceFromLaBauleKm,
    timeAtAnchorHours: wait,
    voyageHours,
    isHorizonTarget: score >= 45,
    horizonScore: score,
    destinationLabel: destinationLabel(ship.destination),
    destinationCodeLabel: decodeAisDestinationWithCode(ship.destination),
    aiSummary: buildSummary(ship, cacheTime, distanceFromLePouliguenKm, wait),
    whyHere: buildWhy(ship, wait),
    fact: buildFact(ship, distanceFromLePouliguenKm, wait),
    coordinateLabel: `${ship.position.lat.toFixed(4)}, ${ship.position.lon.toFixed(4)}`,
  };
}

export function enrichShipCache(cache: OffshoreShipCache): EnrichedShip[] {
  const cacheTime = toDate(cache.generatedAt) ?? new Date();
  return cache.ships.map((ship) => enrichShip(ship, cacheTime));
}

export function offshoreShipStats(ships: EnrichedShip[]): OffshoreShipStats {
  const anchored = ships.filter((ship) => ship.statusGroup === "Anchored");
  const moving = ships.filter((ship) => ship.statusGroup === "Underway");
  const waits = anchored
    .map((ship) => ship.timeAtAnchorHours)
    .filter((value): value is number => value != null);
  return {
    count: ships.length,
    anchoredCount: anchored.length,
    movingCount: moving.length,
    averageWaitHours:
      waits.length > 0 ? waits.reduce((sum, value) => sum + value, 0) / waits.length : null,
    largestShip:
      ships
        .filter((ship) => ship.lengthM > 0)
        .sort((a, b) => b.lengthM - a.lengthM)[0] ?? null,
    biggestTonnage:
      ships
        .filter((ship) => ship.grossTonnage > 0)
        .sort((a, b) => b.grossTonnage - a.grossTonnage)[0] ?? null,
  };
}

export function uniqueShipTypes(ships: EnrichedShip[]): ShipTypeGroup[] {
  return Array.from(new Set(ships.map((ship) => ship.vesselTypeGroup))).sort();
}

export function uniqueShipStatuses(ships: EnrichedShip[]): ShipStatusGroup[] {
  return Array.from(new Set(ships.map((ship) => ship.statusGroup))).sort();
}

export async function fetchOffshoreShips(): Promise<OffshoreShipCache> {
  const response = await fetch(`${SHIPS_DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`offshore ships HTTP ${response.status}`);
  return (await response.json()) as OffshoreShipCache;
}
