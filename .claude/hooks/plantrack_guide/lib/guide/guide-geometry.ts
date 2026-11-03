/* ==============================================================================
 * Guide de test intégré — géométrie PURE (surlignage + placement de la bulle).
 * Porté de Prolearn (`app/lib/guide/guide-geometry.ts`). Séparé du composant pour être
 * testable sans navigateur.
 *
 * La détection d'un élément masqué repose d'abord sur sa taille mesurée (largeur/hauteur
 * nulles), ce qui couvre `display:none`, `visibility:hidden` et tout ancêtre replié quel que
 * soit son nom de classe — valable sur n'importe quelle page sans entretien.
 *
 * MAIS un ancêtre repliable (ex. l'arbre Parcours de ProLearn, `.tn-childwrap.collapsed`)
 * peut rester monté avec sa VRAIE hauteur — rien ne le distingue alors d'un élément visible
 * à la seule mesure. `ancetresReplies` (réglages du site, `guide-reglages.ts`) porte les
 * sélecteurs de ces ancêtres : un candidat qui en a un dans ses ancêtres est traité comme
 * non visible, exactement comme s'il avait une taille nulle (porté de Prolearn
 * `app/lib/guide/guide-geometry.ts`, généralisé — plus de classe en dur dans le moteur).
 * ============================================================================== */

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** Écart entre la bulle et la zone surlignée / les bords de l'écran. */
const MARGE = 12;

const borner = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * Où poser la bulle par rapport à la zone surlignée.
 *
 * Sous la cible par défaut ; au-dessus si ça déborderait par le bas — sinon Mariella
 * devrait faire défiler la page pour lire la consigne du geste qu'elle est en train de
 * faire. Dans tous les cas la bulle reste **entièrement dans l'écran** : une bulle à
 * moitié hors champ ne vaut pas mieux que pas de bulle.
 */
export function placeBubble(
  cible: Rect | null, bulle: Size, ecran: Size,
): { top: number; left: number; cote: "haut" | "bas" | "centre" } {
  const maxTop = ecran.h - bulle.h - MARGE;
  const maxLeft = ecran.w - bulle.w - MARGE;

  if (!cible) {
    return {
      top: borner((ecran.h - bulle.h) / 2, MARGE, maxTop),
      left: (ecran.w - bulle.w) / 2,
      cote: "centre",
    };
  }

  const left = borner(cible.x + cible.w / 2 - bulle.w / 2, MARGE, maxLeft);
  const dessous = cible.y + cible.h + MARGE;
  if (dessous + bulle.h <= ecran.h) return { top: dessous, left, cote: "bas" };

  const dessus = cible.y - MARGE - bulle.h;
  if (dessus >= 0) return { top: dessus, left, cote: "haut" };

  // Ni dessus ni dessous : la cible occupe (plus que) tout l'écran — typiquement une
  // ZONE entière et non une ligne. On la pose en bas, dans l'écran.
  return { top: borner(maxTop, MARGE, maxTop), left, cote: "bas" };
}

/** Mesure réelle d'un élément (défaut de `resolveTarget`). */
const mesureDom = (el: Element): Rect => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

/**
 * Premier sélecteur qui désigne un élément **réellement visible**.
 *
 * Les candidats vont du plus précis au plus général : une page réelle varie (le jeu de
 * données peut ne pas contenir l'élément cité), et se rabattre sur la zone parente vaut
 * mieux que ne rien montrer.
 *
 * On refuse toute taille nulle (largeur OU hauteur à 0) : c'est le signal générique d'un
 * élément non affiché, quelle qu'en soit la raison (`display:none`, ancêtre replié, zéro
 * résultat…). Encadrer un tel élément reviendrait à pointer du vide en affirmant « c'est
 * là » — exactement ce qu'une aide ne doit jamais faire.
 *
 * Un sélecteur invalide est ignoré plutôt que fatal : une faute de frappe dans un
 * scénario ne doit pas faire tomber tout le guide. Même tolérance pour `ancetresReplies` :
 * un sélecteur d'ancêtre invalide est ignoré (le candidat reste jugé sur sa seule taille).
 */
