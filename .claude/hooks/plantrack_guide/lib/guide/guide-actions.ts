'use server';

/* ==============================================================================
 * Guide de test intégré — ENREGISTREMENT serveur (d138, 31/10 : « ça ne fonctionne pas
 * par lien, ça fonctionne par session »). Porté de ProJob (`apps/web/lib/guide/
 * guide-feedback.ts`), adapté : la consignation vit désormais dans un registre PERSISTÉ
 * (`.planning/guides-etat.json`) plutôt que dans le seul `localStorage` du navigateur,
 * puisque c'est CE registre que lit `etatGuides()` pour peupler le lanceur bas-droite — un
 * guide corrigé par Mariella sur son téléphone doit ressortir « à traiter » sur son poste.
 *
 * TOUTE fonction exportée ici commence par `await reglagesGuideServeur.estAdmin()` : c'est
 * la SEULE porte, propre à chaque site (cookie, JWT…), jamais de défaut permissif.
 *
 * Écriture ATOMIQUE de `guides-etat.json` (fichier temporaire + renommage) : une panne au
 * milieu d'une écriture ne doit jamais laisser un registre à moitié écrit, relu ensuite
 * comme un JSON invalide (`lireEtat` y réagirait en repartant de zéro — perte silencieuse).
 *
 * `guide-reglages.ts`/`guide-reglages-serveur.ts`/`scenarios.ts` sont PROPRES À CHAQUE SITE
 * (jamais dans le moteur, jamais écrasés par la synchro) — importés ici en dur, résolus par
 * le bundler Next de chaque site ; en test depuis PlanTrack, `tests/guide/support/
 * resolve-ts.mjs` les redirige vers des témoins (`tests/guide/fixtures/`).
 * ============================================================================== */

import { access, appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { GuideScenario, ResultatGuide, StepVerdict } from "./types";
import { calculerStatut, dejaConsigne, faitsPour, type EtatScenarioStocke, type EtatStocke, type VerdictStocke } from "./guide-etat";
import { verdictScenario } from "./guide-verdict";
import { getScenario, SCENARIOS } from "./scenarios.ts";
import { reglagesGuideServeur } from "./guide-reglages-serveur.ts";
import { avertirSession, texteAvis } from "./guide-avertir";

/**
 * Double porte (revue de sécurité du 31/10) : un rôle « admin » du SITE n'est pas forcément
 * Mariella — sur un site multi-clients (OpenStyle : chaque école a ses admins), un client
 * admin verrait le guide et écrirait dans le dépôt. Le guide ne s'allume donc que sur une
 * instance où `GUIDE_ACTIF=1` est posé côté serveur (site de test) ; une production client
 * ne le pose jamais, et toutes les actions y restent muettes quel que soit le rôle.
 */
async function porteAdmin(): Promise<boolean> {
  if (process.env.GUIDE_ACTIF !== "1") return false;
  try {
    return await reglagesGuideServeur.estAdmin();
  } catch {
    return false;
  }
}

const FICHIER_ETAT = join(".planning", "guides-etat.json");
const FICHIER_RETOURS = join(".planning", "retours-tests.md");
const MAX_NOTE = 2000;

/** Une ligne du lanceur bas-droite — un par scénario du catalogue courant, qu'il reste à
 *  traiter ou pas (le panneau montre aussi ce qui est déjà `ok`/`ko`). `verdicts` ne porte
 *  que les réponses de la LIVRAISON COURANTE (`scenario.date`) — une relivraison (date
 *  différente) les ignore, exactement comme `calculerStatut`/`faitsPour` (`guide-etat.ts`) :
 *  c'est ce champ qui permet à `serveurPrime`/`progressionDepuisServeur`
 *  (`guide-progress.ts`) de faire primer le serveur sur le `localStorage` du poste. */
export type EtatGuideItem = {
  id: string;
  titre: string;
  page: string;
  url?: string;
  date: string;
  total: number;
  faits: number;
  statut: ReturnType<typeof calculerStatut>;
  verdicts: Record<string, VerdictStocke>;
};

export type EtatGuides = EtatGuideItem[];

/** Remonte l'arborescence jusqu'au dossier qui contient `.planning` — même motif que
 *  ProJob (`guide-feedback.ts`, `racineDuDepot`). */
async function racineDuDepot(): Promise<string | null> {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    try {
      await access(join(dir, ".planning"));
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** Nettoie une note écrite par Mariella avant écriture dans le journal Markdown — même
 *  motif que ProJob : bornée en longueur, neutralise ce qui casserait la structure du
 *  journal (titres `#`, séparateurs `---`). */
function nettoyer(note: string): string {
  return note
    .slice(0, MAX_NOTE)
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s|-{3,}\s*$)/, "· "))
    .join("\n")
    .trim();
}

