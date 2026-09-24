import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getProductTitles } from "../services/titles.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const pairs = await prisma.productPair.findMany({
    where: { shopId: session.shop },
    orderBy: [{ lift: "desc" }, { confidence: "desc" }],
    select: {
      id: true,
      productA: true,
      productB: true,
      coCount: true,
      confidence: true,
      lift: true,
    },
  });

  const titles = await getProductTitles(
    session.shop,
    pairs.flatMap((p) => [p.productA, p.productB]),
  );

  return {
    pairs: pairs.map((p) => ({
      id: p.id,
      productA: titles.get(p.productA) ?? p.productA,
      productB: titles.get(p.productB) ?? p.productB,
      coCount: p.coCount,
      confidence: p.confidence,
      lift: p.lift,
    })),
  };
};

const percent = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 0,
});
const twoDecimals = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Associations() {
  const { pairs } = useLoaderData<typeof loader>();

  if (pairs.length === 0) {
    return (
      <s-page heading="Associations">
        <s-section>
          <s-paragraph>
            Aucune association pour l&apos;instant. Importez vos commandes
            depuis l&apos;accueil, puis attendez la fin de l&apos;analyse : les
            produits souvent achetés ensemble apparaîtront ici.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Associations">
      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Produit</s-table-header>
            <s-table-header listSlot="secondary">
              Souvent acheté avec
            </s-table-header>
            <s-table-header format="numeric">Confiance</s-table-header>
            <s-table-header format="numeric">Lift</s-table-header>
            <s-table-header format="numeric">Commandes</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {pairs.map((pair) => (
              <s-table-row key={pair.id}>
                <s-table-cell>{pair.productA}</s-table-cell>
                <s-table-cell>{pair.productB}</s-table-cell>
                <s-table-cell>{percent.format(pair.confidence)}</s-table-cell>
                <s-table-cell>{twoDecimals.format(pair.lift)}</s-table-cell>
                <s-table-cell>{pair.coCount}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
