import os
import requests
from dotenv import load_dotenv

load_dotenv()  # lit le fichier .env du dossier courant

SHOP = os.environ["SHOPIFY_SHOP"]
CLIENT_ID = os.environ["SHOPIFY_CLIENT_ID"]
CLIENT_SECRET = os.environ["SHOPIFY_CLIENT_SECRET"]
API_VERSION = "2025-10"  # la version vue dans les logs de ton app


def get_token() -> str:
    """Échange ID + secret contre un token valable 24 h."""
    resp = requests.post(
        f"https://{SHOP}.myshopify.com/admin/oauth/access_token",
        # data= envoie un formulaire classique, le format exigé par Shopify ici
        data={
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        },
        timeout=30,
    )
    if not resp.ok:
        # le corps de la réponse contient le message d'erreur de Shopify (jamais ton secret)
        print("Refus de Shopify :", resp.status_code, resp.text)
    resp.raise_for_status()
    body = resp.json()
    print("Scopes accordés :", body["scope"])  # on affiche les scopes, JAMAIS le token
    return body["access_token"]


def graphql(token: str, query: str, variables: dict | None = None) -> dict:
    """Envoie une requête GraphQL Admin avec le token."""
    resp = requests.post(
        f"https://{SHOP}.myshopify.com/admin/api/{API_VERSION}/graphql.json",
        json={"query": query, "variables": variables or {}},
        headers={"X-Shopify-Access-Token": token},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    # GraphQL peut répondre 200 OK avec des erreurs dans le corps : on les vérifie
    if body.get("errors"):
        raise RuntimeError(body["errors"])
    return body["data"]


if __name__ == "__main__":
    token = get_token()
    data = graphql(token, "{ shop { name } }")
    print("Connecté à :", data["shop"]["name"])