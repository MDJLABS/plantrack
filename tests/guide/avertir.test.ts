// tests/guide/avertir.test.ts — d172 : un « pas ok » ou une remarque du guide réveille la
// session tout de suite (guide-avertir.ts), et la carte ne cache jamais la zone montrée
// (placerCarte, guide-geometry.ts).
//
// Un faux poste (serveur http local, BCC_PORT) reçoit les messages ; HOME pointe vers un
// dossier vide pour que ~/.bcc-poste/poste.json n'existe pas — jamais le vrai poste.
//
// EXÉCUTION :
//   node --experimental-strip-types --import ./tests/guide/support/register.mjs \
//     tests/guide/avertir.test.ts

import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

const recus: { chemin: string; corps: { projet: string; texte: string } }[] = [];
const faux = createServer((req, res) => {
  let brut = "";
  req.on("data", (c) => (brut += c));
  req.on("end", () => {
    recus.push({ chemin: req.url ?? "", corps: JSON.parse(brut) });
    res.writeHead(200).end("{}");
  });
});
await new Promise<void>((ok) => faux.listen(0, "127.0.0.1", ok));
process.env.BCC_PORT = String((faux.address() as AddressInfo).port);
process.env.HOME = await mkdtemp(join(tmpdir(), "plantrack-guide-home-"));
process.env.GUIDE_ACTIF = "1";
process.env.GUIDE_TEST_ADMIN = "1";

const racine = await mkdtemp(join(tmpdir(), "plantrack-guide-avertir-"));
await mkdir(join(racine, ".planning"), { recursive: true });
process.chdir(racine);

const { consignerPoint, consignerGuide, guideInterrompu } = await import(
  "../../.claude/hooks/plantrack_guide/lib/guide/guide-actions.ts"
);
const { placerCarte } = await import("../../.claude/hooks/plantrack_guide/lib/guide/guide-geometry.ts");

await step("un ok sans remarque ne réveille personne", async () => {
  await consignerPoint("temoin-principal", "p1", "ok");
  assert.equal(recus.length, 0);
});

await step("le clic « ko » seul n'avertit pas : c'est la confirmation du motif qui le fait", async () => {
  await consignerPoint("temoin-principal", "p2", "ko", undefined, false);
  assert.equal(recus.length, 0);
  await consignerPoint("temoin-principal", "p2", "ko", "le bouton\nne répond pas");
  assert.equal(recus.length, 1);
  const { chemin, corps } = recus[0]!;
  assert.equal(chemin, "/guide/point");
  assert.equal(corps.projet, racine);
  assert.match(corps.texte, /point 2\/6 « Point p2 » : PAS OK/);
  assert.match(corps.texte, /« le bouton ne répond pas »/); // une seule ligne citée
  assert.match(corps.texte, /1\. Point p1 : ok/); // les ok voyagent dans l'état du parcours
  assert.match(corps.texte, /3\. Point p3 : pas encore vu/);
});

await step("un ko sans remarque confirmé avertit aussi", async () => {
  await consignerPoint("temoin-principal", "p3", "ko");
  assert.equal(recus.length, 2);
  assert.match(recus[1]!.corps.texte, /PAS OK/);
});

await step("guide fermé avant la fin → résumé de l'arrêt", async () => {
  await guideInterrompu("temoin-principal");
  assert.equal(recus.length, 3);
  assert.match(recus[2]!.corps.texte, /fermé avant la fin : 3 point\(s\) répondu\(s\) sur 6/);
});

await step("guide terminé → bilan", async () => {
  for (const id of ["p4", "p5", "p6"]) await consignerPoint("temoin-principal", id, "ok");
  assert.equal(recus.length, 3);
  const r = await consignerGuide("temoin-principal");
  assert.equal(r.statut, "a-revoir");
  assert.equal(recus.length, 4);
  assert.match(recus[3]!.corps.texte, /terminé : 4 ok, 2 pas ok/);
});

await step("guide déjà consigné → la fermeture ne redit rien", async () => {
  await guideInterrompu("temoin-principal");
  assert.equal(recus.length, 4);
});

await step("poste éteint → jamais d'erreur pour le guide", async () => {
  process.env.BCC_PORT = "1";
  const r = await consignerPoint("temoin-second", "q1", "ko", "x");
  assert.equal(r.error, null);
});

const ecranTel = { w: 390, h: 844 };
const carteTel = { w: 390, h: 300 };
const ecranPc = { w: 1512, h: 982 };
const cartePc = { w: 420, h: 360 };

await step("au pouce : zone libre → la carte reste en bas", () => {
  assert.deepEqual(placerCarte({ x: 20, y: 100, w: 200, h: 50 }, carteTel, ecranTel, true, "bas"), { place: "bas", couvre: false });
});

await step("au pouce : zone sous la carte → la carte passe en haut", () => {
  assert.deepEqual(placerCarte({ x: 20, y: 700, w: 200, h: 50 }, carteTel, ecranTel, true, "bas"), { place: "haut", couvre: false });
});

await step("au pouce : la carte revient en bas dès que la voie est libre", () => {
  assert.equal(placerCarte({ x: 20, y: 400, w: 200, h: 50 }, carteTel, ecranTel, true, "haut").place, "bas");
});

await step("au bureau : zone en bas à droite → un autre coin", () => {
  const r = placerCarte({ x: 1200, y: 800, w: 150, h: 60 }, cartePc, ecranPc, false, "bd");
  assert.equal(r.couvre, false);
  assert.notEqual(r.place, "bd");
});

await step("zone trop grande → meilleure place, et couvre = vrai pour faire défiler", () => {
  const r = placerCarte({ x: 0, y: 0, w: 390, h: 844 }, carteTel, ecranTel, true, "bas");
  assert.equal(r.couvre, true);
});

await step("passage pouce → bureau : la place est ramenée à un coin", () => {
  assert.equal(placerCarte(null, cartePc, ecranPc, false, "haut").place, "bd");
});

faux.close();
console.log(`\n${passed} ok`);
