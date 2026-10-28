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
 * 5. rien ne se monte tant qu'un `?guide=<id>` explicite ET VALIDE n'a pas été vu au moins
 *    une fois dans cet onglet, sur cette origine — voir la note ci-dessous.
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
 * ⚠️ Adaptation MiamBoost à l'invariant 5 : la version Prolearn se garde AUSSI par
 * `process.env.NODE_ENV === 'production'`, et propose un bouton d'ouverture dès qu'une
 * page correspond au `match` d'un scénario, MÊME sans `?guide=`. Les deux sont inadaptés
 * ici : MiamBoost n'a pas de séparation prod/préprod par variable d'environnement — la
 * préprod PUBLIQUE (servie par `miamboost-workers`, vue par de vrais convives sur
 * `<slug>.miamboost.com`) est buildée par `next build`, donc NODE_ENV=production comme une
 * vraie prod. Le seul garde-fou qui tienne est donc purement STRUCTUREL : aucune recherche
 * de scénario par URL courante, uniquement par un paramètre `?guide=<id>` explicite — un
 * convive ne le tapera jamais. D'où l'absence de `usePathname()`/`match` ici (cf.
 * src/lib/guide/types.ts).
 *
 * ⚠️ Tâche 11 — CE COMPOSANT NE RÉSOUT PLUS LUI-MÊME LE SCÉNARIO. `scenario` arrive en
 * PROP, déjà résolu par `GuideDeTestLazy` via `resoudreVisite()` (`@/lib/guide/guide-
 * visite.ts`), seule porte qui sait combiner `?guide=` ET la clé de `sessionStorage` (la
 * persistance qui permet à la visite de survivre à un changement de page). Une seule
 * résolution, à un seul endroit : ce fichier n'a donc AUCUN chemin qui monterait un
 * scénario par lui-même, y compris à partir d'un stockage forgé à la main — il ne lit
 * même plus `sessionStorage`.
 *
 * ⚠️ Ce que ce fichier NE PORTE PAS de Prolearn : l'écriture automatique des retours dans
 * `.planning/retours-tests.md` (guide-feedback.ts côté Prolearn, `'use server'` +
 * `node:fs/promises`). MiamBoost sert sa préprod publique via `miamboost-workers.service`
 * (workerd / OpenNext-Cloudflare, cf. wrangler.jsonc) et non via un process Node classique :
 * un Worker Cloudflare n'a pas accès en écriture au système de fichiers de la machine hôte,
 * `node:fs` sur un chemin réel n'y fonctionnerait pas malgré `nodejs_compat`. Porter ce
 * fichier tel quel aurait donc COMPILÉ mais échoué en silence relatif (erreur affichée,
 * jamais écrite) sur l'environnement réellement servi — signalé au contrôleur en même temps
 * que ce rapport plutôt que tranché seul. Ici, les verdicts ✓/✗ restent LOCAUX (progression
 * dans localStorage, bilan calculé côté client) : Mariella les voit sur la page pendant sa
 * visite, et les relaie dans le chat comme aujourd'hui pour qu'ils atterrissent dans
 * `.planning/retours-tests.md`.
 * ============================================================================== */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { placeBubble, resolveTarget, type Rect } from "@/lib/guide/guide-geometry";
import {
  accederLocalStorage, avancer, chargerProgression, marquerJoue, noterMotif, oublierProgression,
  oublierToutesLesProgressions, reculer, sauverProgression, verdict, vide,
} from "@/lib/guide/guide-progress";
import { indexDePoint, SCENARIOS } from "@/lib/guide/scenarios";
import { verdictScenario } from "@/lib/guide/guide-verdict";
import { construireCompteRendu } from "@/lib/guide/guide-compte-rendu";
import { corpsEnvoi, dejaEnvoye, envoyerResultat, marquerEnvoye } from "@/lib/guide/guide-envoi";
import { accederSessionStorage, type InfosEnvoi } from "@/lib/guide/guide-visite";
import { GuideCurseur } from "./GuideCurseur";
import type { ResultatGeste } from "@/lib/guide/guide-geste";
import type { GuideScenario, GuideProgress } from "@/lib/guide/types";

