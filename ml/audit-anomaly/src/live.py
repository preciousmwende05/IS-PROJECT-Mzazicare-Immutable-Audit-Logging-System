"""
Live MzaziCare audit data: export it, score it with a trained model, and (once
there is enough real activity) train on it.

Read-only against MongoDB: this never writes to the audit log.

Run from ml/audit-anomaly:
    python src/live.py export                     # real entries -> data/raw/audit_events_live.csv
    python src/live.py score --run <run_id>       # flag unusual windows in real activity
    python src/live.py train                      # train on real activity (refused until enough exists)

Why real activity is filtered:
  * metadata.seed = true marks entries imported from the simulator to seed a dev
    chain. They are not real behaviour and are excluded unless --include-seed.
  * Older entries use pre-spec names (e.g. "auth.login"); LEGACY_ACTION_ALIASES
    maps them so one behaviour has one name.
  * A refused sign-in has no signed-in actor. It is keyed by the phone that was
    tried ("phone:+2547..."), the same way simulate.py keys it, so credential
    stuffing against one account shows up as one actor.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from config import (
    ANOMALY_COLLECTION,
    AUDIT_COLLECTION,
    LEGACY_ACTION_ALIASES,
    MIN_LIVE_ACTORS,
    MIN_LIVE_DAYS,
    MIN_LIVE_WINDOWS,
    MONGO_DB,
    MONGO_URI,
    POLICY_RULES,
    RAW_DIR,
    RUNS_DIR,
    SEED,
    WINDOW,
)
from features import build_windows, fit_role_action_vocab
from train import BASELINE_COUNTS, git_commit, model_matrix, policy_flags, score_baseline
from transform import ROLE_RELATIVE_COLUMNS, fit_role_stats, role_relative

LIVE_CSV = RAW_DIR / "audit_events_live.csv"
EVENT_COLUMNS = ["occurredAt", "actorId", "actorRole", "action", "targetType", "targetId",
                 "ip", "statusCode", "outcome", "sequence"]


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def load_live_events(uri: str = MONGO_URI, db: str = MONGO_DB, collection: str = AUDIT_COLLECTION,
                     include_seed: bool = False) -> pd.DataFrame:
    """Real audit entries as the event table the pipeline expects."""
    from pymongo import MongoClient

    query = {} if include_seed else {"metadata.seed": {"$ne": True}}
    fields = {"_id": 0, "sequence": 1, "occurredAt": 1, "actorId": 1, "actorRole": 1, "action": 1,
              "targetType": 1, "targetId": 1, "ip": 1,
              "metadata.subject": 1, "metadata.outcome": 1, "metadata.statusCode": 1}
    with MongoClient(uri, serverSelectionTimeoutMS=5000) as client:
        rows = list(client[db][collection].find(query, fields).sort("sequence", 1))

    records = []
    for r in rows:
        meta = r.get("metadata") or {}
        subject = meta.get("subject") or {}
        action = LEGACY_ACTION_ALIASES.get(r.get("action"), r.get("action"))
        actor_id = r.get("actorId")
        actor_role = r.get("actorRole") or "unknown"
        if not actor_id:
            # Nobody signed in (a refused sign-in): key by the phone tried, else by IP.
            phone = subject.get("phone")
            actor_id = f"phone:{phone}" if phone else f"ip:{r.get('ip') or 'unknown'}"
            actor_role = "anonymous"
        records.append({
            "occurredAt": r.get("occurredAt"),
            "actorId": actor_id,
            "actorRole": actor_role,
            "action": action,
            "targetType": r.get("targetType"),
            "targetId": r.get("targetId"),
            "ip": r.get("ip"),
            "statusCode": meta.get("statusCode"),
            "outcome": meta.get("outcome"),
            "sequence": r.get("sequence"),
        })
    df = pd.DataFrame(records, columns=EVENT_COLUMNS)
    if not df.empty:
        df["occurredAt"] = pd.to_datetime(df["occurredAt"], utc=True)
    return df


def describe(events: pd.DataFrame) -> dict:
    if events.empty:
        return {"events": 0}
    span = events["occurredAt"].max() - events["occurredAt"].min()
    return {
        "events": int(len(events)),
        "first": str(events["occurredAt"].min()),
        "last": str(events["occurredAt"].max()),
        "days_covered": round(span / pd.Timedelta(days=1), 2),
        "distinct_actors": int(events["actorId"].nunique()),
        "by_role": events["actorRole"].value_counts().to_dict(),
        "top_actions": events["action"].value_counts().head(15).to_dict(),
    }


def cmd_export(args) -> None:
    events = load_live_events(args.uri, include_seed=args.include_seed)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / ("audit_events_live_with_seed.csv" if args.include_seed else LIVE_CSV.name)
    events.to_csv(out, index=False)
    print(f"Wrote {len(events):,} real audit events to {out}")
    print(json.dumps(describe(events), indent=2, default=str))


# ---------------------------------------------------------------------------
# Score with a trained run
# ---------------------------------------------------------------------------

def score_events(run: str, events: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Score real events with a trained run: (windows with scores/flags, role-relative features, run config)."""
    run_dir = RUNS_DIR / run
    config = json.loads((run_dir / "config.json").read_text())
    vocab_file = run_dir / "role_action_vocab.json"
    if not vocab_file.exists():
        raise SystemExit(f"{vocab_file} missing: retrain with the current train.py so the run carries its vocabulary.")
    role_vocab = json.loads(vocab_file.read_text())
    role_stats = json.loads((run_dir / "role_stats.json").read_text())
    model = joblib.load(run_dir / "iforest.joblib")

    windows = build_windows(events, role_vocab=role_vocab)
    rel = role_relative(windows, role_stats)
    windows["iforest_score"] = -model.score_samples(model_matrix(windows, rel, config["feature_set"]))
    windows["baseline_score"] = score_baseline(rel)
    windows["iforest_flag"] = (windows["iforest_score"] >= config["iforest"]["threshold"]).astype(int)
    windows["baseline_flag"] = (windows["baseline_score"] >= config["baseline"]["threshold"]).astype(int)
    windows["policy_flag"] = policy_flags(windows)
    windows["flagged"] = (windows["iforest_flag"] | windows["policy_flag"]).astype(int)
    reason_cols = [c for c in BASELINE_COUNTS if c in rel.columns]
    windows["reasons"] = [
        [f"RULE {col}>={n}" for col, n in POLICY_RULES.items() if windows.loc[i, col] >= n]
        + [f"{c[3:]} {rel.loc[i, c]:+.1f}" for c in reason_cols if rel.loc[i, c] >= 3]
        for i in windows.index
    ]
    return windows, rel, config


