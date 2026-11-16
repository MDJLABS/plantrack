# Gestion autonome de la charge du serveur - rapport Fable

Date : 17/11/2026, mesures en direct prises entre 00h09 et 00h30.
Mode : lecture seule. Rien n'a été modifié, arrêté ni relancé. Ce rapport propose, Mariella choisit (d265).

Conventions : les chemins courts (`journaux/...`, `code/...`) sont relatifs à
`/home/mariella/plantrack/sortie/dossier-charge-fable/`. `pt.py` désigne
`/home/mariella/plantrack/.claude/hooks/pt.py`. Les heures du journal de l'orchestre sont en UTC,
sauf les lignes "reveil differe" qui sont en heure locale (incohérence relevée en section 2).

---

## 1. Diagnostic chiffré : pourquoi ça sature encore

### 1.1 La photo de cette nuit (17/11, 00h15)

| Mesure | Valeur | Lecture |
|---|---|---|
| RAM | 15,6 Go, 2,0 Go disponibles (13 %) | zone orange de l'orchestre |
| Mémoire de secours (swap) | 4,0 Go sur 4,0 Go | pleine, aucun amortisseur |
| Charge | 7,5 / 8,6 / 7,4 pour 4 vCPU | environ 2 fois la capacité |
| Pression processeur (PSI some, 1 min) | 43 à 49 % | la moitié du temps, quelque chose attend un processeur |
| Pression mémoire (PSI some, 1 min) | 0,3 % | la mémoire ne "rame" pas : elle est juste pleine |
| Processus gelés (état T) | 21 | des sessions sont en pause en ce moment |
| File kvm-lourd | au moins 10 tâches en attente, toutes "agent" | dont 3 qui demandent 3 Go chacune avec 2,9 Go disponibles |

Qui occupe la mémoire (RSS, mesure directe) : 14 sessions Claude = 3,2 Go ; 41 processus node
"MainThread" = 3,2 Go ; 8 next-server = 1,5 Go ; postgres (environ 124 processus) = 1,35 Go ;
18 npm = 1,0 Go ; workerd 0,8 Go ; litellm 0,6 Go ; nginx 0,6 Go ; 46 containerd-shim = 0,4 Go.
Dont 13 serveurs `playwright-mcp` (un par session, 80 à 113 Mo) et leurs 13 `npm exec`
(38 Mo) : environ 1,6 Go consommés au repos, avant même d'ouvrir un navigateur.

### 1.2 Cause 1 : la charge "au repos" est trop haute et le secours est plein en permanence

- Le swap est à 99 ou 100 % sur presque toutes les lignes de `journaux/journal.log` du 02/11 au
  16/11. 3,6 Go de ce swap appartiennent à `system.slice` (node 801 Mo, litellm 723 Mo, python3
  512 Mo, next-server 438 Mo) : ce sont des pages froides de services, jamais relues.
- Le revidage automatique du secours est quasi impossible : `code/menage-serveur.sh` exige à la
  fois swap >= 1 Go, RAM disponible >= swap + 3 Go (soit 7 Go libres), charge 5 min < 2 et un
  seul essai toutes les 3 h. Résultat dans `journaux/menage.log` : 2 "secours revide" en 32 h
  pour 486 passages.
- Conséquence directe sur le dernier filet : earlyoom est réglé `-m 5 -s 10` (il tire quand RAM
  <= 5 % ET swap libre <= 10 %). Le swap étant toujours plein, la deuxième condition est
  toujours vraie : earlyoom tire dès que la RAM disponible passe sous 780 Mo, sans marge.
- Aucun budget global : `bcc-sessions.slice` a droit à 10 Go, `lourd.slice` à 6 Go
  (`code/unite__lourd.slice`), `bcc.service` à 5 Go, prolearn-next 3 Go, miamboost-workers
  2,5 Go, prorent-dev 2,25 Go, et tout le reste de `system.slice` (8,3 Go occupés, une
  cinquantaine de conteneurs) n'a aucune limite (`02-etat-machine.txt`). La somme des plafonds
  dépasse 28 Go pour 15,6 Go réels : chaque brique respecte sa limite et la machine déborde
  quand même.

### 1.3 Cause 2 : les navigateurs et les sursauts des sessions échappent à tout contrôle