const BULLE: { w: number; h: number } = { w: 360, h: 250 };
const Z = 2147483000; // au-dessus de tout : la page a des overlays à z-index élevé (max mesuré : 1000)

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
const C = {
  fond: "var(--surface-inverse, #2A2724)",
  bord: "#403A31", // --line-strong (thème sombre)
  texte: "#F3EEE6", // --ink (thème sombre)
  doux: "#B8B0A4", // --ink-soft (thème sombre)
  accent: "#54C98A", // --accent (thème sombre)
  ok: "#A9DCBD", // --ok-ink (thème sombre)
  okSoft: "#1C2A21", // --ok-soft (thème sombre)
  ko: "#EDB0A2", // --danger-ink (thème sombre)
  koSoft: "#2E1C18", // --danger-soft (thème sombre)
};

export function GuideDeTest({
  scenario,
  envoi,
  onFermerDefinitivement,
}: {
  /** Déjà résolu par `GuideDeTestLazy` (`resoudreVisite`) — jamais recalculé ici. */
  scenario: GuideScenario;
  /** Déjà résolu par `GuideDeTestLazy` (`resoudreEnvoi`) — `null` si aucune session
   *  d'envoi n'est active (reprise sans paramètres, ou paramètres invalides). */
  envoi: InfosEnvoi | null;
  /** Efface la persistance de session ET synchronise `GuideDeTestLazy` — appelé
   *  UNIQUEMENT par le ✕ « Fermer le guide », jamais par « Replier ». */
  onFermerDefinitivement: () => void;
}) {
  const params = useSearchParams();
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
          envoi={envoi}
          point={params.get("point")}
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
  return (
    <div
      id="guide-pastille"
      style={{
        position: "fixed", right: 16, bottom: 16, zIndex: Z,
        display: "flex", alignItems: "stretch",
        borderRadius: 999, border: `1px solid ${C.bord}`, background: C.fond,
        boxShadow: "0 6px 24px rgba(0,0,0,.45)", overflow: "hidden",
      }}
    >
      <button
        id="guide-ouvrir"
        onClick={onOpen}
        title={`${scenario.etapes.length} points à vérifier — ${scenario.titre}`}
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
        aria-label="Quitter le guide de test"
        title="Quitter le guide (il ne réapparaîtra plus dans cet onglet)"
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

function Visite({ scenario, envoi, point, onReplier, onFermer, onTerminer }: {
  scenario: GuideScenario;
  /** Session d'envoi active, ou `null` — cf. `GuideDeTest` ci-dessus. */
  envoi: InfosEnvoi | null;
  /** Étape à ouvrir d'emblée (`?point=<stepId>`) — pour faire re-vérifier UN point corrigé. */
  point: string | null;
  /** Replier : la pastille reste, la visite CONTINUE (session intacte). */
  onReplier: () => void;
  /** Fermer : tout s'efface (session) — un dispositif dont on ne peut pas sortir serait
   *  pire que pas de dispositif (cf. brief tâche 11, étape 3). */
  onFermer: () => void;
  /** Sortie DÉFINITIVE depuis le bilan (efface la clé de session) — distincte de `onFermer`,
   *  qui ne fait que replier vers la pastille. */
  onTerminer: () => void;
}) {
  const [prog, setProg] = useState<GuideProgress>(() => vide(scenario.id));
  const [cible, setCible] = useState<Rect | null>(null);
  const [trouvee, setTrouvee] = useState(true);
  // Taille RÉELLE de la bulle (invariant 3) : la supposer serait une erreur de placement
  // garantie, le texte des étapes varie d'un point à l'autre.
  const bulleRef = useRef<HTMLElement | null>(null);
  const [tailleBulle, setTailleBulle] = useState(BULLE);
  const [ecranBilan, setEcranBilan] = useState(false);
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

  // Motif d'un "ko" — champ posé APRÈS avoir noté "ko" (cf. `noter` plus bas), jamais avant :
  // le verdict est acquis dès le clic, le motif n'est qu'un détail optionnel qui s'y ajoute.
  const [motifActif, setMotifActif] = useState(false);
  const [motifSaisie, setMotifSaisie] = useState("");

  // Envoi automatique du résultat au bilan — "idle" tant que le bilan n'est pas affiché (ou
  // qu'aucune session d'envoi n'est active), puis "envoi" → "ok"/"echec". Le bouton Copier
  // reste dans tous les cas le filet de sécurité (cf. bandeau de `guide-envoi.ts`).
  const [etatEnvoi, setEtatEnvoi] = useState<"idle" | "envoi" | "ok" | "echec">("idle");

  // Reprise « là où elle s'est arrêtée » — lue APRÈS montage (localStorage n'existe pas
  // au rendu serveur).
  const [charge, setCharge] = useState(false);
  useEffect(() => {
    // Les IDS, pas le nombre d'étapes : c'est ce qui permet à `chargerProgression` de rouvrir
    // sur le premier point SANS RÉPONSE quand le scénario a gagné des points depuis la
    // dernière visite (défaut du 05/08 : « j'ai pas les nouveaux points du guide »).
    const p = chargerProgression(scenario.id, accederLocalStorage(), scenario.etapes.map((e) => e.id));
    // `?point=` a la priorité sur la reprise : le lien désigne explicitement l'étape à
    // revoir. Étape inconnue → on garde la reprise plutôt que de pointer au hasard.
    // Nommée `indexVise` (et non `cible`, qui désigne ailleurs le `Rect` surligné) pour ne
    // pas masquer l'état `cible`/`setCible` déclaré juste au-dessus.
    const indexVise = indexDePoint(scenario.etapes, point);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reprise lue dans localStorage après montage, cf. bandeau de tête
    setProg(indexVise === null ? p : { ...p, index: indexVise });
    setCharge(true);
  }, [scenario.id, scenario.etapes, point]);

  const etape = scenario.etapes[Math.min(prog.index, scenario.etapes.length - 1)];
  const total = scenario.etapes.length;
  const bilan = verdictScenario(scenario.etapes, prog.verdicts);

  // Bascule sur le bilan dès que tous les points ont une réponse (décision Mariella
  // 2026-07-25, portée telle quelle : répondre à tous les points VAUT sa validation).
  useEffect(() => {
    // Rien avant que la progression soit LUE : au premier rendu elle est vide, donc
    // « en-cours », et son chargement passerait pour une complétion.
    if (!charge) return;
    if (bilan.statut === "en-cours") {
      // Retour à une visite incomplète (elle a cliqué ↻) : refermer le récapitulatif.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bascule du bilan sur progression relue, cf. bandeau de tête
      setEcranBilan(false);
      return;
    }
    // À l'ouverture, ne pas imposer le bilan si un `?point=` est visé : ce lien exprime
    // l'intention de revoir CE point, l'écraser le rendrait inutilisable. Sinon, l'afficher.
    if (!point) setEcranBilan(true);
  }, [charge, bilan.statut, point]);

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

  // Envoi automatique au bilan, UNE SEULE FOIS par session (`dejaEnvoye`, sessionStorage —
  // cf. guide-envoi.ts) — jamais à la place du bouton Copier, en complément : un échec
  // réseau laisse `etatEnvoi` à "echec" et le bouton Copier reste disponible juste au-dessus.
  //
  // Dépendances sur les CHAMPS de `envoi` (pas l'objet) : `envoi` est recalculé à chaque
  // rendu par `resoudreEnvoi` (GuideDeTestLazy.tsx) — une dépendance sur sa référence
  // réexécuterait cet effet à CHAQUE rendu du layout parent, et retenterait l'envoi à
  // chaque échec. `prog` n'est volontairement PAS en dépendance : les verdicts envoyés sont
  // ceux au moment où le bilan s'affiche ; revenir sur un point puis rouvrir le bilan (donc
  // repasser `ecranBilan` par `false` puis `true`) relit `prog` à ce moment-là, via la
  // fermeture de l'effet — c'est `ecranBilan` qui porte le redéclenchement, pas `prog`.
  useEffect(() => {
    if (!ecranBilan || !envoi) return;
    const storage = accederSessionStorage();
    if (dejaEnvoye(storage, scenario.id)) {
      setEtatEnvoi("ok");
      return;
    }
    let annule = false;
    setEtatEnvoi("envoi");
    (async () => {
      const corps = corpsEnvoi(scenario, prog, envoi.jeton);
      const r = await envoyerResultat(envoi.poste, envoi.projet, corps);
      if (annule) return;
      if (r.ok) {
        marquerEnvoye(storage, scenario.id);
        setEtatEnvoi("ok");
      } else {
        setEtatEnvoi("echec");
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cf. commentaire ci-dessus : `prog`/`envoi` volontairement hors deps
  }, [ecranBilan, envoi?.jeton, envoi?.poste, envoi?.projet, scenario.id]);

  // Suivi de la cible : elle bouge (défilement, changement d'état après une bascule).
  // Une boucle d'animation plutôt que des écouteurs : le DOM change ici pour des raisons
  // qu'aucun événement ne signale (React qui rerend l'arbre après un fetch).
  useEffect(() => {
    let raf = 0;
    let dernier = "";
    const tick = () => {
      const el = resolveTarget(etape.cibles ?? [], document);
      const r = el
        ? (({ x, y, width, height }) => ({ x, y, w: width, h: height }))(el.getBoundingClientRect())
        : null;
      const cle = r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}` : "null";
      const b = bulleRef.current?.getBoundingClientRect();
      const cleB = b ? `${Math.round(b.width)}x${Math.round(b.height)}` : "";
      if (cle + cleB !== dernier) {
        dernier = cle + cleB;
        setCible(r);
        setTrouvee(!(etape.cibles?.length) || !!el);
        if (b) setTailleBulle({ w: Math.round(b.width), h: Math.round(b.height) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [etape]);

  // Amener la zone à l'écran au changement d'étape — sinon la bulle parle d'une ligne
  // que Mariella ne voit pas.
  useEffect(() => {
    const el = resolveTarget(etape.cibles ?? [], document);
    // `inline: 'nearest'` explicite : aucun défilement HORIZONTAL provoqué par le guide.
    el?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [etape]);

  // Curseur animé : à l'entrée d'une étape qui porte un geste ET ne l'a pas déjà joué
  // (`prog.joues`), on le montre automatiquement — une étape déjà jouée (retour arrière,
  // bilan qui saute à un point) ne le rejoue QUE si Mariella clique « Rejouer » (ci-dessous).
  // Clé dépendante d'`etape.id` SEUL (volontairement) : relire `prog.joues` à chaque frappe
  // de `prog` (un motif saisi, un autre verdict…) n'a aucune raison de redéclencher quoi que
  // ce soit — seul un changement d'ÉTAPE doit décider de montrer ou non le curseur.
  useEffect(() => {
    setGesteRaison(null);
    setMotifActif(false);
    setMotifSaisie("");
    if (etape.geste && !prog.joues?.includes(etape.id)) {
      setCurseurVisible(true);
      setCurseurCle((c) => c + 1);
    } else {
      setCurseurVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un seul passage par ÉTAPE, cf. commentaire ci-dessus
  }, [etape.id]);

  // ⚠️ Invariant 4 : Échap ne ferme PAS la visite. Aucun `onKeyDown` ici, volontairement —
  // en ajouter un pour intercepter Échap casserait le test qu'elle sert justement à faire.

  const pos = placeBubble(cible, tailleBulle, { w: window.innerWidth, h: window.innerHeight });
  const v = prog.verdicts[etape.id];

  const noter = (val: "ok" | "ko") => {
    const p = verdict(prog, etape.id, val);
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
    setGesteRaison(resultat.ok ? null : (resultat.raison ?? "le geste a échoué"));
  };

  /** Bouton « Rejouer » (#guide-rejouer) : repasse le curseur, QUOI QUE `prog.joues` dise —
   *  `curseurCle` force un remontage de `GuideCurseur`, dont la garde anti-double-jeu
   *  (`dejaJoue`) ne concerne qu'UN montage, jamais les montages suivants. */
  const rejouerGeste = () => {
    setGesteRaison(null);
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
            border: `2px solid ${C.accent}`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,.55)",
            pointerEvents: "none",
            transition: "top .12s ease, left .12s ease, width .12s ease, height .12s ease",
          }}
        />
        );
      })()}

      {curseurVisible && etape.geste && !ecranBilan && (
        <GuideCurseur
          key={`${etape.id}:${curseurCle}`}
          depart={{ x: pos.left + tailleBulle.w / 2, y: pos.top + tailleBulle.h / 2 }}
          geste={etape.geste}
          ciblesRepli={etape.cibles ?? []}
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
          // `border-box` : sinon la largeur réelle inclut padding et bordure, et le
          // centrage horizontal est faux d'autant.
          position: "fixed", top: pos.top, left: pos.left, width: BULLE.w, boxSizing: "border-box",
          pointerEvents: "auto", // invariant 1 : seule la bulle capte les clics
          background: C.fond, color: C.texte,
          border: `1px solid ${C.bord}`, borderRadius: 10,
          boxShadow: "0 18px 50px rgba(0,0,0,.6)",
          font: "400 13px/1.5 var(--font-sans, var(--sans, system-ui, sans-serif))",
          padding: 14,
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: C.accent, fontSize: 11, fontWeight: 600, letterSpacing: ".06em" }}>
            {prog.index + 1}/{total}
          </span>
          <strong style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{etape.titre}</strong>
          {/* La visite reprend là où elle s'est arrêtée : sans ce bouton, rejouer un
              scénario déjà terminé (après correction d'un point) serait impossible. */}
          <button
            id="guide-recommencer"
            onClick={() => maj(vide(scenario.id))}
            aria-label="Recommencer depuis le premier point"
            title="Recommencer depuis le premier point"
            style={{ ...btn, padding: "2px 7px", color: C.doux }}
          >↻</button>
          {/* Le curseur animé ne joue le geste qu'une fois (`prog.joues`) — ce bouton permet
              de le REJOUER à la demande, par ex. après avoir corrigé la cible sur la page. */}
          {etape.geste && !ecranBilan && (
            <button
              id="guide-rejouer"
              onClick={rejouerGeste}
              aria-label="Rejouer le geste"
              title="Rejouer le geste automatique"
              style={{ ...btn, padding: "2px 7px", color: C.doux }}
            >▶</button>
          )}
          {/* Replier ≠ Fermer (tâche 11) : replier garde la visite ACTIVE (la pastille la
              rouvre, y compris après un changement de page) ; fermer efface la persistance
              de session — sans cette distinction, impossible de quitter le guide pour de
              bon, ou impossible de le reprendre en changeant de page. */}
          <button
            id="guide-replier"
            onClick={onReplier}
            aria-label="Replier le guide (la visite reste active)"
            title="Replier — la visite reste active"
            style={{ ...btn, padding: "2px 7px", color: C.doux }}
          >─</button>
          <button
            id="guide-fermer"
            onClick={onFermer}
            // Ne détruit plus rien (retour du 26/07) : aucun des deux boutons de cet en-tête
            // ne peut faire perdre la visite. Quitter pour de bon se fait sur la croix de la
            // pastille — un seul endroit, et c'est celui qu'on cherche quand on veut partir.
            aria-label="Fermer la bulle (la visite reste accessible par la pastille)"
            title="Fermer — la visite reste accessible par la pastille"
            style={{ ...btn, padding: "2px 7px", color: C.doux }}
          >✕</button>
        </header>

        {!trouvee && !ecranBilan && (
          // Invariant 2 : ne JAMAIS laisser croire que la zone encadrée est la bonne quand
          // elle est introuvable — le dire est le minimum honnête.
          <p style={{
            margin: "0 0 8px", padding: "6px 8px", borderRadius: 6,
            background: C.koSoft, color: C.ko, fontSize: 12,
          }}>
            La zone décrite n&rsquo;est pas visible sur cette page — la consigne reste
            valable, mais rien n&rsquo;est encadré.
          </p>
        )}

        {gesteRaison && !ecranBilan && (
          // Invariant 2, même esprit que ci-dessus : le geste automatique a échoué, on ne
          // prétend jamais qu'il a réussi. Mariella juge le point elle-même (✓/✗ ci-dessous).
          <p style={{
            margin: "0 0 8px", padding: "6px 8px", borderRadius: 6,
            background: C.koSoft, color: C.ko, fontSize: 12,
          }}>
            Le geste automatique a échoué : {gesteRaison}. Juge le point toi-même.
          </p>
        )}

        {!ecranBilan && (
          <>
            <p style={{ margin: "0 0 9px" }}>{etape.action}</p>
            <p style={{ margin: "0 0 12px", paddingLeft: 9, borderLeft: `2px solid ${C.bord}`, color: C.doux }}>
              <span style={{ color: C.texte, fontWeight: 500 }}>Attendu · </span>{etape.attendu}
            </p>
          </>
        )}

        {ecranBilan ? (
          // Écran de clôture — décision Mariella 2026-07-25 : répondre à tous les points
          // VAUT sa validation, elle n'a pas à la redonner à la main. Ce bilan reste un
          // CONFORT DE LECTURE affiché à l'écran : le texte COPIÉ ci-dessous, lui, ne porte
          // jamais de conclusion (cf. guide-compte-rendu.ts) — round de correction 1.
          <div>
            <p style={{
              margin: "0 0 9px", padding: "7px 9px", borderRadius: 6,
              background: bilan.statut === "valide" ? C.okSoft : C.koSoft,
              color: bilan.statut === "valide" ? C.ok : C.ko, fontWeight: 500,
            }}>
              {bilan.statut === "valide"
                ? `✅ ${bilan.total}/${bilan.total} conformes.`
                : `⚠️ ${bilan.total - bilan.ko.length}/${bilan.total} conformes — ${bilan.ko.length} à revoir.`}
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

            {envoi && (
              // Envoi automatique en complément du bouton Copier, jamais à sa place (cf.
              // bandeau de `guide-envoi.ts`) — un échec ("echec") laisse le bouton et son
              // repli disponibles juste en dessous.
              <p id="guide-envoi-etat" style={{
                margin: "0 0 8px", fontSize: 11.5,
                color: etatEnvoi === "ok" ? C.ok : etatEnvoi === "echec" ? C.ko : C.doux,
              }}>
                {etatEnvoi === "envoi" && "Envoi du résultat à la session en cours…"}
                {etatEnvoi === "ok" && "✓ Résultat envoyé à la session"}
                {etatEnvoi === "echec" && "Envoi impossible — copie le compte-rendu ci-dessous"}
              </p>
            )}

            <p style={{ margin: "0 0 8px", color: C.doux }}>
              Copie le compte-rendu ci-dessous, puis colle-le une fois dans le chat.
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
                  La copie automatique a échoué — sélectionne le texte ci-dessous et
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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => maj(reculer(prog))}
              disabled={prog.index === 0}
              aria-label="Point précédent"
              style={{ ...btn, opacity: prog.index === 0 ? .35 : 1, color: C.doux }}
            >←</button>
            <button onClick={() => noter("ok")} style={{ ...btn, borderColor: C.ok, color: C.ok, flex: 1 }}>
              ✓ Ça marche
            </button>
            <button onClick={() => noter("ko")} style={{ ...btn, borderColor: C.ko, color: C.ko, flex: 1 }}>
              ✗ Ça ne va pas
            </button>
            <button
              onClick={() => maj(avancer(prog, total))}
              disabled={prog.index >= total - 1}
              aria-label="Point suivant"
              style={{ ...btn, opacity: prog.index >= total - 1 ? .35 : 1, color: C.doux }}
            >→</button>
          </div>
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
