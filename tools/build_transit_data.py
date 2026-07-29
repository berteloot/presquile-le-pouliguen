#!/usr/bin/env python3
"""Preprocess the Lila Presqu'ile GTFS feed into compact JSON for the web app.

Downloads the static GTFS zip, keeps only what serves Le Pouliguen, and writes
web/public/data/transit.json. Run manually or from a cron whenever the operator
updates the feed (validity is announced per calendar year).

Usage: python3 tools/build_transit_data.py
"""
from __future__ import annotations

import csv
import io
import json
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

GTFS_URL = "https://transport.data.gouv.fr/resources/83762/download"

# Bounding box around Le Pouliguen, slightly generous so edge stops
# (Batz side, La Baule side) that residents actually use are included.
LAT_MIN, LAT_MAX = 47.265, 47.292
LON_MIN, LON_MAX = -2.460, -2.405

OUT_PATH = Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "transit.json"


def read_table(z: zipfile.ZipFile, name: str) -> list[dict]:
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def hms_to_seconds(hms: str) -> int:
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def main() -> None:
    print(f"Downloading GTFS from {GTFS_URL} ...")
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "presquile-le-pouliguen/0.1"})
    raw = urllib.request.urlopen(req, timeout=120).read()
    z = zipfile.ZipFile(io.BytesIO(raw))

    stops = read_table(z, "stops.txt")
    routes = read_table(z, "routes.txt")
    trips = read_table(z, "trips.txt")
    stop_times = read_table(z, "stop_times.txt")
    calendar = read_table(z, "calendar.txt")
    calendar_dates = read_table(z, "calendar_dates.txt")
    feed_info = read_table(z, "feed_info.txt") if "feed_info.txt" in z.namelist() else []

    local_stops = {}
    for s in stops:
        try:
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
        except (KeyError, ValueError):
            continue
        if LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX:
            local_stops[s["stop_id"]] = {
                "id": s["stop_id"],
                "name": s["stop_name"].strip(),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
            }
    print(f"{len(local_stops)} stops inside the Le Pouliguen box")

    trip_index = {t["trip_id"]: t for t in trips}

    # Departures at local stops, keyed by stop_id.
    departures: dict[str, list] = defaultdict(list)
    used_trips: set[str] = set()
    for st in stop_times:
        sid = st["stop_id"]
        if sid not in local_stops:
            continue
        trip = trip_index.get(st["trip_id"])
        if trip is None:
            continue
        dep = st.get("departure_time") or st.get("arrival_time")
        if not dep:
            continue
        # A departure at the trip's final stop is an arrival, not something to catch.
        if st.get("pickup_type") == "1":
            continue
        used_trips.add(trip["trip_id"])
        departures[sid].append({
            "t": hms_to_seconds(dep),
            "trip": trip["trip_id"],
            "route": trip["route_id"],
            "headsign": (trip.get("trip_headsign") or "").strip(),
            "service": trip["service_id"],
        })
    for sid in departures:
        departures[sid].sort(key=lambda d: d["t"])

    used_services = {trip_index[t]["service_id"] for t in used_trips}

    # ALL routes, not just those serving Le Pouliguen: the GTFS-RT vehicle
    # feed covers the whole network and its route_ids are internal (they do
    # not match the public line numbers), so every vehicle needs a lookup.
    routes_out = {}
    for r in routes:
        routes_out[r["route_id"]] = {
            "shortName": r.get("route_short_name", "").strip(),
            "longName": r.get("route_long_name", "").strip(),
            "color": (r.get("route_color") or "").strip() or None,
            "textColor": (r.get("route_text_color") or "").strip() or None,
        }

    services_out = {}
    for c in calendar:
        if c["service_id"] not in used_services:
            continue
        services_out[c["service_id"]] = {
            "days": [int(c[d]) for d in (
                "monday", "tuesday", "wednesday", "thursday",
                "friday", "saturday", "sunday")],
            "start": c["start_date"],
            "end": c["end_date"],
        }
    exceptions_out: dict[str, dict] = defaultdict(dict)
    for cd in calendar_dates:
        if cd["service_id"] in used_services:
            exceptions_out[cd["service_id"]][cd["date"]] = int(cd["exception_type"])

    # Trip lookup so GTFS-RT vehicle positions can be labeled on the map,
    # including trips that only pass near town without a local stop.
    trips_out = {}
    for t in used_trips:
        trip = trip_index[t]
        trips_out[t] = {
            "route": trip["route_id"],
            "headsign": (trip.get("trip_headsign") or "").strip(),
        }

    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "feed": feed_info[0] if feed_info else {},
        "stops": sorted(local_stops.values(), key=lambda s: s["name"]),
        "routes": routes_out,
        "departures": departures,
        "services": services_out,
        "serviceExceptions": exceptions_out,
        "trips": trips_out,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    size_kb = OUT_PATH.stat().st_size / 1024
    n_dep = sum(len(v) for v in departures.values())
    print(f"Wrote {OUT_PATH} ({size_kb:.0f} KB): "
          f"{len(local_stops)} stops, {len(routes_out)} routes, "
          f"{n_dep} departures, {len(services_out)} services")


if __name__ == "__main__":
    sys.exit(main())
