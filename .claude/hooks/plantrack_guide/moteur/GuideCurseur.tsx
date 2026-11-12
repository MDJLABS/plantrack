"use client";
/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */

/* ==============================================================================
 * Guide de test intégré (Checker) : curseur animé qui joue les gestes d'une étape à la
 * place de Mariella.
 *
 * Pour chaque geste, à la suite (d216 : « écrire la demande » puis « toucher Envoyer ») :
 * glisse jusqu'au centre de la cible (transition CSS ~700 ms), fait un petit « clic »
 * visuel (léger rétrécissement), puis appelle `jouerGeste` (`@/lib/guide/guide-geste.ts`).
 * Entre deux gestes, une courte pause laisse la page réagir (un bouton Envoyer qui ne
 * s'active qu'une fois le champ rempli) ; la cible du geste suivant n'est cherchée
 * qu'APRÈS cette pause. La suite s'arrête au premier échec, dont la raison remonte.
 * Mariella n'a plus qu'à juger le résultat.
 *
 * `prefers-reduced-motion: reduce` → aucune animation : position et absence de transition
 * posées dans le même rendu, le geste est joué tout de suite.
 *
 * Type "aller" (navigation) : rien à encadrer, le geste part directement. C'est toujours
 * le dernier de la suite (`gestesEtape` coupe après lui) : la page se décharge.
 *
 * ⚠️ `onAvantAction` : appelé UNE fois, juste avant le premier `jouerGeste`. L'appelant y
 * marque l'étape jouée et persiste la progression (une navigation décharge la page tout
 * de suite après ; perdre cette écriture ferait rejouer les gestes en boucle).
 *
 * `#guide-curseur` : id stable (auto-vérification, inspection humaine).
 *
 * `ancetresReplies` (réglages CLIENT du site, `guide-reglages.ts`) : même garde que les
 * `resolveTarget` de `GuideDeTest.tsx`, pour ne jamais viser un élément caché sous un
 * ancêtre replié.
 * ============================================================================== */

import { useEffect, useRef, useState } from "react";
import { resolveTarget } from "./guide-geometry";
import { jouerGeste, selecteursGeste, type ResultatGeste } from "./guide-geste";
import type { GuideGeste } from "./types";

/** Durée du glissé : assez lent pour être SUIVI du regard, assez rapide pour ne pas traîner. */
const DUREE_GLISSE_MS = 700;
/** Durée du petit « clic » visuel une fois arrivé : un accent, pas une pause. */
const DUREE_CLIC_MS = 160;
/** Pause entre deux gestes : le temps que React rende l'effet du précédent. */
const PAUSE_ENTRE_GESTES_MS = 450;
/** Au-dessus de `#guide-overlay` (Z = 2147483000 dans `GuideDeTest.tsx`). */
const Z_CURSEUR = 2147483001;

/** La position du curseur en coordonnées écran (`position: fixed`), centre de l'icône. */
type Point = { x: number; y: number };