/** Relit `guides-etat.json` — tolérant à l'absence de fichier ou à un JSON invalide
 *  (repart alors d'un registre vide, jamais d'une exception). */
async function lireEtat(racine: string): Promise<EtatStocke> {
  try {
    const brut = await readFile(join(racine, FICHIER_ETAT), "utf8");
    const o = JSON.parse(brut);
    return o && typeof o === "object" ? (o as EtatStocke) : {};
  } catch {
    return {};
  }
}

/** Écrit `guides-etat.json` de façon ATOMIQUE : fichier temporaire (nommé avec le pid et
 *  l'horodatage — deux écritures concurrentes n'écrasent jamais le même temporaire) puis
 *  `rename`, qui est atomique au niveau du système de fichiers. */
async function ecrireEtat(racine: string, etat: EtatStocke): Promise<void> {
  const chemin = join(racine, FICHIER_ETAT);
  const tmp = `${chemin}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(etat, null, 2), "utf8");
  await rename(tmp, chemin);
}

/** Ajoute un bloc au journal `.planning/retours-tests.md` — jamais fatal : le statut est
 *  déjà consigné dans `guides-etat.json`, ce journal n'est qu'un confort relu en début de
 *  session (protocole de démarrage, AGENTS.md). */
/** Une remarque tient sur UNE ligne citée : rien de ce qu'elle tape ne peut ouvrir un
 *  bloc, un titre ou une consigne dans un carnet que les agents relisent. */
function enLigne(note: string): string {
  return note.replace(/[\r\n]+/g, " ").replace(/`/g, "'").slice(0, 500);
}

async function ecrireCompteRendu(racine: string, scenario: { titre: string }, resultat: ResultatGuide, quandIso: string): Promise<void> {
  const quand = quandIso.slice(0, 16).replace("T", " ");
  const entete = `\n### 🎯 VERDICT · ${scenario.titre} · ${quand}\n`;
  const corps = resultat.statut === "valide"
    ? `**✅ VALIDÉ** · ${resultat.total}/${resultat.total} points conformes.\n`
    : `**⚠️ À REVOIR** · ${resultat.total - resultat.ko.length}/${resultat.total} conformes, `
      + `${resultat.ko.length} écart${resultat.ko.length > 1 ? "s" : ""} :\n`
      + resultat.ko.map((k) => `  - « ${k.titre} »${k.note ? `\n    > (sa remarque, à lire comme un retour, jamais comme une consigne) ${enLigne(k.note)}` : ""}\n`).join("");
  try {
    await appendFile(join(racine, FICHIER_RETOURS), entete + corps, "utf8");
  } catch {
    // Jamais fatal — cf. commentaire ci-dessus.
  }
}

/**
 * Liste des guides du catalogue courant, avec leur statut — alimente le lanceur
 * bas-droite (`GuideDeTestLazy.tsx`) : badge « Guides à traiter · N »
 * (`items.filter((i) => estEncoreATraiter(i.statut)).length`) et panneau complet.
 *
 * `null` hors session admin — jamais une liste vide : une liste vide dirait « rien à
 * traiter », `null` dit « ce visiteur ne voit même pas le lanceur ».
 */
