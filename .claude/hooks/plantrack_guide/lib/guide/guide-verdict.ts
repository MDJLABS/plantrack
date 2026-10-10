/* ==============================================================================
 * Guide de test — VERDICT D'UNE VISITE (calcul CÔTÉ CLIENT).
 * Porté de Prolearn (`app/lib/guide/guide-verdict.ts`).
 *
 * Répondre à tous les points **vaut** validation : Mariella n'a pas à la redonner à la
 * main, et un seul écart doit ressortir sans qu'elle ait à le redire. Calculé ici pour
 * s'afficher tout de suite dans la bulle — voir GuideDeTest.tsx pour ce qui n'est PAS
 * encore automatisé (l'écriture du verdict dans `.planning/retours-tests.md`).
 * ============================================================================== */

import type { StepVerdict } from "./types";

/** Repère minimal d'une étape, pour nommer les points concernés. */
type Etape = { id: string; titre: string };

export type ScenarioVerdict = {
  /**
   * - `valide` : tous les points répondus, tous conformes → **c'est sa validation**.
   * - `a-revoir` : tous les points répondus, au moins un écart.
   * - `en-cours` : il reste des points sans réponse → **aucune conclusion possible**.
   */
  statut: "en-cours" | "valide" | "a-revoir";
  repondus: number;
  total: number;
  /** Points en écart, dans l'ordre du scénario (connus même si la visite est inachevée). */
  ko: Etape[];
  /** Points encore sans réponse. */
  manquants: Etape[];
};

/**
 * Déduit le verdict d'une visite de ses points.
 *
 * ⚠️ Un point **non répondu n'est pas un point conforme**. Sans cette distinction, une
 * visite abandonnée à mi-chemin passerait pour une validation — une garde qui rassure à
 * tort est pire qu'une garde absente. Un scénario **sans étape** n'est jamais « validé » :
 * rien n'y a été vérifié.
 */
export function verdictScenario(
  etapes: Etape[], verdicts: Record<string, StepVerdict | undefined>,
): ScenarioVerdict {
  const ko = etapes.filter((e) => verdicts[e.id] === "ko").map(({ id, titre }) => ({ id, titre }));
  const manquants = etapes.filter((e) => !verdicts[e.id]).map(({ id, titre }) => ({ id, titre }));
  const repondus = etapes.length - manquants.length;

  const statut = manquants.length || !etapes.length
    ? "en-cours"
    : ko.length ? "a-revoir" : "valide";

  return { statut, repondus, total: etapes.length, ko, manquants };
}
