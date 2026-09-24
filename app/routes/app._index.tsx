import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return { shop: session.shop };
};

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();

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
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
