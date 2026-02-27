#!/usr/bin/env python3
"""Evaluate Phase 3 event taxonomy coverage and unmapped events."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TAXONOMY = REPO_ROOT / "config" / "event_taxonomy.json"
DEFAULT_EVENTS = REPO_ROOT / "data" / "derived" / "events.json"
DEFAULT_EVAL_DIR = REPO_ROOT / "data" / "eval"
SCRIPT_VERSION = "phase3-taxonomy-coverage-v0.1.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--taxonomy", type=Path, default=DEFAULT_TAXONOMY)
    parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS)
    parser.add_argument("--eval-dir", type=Path, default=DEFAULT_EVAL_DIR)
    parser.add_argument("--release", action="store_true", help="Fail if any unmapped/unknown event types remain")
    parser.add_argument("--indent", type=int, default=2)
    return parser.parse_args()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_envelope(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must be a JSON object envelope")
    metadata = payload.get("metadata")
    items = payload.get("items")
    if not isinstance(metadata, dict) or not isinstance(items, list):
        raise ValueError(f"{path} missing metadata/items")
    return metadata, items


def write_json(path: Path, payload: dict[str, Any], indent: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=indent if indent > 0 else None, ensure_ascii=False)
        f.write("\n")


def main() -> int:
    args = parse_args()
    taxonomy_path = args.taxonomy.resolve()
    events_path = args.events.resolve()
    eval_dir = args.eval_dir.resolve()

    if not taxonomy_path.is_file():
        print(f"error: missing taxonomy file: {taxonomy_path}")
        return 2
    if not events_path.is_file():
        print(f"error: missing events artifact: {events_path}")
        return 2

    taxonomy = load_json(taxonomy_path)
    if not isinstance(taxonomy, dict):
        print("error: taxonomy file must be a JSON object")
        return 2
    l1_categories = [str(x) for x in taxonomy.get("l1_categories", []) if isinstance(x, str)]
    l2_index_raw = taxonomy.get("l2_index")
    if not isinstance(l2_index_raw, dict):
        print("error: taxonomy missing l2_index")
        return 2

    l2_to_l1: dict[str, str] = {}
    for l2, info in l2_index_raw.items():
        if isinstance(info, dict) and isinstance(info.get("event_type_l1"), str):
            l2_to_l1[str(l2)] = str(info["event_type_l1"])

    events_meta, events = load_envelope(events_path)

    l1_counts: Counter[str] = Counter()
    l2_counts: Counter[str] = Counter()
    unknown_type_events: list[dict[str, Any]] = []
    l1_mismatch_events: list[dict[str, Any]] = []
    unmapped_review_events: list[dict[str, Any]] = []
    examples_by_l2: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for event in events:
        if not isinstance(event, dict):
            continue
        event_id = str(event.get("event_id", ""))
        scene_id = str(event.get("scene_id", ""))
        l1 = str(event.get("event_type_l1", ""))
        l2 = str(event.get("event_type_l2", ""))
        summary = str(event.get("summary", ""))
        l1_counts[l1] += 1
        l2_counts[l2] += 1

        if l2 not in l2_to_l1:
            unknown_type_events.append(
                {
                    "event_id": event_id,
                    "scene_id": scene_id,
                    "event_type_l1": l1,
                    "event_type_l2": l2,
                    "summary": summary,
                }
            )
            continue

        expected_l1 = l2_to_l1[l2]
        if l1 != expected_l1:
            l1_mismatch_events.append(
                {
                    "event_id": event_id,
                    "scene_id": scene_id,
                    "event_type_l1": l1,
                    "event_type_l2": l2,
                    "expected_event_type_l1": expected_l1,
                    "summary": summary,
                }
            )

        if l2 == "unmapped_review_required":
            unmapped_review_events.append(
                {
                    "event_id": event_id,
                    "scene_id": scene_id,
                    "summary": summary,
                }
            )

        if len(examples_by_l2[l2]) < 3:
            examples_by_l2[l2].append(
                {
                    "event_id": event_id,
                    "scene_id": scene_id,
                    "summary": summary,
                }
            )

    missing_l2_types = sorted([l2 for l2 in l2_to_l1 if l2 not in l2_counts])
    l1_expected_set = set(l1_categories)
    l1_observed_set = set(l1_counts)
    missing_l1_categories = sorted([l1 for l1 in l1_categories if l1_counts.get(l1, 0) == 0])

    report = {
        "metadata": {
            "artifact_type": "taxonomy_coverage_report",
            "schema_version": "0.1.0-draft",
            "pipeline_version": SCRIPT_VERSION,
            "build_timestamp": utc_now_iso(),
            "taxonomy_file": str(taxonomy_path.relative_to(REPO_ROOT)) if taxonomy_path.is_relative_to(REPO_ROOT) else str(taxonomy_path),
            "events_file": str(events_path.relative_to(REPO_ROOT)) if events_path.is_relative_to(REPO_ROOT) else str(events_path),
            "events_source_file_hash": str(events_meta.get("source_file_hash") or ""),
            "taxonomy_file_hash": sha256_hex(taxonomy_path.read_bytes()),
            "events_file_hash": sha256_hex(events_path.read_bytes()),
        },
        "summary": {
            "total_events": len(events),
            "taxonomy_l1_count": len(l1_categories),
            "taxonomy_l2_count": len(l2_to_l1),
            "observed_l1_count": len(l1_observed_set),
            "observed_l2_count": len(l2_counts),
            "unknown_event_type_count": len(unknown_type_events),
            "l1_mismatch_count": len(l1_mismatch_events),
            "unmapped_review_required_count": len(unmapped_review_events),
            "missing_l1_categories_count": len(missing_l1_categories),
            "missing_l2_types_count": len(missing_l2_types),
        },
        "counts": {
            "by_l1": dict(sorted(l1_counts.items())),
            "by_l2": dict(sorted(l2_counts.items())),
        },
        "coverage": {
            "observed_l1_categories": sorted(l1_observed_set),
            "missing_l1_categories": missing_l1_categories,
            "missing_l2_types": missing_l2_types,
            "l1_categories_not_in_taxonomy_but_observed": sorted(l1_observed_set - l1_expected_set),
        },
        "issues": {
            "unknown_event_types": unknown_type_events[:200],
            "l1_mismatches": l1_mismatch_events[:200],
            "unmapped_review_required_events": unmapped_review_events[:200],
        },
        "examples_by_l2": dict(sorted(examples_by_l2.items())),
    }

    unmapped_review_payload = {
        "metadata": {
            "artifact_type": "unmapped_events_review",
            "schema_version": "0.1.0-draft",
            "pipeline_version": SCRIPT_VERSION,
            "build_timestamp": report["metadata"]["build_timestamp"],
            "events_file": report["metadata"]["events_file"],
        },
        "summary": {
            "unknown_event_type_count": len(unknown_type_events),
            "unmapped_review_required_count": len(unmapped_review_events),
            "release_blocking_issue_count": len(unknown_type_events) + len(unmapped_review_events) + len(l1_mismatch_events),
        },
        "items": [
            *[
                {"issue_type": "unknown_event_type", **row}
                for row in unknown_type_events
            ],
            *[
                {"issue_type": "l1_mismatch", **row}
                for row in l1_mismatch_events
            ],
            *[
                {"issue_type": "unmapped_review_required", **row}
                for row in unmapped_review_events
            ],
        ],
    }

    write_json(eval_dir / "taxonomy_coverage_report.json", report, args.indent)
    write_json(eval_dir / "unmapped_events_review.json", unmapped_review_payload, args.indent)

    summary = report["summary"]
    print(f"Wrote coverage reports to {eval_dir}")
    print(
        "Coverage summary: "
        f"events={summary['total_events']}, observed_l1={summary['observed_l1_count']}/{summary['taxonomy_l1_count']}, "
        f"observed_l2={summary['observed_l2_count']}/{summary['taxonomy_l2_count']}"
    )
    print(
        "Issues: "
        f"unknown_types={summary['unknown_event_type_count']}, "
        f"l1_mismatches={summary['l1_mismatch_count']}, "
        f"unmapped_review_required={summary['unmapped_review_required_count']}"
    )

    if args.release:
        release_blockers = (
            summary["unknown_event_type_count"]
            + summary["l1_mismatch_count"]
            + summary["unmapped_review_required_count"]
        )
        if release_blockers > 0:
            print(f"Release coverage check FAILED with {release_blockers} blocking issue(s).")
            return 1
        print("Release coverage check passed.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