- `journaux/earlyoom-arrets.log` (7 jours, du 10 au 16/11) : 260 processus tués. Par jour :
  10/11 = 2, 11/11 = 7, 12/11 = 12, 14/11 = 108, 15/11 = 51, 16/11 = 80.
- Victimes : chrome 182, chrome-headless 25, esbuild 27, next-server 9, node MainThread 8,
  java 5, litellm 1. Les navigateurs font 207 arrêts sur 260 (80 %).
- Ce sont des rafales : 14/11 vers 20h28-20h29, 84 arrêts en 2 minutes (81 chrome, 7,2 Go
  cumulés) ; 16/11 à 23h16 et 23h40, 74 arrêts (59 chrome, 7,3 Go) ; 15/11 vers 22h, 38 arrêts.
- Au même moment le journal de l'orchestre montre la vitesse de la chute : le 14/11 à
  19:27:45 UTC, orange à 13,9 % disponible ; à 19:28:40, rouge à 4,9 %. Soit 1,4 Go perdus en
  55 secondes.
- Pourquoi rien ne les retient : le hook `hook_pretool` (`pt.py` l.2570 à 2631) ne classe que
  les commandes de l'outil Bash. Les outils navigateur des sessions (serveur MCP Playwright)
  ne passent pas par Bash : ils n'entrent ni dans la file kvm-lourd, ni dans `lourd.slice`.
  Et le gel de l'orchestre (`orch_gelables`, `pt.py` l.1504 à 1533) ne vise que les
  sous-arbres lancés par une commande Bash : un Chrome ouvert par le serveur MCP n'est jamais
  gelé. Ce point avait déjà été noté "hors périmètre" dans d209.
- Les causes d'épisodes relevées par l'orchestre lui-même confirment : hausses de +467 à
  +2234 Mo attribuées à une session (prolearn 11 fois, projob 9, s69-francoviet 8, bcc 5,
  Mizzzen 4). Chaque session a droit à 3 Go (High) et 4 Go (Max) : avec 13 sessions, ce
  plafond ne protège rien.

### 1.4 Cause 3 : le feu de l'orchestre s'allume mais ne commande presque rien

- La file n'obéit pas au feu pour les tâches des agents. Dans `code/kvm-lourd` (l.338 à 347),
  `retenu_par_orchestre` ne retient que `qui == "fond"`. Or le hook écrit toujours
  `--qui=agent` en dur (`pt.py` l.2623). Dans `journaux/kvm-historique-fin.jsonl` : 877 tâches
  "agent", 30 "humain", 2 "fond" sur 908. Le feu orange ou rouge retient donc 0,2 % des tâches.
  d247 (feu sur le processeur) est en service mais quasiment sans effet sur l'admission.
- La pause ne libère rien. Geler une session (SIGSTOP) garde sa mémoire. Pauses par jour :
  07/11 = 91, 14/11 = 68, 15/11 = 72, 16/11 = 59. La grande majorité se terminent par
  "10 minutes de pause au plus" (ORCH_PAUSE_MAX = 600, `pt.py` l.1259 à 1299), puis un répit de
  10 minutes, puis on recommence : un tourniquet où chacun attend à son tour sans que la
  machine se vide. Avant le 13/11, beaucoup de pauses ne gelaient aucun processus (26 sur 29
  le 03/11, 38 sur 91 le 07/11).
- L'orchestre est trop lent pour les rafales : un seul geste toutes les 30 s (ORCH_PAS), un
  seul écran d'admin ou une seule pile éteinte par tour (`orch_urgence`, l.2099 à 2148), face
  à 1,4 Go perdus en 55 s.
- Le rouge est souvent dû au processeur seul (charge 5 min par vCPU entre 2,0 et 2,1 avec 18
  à 23 % de RAM disponible). Dans ce cas, geler des sessions et éteindre des écrans d'admin
  ne traite pas la cause : la cause est le nombre de tâches qui tournent en même temps, que
  seule l'admission peut régler.
- Il traite les mêmes symptômes en boucle : 22 extinctions d'écrans d'admin (studio, pg_meta
  de projob, miamboost, mdjlabs_marketing), dont 3 fois en 3 minutes le 16/11 entre 22h13 et
  22h16. Ils sont rallumés par les `supabase start` des sessions (piège pg35).
