"""
Role-relative features, fitted on the TRAIN split only and reused unchanged on
val, test and (later) live data.

Why: comparing everyone against everyone makes rare-but-normal roles (admins,
coordinators) look suspicious. Comparing each window against its OWN role's
normal level removes that bias:

  rz_<count>   = (count - role median) / role spread     ("how unusual for this role")
  hour_rarity  = -log P(hour | role) from training weeks  ("how unusual a time for this role")
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from config import LOCAL_TZ

COUNT_COLUMNS = [
    "event_count",
    "distinct_actions",
    "distinct_targets",
    "sensitive_reads",
    "failed_logins",
    "denied_attempts",
    "distinct_ips",
    "rare_role_actions",
]
ROLE_RELATIVE_COLUMNS = [f"rz_{c}" for c in COUNT_COLUMNS] + ["hour_rarity", "is_weekend"]
FALLBACK = "_all"  # used for a role never seen in training


def _local_hour(windows: pd.DataFrame) -> np.ndarray:
    ts = pd.to_datetime(windows["window_start"], utc=True).dt.tz_convert(LOCAL_TZ)
    return ts.dt.hour.to_numpy()


def fit_role_stats(train: pd.DataFrame) -> dict:
    """Per-role medians, spreads and hour-of-day frequencies, from training rows only."""
    hours = _local_hour(train)
    roles = train["actorRole"].to_numpy()
    # Positional masks, not index labels: works whatever the caller's index is.
    groups = {role: (roles == role) for role in pd.unique(roles)}
    groups[FALLBACK] = np.ones(len(train), dtype=bool)
    stats: dict[str, dict] = {}
    for role, mask in groups.items():
        rows = train.loc[mask]
        counts = {}
        for col in COUNT_COLUMNS:
            values = rows[col].to_numpy(dtype=float)
            median = float(np.median(values))
            mad = float(np.median(np.abs(values - median)))
            # Floor the spread so a count that is almost always 0 or 1 cannot explode.
            counts[col] = {"median": median, "spread": max(1.4826 * mad, 1.0)}
        role_hours = hours[mask]
        hist = np.bincount(role_hours, minlength=24).astype(float) + 1.0  # Laplace smoothing
        stats[role] = {"counts": counts, "hour_prob": (hist / hist.sum()).tolist()}
    return stats


def role_relative(windows: pd.DataFrame, stats: dict) -> pd.DataFrame:
    """Apply fitted statistics. Never refits: safe for val, test and live data."""
    out = pd.DataFrame(index=windows.index)
    roles = windows["actorRole"].where(windows["actorRole"].isin(stats), FALLBACK)
    hours = _local_hour(windows)

    for col in COUNT_COLUMNS:
        median = roles.map(lambda r: stats[r]["counts"][col]["median"]).to_numpy()
        spread = roles.map(lambda r: stats[r]["counts"][col]["spread"]).to_numpy()
        out[f"rz_{col}"] = (windows[col].to_numpy(dtype=float) - median) / spread

    hour_prob = np.array([stats[r]["hour_prob"][h] for r, h in zip(roles, hours)])
    out["hour_rarity"] = -np.log(hour_prob)
    out["is_weekend"] = windows["is_weekend"].to_numpy()
    return out
