# Rapport charge serveur — 13/10/2026 02:35 UTC

## Constat
- Load 53 / 56 / 43 sur un VPS bridé à 2 vCPU réels. Swap **4,0 Go / 4,0 Go (100 %)**.
- PSI mémoire : `some` 99 %, `full` **67 %** → la machine passe les deux tiers de son temps
  bloquée sur la mémoire. 36 processus en état D, tous dans `mem_cgroup_handle_over_high`.
- La RAM globale n'est PAS pleine (5,3 Go disponibles) : l'étranglement vient d'un cgroup.

## Cause : `bcc.service` collé à son plafond
- `memory.high` = 4 Go, `memory.current` = 4,5 Go (anon 4,2 Go) → **26,8 millions** d'événements
  `high` : le noyau ralentit chaque processus du service pour récupérer de la mémoire.
- 111 processus dans le service, dont :
  - `tsc --noEmit` (s69-francoviet) : **1,2 Go**
  - `next build` + `opennextjs-cloudflare build` (miamboost) : ~0,6 Go
  - 7 sessions Claude (agent SDK) : 1,9 Go
  - 5 `playwright-mcp` + leurs `npm exec` : ~1 Go
  - 16 `git-remote-https` bloqués depuis ~20 min (rafraîchissement des marketplaces de plugins
    à chaque démarrage de session)

## Ce qui concerne PlanTrack : kvm-lourd ne protège pas quand il le faudrait
1. **Les builds tournent hors file** : `lourd.slice` est **vide** (0 processus) alors que `tsc` et
   deux `next build` tournent dans `bcc.service`. `kvm-lourd status` : « file vide ».
2. **Fail-open au pire moment** : le hook `hook-pretool` appelle `kvm-lourd classe` avec un délai
   de 5 s (`pt.py` ~l. 959). Sous pression mémoire, `kvm-lourd` lui-même (lancé DANS le cgroup
   étranglé) dépasse 5 s → la commande lourde passe **sans file ni plafond**. Le garde-fou
   s'éteint exactement quand la machine sature. 56 timeouts `kvm-lourd classe` dans les
   `incidents.log` des projets (prostule 18, bcc 10, miamboost 10, essai-opencode 6, …).
3. **Budget calculé sur la mauvaise mesure** : `kvm-lourd status` annonce « RAM dispo 5,3 Go,
   budget lourd.slice 6,0 Go » à partir de la RAM globale, sans voir que le cgroup appelant est
   à son plafond ni que la swap est pleine.
4. Effets de bord dans plantrack : `git show` / `git log` du hook expirent aussi (10 s) — même
   cause.

## Pistes (non appliquées — à arbitrer)
- Hook : sous pression (PSI mémoire élevée ou classe en timeout), **fail-closed** pour les
  commandes reconnues lourdes par un motif rapide en Python (sans lancer `kvm-lourd`), ou
  envelopper d'office dans `kvm-lourd run`.
- `kvm-lourd` : intégrer swap libre + PSI + `memory.current/high` du cgroup appelant au budget.
- `bcc.service` : plafond 4 Go trop bas pour 7 sessions + MCP + builds, ou limiter le nombre de
  sessions/Playwright simultanés.
- Swap pleine : `swapoff -a && swapon -a` une fois la pression retombée (geste humain).

## Action du 13/10 02:37 (choix Mariella : « Soulager le serveur »)
39 processus arrêtés (tsc s69, next/opennext build miamboost, git remote-https bloqués > 5 min).
Une minute après : bcc.service 4,5 → 2,35 Go, PSI mémoire avg10 99 % → 3 %, 0 processus en D,
load 53 → 30 et en baisse. Swap toujours pleine (vidage = geste humain).
