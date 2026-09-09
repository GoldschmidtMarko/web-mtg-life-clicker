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


def is_google_authed(auth: https_fn.AuthData | None) -> bool:
    """True only for a real Google-linked sign-in, not the anonymous auth
    session every visitor gets by default. Used to keep the authed/anon
    usage-analytics split meaningful now that "signed in" (any Firebase
    Auth session) no longer implies "has a Google account"."""
    if auth is None:
        return False
    token = auth.token or {}
    return token.get("firebase", {}).get("sign_in_provider") == "google.com"