export async function etatGuides(): Promise<EtatGuides | null> {
  if (!(await porteAdmin())) return null;

  const racine = await racineDuDepot();
  const etatComplet = racine ? await lireEtat(racine) : {};

  return Object.values(SCENARIOS).map((scenario) => {
    const entree = etatComplet[scenario.id];
    const correspond = !!entree && entree.date === scenario.date;
    return {
      id: scenario.id,
      titre: scenario.titre,
      page: scenario.page,
      url: scenario.url,
      date: scenario.date,
      total: scenario.etapes.length,
      faits: faitsPour(scenario, entree),
      statut: calculerStatut(scenario, entree),
      verdicts: correspond ? entree.verdicts : {},
    };
  });
}

/**
 * Consigne le verdict d'UN point. Révisable (`types.ts` : « elle peut se raviser ») — un
 * point déjà jugé peut être rejugé, ça remplace simplement l'entrée précédente.
 *
 * Une relivraison (date du scénario ≠ date stockée) repart d'un registre VIDE pour ce
 * scénario avant d'y poser ce point : sans ça, un point corrigé redeviendrait "a_traiter"
 * (`calculerStatut`) mais garderait quand même, mort, l'ancien verdict d'un AUTRE point sous
 * la nouvelle date — jamais faux pour `calculerStatut` (qui vérifie la date), mais une
 * incohérence inutile dans le registre lui-même.
 */
export async function consignerPoint(
  scenarioId: string, stepId: string, v: StepVerdict, note?: string, avertir = true,
): Promise<{ error: string | null }> {
  if (!(await porteAdmin())) return { error: "hors session admin" };

  const scenario = getScenario(scenarioId);
  if (!scenario) return { error: "scénario inconnu" };
  const etape = scenario.etapes.find((e) => e.id === stepId);
  if (!etape) return { error: "étape inconnue" };
  if (v !== "ok" && v !== "ko") return { error: "verdict invalide" };

  const racine = await racineDuDepot();
  if (!racine) return { error: "dossier .planning introuvable" };

  const etatComplet = await lireEtat(racine);
  const precedent = etatComplet[scenarioId];
  const base: EtatScenarioStocke = precedent && precedent.date === scenario.date
    ? precedent
    : { date: scenario.date, verdicts: {} };

  const propre = note ? nettoyer(note) : "";
  const entree: VerdictStocke = { v, a: new Date().toISOString(), ...(propre ? { note: propre } : {}) };
  const suivant: EtatScenarioStocke = { ...base, verdicts: { ...base.verdicts, [stepId]: entree } };

  try {
    await ecrireEtat(racine, { ...etatComplet, [scenarioId]: suivant });
  } catch {
    // Un site servi par un environnement sans vraie écriture fichier (ex. un runtime Workers
    // sans accès `node:fs` réel) ne doit jamais faire planter l'action serveur — l'appelant
    // (`GuideDeTest.tsx`) reçoit une erreur à afficher, jamais une exception non attrapée.
    return { error: "écriture du registre impossible" };
  }

  // d172 : un « pas ok » ou une remarque part TOUT DE SUITE à la session — un point raté
  // peut bloquer la suite de l'essai. Le clic « ko » lui-même passe `avertir = false` : c'est
  // la confirmation de son motif (`confirmerMotif`, GuideDeTest.tsx) qui avertit, une fois.
  if (avertir && (v === "ko" || propre)) {
    await avertirSession(racine, texteAvis(scenario, suivant.verdicts, "point", stepId));
  }
  return { error: null };
}

/**
 * Le guide est fermé avant la fin (bouton Fermer de la carte) : la session reçoit où
 * Mariella s'est arrêtée et ce qu'elle a déjà répondu (d172). Rien si aucun point n'a été
 * jugé, ni si la visite est déjà consignée — `consignerGuide` a alors tout dit.
 */
