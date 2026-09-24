import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { LocalDate } from "../components/LocalDate";
import { getProductTitles } from "../services/titles.server";

const SECTIONS = [
  {
    classification: "performant",
    heading: "Performants",
    tone: "success",
    description:
      "Ces produits se vendent bien. Gardez-les en avant et en stock.",
  },
  {
    classification: "a_lier",
    heading: "À lier",
    tone: "info",
    description:
      "Ces produits sont souvent achetés avec un autre : proposez-les en pack pour augmenter le panier.",
  },
  {
    classification: "a_surveiller",
    heading: "À surveiller",
    tone: "caution",
    description:
      "Ces produits se vendent peu ou ralentissent. Suivez leur évolution avant qu'ils ne dorment en stock.",
  },
  {
    classification: "a_destocker",
    heading: "À déstocker",
    tone: "critical",
    description:
      "Ces produits ne se vendent plus depuis longtemps, voire jamais. Pensez à une promotion ou à les retirer.",
  },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const stats = await prisma.productStat.findMany({
    where: { shopId: session.shop },
    orderBy: [{ ordersCount: "desc" }, { totalQty: "desc" }],
    select: {
      productId: true,
      classification: true,
      ordersCount: true,
      totalQty: true,
      lastSoldAt: true,
    },
  });

  const titles = await getProductTitles(
    session.shop,
    stats.map((s) => s.productId),
  );

  return {
    products: stats.map((s) => ({
      productId: s.productId,
      title: titles.get(s.productId) ?? s.productId,
      classification: s.classification,
      ordersCount: s.ordersCount,
      totalQty: s.totalQty,
      lastSoldAt: s.lastSoldAt?.toISOString() ?? null,
    })),
  };
};

export default function Catalogue() {
  const { products } = useLoaderData<typeof loader>();

  if (products.length === 0) {
    return (
      <s-page heading="Catalogue">
        <s-section>
          <s-paragraph>
            Aucun produit analysé pour l&apos;instant. Importez vos commandes
            depuis l&apos;accueil : l&apos;analyse classera ensuite chaque
            produit.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Catalogue">
      {SECTIONS.map((section) => {
        const rows = products.filter(
          (p) => p.classification === section.classification,
        );
        return (
          <s-section key={section.classification} heading={section.heading}>
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={section.tone}>
                  {rows.length} produit{rows.length > 1 ? "s" : ""}
                </s-badge>
                <s-text>{section.description}</s-text>
              </s-stack>
              {rows.length === 0 ? (
                <s-paragraph>Aucun produit dans cette catégorie.</s-paragraph>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Produit</s-table-header>
                    <s-table-header format="numeric">Commandes</s-table-header>
                    <s-table-header format="numeric">
                      Quantité vendue
                    </s-table-header>
                    <s-table-header>Dernière vente</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {rows.map((p) => (
                      <s-table-row key={p.productId}>
                        <s-table-cell>{p.title}</s-table-cell>
                        <s-table-cell>{p.ordersCount}</s-table-cell>
                        <s-table-cell>{p.totalQty}</s-table-cell>
                        <s-table-cell>
                          {p.lastSoldAt ? (
                            <LocalDate iso={p.lastSoldAt} withTime={false} />
                          ) : (
                            "jamais"
                          )}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          </s-section>
        );
      })}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
