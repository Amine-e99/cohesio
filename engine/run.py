"""Point d'entrée du moteur : python run.py [--shop boutique.myshopify.com]"""
import argparse
from datetime import datetime, timezone

import pandas as pd

import db
from analysis import compute_pairs, compute_stats, filter_pairs


def main() -> None:
    parser = argparse.ArgumentParser(description="Calcule paires et stats d'une boutique.")
    parser.add_argument("--shop", default="cohesio.myshopify.com")
    shop = parser.parse_args().shop

    lines = db.load_order_lines(shop)
    products = db.load_products(shop)
    # processed_at est stocké en UTC sans fuseau (Prisma) : même convention ici
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    pairs = compute_pairs(lines)
    kept = filter_pairs(pairs)
    stats = compute_stats(products, lines, kept, now)

    db.save_pairs(shop, kept)
    db.save_stats(shop, stats)

    titles = dict(zip(products["product_id"], products["title"]))
    pd.set_option("display.width", 200)

    print(f"{shop} : {len(lines)} lignes, {lines['order_id'].nunique()} commandes, "
          f"{len(products)} produits\n")

    print(f"{len(kept)} paires retenues sur {len(pairs)} (product_pairs)")
    shown = kept.copy()
    for col in ("product_a", "product_b"):
        shown[col] = shown[col].map(titles).fillna(shown[col])
    print(shown.round(3).to_string(index=False), "\n")

    print(f"{len(stats)} stats produit (product_stats)")
    shown = stats.copy()
    shown.insert(0, "title", shown["product_id"].map(titles))
    shown = shown.drop(columns="product_id").sort_values(["classification", "orders_count"])
    print(shown.to_string(index=False))


if __name__ == "__main__":
    main()
