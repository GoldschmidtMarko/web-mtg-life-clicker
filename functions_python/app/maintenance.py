"""Housekeeping callables: expired rate-limit docs and stale lobbies."""

from datetime import datetime, timedelta, timezone

from firebase_functions import https_fn
from google.cloud.firestore_v1.base_query import FieldFilter

from .common import authenticate_user, now_ms
from .firebase_app import db
from .warmup import track_write, with_warmup


@https_fn.on_call()
@with_warmup("cleanupRateLimits")
def cleanupRateLimits(request: https_fn.CallableRequest) -> dict:
    authenticate_user(request.auth)

    now = now_ms()
    rate_limits_ref = db.collection("rateLimits")

    expired_docs = list(rate_limits_ref.where(filter=FieldFilter("expiresAt", "<", now)).limit(100).get())

    if not expired_docs:
        return {"message": "No expired rate limit documents found", "deleted": 0}

    batch = db.batch()
    for doc in expired_docs:
        batch.delete(doc.reference)
    batch.commit()

    return {"message": "Cleanup completed", "deleted": len(expired_docs)}


@https_fn.on_call()
@with_warmup("cleanupOldLobbies")
def cleanupOldLobbies(request: https_fn.CallableRequest) -> dict:
    authenticate_user(request.auth)

    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)

    lobbies_ref = db.collection("lobbies")
    old_lobbies = list(lobbies_ref.where(filter=FieldFilter("lastUpdated", "<", seven_days_ago)).limit(50).get())

    if not old_lobbies:
        return {"message": "No old lobbies found to delete", "deleted": 0}

    deleted_count = 0

    for lobby_doc in old_lobbies:
        try:
            # recursive_delete removes the lobby doc AND every subcollection
            # under it (players, games, and each game's history) - a plain
            # lobby_ref.delete() only removes the lobby doc itself and
            # silently orphans the rest, which is how those subcollections
            # were leaking storage before this fix.
            db.recursive_delete(lobby_doc.reference)
            track_write(f"cleanupOldLobbies - deleted lobby {lobby_doc.id} and its subcollections")

            deleted_count += 1
        except Exception as error:
            print(f"Error deleting lobby {lobby_doc.id}: {error}")

    return {
        "message": f"Cleanup completed. Deleted {deleted_count} old lobbies.",
        "deleted": deleted_count,
        "totalFound": len(old_lobbies),
    }
