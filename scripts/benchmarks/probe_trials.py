#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Derive conservative annotation CSV from private LINA Probe trials, in input order.

This never certifies a baseline or guesses a lost-physical-key count. Add an
annotation object {"inspected": true, "lost_keys": N, "note": "..."} only after
inspecting the retained field/sequence evidence. Originals remain untouched.
"""
import argparse
import csv
import json
import math
from pathlib import Path, PurePosixPath
import sys

from launcher_baseline import COLUMNS


def derive(trial, evidence, *, phase='warmup', iteration=1):
    path = PurePosixPath(evidence)
    if (path.is_absolute() or '..' in path.parts or ':' in evidence
            or '\\' in evidence or path.suffix != '.json'):
        raise ValueError('evidence must be a relative trial JSON path')
    clock = trial['clock']
    if not all(type(clock.get(k)) is int and clock[k] > 0 for k in ('numerator', 'denominator')):
        raise ValueError('clock requires positive integer timebase values')
    scale = clock['numerator'] / clock['denominator'] / 1_000_000
    row = dict(launcher=trial['launcher'], layout=trial['layout'], gap_ms=trial['gap_ms'],
               phase=phase, iteration=iteration, status='capture_invalid', open_ms='',
               first_result_ms='', lost_keys='', rss_bytes='', evidence=evidence)
    rss = trial.get('rss') or {}
    processes = rss.get('processes', [])
    if (rss.get('complete') and processes
            and all(isinstance(p.get('resident_bytes'), int) and p['resident_bytes'] > 0 for p in processes)):
        row['rss_bytes'] = sum(p['resident_bytes'] for p in processes)
    annotation = trial.get('annotation') or {}
    loss = annotation.get('lost_keys')
    if annotation.get('inspected') is True and type(loss) is int and 0 <= loss <= 6 and annotation.get('note'):
        row['lost_keys'] = loss
    keys = [key for key in trial.get('keys', []) if key['down']]
    frames = trial.get('frames', [])
    if trial.get('faults') or len(keys) != 7 or len(frames) < 3:
        return row
    expected_codes = [49] + ([1, 0, 3, 0, 15, 34] if trial['layout'] == 'abc' else [17, 40, 9, 40, 3, 37])
    events = trial['keys']
    if (len(events) != 14 or [key['code'] for key in keys] != expected_codes
            or keys[0].get('flags') != 1_048_576):
        return row
    previous_post = 0
    for i, event in enumerate(events):
        if (event['code'] != expected_codes[i // 2] or event['down'] != (i % 2 == 0)
                or not previous_post <= event['before'] <= event['after']):
            return row
        previous_post = event['after']
    hotkey, last_key = keys[0]['before'], keys[-1]['before']
    deadline = trial.get('deadline_ticks')
    if (deadline is None or abs((deadline - last_key) * scale - 5000) > 0.001
            or trial.get('end_ticks', 0) < deadline):
        return row
    # stopCapture can deliver additional frames while shutting down. They are
    # retained in JSON, but can neither rescue a timeout nor erase an answer
    # established inside the fixed observation window.
    frames = [frame for frame in frames
              if frame.get('display_ticks') is None or frame['display_ticks'] <= deadline]
    # No timing from an unrecorded interval. An idle status can repeat known
    # pixels, but cannot manufacture missing display frames.
    refresh = trial['capture']['refresh_hz']
    if not isinstance(refresh, (float, int)) or not math.isfinite(refresh) or not 24 <= refresh <= 240:
        return row
    max_gap = 1.5 * 1000 / refresh
    # Stream-start metadata is kept in JSON but is not a display observation.
    first_complete = next((i for i, f in enumerate(frames) if f.get('file') and f['status'] == 0), None)
    if first_complete is None:
        return row
    frames = frames[first_complete:]
    if (frames[0].get('display_ticks', hotkey) >= hotkey
            or frames[-1].get('display_ticks') is None
            or (deadline - frames[-1]['display_ticks']) * scale > max_gap):
        return row
    valid = []
    previous = None
    for frame in frames:
        tick = frame.get('display_ticks')
        if tick is None:
            return row
        if previous is not None and not 0 < (tick - previous) * scale <= max_gap:
            return row
        previous = tick
        if frame['status'] == 0:
            if not frame.get('file') or not frame.get('sha256'):
                return row
        elif frame['status'] == 1:
            if frame.get('persisted_from') not in [f['index'] for f in valid if f['status'] == 0]:
                return row
        else:
            return row
        valid.append(frame)
    changed = next((f for f in frames if f.get('panel_changed') and f['display_ticks'] >= hotkey), None)
    if changed is None:
        row['status'] = 'open_timeout'
        return row
    if row['lost_keys'] == '':
        return row
    row['open_ms'] = (changed['display_ticks'] - hotkey) * scale
    row['status'] = 'result_timeout'
    expected = trial['expected_result'].strip().casefold()
    def matches(frame):
        return (frame.get('result_text', '').strip().casefold() == expected
                and frame.get('result_confidence', 0) >= 0.8)
    # A transient pre-query answer is not a completed-query result.
    if not matches(frames[-1]) or frames[-1]['display_ticks'] < last_key:
        return row
    for i in range(len(frames) - 2):
        run = frames[i:i + 3]
        if all(matches(frame) for frame in run) and run[-1]['display_ticks'] >= last_key:
            row['first_result_ms'] = max(0, (run[0]['display_ticks'] - last_key) * scale)
            row['status'] = 'ok'
            break
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('trials', nargs='+', help='relative JSON paths in actual acquisition order')
    parser.add_argument('--phase', choices=['warmup', 'warm'], default='warmup')
    parser.add_argument('--iteration', type=int, default=1, help='first pair number')
    args = parser.parse_args()
    if args.iteration < 1:
        parser.error('--iteration must be positive')
    writer = csv.DictWriter(sys.stdout, fieldnames=COLUMNS)
    writer.writeheader()
    counts = {}
    for path in args.trials:
        source = args.bundle / path
        if not source.resolve().is_relative_to(args.bundle.resolve()):
            parser.error('trial path escapes bundle')
        trial = json.loads(source.read_text())
        key = (trial['launcher'], trial['layout'], trial['gap_ms'])
        iteration = counts.get(key, args.iteration)
        writer.writerow(derive(trial, path, phase=args.phase, iteration=iteration))
        counts[key] = iteration + 1


if __name__ == '__main__':
    main()
