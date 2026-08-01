"""Python port of the Node.js Cloud Functions in functions/index.js.

Deployed Cloud Function names are taken from each Python function's
__name__, and the frontend (public/js/*.js) calls them by exact string
(e.g. functions.httpsCallable('createLobby')), so the names below stay
camelCase to match the JS originals instead of following PEP 8.
"""

import functools
import random
import string
import threading
import time
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import firestore
from firebase_functions import https_fn, options
from google.cloud.firestore_v1.base_query import FieldFilter

Err = https_fn.FunctionsErrorCode

options.set_global_options(region="europe-west3", max_instances=10)

firebase_admin.initialize_app()
db = firestore.client()

_PROCESS_START = time.monotonic()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _safe_number(value, default=0):
    return value if _is_number(value) else default


# --------------------------------------------------------------------------
# Startup / periodic warmup, ported from the JS IIFE + warmUpFunctions().
# --------------------------------------------------------------------------

WARMUP_FUNCTIONS = [
    "savePlayerData", "createLobby", "joinLobby", "getPlayers", "updatePlayer",
    "deletePlayer", "incrementPlayerField", "updateCommanderDamage",
    "applyCombatDamage", "addPlayer", "updateLobbyTimestamp", "updatePlayerSettings",
    "cleanupRateLimits", "cleanupOldLobbies", "startTimer", "recordPayInterest",
    "warmUpFunctions", "heartbeat", "validateLobby",
]
_WARMUP_INTERVAL_MS = 10 * 60 * 1000

_state_lock = threading.Lock()
_last_warmup_time = 0
_function_call_count = 0
_read_count = 0
_write_count = 0


def _prewarm_on_startup() -> None:
    try:
        print("Pre-warming database connection...")
        db.collection("_warmup").document("startup").get()
        db.collection("lobbies").limit(1).get()
        db.collection("players").limit(1).get()
        print("Database connection pre-warmed successfully")
        print("Container startup completed - ready for requests")
    except Exception:
        print("Database pre-warming attempted (some operations may have failed)")


# Run inline rather than on a background thread: the google-cloud-firestore
# client's gRPC channel isn't safe to touch from two threads at once during
# cold start, which reliably deadlocked requests under the emulator.
_prewarm_on_startup()


def track_function_call(function_name: str) -> None:
    global _function_call_count
    with _state_lock:
        _function_call_count += 1
        count = _function_call_count
    print(f"Function call #{count}: {function_name} at {datetime.now(timezone.utc).isoformat()}")


def track_read(operation: str) -> int:
    global _read_count
    with _state_lock:
        _read_count += 1
        count = _read_count
    print(f"DB Read {count}: {operation}")
    return count


def track_write(operation: str) -> int:
    global _write_count
    with _state_lock:
        _write_count += 1
        count = _write_count
    print(f"DB Write {count}: {operation}")
    return count


def warm_up_functions() -> None:
    global _last_warmup_time
    now = _now_ms()

    if now - _last_warmup_time < _WARMUP_INTERVAL_MS:
        print(f"Skipping warmup - last warmup was {round((now - _last_warmup_time) / 1000)}s ago")
        return

    _last_warmup_time = now
    print("Starting function warmup...")

    print(f"Functions container warmed up at {datetime.now(timezone.utc).isoformat()}")
    print(f"Keeping warm: {', '.join(WARMUP_FUNCTIONS)}")

    try:
        db.collection("_warmup").document("ping").get()
        db.collection("_warmup").document("connection-test").get()
        db.collection("lobbies").limit(1).get()
        print("Database connection and query patterns warmed up")
    except Exception:
        print("Database warmup attempted (some operations may have failed)")

    print(f"Function warmup completed successfully. Total calls since startup: {_function_call_count}")


def trigger_warmup() -> None:
    try:
        warm_up_functions()
    except Exception as error:
        print(f"Function warmup failed: {error}")


