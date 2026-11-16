"""Minimal WebVTT parse/serialize for caption translation and upload checks.

Only what captions_service needs: cue timings and text. Header metadata,
NOTE/STYLE/REGION blocks, cue identifiers and cue settings are dropped on a
round trip, which is fine for the tracks we write (Stream renders plain cues).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_TIMING = re.compile(
    r"^\s*((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})"
)
_SENTENCE_END = re.compile(r"[.?!…][\"'”’)\]]*$")

# A translation group stops growing at whichever of these comes first. Small
# enough that a split-back cue stays readable, big enough that the model sees
# a whole clause rather than a 3-word fragment.
_MAX_GROUP_CUES = 4
_MAX_GROUP_CHARS = 240


class VttError(ValueError):
    pass


@dataclass
class Cue:
    start: str
    end: str
    text: str


def decode(raw: bytes) -> str:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise VttError("Caption file must be UTF-8 text") from exc
    return text.replace("\r\n", "\n").replace("\r", "\n")


def parse(text: str) -> list[Cue]:
    lines = text.replace("\r\n", "\n").split("\n")
    if not lines or not lines[0].lstrip("﻿").startswith("WEBVTT"):
        raise VttError("Not a WebVTT file (must start with 'WEBVTT')")
    cues: list[Cue] = []
    i = 1
    while i < len(lines):
        match = _TIMING.match(lines[i])
        if match is None:
            i += 1
            continue
        i += 1
        body: list[str] = []
        while i < len(lines) and lines[i].strip():
            body.append(lines[i].strip())
            i += 1
        cues.append(Cue(start=match.group(1), end=match.group(2), text="\n".join(body)))
    return cues


def validate(raw: bytes) -> str:
    """Decode and check an uploaded caption file. Returns the normalized text."""
    text = decode(raw)
    if not parse(text):
        raise VttError("Caption file has no cues")
    return text


def serialize(cues: list[Cue]) -> str:
    blocks = ["WEBVTT"]
    for cue in cues:
        blocks.append(f"{cue.start} --> {cue.end}\n{cue.text}")
    return "\n\n".join(blocks) + "\n"


def group_for_translation(cues: list[Cue]) -> list[list[Cue]]:
    """Group consecutive cues into roughly sentence-sized runs.

    Speech-to-text cues break mid-sentence; translating each fragment alone
    gives poor French. Each group is translated as one string and the result
    is spread back over the group's original cues (split_translation), so
    timing stays as granular as the English track.
    """
    groups: list[list[Cue]] = []
    current: list[Cue] = []
    chars = 0
    for cue in cues:
        current.append(cue)
        chars += len(cue.text)
        if (
            _SENTENCE_END.search(cue.text.strip())
            or len(current) >= _MAX_GROUP_CUES
            or chars >= _MAX_GROUP_CHARS
        ):
            groups.append(current)
            current, chars = [], 0
    if current:
        groups.append(current)
    return groups


def group_text(group: list[Cue]) -> str:
    return " ".join(" ".join(c.text.split()) for c in group)


def split_translation(group: list[Cue], translated: str) -> list[Cue]:
    """Spread a translated group's words over its cues, in proportion to each
    original cue's share of the source text."""
    words = translated.split()
    if not words:
        return []
    if len(group) == 1:
        return [Cue(group[0].start, group[0].end, " ".join(words))]
    weights = [max(len(c.text), 1) for c in group]
    total = sum(weights)
    out: list[Cue] = []
    taken = 0
    running = 0
    for idx, cue in enumerate(group):
        running += weights[idx]
        if idx == len(group) - 1:
            end = len(words)
        else:
            end = round(len(words) * running / total)
        chunk = words[taken:end]
        taken = max(taken, end)
        if chunk:
            out.append(Cue(cue.start, cue.end, " ".join(chunk)))
        elif out:
            # No words left for this cue: stretch the previous one over it.
            out[-1] = Cue(out[-1].start, cue.end, out[-1].text)
    return out
