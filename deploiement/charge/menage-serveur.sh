#!/usr/bin/env bash
# =============================================================================
# Menage prudent du serveur (choix de Mariella, tel 17/10 : "Menage prudent").
#
# Pourquoi : le 16/10 le serveur a sature ; dessous, le swap etait plein depuis
# la veille a cause de sessions Claude oubliees (rien tape depuis le 5/10) et de
# serveurs de test allumes depuis des jours.
#
# N'eteint QUE ce qui dort depuis plus de INACTIF_H heures :
#  - une session Claude INTERACTIVE (avec un terminal) : rien tape depuis
#    INACTIF_H (atime du tty, comme `w`) ET aucune commande en cours ;
#  - un serveur de test (next dev / wrangler dev / vite) lance a la main :
#    age > INACTIF_H ET aucune connexion venue d'ailleurs que de lui-meme.
# Ne touche JAMAIS a un *.service (prolearn, prorent-dev, bcc...) ni aux
# sessions telephone de bcc (claude sans terminal).
# TERM d'abord, KILL 30 s plus tard si le programme ne repond pas.
# Usage : menage-serveur.sh [--a-blanc]   (--a-blanc = liste sans eteindre)
#
# Respiration automatique (choix de Mariella, tel 27/10 : "On code tout") --
# laisser respirer le serveur sans rien perdre :
#  - un serveur de test s'eteint des SERVEUR_INACTIF_H h d'age s'il n'a eu
#    personne dessus pendant CALME_MIN min d'affilee (temoin par pid) ;
#  - les gros travaux (builds, serveurs de test, navigateurs sans ecran) passent
#    en priorite basse : les sessions de Mariella restent fluides ;
#  - la memoire de secours (swap) est revidee dans la memoire vive quand il y a
#    largement la place (rien n'est perdu : les pages remontent en RAM).
# Lance toutes les 5 min par menage-serveur.timer.
# =============================================================================
set -euo pipefail
# d266 : fichier de capacite unique du serveur (VCPU, interrupteurs), lu par tous
[ -r /etc/plantrack/capacite.conf ] && . /etc/plantrack/capacite.conf

INACTIF_H=${INACTIF_H:-24}
SERVEUR_INACTIF_H=${SERVEUR_INACTIF_H:-6}
CALME_MIN=${CALME_MIN:-60}
ETAT=/var/lib/menage-serveur
A_BLANC=0; [ "${1:-}" = "--a-blanc" ] && A_BLANC=1
LIMITE=$(( INACTIF_H * 3600 ))
MAINTENANT=$(date +%s)
eteints=()

note() { echo "$1"; [ $A_BLANC = 1 ] || logger -t menage-serveur "$1"; }

# Un service systemd est voulu : on n'y touche pas.
est_service() { grep -q '\.service$' "/proc/$1/cgroup" 2>/dev/null; }

descendants() { local e; for e in $(pgrep -P "$1"); do echo "$e"; descendants "$e"; done; }

