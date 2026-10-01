<!-- plantrack:start -->
## PlanTrack
- Un RÉSUMÉ de l'état t'est injecté en début de session et après chaque compaction ; l'état COMPLET (décisions, bugs, pièges, questions) est dans AGENTS.md, section « instantané de l'état ». Fie-toi à lui, pas à ta mémoire de la conversation.
- Ne réimplémente jamais ce qui figure sous DECISIONS ACTEES.
- Ne modifie pas les fichiers d'un fil en pause.
- Après correction d'un bug : consigne la tentative, puis passe-le en "to_verify". Tu ne valides jamais un bug toi-même. Exception : l'humain t'a donné son verdict par un canal relayé (téléphone, carnet web) → saisis-le avec son attestation citée : `./plantrack verify <id> --de "<canal> : <sa réponse>"` (idem reject/answer). Jamais sans citation réelle.
- Quand une décision se prend en conversation, enregistre-la toi-même : `./plantrack decide "..."` (marquée agent). Un bug repéré en passant : `./plantrack bug "..."`. Un piège technique découvert : `./plantrack piege "..."`.
- Avant de corriger un bug : lis `./plantrack attempts <id>`, puis dépose ton hypothèse `./plantrack attempt <id> "..."` avant de coder ; une hypothèse refusée a déjà été tentée, change d'approche.
- Une question posée à l'humain restée sans réponse : `./plantrack question "..."` — elle ressortira à chaque session jusqu'à la réponse.
- Ouvre un fil AVANT de coder : `!focus <sujet>` (`!park <note>` pour changer de sujet, `!close` quand c'est fini). Chaque commit est journalisé sur le fil actif ; à défaut de fil, PlanTrack en ouvre un d'office au nom de la branche — nomme-le toi-même, c'est plus utile.
- Si `!testcheck on` est actif, structure les recettes de test en guide/étapes (`./plantrack guide`, `./plantrack step`) ; tu ne poses JAMAIS le verdict toi-même, il est réservé à l'humain (`./plantrack check`).
<!-- plantrack:end -->
<!-- plantrack:state -->
<!-- genere par plantrack a chaque commit — ne pas editer a la main -->
```

FIL ACTIF — t3 : parcours : phases porteuses de regles (note bcc du 13/09) [65 commits]
  fichiers recemment ecrits : .claude/hooks/pt.py, .planning/scenario.log, .gitignore, ../Clients/s69-francoviet/.gitignore, .planning/session-state.md, .planning/ronde-reference.txt

FILS EN PAUSE (ne pas y toucher sans reprise explicite) :
  t2 : verdict humain en session (!verify / !reject) — reprise : tri des bugs livre et propage (plantrack/bcc/miamboost) ; reste a faire valider b8 par Mariella

DECISIONS ACTEES (ne jamais revenir dessus ni reimplementer) :
  d1 : Purge des transcripts : hook-precompact ne garde que les 5 derniers (MAX_ARCHIVES). Constate le 05/09 sur bcc — 1,7 Go pour 15 archives, ch… (agent)
  d2 : Cause racine des pannes PlanTrack (constat du 06/09 sur bcc et miamboost) : l'outil se degrade en SILENCE et son seul controle, doctor, dev… (agent)
  d3 : Parcours retenu EN ENTIER (choix de Mariella, 22/09) : une phase porte regle + livrable + porte (agent|humain) + questions(bool), 'phase ne… (agent)
  d4 : Mariella (23/09, tel) : abandon de l'implementation du design (erreur de projet). Nouvelle mission de la session : surveiller le bon foncti… (agent)
  d5 : Verdicts de Mariella (23/09, tel, via fil bcc) : b3 VALIDE ; b1 et b2 REFUSES (motif en attente). Le statut reste to_verify car verify/reje… (agent)
  d6 : Mariella (23/09, tel) : nouvelle approche b1/b2 = resume court + fiche complete. Le bloc reinjecte devient un resume minimal (bloquant, fil… (agent)
  d7 : Verdicts de Mariella (23/09, tel, suite) : b4, b5, b6, b7, b8, b9, b10, b11 TOUS VALIDES. La CLI refuse verify cote agent : saisie officiel… (agent)
  d8 : Chantier canal humain (q15/d107) LIVRE : verify, reject et answer acceptent --de "<canal> : <reponse citee>" en env agent — le verdict rela… (agent)
  d9 : Mariella (tel, appels 1989/2003 du 23/09, phrase notee telle quelle) : 'Je ne veux pas perdre d'informations. On me propose la meilleure so… (agent)
  d10 : Verdicts Mariella (tel, 24/09, via AskUserQuestion) : (1) s69-francoviet — garde-fou pre-commit INSTALLE (init --git-hook, doctor vert) ; (… (agent)
  d11 : Mariella (tel, 25/09) : ne JAMAIS relayer dans le fil plantrack les questions produit d'un AUTRE projet (soudure/profil). Sa reponse citee … (agent)
  d12 : Mariella (tel, 26/09) : on reste en surveillance — rondes quotidiennes, ne la deranger que sur une vraie panne technique PlanTrack. Le chan… (agent)
  d13 : Mariella (tel, 29/09) : s69-francoviet depasse le budget de reinjection (3070/3000) car il tourne sur l'ancien coeur (avant resume court d6… (agent)
  d14 : Mariella (tel, 29/09 soir) : apres propagation s69 (budget 905/3000), choix 'Rester en veille' — ronde demain, ne la deranger que sur panne… (agent)
  d15 : Mariella (tel, 01/10, via AskUserQuestion) : promovie sans garde-fou -> 'Poser le garde-fou (Recommande)'. Installe (init --git-hook), doct… (agent)
  d16 : Mariella (tel, 01/10) : apres garde-fou promovie et b13 valide, choix 'Rester en veille (Recommande)' — ronde toutes les 4 h, ne la derange… (agent)

Pieges connus :
  pg1 : L'ecart 'commits arrives au carnet' du doctor remonte jusqu'a l'installation (U…
  pg2 : Un hook git greffe par PlanTrack est efface si son proprietaire le regenere (le…
  pg3 : read_events relit et reparse tout le journal a chaque appel, hook_commit le lit…
  pg4 : Un commit amende ou reset apres le post-commit reste dans le journal append-onl…
  pg5 : injections.json ne porte que la cle 'claude' sur bcc et miamboost : rien ne pro…
  pg6 : Le garde-fou pre-commit refuse tout fichier touche par un fil PARQUE : sur un o…
  pg7 : Propager le coeur vendorise vers un depot ou une AUTRE session Claude travaille…
  pg8 : tests/scenario.sh, test 30 ('commits arrives au carnet 2/2') : observe rouge un…
  pg9 : Une porte humaine sans aucune question posee ne s'ouvre PAS : 'phase next' exig…
  pg10 : Le post-commit journalise le commit lui-meme (events.jsonl) et regenere l'insta…
  pg11 : Les tests en reel laissent leurs depots /tmp dans ~/.plantrack-repos : doctor -…
  pg12 : Le defaut doctor 'commits rattaches a un fil' est RETROACTIF comme pg1 : sur pr…
  pg13 : Gabarit de parcours : la phase de construction est a 'questions: false', mais u…
```
<!-- plantrack:state-end -->
