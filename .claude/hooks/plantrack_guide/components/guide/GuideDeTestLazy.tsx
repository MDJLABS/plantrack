"use client";

/* ==============================================================================
 * Point de montage LAZY du guide de test intégré (lot 2.3, revue finale, IMPORTANT 3 ;
 * persistance inter-pages, tâche 11 ; round de correction 1).
 *
 * `GuideDeTest.tsx` était importé STATIQUEMENT dans des layouts serveur (`(site)/layout.tsx`,
 * `(app)/layout.tsx`). Il ne *rend* rien sans `?guide=`, mais son code — ~42 Ko de source, plus
 * `guide-geometry`, `guide-progress`, `guide-verdict`, `guide-compte-rendu` — était TÉLÉCHARGÉ,
 * PARSÉ et MONTÉ (`useEffect` compris) sur le téléphone de CHAQUE convive visitant `/menu` : un
 * import statique finit dans le bundle client quoi qu'il arrive, que le composant rende `null`
 * ou non.
 *
 * `.claude/rules/guide-de-test.md` : « Aucun élément du guide ne doit être rendu, ni même
 * monté, en son absence. » `/menu` est la page la plus sensible à la latence du produit
 * (téléphone, réseau de restaurant) — un outil interne n'a rien à faire sur ce chemin.
 *
 * ⚠️ Nuance round de correction 1 (voir aussi `.claude/rules/guide-de-test.md` § « Persistance
 * inter-pages ») : `resoudreVisite` (`@/lib/guide/guide-visite.ts`) importe `scenarios.ts` (le
 * CATALOGUE des scénarios, ~8,2 Ko) — ce module-là EST chargé dans le bundle de `/menu`, parce
 * que c'est lui qui permet de décider s'il faut monter le guide. Ce qui reste hors bundle tant
 * qu'aucun `?guide=` valide n'a servi, c'est le CHUNK LOURD, `GuideDeTest.tsx` (~42 Ko de source,
 * plus `guide-geometry`/`guide-progress`/`guide-verdict`/`guide-compte-rendu`) : c'est lui que
 * `next/dynamic(..., { ssr: false })` ne déclenche qu'à l'instant où le composant qu'il enveloppe
 * est effectivement RENDU. Alléger encore (ne charger même pas le catalogue) demanderait une
 * liste d'identifiants séparée, dupliquée en parallèle de `getScenario` — précisément la
 * duplication qu'une porte unique évite ; l'essentiel du gain (le chunk le plus lourd, hors
 * bundle) reste acquis avec une seule garde à maintenir.
 *
 * ⚠️ Invariant 5, REFORMULÉ (tâche 11, jamais supprimé) : rien ne se monte tant qu'un
 * `?guide=<id>` explicite et VALIDE n'a pas été vu au moins une fois dans cet onglet, sur
 * cette origine. `resoudreVisite` est la SEULE porte, testée à part de tout DOM/React
 * (`tests/guide/visite.test.ts`) — elle réutilise `getScenario` (garde de classe), donc une
 * clé de `sessionStorage` FORGÉE à la main (`"constructor"`, `"__proto__"`, un identifiant
 * inconnu…) ne fait pas mieux qu'un `?guide=constructor` dans l'URL : le CHUNK LOURD n'est
 * jamais téléchargé, encore moins monté.
 *
 * ⚠️ Piège de build à ne pas rouvrir : `useSearchParams()` fait échouer `next build` sur toute
 * page prérendue non enveloppée d'une frontière `<Suspense>`. Les points de montage
 * (`(site)/layout.tsx` ×2, `(app)/layout.tsx`) restent dans `<Suspense fallback={null}>` — ne pas
 * la retirer en substituant ce composant à `GuideDeTest`.
 * ============================================================================== */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import {
  resoudreVisite, ecrireVisiteSession, effacerVisiteSession, lireVisiteSession,
  accederSessionStorage, type DecisionMontage,
} from "@/lib/guide/guide-visite";

const GuideDeTest = dynamic(
  () => import("@/components/guide/GuideDeTest").then((m) => m.GuideDeTest),
  { ssr: false },
);

