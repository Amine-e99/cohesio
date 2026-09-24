"""Point d'entrée du moteur : python run.py [--shop boutique.myshopify.com]"""
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone

import pandas as pd

import db
from analysis import compute_pairs, compute_stats, filter_pairs


@dataclass
class RecomputeResult:
    lines: pd.DataFrame
    products: pd.DataFrame
    pairs: pd.DataFrame
    kept: pd.DataFrame
    stats: pd.DataFrame


def recompute(shop: str) -> RecomputeResult:
    """Charge, calcule et enregistre paires et stats d'une boutique (CLI et API)."""
    settings = db.load_settings(shop)
    lines = db.load_order_lines(shop)
    products = db.load_products(shop)
    # processed_at est stocké en UTC sans fuseau (Prisma) : même convention ici
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    pairs = compute_pairs(lines)
    kept = filter_pairs(
        pairs,
        min_co_count=settings.min_co_count,
        min_confidence=settings.min_confidence,
        min_lift=settings.min_lift,
    )
    stats = compute_stats(products, lines, kept, now, dead_days=settings.dead_days)

    db.save_pairs(shop, kept)
    db.save_stats(shop, stats)
    return RecomputeResult(lines, products, pairs, kept, stats)


def print_summary(shop: str, result: RecomputeResult) -> None:
    titles = dict(zip(result.products["product_id"], result.products["title"]))
    pd.set_option("display.width", 200)

    print(f"{shop} : {len(result.lines)} lignes, {result.lines['order_id'].nunique()} commandes, "
          f"{len(result.products)} produits\n")

    print(f"{len(result.kept)} paires retenues sur {len(result.pairs)} (product_pairs)")
    shown = result.kept.copy()
    for col in ("product_a", "product_b"):
        shown[col] = shown[col].map(titles).fillna(shown[col])
    print(shown.round(3).to_string(index=False), "\n")

    print(f"{len(result.stats)} stats produit (product_stats)")
    shown = result.stats.copy()
    shown.insert(0, "title", shown["product_id"].map(titles))
    shown = shown.drop(columns="product_id").sort_values(["classification", "orders_count"])
    print(shown.to_string(index=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="Calcule paires et stats d'une boutique.")
    parser.add_argument("--shop", default="cohesio.myshopify.com")
    shop = parser.parse_args().shop
    print_summary(shop, recompute(shop))


if __name__ == "__main__":
    main()
