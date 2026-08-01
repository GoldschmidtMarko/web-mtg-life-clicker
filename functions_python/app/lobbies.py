"""Lobby lifecycle: create, join, validate, timers."""

import random
import string

from firebase_admin import firestore
from firebase_functions import https_fn

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

        lobby_ref.collection("players").document(user_id).set(player)
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

        player_data = {**player, "id": player_id}
        lobby_ref.collection("players").document(player_id).set(player_data)
        track_write("joinLobby - player addition")

        return {"success": True, "lobbyCode": lobby_code}
    except https_fn.HttpsError:
        raise
    except Exception as error:
        print(f"Error joining lobby: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, "Failed to join lobby. Please try again.")


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
