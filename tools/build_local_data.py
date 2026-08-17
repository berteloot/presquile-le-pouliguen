#!/usr/bin/env python3
"""Build-time collectors for the slower-moving local datasets.

Produces, under web/public/data/:
  trains.json    SNCF departures from the Le Pouliguen station (schedule +
                 trip ids so the browser can match GTFS-RT delays)
  dae.json       Defibrillators in town (OpenStreetMap via Overpass)
  chargers.json  Public EV charging points near town (IRVE consolidated file)
  events.json    Curated/snapshotted events missing from live CORS feeds
  cinema-pax.json Cinéma Pax sessions, cached from the official weekly page

Run: python3 tools/build_local_data.py [trains|dae|chargers|events|cinema|all]
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import math
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

OUT_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
UA = {"User-Agent": "presquile-le-pouliguen/0.1 (local utility app)"}

LAT, LON = 47.2769, -2.4292

SNCF_GTFS_URL = "https://www.data.gouv.fr/api/1/datasets/r/9ae758ec-cd7a-40cd-a890-bb3963224942"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
IRVE_DATASET_API = (
    "https://www.data.gouv.fr/api/1/datasets/"
    "fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques/"
)
LE_CROISIC_AGENDA_URL = "https://lecroisic.fr/fr/ev/748477/agenda-578"
CINEMA_PAX_URL = "http://www.cinemapax.fr/films-horaires/"
CINEMA_PAX_TICKETS_URL = "https://lepouliguencinemapax.cine.boutique/"
CINEMA_PAX_TICKET_URLS = {
    "LES MATINS MERVEILLEUX": "https://lepouliguencinemapax.cine.boutique/media/1489?title=LES%20MATINS%20MERVEILLEUX&visanumber=148798",
}
FRENCH_MONTHS = {
    "janvier": 1,
    "février": 2,
    "fevrier": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "août": 8,
    "aout": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "décembre": 12,
    "decembre": 12,
}


def fetch(url: str, timeout: int = 180) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout).read()


def haversine_km(lat1, lon1, lat2, lon2):
    rad = math.pi / 180
    a = (
        math.sin((lat2 - lat1) * rad / 2) ** 2
        + math.cos(lat1 * rad)
        * math.cos(lat2 * rad)
        * math.sin((lon2 - lon1) * rad / 2) ** 2
    )
    return 2 * 6371 * math.asin(math.sqrt(a))


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_out(name: str, payload: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {path} ({path.stat().st_size / 1024:.0f} KB)")


def write_json(name: str, payload) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {path} ({path.stat().st_size / 1024:.0f} KB)")


def read_table(z: zipfile.ZipFile, name: str) -> list[dict]:
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def hms_to_seconds(hms: str) -> int:
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def build_trains() -> None:
    print("Downloading SNCF GTFS ...")
    z = zipfile.ZipFile(io.BytesIO(fetch(SNCF_GTFS_URL)))
    stops = read_table(z, "stops.txt")
    target_ids = {
        s["stop_id"]: s["stop_name"]
        for s in stops
        if "pouliguen" in s["stop_name"].lower()
    }
    if not target_ids:
        raise SystemExit("No Le Pouliguen stop found in SNCF GTFS")
    print("station stops:", target_ids)

    trips = {t["trip_id"]: t for t in read_table(z, "trips.txt")}
    routes = {r["route_id"]: r for r in read_table(z, "routes.txt")}
    stop_names = {s["stop_id"]: s["stop_name"] for s in stops}

    # One pass over stop_times: collect our departures and every trip's
    # final stop so the destination can be shown even without a headsign.
    departures = []
    last_stop: dict[str, tuple[int, str]] = {}
    used_trips: set[str] = set()
    with z.open("stop_times.txt") as f:
        for st in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            trip_id = st["trip_id"]
            seq = int(st["stop_sequence"])
            prev = last_stop.get(trip_id)
            if prev is None or seq > prev[0]:
                last_stop[trip_id] = (seq, st["stop_id"])
            if st["stop_id"] in target_ids and (st.get("departure_time") or "").strip():
                if st.get("pickup_type") == "1":
                    continue
                departures.append(
                    {"t": hms_to_seconds(st["departure_time"]), "trip": trip_id}
                )
                used_trips.add(trip_id)

    out_deps = []
    for d in sorted(departures, key=lambda x: x["t"]):
        trip = trips.get(d["trip"])
        if trip is None:
            continue
        dest_stop = last_stop.get(d["trip"], (0, ""))[1]
        dest = stop_names.get(dest_stop, "")
        # Skip trains that terminate here: nothing to board toward.
        if dest_stop in target_ids:
            continue
        route = routes.get(trip["route_id"], {})
        out_deps.append(
            {
                "t": d["t"],
                "trip": d["trip"],
                "service": trip["service_id"],
                # SNCF's trip_headsign is the train number, not a destination.
                "dest": dest,
                "number": (trip.get("trip_headsign") or "").strip(),
                "route": (route.get("route_long_name") or route.get("route_short_name") or "").strip(),
            }
        )

    used_services = {trips[t]["service_id"] for t in used_trips if t in trips}
    services = {}
    for c in read_table(z, "calendar.txt") if "calendar.txt" in z.namelist() else []:
        if c["service_id"] in used_services:
            services[c["service_id"]] = {
                "days": [
                    int(c[d])
                    for d in (
                        "monday", "tuesday", "wednesday", "thursday",
                        "friday", "saturday", "sunday",
                    )
                ],
                "start": c["start_date"],
                "end": c["end_date"],
            }
    exceptions: dict[str, dict] = defaultdict(dict)
    for cd in read_table(z, "calendar_dates.txt"):
        if cd["service_id"] in used_services:
            exceptions[cd["service_id"]][cd["date"]] = int(cd["exception_type"])

    write_out(
        "trains.json",
        {
            "generated": now_stamp(),
            "station": sorted(set(target_ids.values()))[0],
            "departures": out_deps,
            "services": services,
            "serviceExceptions": exceptions,
        },
    )
    print(f"{len(out_deps)} train departures, {len(services)} services")


def build_dae() -> None:
    query = (
        '[out:json][timeout:25];'
        'node["emergency"="defibrillator"](47.263,-2.465,47.294,-2.398);out;'
    )
    data = json.loads(
        fetch(OVERPASS_URL + "?" + urllib.parse.urlencode({"data": query}), timeout=60)
    )
    items = []
    for e in data.get("elements", []):
        tags = e.get("tags", {})
        label = (
            tags.get("defibrillator:location")
            or tags.get("description")
            or tags.get("name")
            or ""
        )
        items.append(
            {
                "lat": e["lat"],
                "lon": e["lon"],
                "label": label,
                "indoor": tags.get("indoor"),
                "distanceKm": round(haversine_km(LAT, LON, e["lat"], e["lon"]), 3),
            }
        )
    items.sort(key=lambda x: x["distanceKm"])
    write_out("dae.json", {"generated": now_stamp(), "source": "OpenStreetMap", "items": items})
    print(f"{len(items)} defibrillators")


def build_chargers() -> None:
    print("Locating IRVE consolidated file ...")
    ds = json.loads(fetch(IRVE_DATASET_API, timeout=60))
    csv_url = None
    for r in ds.get("resources", []):
        if (r.get("format") or "").lower() == "csv":
            csv_url = r["url"]
            break
    if not csv_url:
        raise SystemExit("No CSV resource on the IRVE dataset")
    print("Downloading", csv_url[:110], "...")
    raw = fetch(csv_url, timeout=300)
    stations: dict[str, dict] = {}
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8", errors="replace")))
    for row in reader:
        try:
            lon, lat = None, None
            coords = (row.get("coordonneesXY") or "").strip("[] ")
            if coords:
                lon, lat = (float(x) for x in coords.split(","))
        except ValueError:
            continue
        if lat is None or not (47.24 <= lat <= 47.33 and -2.48 <= lon <= -2.35):
            continue
        key = row.get("id_station_itinerance") or row.get("nom_station") or f"{lat},{lon}"
        st = stations.setdefault(
            key,
            {
                "name": (row.get("nom_station") or "").strip(),
                "operator": (row.get("nom_operateur") or row.get("nom_amenageur") or "").strip(),
                "address": (row.get("adresse_station") or "").strip(),
                "lat": lat,
                "lon": lon,
                "points": 0,
                "maxPowerKw": 0.0,
                "distanceKm": round(haversine_km(LAT, LON, lat, lon), 2),
            },
        )
        st["points"] += 1
        try:
            st["maxPowerKw"] = max(st["maxPowerKw"], float(row.get("puissance_nominale") or 0))
        except ValueError:
            pass
    items = sorted(stations.values(), key=lambda x: x["distanceKm"])
    write_out("chargers.json", {"generated": now_stamp(), "items": items})
    print(f"{len(items)} charging stations nearby")


def strip_tags(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def absolute_cinema_url(url: str) -> str:
    """Resolve a scraped href against the programme page.

    urljoin keeps any absolute URL it is given, including a "javascript:" one, so
    the scheme is checked here: the site renders these straight into hrefs, and a
    defaced source page must not be able to plant a script URL in the cache.
    """
    resolved = urllib.parse.urljoin(CINEMA_PAX_URL, html.unescape(url)).replace(
        "https://www.", "http://www."
    )
    if urllib.parse.urlparse(resolved).scheme not in ("http", "https"):
        return CINEMA_PAX_URL
    return resolved


def duration_to_minutes(value: str) -> int | None:
    match = re.search(r"(?:(\d+)\s*h)?\s*(?:(\d+)(?:\s*min)?)?", value.lower())
    if not match:
        return None
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    total = hours * 60 + minutes
    return total or None


def parse_cinema_day_labels(page: str) -> dict[str, str]:
    labels = {}
    current_year = datetime.now(ZoneInfo("Europe/Paris")).year
    previous_month = 0
    for day_id, label in re.findall(
        r'<div class="title day(\d+)"[^>]*>\s*<span>.*?</span>\s*([^<]+)</div>',
        page,
        flags=re.S,
    ):
        text = strip_tags(label).lower()
        match = re.search(r"(\d{1,2})\s+([a-zà-ÿ]+)", text)
        if not match:
            continue
        day = int(match.group(1))
        month = FRENCH_MONTHS.get(match.group(2))
        if not month:
            continue
        if previous_month and month < previous_month:
            current_year += 1
        previous_month = month
        labels[day_id] = f"{current_year:04d}-{month:02d}-{day:02d}"
    return labels


def parse_film_metadata(url: str) -> dict:
    try:
        page = fetch(url, timeout=45).decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"Skipping film metadata for {url}: {exc}")
        return {}
    rows = {}
    for row in re.findall(r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>", page, flags=re.S):
        key = strip_tags(row[0]).lower()
        value = strip_tags(row[1])
        if key and value:
            rows[key] = value
    return {
        "duration_minutes": duration_to_minutes(rows.get("durée", "")),
        "genres": rows.get("genres", ""),
        "director": rows.get("réalisateur", ""),
        "age": rows.get("limite d'âge", ""),
    }


def parse_french_end_date(date_range: str, today) -> object | None:
    text = re.sub(r"\([^)]*\)", " ", date_range).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if " - " in text:
        text = text.split(" - ")[-1]
    elif " et " in text:
        text = text.split(" et ")[-1]
    match = re.search(r"(\d{1,2})\s+([A-Za-zÀ-ÿ]+)(?:\s+(\d{4}))?", text)
    if not match:
        return None
    day = int(match.group(1))
    month = FRENCH_MONTHS.get(match.group(2).lower())
    year = int(match.group(3) or today.year)
    if not month:
        return None
    return datetime(year, month, day).date()


def build_events() -> None:
    today = datetime.now(ZoneInfo("Europe/Paris")).date()
    month_url = f"{LE_CROISIC_AGENDA_URL}/{today.year}/{today.month}"
    print("Fetching Le Croisic official agenda ...")
    page = fetch(month_url, timeout=60).decode("utf-8", errors="replace")
    events = [
        {
            "title": "Marché nocturne",
            "when": "Chaque mercredi soir en été (du 8 juillet au 19 août)",
            "where": "Bord de mer, centre-ville",
            "dateRange": "Chaque mercredi soir en été (du 8 juillet au 19 août)",
            "location": "Bord de mer, centre-ville",
            "city": "Le Pouliguen",
            "url": "https://www.lepouliguen.fr/",
            "note": "Artisans, créateurs et producteurs locaux.",
            "source": "https://www.lepouliguen.fr/",
        }
    ]
    seen = {f"{events[0]['title']}|{events[0]['city']}"}
    for match in re.finditer(
        r'<a\s+href="(?P<href>[^"]+)"[^>]*class="[^"]*\bcard-date\b[^"]*"[^>]*>(?P<body>.*?)</a>',
        page,
        flags=re.S,
    ):
        body = match.group("body")
        title_match = re.search(r'<h2[^>]*class="[^"]*\bcard-title\b[^"]*"[^>]*>(.*?)</h2>', body, re.S)
        date_match = re.search(r'<p[^>]*class="[^"]*\bmb-1\b[^"]*"[^>]*>(.*?)</p>', body, re.S)
        details = [
            strip_tags(value)
            for value in re.findall(r'<p[^>]*class="[^"]*\bcard-text\b[^"]*"[^>]*>(.*?)</p>', body, re.S)
        ]
        if not title_match or not date_match:
            continue
        title = strip_tags(title_match.group(1))
        date_range = strip_tags(date_match.group(1))
        end_date = parse_french_end_date(date_range, today)
        if end_date and end_date < today:
            continue
        detail = next((d for d in reversed(details) if d and "gratuit" not in d.lower()), "")
        location = f"Le Croisic{f' · {detail}' if detail else ''}"
        key = f"{title}|Le Croisic"
        if not title or key in seen:
            continue
        seen.add(key)
        events.append(
            {
                "title": title,
                "when": date_range,
                "where": location,
                "dateRange": date_range,
                "location": location,
                "city": "Le Croisic",
                "url": urllib.parse.urljoin(month_url, match.group("href")),
                "source": month_url,
            }
        )
        if len([e for e in events if e.get("city") == "Le Croisic"]) >= 8:
            break
    write_json("events.json", events)
    print(f"{len(events)} curated events")


def build_cinema() -> None:
    print("Fetching Cinéma Pax schedule ...")
    page = fetch(CINEMA_PAX_URL, timeout=60).decode("utf-8", errors="replace")
    day_labels = parse_cinema_day_labels(page)
    modified_match = re.search(r'<meta property="article:modified_time" content="([^"]+)"', page)
    source_updated = modified_match.group(1) if modified_match else None
    pdf_match = re.search(r'href="([^"]+\.pdf)"[^>]*class="[^"]*\bbtn\b[^"]*"', page, re.I)

    sessions = []
    films: dict[str, dict] = {}
    for day_id, body in re.findall(
        r'<table class="day(\d+)"[^>]*>(.*?)</table>',
        page,
        flags=re.S,
    ):
        date = day_labels.get(day_id)
        if not date:
            continue
        for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", body, flags=re.S):
            time_match = re.search(r"<strong>(\d{1,2}:\d{2})</strong>", row)
            link_match = re.search(r'<a href="([^"]+)">(.*?)</a>', row, flags=re.S)
            if not time_match or not link_match:
                continue
            version_match = re.search(r'<span class="version">\s*\(([^)]+)\)\s*</span>', row)
            film_url = absolute_cinema_url(link_match.group(1))
            title = strip_tags(link_match.group(2))
            special_labels = []
            for icon_match in re.finditer(r'<i\b[^>]*title="([^"]+)"', row, flags=re.S):
                label = strip_tags(icon_match.group(1))
                if label:
                    special_labels.append(label)
            films.setdefault(film_url, {"title": title, "url": film_url})
            sessions.append(
                {
                    "film": title,
                    "date": date,
                    "time": time_match.group(1),
                    "version": strip_tags(version_match.group(1)) if version_match else "",
                    "film_url": film_url,
                    "ticket_url": CINEMA_PAX_TICKET_URLS.get(title),
                    "special_labels": special_labels,
                }
            )

    for film_url, film in films.items():
        film.update(parse_film_metadata(film_url))
    for session in sessions:
        metadata = films.get(session["film_url"], {})
        session["duration_minutes"] = metadata.get("duration_minutes")
        session["genres"] = metadata.get("genres", "")
        session["age"] = metadata.get("age", "")

    sessions.sort(key=lambda item: (item["date"], item["time"], item["film"]))
    content_fingerprint = json.dumps(
        {
            "source_updated_at": source_updated,
            "sessions": sessions,
            "films": sorted(films.values(), key=lambda item: item["title"]),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    schedule_hash = hashlib.sha256(content_fingerprint.encode()).hexdigest()
    existing_generated = None
    existing_path = OUT_DIR / "cinema-pax.json"
    if existing_path.exists():
        try:
            existing = json.loads(existing_path.read_text())
            if existing.get("schedule_hash") == schedule_hash:
                existing_generated = existing.get("generated")
        except (OSError, json.JSONDecodeError):
            existing_generated = None

    write_json(
        "cinema-pax.json",
        {
            "generated": existing_generated or now_stamp(),
            "schedule_hash": schedule_hash,
            "cinema": {
                "name": "Cinéma Pax",
                "address": "5 rue du Maréchal Joffre, 44510 Le Pouliguen",
                "source_url": CINEMA_PAX_URL,
                "tickets_url": CINEMA_PAX_TICKETS_URL,
                "program_pdf_url": absolute_cinema_url(pdf_match.group(1)) if pdf_match else None,
            },
            "source_updated_at": source_updated,
            "sessions": sessions,
            "films": sorted(films.values(), key=lambda item: item["title"]),
            "notice": "Horaires extraits du site officiel. Vérifier la séance et réserver sur cinemapax.fr.",
        },
    )
    print(f"{len(sessions)} Cinéma Pax sessions, {len(films)} films")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("trains", "all"):
        build_trains()
    if which in ("dae", "all"):
        build_dae()
    if which in ("chargers", "all"):
        build_chargers()
    if which in ("events", "all"):
        build_events()
    if which in ("cinema", "all"):
        build_cinema()
