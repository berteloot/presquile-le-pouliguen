# Presqu'île Le Pouliguen ("Le Pouliguen Live")

> **HANDOFF (2026-07-29).** In-flight work, in priority order:
> 1. Tomorrow-rollover for departures: DONE in `web/src/lib/transit.ts`
>    (`tomorrow` flag on NextDeparture). NOT done: same logic in
>    `web/src/lib/trains.ts`, and the UI does not yet display "demain" before
>    the time (bus card, trains card, essentials tiles in `App.tsx`).
> 2. Freshness stamps: show "mis à jour à HH:MM" on live cards (bus delays,
>    trains, circulation routière) so stale data is visible.
> 3. Deploy: give this folder its own git repo (the parent NYTRO_AI repo
>    must NEVER go to GitHub), push, create a Render static site
>    (build: `cd web && npm ci && npm run build`, publish: `web/dist`).
>    RENDER_API_KEY exists in ~/.config/nytro/.env.
> 4. Then: daily briefing block, SEO pages (see Phase 2 below).
> Build is currently green (`cd web && npm run build`).

A live local utility for Le Pouliguen: sea and tide conditions, real-time buses,
weather, and today's events on one screen. Concept: a live operating system for
the town, organized around five needs (Move, Coast, Today, Everyday life, My
address). Product research and data inventory came from Stan's ChatGPT session
(July 2026); the MVP below is Phase 1 of that plan.

## Status (2026-07-29)

Working MVP, static-only architecture, verified running locally:

- Weather now + today (Open-Meteo forecast API, no key)
- Sea state and tide curve with next high/low water, trend, moon phase and
  approximate spring-tide timing
  (Open-Meteo Marine API `sea_level_height_msl`, model data, flagged as
  indicative on the page)