arreter() { # $1 = pids separes par |, $2 = journal, $3 = texte de la bulle
	note "$2"
	[ $A_BLANC = 1 ] && return
	local pids=${1//|/ } p
	kill -TERM $pids 2>/dev/null || true
	for _ in $(seq 30); do
		vivant=0; for p in $pids; do kill -0 "$p" 2>/dev/null && vivant=1; done
		[ $vivant = 1 ] || break; sleep 1
	done
	kill -KILL $pids 2>/dev/null || true
	eteints+=("$3")
}

# --- Sessions Claude interactives -------------------------------------------
for pid in $(pgrep -x claude || true); do
	est_service "$pid" && continue
	tty=$(readlink "/proc/$pid/fd/0" 2>/dev/null || true)
	[[ $tty == /dev/pts/* ]] || continue          # sans terminal = session bcc
	inactif=$(( MAINTENANT - $(stat -c %X "$tty") ))
	[ $inactif -ge $LIMITE ] || continue
	# Occupee : un outil Bash tourne (ses commandes passent par shell-snapshots).
	occupe=0
	for d in $(descendants "$pid"); do
		grep -qa shell-snapshots "/proc/$d/cmdline" 2>/dev/null && { occupe=1; break; }
	done
	[ $occupe = 0 ] || continue
	dossier=$(readlink "/proc/$pid/cwd" 2>/dev/null || echo "?")
	arreter "$pid" "session Claude $pid ($dossier) : rien tape depuis $(( inactif / 3600 )) h" \
		"une session Claude dans ${dossier##*/} (rien tape depuis $(( inactif / 86400 )) j)"
done

# --- Serveurs de test lances a la main ---------------------------------------
MOTIF='next dev|wrangler.*dev|vite'
mkdir -p "$ETAT/calme"
# Temoins de pids disparus : on les oublie.
for t in "$ETAT"/calme/*; do [ -e "$t" ] && ! kill -0 "${t##*/}" 2>/dev/null && rm -f "$t" || true; done
for pid in $(pgrep -f "$MOTIF" || true); do
	est_service "$pid" && continue
	# On vise le haut de l'arbre (npm run dev -> next dev -> ...), pas chaque etage.
	parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') || continue
	tr '\0' ' ' < "/proc/$parent/cmdline" 2>/dev/null | grep -qE "$MOTIF" && continue
	age=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
	[ -n "$age" ] && [ "$age" -ge $(( SERVEUR_INACTIF_H * 3600 )) ] || continue
	membres=$( { echo "$pid"; descendants "$pid"; } | paste -sd'|')
	# Un vrai serveur ECOUTE : sans ca, ce n'est qu'une commande qui contient le
	# mot (un grep vite, un shell...) -- teste le 17/10, il eteignait le shell.
	ss -tlnpH 2>/dev/null | grep -qE "pid=($membres)," || continue
	# Connexions etablies dont l'autre bout n'appartient pas au groupe lui-meme
	# (wrangler parle a son propre workerd en local : ca ne compte pas).
	connectes=$(ss -tnpH state established 2>/dev/null | awk -v m="pid=($membres)," '
		$0 ~ m { loc[$3]=1; n++; pair[n]=$4 }
		END { c=0; for (i=1;i<=n;i++) if (!(pair[i] in loc)) c++; print c+0 }')
	temoin="$ETAT/calme/$pid"
	if [ "$connectes" != 0 ]; then rm -f "$temoin"; continue; fi
	# Personne dessus a CET instant ne suffit pas : il faut CALME_MIN min d'affilee.
	if [ ! -e "$temoin" ]; then [ $A_BLANC = 1 ] || touch "$temoin"; continue; fi
	calme=$(( MAINTENANT - $(stat -c %Y "$temoin") ))
	[ $calme -ge $(( CALME_MIN * 60 )) ] || continue
	dossier=$(readlink "/proc/$pid/cwd" 2>/dev/null || echo "?")
	arreter "$membres" "serveur de test $pid ($dossier) : allume depuis $(( age / 3600 )) h, personne dessus depuis $(( calme / 60 )) min" \
		"le serveur de test de ${dossier##*/} (personne dessus depuis $(( calme / 60 )) min ; il se relance avec npm run dev)"
	[ $A_BLANC = 1 ] || rm -f "$temoin"
done

# --- Ecrans d'admin des bases (choix de Mariella, tel 30/10 : "Menage auto") --
# Studio, pg_meta, analytics, vector : ils se rallument a chaque relance d'un
# projet supabase (restart unless-stopped / compose up). Allumes depuis plus de
# ADMIN_H h -> docker stop (jamais rm) ; un `docker start <nom>` les rend.
ADMIN_H=${ADMIN_H:-1}
for nom in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'studio|pg_meta|-meta-?1?$|supabase-meta|analytics|vector' || true); do
	debut=$(docker inspect -f '{{.State.StartedAt}}' "$nom" 2>/dev/null) || continue
	age=$(( MAINTENANT - $(date -d "$debut" +%s) ))
	[ $age -ge $(( ADMIN_H * 3600 )) ] || continue
	note "ecran d'admin $nom : allume depuis $(( age / 60 )) min"
	[ $A_BLANC = 1 ] && continue
	docker stop "$nom" >/dev/null 2>&1 && eteints+=("l'ecran d'admin $nom (docker start $nom pour le rallumer)")
done

# --- Gros travaux en priorite basse ------------------------------------------
# Builds, serveurs de test, navigateurs sans ecran : ils passent apres les
# sessions. Rien n'est arrete, ils vont juste un peu moins vite quand ca bouchonne.
LOURD='gradle|GradleDaemon|KotlinCompileDaemon|next build|vite build|webpack|rustc|cargo build|next dev|wrangler.*dev|workerd|esbuild|chrome-headless|headless_shell'
for pid in $(pgrep -f "$LOURD" || true); do
	est_service "$pid" && continue
	# kvm-lourd range ses commandes dans un run-*.scope et regle leur priorite lui-meme.
	grep -q '/run-[^/]*\.scope$' "/proc/$pid/cgroup" 2>/dev/null && continue
	# Un shell dont la ligne contient un des mots (un grep, un pgrep...) n'est pas un travail.
	case $(ps -o comm= -p "$pid" 2>/dev/null) in bash|sh|grep|pgrep|"") continue ;; esac
	ni=$(ps -o ni= -p "$pid" 2>/dev/null | tr -d ' ') || continue
	[ -n "$ni" ] && [ "$ni" -lt 10 ] || continue
	note "priorite basse : $pid ($(ps -o comm= -p "$pid" 2>/dev/null))"
	[ $A_BLANC = 1 ] && continue
	renice -n 10 -p "$pid" >/dev/null 2>&1 || true
	ionice -c 3 -p "$pid" 2>/dev/null || true
