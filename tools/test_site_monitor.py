#!/usr/bin/env python3
"""Tests for the alert logic in site_monitor.py.

Covers the two behaviours added on 2026-09-03 after Open-Meteo started
answering with 503s, read timeouts and empty bodies for a few seconds at a
time: an empty body is retried, and a check must fail on ``confirm_runs``
consecutive runs before it pages.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import site_monitor as sm


def cfg(**overrides):
    base = {
        "project": "Test",
        "checks": [
            {"kind": "http", "name": "Homepage", "url": "https://example.test/"},
            {"kind": "http", "name": "Feed", "url": "https://feed.test/", "confirm_runs": 2},
        ],
    }
    base.update(overrides)
    return base


def results(home_ok: bool, feed_ok: bool):
    return [
        sm.CheckResult("Homepage", home_ok, "HTTP 200" if home_ok else "HTTP 500", "https://example.test/"),
        sm.CheckResult("Feed", feed_ok, "HTTP 200" if feed_ok else "HTTP 503", "https://feed.test/"),
    ]


class ConfirmRunsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "state.json"

    def tearDown(self):
        self.tmp.cleanup()

    def run_once(self, home_ok, feed_ok):
        alert, state = sm.build_alert(cfg(), results(home_ok, feed_ok), self.state, False)
        sm.save_json(self.state, state)
        return alert, state

    def test_single_blip_on_confirmed_check_is_silent(self):
        alert, state = self.run_once(True, False)
        self.assertIsNone(alert)
        self.assertEqual(state["streaks"], {"Feed": 1})
        self.assertEqual(state["failing"], {})
        alert, state = self.run_once(True, True)
        self.assertIsNone(alert, "a blip that cleared must not report a recovery either")
        self.assertEqual(state["streaks"], {})

    def test_second_consecutive_failure_alerts_once_then_recovers(self):
        self.run_once(True, False)
        alert, state = self.run_once(True, False)
        self.assertIn("New failures:", alert)
        self.assertIn("- Feed: HTTP 503", alert)
        self.assertEqual(state["failing"], {"Feed": "HTTP 503"})
        alert, _ = self.run_once(True, False)
        self.assertIsNone(alert, "a failure already reported must not page again")
        alert, state = self.run_once(True, True)
        self.assertIn("Recovered:", alert)
        self.assertIn("- Feed", alert)
        self.assertEqual(state["failing"], {})

    def test_default_threshold_alerts_on_first_failure(self):
        alert, _ = self.run_once(False, True)
        self.assertIn("- Homepage: HTTP 500", alert)

    def test_last_ok_reflects_raw_results(self):
        _, state = self.run_once(True, False)
        self.assertFalse(state["last_ok"])

    def test_old_state_without_streaks_still_loads(self):
        sm.save_json(self.state, {"failing": {"Feed": "HTTP 503"}, "last_ok": False})
        alert, state = self.run_once(True, False)
        self.assertIsNone(alert, "a check already failing in old state is not new")
        self.assertEqual(state["failing"], {"Feed": "HTTP 503"})


class EmptyBodyRetryTest(unittest.TestCase):
    def test_empty_body_is_retried(self):
        answers = [
            (sm.HttpResponse(200, b""), 10, None),
            (sm.HttpResponse(200, b'{"current": {"temperature_2m": 19.6}}'), 10, None),
        ]
        with mock.patch.object(sm, "request", side_effect=answers), mock.patch.object(sm.time, "sleep"):
            response, _, error, attempts = sm.request_with_retries({"url": "u", "retry_delay_seconds": 0}, 1)
        self.assertEqual(attempts, 2)
        self.assertIsNone(error)
        self.assertEqual(json.loads(response.text)["current"]["temperature_2m"], 19.6)

    def test_status_503_is_retried_up_to_configured_attempts(self):
        answers = [(sm.HttpResponse(503, b"busy"), 10, None)] * 6
        with mock.patch.object(sm, "request", side_effect=answers), mock.patch.object(sm.time, "sleep"):
            response, _, _, attempts = sm.request_with_retries({"url": "u", "retries": 5}, 1)
        self.assertEqual(attempts, 6)
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
