"""Quality gate for CI: fail the build if the anomaly model got worse.

Reads a run's metrics.json (written by evaluate.py) and checks that

  1. the hybrid detector (Isolation Forest + policy rules) reaches a minimum F1
     and PR-AUC on the held-out test weeks, and
  2. the model still beats the statistical baseline it is compared against.

The thresholds sit a little below the recorded sim-v3 result (hybrid F1 0.916,
PR-AUC 0.955), so ordinary noise passes and a real regression does not.

    python src/check_metrics.py --run <run folder name>
"""
from __future__ import annotations

import argparse
import json
import sys

from config import RUNS_DIR

MIN_HYBRID_F1 = 0.85
MIN_HYBRID_PR_AUC = 0.90


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", required=True, help="run folder name inside runs/")
    args = parser.parse_args()

    metrics = json.loads((RUNS_DIR / args.run / "metrics.json").read_text())
    hybrid, baseline = metrics["hybrid"], metrics["baseline"]

    checks = [
        (f"hybrid F1 {hybrid['f1']:.4f} >= {MIN_HYBRID_F1}", hybrid["f1"] >= MIN_HYBRID_F1),
        (f"hybrid PR-AUC {hybrid['pr_auc']:.4f} >= {MIN_HYBRID_PR_AUC}",
         hybrid["pr_auc"] >= MIN_HYBRID_PR_AUC),
        (f"hybrid F1 {hybrid['f1']:.4f} beats baseline F1 {baseline['f1']:.4f}",
         hybrid["f1"] > baseline["f1"]),
    ]

    for label, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")

    if not all(ok for _, ok in checks):
        sys.exit(1)


if __name__ == "__main__":
    main()
