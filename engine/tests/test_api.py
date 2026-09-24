import pytest
from fastapi.testclient import TestClient

import api

KEY = "test-key"


@pytest.fixture
def calls(monkeypatch) -> list[str]:
    """Clé de test et faux recompute : aucun accès base, aucun vrai calcul."""
    recorded: list[str] = []
    monkeypatch.setenv("ENGINE_API_KEY", KEY)
    monkeypatch.setattr(api, "recompute", recorded.append)
    return recorded


@pytest.fixture
def client() -> TestClient:
    return TestClient(api.app)


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_recompute_without_key(client, calls):
    response = client.post("/recompute", json={"shop": "test.myshopify.com"})
    assert response.status_code == 401
    assert calls == []


def test_recompute_wrong_key(client, calls):
    response = client.post(
        "/recompute", json={"shop": "test.myshopify.com"}, headers={"X-Engine-Key": "wrong"}
    )
    assert response.status_code == 401
    assert calls == []


def test_recompute_good_key(client, calls):
    response = client.post(
        "/recompute", json={"shop": "test.myshopify.com"}, headers={"X-Engine-Key": KEY}
    )
    assert response.status_code == 202
    assert response.json() == {"status": "accepted"}
    assert calls == ["test.myshopify.com"]
    assert "test.myshopify.com" not in api._running


@pytest.fixture
def clean_state():
    """Remet à zéro l'état partagé du module entre deux tests."""
    api._running.clear()
    api._pending.clear()
    yield
    api._running.clear()
    api._pending.clear()


def test_recompute_while_running_is_queued(client, calls, clean_state):
    shop = "test.myshopify.com"
    api._running.add(shop)  # un calcul est en cours

    for _ in range(2):  # deux demandes pendant le même calcul
        response = client.post("/recompute", json={"shop": shop}, headers={"X-Engine-Key": KEY})
        assert response.status_code == 202
        assert response.json() == {"status": "queued"}

    assert calls == []  # aucun calcul lancé en parallèle
    assert api._pending == {shop}


def test_queued_recompute_runs_once_more(calls, clean_state):
    shop = "test.myshopify.com"
    api._running.add(shop)
    api._pending.add(shop)

    api._run_recompute(shop)

    assert calls == [shop, shop]  # le calcul, puis une seule relance
    assert shop not in api._running
    assert shop not in api._pending


def test_failed_recompute_still_releases_shop(monkeypatch, clean_state):
    shop = "test.myshopify.com"

    def boom(_shop):
        raise RuntimeError("base indisponible")

    monkeypatch.setattr(api, "recompute", boom)
    api._running.add(shop)

    api._run_recompute(shop)

    assert shop not in api._running
