// tests/guide/support/resolve-ts.mjs
//
// POURQUOI CE FICHIER : le moteur `guide/` (`.claude/hooks/plantrack_guide/lib/guide/*.ts`)
// est vendu tel quel dans chaque site, où c'est NEXT (bundler, `moduleResolution: "bundler"`)
// qui résout les imports relatifs SANS extension (`./guide-geometry`, `./types`) — convention
// du reste du dépôt, jamais changée pour les tests. `node --experimental-strip-types` fait une
// résolution ESM stricte qui l'ignore : sans ce hook, `ERR_MODULE_NOT_FOUND` dès le premier
// import transitif (mesuré sur guide-geste.ts → ./guide-geometry).
//
// Ce loader ne traduit QUE les specifiers relatifs (`./…`, `../…`) sans extension déjà
// résolvable : il essaie `.ts`, `.tsx`, `.js`, `.mjs` puis `/index.ts` avant de laisser Node
// produire son erreur habituelle. Il ne modifie aucun fichier de `plantrack_guide/` — ceux-ci
// gardent leurs imports verbatim, identiques à la convention Next du reste du dépôt.
//
// ⚠️ Cas particulier : `guide-visite.ts` importe `./scenarios.ts` — un registre qui n'existe
// PAS dans ce dépôt (cf. d34/d35 : le moteur vendu ici est générique, les scénarios sont
// propres à CHAQUE SITE qui en embarque un). Pour exécuter ce fichier en test depuis
// PlanTrack lui-même, on redirige CE specifier précis vers un témoin local
// (`tests/guide/fixtures/scenarios.ts`) — jamais vers un fichier du moteur source.
//
// Même cas pour `guide-actions.ts`, qui importe `./guide-reglages.ts` et
// `./guide-reglages-serveur.ts` — eux aussi PROPRES À CHAQUE SITE (comme `scenarios.ts`,
// jamais dans le moteur). Redirigés vers `tests/guide/fixtures/guide-reglages(-serveur).ts`.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];
const MOTEUR = "/.claude/hooks/plantrack_guide/lib/guide/";
const TEMOINS = new Map([
  ["./scenarios", "../fixtures/scenarios.ts"],
  ["./scenarios.ts", "../fixtures/scenarios.ts"],
  ["./guide-reglages", "../fixtures/guide-reglages.ts"],
  ["./guide-reglages.ts", "../fixtures/guide-reglages.ts"],
  ["./guide-reglages-serveur", "../fixtures/guide-reglages-serveur.ts"],
  ["./guide-reglages-serveur.ts", "../fixtures/guide-reglages-serveur.ts"],
]);

export async function resolve(specifier, context, nextResolve) {
  if (TEMOINS.has(specifier) && context.parentURL?.includes(MOTEUR)) {
    return nextResolve(new URL(TEMOINS.get(specifier), import.meta.url).href, context);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parent = context.parentURL;
    if (parent) {
      for (const ext of EXTENSIONS) {
        const candidat = new URL(specifier + ext, parent);
        const chemin = fileURLToPath(candidat);
        if (existsSync(chemin) && (ext !== "" || statSync(chemin).isFile())) {
          return nextResolve(candidat.href, context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
