#!/usr/bin/env python3
"""Build-time collectors for the slower-moving local datasets.

Produces, under web/public/data/:
  trains.json    SNCF departures from the Le Pouliguen station (schedule +
                 trip ids so the browser can match GTFS-RT delays)
  dae.json       Defibrillators in town (OpenStreetMap via Overpass)
  chargers.json  Public EV charging points near town (IRVE consolidated file)

Run: python3 tools/build_local_data.py [trains|dae|chargers|all]
"""
from __future__ import annotations

import csv
import io
import json
import math
import sys
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
UA = {"User-Agent": "presquile-le-pouliguen/0.1 (local utility app)"}

LAT, LON = 47.2769, -2.4292

SNCF_GTFS_URL = "https://www.data.gouv.fr/api/1/datasets/r/9ae758ec-cd7a-40cd-a890-bb3963224942"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
IRVE_DATASET_API = (
    "https://www.data.gouv.fr/api/1/datasets/"
    "fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques/"
)


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


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("trains", "all"):
        build_trains()
    if which in ("dae", "all"):
        build_dae()
    if which in ("chargers", "all"):
        build_chargers()
