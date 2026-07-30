# Le Pouliguen Live: Architecture and Data Connections

Last updated: 2026-07-30

## Overview

Le Pouliguen Live is a static Vite/React application. There is no app backend in
production: the browser loads the built files from the static host, reads
committed JSON snapshots from `/data/`, and calls public CORS-enabled APIs
directly for live information.

Production URLs:

- Canonical: `https://presquile-le-pouliguen.berteloot.org/`
- Render origin: `https://presquile-le-pouliguen.onrender.com/`

## Runtime Architecture

```text
Browser
  |
  | static assets, PWA manifest, generated JSON
  v
Static host / Render
  |
  | live browser fetches
  v
Open-Meteo, Open-Meteo Marine, transport.data.gouv.fr proxy,
Cap Atlantique OpenDataSoft, Loire-Atlantique OpenDataSoft,
Google Translate, Google Analytics
```

The app is designed to degrade by card. If a live feed fails, the rest of the
page should still render. The source-health strip in the UI exposes whether
major data families are direct, partial, static, or unavailable.

## Build-Time Data

These files are generated locally and committed under `web/public/data/`.

| File | Builder | Source | Use | Main break points |
|---|---|---|---|---|
| `transit.json` | `tools/build_transit_data.py` | Lila Presqu'île GTFS, transport.data.gouv.fr resource `83762` | Bus stops, routes, local departures | Operator changes feed structure, feed validity expires, local bounding box misses a stop, resource URL changes |
| `trains.json` | `tools/build_local_data.py trains` | SNCF GTFS from data.gouv.fr | Station departures and service calendars | SNCF resource ID changes, Le Pouliguen stop naming changes, calendar exception structure changes |
| `dae.json` | `tools/build_local_data.py dae` | OpenStreetMap Overpass | Defibrillator list | Overpass downtime/rate limits, OSM incompleteness, stale community data |
| `chargers.json` | `tools/build_local_data.py chargers` | National IRVE consolidated file | Public EV charger list | CSV schema changes, data.gouv resource changes, stale operator data |
| `events.json` | Curated fallback | Manual/local | Fallback event list | Stale curated data, links rot |
| `cinema-pax.json` | `tools/build_local_data.py cinema` | Official Cinéma Pax Films & horaires page | Upcoming screenings, versions, durations and source links | Cinema HTML template changes, program page unavailable, film metadata pages missing duration |

Refresh commands:

```bash
python3 tools/build_transit_data.py
python3 tools/build_local_data.py all
cd web && npm run build
```

Cinéma Pax also has a dedicated scheduled refresh workflow:
`.github/workflows/cinema-pax-cache.yml`. It runs every six hours, with extra
Tuesday evening and Wednesday morning checks when weekly cinema programs often
roll over. It commits only when the normalized schedule hash changes, avoiding
noisy redeploys.

## Live Browser Connections

| Domain | Code | Source | Purpose | Main break points |
|---|---|---|---|---|
| Weather | `web/src/lib/openmeteo.ts` | Open-Meteo Forecast API | Current conditions, UV, sunrise/sunset, daily forecast | API outage, response schema changes, CORS/network failure |
| Marine/tides | `web/src/lib/openmeteo.ts`, `web/src/lib/tides.ts` | Open-Meteo Marine API | Wave height, water temperature, model sea-level curve and extrema | Model gaps for past/future dates, sea cell changes, users treating model output as official navigation data |
| Bus realtime | `web/src/lib/transit.ts`, `web/src/components/BusMap.tsx` | `proxy.transport.data.gouv.fr` GTFS-RT Lila feeds | Delays, vehicles, service alerts | Proxy downtime, binary GTFS-RT decode failure, trip IDs not matching static GTFS |
| Train realtime | `web/src/lib/trains.ts` | `proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates` | Train delays for Le Pouliguen trips | National feed size/latency, trip IDs not matching static GTFS, proxy CORS changes |
| Waste/glass/beaches/agenda | `web/src/lib/capatlantique.ts` | Cap Atlantique OpenDataSoft Explore v2.1 | Collections, glass points, beaches, regional agenda | Dataset slugs or field names change, zero-result filters, CORS changes |
| Roads/circuits/bike | `web/src/lib/localdata.ts` | Loire-Atlantique and Cap Atlantique OpenDataSoft | Road disruptions, walking/cycling circuits, bike parking, bike share | Dataset slugs/fields change, geometry format changes, rate limits |
| Bathing-water classification | `web/src/App.tsx` | Ministry of Health bathing-water page | Source link for Baie du Guec classification | 2025-specific URL ages out, site markup/routes change |
| Parking | `web/src/App.tsx` | Le Pouliguen municipal page | Official parking guidance source | Seasonal rules change, municipal URL changes |
| Cinema display | `web/src/components/CinemaPax.tsx`, `web/src/lib/cinema.ts` | Committed `/data/cinema-pax.json` cache | Upcoming Cinéma Pax sessions without browser-side scraping | Cache stale until the scheduled collector sees a change |
| Translation | `web/src/components/LanguageSwitcher.tsx` | Google Translate website widget | EN/ES machine translation | Widget deprecation, script blocked by privacy tools, translation UI injection affecting layout |
| Analytics | `web/index.html` | Google Analytics tag `G-088KDJN7B7` | Usage analytics | Ad blockers, tag ID mismatch, consent/privacy changes |

