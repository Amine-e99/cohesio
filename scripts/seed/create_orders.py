import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

from shopify_client import get_token, graphql

if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

SCRIPT_DIR = os.path.dirname(__file__)
PRODUCTS_FILE = os.path.join(SCRIPT_DIR, "products.json")
PROGRESS_FILE = os.path.join(SCRIPT_DIR, "orders_progress.json")

N_ORDERS = 200
DAYS_BACK = 55
SEED = 42
DELAY_SECONDS = 13
THROTTLE_WAIT_SECONDS = 60
MAX_RETRIES = 5
SEED_TAG = "cohesio-seed"

SCENARIOS = ["cafe_filtre", "grains", "the", "divers"]
SCENARIO_WEIGHTS = [30, 15, 20, 35]

DIVERS_POOL = [
    "tasse-en-ceramique",
    "mug-isotherme",
    "cafetiere-a-piston",
    "cafe-moulu",
    "cafe-en-grains",
]

DISPLAY_NAMES = {
    "cafe-en-grains": "Café en grains",
    "moulin-a-cafe": "Moulin à café",
    "cafe-moulu": "Café moulu",
    "filtres-papier": "Filtres papier",
    "cafetiere-a-piston": "Cafetière à piston",
    "tasse-en-ceramique": "Tasse en céramique",
    "mug-isotherme": "Mug isotherme",
    "the-vert": "Thé vert",
    "theiere": "Théière",
    "miel-de-montagne": "Miel de montagne",
    "biscuits-aux-amandes": "Biscuits aux amandes",
    "poster-cafe-vintage": "Poster café vintage",
}

CONFIDENCE_PAIRS = [
    ("cafe-moulu", "filtres-papier"),
    ("cafe-en-grains", "moulin-a-cafe"),
    ("the-vert", "theiere"),
    ("the-vert", "miel-de-montagne"),
    ("biscuits-aux-amandes", "cafe-moulu"),
]

ORDER_CREATE_MUTATION = """
mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    userErrors {
      field
      message
    }
  }
}
"""


def load_products():
    with open(PRODUCTS_FILE, encoding="utf-8") as f:
        return json.load(f)


def generate_basket():
    scenario = random.choices(SCENARIOS, weights=SCENARIO_WEIGHTS, k=1)[0]
    items = []

    if scenario == "cafe_filtre":
        items.append("cafe-moulu")
        if random.random() < 0.75:
            items.append("filtres-papier")
    elif scenario == "grains":
        items.append("cafe-en-grains")
        if random.random() < 0.6:
            items.append("moulin-a-cafe")
    elif scenario == "the":
        items.append("the-vert")
        if random.random() < 0.5:
            items.append("theiere")
        if random.random() < 0.55:
            items.append("miel-de-montagne")
    else:  # divers
        count = random.choice([1, 2])
        items.extend(random.sample(DIVERS_POOL, count))

    if random.random() < 0.2:
        items.append("biscuits-aux-amandes")

    lines = []
    for handle in items:
        quantity = 2 if random.random() < 0.15 else 1
        lines.append({"handle": handle, "quantity": quantity})

    now = datetime.now(timezone.utc)
    seconds_back = random.uniform(0, DAYS_BACK * 86400)
    processed_at = now - timedelta(seconds=seconds_back)

    return {"scenario": scenario, "lines": lines, "processed_at": processed_at}


def generate_baskets(n=N_ORDERS, seed=SEED):
    random.seed(seed)
    return [generate_basket() for _ in range(n)]


def basket_handles(basket):
    return {line["handle"] for line in basket["lines"]}


def print_dry_run_report(baskets):
    counts = {}
    for basket in baskets:
        for handle in basket_handles(basket):
            counts[handle] = counts.get(handle, 0) + 1

    print(f"Paniers générés : {len(baskets)}\n")
    print("Nombre de commandes contenant chaque produit :")
    for handle in DISPLAY_NAMES:
        print(f"  {DISPLAY_NAMES[handle]:<22} {counts.get(handle, 0)}")

    print("\nConfiance (P(consequent | antecedent)) :")
    for antecedent, consequent in CONFIDENCE_PAIRS:
        n_antecedent = sum(1 for b in baskets if antecedent in basket_handles(b))
        n_both = sum(
            1
            for b in baskets
            if antecedent in basket_handles(b) and consequent in basket_handles(b)
        )
        confidence = n_both / n_antecedent if n_antecedent else 0.0
        print(
            f"  {DISPLAY_NAMES[antecedent]} -> {DISPLAY_NAMES[consequent]:<20} "
            f"{confidence:.2%} ({n_both}/{n_antecedent})"
        )


def load_progress():
    if not os.path.exists(PROGRESS_FILE):
        return set()
    with open(PROGRESS_FILE, encoding="utf-8") as f:
        return set(json.load(f))


def save_progress(progress):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(progress), f)


def create_order_with_retry(token, variables):
    for attempt in range(MAX_RETRIES):
        try:
            data = graphql(token, ORDER_CREATE_MUTATION, variables)
        except RuntimeError as e:
            if "THROTTLED" in str(e).upper():
                print("Limite de débit atteinte, attente 60 s avant nouvelle tentative...")
                time.sleep(THROTTLE_WAIT_SECONDS)
                continue
            raise
        user_errors = data["orderCreate"]["userErrors"]
        if user_errors:
            raise RuntimeError(user_errors)
        return
    raise RuntimeError("Échec après plusieurs tentatives suite à des erreurs de limite de débit")


def run_normal(limit):
    products = load_products()
    baskets = generate_baskets()
    progress = load_progress()

    todo = [i for i in range(1, len(baskets) + 1) if i not in progress]
    if limit is not None:
        todo = todo[:limit]

    if not todo:
        print("Aucune commande à créer (tout est déjà fait ou limite atteinte).")
        return

    token = get_token()

    for i, order_number in enumerate(todo):
        basket = baskets[order_number - 1]
        line_items = [
            {
                "variantId": products[line["handle"]]["variant_id"],
                "quantity": line["quantity"],
            }
            for line in basket["lines"]
        ]
        variables = {
            "order": {
                "lineItems": line_items,
                "financialStatus": "PAID",
                "processedAt": basket["processed_at"].isoformat(),
                "tags": [SEED_TAG],
            },
            "options": {
                "sendReceipt": False,
            },
        }

        create_order_with_retry(token, variables)

        progress.add(order_number)
        save_progress(progress)
        print(f"commande {order_number}/{len(baskets)}")

        if i < len(todo) - 1:
            time.sleep(DELAY_SECONDS)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    if args.dry_run:
        baskets = generate_baskets()
        print_dry_run_report(baskets)
        return

    run_normal(args.limit)


if __name__ == "__main__":
    main()