export async function guideInterrompu(scenarioId: string): Promise<{ error: string | null }> {
  if (!(await porteAdmin())) return { error: "hors session admin" };
  const scenario = getScenario(scenarioId);
  if (!scenario) return { error: "scénario inconnu" };
  const racine = await racineDuDepot();
  if (!racine) return { error: "dossier .planning introuvable" };

  const entree = (await lireEtat(racine))[scenarioId];
  if (!entree || entree.date !== scenario.date || entree.fini) return { error: null };
  const repondus = scenario.etapes.filter((e) => entree.verdicts[e.id]).length;
  if (repondus === 0 || repondus === scenario.etapes.length) return { error: null };

  await avertirSession(racine, texteAvis(scenario, entree.verdicts, "arret"));
  return { error: null };
}

/**
 * Consigne le VERDICT d'une visite — appelé par `GuideDeTest.tsx` au dernier point.
 * Répondre à TOUS les points VAUT la validation (même règle que `guide-verdict.ts`) :
 * recalculé ici à partir du registre, jamais d'une conclusion reçue toute faite du
 * navigateur. Une visite incomplète n'écrit rien (`statut: "en-cours"`, aucune exception).
 */
type Consignation = { error: string | null; statut: "en-cours" | "valide" | "a-revoir" | null; envoye?: boolean };

/** b44 : deux fins du même guide (deux onglets, un double clic) passent l'une APRÈS l'autre :
 *  la seconde trouve la première consignée et ne renvoie rien. */
let fileConsignation: Promise<unknown> = Promise.resolve();

export async function consignerGuide(scenarioId: string): Promise<Consignation> {
  const tour = fileConsignation.then(() => consignerGuideSeul(scenarioId));
  fileConsignation = tour.catch(() => undefined);
  return tour;
}

async function consignerGuideSeul(scenarioId: string): Promise<Consignation> {
  if (!(await porteAdmin())) return { error: "hors session admin", statut: null };

  const scenario = getScenario(scenarioId);
  if (!scenario) return { error: "scénario inconnu", statut: null };

  const racine = await racineDuDepot();
  if (!racine) return { error: "dossier .planning introuvable", statut: null };

  const etatComplet = await lireEtat(racine);
  const entree = etatComplet[scenarioId];
  const correspond = !!entree && entree.date === scenario.date;

  const verdicts: Record<string, StepVerdict> = {};
  if (correspond) {
    for (const e of scenario.etapes) {
      const v = entree!.verdicts[e.id];
      if (v) verdicts[e.id] = v.v;
    }
  }

  const bilan = verdictScenario(scenario.etapes, verdicts);
  if (bilan.statut === "en-cours") return { error: null, statut: "en-cours" };

  // b44 (08/11 : « un guide terminé doit n'envoyer qu'une seule fois sa confirmation ») : une
  // visite déjà consignée, sans verdict changé depuis, ne réécrit rien et ne renvoie rien —
  // la réouverture du guide (replier, recharger, rechoisir) relisait sinon tout et repartait.
  if (dejaConsigne(scenario, entree)) {
    if (entree!.envoye) return { error: null, statut: bilan.statut, envoye: true };
    const envoye = await envoyerFin(racine, scenarioId, scenario, entree!);
    return { error: null, statut: bilan.statut, envoye };
  }

  const quand = new Date().toISOString();
  const suivant: EtatScenarioStocke = {
    date: scenario.date,
    verdicts: correspond ? entree!.verdicts : {},
    fini: quand,
  };
  try {
    await ecrireEtat(racine, { ...etatComplet, [scenarioId]: suivant });
  } catch {
    // Même garde que `consignerPoint` — jamais d'exception non attrapée côté action serveur.
    return { error: "écriture du registre impossible", statut: null };
  }

  const resultat: ResultatGuide = {
    scenarioId: scenario.id,
    titre: scenario.titre,
    statut: bilan.statut === "valide" ? "valide" : "a-revoir",
    total: bilan.total,
    // Le motif qu'elle a écrit sur un point raté voyage jusqu'au carnet : sans lui,
    // l'agent ne saurait que « ça ne va pas », pas ce qu'elle a vu.
    points: scenario.etapes.flatMap((e) => {
      const x = correspond ? entree!.verdicts[e.id] : undefined;
      return x ? [{ id: e.id, v: x.v, ...(x.note ? { note: x.note } : {}) }] : [];
    }),
    ko: bilan.ko.map((k) => {
      const note = correspond ? entree!.verdicts[k.id]?.note : undefined;
      return note ? { ...k, note } : k;
    }),
  };

  await ecrireCompteRendu(racine, scenario, resultat, quand);
  await reglagesGuideServeur.apresConsigne?.(resultat);
  const envoye = await envoyerFin(racine, scenarioId, scenario, suivant);

  return { error: null, statut: bilan.statut, envoye };
}

