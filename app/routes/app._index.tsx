import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useSyncExternalStore } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { importAllOrders } from "../services/import-orders.server";
import {
  getEngineStatus,
  triggerRecompute,
} from "../services/engine.server";

/** Pendant un calcul, la page se rafraîchit à ce rythme. */
const STATUS_POLL_MS = 2_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [totalLines, engine] = await Promise.all([
    prisma.orderLine.count({ where: { shopId: session.shop } }),
    getEngineStatus(session.shop),
  ]);

  return { shop: session.shop, totalLines, engine };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();

  if (formData.get("intent") !== "import") {
    return { ok: false as const, message: "Action inconnue." };
  }

  try {
    const result = await importAllOrders(admin, session.shop);
    const analysis = await triggerRecompute(session.shop);
    return { ok: true as const, ...result, analysis };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error ? error.message : "L'import n'a pas abouti.",
    };
  }
};

/**
 * Date formatée dans le fuseau du navigateur. Le serveur, qui ne connaît pas
 * ce fuseau, rend la date ISO ; le client la remplace après l'hydratation.
 */
const noSubscription = () => () => {};

function LocalDate({ iso }: { iso: string }) {
  const isClient = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  const text = isClient
    ? new Date(iso).toLocaleString("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : iso;

  return <time dateTime={iso}>{text}</time>;
}

export default function Index() {
  const { shop, totalLines, engine } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  // Tant que le moteur calcule, on relit le statut jusqu'à la fin du calcul.
  const engineRunning = engine.ok && engine.running;
  useEffect(() => {
    if (!engineRunning || revalidator.state !== "idle") {
      return;
    }
    const timer = setTimeout(() => revalidator.revalidate(), STATUS_POLL_MS);
    return () => clearTimeout(timer);
  }, [engineRunning, revalidator]);

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
        <s-paragraph>
          {!engine.ok ? (
            `Moteur injoignable (${engine.message})`
          ) : engine.running ? (
            "Analyse en cours…"
          ) : engine.computedAt ? (
            <>
              Dernière analyse : <LocalDate iso={engine.computedAt} />,{" "}
              {engine.pairs} paires
            </>
          ) : (
            "Aucune analyse pour l'instant."
          )}
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
              <s-list-item>Produits synchronisés : {result.products}</s-list-item>
              <s-list-item>
                {result.analysis.ok
                  ? "Analyse lancée"
                  : `Analyse non lancée : ${result.analysis.message}`}
              </s-list-item>
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
