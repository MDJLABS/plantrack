"use client";

/* ==============================================================================
 * Guide de test intégré — visite guidée des points à vérifier.
 * Porté de Prolearn (`app/components/guide/GuideDeTest.tsx`), lot 2.3 MiamBoost
 * (« voie rapide état du jour »), tâche 8 (« socle de vérification guidée »).
 * Convention détaillée : `.claude/rules/guide-de-test.md`.
 *
 * Les SIX invariants du fichier source, préservés tels quels — le 5ᵉ REFORMULÉ (pas
 * supprimé) à la tâche 11 (« la visite guidée survit au changement de page ») :
 * 1. l'overlay ne bloque RIEN (`pointer-events: none` sur #guide-overlay, seule la bulle
 *    #guide-bulle capte les clics — sinon impossible de tester un geste sur la page).
 * 2. ne jamais encadrer une zone absente/masquée : `resolveTarget` (guide-geometry.ts)
 *    parcourt tous les éléments d'un sélecteur et retient le premier VISIBLE ; sinon la
 *    bulle le dit (`!trouvee`).
 * 3. la bulle est MESURÉE (bulleRef + tick()), jamais supposée, et le cadre de surlignage
 *    est borné au viewport (Math.max/Math.min sur t/l/w/h).
 * 4. Échap NE ferme PAS la visite — aucun `onKeyDown` ne l'intercepte, volontairement.
 * 5. REFORMULÉ (d138, 31/10 — « ça ne fonctionne pas par lien, ça fonctionne par
 *    session ») : rien ne se monte sans une session ADMIN du site, vérifiée CÔTÉ SERVEUR
 *    (`estAdmin()`, réglages serveur, lu par `guide-actions.ts`/`etatGuides()`). Il n'existe
 *    plus de paramètre d'URL (`?guide=`) : `GuideDeTestLazy.tsx` décide seul, à partir de
 *    `etatGuides()` et du « guide actif » (`sessionStorage`, `lireGuideActif`), lequel
 *    `scenario` (s'il y en a un) passer en prop à ce fichier.
 * 6. styles auto-portés (inline, aucune classe), montage en portail sur `document.body`.
 *
 * ⚠️ `react-hooks/set-state-in-effect` — CINQ tolérances motivées dans ce fichier (chantier
 * `react-hooks`). Elles se lisent ensemble, pas une par une : ce composant est le cas d'école
 * de l'effet LÉGITIME tel que la règle elle-même le décrit — « subscribe for updates from
 * some external system ». Il ne resynchronise aucun état depuis une prop ; il synchronise
 * React avec quatre systèmes qui lui sont EXTÉRIEURS : l'hydratation (`monte`, sans quoi
 * `createPortal` s'exécuterait au rendu serveur), `localStorage` (la progression, qui
 * n'existe pas au rendu serveur), le routage, et le presse-papier.
 *
 * Aucun des trois remèdes employés ailleurs dans ce chantier ne s'y applique : une `key` de
 * parent est exclue — ce composant vit dans le LAYOUT, monté une seule fois et jamais
 * démonté d'une page à l'autre, c'est même la propriété qui fait tenir la tâche 11 ; un
 * geste utilisateur n'existe pas pour « être hydraté » ; et un initialiseur paresseux de
 * `useState` lirait `localStorage` pendant le rendu, ce que l'invariant d'accès au stockage
 * interdit (`npm run test:acces-stockage` rougirait, à raison).
 *
 * ⚠️ Ces effets sont couverts par des invariants MESURÉS et par deux gardes exécutables
 * (`test:acces-stockage`, `test:guide-visite`) ; aucun test de RENDU ne les couvre. Ne pas
 * les restructurer pour éteindre un lint — c'est l'outil de vérification de Mariella, et
 * trois verdicts négatifs de juillet portaient déjà sur le dispositif, jamais sur la
 * fonctionnalité qu'il vérifiait.
 *
 * ⚠️ Ancienne adaptation MiamBoost à l'invariant 5 (RETIRÉE au 31/10, d138) : la garde
 * reposait sur l'ABSENCE de `?guide=` dans l'URL (MiamBoost n'a pas de séparation prod/
 * préprod par variable d'environnement — sa préprod publique est buildée par `next build`,
 * donc `NODE_ENV=production` comme une vraie prod, ce qui rendait `process.env.NODE_ENV`
 * inutilisable comme garde-fou). Le nouveau garde-fou (invariant 5 ci-dessus) est la session
 * admin VÉRIFIÉE CÔTÉ SERVEUR — valable identiquement sur CHAQUE site, MiamBoost compris,
 * sans dépendre d'une particularité de son hébergement.
 *
 * ⚠️ Présentation (30/10, maquette validée par Mariella, cf. commit mdjlabs 1ddbc6f —
 * `https://claude.ai/artifact/CrmX2JdkqBtpucihUxYAgo`, portée telle quelle d'un site à
 * l'autre) : la carte n'est plus positionnée par rapport à la cible surlignée
 * (`placeBubble`, `guide-geometry.ts` — toujours exporté, simplement plus appelé ICI).
 * Posture d'affichage (charte mdjlabs) : feuille collée en bas de l'écran au pouce/à deux
 * mains (`< 600px`), carte fixe 420px en bas à droite sur la table/au bureau (`>= 600px`).
 * `bulleRef` reste mesuré (invariant 3, reformulé) — plus pour PLACER la carte, mais pour
 * donner au curseur animé un point de départ réel (`departCurseur`, dans `Visite`).
 *
 * ⚠️ Tâche 11, mise à jour d138 — CE COMPOSANT NE RÉSOUT PLUS LUI-MÊME LE SCÉNARIO.
 * `scenario` arrive en PROP, déjà résolu par `GuideDeTestLazy` via le catalogue
 * (`getScenario`, `@/lib/guide/guide-visite.ts`) et le « guide actif » choisi dans son
 * panneau (`lireGuideActif`/`ecrireGuideActif`, `@/lib/guide/guide-progress.ts`) : une
 * seule résolution, à un seul endroit.
 *
 * ⚠️ CONSIGNATION SERVEUR (d138, remplace l'ancien envoi réseau `guide-envoi.ts`) : chaque
 * verdict appelle `consignerPoint` et le dernier point du scénario appelle `consignerGuide`
 * (`@/lib/guide/guide-actions.ts`, `'use server'`, `node:fs/promises` sur
 * `.planning/guides-etat.json` + `.planning/retours-tests.md`). Ces écritures supposent un
 * VRAI process Node (pas un runtime Workers sans accès fichier réel) — `consignerPoint`/
 * `consignerGuide` rendent `{ error: "…" }` plutôt que de lever si l'écriture échoue, mais
 * un site qui servirait ce moteur depuis un environnement sans `node:fs` réel ne pourrait
 * alors JAMAIS consigner ses verdicts : point resté incertain, à vérifier par site (cf.
 * rapport de livraison). Le bouton « Copier le compte-rendu » (`guide-compte-rendu.ts`)
 * reste dans tous les cas le filet de sécurité.
 * ============================================================================== */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { BORD_CARTE, placerCarte, resolveTarget, type PlaceCarte, type Rect } from "@/lib/guide/guide-geometry";
import {
  accederLocalStorage, avancer, chargerProgression, marquerJoue, noterMotif, oublierProgression,
  oublierToutesLesProgressions, progressionDepuisServeur, reculer, sauverProgression, serveurPrime,
  verdict, vide,
} from "@/lib/guide/guide-progress";
import { indexDePoint, SCENARIOS } from "@/lib/guide/scenarios";
import { verdictScenario } from "@/lib/guide/guide-verdict";
import { construireCompteRendu } from "@/lib/guide/guide-compte-rendu";
import { consignerGuide, consignerPoint, guideInterrompu, renvoyerGuide } from "@/lib/guide/guide-actions";
import { reglagesGuide } from "@/lib/guide/guide-reglages";
import { surLaPage } from "@/lib/guide/guide-visite";
import { GuideCurseur } from "./GuideCurseur";
import { gestesEtape, type ResultatGeste } from "@/lib/guide/guide-geste";
import type { VerdictStocke } from "@/lib/guide/guide-etat";
import type { GuideScenario, GuideProgress } from "@/lib/guide/types";
import { useDecalageMenuBas } from "@/lib/guide/guide-menu-bas";

