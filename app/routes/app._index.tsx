import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { importAllOrders } from "../services/import-orders.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const totalLines = await prisma.orderLine.count({
    where: { shopId: session.shop },
  });

  return { shop: session.shop, totalLines };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();

  if (formData.get("intent") !== "import") {
    return { ok: false as const, message: "Action inconnue." };
  }

  try {
    const result = await importAllOrders(admin, session.shop);
    return { ok: true as const, ...result };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error ? error.message : "L'import n'a pas abouti.",
    };
  }
};

export default function Index() {
  const { shop, totalLines } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const isImporting = fetcher.state !== "idle";
  const result = fetcher.data;

  const startImport = () => {
    fetcher.submit({ intent: "import" }, { method: "post" });
  };

  return (
    <s-page heading="Cohesio">
      <s-section heading="Bienvenue">
        <s-paragraph>
          Cohesio analyse vos commandes pour trouver les produits achetés
          ensemble.
        </s-paragraph>
      </s-section>

      <s-section heading="Statut">
        <s-paragraph>Boutique connectée : {shop}</s-paragraph>
        <s-paragraph>
          Lignes de commande enregistrées : {totalLines}
        </s-paragraph>
      </s-section>

      <s-section heading="Import des commandes">
        <s-paragraph>
          L&apos;import récupère l&apos;historique des commandes auprès de
          Shopify. Il peut être relancé sans risque : les lignes déjà
          enregistrées ne sont pas dupliquées.
        </s-paragraph>

        {result && !result.ok ? (
          <s-banner heading="L'import a échoué" tone="critical">
            {result.message}
          </s-banner>
        ) : null}

        {result && result.ok ? (
          <s-banner heading="Import terminé" tone="success">
            <s-unordered-list>
              <s-list-item>Commandes lues : {result.orders}</s-list-item>
              <s-list-item>Lignes lues : {result.lines}</s-list-item>
              <s-list-item>Lignes insérées : {result.inserted}</s-list-item>
            </s-unordered-list>
          </s-banner>
        ) : null}

        <s-button variant="primary" loading={isImporting} onClick={startImport}>
          Importer les commandes
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
