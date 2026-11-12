// tests/guide/etat.test.ts — statut d'un scénario déduit de son état stocké
// (`guide-etat.ts`) : statuts, relivraison (changement de `scenario.date`), clé forgée.
//
// Pur, aucun DOM, aucun `node:fs` — directement les scénarios témoins de
// tests/guide/fixtures/scenarios.ts.
//
// EXÉCUTION :
//   node --experimental-strip-types --import ./tests/guide/support/register.mjs \
//     tests/guide/etat.test.ts

import assert from "node:assert/strict";
import {
  calculerStatut, estEncoreATraiter, faitsPour, type EtatScenarioStocke,
} from "../../.claude/hooks/plantrack_guide/moteur/guide-etat";
import { SCENARIOS } from "./fixtures/scenarios";

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

// "temoin-second" n'a qu'UNE étape (q1), date "2026-10-28" — pratique pour les cas
// "tout répondu". "temoin-principal" en a SIX (p1..p6) — pratique pour "certains répondus".
const second = SCENARIOS["temoin-second"];
const principal = SCENARIOS["temoin-principal"];

step("aucun état stocké → a_traiter", () => {
  assert.equal(calculerStatut(second, undefined), "a_traiter");
  assert.equal(faitsPour(second, undefined), 0);
});

step("état stocké mais verdicts vides → a_traiter", () => {
  const etat: EtatScenarioStocke = { date: second.date, verdicts: {} };
  assert.equal(calculerStatut(second, etat), "a_traiter");
  assert.equal(faitsPour(second, etat), 0);
});

step("certains points répondus, pas tous → en_cours", () => {
  const etat: EtatScenarioStocke = {
    date: principal.date,
    verdicts: { p1: { v: "ok", a: "2026-10-31T10:00:00.000Z" }, p2: { v: "ok", a: "2026-10-31T10:00:01.000Z" } },
  };
  assert.equal(calculerStatut(principal, etat), "en_cours");
  assert.equal(faitsPour(principal, etat), 2);
});

step("tous les points répondus mais PAS consigné (fini absent) → en_cours (pas encore ok/ko)", () => {
  const etat: EtatScenarioStocke = { date: second.date, verdicts: { q1: { v: "ok", a: "2026-10-31T10:00:00.000Z" } } };
  assert.equal(calculerStatut(second, etat), "en_cours");
  assert.equal(faitsPour(second, etat), 1);
});

step("tous répondus, tous ok, consigné → ok", () => {
  const etat: EtatScenarioStocke = {
    date: second.date,
    verdicts: { q1: { v: "ok", a: "2026-10-31T10:00:00.000Z" } },
    fini: "2026-10-31T10:00:05.000Z",
  };
  assert.equal(calculerStatut(second, etat), "ok");
  assert.equal(estEncoreATraiter("ok"), false);
});

step("tous répondus, au moins un ko, consigné → ko", () => {
  const etat: EtatScenarioStocke = {
    date: principal.date,
    verdicts: Object.fromEntries(
      principal.etapes.map((e, i) => [e.id, { v: i === 2 ? "ko" : "ok", a: "2026-10-31T10:00:00.000Z" } as const]),
    ),
    fini: "2026-10-31T10:00:05.000Z",
  };
  assert.equal(calculerStatut(principal, etat), "ko");
  assert.equal(estEncoreATraiter("ko"), false, '"ko" sort de la liste "encore à traiter" (d138)');
});

step("relivraison : date stockée ≠ date du scénario → repart à zéro, même avec un état 'fini'", () => {
  const etat: EtatScenarioStocke = {
    date: "2026-01-01", // ancienne livraison
    verdicts: { q1: { v: "ko", a: "2026-01-01T10:00:00.000Z" } },
    fini: "2026-01-01T10:00:05.000Z",
  };
  assert.equal(calculerStatut(second, etat), "a_traiter");
  assert.equal(faitsPour(second, etat), 0);
  assert.equal(estEncoreATraiter(calculerStatut(second, etat)), true);
});

step("clé forgée dans verdicts (__proto__) → ignorée, jamais comptée, jamais de pollution de prototype", () => {
  // Construite depuis une CHAÎNE JSON (comme un vrai fichier .planning/guides-etat.json
  // trafiqué) : `JSON.parse` installe alors "__proto__" comme une PROPRIÉTÉ PROPRE ordinaire
  // (CreateDataProperty), jamais comme le vrai prototype — contrairement à la syntaxe
  // littérale `{ __proto__: ... }` qui, elle, ne produit même pas de propriété propre.
  // On vérifie ici que calculerStatut ne lit JAMAIS cette clé : il n'énumère jamais les
  // clés de `verdicts`, il ne lit que `verdicts[e.id]` pour les ids du catalogue.
  const brut = JSON.parse(
    `{"date":"${second.date}","verdicts":{"__proto__":{"v":"ok","a":"x"},"constructor":{"v":"ok","a":"x"}}}`,
  ) as EtatScenarioStocke;
  // Le scénario "second" n'a qu'une étape "q1" — ni __proto__ ni constructor n'en font partie.
  assert.equal(calculerStatut(second, brut), "a_traiter");
  assert.equal(faitsPour(second, brut), 0);
  assert.equal(Object.getPrototypeOf({}), Object.prototype, "le prototype global n'a pas été pollué");
});

step("clé forgée mêlée à un vrai id (JSON.parse, comme lu du disque) → seul le vrai id compte", () => {
  const etat = JSON.parse(
    `{"date":"${second.date}","verdicts":{"__proto__":{"v":"ok","a":"x"},"q1":{"v":"ok","a":"2026-10-31T10:00:00.000Z"}},"fini":"2026-10-31T10:00:05.000Z"}`,
  ) as EtatScenarioStocke;
  assert.equal(faitsPour(second, etat), 1);
  assert.equal(calculerStatut(second, etat), "ok");
});

console.log(`\n${passed} assertions vertes`);
