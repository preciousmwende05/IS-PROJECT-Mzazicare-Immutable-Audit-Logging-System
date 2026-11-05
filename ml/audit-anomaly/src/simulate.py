"""
Simulate MzaziCare audit activity: realistic normal behaviour per role plus
labelled, planted incidents.

Why simulate: the platform has no real users yet (cold start). Labels are kept
ONLY for evaluation; the Isolation Forest never sees them during training.

Run from ml/audit-anomaly:
    python src/simulate.py
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from config import (
    DATASET_VERSION,
    DENIED_ACTIONS,
    FAILED_LOGIN_ACTIONS,
    INCIDENTS_PER_WEEK,
    LOCAL_TZ,
    LOGIN_ACTION,
    N_ELDERS,
    RAW_DIR,
    SEED,
    SIM_START,
    SIM_WEEKS,
    USERS_PER_ROLE,
)

FAILED_LOGIN = next(iter(FAILED_LOGIN_ACTIONS))
DENIED = next(iter(DENIED_ACTIONS))

# ---------------------------------------------------------------------------
# Role habits (assumptions, documented for Chapter 5)
# ---------------------------------------------------------------------------

# Relative likelihood of starting a session in each hour 0..23 (local time).
HOUR_WEIGHTS = {
    "family":      [0,0,0,0,0,0,1,3,3,2,1,1,2,1,1,1,2,4,6,7,6,4,2,1],
    "caregiver":   [0,0,0,0,0,1,3,6,6,5,4,4,4,4,4,5,5,4,2,1,1,0,0,0],
    "coordinator": [0,0,0,0,0,0,0,2,6,7,7,6,4,6,6,6,5,2,1,0,0,0,0,0],
    "admin":       [0,0,0,0,0,0,0,1,5,7,7,6,4,6,6,5,4,2,0,0,0,0,0,0],
    "auditor":     [0,0,0,0,0,0,0,0,4,7,7,6,3,6,6,5,3,1,0,0,0,0,0,0],
}

# (probability active on a weekday, on a weekend day)
ACTIVE_PROB = {
    "family": (0.45, 0.60),
    "caregiver": (0.80, 0.60),
    "coordinator": (0.95, 0.10),
    "admin": (0.90, 0.05),
    "auditor": (0.85, 0.02),
}

SESSIONS_PER_DAY = {"family": (1, 2), "caregiver": (2, 4), "coordinator": (2, 4), "admin": (1, 3), "auditor": (1, 2)}
EVENTS_PER_SESSION_MEAN = {"family": 4, "caregiver": 6, "coordinator": 10, "admin": 6, "auditor": 6}

# Only actions the live backend actually emits (see Mzazicare-backend *.routes.ts).
ACTION_WEIGHTS = {
    "family": {
        "elder.viewed": 4, "careplan.viewed": 2, "emergencycontacts.viewed": 0.5,
        "carecircle.viewed": 0.5, "visit.requested": 0.8, "visit.cancelled": 0.1,
        "careplan.updated": 0.3, "elder.updated": 0.2, "emergencycontact.added": 0.1,
        "carecircle.member.invited": 0.1,
    },
    "caregiver": {
        "elder.brief.viewed": 3, "careplan.viewed": 2, "elder.viewed": 1,
        "booking.accepted": 0.8, "booking.declined": 0.2,
        "visit.checked_in": 1, "visit.checked_out": 1,
    },
    "coordinator": {
        "elder.viewed": 2, "careplan.viewed": 1, "visit.assigned": 1.5,
        "caregiver.document.accessed": 2, "caregiver.document.reviewed": 1,
        "caregiver.review.started": 0.5, "caregiver.approved": 0.5,
        "emergency.acknowledged": 0.3, "visit.dispute_resolved": 0.2,
    },
    "admin": {
        "audit.log.listed": 2, "audit.chain.verified": 1, "audit.entry.viewed": 0.5,
        "user.status.changed": 0.6, "user.role.changed": 0.2, "user.deactivated": 0.2,
        "caregiver.suspended": 0.2, "catalog.service.updated": 0.3,
    },
    "auditor": {
        "audit.log.listed": 4, "audit.entry.viewed": 3, "audit.chain.verified": 1,
    },
}

# Honest refusals in normal use: an old link, a booking that just ended.
NORMAL_DENIAL_PER_SESSION = {"family": 0.02, "caregiver": 0.04, "coordinator": 0.01, "admin": 0.005, "auditor": 0.01}

# Staff-only pages a family account has no business opening (live: 403 -> access.denied).
STAFF_ONLY_PATHS = ["/v1/auth/users", "/v1/audit", "/v1/caregivers", "/v1/audit/verify"]


def target_type_for(action: str) -> str | None:
    """Which kind of record an action is filed under (mirrors the backend's audit tagging)."""
    if action in ("visit.requested", DENIED) or action.startswith(
            ("elder.", "careplan.", "emergencycontact", "carecircle.")):
        return "elder"
    if action in ("visit.assigned", "visit.cancelled") or action.startswith("booking."):
        return "booking"
    if action.startswith("visit."):
        return "visit"
    if action.startswith("caregiver."):
        return "caregiver"
    if action.startswith("user."):
        return "user"
    return None


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@dataclass
class User:
    user_id: str
    role: str
    ips: list[str]
    pools: dict[str, list[str]] = field(default_factory=dict)


def random_ip(rng: np.random.Generator) -> str:
    a, b, c = rng.integers(0, 256, size=3)
    return f"10.{a}.{b}.{c}"


def build_users(rng: np.random.Generator) -> list[User]:
    elders = [f"eld_{i:04d}" for i in range(N_ELDERS)]
    caregiver_ids = [f"caregiver_{i:03d}" for i in range(USERS_PER_ROLE["caregiver"])]
    users: list[User] = []

    for role, count in USERS_PER_ROLE.items():
        for i in range(count):
            uid = f"{role}_{i:03d}"
            ips = [random_ip(rng) for _ in range(2)]  # home + mobile
            if role == "family":
                elder_pool = list(rng.choice(elders, size=rng.integers(1, 3), replace=False))
            elif role == "caregiver":
                elder_pool = list(rng.choice(elders, size=rng.integers(3, 7), replace=False))
            else:
                elder_pool = list(rng.choice(elders, size=30, replace=False))
            pools = {
                "elder": elder_pool,
                "booking": [f"bkg_{uid}_{j}" for j in range(6)],
                "visit": [f"vst_{uid}_{j}" for j in range(8)],
                "caregiver": caregiver_ids if role in ("coordinator", "admin") else [uid],
                "user": [f"family_{j:03d}" for j in range(USERS_PER_ROLE["family"])],
            }
            users.append(User(uid, role, ips, pools))
    return users


def make_event(ts: pd.Timestamp, user: User, action: str, rng: np.random.Generator,
               ip: str | None = None, target_id: str | None = None,
               anomaly_type: str = "") -> dict:
    ttype = target_type_for(action)
    if target_id is None and ttype is not None:
        target_id = str(rng.choice(user.pools[ttype]))
    return {
        "occurredAt": ts,
        "actorId": user.user_id,
        "actorRole": user.role,
        "action": action,
        "targetType": ttype,
        "targetId": target_id,
        "ip": ip or user.ips[0],
        "is_anomaly": int(bool(anomaly_type)),
        "anomaly_type": anomaly_type,
    }


def failed_login(ts: pd.Timestamp, user: User, ip: str, anomaly_type: str = "") -> dict:
    """A refused sign-in, exactly as the live log records it: nobody is signed in
    yet, so the actor is anonymous and the entry is keyed by the phone tried."""
    return {
        "occurredAt": ts,
        "actorId": f"phone:{user.user_id}",
        "actorRole": "anonymous",
        "action": FAILED_LOGIN,
        "targetType": None,
        "targetId": None,
        "ip": ip,
        "is_anomaly": int(bool(anomaly_type)),
        "anomaly_type": anomaly_type,
    }


def any_elder(rng: np.random.Generator) -> str:
    return f"eld_{int(rng.integers(0, N_ELDERS)):04d}"


# ---------------------------------------------------------------------------
# Normal behaviour
# ---------------------------------------------------------------------------

def normal_sessions(user: User, day: pd.Timestamp, rng: np.random.Generator) -> list[dict]:
    weekday_p, weekend_p = ACTIVE_PROB[user.role]
    p_active = weekend_p if day.dayofweek >= 5 else weekday_p
    if rng.random() > p_active:
        return []

    hour_w = np.array(HOUR_WEIGHTS[user.role], dtype=float)
    hour_p = hour_w / hour_w.sum()
    actions = list(ACTION_WEIGHTS[user.role])
    act_w = np.array(list(ACTION_WEIGHTS[user.role].values()), dtype=float)
    act_p = act_w / act_w.sum()

    events: list[dict] = []
    lo, hi = SESSIONS_PER_DAY[user.role]
    for _ in range(rng.integers(lo, hi + 1)):
        hour = rng.choice(24, p=hour_p)
        ts = day + pd.Timedelta(hours=int(hour), minutes=int(rng.integers(0, 60)))
        ip = user.ips[1] if rng.random() < 0.10 else user.ips[0]

        if rng.random() < 0.04:  # an honest typo before logging in
            events.append(failed_login(ts, user, ip))
            ts += pd.Timedelta(seconds=int(rng.integers(5, 40)))
        events.append(make_event(ts, user, LOGIN_ACTION, rng, ip=ip))

        n = max(1, rng.poisson(EVENTS_PER_SESSION_MEAN[user.role]))
        for _ in range(n):
            ts += pd.Timedelta(seconds=int(rng.exponential(90)) + 5)
            events.append(make_event(ts, user, str(rng.choice(actions, p=act_p)), rng, ip=ip))

        if rng.random() < NORMAL_DENIAL_PER_SESSION[user.role]:  # an honest refusal
            ts += pd.Timedelta(seconds=int(rng.integers(5, 60)))
            events.append(make_event(ts, user, DENIED, rng, ip=ip, target_id=any_elder(rng)))
    return events


# ---------------------------------------------------------------------------
# Planted incidents (labelled; used only for evaluation)
# ---------------------------------------------------------------------------

def _start(day: pd.Timestamp, hour: int, rng: np.random.Generator) -> pd.Timestamp:
    # Start just after a quarter hour so most of an incident lands in one window.
    quarter = int(rng.integers(0, 4)) * 15
    return day + pd.Timedelta(hours=hour, minutes=quarter + int(rng.integers(0, 3)))


def incident_snooping(users, day, rng):
    """Caregiver tries to open many elders that are not theirs. The live system
    hides each refusal behind a 404 but records it as access.denied; the few
    elders they really care for open normally."""
    user = rng.choice([u for u in users if u.role == "caregiver"])
    ts = _start(day, int(rng.integers(9, 17)), rng)
    others = [f"eld_{i:04d}" for i in range(N_ELDERS)]
    targets = rng.choice(others, size=int(rng.integers(25, 51)), replace=False)
    out = [make_event(ts, user, LOGIN_ACTION, rng, anomaly_type="snooping")]
    for t in targets:
        ts += pd.Timedelta(seconds=int(rng.integers(5, 20)))
        if str(t) in user.pools["elder"] or rng.random() < 0.2:
            action = str(rng.choice(["elder.brief.viewed", "careplan.viewed"]))
        else:
            action = DENIED
        out.append(make_event(ts, user, action, rng, target_id=str(t), anomaly_type="snooping"))
    return out


def incident_credential_stuffing(users, day, rng):
    """Many failed logins against one account, from unfamiliar IPs."""
    user = rng.choice([u for u in users if u.role in ("family", "caregiver")])
    ts = _start(day, int(rng.integers(0, 24)), rng)
    attacker_ips = [random_ip(rng) for _ in range(int(rng.integers(1, 4)))]
    out = []
    for _ in range(int(rng.integers(15, 41))):
        ts += pd.Timedelta(seconds=int(rng.integers(3, 15)))
        out.append(failed_login(ts, user, str(rng.choice(attacker_ips)), anomaly_type="credential_stuffing"))
    if rng.random() < 0.5:  # sometimes the attacker gets in
        out.append(make_event(ts + pd.Timedelta(seconds=4), user, LOGIN_ACTION, rng,
                              ip=attacker_ips[0], anomaly_type="credential_stuffing"))
    return out


def incident_night_admin(users, day, rng):
    """Privileged account active in the small hours, reading sensitive data."""
    user = rng.choice([u for u in users if u.role in ("coordinator", "admin")])
    ts = _start(day, int(rng.integers(1, 5)), rng)
    actions = ["caregiver.document.accessed", "audit.log.listed", "caregiver.approved",
               "user.status.changed", "user.role.changed", "user.deactivated"]
    out = [make_event(ts, user, LOGIN_ACTION, rng, anomaly_type="night_admin")]
    for _ in range(int(rng.integers(10, 26))):
        ts += pd.Timedelta(seconds=int(rng.integers(10, 40)))
        out.append(make_event(ts, user, str(rng.choice(actions)), rng, anomaly_type="night_admin"))
    return out


def incident_burst_script(users, day, rng):
    """An automated script hammering the API through a family account."""
    user = rng.choice([u for u in users if u.role == "family"])
    ts = _start(day, int(rng.integers(0, 24)), rng)
    out = [make_event(ts, user, LOGIN_ACTION, rng, anomaly_type="burst_script")]
    for _ in range(int(rng.integers(80, 151))):
        ts += pd.Timedelta(seconds=int(rng.integers(1, 6)))
        action = str(rng.choice(["elder.viewed", "careplan.viewed"]))
        out.append(make_event(ts, user, action, rng, anomaly_type="burst_script"))
    return out


def incident_multi_ip(users, day, rng):
    """One account used from many places within minutes (shared or stolen session)."""
    user = rng.choice(users)
    ts = _start(day, int(rng.integers(8, 21)), rng)
    ips = [random_ip(rng) for _ in range(int(rng.integers(4, 7)))]
    actions = list(ACTION_WEIGHTS[user.role])
    out = []
    for i in range(int(rng.integers(8, 16))):
        ts += pd.Timedelta(seconds=int(rng.integers(20, 60)))
        action = LOGIN_ACTION if i % 3 == 0 else str(rng.choice(actions))
        out.append(make_event(ts, user, action, rng, ip=ips[i % len(ips)], anomaly_type="multi_ip"))
    return out


def incident_role_violation(users, day, rng):
    """A family account probing staff-only pages (user list, audit log, caregiver
    files). The live system refuses each with a 403, recorded as access.denied
    with no elder attached. Subtle on purpose: few events."""
    user = rng.choice([u for u in users if u.role == "family"])
    ts = _start(day, int(rng.integers(8, 22)), rng)
    out = [make_event(ts, user, LOGIN_ACTION, rng, anomaly_type="role_violation")]
    for _ in range(int(rng.integers(3, 9))):
        ts += pd.Timedelta(seconds=int(rng.integers(15, 60)))
        event = make_event(ts, user, DENIED, rng, anomaly_type="role_violation")
        event["targetType"], event["targetId"] = None, None
        event["path"] = str(rng.choice(STAFF_ONLY_PATHS))
        out.append(event)
    return out


INCIDENTS = {
    "snooping": incident_snooping,
    "credential_stuffing": incident_credential_stuffing,
    "night_admin": incident_night_admin,
    "burst_script": incident_burst_script,
    "multi_ip": incident_multi_ip,
    "role_violation": incident_role_violation,
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def simulate(seed: int = SEED, weeks: int = SIM_WEEKS, incidents_per_week: int = INCIDENTS_PER_WEEK) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    users = build_users(rng)
    days = pd.date_range(SIM_START, periods=weeks * 7, freq="D")

    events: list[dict] = []
    for day in days:
        for user in users:
            events.extend(normal_sessions(user, day, rng))

    names = list(INCIDENTS)
    for _ in range(weeks * incidents_per_week):
        day = days[int(rng.integers(0, len(days)))]
        events.extend(INCIDENTS[str(rng.choice(names))](users, day, rng))

    df = pd.DataFrame(events)
    # Simulated clock is Nairobi local time; store UTC like the real database.
    df["occurredAt"] = (
        pd.to_datetime(df["occurredAt"]).dt.tz_localize(LOCAL_TZ).dt.tz_convert("UTC")
    )
    return df.sort_values("occurredAt").reset_index(drop=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate MzaziCare audit activity.")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--weeks", type=int, default=SIM_WEEKS)
    parser.add_argument("--incidents-per-week", type=int, default=INCIDENTS_PER_WEEK)
    args = parser.parse_args()

    df = simulate(args.seed, args.weeks, args.incidents_per_week)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out_csv = RAW_DIR / f"audit_events_{DATASET_VERSION}.csv"
    df.to_csv(out_csv, index=False)

    meta = {
        "dataset_version": DATASET_VERSION,
        "seed": args.seed,
        "weeks": args.weeks,
        "incidents_per_week": args.incidents_per_week,
        "events": int(len(df)),
        "anomalous_events": int(df["is_anomaly"].sum()),
        "events_by_incident": df.loc[df["is_anomaly"] == 1, "anomaly_type"].value_counts().to_dict(),
        "users_by_role": USERS_PER_ROLE,
    }
    (RAW_DIR / f"audit_events_{DATASET_VERSION}.meta.json").write_text(json.dumps(meta, indent=2))

    print(f"Wrote {len(df):,} events to {out_csv}")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
