/* ==============================================================================
 * Guide de test intégré — ENVOI du résultat à la session qui a ouvert le guide.
 *
 * Jusqu'ici, le seul porteur du résultat était le bouton « Copier le compte-rendu »
 * (`guide-compte-rendu.ts`), collé à la main dans le chat. Ce module ajoute un envoi
 * AUTOMATIQUE, en complément — jamais à la place : `guide-compte-rendu.ts` et le bouton
 * Copier restent le filet de sécurité quand l'envoi échoue (réseau, serveur éteint…).
 *
 * Deux responsabilités bien séparées, comme le reste du module `guide/` :
 * - `corpsEnvoi` est PURE (aucun DOM, aucun réseau) — ce qui part dans la requête, calculé
 *   à partir du scénario et de la progression. Testable en Node nu.
 * - `envoyerResultat` est le SEUL point de ce module qui touche le réseau (`fetch`) — et,
 *   comme tout accès à une API navigateur dans ce dépôt, il ne lève JAMAIS : un échec
 *   réseau rend `{ ok: false, message }`, jamais une exception qui remonterait jusqu'à
 *   React (même motif que `accederLocalStorage`/`accederSessionStorage`).
 *
 * Un point n'est transmis que s'il porte un `pt` (identifiant d'étape PlanTrack,
 * `GuideStep.pt`) ET qu'il a déjà une réponse — un point sans `pt` n'a tout simplement
 * rien à faire dans ce que PlanTrack doit recevoir (ex. une étape purement visuelle, sans
 * correspondance dans le plan), et un point sans réponse n'a pas de verdict à transmettre.
 * ============================================================================== */

import { validerPoste } from "./guide-visite";
import type { GuideProgress, GuideScenario, StepVerdict } from "./types";

export type VerdictEnvoi = { pt: string; verdict: StepVerdict; motif?: string };

export type CorpsEnvoi = {
  jeton: string;
  guide: string;
  verdicts: VerdictEnvoi[];
};

/**
 * Construit le corps de la requête — uniquement les étapes qui portent un `pt` ET ont déjà
 * un verdict, dans l'ordre du scénario. Le motif n'accompagne que les "ko" : un motif posé
 * puis le verdict changé en "ok" (elle se ravise) ne doit pas ressortir comme un écart
 * motivé qu'il n'est plus.
 */
export function corpsEnvoi(scenario: GuideScenario, prog: GuideProgress, jeton: string): CorpsEnvoi {
  const verdicts: VerdictEnvoi[] = [];
  for (const etape of scenario.etapes) {
    if (!etape.pt) continue; // pas d'id PlanTrack : rien à transmettre pour ce point
    const v = prog.verdicts[etape.id];
    if (!v) continue; // pas encore répondu
    const motif = v === "ko" ? prog.motifs?.[etape.id] : undefined;
    verdicts.push(motif ? { pt: etape.pt, verdict: v, motif } : { pt: etape.pt, verdict: v });
  }
  return { jeton, guide: scenario.id, verdicts };
}

export type ResultatEnvoi = { ok: boolean; message: string };

/** 10 s : assez pour un aller-retour réseau normal, pas assez pour bloquer longtemps le
 *  bilan sur un serveur éteint ou une session qui ne répond plus — le bouton Copier prend
 *  le relais dans tous les cas, mais encore faut-il que l'écran le propose à temps. */
const DELAI_MS = 10_000;

/**
 * Envoie le résultat à `${poste}/guide/resultat?projet=<projet>` — sans credentials (le
 * jeton DANS le corps authentifie déjà la requête, un cookie de session n'a rien à y
 * faire), avec un délai de 10 s. Ne lève JAMAIS : réseau coupé, serveur éteint, délai
 * dépassé, réponse non-2xx — tout rend `{ ok: false, message }`, jamais une exception.
 * `GuideDeTest.tsx` garde dans tous les cas le bouton Copier comme filet de sécurité.
 *
 * ⚠️ Revalide `poste` via `validerPoste` (`guide-visite.ts`) — DÉFENSE EN PROFONDEUR :
 * `poste` a déjà dû passer cette même validation en amont (`resoudreEnvoi`), mais une
 * valeur qui arrive en paramètre de fonction ne doit jamais être supposée fiable juste
 * parce qu'un appelant l'a validée plus haut dans la pile — le même principe que « un
 * accès stockage ne lève jamais » appliqué à la frontière entre modules. L'URL finale est
 * construite avec l'API `URL` (jamais par concaténation de chaînes) : `poste`/`projet` ne
 * peuvent alors plus injecter de chemin, de query, ni de fragment supplémentaires.
 */
export async function envoyerResultat(poste: string, projet: string, corps: CorpsEnvoi): Promise<ResultatEnvoi> {
  const origine = validerPoste(poste);
  if (!origine) return { ok: false, message: "destination invalide" };

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MS);
  try {
    const url = new URL("/guide/resultat", origine);
    url.searchParams.set("projet", projet);
    const reponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(corps),
      signal: controleur.signal,
    });
    if (!reponse.ok) return { ok: false, message: `le serveur a répondu ${reponse.status}` };
    return { ok: true, message: "résultat envoyé" };
  } catch (e) {
    const abandonne = e instanceof Error && e.name === "AbortError";
    return { ok: false, message: abandonne ? "délai dépassé (10 s)" : "envoi impossible" };
  } finally {
    clearTimeout(minuteur);
  }
}
