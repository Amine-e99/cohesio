import prisma from "../db.server";

/** Titres des produits de la boutique, indexés par gid Shopify. */
export async function getProductTitles(
  shopId: string,
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) {
    return new Map();
  }
  const products = await prisma.product.findMany({
    where: { shopId, productId: { in: [...new Set(productIds)] } },
    select: { productId: true, title: true },
  });
  return new Map(products.map((p) => [p.productId, p.title]));
}
