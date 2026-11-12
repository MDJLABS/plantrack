/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */
/* ==============================================================================
 * Guide de test : guides écrits en JSON (Checker v2, section 3 de docs/checker-v2.md).
 *
 * Un guide = un fichier `lib/guide/guides/<id>.json`. `guides/index.ts` (généré par
 * PlanTrack) les exporte dans `GUIDES_JSON`. Ce module les convertit en `GuideScenario`,
 * les fusionne avec les `SCENARIOS` écrits à la main du site (`../scenarios.ts`, les deux
 * coexistent) et fournit `SCENARIOS`, `getScenario` et `indexDePoint` sur cette fusion.
 *
 * Tolérant : un guide invalide est ignoré avec un `console.warn`, jamais de plantage.
 * Module pur côté conversion (aucun DOM, aucun `node:fs`).
 * ============================================================================== */

import type { GuideGeste, GuideScenario, GuideStep } from "./types.ts";
import { SCENARIOS as SCENARIOS_SITE } from "../scenarios.ts";
import { GUIDES_JSON } from "../guides/index.ts";

type Objet = Record<string, unknown>;

const estObjet = (x: unknown): x is Objet => !!x && typeof x === "object" && !Array.isArray(x);
const texte = (x: unknown): string | null => (typeof x === "string" && x.trim() !== "" ? x : null);

/** Un geste en forme courte (`{clic}`, `{saisir, valeur}`, `{aller}`) ou longue
 *  (`{type, cible, valeur, url}`). `null` si rien d'exploitable. */
function convertirGeste(g: unknown): GuideGeste | null {
  if (!estObjet(g)) return null;
  const clic = texte(g.clic);
  if (clic) return { type: "clic", cible: clic };
  const saisir = texte(g.saisir);
  if (saisir) return { type: "saisie", cible: saisir, valeur: typeof g.valeur === "string" ? g.valeur : "" };
  const aller = texte(g.aller);
  if (aller) return { type: "aller", url: aller };
  const type = g.type;
  if (type === "clic" || type === "saisie" || type === "aller") {
    return {
      type,
      ...(texte(g.cible) ? { cible: g.cible as string } : {}),
      ...(typeof g.valeur === "string" ? { valeur: g.valeur } : {}),
      ...(texte(g.url) ? { url: g.url as string } : {}),
    };
  }
  return null;
}

function convertirPoint(p: unknown, i: number): GuideStep | null {
  if (!estObjet(p)) return null;
  const titre = texte(p.titre);
  const faire = texte(p.faire);
  const attendu = texte(p.attendu);
  if (!titre || !faire || !attendu) return null;

  const cibles = Array.isArray(p.cible)
    ? p.cible.filter((c): c is string => !!texte(c))
    : texte(p.cible) ? [p.cible as string] : [];

  let geste: GuideGeste | undefined;
  let gestes: GuideGeste[] | undefined;
  if (Array.isArray(p.gestes)) {
    const liste = p.gestes.map(convertirGeste).filter((g): g is GuideGeste => g !== null);
    if (liste.length) gestes = liste;
  } else {
    geste = convertirGeste(p) ?? undefined;
  }

  return {
    id: texte(p.id) ?? `p${i + 1}`,
    titre,
    ...(cibles.length ? { cibles } : {}),
    action: faire,
    attendu,
    ...(geste ? { geste } : {}),
    ...(gestes ? { gestes } : {}),
    ...(texte(p.url) ? { url: p.url as string } : {}),
  };
}

/** Convertit UN guide JSON en scénario. `null` si invalide (titre, page ou points manquants,
 *  point sans titre/faire/attendu, ids en double, id de guide hors `[a-z0-9-]+`). */
export function convertirGuide(id: string, brut: unknown): GuideScenario | null {
  if (!/^[a-z0-9-]+$/.test(id) || !estObjet(brut)) return null;
  const titre = texte(brut.titre);
  const page = texte(brut.page);
  if (!titre || !page || !Array.isArray(brut.points) || brut.points.length === 0) return null;

  const etapes: GuideStep[] = [];
  for (let i = 0; i < brut.points.length; i++) {
    const e = convertirPoint(brut.points[i], i);
    if (!e) return null;
    etapes.push(e);
  }
  if (new Set(etapes.map((e) => e.id)).size !== etapes.length) return null;

  const version = texte(brut.version) ?? (typeof brut.version === "number" ? String(brut.version) : "1");
  return { id, titre, date: version, page, url: page, etapes };
}

/** Convertit tous les guides JSON ; les invalides sont ignorés (avertissement console). */
export function convertirGuides(guides: Record<string, unknown> | null | undefined): Record<string, GuideScenario> {
  const sortie: Record<string, GuideScenario> = {};
  if (!estObjet(guides)) return sortie;
  for (const id of Object.keys(guides)) {
    try {
      const s = convertirGuide(id, guides[id]);
      if (s) sortie[id] = s;
      else console.warn(`[checker] guide « ${id} » ignoré : JSON invalide (voir plantrack checker verifier)`);
    } catch {
      console.warn(`[checker] guide « ${id} » ignoré : JSON illisible`);
    }
  }
  return sortie;
}

/** Fusion : guides JSON d'abord, puis scénarios écrits à la main (ceux du site l'emportent
 *  en cas d'id identique). */
export function fusionner(
  site: Record<string, GuideScenario> | null | undefined, json: Record<string, GuideScenario>,
): Record<string, GuideScenario> {
  return { ...json, ...(estObjet(site) ? (site as Record<string, GuideScenario>) : {}) };
}

export const SCENARIOS: Record<string, GuideScenario> = fusionner(SCENARIOS_SITE, convertirGuides(GUIDES_JSON));

/** Garde `hasOwnProperty` : un id forgé (`__proto__`, `constructor`) ne résout jamais. */
export function getScenario(id: string | null | undefined): GuideScenario | null {
  if (!id || !Object.prototype.hasOwnProperty.call(SCENARIOS, id)) return null;
  return SCENARIOS[id] ?? null;
}

/** Index de l'étape `stepId`, `null` si inconnue (retombe alors sur la reprise normale). */
export function indexDePoint(
  etapes: { id: string }[], stepId: string | null | undefined,
): number | null {
  if (!stepId) return null;
  const i = etapes.findIndex((e) => e.id === stepId);
  return i >= 0 ? i : null;
}
