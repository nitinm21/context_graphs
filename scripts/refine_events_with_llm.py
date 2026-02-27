#!/usr/bin/env python3
"""Optional Phase 7 event-summary review with OpenAI (writes review sidecar, never mutates core artifacts)."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
EVENTS_PATH = REPO_ROOT / "data" / "derived" / "events.json"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "eval" / "llm_event_refinement_review.json"


def load_dotenv_if_present() -> None:
    dotenv_path = REPO_ROOT / ".env"
    if not dotenv_path.is_file():
        return
    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip().strip('"').strip("'")
        os.environ[key] = value


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=20, help="Number of events to review (default: 20)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"))
    parser.add_argument("--base-url", default=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    parser.add_argument("--timeout", type=int, default=int(os.environ.get("OPENAI_TIMEOUT_MS", "15000") or "15000"))
    parser.add_argument("--dry-run", action="store_true", help="Do not call OpenAI; write prompt-ready placeholders only")
    parser.add_argument("--force", action="store_true", help="Run even if ENABLE_LLM_EVENT_REVIEW is false")
    return parser.parse_args()


def read_events() -> list[dict[str, Any]]:
    payload = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError(f"{EVENTS_PATH} must be an envelope with items[]")
    rows = [row for row in payload["items"] if isinstance(row, dict)]
    rows.sort(key=lambda row: (str(row.get("scene_id", "")), int(row.get("sequence_in_scene", 0)), str(row.get("event_id", ""))))
    return rows


def event_prompt(event: dict[str, Any]) -> tuple[str, str]:
    event_id = str(event.get("event_id", ""))
    scene_id = str(event.get("scene_id", ""))
    event_type_l1 = str(event.get("event_type_l1", ""))
    event_type_l2 = str(event.get("event_type_l2", ""))
    summary = str(event.get("summary", ""))
    confidence = event.get("confidence")
    participants = event.get("participants") if isinstance(event.get("participants"), list) else []
    participant_lines = []
    for p in participants[:8]:
        if not isinstance(p, dict):
            continue
        participant_lines.append(f"- {p.get('entity_id', '')} ({p.get('role', '')})")

    system = (
        "You are reviewing an extracted screenplay event summary. "
        "Provide a clearer candidate summary without adding new facts. "
        "Preserve ambiguity and uncertainty. Return JSON with keys refined_summary and notes."
    )
    user = "\n".join(
        [
            f"event_id: {event_id}",
            f"scene_id: {scene_id}",
            f"event_type_l1: {event_type_l1}",
            f"event_type_l2: {event_type_l2}",
            f"confidence: {confidence}",
            "participants:",
            *(participant_lines or ["- (none)"]),
            "original_summary:",
            summary,
        ]
    )
    return system, user


def extract_output_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    output = payload.get("output")
    if isinstance(output, list):
      parts: list[str] = []
      for item in output:
          if not isinstance(item, dict):
              continue
          content = item.get("content")
          if not isinstance(content, list):
              continue
          for part in content:
              if not isinstance(part, dict):
                  continue
              text = part.get("text")
              if isinstance(text, str) and text.strip():
                  parts.append(text.strip())
      if parts:
          return "\n".join(parts).strip()

    return ""


def call_openai(base_url: str, api_key: str, model: str, system: str, user: str, timeout_ms: int) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/responses"
    body = {
        "model": model,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": system}]},
            {"role": "user", "content": [{"type": "input_text", "text": user}]},
        ],
        "temperature": 0.2,
        "max_output_tokens": 300,
        "metadata": {
            "app": "irishman-narrative-trace-explorer",
            "purpose": "event_review",
            "phase": "phase7",
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=max(1, timeout_ms / 1000)) as response:
            raw = response.read().decode("utf-8", "replace")
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        raise RuntimeError(f"OpenAI HTTP {exc.code}: {raw[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"OpenAI network error: {exc.reason}") from exc


def main() -> int:
    load_dotenv_if_present()
    args = parse_args()

    if not EVENTS_PATH.is_file():
        print(f"error: missing events artifact: {EVENTS_PATH}", file=sys.stderr)
        return 2

    enabled_flag = env_bool("ENABLE_LLM_EVENT_REVIEW", False)
    if not enabled_flag and not args.force:
        print("LLM event review disabled (ENABLE_LLM_EVENT_REVIEW=false). Use --force to run anyway.")
        return 0

    api_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not api_key and not args.dry_run:
        print("error: OPENAI_API_KEY is required unless --dry-run is used", file=sys.stderr)
        return 2

    events = read_events()
    limit = max(1, min(args.limit, len(events))) if events else 0
    selected = events[:limit]

    output_records: list[dict[str, Any]] = []
    started = time.time()

    for index, event in enumerate(selected, start=1):
        system, user = event_prompt(event)
        event_id = str(event.get("event_id", f"idx_{index}"))
        row: dict[str, Any] = {
            "event_id": event_id,
            "scene_id": event.get("scene_id"),
            "event_type_l2": event.get("event_type_l2"),
            "original_summary": event.get("summary"),
            "status": "pending",
        }

        if args.dry_run:
            row.update(
                {
                    "status": "dry_run",
                    "refined_summary_candidate": event.get("summary"),
                    "notes": "Dry run; no OpenAI call executed.",
                    "prompt_preview": user[:300],
                }
            )
            output_records.append(row)
            continue

        try:
            payload = call_openai(args.base_url, api_key, args.model, system, user, args.timeout)
            text = extract_output_text(payload)
            parsed_json: dict[str, Any] | None = None
            if text:
                try:
                    maybe_obj = json.loads(text)
                    if isinstance(maybe_obj, dict):
                        parsed_json = maybe_obj
                except json.JSONDecodeError:
                    parsed_json = None
            row.update(
                {
                    "status": "ok",
                    "refined_summary_candidate": (
                        parsed_json.get("refined_summary") if parsed_json and isinstance(parsed_json.get("refined_summary"), str) else text
                    ),
                    "notes": (
                        parsed_json.get("notes") if parsed_json and isinstance(parsed_json.get("notes"), str) else ""
                    ),
                    "openai_response_id": payload.get("id") if isinstance(payload, dict) else None,
                    "model": payload.get("model") if isinstance(payload, dict) else args.model,
                }
            )
        except Exception as exc:  # noqa: BLE001
            row.update({"status": "error", "error": str(exc)})
        output_records.append(row)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output_payload = {
        "metadata": {
            "artifact_type": "llm_event_refinement_review",
            "schema_version": "0.1.0-draft",
            "pipeline_version": "phase7-llm-event-review",
            "build_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "record_count": len(output_records),
            "dry_run": bool(args.dry_run),
            "model": args.model,
            "feature_flag_enabled": enabled_flag,
            "duration_seconds": round(time.time() - started, 3),
        },
        "items": output_records,
    }
    args.output.write_text(json.dumps(output_payload, indent=2), encoding="utf-8")

    ok_count = sum(1 for row in output_records if row.get("status") in {"ok", "dry_run"})
    err_count = sum(1 for row in output_records if row.get("status") == "error")
    print(f"Wrote {args.output} | reviewed={len(output_records)} ok={ok_count} error={err_count}")
    return 0 if err_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
