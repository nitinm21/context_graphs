#!/usr/bin/env python3
"""Parse the cleaned Irishman screenplay markdown into Phase 1 artifacts.

Outputs (Phase 1):
- data/intermediate/scenes.json
- data/intermediate/utterances.json
- data/intermediate/action_beats.json
- data/intermediate/script_blocks.json
- data/intermediate/parser_build_manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "the-irishman-ampas-script-cleaned.md"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "intermediate"
PARSER_VERSION = "phase1-parser-v0.1.0"
SCRIPT_BLOCK_SCHEMA_VERSION = "0.1.0-draft"

SCENE_HEADER_RE = re.compile(
    r"^(INT\.|EXT\.|INT/EXT\.|EXT/INT\.|INT\./EXT\.|EXT\./INT\.)\s+(.+)$",
    re.IGNORECASE,
)
YEAR_SEGMENT_RE = re.compile(r"^(19\d{2}|20\d{2})$")
YEAR_INLINE_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")
SCRIPT_BLOCK_RE = re.compile(r"```text\s*\n(.*?)\n```", re.DOTALL)

TIME_OF_DAY_SEGMENTS = {
    "DAY",
    "NIGHT",
    "MORNING",
    "AFTERNOON",
    "EVENING",
    "DAWN",
    "DUSK",
    "LATER",
    "CONTINUOUS",
    "SAME TIME",
    "MOMENTS LATER",
    "LATE AFTERNOON",
    "EARLY MORNING",
    "SUNSET",
    "SUNRISE",
    "THE NEXT DAY",
}

TRANSITIONISH_PREFIXES = (
    "CUT TO",
    "FADE IN",
    "FADE OUT",
    "DISSOLVE TO",
    "MATCH CUT",
    "SMASH CUT",
)

MARKER_RULES: dict[str, re.Pattern[str]] = {
    "voice_over": re.compile(r"\bV/O\b", re.IGNORECASE),
    "in_sync": re.compile(r"\(IN\s+SYNC\)", re.IGNORECASE),
    "contd": re.compile(r"\(CONT['’]?D\)", re.IGNORECASE),
    "overlap": re.compile(r"\(OVERLAP\)", re.IGNORECASE),
    "pre_lap": re.compile(r"PRE-LAP", re.IGNORECASE),
    "back_to": re.compile(r"\bBACK\s+TO\b", re.IGNORECASE),
    "flashback": re.compile(r"\bFLASHBACK\b", re.IGNORECASE),
}


@dataclass
class SceneState:
    scene_id: str
    scene_index: int
    header_raw: str
    header_prefix: str
    location_raw: str
    location_canonical_id: str | None
    time_of_day: str | None
    year_explicit: int | None
    year_inferred: int | None
    flags: list[str]
    line_start: int
    line_end: int
    source_file: str
    header_line: int | None
    content_sequence: int = 0
    is_synthetic: bool = False
    has_explicit_header: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Cleaned markdown source file")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="Output directory")
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indentation (default: 2; use 0 for compact)",
    )
    return parser.parse_args()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_source_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def extract_normalized_script_lines(markdown_text: str) -> list[str]:
    match = SCRIPT_BLOCK_RE.search(markdown_text)
    if not match:
        raise ValueError("Could not find ```text fenced block in source markdown")
    body = match.group(1)
    return body.splitlines()


def make_id(prefix: str, index: int, width: int) -> str:
    return f"{prefix}_{index:0{width}d}"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    slug = re.sub(r"_+", "_", slug)
    return slug or "unknown"


def detect_markers(text: str) -> list[str]:
    found = [name for name, pattern in MARKER_RULES.items() if pattern.search(text)]
    return sorted(found)


def is_scene_header(line: str) -> bool:
    return bool(SCENE_HEADER_RE.match(line.strip()))


def is_parenthetical_line(line: str) -> bool:
    stripped = line.strip()
    return len(stripped) >= 2 and stripped.startswith("(") and stripped.endswith(")")


def is_uppercaseish(line: str) -> bool:
    letters = [ch for ch in line if ch.isalpha()]
    if not letters:
        return False
    uppercase_letters = sum(1 for ch in letters if ch.isupper())
    return uppercase_letters / len(letters) >= 0.9


def cue_token_count(cue: str) -> int:
    base = re.sub(r"\([^)]*\)", "", cue)
    base = base.replace("/", " ")
    tokens = [tok for tok in base.split() if tok]
    return len(tokens)


def looks_like_dialogue_text(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if is_scene_header(stripped):
        return False
    if is_parenthetical_line(stripped):
        return True
    if any(stripped.startswith(prefix) for prefix in TRANSITIONISH_PREFIXES):
        return False

    # Dialog lines in this corpus are overwhelmingly sentence case; using lowercase presence
    # avoids misclassifying title/section lines as character cues.
    has_lower = any(ch.islower() for ch in stripped)
    if has_lower:
        return True

    # Allow short shouted responses such as "NO!" while rejecting long all-caps action lines.
    return len(stripped.split()) <= 3 and len(stripped) <= 20


def is_probable_dialogue_cue(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if is_scene_header(stripped):
        return False
    if is_parenthetical_line(stripped):
        return False
    if stripped.startswith("#"):
        return False
    if " - " in stripped:
        return False
    if any(stripped.startswith(prefix) for prefix in TRANSITIONISH_PREFIXES):
        return False
    if not is_uppercaseish(stripped):
        return False
    if any(ch in stripped for ch in [":", ";"]):
        return False
    if len(stripped) > 80:
        return False
    if cue_token_count(stripped) > 8:
        return False
    # Prevent obvious document/title lines and section labels from being treated as cues.
    blacklist = {"FINAL", "SCRIPT", "SCREENPLAY", "SHOOTING"}
    if blacklist.intersection({tok.strip(".()") for tok in stripped.split()}):
        if "V/O" not in stripped and "(" not in stripped:
            return False
    return True


def next_nonempty_index(lines: list[str], start_index: int) -> int | None:
    for idx in range(start_index, len(lines)):
        if lines[idx].strip():
            return idx
    return None


def cue_has_dialogue_payload(lines: list[str], cue_idx: int) -> tuple[bool, bool]:
    """Return (has_payload, allow_empty_stub).

    `allow_empty_stub` is used for formatter artifacts like `FRANK V/O (CONT'D)` with no text.
    """
    nxt = next_nonempty_index(lines, cue_idx + 1)
    if nxt is None:
        cue = lines[cue_idx].strip()
        return False, ("V/O" in cue or "(" in cue)

    nxt_line = lines[nxt].strip()
    if is_scene_header(nxt_line):
        cue = lines[cue_idx].strip()
        return False, ("V/O" in cue or "(" in cue)

    if is_probable_dialogue_cue(nxt_line):
        cue = lines[cue_idx].strip()
        return False, ("V/O" in cue or "(" in cue)

    if is_parenthetical_line(nxt_line):
        after_parenthetical = next_nonempty_index(lines, nxt + 1)
        if after_parenthetical is None:
            cue = lines[cue_idx].strip()
            return False, ("(" in cue or "V/O" in cue)
        after_line = lines[after_parenthetical].strip()
        if is_scene_header(after_line) or is_probable_dialogue_cue(after_line):
            cue = lines[cue_idx].strip()
            return False, ("(" in cue or "V/O" in cue)
        return looks_like_dialogue_text(after_line), False

    return looks_like_dialogue_text(nxt_line), False


def split_dialogue_cue(cue_raw: str) -> tuple[str, list[str]]:
    modifiers: list[str] = []
    upper = cue_raw.upper()
    if "V/O" in upper:
        modifiers.append("voice_over")
    if "IN SYNC" in upper:
        modifiers.append("in_sync")
    if "PRE-LAP" in upper:
        modifiers.append("pre_lap")
    if "OVERLAP" in upper:
        modifiers.append("overlap")
    if "CONT'D" in upper or "CONT’D" in upper:
        modifiers.append("contd")

    base = cue_raw
    base = re.sub(r"\bV/O\b", "", base, flags=re.IGNORECASE)
    base = re.sub(r"\([^)]*\)", "", base)
    base = re.sub(r"\s+", " ", base).strip()
    return base, sorted(set(modifiers))


def parse_scene_header_fields(header_raw: str) -> dict[str, Any]:
    match = SCENE_HEADER_RE.match(header_raw.strip())
    if not match:
        raise ValueError(f"Not a scene header: {header_raw!r}")

    header_prefix = match.group(1).upper()
    remainder = match.group(2).strip()
    segments = [segment.strip() for segment in remainder.split(" - ") if segment.strip()]

    flags: list[str] = []
    year_explicit: int | None = None
    time_of_day: str | None = None
    consumed_tail = 0

    trailing_segments = list(segments)
    while trailing_segments:
        segment = trailing_segments[-1]
        upper_seg = segment.upper()
        if YEAR_SEGMENT_RE.fullmatch(upper_seg):
            year_explicit = int(upper_seg)
            flags.append("explicit_year")
            trailing_segments.pop()
            consumed_tail += 1
            continue
        if upper_seg == "FLASHBACK":
            flags.append("flashback")
            trailing_segments.pop()
            consumed_tail += 1
            continue
        if upper_seg == "CONTINUED":
            flags.append("continued")
            trailing_segments.pop()
            consumed_tail += 1
            continue
        if upper_seg in TIME_OF_DAY_SEGMENTS:
            time_of_day = upper_seg
            trailing_segments.pop()
            consumed_tail += 1
            continue
        break

    if year_explicit is None:
        year_match = YEAR_INLINE_RE.search(remainder)
        if year_match:
            year_explicit = int(year_match.group(1))
            flags.append("explicit_year_inline")

    if "FLASHBACK" in remainder.upper() and "flashback" not in flags:
        flags.append("flashback")
    if header_prefix in {"INT/EXT.", "EXT/INT.", "INT./EXT.", "EXT./INT."}:
        flags.append("mixed_interior_exterior")

    location_raw = " - ".join(trailing_segments).strip() or remainder
    location_canonical_id = f"loc_{slugify(location_raw)}"

    return {
        "header_prefix": header_prefix,
        "location_raw": location_raw,
        "location_canonical_id": location_canonical_id,
        "time_of_day": time_of_day,
        "year_explicit": year_explicit,
        "year_inferred": None,
        "flags": sorted(set(flags)),
    }


def make_artifact_envelope(
    *,
    artifact_type: str,
    schema_version: str,
    build_timestamp: str,
    source_file: str,
    source_file_hash: str,
    parser_version: str,
    items: list[dict[str, Any]],
    extra_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "artifact_type": artifact_type,
        "schema_version": schema_version,
        "parser_version": parser_version,
        "build_timestamp": build_timestamp,
        "source_file": source_file,
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


def parse_screenplay(lines: list[str], source_file: str) -> dict[str, Any]:
    scenes: list[dict[str, Any]] = []
    utterances: list[dict[str, Any]] = []
    action_beats: list[dict[str, Any]] = []
    script_blocks: list[dict[str, Any]] = []

    scene_prefix_counts: Counter[str] = Counter()
    marker_counts: Counter[str] = Counter()

    current_scene: SceneState | None = None
    scene_counter = 0
    block_counter = 0
    utterance_counter = 0
    action_counter = 0

    def add_scene(scene: SceneState) -> None:
        scenes.append(
            {
                "scene_id": scene.scene_id,
                "scene_index": scene.scene_index,
                "header_raw": scene.header_raw,
                "header_prefix": scene.header_prefix,
                "location_raw": scene.location_raw,
                "location_canonical_id": scene.location_canonical_id,
                "time_of_day": scene.time_of_day,
                "year_explicit": scene.year_explicit,
                "year_inferred": scene.year_inferred,
                "flags": scene.flags,
                "line_start": scene.line_start,
                "line_end": scene.line_end,
                "source_file": scene.source_file,
            }
        )

    def close_current_scene(final_line: int | None = None) -> None:
        nonlocal current_scene
        if current_scene is None:
            return
        if final_line is not None and final_line > current_scene.line_end:
            current_scene.line_end = final_line
        add_scene(current_scene)
        current_scene = None

    def ensure_scene_for_prelude(line_no: int) -> SceneState:
        nonlocal current_scene, scene_counter
        if current_scene is not None:
            return current_scene
        scene_counter += 1
        scene_id = make_id("scene", scene_counter, 4)
        current_scene = SceneState(
            scene_id=scene_id,
            scene_index=scene_counter,
            header_raw="IMPLICIT PRELUDE (NO SCENE HEADER)",
            header_prefix="IMPLICIT",
            location_raw="IMPLICIT PRELUDE",
            location_canonical_id="loc_implicit_prelude",
            time_of_day=None,
            year_explicit=None,
            year_inferred=None,
            flags=["synthetic_prelude_scene"],
            line_start=line_no,
            line_end=line_no,
            source_file=source_file,
            header_line=None,
            is_synthetic=True,
            has_explicit_header=False,
        )
        return current_scene

    def add_script_block(block: dict[str, Any]) -> None:
        nonlocal block_counter
        block_counter += 1
        block["block_id"] = make_id("blk", block_counter, 6)
        script_blocks.append(block)
        for marker in block.get("markers", []):
            marker_counts[marker] += 1

    idx = 0
    while idx < len(lines):
        raw_line = lines[idx]
        line = raw_line.rstrip("\n")
        stripped = line.strip()
        line_no = idx + 1

        if not stripped:
            idx += 1
            continue

        if is_scene_header(stripped):
            close_current_scene(final_line=(line_no - 1))
            scene_counter += 1
            scene_id = make_id("scene", scene_counter, 4)
            header_fields = parse_scene_header_fields(stripped)
            current_scene = SceneState(
                scene_id=scene_id,
                scene_index=scene_counter,
                header_raw=stripped,
                header_prefix=header_fields["header_prefix"],
                location_raw=header_fields["location_raw"],
                location_canonical_id=header_fields["location_canonical_id"],
                time_of_day=header_fields["time_of_day"],
                year_explicit=header_fields["year_explicit"],
                year_inferred=header_fields["year_inferred"],
                flags=header_fields["flags"],
                line_start=line_no,
                line_end=line_no,
                source_file=source_file,
                header_line=line_no,
                is_synthetic=False,
                has_explicit_header=True,
            )
            scene_prefix_counts[current_scene.header_prefix] += 1
            add_script_block(
                {
                    "scene_id": current_scene.scene_id,
                    "block_type": "scene_header",
                    "sequence_in_scene": 0,
                    "line_start": line_no,
                    "line_end": line_no,
                    "text": stripped,
                    "markers": detect_markers(stripped),
                }
            )
            idx += 1
            continue

        scene = ensure_scene_for_prelude(line_no)
        if line_no > scene.line_end:
            scene.line_end = line_no

        if is_probable_dialogue_cue(stripped):
            has_payload, allow_empty_stub = cue_has_dialogue_payload(lines, idx)
            if has_payload or allow_empty_stub:
                cue_raw = stripped
                _, delivery_modifiers = split_dialogue_cue(cue_raw)
                speaker_entity_id = None
                dialogue_lines: list[str] = []
                end_idx = idx
                cursor = idx + 1
                seen_nonempty_after_cue = False

                while cursor < len(lines):
                    candidate = lines[cursor].rstrip("\n")
                    candidate_stripped = candidate.strip()
                    if not candidate_stripped:
                        if seen_nonempty_after_cue:
                            break
                        cursor += 1
                        continue

                    if is_scene_header(candidate_stripped):
                        break
                    if is_probable_dialogue_cue(candidate_stripped):
                        break

                    seen_nonempty_after_cue = True
                    if is_parenthetical_line(candidate_stripped):
                        dialogue_lines.append(candidate_stripped)
                    else:
                        dialogue_lines.append(candidate_stripped)
                    end_idx = cursor
                    cursor += 1

                utterance_counter += 1
                scene.content_sequence += 1
                utterance_id = make_id("utt", utterance_counter, 6)
                utterance_text = " ".join(dialogue_lines).strip()

                utterance = {
                    "utterance_id": utterance_id,
                    "scene_id": scene.scene_id,
                    "speaker_cue_raw": cue_raw,
                    "speaker_entity_id": speaker_entity_id,
                    "delivery_modifiers": delivery_modifiers,
                    "text": utterance_text,
                    "line_start": line_no,
                    "line_end": end_idx + 1,
                    "sequence_in_scene": scene.content_sequence,
                }
                utterances.append(utterance)

                block_markers = sorted(set(detect_markers(cue_raw + " " + utterance_text)))
                add_script_block(
                    {
                        "scene_id": scene.scene_id,
                        "block_type": "utterance",
                        "sequence_in_scene": scene.content_sequence,
                        "line_start": line_no,
                        "line_end": end_idx + 1,
                        "text": utterance_text,
                        "speaker_cue_raw": cue_raw,
                        "utterance_id": utterance_id,
                        "markers": block_markers,
                    }
                )
                if (end_idx + 1) > scene.line_end:
                    scene.line_end = end_idx + 1
                idx = max(idx + 1, end_idx + 1)
                continue

        # Action beat (including structural markers such as BACK TO ...)
        action_lines: list[str] = [stripped]
        end_idx = idx
        cursor = idx + 1
        while cursor < len(lines):
            candidate = lines[cursor].rstrip("\n")
            candidate_stripped = candidate.strip()
            if not candidate_stripped:
                if action_lines:
                    break
                cursor += 1
                continue
            if is_scene_header(candidate_stripped):
                break
            if is_probable_dialogue_cue(candidate_stripped):
                payload, allow_stub = cue_has_dialogue_payload(lines, cursor)
                if payload or allow_stub:
                    break
            action_lines.append(candidate_stripped)
            end_idx = cursor
            cursor += 1

        action_counter += 1
        scene.content_sequence += 1
        action_id = make_id("act", action_counter, 6)
        action_text = " ".join(action_lines).strip()
        action_beats.append(
            {
                "action_id": action_id,
                "scene_id": scene.scene_id,
                "text": action_text,
                "line_start": line_no,
                "line_end": end_idx + 1,
                "sequence_in_scene": scene.content_sequence,
            }
        )
        add_script_block(
            {
                "scene_id": scene.scene_id,
                "block_type": "action",
                "sequence_in_scene": scene.content_sequence,
                "line_start": line_no,
                "line_end": end_idx + 1,
                "text": action_text,
                "action_id": action_id,
                "markers": detect_markers(action_text),
            }
        )
        if (end_idx + 1) > scene.line_end:
            scene.line_end = end_idx + 1
        idx = end_idx + 1

    close_current_scene(final_line=len(lines))

    explicit_scene_headers = sum(1 for s in scenes if "synthetic_prelude_scene" not in s["flags"])
    synthetic_scenes = len(scenes) - explicit_scene_headers
    empty_utterance_count = sum(1 for u in utterances if not u["text"].strip())

    return {
        "scenes": scenes,
        "utterances": utterances,
        "action_beats": action_beats,
        "script_blocks": script_blocks,
        "summary": {
            "scene_count_total": len(scenes),
            "scene_count_explicit_headers": explicit_scene_headers,
            "scene_count_synthetic": synthetic_scenes,
            "utterance_count": len(utterances),
            "action_beat_count": len(action_beats),
            "script_block_count": len(script_blocks),
            "empty_utterance_count": empty_utterance_count,
            "scene_header_prefix_counts": dict(scene_prefix_counts),
            "marker_counts": dict(marker_counts),
        },
    }


def main() -> int:
    args = parse_args()
    source_path: Path = args.source.resolve()
    out_dir: Path = args.out_dir.resolve()

    if not source_path.is_file():
        print(f"error: source file not found: {source_path}")
        return 2

    source_bytes = source_path.read_bytes()
    source_text = source_bytes.decode("utf-8")
    source_hash = sha256_hex(source_bytes)
    build_timestamp = utc_now_iso()
    source_file_name = source_path.name

    try:
        script_lines = extract_normalized_script_lines(source_text)
    except ValueError as exc:
        print(f"error: {exc}")
        return 2

    parsed = parse_screenplay(script_lines, source_file_name)

    common_meta = {
        "build_timestamp": build_timestamp,
        "source_file": source_file_name,
        "source_file_hash": source_hash,
        "parser_version": PARSER_VERSION,
    }

    scenes_envelope = make_artifact_envelope(
        artifact_type="scenes",
        schema_version=SCRIPT_BLOCK_SCHEMA_VERSION,
        items=parsed["scenes"],
        extra_metadata={
            **common_meta,
            "scene_count_explicit_headers": parsed["summary"]["scene_count_explicit_headers"],
            "scene_count_synthetic": parsed["summary"]["scene_count_synthetic"],
        },
        build_timestamp=build_timestamp,
        source_file=source_file_name,
        source_file_hash=source_hash,
        parser_version=PARSER_VERSION,
    )
    utterances_envelope = make_artifact_envelope(
        artifact_type="utterances",
        schema_version=SCRIPT_BLOCK_SCHEMA_VERSION,
        items=parsed["utterances"],
        extra_metadata=common_meta,
        build_timestamp=build_timestamp,
        source_file=source_file_name,
        source_file_hash=source_hash,
        parser_version=PARSER_VERSION,
    )
    actions_envelope = make_artifact_envelope(
        artifact_type="action_beats",
        schema_version=SCRIPT_BLOCK_SCHEMA_VERSION,
        items=parsed["action_beats"],
        extra_metadata=common_meta,
        build_timestamp=build_timestamp,
        source_file=source_file_name,
        source_file_hash=source_hash,
        parser_version=PARSER_VERSION,
    )
    blocks_envelope = make_artifact_envelope(
        artifact_type="script_blocks",
        schema_version=SCRIPT_BLOCK_SCHEMA_VERSION,
        items=parsed["script_blocks"],
        extra_metadata={
            **common_meta,
            "block_type_counts": dict(Counter(block["block_type"] for block in parsed["script_blocks"])),
        },
        build_timestamp=build_timestamp,
        source_file=source_file_name,
        source_file_hash=source_hash,
        parser_version=PARSER_VERSION,
    )

    manifest = {
        "metadata": {
            "artifact_type": "parser_build_manifest",
            "schema_version": "0.1.0-draft",
            "parser_version": PARSER_VERSION,
            "build_timestamp": build_timestamp,
            "source_file": source_file_name,
            "source_file_hash": source_hash,
        },
        "summary": {
            **parsed["summary"],
            "script_body_line_count": len(script_lines),
            "pipeline_version": "phase1-parser",
        },
    }

    outputs = {
        out_dir / "scenes.json": scenes_envelope,
        out_dir / "utterances.json": utterances_envelope,
        out_dir / "action_beats.json": actions_envelope,
        out_dir / "script_blocks.json": blocks_envelope,
        out_dir / "parser_build_manifest.json": manifest,
    }

    for path, payload in outputs.items():
        write_json(path, payload, args.indent)

    summary = manifest["summary"]
    print(f"Wrote Phase 1 parser artifacts to {out_dir}")
    print(
        "Scenes: "
        f"{summary['scene_count_total']} total "
        f"({summary['scene_count_explicit_headers']} explicit headers, {summary['scene_count_synthetic']} synthetic)"
    )
    print(
        f"Utterances: {summary['utterance_count']}, "
        f"Action beats: {summary['action_beat_count']}, "
        f"Script blocks: {summary['script_block_count']}"
    )
    print(
        "Markers detected: "
        + ", ".join(
            f"{key}={value}" for key, value in sorted(summary["marker_counts"].items())
        )
    )
    if summary["empty_utterance_count"]:
        print(f"Empty utterance stubs preserved: {summary['empty_utterance_count']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