- L'apprentissage est presque à l'arrêt : 2 lignes "j'apprends" en 15 jours (seuil orange
  passé de 12 à 14 %), un seul coût appris (prolearn-supabase, 226 Mo contre 1,5 Go par
  défaut). 62 épisodes dans `journaux/incidents.jsonl`, dont beaucoup avec une liste de
  gestes vide.

### 1.5 Effets visibles pour Mariella

- Au moins 9 alertes en 3 jours : 6 alertes de charge dans `journaux/alertes.log` (14/11
  14h55 à 3,57 ; 14/11 20h58 à 5,43 ; 15/11 09h32 ; 15/11 15h56 à 3,83 ; 15/11 21h59 à 5,42 ;
  16/11 18h20 à 3,03), toutes "seuil 3.00 sur 2 vCPU", et 3 alertes mémoire dans
  `journaux/menage.log` (dont 15/11 21h55 et 16/11 21h25). Aucune n'était une panne.
- 14 tâches abandonnées après 2 heures d'attente entre le 14 et le 16/11
  (`journaux/kvm-journal.log` : bcc/gradle 5 fois, miamboost/build 4, proskills/gradle 3,
  s69-soirees/build, prorent-docs/gradle). La file fonctionne, mais elle est affamée : une
  tâche de 3 Go ne part jamais tant que la mémoire au repos laisse 2 à 3 Go.

---

## 2. Ce qui marche, ce qui fait doublon, ce qui se contredit

### 2.1 Ce qui marche et qu'il faut garder

- **La file kvm-lourd** : 908 tâches en 16 jours, 836 terminées avec succès (92 %), estimation
  par médiane des pics, durée maximale par type, réserve de 5 % (d102). C'est la brique la
  plus saine. Les tâches qui y passent ne sont presque jamais celles que earlyoom tue.
- **Les freins processeur** (d222, d224) : cron et conteneurs gourmands passés en CPUWeight
  faible. Pression processeur de cron à 4 %, de docker à 2,5 % cette nuit : contenus.
- **Le portier de réveil à trois étages** (d239) : 8 réveils différés, 7 accordés, plus de
  réveil en pleine surcharge comme le 12/11 (b49).
- **La respiration** (d73) et la page d'attente (d143, d144) : le principe "ce qui ne sert pas
  dort, et se réveille à la demande" est le bon.
- **L'orchestre comme capteur** : sa mesure (PSI 1 min, charge par vCPU, cause par session)
  est juste et son journal est la meilleure source de ce dossier. Il consomme peu
  (plafond 200 Mo).
- **earlyoom** : il a évité le blocage complet de la machine à chaque rafale. Il doit rester,
  mais redevenir un dernier filet rare.

### 2.2 Doublons

| Sujet | Qui le fait aujourd'hui | Problème |
|---|---|---|
| Alerter Mariella | `vps-charge-alerte.sh` (charge), `menage-serveur.sh` (mémoire), l'orchestre (rouge > 10 min), plus les bulles d'information du ménage | 3 émetteurs, 3 seuils, 3 temporisations de 6 h indépendantes |
| Éteindre les écrans d'admin | ménage (plus d'1 h) et urgence de l'orchestre | deux boucles qui éteignent ce que `supabase start` rallume |
| Endormir un site ou une base | respiration (30 min sans battement), urgence de l'orchestre (10 min sans session), ménage (serveur de test de 6 h) | trois règles, trois délais, pas de registre commun |
| Lancer le ménage | son minuteur (5 min) et l'orchestre hors du vert | 486 passages en 32 h au lieu de 386 |
| Baisser la priorité | ménage (renice 10 : 63 fois chrome-headless, 33 fois java), orchestre (CPUWeight), kvm-lourd (lourd.slice) | trois mécanismes sur les mêmes processus |

### 2.3 Contradictions