## Deployment Path

1. Build locally or on the host: `cd web && npm ci && npm run build`.
2. Publish `web/dist`.
3. The canonical domain points to the static deployment.
4. Render origin remains useful as a second probe and fallback diagnostic URL.

Render configuration lives in `render.yaml`. It defines the static-site runtime,
build command, publish directory, and security headers for all paths.

## Known Reliability Edges

- **Static schedule freshness:** bus and train schedules depend on committed JSON.
  If they are not regenerated after operator updates, the UI can look healthy
  but show stale service calendars.
- **Realtime/static ID drift:** GTFS-RT delays are merged by `trip_id`. If a
  realtime feed references IDs that no longer exist in the committed static
  feed, schedules still render but delay labels disappear.
- **Browser-only live calls:** users with strict blockers, captive portals, or
  corporate networks may see the shell but not live cards.
- **OpenDataSoft field drift:** Cap Atlantique and Loire-Atlantique datasets are
  queried by exact field names. A renamed field can silently empty a card.
- **Open-Meteo tide caveat:** tide extrema are inferred from modeled sea level.
  This is helpful for planning but not official SHOM navigation guidance.
- **Google Translate widget:** translation is machine-generated and depends on a
  third-party script. French remains the canonical source language.
- **Event coverage:** agenda coverage is partial by design. Some nearby towns
  can return zero when the source feed lacks structured events.
- **Cinema rights and freshness:** the app links back to Cinéma Pax and avoids
  republishing full synopses or posters. A direct official feed would be better
  than HTML parsing if the cinema can provide one.

## Monitoring

The app owns its monitoring setup in this repository. The monitor is
dependency-free Python so it can run from GitHub Actions, cron, or any
Pierre-style runner without moving app-specific files into another project.

- script: `tools/site_monitor.py`
- config: `monitoring/pierre-site-monitor.json`
- scheduled runner: `.github/workflows/pierre-site-monitor.yml`
- local state file: `.monitor-state.json` when run outside GitHub Actions

Current monitor scope:

- canonical homepage contains `Le Pouliguen Live`
- Render origin is reachable
- AI/SEO files (`llms.txt`, `ai/site-brief.md`, sitemap, manifest) are reachable
- key generated JSON files are reachable and not older than their freshness
  threshold
- Cinéma Pax cache is reachable and contains screenings
- Open-Meteo forecast and marine feeds return expected JSON
- Lila and SNCF GTFS-RT proxy feeds return non-empty protobuf payloads
- Cap Atlantique and Loire-Atlantique OpenDataSoft probes return records
- Google Translate widget script is reachable

GitHub Actions runs the monitor every 15 minutes and on manual dispatch. It uses
repository secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Alert behavior: Pierre sends Telegram messages only on new failures and
recoveries, so repeated failing checks do not spam every 15 minutes.

Telegram break point: alerts require both repository secrets. The checker can
still run and log without Telegram credentials, but it cannot notify.

Manual local run:

```bash
python3 tools/site_monitor.py --config monitoring/pierre-site-monitor.json
```
