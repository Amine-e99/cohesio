import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Requête exécutée en masse par Shopify pour récupérer l'historique des commandes.
 *
 * Niveau Protected Customer Data 1 : on ne demande aucune donnée client
 * (pas de customer, email, phone ni addresses), uniquement ce qui sert à
 * repérer les produits achetés ensemble.
 *
 * Pas de marqueur `#graphql` ici : cette chaîne n'est pas une opération envoyée
 * par le client GraphQL, c'est l'argument `query` de la mutation ci-dessous.
 */
const ORDERS_BULK_QUERY = `
{
  orders {
    edges {
      node {
        id
        processedAt
        lineItems {
          edges {
            node {
              quantity
              product {
                id
              }
            }
          }
        }
      }
    }
  }
}`;

const RUN_BULK_QUERY_MUTATION = `#graphql
  mutation RunOrdersBulkQuery($query: String!) {
    bulkOperationRunQuery(query: $query, groupObjects: false) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

const BULK_OPERATION_STATUS_QUERY = `#graphql
  query BulkOperationStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        url
        errorCode
        objectCount
      }
    }
  }`;

/** Intervalle entre deux vérifications de l'état de l'opération. */
const POLL_INTERVAL_MS = 2_000;

/** Au-delà, on abandonne plutôt que d'attendre indéfiniment. */
const POLL_TIMEOUT_MS = 5 * 60 * 1_000;

type BulkOperationStatus =
  | "CANCELED"
  | "CANCELING"
  | "COMPLETED"
  | "CREATED"
  | "EXPIRED"
  | "FAILED"
  | "RUNNING";

interface BulkOperationNode {
  id: string;
  status: BulkOperationStatus;
  /** Lien vers le fichier JSONL. `null` tant que l'opération n'est pas terminée. */
  url: string | null;
  errorCode: string | null;
  /** `UnsignedInt64`, sérialisé en chaîne par l'API. */
  objectCount: string;
}

interface UserError {
  field: string[] | null;
  message: string;
  code: string | null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Demande à Shopify de lancer l'export des commandes en arrière-plan.
 *
 * `groupObjects: false` produit un JSONL plat : chaque commande est une ligne
 * racine, chaque ligne de commande une ligne enfant portant `__parentId`.
 *
 * @returns l'identifiant (gid) de l'opération groupée créée.
 */
export async function runOrdersBulkQuery(
  admin: AdminApiContext,
): Promise<string> {
  const response = await admin.graphql(RUN_BULK_QUERY_MUTATION, {
    variables: { query: ORDERS_BULK_QUERY },
  });

  const body = (await response.json()) as {
    data?: {
      bulkOperationRunQuery: {
        bulkOperation: { id: string; status: BulkOperationStatus } | null;
        userErrors: UserError[];
      } | null;
    };
  };

  const payload = body.data?.bulkOperationRunQuery;
  const userErrors = payload?.userErrors ?? [];

  if (userErrors.length > 0) {
    const details = userErrors
      .map((error) => `${error.code ?? "erreur"} : ${error.message}`)
      .join(" ; ");
    throw new Error(`Lancement de l'opération groupée refusé (${details}).`);
  }

  const operationId = payload?.bulkOperation?.id;

  if (!operationId) {
    throw new Error(
      "Lancement de l'opération groupée : Shopify n'a retourné aucun identifiant.",
    );
  }

  return operationId;
}

/**
 * Interroge Shopify toutes les 2 s jusqu'à ce que l'opération soit terminée.
 *
 * @returns l'URL du fichier JSONL, ou `null` si l'opération s'est terminée sans
 *   aucun objet (Shopify ne produit alors pas de fichier).
 * @throws si l'opération échoue, est annulée ou expire, et si le délai
 *   d'attente de 5 min est dépassé.
 */
export async function waitForBulkOperation(
  admin: AdminApiContext,
  id: string,
): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await admin.graphql(BULK_OPERATION_STATUS_QUERY, {
      variables: { id },
    });

    const body = (await response.json()) as {
      data?: { node: BulkOperationNode | null };
    };

    const operation = body.data?.node;

    if (!operation) {
      throw new Error(`Opération groupée introuvable : ${id}.`);
    }

    switch (operation.status) {
      case "COMPLETED":
        return operation.url;

      case "FAILED":
      case "CANCELED":
      case "EXPIRED":
        throw new Error(
          `Opération groupée ${operation.status} après ${operation.objectCount} objets ` +
            `(${operation.errorCode ?? "sans code d'erreur"}).`,
        );

      default:
        // CREATED, RUNNING, CANCELING : on continue d'attendre.
        break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Opération groupée toujours en cours après ${POLL_TIMEOUT_MS / 1_000} s : ${id}.`,
  );
}

/** Télécharge le fichier JSONL produit par l'opération groupée. */
export async function downloadJsonl(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Téléchargement du fichier JSONL impossible (HTTP ${response.status}).`,
    );
  }

  return response.text();
}
