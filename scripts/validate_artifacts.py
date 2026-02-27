#!/usr/bin/env python3
"""Phase-aware artifact validation for the Irishman Narrative Trace Explorer."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Requirement:
    path: str
    kind: str = "file"  # "file" or "dir"
    phase: int = 0
    required: bool = True
    note: str | None = None


SCAFFOLD_REQUIREMENTS: list[Requirement] = [
    Requirement("app", kind="dir"),
    Requirement("app/api", kind="dir"),
    Requirement("app/layout.tsx"),
    Requirement("app/page.tsx"),
    Requirement("package.json"),
    Requirement("tsconfig.json"),
    Requirement("next.config.mjs"),
    Requirement("next-env.d.ts"),
    Requirement("data/raw", kind="dir"),
    Requirement("data/intermediate", kind="dir"),
    Requirement("data/derived", kind="dir"),
    Requirement("data/gold", kind="dir"),
    Requirement("data/eval", kind="dir"),
    Requirement("scripts/parse_screenplay.py"),
    Requirement("scripts/build_entities.py"),
    Requirement("scripts/extract_events.py"),
    Requirement("scripts/infer_state_changes.py"),
    Requirement("scripts/build_graphs.py"),
    Requirement("scripts/validate_artifacts.py"),
    Requirement("docs/data-contracts.md"),
    Requirement("data/derived/schema_versions.json"),
    Requirement("src/types/graph.ts"),
]

GENERATED_PHASE_OUTPUTS: list[Requirement] = [
    Requirement("data/intermediate/script_blocks.json", phase=1),
    Requirement("data/intermediate/scenes.json", phase=1),
    Requirement("data/intermediate/utterances.json", phase=1),
    Requirement("data/intermediate/action_beats.json", phase=1),
    Requirement("data/intermediate/parser_build_manifest.json", phase=1),
    Requirement("config/entity_aliases.manual.json", phase=2),
    Requirement("data/derived/entities.json", phase=2),
    Requirement("data/derived/entity_aliases.json", phase=2),
    Requirement("data/derived/kg_edges.json", phase=2),
    Requirement("config/event_taxonomy.json", phase=3),
    Requirement("scripts/eval_taxonomy_coverage.py", phase=3),
    Requirement("app/trace/events-debug/page.tsx", phase=3),
    Requirement("data/derived/events.json", phase=3),
    Requirement("data/derived/event_participants.json", phase=3),
    Requirement("data/derived/scene_index.json", phase=3),
    Requirement("data/eval/taxonomy_coverage_report.json", phase=3),
    Requirement("data/eval/unmapped_events_review.json", phase=3),
    Requirement("config/state_change_rules.json", phase=4),
    Requirement("src/lib/ntgData.ts", phase=4),
    Requirement("app/api/trace/timeline/route.ts", phase=4),
    Requirement("app/api/trace/state-changes/route.ts", phase=4),
    Requirement("app/trace/page.tsx", phase=4),
    Requirement("app/timeline/page.tsx", phase=4),
    Requirement("data/derived/temporal_edges.json", phase=4),
    Requirement("data/derived/state_changes.json", phase=4),
    Requirement("src/lib/queryContract.ts", phase=5),
    Requirement("src/lib/queryRouter.ts", phase=5),
    Requirement("src/lib/queryPatterns.ts", phase=5),
    Requirement("src/lib/queryService.ts", phase=5),
    Requirement("src/lib/answers/kgAnswer.ts", phase=5),
    Requirement("src/lib/answers/traceAnswer.ts", phase=5),
    Requirement("src/lib/answers/hybridAnswer.ts", phase=5),
    Requirement("src/lib/answers/baselineRagLike.ts", phase=5),
    Requirement("app/api/query/route.ts", phase=5),
    Requirement("app/api/query/baseline-rag/route.ts", phase=5),
    Requirement("src/lib/queryRouter.test.ts", phase=5),
    Requirement("src/lib/queryContract.test.ts", phase=5),
    Requirement("data/derived/query_examples.json", phase=5),
    Requirement("src/components/QuestionInput.tsx", phase=6),
    Requirement("src/components/AnswerPanel.tsx", phase=6),
    Requirement("src/components/EvidencePanel.tsx", phase=6),
    Requirement("src/components/ModeBadge.tsx", phase=6),
    Requirement("src/components/BaselineComparisonPanel.tsx", phase=6),
    Requirement("src/components/QueryWorkbench.tsx", phase=6),
    Requirement("app/api/query/evidence/route.ts", phase=6),
    Requirement("app/benchmarks/page.tsx", phase=6),
    Requirement("app/about/page.tsx", phase=6),
    Requirement(".env.example", phase=7),
    Requirement("src/lib/llm/config.ts", phase=7),
    Requirement("src/lib/llm/openaiClient.ts", phase=7),
    Requirement("src/lib/answers/synthesizeWithLLM.ts", phase=7),
    Requirement("scripts/refine_events_with_llm.py", phase=7),
    Requirement("scripts/eval_parser_quality.py", phase=8),
    Requirement("data/gold/parser_spot_checks.json", phase=8),
    Requirement("data/eval/parser_quality_report.json", phase=8),
    Requirement("docs/evaluation.md", phase=8),
    Requirement("docs/demo-script.md", phase=8),
    Requirement("docs/recruiter-summary.md", phase=8),
    Requirement("README.md", phase=8),
]

PHASE1_ENVELOPE_PATHS = {
    "data/intermediate/script_blocks.json",
    "data/intermediate/scenes.json",
    "data/intermediate/utterances.json",
    "data/intermediate/action_beats.json",
}

PHASE2_ENVELOPE_PATHS = {
    "data/derived/entities.json",
    "data/derived/entity_aliases.json",
    "data/derived/kg_edges.json",
}

PHASE3_ENVELOPE_PATHS = {
    "data/derived/events.json",
    "data/derived/event_participants.json",
    "data/derived/scene_index.json",
}

PHASE4_ENVELOPE_PATHS = {
    "data/derived/temporal_edges.json",
    "data/derived/state_changes.json",
}

PHASE5_ENVELOPE_PATHS = {
    "data/derived/query_examples.json",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--phase",
        type=int,
        default=0,
        help="Validate required artifacts up to this phase (default: 0).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON summary.",
    )
    return parser.parse_args()


def exists(req: Requirement) -> bool:
    candidate = REPO_ROOT / req.path
    if req.kind == "dir":
        return candidate.is_dir()
    return candidate.is_file()


def partition(requirements: Iterable[Requirement], phase: int) -> tuple[list[Requirement], list[Requirement]]:
    required_now: list[Requirement] = []
    later: list[Requirement] = []
    for req in requirements:
        if req.phase <= phase:
            required_now.append(req)
        else:
            later.append(req)
    return required_now, later


def validate_schema_versions() -> tuple[bool, str]:
    path = REPO_ROOT / "data/derived/schema_versions.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return False, "Missing file"
    except json.JSONDecodeError as exc:
        return False, f"Invalid JSON: {exc}"

    if not isinstance(data, dict) or "artifact_schemas" not in data:
        return False, "Expected object with 'artifact_schemas'"
    if not isinstance(data.get("artifact_schemas"), dict):
        return False, "'artifact_schemas' must be an object"
    return True, "OK"


def _load_json(path: Path) -> tuple[dict | list | None, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, "Missing file"
    except json.JSONDecodeError as exc:
        return None, f"Invalid JSON: {exc}"

    if not isinstance(payload, (dict, list)):
        return None, "Expected JSON object or array"
    return payload, "OK"


def validate_envelope_json(rel_path: str) -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / rel_path)
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    metadata = payload.get("metadata")
    if not isinstance(items, list):
        return False, "Missing/invalid 'items' array"
    if not isinstance(metadata, dict):
        return False, "Missing/invalid 'metadata' object"
    record_count = metadata.get("record_count")
    if isinstance(record_count, int) and record_count != len(items):
        return False, f"metadata.record_count ({record_count}) != len(items) ({len(items)})"
    return True, "OK"


def validate_parser_manifest() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/intermediate/parser_build_manifest.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object"
    metadata = payload.get("metadata")
    summary = payload.get("summary")
    if not isinstance(metadata, dict):
        return False, "Missing/invalid metadata"
    if not isinstance(summary, dict):
        return False, "Missing/invalid summary"
    required_summary_keys = [
        "scene_count_total",
        "scene_count_explicit_headers",
        "scene_count_synthetic",
        "utterance_count",
        "action_beat_count",
        "script_block_count",
    ]
    missing = [key for key in required_summary_keys if key not in summary]
    if missing:
        return False, f"Missing summary keys: {', '.join(missing)}"
    return True, "OK"


def validate_entities_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/entities.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {"entity_id", "entity_type", "canonical_name", "aliases", "first_scene_id", "metadata"}
    for idx, item in enumerate(items[:50]):  # sample enough for shape validation without huge cost
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
        if not isinstance(item.get("aliases"), list):
            return False, f"Item {idx} aliases must be a list"
    return True, "OK"


def validate_entity_aliases_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/entity_aliases.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {"alias_raw", "alias_normalized", "entity_id", "entity_type", "alias_kind", "source"}
    for idx, item in enumerate(items[:100]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
    return True, "OK"


def validate_kg_edges_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/kg_edges.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {"edge_id", "subject_id", "predicate", "object_id", "stability", "evidence_refs"}
    for idx, item in enumerate(items[:100]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
        if not isinstance(item.get("evidence_refs"), list):
            return False, f"Item {idx} evidence_refs must be a list"
    return True, "OK"


def validate_events_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/events.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {
        "event_id",
        "scene_id",
        "event_type_l1",
        "event_type_l2",
        "summary",
        "participants",
        "evidence_refs",
        "sequence_in_scene",
        "confidence",
        "extraction_method",
    }
    for idx, item in enumerate(items[:120]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
        if not isinstance(item.get("participants"), list):
            return False, f"Item {idx} participants must be a list"
        if not isinstance(item.get("evidence_refs"), list):
            return False, f"Item {idx} evidence_refs must be a list"
    return True, "OK"


def validate_event_participants_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/event_participants.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {
        "event_participant_id",
        "event_id",
        "scene_id",
        "entity_id",
        "role",
        "participant_index",
        "evidence_refs",
    }
    for idx, item in enumerate(items[:120]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
        if not isinstance(item.get("evidence_refs"), list):
            return False, f"Item {idx} evidence_refs must be a list"
    return True, "OK"


def validate_scene_index_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/scene_index.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {"scene_id", "scene_index", "event_ids", "event_count", "event_refs"}
    for idx, item in enumerate(items[:80]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
        if not isinstance(item.get("event_ids"), list):
            return False, f"Item {idx} event_ids must be a list"
        if not isinstance(item.get("event_refs"), list):
            return False, f"Item {idx} event_refs must be a list"
    return True, "OK"


def validate_taxonomy_coverage_report() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/eval/taxonomy_coverage_report.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object"
    metadata = payload.get("metadata")
    summary = payload.get("summary")
    if not isinstance(metadata, dict):
        return False, "Missing/invalid metadata"
    if not isinstance(summary, dict):
        return False, "Missing/invalid summary"
    for key in ["total_events", "unknown_event_type_count", "unmapped_review_required_count"]:
        if key not in summary:
            return False, f"Missing summary key: {key}"
    return True, "OK"


def validate_unmapped_review_report() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/eval/unmapped_events_review.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object"
    summary = payload.get("summary")
    items = payload.get("items")
    if not isinstance(summary, dict):
        return False, "Missing/invalid summary"
    if not isinstance(items, list):
        return False, "Missing/invalid items list"
    return True, "OK"


def validate_temporal_edges_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/temporal_edges.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {"temporal_edge_id", "from_event_id", "to_event_id", "relation", "basis"}
    for idx, item in enumerate(items[:200]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
    return True, "OK"


def validate_state_changes_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/state_changes.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    items = payload.get("items")
    if not isinstance(items, list):
        return False, "Missing items array"
    required_keys = {
        "state_change_id",
        "subject_id",
        "object_id",
        "state_dimension",
        "direction",
        "scene_id",
        "trigger_event_ids",
        "evidence_refs",
        "confidence",
        "inference_method",
        "claim_type",
    }
    for idx, item in enumerate(items[:200]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
        if not isinstance(item.get("trigger_event_ids"), list):
            return False, f"Item {idx} trigger_event_ids must be a list"
        if not isinstance(item.get("evidence_refs"), list):
            return False, f"Item {idx} evidence_refs must be a list"
        claim_type = item.get("claim_type")
        if claim_type not in {"explicit", "inferred"}:
            return False, f"Item {idx} invalid claim_type: {claim_type}"
    return True, "OK"


def validate_state_change_rules_config() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "config/state_change_rules.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object"
    rules = payload.get("rules")
    core_pairs = payload.get("core_pairs")
    if not isinstance(rules, list):
        return False, "Missing/invalid rules list"
    if not isinstance(core_pairs, list):
        return False, "Missing/invalid core_pairs list"
    if not rules:
        return False, "rules list must not be empty"
    sample_rule = rules[0] if rules else None
    if not isinstance(sample_rule, dict):
        return False, "rules[0] must be an object"
    for key in ["rule_id", "subject_id", "object_id", "state_dimension", "direction", "claim_type"]:
        if key not in sample_rule:
            return False, f"rules[0] missing key: {key}"
    return True, "OK"


def validate_query_examples_artifact() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/derived/query_examples.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object envelope"
    metadata = payload.get("metadata")
    items = payload.get("items")
    if not isinstance(metadata, dict):
        return False, "Missing/invalid metadata"
    if not isinstance(items, list):
        return False, "Missing/invalid items list"
    if len(items) < 10:
        return False, "Must include at least 10 benchmark query fixtures"
    required_keys = {"query_id", "question", "query_type_expected", "mode_expected"}
    query_types: set[str] = set()
    for idx, item in enumerate(items[:200]):
        if not isinstance(item, dict):
            return False, f"Item {idx} is not an object"
        missing = sorted(required_keys - set(item.keys()))
        if missing:
            return False, f"Item {idx} missing keys: {', '.join(missing)}"
        q = item.get("question")
        if not isinstance(q, str) or not q.strip():
            return False, f"Item {idx} has invalid question"
        query_type = item.get("query_type_expected")
        mode = item.get("mode_expected")
        if not isinstance(query_type, str):
            return False, f"Item {idx} has invalid query_type_expected"
        if query_type not in {"fact", "timeline", "state_change", "causal_chain", "evidence", "comparison"}:
            return False, f"Item {idx} unknown query_type_expected: {query_type}"
        if not isinstance(mode, str) or mode not in {"kg", "ntg", "hybrid", "baseline_rag"}:
            return False, f"Item {idx} invalid mode_expected: {mode}"
        query_types.add(query_type)
    missing_query_types = sorted({"fact", "timeline", "state_change", "causal_chain", "evidence", "comparison"} - query_types)
    if missing_query_types:
        return False, f"Missing query fixture coverage for: {', '.join(missing_query_types)}"
    record_count = metadata.get("record_count")
    if isinstance(record_count, int) and record_count != len(items):
        return False, f"metadata.record_count ({record_count}) != len(items) ({len(items)})"
    return True, "OK"


def validate_parser_quality_report() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/eval/parser_quality_report.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object"
    metadata = payload.get("metadata")
    summary = payload.get("summary")
    integrity_checks = payload.get("integrity_checks")
    spot_checks = payload.get("spot_checks")
    if not isinstance(metadata, dict):
        return False, "Missing/invalid metadata"
    if metadata.get("artifact_type") != "parser_quality_report":
        return False, "metadata.artifact_type must be parser_quality_report"
    if not isinstance(summary, dict):
        return False, "Missing/invalid summary"
    required_summary_keys = [
        "release_gate_passed",
        "total_checks",
        "passed_checks",
        "failed_checks",
        "explicit_scene_header_count_target",
        "explicit_scene_header_count_actual",
    ]
    for key in required_summary_keys:
        if key not in summary:
            return False, f"Missing summary key: {key}"
    if summary.get("failed_checks") != 0:
        return False, "summary.failed_checks must be 0 for Phase 8"
    if summary.get("release_gate_passed") is not True:
        return False, "summary.release_gate_passed must be true for Phase 8"
    if summary.get("explicit_scene_header_count_actual") != 297:
        return False, "summary.explicit_scene_header_count_actual must equal 297"
    for label, section in [("integrity_checks", integrity_checks), ("spot_checks", spot_checks)]:
        if not isinstance(section, dict):
            return False, f"Missing/invalid {label} object"
        if not isinstance(section.get("summary"), dict):
            return False, f"{label}.summary must be an object"
        if not isinstance(section.get("items"), list):
            return False, f"{label}.items must be a list"
    return True, "OK"


def validate_taxonomy_coverage_release_gate_phase8() -> tuple[bool, str]:
    payload, message = _load_json(REPO_ROOT / "data/eval/taxonomy_coverage_report.json")
    if payload is None:
        return False, message
    if not isinstance(payload, dict):
        return False, "Expected JSON object"
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        return False, "Missing/invalid summary"
    unmapped = summary.get("unmapped_review_required_count")
    unknown = summary.get("unknown_event_type_count")
    if unmapped != 0:
        return False, f"unmapped_review_required_count must be 0 (got {unmapped})"
    if unknown != 0:
        return False, f"unknown_event_type_count must be 0 (got {unknown})"
    return True, "OK"


def validate_phase8_docs_readme() -> tuple[bool, str]:
    readme_path = REPO_ROOT / "README.md"
    try:
        text = readme_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return False, "Missing file"
    except OSError as exc:
        return False, str(exc)
    required_snippets = [
        "## What It Demonstrates",
        "## Setup",
        "## Local-Only Disclaimer",
    ]
    missing = [snippet for snippet in required_snippets if snippet not in text]
    if missing:
        return False, f"README.md missing required sections: {', '.join(missing)}"
    return True, "OK"


def main() -> int:
    args = parse_args()
    if args.phase < 0 or args.phase > 8:
        print("error: --phase must be between 0 and 8")
        return 2

    scaffold_required, _ = partition(SCAFFOLD_REQUIREMENTS, args.phase)
    generated_required, generated_later = partition(GENERATED_PHASE_OUTPUTS, args.phase)

    missing_required: list[str] = []
    present_required = 0
    validation_errors: list[str] = []

    for req in scaffold_required + generated_required:
        if exists(req):
            present_required += 1
        else:
            missing_required.append(req.path)

    schema_ok, schema_message = validate_schema_versions()
    if args.phase >= 0 and not schema_ok and "data/derived/schema_versions.json" not in missing_required:
        missing_required.append(f"data/derived/schema_versions.json ({schema_message})")

    if args.phase >= 1:
        for rel_path in PHASE1_ENVELOPE_PATHS:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = validate_envelope_json(rel_path)
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")
        manifest_path = "data/intermediate/parser_build_manifest.json"
        if manifest_path not in missing_required and exists(Requirement(manifest_path)):
            ok, msg = validate_parser_manifest()
            if not ok:
                validation_errors.append(f"{manifest_path}: {msg}")

    if args.phase >= 2:
        for rel_path in PHASE2_ENVELOPE_PATHS:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = validate_envelope_json(rel_path)
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

    if args.phase >= 3:
        for rel_path in PHASE3_ENVELOPE_PATHS:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = validate_envelope_json(rel_path)
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

        specialized_phase3 = [
            ("data/derived/events.json", validate_events_artifact),
            ("data/derived/event_participants.json", validate_event_participants_artifact),
            ("data/derived/scene_index.json", validate_scene_index_artifact),
            ("data/eval/taxonomy_coverage_report.json", validate_taxonomy_coverage_report),
            ("data/eval/unmapped_events_review.json", validate_unmapped_review_report),
        ]
        for rel_path, fn in specialized_phase3:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = fn()
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

        specialized_checks = [
            ("data/derived/entities.json", validate_entities_artifact),
            ("data/derived/entity_aliases.json", validate_entity_aliases_artifact),
            ("data/derived/kg_edges.json", validate_kg_edges_artifact),
        ]
        for rel_path, fn in specialized_checks:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = fn()
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

    if args.phase >= 4:
        for rel_path in PHASE4_ENVELOPE_PATHS:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = validate_envelope_json(rel_path)
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

        specialized_phase4 = [
            ("config/state_change_rules.json", validate_state_change_rules_config),
            ("data/derived/temporal_edges.json", validate_temporal_edges_artifact),
            ("data/derived/state_changes.json", validate_state_changes_artifact),
        ]
        for rel_path, fn in specialized_phase4:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = fn()
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

    if args.phase >= 5:
        for rel_path in PHASE5_ENVELOPE_PATHS:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = validate_envelope_json(rel_path)
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

        specialized_phase5 = [
            ("data/derived/query_examples.json", validate_query_examples_artifact),
        ]
        for rel_path, fn in specialized_phase5:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = fn()
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

    if args.phase >= 8:
        specialized_phase8 = [
            ("data/eval/parser_quality_report.json", validate_parser_quality_report),
            ("data/eval/taxonomy_coverage_report.json", validate_taxonomy_coverage_release_gate_phase8),
            ("README.md", validate_phase8_docs_readme),
        ]
        for rel_path, fn in specialized_phase8:
            if rel_path in missing_required:
                continue
            if exists(Requirement(rel_path)):
                ok, msg = fn()
                if not ok:
                    validation_errors.append(f"{rel_path}: {msg}")

    pending_later = [req.path for req in generated_later if not exists(req)]
    available_early = [req.path for req in generated_later if exists(req)]

    result = {
        "phase": args.phase,
        "required_checked": len(scaffold_required) + len(generated_required),
        "required_present": present_required,
        "required_missing": missing_required,
        "schema_versions_check": schema_message,
        "validation_errors": validation_errors,
        "pending_later_phase_artifacts": pending_later,
        "available_early_outputs": available_early,
        "repo_root": str(REPO_ROOT),
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Artifact validation report (phase {args.phase})")
        print(f"Repo root: {REPO_ROOT}")
        print(f"Required present: {present_required}/{result['required_checked']}")
        print(f"schema_versions.json: {schema_message}")
        if validation_errors:
            print("Validation errors:")
            for err in validation_errors:
                print(f"  - {err}")
        else:
            print("Validation errors: none")
        if missing_required:
            print("Missing required artifacts:")
            for path in missing_required:
                print(f"  - {path}")
        else:
            print("Missing required artifacts: none")
        if pending_later:
            print("Pending later-phase artifacts (informational):")
            for path in pending_later:
                print(f"  - {path}")
        if available_early:
            print("Later-phase artifacts already present (informational):")
            for path in available_early:
                print(f"  - {path}")

    return 0 if not missing_required and not validation_errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
