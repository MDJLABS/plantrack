/* ==============================================================================
 * Guide de test intégré — modèle.
 * Porté de Prolearn (`app/lib/guide/types.ts`) pour le lot 2.3 (« voie rapide état du jour »).
 * Adaptation MiamBoost : pas de champ `match` — contrairement à Prolearn, le guide ne se
 * propose JAMAIS tout seul selon l'URL courante (cf. GuideDeTest.tsx) : MiamBoost n'a pas de
 * variable d'environnement fiable pour distinguer « préprod » de « production » (la préprod
 * publique est buildée avec `next build`, donc NODE_ENV=production comme une vraie prod), donc
 * le SEUL garde-fou possible est l'absence totale de montage sans `?guide=` explicite dans
 * l'URL. Un scénario proposé au simple survol d'une page l'aurait rendu visible à un convive.
 * ============================================================================== */

/** Un point à vérifier : où regarder, quoi faire, ce qui doit se passer. */
export type GuideStep = {
  /** Identifiant stable — c'est lui qui porte la progression. */
  id: string;
  /** Titre court affiché en tête de bulle. */
  titre: string;
  /**
   * Sélecteurs de la zone à surligner, du plus précis au plus général : on retient
   * le **premier qui désigne un élément VISIBLE**. Plusieurs candidats parce qu'une
   * page réelle varie (un jeu de données peut ne pas avoir l'élément exact) — mieux
   * vaut se rabattre sur la zone parente que sur rien.
   * Vide ⇒ étape sans ancrage (bulle centrée), pour une consigne générale.
   */
  cibles?: string[];
  /** Ce que Mariella doit faire. */
  action: string;
  /** Ce qu'elle doit voir si c'est bon. */
  attendu: string;
};

/** Une livraison à valider = une suite ordonnée de points. */
export type GuideScenario = {
  /** Identifiant utilisé dans l'URL (`?guide=<id>`). */
  id: string;
  titre: string;
  /** Date de livraison — sert de repère humain dans le registre. */
  date: string;
  /** Page concernée, en clair (affiché dans le registre, pas dans la bulle). */
  page: string;
  etapes: GuideStep[];
};

/** Verdict de Mariella sur un point. */
export type StepVerdict = "ok" | "ko";

/** Progression persistée (localStorage) — reprise là où elle s'est arrêtée. */
export type GuideProgress = {
  scenarioId: string;
  /** Index de l'étape courante. */
  index: number;
  /** Verdicts rendus, par id d'étape. */
  verdicts: Record<string, StepVerdict>;
};
