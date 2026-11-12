// tests/guide/guides-json.test.ts : conversion des guides JSON (Checker v2, d241, section 3)
// vers GuideScenario, fusion avec les scénarios du site, getScenario / indexDePoint.
//
// EXÉCUTION :
//   node --experimental-strip-types --import ./tests/guide/support/register.mjs \
//     tests/guide/guides-json.test.ts

import assert from "node:assert/strict";
import {
  convertirGuide, convertirGuides, fusionner, getScenario, indexDePoint, SCENARIOS,
} from "../../.claude/hooks/plantrack_guide/moteur/guides-json";

let passed = 0;
function step(n: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log("ok -", n);
  } catch (e) {
    console.error("FAIL -", n, "\n", e);
    process.exitCode = 1;
  }
}

const guide = {
  titre: "Réserver une soirée",
  page: "/soirees",
  version: "2026-11-12",
  points: [
    { id: "ouvrir", titre: "Ouvrir la fiche", faire: "Touche la première soirée.", attendu: "La fiche s'ouvre.",
      cible: "#soiree-1", clic: "#soiree-1" },
    { id: "email", titre: "Saisir l'e-mail", faire: "Le guide écrit ton e-mail.", attendu: "Le champ l'affiche.",
      cible: ["#email", "#formulaire"],
      gestes: [{ saisir: "#email", valeur: "essai@exemple.fr" }, { clic: "#envoyer" }] },
    { titre: "Aller au compte", faire: "Rien.", attendu: "Le compte s'ouvre.", aller: "/compte", url: "/soirees" },
    { titre: "Regarder", faire: "Regarde.", attendu: "Rien de spécial." },
  ],
};

step("conversion : champs, clic, gestes, aller, ids par défaut", () => {
  const s = convertirGuide("soirees", guide)!;
  assert.ok(s);
  assert.equal(s.id, "soirees");
  assert.equal(s.titre, "Réserver une soirée");
  assert.equal(s.date, "2026-11-12");
  assert.equal(s.page, "/soirees");
  assert.deepEqual(s.etapes.map((e) => e.id), ["ouvrir", "email", "p3", "p4"]);
  assert.deepEqual(s.etapes[0].geste, { type: "clic", cible: "#soiree-1" });
  assert.deepEqual(s.etapes[0].cibles, ["#soiree-1"]);
  assert.equal(s.etapes[0].action, "Touche la première soirée.");
  assert.deepEqual(s.etapes[1].cibles, ["#email", "#formulaire"]);
  assert.deepEqual(s.etapes[1].gestes, [
    { type: "saisie", cible: "#email", valeur: "essai@exemple.fr" },
    { type: "clic", cible: "#envoyer" },
  ]);
  assert.equal(s.etapes[1].geste, undefined);
  assert.deepEqual(s.etapes[2].geste, { type: "aller", url: "/compte" });
  assert.equal(s.etapes[2].url, "/soirees");
  assert.equal(s.etapes[3].geste, undefined);
  assert.equal(s.etapes[3].gestes, undefined);
});

step("version absente → date \"1\"", () => {
  const { version: _v, ...sans } = guide;
  assert.equal(convertirGuide("g", sans)!.date, "1");
});

step("guides invalides → null (titre, page, points, champ de point, ids en double, id de fichier)", () => {
  assert.equal(convertirGuide("g", null), null);
  assert.equal(convertirGuide("g", { ...guide, titre: "" }), null);
  assert.equal(convertirGuide("g", { ...guide, page: undefined }), null);
  assert.equal(convertirGuide("g", { ...guide, points: [] }), null);
  assert.equal(convertirGuide("g", { ...guide, points: [{ titre: "x", faire: "y" }] }), null);
  assert.equal(convertirGuide("g", { ...guide, points: [guide.points[0], guide.points[0]] }), null);
  assert.equal(convertirGuide("Mauvais_Id", guide), null);
});

step("convertirGuides : un guide invalide est ignoré avec un warn, les autres restent", () => {
  const avertis: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void avertis.push(a.join(" "));
  try {
    const tous = convertirGuides({ bon: guide, casse: { titre: "x" }, nul: null });
    assert.deepEqual(Object.keys(tous), ["bon"]);
  } finally {
    console.warn = warn;
  }
  assert.equal(avertis.length, 2);
  assert.match(avertis[0], /casse/);
  assert.deepEqual(convertirGuides(undefined), {});
});

step("fusion : le site et le JSON coexistent, le site l'emporte sur un id identique", () => {
  const json = { a: convertirGuide("a", guide)!, b: convertirGuide("b", guide)! };
  const site = { b: { ...json.b, titre: "Du site" }, c: { ...json.b, id: "c" } };
  const f = fusionner(site, json);
  assert.deepEqual(Object.keys(f).sort(), ["a", "b", "c"]);
  assert.equal(f.b.titre, "Du site");
  assert.deepEqual(Object.keys(fusionner(undefined, json)).sort(), ["a", "b"]);
});

step("registre du moteur (fixtures) : témoins du site + guide JSON, getScenario gardé", () => {
  assert.ok(SCENARIOS["temoin-principal"]);
  assert.ok(SCENARIOS["temoin-json"], "le guide JSON valide des fixtures est présent");
  assert.equal(SCENARIOS["temoin-casse"], undefined);
  assert.equal(getScenario("temoin-json")?.etapes.length, 2);
  assert.equal(getScenario("inconnu"), null);
  assert.equal(getScenario("__proto__"), null);
  assert.equal(getScenario("constructor"), null);
  assert.equal(getScenario(null), null);
});

step("indexDePoint", () => {
  const etapes = [{ id: "a" }, { id: "b" }];
  assert.equal(indexDePoint(etapes, "b"), 1);
  assert.equal(indexDePoint(etapes, "z"), null);
  assert.equal(indexDePoint(etapes, undefined), null);
});

console.log(`\n${passed} assertions vertes`);
