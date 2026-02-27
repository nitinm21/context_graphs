#!/usr/bin/env python3
"""Evaluate parser artifact quality and write Phase 8 parser quality report."""

from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = REPO_ROOT / "the-irishman-ampas-script-cleaned.md"
SCENES_PATH = REPO_ROOT / "data" / "intermediate" / "scenes.json"
UTTERANCES_PATH = REPO_ROOT / "data" / "intermediate" / "utterances.json"
ACTION_BEATS_PATH = REPO_ROOT / "data" / "intermediate" / "action_beats.json"
SCRIPT_BLOCKS_PATH = REPO_ROOT / "data" / "intermediate" / "script_blocks.json"
MANIFEST_PATH = REPO_ROOT / "data" / "intermediate" / "parser_build_manifest.json"
GOLD_SPOT_CHECKS_PATH = REPO_ROOT / "data" / "gold" / "parser_spot_checks.json"
OUTPUT_PATH = REPO_ROOT / "data" / "eval" / "parser_quality_report.json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_envelope(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must be a JSON object")
    metadata = payload.get("metadata")
    items = payload.get("items")
    if not isinstance(metadata, dict):
        raise ValueError(f"{path} missing metadata object")
    if not isinstance(items, list):
        raise ValueError(f"{path} missing items array")
    rows = [row for row in items if isinstance(row, dict)]
    if len(rows) != len(items):
        raise ValueError(f"{path} contains non-object rows")
    return metadata, rows


def get_path(obj: Any, dotted: str) -> Any:
    current = obj
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def add_check(results: list[dict[str, Any]], check_id: str, description: str, passed: bool, **extra: Any) -> None:
    row = {"check_id": check_id, "description": description, "passed": bool(passed)}
    row.update(extra)
    results.append(row)


