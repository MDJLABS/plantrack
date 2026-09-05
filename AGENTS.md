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

FIL ACTIF — t1 : surveillance des repos plantrack [7 commits]
  fichiers recemment ecrits : ../../../tmp/claude-0/-home-mariella-plantrack/25db747d-ebf4-407e-b1fe-4b9b89070138/scratchpad/carnet-deux-depots.html, ../../../tmp/claude-0/-home-mariella-plantrack/25db747d-ebf4-407e-b1fe-4b9b89070138/scratchpad/regle-manquante.html, .claude/hooks/pt.py

DECISIONS ACTEES (ne jamais revenir dessus ni reimplementer) :
  d1 : Purge des transcripts : hook-precompact ne garde que les 5 derniers (MAX_ARCHIVES). Constate le 05/09 sur bcc — 1,7 Go pour 15 archives, ch… (agent)
```
<!-- plantrack:state-end -->
