/* ==============================================================================
 * Guide de test intégré — progression PURE + persistance (localStorage).
 * Porté de Prolearn (`app/lib/guide/guide-progress.ts`). Séparé du composant : la reprise
 * « là où elle s'est arrêtée » est la partie où une erreur silencieuse coûte le plus
 * (repartir au milieu d'une autre visite).
 *
 * Adaptation MiamBoost : `lireVerdictConsigne`/`ecrireVerdictConsigne` de Prolearn (qui
 * dédupliquaient les écritures d'un verdict CÔTÉ SERVEUR) n'ont pas d'équivalent ici — voir
 * l'en-tête de `src/components/guide/GuideDeTest.tsx` : le socle de ce lot n'écrit pas
 * automatiquement dans `.planning/retours-tests.md`, donc rien à dédupliquer.
 *
 * ⚠️ Round de correction 2 (tâche 11) — même CLASSE de défaut que `sessionStorage`
 * (`src/lib/guide/guide-visite.ts`, `accederSessionStorage`), découvert en le corrigeant :
 * `window.localStorage` est un GETTER qui peut lui-même lever (origine opaque, blocage des
 * données de site), AVANT même d'entrer dans une fonction qui reçoit le stockage en
 * PARAMÈTRE. `GuideDeTest.tsx` appelait `chargerProgression(scenario.id, window.localStorage,
 * …)` et `sauverProgression(p, window.localStorage)` directement — l'accès n'était protégé
 * par AUCUN `try/catch`, contrairement à l'usage (`storage.getItem(...)`) déjà gardé à
 * l'intérieur de ces deux fonctions. `chargerProgression` et `sauverProgression` acceptent
 * désormais un `Storage | null` et se comportent, sur `null`, exactement comme sur un stockage
 * vide ou indisponible : le guide reste UTILISABLE, seule la reprise entre les pages est perdue.
 *
 * ⚠️ Round de correction 3 — deux affirmations de ce bloc étaient trop larges, et une
 * affirmation trop large est le mode d'échec « rassure à tort » que ce dépôt combat :
 *
 * 1. « le SEUL point du dépôt qui touche `window.localStorage` » était vrai de la FORME
 *    préfixée, faux de l'accès lui-même : `src/app/layout.tsx` (script `antiFlash`) et
 *    `src/components/theme/ThemeToggle.tsx` touchent le global `localStorage`, qui est le
 *    MÊME getter. Le second n'était pas gardé — corrigé au round 3.
 * 2. « MÊME défaut critique » confondait la classe et le rayon d'action. Le défaut du round 1
 *    vivait dans `GuideDeTestLazy`, importé STATIQUEMENT par `(site)/layout.tsx` : il
 *    atteignait tous les convives de `/menu`. Celui du round 2 vit dans `GuideDeTest`, chargé
 *    par `dynamic()` seulement après un `?guide=<id>` valide : il ne pouvait atteindre qu'un
 *    testeur. Même classe, gravité moindre — le correctif reste juste, sa justification était
 *    trop large.
 *
 * La classe, elle, est désormais fermée par une vérification et non par une promesse :
 * `npm run test:acces-stockage` (`tests/guide/acces-stockage.test.ts`) parcourt l'AST de tout
 * `src/` et rougit sur tout accès à `localStorage`/`sessionStorage` hors d'un bloc `try`.
 * ============================================================================== */

import type { GuideProgress, StepVerdict } from "./types";

/** Interface minimale d'un stockage — injectable pour les tests. `removeItem` depuis le
 *  05/08 (« un guide validé s'efface », ci-dessous) : sans lui, une progression terminée ne
 *  pouvait que rester, ou être écrasée par une progression vide — ce qui n'est pas la même
 *  chose (un `{}` persisté ressemble à une visite commencée). */
export type Storage = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

/**
 * Accède à `window.localStorage` sans jamais lever — même motif que
 * `accederSessionStorage()` (`guide-visite.ts`) : le GETTER peut lever un `SecurityError`
 * (iframe `sandbox` sans `allow-same-origin`, blocage des données de site) avant même
 * d'atteindre `chargerProgression`/`sauverProgression`. `GuideDeTest.tsx` ne référence plus
 * `localStorage` directement — il passe toujours par cette fonction. C'est la porte du GUIDE ;
 * `ThemeToggle.tsx` et le script `antiFlash` de `layout.tsx` gardent leur propre accès sur
 * place. Motif, corrigé au round 4 pour ne pas surévaluer l'enjeu : pour `antiFlash` c'est
 * imparable (une chaîne injectée avant l'hydratation ne peut importer aucun module) ; pour
 * `ThemeToggle` c'est un choix de sobriété, pas une nécessité — ce module ne pèse que son
 * texte, l'essentiel du poids que la tâche 11 tient hors du bundle des convives étant le chunk
 * de 42 Ko de `GuideDeTest.tsx`.
 *
 * ⚠️ La garde de comportement (`test:guide-visite`, qui exerce un vrai getter qui lève) ne
 * couvre QUE les deux portes du guide. `ThemeToggle.tsx` n'est couvert que par la FORME
 * (`test:acces-stockage` : son accès est dans un `try`). Dette assumée et écrite plutôt que
 * sous-entendue.
 */
export function accederLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const cle = (scenarioId: string) => `mdj_guide_${scenarioId}`;

/** Progression neuve. */
export function vide(scenarioId: string): GuideProgress {
  return { scenarioId, index: 0, verdicts: {} };
}

/** Étape suivante, bornée à la dernière : au-delà, la bulle s'ancrerait sur du vide. */
export function avancer(p: GuideProgress, total: number): GuideProgress {
  return { ...p, index: Math.min(p.index + 1, Math.max(0, total - 1)) };
}