def summarize_checks(items: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(items)
    passed = sum(1 for item in items if item.get("passed") is True)
    failed = total - passed
    return {
        "total": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": round((passed / total), 4) if total else 0.0,
    }


def count_duplicates(values: list[str]) -> tuple[int, list[str]]:
    counts = Counter(values)
    duplicates = [value for value, count in counts.items() if count > 1]
    return len(duplicates), sorted(duplicates)[:10]


def validate_scene_ranges(scenes: list[dict[str, Any]]) -> dict[str, Any]:
    rows = sorted(scenes, key=lambda row: (int(row.get("line_start", 0)), int(row.get("line_end", 0))))
    gaps: list[dict[str, Any]] = []
    overlaps: list[dict[str, Any]] = []
    prev_end = 0
    for row in rows:
        start = int(row.get("line_start", 0))
        end = int(row.get("line_end", 0))
        if start > prev_end + 1:
            gaps.append({"after_line": prev_end, "next_scene_id": row.get("scene_id"), "gap_start": prev_end + 1, "gap_end": start - 1})
        if start <= prev_end:
            overlaps.append({"scene_id": row.get("scene_id"), "line_start": start, "prev_end": prev_end})
        prev_end = max(prev_end, end)
    return {
        "scene_count": len(rows),
        "first_line": int(rows[0]["line_start"]) if rows else None,
        "last_line": int(rows[-1]["line_end"]) if rows else None,
        "gap_count": len(gaps),
        "overlap_count": len(overlaps),
        "gaps_sample": gaps[:5],
        "overlaps_sample": overlaps[:5],
    }


def validate_block_sequences(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in blocks:
        grouped[str(row.get("scene_id"))].append(row)

    issues: list[dict[str, Any]] = []
    for scene_id, rows in grouped.items():
        header_rows = [row for row in rows if row.get("block_type") == "scene_header"]
        non_header = [row for row in rows if row.get("block_type") != "scene_header"]
        if len(header_rows) > 1:
            issues.append({"scene_id": scene_id, "issue": "multiple_scene_headers", "count": len(header_rows)})
        if header_rows:
            seq = header_rows[0].get("sequence_in_scene")
            if seq != 0:
                issues.append({"scene_id": scene_id, "issue": "scene_header_sequence_not_zero", "actual": seq})
        seqs = sorted(int(row.get("sequence_in_scene", -1)) for row in non_header)
        expected = list(range(1, len(non_header) + 1))
        if seqs != expected:
            issues.append(
                {
                    "scene_id": scene_id,
                    "issue": "non_header_sequence_gap_or_mismatch",
                    "actual_prefix": seqs[:10],
                    "expected_prefix": expected[:10],
                    "count": len(non_header),
                }
            )

    return {
        "scene_count_checked": len(grouped),
        "issue_count": len(issues),
        "issues_sample": issues[:10],
    }


def aggregate_block_markers(blocks: list[dict[str, Any]]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for row in blocks:
        markers = row.get("markers")
        if not isinstance(markers, list):
            continue
        for marker in markers:
            if isinstance(marker, str):
                counter[marker] += 1
    return dict(sorted(counter.items()))


def run_gold_spot_checks(
    gold_payload: dict[str, Any],
    *,
    scenes: list[dict[str, Any]],
    utterances: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    manifest: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    checks = gold_payload.get("checks")
    if not isinstance(checks, list):
        raise ValueError("Gold spot checks file must contain a checks[] array")

    scene_index = {str(row.get("scene_id")): row for row in scenes}
    utterance_index = {str(row.get("utterance_id")): row for row in utterances}
    block_index = {str(row.get("block_id")): row for row in blocks}
    utterance_counts_by_cue = Counter(str(row.get("speaker_cue_raw")) for row in utterances)
    manifest_summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}

    results: list[dict[str, Any]] = []

    for raw in checks:
        if not isinstance(raw, dict):
            continue
        check_id = str(raw.get("check_id") or f"check_{len(results)+1:03d}")
        kind = str(raw.get("kind") or "")
        description = str(raw.get("description") or kind)
        expected = raw.get("expected")
        passed = False
        actual: Any = None
        error: str | None = None

        try:
            if kind == "manifest_summary_equals":
                actual = get_path(manifest_summary, str(raw.get("path", "")))
                passed = actual == expected
            elif kind == "scene_field_equals":
                scene = scene_index.get(str(raw.get("scene_id")))
                actual = scene.get(str(raw.get("field"))) if isinstance(scene, dict) else None
                passed = actual == expected
            elif kind == "scene_field_contains":
                scene = scene_index.get(str(raw.get("scene_id")))
                field_value = scene.get(str(raw.get("field"))) if isinstance(scene, dict) else None
                actual = field_value
                passed = isinstance(field_value, list) and expected in field_value
            elif kind == "utterance_count_by_cue":
                cue = str(raw.get("speaker_cue_raw"))
                actual = int(utterance_counts_by_cue.get(cue, 0))
                passed = actual == expected
            elif kind == "utterance_modifier_contains":
                utterance = utterance_index.get(str(raw.get("utterance_id")))
                modifiers = utterance.get("delivery_modifiers") if isinstance(utterance, dict) else None
                actual = modifiers
                passed = isinstance(modifiers, list) and expected in modifiers
            elif kind == "script_block_field_equals":
                block = block_index.get(str(raw.get("block_id")))
                actual = block.get(str(raw.get("field"))) if isinstance(block, dict) else None
                passed = actual == expected
            elif kind == "script_block_marker_contains":
                block = block_index.get(str(raw.get("block_id")))
                markers = block.get("markers") if isinstance(block, dict) else None
                actual = markers
                passed = isinstance(markers, list) and expected in markers
            else:
                error = f"Unknown check kind: {kind}"
        except Exception as exc:  # noqa: BLE001
            error = str(exc)

        row: dict[str, Any] = {
            "check_id": check_id,
            "kind": kind,
            "description": description,
            "expected": expected,
            "actual": actual,
            "passed": bool(passed),
        }
        if error:
            row["error"] = error
            row["passed"] = False
        results.append(row)

    return summarize_checks(results), results


def build_parser_quality_report() -> dict[str, Any]:
    started = time.time()

    scenes_meta, scenes = read_envelope(SCENES_PATH)
    utter_meta, utterances = read_envelope(UTTERANCES_PATH)
    action_meta, action_beats = read_envelope(ACTION_BEATS_PATH)
    block_meta, blocks = read_envelope(SCRIPT_BLOCKS_PATH)
    manifest = load_json(MANIFEST_PATH)
    gold = load_json(GOLD_SPOT_CHECKS_PATH)

    if not isinstance(manifest, dict):
        raise ValueError(f"{MANIFEST_PATH} must be a JSON object")

    source_lines = SOURCE_PATH.read_text(encoding="utf-8").splitlines()
    source_line_count = len(source_lines)

    manifest_meta = manifest.get("metadata") if isinstance(manifest.get("metadata"), dict) else {}
    manifest_summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}

    scenes_by_id = {str(row.get("scene_id")): row for row in scenes}
    utterances_by_id = {str(row.get("utterance_id")): row for row in utterances}
    actions_by_id = {str(row.get("action_id")): row for row in action_beats}

    scene_ranges = {scene_id: (int(row.get("line_start", 0)), int(row.get("line_end", 0))) for scene_id, row in scenes_by_id.items()}

    actual_prefix_counts = Counter(
        str(row.get("header_prefix"))
        for row in scenes
        if row.get("header_prefix") not in (None, "") and str(row.get("header_prefix")) != "IMPLICIT"
    )
    actual_scene_synthetic = sum(1 for row in scenes if "synthetic_prelude_scene" in (row.get("flags") or []))
    actual_scene_explicit = len(scenes) - actual_scene_synthetic
    actual_empty_utterances = sum(1 for row in utterances if not str(row.get("text", "")).strip())
    actual_block_type_counts = Counter(str(row.get("block_type")) for row in blocks)
    actual_marker_counts = aggregate_block_markers(blocks)

    integrity_checks: list[dict[str, Any]] = []

    source_hash_values = {
        "manifest": manifest_meta.get("source_file_hash"),
        "scenes": scenes_meta.get("source_file_hash"),
        "utterances": utter_meta.get("source_file_hash"),
        "action_beats": action_meta.get("source_file_hash"),
        "script_blocks": block_meta.get("source_file_hash"),
    }
    unique_hashes = {value for value in source_hash_values.values() if isinstance(value, str) and value}
    add_check(
        integrity_checks,
        "source-hash-consistent-across-parser-artifacts",
        "All parser artifacts and manifest reference the same source file hash.",
        len(unique_hashes) == 1,
        actual=source_hash_values,
    )

    add_check(
        integrity_checks,
        "manifest-counts-match-artifact-record-counts",
        "Manifest summary counts match parser artifact record counts.",
        (
            manifest_summary.get("scene_count_total") == len(scenes)
            and manifest_summary.get("utterance_count") == len(utterances)
            and manifest_summary.get("action_beat_count") == len(action_beats)
            and manifest_summary.get("script_block_count") == len(blocks)
        ),
        expected={
            "scene_count_total": len(scenes),
            "utterance_count": len(utterances),
            "action_beat_count": len(action_beats),
            "script_block_count": len(blocks),
        },
        actual={
            "scene_count_total": manifest_summary.get("scene_count_total"),
            "utterance_count": manifest_summary.get("utterance_count"),
            "action_beat_count": manifest_summary.get("action_beat_count"),
            "script_block_count": manifest_summary.get("script_block_count"),
        },
    )

    add_check(
        integrity_checks,
        "scene-explicit-vs-synthetic-counts-consistent",
        "Scene explicit/synthetic counts match scenes metadata and parser manifest.",
        (
            scenes_meta.get("scene_count_explicit_headers") == actual_scene_explicit
            and scenes_meta.get("scene_count_synthetic") == actual_scene_synthetic
            and manifest_summary.get("scene_count_explicit_headers") == actual_scene_explicit
            and manifest_summary.get("scene_count_synthetic") == actual_scene_synthetic
        ),
        actual={
            "scenes_meta_explicit": scenes_meta.get("scene_count_explicit_headers"),
            "scenes_meta_synthetic": scenes_meta.get("scene_count_synthetic"),
            "manifest_explicit": manifest_summary.get("scene_count_explicit_headers"),
            "manifest_synthetic": manifest_summary.get("scene_count_synthetic"),
            "computed_explicit": actual_scene_explicit,
            "computed_synthetic": actual_scene_synthetic,
        },
    )

    add_check(
        integrity_checks,
        "scene-header-prefix-counts-match-manifest",
        "Computed scene header prefix counts match parser manifest summary.",
        dict(sorted(actual_prefix_counts.items())) == dict(sorted((manifest_summary.get("scene_header_prefix_counts") or {}).items())),
        actual=dict(sorted(actual_prefix_counts.items())),
        expected=dict(sorted((manifest_summary.get("scene_header_prefix_counts") or {}).items())),
    )

    add_check(
        integrity_checks,
        "marker-counts-match-manifest",
        "Computed script-block marker counts match parser manifest summary.",
        actual_marker_counts == dict(sorted((manifest_summary.get("marker_counts") or {}).items())),
        actual=actual_marker_counts,
        expected=dict(sorted((manifest_summary.get("marker_counts") or {}).items())),
    )

    add_check(
        integrity_checks,
        "empty-utterance-count-matches-manifest",
        "Computed empty-utterance count matches parser manifest summary.",
        manifest_summary.get("empty_utterance_count") == actual_empty_utterances,
        actual=actual_empty_utterances,
        expected=manifest_summary.get("empty_utterance_count"),
    )

    block_type_counts_meta = block_meta.get("block_type_counts") if isinstance(block_meta.get("block_type_counts"), dict) else {}
    add_check(
        integrity_checks,
        "script-block-type-counts-consistent",
        "Script block type counts match script_blocks metadata and component artifact counts.",
        (
            block_type_counts_meta.get("scene_header") == actual_block_type_counts.get("scene_header", 0)
            and block_type_counts_meta.get("utterance") == actual_block_type_counts.get("utterance", 0)
            and block_type_counts_meta.get("action") == actual_block_type_counts.get("action", 0)
            and actual_block_type_counts.get("scene_header", 0) == actual_scene_explicit
            and actual_block_type_counts.get("utterance", 0) == len(utterances)
            and actual_block_type_counts.get("action", 0) == len(action_beats)
        ),
        actual={
            "metadata_block_type_counts": block_type_counts_meta,
            "computed_block_type_counts": dict(sorted(actual_block_type_counts.items())),
            "artifact_counts": {
                "scene_headers_from_scenes": actual_scene_explicit,
                "utterances": len(utterances),
                "action_beats": len(action_beats),
            },
        },
    )

    scene_range_stats = validate_scene_ranges(scenes)
    add_check(
        integrity_checks,
        "scene-line-ranges-are-contiguous-and-non-overlapping",
        "Scene line spans cover a contiguous parser body region with no overlaps.",
        scene_range_stats["gap_count"] == 0 and scene_range_stats["overlap_count"] == 0 and scene_range_stats["first_line"] == 1,
        actual=scene_range_stats,
    )

    max_scene_line_end = max((int(row.get("line_end", 0)) for row in scenes), default=0)
    add_check(
        integrity_checks,
        "parser-script-body-line-count-matches-last-scene-line",
        "Manifest script_body_line_count matches the last parsed scene line.",
        manifest_summary.get("script_body_line_count") == max_scene_line_end,
        actual=max_scene_line_end,
        expected=manifest_summary.get("script_body_line_count"),
    )

    add_check(
        integrity_checks,
        "cleaned-source-line-count-not-shorter-than-parser-body-line-count",
        "Cleaned source file line count is >= parser script_body_line_count.",
        source_line_count >= int(manifest_summary.get("script_body_line_count", 0) or 0),
        actual={"source_line_count": source_line_count, "script_body_line_count": manifest_summary.get("script_body_line_count")},
    )

    duplicate_scene_ids, scene_dupes = count_duplicates([str(row.get("scene_id")) for row in scenes])
    duplicate_utt_ids, utt_dupes = count_duplicates([str(row.get("utterance_id")) for row in utterances])
    duplicate_action_ids, action_dupes = count_duplicates([str(row.get("action_id")) for row in action_beats])
    duplicate_block_ids, block_dupes = count_duplicates([str(row.get("block_id")) for row in blocks])
    add_check(
        integrity_checks,
        "no-duplicate-parser-ids",
        "Scene, utterance, action, and block IDs are unique.",
        duplicate_scene_ids == 0 and duplicate_utt_ids == 0 and duplicate_action_ids == 0 and duplicate_block_ids == 0,
        actual={
            "duplicate_scene_id_count": duplicate_scene_ids,
            "duplicate_utterance_id_count": duplicate_utt_ids,
            "duplicate_action_id_count": duplicate_action_ids,
            "duplicate_block_id_count": duplicate_block_ids,
            "samples": {
                "scene": scene_dupes,
                "utterance": utt_dupes,
                "action": action_dupes,
                "block": block_dupes,
            },
        },
    )

    block_ref_issues: list[dict[str, Any]] = []
    block_span_issues: list[dict[str, Any]] = []
    for block in blocks:
        block_id = str(block.get("block_id"))
        scene_id = str(block.get("scene_id"))
        block_type = str(block.get("block_type"))
        if scene_id not in scene_ranges:
            block_ref_issues.append({"block_id": block_id, "issue": "unknown_scene_id", "scene_id": scene_id})
            continue
        scene_start, scene_end = scene_ranges[scene_id]
        line_start = int(block.get("line_start", 0))
        line_end = int(block.get("line_end", 0))
        if not (scene_start <= line_start <= line_end <= scene_end):
            block_span_issues.append(
                {
                    "block_id": block_id,
                    "scene_id": scene_id,
                    "block_span": [line_start, line_end],
                    "scene_span": [scene_start, scene_end],
                }
            )
        if block_type == "utterance":
            utterance_id = block.get("utterance_id")
            if not isinstance(utterance_id, str) or utterance_id not in utterances_by_id:
                block_ref_issues.append({"block_id": block_id, "issue": "missing_or_unknown_utterance_id", "utterance_id": utterance_id})
        if block_type == "action":
            action_id = block.get("action_id")
            if not isinstance(action_id, str) or action_id not in actions_by_id:
                block_ref_issues.append({"block_id": block_id, "issue": "missing_or_unknown_action_id", "action_id": action_id})

    add_check(
        integrity_checks,
        "script-block-references-resolve",
        "Script blocks reference existing scenes and component row IDs.",
        len(block_ref_issues) == 0,
        actual={"issue_count": len(block_ref_issues), "issues_sample": block_ref_issues[:10]},
    )
    add_check(
        integrity_checks,
        "script-block-line-spans-stay-within-parent-scene",
        "Each script block line span falls within its parent scene line span.",
        len(block_span_issues) == 0,
        actual={"issue_count": len(block_span_issues), "issues_sample": block_span_issues[:10]},
    )

    seq_stats = validate_block_sequences(blocks)
    add_check(
        integrity_checks,
        "script-block-sequence-conventions-hold",
        "Per-scene sequence conventions hold (scene_header=0; non-header blocks contiguous from 1).",
        seq_stats["issue_count"] == 0,
        actual=seq_stats,
    )

    utter_blocks_by_id = {
        str(row.get("utterance_id")): row for row in blocks if row.get("block_type") == "utterance" and isinstance(row.get("utterance_id"), str)
    }
    action_blocks_by_id = {
        str(row.get("action_id")): row for row in blocks if row.get("block_type") == "action" and isinstance(row.get("action_id"), str)
    }
    utter_seq_issues: list[dict[str, Any]] = []
    action_seq_issues: list[dict[str, Any]] = []
    for row in utterances:
        utt_id = str(row.get("utterance_id"))
        seq = int(row.get("sequence_in_scene", -1))
        block = utter_blocks_by_id.get(utt_id)
        if seq < 1:
            utter_seq_issues.append({"utterance_id": utt_id, "issue": "sequence_not_positive", "actual": seq})
            continue
        if not isinstance(block, dict):
            utter_seq_issues.append({"utterance_id": utt_id, "issue": "missing_linked_block"})
            continue
        if int(block.get("sequence_in_scene", -999)) != seq:
            utter_seq_issues.append(
                {
                    "utterance_id": utt_id,
                    "issue": "sequence_mismatch_with_block",
                    "utterance_sequence": seq,
                    "block_sequence": block.get("sequence_in_scene"),
                    "block_id": block.get("block_id"),
                }
            )
    for row in action_beats:
        act_id = str(row.get("action_id"))
        seq = int(row.get("sequence_in_scene", -1))
        block = action_blocks_by_id.get(act_id)
        if seq < 1:
            action_seq_issues.append({"action_id": act_id, "issue": "sequence_not_positive", "actual": seq})
            continue
        if not isinstance(block, dict):
            action_seq_issues.append({"action_id": act_id, "issue": "missing_linked_block"})
            continue
        if int(block.get("sequence_in_scene", -999)) != seq:
            action_seq_issues.append(
                {
                    "action_id": act_id,
                    "issue": "sequence_mismatch_with_block",
                    "action_sequence": seq,
                    "block_sequence": block.get("sequence_in_scene"),
                    "block_id": block.get("block_id"),
                }
            )
    add_check(
        integrity_checks,
        "utterance-and-action-sequences-match-script-blocks",
        "Utterance/action sequence_in_scene values are positive and match linked script block rows.",
        len(utter_seq_issues) == 0 and len(action_seq_issues) == 0,
        actual={
            "utterance_issue_count": len(utter_seq_issues),
            "action_issue_count": len(action_seq_issues),
            "utterance_issues_sample": utter_seq_issues[:10],
            "action_issues_sample": action_seq_issues[:10],
        },
    )

    gold_summary, gold_items = run_gold_spot_checks(
        gold,
        scenes=scenes,
        utterances=utterances,
        blocks=blocks,
        manifest=manifest,
    )

    integrity_summary = summarize_checks(integrity_checks)
    total_checks = integrity_summary["total"] + gold_summary["total"]
    passed_checks = integrity_summary["passed"] + gold_summary["passed"]
    failed_checks = integrity_summary["failed"] + gold_summary["failed"]

    release_gate_passed = (
        integrity_summary["failed"] == 0
        and gold_summary["failed"] == 0
        and manifest_summary.get("scene_count_explicit_headers") == 297
    )

    report = {
        "metadata": {
            "artifact_type": "parser_quality_report",
            "schema_version": "0.1.0-draft",
            "pipeline_version": "phase8-parser-quality-v0.1.0",
            "build_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source_file": str(manifest_meta.get("source_file") or SOURCE_PATH.name),
            "source_file_hash": manifest_meta.get("source_file_hash"),
            "parser_manifest_file": "data/intermediate/parser_build_manifest.json",
            "gold_spot_checks_file": "data/gold/parser_spot_checks.json",
            "duration_seconds": round(time.time() - started, 3),
        },
        "summary": {
            "release_gate_passed": release_gate_passed,
            "total_checks": total_checks,
            "passed_checks": passed_checks,
            "failed_checks": failed_checks,
            "integrity_check_count": integrity_summary["total"],
            "integrity_failed_count": integrity_summary["failed"],
            "spot_check_count": gold_summary["total"],
            "spot_check_failed_count": gold_summary["failed"],
            "explicit_scene_header_count_target": 297,
            "explicit_scene_header_count_actual": manifest_summary.get("scene_count_explicit_headers"),
            "scene_count_total": len(scenes),
            "scene_count_synthetic": actual_scene_synthetic,
            "utterance_count": len(utterances),
            "action_beat_count": len(action_beats),
            "script_block_count": len(blocks),
            "source_line_count": source_line_count,
            "parser_script_body_line_count": manifest_summary.get("script_body_line_count"),
        },
        "aggregate_metrics": {
            "scene_header_prefix_counts": dict(sorted(actual_prefix_counts.items())),
            "marker_counts": actual_marker_counts,
            "empty_utterance_count": actual_empty_utterances,
            "script_block_type_counts": dict(sorted(actual_block_type_counts.items())),
            "scene_range_stats": scene_range_stats,
            "block_sequence_stats": seq_stats,
        },
        "integrity_checks": {
            "summary": integrity_summary,
            "items": integrity_checks,
        },
        "spot_checks": {
            "summary": gold_summary,
            "items": gold_items,
        },
        "samples": {
            "scenes": [
                {
                    "scene_id": row.get("scene_id"),
                    "header_raw": row.get("header_raw"),
                    "line_start": row.get("line_start"),
                    "line_end": row.get("line_end"),
                    "flags": row.get("flags"),
                }
                for row in (scenes[:2] + scenes[2:4] + scenes[-2:])
            ],
            "utterances": [
                {
                    "utterance_id": row.get("utterance_id"),
                    "scene_id": row.get("scene_id"),
                    "speaker_cue_raw": row.get("speaker_cue_raw"),
                    "delivery_modifiers": row.get("delivery_modifiers"),
                    "line_start": row.get("line_start"),
                    "line_end": row.get("line_end"),
                }
                for row in utterances[:3]
            ],
        },
    }
    return report


def main() -> int:
    report = build_parser_quality_report()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    summary = report["summary"]
    print(
        "Wrote"
        f" {OUTPUT_PATH}"
        f" | release_gate_passed={summary.get('release_gate_passed')}"
        f" | checks={summary.get('passed_checks')}/{summary.get('total_checks')}"
    )
    return 0 if summary.get("release_gate_passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
