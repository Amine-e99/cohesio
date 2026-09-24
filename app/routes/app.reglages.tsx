import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { triggerRecompute } from "../services/engine.server";

/** Valeurs affichées dans le formulaire ; la confiance y est en %. */
interface FormValues {
  minCoCount: number;
  minConfidencePct: number;
  minLift: number;
  deadDays: number;
}

type Field = keyof FormValues;
type FieldErrors = Partial<Record<Field, string>>;

/** Identiques aux @default du modèle ShopSettings et à db.Settings du moteur. */
const DEFAULTS: FormValues = {
  minCoCount: 8,
  minConfidencePct: 20,
  minLift: 1.5,
  deadDays: 30,
};

const RULES: Record<
  Field,
  { min: number; max: number; integer: boolean; message: string }
> = {
  minCoCount: {
    min: 2,
    max: 1000,
    integer: true,
    message: "Entier entre 2 et 1000.",
  },
  minConfidencePct: {
    min: 5,
    max: 100,
    integer: false,
    message: "Nombre entre 5 et 100 %.",
  },
  minLift: {
    min: 1,
    max: 10,
    integer: false,
    message: "Nombre entre 1,0 et 10.",
  },
  deadDays: {
    min: 7,
    max: 60,
    integer: true,
    message:
      "Entier entre 7 et 60 (les commandes importées ne remontent qu'à 60 jours).",
  },
};

const FIELDS = Object.keys(RULES) as Field[];

/** Accepte « 1,5 » comme « 1.5 » ; NaN si vide ou non numérique. */
function parseNumber(raw: FormDataEntryValue | null): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return Number.NaN;
  }
  return Number(raw.trim().replace(",", "."));
}

function validate(formData: FormData) {
  const values = {} as FormValues;
  const errors: FieldErrors = {};

  for (const field of FIELDS) {
    const rule = RULES[field];
    const value = parseNumber(formData.get(field));
    const valid =
      Number.isFinite(value) &&
      value >= rule.min &&
      value <= rule.max &&
      (!rule.integer || Number.isInteger(value));
    if (valid) {
      values[field] = value;
    } else {
      errors[field] = rule.message;
    }
  }

  return { values, errors };
}

function toFormValues(settings: {
  minCoCount: number;
  minConfidence: number;
  minLift: number;
  deadDays: number;
}): FormValues {
  return {
    minCoCount: settings.minCoCount,
    // 0.2 -> 20, sans artefact d'arrondi (0.35 * 100 = 35.00000000000001)
    minConfidencePct: Math.round(settings.minConfidence * 1000) / 10,
    minLift: settings.minLift,
    deadDays: settings.deadDays,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const settings = await prisma.shopSettings.findUnique({
    where: { shopId: session.shop },
  });

  return { values: settings ? toFormValues(settings) : DEFAULTS };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  let values: FormValues;
  if (intent === "reset") {
    values = DEFAULTS;
  } else if (intent === "save") {
    const result = validate(formData);
    if (Object.keys(result.errors).length > 0) {
      // Rien n'est enregistré tant qu'un champ est invalide
      return { ok: false as const, errors: result.errors };
    }
    values = result.values;
  } else {
    return {
      ok: false as const,
      errors: {} as FieldErrors,
      message: "Action inconnue.",
    };
  }

  const data = {
    minCoCount: values.minCoCount,
    minConfidence: values.minConfidencePct / 100,
    minLift: values.minLift,
    deadDays: values.deadDays,
  };
  await prisma.shopSettings.upsert({
    where: { shopId: session.shop },
    create: { shopId: session.shop, ...data },
    update: data,
  });

  const analysis = await triggerRecompute(session.shop);
  return { ok: true as const, reset: intent === "reset", analysis };
};

export default function Reglages() {
  const { values } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data;
  const errors: FieldErrors = result && !result.ok ? result.errors : {};
  const isSaving = fetcher.state !== "idle";
  const savingIntent = fetcher.formData?.get("intent");

  const resetDefaults = () => {
    fetcher.submit({ intent: "reset" }, { method: "post" });
  };

  return (
    <s-page heading="Réglages">
      <s-section heading="Seuils de l'analyse">
        <s-stack gap="base">
          <s-paragraph>
            Ces seuils décident quelles paires de produits sont retenues et
            quand un produit est considéré comme à déstocker. Chaque
            enregistrement relance l&apos;analyse.
          </s-paragraph>

          {result && result.ok ? (
            <s-banner
              heading={
                result.reset
                  ? "Valeurs par défaut rétablies"
                  : "Réglages enregistrés"
              }
              tone={result.analysis.ok ? "success" : "warning"}
            >
              {result.analysis.ok
                ? "L'analyse est relancée : les résultats seront à jour dans quelques secondes."
                : `Analyse non relancée : ${result.analysis.message}`}
            </s-banner>
          ) : null}

          {result && !result.ok ? (
            <s-banner heading="Réglages non enregistrés" tone="critical">
              {"message" in result
                ? result.message
                : "Corrigez les champs en erreur : aucune valeur n'a été enregistrée."}
            </s-banner>
          ) : null}

          {/* La clé remonte le formulaire quand les valeurs enregistrées changent (ex. rétablissement). */}
          <fetcher.Form method="post" key={JSON.stringify(values)}>
            <input type="hidden" name="intent" value="save" />
            <s-stack gap="base">
              <s-number-field
                label="Commandes communes minimum"
                name="minCoCount"
                defaultValue={String(values.minCoCount)}
                min={2}
                max={1000}
                step={1}
                inputMode="numeric"
                details="Nombre de commandes où les deux produits apparaissent ensemble (2 à 1000)."
                error={errors.minCoCount}
              />
              <s-number-field
                label="Confiance minimum"
                name="minConfidencePct"
                defaultValue={String(values.minConfidencePct)}
                min={5}
                max={100}
                step={1}
                suffix="%"
                inputMode="decimal"
                details="Part des acheteurs du produit A qui prennent aussi B (5 à 100 %)."
                error={errors.minConfidencePct}
              />
              <s-number-field
                label="Lift minimum"
                name="minLift"
                defaultValue={String(values.minLift)}
                min={1}
                max={10}
                step={0.1}
                inputMode="decimal"
                details="Combien de fois l'association est plus fréquente que le hasard (1,0 à 10)."
                error={errors.minLift}
              />
              <s-number-field
                label="Jours sans vente avant déstockage"
                name="deadDays"
                defaultValue={String(values.deadDays)}
                min={7}
                max={60}
                step={1}
                suffix="jours"
                inputMode="numeric"
                details="Entre 7 et 60 jours : les commandes importées ne remontent qu'à 60 jours."
                error={errors.deadDays}
              />
              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  loading={isSaving && savingIntent === "save"}
                  disabled={isSaving}
                >
                  Enregistrer
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={resetDefaults}
                  loading={isSaving && savingIntent === "reset"}
                  disabled={isSaving}
                >
                  Rétablir les valeurs par défaut
                </s-button>
              </s-stack>
            </s-stack>
          </fetcher.Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
