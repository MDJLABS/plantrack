"use client";
/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */

/* ==============================================================================
 * Point de montage LAZY du guide de test intégré (lot 2.3, revue finale, IMPORTANT 3 ;
 * persistance inter-pages, tâche 11 ; round de correction 1) — lanceur BAS-DROITE (d138,
 * 31/10 : « je veux voir quelle que soit la page, en bas à droite une liste de guides
 * encore à traiter. Ça ne fonctionne pas par lien, ça fonctionne par session »).
 *
 * `GuideDeTest.tsx` était importé STATIQUEMENT dans des layouts serveur (`(site)/layout.tsx`,
 * `(app)/layout.tsx`). Il ne *rend* rien sans un scénario choisi, mais son code — ~42 Ko de
 * source, plus `guide-geometry`, `guide-verdict`, `guide-compte-rendu` — serait TÉLÉCHARGÉ,
 * PARSÉ et MONTÉ sur l'appareil de CHAQUE visiteur si on l'importait sans passer par
 * `next/dynamic(..., { ssr: false })` : un import statique finit dans le bundle client quoi
 * qu'il arrive, que le composant rende `null` ou non. `GuideDeTest` n'est donc importé QUE
 * dynamiquement ci-dessous, et seulement monté une fois un scénario effectivement choisi.
 *
 * ⚠️ Rien n'est statiquement importé DEPUIS `GuideDeTest.tsx` dans ce fichier (pas même ses
 * jetons de couleur `C`) : un import statique d'UN SEUL export d'un fichier le ferait courir
 * le risque d'entraîner tout le module (et son 42 Ko) dans le bundle EAGER de chaque page —
 * exactement ce que `next/dynamic` sert à éviter. Les quelques couleurs nécessaires ici sont
 * donc DUPLIQUÉES volontairement (`COULEURS` ci-dessous, mêmes valeurs littérales que `C`
 * dans `GuideDeTest.tsx`) plutôt que partagées par import.
 *
 * ⚠️ Invariant 5, REFORMULÉ (d138, remplace l'ancien `?guide=`) : rien ne se monte — pas
 * même le panneau de liste — sans une session ADMIN du site, vérifiée CÔTÉ SERVEUR
 * (`etatGuides()`, `@/lib/guide/guide-actions.ts`, `'use server'`). `etatGuides()` rend
 * `null` hors session admin : ce composant ne distingue PAS « pas encore répondu » de
 * « pas admin » (les deux rendent `null`, donc rien), pour ne jamais faire clignoter le
 * lanceur chez un visiteur ordinaire pendant l'aller-retour réseau.
 *
 * `guide-visite.ts` (catalogue + accès `sessionStorage`) reste chargé dans le bundle EAGER
 * de chaque page — c'était déjà vrai de l'ancienne version (il fallait déjà `getScenario`
 * pour décider s'il fallait monter le guide), et c'est désormais aussi vrai de
 * `guide-progress.ts`/`guide-etat.ts` (guide actif, statuts) : la LISTE elle-même est
 * désormais visible sur chaque page (pas seulement après un `?guide=`), donc ce qui la
 * calcule doit l'être aussi. Point à surveiller côté poids de bundle (cf. rapport de
 * livraison) — ni `guide-progress.ts` ni `guide-etat.ts` n'importent quoi que ce soit de
 * lourd (modules purs, sans DOM), mais la bascule architecturale change ce qui est « eager »
 * par nature : avant, tout le confort du lanceur vivait DANS le chunk lourd ; maintenant,
 * une partie en sort pour pouvoir s'afficher sans scénario choisi.
 *
 * ⚠️ Piège de build HÉRITÉ, à vérifier (point resté incertain, cf. rapport de livraison) :
 * l'ancienne version utilisait `useSearchParams()`, qui impose une frontière `<Suspense>`
 * autour de ce composant dans les layouts de chaque site — ce composant ne l'utilise plus.
 * Retirer le `<Suspense>` des layouts est HORS PÉRIMÈTRE de ce chantier (moteur commun
 * uniquement, `/home/mariella/plantrack`) ; chaque site garde le sien tel quel pour
 * l'instant — inoffensif, juste potentiellement devenu superflu.
 * ============================================================================== */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { etatGuides, type EtatGuides } from "./guide-actions";
