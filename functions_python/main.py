"""Entry point Firebase Functions loads. Only re-exports callables from the
domain modules below — deployed Cloud Function names are taken from each
callable's __name__, and the frontend (public/js/*.js) calls them by exact
string (e.g. functions.httpsCallable('createLobby')), so those names stay
camelCase to match the JS originals instead of following PEP 8.
"""

from app.account import recordPayInterest, savePlayerData
from app.lobbies import (
    createLobby,
    getUserLobbies,
    joinLobby,
    rollDice,
    startTimer,
    updateLobbyTimestamp,
    validateLobby,
)
from app.maintenance import cleanupOldLobbies, cleanupRateLimits
from app.players import (
    addPlayer,
    applyCombatDamage,
    deletePlayer,
    getPlayers,
    incrementPlayerField,
    updateCommanderDamage,
    updatePlayer,
    updatePlayerSettings,
)
from app.warmup import heartbeat, quickWarmup, warmUpFunctions

__all__ = [
    "recordPayInterest", "savePlayerData",
    "createLobby", "getUserLobbies", "joinLobby", "rollDice", "startTimer", "updateLobbyTimestamp", "validateLobby",
    "cleanupOldLobbies", "cleanupRateLimits",
    "addPlayer", "applyCombatDamage", "deletePlayer", "getPlayers", "incrementPlayerField",
    "updateCommanderDamage", "updatePlayer", "updatePlayerSettings",
    "heartbeat", "quickWarmup", "warmUpFunctions",
]
