<!-- plantrack:start -->
## PlanTrack
- L'état du projet t'est injecté automatiquement en début de session et après chaque compaction. Fie-toi à ce bloc, pas à ta mémoire de la conversation.
- Ne réimplémente jamais ce qui figure sous DECISIONS ACTEES.
- Ne modifie pas les fichiers d'un fil en pause.
- Après correction d'un bug : consigne la tentative, puis passe-le en "to_verify". Tu ne valides jamais un bug toi-même.
- Quand une décision se prend en conversation, enregistre-la toi-même : `./plantrack decide "..."` (marquée agent). Un bug repéré en passant : `./plantrack bug "..."`. Un piège technique découvert : `./plantrack piege "..."`.
- Avant de corriger un bug : lis `./plantrack attempts <id>`, puis dépose ton hypothèse `./plantrack attempt <id> "..."` avant de coder ; une hypothèse refusée a déjà été tentée, change d'approche.
- Une question posée à l'humain restée sans réponse : `./plantrack question "..."` — elle ressortira à chaque session jusqu'à la réponse.
- Ouvre un fil AVANT de coder : `!focus <sujet>` (`!park <note>` pour changer de sujet, `!close` quand c'est fini). Chaque commit est journalisé sur le fil actif ; à défaut de fil, PlanTrack en ouvre un d'office au nom de la branche — nomme-le toi-même, c'est plus utile.
- Si `!testcheck on` est actif, structure les recettes de test en guide/étapes (`./plantrack guide`, `./plantrack step`) ; tu ne poses JAMAIS le verdict toi-même, il est réservé à l'humain (`./plantrack check`).
<!-- plantrack:end -->
<!-- plantrack:state -->
<!-- genere par plantrack a chaque commit — ne pas editer a la main -->
```

!! BUG BLOQUANT — a traiter avant toute autre chose : b1 Troncature du bloc reinjecte : sur bcc le bloc re…

FIL ACTIF — t3 : parcours : phases porteuses de regles (note bcc du 13/09) [10 commits]
  fichiers recemment ecrits : parcours/projet-client.json, tests/scenario.sh, .claude/hooks/pt.py, .planning/session-state.md, ../../../root/.claude/projects/-home-mariella-plantrack/memory/MEMORY.md, ../../../root/.claude/projects/-home-mariella-plantrack/memory/mission-surveillance-plantrack.md

FILS EN PAUSE (ne pas y toucher sans reprise explicite) :
  t2 : verdict humain en session (!verify / !reject) — reprise : tri des bugs livre et propage (plantrack/bcc/miamboost) ; reste a faire valider…

BUGS EN ATTENTE DE TON VERDICT (corriges, ne pas les refaire) :
  b4 (to_verify) [t1] Le fil actif auto-ouvert affiche une note pedagogique de 99 chars ('fil ouvert … (agent) [1 tent.]
  b5 (to_verify) [t1] Worktree git (.git = fichier gitdir:) : branch() lit .git/HEAD et retombe en si… (agent) [1 tent.]
  b6 (to_verify) [t1] hook-filelog n'ecoute que Edit|Write|MultiEdit|NotebookEdit : les modifications… (agent) [2 tent.]
  b7 (to_verify) [t1] 9 des 14 except de pt.py avalent sans aucune trace (note_injection, diagnose da… (agent) [1 tent.]
  b8 (to_verify) [t2] Selection des bugs du bloc reinjecte : context_block prend bugs[-CTX_MAX_BUGS:]… (agent) [2 tent.]
  b9 (to_verify) [t2] AGENTS.md n'est regenere qu'au post-commit : toute ecriture faite SANS commit d… (agent) [2 tent.]
  b10 (to_verify) [t3] usage_gap compare deux horloges differentes : la fenetre 'since' vient du times… (agent) [1 tent.]
  b11 (to_verify) [t3] verify b5 (agent) [1 tent.]

DECISIONS ACTEES (ne jamais revenir dessus ni reimplementer) :
  d1 : Purge des transcripts : hook-precompact ne garde que les 5 derniers (MAX_ARCHIV… (agent)
  d2 : Cause racine des pannes PlanTrack (constat du 06/09 sur bcc et miamboost) : l'o… (agent)
  d3 : Parcours retenu EN ENTIER (choix de Mariella, 22/09) : une phase porte regle + … (agent)
  d4 : Mariella (23/09, tel) : abandon de l'implementation du design (erreur de projet… (agent)

Pieges connus :
  pg4 : Un commit amende ou reset apres le post-commit reste dans le journal append-onl…
  pg5 : injections.json ne porte que la cle 'claude' sur bcc et miamboost : rien ne pro…
  pg6 : Le garde-fou pre-commit refuse tout fichier touche par un fil PARQUE : sur un o…
  pg7 : Propager le coeur vendorise vers un depot ou une AUTRE session Claude travaille…
  pg8 : tests/scenario.sh, test 30 ('commits arrives au carnet 2/2') : observe rouge un…
  pg9 : Une porte humaine sans aucune question posee ne s'ouvre PAS : 'phase next' exig…
```
<!-- plantrack:state-end -->
