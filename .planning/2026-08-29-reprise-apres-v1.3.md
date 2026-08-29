# Reprise — PlanTrack après v1.3.1 (2026-08-29)

Prompt autonome : la session qui lit ceci ne sait rien des précédentes.

## Objectif du projet
PlanTrack : contexte, plan et bugs persistants pour longues sessions d'agent,
installable partout (`uvx plantrack init`). Le PRD fait foi :
`PRD-PlanTrack-v0.2.md` (jalons §16). Repo GitHub : `mdjlabs/plantrack`
(privé), paquet PyPI `plantrack` (public, MIT).

## Où on en est
TOUT le périmètre décidé est livré, commité, poussé, publié :
- couches 1–4 + init/doctor/stats + portage Codex (§13) ;
- v1.1.0 : publication PyPI par trusted publishing (GitHub Actions) ;
- v1.2.0 : découverte multi-agents — bloc complet dans `AGENTS.md`
  (source unique), ligne d'import `@AGENTS.md` dans `CLAUDE.md`/`GEMINI.md`,
  hooks `.claude/settings.json` + `.codex/hooks.json` écrits d'office ;
- v1.3.0 : skill Deep Code `.deepcode/skills/plantrack/SKILL.md` — une
  **référence** vers AGENTS.md, jamais une duplication (principe posé par
  Mariella : UN fichier source + des références partout ailleurs) ;
- v1.3.1 : correctifs du rapport de terrain miamboost
  (`.planning/2026-08-29-rapport-install-claude-code.md`) — `init` FUSIONNE
  les hooks dans un `settings.json` existant (idempotent, atomique),
  `--git-hook` n'ampute plus l'installation, échec → « INCOMPLETE ».
Derniers commits : `941806c` (v1.3.1), `e0a62b3` (session-state).
150 checks verts (`bash tests/scenario.sh`), aussi en environnement nu.

## Décisions tranchées par Mariella (immuables)
- Commande publique : `uvx plantrack init` (npm/curl écartés, PRD §16).
- Publication PyPI immédiate, MIT ; repo GitHub reste privé — le reste du
  jalon Publication (repo public, démo) attend les chiffres du §15.
- Supporter Deep Code (tiers) — contre la reco « rien pour l'instant ».
- JAMAIS installer un agent de codage pour valider (tester sur le contrat
  documenté) ; jamais ccr ni clé API Anthropic.

## Faits mesurés / pièges (coûteux à redécouvrir)
- Publier = bump `version` dans `pyproject.toml` + `git tag vX.Y.Z` +
  `git push origin vX.Y.Z` → Actions `publish.yml` fait le reste (trusted
  publishing, AUCUN token). Un bloc `permissions:` doit garder
  `contents: read` sinon le checkout échoue.
- Juste après un tag, l'index PyPI sert l'ancienne version à uvx → tester
  avec `uvx --refresh --from 'plantrack==X.Y.Z' plantrack init`. L'API JSON
  est indexée AVANT l'index simple qu'utilise uv : attendre que
  `curl https://pypi.org/simple/plantrack/` contienne X.Y.Z.
- `git push -q 2>/dev/null` masque les échecs — jamais sur un push critique.
- Compatibilité vérifiée (web, 2026-08, sources au README) : ZCode, Grok
  Build, Kimi Code CLI, Mistral Vibe lisent AGENTS.md nativement ; aucun
  agent tiers ne supporte l'import `@fichier` ; DeepSeek n'a pas de CLI
  officiel (d'où Deep Code, format SKILL.md compatible Claude Code).
- `pt.py` : 1183 lignes, plafond dérogé 1200 — marge presque nulle, tout
  prochain ajout devra d'abord dégraisser.

## Prochaine action exacte
Aucune tâche en attente. Le prochain jalon (§16 Publication complète) est
CONDITIONNÉ aux chiffres de `plantrack stats` après usage réel — c'est
Mariella qui décide de l'ouvrir. À lire en arrivant :
`.planning/session-state.md`, puis `PRD-PlanTrack-v0.2.md` §15–16.
