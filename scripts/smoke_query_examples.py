#!/usr/bin/env python3
"""Smoke test Phase 5 query API against benchmark fixtures using curl."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURES = REPO_ROOT / "data" / "derived" / "query_examples.json"

REQUIRED_RESPONSE_KEYS = {
    "question",
    "query_type",
    "mode_used",
    "answer_text",
    "confidence",
    "entities_used",
    "events_used",
    "state_changes_used",
    "evidence_refs",
    "reasoning_notes",
    "baseline_comparison",
}
HTTP_CODE_MARKER = "__HTTP_CODE__:"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:3000", help="Base URL for local app (default: http://localhost:3000)")
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--retries", type=int, default=4, help="curl retry count for transient localhost failures")
    parser.add_argument("--retry-delay", type=int, default=1, help="curl retry delay in seconds")
    parser.add_argument("--fail-fast", action="store_true")
    return parser.parse_args()


def load_fixtures(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError(f"{path} must be an envelope with items[]")
    return [row for row in payload["items"] if isinstance(row, dict)]


def post_json(url: str, body: dict[str, Any], timeout: int, retries: int, retry_delay: int) -> tuple[int, str]:
    proc = subprocess.run(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            url,
            "-H",
            "content-type: application/json",
            "--data",
            json.dumps(body, ensure_ascii=False),
            "--max-time",
            str(timeout),
            "--retry",
            str(max(0, retries)),
            "--retry-delay",
            str(max(0, retry_delay)),
            "--retry-connrefused",
            "-w",
            f"\n{HTTP_CODE_MARKER}%{{http_code}}\n",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"curl exited with {proc.returncode}")
    stdout = proc.stdout
    if not stdout:
        return 0, ""
    lines = stdout.splitlines()
    if not lines:
        return 0, ""
    last_line = lines[-1].strip()
    body_text = "\n".join(lines[:-1])
    try:
        if not last_line.startswith(HTTP_CODE_MARKER):
            raise ValueError("missing HTTP code marker")
        code = int(last_line[len(HTTP_CODE_MARKER):].strip())
    except Exception:
        code = 0
        body_text = stdout
    return code, body_text.strip()


def validate_response_shape(payload: Any) -> tuple[bool, str]:
    if not isinstance(payload, dict):
        return False, "response is not an object"
    missing = sorted(REQUIRED_RESPONSE_KEYS - set(payload.keys()))
    if missing:
        return False, f"missing keys: {', '.join(missing)}"
    if not isinstance(payload.get("question"), str) or not payload["question"].strip():
        return False, "question missing/invalid"
    if payload.get("query_type") not in {"fact", "timeline", "state_change", "causal_chain", "evidence", "comparison"}:
        return False, f"invalid query_type: {payload.get('query_type')}"
    if payload.get("mode_used") not in {"kg", "ntg", "hybrid", "baseline_rag"}:
        return False, f"invalid mode_used: {payload.get('mode_used')}"
    if not isinstance(payload.get("answer_text"), str):
        return False, "answer_text missing/invalid"
    if not isinstance(payload.get("confidence"), (int, float)):
        return False, "confidence missing/invalid"
    for key in ["entities_used", "events_used", "state_changes_used", "evidence_refs"]:
        if not isinstance(payload.get(key), list):
            return False, f"{key} missing/invalid"
    if not isinstance(payload.get("reasoning_notes"), str):
        return False, "reasoning_notes missing/invalid"
    baseline = payload.get("baseline_comparison")
    if baseline is not None and not isinstance(baseline, dict):
        return False, "baseline_comparison must be null or object"
    return True, "OK"


def main() -> int:
    args = parse_args()
    fixtures_path = args.fixtures.resolve()
    if not fixtures_path.is_file():
        print(f"error: fixtures file not found: {fixtures_path}")
        return 2

    fixtures = load_fixtures(fixtures_path)
    url = args.base_url.rstrip("/") + "/api/query"

    passed = 0
    failed = 0
    results: list[str] = []

    for fixture in fixtures:
        query_id = str(fixture.get("query_id", "unknown"))
        question = str(fixture.get("question", ""))
        expected_query_type = str(fixture.get("query_type_expected", ""))
        expected_mode = str(fixture.get("mode_expected", ""))
        include_baseline = bool(fixture.get("include_baseline_comparison", False))
        req_body = {
            "question": question,
            "preferred_mode": "auto",
            "include_evidence": True,
            "include_baseline_comparison": include_baseline,
        }

        try:
            status_code, body_text = post_json(
                url,
                req_body,
                timeout=args.timeout,
                retries=args.retries,
                retry_delay=args.retry_delay,
            )
        except Exception as exc:
            failed += 1
            results.append(f"{query_id}: FAIL curl error: {exc}")
            if args.fail_fast:
                break
            continue

        if status_code != 200:
            failed += 1
            results.append(f"{query_id}: FAIL HTTP {status_code}: {body_text[:220]}")
            if args.fail_fast:
                break
            continue

        try:
            payload = json.loads(body_text)
        except json.JSONDecodeError as exc:
            failed += 1
            results.append(f"{query_id}: FAIL invalid JSON response: {exc}")
            if args.fail_fast:
                break
            continue

        ok, msg = validate_response_shape(payload)
        if not ok:
            failed += 1
            results.append(f"{query_id}: FAIL shape: {msg}")
            if args.fail_fast:
                break
            continue

        actual_query_type = str(payload.get("query_type", ""))
        actual_mode = str(payload.get("mode_used", ""))
        baseline = payload.get("baseline_comparison")

        mismatches: list[str] = []
        if expected_query_type and actual_query_type != expected_query_type:
            mismatches.append(f"query_type expected {expected_query_type}, got {actual_query_type}")
        if expected_mode and actual_mode != expected_mode:
            mismatches.append(f"mode expected {expected_mode}, got {actual_mode}")
        if include_baseline and baseline is None:
            mismatches.append("expected baseline_comparison object, got null")

        if mismatches:
            failed += 1
            results.append(f"{query_id}: FAIL " + "; ".join(mismatches))
            if args.fail_fast:
                break
            continue

        passed += 1
        results.append(
            f"{query_id}: PASS type={actual_query_type} mode={actual_mode} events={len(payload.get('events_used', []))} state_changes={len(payload.get('state_changes_used', []))} evidence={len(payload.get('evidence_refs', []))}"
        )

    print(f"Query API smoke test against {url}")
    print(f"Fixtures: {len(fixtures)} | Passed: {passed} | Failed: {failed}")
    for line in results:
        print(f"- {line}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
