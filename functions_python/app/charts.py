"""Server-rendered charts (matplotlib) for a lobby's game history."""

import base64
import io
from datetime import datetime, timezone

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from firebase_functions import https_fn

from .common import Err, authenticate_user
from .firebase_app import db
from .warmup import track_read, with_warmup


def _build_life_series(history_docs, game_started_at) -> dict[str, list[tuple[int, int]]]:
    series: dict[str, list[tuple[int, int]]] = {}
    for doc in history_docs:
        entry_data = doc.to_dict() or {}
        created_at = entry_data.get("createdAt")
        for change in entry_data.get("entries") or []:
            name = change.get("playerName") or "Player"
            life_before = change.get("lifeBefore")
            life_after = change.get("lifeAfter")
            if life_before is None or life_after is None:
                continue
            points = series.setdefault(name, [])
            if not points:
                # Anchor a player's first point at when the game actually
                # started, not the timestamp of their first change - using
                # the same timestamp for both would plot the "before" and
                # "after" values on top of each other.
                points.append((game_started_at or created_at, life_before))
            points.append((created_at, life_after))
    return series


def _render_life_chart(series: dict[str, list[tuple[int, int]]]) -> str:
    fig, ax = plt.subplots(figsize=(7, 4), dpi=150)

    for name, points in series.items():
        times = [datetime.fromtimestamp(t / 1000, tz=timezone.utc) for t, _ in points]
        lives = [life for _, life in points]
        ax.plot(times, lives, marker="o", label=name)

    ax.set_xlabel("Time (UTC)")
    ax.set_ylabel("Life")
    ax.set_title("Life Over Time")
    ax.legend(loc="best")
    ax.grid(True, alpha=0.3)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M:%S"))
    fig.autofmt_xdate()

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", bbox_inches="tight")
    plt.close(fig)
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


@https_fn.on_call(timeout_sec=30, memory=512)
@with_warmup("getLifeChangeChart")
def getLifeChangeChart(request: https_fn.CallableRequest) -> dict:
    data = request.data or {}
    lobby_id = data.get("lobbyId")
    game_id = data.get("gameId")
    authenticate_user(request.auth)

    if not lobby_id or not isinstance(lobby_id, str) or lobby_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid lobbyId parameter")
    if not game_id or not isinstance(game_id, str) or game_id.strip() == "":
        raise https_fn.HttpsError(Err.INVALID_ARGUMENT, "Missing or invalid gameId parameter")

    game_ref = db.collection("lobbies").document(lobby_id).collection("games").document(game_id)
    game_doc = game_ref.get()
    game_started_at = (game_doc.to_dict() or {}).get("startedAt") if game_doc.exists else None

    history_docs = list(game_ref.collection("history").order_by("createdAt").stream())
    track_read(f"getLifeChangeChart - lobby {lobby_id} game {game_id}: {len(history_docs)} entries")

    series = _build_life_series(history_docs, game_started_at)
    if not series:
        # A game with no changes yet (e.g. right after Reset Life) is a
        # normal, expected state - not an error.
        return {"success": True, "image": None}

    image_base64 = _render_life_chart(series)

    return {"success": True, "image": image_base64}
