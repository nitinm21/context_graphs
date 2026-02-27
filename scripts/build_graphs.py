#!/usr/bin/env python3
"""Build graph artifacts (Phase 2 KG edges, Phase 4 temporal edges)."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENTITIES = REPO_ROOT / "data" / "derived" / "entities.json"
DEFAULT_ALIASES = REPO_ROOT / "data" / "derived" / "entity_aliases.json"
DEFAULT_UTTERANCES = REPO_ROOT / "data" / "intermediate" / "utterances.json"
DEFAULT_EVENTS = REPO_ROOT / "data" / "derived" / "events.json"
DEFAULT_SCENE_INDEX = REPO_ROOT / "data" / "derived" / "scene_index.json"
DEFAULT_CONFIG = REPO_ROOT / "config" / "entity_aliases.manual.json"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "derived"
KG_BUILDER_VERSION = "phase2-kg-v0.1.0"
KG_SCHEMA_VERSION = "0.1.0-draft"
TEMPORAL_BUILDER_VERSION = "phase4-temporal-v0.1.0"
TEMPORAL_SCHEMA_VERSION = "0.1.0-draft"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entities", type=Path, default=DEFAULT_ENTITIES)
    parser.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES)
    parser.add_argument("--utterances", type=Path, default=DEFAULT_UTTERANCES)
    parser.add_argument("--events", type=Path, default=DEFAULT_EVENTS)
    parser.add_argument("--scene-index", type=Path, default=DEFAULT_SCENE_INDEX)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--kg-only", action="store_true", help="Generate KG edges only")
    parser.add_argument("--temporal-only", action="store_true", help="Generate temporal edges only")
    parser.add_argument("--cooccurrence-min-scenes", type=int, default=3)
    parser.add_argument("--cooccurrence-max-edges", type=int, default=120)
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


def make_placeholder_evidence_refs(scene_ids: list[str]) -> list[str]:
    return [f"scene:{scene_id}" for scene_id in scene_ids]


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


def build_kg_edges(args: argparse.Namespace) -> int:
    entities_path = args.entities.resolve()
    aliases_path = args.aliases.resolve()
    utterances_path = args.utterances.resolve()
    config_path = args.config.resolve()
    out_dir = args.out_dir.resolve()

    for required in [entities_path, aliases_path, utterances_path, config_path]:
        if not required.is_file():
            print(f"error: missing required file: {required}")
            return 2

    entities_meta, entities = load_envelope(entities_path)
    aliases_meta, alias_rows = load_envelope(aliases_path)
    utterances_meta, utterances = load_envelope(utterances_path)
    cfg = load_json(config_path)
    if not isinstance(cfg, dict):
        print("error: config must be a JSON object")
        return 2

    build_timestamp = utc_now_iso()
    source_hash = str(
        entities_meta.get("source_file_hash")
        or aliases_meta.get("source_file_hash")
        or utterances_meta.get("source_file_hash")
        or ""
    )
    if not source_hash:
        source_hash = sha256_hex(entities_path.read_bytes() + aliases_path.read_bytes() + utterances_path.read_bytes())

    entity_by_id: dict[str, dict[str, Any]] = {}
    for row in entities:
        if isinstance(row, dict) and isinstance(row.get("entity_id"), str):
            entity_by_id[row["entity_id"]] = row

    edge_rows: list[dict[str, Any]] = []
    manual_edge_count = 0
    derived_edge_count = 0
    skipped_manual_edges: list[str] = []
    existing_manual_signatures: set[tuple[str, str, str]] = set()

    # Manual edges from config provide the required phase-2 demo relationships.
    for spec in cfg.get("manual_kg_edges", []):
        if not isinstance(spec, dict):
            continue
        subject_id = str(spec.get("subject_id", "")).strip()
        object_id = str(spec.get("object_id", "")).strip()
        predicate = str(spec.get("predicate", "")).strip()
        stability = str(spec.get("stability", "semi_stable")).strip() or "semi_stable"
        scene_ids = [str(x) for x in spec.get("evidence_scene_ids", []) if str(x)]
        if not subject_id or not object_id or not predicate:
            skipped_manual_edges.append("missing_fields")
            continue
        if subject_id not in entity_by_id or object_id not in entity_by_id:
            skipped_manual_edges.append(f"unknown_entity:{subject_id}->{object_id}")
            continue
        existing_manual_signatures.add((subject_id, predicate, object_id))
        edge_rows.append(
            {
                "subject_id": subject_id,
                "predicate": predicate,
                "object_id": object_id,
                "stability": stability,
                "evidence_refs": make_placeholder_evidence_refs(scene_ids),
                "metadata": {
                    "generation_method": "manual_config",
                    "evidence_scene_ids": scene_ids,
                },
            }
        )
        manual_edge_count += 1

    # Build raw cue -> entity mapping from alias artifact (utterance aliases only).
    raw_cue_to_entity: dict[str, str] = {}
    for alias in alias_rows:
        if not isinstance(alias, dict):
            continue
        alias_raw = alias.get("alias_raw")
        entity_id = alias.get("entity_id")
        alias_kind = alias.get("alias_kind")
        source = str(alias.get("source", ""))
        if not isinstance(alias_raw, str) or not isinstance(entity_id, str):
            continue
        if "utterance_cue" not in source:
            continue
        if alias_kind == "normalized_cue":
            continue
        raw_cue_to_entity.setdefault(alias_raw, entity_id)

    # Scene-level co-speaker co-occurrence edges (deterministic heuristic enrichment).
    scene_speakers: dict[str, set[str]] = defaultdict(set)
    for utt in utterances:
        if not isinstance(utt, dict):
            continue
        scene_id = utt.get("scene_id")
        cue_raw = utt.get("speaker_cue_raw")
        if not isinstance(scene_id, str) or not isinstance(cue_raw, str):
            continue
        entity_id = raw_cue_to_entity.get(cue_raw)
        if not entity_id:
            continue
        entity = entity_by_id.get(entity_id)
        if not entity:
            continue
        if entity.get("entity_type") != "character":
            continue
        scene_speakers[scene_id].add(entity_id)

    pair_scene_counts: Counter[tuple[str, str]] = Counter()
    pair_scenes: dict[tuple[str, str], list[str]] = defaultdict(list)
    for scene_id in sorted(scene_speakers.keys()):
        participants = sorted(scene_speakers[scene_id])
        if len(participants) < 2:
            continue
        for a, b in itertools.combinations(participants, 2):
            pair = (a, b)
            pair_scene_counts[pair] += 1
            if len(pair_scenes[pair]) < 8:
                pair_scenes[pair].append(scene_id)

    cooccurrence_candidates: list[dict[str, Any]] = []
    for (a, b), count in pair_scene_counts.items():
        if count < args.cooccurrence_min_scenes:
            continue
        # Avoid duplicating manual pair relationships under the same coarse semantics.
        if (a, "associated_with", b) in existing_manual_signatures or (b, "associated_with", a) in existing_manual_signatures:
            continue
        cooccurrence_candidates.append(
            {
                "subject_id": a,
                "predicate": "co_present_dialogue",
                "object_id": b,
                "stability": "volatile",
                "evidence_refs": make_placeholder_evidence_refs(pair_scenes[(a, b)]),
                "metadata": {
                    "generation_method": "scene_co_speaker",
                    "cooccurrence_scene_count": count,
                    "evidence_scene_ids": pair_scenes[(a, b)],
                },
            }
        )

    cooccurrence_candidates.sort(
        key=lambda e: (
            -int(e["metadata"]["cooccurrence_scene_count"]),
            e["subject_id"],
            e["object_id"],
        )
    )
    for edge in cooccurrence_candidates[: args.cooccurrence_max_edges]:
        edge_rows.append(edge)
        derived_edge_count += 1

    # Deterministic edge IDs after final sort.
    edge_rows.sort(
        key=lambda e: (
            str(e["subject_id"]),
            str(e["predicate"]),
            str(e["object_id"]),
            str(e.get("metadata", {}).get("generation_method", "")),
        )
    )
    edge_items: list[dict[str, Any]] = []
    predicate_counts: Counter[str] = Counter()
    for i, edge in enumerate(edge_rows, start=1):
        predicate_counts[str(edge["predicate"])] += 1
        edge_items.append(
            {
                "edge_id": f"kg_{i:05d}",
                "subject_id": edge["subject_id"],
                "predicate": edge["predicate"],
                "object_id": edge["object_id"],
                "stability": edge["stability"],
                "evidence_refs": edge.get("evidence_refs", []),
                "metadata": edge.get("metadata", {}),
            }
        )

    envelope = make_envelope(
        artifact_type="kg_edges",
        schema_version=KG_SCHEMA_VERSION,
        pipeline_version=KG_BUILDER_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_hash,
        items=edge_items,
        extra_metadata={
            "manual_edge_count": manual_edge_count,
            "derived_edge_count": derived_edge_count,
            "predicate_counts": dict(predicate_counts),
            "cooccurrence_min_scenes": args.cooccurrence_min_scenes,
            "cooccurrence_max_edges": args.cooccurrence_max_edges,
            "source_artifacts": [
                str(entities_path.relative_to(REPO_ROOT)),
                str(aliases_path.relative_to(REPO_ROOT)),
                str(utterances_path.relative_to(REPO_ROOT)),
            ],
            "config_file": str(config_path.relative_to(REPO_ROOT)),
            "skipped_manual_edge_count": len(skipped_manual_edges),
        },
    )
    write_json(out_dir / "kg_edges.json", envelope, args.indent)

    print(f"Wrote KG edges to {out_dir / 'kg_edges.json'}")
    print(f"KG edges: {len(edge_items)} (manual={manual_edge_count}, derived={derived_edge_count})")
    print("Predicates:")
    for predicate, count in sorted(predicate_counts.items()):
        print(f"  - {predicate}: {count}")
    if skipped_manual_edges:
        print(f"Skipped manual edges: {len(skipped_manual_edges)}")

    return 0


def build_temporal_edges(args: argparse.Namespace) -> int:
    events_path = args.events.resolve()
    scene_index_path = args.scene_index.resolve()
    out_dir = args.out_dir.resolve()

    for required in [events_path, scene_index_path]:
        if not required.is_file():
            print(f"error: missing required file: {required}")
            return 2

    events_meta, events = load_envelope(events_path)
    scene_index_meta, scene_index_items = load_envelope(scene_index_path)

    build_timestamp = utc_now_iso()
    source_hash = str(events_meta.get("source_file_hash") or scene_index_meta.get("source_file_hash") or "")
    if not source_hash:
        source_hash = sha256_hex(events_path.read_bytes() + scene_index_path.read_bytes())

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

    scene_order_by_id: dict[str, int] = {}
    scene_ids_in_order: list[str] = []
    for row in scene_index_items:
        if not isinstance(row, dict):
            continue
        scene_id = row.get("scene_id")
        if not isinstance(scene_id, str):
            continue
        order = safe_int(row.get("scene_index"), default=10**9)
        scene_order_by_id[scene_id] = order
        scene_ids_in_order.append(scene_id)

    event_rows: list[dict[str, Any]] = []
    for row in events:
        if not isinstance(row, dict):
            continue
        event_id = row.get("event_id")
        scene_id = row.get("scene_id")
        if not isinstance(event_id, str) or not isinstance(scene_id, str):
            continue
        event_rows.append(
            {
                "event_id": event_id,
                "scene_id": scene_id,
                "sequence_in_scene": safe_int(row.get("sequence_in_scene"), default=0),
                "event_type_l2": str(row.get("event_type_l2", "")),
            }
        )

    if not event_rows:
        print("error: events artifact contains no usable events")
        return 2

    event_rows.sort(
        key=lambda e: (
            scene_order_by_id.get(str(e["scene_id"]), 10**9),
            safe_int(e.get("sequence_in_scene"), 0),
            str(e["event_id"]),
        )
    )

    event_index_by_id = {str(row["event_id"]): idx for idx, row in enumerate(event_rows)}
    events_by_scene: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in event_rows:
        events_by_scene[str(row["scene_id"])].append(row)

    edge_rows: list[dict[str, str]] = []
    edge_signatures: set[tuple[str, str, str, str]] = set()
    relation_counts: Counter[str] = Counter()
    basis_counts: Counter[str] = Counter()

    def add_edge(from_event_id: str, to_event_id: str, relation: str, basis: str) -> None:
        if not from_event_id or not to_event_id or from_event_id == to_event_id:
            return
        sig = (from_event_id, to_event_id, relation, basis)
        if sig in edge_signatures:
            return
        edge_signatures.add(sig)
        relation_counts[relation] += 1
        basis_counts[basis] += 1
        edge_rows.append(
            {
                "from_event_id": from_event_id,
                "to_event_id": to_event_id,
                "relation": relation,
                "basis": basis,
            }
        )

    # Global screenplay-order adjacency (preserves frame/flashback navigation context).
    for prev_row, next_row in zip(event_rows, event_rows[1:]):
        add_edge(
            str(prev_row["event_id"]),
            str(next_row["event_id"]),
            "precedes",
            "scene_order_and_sequence",
        )

    # Within-scene adjacency edges for local event walk.
    for scene_id, scene_events in events_by_scene.items():
        for prev_row, next_row in zip(scene_events, scene_events[1:]):
            add_edge(
                str(prev_row["event_id"]),
                str(next_row["event_id"]),
                "same_scene_next",
                "scene_order_and_sequence",
            )

    # Scene transition edges connect the end of one scene to the next scene's first event.
    known_scene_id_set = set(scene_ids_in_order)
    scene_transition_order = [sid for sid in scene_ids_in_order if sid in events_by_scene and events_by_scene[sid]]
    scene_transition_order.extend(sorted(sid for sid in events_by_scene if sid not in known_scene_id_set))
    for prev_scene_id, next_scene_id in zip(scene_transition_order, scene_transition_order[1:]):
        prev_events = events_by_scene.get(prev_scene_id) or []
        next_events = events_by_scene.get(next_scene_id) or []
        if not prev_events or not next_events:
            continue
        add_edge(
            str(prev_events[-1]["event_id"]),
            str(next_events[0]["event_id"]),
            "cross_scene_continuation",
            "adjacent_scene_transition",
        )

    # Flashback marker helpers for the UI to surface narrative jumps explicitly.
    for scene_events in events_by_scene.values():
        for idx, row in enumerate(scene_events):
            event_type_l2 = str(row.get("event_type_l2", ""))
            event_id = str(row["event_id"])
            if event_type_l2 == "flashback_enter" and idx + 1 < len(scene_events):
                add_edge(
                    event_id,
                    str(scene_events[idx + 1]["event_id"]),
                    "flashback_to",
                    "flashback_marker_next_event",
                )
            elif event_type_l2 == "flashback_return":
                global_idx = event_index_by_id.get(event_id)
                if global_idx is not None and global_idx + 1 < len(event_rows):
                    add_edge(
                        event_id,
                        str(event_rows[global_idx + 1]["event_id"]),
                        "returns_to_frame",
                        "flashback_return_marker_next_event",
                    )

    edge_rows.sort(
        key=lambda e: (
            event_index_by_id.get(str(e["from_event_id"]), 10**9),
            event_index_by_id.get(str(e["to_event_id"]), 10**9),
            str(e["relation"]),
            str(e["basis"]),
        )
    )

    edge_items: list[dict[str, str]] = []
    for i, edge in enumerate(edge_rows, start=1):
        edge_items.append(
            {
                "temporal_edge_id": f"te_{i:06d}",
                "from_event_id": str(edge["from_event_id"]),
                "to_event_id": str(edge["to_event_id"]),
                "relation": str(edge["relation"]),
                "basis": str(edge["basis"]),
            }
        )

    envelope = make_envelope(
        artifact_type="temporal_edges",
        schema_version=TEMPORAL_SCHEMA_VERSION,
        pipeline_version=TEMPORAL_BUILDER_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_hash,
        items=edge_items,
        extra_metadata={
            "relation_counts": dict(sorted(relation_counts.items())),
            "basis_counts": dict(sorted(basis_counts.items())),
            "event_count": len(event_rows),
            "scene_count": len(events_by_scene),
            "source_artifacts": [
                str(events_path.relative_to(REPO_ROOT)),
                str(scene_index_path.relative_to(REPO_ROOT)),
            ],
        },
    )
    write_json(out_dir / "temporal_edges.json", envelope, args.indent)

    print(f"Wrote temporal edges to {out_dir / 'temporal_edges.json'}")
    print(f"Temporal edges: {len(edge_items)}")
    print("Relations:")
    for relation, count in sorted(relation_counts.items()):
        print(f"  - {relation}: {count}")
    print("Bases:")
    for basis, count in sorted(basis_counts.items()):
        print(f"  - {basis}: {count}")

    return 0


def main() -> int:
    args = parse_args()
    if args.kg_only and args.temporal_only:
        print("error: choose only one of --kg-only or --temporal-only")
        return 2
    if args.temporal_only:
        return build_temporal_edges(args)

    # Default behavior and --kg-only both run KG generation in Phase 2.
    return build_kg_edges(args)


if __name__ == "__main__":
    raise SystemExit(main())
