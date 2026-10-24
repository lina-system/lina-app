# SPDX-License-Identifier: Apache-2.0
"""Synthetic evidence only: these numbers are never a measured baseline."""
import copy
import csv
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "launcher_baseline", Path(__file__).parents[1] / "launcher_baseline.py"
)
baseline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(baseline)


def session():
    rows = []
    for layout in ("abc", "korean-2-set"):
        for gap in (0, 8, 30):
            for phase, count in (("warmup", 2), ("warm", 30)):
                for iteration in range(1, count + 1):
                    for launcher in ("spotlight", "raycast"):
                        rows.append(dict(
                            launcher=launcher, layout=layout, gap_ms=str(gap),
                            phase=phase, iteration=str(iteration), status="ok",
                            open_ms=str(iteration), first_result_ms=str(iteration * 2),
                            lost_keys="0", rss_bytes=str(1048576 * iteration),
                            evidence=f"{layout}/{gap}/{phase}/{iteration}/{launcher}.json",
                        ))
    return rows


class BaselineTests(unittest.TestCase):
    def test_statistics_keep_conditions_separate_and_exclude_warmups(self):
        rows = session()
        for row in rows:
            if row["phase"] == "warmup":
                row["open_ms"] = "9999"
            if row["launcher"] == "raycast":
                row["first_result_ms"] = str(float(row["first_result_ms"]) + 100)
        groups = baseline.summarize(rows)
        self.assertEqual(len(groups), 12)
        self.assertEqual(groups[0]["open_median_ms"], 15.5)
        self.assertEqual(groups[0]["open_p90_ms"], 27)
        self.assertEqual(groups[0]["result_p90_ms"], 54)
        self.assertEqual(groups[1]["result_p90_ms"], 154)
        self.assertEqual(groups[0]["rss_median_mib"], 15.5)

    def test_missing_duplicate_or_non_alternating_run_is_rejected(self):
        rows = session()
        variants = [rows[:-1], rows + [copy.deepcopy(rows[-1])]]
        swapped = session()
        swapped[4], swapped[5] = swapped[5], swapped[4]
        variants.append(swapped)
        for variant in variants:
            with self.subTest(variant=variant[-1]):
                with self.assertRaises(ValueError):
                    baseline.summarize(variant)

    def test_warmups_are_required_for_each_launcher_and_condition(self):
        with self.assertRaises(ValueError):
            baseline.summarize([r for r in session() if r["phase"] != "warmup"])

    def test_timeout_is_counted_and_never_removed_from_latency_denominator(self):
        rows = session()
        row = rows[4]
        row.update(status="result_timeout", first_result_ms="")
        group = baseline.summarize(rows)[0]
        self.assertEqual(group["n"], 30)
        self.assertEqual(group["failures"], 1)
        self.assertIsNone(group["result_median_ms"])
        self.assertIsNone(group["result_p90_ms"])
        self.assertEqual(group["open_p90_ms"], 27)

    def test_open_timeout_and_unreadable_keys_do_not_become_zero(self):
        rows = session()
        rows[4].update(status="open_timeout", open_ms="", first_result_ms="", lost_keys="")
        group = baseline.summarize(rows)[0]
        self.assertIsNone(group["open_median_ms"])
        self.assertIsNone(group["lost_keys"])
        self.assertFalse(baseline.complete(baseline.summarize(rows)))

    def test_invalid_numbers_statuses_and_evidence_are_rejected(self):
        for field, value in (
            ("open_ms", "nan"), ("first_result_ms", "inf"), ("open_ms", "-1"),
            ("lost_keys", "1.5"), ("rss_bytes", "0"), ("rss_bytes", "-3"),
            ("open_ms", ""), ("status", "skipped"), ("layout", "unknown"),
            ("evidence", ""), ("evidence", "/Users/private/data.json"),
            ("evidence", "../private.json"), ("evidence", "https://example.com/run"),
        ):
            with self.subTest(field=field, value=value):
                rows = session()
                rows[4][field] = value
                with self.assertRaises(ValueError):
                    baseline.summarize(rows)

    def test_missing_memory_stays_unknown_and_lost_keys_are_totalled(self):
        rows = session()
        rows[4]["rss_bytes"] = ""
        rows[4]["lost_keys"] = "2"
        group = baseline.summarize(rows)[0]
        self.assertIsNone(group["rss_median_mib"])
        self.assertEqual(group["lost_keys"], 2)
        self.assertFalse(baseline.complete(baseline.summarize(rows)))

    def test_contradictory_timeout_and_duplicate_evidence_are_rejected(self):
        for update in ({"status": "open_timeout"}, {"status": "result_timeout"},
                       {"evidence": session()[5]["evidence"]}):
            rows = session()
            rows[4].update(update)
            with self.assertRaises(ValueError):
                baseline.summarize(rows)

    def test_csv_requires_exact_header(self):
        with self.assertRaises(ValueError):
            baseline.read_csv(io.StringIO("launcher,open_ms\nspotlight,12\n"))
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=baseline.COLUMNS)
        writer.writeheader()
        writer.writerows(session())
        stream.seek(0)
        self.assertEqual(len(baseline.read_csv(stream)), 384)

    def test_output_does_not_claim_device_or_signing_verification(self):
        output = baseline.render(baseline.summarize(session()))
        self.assertIn("Capture provenance, cold runs and phone validation require separate review", output)
        self.assertIn("15.50", output)
        self.assertNotIn("PASS", output)

    def test_cli_returns_nonzero_for_incomplete_annotations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trials.csv"
            for rows, expected in ((session(), 0), (session()[:-1], 2)):
                with path.open("w", newline="", encoding="utf-8") as stream:
                    writer = csv.DictWriter(stream, fieldnames=baseline.COLUMNS)
                    writer.writeheader()
                    writer.writerows(rows)
                result = subprocess.run([sys.executable, SPEC.origin, str(path)],
                                        text=True, capture_output=True, check=False)
                self.assertEqual(result.returncode, expected, result.stderr)
            rows = session()
            rows[4].update(status="result_timeout", first_result_ms="")
            with path.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=baseline.COLUMNS)
                writer.writeheader()
                writer.writerows(rows)
            result = subprocess.run([sys.executable, SPEC.origin, str(path)],
                                    text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("INCOMPLETE", result.stdout)
            self.assertIn("unverified", result.stdout)


if __name__ == "__main__":
    unittest.main()
