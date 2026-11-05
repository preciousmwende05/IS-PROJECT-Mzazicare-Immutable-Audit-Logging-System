"""
Train the rule-based baseline and the Isolation Forest, choose each one's alert
threshold on the VALIDATION split, and save everything to a run folder.

Data discipline (Sprint II brief):
  * train split  -> fit the models and all statistics (labels never used)
  * val split    -> choose the alert threshold (the only place labels guide a decision)
  * test split   -> untouched here; scored ONCE by evaluate.py

Feature sets (for the controlled comparison):
  --features role-relative  (default) each count compared with the actor's own role
  --features raw            the sim-v1 approach: raw counts + time + role one-hot

Run from ml/audit-anomaly:
    python src/train.py
    python src/train.py --features raw --tag raw-features
"""

from __future__ import annotations

import argparse
import json
import platform
import subprocess
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score, roc_auc_score

from config import DATASET_VERSION, FEATURE_COLUMNS, POLICY_RULES, PROCESSED_DIR, RUNS_DIR, SEED, WINDOW
from transform import ROLE_RELATIVE_COLUMNS, fit_role_stats, role_relative

# The baseline flags a window when its most extreme role-relative count is high.
BASELINE_COUNTS = ["rz_event_count", "rz_distinct_targets", "rz_sensitive_reads",
                   "rz_failed_logins", "rz_denied_attempts", "rz_distinct_ips", "rz_rare_role_actions"]

# Candidate alert rates to try on validation (share of training windows above threshold).
CANDIDATE_RATES = [0.0025, 0.005, 0.0075, 0.01, 0.0125, 0.015, 0.02, 0.03, 0.05]


def score_baseline(rel: pd.DataFrame) -> np.ndarray:
    """Rule-based score: the single most extreme role-relative count."""
    return rel[BASELINE_COUNTS].max(axis=1).to_numpy()


def policy_flags(windows: pd.DataFrame) -> np.ndarray:
    """1 where a window breaks a hard policy rule (config.POLICY_RULES)."""
    hit = np.zeros(len(windows), dtype=bool)
    for col, minimum in POLICY_RULES.items():
        hit |= windows[col].to_numpy() >= minimum
    return hit.astype(int)


def model_matrix(windows: pd.DataFrame, rel: pd.DataFrame, feature_set: str) -> pd.DataFrame:
    return rel[ROLE_RELATIVE_COLUMNS] if feature_set == "role-relative" else windows[FEATURE_COLUMNS]


def choose_threshold(train_scores: np.ndarray, val_scores: np.ndarray, val_labels: np.ndarray,
                     method: str) -> tuple[float, float, pd.DataFrame]:
    """Try each alert rate; threshold = train-score quantile; keep the best validation F1."""
    rows = []
    for rate in CANDIDATE_RATES:
        threshold = float(np.quantile(train_scores, 1 - rate))
        pred = (val_scores >= threshold).astype(int)
        rows.append({
            "method": method,
            "alert_rate": rate,
            "threshold": threshold,
            "val_flagged": int(pred.sum()),
            "val_precision": precision_score(val_labels, pred, zero_division=0),
            "val_recall": recall_score(val_labels, pred, zero_division=0),
            "val_f1": f1_score(val_labels, pred, zero_division=0),
        })
    table = pd.DataFrame(rows)
    best = table.sort_values(["val_f1", "val_precision"], ascending=False).iloc[0]
    return float(best["threshold"]), float(best["alert_rate"]), table


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True,
                                       stderr=subprocess.DEVNULL).strip()
    except Exception:
        return "unknown"


