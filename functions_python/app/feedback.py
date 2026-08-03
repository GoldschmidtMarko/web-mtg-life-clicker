"""User-submitted feedback and feature recommendations from index.html."""

from firebase_admin import firestore
from firebase_functions import https_fn

from .common import Err
from .firebase_app import db
from .rate_limiting import check_rate_limit
from .warmup import track_write, with_warmup

MAX_MESSAGE_LENGTH = 2000


@https_fn.on_call()
@with_warmup("submitFeedback")
def submitFeedback(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    message = data.get("message")

    if not message or not isinstance(message, str) or message.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid message parameter")

    message = message.strip()
    if len(message) > MAX_MESSAGE_LENGTH:
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT,
                                   f"Message is too long (max {MAX_MESSAGE_LENGTH} characters).")

    # Feedback doesn't require signing in, but we attribute it to the
    # signed-in user when we can.
    auth = request.auth
    user_id = auth.uid if auth else None
    token = auth.token if auth else {}
    user_name = token.get("name") or token.get("email") or None

    rate_limit_key = user_id or "anonymous"
    max_requests = 5 if user_id else 10
    if not check_rate_limit(rate_limit_key, "submitFeedback", max_requests, 600000):
        raise https_fn.HttpsError(Err.RESOURCE_EXHAUSTED,
                                   "You're submitting feedback too quickly. Please try again later.")

    feedback_ref = db.collection("feedback").document()
    feedback_ref.set({
        "message": message,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "userId": user_id,
        "userName": user_name,
    })
    track_write("submitFeedback - new feedback entry")

    return {"success": True}
