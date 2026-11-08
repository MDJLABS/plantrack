/* ==============================================================================
 * Guide de test intégré — statut d'UN scénario, à partir de l'état enregistré côté
 * SERVEUR (`.planning/guides-etat.json`, écrit par `guide-actions.ts`).
 *
 * Module PURE (aucun `node:fs`, aucun DOM) — testable en Node nu, comme le reste du
 * module `guide/` (`guide-verdict.ts`, `guide-geometry.ts`…).
 *
 * Règle de « relivraison » : l'état stocké porte la `date` du scénario AU MOMENT où le
 * premier verdict a été posé. Si la `date` du scénario a changé depuis (l'agent l'a
 * modifiée après correction), l'état stocké ne correspond plus à CETTE livraison : on
 * repart de zéro, comme si rien n'avait jamais été jugé. C'est le SEUL mécanisme qui fait
 * revenir un "ko" dans la liste « encore à traiter » (d138) — rien ne l'y remet tout seul.
 *
 * Statuts : aucun verdict → "a_traiter" ; certains mais pas tous → "en_cours" ; tous jugés
 * mais le scénario n'a pas encore été consigné (`consignerGuide`) → "en_cours" aussi (on
 * n'affiche "ok"/"ko" qu'une fois le compte-rendu réellement écrit) ; consigné → "ok" si
 * tous les verdicts sont "ok", "ko" sinon.
 * ============================================================================== */

import type { GuideScenario, StepVerdict } from "./types";

export type StatutGuide = "a_traiter" | "en_cours" | "ok" | "ko";

/** Un verdict enregistré côté serveur pour UNE étape. */
export type VerdictStocke = { v: StepVerdict; note?: string; a: string };

/** État stocké d'UN scénario — clé = id de scénario dans `EtatStocke`. */
export type EtatScenarioStocke = {
  /** Date du scénario AU MOMENT du premier verdict — sert à détecter une relivraison. */
  date: string;
  /** Verdicts, par id d'étape. On n'y accède JAMAIS par énumération (`Object.keys`/`for..in`)
   *  — toujours par `verdicts[e.id]` pour un `e.id` qui vient du catalogue (`getScenario`) :
   *  une clé forgée (`__proto__`, `constructor`…) qui s'y trouverait (ex. JSON reçu d'ailleurs)
   *  n'est alors JAMAIS lue, jamais comptée, jamais source d'un statut faussé. */
  verdicts: Record<string, VerdictStocke>;
  /** Horodatage de `consignerGuide` — absent ⇒ pas encore consigné, même si tous les points
   *  ont déjà un verdict. */
  fini?: string;
  /** b44 : horodatage du retour de fin PRIS par le poste pour ce `fini`. Posé ⇒ la session a
   *  déjà reçu cette fin : ni une réouverture du guide ni un nouvel appel ne la renvoient. */
  envoye?: string;
};

/** b44 : une visite est « déjà consignée » quand `fini` est posé et qu'aucun verdict n'a été
 *  donné APRÈS (revoir un point puis le changer rouvre une consignation, voulue). */
export function dejaConsigne(scenario: GuideScenario, etat: EtatScenarioStocke | undefined): boolean {
  if (!correspondALaLivraison(scenario, etat) || !etat.fini) return false;
  const fini = etat.fini;
  return scenario.etapes.every((e) => {
    const x = etat.verdicts[e.id];
    return !!x && x.a <= fini;
  });
}

/** Table complète persistée (`.planning/guides-etat.json`) — une entrée par scénario déjà
 *  touché au moins une fois. */
export type EtatStocke = Record<string, EtatScenarioStocke>;

/** `true` si l'état stocké correspond bien à la livraison COURANTE du scénario — sinon il
 *  est obsolète (relivraison) et ne doit compter pour rien. */
function correspondALaLivraison(scenario: GuideScenario, etat: EtatScenarioStocke | undefined): etat is EtatScenarioStocke {
  return !!etat && etat.date === scenario.date;
}

/** Statut d'UN scénario, déduit de son état stocké (voir bandeau de tête pour les règles). */
export function calculerStatut(scenario: GuideScenario, etat: EtatScenarioStocke | undefined): StatutGuide {
  if (!correspondALaLivraison(scenario, etat)) return "a_traiter";
  const total = scenario.etapes.length;
  if (total === 0) return "a_traiter";

  const repondus = scenario.etapes.filter((e) => Object.prototype.hasOwnProperty.call(etat.verdicts, e.id)).length;
  if (repondus === 0) return "a_traiter";
  if (repondus < total || !etat.fini) return "en_cours";

  const tousOk = scenario.etapes.every((e) => etat.verdicts[e.id]?.v === "ok");
  return tousOk ? "ok" : "ko";
}

/** « Encore à traiter » = a_traiter + en_cours — un "ko" en sort SCIEMMENT (invariant d138) :
 *  l'agent corrige puis relivre (change `scenario.date`), ce qui le fait revenir via
 *  `calculerStatut`. Tant que la date n'a pas changé, un "ko" reste "ko" — il ne redevient
 *  pas "encore à traiter" tout seul. */
export function estEncoreATraiter(statut: StatutGuide): boolean {
  return statut === "a_traiter" || statut === "en_cours";
}

/** Nombre de points déjà jugés pour un scénario — compteur « x/y points » du lanceur. Même
 *  garde de relivraison que `calculerStatut` : un état d'une AUTRE livraison ne compte pour
 *  rien, le scénario repart de zéro. */
export function faitsPour(scenario: GuideScenario, etat: EtatScenarioStocke | undefined): number {
  if (!correspondALaLivraison(scenario, etat)) return 0;
  return scenario.etapes.filter((e) => Object.prototype.hasOwnProperty.call(etat.verdicts, e.id)).length;
}
