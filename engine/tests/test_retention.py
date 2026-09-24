"""Désinstallation et rétention, contre la vraie base PostgreSQL.

Chaque test tourne dans une transaction annulée à la fin : la base n'est pas modifiée.
Ignorés si la base de DATABASE_URL est injoignable.
"""
from datetime import datetime, timedelta, timezone

import pandas as pd
import psycopg
import pytest

import db

SHOP = "pytest-retention.myshopify.com"


class NoCommitConnection:
    """Enveloppe une connexion : `with connect()` ne valide ni ne ferme rien."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        pass

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.fixture
def conn(monkeypatch):
    try:
        real = psycopg.connect(db.DATABASE_URL, connect_timeout=3)
    except psycopg.OperationalError:
        pytest.skip("base PostgreSQL injoignable")
    with real:
        # Hors autocommit, psycopg ouvre une transaction englobante : celles du
        # module deviennent des SAVEPOINT, tout est annulé par le rollback final
        monkeypatch.setattr(db, "connect", lambda: NoCommitConnection(real))
        yield real
        real.rollback()


def _count(conn, table: str) -> int:
    return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE shop_id = %s", (SHOP,)).fetchone()[0]


def test_save_results_ignored_without_session(conn, caplog):
    conn.execute('DELETE FROM "Session" WHERE shop = %s', (SHOP,))
    conn.execute(
        "INSERT INTO product_pairs (shop_id, product_a, product_b, co_count, support, "
        "confidence, lift, computed_at) VALUES (%s, 'a', 'b', 1, 0.1, 0.1, 1.0, now())",
        (SHOP,),
    )
    pairs = pd.DataFrame({"product_a": ["p1"], "product_b": ["p2"], "co_count": [9],
                          "support": [0.5], "confidence": [0.5], "lift": [2.0]})
    stats = pd.DataFrame({"product_id": ["p1"], "total_qty": [3], "orders_count": [2],
                          "last_sold_at": [datetime(2026, 9, 1)], "classification": ["star"]})

    with caplog.at_level("INFO", logger="engine"):
        saved = db.save_results(SHOP, pairs, stats)

    assert saved is False
    assert "boutique désinstallée, résultats ignorés" in caplog.text
    # Rien n'a été écrit ni effacé
    rows = conn.execute(
        "SELECT product_a FROM product_pairs WHERE shop_id = %s", (SHOP,)
    ).fetchall()
    assert rows == [("a",)]
    assert _count(conn, "product_stats") == 0


def test_purge_removes_only_lines_older_than_365_days(conn):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    other_shop = "pytest-other.myshopify.com"
    lines = [
        (SHOP, "old", now - timedelta(days=400)),
        (SHOP, "limit", now - timedelta(days=364)),
        (SHOP, "recent", now - timedelta(days=10)),
        (other_shop, "old-other", now - timedelta(days=400)),
    ]
    conn.cursor().executemany(
        "INSERT INTO order_lines (shop_id, order_id, product_id, quantity, processed_at) "
        "VALUES (%s, %s, 'p1', 1, %s)",
        lines,
    )

    deleted = db.purge_old_order_lines(SHOP)

    assert deleted == 1
    kept = conn.execute(
        "SELECT order_id FROM order_lines WHERE shop_id = %s ORDER BY order_id", (SHOP,)
    ).fetchall()
    assert kept == [("limit",), ("recent",)]
    # Les autres boutiques ne sont pas touchées
    (other,) = conn.execute(
        "SELECT COUNT(*) FROM order_lines WHERE shop_id = %s", (other_shop,)
    ).fetchone()
    assert other == 1