def cmd_score(args) -> None:
    run_dir = RUNS_DIR / args.run
    events = load_live_events(args.uri, include_seed=False)
    if events.empty:
        raise SystemExit("No real audit events to score.")
    windows, rel, config = score_events(args.run, events)
    # The hybrid (model OR hard policy rule) is what raises an alert; "why" lists
    # broken rules first, then the role-relative counts that pushed the score up.
    windows["why"] = [", ".join(r) or "-" for r in windows["reasons"]]

    out = run_dir / "live_scores.csv"
    keep = ["window_start", "actorId", "actorRole", "event_count", "failed_logins", "denied_attempts",
            "sensitive_reads", "distinct_targets", "distinct_ips", "rare_role_actions",
            "iforest_score", "iforest_flag", "policy_flag", "baseline_score", "baseline_flag", "flagged", "why"]
    windows[keep].sort_values("iforest_score", ascending=False).to_csv(out, index=False)

    flagged = windows[windows["flagged"] == 1].sort_values("iforest_score", ascending=False)
    print(f"Scored {len(windows):,} live windows ({len(events):,} events) with run {args.run}")
    print(f"Alerts (model OR policy rule): {len(flagged)}  "
          f"[iforest {int(windows['iforest_flag'].sum())}, policy {int(windows['policy_flag'].sum())}, "
          f"baseline-for-comparison {int(windows['baseline_flag'].sum())}]")
    if len(flagged):
        cols = ["window_start", "actorId", "actorRole", "event_count", "failed_logins", "denied_attempts", "iforest_score", "why"]
        print(flagged[cols].head(args.top).to_string(index=False))
    print(f"\nAll scores: {out}")


