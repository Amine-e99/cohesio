import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import {
  downloadJsonl,
  runOrdersBulkQuery,
  waitForBulkOperation,
} from "./bulk-orders.server";
import { syncProducts } from "./import-products.server";

/** Une ligne prête à être écrite dans `order_lines` (le `shopId` est ajouté à l'insertion). */
export interface OrderLineInput {
  orderId: string;
  productId: string;
  quantity: number;
  processedAt: Date;
}

export interface ImportResult {
  /** Commandes lues dans le fichier JSONL. */
  orders: number;
  /** Lignes exploitables extraites du fichier. */
  lines: number;
  /** Lignes réellement écrites en base (les doublons sont ignorés). */
  inserted: number;
  /** Produits du catalogue synchronisés dans `products`. */
  products: number;
}

/** PostgreSQL accepte de gros INSERT, mais des lots bornés gardent les requêtes courtes. */
const BATCH_SIZE = 500;

/**
 * Forme des enregistrements du JSONL produit par l'opération groupée.
 * Une ligne racine est une commande, une ligne portant `__parentId` est une
 * ligne de commande rattachée à cette commande.
 */
interface JsonlRecord {
  id?: string;
  processedAt?: string;
  quantity?: number;
  /** `null` quand le produit a été supprimé de la boutique. */
  product?: { id: string } | null;
  __parentId?: string;
}

function parseRecords(text: string): JsonlRecord[] {
  const records: JsonlRecord[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    if (line === "") {
      continue;
    }

    records.push(JSON.parse(line) as JsonlRecord);
  }

  return records;
}

/**
 * Transforme le JSONL de l'opération groupée en lignes prêtes pour `order_lines`.
 *
 * Les lignes de commande dont le produit est `null` (produit supprimé depuis)
 * sont ignorées : on ne saurait pas à quel produit les rattacher.
 *
 * Une même commande peut contenir plusieurs lignes pour le même produit (deux
 * variantes, par exemple). La contrainte d'unicité `shopId + orderId + productId`
 * n'autorise qu'une ligne : les quantités sont donc additionnées ici, sans quoi
 * la seconde ligne serait silencieusement perdue à l'insertion.
 */
export function parseOrdersJsonl(text: string): OrderLineInput[] {
  const processedAtByOrder = new Map<string, Date>();
  const itemsByKey = new Map<
    string,
    { orderId: string; productId: string; quantity: number }
  >();

  for (const record of parseRecords(text)) {
    if (record.__parentId === undefined) {
      // Ligne racine : une commande.
      if (record.id && record.processedAt) {
        processedAtByOrder.set(record.id, new Date(record.processedAt));
      }
      continue;
    }

    // Ligne enfant : une ligne de commande.
    if (!record.product) {
      continue;
    }

    const key = `${record.__parentId}\n${record.product.id}`;
    const existing = itemsByKey.get(key);

    if (existing) {
      existing.quantity += record.quantity ?? 0;
    } else {
      itemsByKey.set(key, {
        orderId: record.__parentId,
        productId: record.product.id,
        quantity: record.quantity ?? 0,
      });
    }
  }

  const lines: OrderLineInput[] = [];

  for (const item of itemsByKey.values()) {
    const processedAt = processedAtByOrder.get(item.orderId);

    // Ligne orpheline (commande absente du fichier) : on n'a pas sa date.
    if (!processedAt) {
      continue;
    }

    lines.push({ ...item, processedAt });
  }

  return lines;
}

/** Compte les commandes du fichier, c'est-à-dire les lignes sans `__parentId`. */
export function countOrdersInJsonl(text: string): number {
  let count = 0;

  for (const record of parseRecords(text)) {
    if (record.__parentId === undefined) {
      count += 1;
    }
  }

  return count;
}

/**
 * Écrit les lignes en base par lots.
 *
 * `skipDuplicates` s'appuie sur la contrainte d'unicité
 * `shopId + orderId + productId` : relancer l'import n'écrit rien de nouveau.
 *
 * @returns le nombre de lignes réellement insérées.
 */
export async function importOrders(
  shopId: string,
  lines: OrderLineInput[],
): Promise<number> {
  let inserted = 0;

  for (let start = 0; start < lines.length; start += BATCH_SIZE) {
    const batch = lines
      .slice(start, start + BATCH_SIZE)
      .map((line) => ({ shopId, ...line }));

    const result = await prisma.orderLine.createMany({
      data: batch,
      skipDuplicates: true,
    });

    inserted += result.count;
  }

  return inserted;
}

/**
 * Import initial complet : synchronise le catalogue, lance l'opération groupée,
 * attend son résultat, télécharge le JSONL et écrit les lignes en base.
 */
export async function importAllOrders(
  admin: AdminApiContext,
  shopId: string,
): Promise<ImportResult> {
  const products = await syncProducts(admin, shopId);

  const operationId = await runOrdersBulkQuery(admin);
  const url = await waitForBulkOperation(admin, operationId);

  // Aucun fichier : la boutique n'a aucune commande.
  if (url === null) {
    return { orders: 0, lines: 0, inserted: 0, products };
  }

  const jsonl = await downloadJsonl(url);
  const lines = parseOrdersJsonl(jsonl);
  const inserted = await importOrders(shopId, lines);

  return {
    orders: countOrdersInJsonl(jsonl),
    lines: lines.length,
    inserted,
    products,
  };
}
