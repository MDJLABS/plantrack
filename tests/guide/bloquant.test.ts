// tests/guide/bloquant.test.ts : bouton « Bloquant » (Checker v2, d241). Un point "bloque"
// compte comme NON répondu ; un point retiré (corrigé par la session) puis rejoué ne fait
// pas perdre les ok déjà acquis ; consignerGuide n'est jamais appelé tant qu'il en reste.
//
// EXÉCUTION :
//   node --experimental-strip-types --import ./tests/guide/support/register.mjs \
//     tests/guide/bloquant.test.ts

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculerStatut, bloquesPour, dejaConsigne } from "../../.claude/hooks/plantrack_guide/moteur/guide-etat";
import { verdictScenario } from "../../.claude/hooks/plantrack_guide/moteur/guide-verdict";
import {
  chargerProgression, progressionDepuisServeur, reconcilierAvecServeur, serveurPrime, verdict, vide,
} from "../../.claude/hooks/plantrack_guide/moteur/guide-progress";
import { texteAvis } from "../../.claude/hooks/plantrack_guide/moteur/guide-avertir";
import { SCENARIOS } from "./fixtures/scenarios";

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

const principal = SCENARIOS["temoin-principal"]; // p1..p6
const ids = principal.etapes.map((e) => e.id);
const a = "2026-11-12T10:00:00.000Z";

await step("verdictScenario : bloque = non répondu, guide en cours", () => {
  const b = verdictScenario(principal.etapes, { p1: "ok", p2: "bloque", p3: "ok", p4: "ok", p5: "ok", p6: "ok" });
  assert.equal(b.statut, "en-cours");
  assert.equal(b.repondus, 5);
  assert.deepEqual(b.bloques.map((x) => x.id), ["p2"]);
  assert.deepEqual(b.manquants.map((x) => x.id), ["p2"]);
  assert.equal(b.enAttente, true);
});

await step("verdictScenario : un point simplement non vu n'est pas « en attente »", () => {
  const b = verdictScenario(principal.etapes, { p1: "ok", p2: "bloque" });
  assert.equal(b.enAttente, false);
  assert.equal(b.bloques.length, 1);
});

await step("calculerStatut : tout ok sauf un bloqué, même fini posé → en_cours", () => {
  const verdicts = Object.fromEntries(ids.map((id) => [id, { v: id === "p3" ? "bloque" : "ok", a }]));
  const etat = { date: principal.date, verdicts, fini: a } as never;
  assert.equal(calculerStatut(principal, etat), "en_cours");
  assert.equal(bloquesPour(principal, etat), 1);
  assert.equal(dejaConsigne(principal, etat), false);
});

await step("reconcilierAvecServeur : point retiré (corrigé) puis reprise sur lui, les ok restent", () => {
  const local = {
    ...vide(principal.id),
    index: 5,
    verdicts: { p1: "ok", p2: "bloque", p3: "ok", p4: "ko", p5: "ok" } as never,
    motifs: { p2: "ça plante", p4: "faux" },
    joues: ["p2", "p3"],
  };
  // Le serveur n'a plus p2 (corrigé) ni p4 (ko corrigé) ; p1, p3, p5 restent.
  const serveur = {
    p1: { v: "ok", a }, p3: { v: "ok", a }, p5: { v: "ok", a },
  } as never;
  const p = reconcilierAvecServeur(local, serveur, ids, { p2: a, p4: a });
  assert.deepEqual(Object.keys(p.verdicts).sort(), ["p1", "p3", "p5"]);
  assert.equal(p.index, 1, "reprise sur le premier point sans réponse (p2)");
  assert.deepEqual(p.joues, ["p3"], "le geste du point corrigé est de nouveau à jouer");
  assert.equal(p.motifs?.p2, undefined);
});

await step("reconcilierAvecServeur : verdict local non encore envoyé (absent du serveur, sans marque) gardé", () => {
  const local = { ...vide(principal.id), index: 2, verdicts: { p1: "ok", p2: "ko" } as never, quand: { p1: a, p2: a } };
  const serveur = { p1: { v: "ok", a } } as never;
  const p = reconcilierAvecServeur(local, serveur, ids, {});
  assert.equal(p.verdicts.p2, "ko");
  assert.equal(reconcilierAvecServeur(local, serveur, ids, undefined).verdicts.p2, "ko");
});

await step("reconcilierAvecServeur : marque plus récente = écarté à chaque lecture (onglet ouvert), geste à rejouer", () => {
  const marque = "2026-11-12T11:00:00.000Z";
  const local = { ...vide(principal.id), index: 3, verdicts: { p1: "ok", p2: "ko", p3: "ok" } as never, quand: { p1: a, p2: a }, joues: ["p2"], motifs: { p2: "x" } };
  const serveur = { p1: { v: "ok", a } } as never;
  const p = reconcilierAvecServeur(local, serveur, ids, { p2: marque, p3: marque });
  assert.equal(p.verdicts.p2, undefined);
  assert.equal(p.verdicts.p3, undefined, "sans horodatage local face à une marque = écarté");
  assert.equal(p.verdicts.p1, "ok");
  assert.deepEqual(p.joues, []);
  assert.equal(p.motifs?.p2, undefined);
  assert.equal(p.index, 1);
});

await step("reconcilierAvecServeur : verdict local posé après la marque = gardé", () => {
  const marque = "2026-11-12T11:00:00.000Z";
  const local = { ...vide(principal.id), verdicts: { p2: "ok" } as never, quand: { p2: "2026-11-12T12:00:00.000Z" } };
  const p = reconcilierAvecServeur(local, {} as never, ids, { p2: marque });
  assert.equal(p.verdicts.p2, "ok");
});