done

# --- Services au repos qui gardent du secours (choix de Mariella, tel 08/11) --
# OmniVoice (voix) et la passerelle d'IA de bcc gardent 0,7 a 1 Go dans le swap
# meme au repos : le secours restait plein en permanence et le garde-fou coupait
# des programmes des que la RAM baissait. Un service est redemarre seulement si
# son swap depasse SECOURS_MIN_KB, si aucune connexion n'est ouverte sur son
# port depuis CALME_SERVICE_MIN min (temoin), et au plus une fois toutes les 6 h.
# Rien n'est perdu : les deux sont sans etat (modele recharge au prochain appel).
SECOURS_MIN_KB=${SECOURS_MIN_KB:-524288}
CALME_SERVICE_MIN=${CALME_SERVICE_MIN:-30}
for entree in omnivoice:3900 bcc-passerelle-passerelle-1:4000; do
	nom=${entree%%:*}; port=${entree##*:}
	pid=$(docker inspect -f '{{if .State.Running}}{{.State.Pid}}{{end}}' "$nom" 2>/dev/null || true)
	[ -n "$pid" ] || continue
	swap_svc=0
	for p in $pid $(descendants "$pid"); do
		s=$(awk '/^VmSwap/{print $2}' "/proc/$p/status" 2>/dev/null || true)
		swap_svc=$(( swap_svc + ${s:-0} ))
	done
	temoin="$ETAT/calme-$nom"
	if [ "$(nsenter -t "$pid" -n ss -Htn state established "( sport = :$port )" 2>/dev/null | wc -l)" -gt 0 ]; then
		rm -f "$temoin"; continue                    # quelqu'un s'en sert
	fi
	[ -e "$temoin" ] || { [ $A_BLANC = 1 ] || touch "$temoin"; continue; }
	[ $(( MAINTENANT - $(stat -c %Y "$temoin") )) -ge $(( CALME_SERVICE_MIN * 60 )) ] || continue
	[ "$swap_svc" -ge "$SECOURS_MIN_KB" ] || continue
	dernier_svc=$(stat -c %Y "$ETAT/redemarre-$nom" 2>/dev/null || echo 0)
	[ $(( MAINTENANT - dernier_svc )) -ge 21600 ] || continue
	note "secours : $nom au repos redemarre ($(( swap_svc / 1024 )) Mo de secours rendus)"
	if [ $A_BLANC = 0 ]; then
		touch "$ETAT/redemarre-$nom"; rm -f "$temoin"
		docker restart "$nom" >/dev/null 2>&1 || note "secours : echec du redemarrage de $nom"
	fi
done

# --- Memoire de secours revidee ------------------------------------------------
# Swap plein + RAM libre = de vieilles pages qui encombrent le secours. On les
# remonte en RAM (swapoff/swapon, comme a la main le 24/10) seulement s'il y a
# la place avec 3 Go de marge, que le serveur n'est pas deja charge, et au plus
# une fois toutes les 3 h. Rien n'est perdu.
read -r dispo_kb swap_kb < <(awk '/^MemAvailable/{ma=$2} /^SwapTotal/{st=$2} /^SwapFree/{sf=$2}
	END { printf "%d %d\n", ma, st-sf }' /proc/meminfo)
charge5=$(awk '{print $2}' /proc/loadavg)
# d266 : un seul nombre de processeurs pour tous, celui du fichier de capacite (4, pg34)
coeurs=${COEURS:-${VCPU:-$(nproc)}}
dernier=$(stat -c %Y "$ETAT/swap-revide" 2>/dev/null || echo 0)
if [ "$swap_kb" -ge 1048576 ] && [ "$dispo_kb" -ge $(( swap_kb + ${MARGE_KB:-3145728} )) ] \
	&& awk -v c="$charge5" -v n="$coeurs" 'BEGIN{exit !(c < n)}' \
	&& [ $(( MAINTENANT - dernier )) -ge 10800 ]; then
	note "secours revide : $(( swap_kb / 1024 )) Mo remontes en RAM ($(( dispo_kb / 1024 )) Mo dispo, charge $charge5)"
	if [ $A_BLANC = 0 ]; then
		touch "$ETAT/swap-revide"
		swapoff -a && swapon -a || { swapon -a 2>/dev/null; note "secours : echec du revidage, swap remis en place"; }
	fi
fi

# --- Une seule bulle, seulement si quelque chose a ete eteint ---------------
# d266 : avec ALERTES_UNIQUES=1, seul l'orchestre ecrit a Mariella ; le menage note dans son journal.
if [ ${#eteints[@]} -gt 0 ] && [ "${ALERTES_UNIQUES:-0}" = 1 ]; then
	note "eteint sans bulle (d266) : ${eteints[*]}"
elif [ ${#eteints[@]} -gt 0 ]; then
	texte="Ménage du serveur : j'ai éteint ${#eteints[@]} chose(s) oubliée(s) qui ne servai(en)t plus."
	for e in "${eteints[@]}"; do texte+=$'\n'"- $e"; done
	texte+=$'\n'"Rien n'est perdu : une session Claude se reprend avec claude --resume."
	cd /home/mariella/plantrack && env -u CLAUDE_CODE_SESSION_ID \
		node /home/mariella/bcc/hook/repondre.ts --ton info "$texte" || true
fi

# --- Alerte avant saturation (choix de Mariella, tel 17/10) -----------------
# Le 16/10 le swap etait plein depuis la veille sans que personne ne le sache.
# Une seule bulle au passage du seuil ; le temoin l'empeche de se repeter tant
# qu'on ne redescend pas dessous. N'eteint rien : Mariella decide.
SEUIL_PCT=${SEUIL_PCT:-80}
# d266 : l'alerte memoire est retiree (d67 remplacee), l'orchestre est la seule voix.
[ "${ALERTES_UNIQUES:-0}" = 1 ] && exit 0
# Swap plein seul = vieilles pages qui dorment, pas un danger (fausse alerte
# du 24/10 : ram 42 %, swap 96 %). Choix de Mariella (tel 24/10) : le swap ne
# compte que si la memoire vive est deja bien occupee.
SEUIL_RAM_SWAP=${SEUIL_RAM_SWAP:-60}
TEMOIN=/var/lib/menage-serveur/alerte
read -r ram swap < <(awk '/^MemTotal/{mt=$2} /^MemAvailable/{ma=$2}
	/^SwapTotal/{st=$2} /^SwapFree/{sf=$2}
	END { printf "%d %d\n", 100-100*ma/mt, (st ? 100-100*sf/st : 0) }' /proc/meminfo)
# d212 : le swap ne compte plus que si la memoire est vraiment genee sur 1 min (PSI
# some avg60) ; swap plein + RAM 60-68 % au calme faisait encore 3 fausses alertes sur 11.
SEUIL_PSI_SWAP=${SEUIL_PSI_SWAP:-10}
psi60=$(awk '/^some/{for(i=1;i<=NF;i++) if($i ~ /^avg60=/){sub("avg60=","",$i); print $i}}' /proc/pressure/memory 2>/dev/null)
gene=$(awk -v p="${psi60:-0}" -v s="$SEUIL_PSI_SWAP" 'BEGIN{print (p > s) ? 1 : 0}')
if [ "$ram" -ge "$SEUIL_PCT" ] || { [ "$swap" -ge "$SEUIL_PCT" ] && [ "$ram" -ge "$SEUIL_RAM_SWAP" ] && [ "$gene" = 1 ]; }; then
	if [ ! -e "$TEMOIN" ]; then
		texte="Le serveur est presque plein malgré le ménage automatique : mémoire à ${ram} %, mémoire de secours à ${swap} %. Ce qui reste sert encore, je n'y ai pas touché : c'est toi qui décides."
		texte+=$'\n'"Ce qui prend le plus de place :"
		while read -r rss nom; do
			texte+=$'\n'"- $nom : $(awk -v k="$rss" 'BEGIN{printf "%.1f", k/1048576}') Go"
		done < <(ps -eo rss=,comm= --sort=-rss | head -3)
		note "alerte memoire : ram ${ram} %, swap ${swap} %"
		if [ $A_BLANC = 1 ]; then echo "$texte"; else
			mkdir -p "${TEMOIN%/*}" && touch "$TEMOIN"
			cd /home/mariella/plantrack && env -u CLAUDE_CODE_SESSION_ID \
				node /home/mariella/bcc/hook/repondre.ts --ton probleme "$texte" || true
		fi
	fi
else
	# Passe toutes les 5 min : sans delai, une memoire qui oscille autour du
	# seuil renverrait une bulle a chaque passage (vu le 27/10 : 20h12 puis 20h25).
	# Le temoin ne s'efface donc qu'apres 6 h.
	if [ $A_BLANC = 0 ] && [ -e "$TEMOIN" ] && [ $(( MAINTENANT - $(stat -c %Y "$TEMOIN") )) -ge 21600 ]; then
		rm -f "$TEMOIN"
	fi
fi
exit 0
