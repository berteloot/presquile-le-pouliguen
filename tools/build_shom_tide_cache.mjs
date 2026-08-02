import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ = "Europe/Paris";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../web/public/data/shom-tides.json");
const baseUrl = "https://services.data.shom.fr/spm";
const accessKey = process.env.SHOM_ACCESS_KEY ?? process.env.SHOM_KEY ?? "";
const username = process.env.SHOM_USERNAME ?? "";
const password = process.env.SHOM_PASSWORD ?? "";
const harbor = process.env.SHOM_HARBOR ?? "LE_POULIGUEN";
const harborName = process.env.SHOM_HARBOR_NAME ?? "Le Pouliguen";
const durationDays = Number.parseInt(process.env.SHOM_DURATION_DAYS ?? "4", 10);

function parisDateYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function localIso(dateYmd, timeHm) {
  const [year, month, day] = dateYmd.split("-").map(Number);
  const [hour, minute] = timeHm.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function emptyCache(note) {
  return {
    generatedAt: new Date().toISOString(),
    sourceMode: "not-configured",
    harbor: {
      cst: harbor,
      name: harborName,
    },
    coverage: {
      startDate: parisDateYmd(),
      durationDays: 0,
    },
    notes: [note],
    events: [],
  };
}

async function keepExistingCacheOrEmpty(note) {
  try {
    await readFile(outPath, "utf8");
    console.log("SHOM credentials are missing; keeping existing tide cache.");
    return null;
  } catch {
    return emptyCache(note);
  }
}

function authHeaders() {
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

async function shomFetch(pathname, params = {}, options = {}) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`SHOM HTTP ${res.status}: ${body.slice(0, 240)}`);
  }
  return body;
}

function extractOrderId(text) {
  const clean = text.trim();
  const spm = clean.match(/SPM_\d{8,}/i)?.[0];
  if (spm) return spm.toUpperCase();
  const numeric = clean.match(/\b\d{8,}\b/)?.[0];
  if (numeric) return `SPM_${numeric}`;
  throw new Error(`Could not read SHOM order id from response: ${clean.slice(0, 240)}`);
}

function normalizeDate(match) {
  if (match.year) return `${match.year}-${match.month}-${match.day}`;
  return `${match.year2}-${match.month2}-${match.day2}`;
}

function parseNumber(value) {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEventsFromText(text) {
  const flattened = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ");
  const lines = flattened.split(/\n|(?=\b\d{4}-\d{2}-\d{2}\b)|(?=\b\d{2}\/\d{2}\/\d{4}\b)/);
  const events = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const dateMatch =
      line.match(/(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/) ??
      line.match(/(?<day2>\d{2})\/(?<month2>\d{2})\/(?<year2>\d{4})/);
    const timeMatch = line.match(/\b(?<time>[0-2]?\d:[0-5]\d)\b/);
    if (!dateMatch?.groups || !timeMatch?.groups) continue;

    const lower = line.toLowerCase();
    const type = /\b(basse|bm|low)\b/.test(lower)
      ? "low"
      : /\b(haute|pleine|pm|high)\b/.test(lower)
        ? "high"
        : null;
    if (!type) continue;

    const height =
      parseNumber(line.match(/(?:hauteur|height|niveau|water level)[^\d-]*(-?\d{1,2}(?:[,.]\d{1,3})?)/i)?.[1]) ??
      parseNumber(line.match(/\b(-?\d{1,2}(?:[,.]\d{1,3})?)\s*m\b/i)?.[1]);
    const coefficient = parseNumber(
      line.match(/\b(?:coef\.?|coefficient)[^\d]*(\d{1,3})\b/i)?.[1],
    );

    const dateYmd = normalizeDate(dateMatch.groups);
    events.push({
      type,
      time: localIso(dateYmd, timeMatch.groups.time.padStart(5, "0")),
      localDate: dateYmd,
      localTime: timeMatch.groups.time.padStart(5, "0"),
      heightM: height,
      coefficient,
    });
  }

  const seen = new Set();
  return events
    .filter((event) => {
      const key = `${event.type}:${event.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

async function extractZipText(zipBuffer) {
  const tempDir = await mkdtemp(join(tmpdir(), "shom-tides-"));
  const zipPath = join(tempDir, "commande.zip");
  try {
    await writeFile(zipPath, zipBuffer);
    const list = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const usefulFiles = list.filter((name) => /\.(txt|xml|csv)$/i.test(name));
    const buffers = usefulFiles.map((name) => execFileSync("unzip", ["-p", zipPath, name]));
    return buffers.map((buffer) => new TextDecoder("utf-8").decode(buffer)).join("\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function downloadOrder(orderId) {
  const downloadUrl = `${baseUrl.replace(/\/spm$/, "")}/${accessKey}/telechargement/spm/${orderId}/file/commande.zip`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(downloadUrl, { headers: authHeaders() });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt === 6) {
      const body = await res.text().catch(() => "");
      throw new Error(`SHOM download HTTP ${res.status}: ${body.slice(0, 240)}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 5000));
  }
  throw new Error("SHOM download failed");
}

async function buildCache() {
  if (!accessKey || !username || !password) {
    return keepExistingCacheOrEmpty(
      "SHOM credentials are missing; Open-Meteo Marine fallback remains active.",
    );
  }

  await shomFetch(`/${accessKey}/spm/checkaccess`);
  const startDate = parisDateYmd();
  const orderText = await shomFetch(
    `/${accessKey}/spm`,
    {
      harborName: harbor,
      functions: "hlt",
      utc: "legale",
      date: startDate,
      duration: durationDays,
      correlation: 1,
    },
    { method: "POST" },
  );
  const orderId = extractOrderId(orderText);
  const zipBuffer = await downloadOrder(orderId);
  const text = await extractZipText(zipBuffer);
  const events = parseEventsFromText(text);
  if (events.length === 0) {
    throw new Error("SHOM response was downloaded but no tide events could be parsed.");
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceMode: "shom-cache",
    provider: "SHOM SUP Maree",
    harbor: {
      cst: harbor,
      name: harborName,
    },
    coverage: {
      startDate,
      durationDays,
    },
    notes: [
      "Static cache generated server-side from SHOM tide prediction services.",
      "No SHOM credential is stored in this public JSON file.",
    ],
    events,
  };
}

try {
  const cache = await buildCache();
  if (cache) {
    await writeFile(outPath, `${JSON.stringify(cache, null, 2)}\n`);
    console.log(`Wrote ${outPath}`);
    console.log(`${cache.events.length} tide events (${cache.sourceMode})`);
  }
} catch (error) {
  console.warn(error instanceof Error ? error.message : String(error));
  try {
    await readFile(outPath, "utf8");
    console.warn("Keeping existing SHOM tide cache.");
  } catch {
    await writeFile(
      outPath,
      `${JSON.stringify(emptyCache("SHOM cache generation failed; Open-Meteo Marine fallback remains active."), null, 2)}\n`,
    );
  }
}
