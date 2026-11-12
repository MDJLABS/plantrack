/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */
/* ==============================================================================
 * Guide de test intégré — AVERTIR LA SESSION (d172, 03/11 : « une étape du guide peut
 * tout à fait bloquer la suite, et donc il faut agir de suite »).
 *
 * Les actions serveur (`guide-actions.ts`) écrivent le registre sur le disque du site ;
 * personne ne prévenait la session, qui ne le lisait qu'au démarrage suivant. Ici, un
 * point « pas ok » ou annoté, la fin du guide ou son arrêt en route partent tout de suite
 * à la boîte aux lettres du poste Better Call Code (`POST /guide/point`), qui réveille la
 * session du projet. Les points « ok » ne réveillent personne : ils voyagent dans l'état
 * du parcours joint à chaque message.
 *
 * Jamais fatal, jamais bloquant au-delà de 8 s : un poste absent ou éteint laisse le guide
 * fonctionner exactement comme avant (le registre reste la référence).
 *
 * Le projet est le dossier du site CÔTÉ SERVEUR (`racine`), jamais une donnée du
 * navigateur. Aucun verdict PlanTrack n'est posé ici : le verdict officiel reste à
 * Mariella (b25/d106) — le message n'est qu'un retour à lire.
 * ============================================================================== */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GuideScenario } from "./types";
import type { VerdictStocke } from "./guide-etat";

export type RaisonAvis = "point" | "fin" | "arret" | "bloquant";

/** Une remarque tient sur UNE ligne citée, bornée : rien de ce qu'elle tape ne peut
 *  ouvrir un bloc ou une consigne dans le message lu par l'agent. */
function citer(note: string): string {
  return note.replace(/[\r\n]+/g, " ").replace(/`/g, "'").slice(0, 500);
}

/**
 * Le texte remis à la session : ce qui vient de se passer, puis l'état complet du
 * parcours (les « ok » y sont, d'où l'inutilité de les envoyer un par un).
 */
export function texteAvis(
  scenario: GuideScenario,
  verdicts: Record<string, VerdictStocke>,
  raison: RaisonAvis,
  stepId?: string,
): string {
  const total = scenario.etapes.length;
  const repondus = scenario.etapes.filter((e) => verdicts[e.id] && verdicts[e.id].v !== "bloque").length;
  let tete: string;
  if (raison === "bloquant" && stepId) {
    const n = scenario.etapes.findIndex((e) => e.id === stepId);
    const e = scenario.etapes[n];
    const x = verdicts[stepId];
    tete = `BLOQUANT : ${scenario.id} / ${stepId} (point ${n + 1}/${total} « ${e?.titre ?? stepId} » du guide « ${scenario.titre} »)`
      + (x?.note ? `. Sa remarque : « ${citer(x.note)} »` : "")
      + `. Corrige, puis lance \`plantrack checker corrige ${scenario.id} ${stepId}\` : le point redevient à jouer et Mariella ne rejouera que lui.`;
  } else if (raison === "point" && stepId) {
    const n = scenario.etapes.findIndex((e) => e.id === stepId);
    const e = scenario.etapes[n];
    const x = verdicts[stepId];
    tete = `Guide « ${scenario.titre} », point ${n + 1}/${total} « ${e?.titre ?? stepId} » : `
      + (x?.v === "ko" ? "PAS OK" : "ok, avec une remarque")
      + (x?.note ? `. Sa remarque : « ${citer(x.note)} »` : "")
      + ". Elle est peut-être bloquée sur ce point : agis maintenant.";
  } else if (raison === "fin") {
    const ko = scenario.etapes.filter((e) => verdicts[e.id]?.v === "ko").length;
    tete = `Guide « ${scenario.titre} » terminé : ${repondus - ko} ok, ${ko} pas ok.`;
  } else {
    tete = `Guide « ${scenario.titre} » fermé avant la fin : ${repondus} point(s) répondu(s) sur ${total}.`;
  }
  const lignes = scenario.etapes.map((e, i) => {
    const x = verdicts[e.id];
    const etat = !x ? "pas encore vu" : x.v === "ok" ? "ok" : x.v === "bloque" ? "BLOQUANT" : "PAS OK";
    const note = x?.note && e.id !== stepId ? `, « ${citer(x.note)} »` : "";
    return `${i + 1}. ${e.titre} : ${etat}${note}`;
  });
  return `${tete}\n\nOù en est le parcours :\n${lignes.join("\n")}`;
}

/** Où joindre le poste : comme les hooks bcc (`hook/poste.ts`), `~/.bcc-poste/poste.json`
 *  s'il existe (poste sur une autre machine), sinon la boucle locale. */
async function lirePoste(): Promise<{ base: string; jeton: string }> {
  const local = { base: `http://127.0.0.1:${String(Number(process.env.BCC_PORT ?? 8787))}`, jeton: "" };
  try {
    const brut = JSON.parse(await readFile(join(homedir(), ".bcc-poste", "poste.json"), "utf8")) as {
      adresse?: unknown;
      jeton?: unknown;
    };
    if (typeof brut.adresse !== "string" || brut.adresse.trim() === "") return local;
    return {
      base: brut.adresse.trim().replace(/\/+$/, ""),
      jeton: typeof brut.jeton === "string" ? brut.jeton : "",
    };
  } catch {
    return local;
  }
}

/** Porte le texte à la session du projet. Rend `true` si le poste l'a pris. `cle` (b44) :
 *  étiquette unique d'un envoi ; le poste ignore un second envoi de la même étiquette. */
export async function avertirSession(racine: string, texte: string, cle?: string): Promise<boolean> {
  if (process.env.GUIDE_AVERTIR === "0") return false;
  try {
    const poste = await lirePoste();
    const entetes: Record<string, string> = { "content-type": "application/json" };
    if (poste.jeton !== "") entetes.authorization = `Bearer ${poste.jeton}`;
    const r = await fetch(`${poste.base}/guide/point`, {
      method: "POST",
      headers: entetes,
      body: JSON.stringify({ projet: racine, texte, ...(cle ? { cle } : {}) }),
      // 8 s (b44) : un poste lent (redémarrage) qui prend quand même le message ne doit pas
      // passer pour un échec, que l'essai suivant renverrait.
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
