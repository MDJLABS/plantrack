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

FIL ACTIF — t23 : guides de test automatiques (d100) [129 commits]
  fichiers recemment ecrits : sortie/carte-attente-1540.json, sortie/carte-attente-1540.log, ../../../root/.claude/plans/contexte-reconstruit-par-le-cozy-rivest.md, sortie/carte-attente-1626.json, sortie/carte-attente-1626.log, ../../../root/.claude/plans/contexte-reconstruit-par-le-rosy-flask.md

FILS EN PAUSE (ne pas y toucher sans reprise explicite) :
  t2 : verdict humain en session (!verify / !reject) — reprise : tri des bugs livre et propage (plantrack/bcc/miamboost) ; reste a faire valider b8 par Mariella
  t5 : travaux sur main — reprise : retour au travail courant apres la faille

BUGS EN ATTENTE DE TON VERDICT (corriges, ne pas les refaire) :
  b24 (to_verify) [t22] mdjlabs-site : la synchro du moteur de guide a ecrase guide-verdict.ts — guide-envoi.ts et ses tests importent compteRenduMarkdown et prog.… (agent) [3 tentatives, derniere: Re-ecrasement du 28/10 19h25 : la ronde de mdjlabs a lance …]
  b25 (to_verify) [t23] guide-lien rend le jeton en clair a l'agent et guide-resultat n'a ni require_human ni garde AGENT_ENV : l'agent peut fabriquer lui-meme un … (agent) [1 tentatives, derniere: guide-lien refuse en env agent (le lien part par node bcc/h…]
  b26 (to_verify) [t23] Moteur guide (guide-visite.ts, commun) : l'adresse du poste ou partent les resultats vient du lien (?poste=) et toute origine https est acc… (agent) [1 tentatives, derniere: validerPoste : sans liste blanche NEXT_PUBLIC_GUIDE_POSTES,…]
  b27 (to_verify) kvm-lourd historique : entree bcc/lint du 30/10 16:19 avec duree 107869.6 s (30 h) pour un eslint de quelques minutes — la duree semble com… (agent) [2 tentatives, derniere: Duree maximale par type (lint/tests 30m, build/next-build/d…]
  b30 (to_verify) [t23] Essai guide ProLearn (31/10 06h16, tel Mariella) : apres le code Cloudflare Access (accepte a 05:16:56Z dans le registre Access), la page '… (agent) [2 tentatives, derniere: d144 : portier-reveil etendu a bcc-proxy (18787) et miamboo…]
  b31 (to_verify) [t23] sync_guide (pt.py) ne cherche le moteur que sous ROOT et ROOT/src (lib/guide/types.ts) : les sites qui le rangent sous app/ (prolearn, open… (agent) [1 tentatives, derniere: sync_guide cherche le moteur sous ROOT, src, app, apps/web …]
  b32 (to_verify) [t23] Essai guide ProJob (31/10, tel Mariella) : 'catastrophe' — au lieu d'un guide qui joue les etapes pour elle, elle doit tout faire elle-meme… (agent) [1 tentatives, derniere: Guide design2 ProJob rendu automatique (27de37f, 16 points …]
  b33 (to_verify) [t23] ProJob design2 (essai Mariella 31/10 13h33, guide) : tableau de suivi, au clic sur 'Passer a' la liste s'affiche dans le cadre de la carte … (agent) [1 tentatives, derniere: Menu Passer a sorti du cadre qui defile : portail vers docu…]
  b34 (to_verify) [t23] ProJob design2 (essai Mariella 31/10 13h34-13h35, guide) : points 'La fiche : en-tete et les 5 etapes', 'L historique a l heure de Paris', … (agent) [1 tentatives, derniere: Bouton + : n'existe que sous 600 px, texte du point precise…]
  b35 (to_verify) [t23] kvm-lourd (31/10, install guide OpenStyle) : une commande 'git add ...' a ete classee 'next-build' et mise en file derriere un build Mizzze… (agent) [1 tentatives, derniere: Diagnostic, aucun changement de code : les commandes mises …]
  b36 (to_verify) [t23] Recurrence de b35 (31/10, session ProJob guide commun) : un simple 'git add <fichiers>' (etape 10 du portage guide) a ete classe 'next-buil… (agent) [1 tentatives, derniere: Meme cause que b35 : la commande de l'etape 10 contenait au…]
  b37 (to_verify) [t23] kvm-lourd (01/11) : une commande de lecture (diff/grep/ls dans prolearn) classee next-build et mise en file 8/8 — recurrence b35/b36 (agent) [1 tentatives, derniere: Cause trouvee (reproduite) : dans 'diff <(cat A) B', la par…]
  b38 (to_verify) [t23] Essai versions de test (01/11 soir, tel Mariella) : 's69 soirees mene vers le site s69 dev il me semble, et les 2 autres liens ne fonctionn… (agent) [1 tentatives, derniere: MiamBoost : miamboost-dev.mdjlabs.com classe en domaine de …]
  b39 (to_verify) [t23] Essai guide Soirees (02/11 11h, tel Mariella) : la page /soirees de la version de test s69-soirees affiche 'canal MiamBoost non configure (… (agent) [1 tentatives, derniere: Version de test branchee sur la preprod MiamBoost locale : …]
  b40 (to_verify) [t23] Essai guide Soirees (02/11 11h23, tel Mariella) : 'probleme sur les captcha cloudflare, il y en a 3 dans la page, beaucoup trop ; un seul s… (agent) [1 tentatives, derniere: s69-soirees 3c92781 : TurnstileWidget monte seulement a l'e…]
  b41 (to_verify) [t23] Orchestre (d159) : les sessions lancees sous bccsession (telephone) ne peuvent pas s'inscrire — /var/lib/plantrack-orchestre/sessions en ro… (agent) [1 tentatives, derniere: Dossier sessions en 1777 (bit collant) pose par l'orchestre…]

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
  d73 : Respiration des ressources (Mariella, 18/10, via AskUserQuestion) : PlanTrack gere la charge comme un poumon — battement a chaque hook (.pl… (agent)
  d74 : Respiration EN SERVICE (18/10, choix Mariella 'Tout mettre en service') : v1.9.21 publiee (PyPI ok) ; init dans prolearn, openstyle, proren… (agent)
  d75 : v1.9.22 publiee (18/10, GitHub + PyPI verifie, plan valide par Mariella) : correctif b22 — hooks Codex sans repli sur le cwd (exit 0 hors d… (agent)
  d76 : v1.9.23 publiee (18/10, GitHub + PyPI verifie, choix Mariella tel carte brainstorm 'Empecher le travail en double (Recommande)', plan valid… (agent)
  d77 : Mariella (tel, 18/10, via AskUserQuestion) : apres v1.9.23 (pas de travail en double), choix 'Rester en veille (Recommande)' — veille silen… (agent)
  d78 : Mariella (tel, 19/10, via AskUserQuestion) : alerte charge 21h55 du 18/10 retombee seule (load 0.85, 9,8 Go dispo), choix 'Rester en veille… (agent)
  d79 : Mariella (tel, 19/10, carte brainstorm apres 2 fausses alertes de charge 21h55/06h02) : 'Alerte qui attend (Recommande)' — /usr/local/bin/v… (agent)
  d80 : Mariella (tel, 19/10, via AskUserQuestion) : apres reglage de l'alerte de charge sur moyenne 5 min (d79), choix 'Rester en veille (Recomman… (agent)
  d81 : Moins de relances a vide LIVRE (choix Mariella tel 19/10, carte brainstorm 'Moins de relances a vide (Recommande)', plan valide) : bcc serv… (agent)
  d82 : Mariella (tel, 19/10 18h39) : relances espacees (d81) -> 'Au prochain redemarrage (Recommande)' ; pas de redemarrage force, veille silencie… (agent)
  d83 : v1.9.24 publiee (21/10, GitHub + PyPI verifie, plan valide par Mariella) : licence MIT -> Apache-2.0 (choix Mariella) ; le bilan ne compte … (agent)
  d84 : v1.9.25 publiee (21/10, GitHub + PyPI verifie, plan valide par Mariella tel 'On y va') : lot 2 bcc — wont_fix accepte --de ; decide/bug/pie… (agent)
  d85 : Mariella (tel, 21/10, carte Suite) : reponse 'Vu' sans option -> veille silencieuse (d23), aucune carte de suite ; brainstorm seulement si … (agent)
  d86 : Mariella (tel, 24/10, plan approuve) : alerte charge 10h13 (3.77/2 vCPU) passagere — pic du aux demarrages de sessions Claude, 6,2 Go dispo… (agent)
  d87 : Mariella (tel, 24/10, via AskUserQuestion) : alerte memoire 11h = fausse alerte (ram 42 %, swap 96 %) -> 'Vider le secours + regler l'alert… (agent)
  d88 : Mariella (tel, 24/10, carte brainstorm) : 'Finir ce travail (Recommande)' — terminer, tester et publier le chantier import d'un projet exis… (agent)
  d89 : v1.9.26 publiee (24/10, GitHub + PyPI verifie, plan valide par Mariella tel) : import d'un projet existant — 'plantrack import <f.md|f.json… (agent)
  d90 : Mariella (tel, 24/10) : 'Vu' apres v1.9.26 (import d'un projet existant) -> veille silencieuse (d23, d85), aucune carte de suite. (agent)
  d91 : b23 corrige (24/10, plan valide par Mariella) : kvm-lourd (/usr/local/bin, hors depot, sauvegarde backup/code/usr-local-bin) lit un script … (agent)
  d92 : Mariella (tel, 25/10 20h39) : 'Vu' sur la carte veille -> veille silencieuse maintenue (d23, d85, d90), aucune carte de suite. (agent)
  d93 : Mariella (tel, 27/10, via AskUserQuestion) : respiration auto du serveur -> 'On code tout a 100 % (Recommande)' : menage-serveur.sh vide le… (agent)
  d94 : Respiration auto LIVREE (27/10, choix Mariella tel 'On code tout') : menage-serveur.sh passe toutes les 5 min (timer *:0/5) — serveur de te… (agent)
  d95 : Mariella (tel, 27/10, via AskUserQuestion) : 'Ecrans d'admin des bases (Recommande)' -> 12 conteneurs studio/pg_meta/analytics/vector (proj… (agent)
  d96 : Mariella (tel, 27/10, via AskUserQuestion) : cartes laissees de cote (b174 bcc) -> 'Petit ajout PlanTrack (Recommande)' : question --carte … (agent)
  d97 : v1.9.28 publiee (27/10, GitHub + PyPI verifie, d96) : question --carte <id> / answer --carte <id> --de ; id restreint a [A-Za-z0-9._:-]{1,6… (agent)
  d98 : Mariella (tel, 27/10, via AskUserQuestion) : apres v1.9.28 (cartes de cote), choix 'Laisser bcc finir (Recommande)' — veille silencieuse, r… (agent)
  d99 : Mariella (tel, 28/10) : plan 'Rien a faire : je reste en veille' approuve apres relance auto -> veille silencieuse maintenue (d23, d85, d98… (agent)
  d100 : Mariella (tel, 28/10, plan approuve) : guides de test qui se jouent tout seuls — 'On code tout a 100 %' : geste (clic/saisie/aller) joue pa… (agent)
  d101 : v1.9.29 publiee (28/10, GitHub + PyPI verifie, choix Mariella tel 'Publier maintenant (Recommande)') : protection b24 (update ne reecrase p… (agent)
  d102 : Mariella (tel, 28/10) : la file kvm-lourd laisse toujours au moins 5 % de RAM et de processeur libres aux taches en cours. Livre : reserve … (agent)
  d103 : Mariella (tel, 28/10, plan approuve) : brancher les guides automatiques (d100) sur mdjlabs (portage dans SON guide, garde guide-gate/compte… (agent)
  d104 : Mariella (tel, 28/10, apres essai de l'exemple essai-gestes sur preprod mdjlabs) : 'ca serait bien de laisser afficher la carte de fin pour… (agent)
  d105 : Mariella (tel, 28/10) : maquette des cartes du guide VALIDEE ('Valider, code-la (Recommande)') — https://claude.ai/artifact/CrmX2JdkqBtpuci… (agent)
  d106 : Mariella (tel, 29/10, carte Failles guide) : 'Les deux, comme conseille (Recommande)' — b26 : le guide n'envoie plus qu'au poste (liste bla… (agent)
  d107 : v1.9.30 publiee (29/10, GitHub + PyPI verifie, plan valide par Mariella tel) : b25 ferme selon d106 — guide-lien et guide-resultat refuses … (agent)
  d108 : Mariella (tel, 29/10, carte Suite) : 'Faire l'essai (Recommande)' — lien du guide d'exemple essai-gestes (mdjlabs) envoye par le nouveau ho… (agent)
  d109 : Correction de d108 : l'essai sur mdjlabs n'exerce PAS b25/b26 (mdjlabs envoie ses verdicts par sa Function /api/guide-verdict, pas par bcc … (agent)
  d110 : Mariella (tel, 29/10, carte Essai) : 'Essai sur MiamBoost (Recommande)' — declarer l'adresse publique du poste dans miamboost (NEXT_PUBLIC_… (agent)
  d111 : Mariella (tel, 30/10, plan approuve) : 'Rien a faire : j'attends ton essai sur MiamBoost' — l'essai b25/b26 (guide miamboost, s1/s2 sans ve… (agent)
  d112 : Mariella (tel, 30/10, plan approuve apres relance auto) : 'Rien a faire : j'attends toujours ton essai sur MiamBoost' — guide b25/b26 s1/s2… (agent)
  d113 : Mariella (tel, 30/10 13h04, via AskUserQuestion) : essai b25/b26 sur MiamBoost -> 'Mettre en pause' ; fil t23 mis en pause, aucune relance,… (agent)
  d114 : Mariella (tel, 30/10, plan approuve 'liberer de la RAM') : ecrans d'admin des bases (studio/pg_meta/analytics/vector/imgproxy prorent/prole… (agent)
  d115 : Menage auto des ecrans d'admin LIVRE (choix Mariella tel 30/10 'Menage auto (Recommande)') : menage-serveur.sh (toutes les 5 min) fait dock… (agent)
  d116 : Mariella (tel, 30/10, carte Suite) : 'Brainstorming de la suite (Recommande)' — theme : garder le serveur leger quand beaucoup de sessions … (agent)
  d117 : Mariella (tel, 30/10, carte Brainstorm) : 'Verifs lourdes en file (Recommande)' — eslint/tsc/vitest/next build lances par les sessions pass… (agent)
  d118 : Verifs lourdes une par une LIVRE (d117) : kvm-lourd (/usr/local/bin, hors depot) gagne Config.parallele (KVM_LOURD_PARALLELE, defaut 1) — u… (agent)
  d119 : Mariella (tel, 30/10, carte Suite) : 'Les deux (Recommande)' — plan approuve : brancher le nouveau guide sur tous les sites (S69 x3, prolea… (agent)
  d120 : Mariella (feu vert tel, 30/10, execution d119) : Mizzzen n'a aucun menu aujourd'hui (juste accueil + selecteur de theme) ; scenario decouve… (agent)
  d121 : b27 corrige (30/10, accord Mariella tel 'Reprendre tout (Recommande)') : kvm-lourd a une duree maximale par type (lint/tests 30m, build/nex… (agent)
  d122 : Mariella (tel, 30/10 18h40, via AskUserQuestion) : session en double sur b27/d119 (une autre session a deja modifie kvm-lourd a 18h37, tent… (agent)
  d123 : v1.9.31 (30/10, choix Mariella tel 'Reprendre tout') : correctif b28 pousse sur GitHub (main + tag), PyPI NON publie : aucune cle PyPI sur … (agent)
  d124 : Mariella (tel, 30/10, carte essais guide) : Mizzzen -> 'Creer l'adresse (Recommande)' : mizzzen-dev.mdjlabs.com, protegee comme prolearn-de… (agent)
  d125 : mizzzen-dev.mdjlabs.com cree (30/10, choix Mariella tel) : ingress tunnel -> localhost:3110 (/etc/cloudflared/config.yml, copie .bak-pre-mi… (agent)
  d126 : Mariella (tel, 30/10, carte Suite) : 'Je teste les 4 sites (Recommande)' — ses verdicts arrivent par le guide ; parcours Mizzzen sans menu … (agent)
  d127 : Mariella (tel, 31/10, carte Suite) : cle PyPI -> 'Plus tard, sans PyPI' — v1.9.31 reste sur GitHub seulement (les sites l'ont par update) ;… (agent)
  d128 : Mariella (tel, 31/10, carte Suite) : 'J attends tes essais (Recommande)' — attente de ses verdicts des guides ProLearn/ProJob/OpenStyle/Miz… (agent)
  d129 : Mariella (tel, 31/10, carte Suite) : 'Je fais l'essai (Recommande)' — essai du guide auto sur ProLearn/ProJob/OpenStyle ; verdict b28 a sai… (agent)
  d130 : Mariella (tel, 31/10, plan approuve) : le design des cartes du guide valide en d105 (https://claude.ai/artifact/CrmX2JdkqBtpucihUxYAgo) n'a… (agent)
  d131 : Mariella (tel, 31/10) : 'au changement de page le guide de test doit rester ouvert ; si je ne suis pas au bon endroit, un bouton doit m'y e… (agent)
  d132 : Portage carte d105 sur OpenStyle (sha cbb0fd6, suite d130) : guide reste ouvert au changement de page (architecture guide-visite.ts deja ex… (agent)
  d133 : Mariella (tel, 31/10, via AskUserQuestion) : bouton Fermer de la carte de fin -> 'Fermer sans effacer (Recommande)' sur les 4 sites (comme … (agent)
  d134 : Mariella (tel, 31/10, via AskUserQuestion) : guides quasi automatiques -> 'Le guide ProJob d'abord (Recommande)' : rendre automatiques les … (agent)
  d135 : 31/10 : guide design2 ProJob rendu automatique (27de37f, 16 points avec geste) + historique seed (2999e2d). Incident : un sous-agent a grep… (agent)
  d136 : Mariella (tel, 31/10, via AskUserQuestion) : guide design2 ProJob automatique -> 'Je fais l'essai (Recommande)' ; ses verdicts arrivent par… (agent)
  d137 : Mariella (tel, 31/10, carte b31) : 'Un seul guide commun' (contre ma reco) — sync_guide doit trouver le moteur sous app/, apps/web, apps/we… (agent)
  d138 : Mariella (tel, 31/10, carte Guide commun + appels 9639/9651) : un guide commun comme MOTEUR — pareil partout, chaque projet l'appelle et co… (agent)
  d139 : d138 livre sur OpenStyle (c169aff + 6c66989, estAdmin = role admin d'une adhesion via getUserSchoolMemberships) et Mizzzen (b6a6248 + 5a849… (agent)
  d140 : 31/10 : le moteur commun transmet tous les points juges (ok compris) a apresConsigne (ResultatGuide.points, 08cbc46) — ProLearn trace chaqu… (agent)
  d141 : 31/10 : d138 livre sur ProJob (72f6f47) — estAdmin = mot de passe du site de test (PROJOB_TEST_PASSWORD, basic ou cookie projob_test) ET co… (agent)
  d142 : Mariella (tel, 31/10 19h58, carte Suite) : 'Je fais l'essai (Recommande)' apres la pastille 'Guides a traiter' sur les 4 sites — j'attends … (agent)
  d143 : Mariella (tel, 31/10, carte Suite) : b30 -> 'Page d'attente (Recommande)' — pendant le reveil du site de test ProLearn endormi, afficher 'L… (agent)
  d144 : Mariella (tel, 31/10, carte Suite) : 'Les deux autres aussi (Recommande)' — portier-reveil (page d'attente, d143) branche aussi sur bcc-pro… (agent)
  d145 : Mariella (tel, 31/10 soir, carte Suite) : 'Je continue mes essais (Recommande)' apres la correction du studio ProLearn (b4 ProLearn) — j'at… (agent)
  d146 : Mariella (tel, 31/10, plan approuve apres relance auto) : 'Rien a faire : j'attends tes essais' — attente de ses verdicts des guides (d142,… (agent)
  d147 : Mariella (tel, 01/11, carte q11) : 'Je fais l'essai (Recommande)' — elle teste ProLearn en fenetre privee pour b29 (Hydration failed) ; pla… (agent)
  d148 : Mariella (tel, 01/11, plan approuve apres relance auto) : 'Rien a faire : j'attends toujours ton essai en fenetre privee' — b29/q11 restent… (agent)
  d149 : Mariella (tel, 01/11, carte Message rouge) : b29 classe (wont_fix) — 'Hydration failed' sur ProLearn /login reproduit par elle en fenetre p… (agent)
  d150 : Mariella (tel, 01/11, carte Suite) : 'Je verifie les corrections (Recommande)' apres classement de b29 — j'attends ses verdicts sur les 11 … (agent)
  d151 : Mariella (tel, 01/11, plan approuve) : guide de test partout — publier la derniere version du moteur (tag v1.9.32, GitHub seul, d127), mett… (agent)
  d152 : Mariella (tel, 01/11, carte q13) : 'Versions de test a part (Recommande)' — MiamBoost, S69 Francoviet, S69 Soirees recoivent chacun une ins… (agent)
  d153 : Mariella (tel, 01/11) : 'quand tu mets a jour sur pypi, mets aussi a jour sur github' — toujours les deux ensemble. Constat : le tag pousse… (agent)
  d154 : d152 livre (01/11, choix Mariella tel q13 'Versions de test a part') : versions de test Node (next dev, GUIDE_ACTIF=1, portier-reveil, Stop… (agent)
  d155 : Mariella (tel, 02/11, carte Memoire) : 'Arreter ProRent dev (Recommande)' — swap vide (3,1 Go -> 0) puis prorent-dev.service arrete (stop, … (agent)
  d156 : Mariella (tel, 02/11, carte Suite) : 'Ecrire le guide Soirees (Recommande)' — scenario de test avec gestes (d100) pour la page /soirees dan… (agent)
  d157 : Mariella (tel, 02/11) : b40 -> 'Je refais l'essai (Recommande)' ; attente de son verdict par le guide (s69-soirees 3c92781) (agent)
  d158 : Mariella (tel, appels 10035/10038, 02/11) : exigence saturation — PlanTrack coordinateur : une session EN COURS de travail peut etre mise e… (agent)
  d159 : Mariella (tel, 02/11, carte Saturation) : 'On code tout a 100 % (Recommande)' — PlanTrack chef d'orchestre de la charge serveur (pause des … (agent)
  d160 : Chef d'orchestre de la charge LIVRE (d159, plan valide par Mariella tel) : v1.9.34 (GitHub seul, pas de cle PyPI, d127). plantrack-orchestr… (agent)
  d161 : Mariella (tel, 02/11 soir, carte Suite) : 'Laisser tourner (Recommande)' — le chef d'orchestre (d159, v1.9.34) tourne une semaine ; verdict… (agent)
  d162 : Mariella (tel, 02/11 21h, carte Suite renvoyee) : 'Je fais l'essai (Recommande)' — essai des captchas Soirees (b40, s69-soirees 3c92781) su… (agent)
  d163 : Mariella (tel, 02/11 22h, plan approuve apres relance auto) : 'Rien a faire : j'attends ton essai des captchas Soirees' — b40/q15 restent e… (agent)
  d164 : Mariella (tel, 02/11 22h, carte Suite) : 'Je fais l essai (Recommande)' — essai captchas Soirees (b40, s69-soirees 3c92781) ; verdict atten… (agent)
  d165 : Mariella (tel, 02/11 22h, carte Pendant ton essai) : 'Attendre mon verdict (Recommande)' — aucun nouveau chantier, veille silencieuse jusqu… (agent)
  d166 : Mariella (tel, 03/11, plan approuve apres relance auto) : 'Rien a faire : j'attends ton verdict sur les captchas Soirees' — b40/q15 en atte… (agent)
  d167 : Mariella (tel, 03/11 15h48, plan approuve apres sa reponse 'Je fais l'essai (Recommande)') : rien a faire, j'attends son verdict sur les ca… (agent)
  d168 : Mariella (tel, 03/11 17h30, plan approuve apres relance auto) : rien a faire, attente de son verdict sur les captchas Soirees (b40/q15, s69… (agent)
  d169 : Mariella (tel, 03/11 soir, carte Suite) : 'Je fais l'essai (Recommande)' — essai captchas Soirees (b40/q15, s69-soirees 3c92781) ; attente … (agent)
  d170 : Mariella (tel, 03/11 22h, carte Pendant ton essai) : 'c'est bon' — attente du verdict captchas Soirees (b40/q15, s69-soirees 3c92781), veil… (agent)
  d171 : Mariella (tel, 03/11 22h18, carte Suite) : 'Je fais l'essai (Recommande)' — attente du verdict captchas Soirees (b40/q15, s69-soirees 3c927… (agent)
  d172 : Mariella (tel, 03/11 22h25, plan approuve) : guide de test — chaque ko/remarque reveille la session tout de suite (route locale bcc /guide/… (agent)
  d173 : Mariella (tel, 04/11, plan approuve apres relance auto) : rien a faire, attente de son verdict sur les captchas Soirees (b40/q15, s69-soire… (agent)
  d174 : Mariella (tel, 04/11, plan approuve) : 'envoie le lien' — lien du guide Soirees https://s69-soirees-dev.mdjlabs.com/soirees donne dans la r… (agent)
  d175 : b41 corrige (04/11, plan approuve par Mariella tel) : dossier des fiches de l'orchestre en 1777 pose par le service root a chaque tour, fic… (agent)
  d176 : Mariella (tel, 04/11, via AskUserQuestion) : b41/v1.9.36 -> 'Session admin (Recommande)' : elle ouvre une session PlanTrack en mode adminis… (agent)
  d177 : Mariella (tel, 04/11 23h30, plan approuve apres relance auto alerte charge) : rien a faire, attente de la session administrateur pour pouss… (agent)
  d178 : Mariella (tel, 05/11, plan approuve apres relance auto) : rien a faire — orchestre deja redemarre (05/11 07:24, apres d673c24) ; reste seul… (agent)
  d179 : Guide de test : la carte de fin dit la verite sur l'envoi a la session (plan approuve par Mariella tel 05/11 'On y va', demande 'qu'ils s'e… (agent)
  d180 : mdjlabs (choix Mariella tel 05/11, carte 'Le relais (Recommande)') : relais deploiement/guide-relais-mdjlabs.py + plantrack-guide-relais.ti… (agent)
  d181 : Mariella (tel, 05/11, carte Suite) : 'Session admin (Recommande)' — elle ouvre une session PlanTrack administrateur qui deroule docs/sessio… (agent)
  d182 : 05/11 soir, session root (bcc d312, choix Mariella 'Relancer avec les droits') : v1.9.36+v1.9.37 poussees sur GitHub (main+tags, PyPI toujo… (agent)
  d183 : 05/11 23h22 : rebuilds d182 — ProJob et Mizzzen relances avec le moteur v1.9.37 (actifs) ; OpenStyle BUILD ECHOUE sur sa propre modif paiem… (agent)
  d184 : Mariella (tel, 06/11 10h43, plan approuve 'On y va') : attente de ses verdicts du guide ProLearn, veille silencieuse (d23) ; tri groupe des… (agent)
  d185 : Mariella (tel, 06/11 12h25, carte Pendant ton essai) : 'Attendre mon verdict (Recommande)' — aucun chantier, veille silencieuse jusqu'au ve… (agent)
  d186 : Mariella (tel, 06/11 13h10, plan approuve apres relance auto suite au menage) : rien a faire, attente du verdict du guide ProLearn (d185), … (agent)
  d187 : Mariella (tel, 06/11 13h58, carte Pendant ton essai) : 'Attendre mon verdict (Recommande)' — attente du verdict du guide ProLearn, veille s… (agent)
  d188 : Mariella (tel, 06/11 15h29, carte Pendant ton essai) : 'Attendre mon verdict (Recommande)' — attente du verdict du guide ProLearn, veille s… (agent)
  d189 : Mariella (tel, 06/11 15h36, carte Pendant ton essai) : 'Attendre mon verdict (Recommande)' — attente du verdict du guide ProLearn, veille s… (agent)
  d190 : Mariella (tel, 06/11 16h26, carte Pendant ton essai) : 'Attendre mon verdict (Recommande)' — attente du verdict du guide ProLearn, veille s… (agent)
  d191 : Mariella (tel, 06/11 22h36) : 'donne le lien' -> lien du guide ProLearn https://prolearn-dev.mdjlabs.com/login?guide=essai-gestes donne (pl… (agent)

Pieges connus :
  pg9 : Une porte humaine sans aucune question posee ne s'ouvre PAS : 'phase next' exig…
  pg10 : Le post-commit journalise le commit lui-meme (events.jsonl) et regenere l'insta…
  pg13 : Gabarit de parcours : la phase de construction est a 'questions: false', mais u…
  pg15 : Le Stop hook bcc (hook/index.ts, regle 'projet ne s'endort jamais' du 03/10) EX…
  pg18 : Un site peut recevoir par la ronde une version du moteur de guide jamais commit…
  pg19 : Moteur guide (guide-visite.ts, commun) importe ./scenarios.ts et ./types.ts ave…
  pg20 : Un sous-agent a qui on dit 'ne lis aucun .env' peut quand meme grep apps/web/.e…
  pg21 : Enchainer git add/commit ET le lancement d'un build (meme detache par setsid no…
  pg22 : Sites Cloudflare (OpenNext/workerd : S69 x2, MiamBoost) : le moteur commun du g…
  pg23 : next dev d'un site OpenNext avec une liaison 'ai' (ou remote) dans wrangler.jso…
  pg24 : systemd : EnvironmentFile= l'emporte sur Environment= pour une meme variable — …
  pg25 : tsc --noEmit -p . sur s69-soirees (et probablement les autres sites S69/MiamBoo…
  pg26 : Versions de test S69 (next dev, d152) : wrangler.jsonc met MIAMBOOST_API_BASE s…
  pg27 : pgrep/pkill -f 'bash tests/scenario.sh' se reconnait lui-meme dans une boucle d…
  pg28 : Orchestre : le hook-pretool reinscrit la session sur le premier ancetre claude/…
  pg29 : tests/scenario.sh lance sous le compte bccsession : 6 echecs ronde/b20/bilan --…
  pg30 : Compte bccsession (sessions du telephone) : la boucle locale est filtree — seul…

Questions en attente (reponds via !answer qN ...) :
  q15 : Guide Soirées pret (s69-soirees 1db1d2a) : Mariella fait-elle l'essai sur https…
```
<!-- plantrack:state-end -->
