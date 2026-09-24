import json
import re
import sys
import unicodedata
from pathlib import Path

from shopify_client import get_token, graphql

CATALOG = [
    ("Café en grains", "90"),
    ("Moulin à café", "320"),
    ("Café moulu", "85"),
    ("Filtres papier", "25"),
    ("Cafetière à piston", "250"),
    ("Tasse en céramique", "60"),
    ("Mug isotherme", "150"),
    ("Thé vert", "70"),
    ("Théière", "220"),
    ("Miel de montagne", "110"),
    ("Biscuits aux amandes", "45"),
    ("Poster café vintage", "80"),
]

OUTPUT_PATH = Path(__file__).parent / "products.json"

FIND_PRODUCT_QUERY = """
query findProductByHandle($query: String!) {
  products(first: 1, query: $query) {
    nodes {
      id
      handle
      variants(first: 1) {
        nodes {
          id
          price
        }
      }
    }
  }
}
"""

PRODUCT_CREATE_MUTATION = """
mutation createProduct($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product {
      id
      handle
      variants(first: 1) {
        nodes {
          id
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
"""

VARIANT_PRICE_MUTATION = """
mutation setVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      price
    }
    userErrors {
      field
      message
    }
  }
}
"""


def slugify(title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    lowered = ascii_only.lower()
    handle = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return handle


def fail(context: str, user_errors: list) -> None:
    print(f"Erreurs Shopify ({context}) :")
    for error in user_errors:
        print(" -", error)
    sys.exit(1)


def main() -> None:
    token = get_token()
    results = {}

    for title, price in CATALOG:
        handle = slugify(title)

        existing = graphql(token, FIND_PRODUCT_QUERY, {"query": f"handle:{handle}"})
        nodes = existing["products"]["nodes"]

        if nodes:
            product_id = nodes[0]["id"]
            variant_id = nodes[0]["variants"]["nodes"][0]["id"]
            existing_price = nodes[0]["variants"]["nodes"][0]["price"]
            results[handle] = {
                "product_id": product_id,
                "variant_id": variant_id,
                "price": existing_price,
            }
            print(f"{title} ({handle}) : déjà existant")
            continue

        created = graphql(
            token,
            PRODUCT_CREATE_MUTATION,
            {"product": {"title": title, "handle": handle, "status": "ACTIVE"}},
        )
        create_errors = created["productCreate"]["userErrors"]
        if create_errors:
            fail(f"productCreate pour {title}", create_errors)

        product = created["productCreate"]["product"]
        product_id = product["id"]
        variant_id = product["variants"]["nodes"][0]["id"]

        priced = graphql(
            token,
            VARIANT_PRICE_MUTATION,
            {
                "productId": product_id,
                "variants": [
                    {
                        "id": variant_id,
                        "price": price,
                        "inventoryItem": {"tracked": False},
                    }
                ],
            },
        )
        price_errors = priced["productVariantsBulkUpdate"]["userErrors"]
        if price_errors:
            fail(f"productVariantsBulkUpdate pour {title}", price_errors)

        results[handle] = {
            "product_id": product_id,
            "variant_id": variant_id,
            "price": price,
        }
        print(f"{title} ({handle}) : créé")

    OUTPUT_PATH.write_text(
        json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