1. **Combien de processeurs ?** `code/vps-charge-alerte.sh` écrit `CPUS=2` et
   `code/menage-serveur.sh` écrit `coeurs=${COEURS:-2}`, avec le commentaire "nproc ment".
   L'orchestre divise par `os.cpu_count()` = 4 (`orch_mesure`, `pt.py` l.1438) et le piège pg34
   dit "4 vCPU, pas 2". Résultat : l'alerte part à une charge de 3,0 alors que l'orchestre
   n'est orange qu'à 4,8 et rouge qu'à 8. Les 6 alertes de charge reçues étaient toutes sous le
   seuil rouge de l'orchestre. Ma mesure du processeur "volé" par l'hébergeur était faible
   (environ 1,6 % sur 5 s), ce qui va dans le sens de 4.
2. **Le feu et la file** : d247 dit que le feu retient les tâches lourdes ; le code ne retient
   que "fond", que personne n'utilise (section 1.4).
3. **Les budgets** : chaque tranche a un plafond raisonnable seule, leur somme vaut presque le
   double de la machine (section 1.2).
4. **Les horodatages** : le journal de l'orchestre est en UTC, sauf "reveil differe" en heure
   locale ; earlyoom et le ménage sont en heure locale. Reconstituer un incident demande une
   conversion à la main.
5. **Petits écarts** : la description du minuteur du ménage dit "toutes les heures" alors
   qu'il passe toutes les 5 minutes ; une vingtaine de groupes de sessions vides traînent
   dans `bcc-sessions.slice` (34 groupes pour 13 sessions).

---

## 3. Architecture cible d'une gestion autonome

### 3.1 Un seul responsable, des exécutants

Recommandation : **un seul décideur, l'orchestre**. Les autres briques restent, mais
n'ont plus de seuil ni de voix propres.

| Brique | Rôle cible |
|---|---|
| Orchestre | seul à mesurer, décider, alerter, apprendre |
| kvm-lourd | guichet d'admission : il demande au feu avant de laisser partir, pour toutes les tâches |
| Respiration, portier | bras "sommeil et réveil" de l'orchestre, un seul registre des délais |
| menage-serveur.sh | simple boîte à gestes appelée par l'orchestre (plus de minuteur à seuils, plus d'alerte) |
| vps-charge-alerte.sh | supprimé comme émetteur, remplacé par un chien de garde minimal (voir 3.6) |
| earlyoom | dernier filet inchangé dans son principe, réglé pour tirer rarement |

Pourquoi un seul plutôt que des briques coordonnées : les contradictions de la section 2
viennent toutes de seuils recopiés à plusieurs endroits. Un fichier unique de capacité
(nombre de vCPU, RAM, budgets, délais), lu par tous, les supprime d'un coup.

### 3.2 Des budgets dont la somme tient dans la machine

Quatre tranches cgroup, avec des valeurs de départ à ajuster après une semaine d'observation :

| Tranche | Contenu | Départ proposé (haut / max) | Aujourd'hui |
|---|---|---|---|
| Socle | système, docker, services toujours allumés (bcc, passerelle, voix) | réservé, environ 3 Go, jamais bridé | sans limite |
| Sessions | `bcc-sessions.slice`, navigateurs compris | 6 / 7 Go ; par session 1,5 / 2,5 Go | 9 / 10 Go ; 3 / 4 Go |
| Tâches lourdes | `lourd.slice` | 4 / 4,5 Go | 5,5 / 6 Go |
| Sites et bases de test | nouvelle tranche regroupant serveurs de dev et piles Supabase de test | 2,5 / 3 Go | sans limite |

Total des maxima : 14,5 Go + socle bridé par le reste, avec 5 % gardés libres (d102).
Le budget "par projet" est obtenu par la combinaison : une session = un groupe borné, une
tâche lourde par projet à la fois dans la file, une pile de test par projet soumise au
sommeil. Quand une tranche atteint son "haut", le noyau la ralentit elle seule au lieu de
laisser toute la machine tomber dans earlyoom.

Côté processeur : poids par tranche (socle 200, sessions 100, test 50, lourd 50) et plafond de
`lourd.slice` ramené vers 250 % au lieu de 380 %, pour qu'il reste toujours plus d'un
processeur aux sessions et au socle. Ce point ajuste un réglage posé avec d102 : l'esprit de
d102 (garder une réserve) est conservé et renforcé.

### 3.3 Admission : tout ce qui est lourd passe au guichet

