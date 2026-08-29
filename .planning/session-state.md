# État de session — PlanTrack

## Dernière session : 2026-08-29

### Décisions actées par Mariella (party mode)
- **Installation** : `uvx --from git+https://github.com/mdjlabs/plantrack plantrack init` — PyPI attendra le jalon Publication (§16 PRD).
- **Ancrage** : auto-copie vendorée — `plantrack init` copie pt.py dans `.claude/hooks/` du projet cible ; `plantrack doctor` signalera les versions en retard.
- **GitHub** : repo privé maintenant, public seulement au jalon Publication.
- Le code de la couche 1 était dans `documents/` (non versionné) ; étudié avant usage, conforme au PRD, importé au commit initial.

### Audit couche 1 (v0) vs PRD v0.2 — écarts relevés
1. **O6 contournable** : l'agent peut lancer `./plantrack verify` via Bash — le verrou « validated réservé à l'humain » n'est pas technique. Piste : refuser verify/reject si env CLAUDECODE présent.
2. **README v0 périmé** : mentionne la greffe Beads, contredit la décision de conception du PRD v0.2 (§6, JSONL retenu).
3. **Verrue `!focus --force`** : pt.py:216 — `--force` saute le refus mais crée un fil nommé « --force ».
4. **Pas de tests scriptés** (§14 les exige — tests/scenario.sh à écrire).
5. Note Winston : le pre-commit v0.5 (couche 4) ne peut garder que les fils parqués tant que la couche 2 (tâches) n'existe pas — garde partielle à assumer.

### État
- Commit initial `6209f57` : layout installable (.claude/, plantrack, README, PRD).
- Commit `21fed8c` : les 4 correctifs d'audit livrés — O6 verrouillé (verify/reject
  refusés si env CLAUDECODE/CLAUDE_CODE_ENTRYPOINT), verrue `--force` supprimée,
  README aligné PRD, `tests/scenario.sh` (19 checks, tous verts).
- Remote GitHub PAS créé : `gh` non authentifié → Mariella doit lancer `! gh auth login`,
  puis créer `mdjlabs/plantrack` en privé et pousser.

### Jalon v0.5 ATTEINT — commit `6d922c6`
- `plantrack init --git-hook` + `plantrack precommit` : commit bloqué si un fichier
  stagé appartient à un fil parqué (portée v0.5 ; les tâches cancelled/replaced
  viendront avec la couche 2). 26 checks verts dans tests/scenario.sh.

### Couche 2 LIVRÉE — commit `9f45006`
- Plan phases/tâches complet (§8) : CLI plan/phase/task/decisions, plan import avec
  validation humaine, statuts réservés à l'humain, décisions d'abandon automatiques,
  `!focus <task_id>`, pre-commit étendu aux tâches cancelled/replaced.

### Dérogation fichier unique ACTÉE — commit `a2b614a`
Décision Mariella 2026-08-29 : pt.py reste un seul fichier (auto-copie vendorée
triviale) ; seuil d'éclatement du PRD §0 relevé de 700 à 1200 lignes.

### Couche 3 LIVRÉE — commit `1fdb7a7` → v1.0 COMPLÈTE (couches 1+2+3+4)
- Bugs enrichis (`!bug … --low|--high|--blocker`), bug blocker = avertissement en tête
  du bloc réinjecté ; tentatives (`plantrack attempt`) avec refus de doublon
  difflib > 0.85 rendant l'hypothèse précédente + son motif de rejet (test 6 §14) ;
  machine à états (`plantrack bug <id> <statut>`) : validated refusé à l'agent avec
  message pédagogique (test 7 §14), wont_fix humain seul avec motif, verify/reject
  exigent to_verify, motif de rejet attaché à la dernière tentative, états terminaux
  figés ; `plantrack attempts <bug_id>`.
- 65 checks verts dans tests/scenario.sh. pt.py : 838 lignes (< 1200).
- Écart §11 assumé (hérité v0) : la troncature du bloc coupe par la fin, elle
  n'applique pas l'ordre de priorité décisions > note de reprise > bugs bloquants.

### v1.1 LIVRÉE (hors portage Codex) — commits `95d02ef` + `8ea8214`
- `plantrack init` vendorisé complet (§13) : copie de pt.py, settings.json 4 hooks
  (jamais écrasé), wrapper ./plantrack, bloc CLAUDE.md/AGENTS.md entre marqueurs,
  .gitignore ; idempotent. `--agent codex|gemini` = mode dégradé annoncé.
- `plantrack doctor` (installation, journal, budget) et `plantrack stats` (§15,
  blocages pre-commit désormais journalisés : événement `precommit_block`).
- `pyproject.toml` : installable via uvx/pip depuis GitHub (entry point pt:main
  mappé sur .claude/hooks) — vérifié dans un venv + projet vierge.
