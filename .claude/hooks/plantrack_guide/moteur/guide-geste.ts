/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */
/* ==============================================================================
 * Guide de test intégré — JOUER un geste automatiquement (curseur animé).
 *
 * Jusqu'ici, chaque étape décrivait un geste que MARIELLA devait faire elle-même
 * (« clique sur… », « saisis… »). Ce module le joue à sa place — elle n'a plus qu'à juger
 * le résultat — via `GuideCurseur.tsx`, qui anime le déplacement puis appelle `jouerGeste`.
 *
 * Types (cf. `types.ts`, `GuideGeste`) ; depuis le 14/11 s'y ajoutent touche (Échap),
 * survol, glisser, clic-dehors et retour, décrits sur leurs fonctions `appliquer…` :
 * - "clic"   → `el.click()`.
 * - "saisie" → pose `valeur` via le SETTER NATIF de `HTMLInputElement`/`HTMLTextAreaElement`
 *   (`Object.getOwnPropertyDescriptor(…, 'value').set`), puis déclenche `input` et `change`
 *   en bulles. Nécessaire pour React : poser `el.value = …` directement laisse son état
 *   interne en désaccord avec le DOM (React intercepte le SETTER de l'instance, pas
 *   l'assignation — c'est le même contournement que la plupart des bibliothèques de test
 *   d'UI utilisent pour simuler une saisie « comme un humain »).
 * - "aller"  → `location.assign(url)`. ⚠️ La navigation DÉCHARGE la page avant que React
 *   ait pu persister quoi que ce soit : **l'appelant doit marquer l'étape jouée
 *   (`marquerJoue` + `sauverProgression`) AVANT d'appeler `jouerGeste`**, jamais après.
 *   La reprise de la VISITE elle-même (quel scénario remonter) est assurée par
 *   `sessionStorage` (`guide-visite.ts`) — ce module n'y touche pas.
 *
 * `jouerGeste` ne lève JAMAIS — un geste qui échoue (cible absente, API indisponible)
 * rend `{ ok: false, raison }` ; `GuideDeTest.tsx` affiche la raison et laisse Mariella
 * juger (invariant 2 du guide : ne jamais faire comme si la cible avait été atteinte).
 *
 * Fonctions séparées et EXPORTÉES pour rester testables sans navigateur réel : un objet
 * minimal (`{ click, value, dispatchEvent }`) suffit à exercer `appliquerClic`/
 * `appliquerSaisie` — pas besoin de jsdom (cf. tests/guide/guide-geste.test.ts).
 * ============================================================================== */

import { resolveTarget } from "./guide-geometry";
import type { GuideGeste } from "./types";

export type ResultatGeste = { ok: boolean; raison?: string };

/**
 * Tous les gestes d'une étape, dans l'ordre où ils se jouent : `geste` d'abord, puis
 * `gestes` (d216). Liste vide ⇒ l'étape n'a rien à jouer. Un "aller" placé avant la fin
 * coupe la suite (la page se décharge) : on s'arrête donc juste après lui.
 */
export function gestesEtape(etape: { geste?: GuideGeste; gestes?: GuideGeste[] }): GuideGeste[] {
  const tous = [...(etape.geste ? [etape.geste] : []), ...(etape.gestes ?? [])];
  const aller = tous.findIndex((g) => g.type === "aller" || g.type === "retour" || g.type === "compte");
  return aller >= 0 ? tous.slice(0, aller + 1) : tous;
}

/**
 * Sélecteurs à essayer, du plus précis au plus général : celui du geste d'abord (il
 * désigne précisément l'élément à actionner), puis les `cibles` de l'étape en repli —
 * c'est la même zone que celle surlignée, un repli raisonnable si le geste n'a pas son
 * propre sélecteur ou qu'il ne résout rien.
 */
