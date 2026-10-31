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

/**
 * Un geste à jouer automatiquement pour Mariella, à l'entrée d'une étape — elle n'a plus à
 * le faire elle-même, seulement à juger le résultat. Ajouté pour le curseur animé
 * (`GuideCurseur.tsx`) : `cible` est un sélecteur CSS résolu via `resolveTarget`
 * (`guide-geometry.ts`), avec repli sur les `cibles` de l'étape si absent.
 */
export type GuideGeste = {
  /** clic : `el.click()`. saisie : pose `valeur` dans un champ (setter natif + events React).
   *  aller : navigue vers `url` — la visite reprend grâce à `sessionStorage` (guide-visite.ts). */
  type: "clic" | "saisie" | "aller";
  /** Sélecteur CSS de l'élément à actionner — absent ⇒ repli sur les `cibles` de l'étape. */
  cible?: string;
  /** Valeur à saisir (type "saisie" uniquement). */
  valeur?: string;
  /** URL de destination (type "aller" uniquement). */
  url?: string;
};

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
  /** Geste à jouer automatiquement à l'entrée de l'étape (curseur animé) — absent ⇒
   *  comportement actuel inchangé (elle fait le geste elle-même). */
  geste?: GuideGeste;
  /** Identifiant d'étape PlanTrack (ex. "s3") — RETIRÉ DE SERVICE (d138, 31/10) : portait le
   *  verdict vers l'ancien envoi réseau `guide-envoi.ts`, supprimé. Champ laissé TEL QUEL
   *  (type optionnel, jamais lu) pour ne pas forcer une modification des `scenarios.ts` de
   *  chaque site à cette seule occasion — un site peut le retirer de ses propres scénarios
   *  quand il y retouche, rien ne l'y oblige. */
  pt?: string;
  /**
   * Page où se joue ce point (ex. `/aujourdhui`). Hors de cette page, la carte propose
   * « M'emmener au bon endroit » plutôt que de chercher une zone qui ne peut pas y être.
   * Absent ⇒ l'`url` du scénario (porté de Prolearn, commit 958ecde2, demande Mariella 31/10).
   */
  url?: string;
};

/** Une livraison à valider = une suite ordonnée de points. */
export type GuideScenario = {
  /** Identifiant du scénario — choisi dans le panneau (lanceur bas-droite), plus jamais lu
   *  dans une URL (`?guide=` retiré, d138 : « ça ne fonctionne pas par lien, ça fonctionne
   *  par session »). */
  id: string;
  titre: string;
  /** Date de livraison — sert de repère humain dans le registre, ET de condition de
   *  « relivraison » (`guide-etat.ts` : une date différente de celle stockée repart à
   *  zéro — c'est ainsi qu'un point "ko" corrigé redevient à traiter). */
  date: string;
  /** Page concernée, en clair (affiché dans le registre, pas dans la bulle). */
  page: string;
  /** Page de départ (ex. `/aujourdhui`) — là où le bouton « M'emmener au bon endroit »
   *  conduit, pour les points qui n'ont pas leur propre `url` (porté de Prolearn, commit
   *  958ecde2, demande Mariella 31/10). */
  url?: string;
  /** Jamais lu par ce moteur (qui ne propose plus rien tout seul selon l'URL courante : le
   *  lanceur bas-droite remplace toute proposition spontanée). Porté UNIQUEMENT pour qu'un
   *  scénario copié depuis un site qui s'en servait encore reste assignable sans erreur de
   *  type — compatibilité, pas comportement. */
  match?: string;
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
  /** Motif d'un verdict "ko", par id d'étape — optionnel : une progression déjà stockée
   *  avant ce champ reste valable, `chargerProgression` est tolérant à son absence. */
  motifs?: Record<string, string>;
  /** Ids des étapes dont le geste (`GuideStep.geste`) a déjà été joué une fois — sans ça,
   *  revenir sur une étape (←, bilan) le rejouerait à chaque passage. Optionnel pour la
   *  même raison que `motifs`. */
  joues?: string[];
};

/**
 * Verdict d'une visite CLOSE — transmis à `apresConsigne` (réglages serveur du site) par
 * `consignerGuide` (guide-actions.ts), une fois le compte-rendu écrit dans
 * `.planning/retours-tests.md`. `ko` ne porte que les points en écart (jamais tous les
 * points : un site qui veut tracer, ex. ProLearn/SQLite, n'a besoin que de ça).
 */
export type ResultatGuide = {
  scenarioId: string;
  titre: string;
  statut: "valide" | "a-revoir";
  total: number;
  ko: { id: string; titre: string; note?: string }[];
};

/**
 * Réglages CLIENT-safe propres à UN site — `lib/guide/guide-reglages.ts`, comme
 * `scenarios.ts` : jamais dans le moteur, jamais écrasé par la synchro.
 * Défauts (si le site ne fournit pas le champ) : `resoudreUrl` = identité,
 * `ancetresReplies` = aucun.
 */
export type ReglagesGuideClient = {
  /** Remplace l'ancien `resoudreUrl` générique du moteur — transforme l'URL d'un point selon
   *  le pathname courant (ex. ids dynamiques). Absent ⇒ l'URL est utilisée telle quelle. */
  resoudreUrl?: (url: string, pathname: string) => string;
  /** Sélecteurs d'ancêtres repliés à ignorer lors de la recherche d'une cible visible (ex.
   *  ProLearn : `.tn-childwrap.collapsed`) — voir `guide-geometry.ts`. Absent ⇒ aucun. */
  ancetresReplies?: string[];
};

/**
 * Réglages SERVEUR propres à UN site — `lib/guide/guide-reglages-serveur.ts`, jamais dans le
 * moteur, jamais écrasé. `estAdmin` est la SEULE porte qui autorise `guide-actions.ts` à lire
 * ou écrire quoi que ce soit : toute action commence par `await estAdmin()`.
 */
export type ReglagesGuideServeur = {
  /** `true` si la visite en cours est authentifiée comme admin du site — chaque site
   *  implémente avec SA propre session (cookie, JWT…). Jamais de valeur par défaut : un site
   *  qui oublie ce fichier n'a pas de guide du tout, jamais un guide ouvert à tous. */
  estAdmin: () => Promise<boolean>;
  /** Hook optionnel après consignation d'un guide terminé (ex. ProLearn : traçage SQLite). */
  apresConsigne?: (r: ResultatGuide) => Promise<void>;
};