- 81 checks verts. pt.py : 1021 lignes (plafond dérogé : 1200 — marge faible).
- Reste du jalon v1.1 : portage Codex (traduction config hooks, critère de sortie :
  un projet réel repris depuis Codex) ; questions §17 non tranchées (agent proposant
  wont_fix ; mode strict §10-B par défaut).

### Revue de code FAITE — lots A+D livrés, commit `60c26fa`
Revue skill code-review (4 passes de collecte + 4 vérificateurs, scoring 0-100).
Faux positifs démontés : B1 (pre-commit fils closed = conforme PRD), P5 (rôles
par env = décision actée), P6 (statuts anglais = choix v0). Mariella a retenu
les lots A (bugs sûrs) et D (tests fiables) :
- plafond dur 3000 respecté (le bloc faisait 3042) ; project() tolère un
  événement incomplet (KeyError cassait hooks/CLI/doctor) ; init détecte une
  installation partielle et liste les hooks manquants ; hook-context réinjecte
  une inbox/un plan seuls ; `file` refuse une destination ≠ bug|decision.
- scenario.sh hermétique (export CLAUDECODE=1 — avant : 4 FAIL + EOFError en
  env nu) + 20 nouveaux checks. 101 checks verts, vérifiés aussi en env nu.
  pt.py : 1031 lignes (< 1200).

### Lots B et C LIVRÉS — commit `9cd51ba` → revue de code SOLDÉE
Trois arbitrages actés par Mariella (reco retenue à chaque fois) :
- pre-commit : fil actif (sain) prioritaire sur un fichier partagé avec un fil
  parqué ; chemins git convertis en ROOT-relatifs (projet en sous-répertoire) ;
- §5 : le bloc réinjecté restitue la dernière hypothèse rejetée + motif
  (+compteur) par bug affiché ;
- L6 : rétrograder to_verify→open exige un motif (agent autorisé, tracé,
  pas compté comme reject humain dans stats).
Schéma §9 complété : bug.task, attempt.hypothesis + attempt.actor (projection
rétro-compatible avec l'ancien champ text ; champ changes non implémenté —
aucune donnée disponible à la CLI).
114 checks verts (aussi en env nu). pt.py : 1057 lignes (< 1200).

### Portage Codex LIVRÉ (code) — commit `2a62dcd`
Recherche documentaire (learn.chatgpt.com/docs/hooks + code source openai/codex) :
Codex CLI a un vrai système de hooks calqué sur Claude Code. Faits mesurés :
- réinjection post-compaction = `SessionStart` avec `source: "compact"` (PostCompact
  n'injecte PAS de contexte) → hook-context marche tel quel ;
- `UserPromptSubmit` : exit 2 + stderr bloque, comme Claude Code ;
- `apply_patch` : pas de champ file_path, le chemin est dans le texte du patch
  (`*** Update File: …`) → hook-filelog parse le patch, chemins résolus via cwd ;
- hooks lancés dans le cwd de session (parfois un sous-répertoire), aucune variable
  projet → la commande résout `git rev-parse --show-toplevel` et pose PLANTRACK_ROOT ;
- détection de rôle : `CODEX_THREAD_ID`/`CODEX_SANDBOX` posées par le shell tool de
  Codex (source code, NON documenté — à confirmer) → ajoutées à AGENT_ENV ;
- hooks projet à truster une fois via `/hooks` dans Codex.
Livré : CODEX_HOOKS + write_hooks_file (factorisation avec settings.json), init
--agent codex écrit .codex/hooks.json, doctor étendu, gemini reste mode dégradé.
130 checks verts (aussi en env nu). pt.py : 1101 lignes (< 1200).
**Reste pour solder le jalon v1.1** : critère de sortie « un projet réel repris
depuis Codex » — le binaire `codex` n'est PAS installé sur la machine (seul un
~/.codex/config.toml claude-code-router du 11/08 existe) ; installation + auth
à décider avec Mariella.

### Jalon v1.1 SOLDÉ — décision Mariella 2026-08-29
« Le but c'est que ce mini projet soit compatible avec n'importe quel agent de
codage cli, non pas de tous les installer. le user installera ceux qu'il
voudra. » → PlanTrack est COMPATIBLE avec les agents, il ne les installe
jamais. Le critère de sortie v1.1 du PRD (§16) a été amendé en conséquence :
traduction de config livrée et testée sur le contrat documenté suffit.
Codex (installé un temps pour valider) a été DÉSINSTALLÉ ; le banc de
validation scratchpad supprimé. Interdictions permanentes actées le même
jour : jamais ccr/claude-code-router, jamais de clé API Anthropic.
Restent honnêtement « à confirmer par un utilisateur réel » (notes dans le
README et pt.py) : CODEX_THREAD_ID/CODEX_SANDBOX comme détection de rôle.