# ---------------------------------------------------------------------------
# Raise alerts for admins and auditors
# ---------------------------------------------------------------------------

def cmd_alert(args) -> None:
    """Score the last N hours of real activity; every window the Isolation Forest
    flags becomes an open alert in `audit_anomalies`. The backend's audit worker
    notifies every admin and auditor within ~2 minutes.

    Only model flags are written here: policy-rule breaches are raised by the
    backend itself in real time, so writing them too would double-alert.
    Idempotent: a window already raised is skipped (unique key).
    """
    from pymongo import MongoClient

    events = load_live_events(args.uri, include_seed=False)
    if events.empty:
        print("No real audit events yet; nothing to score.")
        return
    since = pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=args.hours)
    # Score with a little extra history so windows at the edge are complete,
    # then keep only the windows that start inside the requested span.
    recent = events[events["occurredAt"] >= since - pd.Timedelta(minutes=30)]
    if recent.empty:
        print(f"No real activity in the last {args.hours} h.")
        return
    windows, _rel, config = score_events(args.run, recent)
    windows = windows[pd.to_datetime(windows["window_start"], utc=True) >= since]
    hits = windows[windows["iforest_flag"] == 1]

    raised = 0
    with MongoClient(args.uri, serverSelectionTimeoutMS=5000) as client:
        coll = client[MONGO_DB][ANOMALY_COLLECTION]
        for _, w in hits.iterrows():
            start = pd.Timestamp(w["window_start"]).to_pydatetime()
            key = f"iforest:{w['actorId']}:{pd.Timestamp(w['window_start']).isoformat()}"
            reasons = list(w["reasons"]) or ["unusual combination of counts for this role"]
            now = pd.Timestamp.now(tz="UTC").to_pydatetime()
            res = coll.update_one(
                {"key": key},
                {"$setOnInsert": {
                    "key": key,
                    "source": "iforest",
                    "kind": "model",
                    "actorId": str(w["actorId"]),
                    "actorRole": str(w["actorRole"]),
                    "windowStart": start,
                    "windowEnd": start + pd.Timedelta(WINDOW).to_pytimedelta(),
                    "score": round(float(w["iforest_score"]), 4),
                    "summary": f"Isolation Forest flagged this 15-minute window (score {w['iforest_score']:.2f}, "
                               f"threshold {config['iforest']['threshold']:.2f}): {', '.join(reasons)}",
                    "reasons": reasons,
                    "counts": {c: int(w[c]) for c in ("event_count", "sensitive_reads", "failed_logins",
                                                       "denied_attempts", "distinct_targets", "rare_role_actions")},
                    "status": "open",
                    "notifiedAt": None,
                    "resolvedBy": None,
                    "resolvedAt": None,
                    "resolution": None,
                    "run": args.run,
                    "createdAt": now,
                    "updatedAt": now,
                }},
                upsert=True,
            )
            raised += int(res.upserted_id is not None)

    print(f"Scored {len(windows)} window(s) from the last {args.hours} h with run {args.run}: "
          f"{len(hits)} flagged by the model, {raised} new alert(s) raised "
          f"({len(hits) - raised} already raised before).")
    if raised:
        print("Admins and auditors will be notified by the backend within ~2 minutes.")


# ---------------------------------------------------------------------------
# Train on real activity (unsupervised; no labels exist in live data)
# ---------------------------------------------------------------------------

def readiness(events: pd.DataFrame, windows: pd.DataFrame) -> list[str]:
    """Reasons live data is not yet enough to learn 'normal' from. Empty = ready."""
    info = describe(events)
    problems = []
    if info.get("days_covered", 0) < MIN_LIVE_DAYS:
        problems.append(f"only {info.get('days_covered', 0)} day(s) of activity (need {MIN_LIVE_DAYS})")
    if info.get("distinct_actors", 0) < MIN_LIVE_ACTORS:
        problems.append(f"only {info.get('distinct_actors', 0)} distinct actor(s) (need {MIN_LIVE_ACTORS})")
    if len(windows) < MIN_LIVE_WINDOWS:
        problems.append(f"only {len(windows)} behaviour window(s) (need {MIN_LIVE_WINDOWS})")
    return problems


