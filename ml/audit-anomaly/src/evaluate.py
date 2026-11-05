"""
Final evaluation on the TEST split, done once per run, using the thresholds that
train.py chose on validation. Nothing here is tuned on test results.

Writes into the run folder:
  metrics.json             precision, recall, F1, ROC-AUC, PR-AUC for both methods
  recall_by_type.csv       which planted incident types each method catches
  test_predictions.csv     every test window with both scores and flags
  false_positives.csv      normal windows the Isolation Forest flagged (for review)
  score_distribution.png   Isolation Forest scores: normal vs planted anomalies
  pr_curves.png            precision-recall curves, baseline vs Isolation Forest

Run from ml/audit-anomaly:
    python src/evaluate.py --run <run_id printed by train.py>
"""

from __future__ import annotations

import argparse
import json

import joblib
import matplotlib

matplotlib.use("Agg")  # write files, no window needed (works in CI and Colab)
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)

from config import POLICY_RULES, RUNS_DIR  # noqa: E402
from train import model_matrix, policy_flags, score_baseline  # noqa: E402
from transform import role_relative  # noqa: E402


def metrics_for(y, scores, threshold) -> dict:
    pred = (scores >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "threshold": float(threshold),
        "flagged": int(pred.sum()),
        "true_positives": int(tp),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_negatives": int(tn),
        "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y, pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y, scores)), 4),
        "pr_auc": round(float(average_precision_score(y, scores)), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a training run on the test split.")
    parser.add_argument("--run", required=True, help="run folder name inside runs/")
    args = parser.parse_args()

    run_dir = RUNS_DIR / args.run
    config = json.loads((run_dir / "config.json").read_text())

    windows = pd.read_csv(config["windows_file"], parse_dates=["window_start"])
    test = windows[windows["split"] == "test"].reset_index(drop=True)
    y = test["is_anomaly"].to_numpy()

    model = joblib.load(run_dir / "iforest.joblib")
    role_stats = json.loads((run_dir / "role_stats.json").read_text())
    rel = role_relative(test, role_stats)  # statistics fitted on train, applied unchanged

    test["iforest_score"] = -model.score_samples(model_matrix(test, rel, config["feature_set"]))
    test["baseline_score"] = score_baseline(rel)
    test = pd.concat([test, rel.drop(columns=["is_weekend"])], axis=1)
    test["iforest_flag"] = (test["iforest_score"] >= config["iforest"]["threshold"]).astype(int)
    test["baseline_flag"] = (test["baseline_score"] >= config["baseline"]["threshold"]).astype(int)
    # Hybrid: the model OR a hard policy rule. Its score puts every rule hit
    # above any model-only score, so ranking metrics stay meaningful.
    test["policy_flag"] = policy_flags(test)
    test["hybrid_flag"] = (test["iforest_flag"] | test["policy_flag"]).astype(int)
    test["hybrid_score"] = test["iforest_score"] + test["policy_flag"] * 10.0
    hybrid_threshold = config["iforest"]["threshold"]

    results = {
        "run_id": config["run_id"],
        "git_commit": config["git_commit"],
        "dataset_version": config["dataset_version"],
        "feature_set": config["feature_set"],
        "iforest_params": {k: config["iforest"][k] for k in ("n_estimators", "max_samples")},
        "test_windows": int(len(test)),
        "test_anomalous_windows": int(y.sum()),
        "baseline": metrics_for(y, test["baseline_score"].to_numpy(), config["baseline"]["threshold"]),
        "iforest": metrics_for(y, test["iforest_score"].to_numpy(), config["iforest"]["threshold"]),
        "hybrid": {**metrics_for(y, test["hybrid_score"].to_numpy(), hybrid_threshold),
                   "policy_rules": POLICY_RULES},
    }
    (run_dir / "metrics.json").write_text(json.dumps(results, indent=2))

    # Which incident types does each method catch?
    anomalies = test[test["is_anomaly"] == 1]
    by_type = (
        anomalies.groupby("anomaly_type")
        .agg(windows=("is_anomaly", "size"),
             baseline_caught=("baseline_flag", "sum"),
             iforest_caught=("iforest_flag", "sum"),
             hybrid_caught=("hybrid_flag", "sum"))
        .assign(baseline_recall=lambda d: (d["baseline_caught"] / d["windows"]).round(3),
                iforest_recall=lambda d: (d["iforest_caught"] / d["windows"]).round(3),
                hybrid_recall=lambda d: (d["hybrid_caught"] / d["windows"]).round(3))
        .reset_index()
    )
    by_type.to_csv(run_dir / "recall_by_type.csv", index=False)

    keep = ["window_start", "actorId", "actorRole", *config["model_features"], "is_anomaly", "anomaly_type",
            "baseline_score", "baseline_flag", "iforest_score", "iforest_flag", "policy_flag", "hybrid_flag"]
    test[keep].to_csv(run_dir / "test_predictions.csv", index=False)
    fps = test[(test["iforest_flag"] == 1) & (test["is_anomaly"] == 0)]
    fps[keep].sort_values("iforest_score", ascending=False).to_csv(run_dir / "false_positives.csv", index=False)

    # --- charts ---
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.hist(test.loc[test["is_anomaly"] == 0, "iforest_score"], bins=60, alpha=0.7,
            density=True, label="normal windows")
    ax.hist(test.loc[test["is_anomaly"] == 1, "iforest_score"], bins=30, alpha=0.7,
            density=True, label="planted anomalies")
    ax.axvline(config["iforest"]["threshold"], linestyle="--", color="black",
               label="alert threshold (chosen on validation)")
    ax.set_xlabel("anomaly score (higher = more unusual)")
    ax.set_ylabel("density")
    ax.set_title("Isolation Forest scores on the test split")
    ax.legend()
    fig.tight_layout()
    fig.savefig(run_dir / "score_distribution.png", dpi=150)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 5))
    for name, col in [("Rule-based baseline", "baseline_score"), ("Isolation Forest", "iforest_score")]:
        p, r, _ = precision_recall_curve(y, test[col])
        ap = average_precision_score(y, test[col])
        ax.plot(r, p, label=f"{name} (PR-AUC {ap:.3f})")
    ax.axhline(y.mean(), linestyle=":", color="grey", label=f"random guess ({y.mean():.3f})")
    ax.set_xlabel("recall")
    ax.set_ylabel("precision")
    ax.set_title("Precision-recall on the test split")
    ax.legend()
    fig.tight_layout()
    fig.savefig(run_dir / "pr_curves.png", dpi=150)
    plt.close(fig)

    print(json.dumps(results, indent=2))
    print("\nRecall by incident type:")
    print(by_type.to_string(index=False))
    print(f"\nIsolation Forest false positives to review: {len(fps)} -> false_positives.csv")
    print(f"Evidence saved in: {run_dir}")


if __name__ == "__main__":
    main()