# Spec — Respiration des ressources (PlanTrack)

18/10/2026. Choix de Mariella (session du 18/10) : battement à chaque action, délai de 30 min,
ronde centrale toutes les 5 min, souffle déclaré en services systemd.

## 1. Pourquoi

Le VPS est bridé à 2 vCPU réels par Hostinger. Cinq piles Supabase complètes (≈ 0,7 à 1,5 Go
chacune), plus `prorent-dev`, tournent en continu, qu'on s'en serve ou non. La swap se remplit
sans arrêt (07/08, 16/09, 13/10, 18/10).

Mission de PlanTrack (Mariella, 18/10) : gérer la charge **comme un poumon**. Une session qui
travaille inspire, c'est-à-dire qu'elle réveille les ressources de son projet. Quand elle n'en a
plus besoin, elle expire et les libère pour les autres projets.

PlanTrack sait déjà inspirer prudemment : la file `kvm-lourd` met en attente une commande lourde.
Il ne sait pas encore expirer. Cette spec crée l'expiration et le réveil qui va avec.

### Articulation avec l'existant

- **`kvm-lourd`** (d46 à d53) met en attente une commande lourde quand il n'y a pas assez de
  mémoire. C'est l'inspiration prudente, et la spec n'y touche pas.
- **`menage-serveur`** (d66, toutes les heures) éteint ce qui a été oublié **hors systemd** :
  sessions Claude sans frappe depuis 24 h, serveurs de test lancés à la main. Il ne touche jamais à
  un `*.service`.
- **La respiration** (cette spec) s'occupe de l'autre moitié : les **services systemd** d'un
  projet, avec un délai court (30 min) piloté par l'activité réelle des sessions. Elle ne recoupe
  pas le ménage : l'un agit sur des processus, l'autre sur des services, sur des horizons
  différents (24 h contre 30 min).
- **Alertes** : d67 (RAM ou swap ≥ 80 %, dans `menage-serveur`) et `vps-charge-alerte` (charge)
  restent hors de cette spec.

## 2. Vocabulaire

- **Souffle d'un projet** : la liste des services systemd que le projet réveille quand on y
  travaille et qu'il libère sinon. Elle est déclarée dans `<racine>/.plantrack/souffle.conf`.
  Un projet sans ce fichier ne respire pas : PlanTrack ne touche à rien.
- **Battement** : le mtime de `<racine>/.plantrack/battement`, touché à chaque hook PlanTrack.
- **Projet vivant** : son battement a moins de 30 min, OU une commande lancée par une session
  Claude sur ce projet est encore en cours (voir 4.3).

## 3. Déclaration — `souffle.conf`

Un service par ligne. `#` sert aux commentaires. Le préfixe `garde ` indique un service qui
empêche l'expiration tant qu'il est actif, sans être réveillé par la session.

```
# prolearn
prolearn-supabase.service
garde prolearn-next.service
```

- Une ligne simple désigne un service **réveillé** à l'inspiration et **arrêté** à l'expiration.
- Une ligne `garde` désigne un service démarré par un autre mécanisme, en l'occurrence le portier à
  la demande d'août (le premier visiteur du site de dev). Tant qu'il est actif, quelqu'un utilise
  le projet sans session Claude : on n'expire pas. Il s'éteint seul après 15 min sans visite.
- Les projets qui doivent tourner en continu (le worker de `projob`, la passerelle `bcc`) **ne
  déclarent pas de souffle**. Le fait de ne rien déclarer vaut déclaration « permanent ».

## 4. Comportement

### 4.1 Battement (hooks, côté session)

Les hooks `hook-context` (SessionStart), `hook-prompt`, `hook-pretool` et `hook-filelog` appellent
`battre(racine)`, mais seulement si `souffle.conf` existe :

1. Lire le mtime précédent de `battement`. S'il est absent, le projet est considéré endormi.
2. Toucher `battement`.
3. Si le battement précédent avait plus de 30 min (`SOUFFLE_DELAI`), **inspirer** :
   `systemctl start --no-block <services non-garde>` dans un processus détaché.

