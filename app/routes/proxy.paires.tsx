import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/** Nombre maximal de recommandations renvoyées pour une page produit. */
const MAX_RECOMMENDATIONS = 3;

interface Recommendation {
  productId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: string | null;
  currencyCode: string | null;
  confidence: number;
}

/**
 * Recommandations « souvent achetés ensemble » pour la vitrine, via l'App Proxy
 * (/apps/cohesio/paires?product_id=<id numérique>).
 *
 * Seuls `shop` (signé) et `product_id` sont lus : les paramètres client ajoutés
 * par le proxy (logged_in_customer_id) sont ignorés, et la réponse ne dépend
 * que du produit, ce qui la rend cachable publiquement.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Vérifie la signature du proxy ; lève une réponse 400 si elle est invalide.
  const { session } = await authenticate.public.appProxy(request);

  const rawId = new URL(request.url).searchParams.get("product_id") ?? "";
  if (!/^[1-9]\d*$/.test(rawId)) {
    return Response.json(
      { error: "product_id doit être un identifiant numérique." },
      { status: 400 },
    );
  }

  // Sans session, l'app n'est plus installée : ses données ont été supprimées.
  const recommendations = session
    ? await findRecommendations(
        session.shop,
        `gid://shopify/Product/${rawId}`,
      )
    : [];

  return Response.json(
    { recommendations },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
};

async function findRecommendations(
  shopId: string,
  productId: string,
): Promise<Recommendation[]> {
  const pairs = await prisma.productPair.findMany({
    where: { shopId, productA: productId },
    orderBy: [{ confidence: "desc" }, { lift: "desc" }],
    select: { productB: true, confidence: true },
  });
  if (pairs.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      shopId,
      status: "ACTIVE",
      productId: { in: pairs.map((pair) => pair.productB) },
    },
  });
  const byId = new Map(products.map((product) => [product.productId, product]));

  // Le tri des paires est conservé ; les produits non actifs sont écartés
  // avant la limite, pour garder jusqu'à 3 recommandations affichables.
  return pairs
    .flatMap((pair) => {
      const product = byId.get(pair.productB);
      if (!product || !product.handle) {
        return [];
      }
      return [
        {
          productId: product.productId,
          title: product.title,
          url: `/products/${product.handle}`,
          imageUrl: product.imageUrl,
          price: product.price,
          currencyCode: product.currencyCode,
          confidence: pair.confidence,
        },
      ];
    })
    .slice(0, MAX_RECOMMENDATIONS);
}
