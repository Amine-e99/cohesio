import { useSyncExternalStore } from "react";

/**
 * Date formatée dans le fuseau du navigateur. Le serveur, qui ne connaît pas
 * ce fuseau, rend la date ISO ; le client la remplace après l'hydratation.
 */
const noSubscription = () => () => {};

export function LocalDate({
  iso,
  withTime = true,
}: {
  iso: string;
  withTime?: boolean;
}) {
  const isClient = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  const text = isClient
    ? new Date(iso).toLocaleString("fr-FR", {
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" as const } : {}),
      })
    : iso;

  return <time dateTime={iso}>{text}</time>;
}
