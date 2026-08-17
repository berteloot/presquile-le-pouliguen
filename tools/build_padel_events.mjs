import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(repoRoot, "web/public/data/padel-events.json");
const WP_BASE = "https://padel-labaule.fr/wp-json/wp/v2";
const HOME_PAGE_ID = 352;
const PAGE_SLUGS = [
  "planning-des-cours-2",
  "test-planning",
  "planning-des-animations",
  "tournoi-interne-ccb",
];

function codePoint(value, whole) {
  // fromCodePoint throws RangeError above 0x10FFFF, which would fail the whole
  // refresh over one malformed entity.
  return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : whole;
}

function decodeHtml(value = "") {
  return value
    .replace(/&#(\d+);/g, (whole, code) => codePoint(Number(code), whole))
    .replace(/&#x([0-9a-f]+);/gi, (whole, code) =>
      codePoint(Number.parseInt(code, 16), whole),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&euro;/g, "€")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html = "") {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(page) {
  const title = stripTags(page?.title?.rendered ?? "");
  return title || page?.slug || "Page Padel La Baule";
}

/** The site renders these hrefs directly, so anything that is not a plain web
    link is dropped here rather than committed to the cache. */
function webUrl(raw) {
  try {
    const url = new URL(raw, "https://padel-labaule.fr/");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function extractLinks(html = "") {
  const links = [];
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkRe)) {
    const url = webUrl(decodeHtml(match[1]));
    const label = stripTags(match[2]);
    if (!url || !label || links.some((link) => link.url === url && link.label === label)) continue;
    links.push({ label, url });
  }
  return links;
}

function extractPhone(text = "") {
  return text.match(/0\d(?:[\s.-]?\d{2}){4}/)?.[0]?.replace(/\s+/g, " ") ?? null;
}

function extractBookingSystems(html = "") {
  const systems = [];
  const configRe = /bookacti\.booking_system\[\s*['"][^'"]+['"]\s*\]\s*=\s*(\{[\s\S]*?\});/g;
  for (const match of html.matchAll(configRe)) {
    try {
      const config = JSON.parse(match[1]);
      systems.push({
        formId: Number(config.form_id ?? 0) || null,
        calendars: Array.isArray(config.calendars) ? config.calendars : [],
        activities: Array.isArray(config.activities) ? config.activities : [],
        start: String(config.display_period?.start ?? config.start ?? ""),
        end: String(config.display_period?.end ?? config.end ?? ""),
        slotMinTime: String(config.display_data?.slotMinTime ?? ""),
        slotMaxTime: String(config.display_data?.slotMaxTime ?? ""),
        waitingList: Boolean(config.waiting_list),
        redirectUrls: Object.values(config.redirect_url_by_activity ?? {})
          .filter((url) => typeof url === "string" && url.startsWith("http"))
          .filter((url, index, all) => all.indexOf(url) === index),
      });
    } catch (error) {
      console.warn(`Could not parse Booking Activities config: ${error.message}`);
    }
  }
  return systems;
}

function classifyLink(link) {
  const haystack = `${link.label} ${link.url}`.toLowerCase();
  if (/planning.*cours|planning-la-baule|cours/.test(haystack)) return "Cours";
  if (/tournoi|test-planning|p500/.test(haystack)) return "Tournois";
  if (/animation/.test(haystack)) return "Animations";
  if (/form|forms\.gle|inscription/.test(haystack)) return "Inscription";
  if (/séminaire|seminaire/.test(haystack)) return "Séminaire";
  return "Info";
}

function cleanLinkLabel(link) {
  if (link.label.length > 1) return link.label;
  if (/tournoi-interne-ccb/i.test(link.url)) return "Tournoi interne CCB";
  return link.label;
}

function normalizeLinkLabel(link) {
  const label = cleanLinkLabel(link);
  if (label.toLowerCase() === "planning" && /planning-des-cours/i.test(link.url)) {
    return "Planning des cours";
  }
  if (/reglement/i.test(label)) return label.replace("reglement", "règlement");
  return label;
}

function interestingLinks(pages) {
  const all = pages.flatMap((page) => extractLinks(page.content?.rendered ?? ""));
  const keep = all.filter((link) =>
    /planning|cours|tournoi|animation|forms\.gle|inscription|séminaire|seminaire|niveaux/i.test(
      `${link.label} ${link.url}`,
    ),
  );
  return keep
    .map((link) => ({ ...link, label: normalizeLinkLabel(link), kind: classifyLink(link) }))
    .filter((link, index, all) => all.findIndex((other) => other.url === link.url) === index)
    .slice(0, 10);
}

function extractHighlights(pages) {
  const highlights = [];
  for (const page of pages) {
    const text = stripTags(page.content?.rendered ?? "");
    const p500 = text.match(/INSCRIPTIONS POUR LE P500H du 22 août[^!.]*[!.]?/i)?.[0];
    if (p500) {
      highlights.push({
        title: "P500 Homme",
        when: "22 août",
        note: "Inscriptions ouvertes via le formulaire publié par Padel La Baule.",
        sourceUrl: page.link,
      });
    }
    const finals = text.match(/RDV le 26 septembre[^!.]*[!.]?/i)?.[0];
    if (finals) {
      highlights.push({
        title: "Tournoi interne CCB",
        when: "26 septembre",
        note: finals.trim(),
        sourceUrl: page.link,
      });
    }
  }
  return highlights;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "LePouliguenLive/1.0 (+https://presquile-le-pouliguen.berteloot.org)",
    },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const home = await fetchJson(`${WP_BASE}/pages/${HOME_PAGE_ID}`);
  const pages = [home];
  for (const slug of PAGE_SLUGS) {
    const rows = await fetchJson(`${WP_BASE}/pages?slug=${encodeURIComponent(slug)}`);
    if (Array.isArray(rows) && rows[0]) pages.push(rows[0]);
  }

  const homeText = stripTags(home.content?.rendered ?? "");
  const bookingSystems = pages.flatMap((page) => extractBookingSystems(page.content?.rendered ?? ""));
  const restrictedPages = pages
    .filter((page) => /accès restreint|créer un compte|connect/i.test(stripTags(page.content?.rendered ?? "")))
    .map((page) => ({
      title: pageTitle(page),
      url: page.link,
      modifiedAt: page.modified_gmt ? `${page.modified_gmt}Z` : page.modified,
    }));

  const data = {
    generatedAt: new Date().toISOString(),
    source: {
      name: "Padel La Baule",
      siteUrl: "https://padel-labaule.fr/",
      apiUrl: `${WP_BASE}/pages/${HOME_PAGE_ID}`,
      homePageModifiedAt: home.modified_gmt ? `${home.modified_gmt}Z` : home.modified,
    },
    courtBooking: {
      mode: "phone",
      provider: "Tennis Country Club Barrière La Baule",
      phone: extractPhone(homeText) ?? "02 40 11 46 26",
      note: "La réservation libre des pistes est annoncée par téléphone, pas via un flux public de disponibilité.",
    },
    bookingActivities: {
      detected: bookingSystems.length > 0,
      confidence: bookingSystems.length > 0 ? "high" : "low",
      systems: bookingSystems,
      summary:
        bookingSystems.length > 0
          ? "Calendrier Booking Activities détecté pour les cours, tournois et animations publiés."
          : "Aucun calendrier Booking Activities détecté dans la page publique.",
    },
    links: interestingLinks(pages),
    highlights: extractHighlights(pages),
    restrictedPages,
    platformNotes: [
      "Cours, tournois et animations : données publiques et liens détectés sur le site Padel La Baule.",
      "Pistes libres : disponibilité réelle non publiée ; réservation indiquée par téléphone auprès du Country Club.",
      "Certaines pages de planning demandent la création d'un compte avant d'afficher le détail.",
    ],
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote Padel La Baule cache to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
