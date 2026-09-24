declare module "*.css";

/**
 * `s-app-nav` est un composant App Bridge, pas un composant Polaris :
 * `@shopify/polaris-types` ne le déclare donc pas et TypeScript le refuse dans
 * `app/routes/app.tsx`.
 *
 * On ne peut pas se contenter d'ajouter `@shopify/app-bridge-types` aux `types`
 * du tsconfig : ce paquet déclare aussi `s-page`, que `@shopify/polaris-types`
 * déclare déjà avec d'autres propriétés. On reprend donc uniquement le type du
 * composant manquant, importé depuis le paquet officiel pour rester aligné.
 *
 * À supprimer le jour où `@shopify/polaris-types` déclarera `s-app-nav`.
 */
declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": import("@shopify/app-bridge-types").SAppNavAttributes & {
      id?: string;
    };
  }
}
