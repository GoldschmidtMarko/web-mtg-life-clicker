"""Best-effort usage analytics: aggregate summary counters + per-day buckets.

Every write is wrapped in try/except so analytics never blocks or fails the
calling function. Written by the backend only (Admin SDK bypasses rules).

Firestore layout:
  usage/summary               aggregate counters, each *_authed / *_anon / *_total
  usage_daily/{YYYY-MM-DD}    per-day counts (count + count_authed / count_anon)
  lobby_events/{autoId}       one doc per lobby create/join, for the admin
                               dashboard's recent-activity table (exact
                               timestamps). Not yet pruned - see the
                               cleanupOldLobbies note about folding this in.
"""

from datetime import datetime, timezone

from firebase_admin import firestore

from .firebase_app import db


def _suffix(authed):
    return "authed" if authed else "anon"


def _bump_daily(authed):
    """One usage action -> one increment on usage_daily/{YYYY-MM-DD} (UTC), so
    the admin dashboard can plot activity over time."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        db.collection("usage_daily").document(day).set({
            "date": day,
            "count": firestore.Increment(1),
            f"count_{_suffix(authed)}": firestore.Increment(1),
        }, merge=True)
    except Exception as error:
        print(f"analytics daily error: {error}")


def bump_summary(fields, authed):
    """Increment named counters on usage/summary (each *_authed/_anon/_total)
    plus the per-day usage bucket. Call once per user action."""
    payload = {}
    for f in fields:
        payload[f"{f}_{_suffix(authed)}"] = firestore.Increment(1)
        payload[f"{f}_total"] = firestore.Increment(1)
    try:
        db.collection("usage").document("summary").set(payload, merge=True)
    except Exception as error:
        print(f"analytics summary error: {error}")
    _bump_daily(authed)


def log_lobby_event(event_type, lobby_id, player_name, authed):
    """Records one lobby create/join with an exact timestamp, for the admin
    dashboard's recent-activity table (bump_summary only keeps counts)."""
    try:
        db.collection("lobby_events").add({
            "type": event_type,
            "lobbyId": lobby_id,
            "playerName": player_name,
            "authed": authed,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    except Exception as error:
        print(f"analytics lobby event error: {error}")
