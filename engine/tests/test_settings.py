from datetime import datetime

import pandas as pd

import db
import run


class FakeConnection:
    """Connexion factice : SELECT sans résultat, et mémorise la requête."""

    def __init__(self) -> None:
        self.executed: list[tuple] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass

    def execute(self, sql: str, params: tuple):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        return None


def test_load_settings_defaults_without_row(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(db, "connect", lambda: conn)

    settings = db.load_settings("test.myshopify.com")

    assert settings == db.Settings(
        min_co_count=8, min_confidence=0.20, min_lift=1.5, dead_days=30
    )
    # La requête est filtrée par boutique
    [(sql, params)] = conn.executed
    assert "shop_id = %s" in sql
    assert params == ("test.myshopify.com",)


def test_recompute_passes_settings(monkeypatch):
    shop = "test.myshopify.com"
    custom = db.Settings(min_co_count=3, min_confidence=0.35, min_lift=1.2, dead_days=14)
    lines = pd.DataFrame(
        {
            "order_id": ["o1", "o1", "o2"],
            "product_id": ["p1", "p2", "p1"],
            "quantity": [1, 1, 2],
            "processed_at": [datetime(2026, 9, 1)] * 3,
        }
    )
    products = pd.DataFrame(
        {"product_id": ["p1", "p2"], "title": ["A", "B"],
         "status": ["ACTIVE"] * 2, "created_at": [datetime(2026, 1, 1)] * 2}
    )

    loaded: list[str] = []
    monkeypatch.setattr(db, "load_settings", lambda s: loaded.append(s) or custom)
    monkeypatch.setattr(db, "load_order_lines", lambda s: lines)
    monkeypatch.setattr(db, "load_products", lambda s: products)
    monkeypatch.setattr(db, "purge_old_order_lines", lambda s: 0)
    monkeypatch.setattr(db, "save_results", lambda s, pairs, stats: True)

    filter_calls: list[dict] = []
    real_filter = run.filter_pairs

    def spy_filter(pairs, **kwargs):
        filter_calls.append(kwargs)
        return real_filter(pairs, **kwargs)

    stats_calls: list[dict] = []
    real_stats = run.compute_stats

    def spy_stats(*args, **kwargs):
        stats_calls.append(kwargs)
        return real_stats(*args, **kwargs)

    monkeypatch.setattr(run, "filter_pairs", spy_filter)
    monkeypatch.setattr(run, "compute_stats", spy_stats)

    run.recompute(shop)

    assert loaded == [shop]
    assert filter_calls == [
        {"min_co_count": 3, "min_confidence": 0.35, "min_lift": 1.2}
    ]
    assert stats_calls == [{"dead_days": 14}]