def git_dirty() -> bool:
    try:
        out = subprocess.check_output(["git", "status", "--porcelain", "--", "."], text=True,
                                      stderr=subprocess.DEVNULL)
        return bool(out.strip())
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Train baseline + Isolation Forest.")
    parser.add_argument("--windows", default=str(PROCESSED_DIR / f"windows_{DATASET_VERSION}.csv"))
    parser.add_argument("--features", choices=["role-relative", "raw"], default="role-relative")
    parser.add_argument("--n-estimators", type=int, default=300)
    parser.add_argument("--max-samples", default="2048")  # chosen on validation: auto(256) PR-AUC 0.86 -> 2048 PR-AUC 0.985
    parser.add_argument("--tag", default="role-relative")
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    windows = pd.read_csv(args.windows, parse_dates=["window_start"])
    train = windows[windows["split"] == "train"].reset_index(drop=True)
    val = windows[windows["split"] == "val"].reset_index(drop=True)
    y_val = val["is_anomaly"].to_numpy()

    # All statistics come from the training split only.
    role_stats = fit_role_stats(train)
    rel_train = role_relative(train, role_stats)
    rel_val = role_relative(val, role_stats)

    # --- rule-based baseline ---
    b_train, b_val = score_baseline(rel_train), score_baseline(rel_val)
    b_threshold, b_rate, b_table = choose_threshold(b_train, b_val, y_val, "baseline")

    # --- Isolation Forest (labels never used) ---
    max_samples = args.max_samples if args.max_samples == "auto" else int(args.max_samples)
    model = IsolationForest(n_estimators=args.n_estimators, max_samples=max_samples,
                            random_state=args.seed, n_jobs=-1)
    model.fit(model_matrix(train, rel_train, args.features))
    # score_samples: higher = more normal. Negate so higher = more anomalous.
    f_train = -model.score_samples(model_matrix(train, rel_train, args.features))
    f_val = -model.score_samples(model_matrix(val, rel_val, args.features))
    f_threshold, f_rate, f_table = choose_threshold(f_train, f_val, y_val, "iforest")

    # --- run folder ---
    commit = git_commit()
    run_id = f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}_{commit}_{args.tag}"
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(model, run_dir / "iforest.joblib")
    (run_dir / "role_stats.json").write_text(json.dumps(role_stats, indent=2))
    # The run must carry everything needed to score new data the same way:
    # without the role vocabulary, rare_role_actions cannot be recomputed.
    vocab_file = PROCESSED_DIR / f"role_action_vocab_{DATASET_VERSION}.json"
    if vocab_file.exists():
        (run_dir / "role_action_vocab.json").write_text(vocab_file.read_text())
    selection = pd.concat([b_table, f_table])
    selection.to_csv(run_dir / "val_threshold_selection.csv", index=False)

    val_summary = {
        "baseline": {"roc_auc": roc_auc_score(y_val, b_val), "pr_auc": average_precision_score(y_val, b_val)},
        "iforest": {"roc_auc": roc_auc_score(y_val, f_val), "pr_auc": average_precision_score(y_val, f_val)},
    }
    config = {
        "run_id": run_id,
        "tag": args.tag,
        "git_commit": commit,
        "git_uncommitted_changes": git_dirty(),
        "dataset_version": DATASET_VERSION,
        "windows_file": str(args.windows),
        "window": WINDOW,
        "seed": args.seed,
        "feature_set": args.features,
        "model_features": list(model_matrix(train.head(1), rel_train.head(1), args.features).columns),
        "split_sizes": windows["split"].value_counts().to_dict(),
        "iforest": {"n_estimators": args.n_estimators, "max_samples": args.max_samples,
                    "threshold": f_threshold, "alert_rate": f_rate},
        "baseline": {"counts": BASELINE_COUNTS, "threshold": b_threshold, "alert_rate": b_rate},
        "candidate_alert_rates": CANDIDATE_RATES,
        "validation_summary": val_summary,
        "versions": {"python": platform.python_version(), "numpy": np.__version__,
                     "pandas": pd.__version__, "scikit_learn": sklearn.__version__},
    }
    (run_dir / "config.json").write_text(json.dumps(config, indent=2, default=float))

    print(f"Run folder: {run_dir}")
    print("\nThreshold selection on VALIDATION (test set untouched):")
    print(selection.round(3).to_string(index=False))
    print(f"\nChosen: baseline rate={b_rate}, iforest rate={f_rate}")
    print(json.dumps(val_summary, indent=2, default=lambda x: round(float(x), 4)))
    print(f"\nNext: python src/evaluate.py --run {run_id}")


if __name__ == "__main__":
    main()
