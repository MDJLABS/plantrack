# Checker v2 (d241)

Décision de Mariella (12/11) : dossier réservé remplacé d'office ; une commande + un fichier par guide ;
bouton « Bloquant » à chaque étape.

## 1. Dossier réservé (pt.py, sync_guide)

Source PlanTrack : `.claude/hooks/plantrack_guide/` devient :

- `moteur/` : les 14 fichiers du moteur (les 11 de `lib/guide/` + les 3 de `components/guide/`) dans UN dossier.
  Imports internes relatifs (`./guide-etat`, `./GuideCurseur`). Fichiers du site atteints par
  `../scenarios.ts`, `../guide-reglages.ts`, `../guide-reglages-serveur.ts`, `../guides/index.ts`.
  Chaque fichier commence par la mention : `/* CHECKER, fichier du moteur PlanTrack, remplacé à chaque mise à jour. Ne pas modifier : les réglages du site vivent dans lib/guide/ (hors de moteur/). */`
  (placée APRÈS une éventuelle directive "use client" / "use server", qui doit rester la 1re instruction).
- `raccourcis/` : redirections pour les anciens chemins (le code des sites importe `@/components/guide/GuideDeTestLazy`,
  `@/lib/guide/guide-geometry`, `../../lib/guide/guide-geste`, `./types`…) :
  `raccourcis/lib/guide/<f>.ts` = `export * from "./moteur/<f>";` pour chaque fichier lib SAUF `guide-actions.ts`
  (fichier "use server", importé seulement par le moteur : l'ancien est supprimé, pas de raccourci) ;
  `raccourcis/components/guide/<C>.tsx` = `export * from "@/lib/guide/moteur/<C>";`.
  Aucun fichier du moteur n'a d'export default (vérifié).

Dans un site (base = "", src, app, apps/web, apps/web/src) : moteur dans `<base>/lib/guide/moteur/`, raccourcis aux anciens chemins.

Règle de synchro (update, init, ronde), remplace la garde par empreintes (b50) :
- `moteur/` et raccourcis : TOUJOURS remplacés par la version PlanTrack. Si la copie du site diffère de la source
  ET n'est pas une version publiée (GUIDE_PUBLIES) ET n'est pas un raccourci : la copier d'abord dans
  `backup/code/<chemin>` puis remplacer (message d'une ligne).
- Ancien `lib/guide/guide-actions.ts` : sauvegardé si inconnu, puis supprimé.
- Fichiers du site (`scenarios.ts`, `guide-reglages*.ts`, `guides/*`) : jamais écrasés.
- Gardes conservées : « ancien guide » sans `guide-reglages-serveur.ts` laissé tel quel ; jamais d'écriture via un lien
  symbolique sortant du dépôt. Promovie (port Vite, `studio/src/guide/`) n'est pas détecté et reste à part.
- Régénère `<base>/lib/guide/guides/index.ts` (voir 3).

## 2. Bouton « Bloquant » (moteur TS)

- `StepVerdict` gagne `"bloque"`. Sur chaque point, à côté de OK / Pas OK : bouton **« Bloquant »** (id `guide-bloquant`).
  Il ouvre le même champ de note (facultative), puis : consigne `v:"bloque"`, AVERTIT la session tout de suite
  (`avertirSession`, sorte `"bloquant"`), et passe au point suivant. Le guide continue.
- Un point `bloque` compte comme NON répondu : `verdictScenario` → `en-cours`, `calculerStatut` → `en_cours`, le guide
  reste dans « encore à traiter ». Au bilan, s'il reste des points bloqués : la carte de fin dit
  « N point(s) attendent la correction de la session ; tu les rejoueras ensuite » ; pas de compte-rendu final tant
  qu'il en reste (consignerGuide non appelé, ou appelé avec statut en attente : au choix le plus simple, sans casser d138).
- Texte de l'avis bloquant : « BLOQUANT : <scénario> / <point> … note … Corrige, puis lance
  `plantrack checker corrige <scenario> <point>` : le point redevient à jouer et Mariella ne rejouera que lui. »
- Point marqué corrigé (verdict retiré par la commande) : à la réouverture, la reprise tombe sur le 1er point sans réponse,
  donc sur lui ; les points déjà OK restent acquis (plus de remise à zéro). Vaut aussi pour un point `ko`.
  La relivraison par changement de `date` du scénario (remise à zéro totale) reste possible.
- La pastille / liste « Guides à traiter » distingue « à reprendre » (point corrigé) de « en attente de la session » (encore bloqué).

## 3. Une commande + un fichier par guide

Fichier : `<base>/lib/guide/guides/<id>.json` (id = nom du fichier, `[a-z0-9-]+`) :

```json
{
  "titre": "Réserver une soirée",
  "page": "/soirees",
  "version": "2026-11-12",
  "points": [
    { "id": "ouvrir", "titre": "Ouvrir la fiche", "faire": "Touche la première soirée.",
      "attendu": "La fiche de la soirée s'ouvre.", "cible": "#soiree-1", "clic": "#soiree-1" },
    { "id": "email", "titre": "Saisir l'e-mail", "faire": "Le guide écrit ton e-mail.",
      "attendu": "Le champ affiche l'e-mail.", "cible": "#email",
      "gestes": [ { "saisir": "#email", "valeur": "essai@exemple.fr" }, { "clic": "#envoyer" } ] },
    { "id": "page2", "titre": "Aller au compte", "faire": "…", "attendu": "…", "aller": "/compte" }
  ]
}
```

Champs : `id` facultatif (sinon `p1`, `p2`…), `cible` (texte ou liste), raccourcis de geste `clic` / `saisir`+`valeur` / `aller`,
ou `gestes` (liste, `aller` en dernier), `url` facultatif (page du point). `version` = `date` du scénario (défaut "1").
Le moteur convertit (`moteur/guides-json.ts`) vers `GuideScenario` et fusionne avec `SCENARIOS` de `../scenarios.ts`
(les deux coexistent ; le site garde ses anciens scénarios). `getScenario` / `indexDePoint` fournis par le moteur sur la fusion.

`<base>/lib/guide/guides/index.ts` est GÉNÉRÉ par PlanTrack (ne pas éditer) : importe chaque `.json` et exporte
`GUIDES_JSON: Record<string, unknown>` ; vide si aucun guide.

Commande `plantrack checker` :
- `plantrack checker` / `checker installer` : pose le moteur (même sans `_guide: a_poser`), crée les fichiers du site
  s'ils manquent, monte `<GuideDeTestLazy />` dans le layout racine (`app/layout.tsx` ou `src/app/layout.tsx` sous la base :
  import + composant juste avant `</body>`, idempotent ; sinon dit où le mettre), régénère `guides/index.ts`, puis affiche
  ce qui reste à faire (estAdmin, GUIDE_ACTIF=1 sur le site de test) et l'aide courte.
- `plantrack checker aide` : le format ci-dessus en 20 lignes, avec un exemple.
- `plantrack checker verifier [id]` : valide chaque JSON (champs obligatoires titre/page/points, faire/attendu par point,
  ids uniques) et, pour chaque sélecteur `#id`, cherche `id="id"` / `id='id'` / `id={"id"}` dans le code du site (hors
  node_modules, .next) ; avertit si absent. Code retour non nul si erreur bloquante. Régénère index.ts.
- `plantrack checker corrige <scenario> <point>` : retire le verdict de ce point dans `.planning/guides-etat.json`
  (écriture atomique : fichier temporaire + rename), pour la date courante du scénario ; message clair.
- `plantrack checker etat` : liste des guides, et pour chacun les points bloqués / ko / à rejouer.

Consigne injectée dans les AGENTS.md des sites (bloc PlanTrack) : une ligne « Checker : écrire un guide = un fichier
lib/guide/guides/<id>.json, puis `plantrack checker verifier` ; format : `plantrack checker aide`. Un point BLOQUANT
reçu : corrige puis `plantrack checker corrige <scenario> <point>`. Ne jamais modifier lib/guide/moteur/. »
