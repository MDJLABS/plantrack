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
- Si `!testcheck on` est actif, structure les recettes de test en guide/étapes (`./plantrack guide`, `./plantrack step <g> "<un geste>" --attendu "<ce qu'on doit voir>"`) ; tu ne poses JAMAIS le verdict toi-même, il est réservé à l'humain (`./plantrack check`). Verdict donné par un canal relayé (téléphone) → `./plantrack check <s> ok|ko --de "<canal> : <sa réponse>"` — idem pour chaque point d'un compte-rendu du guide de test qu'il colle dans le chat.
<!-- plantrack:end -->
<!-- plantrack:state -->
<!-- genere par plantrack a chaque commit — ne pas editer a la main -->
```

FIL ACTIF — t21 : travaux sur main [15 commits]
  fichiers recemment ecrits : ../../../root/.claude/plans/contexte-reconstruit-par-le-woolly-feigenbaum.md, ../../../root/.claude/plans/contexte-reconstruit-par-le-witty-quail.md, ../../../root/.claude/plans/contexte-reconstruit-par-le-snappy-catmull.md, ../../../usr/local/bin/vps-charge-alerte.sh, sortie/carte-suite.log, ../../../root/.claude/plans/contexte-reconstruit-par-le-zazzy-sun.md
  (fil ouvert d'office pour ne perdre aucun commit — `!close` puis `!focus <sujet>` pour le nommer)

FILS EN PAUSE (ne pas y toucher sans reprise explicite) :
  t2 : verdict humain en session (!verify / !reject) — reprise : tri des bugs livre et propage (plantrack/bcc/miamboost) ; reste a faire valider b8 par Mariella
  t5 : travaux sur main — reprise : retour au travail courant apres la faille

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
  d17 : Mariella (tel, 01/10 14h, via AskUserQuestion) : ronde de 14h verte (alerte miamboost b11 = fil miamboost, d11), choix 'Rester en veille (R… (agent)
  d18 : Mariella (tel, 03/10 10h45, via AskUserQuestion) : Myview (nouveau projet du 03/10) sans garde-fou -> 'Poser le garde-fou (Recommande)'. In… (agent)
  d19 : Mariella (tel, 03/10 10h50) : apres garde-fou Myview, choix 'Rester en veille (Recommande)' — ronde toutes les 4 h, ne la deranger que sur … (agent)
  d20 : Mariella (tel, 04/10 15h40, via AskUserQuestion) : essai-d180 (jeu Robo Defense, nouveau depot du 03/10) sans garde-fou -> 'Poser le garde-… (agent)
  d21 : Mariella (tel, 04/10 apres-midi) : apres garde-fou essai-d180, choix 'Rester en veille (Recommande)' — ronde toutes les 4 h, ne la deranger… (agent)
  d22 : Mariella (tel, 04/10 18h07, via AskUserQuestion) : relance auto sans travail, choix 'Rester en veille (Recommande)' — prochaine ronde vers … (agent)
  d23 : Mariella (tel, 05/10, via AskUserQuestion) : veille SILENCIEUSE — 'Silence sauf panne (Recommande)'. Plus jamais de carte 'on fait quoi ens… (agent)
  d24 : Mariella (tel, 09/10 soir, via carte Suite) : refus de la ronde sans rien faire, puis choix 'Brainstorming de la suite (Recommande)' — on c… (agent)
  d25 : Ronde automatique LIVREE (choix Mariella 09/10, carte brainstorm) : minuteur systeme plantrack-ronde.timer toutes les 4 h lance ronde.sh (d… (agent)
  d26 : Mariella (tel, 09/10, via AskUserQuestion) : bug worktree s69 -> 'Rapatrier + corriger (Recommande)' : recopier les 9 evenements de la copi… (agent)
  d27 : Publication v1.9.0 (demande Mariella 09/10, tel : 'mettre a jour GitHub et l'autre plateforme') : main pousse sur GitHub, tag v1.9.0, PyPI … (agent)
  d28 : Rattrapage auto LIVRE (choix Mariella 10/10, carte brainstorm 'Rattrapage auto (Recommande)') : ronde.sh passe 'update' sur chaque depot de… (agent)
  d29 : Carnet accelere LIVRE (choix Mariella 10/10, carte 'Accelerer le carnet (Recommande)') : read_events analyse le journal une seule fois par … (agent)
  d30 : Mariella (tel, 10/10, via AskUserQuestion) : apres carnet accelere (v1.9.1), choix 'Rester en veille (Recommande)' — veille silencieuse (d2… (agent)
  d31 : v1.9.3 publiee (10/10) : correctif b16 — la ronde rattrape un pt.py modifie non commite s'il est identique a une version publiee (tag), lai… (agent)
  d32 : Mariella (tel, 10/10, carte brainstorm BMAD guide de test prolearn) : 'Telephone d'abord (Recommande)' — PlanTrack ecrit les points de test… (agent)
  d33 : v1.9.4 publiee (10/10, choix Mariella tel 'Publier v1.9.4 (Recommande)') : guide de test facon prolearn (step --attendu, check --de, guide … (agent)
  d34 : Le moteur du guide de test (Next.js) vit dans PlanTrack, propage par update ; scenarios propres a chaque site (choix Mariella tel 10/10 : '… (agent)
  d35 : v1.9.5 publiee (10/10, GitHub + PyPI verifie) : moteur du guide de test dans .claude/hooks/plantrack_guide, recopie par init/update dans to… (agent)
  d36 : Mariella (tel, 10/10 soir, via AskUserQuestion) : apres v1.9.5 (guide dans PlanTrack), choix 'Laisser la ronde faire (Recommande)' — propag… (agent)
  d37 : Mariella (tel, 11/10, carte brainstorm) : 'Bilan de la semaine (Recommande)' — un message court par semaine dans le fil PlanTrack (repondre… (agent)
  d38 : Bilan de la semaine LIVRE (d37, plan valide par Mariella tel 11/10) : 'plantrack bilan [--all] [--jours N]' + bilan.sh (bulle via repondre.… (agent)
  d39 : Mariella (tel, 11/10, carte brainstorm) : 'Regler les pieges connus (Recommande)' — verbe piege-clos, doctor compte par sha (pg4/pg8), gard… (agent)
  d40 : v1.9.7 publiee (11/10, GitHub + PyPI verifie) : piege-clos, doctor par sha (pg4/pg8), garde wrapper (pg14), message pre-commit (pg6). Piege… (agent)
  d41 : Mariella (tel, 11/10, carte brainstorm apres v1.9.7) : 'Tri groupe des attentes (Recommande)' — une seule carte par projet, dans le fil de … (agent)
  d42 : Mariella (tel, 11/10) : tri groupe -> 'Quand je rouvre le projet (Recommande)' : la carte part de la session du projet (resume reinjecte), … (agent)
  d43 : v1.9.8 publiee (11/10, GitHub + PyPI verifie) : tri groupe — le resume reinjecte propose UNE carte (liste / tout valider / plus tard) quand… (agent)
  d44 : Mariella (tel, 11/10, via AskUserQuestion) : apres v1.9.8, choix 'Attendre le bilan de ce soir (Recommande)' — veille jusqu'au bilan du dim… (agent)
  d45 : Logo PlanTrack (choix Mariella tel 11/10, carte logo : 'Le carnet coche (Recommande)') : .bcc/logo.svg = carnet creme + coche verte sur fon… (agent)
  d46 : v1.9.9 publiee (11/10, GitHub + PyPI verifie) : hook PreToolUse kvm-lourd. Verifie en session reelle (claude -p --debug-file, stub kvm-lour… (agent)
  d47 : v1.9.10 publiee (11/10, GitHub + PyPI verifie) : garde-fou choisi par Mariella (tel, carte Securite : 'Ajouter un garde-fou (Recommande)') … (agent)
  d48 : Verification consigne kvm-lourd (11/10, choix Mariella tel 'Tester ./gradlew build (Recommande)') : en session reelle dans bcc, './gradlew … (agent)
  d49 : kvm-lourd corrige (choix Mariella tel 11/10 'Corriger kvm-lourd (Recommande)') : classe lit la commande comme le shell (shlex) — texte cite… (agent)
  d50 : Mariella (tel, 12/10, via AskUserQuestion) : tri des bugs en attente -> 'Dans chaque projet (Recommande)' (respect d11/d42) : la carte de t… (agent)
  d51 : Mariella (tel, 12/10) : la ronde PlanTrack s'execute dans chaque projet, a l'ouverture (choix 'A l'ouverture du projet (Recommande)'), Plan… (agent)
  d52 : v1.9.11 publiee (12/10, GitHub + PyPI verifie) : ronde dans chaque projet (d51) — SessionStart lance 'plantrack ronde' en fond si la dernie… (agent)
  d53 : kvm-lourd estimation corrigee (choix Mariella tel 12/10 'Estimation + alerte (Recommande)') : 1,2 x MEDIANE des 10 derniers pics (au lieu d… (agent)
  d54 : v1.9.12 publiee (13/10, GitHub + PyPI verifie, plan valide par Mariella tel 'Vu') : le bilan du dimanche fait le controle de sante (diagnos… (agent)
  d55 : v1.9.13 publiee (13/10, GitHub + PyPI verifie, choix Mariella tel carte brainstorm 'Voyant qui s'eteint seul (Recommande)', plan valide) : … (agent)
  d56 : Mariella (tel, 13/10, carte brainstorm BMAD nom) : 'Garder PlanTrack (Recommande)' — pas de renommage en Plan Manager ; la gestion des prio… (agent)
  d57 : Mariella (tel, 13/10) : on garde le nom PlanTrack ; la gestion des priorites (kvm-lourd) est une partie de PlanTrack. Surveillance : 4 sema… (agent)
  d58 : Presentation + surveillance LIVREES (d57, 13/10) : page https://plantrack-schemas.pages.dev completee (schema 0 'de bout en bout', section … (agent)
  d59 : Mariella (tel, 14/10, via AskUserQuestion) : prorent questions hors porte -> 'Autoriser ces questions (Recommande)' : en construction, une … (agent)
  d60 : 5 defauts du releve regles (14/10, plan valide tel) : v1.9.14-1.9.16 publiees (GitHub + PyPI verifie) — questions de prerequis humain permi… (agent)
  d61 : Mariella (tel, 14/10, via AskUserQuestion) : apres reglage des 5 defauts (v1.9.16), choix 'Rester en veille (Recommande)' — veille silencie… (agent)
  d62 : v1.9.17 publiee (14/10, plan valide tel) : correctif b20 — la ronde de chaque projet rattrape un pt.py non commite identique a une version … (agent)
  d63 : Mariella (tel, 15/10, carte brainstorm de la suite) : 'Eteindre les fausses alertes (Recommande)' — les 4 rouges recurrents du releve analy… (agent)
  d64 : v1.9.18 publiee (15/10, GitHub + PyPI verifie) : d63 livre — controle 'commits sans fil' borne a USAGE_DAYS (pg12 clos). Les rouges prorent… (agent)
  d65 : Serveur sature 16/10 14h35-15h25 (demande Mariella tel) : cause = build gradle de profil range dans sortie/build-mt-pc.sh, invisible pour k… (agent)
  d66 : Menage prudent LIVRE (choix Mariella tel 17/10 q3, plan valide) : /usr/local/bin/menage-serveur.sh + menage-serveur.timer (horaire). Eteint… (agent)
  d67 : Alerte avant saturation LIVREE (choix Mariella tel 17/10, carte brainstorm 'Alerte avant saturation (Recommande)', plan valide) : menage-se… (agent)
  d68 : Mariella (tel, 17/10, via AskUserQuestion) : message d'essai de l'alerte memoire RECU ; choix 'Recu, retour en veille (Recommande)' — veill… (agent)
  d69 : v1.9.20 publiee (18/10, accord Mariella tel 'Vu' sur la carte cvslim) : flotte() lance le doctor de chaque depot avec le pt.py de l'appelan… (agent)
  d70 : Mariella (tel, 18/10, via AskUserQuestion) : apres v1.9.20 (fausse alerte cvslim eteinte), choix 'Rester en veille (Recommande)' — veille s… (agent)
  d71 : Verification des chiffres de l'alerte 15h02 (demande Mariella tel 18/10 'verifie si les datas sont bonnes', plan valide) : RAM/swap 99 % re… (agent)
  d72 : Mariella (tel, 18/10 15h49) : apres verification des chiffres de l'alerte 15h02, choix 'Rester en veille (Recommande)' — veille silencieuse… (agent)

Pieges connus :
  pg9 : Une porte humaine sans aucune question posee ne s'ouvre PAS : 'phase next' exig…
  pg10 : Le post-commit journalise le commit lui-meme (events.jsonl) et regenere l'insta…
  pg13 : Gabarit de parcours : la phase de construction est a 'questions: false', mais u…
  pg15 : Le Stop hook bcc (hook/index.ts, regle 'projet ne s'endort jamais' du 03/10) EX…
```
<!-- plantrack:state-end -->
