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
# Boutiques à recalculer une fois de plus : demande reçue pendant leur calcul
_pending: set[str] = set()
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
    """Calcule, puis recommence tant qu'une demande est arrivée pendant le calcul.

    Plusieurs demandes pendant un même calcul ne donnent qu'une seule relance.
    """
    while True:
        try:
            recompute(shop)
        except Exception:
            logger.exception("Échec du calcul pour %s", shop)
        with _running_lock:
            if shop in _pending:
                _pending.discard(shop)
                continue
            _running.discard(shop)
            return


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/recompute", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_key)])
def post_recompute(body: RecomputeRequest, background: BackgroundTasks) -> dict:
    with _running_lock:
        if body.shop in _running:
            # Les données ont pu changer depuis le début du calcul : on relancera à la fin
            _pending.add(body.shop)
            return {"status": "queued"}
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
