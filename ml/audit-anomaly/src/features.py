"""
Turn audit events into behaviour windows (one row per user per WINDOW) and
split them by time into train / val / test.

Why windows: a single action says little; suspicious behaviour is a pattern.
Why a time split: in production the model always scores the future using what
it learned from the past, so evaluation must respect time order (no leakage).

Run from ml/audit-anomaly:
    python src/features.py
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd

from config import (
    AUDIT_COLLECTION,
    DATASET_VERSION,
    DENIED_ACTIONS,
    FAILED_LOGIN_ACTIONS,
    MONGO_DB,
    FEATURE_COLUMNS,
    LOCAL_TZ,
    PROCESSED_DIR,
    RARE_ACTION_SHARE,
    RAW_DIR,
    ROLES,
    SENSITIVE_ACTIONS,
    SIM_START,
    TEST_WEEKS,
    TRAIN_WEEKS,
    VAL_WEEKS,
    WINDOW,
)


def split_boundaries(start: str = SIM_START) -> tuple[pd.Timestamp, pd.Timestamp, pd.Timestamp]:
    """UTC end of the train, val and test periods."""
    t0 = pd.Timestamp(start).tz_localize(LOCAL_TZ).tz_convert("UTC")
    train_end = t0 + pd.Timedelta(weeks=TRAIN_WEEKS)
    val_end = train_end + pd.Timedelta(weeks=VAL_WEEKS)
    test_end = val_end + pd.Timedelta(weeks=TEST_WEEKS)
    return train_end, val_end, test_end


def fit_role_action_vocab(events: pd.DataFrame, before: pd.Timestamp,
                          min_share: float = RARE_ACTION_SHARE) -> dict[str, list[str]]:
    """Learn which actions are ordinary for each role, from TRAINING weeks only.

    An action is ordinary for a role if it is at least `min_share` of that role's
    events. Planted incidents are a tiny share, so they do not become "ordinary".
    """
    df = events.copy()
    df["occurredAt"] = pd.to_datetime(df["occurredAt"], utc=True)
    df = df[df["occurredAt"] < before]
    shares = df.groupby("actorRole")["action"].value_counts(normalize=True)
    vocab: dict[str, list[str]] = {}
    for (role, action), share in shares.items():
        if share >= min_share:
            vocab.setdefault(role, []).append(action)
    return {role: sorted(actions) for role, actions in vocab.items()}


def build_windows(events: pd.DataFrame, window: str = WINDOW,
                  role_vocab: dict[str, list[str]] | None = None) -> pd.DataFrame:
    """Aggregate raw events into one feature row per (actor, window)."""
    df = events.copy()
    df["occurredAt"] = pd.to_datetime(df["occurredAt"], utc=True)
    df["window_start"] = df["occurredAt"].dt.floor(window)
    df["is_sensitive"] = df["action"].isin(SENSITIVE_ACTIONS)
    df["is_failed_login"] = df["action"].isin(FAILED_LOGIN_ACTIONS)
    df["is_denied"] = df["action"].isin(DENIED_ACTIONS)
    df["actorRole"] = df["actorRole"].fillna("unknown")
    # groupby drops rows whose key is missing. A refused sign-in has no actor, so
    # without this every failed login (the credential-stuffing signal) vanished.
    df["actorId"] = df["actorId"].fillna("anonymous")
    if role_vocab is None:
        df["is_rare_for_role"] = False
    else:
        ordinary = {role: set(actions) for role, actions in role_vocab.items()}
        df["is_rare_for_role"] = [
            action not in ordinary.get(role, set())
            for role, action in zip(df["actorRole"], df["action"])
        ]

    grouped = df.groupby(["actorId", "actorRole", "window_start"])
    windows = grouped.agg(
        event_count=("action", "size"),
        distinct_actions=("action", "nunique"),
        distinct_targets=("targetId", "nunique"),   # NaN targets are ignored
        sensitive_reads=("is_sensitive", "sum"),
        failed_logins=("is_failed_login", "sum"),
        denied_attempts=("is_denied", "sum"),
        distinct_ips=("ip", "nunique"),
        rare_role_actions=("is_rare_for_role", "sum"),
    ).reset_index()

    # Labels exist only in simulated data; they are never used for training.
    if "is_anomaly" in df.columns:
        labels = grouped.agg(
            is_anomaly=("is_anomaly", "max"),
            anomaly_type=("anomaly_type", lambda s: next((x for x in s if isinstance(x, str) and x), "")),
        ).reset_index(drop=True)
        windows = pd.concat([windows, labels], axis=1)

    # Time of day in local time, encoded on a circle so 23:00 and 00:00 are close.
    local = windows["window_start"].dt.tz_convert(LOCAL_TZ)
    hour = local.dt.hour + local.dt.minute / 60
    windows["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    windows["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    windows["is_weekend"] = (local.dt.dayofweek >= 5).astype(int)

    # One-hot role. An unknown role gets all zeros rather than crashing.
    for role in ROLES:
        windows[f"role_{role}"] = (windows["actorRole"] == role).astype(int)

    int_cols = ["event_count", "distinct_actions", "distinct_targets", "sensitive_reads",
                "failed_logins", "denied_attempts", "distinct_ips", "rare_role_actions"]
    windows[int_cols] = windows[int_cols].astype(int)
    return windows.sort_values("window_start").reset_index(drop=True)


def assign_time_split(windows: pd.DataFrame, start: str = SIM_START) -> pd.DataFrame:
    """Label each window train / val / test by date only (never by random shuffle)."""
    train_end, val_end, test_end = split_boundaries(start)
    ts = windows["window_start"]
    out = windows.copy()
    out["split"] = np.select(
        [ts < train_end, ts < val_end, ts < test_end],
        ["train", "val", "test"],
        default="out_of_range",
    )
    return out


def load_events_from_mongo(uri: str, db: str = MONGO_DB, collection: str = AUDIT_COLLECTION) -> pd.DataFrame:
    """Read real sealed entries. Read-only: never writes to the log.

    Kept for backwards compatibility; live.py's export does the full mapping
    (legacy names, anonymous sign-ins, seed filtering) and should be preferred.
    """
    from live import load_live_events

    return load_live_events(uri=uri, db=db, collection=collection)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build behaviour windows and time splits.")
    parser.add_argument("--events", default=str(RAW_DIR / f"audit_events_{DATASET_VERSION}.csv"))
    args = parser.parse_args()

    events = pd.read_csv(args.events)
    train_end, _, _ = split_boundaries()
    role_vocab = fit_role_action_vocab(events, before=train_end)   # training weeks only
    windows = assign_time_split(build_windows(events, role_vocab=role_vocab))
    # Sessions running past the last midnight fall outside every split; drop them.
    dropped = int((windows["split"] == "out_of_range").sum())
    windows = windows[windows["split"] != "out_of_range"].reset_index(drop=True)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    (PROCESSED_DIR / f"role_action_vocab_{DATASET_VERSION}.json").write_text(json.dumps(role_vocab, indent=2))
    out_csv = PROCESSED_DIR / f"windows_{DATASET_VERSION}.csv"
    windows.to_csv(out_csv, index=False)

    summary = (
        windows.groupby("split")
        .agg(windows=("event_count", "size"), anomalous=("is_anomaly", "sum"))
        .assign(anomaly_rate=lambda d: (d["anomalous"] / d["windows"]).round(4))
    )
    print(f"Wrote {len(windows):,} windows to {out_csv}")
    print(f"Dropped {dropped} window(s) outside the split range")
    print(f"Features ({len(FEATURE_COLUMNS)}): {FEATURE_COLUMNS}")
    print(summary.to_string())
    (PROCESSED_DIR / f"windows_{DATASET_VERSION}.summary.json").write_text(
        json.dumps(summary.reset_index().to_dict(orient="records"), indent=2)
    )


if __name__ == "__main__":
    main()
