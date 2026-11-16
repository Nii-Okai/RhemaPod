"""WebVTT helpers used by caption translation and uploads."""
import pytest

from app.core import vtt


def test_vtt_grouping_and_split_keep_timings():
    cues = vtt.parse(
        "WEBVTT\n\n"
        "1\n00:00:00.000 --> 00:00:02.000 align:start\nAnd so the Lord\n\n"
        "00:00:02.000 --> 00:00:04.000\nsaid to Moses,\n\n"
        "00:00:04.000 --> 00:00:06.000\ngo down.\n\n"
        "00:00:06.000 --> 00:00:08.000\nAmen?\n"
    )
    groups = vtt.group_for_translation(cues)
    assert [len(g) for g in groups] == [3, 1]
    assert vtt.group_text(groups[0]) == "And so the Lord said to Moses, go down."

    out = vtt.split_translation(groups[0], "Et le Seigneur dit à Moïse : descends.")
    assert out[0].start == "00:00:00.000"
    assert out[-1].end == "00:00:06.000"
    assert " ".join(c.text for c in out) == "Et le Seigneur dit à Moïse : descends."


def test_vtt_validate_rejects_srt():
    with pytest.raises(vtt.VttError):
        vtt.validate(b"1\n00:00:01,000 --> 00:00:02,000\nhi\n")
    assert vtt.validate("﻿WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nhi\r\n".encode())
