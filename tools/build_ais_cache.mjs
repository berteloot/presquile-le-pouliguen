#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outputPath = resolve(repoRoot, "web/public/data/offshore-ships.json");

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
    coverageLabel: "Baie du Pouliguen, rade de Saint-Nazaire et approche Donges",
    center: { lat: 47.255, lon: -2.49 },
    notes: ["Cache AIS généré automatiquement depuis AIS_CACHE_SOURCE_URL."],
    ships: rows,
  };
}

async function main() {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  const sourceUrl = process.env.AIS_CACHE_SOURCE_URL;
  const cache = sourceUrl ? await loadFromUrl(sourceUrl) : existing;

  cache.generatedAt = isoParisNow();
  cache.sourceMode = sourceUrl ? "api-cache" : cache.sourceMode ?? "static-cache";
  assertCacheShape(cache);

  await writeFile(outputPath, `${JSON.stringify(cache, null, 2)}\n`);
  console.log(
    `Wrote ${cache.ships.length} offshore ships to ${outputPath} (${cache.sourceMode})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
