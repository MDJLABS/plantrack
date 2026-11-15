/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */
/* ==============================================================================
 * Guide de test intégré — utilitaires de VISITE, purs (aucun DOM, aucun React).
 *
 * Invariant 5, REFORMULÉ (d138, 31/10 — « ça ne fonctionne pas par lien, ça fonctionne par
 * session ») : rien ne se monte sans une session ADMIN du site, vérifiée CÔTÉ SERVEUR
 * (`estAdmin()`, réglages serveur du site, lu par `guide-actions.ts`). Il n'existe plus de
 * paramètre d'URL (`?guide=`, `?retour=`, `?poste=`, `?projet=`) ni d'envoi réseau : le
 * lanceur bas-droite (`GuideDeTestLazy.tsx`) propose la liste des guides encore à traiter
 * (`etatGuides()`), et le scénario choisi devient le « guide actif » — une clé
 * `sessionStorage` posée par `GuideDeTest.tsx`/`GuideDeTestLazy.tsx` via
 * `lireGuideActif`/`ecrireGuideActif` (`guide-progress.ts`), qui réutilise `getScenario`
 * (ci-dessous) comme garde de clé forgée : un id de session fabriqué à la main
 * (`"constructor"`, `"__proto__"`, ou un identifiant inconnu) ne résout jamais.
 *
 * Ce fichier ne porte donc plus de DÉCISION DE MONTAGE ni de persistance de session liée à
 * l'URL (tout ça a disparu avec `?guide=`) — il ne garde que ce qui reste utile une fois le
 * scénario actif choisi : l'accès sûr à `sessionStorage`, et « sur quelle page suis-je ? »
 * (`surLaPage`, pour « M'emmener au bon endroit »).
 * ============================================================================== */

export { getScenario } from "./guides-json.ts";
export type { GuideScenario } from "./types.ts";

/** Interface minimale d'un stockage — injectable pour les tests (même idiome que
 *  `Storage` dans `guide-progress.ts`), avec `removeItem` en plus. */
export type StorageVisite = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

/**
 * Accède à `window.sessionStorage` sans jamais lever.
 *
 * Le GETTER `window.sessionStorage` lui-même peut lever un `SecurityError` — origine opaque
 * (iframe `sandbox` sans `allow-same-origin`), « bloquer toutes les données de site »
 * (Chrome) ou équivalent Firefox — AVANT même d'entrer dans une fonction qui reçoit le
 * stockage en PARAMÈTRE. Cette fonction est le SEUL point de ce module qui touche
 * `window.sessionStorage` directement ; tout le reste passe un `StorageVisite | null` déjà
 * résolu. Retourne `null` si l'accès lève — au même titre qu'un stockage vide, jamais un cas
 * à part.
 */
export function accederSessionStorage(): StorageVisite | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------
 * « M'emmener au bon endroit » (porté de Prolearn, commit 958ecde2, demande Mariella 31/10) —
 * un point peut porter sa propre `url` (ou retomber sur celle du scénario, `GuideStep.url`/
 * `GuideScenario.url`, cf. types.ts) : si la page courante n'est pas la bonne, la carte
 * propose d'y aller plutôt que de chercher une zone qui ne peut pas y être.
 *
 * L'ancien `resoudreUrl` GÉNÉRIQUE du moteur (renvoie l'url telle quelle) est remplacé par
 * `ReglagesGuideClient.resoudreUrl` (réglages PROPRES à chaque site, `guide-reglages.ts`) —
 * un site qui a besoin de transformer l'URL (ex. ProLearn/[formation]) le fait dans sa
 * propre copie, sans que cela change le comportement d'un site qui n'en a pas besoin.
 * `GuideDeTest.tsx` applique `reglages.resoudreUrl ?? ((url) => url)`.
 * ------------------------------------------------------------------------------------------ */

/** Chemin seul (sans `?…` ni `#…`) d'une URL relative ou absolue. */
function cheminDe(url: string): string {
  try {
    return new URL(url, "http://x").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

/** Vrai si `pathname` est la page désignée par `url` (paramètres ignorés). */
export function surLaPage(pathname: string, url: string): boolean {
  return cheminDe(pathname) === cheminDe(url);
}

/* ------------------------------------------------------------------------------------------
 * Adresse réelle où la zone d'un point a été vue (15/11, demande s69). Les pages à jeton
 * (/paiement?…, /confirmation/<id>, /carte-cadeau/<code>) n'ont pas d'url propre dans le
 * scénario : sans mémoire, « M'emmener au bon endroit » retombait sur l'url du scénario et
 * faisait recommencer tout le parcours. On retient, le temps de l'onglet, le chemin ET les
 * paramètres de la page où la zone est apparue, pour y ramener.
 * ------------------------------------------------------------------------------------------ */

const PREFIXE_VUE = "guide-vue:";

/** Retient l'adresse (chemin + paramètres) où la zone du point a été vue. Jamais ne lève. */
export function retenirAdresseVue(storage: StorageVisite | null, scenarioId: string, stepId: string, adresse: string): void {
  if (!storage) return;
  try {
    storage.setItem(`${PREFIXE_VUE}${scenarioId}:${stepId}`, adresse);
  } catch {
    /* stockage plein ou refusé : le bouton retombe sur l'url du scénario, comme avant */
  }
}

/** Dernière adresse où la zone du point a été vue, ou `null`. Jamais ne lève. */
export function adresseVue(storage: StorageVisite | null, scenarioId: string, stepId: string): string | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(`${PREFIXE_VUE}${scenarioId}:${stepId}`);
    return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
  } catch {
    return null;
  }
}