export function GuideDeTestLazy() {
  const pathname = usePathname();
  const params = useSearchParams();
  const paramGuide = params.get("guide");

  // Le VRAI `sessionStorage` n'existe que côté client — au rendu SERVEUR (et à la toute
  // première passe client, avant hydratation), `hydrate` reste `false` : on retombe sur
  // `null`, ce qui revient à IGNORER une éventuelle reprise pour cette passe, jamais à en
  // fabriquer une. Un convive n'obtient donc jamais un rendu différent selon un stockage
  // qu'il ne maîtrise pas — le tout premier rendu client est IDENTIQUE au rendu serveur
  // (pas de faux positif d'hydratation).
  const [hydrate, setHydrate] = useState(false);
  // ⚠️ `react-hooks/set-state-in-effect` — DEUX tolérances motivées dans ce fichier (chantier
  // `react-hooks`), celle-ci et celle de `paramNeutralise` plus bas. Même raison que dans
  // `GuideDeTest.tsx` (bandeau de tête) : aucune n'est une resynchronisation depuis une prop, ce
  // sont des synchronisations avec des systèmes EXTÉRIEURS à React — l'hydratation ici, le routage
  // là. Ce composant vit dans le LAYOUT, monté une fois et jamais démonté : une `key` de parent,
  // remède habituel de ce chantier, n'a aucune prise sur lui.
  //
  // Celle-ci en particulier ne peut PAS devenir un initialiseur paresseux de `useState` : tout son
  // objet est que le premier rendu client soit IDENTIQUE au rendu serveur (`hydrate` faux des deux
  // côtés). Lire l'état d'hydratation pendant le rendu serait précisément le faux positif
  // d'hydratation que ce drapeau existe pour empêcher.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drapeau d'hydratation, cf. ci-dessus
  useEffect(() => setHydrate(true), []);

  // ✕ « Fermer le guide » (round de correction 1, IMPORTANT 2) : sur la page d'ARRIVÉE — le
  // cas le plus fréquent, puisque c'est juste après avoir cliqué le lien — `paramGuide` reste
  // présent dans l'URL après la fermeture. Sans neutralisation, `resoudreVisite` le
  // considérerait à nouveau comme une commande explicite au rendu suivant, et la bulle (ou au
  // moins la pastille) réapparaîtrait aussitôt : une sortie qui ne devient franche qu'après
  // une navigation n'est pas une sortie. `paramNeutralise` mémorise LA VALEUR neutralisée ;
  // une navigation (tout changement de `pathname`, même vers la page qu'on vient de fermer —
  // une nouvelle ARRIVÉE redonne sa valeur de commande explicite au paramètre) la réarme.
  const [paramNeutralise, setParamNeutralise] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- réarmement du paramètre sur navigation, cf. bandeau de `hydrate` ci-dessus
  useEffect(() => { setParamNeutralise(null); }, [pathname]);
  const paramEffectif = paramGuide !== null && paramGuide === paramNeutralise ? null : paramGuide;

  // `version` force un nouveau rendu de CE composant quand `sessionStorage` change SANS
  // navigation ni changement d'URL — seul cas où rien d'autre ne le déclencherait : fermer
  // une visite reprise SANS `?guide=` dans l'URL courante (rien dans les props/hooks de
  // routage ne bouge alors). `pathname` n'est lu que dans l'effet ci-dessus.
  const [version, setVersion] = useState(0);
  void version;

  // Ce composant vit dans le LAYOUT (monté une fois, jamais démonté d'une page à l'autre) :
  // une navigation client-side ne repasse plus par le serveur, donc APRÈS hydratation, lire
  // `sessionStorage` directement ICI (dans le corps du rendu, pas dans un effet différé) est
  // sûr — et surtout ÉVITE qu'une navigation démonte puis remonte le guide en deux passes
  // (un premier rendu avec une valeur de session encore périmée, suivi d'un second corrigé
  // par un effet).
  //
  // `accederSessionStorage()` (guide-visite.ts) enveloppe l'ACCÈS à `window.sessionStorage`
  // lui-même dans un `try` — round de correction 1, défaut critique n°1 : le GETTER peut
  // lever un `SecurityError` (iframe sandbox sans `allow-same-origin`, blocage des données de
  // site) AVANT même d'atteindre `lireVisiteSession`. `window.sessionStorage` n'est plus
  // référencé nulle part ailleurs dans ce fichier : les TROIS accès (lecture ci-dessous,
  // écriture dans l'effet, effacement dans `fermerDefinitivement`) passent tous par cette
  // seule fonction, jamais fatale.
  const sessionBrute = hydrate ? lireVisiteSession(accederSessionStorage()) : null;

  const decision: DecisionMontage = hydrate ? resoudreVisite(paramEffectif, sessionBrute) : null;

  // La clé de session ne s'écrit QUE lors d'une ouverture par paramètre explicite et
  // valide (`ecrireSession`, cf. guide-visite.ts) — aucune autre voie ne l'écrit.
  useEffect(() => {
    if (decision?.ecrireSession) ecrireVisiteSession(accederSessionStorage(), decision.scenario.id);
  }, [decision?.ecrireSession, decision?.scenario.id]);

  // Le ✕ « Fermer le guide » efface la clé, neutralise le paramètre EN COURS (s'il y en a
  // un) et force un nouveau rendu de CE composant, immédiatement — sortie franche sur la
  // page d'arrivée, sans attendre une navigation.
  const fermerDefinitivement = () => {
    effacerVisiteSession(accederSessionStorage());
    setParamNeutralise(paramGuide);
    setVersion((v) => v + 1);
  };

  // Invariant 5 : AUCUN scénario proposé — et ici, en amont, AUCUN chunk lourd du guide
  // chargé — sans `?guide=` valide vu au moins une fois dans cet onglet (directement, ou
  // porté par la clé de session qu'il a lui-même écrite).
  if (!decision) return null;
  return <GuideDeTest scenario={decision.scenario} onFermerDefinitivement={fermerDefinitivement} />;
}
