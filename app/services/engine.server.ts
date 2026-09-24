/**
 * Client du moteur Python (engine/api.py).
 *
 * Aucune fonction ne lève d'exception : un moteur arrêté ou lent doit
 * afficher un message, pas faire planter la page.
 */

/** Au-delà, le moteur est considéré comme injoignable. */
const TIMEOUT_MS = 5_000;

export type EngineResult<T> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

export interface EngineStatus {
  running: boolean;
  /** Date ISO (UTC) du dernier calcul, `null` si jamais calculé. */
  computedAt: string | null;
  pairs: number;
  stats: number;
}

async function callEngine(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response } | { message: string }> {
  const baseUrl = process.env.ENGINE_URL;
  const key = process.env.ENGINE_API_KEY;

  if (!baseUrl || !key) {
    return { message: "Moteur non configuré (ENGINE_URL ou ENGINE_API_KEY)." };
  }

  try {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Engine-Key": key,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { response };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      message: timedOut
        ? `Moteur injoignable (pas de réponse en ${TIMEOUT_MS / 1_000} s).`
        : "Moteur injoignable.",
    };
  }
}

/** Demande au moteur de recalculer paires et stats de la boutique. */
export async function triggerRecompute(
  shop: string,
): Promise<EngineResult<Record<never, never>>> {
  const result = await callEngine("/recompute", {
    method: "POST",
    body: JSON.stringify({ shop }),
  });

  if ("message" in result) {
    return { ok: false, message: result.message };
  }

  switch (result.response.status) {
    case 202:
      return { ok: true };
    case 409:
      return { ok: false, message: "Une analyse est déjà en cours." };
    case 401:
      return { ok: false, message: "Clé moteur refusée." };
    default:
      return {
        ok: false,
        message: `Le moteur a répondu ${result.response.status}.`,
      };
  }
}

/** État du dernier calcul de la boutique. */
export async function getEngineStatus(
  shop: string,
): Promise<EngineResult<EngineStatus>> {
  const params = new URLSearchParams({ shop });
  const result = await callEngine(`/status?${params}`);

  if ("message" in result) {
    return { ok: false, message: result.message };
  }

  if (!result.response.ok) {
    return {
      ok: false,
      message: `Le moteur a répondu ${result.response.status}.`,
    };
  }

  let body: {
    running: boolean;
    computed_at: string | null;
    pairs: number;
    stats: number;
  };

  try {
    body = (await result.response.json()) as typeof body;
  } catch {
    return { ok: false, message: "Réponse du moteur illisible." };
  }

  return {
    ok: true,
    running: body.running,
    computedAt: body.computed_at,
    pairs: body.pairs,
    stats: body.stats,
  };
}
