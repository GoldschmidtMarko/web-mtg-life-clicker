"""Housekeeping callables: expired rate-limit docs and stale lobbies.

Retention policy for cleanupOldLobbies (see the ownerIsAnonymous field set
by createLobby):
  - Anonymous-owned lobbies: deleted after ANON_RETENTION_DAYS of inactivity.
  - Google-owned lobbies: each owner's RECENT_LOBBIES_KEPT most-recently-
    updated lobbies are always kept regardless of age; any others are
    deleted once they pass AUTHED_RETENTION_DAYS of inactivity.
Lobbies created before ownerIsAnonymous existed have no such field and are
invisible to both queries below (Firestore equality filters never match a
missing field) - a narrow, self-resolving gap rather than a migration, since
anything that old had already aged out under the old flat 7-day rule.
"""

from datetime import datetime, timedelta, timezone

from firebase_admin import firestore
from firebase_functions import https_fn
from google.cloud.firestore_v1.base_query import FieldFilter

from .common import authenticate_user, now_ms
from .firebase_app import db
from .warmup import track_write, with_warmup

ANON_RETENTION_DAYS = 7
AUTHED_RETENTION_DAYS = 30
RECENT_LOBBIES_KEPT = 3


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


def _owners_recent_lobby_ids(lobbies_ref, owner_id: str) -> set:
    """The ids of one owner's RECENT_LOBBIES_KEPT most-recently-updated
    lobbies - always protected from cleanup regardless of age."""
    top_docs = (
        lobbies_ref
        .where(filter=FieldFilter("ownerId", "==", owner_id))
        .order_by("lastUpdated", direction=firestore.Query.DESCENDING)
        .limit(RECENT_LOBBIES_KEPT)
        .get()
    )
    return {doc.id for doc in top_docs}


@https_fn.on_call()
@with_warmup("cleanupOldLobbies")
def cleanupOldLobbies(request: https_fn.CallableRequest) -> dict:
    authenticate_user(request.auth)

    now = datetime.now(timezone.utc)
    anon_cutoff = now - timedelta(days=ANON_RETENTION_DAYS)
    authed_cutoff = now - timedelta(days=AUTHED_RETENTION_DAYS)

    lobbies_ref = db.collection("lobbies")

    # Anonymous-owned: simple inactivity cutoff, no protection.
    anon_stale = list(
        lobbies_ref
        .where(filter=FieldFilter("ownerIsAnonymous", "==", True))
        .where(filter=FieldFilter("lastUpdated", "<", anon_cutoff))
        .limit(50)
        .get()
    )

    # Google-owned: only delete once past the longer cutoff, and only if it's
    # not among that owner's RECENT_LOBBIES_KEPT most-recently-updated lobbies.
    authed_candidates = list(
        lobbies_ref
        .where(filter=FieldFilter("ownerIsAnonymous", "==", False))
        .where(filter=FieldFilter("lastUpdated", "<", authed_cutoff))
        .limit(50)
        .get()
    )

    authed_stale = []
    protected_cache: dict[str, set] = {}
    for doc in authed_candidates:
        owner_id = (doc.to_dict() or {}).get("ownerId")
        if not owner_id:
            authed_stale.append(doc)  # no owner on record - nothing to protect it
            continue
        if owner_id not in protected_cache:
            protected_cache[owner_id] = _owners_recent_lobby_ids(lobbies_ref, owner_id)
        if doc.id not in protected_cache[owner_id]:
            authed_stale.append(doc)

    old_lobbies = anon_stale + authed_stale

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
