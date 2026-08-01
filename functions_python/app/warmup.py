"""Cold-start warmup / call-tracking system, ported from the JS IIFE + warmUpFunctions().

Note: the JS version fires warmup work in the background (setImmediate) so it never
blocks a response. Here it runs inline instead: concurrent threads sharing one
Firestore gRPC channel reliably deadlocked requests under the emulator, so
with_warmup() and the callables below call trigger_warmup() synchronously.
warm_up_functions() is a no-op after the first call within _WARMUP_INTERVAL_MS,
so the added latency is negligible.
"""

import functools
import threading
import time
from datetime import datetime, timezone

from firebase_functions import https_fn

from .common import Err, now_ms
from .firebase_app import PROCESS_START, db

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
    now = now_ms()

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
    """Tracks the call and runs the (interval-guarded) warmup check before the handler."""

    def decorator(handler):
        @functools.wraps(handler)
        def wrapped(request: https_fn.CallableRequest):
            track_function_call(function_name)
            trigger_warmup()
            return handler(request)

        return wrapped

    return decorator


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
        "uptime": time.monotonic() - PROCESS_START,
        "totalFunctionCalls": _function_call_count,
    }
