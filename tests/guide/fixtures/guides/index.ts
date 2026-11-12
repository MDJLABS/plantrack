/* tests/guide/fixtures/guides/index.ts : témoin de `lib/guide/guides/index.ts` (généré par
 * PlanTrack dans un vrai site). Vide par défaut ; guides-json.test.ts teste la conversion
 * directement, sans passer par ce registre. */
export const GUIDES_JSON: Record<string, unknown> = {
  "temoin-json": {
    titre: "Témoin JSON",
    page: "/temoin",
    version: "2026-11-12",
    points: [
      { titre: "Premier", faire: "Touche.", attendu: "Ça s'ouvre.", cible: "#zone-temoin", clic: "#bouton-temoin" },
      { titre: "Second", faire: "Regarde.", attendu: "Rien." },
    ],
  },
  "temoin-casse": { titre: "Sans points", page: "/x" },
};