export function GuideCurseur({
  depart,
  gestes,
  ciblesRepli = [],
  ancetresReplies = [],
  onAvantAction,
  onJoue,
}: {
  /** Point de départ du glissé : en pratique, le centre de la bulle. */
  depart: Point;
  /** Gestes de l'étape, dans l'ordre (`gestesEtape`). */
  gestes: GuideGeste[];
  /** `cibles` de l'étape : repli si `geste.cible` est absent ou ne résout rien. */
  ciblesRepli?: string[];
  /** Réglages CLIENT du site : cf. bandeau de tête. */
  ancetresReplies?: string[];
  /** Appelé une fois, juste avant le premier `jouerGeste` : cf. bandeau de tête. */
  onAvantAction: () => void;
  /** Appelé une fois (et une seule) : ok si tous les gestes ont réussi, sinon le premier échec. */
  onJoue: (resultat: ResultatGeste) => void;
}) {
  const [pos, setPos] = useState<Point>(depart);
  const [clic, setClic] = useState(false);
  const [sansTransition, setSansTransition] = useState(false);
  const [visible, setVisible] = useState(gestes[0]?.type !== "aller");
  // Garde contre un double effet (StrictMode en dev) : un geste ne part jamais deux fois.
  // `prochain` retient le premier geste pas encore joué : un remontage reprend la suite LÀ,
  // sans rejouer ni abandonner les gestes restants (b28) ; `fini` ferme la porte au résultat.
  const prochain = useRef(0);
  const avantFait = useRef(false);
  const fini = useRef(false);

  useEffect(() => {
    if (fini.current) return;

    // StrictMode monte, DÉMONTE puis remonte l'effet : le nettoyage annule les minuteurs.
    let annule = false;
    const minuteurs: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;
    const attendre = (ms: number, fn: () => void) => { minuteurs.push(setTimeout(fn, ms)); };

    let motionReduite = false;
    try {
      motionReduite = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      // API indisponible : on se comporte comme si le mouvement était acceptable.
    }

    const rendre = (res: ResultatGeste) => { fini.current = true; onJoue(res); };

    const jouer = (geste: GuideGeste, i: number): ResultatGeste => {
      if (!avantFait.current) { avantFait.current = true; onAvantAction(); }
      prochain.current = i + 1;
      return jouerGeste(geste, document, ciblesRepli, undefined, ancetresReplies);
    };

    const suivant = (i: number) => {
      if (annule) return;
      if (i >= gestes.length) { rendre({ ok: true }); return; }
      const geste = gestes[i];

      if (geste.type === "aller") {
        setVisible(false);
        rendre(jouer(geste, i)); // dernier geste de la suite, cf. `gestesEtape`
        return;
      }

      // La cible est cherchée MAINTENANT, après que la page a réagi au geste précédent.
      const el = resolveTarget(selecteursGeste(geste, ciblesRepli), document, undefined, ancetresReplies);
      if (!el) {
        // Invariant 2 du guide : ne jamais prétendre avoir atteint une cible absente.
        rendre({ ok: false, raison: "cible introuvable" });
        return;
      }
      const r = el.getBoundingClientRect();
      const centre: Point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      setVisible(true);
      setClic(false);

      const conclure = () => {
        if (annule) return;
        const res = jouer(geste, i);
        if (!res.ok) { rendre(res); return; }
        if (i + 1 >= gestes.length) { rendre(res); return; }
        attendre(PAUSE_ENTRE_GESTES_MS, () => suivant(i + 1));
      };

      if (motionReduite) {
        setSansTransition(true);
        setPos(centre);
        conclure();
        return;
      }
      // Un rAF : laisser le rendu courant se faire avant de viser `centre`, sinon le
      // navigateur n'a pas de frame de départ à transitionner.
      raf = requestAnimationFrame(() => setPos(centre));
      attendre(DUREE_GLISSE_MS, () => setClic(true));
      attendre(DUREE_GLISSE_MS + DUREE_CLIC_MS, conclure);
    };

    suivant(prochain.current);

    return () => {
      annule = true;
      cancelAnimationFrame(raf);
      minuteurs.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un seul passage par montage, cf. `prochain`
  }, []);

  if (!visible) return null; // geste "aller" : rien à encadrer

  return (
    <div
      id="guide-curseur"
      aria-hidden="true"
      style={{
        position: "fixed",
        top: pos.y,
        left: pos.x,
        zIndex: Z_CURSEUR,
        pointerEvents: "none", // même invariant que #guide-overlay : ne bloque jamais la page
        transform: `translate(-50%, -50%) scale(${clic ? 0.82 : 1})`,
        transition: sansTransition
          ? "none"
          : `top ${DUREE_GLISSE_MS}ms ease, left ${DUREE_GLISSE_MS}ms ease, transform ${DUREE_CLIC_MS}ms ease`,
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,.5))",
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Flèche de curseur classique, pointe en haut-gauche. */}
        <path
          d="M4 2 L4 20 L9 15.5 L12.5 21.5 L15.5 20 L12 14 L19 14 Z"
          fill="#F3EEE6"
          stroke="#2A2724"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
