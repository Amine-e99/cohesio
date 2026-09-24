import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";

/** Maximum autorisé par l'API Admin pour une page de produits. */
const PAGE_SIZE = 250;

const PRODUCTS_QUERY = `#graphql
  query CatalogProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      nodes {
        id
        title
        status
        createdAt
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

interface ProductNode {
  id: string;
  title: string;
  /** ACTIVE, ARCHIVED, DRAFT, UNLISTED. */
  status: string;
  createdAt: string;
}

interface ProductsPage {
  nodes: ProductNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/** Parcourt le catalogue page par page (curseur `after`). */
export async function fetchAllProducts(
  admin: AdminApiContext,
): Promise<ProductNode[]> {
  const products: ProductNode[] = [];
  let after: string | null = null;

  do {
    const response = await admin.graphql(PRODUCTS_QUERY, {
      variables: { first: PAGE_SIZE, after },
    });

    const body = (await response.json()) as {
      data?: { products: ProductsPage };
    };

    const page = body.data?.products;

    if (!page) {
      throw new Error("Lecture du catalogue : réponse Shopify inattendue.");
    }

    products.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after !== null);

  return products;
}

/**
 * Synchronise le catalogue dans `products` : chaque produit est créé ou mis à
 * jour (titre et statut peuvent changer côté Shopify).
 *
 * @returns le nombre de produits synchronisés.
 */
export async function syncProducts(
  admin: AdminApiContext,
  shopId: string,
): Promise<number> {
  const products = await fetchAllProducts(admin);

  await prisma.$transaction(
    products.map((product) => {
      const data = {
        title: product.title,
        status: product.status,
        createdAt: new Date(product.createdAt),
      };

      return prisma.product.upsert({
        where: { shopId_productId: { shopId, productId: product.id } },
        create: { shopId, productId: product.id, ...data },
        update: data,
      });
    }),
  );

  return products.length;
}
