"""Player account records, separate from in-lobby player state."""

from firebase_admin import firestore
from firebase_functions import https_fn

from .common import Err, authenticate_user
from .firebase_app import db
from .rate_limiting import check_firestore_rate_limit
from .warmup import track_read, track_write, with_warmup


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
