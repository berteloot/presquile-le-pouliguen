#!/usr/bin/env python3
"""Feed transitions: the day a new GTFS calendar starts later than today.

Run: python3 tools/test_build_transit_data.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_transit_data import carry_over_gap, day_before  # noqa: E402


def september_feed() -> dict:
    return {
        "feed": {"feed_start_date": "20260901", "feed_end_date": "20261218"},
        "stops": [{"id": "372", "name": "Gare SNCF", "lat": 47.28, "lon": -2.43}],
        "routes": {"255": {"shortName": "1"}},
        "departures": {"372": [{"t": 25800, "trip": "new-1", "route": "255",
                                "headsign": "La Baule", "service": "sept"}]},
        "services": {"sept": {"days": [1, 1, 1, 1, 1, 1, 1],
                              "start": "20260901", "end": "20261218"}},
        "serviceExceptions": {},
        "trips": {"new-1": {"route": "255", "headsign": "La Baule"}},
    }


def july_feed() -> dict:
    return {
        "stops": [{"id": "372", "name": "Gare SNCF"}],
        "routes": {"255": {"shortName": "1"}, "old": {"shortName": "9"}},
        "departures": {"372": [{"t": 21600, "trip": "old-1", "route": "255",
                                "headsign": "La Baule", "service": "july"}],
                       "999": [{"t": 21600, "trip": "old-2", "route": "255",
                                "headsign": "Nowhere", "service": "july"}]},
        "services": {"july": {"days": [1, 1, 1, 1, 1, 1, 1],
                              "start": "20260105", "end": "20261220"}},
        "serviceExceptions": {"july": {"20260830": 2, "20261115": 1}},
        "trips": {"old-1": {"route": "255", "headsign": "La Baule"},
                  "old-2": {"route": "255", "headsign": "Nowhere"}},
    }


def test_day_before_crosses_a_month():
    assert day_before("20260901") == "20260831"
    assert day_before("20260101") == "20251231"


def test_the_gap_is_covered_and_clamped():
    out = september_feed()
    carry_over_gap(out, july_feed(), "20260830")
    assert out["services"]["july"] == {"days": [1] * 7, "start": "20260830",
                                       "end": "20260831"}, out["services"]["july"]
    assert [d["trip"] for d in out["departures"]["372"]] == ["old-1", "new-1"]


def test_an_exception_outside_the_gap_is_dropped():
    out = september_feed()
    carry_over_gap(out, july_feed(), "20260830")
    assert out["serviceExceptions"]["july"] == {"20260830": 2}


def test_a_stop_the_new_feed_dropped_is_not_resurrected():
    out = september_feed()
    carry_over_gap(out, july_feed(), "20260830")
    assert "999" not in out["departures"]


def test_nothing_is_carried_once_the_new_feed_has_started():
    out = september_feed()
    carry_over_gap(out, july_feed(), "20260901")
    assert list(out["services"]) == ["sept"]
    assert [d["trip"] for d in out["departures"]["372"]] == ["new-1"]


def test_a_feed_that_already_covers_today_carries_nothing():
    out = september_feed()
    out["feed"]["feed_start_date"] = "20260101"
    carry_over_gap(out, july_feed(), "20260830")
    assert list(out["services"]) == ["sept"]


def test_a_first_run_with_no_previous_file_is_fine():
    out = september_feed()
    carry_over_gap(out, {}, "20260830")
    assert list(out["services"]) == ["sept"]


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
