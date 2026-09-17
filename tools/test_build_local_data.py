#!/usr/bin/env python3
"""Tests for the Overpass mirror fallback in build_dae.

A single 504 from the main Overpass instance left dae.json a week stale on
2026-09-14. These cases prove the collector moves to the next mirror and only
fails when every mirror does.
"""
from __future__ import annotations

import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_local_data as bld

ONE_NODE = json.dumps(
    {"elements": [{"lat": 47.277, "lon": -2.429, "tags": {"name": "Mairie"}}]}
).encode()


def run_with(responses, tmp_dir):
    """Replace fetch with a queue of outcomes, keyed by mirror order."""
    calls = []

    def fake_fetch(url, timeout=180):
        calls.append(url.split("/api/")[0])
        outcome = responses[len(calls) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    real_fetch, real_out = bld.fetch, bld.OUT_DIR
    bld.fetch, bld.OUT_DIR = fake_fetch, tmp_dir
    try:
        bld.build_dae()
    finally:
        bld.fetch, bld.OUT_DIR = real_fetch, real_out
    return calls


def gateway_timeout():
    return urllib.error.HTTPError("url", 504, "Gateway Timeout", {}, None)


def main() -> int:
    import tempfile

    failures = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)

        cases = [
            ("first mirror answers, no others tried", [ONE_NODE], 1, True),
            ("504 on the first mirror falls through", [gateway_timeout(), ONE_NODE], 2, True),
            (
                "two failures still reach the third mirror",
                [gateway_timeout(), TimeoutError("read timed out"), ONE_NODE],
                3,
                True,
            ),
            (
                "every mirror down raises instead of writing",
                [gateway_timeout()] * len(bld.OVERPASS_URLS),
                len(bld.OVERPASS_URLS),
                False,
            ),
        ]
        for name, responses, expected_calls, should_write in cases:
            target = tmp_dir / "dae.json"
            if target.exists():
                target.unlink()
            try:
                calls = run_with(responses, tmp_dir)
                wrote = target.exists()
            except RuntimeError:
                calls = responses  # every mirror was attempted before raising
                wrote = target.exists()
            ok = len(calls) == expected_calls and wrote == should_write
            print(f"{'ok' if ok else 'FAIL'}:   {name}")
            if not ok:
                failures.append(name)
                print(f"        calls={len(calls)} (want {expected_calls}) wrote={wrote}")

        if len(bld.OVERPASS_URLS) < 2:
            failures.append("fewer than two Overpass mirrors configured")
            print("FAIL:   fewer than two Overpass mirrors configured")

    print(f"{len(cases) - len(failures)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