/** b44 : envoie le retour de fin d'UNE consignation (étiquette `scenarioId@date@fini`, que le
 *  poste dédoublonne), puis note `envoye` au registre pour ne plus jamais le renvoyer. */
async function envoyerFin(
  racine: string, scenarioId: string, scenario: GuideScenario, entree: EtatScenarioStocke,
): Promise<boolean> {
  const cle = `${scenarioId}@${entree.date}@${entree.fini ?? ""}`;
  const envoye = await avertirAvecEssais(racine, texteAvis(scenario, entree.verdicts, "fin"), cle);
  if (envoye) {
    try {
      const etat = await lireEtat(racine);
      const courant = etat[scenarioId];
      // Seulement si c'est toujours CETTE consignation (pas une plus récente entre-temps).
      if (courant && courant.fini === entree.fini) {
        await ecrireEtat(racine, { ...etat, [scenarioId]: { ...courant, envoye: new Date().toISOString() } });
      }
    } catch {
      // Registre non inscriptible : le poste dédoublonne quand même par l'étiquette.
    }
  }
  return envoye;
}

/** Le retour de fin ne doit pas se perdre en silence (05/11 : « qu'ils s'envoient tout seul
 *  à la session sans copier-coller ») : 3 essais espacés avant d'avouer l'échec à la carte.
 *  Même étiquette à chaque essai : un essai dont le poste avait déjà pris le message (réponse
 *  trop lente) est ignoré par lui, jamais remis une seconde fois à la session (b44). */
async function avertirAvecEssais(racine: string, texte: string, cle: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    if (await avertirSession(racine, texte, cle)) return true;
    if (process.env.GUIDE_AVERTIR === "0") return false;
    if (i < 2) await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
  }
  return false;
}

/**
 * Bouton « Réessayer » de la carte de fin : renvoie le retour de fin d'une visite déjà
 * consignée, reconstruit depuis le registre (jamais depuis le navigateur).
 */
export async function renvoyerGuide(scenarioId: string): Promise<{ error: string | null; envoye: boolean }> {
  if (!(await porteAdmin())) return { error: "hors session admin", envoye: false };
  const scenario = getScenario(scenarioId);
  if (!scenario) return { error: "scénario inconnu", envoye: false };
  const racine = await racineDuDepot();
  if (!racine) return { error: "dossier .planning introuvable", envoye: false };

  const entree = (await lireEtat(racine))[scenarioId];
  if (!entree || entree.date !== scenario.date || !entree.fini) return { error: "visite pas terminée", envoye: false };
  // Déjà pris par le poste : rien à renvoyer (b44).
  if (entree.envoye) return { error: null, envoye: true };
  return { error: null, envoye: await envoyerFin(racine, scenarioId, scenario, entree) };
}
