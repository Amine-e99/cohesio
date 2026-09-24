# État du projet Cohesio

Dernière mise à jour : 21 septembre 2026

## Phase en cours
Phase 0 — Cadrage

## Fait
- Niveau Protected Customer Data choisi : **niveau 1** (commandes sans nom, adresse, e-mail ni téléphone)
- Schéma d'architecture corrigé : `docs/architecture.drawio`
- Ordre de traitement d'un webhook compris : vérifier HMAC → écrire en base → répondre 200 → lancer le recalcul
- Principe compris : la base est sur disque, un plantage de Remix ne l'efface pas ; tout résultat calculé peut être refait à partir de `order_lines`
- Calcul de la confiance fait à la main sur l'exemple de la boutique de Sara

## En cours
- Modèle de données : décider si `product_pairs` stocke une ou deux lignes par paire
- Scopes : liste proposée dans `docs/00-scopes.md`, à confirmer

## Prochaine étape
Terminer la Phase 0, puis Phase 1 — Squelette de l'app (Shopify CLI, Remix, OAuth, boutique de test)

## Points qui m'ont demandé plus d'explications
- Asynchrone (ne pas attendre la fin d'un traitement long)
- Différence entre la mémoire du serveur et la base de données

## Blocages
Aucun
