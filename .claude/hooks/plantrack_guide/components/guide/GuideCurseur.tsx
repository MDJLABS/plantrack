"use client";

/* ==============================================================================
 * Guide de test intégré — curseur animé qui joue un geste à la place de Mariella.
 *
 * Glisse depuis la bulle jusqu'au centre de la cible (transition CSS ~700 ms), fait un
 * petit « clic » visuel (léger rétrécissement), puis appelle `jouerGeste`
 * (`@/lib/guide/guide-geste.ts`). Mariella n'a plus qu'à juger le résultat ✓/✗.
 *
 * `prefers-reduced-motion: reduce` → aucune animation : la position cible et l'absence de
 * transition sont posées dans le MÊME effet, donc dans le même rendu — il n'y a jamais de
 * frame intermédiaire à `depart` à transitionner. Le geste est joué tout de suite après.
 *
 * Type "aller" (navigation) : rien à encadrer — on ne fait pas « glisser » un curseur
 * vers une URL. Ce composant ne rend alors rien (`null`) et appelle `jouerGeste`
 * directement. C'est malgré tout par LUI que ça passe (plutôt que par l'appelant) : un
 * seul endroit décide quand le geste part, qu'il y ait une animation à montrer ou pas.
 *
 * ⚠️ `onAvantAction` : `jouerGeste` (cf. son bandeau de tête) exige que l'étape soit
 * marquée JOUÉE et la progression PERSISTÉE avant qu'il ne s'exécute — une navigation
 * décharge la page tout de suite après, et perdre cette écriture ferait rejouer le geste
 * en boucle à chaque retour sur l'étape. `jouerGeste` lui-même n'a aucune idée de ce
 * qu'est une « progression » (module pur, sans React) : c'est ce composant qui porte la
 * séquence exacte (marquer → jouer), via ce callback appelé juste avant `jouerGeste`,
 * pour TOUT type de geste — pas seulement "aller" — par cohérence et parce qu'un clic/une
 * saisie peut elle aussi déclencher une navigation côté page (un bouton qui redirige).
 *
 * `#guide-curseur` : id stable, pour que la visite guidée puisse un jour s'auto-vérifier
 * (et pour qu'un humain qui inspecte la page retrouve facilement ce qui bouge).
 * ============================================================================== */

import { useEffect, useRef, useState } from "react";
import { resolveTarget } from "@/lib/guide/guide-geometry";
import { jouerGeste, selecteursGeste, type ResultatGeste } from "@/lib/guide/guide-geste";
import type { GuideGeste } from "@/lib/guide/types";

/** Durée du glissé — alignée sur le ~700 ms demandé : assez lent pour être SUIVI du
 *  regard, assez rapide pour ne pas donner l'impression que le guide traîne. */
const DUREE_GLISSE_MS = 700;
/** Durée du petit « clic » visuel une fois arrivé — bref, c'est un ACCENT, pas une pause. */
const DUREE_CLIC_MS = 160;
/** Au-dessus de `#guide-overlay` (Z = 2147483000 dans `GuideDeTest.tsx`) : le curseur doit
 *  rester visible PAR-DESSUS le cadre de surlignage et la bulle. */
const Z_CURSEUR = 2147483001;

/** La position du curseur en coordonnées écran (`position: fixed`), centre de l'icône. */
type Point = { x: number; y: number };

export function GuideCurseur({
  depart,
  geste,
  ciblesRepli = [],
  onAvantAction,
  onJoue,
}: {
  /** Point de départ du glissé — en pratique, le centre de la bulle. */
  depart: Point;
  geste: GuideGeste;
  /** `cibles` de l'étape — repli si `geste.cible` est absent ou ne résout rien (même
   *  logique que `jouerGeste`, cf. `selecteursGeste`). */
  ciblesRepli?: string[];
  /** Appelé juste avant `jouerGeste` — cf. bandeau de tête : c'est ici que l'appelant doit
   *  marquer l'étape jouée et persister la progression. */
  onAvantAction: () => void;
  /** Appelé une fois (et une seule) avec le résultat du geste. */
  onJoue: (resultat: ResultatGeste) => void;
}) {
  const [pos, setPos] = useState<Point>(depart);
  const [clic, setClic] = useState(false);
  const [sansTransition, setSansTransition] = useState(false);
  // Garde contre un double effet (StrictMode en dev, ou un changement de deps imprévu) :
  // un geste — surtout "aller", qui NAVIGUE — ne doit jamais partir deux fois.
  const dejaJoue = useRef(false);

  useEffect(() => {
    if (dejaJoue.current) return;
    dejaJoue.current = true;

    const conclure = () => {
      onAvantAction();
      onJoue(jouerGeste(geste, document, ciblesRepli));
    };

    if (geste.type === "aller") {
      // Rien à montrer (cf. bandeau de tête) — on part directement.
      conclure();
      return;
    }

    const el = resolveTarget(selecteursGeste(geste, ciblesRepli), document);
    if (!el) {
      // Invariant 2 du guide (GuideDeTest.tsx) : ne jamais prétendre avoir atteint une
      // cible absente. On ne joue rien, et on le dit.
      onJoue({ ok: false, raison: "cible introuvable" });
      return;
    }

    const r = el.getBoundingClientRect();
    const centre: Point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };

    let motionReduite = false;
    try {
      motionReduite = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      // API indisponible (contexte restreint) : on se comporte comme si le mouvement
      // était acceptable, c'est le réglage le plus courant.
    }

    if (motionReduite) {
      // `sansTransition` ET `pos` posés dans le MÊME effet ⇒ même rendu ⇒ aucune frame
      // intermédiaire à `depart` ne peut être transitionnée (cf. bandeau de tête).
      setSansTransition(true);
      setPos(centre);
      conclure();
      return;
    }

    // Un rAF : laisser le PREMIER rendu se faire à `depart` avant de viser `centre`,
    // sinon le navigateur n'aurait jamais de frame de départ à transitionner depuis.
    const raf = requestAnimationFrame(() => setPos(centre));
    const timerClic = setTimeout(() => setClic(true), DUREE_GLISSE_MS);
    const timerAction = setTimeout(conclure, DUREE_GLISSE_MS + DUREE_CLIC_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timerClic);
      clearTimeout(timerAction);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un seul passage par montage, cf. `dejaJoue`
  }, []);

  if (geste.type === "aller") return null; // rien à encadrer, cf. bandeau de tête

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
        {/* Flèche de curseur classique, pointe en haut-gauche — orientation standard. */}
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