export function selecteursGeste(geste: GuideGeste, ciblesRepli: readonly string[] = []): string[] {
  // Échap et clic dans le vide visent rarement la zone surlignée : se rabattre sur elle
  // ferait cliquer DEDANS le menu qu'on veut justement fermer. Leur cible est la leur ou rien.
  if (geste.type === "touche" || geste.type === "clic-dehors") return geste.cible ? [geste.cible] : [];
  // Geste conditionnel : sa cible ou rien (cf. `siPresent` dans types.ts).
  if (geste.siPresent) return geste.cible ? [geste.cible] : [];
  return geste.cible ? [geste.cible, ...ciblesRepli] : [...ciblesRepli];
}

/** Un geste qui n'a besoin d'aucun élément à viser : la navigation, et Échap ou le clic
 *  dans le vide quand ils n'ont pas de `cible` propre (focus courant / fond de page). */
export function gesteSansCible(geste: GuideGeste): boolean {
  if (geste.type === "aller" || geste.type === "retour" || geste.type === "compte") return true;
  return (geste.type === "touche" || geste.type === "clic-dehors") && !geste.cible;
}

/**
 * Clic — accepte un vrai `Element` ou un double minimal exposant `click()` (tests). Un
 * élément qui n'expose ni l'un ni l'autre est un échec déclaré, jamais une exception qui
 * remonte jusqu'à React.
 */
export function appliquerClic(el: unknown): ResultatGeste {
  if (!el || typeof (el as { click?: unknown }).click !== "function") {
    return { ok: false, raison: "élément non cliquable" };
  }
  try {
    (el as { click: () => void }).click();
    return { ok: true };
  } catch {
    return { ok: false, raison: "le clic a échoué" };
  }
}

/** L'élément minimal qu'`appliquerSaisie` sait actionner — un vrai `HTMLInputElement`/
 *  `HTMLTextAreaElement`, ou un double de test exposant juste ça. */
type ElementSaisissable = {
  value?: string;
  dispatchEvent?: (e: Event) => unknown;
};

/**
 * Saisie — setter natif si l'élément est un VRAI champ du DOM (pour que React le
 * remarque), repli sur une simple affectation sinon (double de test, ou élément qui n'est
 * ni l'un ni l'autre mais porte quand même `value`). `typeof HTMLInputElement !==
 * "undefined"` est nécessaire : ce module tourne aussi en test Node nu, où ces globales
 * n'existent pas du tout — s'y référer sans ce garde lèverait un `ReferenceError`, pas le
 * « jamais lever » promis par `jouerGeste`.
 */
export function appliquerSaisie(el: unknown, valeur: string): ResultatGeste {
  if (!el || typeof el !== "object") return { ok: false, raison: "élément de saisie absent" };
  const cible = el as ElementSaisissable;
  try {
    const proto =
      (typeof HTMLInputElement !== "undefined" && el instanceof HTMLInputElement && HTMLInputElement.prototype) ||
      (typeof HTMLTextAreaElement !== "undefined" && el instanceof HTMLTextAreaElement && HTMLTextAreaElement.prototype) ||
      (typeof HTMLSelectElement !== "undefined" && el instanceof HTMLSelectElement && HTMLSelectElement.prototype) ||
      null;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(cible, valeur);
    else cible.value = valeur;

    // `bubbles: true` : React écoute au niveau du document (délégation), pas sur le champ
    // lui-même — un événement qui ne remonte pas n'est tout simplement jamais vu.
    if (typeof cible.dispatchEvent === "function") {
      cible.dispatchEvent(new Event("input", { bubbles: true }));
      cible.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true };
  } catch {
    return { ok: false, raison: "la saisie a échoué" };
  }
}

/** Le minimum d'un élément qui reçoit des événements (vrai `Element` ou double de test). */
type Cible = { dispatchEvent?: (e: Event) => unknown; getBoundingClientRect?: () => DOMRect };

