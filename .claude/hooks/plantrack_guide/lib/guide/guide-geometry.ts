/* ==============================================================================
 * Guide de test intégré — géométrie PURE (surlignage + placement de la bulle).
 * Porté de Prolearn (`app/lib/guide/guide-geometry.ts`). Séparé du composant pour être
 * testable sans navigateur.
 *
 * Adaptation MiamBoost : `resolveTarget` ne connaît plus `.tn-childwrap.collapsed` (une
 * classe de l'arbre Parcours de Prolearn, sans équivalent ici) — la détection d'un élément
 * masqué repose uniquement sur sa taille mesurée (largeur/hauteur nulles), ce qui couvre
 * `display:none`, `visibility:hidden` et tout ancêtre replié quel que soit son nom de classe :
 * plus général, donc valable sur n'importe quelle page du dépôt sans entretien.
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
 * scénario ne doit pas faire tomber tout le guide.
 */
export function resolveTarget(
  selecteurs: string[],
  doc: Document,
  mesure: (el: Element) => Rect = mesureDom,
): Element | null {
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
      const r = mesure(el);
      if (r.w > 0 && r.h > 0) return el;
    }
  }
  return null;
}
