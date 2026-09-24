import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // Tout ou rien : si une suppression échoue, l'erreur remonte, Shopify réessaie.
  // Sessions en premier : le moteur verrouille la session (FOR SHARE) avant
  // d'écrire ses résultats, donc cette suppression attend la fin d'un calcul en
  // cours, puis les suppressions suivantes effacent aussi ce qu'il vient d'écrire.
  // Idempotent : un webhook rejoué ne supprime simplement rien.
  const [
    sessions,
    orderLines,
    products,
    productPairs,
    productStats,
    shopSettings,
  ] = await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.orderLine.deleteMany({ where: { shopId: shop } }),
    db.product.deleteMany({ where: { shopId: shop } }),
    db.productPair.deleteMany({ where: { shopId: shop } }),
    db.productStat.deleteMany({ where: { shopId: shop } }),
    db.shopSettings.deleteMany({ where: { shopId: shop } }),
  ]);

  console.log(
    `app/uninstalled ${shop} : lignes supprimées ` +
      JSON.stringify({
        order_lines: orderLines.count,
        products: products.count,
        product_pairs: productPairs.count,
        product_stats: productStats.count,
        shop_settings: shopSettings.count,
        sessions: sessions.count,
      }),
  );

  return new Response();
};
