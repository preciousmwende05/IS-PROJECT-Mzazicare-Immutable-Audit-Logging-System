"""
Shared settings for the audit anomaly pipeline (U-CS 78, Layer 2).

Everything that affects a result lives here, so every run is reproducible and
every number in Chapter 5 can be traced back to one place.
"""

from pathlib import Path

# ---------- folders ----------
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MODELS_DIR = ROOT / "models"
RUNS_DIR = ROOT / "runs"

# ---------- reproducibility ----------
SEED = 42
# Bump when simulate.py logic changes.
#   v1: 128 users.  v2: 620 users.
#   v3: live MzaziCare vocabulary (visit.requested/assigned, access.denied, user.role.changed ...),
#       auditor role, anonymous failed logins keyed by phone, denied_attempts feature.
DATASET_VERSION = "sim-v3"
LOCAL_TZ = "Africa/Nairobi"         # behaviour (e.g. "3 a.m.") is judged in local time

# ---------- simulation span and time-based split ----------
SIM_START = "2026-08-03"            # a Monday
SIM_WEEKS = 6
TRAIN_WEEKS = 4                     # oldest data: model learns "normal" here
VAL_WEEKS = 1                       # next: choose settings (e.g. contamination)
TEST_WEEKS = 1                      # newest: final evaluation, used ONCE
INCIDENTS_PER_WEEK = 100            # planted incidents; keeps ~1% of windows anomalous

# ---------- behaviour windows ----------
WINDOW = "15min"                    # one feature row per user per 15 minutes

# ---------- roles and users ----------
# "anonymous" is not a person: it is a refused sign-in before anyone is known.
# Live entries for it are keyed by the phone that was tried (see live.py).
ROLES = ["family", "caregiver", "coordinator", "admin", "auditor"]
USERS_PER_ROLE = {"family": 400, "caregiver": 200, "coordinator": 15, "admin": 5, "auditor": 3}
N_ELDERS = 400                      # elders on the platform (records, not app users)

# An action is "rare for a role" if it makes up less than this share of that
# role's events in the TRAINING weeks. Learned from data, never hand-listed.
RARE_ACTION_SHARE = 0.005

# ---------- action vocabulary (matches what the live backend emits) ----------
LOGIN_ACTION = "user.logged_in"
FAILED_LOGIN_ACTIONS = {"auth.login.failed"}

# A refused request: 403 anywhere, or a hidden 404 on an elder outside your care
# circle. The main snooping signal.
DENIED_ACTIONS = {"access.denied"}

# Reads of personal, medical or security data, and privileged account changes.
SENSITIVE_ACTIONS = {
    "careplan.viewed",
    "careplan.history.viewed",
    "elder.brief.viewed",
    "emergencycontacts.viewed",
    "carecircle.viewed",
    "caregiver.document.accessed",
    "audit.log.listed",
    "audit.entry.viewed",
    "user.status.changed",
    "user.role.changed",
    "user.deactivated",
}

# Live entries written before the event names were aligned with the spec
# (2026-11-05) use older names. Mapping them keeps one name per behaviour.
LEGACY_ACTION_ALIASES = {
    "auth.login": "user.logged_in",
    "auth.status_changed": "user.status.changed",
    "elder.brief_viewed": "elder.brief.viewed",
    "elder.care_plan.viewed": "careplan.viewed",
    "elder.care_plan.updated": "careplan.updated",
    "elder.emergency_contact.created": "emergencycontact.added",
    "elder.care_circle.invited": "carecircle.member.invited",
    "elder.care_circle.member_added": "carecircle.member.added",
    "elder.care_circle.member_updated": "carecircle.member.updated",
    "elder.care_circle.member_removed": "carecircle.member.removed",
    "booking.created": "visit.requested",
    "booking.assigned": "visit.assigned",
    "booking.cancelled": "visit.cancelled",
}

# ---------- policy rules (hybrid = Isolation Forest OR these) ----------
# Hard alerts no honest window reaches. Chosen on train/val (sim-v3: zero normal
# windows hit either rule in 41,696), never on test. 5 failed logins also matches
# the backend's account lock (MAX_LOGIN_ATTEMPTS).
POLICY_RULES = {"denied_attempts": 3, "failed_logins": 5}

# ---------- live data ----------
MONGO_URI = "mongodb://localhost:27017"
MONGO_DB = "mzazicare"
AUDIT_COLLECTION = "auditlogs"      # the audit-service model's collection name
# Where `live.py alert` raises alerts. The backend audit worker notifies admins
# and auditors about every new one (audit-service models/audit-anomaly.model.ts).
ANOMALY_COLLECTION = "audit_anomalies"
# Training on live data is refused below these sizes: too little real activity
# teaches the model the quirks of a handful of people, not what normal looks like.
MIN_LIVE_DAYS = 14
MIN_LIVE_ACTORS = 50
MIN_LIVE_WINDOWS = 2000

# ---------- features the model sees (order matters, keep fixed) ----------
FEATURE_COLUMNS = [
    "event_count",
    "distinct_actions",
    "distinct_targets",
    "sensitive_reads",
    "failed_logins",
    "denied_attempts",
    "distinct_ips",
    "rare_role_actions",
    "hour_sin",
    "hour_cos",
    "is_weekend",
    "role_family",
    "role_caregiver",
    "role_coordinator",
    "role_admin",
    "role_auditor",
]