### Questions §17 TRANCHÉES — 2026-08-29 (PRD amendé)
- wont_fix : statu quo — proposition en prose + `!note`, pas d'état formel.
- Mode strict §10-B : pas construit tant que `plantrack stats` ne montre pas
  de blocages pre-commit fréquents ; jamais par défaut.
Le PRD n'a plus de question ouverte.

### GitHub POUSSÉ — 2026-08-29
`gh` authentifié (compte Slimariella). L'organisation mdjlabs n'existe pas
encore sur GitHub (HTTP 404 ; sa création est réservée au navigateur, aucune
API/CLI ne le permet) → repo créé en PRIVÉ sous **Slimariella/plantrack**
(`https://github.com/Slimariella/plantrack`), remote origin posé, main poussé
(tête `ece297f`). Mariella a ensuite créé l'org mdjlabs dans le navigateur →
repo TRANSFÉRÉ (`gh api repos/Slimariella/plantrack/transfer -f new_owner=mdjlabs`),
vérifié : **MDJLABS/plantrack**, privé, branche main, remote local mis à jour
(`https://github.com/mdjlabs/plantrack.git`). L'URL d'installation du README
(`uvx --from git+https://github.com/mdjlabs/plantrack …`) est désormais réelle.

### Installation uvx VALIDÉE en réel — 2026-08-29
Sur un projet git vierge : `uvx --from git+https://github.com/mdjlabs/plantrack
plantrack init` passe du premier coup (repo privé cloné via le credential
helper gh ; un utilisateur externe devra avoir accès au repo tant qu'il est
privé). Vérifié fonctionnel : hook-prompt (exit 2, fil créé), hook-context
(bloc réinjecté 325/3000), doctor tout vert, `init --git-hook` + commit réel,
`init --agent codex` (hooks.json JSON valide), idempotence (« deja en place »).

### PUBLIÉ sur PyPI — 2026-08-29 (décision Mariella, PRD §16 amendé)
`plantrack 1.1.0` sur PyPI (licence MIT, page = README) → **`uvx plantrack init`
marche**, testé en réel sur un projet vierge (doctor 6 ok, hook-prompt ok).
Voie : **trusted publishing** GitHub Actions (`.github/workflows/publish.yml`,
tag `v*`, environnement `pypi`, AUCUN token stocké) — publier une version =
bump `version` dans pyproject.toml + `git tag vX.Y.Z && git push origin vX.Y.Z`.
Pièges payés : (1) un bloc `permissions:` dans un workflow met à **none** tout
droit non listé → `contents: read` explicite obligatoire pour checkout ;
(2) pousser `.github/workflows/` exige le scope gh `workflow` (ajouté par
device flow) — avant ça le push échouait, silencieusement avec `-q 2>/dev/null` ;
(3) la saisie masquée `read -s` via `!` ne capture rien (fichier vide → 403
PyPI) — le trusted publishing évite tout secret. Le code du paquet est public ;
le repo GitHub reste privé (le reste du jalon Publication — repo public, démo —
demeure conditionné aux chiffres du §15).

### v1.2.0 — découverte multi-agents (décision Mariella 2026-08-29)
Demande : « comment l'agent installé en prend connaissance, ou s'il y en a
plusieurs, ou installé après ? … une ligne réf dans claude.md, et les autres
pareil. » Livré (tag v1.2.0, publié PyPI, testé en réel depuis PyPI) :
- `init` sans option couvre TOUT : `.claude/settings.json` + `.codex/hooks.json`
  systématiques (un fichier de config est inerte sans l'agent ; celui installé
  après trouve tout en place) ; bloc complet dans **AGENTS.md** (source unique,
  standard cross-agents) ; ligne d'import `@AGENTS.md` entre marqueurs dans
  **CLAUDE.md** et **GEMINI.md** (les deux savent importer via `@`).
- Fait vérifié (web) : Gemini CLI lit GEMINI.md par défaut, AGENTS.md
  seulement via config → d'où le fichier GEMINI.md.
- `--agent` obsolète (accepté, annoncé) ; `write_md_block` remplace le contenu
  entre marqueurs (mise à niveau des anciens blocs CLAUDE.md v1.1) ; doctor
  vérifie codex + AGENTS.md inconditionnellement.
- 134 checks verts (aussi env nu). pt.py : 1126 lignes (< 1200).
- Piège : juste après un tag, l'index PyPI peut servir l'ancienne version à
  uvx — forcer `--from 'plantrack==X.Y.Z'` pour tester la fraîche.

