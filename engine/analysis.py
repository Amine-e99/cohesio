"""Calculs du moteur : fonctions pures, sans accès à la base."""
from datetime import datetime, timedelta
from itertools import combinations

import pandas as pd

PAIR_COLUMNS = ["product_a", "product_b", "co_count", "support", "confidence", "lift"]


def compute_pairs(lines: pd.DataFrame) -> pd.DataFrame:
    """De la table de lignes aux paires avec support, confiance, lift."""
    n_orders = lines["order_id"].nunique()

    # Étape 1 : une commande = un ensemble de produits
    baskets = lines.groupby("order_id")["product_id"].apply(set)

    # Nombre de commandes contenant chaque produit (pour confiance et lift)
    product_count = lines.groupby("product_id")["order_id"].nunique()

    # Étape 2 : toutes les paires de chaque commande, dans les deux sens
    rows = []
    for products in baskets:
        for a, b in combinations(sorted(products), 2):  # (a, b) non ordonnée
            rows.append((a, b))
            rows.append((b, a))  # deux lignes par paire, décision de la Phase 0

    if not rows:
        return pd.DataFrame(columns=PAIR_COLUMNS)

    # Étape 3 : compter les commandes par paire
    pairs = pd.DataFrame(rows, columns=["product_a", "product_b"])
    pairs = pairs.groupby(["product_a", "product_b"]).size().reset_index(name="co_count")

    # Étape 4 : les métriques
    pairs["support"] = pairs["co_count"] / n_orders
    pairs["confidence"] = pairs["co_count"] / pairs["product_a"].map(product_count)
    pairs["lift"] = pairs["confidence"] / (pairs["product_b"].map(product_count) / n_orders)
    return pairs.sort_values("lift", ascending=False)


def filter_pairs(
    pairs: pd.DataFrame,
    min_co_count: int = 8,
    min_confidence: float = 0.20,
    min_lift: float = 1.5,
) -> pd.DataFrame:
    """Ne garde que les paires qui passent les trois seuils."""
    kept = (
        (pairs["co_count"] >= min_co_count)
        & (pairs["confidence"] >= min_confidence)
        & (pairs["lift"] >= min_lift)
    )
    return pairs[kept]


def compute_stats(
    products: pd.DataFrame,
    lines: pd.DataFrame,
    kept_pairs: pd.DataFrame,
    now: datetime,
    dead_days: int = 30,
) -> pd.DataFrame:
    """Une ligne par produit du catalogue, y compris ceux jamais vendus.

    `now` doit avoir le même fuseau que `processed_at` (UTC naïf en base).
    Classification, dans l'ordre :
      - a_destocker : jamais vendu, ou aucune vente depuis `dead_days` jours ;
      - performant  : orders_count >= médiane des produits vendus ;
      - a_lier      : sous la médiane, et product_a d'une paire retenue ;
      - a_surveiller : sous la médiane, sans paire retenue.
    """
    sales = lines.groupby("product_id").agg(
        total_qty=("quantity", "sum"),
        orders_count=("order_id", "nunique"),
        last_sold_at=("processed_at", "max"),
    )
    stats = products[["product_id"]].merge(
        sales, left_on="product_id", right_index=True, how="left"
    )
    stats["total_qty"] = stats["total_qty"].fillna(0).astype(int)
    stats["orders_count"] = stats["orders_count"].fillna(0).astype(int)

    sold = stats["orders_count"] > 0
    median = stats.loc[sold, "orders_count"].median()
    cutoff = now - timedelta(days=dead_days)
    linked = set(kept_pairs["product_a"])

    def classify(row) -> str:
        if pd.isna(row.last_sold_at) or row.last_sold_at < cutoff:
            return "a_destocker"
        if row.orders_count >= median:
            return "performant"
        if row.product_id in linked:
            return "a_lier"
        return "a_surveiller"

    stats["classification"] = [classify(r) for r in stats.itertuples(index=False)]
    # None plutôt que NaT pour « jamais vendu »
    stats["last_sold_at"] = stats["last_sold_at"].astype(object).where(
        stats["last_sold_at"].notna(), None
    )
    return stats.reset_index(drop=True)
