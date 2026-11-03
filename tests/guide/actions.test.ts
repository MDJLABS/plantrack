// tests/guide/actions.test.ts — etatGuides/consignerPoint/consignerGuide (guide-actions.ts).
//
// Utilise un dossier TEMPORAIRE (mkdtemp) comme « racine du dépôt » (process.chdir) —
// jamais le vrai .planning de PlanTrack. GUIDE_TEST_ADMIN pilote la porte estAdmin() du
// témoin (tests/guide/fixtures/guide-reglages-serveur.ts), sans vraie session.
//
// EXÉCUTION :
//   node --experimental-strip-types --import ./tests/guide/support/register.mjs \
//     tests/guide/actions.test.ts

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
async function step(n: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log("ok -", n);
  } catch (e) {
    console.error("FAIL -", n, "\n", e);
    process.exitCode = 1;
  }
}

// Racine temporaire AVANT d'importer guide-actions.ts : racineDuDepot() lit process.cwd()
// à chaque appel, mais autant partir d'un dossier propre dès le départ.
// d172 : jamais de message au vrai poste depuis ces tests (cf. avertir.test.ts).
process.env.GUIDE_AVERTIR = "0";
const racine = await mkdtemp(join(tmpdir(), "plantrack-guide-actions-"));
await mkdir(join(racine, ".planning"), { recursive: true });
process.chdir(racine);

const { etatGuides, consignerPoint, consignerGuide } = await import(
  "../../.claude/hooks/plantrack_guide/lib/guide/guide-actions.ts"
);
const { appelsApresConsigne } = await import("./fixtures/guide-reglages-serveur.ts");

await step("instance sans GUIDE_ACTIF=1 → muet même pour un admin", async () => {
  delete process.env.GUIDE_ACTIF;
  process.env.GUIDE_TEST_ADMIN = "1";
  assert.equal(await etatGuides(), null);
  const r = await consignerPoint("essai", "x", "ok");
  assert.notEqual(r.error, null);
});
process.env.GUIDE_ACTIF = "1";

await step("hors admin (GUIDE_TEST_ADMIN=0) → etatGuides rend null", async () => {
  process.env.GUIDE_TEST_ADMIN = "0";
  assert.equal(await etatGuides(), null);
});

await step("hors admin → consignerPoint refuse (jamais de verdict posé)", async () => {
  process.env.GUIDE_TEST_ADMIN = "0";
  const r = await consignerPoint("temoin-second", "q1", "ok");
  assert.match(r.error ?? "", /admin/);
});

process.env.GUIDE_TEST_ADMIN = "1";

await step("admin, rien consigné → les témoins sont a_traiter", async () => {
  const etat = await etatGuides();
  assert.ok(etat);
  const second = etat!.find((g) => g.id === "temoin-second");
  assert.equal(second?.statut, "a_traiter");
  assert.equal(second?.faits, 0);
});

await step("scénario inconnu → consignerPoint refuse", async () => {
  const r = await consignerPoint("inconnu", "x", "ok");
  assert.match(r.error ?? "", /inconnu/);
});

await step("étape inconnue → consignerPoint refuse", async () => {
  const r = await consignerPoint("temoin-second", "zzz", "ok");
  assert.match(r.error ?? "", /inconnue/);
});

await step("consignerPoint ok → etatGuides reflète le point (en_cours, pas encore fini)", async () => {
  const r = await consignerPoint("temoin-second", "q1", "ok", "tout bon");
  assert.equal(r.error, null);
  const etat = await etatGuides();
  const second = etat!.find((g) => g.id === "temoin-second");
  assert.equal(second?.faits, 1);
  assert.equal(second?.statut, "en_cours");
  assert.deepEqual(second?.verdicts.q1?.v, "ok");
});

await step("consignerGuide (scénario complet, tout ok) → valide, fini posé, apresConsigne appelé", async () => {
  appelsApresConsigne.length = 0;
  const r = await consignerGuide("temoin-second");
  assert.equal(r.error, null);
  assert.equal(r.statut, "valide");
  const etat = await etatGuides();
  const second = etat!.find((g) => g.id === "temoin-second");
  assert.equal(second?.statut, "ok");
  assert.equal(appelsApresConsigne.length, 1);
  assert.equal(appelsApresConsigne[0].statut, "valide");
  const journal = await readFile(join(racine, ".planning", "retours-tests.md"), "utf8");
  assert.match(journal, /VALIDÉ/);
});

await step("consignerGuide sur un scénario encore incomplet → statut en-cours, rien écrit", async () => {
  const r = await consignerGuide("temoin-principal");
  assert.equal(r.error, null);
  assert.equal(r.statut, "en-cours");
});

await step("un point ko sur un scénario complet → consignerGuide rend a-revoir", async () => {
  await consignerPoint("temoin-geste", "r1", "ok");
  await consignerPoint("temoin-geste", "r2", "ko", "le bouton ne répond pas");
  appelsApresConsigne.length = 0;
  const r = await consignerGuide("temoin-geste");
  assert.equal(r.statut, "a-revoir");
  assert.equal(appelsApresConsigne[0].statut, "a-revoir");
  assert.deepEqual(appelsApresConsigne[0].ko.map((k: { id: string }) => k.id), ["r2"]);
});

console.log(`\n${passed} assertions vertes`);