await step("verdict() horodate le verdict local", () => {
  const p = verdict(vide(principal.id), "p1", "ok");
  assert.match(p.quand!.p1, /^\d{4}-\d{2}-\d{2}T.*Z$/);
});

await step("reconcilierAvecServeur : sans retrait, la progression locale est gardée telle quelle", () => {
  const local = { ...vide(principal.id), index: 2, verdicts: { p1: "ok", p2: "ok" } as never };
  const serveur = { p1: { v: "ok", a }, p2: { v: "ok", a } } as never;
  assert.equal(reconcilierAvecServeur(local, serveur, ids), local);
  assert.equal(reconcilierAvecServeur(local, undefined, ids), local);
});

await step("serveurPrime : ne compte que les ids du scénario (étapes retirées ignorées)", () => {
  const local = { ...vide(principal.id), verdicts: { p1: "ok", vieux1: "ko", vieux2: "ko" } as never };
  const serveur = { p1: { v: "ok", a }, p2: { v: "ok", a } };
  assert.equal(serveurPrime(local, serveur), false, "sans etapesIds : ancien décompte brut");
  assert.equal(serveurPrime(local, serveur, ids), true, "avec etapesIds : 2 contre 1, le serveur prime");
  const p = reconcilierAvecServeur(local, serveur as never, ids);
  assert.deepEqual(Object.keys(p.verdicts).sort(), ["p1", "p2"], "la vieille remarque locale ne revient pas");
});

await step("reconcilierAvecServeur : quand le serveur prime, les gestes déjà joués sont gardés (filtrés)", () => {
  const local = { ...vide(principal.id), verdicts: { p1: "ok" } as never, joues: ["p1", "vieux"] };
  const serveur = { p1: { v: "ok", a }, p2: { v: "ok", a } } as never;
  const p = reconcilierAvecServeur(local, serveur, ids);
  assert.deepEqual(p.joues, ["p1"]);
  assert.deepEqual(progressionDepuisServeur(principal.id, serveur, ids).joues, []);
});

await step("chargerProgression : un point bloqué est rouvert (reprise sur le 1er sans réponse)", () => {
  const stock = new Map<string, string>();
  const storage = { getItem: (k: string) => stock.get(k) ?? null, setItem: (k: string, v: string) => void stock.set(k, v) } as Storage;
  storage.setItem(`mdj_guide_${principal.id}`, JSON.stringify({
    scenarioId: principal.id, index: 0, verdicts: { p1: "ok", p2: "bloque" },
  }));
  const p = chargerProgression(principal.id, storage, ids);
  assert.equal(p.index, 1, "p1 est répondu, p2 (bloqué) est le premier sans réponse");
});

await step("texteAvis bloquant : consigne de correction avec la commande", () => {
  const t = texteAvis(principal, { p2: { v: "bloque", note: "page blanche", a } }, "bloquant", "p2");
  assert.match(t, /^BLOQUANT : temoin-principal \/ p2/);
  assert.match(t, /page blanche/);
  assert.match(t, /plantrack checker corrige temoin-principal p2/);
  assert.match(t, /2\. Point p2 : BLOQUANT/);
});

// --- côté serveur (registre dans un dossier temporaire) ---
process.env.GUIDE_AVERTIR = "0";
const racine = await mkdtemp(join(tmpdir(), "plantrack-guide-bloquant-"));
await mkdir(join(racine, ".planning"), { recursive: true });
process.chdir(racine);
process.env.GUIDE_ACTIF = "1";
process.env.GUIDE_TEST_ADMIN = "1";
const { etatGuides, consignerPoint, consignerGuide } = await import(
  "../../.claude/hooks/plantrack_guide/moteur/guide-actions.ts"
);
const lireRegistre = async () => JSON.parse(await readFile(join(racine, ".planning", "guides-etat.json"), "utf8"));

await step("consignerPoint accepte bloque ; le guide reste à traiter et rien n'est consigné", async () => {
  for (const id of ["p1", "p2", "p3", "p4", "p5"]) assert.equal((await consignerPoint("temoin-principal", id, "ok")).error, null);
  assert.equal((await consignerPoint("temoin-principal", "p6", "bloque", "ça casse")).error, null);
  const g = (await etatGuides())!.find((x) => x.id === "temoin-principal")!;
  assert.equal(g.statut, "en_cours");
  assert.equal(g.faits, 5);
  assert.equal(g.bloques, 1);
  assert.equal(g.enAttente, true);
  const r = await consignerGuide("temoin-principal");
  assert.equal(r.statut, "en-cours", "pas de compte-rendu final tant qu'un point est bloqué");
  const reg = await lireRegistre();
  assert.equal(reg["temoin-principal"].fini, undefined);
  assert.equal(reg["temoin-principal"].verdicts.p6.note, "ça casse");
});

await step("point retiré du registre (checker corrige) : les OK restent, seul p6 est à rejouer", async () => {
  const reg = await lireRegistre();
  delete reg["temoin-principal"].verdicts.p6;
  await writeFile(join(racine, ".planning", "guides-etat.json"), JSON.stringify(reg));
  const g = (await etatGuides())!.find((x) => x.id === "temoin-principal")!;
  assert.equal(g.faits, 5);
  assert.equal(g.bloques, 0);
  assert.equal(g.enAttente, false);
  assert.equal(g.statut, "en_cours");
  assert.deepEqual(Object.keys(g.verdicts).sort(), ["p1", "p2", "p3", "p4", "p5"]);
  // Elle rejoue p6 : ok, le guide se consigne alors normalement.
  await consignerPoint("temoin-principal", "p6", "ok");
  const r = await consignerGuide("temoin-principal");
  assert.equal(r.statut, "valide");
});

console.log(`\n${passed} assertions vertes`);
