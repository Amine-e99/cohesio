"""Accès PostgreSQL du moteur. Toute requête est paramétrée et filtrée par shop_id."""
import os

import pandas as pd
import psycopg
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def _query_df(sql: str, params: tuple) -> pd.DataFrame:
    """Exécute un SELECT et renvoie un DataFrame (colonnes présentes même si vide)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        columns = [col.name for col in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=columns)


def load_order_lines(shop: str) -> pd.DataFrame:
    """Lignes de commande d'UNE boutique."""
    return _query_df(
        "SELECT order_id, product_id, quantity, processed_at "
        "FROM order_lines WHERE shop_id = %s",
        (shop,),
    )


def load_products(shop: str) -> pd.DataFrame:
    """Catalogue d'UNE boutique, synchronisé par l'app."""
    return _query_df(
        "SELECT product_id, title, status, created_at "
        "FROM products WHERE shop_id = %s",
        (shop,),
    )


def _replace_rows(shop: str, table: str, columns: list[str], rows: list[tuple]) -> None:
    """Remplace les lignes de la boutique dans `table`, en une seule transaction.

    Si l'INSERT échoue, le DELETE est annulé : la boutique garde ses anciennes lignes.
    `table` et `columns` sont des constantes du module, jamais des entrées utilisateur.
    """
    placeholders = ", ".join(["%s"] * (len(columns) + 1))
    insert = (
        f"INSERT INTO {table} (shop_id, {', '.join(columns)}, computed_at) "  # UTC sans fuseau, comme Prisma
        f"VALUES ({placeholders}, now() AT TIME ZONE 'UTC')"
    )
    with connect() as conn:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(f"DELETE FROM {table} WHERE shop_id = %s", (shop,))
            cur.executemany(insert, [(shop, *row) for row in rows])


def save_pairs(shop: str, pairs: pd.DataFrame) -> None:
    rows = [
        (r.product_a, r.product_b, int(r.co_count),
         float(r.support), float(r.confidence), float(r.lift))
        for r in pairs.itertuples(index=False)
    ]
    _replace_rows(
        shop, "product_pairs",
        ["product_a", "product_b", "co_count", "support", "confidence", "lift"],
        rows,
    )


def save_stats(shop: str, stats: pd.DataFrame) -> None:
    rows = [
        (r.product_id, int(r.total_qty), int(r.orders_count),
         None if pd.isna(r.last_sold_at) else pd.Timestamp(r.last_sold_at).to_pydatetime(),
         r.classification)
        for r in stats.itertuples(index=False)
    ]
    _replace_rows(
        shop, "product_stats",
        ["product_id", "total_qty", "orders_count", "last_sold_at", "classification"],
        rows,
    )


def load_status(shop: str) -> dict:
    """Dernier calcul de la boutique : date (UTC sans fuseau) et volumes enregistrés."""
    with connect() as conn:
        computed_at, pairs = conn.execute(
            "SELECT MAX(computed_at), COUNT(*) FROM product_pairs WHERE shop_id = %s",
            (shop,),
        ).fetchone()
        (stats,) = conn.execute(
            "SELECT COUNT(*) FROM product_stats WHERE shop_id = %s",
            (shop,),
        ).fetchone()
    return {"computed_at": computed_at, "pairs": pairs, "stats": stats}