export function resolveTarget(
  selecteurs: string[],
  doc: Document,
  mesure: (el: Element) => Rect = mesureDom,
  ancetresReplies: string[] = [],
): Element | null {
  const dansUnAncetreReplie = (el: Element): boolean =>
    ancetresReplies.some((sel) => {
      try {
        return el.closest(sel) !== null;
      } catch {
        return false;
      }
    });

  for (const sel of selecteurs) {
    let candidats: Element[] = [];
    try {
      candidats = [...doc.querySelectorAll(sel)];
    } catch {
      continue;
    }
    // TOUS les éléments du sélecteur, pas seulement le premier : un scénario cible des
    // sélecteurs génériques et le premier du DOM peut très bien être masqué alors qu'un
    // autre est parfaitement visible.
    for (const el of candidats) {
      if (dansUnAncetreReplie(el)) continue;
      const r = mesure(el);
      if (r.w > 0 && r.h > 0) return el;
    }
  }
  return null;
}

/**
 * Où ranger la CARTE du guide pour qu'elle ne cache jamais la zone qu'elle montre (d172,
 * Mariella 03/11 : « s'il me montre un endroit qui se trouve derrière lui, le cadre du
 * guide doit se déplacer sur une autre partie de la page »).
 *
 * Au pouce, la carte occupe toute la largeur : en bas (sa place) ou en haut. Ailleurs,
 * elle tient dans un coin : bas-droite (sa place), puis les trois autres. Elle revient à
 * sa place dès qu'elle y est libre ; sinon elle GARDE la place actuelle tant qu'elle ne
 * recouvre pas la zone — pas de saut d'un coin à l'autre pour rien. Sinon, on prend la place
 * qui la recouvre le moins (la place d'origine d'abord, à égalité). `couvre` reste vrai
 * si même la meilleure place recouvre encore la zone : à l'appelant de faire défiler.
 */
export type PlaceCarte = "bas" | "haut" | "bd" | "bg" | "hd" | "hg";

const ORDRE_POUCE: PlaceCarte[] = ["bas", "haut"];
const ORDRE_COINS: PlaceCarte[] = ["bd", "bg", "hd", "hg"];
/** Écart laissé entre la carte et le bord de l'écran — le même que `carteStyle`. */
export const BORD_CARTE = 16;

/** Le rectangle qu'occuperait la carte à cette place. */
export function rectCarte(place: PlaceCarte, carte: Size, ecran: Size): Rect {
  if (place === "bas") return { x: 0, y: ecran.h - carte.h, w: ecran.w, h: carte.h };
  if (place === "haut") return { x: 0, y: 0, w: ecran.w, h: carte.h };
  const x = place === "bd" || place === "hd" ? ecran.w - BORD_CARTE - carte.w : BORD_CARTE;
  const y = place === "bd" || place === "bg" ? ecran.h - BORD_CARTE - carte.h : BORD_CARTE;
  return { x, y, w: carte.w, h: carte.h };
}

/** Surface commune à deux rectangles (0 s'ils ne se touchent pas). */
export function chevauchement(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function placerCarte(
  cible: Rect | null, carte: Size, ecran: Size, pouce: boolean, actuelle: PlaceCarte,
): { place: PlaceCarte; couvre: boolean } {
  const ordre = pouce ? ORDRE_POUCE : ORDRE_COINS;
  const depart = ordre.includes(actuelle) ? actuelle : ordre[0];
  if (!cible) return { place: depart, couvre: false };
  // Le cadre de surlignage déborde de 4 px autour de la zone (GuideDeTest.tsx) : il
  // compte, sinon la carte se poserait pile sur la bordure qui montre la zone.
  const zone = { x: cible.x - 6, y: cible.y - 6, w: cible.w + 12, h: cible.h + 12 };
  const gene = (p: PlaceCarte) => chevauchement(zone, rectCarte(p, carte, ecran));
  // Retour à sa place dès que la voie y est libre ; sinon on reste où l'on est tant que
  // ça ne gêne pas (pas de saut à chaque pixel de défilement).
  if (gene(ordre[0]) === 0) return { place: ordre[0], couvre: false };
  if (gene(depart) === 0) return { place: depart, couvre: false };
  let meilleure = ordre[0];
  for (const p of ordre) if (gene(p) < gene(meilleure)) meilleure = p;
  return { place: meilleure, couvre: gene(meilleure) > 0 };
}
