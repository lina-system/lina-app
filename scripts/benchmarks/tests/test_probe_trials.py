# SPDX-License-Identifier: Apache-2.0
import importlib.util
from pathlib import Path
import unittest
import sys
sys.path.insert(0, str(Path(__file__).parents[1]))

spec = importlib.util.spec_from_file_location('probe_trials', Path(__file__).parents[1] / 'probe_trials.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def trial():
    events = []
    for i, code in enumerate([49, 1, 0, 3, 0, 15, 34]):
        tick = 24000 + i * 4000
        events.extend([dict(code=code, down=True, before=tick, after=tick + 1,
                            flags=1_048_576 if i == 0 else 0),
                       dict(code=code, down=False, before=tick + 2, after=tick + 3, flags=0)])
    return dict(id='test', launcher='spotlight', layout='abc', gap_ms=30,
                clock=dict(numerator=125, denominator=3), faults=[], keys=events,
                deadline_ticks=120048000, end_ticks=120050000,
                frames=[dict(index=i, display_ticks=48000 + i * 400000 if i else 0, status=0,
                             file=f'frames/{i}.bgra', sha256='0' * 64,
                             panel_changed=i > 0, result_text='Safari' if i > 0 else '',
                             result_confidence=0.99, field_text='safari') for i in range(301)],
                capture=dict(refresh_hz=60), expected_result='Safari',
                annotation=dict(lost_keys=0, inspected=True, note='synthetic test only'),
                rss=dict(complete=True, processes=[dict(resident_bytes=1024)], shared_services=[]))


class TrialTests(unittest.TestCase):
    def test_mach_mapping_and_csv(self):
        row = probe.derive(trial(), 'test/trial.json', phase='warmup', iteration=1)
        self.assertEqual(row['status'], 'ok')
        self.assertAlmostEqual(row['open_ms'], 17.6666666667)
        self.assertAlmostEqual(row['first_result_ms'], 16.6666666667)
        self.assertEqual(row['rss_bytes'], 1024)

    def test_unknown_loss_is_not_zero_or_ok(self):
        value = trial()
        value.pop('annotation')
        row = probe.derive(value, 'test/trial.json')
        self.assertEqual(row['lost_keys'], '')
        self.assertEqual(row['status'], 'capture_invalid')
        self.assertEqual(row['open_ms'], '')

    def test_capture_gap_invalidates_boundary(self):
        value = trial()
        value['frames'][2]['display_ticks'] += 300000
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')

    def test_idle_requires_persisted_pixels(self):
        value = trial()
        value['frames'][2]['status'] = 1
        value['frames'][2].pop('file')
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')
        value['frames'][2]['persisted_from'] = 1
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'ok')

    def test_real_input_and_writer_error_kept_as_invalid(self):
        for fault in ('real_input', 'writer_error', 'queue_overflow', 'focus_mismatch'):
            value = trial()
            value['faults'] = [fault]
            self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')

    def test_missing_process_leaves_rss_unknown(self):
        value = trial()
        value['rss']['complete'] = False
        self.assertEqual(probe.derive(value, 'test/trial.json')['rss_bytes'], '')

    def test_result_timeout_and_no_open(self):
        value = trial()
        for frame in value['frames']:
            frame['result_text'] = ''
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'result_timeout')
        for frame in value['frames']:
            frame['panel_changed'] = False
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'open_timeout')

    def test_stable_preexisting_result_is_clamped_and_rechecked(self):
        value = trial()
        for frame in value['frames']:
            frame['result_text'] = 'Safari'
        value['keys'][-2].update(before=900000, after=900001)
        value['keys'][-1].update(before=900002, after=900003)
        value['deadline_ticks'] = 120900000
        value['end_ticks'] = 120902000
        for i in range(301, 304):
            frame = value['frames'][-1].copy()
            frame.update(index=i, display_ticks=48000 + i * 400000, file=f'frames/{i}.bgra')
            value['frames'].append(frame)
        self.assertEqual(probe.derive(value, 'test/trial.json')['first_result_ms'], 0)
        last_observed = next(f for f in reversed(value['frames']) if f['display_ticks'] <= value['deadline_ticks'])
        last_observed['result_text'] = 'Other'
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'result_timeout')

    def test_single_or_nonconsecutive_match_is_not_ready(self):
        value = trial()
        for frame in value['frames'][::2]:
            frame['result_text'] = 'Other'
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'result_timeout')

    def test_no_keys_or_frames_is_retained_failure(self):
        value = trial()
        value['keys'] = []
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')
        value = trial()
        value['frames'] = []
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')

    def test_short_capture_and_missing_baseline_cannot_pass(self):
        for modify in (lambda v: v.update(end_ticks=v['deadline_ticks'] - 1),
                       lambda v: v.update(frames=v['frames'][:10]),
                       lambda v: v['frames'][0].update(display_ticks=24000)):
            value = trial()
            modify(value)
            self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')

    def test_wrong_physical_sequence_cannot_pass(self):
        value = trial()
        value['keys'][2]['code'] = 9
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')
        value = trial()
        value['keys'][0]['flags'] = 0
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'capture_invalid')

    def test_positive_lost_key_count_is_kept_and_uninspected_count_is_unknown(self):
        value = trial()
        value['annotation']['lost_keys'] = 2
        self.assertEqual(probe.derive(value, 'test/trial.json')['lost_keys'], 2)
        value['annotation']['inspected'] = False
        self.assertEqual(probe.derive(value, 'test/trial.json')['lost_keys'], '')

    def test_result_and_panel_changes_after_deadline_remain_timeouts(self):
        value = trial()
        for frame in value['frames']:
            frame['result_text'] = ''
        for i in range(301, 304):
            frame = value['frames'][-1].copy()
            frame.update(index=i, display_ticks=48000 + i * 400000, file=f'frames/{i}.bgra',
                         result_text='Safari', result_confidence=0.99)
            value['frames'].append(frame)
        row = probe.derive(value, 'test/trial.json')
        self.assertEqual(row['status'], 'result_timeout')
        self.assertEqual(row['first_result_ms'], '')
        for frame in value['frames'][:301]:
            frame['panel_changed'] = False
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'open_timeout')

    def test_shutdown_frame_does_not_erase_an_in_deadline_result(self):
        value = trial()
        frame = value['frames'][-1].copy()
        frame.update(index=301, display_ticks=120448000, result_text='unrelated cleanup')
        value['frames'].append(frame)
        self.assertEqual(probe.derive(value, 'test/trial.json')['status'], 'ok')

    def test_rejects_unsafe_evidence_path(self):
        with self.assertRaises(ValueError):
            probe.derive(trial(), '../trial.json')


if __name__ == '__main__':
    unittest.main()
