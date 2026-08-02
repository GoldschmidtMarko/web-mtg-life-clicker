"""Lobby lifecycle: create, join, validate, timers."""

import random
import string

from firebase_admin import firestore
from firebase_functions import https_fn
from google.cloud.firestore_v1.base_query import FieldFilter

from .common import Err, authenticate_user, is_number, now_ms
from .firebase_app import db
from .rate_limiting import check_rate_limit
from .warmup import track_read, track_write, with_warmup


@https_fn.on_call(timeout_sec=10)
@with_warmup("createLobby")
def createLobby(request: https_fn.CallableRequest) -> dict:
    player = request.data or {}
    authenticate_user(request.auth)
    user_id = request.auth.uid
    player_name = player.get("name", "Player")

    if not check_rate_limit(user_id, "createLobby", 3, 300000):
        raise https_fn.HttpsError(Err.RESOURCE_EXHAUSTED,
                                   "Rate limit exceeded. You can only create 3 lobbies per 5 minutes.")

    lobby_code = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

    new_lobby = {
        "code": lobby_code,
        "ownerId": user_id,
        "ownerName": player_name,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "lastUpdated": firestore.SERVER_TIMESTAMP,
    }

    try:
        lobby_ref = db.collection("lobbies").document(lobby_code)
        lobby_ref.set(new_lobby)
        track_write("createLobby - lobby creation")

        lobby_ref.collection("players").document(user_id).set({**player, "id": user_id})
        track_write("createLobby - player addition")

        return {"lobbyCode": lobby_code}
    except Exception as error:
        print(f"Error creating lobby: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, "Failed to create lobby. Please try again.")


@https_fn.on_call()
@with_warmup("joinLobby")
def joinLobby(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    player = data.get("player")
    lobby_code = data.get("lobbyCode")
    authenticate_user(request.auth)
    user_id = request.auth.uid

    if not lobby_code or not isinstance(lobby_code, str) or lobby_code.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobby code")
    if not player or not isinstance(player, dict):
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid player data")

    player_id = player.get("id") or user_id
    if not player_id or not isinstance(player_id, str):
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Invalid player ID")

    try:
        lobby_ref = db.collection("lobbies").document(lobby_code)
        lobby_doc = lobby_ref.get()

        if not lobby_doc.exists:
            raise https_fn.HttpsError(Err.NOT_FOUND, "Lobby not found. Please check the lobby code.")

        player_ref = lobby_ref.collection("players").document(player_id)

        @firestore.transactional
        def _run(transaction: firestore.Transaction) -> None:
            existing = player_ref.get(transaction=transaction)
            if existing.exists:
                # Rejoining with the same id: only the name is meant to change.
                # Life, colors, and commander damage carry over from the existing session.
                transaction.update(player_ref, {"name": player.get("name") or "Player"})
            else:
                transaction.set(player_ref, {**player, "id": player_id})

        _run(db.transaction())
        track_write("joinLobby - player addition")

        return {"success": True, "lobbyCode": lobby_code}
    except https_fn.HttpsError:
        raise
    except Exception as error:
        print(f"Error joining lobby: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, "Failed to join lobby. Please try again.")


@https_fn.on_call()
@with_warmup("getUserLobbies")
def getUserLobbies(request: https_fn.CallableRequest) -> dict:
    authenticate_user(request.auth)
    user_id = request.auth.uid

    player_docs = list(
        db.collection_group("players").where(filter=FieldFilter("id", "==", user_id)).get()
    )
    track_read(f"getUserLobbies - {len(player_docs)} memberships for {user_id}")

    lobbies = []
    seen_codes = set()
    for player_doc in player_docs:
        lobby_ref = player_doc.reference.parent.parent
        if lobby_ref is None or lobby_ref.id in seen_codes:
            continue
        seen_codes.add(lobby_ref.id)

        lobby_doc = lobby_ref.get()
        if not lobby_doc.exists:
            continue

        lobby_data = lobby_doc.to_dict()
        last_updated = lobby_data.get("lastUpdated")
        lobbies.append({
            "code": lobby_ref.id,
            "ownerId": lobby_data.get("ownerId"),
            "ownerName": lobby_data.get("ownerName"),
            "isOwner": lobby_data.get("ownerId") == user_id,
            "lastUpdated": last_updated.isoformat() if last_updated else None,
        })

    lobbies.sort(key=lambda entry: entry["lastUpdated"] or "", reverse=True)

    return {"lobbies": lobbies}


@https_fn.on_call()
@with_warmup("validateLobby")
def validateLobby(request: https_fn.CallableRequest) -> dict:
    lobby_id = (request.data or {}).get("lobbyId")

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")

    try:
        lobby_ref = db.collection("lobbies").document(lobby_id)
        lobby_doc = lobby_ref.get()
        track_read(f"validateLobby - check lobby {lobby_id}")

        return {"exists": lobby_doc.exists, "lobbyId": lobby_id}
    except Exception as error:
        print(f"Error validating lobby: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, "Failed to validate lobby. Please try again.")


@https_fn.on_call()
@with_warmup("updateLobbyTimestamp")
def updateLobbyTimestamp(request: https_fn.CallableRequest) -> dict:
    lobby_id = (request.data or {}).get("lobbyId")
    authenticate_user(request.auth)

    lobby_ref = db.collection("lobbies").document(lobby_id)
    lobby_ref.update({"lastUpdated": firestore.SERVER_TIMESTAMP})
    track_write(f"updateLobbyTimestamp - lobby {lobby_id}")

    return {"success": True}


@https_fn.on_call()
@with_warmup("startTimer")
def startTimer(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    duration = data.get("duration")
    authenticate_user(request.auth)

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not is_number(duration) or duration <= 0:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid duration parameter")

    lobby_ref = db.collection("lobbies").document(lobby_id)
    now = now_ms()
    timer_end = now + duration * 60 * 1000

    lobby_ref.update({"timerEnd": timer_end, "timerDuration": duration, "timerStartedAt": now})
    track_write(f"startTimer - lobby {lobby_id} for {duration} min")

    return {"success": True, "timerEnd": timer_end}


@https_fn.on_call()
@with_warmup("rollDice")
def rollDice(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    sides = data.get("sides")
    authenticate_user(request.auth)

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not is_number(sides) or sides < 2:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid sides parameter")

    sides = int(sides)
    result = random.randint(1, sides)
    rolled_at = now_ms()

    lobby_ref = db.collection("lobbies").document(lobby_id)
    lobby_ref.update({"diceResult": result, "diceSides": sides, "diceRolledAt": rolled_at})
    track_write(f"rollDice - lobby {lobby_id}: d{sides} -> {result}")

    return {"success": True, "result": result, "sides": sides, "rolledAt": rolled_at}


@https_fn.on_call()
@with_warmup("logGameChanges")
def logGameChanges(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    changes = data.get("changes")
    authenticate_user(request.auth)

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not isinstance(changes, list) or len(changes) == 0:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid changes parameter")

    entries = []
    for change in changes:
        if not isinstance(change, dict) or not change.get("playerId"):
            continue
        commander_changes = []
        for cd in change.get("commanderDamageChanges") or []:
            if not isinstance(cd, dict):
                continue
            commander_changes.append({
                "commanderName": cd.get("commanderName"),
                "damageBefore": cd.get("damageBefore"),
                "damageAfter": cd.get("damageAfter"),
            })
        entries.append({
            "playerId": change.get("playerId"),
            "playerName": change.get("playerName"),
            "lifeBefore": change.get("lifeBefore"),
            "lifeAfter": change.get("lifeAfter"),
            "infectBefore": change.get("infectBefore"),
            "infectAfter": change.get("infectAfter"),
            "commanderDamageChanges": commander_changes,
        })

    if not entries:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "No valid change entries provided")

    now = now_ms()
    history_ref = db.collection("lobbies").document(lobby_id).collection("history").document()
    history_ref.set({"createdAt": now, "entries": entries})
    track_write(f"logGameChanges - lobby {lobby_id}: {len(entries)} player(s)")

    return {"success": True, "historyId": history_ref.id}
