/* ==============================================================================
 * Guide de test intégré — JOUER un geste automatiquement (curseur animé).
 *
 * Jusqu'ici, chaque étape décrivait un geste que MARIELLA devait faire elle-même
 * (« clique sur… », « saisis… »). Ce module le joue à sa place — elle n'a plus qu'à juger
 * le résultat — via `GuideCurseur.tsx`, qui anime le déplacement puis appelle `jouerGeste`.
 *
 * Trois types (cf. `types.ts`, `GuideGeste`) :
 * - "clic"   → `el.click()`.
 * - "saisie" → pose `valeur` via le SETTER NATIF de `HTMLInputElement`/`HTMLTextAreaElement`
 *   (`Object.getOwnPropertyDescriptor(…, 'value').set`), puis déclenche `input` et `change`
 *   en bulles. Nécessaire pour React : poser `el.value = …` directement laisse son état
 *   interne en désaccord avec le DOM (React intercepte le SETTER de l'instance, pas
 *   l'assignation — c'est le même contournement que la plupart des bibliothèques de test
 *   d'UI utilisent pour simuler une saisie « comme un humain »).
 * - "aller"  → `location.assign(url)`. ⚠️ La navigation DÉCHARGE la page avant que React
 *   ait pu persister quoi que ce soit : **l'appelant doit marquer l'étape jouée
 *   (`marquerJoue` + `sauverProgression`) AVANT d'appeler `jouerGeste`**, jamais après.
 *   La reprise de la VISITE elle-même (quel scénario remonter) est assurée par
 *   `sessionStorage` (`guide-visite.ts`) — ce module n'y touche pas.
 *
 * `jouerGeste` ne lève JAMAIS — un geste qui échoue (cible absente, API indisponible)
 * rend `{ ok: false, raison }` ; `GuideDeTest.tsx` affiche la raison et laisse Mariella
 * juger (invariant 2 du guide : ne jamais faire comme si la cible avait été atteinte).
 *
 * Fonctions séparées et EXPORTÉES pour rester testables sans navigateur réel : un objet
 * minimal (`{ click, value, dispatchEvent }`) suffit à exercer `appliquerClic`/
 * `appliquerSaisie` — pas besoin de jsdom (cf. tests/guide/guide-geste.test.ts).
 * ============================================================================== */

import { resolveTarget } from "./guide-geometry";
import type { GuideGeste } from "./types";

export type ResultatGeste = { ok: boolean; raison?: string };

/**
 * Sélecteurs à essayer, du plus précis au plus général : celui du geste d'abord (il
 * désigne précisément l'élément à actionner), puis les `cibles` de l'étape en repli —
 * c'est la même zone que celle surlignée, un repli raisonnable si le geste n'a pas son
 * propre sélecteur ou qu'il ne résout rien.
 */
export function selecteursGeste(geste: GuideGeste, ciblesRepli: readonly string[] = []): string[] {
  return geste.cible ? [geste.cible, ...ciblesRepli] : [...ciblesRepli];
}

/**
 * Clic — accepte un vrai `Element` ou un double minimal exposant `click()` (tests). Un
 * élément qui n'expose ni l'un ni l'autre est un échec déclaré, jamais une exception qui
 * remonte jusqu'à React.
 */
export function appliquerClic(el: unknown): ResultatGeste {
  if (!el || typeof (el as { click?: unknown }).click !== "function") {
    return { ok: false, raison: "élément non cliquable" };
  }
  try {
    (el as { click: () => void }).click();
    return { ok: true };
  } catch {
    return { ok: false, raison: "le clic a échoué" };
  }
}

/** L'élément minimal qu'`appliquerSaisie` sait actionner — un vrai `HTMLInputElement`/
 *  `HTMLTextAreaElement`, ou un double de test exposant juste ça. */
type ElementSaisissable = {
  value?: string;
  dispatchEvent?: (e: Event) => unknown;
};

/**
 * Saisie — setter natif si l'élément est un VRAI champ du DOM (pour que React le
 * remarque), repli sur une simple affectation sinon (double de test, ou élément qui n'est
 * ni l'un ni l'autre mais porte quand même `value`). `typeof HTMLInputElement !==
 * "undefined"` est nécessaire : ce module tourne aussi en test Node nu, où ces globales
 * n'existent pas du tout — s'y référer sans ce garde lèverait un `ReferenceError`, pas le
 * « jamais lever » promis par `jouerGeste`.
 */
export function appliquerSaisie(el: unknown, valeur: string): ResultatGeste {
  if (!el || typeof el !== "object") return { ok: false, raison: "élément de saisie absent" };
  const cible = el as ElementSaisissable;
  try {
    const proto =
      (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement && HTMLInputElement.prototype) ||
      (typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement && HTMLTextAreaElement.prototype) ||
      null;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(cible, valeur);
    else cible.value = valeur;

    // `bubbles: true` : React écoute au niveau du document (délégation), pas sur le champ
    // lui-même — un événement qui ne remonte pas n'est tout simplement jamais vu.
    if (typeof cible.dispatchEvent === "function") {
      cible.dispatchEvent(new Event("input", { bubbles: true }));
      cible.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true };
  } catch {
    return { ok: false, raison: "la saisie a échoué" };
  }
}

/**
 * Joue un geste. Ne lève JAMAIS — toute anomalie (cible introuvable, API indisponible,
 * sélecteur invalide) rend `{ ok: false, raison }` plutôt qu'une exception qui
 * traverserait React jusqu'à la page d'erreur.
 *
 * `doc` et `resolve` sont injectables (mêmes idiomes que `resolveTarget` et le reste du
 * module `guide-geometry.ts`) pour rester testables sans navigateur réel ; en production,
 * l'appelant passe toujours `document`.
 */
export function jouerGeste(
  geste: GuideGeste,
  doc: Document,
  ciblesRepli: readonly string[] = [],
  resolve: typeof resolveTarget = resolveTarget,
): ResultatGeste {
  try {
    if (geste.type === "aller") {
      if (!geste.url) return { ok: false, raison: 'geste "aller" sans url' };
      // Cf. bandeau de tête : marquer l'étape jouée est la responsabilité de L'APPELANT,
      // AVANT cet appel — la navigation décharge la page tout de suite après.
      if (typeof location === "undefined" || typeof location.assign !== "function") {
        return { ok: false, raison: "navigation indisponible" };
      }
      location.assign(geste.url);
      return { ok: true };
    }

    const selecteurs = selecteursGeste(geste, ciblesRepli);
    const el = resolve(selecteurs, doc);
    if (!el) return { ok: false, raison: "cible introuvable" };

    if (geste.type === "clic") return appliquerClic(el);
    if (geste.type === "saisie") return appliquerSaisie(el, geste.valeur ?? "");

    // Exhaustivité : `GuideGeste["type"]` n'a que ces trois valeurs ; un futur ajout de
    // type qui oublierait de l'implémenter ici échoue PROPREMENT plutôt que silencieux.
    return { ok: false, raison: `type de geste inconnu : ${(geste as GuideGeste).type}` };
  } catch {
    return { ok: false, raison: "le geste a échoué" };
  }
}