La comparaison avec le battement précédent tient lieu d'état : il n'y a pas de fichier d'état à
tenir à jour. Si les services tournent déjà, `systemctl start` ne fait rien. Ce chemin est donc
sans danger, même s'il se déclenche à tort.

Le battement est **fail-open**, comme tous les hooks PlanTrack. Une erreur est tracée par
`trace()` et ne bloque jamais la session. Il est aussi **non bloquant** : la session ne fait jamais
attendre le démarrage d'une pile, qui prend environ 1 min. Une commande qui interroge la base dans
cette minute peut échouer une fois. C'est une limite connue, à documenter dans le message de
réinjection de SessionStart (« pile en cours de réveil »).

### 4.2 Expiration (ronde centrale)

La commande `plantrack respirer` est lancée par `plantrack-respiration.timer` toutes les 5 min
(`OnUnitActiveSec=5min`). Pour chaque racine du registre `~/.plantrack-repos` qui a un
`souffle.conf` :

1. Si le projet est vivant, rien.
2. Si un service `garde` est actif, rien.
3. Sinon, `systemctl stop` de chaque service non-garde **actif**, puis une ligne dans
   `<racine>/.plantrack/souffle.log` (`ts`, `expire`, services arrêtés, âge du battement).

`plantrack respirer --etat` imprime une ligne par projet : vivant ou endormi, âge du battement,
services actifs. Il sert au diagnostic et aux tests.

### 4.3 Commande longue en cours

Un build de 40 min ne déclenche aucun hook pendant qu'il tourne. Sans ce point, le projet
expirerait en plein build.

Un projet est donc aussi considéré vivant si un processus `claude` dont le `cwd` est sous la
racine a un descendant dont la `cmdline` contient `shell-snapshots`, c'est-à-dire une commande
Bash en cours. C'est **le même signal** que `menage-serveur.sh` (d66), réutilisé tel quel. La
lecture se fait dans `/proc`, en stdlib. Les sessions bcc sans terminal comptent aussi.

Une session simplement ouverte et inactive ne compte pas, puisqu'elle n'a aucune commande en
cours. Un serveur lancé en arrière-plan par une session garde le projet vivant tant qu'il tourne.
C'est voulu : quelque chose tourne vraiment. Le ménage d66 l'éteindra après 24 h s'il est oublié.

### 4.4 Démarrage du serveur

Les services du souffle sont **`enable`** : au boot, tout inspire. La ronde expire ensuite, en
35 min au plus, chaque projet sans session.

C'est ce qui règle le cas des conteneurs en `restart: unless-stopped`. Docker les relance au boot
en dehors de systemd. Si les services étaient `disable`, la ronde les verrait inactifs et ne les
arrêterait jamais. En démarrant tout, le `ExecStop` s'exécute ensuite normalement.

## 5. Services à créer ou à adapter

Le modèle est celui de `miamboost-supabase.service`, qui existe déjà : `Type=oneshot`,
`RemainAfterExit=yes`, un `ExecStart` qui démarre la pile et un `ExecStop` qui l'arrête.

