# Reprise PlanTrack — après v1.1 (2026-08-29)

La session précédente ne laisse RIEN en suspens. Ce fichier est autonome :
la session qui le lit ne sait rien de celle qui l'a écrit.

## Objectif du projet
PlanTrack : contexte, plan et bugs persistants pour longues sessions d'agent —
un seul fichier Python (`.claude/hooks/pt.py`), journal append-only
`.plantrack/events.jsonl`, 4 hooks. Le PRD fait foi : `PRD-PlanTrack-v0.2.md`
(plus AUCUNE question ouverte — §17 tranché le 2026-08-29).

## Où on en est (fait)
- **v1.0** (couches 1-4) + **v1.1 SOLDÉE** : init vendorisé, doctor, stats,
  pyproject installable, portage Codex §13 (`init --agent codex` écrit
  `.codex/hooks.json`). Tête : `6c15090` + commit memlog.
- **Repo GitHub** : `https://github.com/mdjlabs/plantrack`, PRIVÉ, remote
  `origin`, tout poussé. (Créé sous Slimariella puis transféré à l'org
  mdjlabs créée par Mariella le 2026-08-29.) L'URL d'installation du README
  est réelle : `uvx --from git+https://github.com/mdjlabs/plantrack plantrack init`.
- **Tests** : `bash tests/scenario.sh` → 130 checks verts (aussi en env nu
  `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`). pt.py : 1101 lignes
  (plafond dérogé : 1200 — marge faible, éclater si on dépasse).

## Décisions de Mariella (immuables)
- **PlanTrack est COMPATIBLE avec les agents CLI, il n'en installe JAMAIS** :
  « Le but c'est que ce mini projet soit compatible avec n'importe quel agent
  de codage cli, non pas de tous les installer. le user installera ceux qu'il
  voudra. » Valider un portage = tester le contrat documenté (JSON simulés),
  jamais installer l'agent. Critère v1.1 du PRD amendé en ce sens.
- **Interdits permanents** : jamais ccr/claude-code-router, jamais de clé API
  Anthropic (mémoires globales déjà écrites).
- §17 : wont_fix proposé en prose + `!note` (pas d'état formel) ; mode strict
  §10-B pas construit tant que `plantrack stats` ne montre pas de blocages
  pre-commit fréquents, jamais par défaut.
- Repo privé jusqu'au jalon Publication ; PyPI attendra ce jalon.

## Faits mesurés à ne pas re-payer
- Hooks Codex (doc + code source openai/codex) : réinjection post-compaction
  = `SessionStart` avec `source:"compact"` (PostCompact n'injecte rien) ;
  `apply_patch` n'a pas de file_path → chemins parsés dans le texte du patch,
  relatifs au cwd de session ; hooks lancés dans le cwd (parfois
  sous-répertoire) → la commande pose PLANTRACK_ROOT via
  `git rev-parse --show-toplevel` ; trust une fois via `/hooks` dans Codex.
- `CODEX_THREAD_ID`/`CODEX_SANDBOX` (détection de rôle) : issues du code
  source, NON documentées — noté « à confirmer par un utilisateur réel »
  dans README et pt.py.
- Créer une organisation GitHub = navigateur uniquement (aucune API/CLI).
- Transfert de repo : `gh api repos/<old>/plantrack/transfer -f new_owner=…`
  fonctionne, redirections automatiques.

## Prochaine action exacte
Rien d'obligatoire. Le prochain jalon (§16 : Publication — PyPI, repo public)
ne se lance QUE si les chiffres de `plantrack stats` justifient l'outil après
usage réel (mesure de 2 semaines décrite dans le README). Chantier optionnel
utile avant : tester l'installation réelle depuis GitHub sur un projet vierge
(`uvx --from git+https://github.com/mdjlabs/plantrack plantrack init`).

## Fichiers à lire en reprise
- `.planning/session-state.md` (historique détaillé des jalons)
- `PRD-PlanTrack-v0.2.md` (la référence)
- `README.md` (contrat utilisateur)
