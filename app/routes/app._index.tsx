import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { LocalDate } from "../components/LocalDate";
import { authenticate } from "../shopify.server";
import { importAllOrders } from "../services/import-orders.server";
import {
  getEngineStatus,
  triggerRecompute,
} from "../services/engine.server";
import { getProductTitles } from "../services/titles.server";

/** Pendant un calcul, la page se rafraîchit à ce rythme. */
const STATUS_POLL_MS = 2_000;

/** Seuils de fiabilité, en nombre de commandes distinctes analysées. */
const RELIABILITY_MEDIUM = 100;
const RELIABILITY_GOOD = 500;

async function countDistinctOrders(shopId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(DISTINCT order_id)::int AS n
    FROM order_lines
    WHERE shop_id = ${shopId}
  `;
  return rows[0]?.n ?? 0;
}

/**
 * Pour chaque produit « à lier », son meilleur partenaire : la paire où il est
 * product_a avec la plus haute confiance, départagée par le lift.
 */
async function getPackSuggestions(shopId: string) {
  const toLink = await prisma.productStat.findMany({
    where: { shopId, classification: "a_lier" },
    select: { productId: true },
  });
  if (toLink.length === 0) {
    return [];
  }

  const pairs = await prisma.productPair.findMany({
    where: { shopId, productA: { in: toLink.map((s) => s.productId) } },
    orderBy: [{ confidence: "desc" }, { lift: "desc" }],
    select: { productA: true, productB: true, confidence: true },
  });

  const best = new Map<string, (typeof pairs)[number]>();
  for (const pair of pairs) {
    if (!best.has(pair.productA)) {
      best.set(pair.productA, pair);
    }
  }

  const titles = await getProductTitles(
    shopId,
    [...best.values()].flatMap((p) => [p.productA, p.productB]),
  );

  return [...best.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .map((p) => ({
      productA: titles.get(p.productA) ?? p.productA,
      productB: titles.get(p.productB) ?? p.productB,
      confidencePct: Math.round(p.confidence * 100),
    }));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [totalLines, ordersCount, packs, engine] = await Promise.all([
    prisma.orderLine.count({ where: { shopId: session.shop } }),
    countDistinctOrders(session.shop),
    getPackSuggestions(session.shop),
    getEngineStatus(session.shop),
  ]);

  return { shop: session.shop, totalLines, ordersCount, packs, engine };
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

export default function Index() {
  const { shop, totalLines, ordersCount, packs, engine } =
    useLoaderData<typeof loader>();
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

      <s-section heading="Fiabilité">
        {ordersCount < RELIABILITY_MEDIUM ? (
          <s-banner heading="Fiabilité faible" tone="warning">
            Seulement {ordersCount} commandes analysées. Il en faut au moins{" "}
            {RELIABILITY_MEDIUM} pour que les associations aient du sens.
          </s-banner>
        ) : ordersCount < RELIABILITY_GOOD ? (
          <s-paragraph>
            Fiabilité moyenne : {ordersCount} commandes analysées. Les
            résultats sont indicatifs.
          </s-paragraph>
        ) : (
          <s-paragraph>
            Fiabilité bonne : {ordersCount} commandes analysées.
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Suggestions de packs">
        {packs.length === 0 ? (
          <s-paragraph>
            Aucune suggestion pour l&apos;instant : aucun produit à lier
            n&apos;a de partenaire.
          </s-paragraph>
        ) : (
          <s-unordered-list>
            {packs.map((pack) => (
              <s-list-item key={pack.productA}>
                Proposer {pack.productA} avec {pack.productB} —{" "}
                {pack.confidencePct} % des acheteurs de {pack.productA}{" "}
                prennent aussi {pack.productB}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}
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