| Projet | Service | Démarrer / arrêter | Garde |
|---|---|---|---|
| prolearn | `prolearn-supabase.service` (à créer) | `docker compose -f /home/mariella/prolearn/docker-compose.yaml up -d` / `stop` | `prolearn-next.service` |
| prorent | `prorent-supabase.service` (à créer) | `docker compose -f /home/mariella/prorent-docs/docker-compose.yml up -d` / `stop` | — |
| prorent | `prorent-dev.service` (existe, permanent aujourd'hui) | réveillé et arrêté par le souffle | — |
| miamboost | `miamboost-supabase.service` (existe) | `supabase start` / `stop` | `miamboost-workers.service` |
| openstyle | `openstyle-supabase.service` (à créer) | `supabase start` / `stop` dans `/home/mariella/openstyle/app` | — |
| projob | aucun : permanent | — | — |

`miamboost-coffre-alertes.service` (minuteur quotidien à 06 h) lit la base MiamBoost. Il reçoit
`Wants=` et `After=miamboost-supabase.service` : il réveille la pile pour son passage, et la ronde
la rendort ensuite.

**Prérequis** : `prolearn` et `openstyle` ne sont pas dans le registre PlanTrack, et leurs
sessions n'ont pas les hooks. Il faut lancer `plantrack init` dans ces deux dépôts, sinon leurs
sessions ne battent pas et leurs piles ne se réveilleraient jamais d'elles-mêmes.

## 6. Code

- Tout va dans `.claude/hooks/pt.py`, en stdlib uniquement et selon les conventions existantes
  (messages en français sans accents dans le code, fail-open).
- Nouvelles fonctions :
  - `battre(racine)` ;
  - `souffle(racine)`, qui lit le conf et renvoie `(reveil, garde)` ;
  - `vivant(racine, maintenant)` ;
  - `cmd_respirer(args)`.
- Les commandes `systemctl` passent par une seule fonction, surchargeable par `SOUFFLE_SYSTEMCTL`
  (même principe que `RELEVE_CMD`), pour que les tests utilisent un faux.
- Les constantes `SOUFFLE_DELAI=1800` et `SOUFFLE_PERIODE` (documentaire, le minuteur fait foi)
  sont surchargeables par l'environnement.
- `.plantrack/battement` et `.plantrack/souffle.log` sont propres à la machine. Ils s'ajoutent à
  la liste `.gitignore` de `cmd_init`, près de `ronde.log` (pt.py:1457), sinon chaque hook
  salirait `git status`. En revanche, `souffle.conf` se commite : il décrit le projet.
- Les units `plantrack-respiration.{service,timer}` vont dans `/etc/systemd/system/`. Le service
  lance `/home/mariella/plantrack/plantrack respirer`.

## 7. Tests (`tests/scenario.sh`)

Un faux `systemctl` journalise ses appels dans un fichier. Les cas à couvrir :

1. Sans `souffle.conf` : aucun battement écrit, aucun appel à `systemctl`.
2. Premier hook (battement absent) : `start --no-block` des services non-garde, mais pas des
   services `garde`.
3. Deuxième hook à moins de 30 min : aucun `start`.
4. Battement vieilli à plus de 30 min (`touch -d`) puis hook : nouveau `start`.
5. `respirer` avec un battement frais : aucun `stop`.
6. `respirer` avec un battement vieux et un service garde actif (le faux renvoie `active`) :
   aucun `stop`.
7. `respirer` avec un battement vieux et aucune garde active : `stop` des services actifs, et une
   ligne écrite dans `souffle.log`.
8. `respirer` avec un battement vieux et une commande en cours : aucun `stop`. Le cas se
   reproduit avec un script nommé `claude`, dont le `cwd` est sous la racine, qui lance
   `bash -c 'sleep 30' shell-snapshots`.
9. `systemctl` en échec : le hook sort en 0 (fail-open).

## 8. Hors périmètre (v1)

- Priorités entre projets (« qui respire en premier » quand la RAM manque) et intégration avec le
  budget de `kvm-lourd`.
- Faire passer le démarrage d'une pile par la file `kvm-lourd`.
- La surveillance de la charge reste dans `vps-charge-alerte` (bulle dans le fil). PlanTrack ne lit
  toujours ni la charge ni la swap.

## 9. Mise en service

1. Code et tests verts, puis publication de PlanTrack selon le circuit habituel. Les dépôts
   reçoivent le nouveau `pt.py` à la ronde.
2. `plantrack init` dans prolearn et openstyle.
3. Création ou adaptation des units (section 5), avec sauvegarde des units existantes dans
   `/root/backup-systemd-20261018/`.
4. Écriture des `souffle.conf`.
5. Activation de `plantrack-respiration.timer`.
6. Vérification le lendemain : `plantrack respirer --etat` et `souffle.log`, plus la RAM disponible
   et la swap comparées à aujourd'hui (4,7 Go disponibles après l'arrêt d'openstyle, swap vidée).
7. Décision consignée avec `./plantrack decide`.
