#!/usr/bin/env python3
"""Clean the extracted Irishman screenplay markdown for easier parsing.

Input format is the page-by-page markdown produced from PDF extraction.
Output is a normalized markdown file with a single cleaned script block.

This is a heuristic cleaner (not a full screenplay parser). It focuses on:
- page number artifacts merged into lines
- "(MORE)" continuation markers
- line wraps from PDF extraction
- merged cue/page-break collisions (best-effort)
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
INPUT_MD = ROOT / "the-irishman-ampas-script-extracted.md"
OUTPUT_MD = ROOT / "the-irishman-ampas-script-cleaned.md"


PAGE_HEADER_RE = re.compile(r"^## Page (\d+)\s*$")
UPPERISH_RE = re.compile(r"^[A-Z0-9 .,'’/()&:;?!-]+$")

SCENE_PREFIXES = (
    "INT.",
    "EXT.",
    "INT./EXT.",
    "EXT./INT.",
    "INT/EXT.",
    "EXT/INT.",
)

SCENE_LIKE_PREFIXES = (
    "BACK TO ",
    "INTERCUT",
    "MONTAGE",
    "SERIES OF SHOTS",
    "INSERT",
    "ANGLE",
    "CLOSE ON",
    "WIDER",
    "OMITTED",
)

TRANSITIONS = {
    "CUT TO:",
    "SMASH CUT TO:",
    "DISSOLVE TO:",
    "MATCH CUT TO:",
    "FADE IN:",
    "FADE OUT:",
}

SCENE_PREFIX_ONLY = {
    "INT.",
    "EXT.",
    "INT/EXT.",
    "EXT/INT.",
    "INT./EXT.",
    "EXT./INT.",
}


def parse_pages(md_text: str) -> list[tuple[int, list[str]]]:
    pages: list[tuple[int, list[str]]] = []
    lines = md_text.splitlines()
    i = 0
    while i < len(lines):
        m = PAGE_HEADER_RE.match(lines[i])
        if not m:
            i += 1
            continue
        page_num = int(m.group(1))
        i += 1
        # Skip blank lines
        while i < len(lines) and lines[i].strip() == "":
            i += 1
        if i >= len(lines) or lines[i].strip() != "```text":
            raise ValueError(f"Expected ```text after page heading {page_num}")
        i += 1
        block: list[str] = []
        while i < len(lines) and lines[i].strip() != "```":
            block.append(lines[i])
            i += 1
        if i >= len(lines):
            raise ValueError(f"Unterminated code block for page {page_num}")
        # Skip closing fence
        i += 1
        pages.append((page_num, block))
    if not pages:
        raise ValueError("No pages found in extracted markdown")
    return pages


def is_scene_heading(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if s.startswith(SCENE_PREFIXES):
        return True
    return any(s.startswith(prefix) for prefix in SCENE_LIKE_PREFIXES)


def is_transition(line: str) -> bool:
    s = line.strip()
    if s in TRANSITIONS:
        return True
    if s.endswith(":") and UPPERISH_RE.fullmatch(s) and len(s) <= 40:
        return True
    return False


def is_character_cue(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if is_scene_heading(s) or is_transition(s):
        return False
    if len(s) > 45:
        return False
    if not UPPERISH_RE.fullmatch(s):
        return False
    if not any(ch.isalpha() for ch in s):
        return False
    # Exclude obvious title-page formatting like "T H E   I R I S H M A N".
    if "  " in s and s.replace(" ", "").isalpha() and len(s.split()) > 4:
        return False
    words = s.split()
    # Character cues are usually short and not all generic stage directions.
    if len(words) > 6 and "(CONT'D)" not in s and "V/O" not in s and "O.S." not in s:
        return False
    return True


def is_parenthetical(line: str) -> bool:
    s = line.strip()
    return bool(s) and s.startswith("(") and s.endswith(")") and len(s) <= 60


def looks_scene_continuation(line: str) -> bool:
    s = line.strip()
    if not s or len(s) < 8:
        return False
    if " - " not in s:
        return False
    # This line is usually all caps and punctuation when the scene heading is split after "INT."/"EXT."
    if not UPPERISH_RE.fullmatch(s):
        return False
    return True


def maybe_split_merged_cue(line: str) -> list[str]:
    """Split lines where page break artifacts merged dialogue/text with a cue."""
    s = line.strip()
    if not s:
        return [""]

    # cue + page-number + continuation text (e.g., "FRANK V/O (CONT'D) 3Business...")
    m = re.match(r"^(.+?)\s+\d{1,3}([A-Z].*)$", s)
    if m:
        left, right = m.group(1).strip(), m.group(2).strip()
        if is_character_cue(left):
            return [left, right]

    # sentence immediately followed by cue + optional page number at end
    m = re.match(r"^(.+?[.!?…])\s*([A-Z][A-Z0-9 .,'’/()&-]{1,60}?)(?:\s+\d{1,3})?$", s)
    if m:
        left, right = m.group(1).strip(), m.group(2).strip()
        if is_character_cue(right):
            return [left, right]

    # sentence + 2 spaces + cue + page number (common extraction artifact)
    m = re.match(r"^(.+?)\s{2,}([A-Z][A-Z0-9 .,'’/()&-]{1,60})\s+\d{1,3}$", s)
    if m:
        left, right = m.group(1).strip(), m.group(2).strip()
        if is_character_cue(right):
            return [left, right]

    return [s]


def clean_line_basic(line: str, page_num: int) -> list[str]:
    s = line.rstrip()
    if not s.strip():
        return [""]
    s = s.strip()

    # Drop pure continuation markers.
    if re.fullmatch(r"\(MORE\)\s*\d*", s):
        return []
    if re.fullmatch(r"\d{1,3}", s):
        return []

    # Remove explicit "(MORE)" prefix if it was glued to content.
    s = re.sub(r"^\(MORE\)\s*", "", s)

    # Remove leading page-number artifacts glued to content, e.g. "10FRANK", "7INT."
    s = re.sub(r"^\d{1,3}(?=[A-Z(])", "", s)

    # Split common cue collision patterns before stripping trailing page numbers.
    parts = maybe_split_merged_cue(s)
    out: list[str] = []
    for part in parts:
        t = part.strip()
        if not t:
            continue

        # Remove trailing page number artifact when appended to a longer line.
        if len(t) > 18:
            t = re.sub(r"\s{2,}\d{1,3}$", "", t)
            t = re.sub(rf"\s+{page_num}\s*$", "", t)
            # Sometimes the footer carries the previous page number.
            if page_num > 1:
                t = re.sub(rf"\s+{page_num - 1}\s*$", "", t)

        # "FRANK V/O (CONT'D) 3" -> "FRANK V/O (CONT'D)"
        if is_character_cue(re.sub(r"\s+\d{1,3}$", "", t)):
            t = re.sub(r"\s+\d{1,3}$", "", t)

        # Second chance split after trimming.
        split_again = maybe_split_merged_cue(t)
        for piece in split_again:
            piece = piece.strip()
            if not piece:
                continue
            out.append(piece)

    return out


def clean_pages_to_lines(pages: list[tuple[int, list[str]]]) -> list[str]:
    cleaned: list[str] = []
    for page_num, raw_lines in pages:
        for raw in raw_lines:
            parts = clean_line_basic(raw, page_num)
            cleaned.extend(parts)
    # Collapse excessive blanks
    normalized: list[str] = []
    blank_run = 0
    for line in cleaned:
        if not line.strip():
            blank_run += 1
            if blank_run <= 1:
                normalized.append("")
        else:
            blank_run = 0
            normalized.append(line.strip())
    return normalized


def join_wrapped_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    block_parts: list[str] = []
    block_mode: str | None = None  # "dialogue" | "action"
    dialogue_context = False

    def flush_block() -> None:
        nonlocal block_parts, block_mode
        if not block_parts:
            return
        text = block_parts[0]
        for nxt in block_parts[1:]:
            if text.endswith("-") and not text.endswith(" -") and nxt and nxt[0].islower():
                text += nxt
            else:
                text += " " + nxt
        out.append(text)
        block_parts = []
        block_mode = None

    def append_blank() -> None:
        if out and out[-1] != "":
            out.append("")

    for line in lines:
        s = line.strip()
        if not s:
            flush_block()
            append_blank()
            dialogue_context = False
            continue

        if is_scene_heading(s) or is_transition(s):
            flush_block()
            append_blank()
            out.append(s)
            dialogue_context = False
            continue

        if is_character_cue(s):
            flush_block()
            append_blank()
            out.append(s)
            dialogue_context = True
            continue

        if is_parenthetical(s):
            flush_block()
            out.append(s)
            # Parenthetical commonly sits within dialogue after a cue.
            continue

        mode = "dialogue" if dialogue_context else "action"

        # If a dialogue block has already started and the next line looks like an
        # action beat (often introduced after a page break), switch to action.
        if (
            mode == "dialogue"
            and block_parts
            and re.match(r"^[A-Z][A-Z'’.-]+(?: [A-Z][A-Z'’.-]+){1,4}\b.*[a-z]", s)
        ):
            flush_block()
            block_mode = None
            dialogue_context = False
            mode = "action"

        if block_mode and block_mode != mode:
            flush_block()
        block_mode = mode
        block_parts.append(s)

        # Once dialogue text starts, keep collecting dialogue until structural boundary.
        if mode == "action":
            dialogue_context = False

    flush_block()

    # Final blank collapse and trim.
    final: list[str] = []
    blank_run = 0
    for line in out:
        if line == "":
            blank_run += 1
            if blank_run <= 1:
                final.append(line)
        else:
            blank_run = 0
            final.append(line)
    while final and final[0] == "":
        final.pop(0)
    while final and final[-1] == "":
        final.pop()
    return final


def strip_residual_page_artifacts(line: str) -> str:
    s = line
    # Mid-line page numbers inserted at page boundaries, e.g. ".   4 He’s"
    s = re.sub(r"\s{2,}\d{1,3}(?=\s+[A-Z])", "", s)
    s = re.sub(r"(?<=[.?!…])\s+\d{1,3}(?=\s+[A-Z])", "", s)

    # Trailing page numbers appended to content lines.
    if not re.fullmatch(r"No\.\s+\d{1,3}", s):
        s = re.sub(r"\s{2,}\d{1,3}$", "", s)
        s = re.sub(r"(?<=[A-Za-z,;:)\]’\".!?…])\s+\d{1,3}$", "", s)

    return s.strip()


def postprocess_normalized_lines(lines: list[str]) -> list[str]:
    # 1) Merge scene headings split as "INT." + "FRANK'S HOUSE - DAY - 1975"
    merged: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line in SCENE_PREFIX_ONLY:
            j = i + 1
            while j < len(lines) and lines[j] == "":
                j += 1
            if j < len(lines) and looks_scene_continuation(lines[j]):
                merged.append(f"{line} {lines[j]}")
                i = j + 1
                continue
        merged.append(line)
        i += 1

    # 2) Strip residual page-number artifacts and re-collapse blanks.
    cleaned: list[str] = []
    for line in merged:
        if line == "":
            cleaned.append("")
            continue
        cleaned.append(strip_residual_page_artifacts(line))

    final: list[str] = []
    blank_run = 0
    for line in cleaned:
        if not line:
            blank_run += 1
            if blank_run <= 1:
                final.append("")
        else:
            blank_run = 0
            final.append(line)
    while final and final[0] == "":
        final.pop(0)
    while final and final[-1] == "":
        final.pop()
    return final


def build_output(clean_lines: list[str], page_count: int) -> str:
    body = "\n".join(clean_lines)
    return (
        "# The Irishman (AMPAS Script) - Cleaned Extract\n\n"
        f"- Source PDF: `the-irishman-ampas-script.pdf`\n"
        f"- Derived from: `the-irishman-ampas-script-extracted.md`\n"
        f"- Original page count: {page_count}\n"
        "- Cleanup pass: removed page-number artifacts, dropped `(MORE)` markers, and unwrapped many PDF line wraps.\n"
        "- Notes: Heuristic cleanup (not a perfect screenplay parser). Keep the extracted file for audit/reference.\n\n"
        "## Script (Normalized Text)\n\n"
        "```text\n"
        f"{body}\n"
        "```\n"
    )


def main() -> None:
    md_text = INPUT_MD.read_text(encoding="utf-8")
    pages = parse_pages(md_text)
    cleaned_lines = clean_pages_to_lines(pages)
    normalized_lines = join_wrapped_lines(cleaned_lines)
    normalized_lines = postprocess_normalized_lines(normalized_lines)
    OUTPUT_MD.write_text(build_output(normalized_lines, len(pages)), encoding="utf-8")
    print(f"Wrote {OUTPUT_MD.name} ({len(normalized_lines)} cleaned lines from {len(pages)} pages)")


if __name__ == "__main__":
    main()