import { estEncoreATraiter } from "./guide-etat";
import { getScenario, accederSessionStorage } from "./guide-visite";
import { lireGuideActif, ecrireGuideActif, effacerGuideActif } from "./guide-progress";
import { useDecalageMenuBas } from "./guide-menu-bas";

const GuideDeTest = dynamic(
  () => import("./GuideDeTest").then((m) => m.GuideDeTest),
  { ssr: false },
);

/** Duplication VOLONTAIRE d'un sous-ensemble de `C` (`GuideDeTest.tsx`) — cf. bandeau de
 *  tête : jamais un import depuis ce fichier, pour ne pas entraîner son chunk lourd ici. */
const COULEURS = {
  fond: "var(--surface-inverse, #2A2724)",
  bord: "#403A31",
  texte: "#F3EEE6",
  doux: "#B8B0A4",
  accent: "#54C98A",
  ok: "#A9DCBD",
  okSoft: "#1C2A21",
  ko: "#EDB0A2",
  koSoft: "#2E1C18",
};

/** Garde de clé forgée pour `lireGuideActif` (`guide-progress.ts`) — un id qui ne résout à
 *  AUCUN scénario du catalogue courant (forgé, ou scénario retiré depuis) n'est jamais
 *  rendu actif. */
const estIdConnu = (id: string) => getScenario(id) !== null;

