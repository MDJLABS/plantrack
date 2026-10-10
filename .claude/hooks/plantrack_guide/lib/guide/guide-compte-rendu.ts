/* ==============================================================================
 * Guide de test — COMPTE-RENDU BRUT (texte copié dans le presse-papier).
 *
 * Décision Mariella (round de correction 1, lot 2.3, 2026-07-25) : pas de stockage
 * serveur pour l'instant (cf. `.claude/rules/guide-de-test.md` § « Ce qui n'est pas
 * encore porté »). À la place, l'écran de bilan de `GuideDeTest.tsx` porte un bouton qui
 * copie ce texte ; Mariella le colle une fois dans le chat.
 *
 * Distinct de `guide-verdict.ts` À DESSEIN : ce fichier ne produit JAMAIS de conclusion
 * (aucun statut global, aucun « ✅ VALIDÉ ») — seulement les réponses BRUTES, point par
 * point, dans l'ordre du scénario. Le verdict se recalcule EN DEHORS, à partir de ces
 * réponses brutes — du navigateur on ne prend jamais la conclusion, seulement les
 * réponses. Un point sans réponse apparaît EXPLICITEMENT comme tel : le taire ferait
 * passer une visite abandonnée à mi-chemin pour un succès, la même famille d'erreur
 * qu'une garde qui sous-rapporte sans faire de bruit (cf. CLAUDE.md § secrets).
 * ============================================================================== */

import type { StepVerdict } from "./types";

/** Repère minimal d'une étape, pour nommer les points concernés. */
type Etape = { id: string; titre: string };

const LIBELLE: Record<StepVerdict | "manquant", string> = {
  ok: "conforme",
  ko: "écart",
  manquant: "sans réponse",
};

/**
 * Compte-rendu texte (Markdown léger, lisible tel quel) des réponses d'un scénario —
 * un point par ligne, dans l'ordre du scénario, AUCUNE conclusion.
 */
export function construireCompteRendu(
  scenarioId: string, etapes: Etape[], verdicts: Record<string, StepVerdict | undefined>,
): string {
  const lignes = etapes.map((e) => {
    const v = verdicts[e.id];
    return `- ${e.titre} : ${v ? LIBELLE[v] : LIBELLE.manquant}`;
  });
  return [`Guide de test — ${scenarioId}`, "", ...lignes].join("\n");
}