- **Les tâches des agents obéissent au feu** : au rouge, aucune tâche lourde ne part (agent
  compris) ; à l'orange, seules partent celles dont le pic appris est petit (moins d'1 Go) ;
  "fond" reste retenu dès l'orange. C'est ce que d247 voulait : la décision est maintenue,
  c'est son application qui est corrigée.
- **Les navigateurs entrent dans le jeu** : le hook reconnaît aussi les outils navigateur des
  sessions (les noms d'outils `mcp__playwright__...`) et demande un jeton à l'orchestre.
  Nombre de navigateurs ouverts en même temps limité (2 pour commencer), fermeture
  automatique d'un navigateur inactif depuis 10 minutes (un navigateur se rouvre sans perte).
- **Une file juste** : une seule tâche lourde par projet en attente (les doublons du même
  build sont fusionnés), priorité qui monte avec l'âge, et les très grosses tâches (gradle à
  3 Go) obtiennent une "réservation" : quand l'une attend depuis 20 minutes, l'orchestre
  endort ce qu'il faut pour lui faire la place, au lieu de la laisser abandonner après 2 h.
- **Deux petites en même temps** : au vert, laisser partir 2 tâches si la somme de leurs pics
  appris tient dans la mémoire. Ceci modifie d118 (une seule à la fois par défaut) : je le
  propose explicitement, parce que 14 tâches ont été abandonnées en 3 jours et que la
  machine a 4 processeurs, pas 2. Si Mariella préfère garder d118 tel quel, le reste tient.

### 3.4 Mise en sommeil : prévenir plutôt que geler

Ordre des leviers quand la mémoire baisse, du moins coûteux au plus coûteux :

1. fermer les navigateurs inactifs et les serveurs de dev sans visite (rien n'est perdu) ;
2. endormir les piles de test sans session active (respiration, délai unique dans le registre) ;
3. retenir les nouvelles tâches lourdes (guichet) ;
4. geler la session qui cause la hausse, elle seule, et non plus toutes à tour de rôle
   (d158 et d159 conservées : la pause reste, mais ciblée et en dernier) ;
5. dernier filet : earlyoom.

Et à la source : les écrans d'admin des bases ne sont plus démarrés du tout (option
`-x studio` et équivalents dans le lancement commun des piles, comme pour MiamBoost en pg35),
au lieu d'être éteints 22 fois. Ils se lancent à la main le jour où quelqu'un en a besoin.

L'orchestre agit par paliers proportionnés : à l'orange un geste par tour comme aujourd'hui ;
au rouge, tous les gestes des niveaux 1 et 2 d'un coup, parce qu'une rafale prend moins d'une
minute.

### 3.5 Redonner un amortisseur

Le secours plein n'est pas grave en soi (ce sont des pages froides), mais il supprime la marge
et dérègle earlyoom. Deux réglages : agrandir le secours (8 Go) ou ajouter un secours
compressé en mémoire (zram), puis régler earlyoom sur la mémoire seule avec un seuil clair.
À choisir après vérification du disque et du noyau (section 6).

### 3.6 Quand alerter l'humaine

Une seule voix (l'orchestre), et quatre cas seulement, conformes à d23 :

1. un service toujours allumé est tombé et ne redémarre pas après 3 essais ;
2. l'orchestre lui-même est mort ou muet depuis 10 minutes (chien de garde indépendant, très
   petit, seul rescapé de `vps-charge-alerte.sh`) ;
3. rouge continu depuis plus de 30 minutes alors que tous les leviers ont été utilisés ;
4. disque presque plein (plus de 90 %).

Tout le reste (pics, pauses, tâches retardées, arrêts earlyoom isolés) va dans le journal et
ressort résumé dans le bilan du dimanche (d37, d54), avec trois chiffres : arrêts earlyoom,
minutes au rouge, tâches abandonnées. Ceci remplace les alertes de d67 (mémoire à 80 %) et
de d79 (charge sur 5 minutes) : je propose explicitement de les retirer, parce qu'elles ont
produit au moins 9 messages en 3 jours sans une seule panne, et que le cas 3 ci-dessus
couvre la vraie saturation. d222, d224, d232, d239 et d247 sont conservées telles quelles.

### 3.7 S'améliorer à chaque surcharge (d221, d238)

