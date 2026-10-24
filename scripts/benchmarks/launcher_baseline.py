#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Summarize annotated launcher captures; this is not a capture or signing tool."""

import argparse
import csv
import math
from pathlib import Path, PurePosixPath
import re
import statistics
import sys


COLUMNS = (
    "launcher", "layout", "gap_ms", "phase", "iteration", "status",
    "open_ms", "first_result_ms", "lost_keys", "rss_bytes", "evidence",
)
LAUNCHERS = ("spotlight", "raycast")
CONDITIONS = tuple((layout, gap) for layout in ("abc", "korean-2-set") for gap in (0, 8, 30))


def read_csv(stream):
    reader = csv.DictReader(stream)
    if reader.fieldnames != list(COLUMNS):
        raise ValueError("CSV header must be: " + ",".join(COLUMNS))
    return list(reader)


def number(value, name, *, integer=False, optional=False):
    if value == "" and optional:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name}: missing number")
    if integer and not re.fullmatch(r"[0-9]+", value):
        raise ValueError(f"{name}: expected a nonnegative integer")
    result = int(value) if integer else float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"{name}: expected a finite nonnegative number")
    return result


def percentiles(values):
    # An absent observation is never discarded to make the latency look better.
    if any(value is None for value in values):
        return None, None
    ordered = sorted(values)
    return statistics.median(ordered), ordered[math.ceil(0.9 * len(ordered)) - 1]


def summarize(rows):
    groups = {condition: [] for condition in CONDITIONS}
    evidence_seen = set()
    for line, row in enumerate(rows, 2):
        try:
            if set(row) != set(COLUMNS) or any(value is None for value in row.values()):
                raise ValueError("wrong number of CSV columns")
            launcher = row["launcher"]
            condition = (row["layout"], number(row["gap_ms"], "gap_ms", integer=True))
            if launcher not in LAUNCHERS or condition not in groups:
                raise ValueError("unknown launcher, input layout or key gap")
            if row["phase"] not in ("warmup", "warm"):
                raise ValueError("only warmup/warm rows belong in this file; record cold runs separately")
            iteration = number(row["iteration"], "iteration", integer=True)
            status = row["status"]
            if status not in ("ok", "open_timeout", "result_timeout", "capture_invalid"):
                raise ValueError("unknown status")
            open_ms = number(row["open_ms"], "open_ms", optional=True)
            result_ms = number(row["first_result_ms"], "first_result_ms", optional=True)
            lost_keys = number(row["lost_keys"], "lost_keys", integer=True, optional=True)
            rss = number(row["rss_bytes"], "rss_bytes", integer=True, optional=True)
            if rss == 0:
                raise ValueError("rss_bytes must be positive or empty (unknown)")
            if status == "ok" and (open_ms is None or result_ms is None or lost_keys is None):
                raise ValueError("ok requires both timings and a verified lost-key count")
            if status == "result_timeout" and (open_ms is None or result_ms is not None):
                raise ValueError("result_timeout requires open_ms and no first_result_ms")
            if status in ("open_timeout", "capture_invalid") and (open_ms is not None or result_ms is not None):
                raise ValueError("open_timeout/capture_invalid must not carry timing values")
            evidence = row["evidence"]
            path = PurePosixPath(evidence)
            if (not evidence.strip() or path.is_absolute() or ".." in path.parts
                    or ":" in evidence or "\\" in evidence or path.suffix != ".json"):
                raise ValueError("evidence must name a relative trial JSON file without parent traversal")
            canonical = str(path)
            if canonical in evidence_seen:
                raise ValueError("each observation must have distinct trial evidence")
            evidence_seen.add(canonical)
            groups[condition].append(dict(
                launcher=launcher, phase=row["phase"], iteration=iteration,
                open_ms=open_ms, result_ms=result_ms, lost_keys=lost_keys,
                rss_mib=None if rss is None else rss / 1048576,
                failed=status != "ok",
            ))
        except (ValueError, OverflowError) as error:
            raise ValueError(f"CSV line {line}: {error}") from error

    expected = [(phase, iteration, launcher)
                for phase, count in (("warmup", 2), ("warm", 30))
                for iteration in range(1, count + 1) for launcher in LAUNCHERS]
    summaries = []
    for (layout, gap), trials in groups.items():
        actual = [(r["phase"], r["iteration"], r["launcher"]) for r in trials]
        if actual != expected:
            raise ValueError(
                f"{layout}/{gap}ms: require two warmups then 30 warm pairs, "
                "Spotlight then Raycast in each pair, in acquisition order"
            )
        for launcher in LAUNCHERS:
            measured = [r for r in trials if r["phase"] == "warm" and r["launcher"] == launcher]
            summary = dict(launcher=launcher, layout=layout, gap_ms=gap, n=len(measured),
                           failures=sum(r["failed"] for r in measured))
            for metric, unit in (("open", "ms"), ("result", "ms"), ("rss", "mib")):
                median, p90 = percentiles([r[f"{metric}_{unit}"] for r in measured])
                summary[f"{metric}_median_{unit}"] = median
                summary[f"{metric}_p90_{unit}"] = p90
            keys = [r["lost_keys"] for r in measured]
            summary["lost_keys"] = None if None in keys else sum(keys)
            summaries.append(summary)
    return summaries


def complete(groups):
    return all(group["failures"] == 0 and all(value is not None for value in group.values())
               for group in groups)


def render(groups):
    def fmt(value):
        return "unverified" if value is None else f"{value:.2f}"

    output = [
        "# Launcher warm-run summary",
        "",
        "Annotation completeness: " + ("complete." if complete(groups) else "INCOMPLETE."),
        "Capture provenance, cold runs and phone validation require separate review.",
        "This calculation does not verify the recorder, raw evidence, signatures or device.",
        "",
        "| Launcher | Layout | Gap (ms) | n | Failed | Open median / p90 (ms) | First result median / p90 (ms) | Lost keys (total) | RSS median / p90 (MiB) |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for g in groups:
        lost = "unverified" if g["lost_keys"] is None else str(g["lost_keys"])
        output.append(
            f"| {g['launcher']} | {g['layout']} | {g['gap_ms']} | {g['n']} | {g['failures']} | "
            f"{fmt(g['open_median_ms'])} / {fmt(g['open_p90_ms'])} | "
            f"{fmt(g['result_median_ms'])} / {fmt(g['result_p90_ms'])} | {lost} | "
            f"{fmt(g['rss_median_mib'])} / {fmt(g['rss_p90_mib'])} |"
        )
    output.extend(["", "p90 uses nearest rank: sorted observation 27 of 30. Warmups are excluded.",
                   "RSS is summed resident bytes of the documented process set, not physical footprint.", ""])
    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="annotated warm trials in acquisition order")
    args = parser.parse_args()
    try:
        with args.csv.open(newline="", encoding="utf-8") as stream:
            groups = summarize(read_csv(stream))
    except (OSError, ValueError, csv.Error) as error:
        print(f"launcher baseline: {error}", file=sys.stderr)
        return 2
    print(render(groups), end="")
    return 0 if complete(groups) else 2


if __name__ == "__main__":
    sys.exit(main())
