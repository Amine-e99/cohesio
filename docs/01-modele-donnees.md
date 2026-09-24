# Modèle de données

Toutes les tables ont une colonne `shop_id` : la base contient plusieurs boutiques, leurs données ne doivent jamais se mélanger. Toute requête filtre sur `shop_id`.

Note : le template Remix de Shopify crée déjà une table `Session` (Prisma) qui stocke le token d'accès. Les tables ci-dessous s'ajoutent à elle.

## `shops` — une ligne par boutique installée
| Colonne | Type | Rôle |
|---|---|---|
| `id` | identifiant | clé primaire |
| `shop_domain` | texte, unique | ex. `cafe-atlas.myshopify.com` |
| `installed_at` | date | date d'installation |
| `last_sync_at` | date | dernier import de commandes |

## `order_lines` — données brutes (table de faits)
| Colonne | Type | Rôle |
|---|---|---|
| `shop_id` | référence | boutique |
| `order_id` | texte | identifiant Shopify de la commande |
| `product_id` | texte | identifiant Shopify du produit |
| `quantity` | entier | quantité achetée |
| `ordered_at` | date | date de la commande |

Contrainte d'unicité sur (`shop_id`, `order_id`, `product_id`) : si Shopify renvoie deux fois le même webhook, la commande n'est pas comptée en double.

Aucune donnée client dans cette table.

## `product_pairs` — résultats du moteur, par paire
| Colonne | Type | Rôle |
|---|---|---|
| `shop_id` | référence | boutique |
| `product_a` | texte | produit de départ |
| `product_b` | texte | produit associé |
| `co_count` | entier | nombre de commandes contenant A et B |
| `support` | décimal | part des commandes contenant A et B |
| `confidence` | décimal | part des commandes avec A qui contiennent aussi B |
| `lift` | décimal | force de l'association par rapport au hasard |
| `computed_at` | date | date du calcul |

## `product_stats` — résultats du moteur, par produit
| Colonne | Type | Rôle |
|---|---|---|
| `shop_id` | référence | boutique |
| `product_id` | texte | produit |
| `total_qty` | entier | quantité vendue sur la période |
| `orders_count` | entier | nombre de commandes contenant le produit |
| `last_sold_at` | date | dernière vente |
| `classification` | texte | performant / à déstocker / à lier |
| `computed_at` | date | date du calcul |

## Décisions
1. **On garde `order_lines`** (et pas seulement les résultats) : permet de tout recalculer après un plantage ou avec d'autres seuils.
2. **Conservation** : lignes de plus de 12 mois supprimées automatiquement ; toutes les données de la boutique supprimées à la désinstallation.
3. 3. **Sens des paires** : deux lignes par paire (A→B et B→A), car la confiance dépend du sens. Le bloc storefront cherche les lignes où `product_a` = produit de la page.
