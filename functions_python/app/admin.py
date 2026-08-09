"""Admin-only usage dashboard (getUsageStats).

Returns the analytics written by app.analytics (usage/summary + usage_daily) and
a small users overview. Gated to a fixed allow-list of admin emails (with a
bypass under the local Functions emulator) and reads via the Admin SDK, so the
Firestore rules stay locked and the client never touches the usage collections.
"""

import os

from firebase_admin import firestore
from firebase_functions import https_fn

from .common import Err, authenticate_user
from .firebase_app import db
from .warmup import with_warmup

# Emails allowed to view the usage dashboard.
ADMIN_EMAILS = {"mgoldschmidt01@gmail.com", "ma.goldschmidt@web.de"}


def _is_emulator() -> bool:
    """True under the local Functions emulator (sets FUNCTIONS_EMULATOR=true),
    where any signed-in account may view the dashboard for development."""
    return os.environ.get("FUNCTIONS_EMULATOR", "").lower() == "true"


def _is_admin(request) -> bool:
    if _is_emulator():
        return True
    token = (request.auth.token or {}) if request.auth else {}
    email = (token.get("email") or "").lower()
    return bool(email) and email in {e.lower() for e in ADMIN_EMAILS}


def _ms(ts):
    """Firestore timestamp -> epoch millis (JSON-safe), or None."""
    if ts is None:
        return None
    try:
        return int(ts.timestamp() * 1000)
    except Exception:
        return None


def _daily_series(limit=120):
    """Per-day usage counts (from usage_daily), oldest first, for the timeline."""
    out = []
    try:
        q = (db.collection("usage_daily")
               .order_by("date", direction=firestore.Query.DESCENDING)
               .limit(limit))
        for doc in q.stream():
            d = doc.to_dict() or {}
            out.append({
                "date": d.get("date") or doc.id,
                "count": d.get("count", 0),
                "count_authed": d.get("count_authed", 0),
                "count_anon": d.get("count_anon", 0),
            })
        out.reverse()  # oldest -> newest for plotting
    except Exception as error:
        print(f"usage _daily_series error: {error}")
    return out


def _users_overview(limit=15):
    """Total registered players + the most active by login count."""
    result = {"total": 0, "top": []}
    try:
        rows = []
        for doc in db.collection("players").stream():
            d = doc.to_dict() or {}
            rows.append({
                "name": d.get("name") or "",
                "email": d.get("email") or "",
                "loginCount": d.get("loginCount", 0),
                "lastLogin": _ms(d.get("lastLogin")),
                "registrationDate": _ms(d.get("registrationDate")),
            })
        result["total"] = len(rows)
        rows.sort(key=lambda r: r["loginCount"], reverse=True)
        result["top"] = rows[:limit]
    except Exception as error:
        print(f"usage _users_overview error: {error}")
    return result


def _feedback_list(limit=100):
    """Most recent feedback submissions (newest first)."""
    out = []
    try:
        q = (db.collection("feedback")
               .order_by("createdAt", direction=firestore.Query.DESCENDING)
               .limit(limit))
        for doc in q.stream():
            d = doc.to_dict() or {}
            out.append({
                "message": d.get("message") or "",
                "userName": d.get("userName"),
                "userId": d.get("userId"),
                "createdAt": _ms(d.get("createdAt")),
            })
    except Exception as error:
        print(f"usage _feedback_list error: {error}")
    return out


@https_fn.on_call()
@with_warmup("getUsageStats")
def getUsageStats(request: https_fn.CallableRequest) -> dict:
    """Return the aggregated usage analytics. Admin-only."""
    authenticate_user(request.auth)
    if not _is_admin(request):
        raise https_fn.HttpsError(Err.PERMISSION_DENIED, "Not authorized.")

    summary = {}
    try:
        snap = db.collection("usage").document("summary").get()
        if snap.exists:
            summary = snap.to_dict() or {}
    except Exception as error:
        print(f"usage summary error: {error}")

    return {
        "summary": summary,
        "daily": _daily_series(),
        "users": _users_overview(),
        "feedback": _feedback_list(),
    }