def with_warmup(function_name: str):
    """Tracks the call and runs the (interval-guarded) warmup check, mirroring withWarmup() in the JS version.

    The JS version fires this in the background via setImmediate(); here it runs inline
    because concurrent threads sharing one Firestore gRPC channel deadlocked under the
    emulator. warm_up_functions() is a no-op after the first call within _WARMUP_INTERVAL_MS,
    so the added latency is negligible.
    """

    def decorator(handler):
        @functools.wraps(handler)
        def wrapped(request: https_fn.CallableRequest):
            track_function_call(function_name)
            trigger_warmup()
            return handler(request)

        return wrapped

    return decorator


# --------------------------------------------------------------------------
# Rate limiting / debouncing, ported from checkRateLimit / checkFirestoreRateLimit
# / shouldDebounceUpdate.
# --------------------------------------------------------------------------

_rate_limit_store: dict[str, dict] = {}
_rate_limit_lock = threading.Lock()


def check_rate_limit(user_id: str, action: str, max_requests: int = 10, window_ms: int = 60000) -> bool:
    key = f"{user_id}:{action}"
    now = _now_ms()

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
    now = _now_ms()

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
    now = _now_ms()

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


def authenticate_user(auth: https_fn.AuthData | None) -> None:
    if auth is None:
        raise https_fn.HttpsError(Err.UNAUTHENTICATED, "User must be signed in.")


# --------------------------------------------------------------------------
# Callable functions
# --------------------------------------------------------------------------

@https_fn.on_call()
def quickWarmup(request: https_fn.CallableRequest) -> dict:
    timestamp = datetime.now(timezone.utc).isoformat()
    print(f"Quick warmup called at {timestamp}")

    global _function_call_count
    with _state_lock:
        _function_call_count += 1

    trigger_warmup()

    return {"success": True, "message": "Quick warmup completed", "timestamp": timestamp, "ready": True}