/** Centre écran d'un élément, ou (0,0) si on ne sait pas le mesurer (double de test). */
function centreDe(el: Cible): { x: number; y: number } {
  try {
    const r = el.getBoundingClientRect?.();
    if (r) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  } catch { /* mesure impossible : (0,0) */ }
  return { x: 0, y: 0 };
}

/** Fabrique un événement si l'API existe dans cet environnement (Node nu : non). */
function fabriquer(type: string, init: Record<string, unknown>): Event | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const famille =
    type.startsWith("key") ? "KeyboardEvent"
    : type.startsWith("pointer") ? "PointerEvent"
    : type.startsWith("drag") || type === "drop" ? "DragEvent"
    : "MouseEvent";
  // Repli PointerEvent → MouseEvent (vieux Safari), puis Event nu.
  for (const nom of [famille, "MouseEvent", "Event"]) {
    const C = g[nom] as (new (t: string, i?: Record<string, unknown>) => Event) | undefined;
    if (typeof C === "function") {
      try { return new C(type, init); } catch { /* constructeur refusé : suivant */ }
    }
  }
  return null;
}

function emettre(el: Cible, type: string, init: Record<string, unknown> = {}): boolean {
  if (typeof el.dispatchEvent !== "function") return false;
  const ev = fabriquer(type, { bubbles: true, cancelable: true, composed: true, ...init });
  if (!ev) return false;
  el.dispatchEvent(ev);
  return true;
}

/**
 * Touche — `keydown` puis `keyup` sur l'élément visé, en bulles : un menu qui écoute Échap
 * sur `document` (le cas général) le reçoit aussi. `code` est posé pour les écouteurs qui
 * le lisent à la place de `key`.
 */
export function appliquerTouche(el: unknown, touche = "Escape"): ResultatGeste {
  if (!el || typeof (el as Cible).dispatchEvent !== "function") {
    return { ok: false, raison: "rien pour recevoir la touche" };
  }
  try {
    const code = touche === "Escape" ? "Escape" : touche === "Enter" ? "Enter" : touche;
    const init = { key: touche, code, keyCode: touche === "Escape" ? 27 : touche === "Enter" ? 13 : 0 };
    if (!emettre(el as Cible, "keydown", init)) return { ok: false, raison: "touche indisponible" };
    emettre(el as Cible, "keyup", init);
    return { ok: true };
  } catch {
    return { ok: false, raison: "la touche a échoué" };
  }
}

/** Classe posée sur l'élément survolé et ses ancêtres : la feuille de style copiée ci-dessous
 *  y applique les règles `:hover` de la page (même principe que « forcer l'état » des outils
 *  de développement — un événement fabriqué ne déclenche jamais le vrai `:hover`). */
export const CLASSE_SURVOL = "guide-force-survol";
const ID_FEUILLE_SURVOL = "guide-feuille-survol";

/**
 * Réécrit une règle CSS qui parle de `:hover` pour qu'elle vise aussi `.guide-force-survol`.
 * On garde l'original et on ajoute la copie (l'utilisateur peut encore survoler à la main).
 * `@media (hover: hover)` (Tailwind 4) devient `all` : sur téléphone il ne répond jamais, et
 * c'est justement là que Mariella regarde le plus souvent. Exportée pour les tests.
 */
export function reecrireSurvol(cssText: string): string | null {
  if (!cssText.includes(":hover")) return null;
  return cssText
    .replace(/:hover\b/g, `.${CLASSE_SURVOL}`)
    .replace(/\(\s*hover\s*:\s*hover\s*\)/g, "all");
}

/** Construit (une fois par page) la feuille des règles `:hover` réécrites. */
function feuilleSurvol(doc: Document): void {
  if (doc.getElementById(ID_FEUILLE_SURVOL)) return;
  const copies: string[] = [];
  for (const feuille of Array.from(doc.styleSheets)) {
    let regles: CSSRuleList;
    try { regles = feuille.cssRules; } catch { continue; } // feuille d'un autre domaine : illisible
    for (const r of Array.from(regles)) {
      const copie = reecrireSurvol(r.cssText);
      if (copie) copies.push(copie);
    }
  }
  const style = doc.createElement("style");
  style.id = ID_FEUILLE_SURVOL;
  style.textContent = copies.join("\n");
  doc.head.appendChild(style);
}