/** Étape précédente, bornée à la première. */
export function reculer(p: GuideProgress): GuideProgress {
  return { ...p, index: Math.max(0, p.index - 1) };
}

/** Verdict de Mariella sur une étape (réversible : elle peut se raviser). */
export function verdict(p: GuideProgress, stepId: string, v: StepVerdict): GuideProgress {
  return { ...p, verdicts: { ...p.verdicts, [stepId]: v } };
}

export function sauverProgression(p: GuideProgress, storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(cle(p.scenarioId), JSON.stringify(p));
  } catch {
    // Stockage indisponible (navigation privée, quota, ou ACCÈS déjà refusé — cf.
    // `accederLocalStorage`) : la visite reste utilisable, seule la reprise est perdue.
    // Ne jamais faire tomber la page pour ça.
  }
}

/**
 * Efface la progression d'UN scénario — « un guide validé s'efface » (demande de Mariella du
 * 05/08). Appelé à la clôture du bilan, jamais en cours de visite : c'est la fin du parcours
 * qui vaut sa validation (décision du 25/07, déjà portée par la bascule automatique sur le
 * bilan), et une progression effacée avant la fin lui ferait perdre des réponses déjà données.
 */
export function oublierProgression(scenarioId: string, storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(cle(scenarioId));
  } catch {
    // Même repli que `sauverProgression` : jamais faire tomber la page pour un stockage
    // indisponible. Une progression qui survit à un effacement raté se rejoue au pire.
  }
}

/**
 * Efface TOUTES les progressions connues — demande de Mariella du 05/08 : « il faut reset tous
 * les guides car j'ai tout vu sauf ceux que je suis censée découvrir ici ».
 *
 * Prend la liste des identifiants en PARAMÈTRE plutôt que d'énumérer le stockage
 * (`storage.length`/`storage.key(i)`) : ce module resterait sinon dépendant d'une surface de
 * `Storage` que les doubles des tests n'implémentent pas, et une énumération verrait des clés
 * qui ne lui appartiennent pas. L'appelant passe `Object.keys(SCENARIOS)` — le catalogue est la
 * seule liste qui fasse autorité, jamais une seconde recopiée ici.
 */
export function oublierToutesLesProgressions(storage: Storage | null, scenarioIds: readonly string[]): void {
  for (const id of scenarioIds) oublierProgression(id, storage);
}

/**
 * Relit la progression du scénario demandé.
 *
 * Toute anomalie ramène à une progression NEUVE plutôt qu'à une exception ou à un état
 * douteux : stockage d'un **autre** scénario (sinon Mariella démarrerait au milieu d'une
 * visite sans rapport), JSON illisible, champs absents, index aberrant.
 *
 * `etapesIds` (les identifiants du scénario COURANT, dans l'ordre) borne l'index relu : sans
 * ça, un scénario raccourci depuis la dernière visite (ou un stockage corrompu à la main)
 * laisserait un `index` trop grand survivre dans `GuideProgress`. `Visite` borne déjà l'ÉTAPE
 * AFFICHÉE (`scenario.etapes[Math.min(prog.index, …)]`), mais pas le compteur « n/total » ni
 * l'activation de ←/→, qui lisent `prog.index` brut — d'où le borner ICI, à la source.
 *
 * 🔴 **Et il repositionne l'index sur le premier point SANS RÉPONSE** (05/08). Défaut mesuré :
 * un scénario qui GAGNE des étapes (les deux points « marche arrière » ajoutés à `commandes`)
 * rouvrait à l'index persisté — au milieu de points déjà répondus — et les nouveaux points ne
 * lui étaient jamais présentés : « j'ai pas les nouveaux points du guide ». L'index seul ne
 * peut pas dire où reprendre quand la liste a bougé sous lui ; les VERDICTS, eux, sont ancrés
 * aux identifiants d'étape et restent justes quoi qu'il arrive à l'ordre. Reprendre au premier
 * point sans verdict, c'est reprendre là où il reste quelque chose à faire — la définition
 * utile de « là où elle s'est arrêtée ». Un scénario entièrement répondu ne bouge pas : son
 * index reste, et `Visite` bascule de toute façon sur le bilan.
 */
export function chargerProgression(
  scenarioId: string,
  storage: Storage | null,
  etapesIds: readonly string[],
): GuideProgress {
  const total = etapesIds.length;
  const bornerIndex = (i: number) => Math.max(0, Math.min(i, Math.max(0, total - 1)));

  if (!storage) return vide(scenarioId);

  let brut: string | null = null;
  try {
    brut = storage.getItem(cle(scenarioId));
  } catch {
    return vide(scenarioId);
  }
  if (!brut) return vide(scenarioId);

  let o: unknown;
  try {
    o = JSON.parse(brut);
  } catch {
    return vide(scenarioId);
  }
  if (!o || typeof o !== "object") return vide(scenarioId);

  const p = o as Partial<GuideProgress>;
  if (p.scenarioId !== scenarioId) return vide(scenarioId);

  const index = bornerIndex(Number.isInteger(p.index) && (p.index as number) >= 0 ? (p.index as number) : 0);
  const verdicts = p.verdicts && typeof p.verdicts === "object" ? p.verdicts : {};

  // Reprise au premier point SANS réponse (cf. bloc ci-dessus) — seulement si le point relu en
  // a déjà une : sinon on respecte l'index persisté, y compris quand elle est revenue en
  // arrière pour revoir un point qu'elle n'a pas encore tranché.
  const idCourant: string | undefined = etapesIds[index];
  const premierSansReponse = etapesIds.findIndex((id) => !verdicts[id]);
  const reprise = idCourant && verdicts[idCourant] && premierSansReponse !== -1 ? premierSansReponse : index;

  return { scenarioId, index: reprise, verdicts };
}
