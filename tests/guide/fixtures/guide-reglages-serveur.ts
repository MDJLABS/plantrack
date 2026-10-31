/* tests/guide/fixtures/guide-reglages-serveur.ts — réglages SERVEUR témoins, pour les tests.
 *
 * Même principe que `fixtures/scenarios.ts` et `fixtures/guide-reglages.ts` :
 * `guide-reglages-serveur.ts` est propre à CHAQUE SITE, jamais dans le moteur, jamais
 * écrasé par la synchro. Redirigé par `tests/guide/support/resolve-ts.mjs` UNIQUEMENT à
 * l'exécution des tests.
 *
 * `estAdmin` est piloté par la variable d'environnement `GUIDE_TEST_ADMIN` — absente ou
 * différente de "0" ⇒ admin, "0" ⇒ pas admin — pour que les tests de `guide-actions.ts`
 * puissent exercer la porte `estAdmin()` (qui gate TOUTE action) sans vraie session.
 * `appelsApresConsigne` enregistre chaque appel de `apresConsigne`, pour que les tests
 * puissent vérifier qu'il est bien déclenché (et avec quel résultat) sans double applicatif.
 */
import type { ReglagesGuideServeur, ResultatGuide } from "../../../.claude/hooks/plantrack_guide/lib/guide/types";

export const appelsApresConsigne: ResultatGuide[] = [];

export const reglagesGuideServeur: ReglagesGuideServeur = {
  estAdmin: async () => process.env.GUIDE_TEST_ADMIN !== "0",
  apresConsigne: async (r) => {
    appelsApresConsigne.push(r);
  },
};
