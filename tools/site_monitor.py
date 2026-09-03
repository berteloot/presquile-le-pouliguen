#!/usr/bin/env python3
"""Monitor Le Pouliguen Live endpoints and optionally alert on Telegram.

The script is intentionally dependency-free so it can run from GitHub Actions,
cron, or any small Pierre-style runner.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "monitoring" / "pierre-site-monitor.json"
DEFAULT_STATE = ROOT / ".monitor-state.json"
DEFAULT_TIMEOUT = 15
DEFAULT_RETRIES = 2
DEFAULT_RETRY_STATUSES = {429, 500, 502, 503, 504}


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str
    url: str
    elapsed_ms: int = 0


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_dt(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def load_json(path: Path) -> dict[str, Any]:
    with open(path) as f:
        return json.load(f)


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)


def read_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"failing": {}}
    try:
        return load_json(path)
    except (OSError, json.JSONDecodeError):
        return {"failing": {}}


@dataclass
class HttpResponse:
    status_code: int
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text)


def request(url: str, timeout: int) -> tuple[HttpResponse | None, int, str | None]:
    start = time.monotonic()
    try:
        req = Request(url, headers={"User-Agent": "Pierre site monitor/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            content = resp.read()
            status = getattr(resp, "status", resp.getcode())
        return HttpResponse(status, content), int((time.monotonic() - start) * 1000), None
    except HTTPError as exc:
        return HttpResponse(exc.code, exc.read()), int((time.monotonic() - start) * 1000), None
    except (URLError, TimeoutError, OSError) as exc:
        return None, int((time.monotonic() - start) * 1000), str(exc)


def request_with_retries(
    item: dict[str, Any],
    timeout: int,
) -> tuple[HttpResponse | None, int, str | None, int]:
    retries = int(item.get("retries", DEFAULT_RETRIES))
    retry_statuses = set(item.get("retry_statuses", DEFAULT_RETRY_STATUSES))
    delay_seconds = float(item.get("retry_delay_seconds", 1))
    attempts = max(1, retries + 1)
    total_elapsed_ms = 0
    last_response: HttpResponse | None = None
    last_error: str | None = None

    for attempt in range(1, attempts + 1):
        response, elapsed_ms, error = request(item["url"], timeout)
        total_elapsed_ms += elapsed_ms
        last_response = response
        last_error = error

        empty_body = response is not None and not response.content
        should_retry = response is None or response.status_code in retry_statuses or empty_body
        if not should_retry or attempt == attempts:
            return response, total_elapsed_ms, error, attempt

        time.sleep(delay_seconds * attempt)

    return last_response, total_elapsed_ms, last_error, attempts


def value_at_path(payload: Any, path: str) -> Any:
    current = payload
    for part in path.split("."):
        current = current[part] if isinstance(current, dict) else current[int(part)]
    return current


def validate_http_response(
    item: dict[str, Any],
    response: HttpResponse | None,
    elapsed_ms: int,
    error: str | None,
    attempts: int,
) -> CheckResult | None:
    attempt_note = f" after {attempts} attempts" if attempts > 1 else ""
    if response is None:
        return CheckResult(item["name"], False, f"{error or 'request failed'}{attempt_note}", item["url"], elapsed_ms)

    expected = set(item.get("expect_status", [200]))
    if response.status_code not in expected:
        return CheckResult(item["name"], False, f"HTTP {response.status_code}, expected {sorted(expected)}{attempt_note}", item["url"], elapsed_ms)

    min_bytes = int(item.get("min_bytes", 0))
    if min_bytes and len(response.content) < min_bytes:
        return CheckResult(item["name"], False, f"{len(response.content)} bytes, expected at least {min_bytes}", item["url"], elapsed_ms)

    contains = item.get("contains")
    if contains and contains not in response.text:
        return CheckResult(item["name"], False, f"missing expected text: {contains}", item["url"], elapsed_ms)

    json_path = item.get("json_path")
    if json_path:
        try:
            found = value_at_path(response.json(), str(json_path))
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            return CheckResult(item["name"], False, f"bad json path {json_path}: {exc}", item["url"], elapsed_ms)
        if found in (None, "", [], {}):
            return CheckResult(item["name"], False, f"empty json path: {json_path}", item["url"], elapsed_ms)

    return None


def check_http(item: dict[str, Any], timeout: int) -> CheckResult:
    response, elapsed_ms, error, attempts = request_with_retries(item, timeout)
    invalid = validate_http_response(item, response, elapsed_ms, error, attempts)
    if invalid:
        return invalid

    attempt_note = f" after {attempts} attempts" if attempts > 1 else ""
    assert response is not None
    return CheckResult(item["name"], True, f"HTTP {response.status_code}, {elapsed_ms} ms{attempt_note}", item["url"], elapsed_ms)


def check_generated_json(item: dict[str, Any], timeout: int) -> CheckResult:
    response, elapsed_ms, error, attempts = request_with_retries(item, timeout)
    invalid = validate_http_response(item, response, elapsed_ms, error, attempts)
    if invalid:
        return invalid

    assert response is not None
    try:
        payload = response.json()
    except ValueError as exc:
        return CheckResult(item["name"], False, f"invalid JSON: {exc}", item["url"], elapsed_ms)

    generated = parse_dt(str(payload.get("generated", "")))
    if not generated:
        return CheckResult(item["name"], False, "missing generated timestamp", item["url"], elapsed_ms)

    max_age_hours = int(item.get("max_age_hours", 24 * 45))
    age_hours = (utc_now() - generated).total_seconds() / 3600
    if age_hours > max_age_hours:
        return CheckResult(item["name"], False, f"generated {age_hours:.0f} h ago, max {max_age_hours} h", item["url"], elapsed_ms)
    return CheckResult(item["name"], True, f"generated {age_hours:.1f} h ago", item["url"], elapsed_ms)


def run_checks(cfg: dict[str, Any]) -> list[CheckResult]:
    timeout = int(cfg.get("timeout_seconds", DEFAULT_TIMEOUT))
    results: list[CheckResult] = []
    for item in cfg.get("checks", []):
        kind = item.get("kind", "http")
        if kind == "generated_json":
            results.append(check_generated_json(item, timeout))
        elif kind == "http":
            results.append(check_http(item, timeout))
        else:
            results.append(CheckResult(item.get("name", "unnamed"), False, f"unknown check kind: {kind}", item.get("url", "")))
    return results


def confirm_runs_for(cfg: dict[str, Any], item: dict[str, Any]) -> int:
    """How many consecutive failing runs a check needs before it is reported.

    Third-party feeds blip for a few seconds and are back by the next run, so a
    single failing run on those pages twice (failure, then recovery) for
    nothing. Per-check ``confirm_runs`` wins over the top-level default of 1.
    """
    return max(1, int(item.get("confirm_runs", cfg.get("confirm_runs", 1))))


def build_alert(cfg: dict[str, Any], results: list[CheckResult], state_path: Path, force: bool) -> tuple[str | None, dict[str, Any]]:
    state = read_state(state_path)
    previous = state.get("failing", {})
    thresholds = {item.get("name", "unnamed"): confirm_runs_for(cfg, item) for item in cfg.get("checks", [])}
    old_streaks = state.get("streaks", {})
    streaks: dict[str, int] = {}
    for r in results:
        # A state file written before streaks existed lists confirmed failures
        # only; count those as already past their threshold.
        seed = thresholds.get(r.name, 1) if r.name in previous else 0
        streaks[r.name] = int(old_streaks.get(r.name, seed)) + 1 if not r.ok else 0
    # A failure counts only once it has held for confirm_runs consecutive runs.
    current = {r.name: r.detail for r in results if not r.ok and streaks[r.name] >= thresholds.get(r.name, 1)}
    new_failures = [r for r in results if r.name in current and r.name not in previous]
    recoveries = [name for name in previous if name not in current]

    state["failing"] = current
    state["streaks"] = {name: n for name, n in streaks.items() if n}
    state["last_run"] = utc_now().isoformat()
    state["last_ok"] = not any(not r.ok for r in results)

    if force and not current:
        return f"Pierre monitor: {cfg.get('project', 'Website monitor')}\nAll checks green ({len(results)} checks).", state
    if not new_failures and not recoveries:
        return None, state

    lines = [f"Pierre monitor: {cfg.get('project', 'Website monitor')}"]
    if new_failures:
        lines.append("\nNew failures:")
        for result in new_failures:
            lines.append(f"- {result.name}: {result.detail}")
            lines.append(f"  {result.url}")
    if recoveries:
        lines.append("\nRecovered:")
        lines.extend(f"- {name}" for name in recoveries)
    lines.append(f"\nStill failing: {len(current)} check(s)" if current else "\nAll checks are green again.")
    return "\n".join(lines), state


def send_telegram(message: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("Telegram not configured: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID", file=sys.stderr)
        return False

    ok = True
    for i in range(0, len(message), 4000):
        payload = urlencode({"chat_id": chat_id, "text": message[i:i + 4000]}).encode()
        req = Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urlopen(req, timeout=15) as resp:
                ok = ok and getattr(resp, "status", resp.getcode()) == 200
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            print(f"Telegram send failed: {exc}", file=sys.stderr)
            ok = False
    return ok


def print_report(results: list[CheckResult]) -> None:
    for result in results:
        mark = "OK" if result.ok else "FAIL"
        print(f"[{mark}] {result.name}: {result.detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Le Pouliguen Live site monitor")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--state", default=str(DEFAULT_STATE))
    parser.add_argument("--telegram", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--always-alert", action="store_true")
    args = parser.parse_args()

    cfg = load_json(Path(args.config))
    results = run_checks(cfg)
    alert, state = build_alert(cfg, results, Path(args.state), args.always_alert)
    save_json(Path(args.state), state)

    if not args.quiet:
        print_report(results)
    if args.telegram and alert:
        send_telegram(alert)

    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
