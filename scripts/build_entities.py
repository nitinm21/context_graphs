#!/usr/bin/env python3
"""Build Phase 2 entity and alias artifacts from parsed screenplay data."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENES = REPO_ROOT / "data" / "intermediate" / "scenes.json"
DEFAULT_UTTERANCES = REPO_ROOT / "data" / "intermediate" / "utterances.json"
DEFAULT_CONFIG = REPO_ROOT / "config" / "entity_aliases.manual.json"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "derived"
ENTITY_BUILDER_VERSION = "phase2-entities-v0.1.0"
ENTITY_SCHEMA_VERSION = "0.1.0-draft"

MODIFIER_PATTERNS = [
    re.compile(r"\bV/O\b", re.IGNORECASE),
    re.compile(r"\bO/S\b", re.IGNORECASE),
    re.compile(r"\bO\.S\.\b", re.IGNORECASE),
    re.compile(r"\bO/C\b", re.IGNORECASE),
    re.compile(r"\bO\.C\.\b", re.IGNORECASE),
    re.compile(r"\bPRE-LAP\b", re.IGNORECASE),
]
PARENS_RE = re.compile(r"\([^)]*\)")
WHITESPACE_RE = re.compile(r"\s+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
ROMAN_NUMERAL_RE = re.compile(r"\b[IVX]+\b")
ACRONYM_TOKENS = {"FBI", "TV", "USA", "US", "DC", "PA"}

ENTITY_TYPE_ORDER = {
    "character": 0,
    "group": 1,
    "organization": 2,
    "location": 3,
    "object": 4,
}


@dataclass
class EntityAccumulator:
    entity_id: str
    entity_type: str
    canonical_name: str
    aliases: set[str] = field(default_factory=set)
    first_scene_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class AliasRecord:
    alias_raw: str
    alias_normalized: str
    entity_id: str
    entity_type: str
    alias_kind: str
    source: str
    first_scene_id: str | None = None
    count: int | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=Path, default=DEFAULT_SCENES)
    parser.add_argument("--utterances", type=Path, default=DEFAULT_UTTERANCES)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
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
        raise ValueError(f"{path} missing envelope metadata/items")
    return metadata, items


def normalize_ascii_apostrophes(text: str) -> str:
    return text.replace("’", "'").replace("‘", "'")


def normalize_alias_text(raw: str) -> str:
    text = normalize_ascii_apostrophes(raw).strip()
    for pattern in MODIFIER_PATTERNS:
        text = pattern.sub("", text)
    text = PARENS_RE.sub("", text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    return text.upper()


def slugify(text: str) -> str:
    lowered = normalize_ascii_apostrophes(text).lower()
    slug = NON_ALNUM_RE.sub("_", lowered).strip("_")
    slug = re.sub(r"_+", "_", slug)
    return slug or "unknown"


def display_name_from_cue(base: str) -> str:
    tokens = base.split()
    titled: list[str] = []
    for token in tokens:
        token_clean = token.strip(".,")
        if ROMAN_NUMERAL_RE.fullmatch(token_clean):
            titled.append(token)
            continue
        if token_clean in ACRONYM_TOKENS:
            titled.append(token_clean if token == token_clean else token.replace(token_clean, token_clean))
            continue
        if token.endswith(".") and len(token_clean) == 1 and token_clean.isalpha():
            titled.append(token.upper())
            continue
        titled.append(token.lower().capitalize())
    return " ".join(titled)


def cue_is_ignored(raw_cue: str, normalized_cue: str, cfg: dict[str, Any]) -> bool:
    ignored_exact = set(cfg.get("ignored_cues_exact", []))
    ignored_normalized = set(cfg.get("ignored_cues_normalized", []))
    ignored_prefixes = tuple(cfg.get("ignored_cue_prefixes", []))
    ignored_contains = tuple(cfg.get("ignored_cue_contains", []))

    if raw_cue in ignored_exact:
        return True
    if normalized_cue in ignored_normalized:
        return True
    if raw_cue.startswith(ignored_prefixes) or normalized_cue.startswith(ignored_prefixes):
        return True
    if any(fragment in raw_cue for fragment in ignored_contains):
        return True
    if any(fragment in normalized_cue for fragment in ignored_contains):
        return True
    if not normalized_cue:
        return True
    if normalized_cue in {"CUT TO", "DISSOLVE TO", "FADE IN", "FADE OUT"}:
        return True
    return False


def entity_type_sort_key(entity: dict[str, Any]) -> tuple[int, str, str]:
    return (
        ENTITY_TYPE_ORDER.get(entity.get("entity_type", "zz"), 99),
        str(entity.get("canonical_name", "")),
        str(entity.get("entity_id", "")),
    )


def update_first_scene(acc: EntityAccumulator, scene_id: str | None) -> None:
    if not scene_id:
        return
    if acc.first_scene_id is None or scene_id < acc.first_scene_id:
        acc.first_scene_id = scene_id


def ensure_entity(
    entities: dict[str, EntityAccumulator],
    *,
    entity_id: str,
    entity_type: str,
    canonical_name: str,
    metadata: dict[str, Any] | None = None,
) -> EntityAccumulator:
    if entity_id not in entities:
        entities[entity_id] = EntityAccumulator(
            entity_id=entity_id,
            entity_type=entity_type,
            canonical_name=canonical_name,
            metadata=dict(metadata or {}),
        )
    else:
        acc = entities[entity_id]
        if metadata:
            for key, value in metadata.items():
                if key not in acc.metadata:
                    acc.metadata[key] = value
    return entities[entity_id]


def add_alias(
    alias_records: dict[tuple[str, str], AliasRecord],
    *,
    alias_raw: str,
    alias_normalized: str,
    entity_id: str,
    entity_type: str,
    alias_kind: str,
    source: str,
    first_scene_id: str | None = None,
    count: int | None = None,
) -> None:
    key = (alias_raw, entity_id)
    record = alias_records.get(key)
    if record is None:
        alias_records[key] = AliasRecord(
            alias_raw=alias_raw,
            alias_normalized=alias_normalized,
            entity_id=entity_id,
            entity_type=entity_type,
            alias_kind=alias_kind,
            source=source,
            first_scene_id=first_scene_id,
            count=count,
        )
        return

    if first_scene_id and (record.first_scene_id is None or first_scene_id < record.first_scene_id):
        record.first_scene_id = first_scene_id
    if count is not None:
        record.count = (record.count or 0) + count if record.count is not None else count
    if alias_kind.startswith("manual"):
        record.alias_kind = alias_kind
    if source not in record.source.split(","):
        record.source = f"{record.source},{source}"


def title_from_location(location_raw: str) -> str:
    # Preserve screenplay casing; only normalize whitespace.
    return WHITESPACE_RE.sub(" ", location_raw).strip()


def build_artifact_envelope(
    *,
    artifact_type: str,
    schema_version: str,
    build_timestamp: str,
    source_file_hash: str,
    pipeline_version: str,
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


def write_json(path: Path, payload: dict[str, Any], indent: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=indent if indent > 0 else None, ensure_ascii=False)
        f.write("\n")


def main() -> int:
    args = parse_args()
    scenes_path = args.scenes.resolve()
    utterances_path = args.utterances.resolve()
    config_path = args.config.resolve()
    out_dir = args.out_dir.resolve()

    for required in [scenes_path, utterances_path, config_path]:
        if not required.is_file():
            print(f"error: missing required file: {required}")
            return 2

    scenes_meta, scenes = load_envelope(scenes_path)
    utterances_meta, utterances = load_envelope(utterances_path)
    cfg = load_json(config_path)
    if not isinstance(cfg, dict):
        print("error: entity alias config must be a JSON object")
        return 2

    build_timestamp = utc_now_iso()
    source_hash = str(scenes_meta.get("source_file_hash") or utterances_meta.get("source_file_hash") or "")
    if not source_hash:
        source_hash = sha256_hex((scenes_path.read_bytes() + utterances_path.read_bytes()))

    entities: dict[str, EntityAccumulator] = {}
    alias_records: dict[tuple[str, str], AliasRecord] = {}

    # Manual seeds (characters/groups/orgs required for Phase 2 demos)
    manual_entity_ids: set[str] = set()
    for seed in cfg.get("manual_entities", []):
        if not isinstance(seed, dict):
            continue
        entity_id = str(seed.get("entity_id", "")).strip()
        entity_type = str(seed.get("entity_type", "character")).strip()
        canonical_name = str(seed.get("canonical_name", entity_id)).strip()
        if not entity_id or not canonical_name:
            continue
        manual_entity_ids.add(entity_id)
        acc = ensure_entity(
            entities,
            entity_id=entity_id,
            entity_type=entity_type,
            canonical_name=canonical_name,
            metadata={**(seed.get("metadata") if isinstance(seed.get("metadata"), dict) else {}), "manual_seed": True},
        )
        for alias in seed.get("aliases", []):
            alias = str(alias).strip()
            if not alias:
                continue
            acc.aliases.add(alias)
            add_alias(
                alias_records,
                alias_raw=alias,
                alias_normalized=normalize_alias_text(alias),
                entity_id=entity_id,
                entity_type=entity_type,
                alias_kind="seed_alias",
                source="manual_seed",
            )

    manual_exact = {str(k): str(v) for k, v in (cfg.get("manual_aliases_exact") or {}).items()}
    manual_norm = {str(k): str(v) for k, v in (cfg.get("manual_aliases_normalized") or {}).items()}

    utterance_scene_by_cue: dict[str, str] = {}
    cue_counts: Counter[str] = Counter()
    ignored_cues: Counter[str] = Counter()
    auto_generated_cues: Counter[str] = Counter()
    normalized_to_entity_id: dict[str, str] = {}

    # Prime normalized->entity map from manual aliases and manual seeds.
    for alias, entity_id in manual_exact.items():
        normalized_to_entity_id.setdefault(normalize_alias_text(alias), entity_id)
    for alias_norm, entity_id in manual_norm.items():
        normalized_to_entity_id.setdefault(normalize_alias_text(alias_norm), entity_id)
    for entity_id, acc in entities.items():
        for alias in acc.aliases:
            normalized_to_entity_id.setdefault(normalize_alias_text(alias), entity_id)

    # Build characters/groups from utterance speaker cues.
    for utt in utterances:
        if not isinstance(utt, dict):
            continue
        raw_cue = str(utt.get("speaker_cue_raw", "")).strip()
        scene_id = str(utt.get("scene_id", "")).strip() or None
        if not raw_cue:
            continue
        cue_counts[raw_cue] += 1
        if raw_cue not in utterance_scene_by_cue and scene_id:
            utterance_scene_by_cue[raw_cue] = scene_id

        normalized_cue = normalize_alias_text(raw_cue)
        if cue_is_ignored(raw_cue, normalized_cue, cfg):
            ignored_cues[raw_cue] += 1
            continue

        entity_id = manual_exact.get(raw_cue)
        alias_kind = "manual_exact" if entity_id else ""
        if not entity_id:
            entity_id = manual_norm.get(normalized_cue)
            alias_kind = "manual_normalized" if entity_id else ""
        if not entity_id:
            entity_id = normalized_to_entity_id.get(normalized_cue)
            alias_kind = "normalized_match" if entity_id else ""

        if not entity_id:
            if " AND " in normalized_cue or "/" in normalized_cue:
                ignored_cues[raw_cue] += 1
                continue
            entity_id = f"char_{slugify(normalized_cue)}"
            alias_kind = "auto_from_cue"
            auto_generated_cues[raw_cue] += 1

        if entity_id not in entities:
            canonical_base = normalized_cue or raw_cue
            entity_type = "character"
            canonical_name = display_name_from_cue(canonical_base)
            ensure_entity(
                entities,
                entity_id=entity_id,
                entity_type=entity_type,
                canonical_name=canonical_name,
                metadata={"manual_seed": False},
            )
        acc = entities[entity_id]
        # Preserve manually seeded type/name when alias maps to group or org.
        acc.aliases.add(raw_cue)
        if normalized_cue and normalized_cue != raw_cue:
            acc.aliases.add(normalized_cue)
        update_first_scene(acc, scene_id)
        acc.metadata["utterance_count"] = int(acc.metadata.get("utterance_count", 0)) + 1
        acc.metadata["source_utterance_cues"] = True
        if entity_id in manual_entity_ids:
            acc.metadata["priority"] = bool(acc.metadata.get("priority", False))

        normalized_to_entity_id.setdefault(normalized_cue, entity_id)

        add_alias(
            alias_records,
            alias_raw=raw_cue,
            alias_normalized=normalized_cue,
            entity_id=entity_id,
            entity_type=acc.entity_type,
            alias_kind=alias_kind,
            source="utterance_cue",
            first_scene_id=scene_id,
            count=1,
        )
        if normalized_cue and normalized_cue != raw_cue:
            add_alias(
                alias_records,
                alias_raw=normalized_cue,
                alias_normalized=normalized_cue,
                entity_id=entity_id,
                entity_type=acc.entity_type,
                alias_kind="normalized_cue",
                source="utterance_cue",
                first_scene_id=scene_id,
                count=None,
            )

    # Build location entities from scene headers.
    location_scene_counts: Counter[str] = Counter()
    location_header_prefixes: dict[str, set[str]] = defaultdict(set)
    location_examples: dict[str, set[str]] = defaultdict(set)
    for scene in scenes:
        if not isinstance(scene, dict):
            continue
        scene_id = str(scene.get("scene_id", "")).strip() or None
        flags = scene.get("flags") or []
        if isinstance(flags, list) and "synthetic_prelude_scene" in flags:
            continue
        entity_id = str(scene.get("location_canonical_id", "")).strip()
        location_raw = str(scene.get("location_raw", "")).strip()
        header_prefix = str(scene.get("header_prefix", "")).strip()
        if not entity_id or not location_raw:
            continue

        acc = ensure_entity(
            entities,
            entity_id=entity_id,
            entity_type="location",
            canonical_name=title_from_location(location_raw),
            metadata={"source_scene_header": True},
        )
        acc.aliases.add(location_raw)
        update_first_scene(acc, scene_id)

        location_scene_counts[entity_id] += 1
        if header_prefix:
            location_header_prefixes[entity_id].add(header_prefix)
        if len(location_examples[entity_id]) < 5:
            location_examples[entity_id].add(location_raw)

        add_alias(
            alias_records,
            alias_raw=location_raw,
            alias_normalized=normalize_ascii_apostrophes(location_raw).upper(),
            entity_id=entity_id,
            entity_type="location",
            alias_kind="scene_location",
            source="scene_header",
            first_scene_id=scene_id,
            count=1,
        )

    for entity_id, acc in entities.items():
        if acc.entity_type == "location":
            acc.metadata["scene_count"] = location_scene_counts.get(entity_id, 0)
            acc.metadata["header_prefixes"] = sorted(location_header_prefixes.get(entity_id, set()))
            examples = sorted(location_examples.get(entity_id, set()))
            if examples:
                acc.metadata["scene_location_examples"] = examples

    # If any manual seed aliases appeared, set first_scene_id based on alias observations.
    for entity_id, acc in entities.items():
        if acc.first_scene_id is not None:
            continue
        candidate_first: str | None = None
        for alias in acc.aliases:
            scene_id = utterance_scene_by_cue.get(alias)
            if scene_id and (candidate_first is None or scene_id < candidate_first):
                candidate_first = scene_id
        if candidate_first:
            acc.first_scene_id = candidate_first

    # Finalize entities
    entity_items: list[dict[str, Any]] = []
    entity_type_counts: Counter[str] = Counter()
    for acc in entities.values():
        aliases_sorted = sorted(a for a in acc.aliases if a)
        entity_type_counts[acc.entity_type] += 1
        # Keep metadata deterministic and lightweight
        metadata = dict(acc.metadata)
        if isinstance(metadata.get("utterance_count"), int) and metadata["utterance_count"] == 0:
            metadata.pop("utterance_count", None)
        entity_items.append(
            {
                "entity_id": acc.entity_id,
                "entity_type": acc.entity_type,
                "canonical_name": acc.canonical_name,
                "aliases": aliases_sorted,
                "first_scene_id": acc.first_scene_id,
                "metadata": metadata,
            }
        )

    entity_items.sort(key=entity_type_sort_key)

    alias_items: list[dict[str, Any]] = []
    sorted_alias_records = sorted(
        alias_records.values(),
        key=lambda rec: (rec.alias_normalized, rec.alias_raw, rec.entity_id, rec.alias_kind),
    )
    for i, rec in enumerate(sorted_alias_records, start=1):
        alias_items.append(
            {
                "alias_record_id": f"ealias_{i:06d}",
                "alias_raw": rec.alias_raw,
                "alias_normalized": rec.alias_normalized,
                "entity_id": rec.entity_id,
                "entity_type": rec.entity_type,
                "alias_kind": rec.alias_kind,
                "source": rec.source,
                "first_scene_id": rec.first_scene_id,
                "count": rec.count,
            }
        )

    entities_envelope = build_artifact_envelope(
        artifact_type="entities",
        schema_version=ENTITY_SCHEMA_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_hash,
        pipeline_version=ENTITY_BUILDER_VERSION,
        items=entity_items,
        extra_metadata={
            "entity_type_counts": dict(entity_type_counts),
            "manual_seed_count": len(manual_entity_ids),
            "ignored_cue_unique_count": len(ignored_cues),
            "auto_generated_cue_unique_count": len(auto_generated_cues),
            "source_artifacts": [str(scenes_path.relative_to(REPO_ROOT)), str(utterances_path.relative_to(REPO_ROOT))],
            "config_file": str(config_path.relative_to(REPO_ROOT)),
        },
    )
    aliases_envelope = build_artifact_envelope(
        artifact_type="entity_aliases",
        schema_version=ENTITY_SCHEMA_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_hash,
        pipeline_version=ENTITY_BUILDER_VERSION,
        items=alias_items,
        extra_metadata={
            "source_artifacts": [str(scenes_path.relative_to(REPO_ROOT)), str(utterances_path.relative_to(REPO_ROOT))],
            "config_file": str(config_path.relative_to(REPO_ROOT)),
        },
    )

    write_json(out_dir / "entities.json", entities_envelope, args.indent)
    write_json(out_dir / "entity_aliases.json", aliases_envelope, args.indent)

    print(f"Wrote entity artifacts to {out_dir}")
    print(f"Entities: {len(entity_items)} ({', '.join(f'{k}={v}' for k, v in sorted(entity_type_counts.items()))})")
    print(f"Alias records: {len(alias_items)}")
    print(f"Ignored cue variants: {len(ignored_cues)}")
    if ignored_cues:
        print("Top ignored cues:")
        for cue, count in ignored_cues.most_common(10):
            print(f"  - {cue}: {count}")
    if auto_generated_cues:
        print(f"Auto-generated cue canonicals: {len(auto_generated_cues)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