/** Retire l'état de survol forcé (nouvelle étape, ou nouveau survol ailleurs). */
export function oublierSurvol(doc: Document): void {
  try {
    doc.querySelectorAll(`.${CLASSE_SURVOL}`).forEach((n) => {
      n.classList.remove(CLASSE_SURVOL);
      emettre(n, "mouseout", { relatedTarget: null });
      emettre(n, "mouseleave", { bubbles: false, relatedTarget: null });
      emettre(n, "pointerleave", { bubbles: false });
    });
    // La feuille est jetée aussi : une page qui charge de nouveaux styles (navigation
    // client) aura sa copie refaite au prochain survol.
    doc.getElementById(ID_FEUILLE_SURVOL)?.remove();
  } catch { /* rien à retirer */ }
}

/**
 * Survol — événements souris et pointeur (React tire `onMouseEnter` de `mouseover`) ET
 * état `:hover` forcé sur l'élément et ses ancêtres (un `group-hover` vit sur un parent).
 */
export function appliquerSurvol(el: unknown, doc?: Document): ResultatGeste {
  if (!el || typeof (el as Cible).dispatchEvent !== "function") {
    return { ok: false, raison: "rien à survoler" };
  }
  try {
    const c = el as Cible;
    const { x: clientX, y: clientY } = centreDe(c);
    const pos = { clientX, clientY, pointerType: "mouse", isPrimary: true, pointerId: 1 };
    if (doc) {
      oublierSurvol(doc);
      feuilleSurvol(doc);
      for (let n = el as Element | null; n && n !== doc.documentElement; n = n.parentElement) {
        n.classList?.add(CLASSE_SURVOL);
      }
    }
    emettre(c, "pointerover", pos);
    emettre(c, "pointerenter", { ...pos, bubbles: false });
    emettre(c, "mouseover", { clientX, clientY, relatedTarget: null });
    emettre(c, "mouseenter", { clientX, clientY, bubbles: false, relatedTarget: null });
    emettre(c, "pointermove", pos);
    emettre(c, "mousemove", { clientX, clientY });
    return { ok: true };
  } catch {
    return { ok: false, raison: "le survol a échoué" };
  }
}

/**
 * Clic dans le vide — la suite complète d'un vrai clic (pointeur, souris, click) : les menus
 * se ferment sur l'un ou l'autre selon leur code (souvent `mousedown` sur `document`).
 */
