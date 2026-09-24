from datetime import datetime, timedelta

import pandas as pd
import pytest

from analysis import compute_pairs, compute_stats, filter_pairs

NOW = datetime(2026, 9, 23, 12, 0)
SOLD_AT = NOW - timedelta(days=5)

ORDERS = {
    1: ["cafe", "filtres"],
    2: ["cafe", "filtres"],
    3: ["cafe", "filtres", "tasse"],
    4: ["cafe"],
    5: ["tasse"],
    6: ["cafe", "filtres"],
    7: ["cafe", "tasse"],
}
CATALOG = ["cafe", "filtres", "tasse", "poster"]


@pytest.fixture
def lines() -> pd.DataFrame:
    rows = [
        (f"order-{order}", product, 1, SOLD_AT)
        for order, products in ORDERS.items()
        for product in products
    ]
    return pd.DataFrame(rows, columns=["order_id", "product_id", "quantity", "processed_at"])


@pytest.fixture
def products() -> pd.DataFrame:
    return pd.DataFrame({"product_id": CATALOG, "title": [p.title() for p in CATALOG]})


@pytest.fixture
def pairs(lines) -> pd.DataFrame:
    return compute_pairs(lines)


def pair(pairs: pd.DataFrame, a: str, b: str) -> pd.Series:
    match = pairs[(pairs["product_a"] == a) & (pairs["product_b"] == b)]
    assert len(match) == 1
    return match.iloc[0]


def test_confidence_filtres_to_cafe(pairs):
    assert pair(pairs, "filtres", "cafe")["confidence"] == pytest.approx(1.0)


def test_confidence_cafe_to_filtres(pairs):
    assert pair(pairs, "cafe", "filtres")["confidence"] == pytest.approx(4 / 6)


def test_lift_filtres_to_cafe(pairs):
    assert pair(pairs, "filtres", "cafe")["lift"] == pytest.approx(7 / 6)


def test_lift_tasse_to_cafe_below_one(pairs):
    assert pair(pairs, "tasse", "cafe")["lift"] < 1


def test_lift_is_symmetric(pairs):
    for r in pairs.itertuples(index=False):
        assert pair(pairs, r.product_b, r.product_a)["lift"] == pytest.approx(r.lift)


def test_never_sold_product_is_a_destocker(products, lines, pairs):
    stats = compute_stats(products, lines, filter_pairs(pairs), NOW)
    assert len(stats) == len(CATALOG)
    poster = stats[stats["product_id"] == "poster"].iloc[0]
    assert poster["classification"] == "a_destocker"
    assert poster["last_sold_at"] is None
    assert poster["total_qty"] == 0
    assert poster["orders_count"] == 0


def test_filter_min_co_count_5_keeps_nothing(pairs):
    assert filter_pairs(pairs, min_co_count=5).empty
