/* tests/guide/fixtures/guide-reglages.ts — réglages CLIENT témoins, pour les tests.
 *
 * `guide-reglages.ts` (le vrai, propre à CHAQUE SITE qui embarque le moteur) n'existe PAS
 * dans ce dépôt — même principe que `scenarios.ts` (voir fixtures/scenarios.ts) : jamais
 * dans le moteur, jamais écrasé par la synchro. `tests/guide/support/resolve-ts.mjs`
 * redirige UNIQUEMENT ce specifier, UNIQUEMENT à l'exécution des tests, vers ce fichier.
 *
 * `ancetresReplies` porte une valeur témoin (le motif ProLearn d'origine,
 * `.tn-childwrap.collapsed`) pour que les tests de `guide-geometry.ts`/`guide-geste.ts`
 * puissent vérifier qu'un réglage de site est bien PRIS EN COMPTE, pas seulement accepté.
 */
import type { ReglagesGuideClient } from "../../../.claude/hooks/plantrack_guide/moteur/types";

export const reglagesGuide: ReglagesGuideClient = {
  ancetresReplies: [".tn-childwrap.collapsed"],
};