/** Vrai si les paramètres (`?…`) de `url` sont ceux de la page affichée (ordre ignoré). */
function memesParametres(url: string): boolean {
  if (typeof window === "undefined") return true;
  const trier = (s: string) => [...new URLSearchParams(s)].map(([k, v]) => `${k}=${v}`).sort().join("&");
  try {
    return trier(new URL(url, window.location.href).search) === trier(window.location.search);
  } catch {
    return true;
  }
}

const Z = 2147483000; // au-dessus de tout : la page a des overlays à z-index élevé (max mesuré : 1000)
/** Seuil posture (charte mdjlabs) : < 600 → feuille collée en bas ; >= 600 → carte fixe. */
const SEUIL_ORDINATEUR = 600;
/** b44 : temps pendant lequel la dernière réponse reste à l'écran, cochée, avant la carte de fin. */
const DELAI_COCHE_FIN = 700;

/**
 * Couleurs FIXES (littérales, pas des jetons `var(--…)`) : le fond de la bulle
 * (`var(--surface-inverse, #2A2724)`, ci-dessous) reste délibérément SOMBRE dans les deux thèmes du
 * site — « l'encre suit son fond » ne s'applique qu'aux fonds qui BASCULENT entre clair et
 * sombre, jamais à un fond figé. Sur un fond figé, l'encre doit l'être aussi, sous peine de
 * s'inverser dans le mauvais sens et disparaître dans le thème sombre. Même motif, mêmes
 * valeurs que la carte sombre de `CtaDiagnostic.tsx` : les hex ci-dessous sont les valeurs
 * RÉELLES du thème sombre du design system (globals.css), pas des couleurs inventées.
 *
 * 🔴 PORTAGE SUR CE SITE (05/09) : `--surface-inverse` et `--sans` sont des jetons du COCKPIT,
 * absents du `globals.css` d'ici. Un `var()` non défini ne rend pas une valeur par défaut, il
 * rend la propriété INVALIDE : la bulle s'affichait donc SANS FOND, texte clair par-dessus la
 * page claire — illisible, et rien ne le signalait (ni type, ni build, ni test). D'où le repli
 * écrit dans le `var()` lui-même : la valeur du cockpit reste utilisée là où le jeton existe.
 */
export const C = {
  fond: "var(--surface-inverse, #2A2724)",
  bord: "#403A31", // --line-strong (thème sombre)
  texte: "#F3EEE6", // --ink (thème sombre)
  doux: "#B8B0A4", // --ink-soft (thème sombre)
  accent: "#54C98A", // --accent (thème sombre)
  ok: "#A9DCBD", // --ok-ink (thème sombre)
  okSoft: "#1C2A21", // --ok-soft (thème sombre)
  ko: "#EDB0A2", // --danger-ink (thème sombre)
  koSoft: "#2E1C18", // --danger-soft (thème sombre)
  // Boutons de verdict pleins + progression en segments/cadre de surlignage (design validé
  // mdjlabs 1ddbc6f, mêmes valeurs que ProLearn) — littérales comme le groupe ci-dessous :
  // contrairement à `accent`/`ok`/`ko`, ces teintes ne suivent PAS le thème du site.
  vert: "#4fc38a",
  vertTexte: "#06140d",
  cyan: "#5fd4f4",
  cyanTexte: "#04161d",
  // Encart « TU DOIS VOIR » (même design) — fond distinct du fond de la carte, littéral.
  fondProfond: "#0b0e12",
  bordClair: "#262c34",
  tresDoux: "#8fa3b3",
  // Bandeau « Tu dois voir » / « J'ai fait le geste pour toi » (design validé mdjlabs
  // 1ddbc6f) — valeurs REPRISES telles quelles du mockup, pas inventées ici.
  cyanFond: "#0f2a33",
  cyanDoux: "#9be5f9",
  cyanFort: "#d6f4fc",
  // Bandeau « geste automatique en échec » + bouton « Réessayer le geste », et contour du
  // bouton de verdict « Non, pas ça » — idem.
  orange: "#f0a35a",
  orangeFond: "#2b1d0f",
  orangeBord: "#6b4520",
  orangeTexte: "#f6c08a",
};

export function GuideDeTest({
  scenario,
  verdictsServeur,
  onFermerDefinitivement,
  onChoisirAutre,
  onTermine,
}: {
  /** Choisi dans le panneau du lanceur (`GuideDeTestLazy`) — jamais résolu ici. */
  scenario: GuideScenario;
  /** Verdicts déjà connus du SERVEUR pour ce scénario (`etatGuides()`, lu par
   *  `GuideDeTestLazy`) — `undefined` si la liste n'a pas encore répondu. Sert UNIQUEMENT à
   *  faire primer le serveur sur le `localStorage` du poste (d138), cf. `serveurPrime`. */
  verdictsServeur?: Record<string, VerdictStocke>;
  /** Efface la persistance de session ET synchronise `GuideDeTestLazy` — appelé
   *  UNIQUEMENT par le ✕ « Fermer le guide », jamais par « Replier ». */
  onFermerDefinitivement: () => void;
  /** « Choisir un autre guide » (Mariella, 07/11) : quitte CE guide sans effacer sa
   *  progression et rouvre la liste des guides. Absent : le lien ne s'affiche pas. */
  onChoisirAutre?: () => void;
  /** b44 : la fin du guide est consignée — le lanceur relit la liste (pastille à jour). */
  onTermine?: () => void;
}) {
  const [monte, setMonte] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drapeau d'hydratation, cf. bandeau de tête
  useEffect(() => setMonte(true), []);

  const [ouvert, setOuvert] = useState(false);
  // Le lien direct (ou la reprise de session) ouvre la visite ; sinon on attend le bouton
  // (repris là où elle s'est arrêtée). Déclenché par `scenario.id` : passer d'un scénario à
  // un autre (cockpit → vitrine) doit rouvrir la bulle, pas rester replié sur l'ancien état.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- ouverture sur changement de scénario, cf. bandeau de tête
  useEffect(() => setOuvert(true), [scenario.id]);

  if (!monte) return null;
  return createPortal(
    ouvert
      ? (
        <Visite
          scenario={scenario}
          verdictsServeur={verdictsServeur}
          onReplier={() => setOuvert(false)}
          // ⚠️ Retour de Mariella du 26/07 : « si je ferme l'overlay je veux un bouton pour
          // le rouvrir ». Le ✕ effaçait la clé de session, donc PLUS RIEN ne se montait —
          // seul un `?guide=` retapé à la main pouvait rouvrir la visite, et une visite
          // fermée par mégarde ressemblait à une visite qui ne survit pas au changement de
          // page. Le ✕ replie désormais vers la pastille ; la sortie DÉFINITIVE existe
          // toujours, mais elle est portée par la croix de la pastille (`#guide-quitter`),
          // là où on la cherche quand on veut vraiment partir.
          onFermer={() => setOuvert(false)}
          // Clôture depuis le BILAN : la visite est finie, elle a son compte-rendu. On sort
          // pour de bon (session effacée) — l'effacement de la PROGRESSION, lui, se fait dans
          // `Visite`, qui est le seul endroit à savoir de quelle progression il s'agit.
          onTerminer={onFermerDefinitivement}
          onChoisirAutre={onChoisirAutre}
          onTermine={onTermine}
        />
      )
      : (
        <BoutonOuvrir
          scenario={scenario}
          onOpen={() => setOuvert(true)}
          onQuitter={onFermerDefinitivement}
        />
      ),
    document.body,
  );
}

