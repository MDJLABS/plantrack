/* tests/guide/fixtures/scenarios.ts — registre de SCÉNARIOS TÉMOINS, pour les tests.
 *
 * `scenarios.ts` (le registre réel, `getScenario`/`SCENARIOS`) n'existe PAS dans ce dépôt :
 * c'est le contenu propre à CHAQUE SITE qui en porte un (cf. d34/d35 — le moteur vendu ici
 * n'embarque que le dispositif générique, `.claude/hooks/plantrack_guide/lib/guide/`).
 * `guide-visite.ts` importe pourtant `./scenarios` en dur (même convention Next que le reste
 * du moteur, résolue par le bundler de chaque site) — pour l'exécuter en test depuis PlanTrack
 * lui-même, il faut donc un registre à sa place. `tests/guide/support/resolve-ts.mjs` redirige
 * UNIQUEMENT ce specifier, UNIQUEMENT à l'exécution des tests, vers ce fichier — jamais touché
 * dans le moteur source, jamais livré à un site.
 *
 * Forme identique à `src/lib/guide/scenarios.ts` de miamboost (référence) : `SCENARIOS`,
 * `getScenario` (garde `hasOwnProperty.call` — un id forgé sur la chaîne de prototypes
 * n'y résout jamais), `indexDePoint`.
 */
import type { GuideScenario } from "../../../.claude/hooks/plantrack_guide/lib/guide/types";

export const SCENARIOS: Record<string, GuideScenario> = {
  "temoin-principal": {
    id: "temoin-principal",
    titre: "Témoin de test (6 points)",
    date: "2026-10-28",
    page: "aucune — ce scénario n'est jamais livré",
    etapes: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({
      id,
      titre: `Point ${id}`,
      cibles: ["#zone-temoin"],
      action: "—",
      attendu: "—",
    })),
  },
  "temoin-second": {
    id: "temoin-second",
    titre: "Second témoin (celui que le paramètre d'URL doit imposer)",
    date: "2026-10-28",
    page: "aucune — ce scénario n'est jamais livré",
    etapes: [{ id: "q1", titre: "Point q1", cibles: ["#zone-temoin"], action: "—", attendu: "—" }],
  },
  "temoin-geste": {
    id: "temoin-geste",
    titre: "Témoin avec des gestes et des points PlanTrack",
    date: "2026-10-28",
    page: "aucune — ce scénario n'est jamais livré",
    etapes: [
      {
        id: "r1",
        titre: "Point r1 (clic)",
        cibles: ["#zone-temoin"],
        action: "—",
        attendu: "—",
        pt: "pt-r1",
        geste: { type: "clic", cible: "#bouton-temoin" },
      },
      {
        id: "r2",
        titre: "Point r2 (sans pt)",
        cibles: ["#zone-temoin"],
        action: "—",
        attendu: "—",
      },
    ],
  },
};

export function getScenario(id: string | null | undefined): GuideScenario | null {
  if (!id || !Object.prototype.hasOwnProperty.call(SCENARIOS, id)) return null;
  const s = SCENARIOS[id];
  return Array.isArray(s?.etapes) && s.etapes.length > 0 ? s : null;
}

export function indexDePoint(etapes: { id: string }[], stepId: string | null | undefined): number | null {
  if (!stepId) return null;
  const i = etapes.findIndex((e) => e.id === stepId);
  return i >= 0 ? i : null;
}
