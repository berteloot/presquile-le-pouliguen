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
from datetime import datetime, timedelta, timezone
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


def previous_snapshot(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def day_before(yyyymmdd: str) -> str:
    stamp = datetime.strptime(yyyymmdd, "%Y%m%d") - timedelta(days=1)
    return stamp.strftime("%Y%m%d")


def carry_over_gap(out: dict, previous: dict, today: str) -> None:
    """Keep the outgoing feed alive until the incoming one starts.

    Transdev published the September feed on 25 August, valid from the 1st.
    Rebuilding on the 30th replaced a calendar that covered that day with one
    that starts two days later, and the bus panel read "Aucun passage trouve"
    for every stop in town. The old services are carried, clamped to the day
    before the new feed starts so no date is served twice.
    """
    new_start = (out.get("feed") or {}).get("feed_start_date") or ""
    if not new_start or new_start <= today or not previous:
        return
    cutoff = day_before(new_start)

    carried = {}
    for sid, svc in (previous.get("services") or {}).items():
        if sid in out["services"]:
            continue
        start = max(svc.get("start", ""), today)
        end = min(svc.get("end", ""), cutoff)
        if not start or not end or start > end:
            continue
        carried[sid] = {"days": svc["days"], "start": start, "end": end}
    if not carried:
        return

    out["services"].update(carried)
    for sid, dates in (previous.get("serviceExceptions") or {}).items():
        if sid not in carried:
            continue
        window = {d: kind for d, kind in dates.items() if today <= d <= cutoff}
        if window:
            out["serviceExceptions"][sid] = window

    known_stops = {s["id"] for s in out["stops"]}
    for stop_id, deps in (previous.get("departures") or {}).items():
        if stop_id not in known_stops:
            continue
        gap_deps = [d for d in deps if d.get("service") in carried]
        if not gap_deps:
            continue
        out["departures"][stop_id] = sorted(
            out["departures"].get(stop_id, []) + gap_deps, key=lambda d: d["t"])

    carried_trips = {d["trip"] for deps in out["departures"].values() for d in deps}
    for trip_id, trip in (previous.get("trips") or {}).items():
        if trip_id in carried_trips and trip_id not in out["trips"]:
            out["trips"][trip_id] = trip
    for route_id, route in (previous.get("routes") or {}).items():
        out["routes"].setdefault(route_id, route)

    print(f"Carried {len(carried)} outgoing services through {cutoff}, "
          f"the day before the new feed starts")


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
    carry_over_gap(out, previous_snapshot(OUT_PATH),
                   datetime.now(timezone.utc).strftime("%Y%m%d"))

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    size_kb = OUT_PATH.stat().st_size / 1024
    n_dep = sum(len(v) for v in out["departures"].values())
    print(f"Wrote {OUT_PATH} ({size_kb:.0f} KB): "
          f"{len(out['stops'])} stops, {len(out['routes'])} routes, "
          f"{n_dep} departures, {len(out['services'])} services")


if __name__ == "__main__":
    sys.exit(main())