Chaque épisode écrit dans `incidents.jsonl` : la cause, les gestes, et le résultat de chaque
geste (mémoire rendue, durée). Trois apprentissages automatiques, bornés par des limites
fixes : coût réel de réveil de chaque pile (déjà commencé), pic réel par projet et type
(déjà fait par kvm-lourd), et budget par session ajusté selon les dépassements. Un geste
qui n'a rien rendu trois fois de suite est rétrogradé dans l'ordre des leviers.

---

## 4. Les pistes, la recommandée en premier

### Piste A (recommandée) : un seul chef d'orchestre, avec budgets et guichet pour tout

- **Ce que ça règle** : les trois causes. Les navigateurs et les tâches des agents passent au
  guichet, la somme des budgets tient dans la machine, une seule voix d'alerte.
- **Effort** : 6 lots courts, de l'ordre de 4 à 6 séances de travail, livrables un par un
  (le lot 1 seul fait déjà taire les fausses alertes).
- **Risque** : moyen. Un budget trop serré peut ralentir ou couper une session ; limité en
  commençant par une semaine d'observation sans bridage, puis en serrant par étapes.
- **Pour Mariella** : plus d'alerte sauf vraie panne, et les sessions avancent plus
  régulièrement au lieu d'attendre chacune leur tour.

### Piste B : réparations ciblées, sans changer l'organisation

- **Contenu** : 5 corrections. Le feu retient aussi les tâches "agent" au rouge ; un seul
  nombre de processeurs partout (4) ; les trois alertes fusionnées en une ; écrans d'admin non
  démarrés ; réglage earlyoom et revidage du secours assoupli.
- **Ce que ça règle** : les fausses alertes et une partie de la cause 3. Ne règle pas les
  rafales de navigateurs ni l'absence de budget (causes 1 et 2).
- **Effort** : faible, 1 à 2 séances.
- **Risque** : faible. Retenir les tâches "agent" au rouge peut allonger les attentes tant que
  la charge au repos reste haute.
- **Pour Mariella** : beaucoup moins de messages tout de suite, mais des ralentissements et
  des navigateurs coupés qui continueront certains soirs.

### Piste C : acheter de la marge (plus de mémoire)

- **Contenu** : secours agrandi ou compressé tout de suite, et passage à une offre à 32 Go.
- **Ce que ça règle** : repousse le mur, earlyoom tire moins. Ne corrige ni le feu sans
  effet, ni les doublons, ni les alertes ; avec 14 sessions qui grossissent, la marge se
  remplit en quelques semaines.