### v1.3.0 — skill Deep Code (décision Mariella 2026-08-29)
Demande : couvrir aussi zcode, xcode, kimi code, deepseek, mistral. Vérifié
(web, sources au README) : ZCode, Grok Build, Kimi Code CLI, Mistral Vibe
lisent AGENTS.md nativement — déjà couverts, zéro code ; « xcode » n'existe
pas comme agent CLI ; DeepSeek n'a pas de CLI officiel. Mariella a choisi
« Supporter Deep Code (tiers) » (contre la reco « rien pour l'instant »).
Livré (tag v1.3.0, publié PyPI via Actions, testé en réel depuis PyPI) :
- Principe reconfirmé par Mariella en séance : UN fichier source
  (`AGENTS.md`) + une **référence** dans chaque fichier propre à un agent —
  la skill Deep Code ne duplique donc RIEN, elle renvoie vers AGENTS.md.
- `init` écrit `.deepcode/skills/plantrack/SKILL.md` (format Claude Code :
  frontmatter YAML name/description + corps) via `write_owned_file`
  (fichier 100 % généré → remplaçable sans risque, « deja en place » si
  identique) ; rappelle `./plantrack status` faute de hooks.
- doctor vérifie la présence de la skill. 137 checks verts.
- Sources : github.com/lessweb/deepcode-cli,
  api-docs.deepseek.com/quick_start/agent_integrations/deepcode/.

### v1.3.1 — correctifs du rapport de terrain miamboost (2026-08-29)
Rapport : `.planning/2026-08-29-rapport-install-claude-code.md` (3 défauts
constatés en installant sur miamboost). Livré (tag v1.3.1, publié, rejoué
en réel depuis PyPI sur le scénario exact du rapport) :
- `write_hooks_file` FUSIONNE dans un settings.json existant (additive,
  comparaison sur la commande → idempotente, écriture atomique os.replace,
  JSON invalide → bloc à coller imprimé + retour False) ;
- retour anticipé `--git-hook` supprimé : le drapeau AJOUTE le garde-fou à
  l'installation complète (le chemin mort de fin de cmd_init le gérait déjà) ;
- init termine sur « installation INCOMPLETE » si une étape a échoué.
- 150 checks verts (dont section 22 = rejeu miamboost). pt.py : 1183 lignes
  (plafond 1200 — marge très faible, prochain ajout devra dégraisser).
- Piège : l'API JSON PyPI est indexée AVANT l'index simple qu'utilise uv —
  attendre `curl https://pypi.org/simple/plantrack/ | grep X.Y.Z`.

### v1.4.0 → v1.4.2 — update, garde-fou surcouches, README grand public (2026-08-29)
- v1.4.0 : commande `update` (demande Mariella) — remplace la copie vendoree
  par la version qui execute la commande puis rejoue init (idempotent).
  Usage : `uvx plantrack@latest update`. Piege : @latest peut resoudre
  l'ancienne version quelques minutes apres publication.
- v1.4.1 : surcouches (demande Mariella : BMAD, GSD…). Recherche sous-agent
  (sources au README) : les sous-agents Claude Code RECOIVENT le CLAUDE.md
  du projet → BMAD, task-master, claude-flow, spec-kit deja couverts ; BMAD
  et task-master ecrivent eux-memes dans AGENTS.md entre leurs marqueurs
  (cohabitation ok). Seul point dur : GSD genere/ecrase CLAUDE.md. Choix
  Mariella : garde-fou doctor (verifie @AGENTS.md dans CLAUDE.md/GEMINI.md),
  rien d'intrusif chez les autres outils.
- v1.4.2 : section README « Comment ca marche, tout simplement » (langage
  courant, demande Mariella) — publiee sur PyPI via bump.
- 165 checks verts ; pt.py 1195 lignes (doctor degraisse via slurp()).
- Scenarios rejoues en reel depuis PyPI : update 1.3.1→1.4.0, CLAUDE.md
  ecrase facon GSD → doctor detecte, init repose la ligne.

### v1.4.3 — repo public + README vitrine (2026-08-29)
- Repo GitHub rendu PUBLIC (décision Mariella — elle voulait un lien
  partageable ; le code était déjà public via la sdist PyPI) :
  https://github.com/MDJLABS/plantrack
- README refondu en présentation publique pédagogique (demande Mariella,
  français seul — choix AskUserQuestion) : badges, problème/réponse,
  « Une session type, pas à pas », schéma des hooks, tableau de
  compatibilité agents. Sections internes (« Mesure à tenir », « La
  suite ») déplacées dans `.planning/notes-internes-mesure-et-suite.md`.
- pyproject : `[project.urls]` (Homepage/Source/Issues) → lien GitHub
  visible sur PyPI. Tag v1.4.3 poussé.

### Session CLOSE — 2026-08-29
Prompt de reprise : `.planning/2026-08-29-reprise-apres-v1.4.md` (autonome,
les anciens sont purgés). Rien en suspens. Prochain jalon (§16 Publication)
réduit à la démo, conditionné aux chiffres de `plantrack stats`.
