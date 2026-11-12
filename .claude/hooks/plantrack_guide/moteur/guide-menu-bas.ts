/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */
/* Guide de test : hauteur du menu fixé en bas de l'écran (au pouce), pour que la pastille et
 * le lanceur se posent AU-DESSUS au lieu de le cacher (b42 ProRent, 12/11 : la pastille
 * masquait Litiges/Contenu/Outils du menu admin). Moteur commun : aucun site n'a à déclarer
 * quoi que ce soit, même si `data-menu-bas` sur le menu est le repère le plus sûr. Détecte
 * tout élément visible, fixé ou collant, posé contre le bas de la fenêtre et pas plus haut
 * qu'un tiers d'écran (une barre, pas une boîte de dialogue). */
"use client";

import { useEffect, useState } from "react";

const CANDIDATS = '[data-menu-bas], nav, footer, [role="navigation"], [role="tablist"]';

/** Le guide lui-même ne compte jamais (sa carte se pose aussi en bas). */
function estDuGuide(el: Element): boolean {
  return !!el.closest('[id^="guide-"]');
}

export function mesurerMenuBas(): number {
  if (typeof window === "undefined") return 0;
  const h = window.innerHeight;
  let decalage = 0;
  document.querySelectorAll(CANDIDATS).forEach((el) => {
    if (estDuGuide(el)) return;
    const st = getComputedStyle(el);
    if (st.position !== "fixed" && st.position !== "sticky") return;
    if (st.display === "none" || st.visibility === "hidden") return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.height > h / 3) return;
    if (r.bottom < h - 2) return; // pas collé au bas de l'écran
    decalage = Math.max(decalage, Math.ceil(h - r.top));
  });
  return decalage;
}

/** Décalage à ajouter au `bottom` d'un élément fixé du guide (0 sans menu du bas). */
export function useDecalageMenuBas(): number {
  const [decalage, setDecalage] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const relire = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => setDecalage(mesurerMenuBas()));
    };
    relire();
    window.addEventListener("resize", relire);
    // Changement de page ou menu qui apparaît : le DOM bouge, on remesure (au plus 1 fois par image).
    const obs = new MutationObserver(relire);
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", relire); obs.disconnect(); };
  }, []);
  return decalage;
}