def cmd_train(args) -> None:
    events = load_live_events(args.uri, include_seed=False)
    if events.empty:
        raise SystemExit("No real audit events yet.")
    cutoff = events["occurredAt"].min() + (events["occurredAt"].max() - events["occurredAt"].min()) * 0.8
    role_vocab = fit_role_action_vocab(events, before=cutoff)
    windows = build_windows(events, role_vocab=role_vocab)

    problems = readiness(events, windows)
    if problems and not args.force:
        print("Not enough real activity to train on yet:")
        for p in problems:
            print(f"  - {p}")
        print("\nUntil then, train on the simulator (python src/simulate.py, features.py, train.py) and use"
              "\n`python src/live.py score --run <run>` to check real activity against it.")
        raise SystemExit(2)

    # Time split: learn normal on the oldest 80%, keep the newest 20% for review.
    train = windows[windows["window_start"] < cutoff].reset_index(drop=True)
    recent = windows[windows["window_start"] >= cutoff].reset_index(drop=True)
    role_stats = fit_role_stats(train)
    rel_train, rel_recent = role_relative(train, role_stats), role_relative(recent, role_stats)

    model = IsolationForest(n_estimators=300, max_samples=min(2048, len(train)), random_state=SEED, n_jobs=-1)
    model.fit(rel_train[ROLE_RELATIVE_COLUMNS])
    f_train = -model.score_samples(rel_train[ROLE_RELATIVE_COLUMNS])
    b_train = score_baseline(rel_train)
    # No labels: the threshold is the alert budget (share of windows a reviewer can read).
    threshold = float(np.quantile(f_train, 1 - args.alert_rate))
    b_threshold = float(np.quantile(b_train, 1 - args.alert_rate))

    run_id = f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}_{git_commit()}_live"
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, run_dir / "iforest.joblib")
    (run_dir / "role_stats.json").write_text(json.dumps(role_stats, indent=2))
    (run_dir / "role_action_vocab.json").write_text(json.dumps(role_vocab, indent=2))
    config = {
        "run_id": run_id, "tag": "live", "dataset_version": "live", "window": WINDOW,
        "feature_set": "role-relative", "model_features": ROLE_RELATIVE_COLUMNS,
        "trained_on": describe(events), "forced_despite": problems,
        "split_sizes": {"train": len(train), "recent": len(recent)},
        "iforest": {"n_estimators": 300, "max_samples": min(2048, len(train)),
                    "threshold": threshold, "alert_rate": args.alert_rate},
        "baseline": {"counts": BASELINE_COUNTS, "threshold": b_threshold, "alert_rate": args.alert_rate},
    }
    (run_dir / "config.json").write_text(json.dumps(config, indent=2, default=str))
    recent_flags = int((-model.score_samples(rel_recent[ROLE_RELATIVE_COLUMNS]) >= threshold).sum()) if len(recent) else 0
    print(f"Live run: {run_dir}")
    print(f"Trained on {len(train):,} windows; {recent_flags} of {len(recent):,} recent windows flagged.")
    if problems:
        print("WARNING: trained with --force despite: " + "; ".join(problems))


def main() -> None:
    parser = argparse.ArgumentParser(description="Live MzaziCare audit data.")
    parser.add_argument("--uri", default=MONGO_URI)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("export", help="write real audit events to CSV")
    p.add_argument("--include-seed", action="store_true", help="also include imported simulator entries")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("score", help="score real activity with a trained run")
    p.add_argument("--run", required=True)
    p.add_argument("--top", type=int, default=15)
    p.set_defaults(func=cmd_score)

    p = sub.add_parser("alert", help="raise alerts (admins + auditors) for windows the model flags")
    p.add_argument("--run", required=True)
    p.add_argument("--hours", type=float, default=24, help="how far back to score (default 24)")
    p.set_defaults(func=cmd_alert)

    p = sub.add_parser("train", help="train on real activity (refused until enough exists)")
    p.add_argument("--alert-rate", type=float, default=0.0125, help="share of windows to flag (default: sim-v2 choice)")
    p.add_argument("--force", action="store_true", help="train even if below the minimums (not for real use)")
    p.set_defaults(func=cmd_train)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