export function GuideDeTestLazy() {
  const pathname = usePathname();
  const menuBas = useDecalageMenuBas(); // b42 : le lanceur se pose au-dessus du menu du bas

  // Hydratation — même motif que `GuideDeTest.tsx` (bandeau de tête) : le tout premier
  // rendu client doit être identique au rendu serveur, `sessionStorage` n'existant pas
  // côté serveur.
  const [hydrate, setHydrate] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- drapeau d'hydratation, cf. ci-dessus
  useEffect(() => setHydrate(true), []);

  // Liste des guides (et leur statut), lue côté serveur — `null` tant qu'elle n'a pas
  // encore répondu OU que la session n'est pas admin : les deux cas se traitent
  // IDENTIQUEMENT (rien ne se monte), cf. invariant 5 du bandeau de tête. Relue à chaque
  // changement de page : un verdict posé ailleurs (son téléphone) doit se refléter ici
  // sans avoir à recharger l'onglet.
  const [etat, setEtat] = useState<EtatGuides | null>(null);
  // b44 : relue AUSSI dès qu'un guide est consigné (`relire`), sans attendre un changement
  // de page — la pastille « Guides à traiter » baisse tout de suite.
  const [relecture, setRelecture] = useState(0);
  useEffect(() => {
    let annule = false;
    void etatGuides().then((e) => {
      if (!annule) setEtat(e);
    });
    return () => {
      annule = true;
    };
  }, [pathname, relecture]);
  const relire = () => setRelecture((n) => n + 1);

  // `version` force un nouveau rendu après une écriture `sessionStorage` (choisir/fermer un
  // guide) qui ne passe par aucun changement de `pathname`/props.
  const [version, setVersion] = useState(0);
  void version;

  const [panneauOuvert, setPanneauOuvert] = useState(false);

  // `accederSessionStorage()` (guide-visite.ts) enveloppe l'ACCÈS lui-même dans un `try` —
  // le GETTER peut lever (iframe sandbox, blocage des données de site) avant même d'entrer
  // dans `lireGuideActif`.
  const storage = hydrate ? accederSessionStorage() : null;
  const guideActifId = hydrate ? lireGuideActif(storage, estIdConnu) : null;
  const itemActif = etat && guideActifId ? etat.find((g) => g.id === guideActifId) ?? null : null;
  // Résolu séparément (plutôt qu'un `!` non-null) : si le catalogue a changé entre l'appel
  // serveur et ce rendu, on retombe sur le panneau plutôt que de planter.
  const scenarioActif = itemActif ? getScenario(itemActif.id) : null;

  const choisir = (id: string) => {
    ecrireGuideActif(storage, id);
    setPanneauOuvert(false);
    setVersion((v) => v + 1);
  };

  const fermerDefinitivement = () => {
    effacerGuideActif(storage);
    setVersion((v) => v + 1);
  };

  // « Choisir un autre guide » (Mariella, 07/11) : sort du guide actif sans toucher à sa
  // progression, et rouvre directement la liste.
  const choisirAutre = () => {
    effacerGuideActif(storage);
    setPanneauOuvert(true);
    setVersion((v) => v + 1);
  };

  // Invariant 5 : hors session admin (ou réponse pas encore arrivée), rien ne se monte —
  // ni la liste, ni le chunk lourd du guide (importé seulement si un scénario est choisi).
  if (!etat) return null;

  if (itemActif && scenarioActif) {
    return (
      <GuideDeTest
        scenario={scenarioActif}
        verdictsServeur={itemActif.verdicts}
        corriges={itemActif.corriges}
        onFermerDefinitivement={fermerDefinitivement}
        onChoisirAutre={choisirAutre}
        onTermine={relire}
      />
    );
  }

  const aTraiter = etat.filter((g) => estEncoreATraiter(g.statut));
  // Checker v2 : un guide dont tout le reste est bloqué n'a rien à jouer ; il attend la
  // session. Distinct de « à reprendre » (il y a de quoi jouer maintenant).
  const aReprendre = aTraiter.filter((g) => !g.enAttente);
  const enAttente = aTraiter.filter((g) => g.enAttente);

  return (
    <div id="guide-lanceur" style={{ position: "fixed", right: 16, bottom: 16 + menuBas, zIndex: 2147483000 }}>
      {panneauOuvert && (
        <div
          id="guide-lanceur-panneau"
          style={{
            marginBottom: 8, width: 280, maxHeight: 360, overflowY: "auto",
            borderRadius: 10, border: `1px solid ${COULEURS.bord}`, background: COULEURS.fond,
            boxShadow: "0 6px 24px rgba(0,0,0,.45)", padding: 8,
          }}
        >
          {/* b44 : seuls les guides RESTANTS — un guide fini sort de la liste. */}
          {aTraiter.length === 0 ? (
            <p style={{ margin: 4, color: COULEURS.doux, fontSize: 12.5 }}>
              {etat.length === 0 ? "Aucun guide dans le catalogue." : "Plus aucun guide à traiter."}
            </p>
          ) : (
            aTraiter.map((g) => (
              <button
                key={g.id}
                id={`guide-lanceur-item-${g.id}`}
                onClick={() => choisir(g.id)}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  width: "100%", textAlign: "left", gap: 8, padding: "7px 8px",
                  marginBottom: 4, borderRadius: 6, border: "none",
                  background: "transparent", color: COULEURS.texte, cursor: "pointer",
                  font: "500 12.5px/1.3 var(--font-sans, var(--sans, system-ui, sans-serif))",
                }}
              >
                <span>{g.titre}</span>
                <span style={{
                  padding: "2px 6px", borderRadius: 999, fontSize: 10.5,
                  background: g.statut === "ok" ? COULEURS.okSoft : g.statut === "ko" ? COULEURS.koSoft : "rgba(0,0,0,.25)",
                  color: g.statut === "ok" ? COULEURS.ok : g.statut === "ko" ? COULEURS.ko : COULEURS.doux,
                }}>
                  {g.statut === "ok" ? "✓" : g.statut === "ko" ? "⚠️"
                    : g.enAttente ? "en attente de la session"
                      : g.faits > 0 ? `${g.faits}/${g.total} · à reprendre` : `${g.faits}/${g.total}`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      <button
        id="guide-lanceur-badge"
        onClick={() => setPanneauOuvert((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "9px 14px", borderRadius: 999, border: `1px solid ${COULEURS.bord}`,
          background: COULEURS.fond, color: COULEURS.texte, boxShadow: "0 6px 24px rgba(0,0,0,.45)",
          font: "500 12.5px/1 var(--font-sans, var(--sans, system-ui, sans-serif))", cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ color: COULEURS.accent }}>◎</span>
        {/* Nom de l'outil : Checker (choix Mariella, d216). */}
        Checker · à traiter
        <span style={{
          padding: "2px 6px", borderRadius: 999, background: "rgba(0,0,0,.25)",
          color: COULEURS.doux, fontSize: 11,
        }}>
          {aReprendre.length}
        </span>
        {enAttente.length > 0 && (
          <span id="guide-lanceur-attente" style={{
            padding: "2px 6px", borderRadius: 999, background: COULEURS.koSoft,
            color: COULEURS.ko, fontSize: 11,
          }}>
            {enAttente.length} en attente de la session
          </span>
        )}
      </button>
    </div>
  );
}
