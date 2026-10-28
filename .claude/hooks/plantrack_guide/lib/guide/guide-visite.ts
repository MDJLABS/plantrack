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

/* ------------------------------------------------------------------------------------------
 * Envoi du résultat (lot « curseur animé ») — `retour` (jeton), `poste` (base URL de la
 * session qui a ouvert le guide) et `projet` arrivent en paramètres d'URL EN MÊME TEMPS que
 * `?guide=`, et doivent survivre au même changement de page que la visite elle-même : d'où
 * leur persistance ICI, avec la MÊME logique (une clé `sessionStorage` à part, écrite
 * seulement sur une ouverture explicite et valide, relue sinon). Étendre ce fichier plutôt
 * qu'en ouvrir un second qui dupliquerait `accederSessionStorage()`/le motif try-catch.
 *
 * Ce module ne SAIT PAS envoyer quoi que ce soit (aucun `fetch` ici) : ça reste à
 * `guide-envoi.ts`, pur lui aussi côté construction du corps, impur seulement pour l'appel
 * réseau — ce fichier-ci ne fait que PORTER les trois informations d'une page à l'autre.
 * ------------------------------------------------------------------------------------------ */

const CLE_SESSION_ENVOI = "mdj_guide_session_envoi";

/** Les trois informations nécessaires pour envoyer un résultat (cf. `guide-envoi.ts`). */
export type InfosEnvoi = { jeton: string; poste: string; projet: string };

/** Jeton : longueur bornée et alphabet restreint — c'est une valeur qui transite par
 *  l'URL ET revient dans le corps d'une requête POST (`guide-envoi.ts`) ; lui interdire
 *  tout caractère hors `[A-Za-z0-9_-]` retire d'emblée toute tentative d'y faire passer
 *  autre chose qu'un jeton (espaces, guillemets, séquences d'échappement…). 1 à 200 : un
 *  jeton réel tient largement dedans, 200 écarte un collage accidentel d'un bloc entier. */
const JETON_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** Hôtes locaux tolérés en clair (`http:`) — développement uniquement. `[::1]` : forme
 *  EXACTE que `new URL(...).hostname` rend pour le loopback IPv6 (crochets inclus). */
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Liste blanche FACULTATIVE d'origines (`NEXT_PUBLIC_GUIDE_POSTES`, séparées par des
 * virgules) — quand elle est définie, `validerPoste` n'accepte plus QUE les origines
 * qu'elle contient (quel que soit leur protocole), à la place de la règle habituelle
 * (https / hôte local) ; non définie ou vide, elle ne change rien. Comparaison sur
 * l'ORIGINE normalisée (`new URL(x).origin`), jamais sur la chaîne brute de la variable —
 * une entrée mal formée de la liste est ignorée plutôt que de faire planter la validation.
 */
function listeBlanchePostes(): Set<string> | null {
  const brut = process.env.NEXT_PUBLIC_GUIDE_POSTES;
  if (!brut) return null;
  const origines = new Set<string>();
  for (const morceau of brut.split(",")) {
    const texte = morceau.trim();
    if (!texte) continue;
    try {
      origines.add(new URL(texte).origin);
    } catch {
      // entrée mal formée de la liste blanche : ignorée, jamais fatale
    }
  }
  return origines.size > 0 ? origines : null;
}

/**
 * Valide `poste` (l'URL de base de la session qui a ouvert le guide) et rend son
 * **origine normalisée** (`https://exemple.com`, jamais de chemin/query/hash — même si
 * `poste` en portait) ; `null` si `poste` n'est pas une destination sûre.
 *
 * Refuse, dans l'ordre :
 * - une chaîne qui n'est pas une URL ABSOLUE valide (`new URL` lève) — élimine d'office
 *   tout schéma dangereux qui n'a pas d'autorité (`javascript:alert(1)` n'a pas d'origine
 *   analysable de la même façon, et échoue ici) ;
 * - un userinfo non vide (`https://user:pass@hote/`) — un `poste` qui embarque des
 *   identifiants dans l'URL n'est pas une forme qu'on accepte de relayer tel quel ;
 * - si `NEXT_PUBLIC_GUIDE_POSTES` est définie (cf. `listeBlanchePostes` ci-dessus),
 *   l'origine doit y figurer — SEUL critère dans ce cas, la règle protocole/hôte local
 *   suivante ne s'applique plus ;
 * - sinon, tout hôte qui n'est pas LOCAL (b26) : sans liste blanche, seul le poste de la
 *   machine (`localhost`, `127.0.0.1`, `[::1]`, en `http:` ou `https:`) est accepté. Un
 *   poste distant (`https://bcc.exemple.com`) DOIT être déclaré dans
 *   `NEXT_PUBLIC_GUIDE_POSTES` — sinon un lien piégé (`?poste=https://ailleurs`) enverrait
 *   les verdicts et notes du testeur à un tiers. `javascript:`, `data:`, `file:` restent
 *   refusés.
 *
 * Partagée par `resoudreEnvoi`/`parserInfosEnvoi` ICI et par `envoyerResultat`
 * (`guide-envoi.ts`, défense en profondeur — ne jamais supposer qu'une valeur déjà
 * « validée » plus haut dans l'appel reste fiable une fois passée en paramètre).
 */
