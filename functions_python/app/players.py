"""Player CRUD within a lobby: get/update/delete, increments, commander/combat damage."""

from firebase_admin import firestore
from firebase_functions import https_fn

from .common import Err, authenticate_user, is_number, safe_number
from .firebase_app import db
from .rate_limiting import check_firestore_rate_limit, check_rate_limit, should_debounce_update
from .warmup import track_read, track_write, with_warmup


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
        if is_number(value) and abs(value) > 10000:
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

        if not is_number(player_data.get("life")):
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
            if not is_number(life_to_apply) or not is_number(damage):
                print(f"Invalid commander damage data for player {player_id}: {cd}")
                updated_commander_damages.append(cd)
                continue
            total_commander_life_to_apply += life_to_apply
            updated_commander_damages.append({**cd, "damage": damage + life_to_apply, "lifeToApply": 0})

        life_to_apply = safe_number(player_data.get("lifeToApply"))
        infect = safe_number(player_data.get("infect"))
        infect_to_apply = safe_number(player_data.get("infectToApply"))

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
