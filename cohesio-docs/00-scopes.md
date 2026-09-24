# Scopes et protection des données clients

## Niveau Protected Customer Data : niveau 1

Shopify classe l'objet `Order` comme donnée client protégée. Dès qu'on lit des commandes, on sort du niveau 0.

Cohesio reste au **niveau 1** : il n'a besoin d'aucun des quatre champs identifiants (nom, adresse, e-mail, téléphone). L'analyse ne regarde que quels produits apparaissent ensemble dans une même commande.

Champs lus sur une commande : `id`, `createdAt`, `lineItems { product { id }, quantity }`.
Champs **jamais** demandés : `customer`, `email`, `phone`, `shippingAddress`, `billingAddress`.

En développement (boutique de test uniquement), pas de revue Shopify : il suffit de cocher « Protected customer data » dans le Dashboard, sans les quatre champs, avec une justification.

## Scopes demandés

| Scope | Pourquoi | Phase |
|---|---|---|
| `read_orders` | lire les produits de chaque commande | 2 |
| `read_products` | titres, images, prix pour le dashboard et le bloc storefront | 2 |
| `read_inventory` | détecter le stock mort (stock restant sans ventes) | 3 |
| `write_products` | créer les bundles | 7 |

Limite connue : `read_orders` ne donne accès qu'aux 60 derniers jours de commandes. Au-delà, il faut `read_all_orders`, une permission demandée séparément à Shopify. Choix pour le portfolio : 60 jours, documenté comme limite.

## Exigences de niveau 1 et mise en œuvre

| Exigence | Dans Cohesio |
|---|---|
| Minimiser les données | requête GraphQL limitée aux champs ci-dessus |
| Informer le marchand | page Politique de confidentialité (Phase 9) |
| Limiter à la finalité déclarée | données utilisées uniquement pour l'analyse d'associations de produits |
| Consentement / opt-out / décisions automatisées | aucune donnée personnelle traitée, aucune décision sur les personnes ; à préciser dans la politique |
| Accord avec les marchands | politique de confidentialité + conditions (Phase 9) |
| Durée de conservation | `order_lines` purgées au-delà de 12 mois ; suppression totale à la désinstallation (Phase 5) |
| Chiffrement | HTTPS partout ; disque PostgreSQL chiffré (Azure) ; token d'accès Shopify chiffré en base |