/**
 * Pastille discrète, en bas à droite — jamais au-dessus d'une zone de travail.
 *
 * Deux commandes distinctes, volontairement : la pastille ROUVRE la visite (au point où elle
 * s'est arrêtée), sa croix la QUITTE pour de bon. Sans cette croix, une visite ouverte une
 * fois deviendrait impossible à quitter dans cet onglet — un dispositif dont on ne peut pas
 * sortir est pire que pas de dispositif. Sans la pastille, à l'inverse, un ✕ malencontreux
 * faisait disparaître la visite sans recours (retour de Mariella, 26/07).
 */
function BoutonOuvrir({ scenario, onOpen, onQuitter }: {
  scenario: GuideScenario;
  onOpen: () => void;
  onQuitter: () => void;
}) {
  const menuBas = useDecalageMenuBas(); // b42 : jamais posée sur le menu du bas
  return (
    <div
      id="guide-pastille"
      style={{
        position: "fixed", right: 16, bottom: 16 + menuBas, zIndex: Z,
        display: "flex", alignItems: "stretch",
        borderRadius: 999, border: `1px solid ${C.bord}`, background: C.fond,
        boxShadow: "0 6px 24px rgba(0,0,0,.45)", overflow: "hidden",
      }}
    >
      <button
        id="guide-ouvrir"
        onClick={onOpen}
        title={`${scenario.etapes.length} points à vérifier : ${scenario.titre}`}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "9px 12px 9px 14px",
          border: "none", background: "transparent", color: C.texte,
          font: "500 12.5px/1 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ color: C.accent }}>◎</span>
        Points à vérifier
        <span style={{
          padding: "2px 6px", borderRadius: 999, background: "rgba(0,0,0,.25)",
          color: C.doux, fontSize: 11,
        }}>{scenario.etapes.length}</span>
      </button>
      <button
        id="guide-quitter"
        onClick={onQuitter}
        aria-label="Quitter Checker, le guide de test"
        title="Quitter Checker (il ne réapparaîtra plus dans cet onglet)"
        style={{
          padding: "0 11px",
          border: "none", borderLeft: `1px solid ${C.bord}`,
          background: "transparent", color: C.doux,
          font: "500 13px/1 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}

function Visite({ scenario, verdictsServeur, onReplier, onFermer, onTerminer, onChoisirAutre, onTermine }: {
  scenario: GuideScenario;
  /** Verdicts SERVEUR déjà connus pour ce scénario — cf. `GuideDeTest` ci-dessus. */
  verdictsServeur?: Record<string, VerdictStocke>;
  /** Replier : la pastille reste, la visite CONTINUE (session intacte). */
  onReplier: () => void;
  /** Fermer : tout s'efface (session) — un dispositif dont on ne peut pas sortir serait
   *  pire que pas de dispositif (cf. brief tâche 11, étape 3). */
  onFermer: () => void;
  /** Sortie DÉFINITIVE depuis le bilan (efface la clé de session) — distincte de `onFermer`,
   *  qui ne fait que replier vers la pastille. */
  onTerminer: () => void;
  onChoisirAutre?: () => void;
  onTermine?: () => void;
}) {
  const [prog, setProg] = useState<GuideProgress>(() => vide(scenario.id));
  const [cible, setCible] = useState<Rect | null>(null);
  const [trouvee, setTrouvee] = useState(true);
  // La carte n'est plus placée par rapport à la cible (cf. bandeau de tête) : `bulleRef`
  // reste mesuré (invariant 3, reformulé) uniquement pour donner au curseur animé un point
  // de départ réel — jamais pour calculer la position de la carte elle-même.
  const bulleRef = useRef<HTMLElement | null>(null);
  const [ecranBilan, setEcranBilan] = useState(false);
  // Posture (charte mdjlabs, design validé 1ddbc6f) : feuille collée en bas au pouce/à deux
  // mains, carte fixe en bas à droite sur la table/au bureau. `window` est lu ici comme le
  // reste du fichier le fait déjà en render (cf. l'ancien calcul de `pos`) : `Visite` ne
  // monte qu'après hydratation (portail dans `GuideDeTest`), donc toujours côté client.
  const [largeurEcran, setLargeurEcran] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  useEffect(() => {
    const onResize = () => setLargeurEcran(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const mobile = largeurEcran < SEUIL_ORDINATEUR;
  // d172 : la carte ne cache jamais la zone qu'elle montre — elle change de côté (en haut
  // au pouce, un autre coin ailleurs) et revient dès que la voie est libre (`placerCarte`).
  const [place, setPlace] = useState<PlaceCarte>(mobile ? "bas" : "bd");
  const defileRef = useRef<string | null>(null);
  // Menu « ⋯ » (design validé) : regroupe les commandes auparavant en icônes séparées
  // (rejouer/recommencer/replier/fermer) — mêmes actions, même sémantique, cf. plus bas.
  const [menuOuvert, setMenuOuvert] = useState(false);
  // Bouton « Copier le compte-rendu » (décision Mariella, round de correction 1) : pas de
  // distinction fine ici, juste « ça a marché » / « ça a échoué » — `navigator.clipboard`
  // peut être absent (contexte non sécurisé) ou refusé (permission), les deux tombent dans
  // "echec", qui fait apparaître le repli (textarea en lecture seule, pré-sélectionnée).
  const [etatCopie, setEtatCopie] = useState<"idle" | "ok" | "echec">("idle");
  const secoursRef = useRef<HTMLTextAreaElement | null>(null);

  // Curseur animé (lot « curseur animé ») — joue le geste de l'étape (`etape.geste`) à la
  // place de Mariella. `curseurCle` force un REMONTAGE de `GuideCurseur` (sa propre garde
  // anti-double-jeu, `dejaJoue`, ne doit repartir que sur un geste VOULU — un nouveau
  // montage, pas une mise à jour de props) : changement d'étape, ou bouton « Rejouer ».
  const [curseurVisible, setCurseurVisible] = useState(false);
  const [curseurCle, setCurseurCle] = useState(0);
  const [gesteRaison, setGesteRaison] = useState<string | null>(null);
  // Bandeau « J'ai fait le geste pour toi » (design validé) — vrai quand le geste
  // automatique a réussi, pour que Mariella sache qu'elle n'a rien à faire elle-même.
  const [gesteOk, setGesteOk] = useState(false);

  // Motif d'un "ko" — champ posé APRÈS avoir noté "ko" (cf. `noter` plus bas), jamais avant :
  // le verdict est acquis dès le clic, le motif n'est qu'un détail optionnel qui s'y ajoute.
  const [motifActif, setMotifActif] = useState(false);
  const [motifSaisie, setMotifSaisie] = useState("");

  // Consignation du scénario (`consignerGuide`) — une seule fois par passage à l'état
  // complet (cf. l'effet de bascule plus bas) : garde contre un double appel (changement de
  // point qui ne modifie pas le statut final, double rendu StrictMode…).
  const consigneRef = useRef<string | null>(null);
  // b44 : la consignation de fin attend que le DERNIER point soit écrit côté serveur
  // (`pointRef`), et la dernière réponse reste visible un instant, cochée, avant la carte de
  // fin (`vientDeNoterRef`) — sinon elle ne se voyait jamais validée.
  const pointRef = useRef<Promise<unknown>>(Promise.resolve());
  const vientDeNoterRef = useRef(false);
  const onTermineRef = useRef(onTermine);
  useEffect(() => { onTermineRef.current = onTermine; }, [onTermine]);
  // Envoi du retour de fin à la session (05/11) : la carte dit la vérité — parti, en
  // cours, ou raté (le copier-coller ne reparaît qu'alors, en secours).
  const [envoi, setEnvoi] = useState<"envoi" | "envoye" | "echec">("envoi");

  // Reprise « là où elle s'est arrêtée » — lue APRÈS montage (localStorage n'existe pas
  // au rendu serveur).
  const [charge, setCharge] = useState(false);
  useEffect(() => {
    // Les IDS, pas le nombre d'étapes : c'est ce qui permet à `chargerProgression` de rouvrir
    // sur le premier point SANS RÉPONSE quand le scénario a gagné des points depuis la
    // dernière visite (défaut du 05/08 : « j'ai pas les nouveaux points du guide »).
    const etapesIds = scenario.etapes.map((e) => e.id);
    const local = chargerProgression(scenario.id, accederLocalStorage(), etapesIds);
    // Le serveur prime sur ce poste SEULEMENT s'il porte STRICTEMENT plus de verdicts (d138)
    // — ex. un point jugé sur le téléphone de Mariella, jamais rouvert ici.
    const p = serveurPrime(local, verdictsServeur)
      ? progressionDepuisServeur(scenario.id, verdictsServeur!, etapesIds)
      : local;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reprise lue dans localStorage/serveur après montage, cf. bandeau de tête
    setProg(p);
    setCharge(true);
  }, [scenario.id, scenario.etapes, verdictsServeur]);

  const etape = scenario.etapes[Math.min(prog.index, scenario.etapes.length - 1)];
  // Tous les gestes de l'étape, dans l'ordre (`geste` puis `gestes`, d216).
  const gestes = gestesEtape(etape);
  const aGestes = gestes.length > 0;
  const total = scenario.etapes.length;

  // « Si je ne suis pas sur la bonne page, un bouton doit m'y emmener » (porté de Prolearn,
  // commit 958ecde2, demande Mariella 31/10). `urlPoint` : la destination connue de CE point
  // (ou, à défaut, celle du scénario), passée par `reglagesGuide.resoudreUrl` — réglages
  // PROPRES à chaque site (`guide-reglages.ts`) : un site qui aurait besoin d'y substituer
  // un segment variable (ex. ProLearn/[formation]) le fait dans sa propre copie, sans que
  // cela change le comportement d'un site qui n'en a pas besoin (identité par défaut).
  // `null` si ni le point ni le scénario n'en portent.
  const pathname = usePathname();
  const router = useRouter();
  const urlBrute = etape.url ?? scenario.url ?? null;
  const urlPoint = urlBrute === null ? null : (reglagesGuide.resoudreUrl ?? ((u: string) => u))(urlBrute, pathname);
  // Un scénario porte souvent un `match` (toutes les pages où il est valable, ex. n'importe
  // quel élément du Studio) plus large que son `url` (UNE page de départ) : sur une page
  // couverte par `match`, elle n'est pas « hors page » tant que le point n'a pas sa propre
  // `url` — sinon le bouton la chasserait d'une page où le point se joue très bien (07/11).
  const couvertParMatch = etape.url == null && !!scenario.match && (() => {
    try { return new RegExp(scenario.match).test(pathname); } catch { return false; }
  })();
  const horsPage = urlPoint !== null && !couvertParMatch && !surLaPage(pathname, urlPoint);
  // Présent quand elle n'est pas au bon endroit pour ce point, OU que la zone décrite y est
  // introuvable mais qu'une destination connue pourrait corriger ça. Plus de `?guide=` à
  // reporter dans l'URL (d138) : la visite tient par le « guide actif » en sessionStorage,
  // qui survit tout seul au changement de page.
  // Jamais un bouton qui renvoie sur la page où elle est déjà (même chemin ET mêmes
  // paramètres, `?vue=` de /dashboard compris) : un clic sans effet (b42, 07/11).
  const dejaLa = urlPoint !== null && surLaPage(pathname, urlPoint) && memesParametres(urlPoint);
  const onAllerAuBonEndroit = urlPoint !== null && (horsPage || (!trouvee && !dejaLa))
    ? () => router.push(urlPoint)
    : null;

  const bilan = verdictScenario(scenario.etapes, prog.verdicts);

  // Bascule sur le bilan dès que tous les points ont une réponse (décision Mariella
  // 2026-07-25, portée telle quelle : répondre à tous les points VAUT sa validation).
  // Depuis d138, c'est aussi CE passage qui déclenche `consignerGuide` (« le dernier point
  // appelle consignerGuide ») — une seule fois par scénario tant qu'elle ne revient pas à
  // "en-cours" (`consigneRef`, remis à `null` ci-dessous) : revoir un point déjà jugé sans
  // repasser par "en-cours" ne réécrit pas le journal, cf. rapport de livraison.
  useEffect(() => {
    // Rien avant que la progression soit LUE : au premier rendu elle est vide, donc
    // « en-cours », et son chargement passerait pour une complétion.
    if (!charge) return;
    if (bilan.statut === "en-cours") {
      // Retour à une visite incomplète (elle a cliqué ↻, ou un point a perdu son verdict) :
      // refermer le récapitulatif, et autoriser une prochaine consignation.
      consigneRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bascule du bilan sur progression relue, cf. bandeau de tête
      setEcranBilan(false);
      return;
    }
    // Un « pas ok » au DERNIER point : la carte de fin attend sa remarque (le champ motif
    // disparaissait sinon aussitôt, et la remarque ne partait jamais — b44).
    if (motifActif) return;
    const delai = vientDeNoterRef.current ? DELAI_COCHE_FIN : 0;
    vientDeNoterRef.current = false;
    const t = setTimeout(() => {
      setEcranBilan(true);
      if (consigneRef.current === scenario.id) return;
      consigneRef.current = scenario.id;
      setEnvoi("envoi");
      // Une réouverture rappelle `consignerGuide`, mais le serveur ne renvoie jamais une fin
      // déjà prise par le poste (b44) : il rend juste `envoye`.
      void pointRef.current
        .catch(() => undefined)
        .then(() => consignerGuide(scenario.id))
        .then((r) => {
          setEnvoi(!r.error && r.envoye ? "envoye" : "echec");
          if (!r.error && r.statut !== "en-cours") onTermineRef.current?.();
        })
        .catch(() => setEnvoi("echec"));
    }, delai);
    return () => clearTimeout(t);
  }, [charge, bilan.statut, scenario.id, motifActif]);

  const renvoyer = () => {
    setEnvoi("envoi");
    void renvoyerGuide(scenario.id)
      .then((r) => setEnvoi(!r.error && r.envoye ? "envoye" : "echec"))
      .catch(() => setEnvoi("echec"));
  };

  const maj = useCallback((p: GuideProgress) => {
    setProg(p);
    sauverProgression(p, accederLocalStorage());
  }, []);

  /** Clôture du bilan : la progression du scénario est EFFACÉE, puis on sort pour de bon
   *  (demande de Mariella du 05/08 : « il faut un système pour que les guides se suppriment une
   *  fois que j'ai validé »). Un scénario re-livré plus tard — enrichi de nouveaux points —
   *  repart alors du premier, sans traîner les réponses d'une version précédente. */
  const terminer = useCallback(() => {
    oublierProgression(scenario.id, accederLocalStorage());
    onTerminer();
  }, [scenario.id, onTerminer]);

  // Remise à zéro de TOUS les guides. Confirmation À LA PLACE du bouton (règle du dépôt,
  // 04/08) : ni `confirm()` natif, ni fenêtre par-dessus la page — ici, le bouton devient
  // sa propre confirmation. Le geste efface les réponses de toutes les visites, y compris
  // celles d'un scénario qu'elle n'a pas rouvert : ça engage vraiment, donc ça se confirme.
  const [resetADemander, setResetADemander] = useState(false);
  const [resetFait, setResetFait] = useState(false);
  const remettreTousLesGuidesAZero = () => {
    // `Object.keys(SCENARIOS)` : le catalogue fait autorité sur « tous les guides » — une
    // seconde liste recopiée ici oublierait le prochain scénario ajouté, en silence.
    oublierToutesLesProgressions(accederLocalStorage(), Object.keys(SCENARIOS));
    setProg(vide(scenario.id)); // `setProg` et non `maj` : rien à réécrire dans le stockage.
    setResetADemander(false);
    setResetFait(true);
  };

  // Réponses BRUTES, point par point, AUCUNE conclusion (cf. guide-compte-rendu.ts) — ce
  // que le bouton « Copier » ci-dessous met dans le presse-papier.
  const texteCompteRendu = construireCompteRendu(scenario.id, scenario.etapes, prog.verdicts, prog.motifs);

  // Repartir de « idle » à chaque nouvelle ouverture du bilan : un « ✓ Copié » qui traîne
  // d'un tour précédent mentirait sur l'état courant du presse-papier.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- remise à zéro de l'état du presse-papier, cf. bandeau de tête
  useEffect(() => { if (ecranBilan) setEtatCopie("idle"); }, [ecranBilan]);

  // Le repli (textarea de secours) doit être immédiatement utilisable : pré-sélectionner
  // son contenu dès qu'il apparaît, sinon Mariella doit encore le sélectionner elle-même
  // avant de pouvoir copier à la main — ce que le repli est censé lui éviter.
  useEffect(() => { if (etatCopie === "echec") secoursRef.current?.select(); }, [etatCopie]);

  const copierCompteRendu = async () => {
    try {
      // `navigator.clipboard.writeText` n'existe que dans un contexte sécurisé et peut être
      // refusé (permission) : les deux tombent ici, jamais un échec silencieux.
      if (!("clipboard" in navigator) || typeof navigator.clipboard.writeText !== "function") {
        throw new Error("Clipboard API indisponible");
      }
      await navigator.clipboard.writeText(texteCompteRendu);
      setEtatCopie("ok");
    } catch {
      setEtatCopie("echec");
    }
  };

  // Suivi de la cible : elle bouge (défilement, changement d'état après une bascule).
  // Une boucle d'animation plutôt que des écouteurs : le DOM change ici pour des raisons
  // qu'aucun événement ne signale (React qui rerend l'arbre après un fetch).
  useEffect(() => {
    let raf = 0;
    let dernier = "";
    let presente = false;
    const tick = () => {
      const el = resolveTarget(etape.cibles ?? [], document, undefined, reglagesGuide.ancetresReplies ?? []);
      const r = el
        ? (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(el.getBoundingClientRect())
        : null;
      // b42 : la zone APPARAÎT (changement d'étape, ou arrivée après « M'emmener au bon
      // endroit » une fois la page chargée) → l'amener à l'écran si elle est hors de vue.
      // Pas à chaque image : Mariella reste libre de faire défiler la page ensuite.
      if (el && r && !presente && (r.y < 0 || r.y + r.h > window.innerHeight)) {
        // `inline: 'nearest'` explicite : aucun défilement HORIZONTAL provoqué par le guide.
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
      presente = !!el;
      const cle = r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}` : "null";
      if (cle !== dernier) {
        dernier = cle;
        setCible(r);
        setTrouvee(!(etape.cibles?.length) || !!el);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [etape]);

  // d172 : la carte s'écarte de la zone montrée. Mesurée (bulleRef), jamais supposée.
  // Si même la meilleure place la recouvre (zone trop grande), la page défile UNE fois par
  // point pour que le haut de la zone reste visible hors de la carte.
  useEffect(() => {
    const b = bulleRef.current?.getBoundingClientRect();
    if (!b) return;
    const ecran = { w: window.innerWidth, h: window.innerHeight };
    const { place: p, couvre } = placerCarte(cible, { w: b.width, h: b.height }, ecran, mobile, place);
    if (p !== place) setPlace(p);
    if (couvre && cible && defileRef.current !== etape.id) {
      defileRef.current = etape.id;
      const enHautP = p === "haut" || p === "hd" || p === "hg";
      const dy = enHautP ? cible.y + cible.h - (ecran.h - BORD_CARTE) : cible.y - BORD_CARTE;
      if (Math.abs(dy) > 4) window.scrollBy({ top: dy, behavior: "smooth" });
    }
  }, [cible, mobile, place, etape.id]);

  // Curseur animé : à l'entrée d'une étape qui porte un geste ET ne l'a pas déjà joué
  // (`prog.joues`), on le montre automatiquement — une étape déjà jouée (retour arrière,
  // bilan qui saute à un point) ne le rejoue QUE si Mariella clique « Rejouer » (ci-dessous).
  // Clé dépendante d'`etape.id` SEUL (volontairement) : relire `prog.joues` à chaque frappe
  // de `prog` (un motif saisi, un autre verdict…) n'a aucune raison de redéclencher quoi que
  // ce soit — seul un changement d'ÉTAPE doit décider de montrer ou non le curseur.
  useEffect(() => {
    setGesteRaison(null);
    setGesteOk(false);
    setMenuOuvert(false);
    setMotifActif(false);
    setMotifSaisie("");
    // Pas sur la bonne page (porté de Prolearn, commit 958ecde2) : le geste raterait sa
    // cible. Il partira une fois arrivée (cf. `onAllerAuBonEndroit`).
    if (horsPage) { setCurseurVisible(false); return; }
    // Rien avant que la progression soit LUE (b48) : au montage elle est vide, donc sur le
    // point 1 ; armer le curseur là ferait monter, au rendu suivant, un curseur sur le point
    // REPRIS, dont l'effet (enfant, joué avant celui-ci) rejouerait un geste déjà fait. Un
    // geste "aller" rechargeait ainsi la page en boucle.
    if (!charge) { setCurseurVisible(false); return; }
    if (aGestes && !prog.joues?.includes(etape.id)) {
      setCurseurVisible(true);
      setCurseurCle((c) => c + 1);
    } else {
      setCurseurVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un seul passage par ÉTAPE (et par arrivée sur sa page), cf. commentaire ci-dessus
  }, [etape.id, horsPage, charge]);

  // ⚠️ Invariant 4 : Échap ne ferme PAS la visite. Aucun `onKeyDown` ici, volontairement —
  // en ajouter un pour intercepter Échap casserait le test qu'elle sert justement à faire.

  // Carte posée par POSTURE (design validé), plus par rapport à la cible surlignée —
  // cf. bandeau de tête. Lu directement en render comme l'ancien `pos`, pour la même
  // raison (client only, après hydratation/portail).
  const enHaut = place === "haut" || place === "hd" || place === "hg";
  const carteStyle: CSSProperties = mobile
    ? {
        position: "fixed", left: 0, right: 0, ...(enHaut ? { top: 0 } : { bottom: 0 }),
        width: "auto", maxWidth: "100%", maxHeight: "75vh", overflowY: "auto",
        borderRadius: enHaut ? "0 0 14px 14px" : "14px 14px 0 0", boxSizing: "border-box",
      }
    : {
        position: "fixed",
        ...(place === "bg" || place === "hg" ? { left: BORD_CARTE } : { right: BORD_CARTE }),
        ...(enHaut ? { top: BORD_CARTE } : { bottom: BORD_CARTE }),
        width: 420, maxHeight: "80vh", overflowY: "auto",
        borderRadius: 10, boxSizing: "border-box",
      };
  // Point de départ du curseur animé : le centre RÉEL de la carte mesurée (invariant 3,
  // reformulé) — un repli raisonnable tant qu'elle n'a encore jamais été mesurée.
  const bRect = bulleRef.current?.getBoundingClientRect();
  const departCurseur = bRect
    ? { x: bRect.left + bRect.width / 2, y: bRect.top + bRect.height / 2 }
    : { x: window.innerWidth - 220, y: window.innerHeight - 160 };
  const v = prog.verdicts[etape.id];

  const noter = (val: "ok" | "ko") => {
    const p = verdict(prog, etape.id, val);
    // Consigné côté serveur dès le clic (d138 : « chaque verdict appelle consignerPoint ») —
    // jamais bloquant pour l'affichage local, qui reste la source immédiate de vérité pour
    // CETTE page. Un "ko" sans motif est reconfirmé (avec le motif) par `confirmerMotif`
    // ci-dessous : deux écritures pour ce cas, l'une écrase l'autre, jamais destructeur.
    // Un "ko" n'avertit la session qu'à la confirmation du motif (`confirmerMotif`) : un
    // seul message, avec sa remarque, plutôt que deux (d172).
    pointRef.current = consignerPoint(scenario.id, etape.id, val, undefined, val === "ok");
    vientDeNoterRef.current = true;
    if (val === "ko") {
      // Le "ko" est acquis tout de suite (`maj`), mais n'avance PAS encore : le petit champ
      // de motif (#guide-motif) s'ouvre, et c'est sa confirmation (`confirmerMotif`) qui fait
      // avancer — même séquence qu'avant pour "ok", juste différée d'un geste pour "ko".
      maj(p);
      setMotifActif(true);
      setMotifSaisie("");
      return;
    }
    // Une seule écriture localStorage : `avancer()` est appliqué au résultat de `verdict()`
    // avant le `maj()` unique, plutôt que d'écrire deux fois pour une seule action.
    maj(prog.index < total - 1 ? avancer(p, total) : p);
  };

  /** Confirme (ou saute) le motif saisi pour le "ko" en cours, puis avance — reprend
   *  exactement la séquence que `noter("ok")` fait en un seul geste. Un motif vide n'est
   *  pas une erreur : le champ est facultatif, seul le verdict "ko" lui-même est obligé. */
  const confirmerMotif = () => {
    const texte = motifSaisie.trim();
    const p = texte ? noterMotif(prog, etape.id, texte) : prog;
    // Reconsigne avec le motif, s'il y en a un — `consignerPoint` remplace simplement
    // l'entrée posée par `noter("ko")` ci-dessus (jamais deux verdicts qui coexistent).
    pointRef.current = consignerPoint(scenario.id, etape.id, "ko", texte || undefined);
    vientDeNoterRef.current = true;
    setMotifActif(false);
    setMotifSaisie("");
    maj(prog.index < total - 1 ? avancer(p, total) : p);
  };

  /** Juste avant que `GuideCurseur` ne joue le geste — cf. son bandeau de tête : marquer
   *  l'étape jouée et PERSISTER avant le geste, jamais après (un geste "aller" décharge la
   *  page tout de suite). */
  const avantGeste = useCallback(() => {
    maj(marquerJoue(prog, etape.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `prog`/`etape` lus à l'appel, cf. `GuideCurseur`
  }, [maj, prog, etape.id]);

  const gesteJoue = (resultat: ResultatGeste) => {
    setCurseurVisible(false);
    if (resultat.ok) {
      setGesteRaison(null);
      setGesteOk(true);
    } else {
      setGesteRaison(resultat.raison ?? "le geste a échoué");
      setGesteOk(false);
    }
  };

  /** Bouton « Rejouer le geste » / « Réessayer le geste » (menu, ou bandeau d'échec) :
   *  repasse le curseur, QUOI QUE `prog.joues` dise — `curseurCle` force un remontage de
   *  `GuideCurseur`, dont la garde anti-double-jeu (`dejaJoue`) ne concerne qu'UN montage,
   *  jamais les montages suivants. */
  const rejouerGeste = () => {
    setMenuOuvert(false);
    setGesteRaison(null);
    setGesteOk(false);
    setCurseurVisible(true);
    setCurseurCle((c) => c + 1);
  };

  return (
    <div id="guide-overlay" style={{ position: "fixed", inset: 0, zIndex: Z, pointerEvents: "none" }}>
      {/* Projecteur : un seul élément, dont l'ombre géante assombrit tout le reste.
          Pas de calque plein écran — il intercepterait les clics (invariant 1). */}
      {cible && (() => {
        // Le cadre est BORNÉ à l'écran (invariant 3) : une zone peut déborder (plus large
        // que le viewport, ou conteneur défilé horizontalement).
        const t = Math.max(0, cible.y - 4);
        const l = Math.max(0, cible.x - 4);
        const w = Math.min(cible.x + cible.w + 4, window.innerWidth) - l;
        const h = Math.min(cible.y + cible.h + 4, window.innerHeight) - t;
        return (
        <div
          id="guide-spot"
          aria-hidden="true"
          style={{
            position: "fixed",
            top: t, left: l,
            width: Math.max(0, w), height: Math.max(0, h),
            borderRadius: 6,
            border: `2px solid ${C.cyan}`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,.55)",
            pointerEvents: "none",
            transition: "top .12s ease, left .12s ease, width .12s ease, height .12s ease",
          }}
        />
        );
      })()}

      {curseurVisible && aGestes && !ecranBilan && (
        <GuideCurseur
          key={`${etape.id}:${curseurCle}`}
          depart={departCurseur}
          gestes={gestes}
          ciblesRepli={etape.cibles ?? []}
          ancetresReplies={reglagesGuide.ancetresReplies ?? []}
          onAvantAction={avantGeste}
          onJoue={gesteJoue}
        />
      )}

      <section
        id="guide-bulle"
        role="dialog"
        aria-label={`Point à vérifier ${prog.index + 1} sur ${total}`}
        ref={bulleRef}
        style={{
          ...carteStyle,
          pointerEvents: "auto", // invariant 1 : seule la bulle capte les clics
          background: C.fond, color: C.texte,
          border: `1px solid ${C.bord}`,
          boxShadow: "0 18px 50px rgba(0,0,0,.6)",
          font: "400 13px/1.5 var(--font-sans, var(--sans, system-ui, sans-serif))",
          padding: 14,
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{
            font: "500 11px/1 var(--font-mono, monospace)", color: C.doux, whiteSpace: "nowrap",
          }}>
            {ecranBilan ? `${total} sur ${total}` : `Point ${prog.index + 1} sur ${total}`}
          </span>
          {(
            // Barre de progression segmentée (visible aussi sur la carte de fin, toute verte : b44) (design validé 1ddbc6f, mêmes valeurs que
            // ProLearn) : vert = point déjà jugé, cyan = point courant, bord = à venir.
            <div id="guide-progression" aria-hidden="true" style={{ flexGrow: 1, display: "flex", gap: 4 }}>
              {scenario.etapes.map((e, i) => (
                <span
                  key={e.id}
                  style={{
                    flex: 1, height: 4, borderRadius: 2,
                    background: prog.verdicts[e.id] ? C.vert : i === prog.index ? C.cyan : C.bord,
                  }}
                />
              ))}
            </div>
          )}
          {/* Menu « ⋯ » (design validé 1ddbc6f) : regroupe les commandes auparavant en
              icônes séparées — mêmes actions, même sémantique, ids conservés. */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              id="guide-menu"
              onClick={() => setMenuOuvert((o) => !o)}
              aria-label="Menu du guide"
              aria-haspopup="true"
              aria-expanded={menuOuvert}
              style={menuBtnStyle}
            >⋯</button>
            {menuOuvert && (
              <div id="guide-menu-panel" role="menu" style={menuPanelStyle}>
                {/* Le curseur animé ne joue le geste qu'une fois (`prog.joues`) — cette entrée
                    permet de le REJOUER à la demande, par ex. après correction de la cible. */}
                {aGestes && !ecranBilan && (
                  <button id="guide-rejouer" role="menuitem" onClick={rejouerGeste} style={menuItemStyle}>
                    Rejouer le geste
                  </button>
                )}
                {/* La visite reprend là où elle s'est arrêtée : sans cette entrée, rejouer un
                    scénario déjà terminé (après correction d'un point) serait impossible. */}
                <button
                  id="guide-recommencer"
                  role="menuitem"
                  onClick={() => { setMenuOuvert(false); maj(vide(scenario.id)); }}
                  style={menuItemStyle}
                >Recommencer depuis le début</button>
                {/* Replier ≠ Fermer (tâche 11) : replier garde la visite ACTIVE (la pastille la
                    rouvre, y compris après un changement de page) ; fermer efface la persistance
                    de session — sans cette distinction, impossible de quitter le guide pour de
                    bon, ou impossible de le reprendre en changeant de page. Deux entrées
                    distinctes, volontairement, même si leur effet se ressemble aujourd'hui :
                    elles portent une intention différente (cf. commentaires d'origine). */}
                <button
                  id="guide-replier"
                  role="menuitem"
                  onClick={() => { setMenuOuvert(false); onReplier(); }}
                  style={menuItemStyle}
                >Replier</button>
                <button
                  id="guide-fermer"
                  role="menuitem"
                  onClick={() => { setMenuOuvert(false); void guideInterrompu(scenario.id); onFermer(); }}
                  style={menuItemStyle}
                >Fermer</button>
              </div>
            )}
          </div>
        </header>

        {onChoisirAutre && (
          // « Il me faut un lien dans les guides pour revenir et choisir un autre guide »
          // (Mariella, 07/11) : visible, pas rangé dans le ⋯. La progression de CE guide est
          // gardée (localStorage) : le rechoisir le reprend où elle s'était arrêtée.
          <button
            id="guide-choisir-autre"
            onClick={() => { setMenuOuvert(false); onChoisirAutre(); }}
            style={{
              display: "block", minHeight: 44, margin: "-6px 0 4px", padding: 0,
              background: "none", border: "none", cursor: "pointer",
              color: C.cyan, font: "600 13px/1.2 var(--font-sans, var(--sans, system-ui, sans-serif))",
              textAlign: "left", textDecoration: "underline",
            }}
          >&larr; Choisir un autre guide</button>
        )}

        <strong style={{ display: "block", marginBottom: 10, fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>
          {etape.titre}
        </strong>

        {onAllerAuBonEndroit && !ecranBilan ? (
          // Porté de Prolearn (commit 958ecde2, demande Mariella 31/10) : pas la bonne page,
          // ou zone introuvable avec une destination connue — l'y conduire plutôt que de
          // laisser chercher une zone qui ne peut pas être là.
          <div id="guide-pas-au-bon-endroit" style={{
            display: "flex", flexDirection: "column", gap: 10, marginBottom: 8,
            padding: 12, borderRadius: 10, background: C.orangeFond, border: `1px solid ${C.orangeBord}`,
          }}>
            <span style={{ color: C.orangeTexte, fontSize: 13, fontWeight: 600 }}>
              Tu n&rsquo;es pas au bon endroit pour ce point.
            </span>
            <button
              id="guide-aller-au-bon-endroit"
              onClick={onAllerAuBonEndroit}
              style={{
                height: 44, borderRadius: 10, border: "none",
                background: C.cyan, color: C.cyanTexte,
                font: "600 14px/1 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
              }}
            >M&rsquo;emmener au bon endroit</button>
          </div>
        ) : !trouvee && !gesteOk && !ecranBilan && (
          // b47 : une zone retirée par le geste lui-même (fermer une boîte) n'est pas
          // « introuvable » : le geste a réussi, l'alerte serait un faux problème.
          // Invariant 2 : ne JAMAIS laisser croire que la zone encadrée est la bonne quand
          // elle est introuvable — le dire est le minimum honnête.
          <p style={{
            margin: "0 0 8px", padding: "6px 8px", borderRadius: 6,
            background: C.koSoft, color: C.ko, fontSize: 12,
          }}>
            La zone décrite n&rsquo;est pas visible sur cette page, la consigne reste
            valable, mais rien n&rsquo;est encadré.
          </p>
        )}

        {gesteRaison && !ecranBilan && (
          // Invariant 2, même esprit que ci-dessus : le geste automatique a échoué, on ne
          // prétend jamais qu'il a réussi. Mariella juge le point elle-même (✓/✗ ci-dessous).
          <div style={{
            margin: "0 0 9px", padding: "8px 9px", borderRadius: 6,
            background: C.orangeFond, border: `1px solid ${C.orangeBord}`, color: C.orangeTexte,
          }}>
            <p style={{ margin: "0 0 7px", fontSize: 12 }}>
              Le geste automatique a échoué : {gesteRaison}. Juge le point toi-même.
            </p>
            <button
              id="guide-reessayer-geste"
              onClick={rejouerGeste}
              style={{ ...btn, borderColor: C.orangeBord, color: C.orangeTexte }}
            >Réessayer le geste</button>
          </div>
        )}

        {!ecranBilan && (
          <>
            {/* Bandeau « J'ai fait le geste pour toi » (design validé) — remplace le texte
                de la consigne quand le geste automatique a réussi : rien à faire, juste à
                juger le résultat (✓/✗ ci-dessous). */}
            {gesteOk ? (
              <p id="guide-geste-ok" style={{
                margin: "0 0 9px", padding: "8px 9px", borderRadius: 8,
                background: C.cyanFond, color: C.cyanDoux, fontSize: 12.5, fontWeight: 500,
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <span aria-hidden="true">✓</span>
                J&rsquo;ai fait le geste pour toi
              </p>
            ) : (
              <p style={{ margin: "0 0 9px" }}>{etape.action}</p>
            )}
            <div style={{
              margin: "0 0 12px", padding: "10px 11px", borderRadius: 8,
              background: C.fondProfond, border: `1px solid ${C.bordClair}`,
            }}>
              <div style={{
                font: "600 10.5px/1 var(--font-sans, var(--sans, system-ui, sans-serif))",
                letterSpacing: ".08em", color: C.tresDoux,
              }}>
                TU DOIS VOIR
              </div>
              <p id="guide-attendu" style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.45, color: C.texte }}>
                {etape.attendu}
              </p>
            </div>
          </>
        )}

        {ecranBilan ? (
          // Écran de clôture — décision Mariella 2026-07-25 : répondre à tous les points
          // VAUT sa validation, elle n'a pas à la redonner à la main. Ce bilan reste un
          // CONFORT DE LECTURE affiché à l'écran : le texte COPIÉ ci-dessous, lui, ne porte
          // jamais de conclusion (cf. guide-compte-rendu.ts) — round de correction 1.
          <div>
            <p id="guide-bilan-titre" style={{
              margin: "0 0 9px", padding: "7px 9px", borderRadius: 6,
              background: bilan.statut === "valide" ? C.okSoft : C.koSoft,
              color: bilan.statut === "valide" ? C.ok : C.ko, fontWeight: 500,
            }}>
              {bilan.statut === "valide"
                ? `C'est fini, tout est bon · ${bilan.total} sur ${bilan.total}`
                : `⚠️ ${bilan.total - bilan.ko.length}/${bilan.total} conformes : ${bilan.ko.length} à revoir.`}
            </p>
            {bilan.statut === "a-revoir" && (
              <ul style={{ margin: "0 0 10px", paddingLeft: 16, color: C.doux }}>
                {bilan.ko.map((k) => (
                  <li key={k.id} style={{ marginBottom: 4 }}>
                    <button
                      onClick={() => {
                        const i = indexDePoint(scenario.etapes, k.id);
                        if (i !== null) { setEcranBilan(false); maj({ ...prog, index: i }); }
                      }}
                      style={{ ...btn, padding: "2px 6px", borderColor: C.ko, color: C.ko }}
                    >{k.titre}</button>
                  </li>
                ))}
              </ul>
            )}

            <p id="guide-envoi-etat" role="status" style={{
              margin: "0 0 8px", fontWeight: envoi === "envoi" ? 400 : 500,
              color: envoi === "envoye" ? C.ok : envoi === "echec" ? C.ko : C.doux,
            }}>
              {envoi === "envoye"
                ? "✓ Envoyé à ta session, tu n'as rien à faire."
                : envoi === "envoi"
                  ? "Envoi à ta session…"
                  : "Pas pu envoyer à ta session."}
            </p>
            {envoi === "echec" && (
            <>
            <button
              id="guide-renvoyer"
              type="button"
              onClick={renvoyer}
              style={{ ...btn, width: "100%", marginBottom: 8, borderColor: C.accent, color: C.accent }}
            >
              Réessayer
            </button>
            <p style={{ margin: "0 0 6px", color: C.doux, fontSize: 11.5 }}>
              En dernier recours : copie le compte-rendu et colle-le dans le chat.
            </p>
            <button
              id="guide-copier-compte-rendu"
              type="button"
              onClick={copierCompteRendu}
              style={{ ...btn, width: "100%", marginBottom: 8, borderColor: C.accent, color: C.accent }}
            >
              {etatCopie === "ok" ? "✓ Copié dans le presse-papier" : "Copier le compte-rendu"}
            </button>
            {etatCopie === "echec" && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ margin: "0 0 4px", color: C.ko, fontSize: 11.5 }}>
                  La copie automatique a échoué, sélectionne le texte ci-dessous et
                  copie-le à la main (Ctrl+C / Cmd+C).
                </p>
                <textarea
                  id="guide-compte-rendu-secours"
                  ref={secoursRef}
                  readOnly
                  value={texteCompteRendu}
                  onFocus={(e) => e.currentTarget.select()}
                  rows={Math.min(10, scenario.etapes.length + 2)}
                  style={{
                    width: "100%", boxSizing: "border-box", resize: "vertical",
                    background: "rgba(0,0,0,.25)", color: C.texte,
                    border: `1px solid ${C.bord}`, borderRadius: 6, padding: 7,
                    font: "400 11.5px/1.4 var(--font-sans, var(--sans, system-ui, sans-serif))",
                  }}
                />
              </div>
            )}
            </>
            )}

            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setEcranBilan(false)} style={{ ...btn, color: C.doux }}>
                Revoir les points
              </button>
              {/* Clôture définitive : efface la clé de session ET la progression de ce
                  scénario (05/08). Elle a copié son compte-rendu, la visite est finie — la
                  garder en mémoire ferait rouvrir un bilan déjà rendu à la prochaine
                  livraison, au lieu des points neufs. */}
              <button id="guide-terminer" onClick={terminer} style={{ ...btn, flex: 1 }}>
                Terminer et effacer
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Boutons de verdict pleins, 56 px (design validé 1ddbc6f, mêmes valeurs que
                ProLearn) — remplacent les anciens « ✓ Ça marche » / « ✗ Ça ne va pas ». */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              <button
                onClick={() => noter("ok")}
                style={{
                  height: 56, borderRadius: 10, border: "none",
                  background: C.vert, color: C.vertTexte,
                  font: "600 15px/1 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
                }}
              >Oui, je le vois</button>
              <button
                onClick={() => noter("ko")}
                style={{
                  height: 56, borderRadius: 10, border: `2px solid ${C.orange}`,
                  background: "transparent", color: C.orangeTexte,
                  font: "600 15px/1 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
                }}
              >Non, pas ça</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <button
                onClick={() => maj(reculer(prog))}
                disabled={prog.index === 0}
                aria-label="Point précédent"
                style={{ ...btn, border: "none", opacity: prog.index === 0 ? .35 : 1, color: C.doux }}
              >← Précédent</button>
              <button
                onClick={() => maj(avancer(prog, total))}
                disabled={prog.index >= total - 1}
                aria-label="Point suivant"
                style={{ ...btn, border: "none", opacity: prog.index >= total - 1 ? .35 : 1, color: C.doux }}
              >Suivant →</button>
            </div>
          </>
        )}

        {motifActif && !ecranBilan && (
          // Posé APRÈS le "ko" (cf. `noter`) — facultatif : Mariella peut valider sans rien
          // écrire, le verdict est déjà acquis, ce champ ne fait qu'ajouter un détail.
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input
              id="guide-motif"
              type="text"
              value={motifSaisie}
              onChange={(e) => setMotifSaisie(e.target.value)}
              placeholder="Motif de l'écart (facultatif)"
              style={{
                flex: 1, padding: "6px 8px", borderRadius: 6,
                border: `1px solid ${C.bord}`, background: "transparent", color: C.texte,
                font: "400 12px/1.3 var(--font-sans, var(--sans, system-ui, sans-serif))",
              }}
            />
            <button
              id="guide-motif-confirmer"
              onClick={confirmerMotif}
              style={{ ...btn, borderColor: C.ko, color: C.ko }}
            >Valider</button>
          </div>
        )}

        {v && !ecranBilan && (
          <p style={{ margin: "8px 0 0", fontSize: 11.5, color: v === "ok" ? C.ok : C.ko }}>
            {v === "ok" ? "✓ noté comme conforme" : "✗ noté comme à revoir"}
          </p>
        )}

        {/* Pied de bulle : la remise à zéro de TOUTES les visites. Visible sur les deux écrans
            (étape et bilan) — c'est justement quand un guide rouvre sur des réponses périmées
            qu'on cherche ce bouton, et attendre le bilan pour l'atteindre supposerait de
            re-répondre à tout d'abord. */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.bord}`, textAlign: "right" }}>
          {resetFait ? (
            <span id="guide-reset-fait" style={{ fontSize: 11, color: C.ok }}>
              ✓ Toutes les visites sont remises à zéro
            </span>
          ) : resetADemander ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <button
                id="guide-reset-annuler"
                onClick={() => setResetADemander(false)}
                style={{ ...btn, padding: "3px 7px", fontSize: 11, color: C.doux }}
              >Annuler</button>
              <button
                id="guide-reset-confirmer"
                onClick={remettreTousLesGuidesAZero}
                style={{ ...btn, padding: "3px 7px", fontSize: 11, borderColor: C.ko, color: C.ko }}
              >Effacer toutes les réponses</button>
            </span>
          ) : (
            <button
              id="guide-reset-tout"
              onClick={() => setResetADemander(true)}
              title="Efface les réponses de TOUTES les visites, pas seulement celle-ci"
              style={{ ...btn, padding: "3px 7px", fontSize: 11, border: "none", color: C.doux }}
            >Remettre tous les guides à zéro</button>
          )}
        </div>
      </section>
    </div>
  );
}

/** Base commune des boutons de la bulle (styles inline — cf. en-tête du fichier). */
const btn: CSSProperties = {
  padding: "6px 10px", borderRadius: 6,
  border: `1px solid ${C.bord}`, background: "transparent", color: C.texte,
  font: "500 12.5px/1 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
};

/** Bouton « ⋯ » du menu (design validé) — déclenche `#guide-menu-panel`. */
const menuBtnStyle: CSSProperties = {
  width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: 6, border: `1px solid ${C.bord}`, background: "transparent", color: C.doux,
  fontSize: 16, lineHeight: 1, cursor: "pointer",
};
/** Panneau du menu « ⋯ » — ancré sous le bouton, jamais hors écran côté droit (right: 0). */
const menuPanelStyle: CSSProperties = {
  position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 1,
  minWidth: 190, display: "flex", flexDirection: "column", gap: 2,
  padding: 4, borderRadius: 8, border: `1px solid ${C.bord}`,
  background: C.fond, boxShadow: "0 10px 30px rgba(0,0,0,.5)",
};
/** Une entrée du menu « ⋯ ». */
const menuItemStyle: CSSProperties = {
  textAlign: "left", padding: "7px 9px", borderRadius: 6,
  border: "none", background: "transparent", color: C.texte,
  font: "400 12.5px/1.3 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
};
