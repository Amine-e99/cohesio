import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { triggerRecompute } from "../services/engine.server";

/**
 * Seuls champs lus dans la commande. Les données client (customer, email,
 * phone, adresses) ne sont ni lues, ni stockées, ni journalisées.
 */
interface OrderPayload {
  admin_graphql_api_id?: unknown;
  processed_at?: unknown;
  line_items?: unknown;
}

interface LineItemPayload {
  product_id?: unknown;
  quantity?: unknown;
}

/** Quantité par produit : les lignes d'un même produit (variantes) sont additionnées. */
function quantitiesByProduct(lineItems: unknown): Map<string, number> {
  const quantities = new Map<string, number>();
  if (!Array.isArray(lineItems)) {
    return quantities;
  }

  for (const item of lineItems as LineItemPayload[]) {
    const { product_id: productId, quantity } = item ?? {};
    // Lignes sans produit (montant personnalisé, produit supprimé) : ignorées
    if (
      (typeof productId !== "number" && typeof productId !== "string") ||
      productId === ""
    ) {
      continue;
    }
    if (typeof quantity !== "number" || quantity <= 0) {
      continue;
    }
    const gid = `gid://shopify/Product/${productId}`;
    quantities.set(gid, (quantities.get(gid) ?? 0) + quantity);
  }

  return quantities;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Vérifie la signature HMAC : lève une réponse 401 si elle est absente ou fausse
  const { shop, topic, payload } = await authenticate.webhook(request);

  const order = payload as OrderPayload;
  const orderId = order.admin_graphql_api_id;
  const processedAt =
    typeof order.processed_at === "string"
      ? new Date(order.processed_at)
      : null;

  if (
    typeof orderId !== "string" ||
    !processedAt ||
    Number.isNaN(processedAt.getTime())
  ) {
    console.warn(`${topic} ignoré pour ${shop} : id ou date de commande absent.`);
    return new Response();
  }

  const lines = [...quantitiesByProduct(order.line_items)].map(
    ([productId, quantity]) => ({
      shopId: shop,
      orderId,
      productId,
      quantity,
      processedAt,
    }),
  );

  if (lines.length > 0) {
    // Shopify peut renvoyer le même webhook : la contrainte unique évite les doublons
    const { count } = await prisma.orderLine.createMany({
      data: lines,
      skipDuplicates: true,
    });
    console.log(`${topic} ${orderId} pour ${shop} : ${count} lignes insérées.`);
  }

  // Sans attendre : Shopify veut une réponse rapide, le calcul se fait en arrière-plan
  void triggerRecompute(shop)
    .then((result) => {
      if (!result.ok) {
        console.error(`Analyse non relancée pour ${shop} : ${result.message}`);
      }
    })
    .catch((error: unknown) => {
      console.error(`Analyse non relancée pour ${shop}`, error);
    });

  return new Response();
};