- **Effort** : très faible (une heure, plus une migration si changement d'offre).
- **Risque** : faible techniquement, coût mensuel en plus ; masque les causes.
- **Pour Mariella** : un répit rapide, mais les alertes reviendront si rien d'autre ne change.

Les pistes s'emboîtent : B est le lot 1 et une partie du lot 2 de A ; la partie "secours" de
C est le lot 5 de A. Recommandation : décider A et la livrer en commençant par B.

---

## 5. Étapes de livraison de la piste A et comment vérifier

Référence de départ (à relever avant de commencer, sans rien changer) : 260 arrêts earlyoom en
7 jours, au moins 9 alertes en 3 jours, 14 abandons de file en 3 jours, 59 à 72 pauses par jour.

| Lot | Contenu | Comment vérifier |
|---|---|---|
| 1. Une voix, un chiffre | Fichier unique de capacité (4 vCPU, RAM, délais) lu par l'orchestre, le ménage et kvm-lourd ; alertes de `vps-charge-alerte.sh` et de `menage-serveur.sh` retirées ; les 4 cas de panne de 3.6 dans l'orchestre ; chien de garde ; horodatage unique dans les journaux | `grep -n "2 vCPU"` ne trouve plus rien dans les scripts ; essai à blanc de chaque cas de panne (une bulle chacun) ; 48 h avec charge au-dessus de 3 sans aucun message |
| 2. Le guichet obéit au feu | kvm-lourd retient "agent" au rouge et les grosses à l'orange ; une tâche par projet, fusion des doublons, priorité à l'ancienneté, réservation pour les grosses ; deux petites au vert (si d118 est ajustée) | test ajouté à `tests/scenario.sh` (feu rouge simulé : la tâche attend, feu vert : elle part) ; `kvm-lourd status` affiche "retenu par le feu" ; zéro abandon après 2 h sur une semaine |
| 3. Les navigateurs au guichet | Le hook reconnaît les outils navigateur des sessions, jetons délivrés par l'orchestre, fermeture des navigateurs inactifs | en session réelle : le 3e navigateur attend ; le journal earlyoom montre moins de 5 chrome tués par jour, puis zéro |
| 4. Les budgets | Une semaine en observation (journal des dépassements théoriques), puis pose des tranches de 3.2 par paliers ; nouvelle tranche des sites et bases de test ; poids processeur | `systemctl show` de chaque tranche ; compteurs `memory.events` (high, max, oom_kill) par tranche ; pression processeur du socle sous 5 % pendant un build |
| 5. Sommeil unique et amortisseur | Un seul registre des délais (respiration, urgence, ménage) ; écrans d'admin non démarrés ; leviers par paliers au rouge ; gel ciblé sur la cause ; secours agrandi ou compressé ; earlyoom réglé | journal : zéro ligne "ecran d'admin eteint" sur 48 h ; pauses par jour divisées par 5 au moins ; secours sous 60 % au repos |
| 6. Apprentissage et bilan | Résultat de chaque geste consigné, réglages ajustés dans des bornes, trois chiffres dans le bilan du dimanche | le bilan suivant affiche les trois chiffres et les réglages modifiés dans la semaine |

Règles de livraison communes : sauvegarde avant chaque fichier hors dépôt, un lot = une
version publiée, retour arrière possible lot par lot (chaque lot garde un interrupteur dans
le fichier de capacité), et une semaine de mesure entre le lot 4 et le lot 5.

Objectif chiffré à 3 semaines : moins de 10 arrêts earlyoom par semaine (260 aujourd'hui),
zéro alerte hors panne, zéro tâche abandonnée, moins de 30 minutes de rouge par jour.

---

## 6. Ce que je n'ai pas pu vérifier

- **L'origine exacte des navigateurs tués.** Je déduis qu'ils viennent surtout des serveurs
  Playwright des sessions (13 présents, hors file, hors gel), mais earlyoom ne note pas le
  parent. Une partie vient peut-être des tâches "navigateur" de la file (114 en 16 jours) ou
  de tests. À confirmer en lot 3 par un relevé du groupe cgroup de chaque Chrome.
- **Le nombre réel de processeurs accordés par l'hébergeur.** `nproc` dit 4 et le vol de
  processeur mesuré sur 5 secondes est faible, mais une seule mesure de nuit ne tranche pas
  le commentaire "seuls 2 vCPU sont accordés". À mesurer sur 24 h avant de fixer le chiffre.
- **La profondeur de l'historique.** Les arrêts earlyoom ne couvrent que 7 jours, les alertes
  3 jours, le ménage 32 heures. Les tendances plus anciennes viennent du journal de
  l'orchestre et des décisions consignées.
- **Le nombre de bulles réellement envoyées par l'orchestre** (rouge de plus de 10 minutes) :
  non compté ; le total de 9 alertes en 3 jours est donc un minimum.
- **Le détail de la respiration et du portier.** Je n'ai pas lu ligne à ligne `souffle`,
  `battre`, `orch_portier`, `orch_apprendre` ni `code/portier-reveil`, ni les `souffle.conf`
  de chaque projet, ni les trois documents antérieurs du dossier (rapport du 13/10, spec de
  la respiration, `01-plantrack.md`). Le registre unique du lot 5 demandera cette lecture.
- **Le contenu exact du socle.** Je n'ai pas séparé, dans les 8,3 Go de `system.slice`, ce
  qui est indispensable de ce qui est du test. Les budgets de 3.2 sont des valeurs de départ,
  pas des mesures.
- **La faisabilité du secours compressé** (module zram du noyau, place disque pour un fichier
  de 8 Go) : non vérifiée.
- **La prise en charge des outils navigateur par le hook** : le hook actuel ne traite que
  Bash ; je n'ai pas vérifié dans la configuration des sessions (fichiers de réglages non
  lus, par consigne) que le hook peut être branché sur ces outils partout.
- **Aucun essai n'a été fait** : pas de build, pas de test, pas de simulation de charge.
  Tous les chiffres viennent des journaux fournis et de mesures instantanées.
