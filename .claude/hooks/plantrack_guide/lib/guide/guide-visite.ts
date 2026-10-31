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

export { getScenario } from "./scenarios.ts";
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
