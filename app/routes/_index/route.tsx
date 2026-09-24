import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

const SOURCE_URL = "https://github.com/Amine-e99/cohesio";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <main className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.heading}>Cohesio</h1>
          <p className={styles.text}>
            Découvrez quels produits vos clients achètent ensemble.
          </p>
        </header>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span className={styles.labelText}>Domaine de la boutique</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                autoComplete="off"
                spellCheck={false}
              />
              <span className={styles.hint}>
                ex. : ma-boutique.myshopify.com
              </span>
            </label>
            <button className={styles.button} type="submit">
              Se connecter
            </button>
          </Form>
        )}

        <ul className={styles.list}>
          <li className={styles.item}>
            <strong className={styles.itemTitle}>Associations fiables</strong>
            <span>
              Support, confiance et lift, pour écarter les coïncidences.
            </span>
          </li>
          <li className={styles.item}>
            <strong className={styles.itemTitle}>Stock mort repéré</strong>
            <span>Les produits qui ne se vendent plus.</span>
          </li>
          <li className={styles.item}>
            <strong className={styles.itemTitle}>
              Recommandations sur la boutique
            </strong>
            <span>
              Un bloc « Fréquemment achetés ensemble » sur les pages produit.
            </span>
          </li>
        </ul>

        <footer className={styles.footer}>
          Projet de portfolio ·{" "}
          <a className={styles.link} href={SOURCE_URL}>
            Code source sur GitHub
          </a>
        </footer>
      </main>
    </div>
  );
}
