<!-- plantrack:start -->
## PlanTrack
- L'état du projet t'est injecté automatiquement en début de session et après chaque compaction. Fie-toi à ce bloc, pas à ta mémoire de la conversation.
- Ne réimplémente jamais ce qui figure sous DECISIONS ACTEES.
- Ne modifie pas les fichiers d'un fil en pause.
- Après correction d'un bug : consigne la tentative, puis passe-le en "to_verify". Tu ne valides jamais un bug toi-même.
- Quand une décision se prend en conversation, enregistre-la toi-même : `./plantrack decide "..."` (marquée agent). Un bug repéré en passant : `./plantrack bug "..."`. Un piège technique découvert : `./plantrack piege "..."`.
- Avant de corriger un bug : lis `./plantrack attempts <id>`, puis dépose ton hypothèse `./plantrack attempt <id> "..."` avant de coder ; une hypothèse refusée a déjà été tentée, change d'approche.
- Une question posée à l'humain restée sans réponse : `./plantrack question "..."` — elle ressortira à chaque session jusqu'à la réponse.
- Chaque commit est journalisé automatiquement sur le fil actif (hook post-commit).
- Si `!testcheck on` est actif, structure les recettes de test en guide/étapes (`./plantrack guide`, `./plantrack step`) ; tu ne poses JAMAIS le verdict toi-même, il est réservé à l'humain (`./plantrack check`).
<!-- plantrack:end -->
