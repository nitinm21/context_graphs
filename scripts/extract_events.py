#!/usr/bin/env python3
"""Phase 3 rule-based observable event extraction for The Irishman demo.

Outputs:
- data/derived/events.json
- data/derived/event_participants.json
- data/derived/scene_index.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DERIVED_DIR = REPO_ROOT / "data" / "derived"
DEFAULT_INTERMEDIATE_DIR = REPO_ROOT / "data" / "intermediate"
DEFAULT_TAXONOMY_PATH = REPO_ROOT / "config" / "event_taxonomy.json"
EXTRACTOR_VERSION = "phase3-events-v0.1.0"
EVENT_SCHEMA_VERSION = "0.1.0-draft"

WORD_RE = re.compile(r"[A-Za-z0-9']+")
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class Classification:
    event_type_l2: str
    confidence: float
    notes: list[str]


@dataclass(frozen=True)
class EvidenceSpan:
    evidence_ref_id: str
    source_file: str
    scene_id: str
    block_type: str
    block_id: str
    line_start: int
    line_end: int
    snippet: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidence_ref_id": self.evidence_ref_id,
            "source_file": self.source_file,
            "scene_id": self.scene_id,
            "block_type": self.block_type,
            "block_id": self.block_id,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "snippet": self.snippet,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intermediate-dir", type=Path, default=DEFAULT_INTERMEDIATE_DIR)
    parser.add_argument("--derived-dir", type=Path, default=DEFAULT_DERIVED_DIR)
    parser.add_argument("--taxonomy", type=Path, default=DEFAULT_TAXONOMY_PATH)
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


def build_envelope(
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


def normalize_text(text: str) -> str:
    return text.replace("’", "'")


def slugify(text: str) -> str:
    return NON_ALNUM_RE.sub("_", normalize_text(text).lower()).strip("_") or "unknown"


def truncate_snippet(text: str, max_len: int = 220) -> str:
    t = " ".join(text.split())
    if len(t) <= max_len:
        return t
    return t[: max_len - 3].rstrip() + "..."


def token_set(text: str) -> set[str]:
    return {match.group(0).lower() for match in WORD_RE.finditer(normalize_text(text))}


def text_has_any(text: str, needles: Iterable[str]) -> bool:
    lower = normalize_text(text).lower()
    return any(n in lower for n in needles)


def count_chars(text: str, char: str) -> int:
    return text.count(char)


def safe_int(value: Any) -> int | None:
    return value if isinstance(value, int) else None


def as_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def dedupe_participants(participants: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for p in participants:
        entity_id = str(p.get("entity_id", "")).strip()
        role = str(p.get("role", "")).strip()
        if not entity_id or not role:
            continue
        key = (entity_id, role)
        if key in seen:
            continue
        seen.add(key)
        out.append({"entity_id": entity_id, "role": role})
    return out


def build_alias_maps(alias_rows: list[dict[str, Any]]) -> tuple[dict[str, str], dict[str, str]]:
    raw_map: dict[str, str] = {}
    normalized_map: dict[str, str] = {}
    for row in alias_rows:
        if not isinstance(row, dict):
            continue
        alias_raw = as_str(row.get("alias_raw"))
        alias_norm = as_str(row.get("alias_normalized"))
        entity_id = as_str(row.get("entity_id"))
        source = str(row.get("source", ""))
        alias_kind = str(row.get("alias_kind", ""))
        if not alias_raw or not entity_id:
            continue
        if "utterance_cue" in source and alias_kind != "normalized_cue":
            raw_map.setdefault(alias_raw, entity_id)
        if alias_norm and "utterance_cue" in source:
            normalized_map.setdefault(alias_norm, entity_id)
    return raw_map, normalized_map


def normalize_cue_for_lookup(cue_raw: str) -> str:
    text = normalize_text(cue_raw)
    text = re.sub(r"\bV/O\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bPRE-LAP\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bO/S\b|\bO\.S\.\b|\bO/C\b|\bO\.C\.\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.upper()


def build_mention_patterns(entities: list[dict[str, Any]]) -> dict[str, list[tuple[str, re.Pattern[str]]]]:
    patterns: dict[str, list[tuple[str, re.Pattern[str]]]] = defaultdict(list)
    for entity in entities:
        entity_id = as_str(entity.get("entity_id"))
        entity_type = as_str(entity.get("entity_type"))
        canonical_name = as_str(entity.get("canonical_name"))
        aliases = entity.get("aliases") if isinstance(entity.get("aliases"), list) else []
        if not entity_id or entity_type not in {"character", "group", "organization"}:
            continue
        seen_alias_texts: set[str] = set()
        for alias in [canonical_name, *[str(a) for a in aliases if isinstance(a, str)]]:
            if not alias:
                continue
            alias_norm = normalize_text(alias).strip()
            if len(alias_norm) < 2:
                continue
            if alias_norm.upper() in {"PRO", "WHISPERS", "SOMEONE"}:
                continue
            if alias_norm in seen_alias_texts:
                continue
            seen_alias_texts.add(alias_norm)
            # Require non-word boundaries to reduce substring false positives.
            pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(alias_norm)}(?![A-Za-z0-9])", re.IGNORECASE)
            patterns[entity_id].append((alias_norm, pattern))
    return patterns


def find_text_entities(
    text: str,
    *,
    mention_patterns: dict[str, list[tuple[str, re.Pattern[str]]]],
    exclude_entity_ids: set[str] | None = None,
) -> list[str]:
    exclude = exclude_entity_ids or set()
    candidate_matches: list[tuple[int, int, str]] = []
    norm_text = normalize_text(text)
    for entity_id, patterns in mention_patterns.items():
        if entity_id in exclude:
            continue
        best_match: tuple[int, int] | None = None
        for alias, pattern in patterns:
            m = pattern.search(norm_text)
            if m:
                start, end = m.span()
                alias_len = len(alias)
                if best_match is None:
                    best_match = (start, end)
                    continue
                best_start, best_end = best_match
                best_len = best_end - best_start
                if start < best_start or (start == best_start and alias_len > best_len):
                    best_match = (start, end)
        if best_match is not None:
            candidate_matches.append((best_match[0], best_match[1], entity_id))

    # Prefer longer overlapping mentions (e.g., "Bill Bufalino" over "Bufalino")
    # so participants don't double-count ambiguous surname matches.
    candidate_matches.sort(key=lambda item: (item[0], -(item[1] - item[0]), item[2]))

    selected: list[tuple[int, str]] = []
    selected_spans: list[tuple[int, int]] = []
    for start, end, entity_id in candidate_matches:
        overlaps = any(not (end <= s or start >= e) for s, e in selected_spans)
        if overlaps:
            continue
        selected_spans.append((start, end))
        selected.append((start, entity_id))

    selected.sort(key=lambda item: (item[0], item[1]))
    return [entity_id for _, entity_id in selected]


def load_taxonomy(taxonomy_path: Path) -> tuple[dict[str, Any], dict[str, str]]:
    payload = load_json(taxonomy_path)
    if not isinstance(payload, dict):
        raise ValueError(f"{taxonomy_path} must be a JSON object")
    l2_index = payload.get("l2_index")
    if not isinstance(l2_index, dict):
        raise ValueError(f"{taxonomy_path} missing l2_index")
    l2_to_l1: dict[str, str] = {}
    for l2, info in l2_index.items():
        if not isinstance(info, dict):
            continue
        l1 = info.get("event_type_l1")
        if isinstance(l1, str):
            l2_to_l1[str(l2)] = l1
    return payload, l2_to_l1


def classify_utterance(
    *,
    text: str,
    speaker_cue_raw: str,
    delivery_modifiers: list[str],
    scene: dict[str, Any],
    last_question_pending: bool,
    prior_speaker_entity_id: str | None,
    current_speaker_entity_id: str | None,
) -> Classification:
    text_norm = normalize_text(text)
    text_lower = text_norm.lower()
    scene_loc = normalize_text(str(scene.get("location_raw", ""))).lower()
    scene_header = normalize_text(str(scene.get("header_raw", ""))).lower()
    modifiers = set(delivery_modifiers)

    if "pre_lap" in modifiers:
        return Classification("prelap_audio_transition", 0.97, ["delivery_modifier:pre_lap"])
    if "overlap" in modifiers:
        return Classification("overlap_dialogue_transition", 0.96, ["delivery_modifier:overlap"])
    if "voice_over" in modifiers:
        if "assisted living" in scene_loc or "assisted living" in scene_header:
            return Classification("frame_narration_segment", 0.93, ["voiceover_in_frame_scene"])
        return Classification("voiceover_narration", 0.95, ["delivery_modifier:voice_over"])

    cue_upper = normalize_text(speaker_cue_raw).upper()
    if "REPORTER" in cue_upper and "?" in text_norm:
        return Classification("press_qna_exchange", 0.92, ["reporter_cue_question"])
    if text_has_any(text_lower, ["committee", "senator", "press", "reporters"]) and "?" in text_norm:
        return Classification("press_qna_exchange", 0.78, ["press_keywords"])
    phone_scene = text_has_any(scene_loc, ["phone", "telephone"]) or text_has_any(scene_header, ["phone", "telephone"])
    explicit_phone_conversation = bool(re.search(r"^\W*(hello|hold on)\b", text_lower)) or "on the phone" in text_lower
    phone_scene_dialogue = phone_scene and (
        "phone" in text_lower
        or "telephone" in text_lower
        or bool(re.search(r"\b(call me|call him|call her|call back)\b", text_lower))
        or bool(re.search(r"^\W*(hello|hold on)\b", text_lower))
    )
    if explicit_phone_conversation or phone_scene_dialogue:
        return Classification("phone_call_conversation", 0.72, ["phone_keywords"])

    if "?" in text_norm:
        if text_has_any(text_lower, ["what do i owe", "what are the odds", "where are", "why", "how", "who", "when"]):
            return Classification("question", 0.92, ["question_mark+interrogative"])
        return Classification("question", 0.88, ["question_mark"])

    if last_question_pending and current_speaker_entity_id and current_speaker_entity_id != prior_speaker_entity_id:
        if len(text_norm) <= 260:
            return Classification("answer_response", 0.76, ["follows_question_different_speaker"])

    if re.search(r"^\W*(hi|hello|hey|good morning|good evening)\b", text_lower):
        return Classification("greeting_or_opening", 0.83, ["greeting_keyword"])
    if re.search(r"\b(goodbye|bye|see you)\b", text_lower):
        return Classification("farewell_or_closing", 0.83, ["farewell_keyword"])
    if re.search(r"\bthis is\b", text_lower) and re.search(r"\bmeet\b", text_lower):
        return Classification("introduction", 0.78, ["introduce+meet_keywords"])
    if re.search(r"\b(my fault|i'm sorry|sorry)\b", text_lower):
        return Classification("apology_or_regret", 0.86, ["apology_keyword"])
    if re.search(r"\b(vow|i promise|i swear)\b", text_lower):
        return Classification("promise_or_vow", 0.9, ["promise_keyword"])
    if re.search(r"\b(shut up|idiot|stupid|moron|son of a bitch)\b", text_lower):
        return Classification("insult_or_disrespect", 0.85, ["insult_keyword"])
    if re.search(r"\b(kill you|dead|or else|i'll kill|we'll kill)\b", text_lower):
        return Classification("threat_verbal", 0.84, ["threat_keyword"])
    if re.search(r"\b(can you|could you|would you|please|let me|let us|let's)\b", text_lower):
        return Classification("request", 0.78, ["request_phrase"])
    if re.search(r"\b(go|call|tell|take|sit|listen)\b", text_lower) and len(text_norm) < 90:
        # Light heuristic for imperative/ordering speech.
        if text_lower.split()[:1] and text_lower.split()[0] in {"go", "call", "tell", "take", "sit", "listen"}:
            return Classification("instruction_order", 0.72, ["imperative_opening"])
    if re.search(r"\b(don't|do not|be careful|watch out|careful)\b", text_lower):
        return Classification("warning", 0.7, ["warning_keyword"])
    if re.search(r"\b(no|nope|can't|cannot|won't|wouldn't|not gonna)\b", text_lower) and len(text_norm) < 120:
        return Classification("refusal", 0.68, ["refusal_phrase"])
    if re.search(r"\b(okay|ok|all right|fine|sure|yeah)\b", text_lower) and len(text_norm) < 100:
        return Classification("agreement_acceptance", 0.65, ["acceptance_keyword"])
    if re.search(r"\b(cheers|toast)\b", text_lower):
        return Classification("joke_banter_or_toast", 0.76, ["toast_keyword"])
    if re.search(r"\b(why don't you|you gotta|you have to|listen to me)\b", text_lower):
        return Classification("persuasion_attempt", 0.69, ["persuasion_phrase"])
    if re.search(r"\b(deal|terms|price|percent|split)\b", text_lower):
        return Classification("negotiation", 0.66, ["negotiation_keyword"])
    if re.search(r"\b(because|it turns out|the thing was|what happened)\b", text_lower) or len(text_norm) > 220:
        return Classification("explanation_account", 0.74, ["explanatory_phrase_or_length"])
    if re.search(r"\b(i did|i killed|i took|it was me)\b", text_lower):
        return Classification("confession_or_admission", 0.68, ["admission_phrase"])
    if re.search(r"\b(rally|brothers|sisters|ladies and gentlemen)\b", text_lower):
        return Classification("public_speech_or_address", 0.7, ["address_phrase"])

    return Classification("statement", 0.62, ["default_utterance"])


def classify_action(*, text: str, scene: dict[str, Any], markers: list[str]) -> Classification:
    text_norm = normalize_text(text)
    lower = text_norm.lower()
    scene_loc = normalize_text(str(scene.get("location_raw", ""))).lower()
    scene_header = normalize_text(str(scene.get("header_raw", ""))).lower()
    flags = set(scene.get("flags") if isinstance(scene.get("flags"), list) else [])
    shooting_context = bool(
        re.search(r"\b(gunshot|gunshots|shotgun|shooting|shoots|shoot)\b", lower)
        or "shots fired" in lower
        or re.search(r"\bshot\b", lower)
    )

    # Narrative structure first
    if "back to" in lower:
        if "flashback" in flags or "flashback" in scene_header:
            return Classification("flashback_return", 0.96, ["back_to_in_flashback_scene"])
        return Classification("structural_callback_or_rejoin", 0.9, ["back_to_marker"])
    if "flashback" in lower:
        return Classification("flashback_enter", 0.9, ["flashback_keyword_action"])
    if "overlap" in lower:
        return Classification("overlap_dialogue_transition", 0.82, ["overlap_keyword_action"])
    if "pre-lap" in lower:
        return Classification("prelap_audio_transition", 0.82, ["prelap_keyword_action"])

    # Health / end-of-life context
    if text_has_any(lower, ["assisted living", "nursing", "wheelchair", "care facility"]) or text_has_any(scene_loc, ["assisted living"]):
        return Classification("nursing_home_or_assisted_living_interaction", 0.89, ["assisted_living_context"])
    if text_has_any(lower, ["hospital", "doctor", "treatment", "medical"]):
        return Classification("medical_consultation_or_treatment", 0.74, ["medical_keywords"])
    if (
        re.search(r"\b(dies|died|dead|death)\b", lower)
        and not shooting_context
        and "not dead" not in lower
    ):
        return Classification("death_event", 0.72, ["death_keywords"])
    if text_has_any(lower, ["coffin", "grave", "cemetery", "burial", "plot"]):
        return Classification("end_of_life_preparation", 0.7, ["end_of_life_keywords"])

    # Criminal / violence
    if shooting_context:
        return Classification("shooting", 0.92, ["shooting_keywords"])
    if text_has_any(lower, ["kill", "murder", "killed", "homicide"]):
        return Classification("homicide_killing", 0.83, ["killing_keywords"])
    if text_has_any(lower, ["gun", "pistol", "revolver", "rifle", "weapon"]) and not text_has_any(lower, ["shot", "shoot"]):
        return Classification("weapon_display_or_preparation", 0.8, ["weapon_keywords"])
    dance_performance_kick = bool(re.search(r"\bhigh[- ]kick(?:ing|ed|s)?\b", lower)) and (
        "dancer" in lower or "stage" in lower
    )
    if not dance_performance_kick and re.search(r"\b(punch|beat|beating|kick|smash)\b", lower):
        return Classification("assault_or_beating", 0.76, ["assault_keywords"])
    if text_has_any(lower, ["collecting money", "collect money", "collection"]) and text_has_any(lower, ["money", "debt"]):
        return Classification("debt_collection_attempt", 0.8, ["collection_money_keywords"])
    if text_has_any(lower, ["take care of it", "go see him", "job for you", "assignment"]):
        return Classification("criminal_assignment_or_tasking", 0.68, ["tasking_phrase"])
    if text_has_any(lower, ["shylock", "loan"]):
        return Classification("loan_sharking_or_shylock_business", 0.7, ["shylock_keyword"])
    if text_has_any(lower, ["payoff", "pay off", "bribe"]):
        return Classification("bribery_or_payoff", 0.66, ["payoff_keyword"])

    # Legal/law enforcement/incarceration
    if text_has_any(lower, ["fbi", "agent", "questioning", "interrogat", "government"]):
        return Classification("law_enforcement_contact_or_questioning", 0.73, ["law_enforcement_keywords"])
    if text_has_any(lower, ["bug", "wiretap", "surveillance", "phone tap"]):
        return Classification("surveillance_disclosure_or_bugging_discussion", 0.75, ["surveillance_keywords"])
    if text_has_any(lower, ["committee", "hearing"]) or text_has_any(scene_loc, ["hearing", "committee"]):
        return Classification("hearing_or_committee_session", 0.85, ["hearing_keywords"])
    if text_has_any(lower, ["courtroom", "judge", "court"]) or text_has_any(scene_loc, ["courtroom", "court"]):
        return Classification("court_appearance", 0.82, ["court_keywords"])
    if text_has_any(lower, ["testifies", "sworn", "testimony"]):
        return Classification("testimony_or_sworn_statement", 0.8, ["testimony_keywords"])
    if text_has_any(lower, ["indict", "charge", "charged"]):
        return Classification("indictment_or_charge", 0.74, ["charge_keywords"])
    if text_has_any(lower, ["sentence", "sentencing"]):
        return Classification("sentencing", 0.74, ["sentencing_keywords"])
    if text_has_any(lower, ["prison", "penitentiary", "cell", "confinement"]) or text_has_any(scene_loc, ["prison", "penitentiary"]):
        return Classification("prison_confinement_life", 0.82, ["prison_keywords"])
    if text_has_any(lower, ["parole", "released"]) :
        return Classification("release_or_parole", 0.7, ["parole_keywords"])

    # Business/labor/political
    if text_has_any(lower, ["teamster", "union", "local one-o-seven"]) or text_has_any(scene_loc, ["teamsters"]):
        if text_has_any(lower, ["rally", "crowd", "podium"]):
            return Classification("public_event_or_rally", 0.8, ["teamster_rally_keywords"])
        if text_has_any(lower, ["office", "meeting", "headquarters", "hq"]):
            return Classification("union_meeting_or_union_office_interaction", 0.82, ["union_office_keywords"])
        return Classification("union_meeting_or_union_office_interaction", 0.7, ["union_keywords"])
    if text_has_any(lower, ["delivery", "delivers", "loading dock", "carcasses", "unloading", "load", "truck"]):
        if text_has_any(lower, ["load", "unload", "luggage", "trunk"]):
            # luggage/trunk can also be travel logistics; favor travel when non-work context.
            if text_has_any(scene_loc, ["highway", "house", "howard johnson", "lincoln"]):
                return Classification("logistics_loading_unloading", 0.72, ["travel_loading_keywords"])
        if text_has_any(lower, ["carcasses", "store manager", "yard manager", "seal"]):
            return Classification("delivery_or_transport_job", 0.92, ["meat_delivery_keywords"])
        return Classification("work_shift_or_job_task", 0.72, ["work_delivery_keywords"])
    if text_has_any(lower, ["cash", "money handoff", "pays him", "payment"]):
        return Classification("cash_payment_or_side_deal", 0.67, ["cash_keywords"])
    if text_has_any(lower, ["campaign", "fundraiser", "fundraising"]):
        return Classification("campaign_support_or_fundraising", 0.7, ["campaign_keywords"])
    if re.search(r"\b(strategy|plan|leaders)\b", lower):
        return Classification("leadership_strategy_session", 0.62, ["strategy_keywords"])

    # Movement/travel/logistics
    if text_has_any(lower, ["engine starts making noises", "misfiring", "timing chain", "broke down", "breakdown"]):
        return Classification("vehicle_issue_or_breakdown", 0.92, ["engine_issue_keywords"])
    if text_has_any(lower, ["wrench", "fix", "adjustment", "repair", "maintenance"]) and text_has_any(lower, ["engine", "hood", "truck", "car"]):
        return Classification("vehicle_repair_or_maintenance", 0.92, ["vehicle_repair_keywords"])
    if text_has_any(lower, ["luggage", "trunk", "garment bag", "loading", "unloading"]) and not text_has_any(lower, ["carcasses"]):
        return Classification("logistics_loading_unloading", 0.86, ["travel_loading_keywords"])
    if text_has_any(lower, ["gas station", "guard rail", "stop", "stuckey", "texaco"]) and (
        text_has_any(lower, ["smoking", "smoke", "stop", "guard rail"]) or text_has_any(scene_loc, ["highway", "i-80"])
    ):
        return Classification("travel_stopover", 0.86, ["stopover_keywords"])
    if text_has_any(lower, ["howard johnson", "hotel", "motel", "check in", "suite"]) or text_has_any(scene_loc, ["hotel", "howard johnson"]):
        return Classification("lodging_checkin_or_stay", 0.8, ["lodging_keywords"])
    if text_has_any(lower, ["airport", "airstrip", "landing strip", "flight", "plane"]) or text_has_any(
        scene_loc, ["airstrip", "airport"]
    ):
        return Classification("air_travel_or_flight", 0.82, ["air_travel_keywords"])
    if text_has_any(lower, ["walk", "walking", "approach", "hallway", "moving along", "drift into"]) and not text_has_any(lower, ["watch", "watches"]):
        return Classification("walking_approach_or_tail", 0.66, ["walking_approach_keywords"])
    if text_has_any(lower, ["drives", "driving", "drive", "car", "truck", "highway", "road", "lincoln"]):
        if text_has_any(scene_loc, ["highway", "i-80", "howard johnson"]) or text_has_any(lower, ["detroit", "road trip"]):
            return Classification("road_trip_segment", 0.78, ["road_trip_context"])
        return Classification("drive_or_vehicle_travel", 0.76, ["vehicle_travel_keywords"])
    if text_has_any(lower, ["arrives", "arrival", "comes in", "approach a particular man"]):
        return Classification("arrival", 0.62, ["arrival_keyword"])
    if text_has_any(lower, ["leaves", "heads off", "departure"]):
        return Classification("departure", 0.62, ["departure_keyword"])

    # Domestic / ritual / leisure
    if text_has_any(lower, ["wedding", "invitation", "bride", "married"]) or text_has_any(scene_loc, ["wedding"]):
        return Classification("wedding_related_event", 0.88, ["wedding_keywords"])
    if text_has_any(lower, ["baptism", "church", "priest"]) or text_has_any(scene_loc, ["church"]):
        return Classification("religious_ritual", 0.84, ["religious_keywords"])
    if text_has_any(lower, ["smoke", "cigarette", "smoking"]) :
        return Classification("smoking_break_or_smoking_conflict", 0.84, ["smoking_keywords"])
    if text_has_any(lower, ["bar", "drink", "bartender", "toasts"]) or text_has_any(scene_loc, ["lounge", "casino", "copa", "bar"]):
        return Classification("bar_or_social_drinking", 0.74, ["bar_drinking_keywords"])
    if text_has_any(lower, ["eat", "eating", "dinner", "meal", "restaurant"]) :
        return Classification("meal_or_dining", 0.72, ["meal_keywords"])
    if text_has_any(lower, ["house", "kitchen", "bureau", "home"]) :
        return Classification("domestic_routine", 0.62, ["domestic_keywords"])

    # Social relationship
    if text_has_any(lower, ["doesn't know yet", "first meets", "appears out of nowhere"]):
        return Classification("first_meeting", 0.8, ["first_meeting_phrase"])
    if text_has_any(lower, ["private ceremony", "daughter", "wife", "family"]) :
        return Classification("family_interaction", 0.64, ["family_keywords"])
    if text_has_any(lower, ["ignores", "no attention", "avoid", "distancing", "silent treatment"]) :
        return Classification("estrangement_or_distance_behavior", 0.66, ["distance_keywords"])
    if text_has_any(lower, ["hug", "comfort", "care", "protect"]) :
        return Classification("affection_or_care_signal", 0.64, ["care_keywords"])
    if text_has_any(lower, ["nod", "respect", "deference", "obeys"]) :
        return Classification("deference_signal", 0.6, ["deference_keywords"])

    # Perception / surveillance
    if text_has_any(lower, ["watches", "watching", "looking", "looks", "glances", "stares", "sees", "we see", "regard"]) :
        return Classification("observation_or_witnessing", 0.72, ["observation_keywords"])
    if text_has_any(lower, ["realizes", "it turns out", "recognizes"]):
        return Classification("recognition_or_realization", 0.72, ["realization_keywords"])
    if text_has_any(lower, ["suspicious", "distrust", "suspects"]):
        return Classification("suspicion_or_distrust_expression", 0.7, ["suspicion_keywords"])
    if text_has_any(lower, ["follow", "tailing", "tails"]):
        return Classification("following_or_tail_surveillance", 0.75, ["tailing_keywords"])
    if text_has_any(lower, ["waits", "waiting", "watch"]):
        return Classification("stakeout_or_waiting_watch", 0.62, ["waiting_watch_keywords"])
    if text_has_any(lower, ["coded", "don't say names", "secret", "secrecy"]):
        return Classification("privacy_or_secrecy_behavior", 0.62, ["secrecy_keywords"])
    if text_has_any(lower, ["message", "tells him", "relay", "signal"]):
        return Classification("signal_or_message_delivery", 0.58, ["message_keywords"])
    if text_has_any(lower, ["tv", "news", "headline", "anchor"]):
        return Classification("news_media_awareness_update", 0.68, ["news_keywords"])

    # Generic fallbacks
    if text_has_any(lower, ["work", "shift", "job", "task"]):
        return Classification("work_shift_or_job_task", 0.5, ["generic_work_fallback"])
    return Classification("observation_or_witnessing", 0.48, ["default_action_fallback"])


def infer_action_roles(event_type_l1: str, event_type_l2: str, action_text: str) -> tuple[str, str | None]:
    # Action text often contains multiple named entities and role keywords that don't align
    # with mention order (e.g., "addresses the judge"). Use conservative generic roles.
    _ = (event_type_l1, event_type_l2, action_text)
    return "participant", None


def make_event_summary(
    *,
    event_type_l2: str,
    scene: dict[str, Any],
    block_type: str,
    text: str,
    speaker_cue_raw: str | None = None,
) -> str:
    prefix = event_type_l2.replace("_", " ")
    location = str(scene.get("location_raw", "")).strip()
    if block_type == "utterance" and speaker_cue_raw:
        content = truncate_snippet(text, 150)
        return f"{speaker_cue_raw}: {content} ({prefix})"
    content = truncate_snippet(text, 160)
    if location:
        return f"{prefix} in {location}: {content}"
    return f"{prefix}: {content}"


def main() -> int:
    args = parse_args()
    intermediate_dir = args.intermediate_dir.resolve()
    derived_dir = args.derived_dir.resolve()
    taxonomy_path = args.taxonomy.resolve()

    required_paths = [
        intermediate_dir / "scenes.json",
        intermediate_dir / "utterances.json",
        intermediate_dir / "action_beats.json",
        intermediate_dir / "script_blocks.json",
        derived_dir / "entities.json",
        derived_dir / "entity_aliases.json",
        taxonomy_path,
    ]
    for path in required_paths:
        if not path.is_file():
            print(f"error: missing required file: {path}")
            return 2

    scenes_meta, scenes = load_envelope(intermediate_dir / "scenes.json")
    _utter_meta, utterances = load_envelope(intermediate_dir / "utterances.json")
    _act_meta, action_beats = load_envelope(intermediate_dir / "action_beats.json")
    _blocks_meta, script_blocks = load_envelope(intermediate_dir / "script_blocks.json")
    entities_meta, entities = load_envelope(derived_dir / "entities.json")
    _aliases_meta, alias_rows = load_envelope(derived_dir / "entity_aliases.json")
    taxonomy_payload, l2_to_l1 = load_taxonomy(taxonomy_path)

    source_file_hash = str(scenes_meta.get("source_file_hash") or entities_meta.get("source_file_hash") or "")
    if not source_file_hash:
        source_file_hash = sha256_hex((intermediate_dir / "script_blocks.json").read_bytes())
    source_file = str(scenes_meta.get("source_file") or "the-irishman-ampas-script-cleaned.md")
    build_timestamp = utc_now_iso()

    scene_by_id = {str(scene["scene_id"]): scene for scene in scenes if isinstance(scene, dict) and isinstance(scene.get("scene_id"), str)}
    scenes_sorted = sorted(scene_by_id.values(), key=lambda s: (int(s.get("scene_index", 0)), str(s.get("scene_id"))))
    utterance_by_id = {str(u["utterance_id"]): u for u in utterances if isinstance(u, dict) and isinstance(u.get("utterance_id"), str)}
    action_by_id = {str(a["action_id"]): a for a in action_beats if isinstance(a, dict) and isinstance(a.get("action_id"), str)}

    blocks_by_scene: dict[str, list[dict[str, Any]]] = defaultdict(list)
    scene_header_block_by_scene: dict[str, dict[str, Any]] = {}
    for block in script_blocks:
        if not isinstance(block, dict):
            continue
        scene_id = as_str(block.get("scene_id"))
        if not scene_id:
            continue
        blocks_by_scene[scene_id].append(block)
        if block.get("block_type") == "scene_header":
            scene_header_block_by_scene.setdefault(scene_id, block)
    for scene_id, blocks in blocks_by_scene.items():
        blocks.sort(key=lambda b: (int(b.get("sequence_in_scene", 0)), int(b.get("line_start", 0)), str(b.get("block_id", ""))))

    raw_cue_to_entity, normalized_cue_to_entity = build_alias_maps(alias_rows)
    entity_by_id = {str(e["entity_id"]): e for e in entities if isinstance(e, dict) and isinstance(e.get("entity_id"), str)}
    mention_patterns = build_mention_patterns(entities)

    # Scene speaker roster for weak listener inference/context.
    scene_speaker_entities: dict[str, set[str]] = defaultdict(set)
    for utt in utterances:
        if not isinstance(utt, dict):
            continue
        scene_id = as_str(utt.get("scene_id"))
        cue_raw = as_str(utt.get("speaker_cue_raw"))
        if not scene_id or not cue_raw:
            continue
        speaker_entity_id = raw_cue_to_entity.get(cue_raw) or normalized_cue_to_entity.get(normalize_cue_for_lookup(cue_raw))
        if speaker_entity_id:
            scene_speaker_entities[scene_id].add(speaker_entity_id)

    events: list[dict[str, Any]] = []
    event_participants: list[dict[str, Any]] = []
    scene_index_items: list[dict[str, Any]] = []

    event_counter = 0
    participant_counter = 0
    evidence_counter = 0
    event_type_l1_counts: Counter[str] = Counter()
    event_type_l2_counts: Counter[str] = Counter()

    def next_event_id() -> str:
        nonlocal event_counter
        event_counter += 1
        return f"evt_{event_counter:06d}"

    def next_participant_id() -> str:
        nonlocal participant_counter
        participant_counter += 1
        return f"ep_{participant_counter:06d}"

    def next_evidence_id() -> str:
        nonlocal evidence_counter
        evidence_counter += 1
        return f"evref_{evidence_counter:06d}"

    def make_evidence_for_block(
        *,
        scene_id: str,
        block_type: str,
        block_id: str,
        line_start: int,
        line_end: int,
        text: str,
    ) -> EvidenceSpan:
        return EvidenceSpan(
            evidence_ref_id=next_evidence_id(),
            source_file=source_file,
            scene_id=scene_id,
            block_type=block_type,
            block_id=block_id,
            line_start=line_start,
            line_end=line_end,
            snippet=truncate_snippet(text),
        )

    def ensure_taxonomy_l2(l2: str) -> str:
        if l2 in l2_to_l1:
            return l2
        return "unmapped_review_required"

    for scene in scenes_sorted:
        scene_id = str(scene["scene_id"])
        scene_blocks = blocks_by_scene.get(scene_id, [])
        scene_header_block = scene_header_block_by_scene.get(scene_id)
        scene_location_entity_id = as_str(scene.get("location_canonical_id"))
        if scene_location_entity_id and scene_location_entity_id not in entity_by_id:
            scene_location_entity_id = None

        scene_events: list[dict[str, Any]] = []
        scene_event_ids: list[str] = []
        scene_evidence_refs: list[str] = []
        scene_participant_entities: set[str] = set()
        scene_l1_counts: Counter[str] = Counter()
        scene_l2_counts: Counter[str] = Counter()
        sequence_in_scene = 0

        def append_event(
            *,
            l2: str,
            confidence: float,
            notes: list[str],
            summary: str,
            participants: list[dict[str, Any]],
            block_type: str,
            block_id: str,
            line_start: int,
            line_end: int,
            evidence_text: str,
            extraction_method: str = "rule",
            source_block_ref: dict[str, Any] | None = None,
        ) -> None:
            nonlocal sequence_in_scene
            sequence_in_scene += 1
            l2_safe = ensure_taxonomy_l2(l2)
            l1 = l2_to_l1.get(l2_safe, "other_review_required")
            evidence = make_evidence_for_block(
                scene_id=scene_id,
                block_type=block_type,
                block_id=block_id,
                line_start=line_start,
                line_end=line_end,
                text=evidence_text,
            )
            participants_local = list(participants)
            if scene_location_entity_id:
                participants_local.append({"entity_id": scene_location_entity_id, "role": "location"})
            participants_deduped = dedupe_participants(participants_local)

            event_id = next_event_id()
            event = {
                "event_id": event_id,
                "scene_id": scene_id,
                "event_type_l1": l1,
                "event_type_l2": l2_safe,
                "summary": summary,
                "participants": participants_deduped,
                "evidence_refs": [evidence.evidence_ref_id],
                "sequence_in_scene": sequence_in_scene,
                "confidence": round(float(confidence), 3),
                "extraction_method": extraction_method,
                "metadata": {
                    "source_block_type": block_type,
                    "source_block_id": block_id,
                    "line_start": line_start,
                    "line_end": line_end,
                    "evidence_spans": [evidence.to_dict()],
                    "classification_notes": notes,
                },
            }
            if source_block_ref:
                event["metadata"]["source_block_ref"] = source_block_ref
            events.append(event)
            scene_events.append(event)
            scene_event_ids.append(event_id)
            scene_evidence_refs.append(evidence.evidence_ref_id)
            event_type_l1_counts[l1] += 1
            event_type_l2_counts[l2_safe] += 1
            scene_l1_counts[l1] += 1
            scene_l2_counts[l2_safe] += 1

            for idx, participant in enumerate(participants_deduped, start=1):
                participant_entity_id = participant["entity_id"]
                scene_participant_entities.add(participant_entity_id)
                event_participants.append(
                    {
                        "event_participant_id": next_participant_id(),
                        "event_id": event_id,
                        "scene_id": scene_id,
                        "entity_id": participant_entity_id,
                        "role": participant["role"],
                        "participant_index": idx,
                        "evidence_refs": [evidence.evidence_ref_id],
                        "confidence": round(float(confidence), 3),
                        "extraction_method": extraction_method,
                    }
                )

        # Synthetic scene entry / structure events, anchored on scene header when present.
        header_line_start = safe_int(scene.get("line_start")) or 0
        header_line_end = safe_int(scene.get("line_start")) or (safe_int(scene.get("line_end")) or 0)
        if scene_header_block:
            header_line_start = int(scene_header_block.get("line_start", header_line_start))
            header_line_end = int(scene_header_block.get("line_end", header_line_end))
        header_text = as_str(scene.get("header_raw")) or as_str(scene_header_block.get("text") if scene_header_block else None) or "SCENE"
        header_block_id = as_str(scene_header_block.get("block_id") if scene_header_block else None) or scene_id
        header_block_type = "scene_header" if scene_header_block else "scene"

        append_event(
            l2="scene_entry",
            confidence=1.0,
            notes=["synthetic_scene_boundary_start"],
            summary=f"Scene entry: {header_text}",
            participants=[],
            block_type=header_block_type,
            block_id=header_block_id,
            line_start=header_line_start,
            line_end=header_line_end,
            evidence_text=header_text,
            source_block_ref={"synthetic": True, "kind": "scene_entry"},
        )

        year_explicit = safe_int(scene.get("year_explicit"))
        if year_explicit is not None:
            append_event(
                l2="time_jump_explicit",
                confidence=0.98,
                notes=["scene_header_year_explicit"],
                summary=f"Explicit time marker in scene header: {year_explicit}",
                participants=[],
                block_type=header_block_type,
                block_id=header_block_id,
                line_start=header_line_start,
                line_end=header_line_end,
                evidence_text=header_text,
                source_block_ref={"synthetic": True, "kind": "time_jump_explicit"},
            )

        scene_flags = scene.get("flags") if isinstance(scene.get("flags"), list) else []
        if any(str(flag) == "flashback" for flag in scene_flags):
            append_event(
                l2="flashback_enter",
                confidence=0.97,
                notes=["scene_flag_flashback"],
                summary="Flashback scene begins",
                participants=[],
                block_type=header_block_type,
                block_id=header_block_id,
                line_start=header_line_start,
                line_end=header_line_end,
                evidence_text=header_text,
                source_block_ref={"synthetic": True, "kind": "flashback_enter"},
            )

        last_question_pending = False
        prior_speaker_entity_id: str | None = None

        for block in scene_blocks:
            block_type = as_str(block.get("block_type")) or "unknown"
            if block_type == "scene_header":
                continue

            block_id = as_str(block.get("block_id")) or f"blk_missing_{scene_id}"
            line_start = int(block.get("line_start", scene.get("line_start", 0)) or 0)
            line_end = int(block.get("line_end", line_start) or line_start)
            text = as_str(block.get("text")) or ""
            markers = [str(m) for m in (block.get("markers") or []) if isinstance(m, str)]

            if block_type == "utterance":
                utterance_id = as_str(block.get("utterance_id")) or ""
                utter = utterance_by_id.get(utterance_id, {})
                speaker_cue_raw = as_str(block.get("speaker_cue_raw")) or as_str(utter.get("speaker_cue_raw")) or "UNKNOWN"
                delivery_modifiers = [str(m) for m in (utter.get("delivery_modifiers") or []) if isinstance(m, str)]
                current_speaker_entity_id = raw_cue_to_entity.get(speaker_cue_raw) or normalized_cue_to_entity.get(
                    normalize_cue_for_lookup(speaker_cue_raw)
                )
                cls = classify_utterance(
                    text=text,
                    speaker_cue_raw=speaker_cue_raw,
                    delivery_modifiers=delivery_modifiers,
                    scene=scene,
                    last_question_pending=last_question_pending,
                    prior_speaker_entity_id=prior_speaker_entity_id,
                    current_speaker_entity_id=current_speaker_entity_id,
                )
                participants: list[dict[str, Any]] = []
                if current_speaker_entity_id:
                    participants.append({"entity_id": current_speaker_entity_id, "role": "speaker"})
                mentioned_entities = find_text_entities(
                    text,
                    mention_patterns=mention_patterns,
                    exclude_entity_ids={current_speaker_entity_id} if current_speaker_entity_id else set(),
                )
                if mentioned_entities:
                    primary_role = "mentioned"
                    if cls.event_type_l2 in {
                        "question",
                        "request",
                        "instruction_order",
                        "warning",
                        "threat_verbal",
                        "persuasion_attempt",
                    }:
                        primary_role = "target"
                    if cls.event_type_l2 == "signal_or_message_delivery":
                        primary_role = "messenger"
                    for idx, entity_id in enumerate(mentioned_entities[:3]):
                        participants.append({"entity_id": entity_id, "role": primary_role if idx == 0 else "mentioned"})
                # Very weak listener inference from scene roster for non-voiceover dialogue.
                if cls.event_type_l2 not in {"voiceover_narration", "frame_narration_segment"} and current_speaker_entity_id:
                    existing_participant_ids = {
                        str(p.get("entity_id"))
                        for p in participants
                        if isinstance(p, dict) and isinstance(p.get("entity_id"), str)
                    }
                    others = [e for e in sorted(scene_speaker_entities.get(scene_id, set())) if e != current_speaker_entity_id]
                    for listener_entity_id in others[:2]:
                        if listener_entity_id in existing_participant_ids:
                            continue
                        participants.append({"entity_id": listener_entity_id, "role": "listener"})
                        existing_participant_ids.add(listener_entity_id)

                append_event(
                    l2=cls.event_type_l2,
                    confidence=cls.confidence,
                    notes=cls.notes + [f"markers:{','.join(markers) if markers else 'none'}"],
                    summary=make_event_summary(
                        event_type_l2=cls.event_type_l2,
                        scene=scene,
                        block_type="utterance",
                        text=text,
                        speaker_cue_raw=speaker_cue_raw,
                    ),
                    participants=participants,
                    block_type="utterance",
                    block_id=utterance_id or block_id,
                    line_start=line_start,
                    line_end=line_end,
                    evidence_text=f"{speaker_cue_raw}: {text}",
                    source_block_ref={
                        "block_id": block_id,
                        "utterance_id": utterance_id or None,
                        "speaker_cue_raw": speaker_cue_raw,
                        "delivery_modifiers": delivery_modifiers,
                        "markers": markers,
                    },
                )

                last_question_pending = cls.event_type_l2 == "question"
                prior_speaker_entity_id = current_speaker_entity_id
                continue

            if block_type == "action":
                action_id = as_str(block.get("action_id")) or ""
                cls = classify_action(text=text, scene=scene, markers=markers)
                action_mentions = find_text_entities(text, mention_patterns=mention_patterns)
                role_primary, _ = infer_action_roles(l2_to_l1.get(ensure_taxonomy_l2(cls.event_type_l2), "other_review_required"), cls.event_type_l2, text)
                participants = []
                for idx, entity_id in enumerate(action_mentions[:4]):
                    participants.append({"entity_id": entity_id, "role": role_primary if idx == 0 else "participant"})

                append_event(
                    l2=cls.event_type_l2,
                    confidence=cls.confidence,
                    notes=cls.notes + [f"markers:{','.join(markers) if markers else 'none'}"],
                    summary=make_event_summary(
                        event_type_l2=cls.event_type_l2,
                        scene=scene,
                        block_type="action",
                        text=text,
                    ),
                    participants=participants,
                    block_type="action",
                    block_id=action_id or block_id,
                    line_start=line_start,
                    line_end=line_end,
                    evidence_text=text,
                    source_block_ref={"block_id": block_id, "action_id": action_id or None, "markers": markers},
                )
                last_question_pending = False
                continue

        # Synthetic scene exit anchored on last scene line.
        append_event(
            l2="scene_exit",
            confidence=1.0,
            notes=["synthetic_scene_boundary_end"],
            summary=f"Scene exit: {header_text}",
            participants=[],
            block_type="scene",
            block_id=scene_id,
            line_start=int(scene.get("line_end", header_line_end) or header_line_end),
            line_end=int(scene.get("line_end", header_line_end) or header_line_end),
            evidence_text=header_text,
            source_block_ref={"synthetic": True, "kind": "scene_exit"},
        )

        # Scene index record
        scene_index_items.append(
            {
                "scene_id": scene_id,
                "scene_index": int(scene.get("scene_index", 0) or 0),
                "header_raw": scene.get("header_raw"),
                "header_prefix": scene.get("header_prefix"),
                "location_raw": scene.get("location_raw"),
                "location_canonical_id": scene.get("location_canonical_id"),
                "time_of_day": scene.get("time_of_day"),
                "year_explicit": scene.get("year_explicit"),
                "year_inferred": scene.get("year_inferred"),
                "flags": scene.get("flags") if isinstance(scene.get("flags"), list) else [],
                "line_start": scene.get("line_start"),
                "line_end": scene.get("line_end"),
                "event_ids": scene_event_ids,
                "event_count": len(scene_event_ids),
                "event_type_l1_counts": dict(scene_l1_counts),
                "event_type_l2_counts": dict(scene_l2_counts),
                "participant_entity_ids": sorted(scene_participant_entities),
                "evidence_refs": scene_evidence_refs,
                "event_refs": [
                    {
                        "event_id": ev["event_id"],
                        "event_type_l1": ev["event_type_l1"],
                        "event_type_l2": ev["event_type_l2"],
                        "sequence_in_scene": ev["sequence_in_scene"],
                        "summary": ev["summary"],
                        "evidence_refs": ev["evidence_refs"],
                    }
                    for ev in scene_events
                ],
            }
        )

    # Flatten event participants are already generated in event order.
    # Derive a companion scene lookup for event debug UI and later query routing.

    events_envelope = build_envelope(
        artifact_type="events",
        schema_version=EVENT_SCHEMA_VERSION,
        pipeline_version=EXTRACTOR_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_file_hash,
        items=events,
        extra_metadata={
            "event_type_l1_counts": dict(event_type_l1_counts),
            "event_type_l2_counts": dict(event_type_l2_counts),
            "taxonomy_file": str(taxonomy_path.relative_to(REPO_ROOT)) if taxonomy_path.is_relative_to(REPO_ROOT) else str(taxonomy_path),
            "taxonomy_l2_count": len(l2_to_l1),
            "source_artifacts": [
                "data/intermediate/scenes.json",
                "data/intermediate/utterances.json",
                "data/intermediate/action_beats.json",
                "data/intermediate/script_blocks.json",
                "data/derived/entities.json",
                "data/derived/entity_aliases.json",
            ],
        },
    )
    participants_envelope = build_envelope(
        artifact_type="event_participants",
        schema_version=EVENT_SCHEMA_VERSION,
        pipeline_version=EXTRACTOR_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_file_hash,
        items=event_participants,
        extra_metadata={
            "source_artifact": "data/derived/events.json",
        },
    )
    scene_index_envelope = build_envelope(
        artifact_type="scene_index",
        schema_version=EVENT_SCHEMA_VERSION,
        pipeline_version=EXTRACTOR_VERSION,
        build_timestamp=build_timestamp,
        source_file_hash=source_file_hash,
        items=sorted(scene_index_items, key=lambda s: (int(s.get("scene_index", 0)), str(s.get("scene_id")))),
        extra_metadata={
            "source_artifacts": ["data/intermediate/scenes.json", "data/derived/events.json"],
            "scene_count": len(scene_index_items),
        },
    )

    write_json(derived_dir / "events.json", events_envelope, args.indent)
    write_json(derived_dir / "event_participants.json", participants_envelope, args.indent)
    write_json(derived_dir / "scene_index.json", scene_index_envelope, args.indent)

    print(f"Wrote event artifacts to {derived_dir}")
    print(f"Events: {len(events)}")
    print(f"Event participants: {len(event_participants)}")
    print(f"Scenes indexed: {len(scene_index_items)}")
    print("L1 coverage:")
    for l1, count in sorted(event_type_l1_counts.items()):
        print(f"  - {l1}: {count}")
    print("Top L2 event types:")
    for l2, count in event_type_l2_counts.most_common(15):
        print(f"  - {l2}: {count}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
