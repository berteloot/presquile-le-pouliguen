#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outputPath = resolve(repoRoot, "web/public/data/offshore-ships.json");
const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const DEFAULT_AISSTREAM_SECONDS = 75;
const DEFAULT_BBOX = [
  [
    [47.03, -3.1],
    [47.56, -2.02],
  ],
];
const SAINT_NAZAIRE_BAY_BOUNDS = {
  minLat: 47.03,
  maxLat: 47.32,
  minLon: -2.66,
  maxLon: -2.02,
};
const DEFAULT_MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport",
];
const AIS_STATUS = new Map([
  [0, "En route au moteur"],
  [1, "Au mouillage"],
  [2, "Non maître de sa manoeuvre"],
  [3, "Manoeuvrabilité restreinte"],
  [4, "Contraint par son tirant d'eau"],
  [5, "Amarré"],
  [6, "Échoué"],
  [7, "En pêche"],
  [8, "À la voile"],
  [9, "Réservé HSC"],
  [10, "Réservé WIG"],
  [11, "Remorque arrière"],
  [12, "Remorque avant/arrière"],
  [13, "Réservé"],
  [14, "Aide à la navigation active"],
  [15, "Non défini"],
]);
const MID_COUNTRIES = new Map([
  ["205", ["Belgium", "BE"]],
  ["209", ["Cyprus", "CY"]],
  ["211", ["Germany", "DE"]],
  ["212", ["Cyprus", "CY"]],
  ["215", ["Malta", "MT"]],
  ["218", ["Germany", "DE"]],
  ["219", ["Denmark", "DK"]],
  ["224", ["Spain", "ES"]],
  ["225", ["Spain", "ES"]],
  ["226", ["France", "FR"]],
  ["227", ["France", "FR"]],
  ["228", ["France", "FR"]],
  ["229", ["Malta", "MT"]],
  ["230", ["Finland", "FI"]],
  ["231", ["Faroe Islands", "FO"]],
  ["232", ["United Kingdom", "GB"]],
  ["233", ["United Kingdom", "GB"]],
  ["234", ["United Kingdom", "GB"]],
  ["235", ["United Kingdom", "GB"]],
  ["237", ["Greece", "GR"]],
  ["239", ["Greece", "GR"]],
  ["240", ["Greece", "GR"]],
  ["241", ["Greece", "GR"]],
  ["244", ["Netherlands", "NL"]],
  ["245", ["Netherlands", "NL"]],
  ["246", ["Netherlands", "NL"]],
  ["247", ["Italy", "IT"]],
  ["248", ["Malta", "MT"]],
  ["249", ["Malta", "MT"]],
  ["250", ["Ireland", "IE"]],
  ["251", ["Iceland", "IS"]],
  ["255", ["Portugal", "PT"]],
  ["256", ["Malta", "MT"]],
  ["257", ["Norway", "NO"]],
  ["258", ["Norway", "NO"]],
  ["259", ["Norway", "NO"]],
  ["261", ["Poland", "PL"]],
  ["263", ["Portugal", "PT"]],
  ["265", ["Sweden", "SE"]],
  ["266", ["Sweden", "SE"]],
  ["269", ["Switzerland", "CH"]],
  ["271", ["Turkey", "TR"]],
  ["303", ["United States", "US"]],
  ["304", ["Antigua and Barbuda", "AG"]],
  ["305", ["Antigua and Barbuda", "AG"]],
  ["306", ["Netherlands", "NL"]],
  ["308", ["Bahamas", "BS"]],
  ["309", ["Bahamas", "BS"]],
  ["311", ["Bahamas", "BS"]],
  ["316", ["Canada", "CA"]],
  ["319", ["Cayman Islands", "KY"]],
  ["338", ["United States", "US"]],
  ["347", ["Martinique", "MQ"]],
  ["352", ["Panama", "PA"]],
  ["367", ["United States", "US"]],
  ["368", ["United States", "US"]],
  ["369", ["United States", "US"]],
  ["371", ["Panama", "PA"]],
  ["372", ["Panama", "PA"]],
  ["373", ["Panama", "PA"]],
  ["374", ["Panama", "PA"]],
  ["412", ["China", "CN"]],
  ["440", ["South Korea", "KR"]],
  ["431", ["Japan", "JP"]],
  ["477", ["Hong Kong", "HK"]],
  ["538", ["Marshall Islands", "MH"]],
  ["563", ["Singapore", "SG"]],
  ["564", ["Singapore", "SG"]],
  ["565", ["Singapore", "SG"]],
  ["566", ["Singapore", "SG"]],
  ["636", ["Liberia", "LR"]],
]);

function isoParisNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+02:00`;
}

function assertCacheShape(cache) {
  if (!cache || !Array.isArray(cache.ships)) {
    throw new Error("AIS cache must contain a ships array");
  }
  for (const ship of cache.ships) {
    for (const field of ["mmsi", "imo", "name", "flagCountry", "vesselType", "position"]) {
      if (ship[field] == null) throw new Error(`AIS ship is missing ${field}`);
    }
  }
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function knownText(value) {
  if (!value) return false;
  return !/^(undefined|null|non connu|non confirm|non déclar|unknown|n\/a)$/i.test(String(value).trim());
}

function isInSaintNazaireBay(position) {
  const lat = Number(position?.lat);
  const lon = Number(position?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return (
    lat >= SAINT_NAZAIRE_BAY_BOUNDS.minLat &&
    lat <= SAINT_NAZAIRE_BAY_BOUNDS.maxLat &&
    lon >= SAINT_NAZAIRE_BAY_BOUNDS.minLon &&
    lon <= SAINT_NAZAIRE_BAY_BOUNDS.maxLon
  );
}

function parseCsvEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseBoundingBoxes() {
  const raw = process.env.AISSTREAM_BBOX;
  if (!raw) return DEFAULT_BBOX;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    const nums = raw
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value));
    if (nums.length !== 4) {
      throw new Error("AISSTREAM_BBOX must be JSON or minLat,minLon,maxLat,maxLon");
    }
    return [
      [
        [nums[0], nums[1]],
        [nums[2], nums[3]],
      ],
    ];
  }
}

function countryFromMmsi(mmsi) {
  const mid = String(mmsi).slice(0, 3);
  const found = MID_COUNTRIES.get(mid);
  if (found) return { country: found[0], flagCode: found[1] };
  return { country: "Inconnu", flagCode: "" };
}

function statusFromCode(code, speedKnots) {
  const numeric = numberOrNull(code);
  const label = numeric == null ? null : AIS_STATUS.get(numeric);
  const speed = numberOrNull(speedKnots) ?? 0;
  if (numeric === 1) return { navStatus: label, statusGroup: "Anchored" };
  if (numeric === 5) return { navStatus: label, statusGroup: "Moored" };
  if ([2, 3, 4, 7, 11, 12, 14].includes(numeric)) {
    return { navStatus: label, statusGroup: "Working" };
  }
  if (numeric === 0 || speed >= 0.5) {
    return { navStatus: label ?? "En route", statusGroup: "Underway" };
  }
  if (speed < 0.5) {
    return { navStatus: label ?? "Immobile ou très lent", statusGroup: "Anchored" };
  }
  return { navStatus: label ?? "Non défini", statusGroup: "Underway" };
}

function typeFromCode(code) {
  const numeric = numberOrNull(code);
  if (numeric == null || numeric <= 0) {
    return { vesselType: "Navire AIS", vesselTypeGroup: "Other" };
  }
  if (numeric >= 70 && numeric <= 79) {
    return { vesselType: numeric === 79 ? "Cargo lourd ou spécialisé" : "Cargo", vesselTypeGroup: "Cargo" };
  }
  if (numeric >= 80 && numeric <= 89) {
    return { vesselType: "Tanker", vesselTypeGroup: "Tanker" };
  }
  if (numeric >= 60 && numeric <= 69) {
    return { vesselType: "Passenger ship", vesselTypeGroup: "Passenger" };
  }
  if (numeric === 30) return { vesselType: "Fishing vessel", vesselTypeGroup: "Fishing" };
  if ([31, 32, 50, 51, 52, 53, 54, 55, 58].includes(numeric)) {
    return { vesselType: "Service vessel", vesselTypeGroup: "Service" };
  }
  if ([36, 37].includes(numeric)) {
    return { vesselType: numeric === 36 ? "Sailing vessel" : "Pleasure craft", vesselTypeGroup: "Other" };
  }
  return { vesselType: `AIS type ${numeric}`, vesselTypeGroup: "Other" };
}

function normalizeHeading(value) {
  const heading = numberOrNull(value);
  if (heading == null || heading >= 360) return 0;
  return Math.max(0, heading);
}

function positionArea(lat, lon) {
  if (lat >= 47.45 && lon <= -2.55) return "Mor Braz / baie de Quiberon";
  if (lat >= 47.35 && lon <= -2.45) return "Secteur Vilaine - Morbihan";
  if (lon <= -2.75) return "Au large du Croisic / plateau du Four";
  if (lat < 47.18 && lon < -2.5) return "Sud-ouest de la baie du Pouliguen";
  if (lat < 47.18) return "Mouillage extérieur sud Loire";
  if (lon > -2.25) return "Estuaire de la Loire / Saint-Nazaire";
  if (lon > -2.35) return "Approche Saint-Nazaire";
  if (lat >= 47.2 && lat <= 47.31 && lon >= -2.5) {
    return "Baie du Pouliguen / La Baule";
  }
  return "Mouillage extérieur au large de La Baule";
}

function dimensionSum(dimension, aKey, bKey) {
  if (!dimension || typeof dimension !== "object") return null;
  const a = numberOrNull(dimension[aKey]);
  const b = numberOrNull(dimension[bKey]);
  if (a == null || b == null) return null;
  const sum = a + b;
  return sum > 0 ? sum : null;
}

function formatEta(rawEta) {
  if (!rawEta) return undefined;
  if (typeof rawEta === "string") return rawEta;
  if (typeof rawEta !== "object") return undefined;
  const month = numberOrNull(firstDefined(rawEta.Month, rawEta.month));
  const day = numberOrNull(firstDefined(rawEta.Day, rawEta.day));
  const hour = numberOrNull(firstDefined(rawEta.Hour, rawEta.hour)) ?? 0;
  const minute = numberOrNull(firstDefined(rawEta.Minute, rawEta.minute)) ?? 0;
  if (!month || !day) return undefined;
  const now = new Date();
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day, hour, minute));
  if (candidate.getTime() < now.getTime() - 30 * 24 * 3_600_000) {
    candidate.setUTCFullYear(candidate.getUTCFullYear() + 1);
  }
  return candidate.toISOString();
}

function dataText(data) {
  if (typeof data === "string") return Promise.resolve(data);
  if (data instanceof ArrayBuffer) return Promise.resolve(Buffer.from(data).toString("utf8"));
  if (Buffer.isBuffer(data)) return Promise.resolve(data.toString("utf8"));
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  return Promise.resolve(String(data));
}

function messageBody(envelope) {
  const message = envelope.Message ?? {};
  const type = envelope.MessageType;
  return (
    message[type] ??
    message.PositionReport ??
    message.StandardClassBPositionReport ??
    message.ExtendedClassBPositionReport ??
    message.ShipStaticData ??
    message.StaticDataReport ??
    {}
  );
}

function mergeStaticReport(record, body) {
  const reportA = body.ReportA ?? {};
  const reportB = body.ReportB ?? {};
  const dimension = firstDefined(body.Dimension, reportB.Dimension, reportA.Dimension);
  const shipTypeCode = numberOrNull(firstDefined(body.Type, body.ShipType, reportB.ShipType, reportB.Type));
  const lengthM = dimensionSum(dimension, "A", "B");
  const beamM = dimensionSum(dimension, "C", "D");
  record.imo = firstDefined(body.ImoNumber, body.IMO, body.Imo, record.imo);
  record.callSign = firstDefined(body.CallSign, reportA.CallSign, record.callSign);
  record.name = firstDefined(body.Name, body.ShipName, reportA.Name, record.name);
  record.destination = firstDefined(body.Destination, reportB.Destination, record.destination);
  record.eta = firstDefined(formatEta(body.Eta), formatEta(reportB.Eta), record.eta);
  record.shipTypeCode = shipTypeCode ?? record.shipTypeCode;
  record.lengthM = lengthM ?? record.lengthM;
  record.beamM = beamM ?? record.beamM;
}

function mergeAisstreamMessage(records, envelope) {
  const body = messageBody(envelope);
  const metadata = envelope.MetaData ?? envelope.Metadata ?? {};
  const mmsi = String(
    firstDefined(
      metadata.MMSI,
      metadata.Mmsi,
      body.UserID,
      body.UserId,
      body.MMSI,
      body.Mmsi,
      body.MmsiNumber,
    ) ?? "",
  ).trim();
  if (!mmsi) return;

  const record = records.get(mmsi) ?? { mmsi };
  const lat = numberOrNull(firstDefined(body.Latitude, body.Lat, metadata.latitude, metadata.Latitude));
  const lon = numberOrNull(firstDefined(body.Longitude, body.Lon, metadata.longitude, metadata.Longitude));
  const updatedAt = firstDefined(metadata.time_utc, metadata.TimeUtc, metadata.Timestamp, envelope.Time);

  record.name = firstDefined(metadata.ShipName, metadata.Shipname, body.Name, body.ShipName, record.name);
  record.speedKnots = numberOrNull(firstDefined(body.Sog, body.SOG, body.SpeedOverGround, record.speedKnots));
  record.courseDeg = numberOrNull(firstDefined(body.Cog, body.COG, body.CourseOverGround, record.courseDeg));
  record.headingDeg = numberOrNull(firstDefined(body.TrueHeading, body.Heading, body.Cog, record.headingDeg));
  record.navStatusCode = numberOrNull(firstDefined(body.NavigationalStatus, body.NavigationStatus, record.navStatusCode));
  record.shipTypeCode = numberOrNull(firstDefined(body.Type, body.ShipType, record.shipTypeCode));
  record.updatedAt = updatedAt ?? record.updatedAt;

  if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    record.position = { lat, lon };
  }

  if (["ShipStaticData", "StaticDataReport"].includes(envelope.MessageType)) {
    mergeStaticReport(record, body);
  }

  records.set(mmsi, record);
}

function captureAisstream({ apiKey, seconds, existing }) {
  if (typeof WebSocket !== "function") {
    throw new Error("This Node runtime does not provide WebSocket. Use Node 22+.");
  }

  const boundingBoxes = parseBoundingBoxes();
  const messageTypes = parseCsvEnv("AISSTREAM_MESSAGE_TYPES", DEFAULT_MESSAGE_TYPES);
  const records = new Map();

  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const socket = new WebSocket(AISSTREAM_URL);
    const closeSocket = () => {
      try {
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      } catch {
        // The capture is already done; cleanup should never make the cache fail.
      }
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      closeSocket();
      resolvePromise(buildAisstreamCache(records, existing, seconds, boundingBoxes));
    };
    const rejectOnce = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      closeSocket();
      reject(err);
    };
    const timeout = setTimeout(resolveOnce, seconds * 1000);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: boundingBoxes,
          FilterMessageTypes: messageTypes,
        }),
      );
    });

    socket.addEventListener("message", async (event) => {
      try {
        const text = await dataText(event.data);
        const payload = JSON.parse(text);
        if (payload.error || payload.Error) {
          rejectOnce(new Error(payload.error ?? payload.Error));
          return;
        }
        mergeAisstreamMessage(records, payload);
      } catch (err) {
        console.warn(`Skipping AISstream message: ${err.message}`);
      }
    });

    socket.addEventListener("error", () => {
      rejectOnce(new Error("AISstream WebSocket error"));
    });

    socket.addEventListener("close", () => {
      resolveOnce();
    });
  });
}

function buildAisstreamCache(records, existing, seconds, boundingBoxes) {
  const generatedAt = isoParisNow();
  const previous =
    existing?.sourceMode === "api-cache"
      ? new Map(existing.ships.map((ship) => [String(ship.mmsi), ship]))
      : new Map();

  const ships = Array.from(records.values())
    .filter((record) => record.position)
    .filter((record) => isInSaintNazaireBay(record.position))
    .map((record) => {
      const { country, flagCode } = countryFromMmsi(record.mmsi);
      const speedKnots = record.speedKnots ?? 0;
      const status = statusFromCode(record.navStatusCode, speedKnots);
      const previousShip = previous.get(String(record.mmsi));
      const currentType = typeFromCode(record.shipTypeCode);
      const type =
        currentType.vesselType === "Navire AIS" &&
        previousShip?.vesselType &&
        previousShip.vesselType !== "Navire AIS"
          ? {
              vesselType: previousShip.vesselType,
              vesselTypeGroup: previousShip.vesselTypeGroup,
            }
          : currentType;
      const name = String(
        firstDefined(
          record.name,
          previousShip && !/^MMSI\s/i.test(previousShip.name) ? previousShip.name : undefined,
          `MMSI ${record.mmsi}`,
        ),
      ).trim();
      const destination = String(
        firstDefined(
          knownText(record.destination) ? record.destination : undefined,
          knownText(previousShip?.destination) ? previousShip.destination : undefined,
          "Non déclarée",
        ),
      ).trim();
      const isStillAnchored =
        status.statusGroup === "Anchored" && previousShip?.statusGroup === "Anchored";
      const anchorStartedAt =
        status.statusGroup === "Anchored"
          ? isStillAnchored
            ? previousShip.anchorStartedAt ?? previousShip.updatedAt
            : null
          : null;

      return {
        mmsi: String(record.mmsi),
        imo: knownText(record.imo)
          ? String(record.imo).trim()
          : knownText(previousShip?.imo)
            ? String(previousShip.imo).trim()
            : "",
        name,
        callSign: firstDefined(
          knownText(record.callSign) ? record.callSign : undefined,
          knownText(previousShip?.callSign) ? previousShip.callSign : undefined,
        ),
        flagCountry: country,
        flagCode,
        vesselType: type.vesselType,
        vesselTypeGroup: type.vesselTypeGroup,
        lengthM: record.lengthM ?? previousShip?.lengthM ?? 0,
        beamM: record.beamM ?? previousShip?.beamM,
        grossTonnage: record.grossTonnage ?? previousShip?.grossTonnage ?? 0,
        deadweightTons: previousShip?.deadweightTons,
        speedKnots,
        headingDeg: normalizeHeading(record.headingDeg ?? record.courseDeg),
        courseDeg: record.courseDeg,
        navStatus: status.navStatus,
        statusGroup: status.statusGroup,
        destination,
        lastDeparturePort: previousShip?.lastDeparturePort ?? {
          name: "Non connu",
          country: "non confirmé",
        },
        eta: record.eta ?? previousShip?.eta,
        anchorStartedAt,
        position: record.position,
        updatedAt: record.updatedAt ?? generatedAt,
        areaName: positionArea(record.position.lat, record.position.lon),
        cargoContext:
          "Position AIS réelle captée en direct ; détails statiques conservés par MMSI quand AISstream les transmet.",
        sourceConfidence: "high",
      };
    })
    .sort((a, b) => {
      const statusA = a.statusGroup === "Anchored" ? 0 : 1;
      const statusB = b.statusGroup === "Anchored" ? 0 : 1;
      return statusA - statusB || a.name.localeCompare(b.name, "fr");
    });

  return {
    generatedAt,
    sourceMode: "api-cache",
    coverageLabel: "Baie de Saint-Nazaire : La Baule, Le Pouliguen, mouillages Loire/Donges",
    center: { lat: 47.21, lon: -2.36 },
    notes: [
      `Cache AISstream généré depuis une capture WebSocket de ${seconds} s.`,
      `Zone AISstream: ${JSON.stringify(boundingBoxes)}.`,
      "Affichage filtré à la baie de Saint-Nazaire ; Mor Braz, Vilaine, Houat et Quiberon sont exclus.",
      "Positions, vitesse, cap et statut proviennent du flux AIS live lorsque transmis.",
      "IMO, destination, dimensions et ETA sont conservés par MMSI dès qu'un message statique AIS les fournit.",
      "Port précédent et historique long nécessitent toujours une source AIS historique externe.",
    ],
    ships,
  };
}

async function loadFromUrl(url) {
  const res = await fetch(url, {
    headers: process.env.AIS_API_KEY
      ? { Authorization: `Bearer ${process.env.AIS_API_KEY}` }
      : undefined,
  });
  if (!res.ok) throw new Error(`AIS source HTTP ${res.status}`);
  const payload = await res.json();

  // Preferred: upstream already returns this app's cache schema.
  if (Array.isArray(payload.ships)) return payload;

  // Minimal adapter for providers that return records/results.
  const rows = payload.results ?? payload.records ?? payload.data;
  if (!Array.isArray(rows)) {
    throw new Error("AIS source did not return ships, results, records or data");
  }

  return {
    generatedAt: isoParisNow(),
    sourceMode: "api-cache",
    coverageLabel: "Baie de Saint-Nazaire : La Baule, Le Pouliguen, mouillages Loire/Donges",
    center: { lat: 47.21, lon: -2.36 },
    notes: [
      "Cache AIS généré automatiquement depuis AIS_CACHE_SOURCE_URL.",
      "Affichage filtré à la baie de Saint-Nazaire ; Mor Braz, Vilaine, Houat et Quiberon sont exclus.",
    ],
    ships: rows.filter((ship) => isInSaintNazaireBay(ship.position)),
  };
}

async function main() {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  const sourceUrl = process.env.AIS_CACHE_SOURCE_URL;
  const aisstreamKey = process.env.AISSTREAM_API_KEY;
  const seconds = Number(process.env.AISSTREAM_SECONDS ?? DEFAULT_AISSTREAM_SECONDS);
  let cache;
  try {
    cache = aisstreamKey
      ? await captureAisstream({
          apiKey: aisstreamKey,
          seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_AISSTREAM_SECONDS,
          existing,
        })
      : sourceUrl
        ? await loadFromUrl(sourceUrl)
        : existing;
  } catch (err) {
    if ((aisstreamKey || sourceUrl) && existing.ships?.length > 0) {
      console.warn(`AIS refresh failed (${err.message}); keeping existing cache.`);
      cache = existing;
    } else {
      throw err;
    }
  }

  if ((aisstreamKey || sourceUrl) && cache.ships.length === 0 && existing.ships?.length > 0) {
    console.log(
      "AIS refresh returned 0 ships in the Saint-Nazaire bay filter; keeping existing cache.",
    );
    cache = existing;
  }

  cache.generatedAt = cache.generatedAt ?? isoParisNow();
  cache.sourceMode = aisstreamKey || sourceUrl ? "api-cache" : cache.sourceMode ?? "static-cache";
  assertCacheShape(cache);

  await writeFile(outputPath, `${JSON.stringify(cache, null, 2)}\n`);
  console.log(
    `Wrote ${cache.ships.length} offshore ships to ${outputPath} (${cache.sourceMode})`,
  );
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
