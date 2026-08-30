# Reprise — PlanTrack après v1.6.0 (2026-08-30)

Prompt autonome : la session qui lit ceci ne sait rien des précédentes.

## Objectif du projet
PlanTrack : contexte, plan et bugs persistants pour longues sessions d'agent,
installable partout (`uvx plantrack init`). Le PRD fait foi :
`PRD-PlanTrack-v0.2.md` (jalons §16). Repo GitHub PUBLIC :
https://github.com/MDJLABS/plantrack — paquet PyPI `plantrack` (MIT).

## Où on en est
TOUT le périmètre décidé est livré, commité, poussé, publié (v1.6.0) :
- v1.0→v1.4.3 : couches 1–4, init/doctor/stats/update, portage Codex,
  publication PyPI par trusted publishing, découverte multi-agents
  (AGENTS.md source unique + références), skill Deep Code, fusion
  settings.json, README vitrine pédagogique, repo public, `[project.urls]` ;
- v1.5.0 (commits `6ba24fe`, `57e634c`) : l'agent écrit LUI-MÊME au carnet —
  CLI `decide`/`bug`/`piege`/`question`/`answer` + `!piege` `!question`
  `!answer`, provenance ` (agent)`, tentatives et questions en attente
  réinjectées, pièges préfixe `pg`. Issue du brainstorming BMAD sur les
  galères prolearn/miamboost/bcc (sous-capture = constat majeur) ;
- v1.6.0 (commits `b26abf3`, `01e5a30`) : hook git post-commit installé
  D'OFFICE par init (jamais bloquant, hook étranger préservé) — chaque
  commit rattaché au fil actif, ` [N commits]` réinjecté ; guides de test
  cochés derrière `!testcheck on|off` (OFF par défaut) — `guide`/`step`
  agent, verdict `check ok|ko -m` HUMAIN (require_human, motif obligatoire
  si ko), étapes sans verdict réinjectées.
238 checks verts (`bash tests/scenario.sh`). pt.py : 1442 lignes.

## Décisions tranchées par Mariella (immuables)
- `uvx plantrack init` (npm/curl écartés) ; PyPI immédiat, MIT ; repo public.
- PAS de MCP (enquête 2026-08-29 : les 8 agents visés ont tous un shell,
  `./plantrack` équivaut à un tools/call) — MCP en option, jamais en socle.
- Plafond pt.py : **1450 lignes** (relevé de 1400 le 2026-08-30 ; le fichier
  unique vendoré est une architecture immuable, jamais l'éclater).
- Post-commit journalisant : d'office à l'init ; pre-commit garde-fou :
  opt-in `--git-hook`.
- JAMAIS installer un agent de codage pour valider (tester sur le contrat
  documenté) ; jamais ccr ni clé API Anthropic.
- Sur bcc : PlanTrack N'EST PAS installé — c'est Mariella qui installe.
  (bcc `server/index.ts:254` : `settingSources: ["user","project","local"]`
  → un `uvx plantrack init` y brancherait Claude Code ET l'agent
  intermédiaire d'un coup.)

## Faits mesurés / pièges (coûteux à redécouvrir)
- Publier = bump `pyproject.toml` + tag `vX.Y.Z` poussé → `publish.yml`
  (trusted publishing, AUCUN token). Attendre que
  `curl https://pypi.org/simple/plantrack/` contienne X.Y.Z (l'API JSON est
  indexée AVANT l'index simple qu'utilise uv).
- scenario.sh exporte `CLAUDE_PROJECT_DIR` globalement → pollue les commits
  git des tests dans d'autres répertoires : `env -u CLAUDE_PROJECT_DIR`.
- Sécurité (2026-08-29) : gitleaks 50 commits + passe manuelle = propre ;
  secret scanning + push protection GitHub ACTIVÉS sur le repo.
- Trackers SQLite maison comparés : prolearn-knowledge.db = base de
  connaissance riche, reste un outil séparé ; s69 track.py et miamboost
  log.py = sous-ensembles de PlanTrack (aucun n'a de réinjection auto).
- Les commits portent la signature Co-Authored-By de Claude (convention
  Claude Code) ; Mariella ne s'est pas prononcée sur son retrait
  (`includeCoAuthoredBy: false`) — ne rien changer sans sa demande.

## Prochaine action exacte
Aucune tâche en attente. Le prochain jalon (§16 Publication complète,
réduit à la démo) est CONDITIONNÉ aux chiffres de `plantrack stats` après
usage réel — c'est Mariella qui décide de l'ouvrir. À lire en arrivant :
`.planning/session-state.md`, puis `PRD-PlanTrack-v0.2.md` §15–16.
