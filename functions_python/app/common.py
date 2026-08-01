"""Small helpers shared across the callable function modules."""

import time

from firebase_functions import https_fn

Err = https_fn.FunctionsErrorCode


def now_ms() -> int:
    return int(time.time() * 1000)


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def safe_number(value, default=0):
    return value if is_number(value) else default


def authenticate_user(auth: https_fn.AuthData | None) -> None:
    if auth is None:
        raise https_fn.HttpsError(Err.UNAUTHENTICATED, "User must be signed in.")
