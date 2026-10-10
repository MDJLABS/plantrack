/* ==============================================================================
 * Guide de test intégré — DÉCISION DE MONTAGE, pure (aucun DOM, aucun React).
 * Lot 2.3, tâche 11 (« la visite guidée survit au changement de page »).
 *
 * Avant cette tâche, `GuideDeTestLazy` ne savait lire qu'une seule source : `?guide=<id>`
 * dans l'URL courante. Dès qu'elle disparaissait (changement de page), plus rien ne
 * désignait de scénario, et la visite se démontait — voir le brief, cause racine mesurée.
 *
 * Ce fichier ajoute une SECONDE source, `sessionStorage` (portée : durée de l'onglet,
 * DÉCISION DE MARIELLA — jamais `localStorage`, où vit déjà la PROGRESSION dans les
 * étapes : ce sont deux choses distinctes, et ce mélange est délibéré. Fermer l'onglet
 * remet tout à zéro ; la progression, elle, doit survivre plus longtemps).
 *
 * Invariant 5, REFORMULÉ (jamais supprimé) : rien ne se monte tant qu'un `?guide=<id>`
 * explicite et VALIDE n'a pas été vu au moins une fois dans cet onglet, sur cette
 * origine. `resoudreVisite` est la SEULE porte qui décide « quel scénario monter, ou
 * rien » — elle réutilise `getScenario` (garde de classe `hasOwnProperty.call` +
 * ceinture sur `etapes`), donc une clé de session FORGÉE à la main (`"constructor"`,
 * `"__proto__"`, `"toString"`, ou un identifiant inconnu) ne fait pas mieux qu'un
 * `?guide=constructor` dans l'URL : elle échoue exactement de la même façon.
 *
 * La clé de session ne s'écrit QUE lors d'une ouverture par paramètre explicite et
 * valide (`ecrireSession: true`) — aucune autre voie ne l'écrit. C'est ce qui rend la
 * question du convive vérifiable : sans être jamais passé par un `?guide=` valide, la
 * clé n'existe pas, et une clé qu'il fabriquerait à la main ne résout jamais via
 * `getScenario`.
 * ============================================================================== */

import { getScenario } from "./scenarios.ts";
import type { GuideScenario } from "./types.ts";

/** Interface minimale d'un stockage — injectable pour les tests (même idiome que
 *  `Storage` dans `guide-progress.ts`), avec `removeItem` en plus (fermeture explicite). */
export type StorageVisite = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

/** Clé `sessionStorage` — un seul scénario actif à la fois (le cockpit et la vitrine
 *  vivent de toute façon sur deux ORIGINES distinctes, donc deux `sessionStorage`
 *  différents ; pas besoin d'une clé par scénario ici). */
const CLE_SESSION = "mdj_guide_session_actif";

export type DecisionMontage = {
  scenario: GuideScenario;
  /** `true` seulement quand la source est le paramètre d'URL explicite : c'est le SEUL
   *  moment où la clé de session doit être (ré)écrite. */
  ecrireSession: boolean;
} | null;

/**
 * Décide quel scénario monter, à partir du paramètre d'URL courant et du CONTENU déjà lu
 * du stockage de session (une chaîne, ou `null` — jamais l'objet `Storage` lui-même :
 * aucun DOM ni accès navigateur ici, uniquement des chaînes).
 *
 * Priorité :
 * 1. `?guide=<id>` explicite et valide → il l'emporte TOUJOURS, même sur une visite déjà
 *    persistée (c'est ainsi qu'on passe du scénario cockpit au scénario vitrine sans
 *    rester prisonnier du premier) — et c'est le seul cas qui écrit la session.
 * 2. sinon, le contenu de session, s'il désigne un scénario qui résout encore (le
 *    catalogue a pu changer entre deux ouvertures) → reprise sans paramètre.
 * 3. sinon, rien — le cas du convive qui n'a jamais tapé `?guide=`, le plus important.
 *
 * Un paramètre présent mais INVALIDE (faute de frappe, `?guide=constructor`…) n'est pas
 * une commande explicite valable : on retombe sur la session plutôt que de couper une
 * visite en cours pour une faute de frappe dans l'URL.
 */
export function resoudreVisite(
  paramGuide: string | null | undefined,
  contenuSession: string | null | undefined,
): DecisionMontage {
  const parParam = getScenario(paramGuide);
  if (paramGuide && parParam) return { scenario: parParam, ecrireSession: true };

  const parSession = getScenario(contenuSession);
  if (parSession) return { scenario: parSession, ecrireSession: false };

  return null;
}

/**
 * Accède à `window.sessionStorage` sans jamais lever — round de correction 1, défaut
 * critique n°1.
 *
 * ⚠️ Ce que le premier jet ratait : le GETTER `window.sessionStorage` lui-même peut lever
 * un `SecurityError` — origine opaque (iframe `sandbox` sans `allow-same-origin`),
 * « bloquer toutes les données de site » (Chrome) ou équivalent Firefox — AVANT même
 * d'entrer dans une fonction qui reçoit le stockage en PARAMÈTRE. Un `try/catch` posé à
 * l'INTÉRIEUR de `lireVisiteSession`/`ecrireVisiteSession`/`effacerVisiteSession` protège
 * l'USAGE (`storage.getItem(...)`) mais pas l'ACCÈS : `window.sessionStorage` était évalué
 * en amont, dans l'expression d'appel, hors de portée de ces `try`. Sur `/menu` (aucun
 * `error.tsx`/`global-error.tsx` dans `src/app`), l'exception remontait jusqu'à React et un
 * convive dans ces conditions obtenait la page d'erreur de Next au lieu de la carte du
 * restaurant — une exposition NOUVELLE, absente avant cette tâche.
 *
 * Cette fonction est le SEUL point du dépôt qui touche `window.sessionStorage` directement ;
 * tout le reste (lecture, écriture, effacement) passe un `StorageVisite | null` déjà résolu.
 * Retourne `null` si l'accès lève — au même titre qu'un stockage vide, jamais un cas à part.
 */
export function accederSessionStorage(): StorageVisite | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Lit la clé de session — jamais fatal (navigation privée, quota, `storage` déjà `null`
 *  parce que son ACCÈS a levé, cf. `accederSessionStorage`) : une lecture indisponible
 *  revient au même que « rien de persisté ». */
export function lireVisiteSession(storage: StorageVisite | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(CLE_SESSION);
  } catch {
    return null;
  }
}

/** Écrit la clé de session — appelée UNIQUEMENT quand `resoudreVisite` a répondu
 *  `ecrireSession: true` (paramètre d'URL explicite et valide). */
export function ecrireVisiteSession(storage: StorageVisite | null, scenarioId: string): void {
  if (!storage) return;
  try {
    storage.setItem(CLE_SESSION, scenarioId);
  } catch {
    // Stockage indisponible : la visite reste utilisable pour cette page, seule la
    // reprise inter-pages est perdue — jamais faire tomber la page pour ça.
  }
}

/** Efface la clé de session — c'est CE QUI DISTINGUE « replier » de « fermer » (cf.
 *  GuideDeTest.tsx) : replier laisse la clé intacte, fermer l'efface. Sans cette
 *  effacement, la visite ressusciterait à la prochaine navigation, et deviendrait
 *  impossible à quitter. */
export function effacerVisiteSession(storage: StorageVisite | null): void {
  if (!storage) return;
  try {
    storage.removeItem(CLE_SESSION);
  } catch {
    // idem — tant pis pour la reprise, jamais pour la page.
  }
}
