"""Accès PostgreSQL du moteur. Toute requête est paramétrée et filtrée par shop_id."""
import logging
import os
from dataclasses import dataclass

import pandas as pd
import psycopg
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]
RETENTION_DAYS = 365  # historique conservé dans order_lines
logger = logging.getLogger("engine")


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def _query_df(sql: str, params: tuple) -> pd.DataFrame:
    """Exécute un SELECT et renvoie un DataFrame (colonnes présentes même si vide)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        columns = [col.name for col in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=columns)


@dataclass(frozen=True)
class Settings:
    """Seuils d'une boutique ; défauts identiques à ceux de ShopSettings (Prisma)."""
    min_co_count: int = 8
    min_confidence: float = 0.20
    min_lift: float = 1.5
    dead_days: int = 30


def load_settings(shop: str) -> Settings:
    """Réglages d'UNE boutique, ou les défauts si elle n'en a jamais enregistré."""
    with connect() as conn:
        row = conn.execute(
            "SELECT min_co_count, min_confidence, min_lift, dead_days "
            "FROM shop_settings WHERE shop_id = %s",
            (shop,),
        ).fetchone()
    if row is None:
        return Settings()
    min_co_count, min_confidence, min_lift, dead_days = row
    return Settings(int(min_co_count), float(min_confidence), float(min_lift), int(dead_days))


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


def _replace_rows(cur: psycopg.Cursor, shop: str, table: str,
                  columns: list[str], rows: list[tuple]) -> None:
    """Remplace les lignes de la boutique dans `table`, dans la transaction de `cur`.

    `table` et `columns` sont des constantes du module, jamais des entrées utilisateur.
    """
    placeholders = ", ".join(["%s"] * (len(columns) + 1))
    insert = (
        f"INSERT INTO {table} (shop_id, {', '.join(columns)}, computed_at) "  # UTC sans fuseau, comme Prisma
        f"VALUES ({placeholders}, now() AT TIME ZONE 'UTC')"
    )
    cur.execute(f"DELETE FROM {table} WHERE shop_id = %s", (shop,))
    cur.executemany(insert, [(shop, *row) for row in rows])


def _pair_rows(pairs: pd.DataFrame) -> list[tuple]:
    return [
        (r.product_a, r.product_b, int(r.co_count),
         float(r.support), float(r.confidence), float(r.lift))
        for r in pairs.itertuples(index=False)
    ]


def _stat_rows(stats: pd.DataFrame) -> list[tuple]:
    return [
        (r.product_id, int(r.total_qty), int(r.orders_count),
         None if pd.isna(r.last_sold_at) else pd.Timestamp(r.last_sold_at).to_pydatetime(),
         r.classification)
        for r in stats.itertuples(index=False)
    ]


def save_results(shop: str, pairs: pd.DataFrame, stats: pd.DataFrame) -> bool:
    """Remplace paires et stats de la boutique en une seule transaction.

    Rien n'est écrit si la boutique n'a plus de session (app désinstallée pendant
    le calcul). FOR SHARE verrouille la session jusqu'au COMMIT : le webhook
    app/uninstalled, qui supprime la session en premier, attend la fin de cette
    transaction puis efface aussi ces résultats. Renvoie False si rien n'est écrit.
    """
    with connect() as conn:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute('SELECT 1 FROM "Session" WHERE shop = %s FOR SHARE', (shop,))
            if cur.fetchone() is None:
                logger.info("%s : boutique désinstallée, résultats ignorés", shop)
                return False
            _replace_rows(
                cur, shop, "product_pairs",
                ["product_a", "product_b", "co_count", "support", "confidence", "lift"],
                _pair_rows(pairs),
            )
            _replace_rows(
                cur, shop, "product_stats",
                ["product_id", "total_qty", "orders_count", "last_sold_at", "classification"],
                _stat_rows(stats),
            )
    return True


def purge_old_order_lines(shop: str, days: int = RETENTION_DAYS) -> int:
    """Supprime les lignes de commande de la boutique plus vieilles que `days` jours."""
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM order_lines WHERE shop_id = %s "
            "AND processed_at < (now() AT TIME ZONE 'UTC') - make_interval(days => %s)",
            (shop, days),
        )
        return cur.rowcount


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
