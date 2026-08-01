"""Rate limiting / debouncing, ported from checkRateLimit / checkFirestoreRateLimit / shouldDebounceUpdate."""

import threading

from firebase_admin import firestore

from .common import now_ms
from .firebase_app import db

_rate_limit_store: dict[str, dict] = {}
_rate_limit_lock = threading.Lock()


def check_rate_limit(user_id: str, action: str, max_requests: int = 10, window_ms: int = 60000) -> bool:
    key = f"{user_id}:{action}"
    now = now_ms()

    with _rate_limit_lock:
        entry = _rate_limit_store.get(key)

        if entry is None or now > entry["reset_time"]:
            _rate_limit_store[key] = {"count": 1, "reset_time": now + window_ms}
            return True

        if entry["count"] < max_requests:
            entry["count"] += 1
            return True

        return False


def check_firestore_rate_limit(user_id: str, action: str, max_requests: int = 10, window_ms: int = 60000) -> bool:
    rate_limit_ref = db.collection("rateLimits").document(f"{user_id}_{action}")
    now = now_ms()

    @firestore.transactional
    def _run(transaction: firestore.Transaction) -> bool:
        snapshot = rate_limit_ref.get(transaction=transaction)

        if not snapshot.exists:
            transaction.set(rate_limit_ref, {"count": 1, "resetTime": now + window_ms, "lastRequest": now})
            return True

        data = snapshot.to_dict()

        if now > data["resetTime"]:
            transaction.update(rate_limit_ref, {"count": 1, "resetTime": now + window_ms, "lastRequest": now})
            return True

        if data["count"] < max_requests:
            transaction.update(rate_limit_ref, {"count": data["count"] + 1, "lastRequest": now})
            return True

        return False

    try:
        return _run(db.transaction())
    except Exception as error:
        print(f"Firestore rate limit check failed: {error}")
        return check_rate_limit(user_id, action, max_requests, window_ms)


def should_debounce_update(user_id: str, player_id: str, field: str, min_interval_ms: int = 100) -> bool:
    debounce_key = f"debounce_{user_id}_{player_id}_{field}"
    rate_limit_ref = db.collection("rateLimits").document(debounce_key)
    now = now_ms()

    @firestore.transactional
    def _run(transaction: firestore.Transaction) -> bool:
        snapshot = rate_limit_ref.get(transaction=transaction)

        if not snapshot.exists:
            transaction.set(rate_limit_ref, {"lastUpdate": now, "expiresAt": now + 24 * 60 * 60 * 1000})
            return False

        data = snapshot.to_dict()
        time_since_last_update = now - data["lastUpdate"]

        if time_since_last_update >= min_interval_ms:
            transaction.update(rate_limit_ref, {"lastUpdate": now, "expiresAt": now + 24 * 60 * 60 * 1000})
            return False

        return True

    try:
        return _run(db.transaction())
    except Exception as error:
        print(f"Debounce check failed: {error}")
        return False