export function appliquerClicDehors(el: unknown): ResultatGeste {
  if (!el || typeof (el as Cible).dispatchEvent !== "function") {
    return { ok: false, raison: "pas de fond de page où cliquer" };
  }
  try {
    const c = el as Cible;
    const { x: clientX, y: clientY } = centreDe(c);
    const base = { clientX, clientY, button: 0 };
    const ptr = { ...base, pointerType: "mouse", isPrimary: true, pointerId: 1 };
    emettre(c, "pointerdown", { ...ptr, buttons: 1 });
    emettre(c, "mousedown", { ...base, buttons: 1 });
    emettre(c, "pointerup", ptr);
    emettre(c, "mouseup", base);
    if (!emettre(c, "click", base)) return { ok: false, raison: "clic indisponible" };
    return { ok: true };
  } catch {
    return { ok: false, raison: "le clic dans le vide a échoué" };
  }
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Nombre de pas du glissé dnd-kit : assez pour franchir son seuil d'activation (quelques px)
 *  puis laisser ses détecteurs de collision voir passer la souris au-dessus des cibles. */
const PAS_GLISSE = 12;

/**
 * Glisser-déposer — deux mécanismes, choisis d'après la source :
 * - élément `draggable` (glisser-déposer NATIF du navigateur) : dragstart → dragenter/
 *   dragover → drop → dragend, avec un `DataTransfer` partagé, comme le navigateur ;
 * - sinon (dnd-kit et ses semblables) : pointerdown sur la source, une série de
 *   pointermove sur le document jusqu'à la destination, pointerup. Les pauses entre les pas
 *   laissent React rendre la position « en cours de glissé » que dnd-kit lit au lâcher.
 */
export async function appliquerGlisser(
  source: unknown,
  dest: unknown,
  doc?: Document,
  pasMs = 40,
): Promise<ResultatGeste> {
  if (!source || typeof (source as Cible).dispatchEvent !== "function") {
    return { ok: false, raison: "rien à glisser" };
  }
  if (!dest || typeof (dest as Cible).dispatchEvent !== "function") {
    return { ok: false, raison: "endroit où déposer introuvable" };
  }
  try {
    const s = source as Cible;
    const d = dest as Cible;
    const a = centreDe(s);
    const b = centreDe(d);
    const natif = (source as Element).closest?.('[draggable="true"]');
    if (natif) {
      const g = globalThis as unknown as { DataTransfer?: new () => DataTransfer };
      const dataTransfer = typeof g.DataTransfer === "function" ? new g.DataTransfer() : undefined;
      const src = natif as unknown as Cible;
      emettre(src, "dragstart", { clientX: a.x, clientY: a.y, dataTransfer });
      await pause(pasMs);
      emettre(d, "dragenter", { clientX: b.x, clientY: b.y, dataTransfer });
      emettre(d, "dragover", { clientX: b.x, clientY: b.y, dataTransfer });
      await pause(pasMs);
      emettre(d, "drop", { clientX: b.x, clientY: b.y, dataTransfer });
      emettre(src, "dragend", { clientX: b.x, clientY: b.y, dataTransfer });
      return { ok: true };
    }
    const ptr = { pointerType: "mouse", isPrimary: true, pointerId: 1, button: 0 };
    const recoit: Cible = (doc as unknown as Cible) ?? s;
    if (!emettre(s, "pointerdown", { ...ptr, buttons: 1, clientX: a.x, clientY: a.y })) {
      return { ok: false, raison: "glisser indisponible" };
    }
    emettre(s, "mousedown", { button: 0, buttons: 1, clientX: a.x, clientY: a.y });
    await pause(pasMs);
    for (let i = 1; i <= PAS_GLISSE; i++) {
      const t = i / PAS_GLISSE;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      emettre(recoit, "pointermove", { ...ptr, buttons: 1, clientX: x, clientY: y });
      emettre(recoit, "mousemove", { button: 0, buttons: 1, clientX: x, clientY: y });
      await pause(pasMs);
    }
    await pause(pasMs * 2);
    emettre(recoit, "pointerup", { ...ptr, buttons: 0, clientX: b.x, clientY: b.y });
    emettre(recoit, "mouseup", { button: 0, buttons: 0, clientX: b.x, clientY: b.y });
    return { ok: true };
  } catch {
    return { ok: false, raison: "le glisser-déposer a échoué" };
  }
}

/** Fichier d'essai décrit dans un geste "fichier" (cf. `GuideGeste.fichier`). */
type FichierEssai = NonNullable<GuideGeste["fichier"]>;

/**
 * Fichier - dépose un fichier d'essai. Si `el` est un `<input type="file">` (ou en contient
 * un) : `input.files` reçoit le fichier puis `input` et `change` partent en bulles. Sinon
 * l'élément est une zone de dépôt : `dragenter`, `dragover`, `drop` avec le `DataTransfer`.
 */
export function appliquerFichier(el: unknown, f: FichierEssai | undefined): ResultatGeste {
  if (!el || typeof el !== "object") return { ok: false, raison: "rien pour recevoir le fichier" };
  if (!f || typeof f.nom !== "string" || !f.nom) return { ok: false, raison: 'geste "fichier" sans nom de fichier' };
  try {
    const g = globalThis as unknown as {
      File?: new (parts: BlobPart[], nom: string, o?: FilePropertyBag) => File;
      DataTransfer?: new () => DataTransfer;
    };
    if (typeof g.File !== "function" || typeof g.DataTransfer !== "function") {
      return { ok: false, raison: "dépôt de fichier indisponible" };
    }
    let parts: BlobPart[];
    if (typeof f.base64 === "string") {
      const bin = atob(f.base64);
      const octets = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
      parts = [octets];
    } else {
      parts = [f.contenu ?? ""];
    }
    const fichier = new g.File(parts, f.nom, { type: f.type || "text/plain" });
    const dt = new g.DataTransfer();
    dt.items.add(fichier);

    const e = el as Cible & { type?: string; files?: unknown; querySelector?: (s: string) => unknown };
    const input = (e.type === "file" ? e
      : typeof e.querySelector === "function" ? e.querySelector('input[type="file"]')
      : null) as (Cible & { files?: unknown }) | null;
    if (input) {
      input.files = dt.files;
      if (typeof input.dispatchEvent !== "function") return { ok: false, raison: "champ fichier inutilisable" };
      emettre(input, "input");
      emettre(input, "change");
      return { ok: true };
    }
    const { x: clientX, y: clientY } = centreDe(e);
    for (const t of ["dragenter", "dragover", "drop"]) {
      if (!emettre(e, t, { clientX, clientY, dataTransfer: dt })) return { ok: false, raison: "zone de dépôt inutilisable" };
    }
    return { ok: true };
  } catch {
    return { ok: false, raison: "le dépôt du fichier a échoué" };
  }
}

/**
 * Compte - appelle l'adaptateur du site (`ReglagesGuideClient.changerCompte`) puis recharge
 * la page (`recharger`, injectable). L'appelant a déjà marqué l'étape jouée (cf. "aller").
 * Ne lève jamais ; sans adaptateur, ou si l'adaptateur échoue, rien n'est rechargé.
 */
export async function appliquerCompte(
  compte: string | undefined,
  changerCompte?: (compte: string) => Promise<boolean | void> | boolean | void,
  recharger: () => void = () => { if (typeof location !== "undefined") location.reload(); },
): Promise<ResultatGeste> {
  if (!compte || typeof compte !== "string") return { ok: false, raison: 'geste "compte" sans compte' };
  if (typeof changerCompte !== "function") return { ok: false, raison: "changement de compte non prévu par ce site" };
  try {
    if ((await changerCompte(compte)) === false) return { ok: false, raison: "le changement de compte a échoué" };
  } catch {
    return { ok: false, raison: "le changement de compte a échoué" };
  }
  try { recharger(); } catch { return { ok: false, raison: "rechargement impossible" }; }
  return { ok: true };
}

/** L'élément qui reçoit Échap / le clic dans le vide quand le geste n'a pas de `cible`. */
function cibleParDefaut(geste: GuideGeste, doc: Document): Element | null {
  if (geste.type === "touche") {
    const actif = doc.activeElement;
    return actif && actif !== doc.body ? actif : doc.body;
  }
  return doc.body ?? null;
}

/**
 * Joue un geste. Ne lève JAMAIS — toute anomalie (cible introuvable, API indisponible,
 * sélecteur invalide) rend `{ ok: false, raison }` plutôt qu'une exception qui
 * traverserait React jusqu'à la page d'erreur.
 *
 * `doc` et `resolve` sont injectables (mêmes idiomes que `resolveTarget` et le reste du
 * module `guide-geometry.ts`) pour rester testables sans navigateur réel ; en production,
 * l'appelant passe toujours `document`.
 */
export function jouerGeste(
  geste: GuideGeste,
  doc: Document,
  ciblesRepli: readonly string[] = [],
  resolve: typeof resolveTarget = resolveTarget,
  ancetresReplies: readonly string[] = [],
): ResultatGeste {
  try {
    if (geste.type === "aller") {
      if (!geste.url) return { ok: false, raison: 'geste "aller" sans url' };
      // Cf. bandeau de tête : marquer l'étape jouée est la responsabilité de L'APPELANT,
      // AVANT cet appel — la navigation décharge la page tout de suite après.
      if (typeof location === "undefined" || typeof location.assign !== "function") {
        return { ok: false, raison: "navigation indisponible" };
      }
      location.assign(geste.url);
      return { ok: true };
    }

    if (geste.type === "retour") {
      // Même règle que "aller" : l'appelant a déjà marqué l'étape jouée.
      if (typeof history === "undefined" || typeof history.back !== "function") {
        return { ok: false, raison: "retour arrière indisponible" };
      }
      history.back();
      return { ok: true };
    }

    const selecteurs = selecteursGeste(geste, ciblesRepli);
    const el = gesteSansCible(geste)
      ? cibleParDefaut(geste, doc)
      : resolve(selecteurs, doc, undefined, ancetresReplies as string[]);
    if (!el) return geste.siPresent ? { ok: true } : { ok: false, raison: "cible introuvable" };

    if (geste.type === "clic") return appliquerClic(el);
    if (geste.type === "saisie") return appliquerSaisie(el, geste.valeur ?? "");
    if (geste.type === "touche") return appliquerTouche(el, geste.touche ?? "Escape");
    if (geste.type === "survol") return appliquerSurvol(el, doc);
    if (geste.type === "clic-dehors") return appliquerClicDehors(el);
    if (geste.type === "fichier") return appliquerFichier(el, geste.fichier);
    if (geste.type === "glisser") return { ok: false, raison: "glisser se joue avec jouerGesteAttendu" };
    if (geste.type === "compte") return { ok: false, raison: "compte se joue avec jouerGesteAttendu" };

    // Exhaustivité : `GuideGeste["type"]` n'a que ces valeurs ; un futur ajout de
    // type qui oublierait de l'implémenter ici échoue PROPREMENT plutôt que silencieux.
    return { ok: false, raison: `type de geste inconnu : ${(geste as GuideGeste).type}` };
  } catch {
    return { ok: false, raison: "le geste a échoué" };
  }
}

/**
 * Comme `jouerGeste`, mais attend la fin des gestes qui prennent du temps (le glisser-déposer
 * se joue en plusieurs pas). C'est elle que le curseur animé appelle. Ne lève JAMAIS.
 */
export async function jouerGesteAttendu(
  geste: GuideGeste,
  doc: Document,
  ciblesRepli: readonly string[] = [],
  resolve: typeof resolveTarget = resolveTarget,
  ancetresReplies: readonly string[] = [],
  changerCompte?: (compte: string) => Promise<boolean | void> | boolean | void,
  recharger?: () => void,
): Promise<ResultatGeste> {
  if (geste.type === "compte") return appliquerCompte(geste.compte, changerCompte, recharger);
  if (geste.type !== "glisser") return jouerGeste(geste, doc, ciblesRepli, resolve, ancetresReplies);
  try {
    if (!geste.vers) return { ok: false, raison: 'geste "glisser" sans destination (vers)' };
    const source = resolve(selecteursGeste(geste, ciblesRepli), doc, undefined, ancetresReplies as string[]);
    if (!source) return geste.siPresent ? { ok: true } : { ok: false, raison: "cible introuvable" };
    const dest = resolve([geste.vers], doc, undefined, ancetresReplies as string[]);
    if (!dest) return { ok: false, raison: "endroit où déposer introuvable" };
    return await appliquerGlisser(source, dest, doc);
  } catch {
    return { ok: false, raison: "le geste a échoué" };
  }
}