@https_fn.on_call()
def warmUpFunctions(request: https_fn.CallableRequest) -> dict:
    track_function_call("warmUpFunctions")
    print("Manual warmup triggered")

    try:
        warm_up_functions()
        return {
            "success": True,
            "message": f"Warmup completed for {len(WARMUP_FUNCTIONS)} functions",
            "warmedFunctions": WARMUP_FUNCTIONS,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "lastWarmupTime": datetime.fromtimestamp(_last_warmup_time / 1000, tz=timezone.utc).isoformat(),
            "totalFunctionCalls": _function_call_count,
        }
    except Exception as error:
        print(f"Manual warmup failed: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, "Warmup failed. Please try again.")


@https_fn.on_call()
def heartbeat(request: https_fn.CallableRequest) -> dict:
    track_function_call("heartbeat")
    timestamp = datetime.now(timezone.utc).isoformat()
    print(f"Heartbeat received at {timestamp}")

    trigger_warmup()

    return {
        "success": True,
        "message": "Heartbeat successful",
        "timestamp": timestamp,
        "functionsCount": len(WARMUP_FUNCTIONS),
        "lastWarmupTime": datetime.fromtimestamp(_last_warmup_time / 1000, tz=timezone.utc).isoformat(),
        "uptime": time.monotonic() - _PROCESS_START,
        "totalFunctionCalls": _function_call_count,
    }


@https_fn.on_call()
@with_warmup("savePlayerData")
def savePlayerData(request: https_fn.CallableRequest) -> dict:
    auth = request.auth
    if auth is None:
        raise https_fn.HttpsError(Err.UNAUTHENTICATED, "User must be authenticated.")

    user_id = auth.uid
    token = auth.token or {}

    player_data = {
        "name": token.get("name", "Unknown"),
        "email": token.get("email", ""),
        "lastLogin": firestore.SERVER_TIMESTAMP,
        "uid": user_id,
        "loginCount": firestore.Increment(1),
    }

    try:
        player_ref = db.collection("players").document(user_id)
        player_doc = player_ref.get()

        show_popup = False

        if not player_doc.exists:
            player_data["registrationDate"] = firestore.SERVER_TIMESTAMP
            player_data["shownExample"] = True
            show_popup = True
        else:
            existing_data = player_doc.to_dict() or {}
            if not existing_data.get("registrationDate"):
                player_data["registrationDate"] = firestore.SERVER_TIMESTAMP
            show_popup = existing_data.get("shownExample") is False

        player_ref.set(player_data, merge=True)

        return {"success": True, "message": "Player data saved successfully.", "showPopup": show_popup}
    except Exception as error:
        print(f"Error saving player data: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, "Failed to save player data.")


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
@with_warmup("getPlayers")
def getPlayers(request: https_fn.CallableRequest) -> dict:
    lobby_id = (request.data or {}).get("lobbyId")
    authenticate_user(request.auth)

    players_snapshot = list(db.collection("lobbies").document(lobby_id).collection("players").get())
    track_read(f"getPlayers - {len(players_snapshot)} players")

    players = []
    for doc in players_snapshot:
        data = doc.to_dict() or {}
        data.pop("id", None)
        players.append({"id": doc.id, **data})

    return {"players": players}


@https_fn.on_call()
@with_warmup("updatePlayer")
def updatePlayer(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    player_id = data.get("playerId")
    updates = data.get("updates")
    authenticate_user(request.auth)
    user_id = request.auth.uid

    if not check_firestore_rate_limit(user_id, "updatePlayer", 50, 60000):
        raise https_fn.HttpsError(Err.RESOURCE_EXHAUSTED, "Rate limit exceeded. Please slow down your requests.")

    player_update_key = f"updatePlayer_{player_id}"
    if not check_firestore_rate_limit(user_id, player_update_key, 30, 60000):
        raise https_fn.HttpsError(Err.RESOURCE_EXHAUSTED, "Rate limit exceeded for this player. Please slow down.")

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not player_id or not isinstance(player_id, str) or player_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid playerId parameter")
    if not updates or not isinstance(updates, dict):
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid updates parameter")

    for key, value in updates.items():
        if _is_number(value) and abs(value) > 10000:
            raise https_fn.HttpsError(Err.INVALID_ARGUMENT, f"Update value too large for field {key}. Maximum allowed: ±10000")
        if isinstance(value, str) and len(value) > 500:
            raise https_fn.HttpsError(Err.INVALID_ARGUMENT, f"String value too long for field {key}. Maximum 500 characters.")

    frequent_fields = {"lifeToApply", "infectToApply", "life"}
    for field in updates:
        if field in frequent_fields and should_debounce_update(user_id, player_id, field, 50):
            raise https_fn.HttpsError(Err.RESOURCE_EXHAUSTED, f"Update too frequent for field {field}. Please slow down.")

    player_ref = db.collection("lobbies").document(lobby_id).collection("players").document(player_id)
    player_ref.update(updates)
    track_write(f"updatePlayer - {player_id} fields: {', '.join(updates.keys())}")

    return {"success": True}


@https_fn.on_call()
@with_warmup("deletePlayer")
def deletePlayer(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    player_id = data.get("playerId")
    authenticate_user(request.auth)

    player_ref = db.collection("lobbies").document(lobby_id).collection("players").document(player_id)
    player_ref.delete()
    track_write(f"deletePlayer - {player_id}")

    return {"success": True}


@https_fn.on_call()
@with_warmup("incrementPlayerField")
def incrementPlayerField(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    player_id = data.get("playerId")
    field = data.get("field")
    value = data.get("value")
    authenticate_user(request.auth)
    user_id = request.auth.uid

    if not check_rate_limit(user_id, "incrementPlayerField", 30, 60000):
        raise https_fn.HttpsError(Err.RESOURCE_EXHAUSTED, "Rate limit exceeded. Please slow down your requests.")

    if abs(value) > 1000:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Value change too large. Maximum allowed: ±1000")

    player_ref = db.collection("lobbies").document(lobby_id).collection("players").document(player_id)
    player_ref.update({field: firestore.Increment(value)})
    track_write(f"incrementPlayerField - {player_id} {field} by {value}")

    return {"success": True}


@https_fn.on_call()
@with_warmup("updateCommanderDamage")
def updateCommanderDamage(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    player_id = data.get("playerId")
    commander_damages = data.get("commanderDamages")
    authenticate_user(request.auth)

    player_ref = db.collection("lobbies").document(lobby_id).collection("players").document(player_id)

    @firestore.transactional
    def _run(transaction: firestore.Transaction) -> None:
        snapshot = player_ref.get(transaction=transaction)
        track_read(f"updateCommanderDamage - get player {player_id}")
        if not snapshot.exists:
            raise Exception("Player document does not exist")

        transaction.update(player_ref, {"commanderDamages": commander_damages})
        track_write(f"updateCommanderDamage - update player {player_id}")

    _run(db.transaction())

    return {"success": True}


@https_fn.on_call()
@with_warmup("applyCombatDamage")
def applyCombatDamage(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    player_id = data.get("playerId")
    authenticate_user(request.auth)

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not player_id or not isinstance(player_id, str) or player_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid playerId parameter")

    player_ref = db.collection("lobbies").document(lobby_id).collection("players").document(player_id)

    @firestore.transactional
    def _run(transaction: firestore.Transaction) -> dict:
        player_doc = player_ref.get(transaction=transaction)
        track_read(f"applyCombatDamage - get player {player_id}")

        if not player_doc.exists:
            raise https_fn.HttpsError(Err.NOT_FOUND, f"Player document does not exist: {player_id}")

        player_data = player_doc.to_dict() or {}

        if not _is_number(player_data.get("life")):
            print(f"Invalid life value for player {player_id}: {player_data.get('life')}")
            raise https_fn.HttpsError(Err.INVALID_ARGUMENT, f"Player {player_id} has invalid life value: {player_data.get('life')}")

        commander_damages = player_data.get("commanderDamages")
        if not isinstance(commander_damages, list):
            if commander_damages is not None:
                print(f"Invalid commanderDamages for player {player_id}: {commander_damages}")
            commander_damages = []

        total_commander_life_to_apply = 0
        updated_commander_damages = []
        for cd in commander_damages:
            life_to_apply = cd.get("lifeToApply")
            damage = cd.get("damage")
            if not _is_number(life_to_apply) or not _is_number(damage):
                print(f"Invalid commander damage data for player {player_id}: {cd}")
                updated_commander_damages.append(cd)
                continue
            total_commander_life_to_apply += life_to_apply
            updated_commander_damages.append({**cd, "damage": damage + life_to_apply, "lifeToApply": 0})

        life_to_apply = _safe_number(player_data.get("lifeToApply"))
        infect = _safe_number(player_data.get("infect"))
        infect_to_apply = _safe_number(player_data.get("infectToApply"))

        update_data = {
            "commanderDamages": updated_commander_damages,
            "life": player_data["life"] - total_commander_life_to_apply + life_to_apply,
            "infect": infect + infect_to_apply,
            "lifeToApply": 0,
            "infectToApply": 0,
        }

        transaction.update(player_ref, update_data)
        track_write(f"applyCombatDamage - update player {player_id}")

        return player_data

    try:
        result = _run(db.transaction())
        return {"success": True, "data": result}
    except https_fn.HttpsError:
        raise
    except Exception as error:
        print(f"applyCombatDamage error for {player_id}: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, f"Failed to apply combat damage for player {player_id}: {error}")


@https_fn.on_call()
@with_warmup("addPlayer")
def addPlayer(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    player = data.get("player")
    authenticate_user(request.auth)

    if not lobby_id or not player:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing lobbyId or player")

    players_ref = db.collection("lobbies").document(lobby_id).collection("players")

    player_id = player.get("id")
    player_data = {k: v for k, v in player.items() if k != "id"}

    if player_id:
        players_ref.document(player_id).set(player_data)
    else:
        players_ref.add(player_data)

    track_write(f"addPlayer - add player to lobby {lobby_id}")
    return {"success": True}


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
@with_warmup("updatePlayerSettings")
def updatePlayerSettings(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    player_id = data.get("playerId")
    settings = data.get("settings")
    authenticate_user(request.auth)

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not player_id or not isinstance(player_id, str) or player_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid playerId parameter")
    if not settings or not isinstance(settings, dict):
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid settings parameter")

    player_ref = db.collection("lobbies").document(lobby_id).collection("players").document(player_id)

    player_doc = player_ref.get()
    track_read(f"updatePlayerSettings - get player {player_id}")

    if not player_doc.exists:
        raise https_fn.HttpsError(Err.NOT_FOUND, f"Player document does not exist: {player_id}")

    player_ref.update(settings)
    track_write(f"updatePlayerSettings - update player {player_id}")

    return {"success": True}


@https_fn.on_call()
@with_warmup("cleanupRateLimits")
def cleanupRateLimits(request: https_fn.CallableRequest) -> dict:
    authenticate_user(request.auth)

    now = _now_ms()
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
            lobby_ref = lobby_doc.reference

            players_snapshot = list(lobby_ref.collection("players").get())
            if players_snapshot:
                player_batch = db.batch()
                for player_doc in players_snapshot:
                    player_batch.delete(player_doc.reference)
                player_batch.commit()
                track_write(f"cleanupOldLobbies - deleted {len(players_snapshot)} players from lobby {lobby_doc.id}")

            lobby_ref.delete()
            track_write(f"cleanupOldLobbies - deleted lobby {lobby_doc.id}")

            deleted_count += 1
        except Exception as error:
            print(f"Error deleting lobby {lobby_doc.id}: {error}")

    return {
        "message": f"Cleanup completed. Deleted {deleted_count} old lobbies.",
        "deleted": deleted_count,
        "totalFound": len(old_lobbies),
    }


@https_fn.on_call()
@with_warmup("startTimer")
def startTimer(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    duration = data.get("duration")
    authenticate_user(request.auth)

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not _is_number(duration) or duration <= 0:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid duration parameter")

    lobby_ref = db.collection("lobbies").document(lobby_id)
    now = _now_ms()
    timer_end = now + duration * 60 * 1000

    lobby_ref.update({"timerEnd": timer_end, "timerDuration": duration, "timerStartedAt": now})
    track_write(f"startTimer - lobby {lobby_id} for {duration} min")

    return {"success": True, "timerEnd": timer_end}


@https_fn.on_call()
@with_warmup("recordPayInterest")
def recordPayInterest(request: https_fn.CallableRequest) -> dict:
    authenticate_user(request.auth)
    user_id = request.auth.uid

    if not check_firestore_rate_limit(user_id, "recordPayInterest", 5, 3600000):
        raise https_fn.HttpsError(Err.RESOURCE_EXHAUSTED,
                                   "You can only show interest 5 times per hour. Thank you for your enthusiasm!")

    try:
        user_doc_ref = db.collection("players").document(user_id)
        doc = user_doc_ref.get()
        track_read(f"recordPayInterest - get player {user_id}")

        if doc.exists:
            user_doc_ref.update({
                "pay_interest": firestore.Increment(1),
                "last_interest_shown": firestore.SERVER_TIMESTAMP,
            })
            track_write(f"recordPayInterest - update existing player {user_id}")
        else:
            user_doc_ref.set({
                "pay_interest": 1,
                "last_interest_shown": firestore.SERVER_TIMESTAMP,
                "uid": user_id,
            })
            track_write(f"recordPayInterest - create new player {user_id}")

        return {"success": True, "message": "Thank you for showing interest in supporting this project!"}
    except Exception as error:
        print(f"Error recording pay interest: {error}")
        raise https_fn.HttpsError(Err.INTERNAL, "Failed to record interest. Please try again.")
