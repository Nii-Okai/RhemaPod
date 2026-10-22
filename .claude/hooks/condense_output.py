#!/usr/bin/env python3
"""Keep noisy Bash output out of Claude's context.

Two modes:

  PreToolUse hook (stdin is the hook JSON): if the Bash command is a known
  noisy one (installs, builds, test runs, docker, git diff, ...), rewrite it
  to run through this script in --run mode. Anything else is left alone.

  --run <base64 command>: run the command, save the full output to a log
  file, and print it unchanged if it is short. If it is long, print only
  errors/failures (with a little context), the final summary lines, and the
  log path so the full output can still be read on demand. The exit code is
  preserved.

Bypass for a single command: prefix it with CLAUDE_RAW=1.
"""
import base64
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time

# Output at or under this many lines is passed through untouched.
SHORT_LINES = 40
# Lines kept from the end of a long output (where summaries live).
TAIL_LINES = 15
# Lines kept after each error match (traceback / assertion detail).
CONTEXT_AFTER = 3
# Hard cap on important lines printed from a long output.
MAX_IMPORTANT = 120

LOG_DIR = os.path.join(tempfile.gettempdir(), "claude-condensed")

NOISY = re.compile(
    r"""(?x)
    (^|[;&|(]\s*|\s)(
        (npm|pnpm|yarn|bun)\s+(install|i|ci|add|update|test|t|build|run\s+(build|test|lint|typecheck|e2e)\S*)
      | npx\s+(tsc|jest|vitest|eslint|next\s+build|playwright\s+test|expo\s+export)
      | (pip|pip3)\s+install | python3?\s+-m\s+(pip\s+install|pytest)
      | uv\s+(sync|add|pip\s+install|run\s+(pytest|alembic|mypy|ruff))
      | poetry\s+install
      | pytest | jest | vitest | tsc | eslint | mypy
      | next\s+build | playwright\s+test
      | docker(-compose)?\s+(build|compose|pull|push|run|up)
      | git\s+(diff|show|log\s+-p)
      | make | cargo\s+(build|test) | go\s+(build|test) | mvn | gradle | \./gradlew
      | apt(-get)?\s+install | alembic\s+upgrade
    )\b
    """
)

# The command already limits its own output, so leave it alone.
SELF_LIMITED = re.compile(r"\|\s*(head|tail|grep|wc|less|jq)\b|(?<![0-9&])>\s*[^&\s]|--stat\b|--quiet\b|\s-q\b")

IMPORTANT = re.compile(
    r"""(?ix)
    error | err! | fail(ed|ure|ing)? | exception | traceback | panic | fatal
    | ^\s*E\s{2,} | assert | ✕ | ✗ | ×\s | \bnot\s+ok\b
    | cannot\s+find | not\s+found | denied | segmentation | killed
    """
)

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def hook():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    if event.get("tool_name") != "Bash":
        return
    tool_input = event.get("tool_input") or {}
    command = tool_input.get("command") or ""
    if (
        not command.strip()
        or tool_input.get("run_in_background")
        or command.lstrip().startswith("CLAUDE_RAW=1")
        or "condense_output.py" in command
        or SELF_LIMITED.search(command)
        or not NOISY.search(command)
    ):
        return
    encoded = base64.b64encode(command.encode()).decode()
    wrapped = f"python3 {shlex.quote(os.path.abspath(__file__))} --run {encoded}"
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "updatedInput": {**tool_input, "command": wrapped},
            }
        },
        sys.stdout,
    )


def clean(raw):
    lines = []
    for line in ANSI.sub("", raw).splitlines():
        # A progress bar redraws itself with \r; keep only its final state.
        line = line.rsplit("\r", 1)[-1].rstrip()
        if line:
            lines.append(line)
    return lines


def diff_summary(lines):
    files, current = [], None
    for line in lines:
        if line.startswith("diff --git "):
            current = [line.split(" b/", 1)[-1], 0, 0]
            files.append(current)
        elif current and line.startswith("+") and not line.startswith("+++"):
            current[1] += 1
        elif current and line.startswith("-") and not line.startswith("---"):
            current[2] += 1
    out = [f" {name}  +{add} -{rem}" for name, add, rem in files]
    out.append(f" {len(files)} files changed, +{sum(f[1] for f in files)} -{sum(f[2] for f in files)}")
    return out


def condense(command, lines):
    if re.match(r"\s*git\s+(diff|show|log)", command) and any(l.startswith("diff --git ") for l in lines):
        return diff_summary(lines)
    keep = set()
    for i, line in enumerate(lines):
        if IMPORTANT.search(line):
            keep.update(range(i, min(i + CONTEXT_AFTER + 1, len(lines))))
    tail_start = max(0, len(lines) - TAIL_LINES)
    important = sorted(i for i in keep if i < tail_start)
    out = []
    if len(important) > MAX_IMPORTANT:
        out.append(f"[{len(important) - MAX_IMPORTANT} more error lines omitted]")
        important = important[:MAX_IMPORTANT]
    prev = None
    for i in important:
        if prev is not None and i != prev + 1:
            out.append("  ...")
        out.append(lines[i])
        prev = i
    if out:
        out.append("  ...")
    out.extend(lines[tail_start:])
    return out


def run(encoded):
    command = base64.b64decode(encoded).decode()
    proc = subprocess.run(
        ["bash", "-c", command],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
    )
    raw = proc.stdout.decode(errors="replace")
    lines = clean(raw)
    if len(lines) <= SHORT_LINES:
        print("\n".join(lines))
        return proc.returncode
    os.makedirs(LOG_DIR, exist_ok=True)
    log = os.path.join(LOG_DIR, time.strftime("%Y%m%d-%H%M%S") + f"-{os.getpid()}.log")
    with open(log, "w") as f:
        f.write(raw)
    shown = condense(command, lines)
    print("\n".join(shown))
    print(
        f"[condensed: showed {len(shown)} of {len(lines)} lines, exit {proc.returncode}. "
        f"Full output: {log}]"
    )
    return proc.returncode


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--run":
        sys.exit(run(sys.argv[2]))
    hook()