export function validerPoste(poste: string): string | null {
  let url: URL;
  try {
    url = new URL(poste);
  } catch {
    return null;
  }
  if (url.username || url.password) return null; // userinfo refusé, cf. ci-dessus

  const listeBlanche = listeBlanchePostes();
  if (listeBlanche) return listeBlanche.has(url.origin) ? url.origin : null;

  if (!HOTES_LOCAUX.has(url.hostname)) return null; // b26 : distant = liste blanche obligatoire
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin; // origine SEULE : jamais le chemin/query/hash d'entrée
}

/** Jeton valide — exportée pour que `GuideDeTestLazy.tsx` puisse recalculer EXACTEMENT la
 *  même garde que `resoudreEnvoi` (ci-dessous) sans dupliquer `JETON_RE` : c'est elle qui
 *  décide si CETTE ouverture doit (ré)écrire la session d'envoi, cf. son usage là-bas. */
export function validerJeton(jeton: string): boolean {
  return JETON_RE.test(jeton);
}

/**
 * Décide les infos d'envoi actives.
 *
 * ⚠️ Gardée par la VISITE elle-même : `decisionVisite` (le résultat de `resoudreVisite`
 * sur CETTE page) doit être non nul — sans guide activement monté (ni explicite ni
 * repris), aucune info d'envoi n'est jamais rendue, quoi que l'URL ou la session
 * prétendent par ailleurs. Et l'ÉCRITURE de la session d'envoi n'a lieu que si CE rendu
 * est l'ouverture EXPLICITE et valide du guide (`decisionVisite.ecrireSession`) — jamais
 * sur une simple reprise : lire `retour`/`poste`/`projet` sur une page quelconque qui ne
 * porte même pas de `?guide=` valide ne doit rien pouvoir déclencher.
 *
 * Même priorité que `resoudreVisite` sinon : les trois paramètres d'URL s'ils sont TOUS
 * présents ET valides individuellement (jeton, poste) ; sinon le contenu de session déjà
 * lu, s'il est valide ; sinon rien. Un paramètre présent mais invalide retombe sur la
 * session plutôt que de faire échouer toute la résolution (même politique que
 * `resoudreVisite` pour un `?guide=` fautif).
 */
export function resoudreEnvoi(
  decisionVisite: DecisionMontage,
  paramRetour: string | null | undefined,
  paramPoste: string | null | undefined,
  paramProjet: string | null | undefined,
  contenuSessionEnvoi: string | null | undefined,
): InfosEnvoi | null {
  if (!decisionVisite) return null; // aucun guide actif : rien, jamais

  if (decisionVisite.ecrireSession && paramRetour && paramPoste && paramProjet) {
    const poste = validerPoste(paramPoste);
    if (poste && validerJeton(paramRetour)) {
      return { jeton: paramRetour, poste, projet: paramProjet };
    }
  }
  return parserInfosEnvoi(contenuSessionEnvoi);
}

/** Relecture tolérante — un contenu absent, illisible, aux champs incomplets, ou dont le
 *  `poste`/`jeton` ne passe plus `validerPoste`/`JETON_RE` rend `null` plutôt qu'une
 *  donnée d'envoi à moitié vraie. Revalider ICI (et pas seulement à l'écriture) couvre une
 *  clé `sessionStorage` FORGÉE à la main — même esprit que `getScenario` pour la visite :
 *  une entrée de stockage ne doit jamais valoir mieux qu'un paramètre d'URL direct. */
function parserInfosEnvoi(contenu: string | null | undefined): InfosEnvoi | null {
  if (!contenu) return null;
  let o: unknown;
  try {
    o = JSON.parse(contenu);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const { jeton, poste, projet } = o as Partial<InfosEnvoi>;
  if (typeof jeton !== "string" || typeof poste !== "string" || typeof projet !== "string" || !projet) return null;
  const posteValide = validerPoste(poste);
  if (!posteValide || !validerJeton(jeton)) return null;
  return { jeton, poste: posteValide, projet };
}

/** Lit la clé de session d'envoi — même repli que `lireVisiteSession` (jamais fatal). */
export function lireInfosEnvoiSession(storage: StorageVisite | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(CLE_SESSION_ENVOI);
  } catch {
    return null;
  }
}

/** Écrit la clé de session d'envoi — appelée UNIQUEMENT quand `resoudreEnvoi` a reçu les
 *  trois paramètres d'URL explicites (même garde que `ecrireVisiteSession`). */
export function ecrireInfosEnvoiSession(storage: StorageVisite | null, infos: InfosEnvoi): void {
  if (!storage) return;
  try {
    storage.setItem(CLE_SESSION_ENVOI, JSON.stringify(infos));
  } catch {
    // Stockage indisponible : l'envoi automatique ne survivra pas au changement de page,
    // le bouton Copier reste le filet de sécurité — jamais faire tomber la page pour ça.
  }
}

/** Efface la clé de session d'envoi — à la fermeture DÉFINITIVE du guide (même geste que
 *  `effacerVisiteSession`), pour qu'une visite rouverte plus tard ne retente pas un envoi
 *  avec un jeton périmé. */
export function effacerInfosEnvoiSession(storage: StorageVisite | null): void {
  if (!storage) return;
  try {
    storage.removeItem(CLE_SESSION_ENVOI);
  } catch {
    // idem — tant pis pour la reprise, jamais pour la page.
  }
}
