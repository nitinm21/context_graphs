#!/usr/bin/env python3
"""Infer Phase 4 relationship/state changes from extracted events."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVENTS = REPO_ROOT / "data" / "derived" / "events.json"
DEFAULT_SCENE_INDEX = REPO_ROOT / "data" / "derived" / "scene_index.json"
DEFAULT_ENTITIES = REPO_ROOT / "data" / "derived" / "entities.json"
DEFAULT_RULES = REPO_ROOT / "config" / "state_change_rules.json"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "derived"

SCRIPT_VERSION = "phase4-state-changes-v0.1.0"
SCHEMA_VERSION = "0.1.0-draft"
ALLOWED_DIRECTIONS = {"increase", "decrease", "shift", "break", "repair_attempt", "stabilize"}
ALLOWED_MAGNITUDES = {"low", "medium", "high", None}
ALLOWED_CLAIM_TYPES = {"explicit", "inferred"}
MAGNITUDE_RANK = {None: 0, "low": 1, "medium": 2, "high": 3}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS)
    parser.add_argument("--scene-index", type=Path, default=DEFAULT_SCENE_INDEX)
    parser.add_argument("--entities", type=Path, default=DEFAULT_ENTITIES)
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
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
        raise ValueError(f"{path} missing metadata/items envelope")
    return metadata, items


def write_json(path: Path, payload: dict[str, Any], indent: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=indent if indent > 0 else None, ensure_ascii=False)
        f.write("\n")


def make_envelope(
    *,
    artifact_type: str,
    schema_version: str,
    pipeline_version: str,
    build_timestamp: str,
    source_file_hash: str,
    items: list[dict[str, Any]],
    extra_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "artifact_type": artifact_type,
        "schema_version": schema_version,
        "pipeline_version": pipeline_version,
        "build_timestamp": build_timestamp,
        "source_file_hash": source_file_hash,
        "record_count": len(items),
    }
    if extra_metadata:
        metadata.update(extra_metadata)
    return {"metadata": metadata, "items": items}


def as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def safe_int(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        return int(str(value).strip())
    except Exception:
        return default


def safe_float(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except Exception:
        return default


def unique_stable(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def pair_key(subject_id: str, object_id: str) -> str:
    return f"{subject_id}->{object_id}"


def pair_key_undirected(subject_id: str, object_id: str) -> str:
    a, b = sorted([subject_id, object_id])
    return f"{a}<->{b}"


def collect_event_text(event: dict[str, Any]) -> str:
    parts: list[str] = []
    summary = as_str(event.get("summary"))
    if summary:
        parts.append(summary)
    metadata = event.get("metadata")
    if isinstance(metadata, dict):
        evidence_spans = metadata.get("evidence_spans")
        if isinstance(evidence_spans, list):
            for span in evidence_spans:
                if isinstance(span, dict):
                    snippet = as_str(span.get("snippet"))
                    if snippet:
                        parts.append(snippet)
        notes = metadata.get("classification_notes")
        if isinstance(notes, list):
            parts.extend(str(note) for note in notes if isinstance(note, (str, int, float)))
    parts.append(str(event.get("event_type_l1", "")))
    parts.append(str(event.get("event_type_l2", "")))
    return " \n ".join(parts).lower()


def build_scene_order(scene_index_items: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, dict[str, Any]]]:
    scene_order_by_id: dict[str, int] = {}
    scene_row_by_id: dict[str, dict[str, Any]] = {}
    for row in scene_index_items:
        if not isinstance(row, dict):
            continue
        scene_id = as_str(row.get("scene_id"))
        if not scene_id:
            continue
        scene_order_by_id[scene_id] = safe_int(row.get("scene_index"), default=10**9)
        scene_row_by_id[scene_id] = row
    return scene_order_by_id, scene_row_by_id


def validate_rules_config(cfg: dict[str, Any]) -> tuple[bool, str]:
    rules = cfg.get("rules")
    if not isinstance(rules, list):
        return False, "rules must be a list"
    for idx, rule in enumerate(rules):
        if not isinstance(rule, dict):
            return False, f"rules[{idx}] must be an object"
        for key in ["rule_id", "subject_id", "object_id", "state_dimension", "direction", "claim_type"]:
            if not isinstance(rule.get(key), str) or not str(rule.get(key)).strip():
                return False, f"rules[{idx}] missing/invalid {key}"
        direction = str(rule["direction"])
        if direction not in ALLOWED_DIRECTIONS:
            return False, f"rules[{idx}] invalid direction: {direction}"
        claim_type = str(rule["claim_type"])
        if claim_type not in ALLOWED_CLAIM_TYPES:
            return False, f"rules[{idx}] invalid claim_type: {claim_type}"
        magnitude = rule.get("magnitude")
        if magnitude not in ALLOWED_MAGNITUDES:
            return False, f"rules[{idx}] invalid magnitude: {magnitude}"
    return True, "OK"


def rule_matches_event(rule: dict[str, Any], event: dict[str, Any], participant_ids: set[str], haystack_lower: str) -> bool:
    subject_id = str(rule.get("subject_id", "")).strip()
    object_id = str(rule.get("object_id", "")).strip()
    if not subject_id or not object_id or subject_id == object_id:
        return False
    if subject_id not in participant_ids or object_id not in participant_ids:
        return False

    event_type_l1 = str(event.get("event_type_l1", ""))
    event_type_l2 = str(event.get("event_type_l2", ""))

    l1_any = rule.get("event_type_l1_any")
    if isinstance(l1_any, list):
        allowed = {str(x) for x in l1_any}
        if event_type_l1 not in allowed:
            return False

    l2_any = rule.get("event_type_l2_any")
    if isinstance(l2_any, list):
        allowed = {str(x) for x in l2_any}
        if event_type_l2 not in allowed:
            return False

    l2_not = rule.get("event_type_l2_not")
    if isinstance(l2_not, list):
        disallowed = {str(x) for x in l2_not}
        if event_type_l2 in disallowed:
            return False

    min_event_conf = rule.get("min_event_confidence")
    if min_event_conf is not None and safe_float(event.get("confidence"), 0.0) < safe_float(min_event_conf, 0.0):
        return False

    text_any = rule.get("text_any")
    if isinstance(text_any, list):
        needles = [str(x).lower() for x in text_any if str(x).strip()]
        if needles and not any(needle in haystack_lower for needle in needles):
            return False

    text_all = rule.get("text_all")
    if isinstance(text_all, list):
        needles = [str(x).lower() for x in text_all if str(x).strip()]
        if needles and not all(needle in haystack_lower for needle in needles):
            return False

    text_none = rule.get("text_none")
    if isinstance(text_none, list):
        needles = [str(x).lower() for x in text_none if str(x).strip()]
        if any(needle in haystack_lower for needle in needles):
            return False

    return True


def combine_confidence(rule_conf: float, event_conf: float) -> float:
    combined = (rule_conf * 0.7) + (event_conf * 0.3)
    return round(max(0.05, min(0.999, combined)), 3)


def main() -> int:
    args = parse_args()
    events_path = args.events.resolve()
    scene_index_path = args.scene_index.resolve()
    entities_path = args.entities.resolve()
    rules_path = args.rules.resolve()
    out_dir = args.out_dir.resolve()

    for required in [events_path, scene_index_path, entities_path, rules_path]:
        if not required.is_file():
            print(f"error: missing required file: {required}")
            return 2

    try:
        events_meta, events = load_envelope(events_path)
        _scene_index_meta, scene_index_items = load_envelope(scene_index_path)
        _entities_meta, entities = load_envelope(entities_path)
    except Exception as exc:
        print(f"error: {exc}")
        return 2

    cfg = load_json(rules_path)
    if not isinstance(cfg, dict):
        print("error: state_change_rules.json must be a JSON object")
        return 2
    ok, msg = validate_rules_config(cfg)
    if not ok:
        print(f"error: invalid rules config: {msg}")
        return 2

    rules: list[dict[str, Any]] = [r for r in cfg.get("rules", []) if isinstance(r, dict) and r.get("enabled", True) is not False]
    core_pairs = [p for p in cfg.get("core_pairs", []) if isinstance(p, dict)]

    scene_order_by_id, scene_row_by_id = build_scene_order(scene_index_items)
    entity_name_by_id: dict[str, str] = {}
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_id = as_str(entity.get("entity_id"))
        canonical_name = as_str(entity.get("canonical_name"))
        if entity_id and canonical_name:
            entity_name_by_id[entity_id] = canonical_name

    normalized_events: list[dict[str, Any]] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        event_id = as_str(event.get("event_id"))
        scene_id = as_str(event.get("scene_id"))
        if not event_id or not scene_id:
            continue
        normalized_events.append(event)

    normalized_events.sort(
        key=lambda e: (
            scene_order_by_id.get(str(e.get("scene_id")), 10**9),
            safe_int(e.get("sequence_in_scene"), default=0),
            str(e.get("event_id", "")),
        )
    )
    event_order_pos = {str(e["event_id"]): idx for idx, e in enumerate(normalized_events)}

    aggregated: dict[tuple[str, str, str, str, str, str], dict[str, Any]] = {}
    rule_hits: Counter[str] = Counter()

    for event in normalized_events:
        participants_raw = event.get("participants")
        if not isinstance(participants_raw, list):
            continue
        participant_ids = {
            str(p.get("entity_id"))
            for p in participants_raw
            if isinstance(p, dict) and isinstance(p.get("entity_id"), str)
        }
        if len(participant_ids) < 2:
            continue

        haystack_lower = collect_event_text(event)
        event_id = str(event.get("event_id"))
        scene_id = str(event.get("scene_id"))
        event_conf = safe_float(event.get("confidence"), 0.0)
        evidence_refs = [str(x) for x in event.get("evidence_refs", []) if isinstance(x, str)]
        event_type_l2 = str(event.get("event_type_l2", ""))

        for rule in rules:
            if not rule_matches_event(rule, event, participant_ids, haystack_lower):
                continue

            subject_id = str(rule["subject_id"])
            object_id = str(rule["object_id"])
            state_dimension = str(rule["state_dimension"])
            direction = str(rule["direction"])
            magnitude = rule.get("magnitude")
            magnitude_value = str(magnitude) if isinstance(magnitude, str) else None
            claim_type = str(rule["claim_type"])
            rule_conf = safe_float(rule.get("confidence"), 0.7)
            inference_method = str(rule.get("inference_method") or "rule+review")
            rule_id = str(rule.get("rule_id") or "rule")

            agg_key = (scene_id, subject_id, object_id, state_dimension, direction, claim_type)
            row = aggregated.get(agg_key)
            if row is None:
                row = {
                    "scene_id": scene_id,
                    "subject_id": subject_id,
                    "object_id": object_id,
                    "state_dimension": state_dimension,
                    "direction": direction,
                    "magnitude": magnitude_value,
                    "claim_type": claim_type,
                    "trigger_event_ids": [],
                    "evidence_refs": [],
                    "confidence": 0.0,
                    "inference_method": inference_method,
                    "metadata": {
                        "rule_ids": [],
                        "trigger_event_type_l2s": [],
                        "scene_header_raw": str((scene_row_by_id.get(scene_id) or {}).get("header_raw") or ""),
                    },
                    "_sort_event_pos": event_order_pos.get(event_id, 10**9),
                }
                aggregated[agg_key] = row

            row["trigger_event_ids"] = unique_stable(list(row["trigger_event_ids"]) + [event_id])
            row["evidence_refs"] = unique_stable(list(row["evidence_refs"]) + evidence_refs)
            row["confidence"] = max(float(row["confidence"]), combine_confidence(rule_conf, event_conf))

            if magnitude_value is not None:
                current_mag = row.get("magnitude")
                current_rank = MAGNITUDE_RANK.get(current_mag, 0)
                new_rank = MAGNITUDE_RANK.get(magnitude_value, 0)
                if new_rank > current_rank:
                    row["magnitude"] = magnitude_value

            metadata = row["metadata"]
            if isinstance(metadata, dict):
                metadata["rule_ids"] = unique_stable([str(x) for x in metadata.get("rule_ids", []) if isinstance(x, str)] + [rule_id])
                metadata["trigger_event_type_l2s"] = unique_stable(
                    [str(x) for x in metadata.get("trigger_event_type_l2s", []) if isinstance(x, str)] + [event_type_l2]
                )

            row["_sort_event_pos"] = min(int(row["_sort_event_pos"]), event_order_pos.get(event_id, 10**9))
            rule_hits[rule_id] += 1

    state_change_rows = list(aggregated.values())
    state_change_rows.sort(
        key=lambda row: (
            int(row.get("_sort_event_pos", 10**9)),
            scene_order_by_id.get(str(row.get("scene_id")), 10**9),
            str(row.get("subject_id", "")),
            str(row.get("object_id", "")),
            str(row.get("state_dimension", "")),
            str(row.get("direction", "")),
        )
    )

    items: list[dict[str, Any]] = []
    claim_type_counts: Counter[str] = Counter()
    dimension_counts: Counter[str] = Counter()
    direction_counts: Counter[str] = Counter()
    pair_counts: Counter[str] = Counter()
    pair_counts_undirected: Counter[str] = Counter()

    for i, row in enumerate(state_change_rows, start=1):
        row.pop("_sort_event_pos", None)
        confidence = round(float(row.get("confidence", 0.0)), 3)
        row["confidence"] = max(0.05, min(0.999, confidence))
        row["trigger_event_ids"] = unique_stable([str(x) for x in row.get("trigger_event_ids", []) if isinstance(x, str)])
        row["evidence_refs"] = unique_stable([str(x) for x in row.get("evidence_refs", []) if isinstance(x, str)])
        if not row.get("trigger_event_ids"):
            continue

        subject_id = str(row["subject_id"])
        object_id = str(row["object_id"])
        state_dimension = str(row["state_dimension"])
        direction = str(row["direction"])
        claim_type = str(row["claim_type"])

        item = {
            "state_change_id": f"sc_{i:06d}",
            "subject_id": subject_id,
            "object_id": object_id,
            "state_dimension": state_dimension,
            "direction": direction,
            "magnitude": row.get("magnitude"),
            "scene_id": str(row["scene_id"]),
            "trigger_event_ids": row["trigger_event_ids"],
            "evidence_refs": row["evidence_refs"],
            "confidence": row["confidence"],
            "inference_method": str(row.get("inference_method") or "rule+review"),
            "claim_type": claim_type,
            "metadata": row.get("metadata", {}),
        }
        items.append(item)

        claim_type_counts[claim_type] += 1
        dimension_counts[state_dimension] += 1
        direction_counts[direction] += 1
        pair_counts[pair_key(subject_id, object_id)] += 1
        pair_counts_undirected[pair_key_undirected(subject_id, object_id)] += 1

    build_timestamp = utc_now_iso()
    source_hash = str(events_meta.get("source_file_hash") or "")
    if not source_hash:
        source_hash = sha256_hex(events_path.read_bytes() + scene_index_path.read_bytes() + rules_path.read_bytes())

    core_pair_summary: dict[str, dict[str, Any]] = {}
    for pair in core_pairs:
        subject_id = str(pair.get("subject_id", "")).strip()
        object_id = str(pair.get("object_id", "")).strip()
        if not subject_id or not object_id:
            continue
        directed_key = pair_key(subject_id, object_id)
        undirected_key = pair_key_undirected(subject_id, object_id)
        core_pair_summary[str(pair.get("pair_id") or directed_key)] = {
            "label": str(pair.get("label") or directed_key),
            "subject_id": subject_id,
            "object_id": object_id,
            "directed_state_change_count": pair_counts.get(directed_key, 0),
            "undirected_state_change_count": pair_counts_undirected.get(undirected_key, 0),
        }

    envelope = make_envelope(
        artifact_type="state_changes",
        schema_version=SCHEMA_VERSION,
        pipeline_version=SCRIPT_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_hash,
        items=items,
        extra_metadata={
            "claim_type_counts": dict(sorted(claim_type_counts.items())),
            "state_dimension_counts": dict(sorted(dimension_counts.items())),
            "direction_counts": dict(sorted(direction_counts.items())),
            "pair_counts": dict(sorted(pair_counts.items())),
            "pair_counts_undirected": dict(sorted(pair_counts_undirected.items())),
            "core_pair_summary": core_pair_summary,
            "rule_count_active": len(rules),
            "rule_hit_counts": dict(sorted(rule_hits.items())),
            "source_artifacts": [
                str(events_path.relative_to(REPO_ROOT)),
                str(scene_index_path.relative_to(REPO_ROOT)),
                str(entities_path.relative_to(REPO_ROOT)),
            ],
            "config_file": str(rules_path.relative_to(REPO_ROOT)),
            "claim_type_note": "explicit=direct relational/perception wording in evidence; inferred=behavioral/structural cue rule",
        },
    )
    write_json(out_dir / "state_changes.json", envelope, args.indent)

    print(f"Wrote state changes to {out_dir / 'state_changes.json'}")
    print(f"State changes: {len(items)}")
    print("Claim types:")
    for key, count in sorted(claim_type_counts.items()):
        print(f"  - {key}: {count}")
    print("State dimensions:")
    for key, count in sorted(dimension_counts.items()):
        print(f"  - {key}: {count}")

    if core_pair_summary:
        print("Core pair coverage:")
        for pair_id, info in sorted(core_pair_summary.items()):
            label = str(info.get("label", pair_id))
            directed_count = int(info.get("directed_state_change_count", 0))
            undirected_count = int(info.get("undirected_state_change_count", 0))
            print(f"  - {pair_id}: directed={directed_count}, undirected={undirected_count} ({label})")

    # Helpful non-fatal warning if any priority pairs have zero coverage.
    missing_priority = [
        pair_id
        for pair_id, info in core_pair_summary.items()
        if int(info.get("undirected_state_change_count", 0)) == 0
        and pair_id in {"frank_peggy", "frank_hoffa", "hoffa_frank", "frank_russell", "russell_frank"}
    ]
    if missing_priority:
        print(f"warning: zero state changes for core directed pair(s): {', '.join(sorted(missing_priority))}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
