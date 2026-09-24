import os
from itertools import combinations

import pandas as pd
import psycopg
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]
SHOP = "cohesio.myshopify.com"

# Seuils de rétention d'une paire (les trois doivent être atteints)
MIN_CO_COUNT = 8        # commandes minimum contenant les deux produits
MIN_CONFIDENCE = 0.20   # P(B | A)
MIN_LIFT = 1.5          # au-delà du hasard


def load_order_lines(shop: str) -> pd.DataFrame:
    """Lit order_lines pour UNE boutique. Le filtre shop_id est obligatoire."""
    with psycopg.connect(DATABASE_URL) as conn:
        return pd.read_sql(
            "SELECT order_id, product_id, quantity, processed_at "
            "FROM order_lines WHERE shop_id = %s",
            conn,
            params=(shop,),
        )


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

    # Étape 3 : compter les commandes par paire
    pairs = pd.DataFrame(rows, columns=["product_a", "product_b"])
    pairs = pairs.groupby(["product_a", "product_b"]).size().reset_index(name="co_count")

    # Étape 4 : les métriques
    pairs["support"] = pairs["co_count"] / n_orders
    pairs["confidence"] = pairs["co_count"] / pairs["product_a"].map(product_count)
    pairs["lift"] = pairs["confidence"] / (pairs["product_b"].map(product_count) / n_orders)
    return pairs.sort_values("lift", ascending=False)


def filter_pairs(pairs: pd.DataFrame) -> pd.DataFrame:
    """Ne garde que les paires qui passent les trois seuils."""
    kept = (
        (pairs["co_count"] >= MIN_CO_COUNT)
        & (pairs["confidence"] >= MIN_CONFIDENCE)
        & (pairs["lift"] >= MIN_LIFT)
    )
    return pairs[kept]


def save_pairs(shop: str, pairs: pd.DataFrame) -> None:
    """Remplace les paires de la boutique, en une seule transaction.

    Si l'INSERT échoue, le DELETE est annulé : la boutique garde ses anciennes paires.
    """
    rows = [
        (shop, r.product_a, r.product_b, int(r.co_count),
         float(r.support), float(r.confidence), float(r.lift))
        for r in pairs.itertuples(index=False)
    ]
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("DELETE FROM product_pairs WHERE shop_id = %s", (shop,))
            cur.executemany(
                "INSERT INTO product_pairs "
                "(shop_id, product_a, product_b, co_count, support, confidence, lift, computed_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, now())",
                rows,
            )


def load_titles(shop: str) -> dict:
    """product_id -> titre, depuis la table products synchronisée par l'app."""
    with psycopg.connect(DATABASE_URL) as conn:
        rows = conn.execute(
            "SELECT product_id, title FROM products WHERE shop_id = %s",
            (shop,),
        ).fetchall()
    return dict(rows)


if __name__ == "__main__":
    lines = load_order_lines(SHOP)
    print(f"{len(lines)} lignes, {lines['order_id'].nunique()} commandes\n")
    pairs = compute_pairs(lines)
    kept = filter_pairs(pairs)
    save_pairs(SHOP, kept)
    print(f"{len(kept)} paires retenues sur {len(pairs)}, enregistrées dans product_pairs\n")

    titles = load_titles(SHOP)
    shown = kept.copy()
    shown["product_a"] = shown["product_a"].map(titles).fillna(shown["product_a"])
    shown["product_b"] = shown["product_b"].map(titles).fillna(shown["product_b"])
    pd.set_option("display.width", 200)
    print(shown.round(3).to_string(index=False))