- Next bus departures per stop with real-time delays
  (Lila Presqu'île static GTFS preprocessed at build time + GTFS-RT TripUpdate)
- Live bus map (Leaflet + GTFS-RT VehiclePosition, 20 s refresh)
- Network service alerts (GTFS-RT ServiceAlert)
- Live agenda: upcoming presqu'île events from the Cap Atlantique OpenAgenda
  extraction, merged with curated/snapshotted `web/public/data/events.json`
  for sources such as the official Le Croisic agenda
- Cinéma Pax: cached official weekly sessions from the Films & horaires page,
  with VO / young-audience hints, running time and direct ticket/source links
- Beaches: the commune's 4 official bathing sites with descriptions and links,
  plus a link to official water quality (baignades.sante.gouv.fr)
- Offshore ships: static AIS-ready cache for vessels off Le Pouliguen / La
  Baule, with map, filters, wait-time estimates, origin/previous-port context
  and generated natural-language explanations
- Waste collection: next door-to-door pickups (bac vert / bac jaune) for the
  commune from the Cap Atlantique calendar, nearest glass drop-off point,
  and local waste center address/opening hours
- Fishing on foot: next low tides as favorable windows, with links to
  pecheapied-responsable.fr and the prefecture for sanitary closures
- Discover page: local essentials such as the port carousel/niniches, the
  Croisic fish market/criée and Canopy Parc
- Ticket links: lilapresquile.fr (bus), SNCF Connect (train)
- Installable PWA manifest, French UI, mobile-first

Cap Atlantique's OpenDataSoft portal (data.capatlantique.fr, Explore v2.1 API)
is CORS-open, so all of the above is queried live from the browser with
server-side filtering (`src/lib/capatlantique.ts`). No rebuild needed when the
data changes.

Key finding: the transport.data.gouv.fr GTFS-RT proxy sends
`access-control-allow-origin: *`, so the browser fetches the real-time feeds
directly. No backend is required for Phase 1, which means free static hosting.

## Added since (2026-07-29, second pass)

- Trains: SNCF GTFS preprocessed at build time (`tools/build_local_data.py`),
  next departures from the gare du Pouliguen with LIVE delays from the
  national GTFS-RT feed (verified: caught a +25 min TER in testing)
- Tide accuracy: 15-minute model resolution on a sea grid cell; verified
  against a harmonic reference (low tide matched to the minute on test day).
  SHOM licensed predictions remain the Phase 2 gold standard.
- Road disruptions: live from the Loire-Atlantique department portal,
  filtered within 25 km
- Circuits rando + vélo: live Cap Atlantique data, route traces drawn on a
  map, click a name in the list to highlight and zoom, official PDF fiches
- Defibrillators (OpenStreetMap Overpass, build time), EV chargers (national
  IRVE consolidated file, build time) with map
- Beach map, charger map (shared PoiMap component)
- Sticky pill navigation with section anchors + hash-routed "Découvrir" page
  (history, marais salants, Côte Sauvage, off the beaten path, fun facts)
- Type system: Bricolage Grotesque (display) + Plus Jakarta Sans (body),
  large sizes kept for older readers
- Layout: 5 sections (L'essentiel / Se déplacer / La côte / Aujourd'hui /
  Vie pratique) matching the product's five-needs structure

Data refresh: `python3 tools/build_transit_data.py` (bus GTFS) and
`python3 tools/build_local_data.py all` (trains, DAE, chargers, curated
agenda snapshot, Cinéma Pax cache). `node tools/build_ais_cache.mjs` refreshes
the offshore-ship cache; set `AIS_CACHE_SOURCE_URL` and optionally
`AIS_API_KEY` to point it at a real AIS provider/export. Most other operational
data is queried live from the browser. The Cinéma Pax cache also has a
scheduled GitHub Actions refresh workflow.

AIS note: the deployed app remains a free static page. Real-time AIS and
historical port calls usually require an API key, paid archive, or contributed
receiver feed, so this project keeps AIS behind a replaceable static cache
instead of requiring a Node server at runtime.

## Layout

```
tools/build_transit_data.py   Downloads the Lila GTFS zip, keeps stops inside
                              the Le Pouliguen bounding box, writes compact
                              web/public/data/transit.json (~440 KB).
                              Re-run when the operator updates the feed.
web/                          Vite + React + TypeScript PWA.
  src/lib/openmeteo.ts        Weather + marine fetchers, WMO labels (French).
  src/lib/tides.ts            Tide extrema from hourly sea level (parabolic
                              refinement), trend.
  src/lib/transit.ts          Schedule logic (calendar + exceptions, Paris
                              service day), GTFS-RT decoding
                              (gtfs-realtime-bindings), stop grouping.
  src/components/             TideChart (SVG), BusMap (Leaflet).
  public/data/transit.json    Generated, committed.
  public/data/events.json     Curated/snapshotted events merged into agenda.
  public/data/cinema-pax.json Generated, committed Cinéma Pax schedule cache.
```

## Run

```
cd web
npm install
npm run dev        # local dev
npm run build      # production build to dist/
npm run preview    # serve dist/ locally
python3 ../tools/build_transit_data.py   # refresh transit data
python3 ../tools/build_local_data.py cinema # refresh Cinéma Pax cache
```

## Data sources

| Domain | Source | Access |
|---|---|---|
| Weather | Open-Meteo forecast API | keyless, CORS open |
| Sea, tides | Open-Meteo Marine API | keyless, CORS open; model data, not SHOM official predictions |
| Bus schedules | Lila Presqu'île GTFS, transport.data.gouv.fr resource 83762 | keyless download |
| Bus real time | GTFS-RT vehicle-position / trip-update / service-alert via proxy.transport.data.gouv.fr (lila-presquile-cap-atlantique-*) | keyless, CORS open |
| Events | lepouliguen.fr (manual for now) | scrape or feed later |

## Phase 2 candidates (from the research)

- Trains: SNCF GTFS + GTFS-RT (next TER at Le Pouliguen station, delays)
- Official SHOM tide predictions (licensed API) to replace model sea level
- Bathing-water quality results in-app (baignades.sante.gouv.fr has no clean
  API; needs a scraper or the annual data.gouv dataset)
- Shellfish closure status in-app (prefecture arrêtés are PDFs; needs parsing)
- Daily briefing page (/aujourdhui), per-stop and per-beach SEO pages
- Defibrillators (GeoDAE), EV charging (IRVE), Météo-France vigilance
- Deployment: Render static site (free tier), custom domain

## Notes

- Departures are computed for the current Paris service day only; GTFS
  after-midnight times (>24 h) from the previous service day are not merged
  yet. Last local buses run well before midnight so the impact is nil today.
- Tide times come from a hydrodynamic model, not official predictions. The UI
  labels them indicative and warns against navigation use.
- The JS bundle is ~545 KB minified (protobufjs + Leaflet dominate); code
  splitting is a Phase 2 cleanup.
