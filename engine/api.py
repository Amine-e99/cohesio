"""API HTTP du moteur : uvicorn api:app --port 8000"""
import logging
import os
import secrets
import threading

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel

import db
from run import recompute

load_dotenv()
logger = logging.getLogger("engine")

app = FastAPI(title="Cohesio engine")

# Boutiques dont un calcul est en cours (un seul processus uvicorn)
_running: set[str] = set()
_running_lock = threading.Lock()


def require_key(x_engine_key: str | None = Header(default=None)) -> None:
    """Compare l'en-tête X-Engine-Key à ENGINE_API_KEY en temps constant."""
    expected = os.environ.get("ENGINE_API_KEY", "")
    if not expected or x_engine_key is None or not secrets.compare_digest(
        x_engine_key.encode(), expected.encode()
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Clé moteur invalide.")


class RecomputeRequest(BaseModel):
    shop: str


def _run_recompute(shop: str) -> None:
    try:
        recompute(shop)
    except Exception:
        logger.exception("Échec du calcul pour %s", shop)
    finally:
        with _running_lock:
            _running.discard(shop)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/recompute", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_key)])
def post_recompute(body: RecomputeRequest, background: BackgroundTasks) -> dict:
    with _running_lock:
        if body.shop in _running:
            raise HTTPException(status.HTTP_409_CONFLICT, "Calcul déjà en cours pour cette boutique.")
        _running.add(body.shop)
    background.add_task(_run_recompute, body.shop)
    return {"status": "accepted"}


@app.get("/status", dependencies=[Depends(require_key)])
def get_status(shop: str) -> dict:
    with _running_lock:
        running = shop in _running
    info = db.load_status(shop)
    computed_at = info["computed_at"]
    return {
        "running": running,
        # Stocké en UTC sans fuseau : on l'explicite pour le client
        "computed_at": computed_at.isoformat() + "Z" if computed_at else None,
        "pairs": info["pairs"],
        "stats": info["stats"],
    }
