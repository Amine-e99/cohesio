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
