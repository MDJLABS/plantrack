#!/usr/bin/env python3
"""
PlanTrack v0 — couche de capture et de reinjection de contexte.

Un seul fichier, stdlib uniquement. Source de verite : .plantrack/events.jsonl
(append-only, versionnable dans git). Aucun etat n'est stocke : il est reconstruit
par rejeu du journal a chaque appel.

Points d'entree :
  hook-prompt      UserPromptSubmit  -> intercepte les commandes "!"
  hook-filelog     PostToolUse       -> journalise les fichiers ecrits
  hook-context     SessionStart      -> reinjecte l'etat (y compris apres compaction)
  hook-precompact  PreCompact        -> archive le transcript avant compaction
  <commande>       CLI humaine       -> status, bugs, inbox, verify, reject, ...
"""

import atexit
import difflib
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

# ---------------------------------------------------------------- configuration

MAX_OPEN_THREADS = 3          # garde-fou : au-dela, le contexte reinjecte enfle
CTX_MAX_CHARS = 3000          # plafond de sante du RESUME injecte (d6) — la fiche, elle, n'est jamais coupee
CTX_MAX_BUGS = 8
CTX_MAX_DECISIONS = 6
CTX_MAX_FILES = 6
CTX_MAX_PIEGES = 6
CTX_MAX_QUESTIONS = 6
LINE_TRUNC = 140
MAX_ARCHIVES = 5              # transcripts gardes : chacun pese la session entiere
STALE_DAYS = 7                # au-dela, un bug sans verdict humain est un oubli
USAGE_DAYS = 30               # fenetre du controle d'usage (commits vs journal)
PHASE_STALE_HOURS = 24        # phase active sans le moindre evenement : elle dort
PORTES = ("agent", "humain")  # qui autorise la sortie d'une phase

# Source unique des regles : elles vivent ici, sont ecrites dans AGENTS.md (agents
# sans hooks) ET reinjectees hors budget a chaque session — un outil tiers peut
# regenerer un fichier de consignes, il ne peut pas toucher au bloc injecte.
RULES = """- Un RÉSUMÉ de l'état t'est injecté en début de session et après chaque compaction ; l'état COMPLET (décisions, bugs, pièges, questions) est dans AGENTS.md, section « instantané de l'état ». Fie-toi à lui, pas à ta mémoire de la conversation.
- Ne réimplémente jamais ce qui figure sous DECISIONS ACTEES.
- Ne modifie pas les fichiers d'un fil en pause.
- Après correction d'un bug : consigne la tentative, puis passe-le en "to_verify". Tu ne valides jamais un bug toi-même. Exception : l'humain t'a donné son verdict par un canal relayé (téléphone, carnet web) → saisis-le avec son attestation citée : `./plantrack verify <id> --de "<canal> : <sa réponse>"` (idem reject/answer). Jamais sans citation réelle.
- Quand une décision se prend en conversation, enregistre-la toi-même : `./plantrack decide "..."` (marquée agent). Un bug repéré en passant : `./plantrack bug "..."`. Un piège technique découvert : `./plantrack piege "..."`.
- Avant de corriger un bug : lis `./plantrack attempts <id>`, puis dépose ton hypothèse `./plantrack attempt <id> "..."` avant de coder ; une hypothèse refusée a déjà été tentée, change d'approche.
- Une question posée à l'humain restée sans réponse : `./plantrack question "..."` — elle ressortira à chaque session jusqu'à la réponse.
- Ouvre un fil AVANT de coder : `!focus <sujet>` (`!park <note>` pour changer de sujet, `!close` quand c'est fini). Chaque commit est journalisé sur le fil actif ; à défaut de fil, PlanTrack en ouvre un d'office au nom de la branche — nomme-le toi-même, c'est plus utile.
- Si `!testcheck on` est actif, structure les recettes de test en guide/étapes (`./plantrack guide`, `./plantrack step <g> "<un geste>" --attendu "<ce qu'on doit voir>"`) ; tu ne poses JAMAIS le verdict toi-même, il est réservé à l'humain (`./plantrack check`). Verdict donné par un canal relayé (téléphone) → `./plantrack check <s> ok|ko --de "<canal> : <sa réponse>"` — idem pour chaque point d'un compte-rendu du guide de test qu'il colle dans le chat.
"""

ROOT = (os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get("PLANTRACK_ROOT")
        or os.getcwd())


def journal_root(root):
    """b14 : une copie `git worktree` ecrit dans le carnet du depot principal, sinon il se coupe en deux."""
    try:
        gitdir = open(os.path.join(root, ".git"), encoding="utf-8").read().split("gitdir:", 1)[1].strip()
    except (OSError, IndexError):
        return root  # depot ordinaire (.git est un dossier) ou pas de git
    gitdir = os.path.join(root, gitdir)
    if not os.path.exists(os.path.join(gitdir, "commondir")):
        return root  # sous-module, pas une copie de travail
    main = os.path.dirname(os.path.dirname(os.path.dirname(os.path.normpath(gitdir))))
    return main if os.path.isdir(os.path.join(main, ".plantrack")) else root


PT_DIR = os.path.join(journal_root(ROOT), ".plantrack")
LOG = os.path.join(PT_DIR, "events.jsonl")
ARCHIVE = os.path.join(PT_DIR, "transcripts")
# registre des depots installes : personne n'ira lancer doctor dans vingt repos
REGISTRY = os.environ.get("PLANTRACK_REGISTRY") or os.path.expanduser("~/.plantrack-repos")
INJECTIONS = os.path.join(PT_DIR, "injections.json")
INCIDENTS = os.path.join(PT_DIR, "incidents.log")
RONDE = os.path.join(PT_DIR, "ronde.log")   # horodatage + trace de la ronde, propre a la machine
RONDE_PERIODE = 4 * 3600
SOUFFLE_DELAI = int(os.environ.get("SOUFFLE_DELAI") or 1800)       # sans battement depuis ce delai : endormi
SOUFFLE_PERIODE = int(os.environ.get("SOUFFLE_PERIODE") or 300)    # documentaire : plantrack-respiration.timer fait foi
SANTE = os.path.join(PT_DIR, "sante.jsonl")   # releve de sante quotidien de la flotte (d57)
ATTENTES = ("bugs en attente de verdict", "questions sans reponse")   # defauts doctor cote humain
MAX_INCIDENTS = 50            # une panne qui se repete se lit sur ses dernieres traces


def trace(ou, e):
    """Une panne avalee est une panne invisible (b7, contre d2). Un except qui ne
    peut pas remonter — un hook ne doit jamais bloquer une session — depose sa
    ligne ici, et le doctor l'annonce. Ne leve jamais : une trace qui plante
    ferait deux pannes au lieu d'une."""
    try:
        os.makedirs(PT_DIR, exist_ok=True)
        ligne = " ".join(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} "
                         f"{ou} : {type(e).__name__}: {e}".split())[:300]
        vieilles = []
        if os.path.exists(INCIDENTS):
            with open(INCIDENTS, encoding="utf-8") as f:
                vieilles = f.read().splitlines()[-(MAX_INCIDENTS - 1):]
        with open(INCIDENTS, "w", encoding="utf-8") as f:
            f.write("\n".join(vieilles + [ligne]) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------- journal

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def append(kind, **fields):
    os.makedirs(PT_DIR, exist_ok=True)
    ev = {"ts": now(), "kind": kind}
    ev.update({k: v for k, v in fields.items() if v is not None})
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    if not getattr(append, "dirty", False):
        # b9 : l'instantane AGENTS.md ne suivait que le post-commit — une ecriture
        # sans commit derriere (decision, bug_status…) le laissait perime pour tout
        # agent qui LIT le fichier. Tout processus qui ecrit au journal le regenere
        # en sortant (atexit survit aux sys.exit des hooks). Cout : un rejeu de
        # plus par invocation mutante.
        append.dirty = True
        atexit.register(lambda: write_state_block(project()))
    return ev


_LUS = [0, []]  # (octets deja analyses, evenements) — pg3 : un seul rejeu par processus


def read_events():
    """Le journal n'est analyse qu'une fois par processus : un appel suivant ne lit
    que la queue ajoutee depuis (par ce processus ou un autre). Un fichier qui a
    retreci (reecrit) est relu en entier."""
    # ponytail: cache en memoire seulement — chaque hook relit le journal une fois ;
    # un etat projete sur disque si un hook depasse ~0,3 s (vers 15-20 000 evenements)
    if not os.path.exists(LOG):
        return []
    if os.path.getsize(LOG) < _LUS[0]:
        _LUS[:] = [0, []]
    with open(LOG, "rb") as f:
        f.seek(_LUS[0])
        neuf = f.read()
    fin = neuf.rfind(b"\n") + 1  # une ligne en cours d'ecriture attend l'appel suivant
    for line in neuf[:fin].decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            _LUS[1].append(json.loads(line))
        except json.JSONDecodeError:
            continue  # une ligne corrompue ne doit jamais casser une session
    _LUS[0] += fin
    return list(_LUS[1])


# -------------------------------------------------------------------- projection

def project():
    """Rejoue le journal et renvoie l'etat courant."""
    st = {"threads": {}, "bugs": {}, "decisions": [], "inbox": [], "active": None,
          "phases": {}, "tasks": {}, "pieges": {}, "questions": {}, "testcheck": False,
          "guides": {}, "steps": {}, "parcours": {}, "tri_plus_tard": "", "jetons": {}}
    for ev in read_events():
        k = ev.get("kind") if isinstance(ev, dict) else None
        if k is None:
            continue
        # un evenement incomplet (JSON valide mais champs manquants) ne doit
        # jamais casser le rejeu — meme regle qu'une ligne corrompue
        if k not in ("file_touched", "precommit_block", "commit", "testcheck", "tri_plus_tard") and not ("id" in ev and "ts" in ev):
            continue
        if k == "thread_open":
            st["threads"][ev["id"]] = {
                "id": ev["id"], "label": ev.get("text", ""), "status": "active",
                "note": "", "files": [], "ts": ev["ts"], "task": ev.get("task"), "commits": [],
                "auto": bool(ev.get("auto")),
            }
            st["active"] = ev["id"]
        elif k == "focus":
            if ev["id"] in st["threads"]:
                st["threads"][ev["id"]]["status"] = "active"
                st["active"] = ev["id"]
        elif k == "park":
            t = st["threads"].get(ev["id"])
            if t:
                t["status"] = "parked"
                t["note"] = ev.get("text", "")
                t["parked_ts"] = ev.get("ts", "")
            if st["active"] == ev["id"]:
                st["active"] = None
        elif k == "close":
            t = st["threads"].get(ev["id"])
            if t:
                t["status"] = "closed"
            if st["active"] == ev["id"]:
                st["active"] = None
        elif k == "file_touched":
            t = st["threads"].get(ev.get("thread"))
            if t:
                p = ev.get("text", "")
                if p in t["files"]:
                    t["files"].remove(p)
                t["files"].append(p)
        elif k == "bug":
            st["bugs"][ev["id"]] = {
                "id": ev["id"], "text": ev.get("text", ""), "status": "open",
                "thread": ev.get("thread"), "notes": [], "ts": ev["ts"],
                "severity": ev.get("severity", "normal"),
                "blocking": bool(ev.get("blocking")), "attempts": [],
                "par": ev.get("par"),
            }
        elif k == "bug_status":
            b = st["bugs"].get(ev["id"])
            if b:
                b["status"], b["status_ts"] = ev.get("status", b["status"]), ev["ts"]
                if ev.get("text"):
                    b["notes"].append(ev["text"])
                    # un rejet motive s'attache a la derniere tentative (§9)
                    if ev.get("status") == "open" and b["attempts"]:
                        b["attempts"][-1]["rejected"] = re.sub(r"^rejete : ", "", ev["text"])
        elif k == "attempt":
            b = st["bugs"].get(ev.get("bug"))
            if b:
                b["attempts"].append({
                    # "text" : nom du champ avant la mise en conformite §9
                    "id": ev["id"], "hypothesis": ev.get("hypothesis") or ev.get("text", ""),
                    "ts": ev["ts"], "rejected": None, "session": ev.get("session"),
                })
        elif k == "decision":
            st["decisions"].append({"id": ev["id"], "text": ev.get("text", ""), "ts": ev["ts"],
                                    "par": ev.get("par")})
        elif k == "note":
            st["inbox"].append({"id": ev["id"], "text": ev.get("text", ""), "ts": ev["ts"]})
        elif k == "note_filed":
            st["inbox"] = [n for n in st["inbox"] if n["id"] != ev["id"]]
        elif k == "piege":
            st["pieges"][ev["id"]] = {"id": ev["id"], "text": ev.get("text", ""), "ts": ev["ts"]}
        elif k == "tri_plus_tard":
            st["tri_plus_tard"] = ev["ts"]
        elif k == "piege_clos":
            st["pieges"].pop(ev["id"], None)
        elif k == "question":
            st["questions"][ev["id"]] = {"id": ev["id"], "text": ev.get("text", ""),
                                         "ts": ev["ts"], "answer": None,
                                         # la phase d'ou part la question : c'est elle
                                         # qui decide si la porte peut s'ouvrir (§parcours)
                                         "phase": ev.get("phase"),
                                         # carte laissee de cote (b174 bcc) : l'id de la
                                         # carte du poste, pour reprendre l'action a la reponse
                                         "carte": ev.get("carte")}
        elif k == "answer":
            q = st["questions"].get(ev["id"])
            if q:
                q["answer"] = ev.get("text", "")
        elif k == "question_doublon":
            # rattachee a une question plus ancienne : rien n'est perdu, mais la copie
            # ne revient plus a chaque session (la reponse reste a l'humain)
            q = st["questions"].get(ev["id"])
            if q:
                q["doublon_de"] = ev.get("de")
        elif k == "commit":
            if (t := st["threads"].get(ev.get("thread"))):
                t["commits"].append({"sha": ev.get("sha", ""), "ctype": ev.get("ctype", "")})
        elif k == "testcheck":
            st["testcheck"] = bool(ev.get("enabled"))
        elif k == "guide":
            st["guides"][ev["id"]] = {"id": ev["id"], "title": ev.get("text", ""), "steps": [], "ts": ev["ts"]}
        elif k == "step":
            st["steps"][ev["id"]] = {"id": ev["id"], "guide": ev.get("guide"), "text": ev.get("text", ""),
                                     "attendu": ev.get("attendu"), "verdict": None, "motif": None,
                                     "canal": None, "ts": ev["ts"]}
            if (g := st["guides"].get(ev.get("guide"))):
                g["steps"].append(ev["id"])
        elif k == "check":
            if (s := st["steps"].get(ev["id"])):
                s["verdict"], s["motif"], s["canal"] = ev.get("verdict"), ev.get("text"), ev.get("canal")
        elif k == "guide_jeton":
            # jamais le jeton en clair ici : seul son hash sha256 est journalise (b24/d100)
            st["jetons"][ev.get("hash", "")] = {"hash": ev.get("hash"), "guide": ev.get("guide"),
                                                 "consumed": False, "ts": ev["ts"]}
        elif k == "guide_jeton_consomme":
            j = st["jetons"].get(ev.get("hash", ""))
            if j:
                j["consumed"] = True
        elif k == "parcours_defini":
            st["parcours"][ev.get("text", "")] = {
                "id": ev["id"], "nom": ev.get("text", ""), "ts": ev["ts"],
                "phases": ev.get("phases") or [],
            }
        elif k == "phase_open":
            st["phases"][ev["id"]] = {
                "id": ev["id"], "title": ev.get("text", ""), "goal": ev.get("goal", ""),
                "status": "open", "ts": ev["ts"],
                # champs de parcours : absents sur une phase creee a la main, et
                # c'est bien ainsi — une phase sans regle reste une phase valide
                "regle": ev.get("regle", ""), "livrable": ev.get("livrable", ""),
                "porte": ev.get("porte", ""), "parcours": ev.get("parcours"),
                "ordre": ev.get("ordre"), "questions": ev.get("questions", True),
            }
        elif k == "phase_status":
            p = st["phases"].get(ev["id"])
            if p:
                p["status"] = ev.get("status", p["status"])
                p["status_ts"] = ev["ts"]
                if ev.get("text"):
                    p["motif"] = ev["text"]
                if ev.get("canal"):
                    p["canal"] = ev["canal"]
        elif k == "task_open":
            st["tasks"][ev["id"]] = {
                "id": ev["id"], "phase": ev.get("phase"), "text": ev.get("text", ""),
                "status": "todo", "ts": ev["ts"], "source": ev.get("source"),
            }
        elif k == "task_status":
            t = st["tasks"].get(ev["id"])
            if t:
                t["status"] = ev.get("status", t["status"])
                t["status_ts"] = ev["ts"]
                if ev.get("text"):
                    t["motif"] = ev["text"]
                if ev.get("replaced_by"):
                    t["replaced_by"] = ev["replaced_by"]
                if ev.get("canal"):
                    t["canal"] = ev["canal"]
    return st


def next_id(prefix):
    n = 0
    for ev in read_events():
        i = ev.get("id", "")
        if isinstance(i, str) and i.startswith(prefix) and i[len(prefix):].isdigit():
            n = max(n, int(i[len(prefix):]))
    return f"{prefix}{n + 1}"


def open_threads(st):
    return [t for t in st["threads"].values() if t["status"] in ("active", "parked")]


# ------------------------------------------------------------------- parcours
# Un parcours est une suite ORDONNEE de phases declarees une fois, ou chaque phase
# porte une regle injectee dans le contexte de l'agent. PlanTrack savait deja dire
# "phase 2 en cours" ; il ne savait pas dire "en phase 2 tu livres des pistes avant
# toute question". Rien de nouveau sous le capot : ce sont les phases existantes,
# avec quatre champs de plus et une commande pour enchainer.

def active_phase(st):
    """La phase en cours. Une seule a la fois : `phase next` ferme avant d'ouvrir."""
    act = [p for p in st["phases"].values() if p["status"] == "active"]
    # au cas ou deux phases auraient ete demarrees a la main : la plus recente gagne
    return max(act, key=lambda p: p.get("status_ts", p["ts"])) if act else None


def phases_du_parcours(st, nom):
    """Les phases instanciees d'un parcours, dans l'ordre declare."""
    return sorted((p for p in st["phases"].values() if p.get("parcours") == nom),
                  key=lambda p: (p.get("ordre") if p.get("ordre") is not None else 0))


def porte_bloquee(st, ph):
    """Ce qui empeche de sortir de la phase `ph`, ou None si la voie est libre.

    Porte `agent` : l'agent sort quand il veut. Porte `humain` : il faut qu'une
    question ait ete posee DANS cette phase et qu'elle ait recu une reponse —
    c'est la seule preuve qu'un humain a tranche. Aucune question du tout n'est
    pas un raccourci : c'est justement le cas que la porte humaine interdit."""
    if ph.get("porte") != "humain":
        return None
    qs = [q for q in st["questions"].values() if q.get("phase") == ph["id"]]
    if not qs:
        return ("porte humaine : aucune question n'a ete posee dans cette phase — "
                "`plantrack question \"...\"` puis attends la reponse")
    muettes = [q["id"] for q in qs if not q.get("answer")]
    if muettes:
        return (f"porte humaine : {', '.join(muettes)} attend(ent) toujours une reponse "
                f"(`!answer {muettes[0]} <texte>`)")
    return None


def git_dir():
    """Le repertoire git du depot, ou None. Dans un WORKTREE, `.git` n'est pas un
    repertoire mais un fichier 'gitdir: <chemin>' : lire ROOT/.git/HEAD y echoue en
    silence (b5). Pas de subprocess, le hook doit rester instantane."""
    p = os.path.join(ROOT, ".git")
    if os.path.isdir(p):
        return p
    try:
        with open(p, encoding="utf-8") as f:
            ligne = f.read().strip()
    except OSError:
        return None
    if not ligne.startswith("gitdir:"):
        return None
    d = ligne.split(":", 1)[1].strip()
    return d if os.path.isabs(d) else os.path.normpath(os.path.join(ROOT, d))


def git_hooks_dir():
    """Les hooks vivent dans le repertoire COMMUN : un worktree
    (<git>/worktrees/<nom>) partage ceux du depot principal."""
    d = git_dir()
    if not d:
        return None
    parent, _ = os.path.split(d.rstrip(os.sep))
    if os.path.basename(parent) == "worktrees":
        d = os.path.dirname(parent)
    return os.path.join(d, "hooks")


def branch():
    """Nom de la branche courante, lu sans git (le hook doit rester instantane)."""
    d = git_dir()
    try:
        head = open(os.path.join(d, "HEAD"), encoding="utf-8").read().strip()
    except (OSError, TypeError):
        return "le depot"
    return head.rsplit("/", 1)[-1] if head.startswith("ref:") else "un commit detache"


def trunc(s, n=LINE_TRUNC):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "\u2026"


# ------------------------------------------------------------- bloc de contexte

def context_block(st, header=True, rules=True, full=True):
    """d6 (b1/b2 — remplace l'elision par priorite, refusee) : plus AUCUNE coupe.
    En entier (full=True) ce rendu est la FICHE : AGENTS.md, `plantrack status`,
    `!state`. Les plafonds CTX_MAX_* la bornent par le NOMBRE d'entrees, jamais
    par les chars — rien ne s'y perd. En resume (full=False, SessionStart) seul
    l'immediat est injecte — regle de phase, bloquants, fils — plus les compteurs
    et le renvoi a la fiche, que tous les agents chargent d'office (AGENTS.md)."""
    L = []
    if header:
        L.append("== PlanTrack — etat persistant du projet ==")
        L.append("(reinjecte automatiquement, y compris apres compaction du contexte)")

    def sec(head, items=None):
        # items=None : section d'une seule ligne. Sinon la tete n'a de sens
        # qu'avec au moins une ligne sous elle — sans quoi le bloc annonce des
        # sections vides ("Questions en attente :" suivi de rien).
        if items is None:
            L.append(head)
        elif items:
            L.append(head)
            L.extend(items)

    # la regle de phase sort meme en resume : c'est la seule ligne du bloc qui dit
    # a l'agent COMMENT travailler maintenant, pas seulement ce qu'il ne doit pas refaire.
    ph = active_phase(st)
    if ph and (ph.get("regle") or ph.get("parcours")):
        det = []
        if ph.get("regle"):
            det.append(f"  regle : {trunc(ph['regle'])}")
        if ph.get("porte") == "humain":
            det.append("  sortie : porte humaine — il faut une question posee ET sa reponse"
                       " avant `plantrack phase next`")
        elif ph.get("porte") == "agent":
            det.append("  sortie : porte agent — tu passes a la suite toi-meme"
                       " (`plantrack phase next`)")
        if ph.get("livrable"):
            det.append(f"  livrable attendu : {trunc(ph['livrable'], 90)}")
        rang = ""
        if ph.get("parcours"):
            suite = phases_du_parcours(st, ph["parcours"])
            ids = [p["id"] for p in suite]
            if ph["id"] in ids:
                rang = f" — phase {ids.index(ph['id']) + 1}/{len(ids)}"
        nom = f"PARCOURS {ph['parcours']}{rang} : " if ph.get("parcours") else "PHASE EN COURS : "
        sec(f"\n{nom}{trunc(ph['title'], 60)}", det or None)

    blockers = [b for b in st["bugs"].values()
                if b.get("blocking") and b["status"] not in ("validated", "wont_fix")]
    if blockers:
        ids = " ; ".join(f"{b['id']} {trunc(b['text'], 50)}" for b in blockers[:2])
        sec(f"\n!! BUG BLOQUANT — a traiter avant toute autre chose : {ids}")

    a = st["threads"].get(st["active"]) if st["active"] else None
    if a:
        tag = f" [{a['task']}]" if a.get("task") else ""
        ctag = f" [{len(a['commits'])} commits]" if a.get("commits") else ""
        det = []
        if a["files"]:
            det.append("  fichiers recemment ecrits : " + ", ".join(a["files"][-CTX_MAX_FILES:]))
        sec(f"\nFIL ACTIF — {a['id']}{tag} : {trunc(a['label'])}{ctag}", det or None)
        if a.get("auto"):
            sec("  (fil ouvert d'office pour ne perdre aucun commit — `!close` puis `!focus <sujet>` pour le nommer)")
    else:
        sec("\nFIL ACTIF : aucun. Ouvre un fil avec `!focus <sujet>` avant de coder — sans fil, aucun de tes commits n'est rattache.")

    parked = [t for t in st["threads"].values() if t["status"] == "parked"]
    sec("\nFILS EN PAUSE (ne pas y toucher sans reprise explicite) :" if parked else None,
        [f"  {t['id']} : {trunc(t['label'], 60)} — reprise : {trunc(t['note'] or 'aucune note', 110)}"
         for t in parked])

    def bug_line(b):
        th = f"[{b['thread']}] " if b.get("thread") else ""
        tag = " (agent)" if b.get("par") == "agent" else ""
        att = ""
        if b["attempts"]:  # tentatives cablees en session (v1.5)
            att = (f" [{len(b['attempts'])} tentatives, derniere: "
                   f"{trunc(b['attempts'][-1]['hypothesis'], 60)}]")
        line = f"  {b['id']} ({b['status']}) {th}{trunc(b['text'])}{tag}{att}"
        rej = [x for x in b["attempts"] if x.get("rejected")]
        if rej:  # §5 : ce qui a deja ete tente doit survivre a la compaction — et
            # reste colle a son bug pour ne jamais s'en separer a la lecture
            plus = f" (+{len(rej) - 1}, voir plantrack attempts {b['id']})" if len(rej) > 1 else ""
            line += (f"\n    deja rejete : {trunc(rej[-1]['hypothesis'], 60)}"
                     f" — {trunc(rej[-1]['rejected'], 60)}{plus}")
        return line

    # Deux sections, pas une : un bug JAMAIS corrige et un bug qui n'attend qu'un verdict
    # ne meritent pas la meme place. Melanges, les plafonds partent aux plus recents —
    # mesure du 20/09 sur bcc : 45 bugs, les 8 places prises par des to_verify, les deux
    # seuls bugs non corriges (secrets en clair) jamais montres a l'agent.
    bugs = list(st["bugs"].values())
    troues = [b for b in bugs if b["status"] in ("open", "in_progress")]
    verdict = [b for b in bugs if b["status"] == "to_verify"]
    pending_q = [q for q in st["questions"].values() if q_ouverte(q) and not q.get("carte")]
    # d96 : une carte laissee de cote est une action suspendue, pas une question
    # ordinaire — elle se montre a part, avec son id, pour etre reprise a la reponse
    cartes = [q for q in st["questions"].values() if q_ouverte(q) and q.get("carte")]
    carte_line = lambda q: f"  {q['id']} (carte {q['carte']}) : {trunc(q['text'], 80)}"

    if full:
        # b12 : la fiche promet l'etat COMPLET (d6) — aucun plafond CTX_MAX_* ici,
        # sinon les entrees anciennes disparaissent de partout (27 bugs caches le 23/09)
        sec("\nBUGS NON CORRIGES (personne ne s'en est occupe) :",
            [bug_line(b) for b in troues])
        sec("\nBUGS EN ATTENTE DE TON VERDICT (corriges, ne pas les refaire) :",
            [bug_line(b) for b in verdict])

        sec("\nDECISIONS ACTEES (ne jamais revenir dessus ni reimplementer) :",
            [f"  {d['id']} : {trunc(d['text'])}" + (" (agent)" if d.get("par") == "agent" else "")
             for d in st["decisions"]])

        sec("\nPieges connus :",
            [f"  {p['id']} : {trunc(p['text'], 80)}"
             for p in st["pieges"].values()])

        sec("\nQuestions en attente (reponds via !answer qN ...) :",
            [f"  {q['id']} : {trunc(q['text'], 80)}" for q in pending_q])
        sec("\nCartes laissees de cote (action a reprendre a la reponse : answer --carte <id>) :",
            [carte_line(q) for q in cartes])
    else:
        # resume : des compteurs, jamais le detail — l'etat entier est dans la
        # fiche AGENTS.md que chaque agent charge d'office. Rien a elider, donc
        # rien a perdre (b1) ni a mesurer apres coupe (b2).
        n = [f"{len(troues)} bug(s) non corrige(s)" if troues else "",
             f"{len(verdict)} bug(s) corrige(s) en attente de verdict humain" if verdict else "",
             f"{len(st['decisions'])} decision(s) actee(s)" if st["decisions"] else "",
             f"{len(st['pieges'])} piege(s) connu(s)" if st["pieges"] else "",
             f"{len(pending_q)} question(s) sans reponse" if pending_q else ""]
        if cartes:
            sec(f"\nCARTES LAISSEES DE COTE ({len(cartes)}) — l'humain n'a pas encore repondu, "
                "ne pas les reposer ; reprendre l'action quand la reponse arrive :",
                [carte_line(q) for q in cartes[-5:]]
                + ([f"  (+{len(cartes) - 5} autres dans la fiche)"] if len(cartes) > 5 else []))
        if any(n):
            sec("\nDANS LA FICHE D'ETAT : " + " ; ".join(x for x in n if x) + ".")
        bugs_v, qs_v, old = attentes(st)
        if (bugs_v or qs_v) and st["tri_plus_tard"] < old:
            sec(f"\nTRI GROUPE A PROPOSER : {len(bugs_v)} bug(s) corrige(s) et {len(qs_v)} question(s) "
                f"attendent l'humain depuis +{STALE_DAYS} j (`plantrack attentes`). UNE carte : Me montrer "
                "la liste (Recommande) / Tout valider (verify --de chaque bug) / Plus tard (`plantrack "
                "attentes plus-tard`, 7 j).")
        sec("Lis l'etat COMPLET avant de coder : AGENTS.md, section « instantane de l'etat » (ou `plantrack status`).")

    if st.get("testcheck"):
        for g in list(st["guides"].values())[:6]:
            if (pend := [s for s in g["steps"] if st["steps"][s]["verdict"] is None]):
                sec(f"\nGuide {trunc(g['title'], 50)}: {len(pend)} etapes sans verdict ({', '.join(pend)})")

    if st["inbox"]:
        sec(f"\nINBOX NON CLASSEE : {len(st['inbox'])} element(s), voir `plantrack inbox`.")

    out = "\n".join(L)
    # les regles ferment le bloc : l'etat vit dans la fiche, les regles restent
    # ici — c'est le seul canal qu'aucun outil tiers ne peut ecraser
    if not rules:
        return out
    return out + "\n\nREGLES PLANTRACK (elles priment sur ta memoire de la conversation) :\n" + RULES.rstrip()


# ---------------------------------------------------------------------- commandes

def q_ouverte(q):
    """Une question attend l'humain : sans reponse et pas rattachee a une plus ancienne."""
    return not q.get("answer") and not q.get("doublon_de")


def texte_invalide(text, usage):
    """Une demande d'aide, une option ou un simple identifiant n'est pas un texte :
    rien ne s'ecrit (des --help et des pg9 tapes par erreur ont cree de faux
    pieges, decisions et bugs). Renvoie le message de refus, ou None."""
    t = (text or "").strip()
    if t.startswith("-"):
        return usage
    m = re.fullmatch(r"(b|d|pg|q|t|g|s|a)\d+", t)
    if m:
        if m.group(1) == "pg":
            return f"{usage}\n(pour clore le piege {t} : plantrack piege-clos {t} <motif : ce qui l'a regle>)"
        return f"{usage}\n({t} est un identifiant, pas un texte : rien n'a ete enregistre)"
    return None


def cmd_bug(text, st, par="humain"):
    usage = "usage : !bug <description> [--low|--high|--blocker]"
    if not text:
        return usage
    severity = "normal"
    m = re.search(r"\s*--(low|high|blocker)\b", text)
    if m:
        severity = m.group(1)
        text = (text[:m.start()] + text[m.end():]).strip()
    if not text or texte_invalide(text, usage):
        return texte_invalide(text, usage) or usage
    bid = next_id("b")
    active = st["threads"].get(st["active"]) if st["active"] else None
    append("bug", id=bid, text=text, thread=st["active"],
           task=active.get("task") if active else None, severity=severity,
           blocking=True if severity == "blocker" else None,
           par=par if par == "agent" else None)
    sev = f" [{severity}]" if severity != "normal" else ""
    return f"[PlanTrack] bug {bid}{sev} enregistre : {trunc(text, 80)}\n(non traite pour l'instant — il sera rappele a chaque session)"


def cmd_decide(text, par="humain"):
    usage = "usage : !decide <ce qui est decide> — <motif>"
    if not text or texte_invalide(text, usage):
        return texte_invalide(text, usage) or usage
    did = next_id("d")
    append("decision", id=did, text=text, par=par if par == "agent" else None)
    return f"[PlanTrack] decision {did} actee : {trunc(text, 80)}"


def cmd_piege(text):
    usage = "usage : !piege <ce qu'il ne faut pas refaire>"
    if not text or texte_invalide(text, usage):
        return texte_invalide(text, usage) or usage
    pid = next_id("pg")
    append("piege", id=pid, text=text)
    return f"[PlanTrack] piege {pid} note : {trunc(text, 80)}"


def cmd_piege_clos(pid, motif):
    if pid not in project()["pieges"] or not motif:
        return "usage : plantrack piege-clos <pg ouvert> <motif : ce qui l'a regle>"
    append("piege_clos", id=pid, text=motif)
    return f"[PlanTrack] piege {pid} clos : {trunc(motif, 80)}"


def attentes(st):
    """Ce qui attend l'humain depuis plus de STALE_DAYS : bugs sans verdict, questions muettes."""
    old = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat(timespec="seconds")
    return ([b for b in st["bugs"].values()
             if b["status"] == "to_verify" and b.get("status_ts", b["ts"]) < old],
            [q for q in st["questions"].values() if q_ouverte(q) and q["ts"] < old], old)


def cmd_attentes(args, st):
    if args[:1] == ["plus-tard"]:
        append("tri_plus_tard")
        return f"[PlanTrack] tri groupe reporte : silence {STALE_DAYS} jours."
    bugs, qs, _ = attentes(st)
    return "\n".join([f"Bugs corriges en attente de verdict ({len(bugs)}) :"]
                     + [f"  {b['id']} : {trunc(b['text'], 100)}" for b in bugs]
                     + [f"Questions sans reponse ({len(qs)}) :"]
                     + [f"  {q['id']} : {trunc(q['text'], 100)}" for q in qs])


def cmd_question(text, st=None, carte=None):
    usage = "usage : !question <texte>"
    if not text or texte_invalide(text, usage):
        return texte_invalide(text, usage) or usage
    if st:
        for q in st["questions"].values():
            # une carte se reconnait a son id, pas a son texte : deux autorisations
            # au libelle voisin sont deux cartes distinctes (d96)
            meme = (q.get("carte") == carte) if carte else (not q.get("carte") and question_proche(text, q["text"]))
            if q_ouverte(q) and meme:
                return (f"[PlanTrack] refuse : question deja posee et toujours ouverte — "
                        f"{q['id']} : {trunc(q['text'], 80)}\n"
                        "(elle est deja rappelee a chaque session : rien n'a ete enregistre)")
    qid = next_id("q")
    # la phase d'origine est stockee a l'emission : c'est elle qui ouvrira (ou non)
    # la porte au moment du `phase next`, et le doctor s'en sert pour reperer une
    # question posee dans une phase qui n'en veut pas
    ph = active_phase(st) if st else None
    append("question", id=qid, text=text, phase=ph["id"] if ph else None, carte=carte)
    hors = ""
    if ph and not ph.get("questions", True):
        # d59 : ce que seul l'humain peut faire (un compte, une cle) reste permis
        hors = (f"\n!! la phase {ph['id']} ({ph['title']}) n'admet de question que pour ce que seul "
                f"l'humain peut faire (un compte, une cle, un acces) — {ph.get('regle', '')}")
    return (f"[PlanTrack] question {qid} enregistree" + (f" (carte {carte})" if carte else "")
            + f" : {trunc(text, 80)}\n"
            "(sans reponse, elle sera rappelee a chaque session)" + hors)


def cmd_answer(rest, st):
    """!answer (hook, humain) : ne fait jamais sys.exit — le hook doit rester
    silencieux en erreur et afficher un message au lieu de planter la session."""
    parts = rest.split(None, 1)
    if len(parts) < 2 or not parts[1].strip():
        return "usage : !answer <id> <texte>"
    qid, text = parts[0], parts[1].strip()
    q = st["questions"].get(qid)
    if not q:
        return f"[PlanTrack] question introuvable : {qid} — `plantrack status` pour la liste."
    if q.get("answer"):
        return f"[PlanTrack] {qid} a deja une reponse."
    append("answer", id=qid, text=text)
    return f"[PlanTrack] {qid} repondue : {trunc(text, 80)}"


def cmd_testcheck(arg):
    if arg not in ("on", "off"):
        return "usage : !testcheck on|off"
    append("testcheck", enabled=(arg == "on"))
    return f"[PlanTrack] testcheck {'active' if arg == 'on' else 'desactive'}."

def cmd_guide(text, st):
    if not st.get("testcheck"):
        return "[PlanTrack] option testcheck desactivee — active avec !testcheck on"
    if not text:
        return "usage : !guide <titre>"
    gid = next_id("g")
    append("guide", id=gid, text=text)
    return f"[PlanTrack] guide {gid} cree : {trunc(text, 80)}"

def cmd_step(rest, st):
    if not st.get("testcheck"):
        return "[PlanTrack] option testcheck desactivee — active avec !testcheck on"
    # Point facon guide de test prolearn (d32) : un geste, puis ce qu'on doit voir.
    rest, _, attendu = rest.partition(" --attendu ")
    parts = rest.split(None, 1)
    if len(parts) < 2 or parts[0] not in st["guides"]:
        return "usage : !step <guide_id> <geste> [--attendu <ce qu'on doit voir>]"
    sid = next_id("s")
    append("step", id=sid, guide=parts[0], text=parts[1], attendu=attendu.strip() or None)
    return f"[PlanTrack] etape {sid} ajoutee a {parts[0]} : {trunc(parts[1], 80)}"

def cmd_check(sid, verdict, motif, st, canal=None):
    """Verdict humain, partage entre !check (hook) et `plantrack check` (CLI)."""
    if not st.get("testcheck"):
        return "[PlanTrack] option testcheck desactivee — active avec !testcheck on"
    if sid not in st["steps"] or verdict not in ("ok", "ko"):
        return "usage : check <step_id> ok|ko [motif]"
    if verdict == "ko" and not motif:
        return "refuse : motif obligatoire pour un ko."
    append("check", id=sid, verdict=verdict, text=motif, canal=canal)
    return (f"[PlanTrack] {sid} : {verdict}" + (f" — {trunc(motif, 80)}" if motif else "")
            + (f" (canal : {trunc(canal, 60)})" if canal else ""))


def arg_opt(args, name):
    """Extrait une option generique `--<name> <valeur>` (premiere occurrence) :
    meme esprit qu'arg_de/arg_carte, mais reutilisable pour --url/--poste/--scenario."""
    flag = f"--{name}"
    if flag not in args:
        return None, args
    i = args.index(flag)
    if i + 1 >= len(args) or not args[i + 1].strip():
        sys.exit(f"{flag} attend une valeur.")
    return args[i + 1].strip(), args[:i] + args[i + 2:]


def poste_base():
    """Adresse du poste bcc pour un lien de guide web (b24/d100) — meme source que
    hook/poste.ts::lirePoste cote bcc : un fichier simple ~/.bcc-poste/poste.json
    (champ `adresse`), sinon le meme repli local que repondre.ts (127.0.0.1,
    BCC_PORT ou 8787 — le poste local n'a rien a authentifier)."""
    chemin = os.path.join(os.path.expanduser("~"), ".bcc-poste", "poste.json")
    try:
        with open(chemin, encoding="utf-8") as f:
            brut = json.load(f)
        adresse = brut.get("adresse") if isinstance(brut, dict) else None
        if isinstance(adresse, str) and adresse.strip():
            return adresse.strip().rstrip("/")
    except (OSError, ValueError, AttributeError):
        pass
    try:
        port = int(os.environ.get("BCC_PORT") or 8787)
    except ValueError:
        port = 8787
    return f"http://127.0.0.1:{port}"


def cmd_guide_lien(gid, args, st):
    """plantrack guide-lien <gid> --url <page> [--poste <base>] [--scenario <id>] :
    fabrique le lien d'un guide de test web a usage unique (b24/d100). Autorise en
    environnement agent — c'est l'agent qui fabrique le lien, pas qui pose le
    verdict. Le jeton n'est JAMAIS journalise en clair, seul son hash (meme
    logique qu'un mot de passe) ; c'est lui qui authentifiera le retour du
    navigateur cote `guide-resultat`, pas une identite humaine CLI.
    b25/d106 : REFUSE en environnement agent, sans exception --de — un agent
    qui lit le jeton pourrait forger lui-meme le verdict. Le lien est fabrique
    par le poste (`node <bcc>/hook/guide-lien.ts`, env nettoye) qui l'envoie
    en bulle a l'humain sans jamais l'imprimer."""
    if any(os.environ.get(v) for v in AGENT_ENV):
        sys.exit("[PlanTrack] refuse : `guide-lien` rendrait le jeton du guide a l'agent (b25).\n"
                 "Envoie le lien par le poste : node <bcc>/hook/guide-lien.ts <guide_id> --url <page> "
                 "[--scenario <id>] — il part en bulle sur le telephone, le jeton ne s'affiche jamais.")
    if not gid or gid not in st["guides"]:
        sys.exit("usage : plantrack guide-lien <guide_id> --url <page> "
                 "[--poste <base>] [--scenario <id>] — guide introuvable.")
    url, args = arg_opt(args, "url")
    if not url:
        sys.exit("usage : plantrack guide-lien <guide_id> --url <page> "
                 "[--poste <base>] [--scenario <id>]")
    poste, args = arg_opt(args, "poste")
    scenario, args = arg_opt(args, "scenario")

    jeton = secrets.token_urlsafe(24)
    h = hashlib.sha256(jeton.encode()).hexdigest()
    append("guide_jeton", id=h, guide=gid, hash=h)

    base = poste or os.environ.get("PLANTRACK_POSTE") or poste_base()
    sep = "&" if "?" in url else "?"
    params = (f"guide={quote(scenario or gid)}&retour={quote(jeton)}"
              f"&poste={quote(base, safe='')}&projet={quote(journal_root(ROOT), safe='')}")
    return f"{url}{sep}{params}"


GUIDE_RESULTAT_MAX = 32 * 1024  # meme plafond que la route bcc /guide/resultat : un corps hors-norme est un abus, pas un guide


def cmd_guide_resultat(st):
    """plantrack guide-resultat : recoit sur stdin le verdict d'un guide de test
    rempli dans le navigateur (b24/d100) — appele par la route bcc, jamais par un
    terminal. Authentifie par jeton a usage unique, PAS par require_human : la
    route n'a pas de session agent, c'est le jeton qui prouve que la reponse
    vient bien d'un guide ouvert par l'agent (canal relaye, legitime en env
    agent — meme famille que --de, d8/d107, mais authentifie differemment).
    b25/d106 : refuse (code 5) en environnement agent — seul le poste, qui
    appelle avec un env nettoye des variables agent, depose un resultat."""
    if any(os.environ.get(v) for v in AGENT_ENV):
        print("[PlanTrack] refuse : `guide-resultat` est reserve au poste (environnement agent detecte, b25).",
              file=sys.stderr)
        sys.exit(5)
    brut = sys.stdin.buffer.read(GUIDE_RESULTAT_MAX + 1)
    if len(brut) > GUIDE_RESULTAT_MAX:
        sys.exit(2)
    try:
        data = json.loads(brut.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        sys.exit(2)
    if not isinstance(data, dict):
        sys.exit(2)
    jeton, gid, verdicts = data.get("jeton"), data.get("guide"), data.get("verdicts")
    if not isinstance(jeton, str) or not jeton or not isinstance(gid, str) or not isinstance(verdicts, list):
        sys.exit(2)

    h = hashlib.sha256(jeton.encode()).hexdigest()
    j = st["jetons"].get(h)
    if not j or j.get("guide") != gid:
        sys.exit(3)
    if j.get("consumed"):
        sys.exit(4)
    guide = st["guides"].get(gid)
    if not guide:
        sys.exit(3)

    ok_n = ko_n = 0
    ko_details, inconnus = [], []
    for v in verdicts:
        if not isinstance(v, dict):
            continue
        sid, verdict = v.get("pt"), v.get("verdict")
        if not isinstance(sid, str) or verdict not in ("ok", "ko"):
            continue
        if sid not in guide["steps"]:
            inconnus.append(sid)
            continue
        motif = v.get("motif")
        motif = motif.strip() if isinstance(motif, str) and motif.strip() else None
        if verdict == "ko" and not motif:
            # vient du navigateur, pas d'un humain tapant la CLI : on ne perd pas
            # le verdict pour une case de motif laissee vide (contrairement a
            # cmd_check appele depuis la CLI, qui refuse un ko sans motif)
            motif = "(pas de motif donne)"
        canal = f"guide web : {verdict}" + (f" — {motif}" if motif else "")
        cmd_check(sid, verdict, motif, st, canal=canal)
        if verdict == "ok":
            ok_n += 1
        else:
            ko_n += 1
            ko_details.append(f"{sid} : {motif}")

    append("guide_jeton_consomme", id=h, hash=h)

    ligne = f"Guide {gid} : {ok_n} ok, {ko_n} pas ok"
    if ko_details:
        ligne += " — " + " ; ".join(ko_details)
    print(ligne)
    if inconnus:
        print(f"[PlanTrack] etapes inconnues ignorees (hors de ce guide) : {', '.join(inconnus)}",
              file=sys.stderr)
    sys.exit(0)


def cmd_focus(arg, st):
    if not arg:
        return "usage : !focus <sujet ou identifiant de fil>"
    if st["active"]:
        a = st["threads"][st["active"]]
        return (f"[PlanTrack] refuse : le fil {a['id']} ({trunc(a['label'], 40)}) est encore actif.\n"
                f"Fais `!park <ou tu en es>` avant de changer de sujet, ou `!close` s'il est termine.")
    if arg in st["tasks"]:
        k = st["tasks"][arg]
        if k["status"] in ("done", "cancelled", "replaced"):
            extra = f" — motif : {trunc(k.get('motif', ''), 80)}" if k.get("motif") else ""
            return f"[PlanTrack] refuse : la tache {arg} est {k['status']}{extra}"
        th = next((t for t in st["threads"].values()
                   if t.get("task") == arg and t["status"] != "closed"), None)
        if th:
            append("focus", id=th["id"])
            append("task_status", id=arg, status="in_progress")
            msg = f"[PlanTrack] reprise du fil {th['id']} [tache {arg}] : {trunc(th['label'], 60)}"
            if th["note"]:
                msg += f"\n  note de reprise : {th['note']}"
            if th["files"]:
                msg += "\n  fichiers : " + ", ".join(th["files"][-CTX_MAX_FILES:])
            return msg
        if len(open_threads(st)) >= MAX_OPEN_THREADS:
            ids = ", ".join(t["id"] for t in open_threads(st))
            return f"[PlanTrack] refuse : {MAX_OPEN_THREADS} fils deja ouverts ({ids})."
        tid = next_id("t")
        append("thread_open", id=tid, text=k["text"], task=arg)
        append("task_status", id=arg, status="in_progress")
        return f"[PlanTrack] nouveau fil {tid} sur la tache {arg} : {trunc(k['text'], 60)} (passee in_progress)"
    if arg in st["threads"]:
        append("focus", id=arg)
        t = st["threads"][arg]
        msg = f"[PlanTrack] reprise du fil {arg} : {trunc(t['label'], 60)}"
        if t["note"]:
            msg += f"\n  note de reprise : {t['note']}"
        if t["files"]:
            msg += "\n  fichiers : " + ", ".join(t["files"][-CTX_MAX_FILES:])
        return msg
    if len(open_threads(st)) >= MAX_OPEN_THREADS:
        ids = ", ".join(t["id"] for t in open_threads(st))
        return (f"[PlanTrack] refuse : {MAX_OPEN_THREADS} fils deja ouverts ({ids}).\n"
                f"Ferme-en un avec `plantrack close <id>` avant d'en ouvrir un nouveau.")
    tid = next_id("t")
    append("thread_open", id=tid, text=arg)
    return f"[PlanTrack] nouveau fil {tid} : {trunc(arg, 60)}"


def cmd_park(text, st):
    if not st["active"]:
        return "[PlanTrack] aucun fil actif a mettre en pause."
    if not text:
        return "[PlanTrack] refuse : une mise en pause exige une note de reprise.\nusage : !park <ou tu en es, ce qu'il reste, ce qu'il ne faut pas toucher>"
    tid = st["active"]
    append("park", id=tid, text=text)
    return f"[PlanTrack] fil {tid} en pause. Note de reprise enregistree."


def cmd_close(st):
    if not st["active"]:
        return "[PlanTrack] aucun fil actif."
    tid = st["active"]
    append("close", id=tid)
    return f"[PlanTrack] fil {tid} ferme."


def cmd_note(text):
    nid = next_id("n")
    append("note", id=nid, text=text)
    return f"[PlanTrack] note {nid} capturee dans l'inbox : {trunc(text, 80)}"


def handle_command(raw):
    """raw = contenu apres le '!'. Renvoie le message a afficher a l'humain."""
    st = project()
    parts = raw.strip().split(None, 1)
    verb = parts[0].lower() if parts else ""
    rest = parts[1].strip() if len(parts) > 1 else ""

    if verb == "bug":
        return cmd_bug(rest, st)
    if verb in ("decide", "decision"):
        return cmd_decide(rest)
    if verb == "focus":
        return cmd_focus(rest, st)
    if verb == "park":
        return cmd_park(rest, st)
    if verb == "close":
        return cmd_close(st)
    if verb == "piege":
        return cmd_piege(rest)
    if verb == "question":
        return cmd_question(rest, st)
    if verb == "answer":
        return cmd_answer(rest, st)
    if verb == "verify":
        return cmd_verdict(st, rest.split()[0] if rest else "")[1]
    if verb == "reject":
        parts = rest.split(None, 1)
        if len(parts) < 2 or not parts[1].strip():
            return "usage : !reject <id> <pourquoi ca ne marche pas>"
        return cmd_verdict(st, parts[0], parts[1].strip())[1]
    if verb == "testcheck":
        return cmd_testcheck(rest)
    if verb == "guide":
        return cmd_guide(rest, st)
    if verb == "step":
        return cmd_step(rest, st)
    if verb == "check":
        parts = rest.split(None, 2)
        if len(parts) < 2:
            return "usage : !check <step_id> ok|ko [motif]"
        return cmd_check(parts[0], parts[1], parts[2] if len(parts) > 2 else None, st)
    if verb == "parcours":
        if not rest:
            return ("usage : !parcours <nom> — parcours declares : "
                    + (", ".join(sorted(st["parcours"])) or "aucun"))
        return parcours_start(st, rest.split()[0])[1]
    if verb == "phase":
        if rest.split()[:1] != ["next"]:
            return "usage : !phase next   (le reste : `plantrack phase ...` en CLI)"
        return cmd_phase_next(st)
    if verb == "state":
        return context_block(st)
    if verb == "help":
        return HELP
    # Inbox : capture sans typage, zero decision au moment de la saisie.
    return cmd_note(raw.strip())


HELP = """[PlanTrack] commandes (dans le prompt de l'agent, jamais transmises au modele) :
  !bug <texte> [--low|--high|--blocker]   enregistre un bug, sans interrompre le fil
  !decide <texte>     acte une decision (elle sera rappelee a chaque session)
  !focus <sujet|id>   ouvre ou reprend un fil de travail
  !park <note>        met le fil actif en pause avec une note de reprise (obligatoire)
  !close              ferme le fil actif
  !piege <texte>      note un piege technique (rappele a chaque session)
  !question <texte>   pose une question a l'humain (rappelee tant que sans reponse)
  !answer <id> <texte>   toi seule : reponds a une question en attente
  !verify <id> / !reject <id> <motif>   toi seule : verdict sur un bug to_verify, sans quitter la session
  !testcheck on|off / !guide <titre> / !step <id> <texte> / !check <id> ok|ko [motif]   guides de test, off par defaut (ko exige un motif)
  !parcours <nom>     lance un parcours declare (ses phases portent les regles de travail)
  !phase next         clot la phase en cours et ouvre la suivante (porte humaine : exige une question repondue)
  !state              affiche l'etat persistant courant
  !<texte libre>      capture dans l'inbox, a classer plus tard
CLI humaine : plantrack status | bugs | inbox | verify <id> | reject <id> -m ... | close <id>
              plantrack attempt <bug_id> <hypothese> | attempts <bug_id> | echecs [--json]   tentatives ratees par bug et par tache
              plantrack bug <id> open|in_progress|to_verify|wont_fix   (wont_fix : humain seul, ou relaye avec --de)
              plantrack questions-doublons [--fusionner]   rattache les questions en double a la plus ancienne
              plantrack plan [import <f.md>] | decisions
              plantrack import <f.json|f.md> [--source <nom>] [--apercu] [--de ...]   reprend les taches d'un projet existant ([x] = fait, avec la source)
              plantrack parcours list | import <f.json> (humain seul) | start <nom> [--depuis <phase> --de ...] | json
              plantrack phase add|start|done|next|cancel   (done/cancel : humain seul ; next : la porte decide)
              plantrack task add|start|verify|done|cancel|replace   (done/cancel/replace : humain seul, done relaye avec --de)
              plantrack decide <texte> | bug <texte> [--low|--high|--blocker]   ecriture agent (marquee (agent))
              plantrack piege <texte> | piege-clos <id> <motif> | question <texte>   utilisables par l'agent
              plantrack answer <question_id> <texte>   toi seule, hors session
              plantrack testcheck on|off | guide <titre>|<id> | step <id> <texte> | check <id> ok|ko [-m motif]
              plantrack guide-lien <id> --url <page> [--poste <base>] [--scenario <id>]   lien de guide web a jeton unique (b24/d100) — poste seulement ; agent : node <bcc>/hook/guide-lien.ts (b25)
              plantrack guide-resultat   recoit sur stdin le verdict d'un guide web (jeton), appele par la route bcc
              plantrack init  installation vendoree (tous agents, + hooks git post-commit et pre-commit d'office)
              uvx plantrack@latest update   mise a jour d'une installation existante
              plantrack doctor [--all]   verifie l'installation et l'usage reel | plantrack stats   usage sur 14 jours
              plantrack ronde   met le coeur du projet a niveau (lancee seule a l'ouverture, toutes les 4 h au plus)
              plantrack bilan [--all] [--jours N]   ce qui a avance, ce qui attend ton avis
              plantrack releve [--rapport]   releve de sante de la flotte (bulle sur panne neuve) | rapport final
              plantrack orchestre [--boucle|--tour|--tout-reprendre]   charge du serveur : feu, sessions, pauses
              plantrack attentes [plus-tard]   ce qui attend ton avis depuis plus de 7 jours (tri groupe)"""


# -------------------------------------------------------------------------- hooks

def read_hook_input():
    try:
        return json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as e:
        trace("hook : entree stdin illisible", e)
        return {}


def souffle_conf(racine):
    return os.path.join(racine, ".plantrack", "souffle.conf")


# nom d'unite valide, sans option deguisee (partage : souffle.conf et demandes de reveil)
nom_ok = re.compile(r"[A-Za-z0-9][A-Za-z0-9@_.:-]*\.(service|target|socket)").fullmatch


def souffle(racine):
    """Lit souffle.conf : (reveil, garde). Une ligne = un service ; 'garde X' empeche
    l'expiration sans etre reveille. Pas de fichier = ([], []) : le projet ne respire pas."""
    reveil, garde = [], []
    try:
        with open(souffle_conf(racine), encoding="utf-8") as f:
            for l in f:
                l = l.split("#", 1)[0].split()
                if len(l) == 1 and nom_ok(l[0]):
                    reveil.append(l[0])
                elif len(l) == 2 and l[0] == "garde" and nom_ok(l[1]):
                    garde.append(l[1])
    except OSError:
        pass
    return reveil, garde


def systemctl(args, detache=False):
    """Seul point d'appel a systemctl, surchargeable par SOUFFLE_SYSTEMCTL (tests).
    detache : le reveil ne fait jamais attendre la session. Sinon, renvoie stdout."""
    cmd = shlex.split(os.environ.get("SOUFFLE_SYSTEMCTL") or "systemctl") + list(args)
    if detache:
        subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
        return ""
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout.strip()


def battre(racine):
    """Battement (4.1) : touche .plantrack/battement ; si le precedent datait de plus de
    SOUFFLE_DELAI (ou n'existait pas), reveille les services du souffle. Fail-open.
    Renvoie True si un reveil a ete lance."""
    try:
        reveil, _ = souffle(racine)
        if not os.path.exists(souffle_conf(racine)):
            return False
        bat = os.path.join(racine, ".plantrack", "battement")
        try:
            vieux = time.time() - os.path.getmtime(bat) > SOUFFLE_DELAI
        except OSError:
            vieux = True
        with open(bat, "a"):
            pass
        os.utime(bat)
        if vieux and reveil:
            # portier : un service deja actif ne se reveille pas
            reveil = [s for s in reveil if systemctl(["is-active", "--", s]) != "active"]
            if not reveil:
                return False
            if orch_portier(racine, reveil):
                return False
            systemctl(["start", "--no-block", "--"] + reveil, detache=True)
            return True
    except Exception as e:
        trace("battre", e)
    return False


def commande_en_cours(racine):
    """4.3 : une session claude dont le cwd est sous la racine a un descendant dont la
    cmdline contient shell-snapshots (meme signal que menage-serveur.sh)."""
    racine = os.path.realpath(racine)
    pere, comm = {}, {}
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            with open(f"/proc/{pid}/stat", "rb") as f:
                st = f.read().decode(errors="replace")
            pere[pid] = st.rsplit(")", 1)[1].split()[1]
            comm[pid] = st[st.index("(") + 1:st.rindex(")")]
        except (OSError, ValueError, IndexError):
            continue
    for pid in [p for p, c in comm.items() if c == "claude"]:
        try:
            cwd = os.path.realpath(f"/proc/{pid}/cwd")
        except OSError:
            continue
        if cwd != racine and not cwd.startswith(racine + os.sep):
            continue
        vus, pile = set(), [pid]
        while pile:
            cur = pile.pop()
            for p, pp in pere.items():
                if pp == cur and p not in vus:
                    vus.add(p)
                    pile.append(p)
        for d in vus:
            try:
                with open(f"/proc/{d}/cmdline", "rb") as f:
                    if b"shell-snapshots" in f.read():
                        return True
            except OSError:
                pass
    return False


def vivant(racine, maintenant, delai=None):
    """Battement recent (moins de delai, SOUFFLE_DELAI par defaut), ou commande Bash de
    session en cours (4.3)."""
    try:
        if maintenant - os.path.getmtime(os.path.join(racine, ".plantrack", "battement")) < (delai or SOUFFLE_DELAI):
            return True
    except OSError:
        pass
    return commande_en_cours(racine)


def souffle_etat(racine, maintenant):
    """(reveil, garde, actifs, age) d'un projet qui respire : services de souffle.conf, ceux
    qui sont actifs, et l'age de son battement en s (-1 si absent). Commun a la ronde
    d'expiration et au menage d'urgence de l'orchestre."""
    reveil, garde = souffle(racine)
    actifs = [s for s in reveil + garde if systemctl(["is-active", "--", s]) == "active"]
    try:
        age = int(maintenant - os.path.getmtime(os.path.join(racine, ".plantrack", "battement")))
    except OSError:
        age = -1
    return reveil, garde, actifs, age


def cmd_respirer(args):
    """Ronde d'expiration (4.2), lancee par plantrack-respiration.timer. --etat : diagnostic."""
    maintenant = time.time()
    for racine in registered_roots():
        if not os.path.exists(souffle_conf(racine)):
            continue
        try:
            reveil, garde, actifs, age = souffle_etat(racine, maintenant)
            if "--etat" in args:
                print(f"{racine} : {'vivant' if vivant(racine, maintenant) else 'endormi'}, "
                      f"battement {age if age >= 0 else 'absent'}s, actifs : {' '.join(actifs) or 'aucun'}")
                continue
            if vivant(racine, maintenant) or any(g in actifs for g in garde):
                continue
            arret = [s for s in reveil if s in actifs]
            for s in arret:
                systemctl(["stop", "--", s])
            if arret:
                with os.fdopen(os.open(os.path.join(racine, ".plantrack", "souffle.log"),
                                       os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o644),
                               "a", encoding="utf-8") as f:
                    f.write(f"{datetime.now().isoformat(timespec='seconds')} expire "
                            f"{' '.join(arret)} battement={age}s\n")
        except Exception as e:
            trace(f"respirer {racine}", e)


# --- Chef d'orchestre de la charge (d159, plan valide par Mariella le 02/11) ---------
# Feu tricolore en direct (PSI + MemAvailable), rang de chaque session, pause entre
# deux etapes (le hook PreToolUse attend) et gel des commandes en cours (SIGSTOP),
# reprise dans l'ordre quand le serveur respire. Fail-open partout : dossier absent ou
# etat.json muet depuis ORCH_FRAIS = tout passe comme avant ; earlyoom reste le filet.
ORCH_DIR = os.environ.get("PLANTRACK_ORCHESTRE") or "/var/lib/plantrack-orchestre"
ORCH_PROC = os.environ.get("PLANTRACK_PROC") or "/proc"   # meminfo + pressure (tests)
ORCH_FRAIS = 60                                            # etat plus vieux : orchestre muet
ORCH_ATTENTE = int(os.environ.get("ORCH_ATTENTE") or 540)  # sous le timeout 600 des hooks
ORCH_PAUSE_MAX = int(os.environ.get("ORCH_PAUSE_MAX") or 600)  # une pause ne depasse jamais 10 min
ORCH_HUMAIN = 600        # prompt de Mariella plus recent : rang humain, jamais en pause
ORCH_FOND = 7200         # aucun prompt de Mariella depuis 2 h : rang fond
ORCH_CALME = int(os.environ.get("ORCH_CALME") or 180)      # sous le seuil depuis : le feu baisse
ORCH_PAS = int(os.environ.get("ORCH_PAS") or 30)           # entre deux pauses, deux reprises
ORCH_TOUR = 10                                             # periode de la boucle
# d212 : le feu juge la pression sur 1 min (avg60) ; avg10 seul faisait rouge/vert a la
# minute sur un a-coup. La RAM disponible n'est plus qu'un filet (le cache la fait paraitre basse).
ORCH_ROUGE_DISPO = float(os.environ.get("ORCH_ROUGE_DISPO") or 5)     # % de RAM disponible
ORCH_ORANGE_DISPO = float(os.environ.get("ORCH_ORANGE_DISPO") or 10)
ORCH_ROUGE_PSI = float(os.environ.get("ORCH_ROUGE_PSI") or 5)         # PSI memoire full avg60
ORCH_ROUGE_PSI_PIC = float(os.environ.get("ORCH_ROUGE_PSI_PIC") or 25)  # full avg10 : coup dur
ORCH_ORANGE_PSI = float(os.environ.get("ORCH_ORANGE_PSI") or 10)      # PSI memoire some avg60
ORCH_ALERTE_DELAI = 600  # rouge depuis 10 min malgre les pauses : une bulle
ORCH_ALERTE = os.environ.get("ORCH_ALERTE") or "node /home/mariella/bcc/hook/repondre.ts --ton probleme"
ORCH_JAMAIS = {"systemd", "sshd", "cloudflared", "dockerd", "containerd", "earlyoom"}
# Portier des reveils, menage d'urgence, apprentissage (d237, panne du 12/11 22h : deux piles
# supabase de 1,5 a 2 Go reveillees par la respiration sans que l'orchestre soit consulte)
ORCH_COUT_DEFAUT = float(os.environ.get("ORCH_COUT_DEFAUT") or 1.5 * 2**30)  # octets d'un reveil inconnu
ORCH_COUT_PLANCHER = 200 * 2**20
ORCH_APPRENDRE = 180         # delai avant de mesurer le cout reel d'un reveil
ORCH_DEMANDE_AGE = 7200      # une demande de reveil plus vieille est oubliee
ORCH_URGENCE_CALME = int(os.environ.get("ORCH_URGENCE_CALME") or 600)  # sans battement depuis : pile endormable
ORCH_ECRANS = re.compile(r"studio|pg_meta|-meta-?1?$|supabase-meta|analytics|vector|imgproxy")
ORCH_NOM_DOCKER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
ORCH_ORANGE_PLAFOND = 20.0
ORCH_INSTANTANE = 60         # periode des instantanes de memoire
ORCH_FENETRE_CAUSES = 600    # les causes se cherchent sur les 10 dernieres minutes
RANGS = ("humain", "agent", "fond")
# relais bcc d'un message ou d'un appel de Mariella : c'est elle qui parle
ORCH_RELAIS_HUMAIN = re.compile(r"Mariella (t'a ecrit|a repondu)|\[appel \d+")


def orch_ecrire(chemin, obj):
    tmp = f"{chemin}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, chemin)


def orch_lire(chemin, defaut=None):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return defaut


def orch_etat_frais():
    """etat.json s'il a moins de ORCH_FRAIS secondes, sinon None (orchestre muet)."""
    e = orch_lire(os.path.join(ORCH_DIR, "etat.json"))
    if isinstance(e, dict) and time.time() - e.get("ts", 0) <= ORCH_FRAIS:
        return e
    return None


def orch_stat(pid):
    """(comm, ppid) depuis /proc/<pid>/stat, ou None."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            s = f.read().decode(errors="replace")
        return s[s.index("(") + 1:s.rindex(")")], int(s.rsplit(")", 1)[1].split()[1])
    except (OSError, ValueError, IndexError):
        return None


def orch_zombie(pid):
    """Une session finie mais pas encore ramassee par son pere garde son nom : elle est morte."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            return f.read().decode(errors="replace").rsplit(")", 1)[1].split()[0] in ("Z", "X")
    except (OSError, IndexError):
        return True


def orch_pid_session():
    """Le processus claude (ou codex) qui a lance ce hook : son premier ancetre de ce nom."""
    pid = os.getppid()
    for _ in range(8):
        st = orch_stat(pid)
        if not st:
            return None
        if st[0] in ("claude", "codex"):
            return pid
        pid = st[1]
        if pid <= 1:
            return None
    return None


def orch_terminal(pid):
    try:
        return os.readlink(f"/proc/{pid}/fd/0").startswith("/dev/pts/")
    except OSError:
        return False


def orch_inscrire(data, prompt=None):
    """Registre des sessions : une fiche par session_id, rafraichie a chaque hook.
    prompt (UserPromptSubmit) : venu d'un terminal ou relaye de Mariella par bcc = humain.
    Rend le session_id, ou None (orchestre non installe, entree sans session)."""
    try:
        if not os.path.isdir(ORCH_DIR):
            return None
        sid = re.sub(r"[^A-Za-z0-9_-]", "", str(data.get("session_id") or ""))[:80]
        if not sid:
            return None
        dossier = os.path.join(ORCH_DIR, "sessions")
        os.makedirs(dossier, exist_ok=True)
        if not os.access(dossier, os.W_OK):   # service pas encore relance en 1777 (b41)
            return None
        chemin = os.path.join(dossier, sid + ".json")
        fiche = orch_lire(chemin, {}) or {}
        pid = orch_pid_session() or fiche.get("pid")
        maintenant = time.time()
        terminal = orch_terminal(pid) if pid else False
        fiche.update(sid=sid, pid=pid, terminal=terminal, vu=maintenant,
                     projet=os.path.basename(os.environ.get("CLAUDE_PROJECT_DIR")
                                             or data.get("cwd") or ROOT))
        fiche.setdefault("debut", maintenant)
        if prompt is not None and (terminal or ORCH_RELAIS_HUMAIN.search(prompt)):
            fiche["humain"] = maintenant
        orch_ecrire(chemin, fiche)
        return sid
    except Exception as e:
        trace("orchestre : inscription", e)
        return None


def orch_rang(fiche, maintenant):
    h = fiche.get("humain")
    if h and maintenant - h < ORCH_HUMAIN:
        return "humain"
    if h and maintenant - h < ORCH_FOND:
        return "agent"
    return "fond"


def orch_attendre(sid, retenu):
    """Fait patienter le hook tant que retenu(etat) est vrai, au plus ORCH_ATTENTE.
    Rend la duree d'attente (s) et si la session est toujours retenue."""
    if not sid:
        return 0, False
    debut = time.time()
    while True:
        e = orch_etat_frais()
        if not e or not retenu(e):
            return time.time() - debut, False
        if time.time() - debut >= ORCH_ATTENTE:
            return time.time() - debut, True
        time.sleep(float(os.environ.get("ORCH_SOMME") or 5))


def orch_mesure():
    with open(os.path.join(ORCH_PROC, "meminfo"), encoding="utf-8") as f:
        mi = {l.split(":")[0]: int(l.split()[1]) * 1024 for l in f if ":" in l and len(l.split()) > 1}
    total = mi.get("MemTotal") or 1
    m = {"total": total, "dispo_o": mi.get("MemAvailable", 0),
         "dispo": round(100 * mi.get("MemAvailable", 0) / total, 1)}
    st = mi.get("SwapTotal", 0)
    m["swap"] = round(100 * (st - mi.get("SwapFree", 0)) / st, 1) if st else 0.0
    for res in ("memory", "cpu"):
        try:
            with open(os.path.join(ORCH_PROC, "pressure", res), encoding="utf-8") as f:
                for l in f:
                    k, *kv = l.split()
                    v = dict(x.split("=", 1) for x in kv)
                    m[f"psi_{res}_{k}"] = float(v.get("avg10", 0))
                    m[f"psi_{res}_{k}_60"] = float(v.get("avg60", 0))
        except (OSError, ValueError):
            pass
    return m


def orch_niveau(m):
    if (m["dispo"] < ORCH_ROUGE_DISPO or m.get("psi_memory_full_60", 0) > ORCH_ROUGE_PSI
            or m.get("psi_memory_full", 0) > ORCH_ROUGE_PSI_PIC):
        return "rouge"
    if m["dispo"] < orch_orange() or m.get("psi_memory_some_60", 0) > ORCH_ORANGE_PSI:
        return "orange"
    return "vert"


def orch_arbre():
    """(enfants par pid, rss par pid) de tout /proc, lu une seule fois par tour."""
    enfants, rss = {}, {}
    page = os.sysconf("SC_PAGE_SIZE")
    for p in filter(str.isdigit, os.listdir("/proc")):
        st = orch_stat(p)
        if not st:
            continue
        enfants.setdefault(st[1], []).append(int(p))
        try:
            with open(f"/proc/{p}/statm") as f:
                rss[int(p)] = int(f.read().split()[1]) * page
        except (OSError, ValueError, IndexError):
            pass
    return enfants, rss


def orch_descendants(pid, enfants):
    vus, pile = [], [pid]
    while pile:
        for c in enfants.get(pile.pop(), []):
            if c not in vus:
                vus.append(c)
                pile.append(c)
    return vus


def orch_geler(pid, enfants):
    """SIGSTOP des commandes en cours de la session (sous-arbres dont la cmdline porte
    shell-snapshots, comme commande_en_cours). Jamais la session elle-meme ni ses hooks,
    jamais un processus systeme de ORCH_JAMAIS. Rend les pids geles."""
    geles = []
    for p in orch_gelables(pid, enfants):
        try:
            os.kill(p, signal.SIGSTOP)
            geles.append(p)
        except OSError:
            pass
    return geles


def orch_gelables(pid, enfants):
    """Les pids que orch_geler gelerait, sans rien geler (pour ne pas pauser a vide)."""
    geles = []
    for d in orch_descendants(pid, enfants):
        try:
            with open(f"/proc/{d}/cmdline", "rb") as f:
                if b"shell-snapshots" not in f.read():
                    continue
        except OSError:
            continue
        for p in [d] + orch_descendants(d, enfants):
            st = orch_stat(p)
            if p in geles or not st or st[0] in ORCH_JAMAIS:
                continue
            geles.append(p)
    return geles


def orch_degeler(pids):
    for p in pids:
        try:
            os.kill(p, signal.SIGCONT)
        except OSError:
            pass


def orch_journal(texte):
    try:
        with open(os.path.join(ORCH_DIR, "journal.log"), "a", encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} {texte}\n")
    except OSError:
        pass


def orch_estimation(projet):
    """Ce qu'une session de ce projet consomme d'habitude : 1,2 x mediane des 10
    derniers pics (meme regle que kvm-lourd). 0 si on ne sait pas encore."""
    pics = []
    try:
        with open(os.path.join(ORCH_DIR, "historique.jsonl"), encoding="utf-8") as f:
            for l in f:
                try:
                    h = json.loads(l)
                except ValueError:
                    continue
                if h.get("projet") == projet and h.get("pic"):
                    pics.append(h["pic"])
    except OSError:
        return 0
    pics = sorted(pics[-10:])
    return int(1.2 * pics[len(pics) // 2]) if pics else 0


def orch_meme_compte(chemin, pid):
    """Le dossier des fiches est ouvert a tous (1777) : une fiche n'est crue que si son
    proprietaire est root ou le compte du processus qu'elle designe."""
    try:
        proprio = os.stat(chemin).st_uid
        if proprio == 0:
            return True
        with open(f"/proc/{int(pid)}/status", encoding="utf-8") as f:
            for ligne in f:
                if ligne.startswith("Uid:"):
                    return int(ligne.split()[1]) == proprio
    except (OSError, ValueError, TypeError):
        pass
    return False


def orch_sessions(maintenant, enfants, rss, etat):
    """Fiches des sessions vivantes, avec rang et poids (RSS de tout l'arbre). Une
    session finie est retiree et son pic entre dans l'historique (apprentissage)."""
    vivantes = {}
    dossier = os.path.join(ORCH_DIR, "sessions")
    connues = etat.get("sessions", {})
    for nom in (os.listdir(dossier) if os.path.isdir(dossier) else []):
        if not nom.endswith(".json"):
            continue
        chemin = os.path.join(dossier, nom)
        fiche = orch_lire(chemin)
        pid = (fiche or {}).get("pid")
        st = orch_stat(pid) if pid else None
        if not fiche or not st or st[0] not in ("claude", "codex") or orch_zombie(pid) \
                or maintenant - fiche.get("vu", 0) > 86400:
            k = connues.get((fiche or {}).get("sid"))
            if k and k.get("pic"):
                with open(os.path.join(ORCH_DIR, "historique.jsonl"), "a", encoding="utf-8") as f:
                    f.write(json.dumps({"projet": k.get("projet"), "pic": k["pic"],
                                        "duree": int(maintenant - (fiche or {}).get("debut", maintenant)),
                                        "fin": int(maintenant)}) + "\n")
            try:
                os.remove(chemin)
            except OSError:
                pass
            continue
        if not orch_meme_compte(chemin, pid):   # une fiche ne gele que son propre compte (b41)
            continue
        poids = rss.get(pid, 0) + sum(rss.get(d, 0) for d in orch_descendants(pid, enfants))
        pic = max(poids, (connues.get(fiche["sid"]) or {}).get("pic", 0))
        vivantes[fiche["sid"]] = {"pid": pid, "projet": fiche.get("projet"), "poids": poids,
                                  "pic": pic, "rang": orch_rang(fiche, maintenant)}
    return vivantes


def orch_alerter(texte):
    try:
        subprocess.Popen(shlex.split(ORCH_ALERTE) + [texte], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    except OSError as e:
        trace("orchestre : alerte", e)


def orch_reprendre(etat, sid, motif):
    p = etat["pauses"].pop(sid, None)
    if p:
        orch_degeler(p.get("geles", []))
        orch_journal(f"reprise {sid[:8]} ({p.get('projet')}) apres "
                     f"{int(time.time() - p['ts'])} s — {motif}")


# Taches planifiees (d222, Mariella 09/11) : le cron de la machine relancait chaque minute 17
# « wrangler kv put » sans que rien ne le voie (l'orchestre ne regardait que les sessions et
# la memoire). On compte le processeur cumule de leur groupe systemd ; au-dela du seuil sur la
# fenetre, elles passent apres le reste (CPUWeight bas, rien n'est arrete) et Mariella recoit
# le nom de la ligne fautive. Le frein se leve quand la conso retombe sous la moitie du seuil.
ORCH_CGROUP = os.environ.get("PLANTRACK_CGROUP") or "/sys/fs/cgroup/system.slice"
ORCH_TACHES = tuple((os.environ.get("ORCH_TACHES") or "cron.service").split())
ORCH_TACHES_SEUIL = float(os.environ.get("ORCH_TACHES_SEUIL") or 30)    # % d'un processeur
ORCH_TACHES_FENETRE = int(os.environ.get("ORCH_TACHES_FENETRE") or 600)
ORCH_TACHES_POIDS = 10   # CPUWeight du frein (100 = normal) : elles prennent ce qui reste
# Controles de sante docker (d232, pg32) : leurs « docker exec » toutes les 5-10 s sont comptes
# dans containerd/dockerd, pas dans le groupe du conteneur. On les regarde (journal + alerte),
# sans jamais les freiner : un frein sur dockerd ralentirait tous les sites.
ORCH_SANTE = tuple((os.environ.get("ORCH_SANTE_UNITES")
                    or "containerd.service docker.service").split())
ORCH_SANTE_SEUIL = float(os.environ.get("ORCH_SANTE_SEUIL") or 15)   # % d'un processeur, cumule
ORCH_TICK = os.sysconf("SC_CLK_TCK")


ORCH_SECRET_OPT = re.compile(r"(--?[\w-]*(?:token|key|pass|secret|auth)[\w-]*[ =])\S+", re.I)


def orch_masquer(cmd):
    """Etiquette d'une ligne de commande, sure pour un journal ou une bulle : caracteres de
    controle retires, valeurs d'affectation (X=...), d'options sensibles et longues chaines
    (clefs probables) masquees, 120 caracteres au plus."""
    cmd = "".join(c if c.isprintable() else " " for c in cmd)
    cmd = re.sub(r"\b([A-Za-z_][A-Za-z0-9_]*)=\S+", r"\1=***", cmd)
    cmd = ORCH_SECRET_OPT.sub(r"\1***", cmd)
    cmd = re.sub(r"[A-Za-z0-9+_-]{24,}", "***", cmd)
    return cmd[:120]


def orch_etiquette(cmd):
    """Nom sur d'une tache : le programme et les scripts lances (nom de fichier seul), jamais
    les arguments, qui peuvent porter une clef (relecture securite d222). Ex. « bash studio.sh »."""
    mots = cmd.split()
    garde = [os.path.basename(m) for i, m in enumerate(mots)
             if (i == 0 or re.fullmatch(r"[\w./-]+\.(sh|mjs|cjs|js|ts|py|rb|pl)", m))
             and "://" not in m and "=" not in m]
    return orch_masquer(" ".join(garde[:4]) or "?")


def orch_tache_pids(unite):
    """{pid: (secondes processeur, etiquette)} des processus du groupe de l'unite. Etiquette =
    ligne de commande de l'ancetre lance directement par le demon (la ligne de crontab)."""
    try:
        with open(os.path.join(ORCH_CGROUP, unite, "cgroup.procs")) as f:
            pids = {int(l) for l in f if l.strip().isdigit()}
    except OSError:
        return {}
    info = {}
    for p in pids:
        try:
            with open(f"/proc/{p}/stat", "rb") as f:
                s = f.read().decode(errors="replace")
            champs = s.rsplit(")", 1)[1].split()
            with open(f"/proc/{p}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\0", b" ").decode(errors="replace").strip()
            # + temps des enfants deja termines (cutime/cstime) : un « wrangler » d'une seconde,
            # lance et fini entre deux tours, reste ainsi impute a la ligne qui l'a lance
            info[p] = (int(champs[1]), sum(int(x) for x in champs[11:15]) / ORCH_TICK, cmd)
        except (OSError, ValueError, IndexError):
            continue
    demon = next((p for p, v in info.items()
                  if os.path.basename(v[2].split(" ")[0]) in ("cron", "crond", "anacron")), None)
    res = {}
    for p, (ppid, sec, cmd) in info.items():
        haut, vus = p, set()
        while info.get(haut, (0,))[0] in info and info[haut][0] != demon and haut not in vus:
            vus.add(haut)
            haut = info[haut][0]
        if p != demon:
            res[p] = (sec, orch_etiquette(info[haut][2] or cmd))
    return res


def orch_taches(etat, maintenant):
    """Surveille et freine les taches planifiees. Modifie etat["taches"]."""
    toutes = etat.setdefault("taches", {})
    try:   # conteneurs (d224, VPN MdjFlight bloques a 120 % chacun) : meme regle, un par un
        scopes = sorted(f for f in os.listdir(ORCH_CGROUP)
                        if f.startswith("docker-") and f.endswith(".scope"))
    except OSError:
        scopes = []
    for u in [u for u in toutes if u.endswith(".scope") and u not in scopes]:
        del toutes[u]   # conteneur disparu : son groupe (et son frein) avec lui
    sante = {}
    for unite in ORCH_TACHES + tuple(scopes) + ORCH_SANTE:
        conteneur = unite.endswith(".scope")
        observe = unite in ORCH_SANTE
        try:
            with open(os.path.join(ORCH_CGROUP, unite, "cpu.stat")) as f:
                usage = int(next(l.split()[1] for l in f if l.startswith("usage_usec"))) / 1e6
        except (OSError, ValueError, StopIteration):
            continue
        t = toutes.setdefault(unite, {})
        hist = t.get("hist", []) + [[maintenant, usage]]
        while len(hist) > 2 and maintenant - hist[1][0] >= ORCH_TACHES_FENETRE:
            hist.pop(0)   # on garde un seul point plus vieux que la fenetre : son repere
        t["hist"] = hist
        pids = {} if conteneur or observe else orch_tache_pids(unite)
        avant = {int(k): v for k, v in t.get("pids", {}).items()}
        parts = [x for x in t.get("parts", []) if maintenant - x[0] <= ORCH_TACHES_FENETRE]
        if "pids" in t:   # premier tour : simple repere, rien n'est compte
            for p, (sec, etiq) in pids.items():
                d = sec - avant.get(p, 0)
                if d > 0:
                    parts.append([maintenant, etiq, round(d, 2)])
        t["pids"] = {str(p): v[0] for p, v in pids.items()}
        t["parts"] = parts
        duree = maintenant - hist[0][0]
        if duree < ORCH_TACHES_FENETRE * 0.9:
            continue
        part = round(100 * max(0.0, usage - hist[0][1]) / duree, 1)
        t["part"] = part
        if observe:
            sante[unite] = part
            continue
        if part > ORCH_TACHES_SEUIL and not t.get("frein"):
            cumul = {}
            for _, etiq, d in parts:
                cumul[etiq] = cumul.get(etiq, 0) + d
            pire = sorted(cumul.items(), key=lambda kv: -kv[1])[:2]
            try:
                systemctl(["set-property", "--runtime", unite, f"CPUWeight={ORCH_TACHES_POIDS}"])
            except (OSError, subprocess.SubprocessError) as e:
                trace("orchestre : frein taches", e)
                continue
            t["frein"] = maintenant
            noms = (f"« {orch_conteneur(unite)} »" if conteneur else
                    " ; ".join(f"« {e} »" for e, _ in pire) or "(non identifiée)")
            orch_journal(f"frein {unite} : {part} % d'un processeur sur "
                         f"{ORCH_TACHES_FENETRE // 60} min — {noms}")
            if maintenant - t.get("alerte", 0) > 6 * 3600:
                t["alerte"] = maintenant
                quoi = (f"Le conteneur {noms} a pris" if conteneur else
                        "Les tâches automatiques de la machine ont pris")
                orch_alerter(f"{quoi} {part} % d'un "
                             f"processeur sur les {ORCH_TACHES_FENETRE // 60} dernières minutes. "
                             + ("Je le fais passer après le reste, il n'est pas arrêté. " if conteneur
                                else "Je les fais passer après le reste, rien n'est arrêté. ")
                             + ("" if conteneur else f"La plus gourmande : {noms}. ")
                             + "À corriger dans son projet.")
        elif t.get("frein") and part < ORCH_TACHES_SEUIL / 2 \
                and maintenant - t["frein"] >= ORCH_TACHES_FENETRE:
            orch_lever_frein(t, unite, f"retombees a {part} %")
    orch_sante(etat, maintenant, sante)


def orch_sante(etat, maintenant, parts):
    """Cout cumule des controles de sante docker : journal et alerte au-dela du seuil, au plus
    une alerte toutes les 6 h. Aucun frein (voir ORCH_SANTE)."""
    s = etat.setdefault("sante", {})
    total = round(sum(parts.values()), 1)
    if not parts:
        return
    s["part"] = total
    if total <= ORCH_SANTE_SEUIL:
        s.pop("haut", None)
        return
    if not s.get("haut"):
        s["haut"] = maintenant
        detail = ", ".join(f"{u.split('.')[0]} {p} %" for u, p in sorted(parts.items()))
        orch_journal(f"controles de sante docker : {total} % d'un processeur sur "
                     f"{ORCH_TACHES_FENETRE // 60} min ({detail}), non freines")
    if maintenant - s.get("alerte", 0) > 6 * 3600:
        s["alerte"] = maintenant
        orch_alerter(f"Les contrôles de santé des conteneurs prennent {total} % d'un processeur "
                     f"sur les {ORCH_TACHES_FENETRE // 60} dernières minutes. Je ne les freine "
                     "pas (ça ralentirait tous les sites) : il faut espacer les contrôles des "
                     "conteneurs concernés.")


def docker(args, code=False):
    """Seul point d'appel a docker, surchargeable par ORCH_DOCKER (tests). Rend stdout, ou le code retour si code."""
    cmd = shlex.split(os.environ.get("ORCH_DOCKER") or "docker") + list(args)
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return p.stdout.strip() if not code else p.returncode


def orch_nom_docker(ident):
    try:
        nom = docker(["inspect", "-f", "{{.Name}}", ident]).lstrip("/")
    except (OSError, subprocess.SubprocessError):
        nom = ""
    return orch_masquer(nom or ident[:12])


def orch_conteneur(unite):
    """Nom lisible du conteneur d'un groupe docker-<id>.scope (repli : debut de l'id)."""
    return orch_nom_docker(unite[len("docker-"):-len(".scope")])


def orch_lever_frein(t, unite, motif):
    try:
        systemctl(["set-property", "--runtime", unite, "CPUWeight=100"])
    except (OSError, subprocess.SubprocessError) as e:
        trace("orchestre : frein taches", e)
        return
    t.pop("frein", None)
    orch_journal(f"frein {unite} leve — {motif}")


def orch_dossier_ouvert(nom):
    """ORCH_DIR/<nom>, en 1777 comme le dossier des sessions (b41) : chaque compte y depose
    ses fichiers, seul leur proprietaire ou root peut les retirer."""
    dossier = os.path.join(ORCH_DIR, nom)
    os.makedirs(dossier, exist_ok=True)
    try:
        os.chmod(dossier, 0o1777)
    except OSError:
        pass
    return dossier


def orch_orange():
    """Seuil orange de memoire disponible (%) en vigueur : la variable d'environnement si
    posee, sinon la valeur apprise (reglages.json), jamais sous la valeur de base."""
    if os.environ.get("ORCH_ORANGE_DISPO"):
        return ORCH_ORANGE_DISPO
    try:
        return max(ORCH_ORANGE_DISPO, min(ORCH_ORANGE_PLAFOND,
                   float((orch_lire(os.path.join(ORCH_DIR, "reglages.json"), {}) or {})["orange_dispo"])))
    except (KeyError, TypeError, ValueError):
        return ORCH_ORANGE_DISPO


def orch_cout(service, couts):
    """Memoire (octets) qu'un reveil de ce service prend d'habitude : appris, sinon defaut."""
    try:
        v = float((couts or {}).get(service))
        return v if v > 0 else ORCH_COUT_DEFAUT
    except (TypeError, ValueError):
        return ORCH_COUT_DEFAUT


def orch_portier(racine, reveil):
    """Appele par battre() avant de reveiller des services. True = reveil DIFFERE : feu pas
    vert, ou pas assez de marge pour le cout appris. Une demande est deposee, c'est
    l'orchestre qui reveillera au retour du calme. Orchestre muet = False (fail-open)."""
    e = orch_etat_frais()
    if e is None:
        return False
    m = e.get("mesure", {})
    couts = orch_lire(os.path.join(ORCH_DIR, "couts.json"), {})
    cout = sum(orch_cout(s, couts) for s in reveil)
    reserve = (m.get("total") or 1) * orch_orange() / 100
    maintenant = time.time()
    if e.get("feu") == "vert" and m.get("dispo_o", 0) - cout >= reserve:
        try:   # trace du reveil accorde : l'orchestre en mesure le cout reel
            dossier = orch_dossier_ouvert("reveils")
            for s in reveil:
                orch_ecrire(os.path.join(dossier, s + ".json"), {"ts": maintenant, "avant": m.get("dispo_o", 0)})
        except OSError:
            pass
        return False
    projet = os.path.basename(os.path.realpath(racine))
    rangs = [f.get("rang") for f in (e.get("sessions") or {}).values() if f.get("projet") == projet]
    rang = min(rangs, key=lambda r: RANGS.index(r) if r in RANGS else 1) if rangs else "agent"
    try:
        dossier = orch_dossier_ouvert("demandes")
        journalise = False
        for s in reveil:
            chemin = os.path.join(dossier, s + ".json")
            deja = orch_lire(chemin)
            if isinstance(deja, dict) and maintenant - float(deja.get("ts", 0)) < ORCH_DEMANDE_AGE:
                continue   # deja demande : on garde la plus ancienne
            try:
                with open(os.path.join(ORCH_DIR, "journal.log"), "a", encoding="utf-8") as f:
                    f.write(f"{datetime.now().isoformat(timespec='seconds')} reveil differe {s} "
                            f"({projet}) : memoire basse\n")
                journalise = True
            except OSError:
                journalise = False
            orch_ecrire(chemin, {"service": s, "projet": projet, "racine": racine, "ts": maintenant,
                                 "rang": rang, "journalise": journalise})
    except (OSError, ValueError):
        return False   # impossible de deposer la demande : on reveille comme avant
    return True


def orch_lire_sur(chemin):
    """(objet, uid du proprietaire) d'un fichier regulier lu sans suivre de lien, sinon (None, None)."""
    try:
        fd = os.open(chemin, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None, None
    try:
        st = os.fstat(fd)
        if st.st_mode & 0o170000 != 0o100000 or st.st_size > 65536:
            return None, None
        with os.fdopen(fd, encoding="utf-8") as f:
            fd = None
            return json.load(f), st.st_uid
    except (OSError, ValueError):
        return None, None
    finally:
        if fd is not None:
            os.close(fd)


def orch_proprio_ok(uid, racine):
    """Le fichier est de root ou du proprietaire du souffle.conf de ce projet."""
    try:
        return uid == 0 or uid == os.stat(souffle_conf(racine)).st_uid
    except OSError:
        return False


def orch_service_du_registre(service, uid=None, racine=None):
    """Le service figure dans le souffle.conf d'un projet du registre (celui donne, s'il y en a un)
    et, si uid est donne, ce fichier appartient a root ou au proprietaire de ce souffle.conf."""
    for r in registered_roots():
        if racine is not None and os.path.realpath(r) != os.path.realpath(str(racine)):
            continue
        if service in souffle(r)[0] and (uid is None or orch_proprio_ok(uid, r)):
            return True
    return False


def orch_ramasser_reveils(etat):
    """Traces deposees par le portier pour un reveil accorde : l'orchestre en mesurera le cout.
    Une trace est non fiable : meme controles qu'une demande, valeurs bornees."""
    dossier = os.path.join(ORCH_DIR, "reveils")
    suivis = etat.setdefault("reveils", {})
    total = (etat.get("mesure") or {}).get("total") or 0
    maintenant = time.time()
    for nom in (os.listdir(dossier) if os.path.isdir(dossier) else []):
        chemin = os.path.join(dossier, nom)
        try:
            d, uid = orch_lire_sur(chemin)
            if os.path.lexists(chemin):
                os.remove(chemin)
            service = nom[:-5]
            if not isinstance(d, dict) or not nom.endswith(".json") or not nom_ok(service) \
                    or not orch_service_du_registre(service, uid):
                continue
            ts, avant = float(d["ts"]), float(d["avant"])
            if not (0 <= maintenant - ts < 600) or not (0 <= avant <= (total or avant)):
                continue
            suivis.setdefault(service, {"ts": ts, "avant": avant})
            etat.setdefault("recents", {})[service] = ts
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            continue


def orch_retirer(chemin):
    try:
        os.remove(chemin)
    except OSError:
        pass


def orch_demandes(etat, maintenant, m, feu):
    """Sert les demandes de reveil deposees par les sessions (non fiables : le nom est
    revalide). Au plus une par tour, si le feu est vert et la marge suffit."""
    dossier = os.path.join(ORCH_DIR, "demandes")
    if not os.path.isdir(dossier):
        return
    couts = orch_lire(os.path.join(ORCH_DIR, "couts.json"), {})
    reserve = (m.get("total") or 1) * orch_orange() / 100
    attente, vus = [], etat.setdefault("demandes_vues", {})
    for nom in os.listdir(dossier):
        chemin = os.path.join(dossier, nom)
        d, uid = orch_lire_sur(chemin)
        try:
            ok = isinstance(d, dict) and nom.endswith(".json") and nom_ok(str(d.get("service"))) \
                and nom == d["service"] + ".json" and maintenant - float(d["ts"]) <= ORCH_DEMANDE_AGE
            # la demande est ecrite par un compte quelconque : projet du registre, service de
            # son souffle.conf, fichier de root ou du proprietaire de ce souffle.conf
            if ok and not orch_service_du_registre(d["service"], uid, d.get("racine")):
                ok = False
                orch_journal(f"demande refusee {nom[:80]} : pas un reveil autorise de ce projet")
        except (KeyError, TypeError, ValueError, OverflowError):
            ok = False
        if not ok:
            try:
                os.remove(chemin)
            except OSError:
                pass
            continue
        d["projet"] = re.sub(r"[^\w.-]", "", str(d.get("projet")))[:60]
        attente.append((chemin, d))
    for s in [s for s in vus if not any(d["service"] == s for _, d in attente)]:
        del vus[s]
    for chemin, d in attente:
        if d["service"] not in vus:
            vus[d["service"]] = maintenant
            if not d.get("journalise"):
                orch_journal(f"reveil differe {d['service']} ({d['projet']}) : memoire basse")
    if feu != "vert":
        return
    attente.sort(key=lambda cd: (RANGS.index(cd[1]["rang"]) if cd[1].get("rang") in RANGS else 1,
                                 float(cd[1]["ts"])))
    for chemin, d in attente:
        s = d["service"]
        if systemctl(["is-active", "--", s]) == "active":
            orch_retirer(chemin)
            continue
        if m.get("dispo_o", 0) - orch_cout(s, couts) < reserve:
            continue
        systemctl(["start", "--no-block", "--", s], detache=True)
        orch_retirer(chemin)
        etat.setdefault("reveils", {})[s] = {"ts": maintenant, "avant": m.get("dispo_o", 0)}
        etat.setdefault("recents", {})[s] = maintenant
        orch_journal(f"reveil accorde {s} ({d['projet']}) apres {int(maintenant - float(d['ts']))} s")
        return


def orch_apprendre(etat, maintenant, m):
    """Cout reel d'un reveil : 180 s apres, memoire perdue depuis le reveil. Moyenne
    glissante dans couts.json (premiere mesure brute, plancher 200 Mio)."""
    suivis = etat.get("reveils") or {}
    for s in [s for s, r in suivis.items() if maintenant - r.get("ts", maintenant) >= ORCH_APPRENDRE]:
        r = suivis.pop(s)
        chemin = os.path.join(ORCH_DIR, "couts.json")
        couts = orch_lire(chemin, {}) or {}
        neuf = max(ORCH_COUT_PLANCHER, max(0, r.get("avant", 0) - m.get("dispo_o", 0)))
        ancien = couts.get(s)
        couts[s] = int(0.5 * ancien + 0.5 * neuf) if isinstance(ancien, (int, float)) and ancien > 0 else int(neuf)
        orch_ecrire(chemin, couts)
        orch_journal(f"cout appris {s} : {couts[s] // 2**20} Mo")
    for s in [s for s, t in (etat.get("recents") or {}).items() if maintenant - t > 1800]:
        del etat["recents"][s]


def orch_geste(etat, texte):
    """Un geste de l'orchestre : consigne dans l'episode de surcharge en cours."""
    ep = etat.get("episode")
    if ep is not None:
        ep.setdefault("gestes", []).append(texte)


def orch_urgence(etat, maintenant):
    """Menage d'urgence (feu orange ou rouge) : UN geste, dans l'ordre, le premier qui
    trouve quelque chose. (a) un ecran d'admin de base docker (arrete, jamais supprime) ;
    (b) la pile de services d'un projet sans session depuis ORCH_URGENCE_CALME. Rend True
    si un geste a eu lieu."""
    try:
        noms = docker(["ps", "--format", "{{.Names}}"]).splitlines()
    except (OSError, subprocess.SubprocessError) as e:
        trace("orchestre : urgence docker", e)
        noms = []
    echecs = {n: t for n, t in (etat.get("echecs_docker") or {}).items() if maintenant - t < 3600}
    etat["echecs_docker"] = echecs
    for nom in (n.strip().lstrip("/") for n in noms):
        if ORCH_NOM_DOCKER.fullmatch(nom) and ORCH_ECRANS.search(nom) and nom not in echecs:
            try:
                rc = docker(["stop", nom], code=True)
            except (OSError, subprocess.SubprocessError):
                rc = 1
            if rc != 0:   # echec : on ne le retente pas pendant 1 h, on passe a l'etape suivante
                echecs[nom] = maintenant
                orch_journal(f"menage d'urgence : docker stop {nom} a echoue, je n'insiste pas pendant 1 h")
                continue
            orch_journal(f"menage d'urgence : ecran d'admin {nom} eteint (docker start {nom} pour le rallumer)")
            orch_geste(etat, f"ecran {nom} eteint")
            return True
    infos = {}
    for racine in registered_roots():
        if not os.path.exists(souffle_conf(racine)):
            continue
        try:
            reveil, garde, actifs, age = souffle_etat(racine, maintenant)
            infos[racine] = (reveil, garde, actifs, age, vivant(racine, maintenant, ORCH_URGENCE_CALME))
        except Exception as e:
            trace(f"orchestre : urgence {racine}", e)
    proteges = {g for (_, garde, _, _, vif) in infos.values() if vif for g in garde}
    for racine, (reveil, garde, actifs, age, vif) in infos.items():
        if vif or any(g in actifs for g in garde):
            continue
        arret = [s for s in reveil if s in actifs and s not in proteges]
        if not arret:
            continue
        for s in arret:
            systemctl(["stop", "--", s])
            projet = os.path.basename(racine)
            minutes = f"{age // 60} min" if age >= 0 else "longtemps"
            orch_journal(f"menage d'urgence : {s} eteint ({projet}, aucune session depuis {minutes} ; "
                         "il se rallume tout seul au prochain travail)")
            orch_geste(etat, f"pile {s} eteinte ({projet})")
        return True
    return False


def orch_instantane(etat, maintenant, sessions, force=False):
    """Instantane leger de la memoire (par projet de session, conteneur docker, service
    reveille recemment), une fois par minute, borne a la fenetre des causes. True si pris."""
    inst = etat.setdefault("instantanes", [])
    if inst and not force and maintenant - inst[-1]["ts"] < ORCH_INSTANTANE:
        return False
    cles = {}
    for f in sessions.values():
        k = "session " + str(f.get("projet"))
        cles[k] = cles.get(k, 0) + f.get("poids", 0)

    def lire(unite):
        try:
            with open(os.path.join(ORCH_CGROUP, unite, "memory.current")) as fh:
                return int(fh.read().strip())
        except (OSError, ValueError):
            return None
    try:
        unites = [u for u in os.listdir(ORCH_CGROUP) if u.startswith("docker-") and u.endswith(".scope")]
    except OSError:
        unites = []
    for u in unites:
        v = lire(u)
        if v is not None:
            cles["docker " + u[len("docker-"):-len(".scope")][:12]] = v
    for s in (etat.get("recents") or {}):
        v = lire(s)
        if v is not None:
            cles["service " + s] = v
    inst.append({"ts": maintenant, "cles": cles})
    etat["instantanes"] = [i for i in inst if maintenant - i["ts"] <= ORCH_FENETRE_CAUSES + ORCH_INSTANTANE]
    return True


def orch_hausses(etat):
    """Les 3 plus fortes hausses de memoire sur la fenetre : [[nom, octets], ...]."""
    inst = etat.get("instantanes") or []
    if not inst:
        return []
    base, fin = (inst[0]["cles"] if len(inst) > 1 else {}), inst[-1]["cles"]
    h = sorted(((k, v - base.get(k, 0)) for k, v in fin.items() if v - base.get(k, 0) > 0),
               key=lambda kv: -kv[1])
    return [[k, v] for k, v in h[:3]]


def orch_nom_cause(nom):
    if nom.startswith("docker "):
        return "docker " + orch_nom_docker(nom[len("docker "):])
    return nom


def orch_regler(maintenant, ep=None):
    """Seuils appris (reglages.json) : un episode sous le rouge fait reagir plus tot (orange
    +2 points, plafond 20) ; 7 jours sans episode, on redescend de 1 (plancher : la base)."""
    if os.environ.get("ORCH_ORANGE_DISPO"):
        return   # la variable d'environnement decide
    chemin = os.path.join(ORCH_DIR, "reglages.json")
    r = orch_lire(chemin, {}) or {}
    actuel = orch_orange()
    if ep is not None:
        r["dernier_episode"] = maintenant
        if ep.get("min_dispo", 100) < max(ORCH_ROUGE_DISPO, 5.0):
            r["orange_dispo"] = min(ORCH_ORANGE_PLAFOND, actuel + 2)
            r["maj"] = maintenant
            orch_journal(f"j'apprends : je reagirai plus tot (orange a {r['orange_dispo']:g} % de memoire libre)")
        orch_ecrire(chemin, r)
    elif actuel > ORCH_ORANGE_DISPO and maintenant - max(r.get("dernier_episode", 0), r.get("maj", 0)) > 7 * 86400:
        r["orange_dispo"] = max(ORCH_ORANGE_DISPO, actuel - 1)
        r["maj"] = maintenant
        orch_journal(f"j'apprends : sept jours calmes, orange redescend a {r['orange_dispo']:g} % de memoire libre")
        orch_ecrire(chemin, r)


def orch_episode(etat, maintenant, feu, m, sessions):
    """Episode de surcharge : ouvert quand le feu quitte le vert, clos (incidents.jsonl) a son
    retour. Jamais de bulle : la veille reste silencieuse, seule l'alerte rouge 10 min existe."""
    ep = etat.get("episode")
    if feu != "vert":
        neuf = ep is None
        if neuf:
            ep = etat["episode"] = {"debut": maintenant, "min_dispo": m["dispo"], "causes": [], "gestes": []}
        ep["min_dispo"] = min(ep.get("min_dispo", m["dispo"]), m["dispo"])
        if orch_instantane(etat, maintenant, sessions, force=neuf) or neuf:
            connues = {k: v for k, v in ep.get("causes", [])}
            for k, v in orch_hausses(etat):
                connues[k] = max(v, connues.get(k, 0))
            ep["causes"] = [[k, v] for k, v in sorted(connues.items(), key=lambda kv: -kv[1])[:3]]
        return
    if ep is None:
        orch_instantane(etat, maintenant, sessions)
        orch_regler(maintenant)
        return
    causes = [[orch_nom_cause(k), v] for k, v in ep.get("causes", [])]
    incident = {"debut": ep["debut"], "fin": maintenant, "min_dispo": ep["min_dispo"],
                "causes": causes, "gestes": ep.get("gestes", [])}
    with open(os.path.join(ORCH_DIR, "incidents.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(incident, ensure_ascii=False) + "\n")
    if causes:
        orch_journal(f"surcharge terminee : cause principale {causes[0][0]} (+{int(causes[0][1]) // 2**20} Mo)")
    else:
        orch_journal("surcharge terminee : cause non identifiee")
    del etat["episode"]
    orch_regler(maintenant, incident)


def orch_tour(etat, maintenant):
    """Un tour du chef d'orchestre. Modifie et rend etat (ecrit par l'appelant)."""
    try:
        orch_taches(etat, maintenant)
    except Exception as e:   # fail-open : jamais au prix du reste du tour
        trace("orchestre : taches", e)
    m = orch_mesure()
    brut = orch_niveau(m)
    if brut == "rouge":
        etat["vu_rouge"] = maintenant
    if brut != "vert":
        etat["vu_orange"] = maintenant
    # le feu monte tout de suite, il ne redescend qu'apres ORCH_CALME sous le seuil
    feu = ("rouge" if brut == "rouge" or maintenant - etat.get("vu_rouge", -1e12) < ORCH_CALME else
           "orange" if brut != "vert" or maintenant - etat.get("vu_orange", -1e12) < ORCH_CALME
           else "vert")
    if feu != etat.get("feu"):
        orch_journal(f"feu {feu} (memoire disponible {m['dispo']} %, swap {m['swap']} %, "
                     f"pression sur 1 min {m.get('psi_memory_some_60', 0)} %)")
        etat["feu_depuis"] = maintenant
        etat.pop("alerte_feu", None)
    etat["feu"], etat["mesure"] = feu, m
    enfants, rss = orch_arbre()
    sessions = orch_sessions(maintenant, enfants, rss, etat)
    for etape, args in ((orch_ramasser_reveils, (etat,)), (orch_apprendre, (etat, maintenant, m)),
                        (orch_demandes, (etat, maintenant, m, feu)),
                        (orch_episode, (etat, maintenant, feu, m, sessions))):
        try:   # fail-open : aucune de ces etapes ne doit coûter le reste du tour
            etape(*args)
        except Exception as e:
            trace(f"orchestre : {etape.__name__}", e)
    pauses = etat.setdefault("pauses", {})
    for sid in list(pauses):
        if sid not in sessions:
            orch_reprendre(etat, sid, "session terminee")
        elif maintenant - pauses[sid]["ts"] > ORCH_PAUSE_MAX:
            orch_reprendre(etat, sid, f"{ORCH_PAUSE_MAX // 60} minutes de pause au plus")
            etat.setdefault("repit", {})[sid] = maintenant  # ne la regele pas aussitot
    repit = {s: t for s, t in etat.get("repit", {}).items() if maintenant - t < ORCH_PAUSE_MAX}
    etat["repit"] = repit
    if maintenant - etat.get("geste", 0) >= ORCH_PAS:
        agi = False
        if feu != "vert":   # menage d'urgence d'abord : la pause des sessions ne vient qu'ensuite
            try:
                agi = orch_urgence(etat, maintenant)
            except Exception as e:
                trace("orchestre : urgence", e)
            if agi:
                etat["geste"] = maintenant
        if agi:
            pass
        elif feu == "rouge":
            cand = [(s, f) for s, f in sessions.items()
                    if s not in pauses and s not in repit and f["rang"] != "humain"]
            # on garde toujours au moins une session au travail : la plus prioritaire,
            # et a rang egal la plus grosse (Mariella, 02/11 : elle laisse la place a
            # celle qui fait le plus gros travail)
            if len(cand) >= 2:
                cand.sort(key=lambda sf: (-RANGS.index(sf[1]["rang"]), sf[1]["poids"]))
                # une pause a vide ne soulage rien : seule compte une session qui a une commande a geler
                for sid, f in cand[:-1]:
                    if not orch_gelables(f["pid"], enfants):
                        continue
                    geles = orch_geler(f["pid"], enfants)
                    if not geles:
                        continue
                    pauses[sid] = {"ts": maintenant, "projet": f["projet"], "rang": f["rang"],
                                   "geles": geles}
                    etat["geste"] = maintenant
                    etat["nb_pauses"] = etat.get("nb_pauses", 0) + 1
                    orch_journal(f"pause {sid[:8]} ({f['projet']}, {f['rang']}, "
                                 f"{f['poids'] // 2**20} Mo), {len(geles)} processus geles")
                    orch_geste(etat, f"pause {sid[:8]} ({f['projet']})")
                    break
        elif feu == "vert" and pauses:
            orch_reprendre(etat, min(pauses, key=lambda s: pauses[s]["ts"]), "le serveur respire")
            etat["geste"] = maintenant
    if feu != "vert" and maintenant - etat.get("menage", 0) > 300:
        etat["menage"] = maintenant   # range tout de suite ce qui ne sert pas (d66, d115)
        if os.path.exists("/etc/systemd/system/menage-serveur.service"):
            try:
                systemctl(["start", "--no-block", "menage-serveur.service"], detache=True)
            except OSError as e:
                trace("orchestre : menage", e)
    if feu == "rouge" and maintenant - etat.get("feu_depuis", maintenant) > ORCH_ALERTE_DELAI \
            and not etat.get("alerte_feu") and maintenant - etat.get("alerte", 0) > 6 * 3600:
        etat["alerte"] = etat["alerte_feu"] = maintenant
        orch_alerter(f"Le serveur sature depuis plus de 10 minutes malgré les pauses : "
                     f"{m['dispo']} % de mémoire libre, {len(pauses)} session(s) en pause. "
                     f"Ce qui consomme le plus : "
                     + ", ".join(f"{f['projet']} ({f['poids'] // 2**20} Mo)" for f in
                                 sorted(sessions.values(), key=lambda f: -f["poids"])[:3]))
    etat["sessions"] = {s: {k: f[k] for k in ("projet", "rang", "poids", "pic")}
                        for s, f in sessions.items()}
    etat["ts"] = maintenant
    return etat


def orch_resume(e):
    """Etat du serveur en mots simples (plantrack orchestre)."""
    if not e:
        return "chef d'orchestre muet : aucune mesure recente (service plantrack-orchestre arrete ?)."
    m = e.get("mesure", {})
    ss = e.get("sessions", {})
    pauses = e.get("pauses", {})
    lignes = [f"feu {e.get('feu')} — memoire disponible {m.get('dispo')} %, swap {m.get('swap')} %, "
              f"pression memoire sur 1 min {m.get('psi_memory_some_60', 0)} %",
              f"sessions : {len(ss)} ("
              + ", ".join(f"{r} {sum(1 for f in ss.values() if f['rang'] == r)}" for r in RANGS)
              + f"), en pause : {len(pauses)}"]
    for unite, t in e.get("taches", {}).items():
        conteneur = unite.endswith(".scope")
        # 55 conteneurs au repos noieraient le resume : seuls ceux qui consomment ou sont freines
        if "part" in t and (not conteneur or t.get("frein") or t["part"] >= ORCH_TACHES_SEUIL / 3):
            quoi = "conteneur" if conteneur else "taches planifiees"
            lignes.append(f"{quoi} ({unite[:30]}) : {t['part']} % d'un processeur sur "
                          f"{ORCH_TACHES_FENETRE // 60} min" + (" (FREINEES)" if t.get("frein") else ""))
    for s, f in sorted(ss.items(), key=lambda sf: -sf[1]["poids"]):
        etat = " — EN PAUSE" if s in pauses else ""
        lignes.append(f"  {s[:8]} {f['projet']} [{f['rang']}] {f['poids'] // 2**20} Mo{etat}")
    return "\n".join(lignes)


def orch_bilan(jours):
    """Ligne du bilan du dimanche (d159) : combien de pauses, et si le garde-fou earlyoom a
    encore du tuer un programme (objectif : zero). None si l'orchestre n'a jamais tourne."""
    try:
        with open(os.path.join(ORCH_DIR, "journal.log"), encoding="utf-8") as f:
            lignes = f.read().splitlines()
    except OSError:
        return None
    depuis = (datetime.now() - timedelta(days=jours)).isoformat(timespec="seconds")
    pauses = sum(1 for l in lignes if l[:19] >= depuis and l[20:].startswith("pause "))
    try:
        p = subprocess.run(["journalctl", "-u", "earlyoom", "--since", f"-{jours}d", "--no-pager", "-q"],
                           capture_output=True, text=True, timeout=30)
        tues = sum(1 for l in p.stdout.splitlines() if "sending sig" in l.lower())
    except (OSError, subprocess.SubprocessError):
        tues = None
    texte = (f"• Charge du serveur : {pauses} mise(s) en pause par le chef d'orchestre"
             if pauses else "• Charge du serveur : aucune session mise en pause")
    if tues is not None:
        texte += (", le garde-fou n'a rien eu a tuer" if not tues else
                  f", mais le garde-fou a du tuer {tues} programme(s)")
    texte += "."
    # surcharges apprises (incidents.jsonl) : combien, cause la plus frequente, reglage en vigueur
    fin_min, causes = time.time() - jours * 86400, {}
    n = 0
    try:
        with open(os.path.join(ORCH_DIR, "incidents.jsonl"), encoding="utf-8") as f:
            for l in f:
                try:
                    i = json.loads(l)
                    if i.get("fin", 0) >= fin_min:
                        n += 1
                        if i.get("causes"):
                            c = i["causes"][0][0]
                            causes[c] = causes.get(c, 0) + 1
                except (ValueError, TypeError, IndexError, AttributeError):
                    continue
    except OSError:
        pass
    quand = "cette semaine" if jours == 7 else f"sur {jours} jours"
    reglage = f"orange a {orch_orange():g} % de memoire libre"
    if n:
        top = max(causes, key=causes.get) if causes else "non identifiee"
        texte += f"\n• {n} surcharge(s) {quand}, cause la plus frequente : {top} ; reglage : {reglage}."
    else:
        texte += f"\n• Aucune surcharge {quand} ; reglage : {reglage}."
    return texte


def cmd_orchestre(args):
    """plantrack orchestre [--boucle | --tour | --tout-reprendre] — sans option : l'etat."""
    chemin = os.path.join(ORCH_DIR, "etat.json")
    if "--boucle" in args or "--tour" in args:
        import fcntl   # Linux seulement : le reste de PlanTrack ne doit pas en dependre
        os.makedirs(os.path.join(ORCH_DIR, "sessions"), exist_ok=True)
        try:   # chaque compte inscrit sa propre fiche, comme /tmp (b41)
            os.chmod(os.path.join(ORCH_DIR, "sessions"), 0o1777)
            orch_dossier_ouvert("demandes")   # idem pour les demandes de reveil et leurs traces
            orch_dossier_ouvert("reveils")
        except OSError:
            pass
        verrou = open(os.path.join(ORCH_DIR, "verrou"), "w")
        try:
            fcntl.flock(verrou, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            sys.exit("[PlanTrack] un chef d'orchestre tourne deja.")
        while True:
            etat = orch_lire(chemin, {}) or {}
            try:
                orch_ecrire(chemin, orch_tour(etat, time.time()))
            except Exception as e:
                trace("orchestre : tour", e)
            if "--tour" in args:
                return
            time.sleep(ORCH_TOUR)
    if "--tout-reprendre" in args:   # arret du service : personne ne reste gele
        etat = orch_lire(chemin, {}) or {}
        for sid in list(etat.get("pauses", {})):
            orch_reprendre(etat, sid, "arret du chef d'orchestre")
        for unite, t in etat.get("taches", {}).items():
            if t.get("frein"):
                orch_lever_frein(t, unite, "arret du chef d'orchestre")
        if os.path.isdir(ORCH_DIR):
            orch_ecrire(chemin, etat)
        return
    print(orch_resume(orch_etat_frais()))


def hook_prompt():
    """UserPromptSubmit. Les commandes '!' sont capturees puis le prompt est
    rejete (exit 2) : l'agent ne les voit jamais, son contexte reste propre."""
    data = read_hook_input()
    battre(journal_root(ROOT))
    prompt = (data.get("prompt") or "").strip()
    sid = orch_inscrire(data, prompt)
    if sid and not prompt.startswith("!"):
        # travail de fond : il ne demarre pas quand le serveur chauffe, ni quand ce qu'il
        # consomme d'habitude ferait passer la memoire sous le seuil orange (anticipation)
        fiche = orch_lire(os.path.join(ORCH_DIR, "sessions", sid + ".json"), {}) or {}
        if orch_rang(fiche, time.time()) == "fond":
            besoin = orch_estimation(fiche.get("projet"))

            def retenu(e):
                m = e.get("mesure", {})
                apres = m.get("dispo_o", 0) - besoin
                return e.get("feu") != "vert" or \
                    (besoin and 100 * apres / (m.get("total") or 1) < orch_orange())
            orch_attendre(sid, retenu)
    if not prompt.startswith("!"):
        sys.exit(0)
    try:
        msg = handle_command(prompt[1:])
    except Exception as e:  # un hook ne doit jamais bloquer une session
        msg = f"[PlanTrack] erreur : {e}"
    print(msg, file=sys.stderr)
    sys.exit(2)


def bash_targets(cmd):
    """Cibles d'ecriture d'une commande Bash (b6), par heuristique : redirections
    (> >>), tee, sed -i. Best effort assume — telemetre, pas garde : mv/cp/touch
    et les cibles calculees ($f) passent au travers ; l'appelant ne retient que
    les chemins qui existent vraiment apres la commande."""
    t = re.findall(r"(?:>>?|\btee\b(?:\s+-\S+)*)\s*([^\s;|&<>()'\"]+)", cmd)
    t += re.findall(r"\bsed\b\s+(?:-\S+\s+)*-i\S*\s+(?:'[^']*'|\"[^\"]*\"|\S+)\s+"
                    r"([^\s;|&<>'\"]+)", cmd)
    return [p for p in t if not p.startswith(("-", "/dev/"))]


def hook_filelog():
    """PostToolUse sur les outils d'ecriture : journalise le(s) fichier(s) touches.
    Codex n'a pas de champ file_path : apply_patch livre le patch entier dans
    tool_input.command, les chemins sont sur les lignes '*** Update File: ...'."""
    data = read_hook_input()
    battre(journal_root(ROOT))
    ti = data.get("tool_input") or {}
    p = ti.get("file_path") or ti.get("path") or ti.get("notebook_path")
    bash = data.get("tool_name") == "Bash"
    if p:
        paths = [p]
    elif bash:  # b6 : sed -i, redirections, heredoc — cibles extraites de la commande
        paths = bash_targets(ti.get("command") or "")
    else:
        paths = re.findall(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$",
                           ti.get("command") or "", re.M)
    if not paths:
        sys.exit(0)
    st = project()
    if not st["active"]:
        sys.exit(0)
    for path in paths:
        if not os.path.isabs(path):  # apply_patch/Bash : chemins relatifs au cwd de session
            path = os.path.join(data.get("cwd") or ROOT, path)
        if bash and not os.path.isfile(path):
            continue  # l'heuristique se prouve sur le disque : une fausse cible n'existe pas
        try:
            path = os.path.relpath(path, ROOT)
        except ValueError:
            pass
        append("file_touched", text=path, thread=st["active"])
    sys.exit(0)


def bash_deny(cwd):
    """Une regle deny Bash(...) ne reconnaitrait plus la commande une fois
    enveloppee dans kvm-lourd : s'il en existe une, on n'enveloppe pas."""
    proj = os.environ.get("CLAUDE_PROJECT_DIR") or cwd or ROOT
    for p in (os.path.expanduser("~/.claude/settings.json"),
              "/etc/claude-code/managed-settings.json",
              os.path.join(proj, ".claude", "settings.json"),
              os.path.join(proj, ".claude", "settings.local.json")):
        try:
            with open(p, encoding="utf-8") as f:
                deny = (json.load(f).get("permissions") or {}).get("deny") or []
        except Exception:
            continue
        if any(str(r).startswith("Bash") for r in deny):
            return True
    return False


def orch_noter(note):
    """Sortie PreToolUse sans reecriture : juste le mot de l'orchestre, s'il y en a un."""
    if note:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                                 "additionalContext": note}}, ensure_ascii=False))


def hook_pretool():
    """PreToolUse (tous les outils) : une session mise en pause par le chef d'orchestre
    attend ici. Sur Bash, une commande lourde (build, gradle...) part dans la
    file kvm-lourd du KVM, en arriere-plan, pour ne plus saturer la RAM a
    plusieurs agents. Toute la logique (quoi est lourd, combien) reste dans
    kvm-lourd ; ici on ne fait que reecrire. Fail-open : kvm-lourd absent, lent
    ou en erreur = la commande passe telle quelle. Jamais de permissionDecision :
    la reecriture ne doit pas faire sauter une demande d'autorisation."""
    note = ""
    try:
        data = read_hook_input()
        battre(journal_root(ROOT))
        # chef d'orchestre (d159) : une session mise en pause attend ici, entre deux etapes
        sid = orch_inscrire(data)
        attendu, encore = orch_attendre(sid, lambda e: sid in e.get("pauses", {}))
        if encore:
            note = ("⏸ Serveur saturé : le chef d'orchestre PlanTrack te garde en pause. "
                    "Continue normalement ; l'attente reprendra à l'étape suivante si besoin.")
        elif attendu >= 5:
            note = (f"⏸ Pause de {int(attendu)} s : le serveur saturait, PlanTrack a laissé "
                    "passer une session prioritaire. Tu reprends là où tu étais.")
        ti = data.get("tool_input") or {}
        cmd = ti.get("command") if data.get("tool_name") in (None, "Bash") else ""
        chemin = shutil.which("kvm-lourd")
        if not cmd or not chemin or bash_deny(data.get("cwd")):
            return orch_noter(note)
        # b17 : kvm-lourd est charge dans CE processus. Lance a part (`kvm-lourd classe`),
        # un second Python demarrait dans un cgroup sature, depassait le delai, et la
        # commande lourde passait hors file pile quand la machine etouffait.
        try:
            spec = importlib.util.spec_from_loader(
                "kvm_lourd", importlib.machinery.SourceFileLoader("kvm_lourd", chemin))
            kl = importlib.util.module_from_spec(spec)
            sys.modules["kvm_lourd"] = kl   # requis par @dataclass
            spec.loader.exec_module(kl)
            cfg = kl.Config.depuis_env()
            try:    # le dossier de l'agent : un `sortie/build.sh` s'y lit (16/10)
                t = kl.classe(cmd, kl.charger_types(cfg.types), data.get("cwd"))
            except TypeError:   # kvm-lourd d'avant le 16/10
                t = kl.classe(cmd, kl.charger_types(cfg.types))
            if not t:
                return orch_noter(note)
            # nom du projet sans `git rev-parse` (projet_par_defaut) : pas de sous-processus
            projet = os.path.basename(os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or ROOT)
            est = kl.estimer(t, projet, kl.lire_historique(cfg.etat / "historique.jsonl"))
        except Exception as e:
            trace("hook-pretool : kvm-lourd classe", e)
            return orch_noter(note)
        type_ = t.nom
        go = f"{est / 2**30:.1f}".replace(".", ",")
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "updatedInput": {**ti, "run_in_background": True,
                             "command": f"kvm-lourd run --qui=agent --type={type_} -- "
                                        f"bash -c {shlex.quote(cmd)}"},
            "additionalContext": (note + "\n" if note else "") + f"⏳ Commande passée par la file kvm-lourd ({type_}, ~{go} Go "
                                 "estimés), en arrière-plan : tu seras notifié à la fin. Ne la "
                                 "relance pas ; `kvm-lourd status` montre la file."}},
            ensure_ascii=False))
    except Exception as e:
        trace("hook-pretool", e)
        orch_noter(note)


def note_injection():
    """Un hook declare mais jamais approuve (Codex : /hooks) est indiscernable
    d'un hook qui tourne. Cette trace, par agent, rend la difference visible."""
    who = next(("codex" if e.startswith("CODEX") else "claude"
                for e in AGENT_ENV if os.environ.get(e)), "autre")
    try:
        d = json.load(open(INJECTIONS, encoding="utf-8")) if os.path.exists(INJECTIONS) else {}
        d[who] = now()
        os.makedirs(PT_DIR, exist_ok=True)
        with open(INJECTIONS, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=1, sort_keys=True)
    except (OSError, ValueError) as e:
        trace("note_injection", e)


def hook_context():
    """SessionStart. stdout est injecte comme contexte visible par l'agent."""
    data = read_hook_input()
    note_injection()
    lancer_ronde()
    if battre(journal_root(ROOT)):
        print("(pile en cours de reveil : une commande qui interroge la base dans la minute peut echouer une fois)")
    src = data.get("source", "startup")
    st = project()
    if not any([st["threads"], st["bugs"], st["decisions"], st["inbox"],
                st["phases"], st["tasks"], st["pieges"], st["questions"], st["guides"]]):
        sys.exit(0)
    if src == "compact":
        print("(contexte compacte — etat du projet reinjecte depuis PlanTrack)")
    # le diagnostic sort AVANT le bloc et hors de son budget : c'est la seule
    # facon qu'une panne d'installation se voie sans que personne ait pense a
    # lancer `plantrack doctor`. Il n'est jamais bloquant.
    try:
        ko = [lab for good, lab, _ in diagnose(st) if good is False]
    except Exception as e:  # un diagnostic casse ne doit pas priver l'agent de son etat
        trace("diagnose (hook-context)", e)
        ko = []
    if ko:
        print(f"\n!! PLANTRACK EN DEFAUT ({len(ko)}) — signale-le a l'humain et lance "
              f"`plantrack doctor` : {' ; '.join(ko[:3])}"
              + (f" ; +{len(ko) - 3} autre(s)" if len(ko) > 3 else ""))
    print(context_block(st, full=False))
    sys.exit(0)


def lancer_ronde():
    """d51 : chaque projet fait sa propre ronde, a l'ouverture, au plus toutes les 4 h.
    Detachee : l'agent n'attend pas le reseau. Jamais dans un bac a sable (/tmp)."""
    try:
        if os.path.realpath(ROOT).startswith(os.path.realpath(tempfile.gettempdir()) + os.sep):
            return
        if os.path.exists(RONDE) and time.time() - os.path.getmtime(RONDE) < RONDE_PERIODE:
            return
        os.makedirs(PT_DIR, exist_ok=True)
        with open(RONDE, "a", encoding="utf-8") as log:
            log.write(f"{datetime.now().isoformat(timespec='seconds')} ronde lancee\n")
            subprocess.Popen([sys.executable, os.path.abspath(__file__), "ronde"], cwd=ROOT,
                             stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
                             env=dict(os.environ, PLANTRACK_ROOT=ROOT, CLAUDE_PROJECT_DIR=ROOT))
    except OSError as e:
        trace("lancer_ronde", e)


COMMIT_RONDE = "chore(plantrack): coeur mis a jour par la ronde"


def cmd_ronde():
    """Remet le coeur du projet a niveau depuis PyPI (`uvx plantrack@latest update`) et
    commite uniquement les fichiers que l'update a touches — jamais le travail en cours.
    Le diagnostic, lui, est deja affiche a chaque ouverture (hook-context)."""
    def sales():
        git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True,
                                         check=True).stdout.split()
        try:
            return set(git("ls-files", "-m", "-o", "--exclude-standard")) | set(
                git("diff", "--cached", "--name-only", "--relative"))
        except (OSError, subprocess.CalledProcessError):
            return None
    pyproject = os.path.join(ROOT, "pyproject.toml")
    if os.path.exists(pyproject) and 'name = "plantrack"' in open(pyproject, encoding="utf-8").read():
        return print("ronde : depot source de PlanTrack, pas de mise a jour depuis PyPI")
    avant = sales()
    if avant is None:
        return print("ronde : pas de git exploitable")
    # un pt.py jamais commite (.claude non suivi, Myview) n'est pas modifie a la main :
    # seul un pt.py SUIVI et modifie l'est
    suivi = subprocess.run(["git", "ls-files", "--error-unmatch", ".claude/hooks/pt.py"], cwd=ROOT,
                           capture_output=True).returncode == 0
    # un pt.py suivi et modifie n'est remplace que s'il est une version publiee intacte :
    # vieille mise a jour jamais commitee (b16/b20) ; update --si-publie refuse une retouche
    si_publie = suivi and ".claude/hooks/pt.py" in avant
    if si_publie:
        avant.discard(".claude/hooks/pt.py")
    # --refresh-package : sans lui, uv peut resservir une version en cache, plus vieille que
    # la derniere publiee (b24 : v1.9.28 sans protection du guide, 28/10 19h25)
    try:
        p = subprocess.run(["uvx", "--refresh-package", "plantrack", "plantrack@latest", "update", *(["--si-publie"] if si_publie else [])],
                           cwd=ROOT, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as e:
        return print(f"ronde : update impossible ({e})")
    if p.returncode:
        return print(f"ronde : update en echec : {p.stderr.strip()[-300:]}")
    nouveaux = sorted((sales() or set()) - avant)
    if not nouveaux:
        return print("ronde : coeur deja a jour")
    git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True)
    if git("add", "--", *nouveaux).returncode or git(
            "commit", "-q", "-m", COMMIT_RONDE, "--", *nouveaux).returncode:
        git("reset", "-q", "--", *nouveaux)
        return print(f"ronde : coeur mis a jour, commit refuse : {' '.join(nouveaux)}")
    print(f"ronde : coeur mis a jour et commite ({len(nouveaux)} fichier(s))")


def hook_commit():
    """post-commit git (sha/sujet passes en argv par le hook shell) : journalise
    {type, sha, fil actif}. Sans fil actif, il en ouvre un d'office au nom de la
    branche : un commit perdu ne se rattrape pas, un fil mal nomme se renomme.
    Jamais bloquant."""
    st = project()
    if len(sys.argv) < 4:
        sys.exit(0)
    sha, subject = sys.argv[2], sys.argv[3]
    tid = st["active"]
    if not tid and len(open_threads(st)) < MAX_OPEN_THREADS:
        tid = next_id("t")
        append("thread_open", id=tid, text=f"travaux sur {branch()}", auto=1)
    m = re.match(r"^([a-zA-Z]+)(\(.+\))?!?:", subject)
    # tid peut rester None : le plafond de fils interdit d'en OUVRIR un de plus,
    # jamais de perdre le commit. Un commit sans fil est journalise quand meme et
    # le doctor le reclame — sortir en silence, c'est ce qui a coute 69 commits
    # sur bcc sans que rien ne le signale.
    # l'instantane AGENTS.md est regenere en sortie par l'atexit d'append (b9)
    append("commit", sha=sha, ctype=m.group(1).lower() if m else "commit", thread=tid)
    sys.exit(0)


def hook_precompact():
    """PreCompact. stdout n'est PAS injecte ici : on archive le transcript,
    seule facon de retrouver une nuance discutee mais jamais enregistree."""
    data = read_hook_input()
    tp = data.get("transcript_path")
    if tp and os.path.exists(tp):
        os.makedirs(ARCHIVE, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        try:
            shutil.copy(tp, os.path.join(ARCHIVE, f"{stamp}-{os.path.basename(tp)}"))
            for old in sorted(os.listdir(ARCHIVE))[:-MAX_ARCHIVES]:
                os.unlink(os.path.join(ARCHIVE, old))
        except OSError as e:
            trace("archive du transcript", e)
    sys.exit(0)


# ---------------------------------------------------------------------- CLI

# CODEX_THREAD_ID/CODEX_SANDBOX : poses par le shell tool de Codex (source :
# codex-rs/protocol/src/shell_environment.rs), non documentes — a re-verifier
# lors de la validation sur un projet reel repris depuis Codex.
AGENT_ENV = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CODEX_THREAD_ID", "CODEX_SANDBOX")


# les deux CALL sont ce qui est greffe sur le hook d'un autre outil : ils doivent
# tenir seuls, sans shebang ni `exec` qui priverait l'occupant de son tour
# le test de presence n'est pas cosmetique : greffe chez un autre outil, un pt.py
# absent ferait echouer la ligne et bloquerait TOUS les commits du depot
GIT_HOOK_CALL = "if [ -f .claude/hooks/pt.py ]; then python3 .claude/hooks/pt.py precommit || exit 1; fi\n"
GIT_HOOK = "#!/bin/sh\n# installe par plantrack init --git-hook\n" + GIT_HOOK_CALL

GIT_HOOK_POST_CALL = ('[ -f .claude/hooks/pt.py ] && python3 .claude/hooks/pt.py hook-commit '
                      '"$(git rev-parse --short HEAD)" "$(git log -1 --pretty=%s)"\n')
GIT_HOOK_POST = ("#!/bin/sh\n# installe d'office par plantrack init (journalisation, jamais bloquant)\n"
                 + GIT_HOOK_POST_CALL + "exit 0\n")

WRAPPER = '#!/bin/sh\nexec python3 "$(dirname "$0")/.claude/hooks/pt.py" "$@"\n'

SETTINGS = {"hooks": {
    "UserPromptSubmit": [{"hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-prompt",
         "timeout": 600}]}],
    "PostToolUse": [{"matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash", "hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-filelog"}]}],
    # tous les outils : une session mise en pause par le chef d'orchestre attend ici (d159) ;
    # 600 s couvre ORCH_ATTENTE (540 s)
    "PreToolUse": [{"matcher": "*", "hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-pretool",
         "timeout": 600}]}],
    "SessionStart": [{"hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-context"}]}],
    "PreCompact": [{"hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-precompact"}]}],
}}


def _codex_cmd(entry):
    # les hooks Codex tournent dans le cwd de session (parfois un sous-repertoire)
    # sans variable d'environnement projet : la racine se resout dans la commande.
    # jamais de repli sur le cwd (b22) : hors d'un depot equipe, on ne lance rien
    return ('r="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -f "$r/.codex/hooks.json" ] '
            '&& [ -f "$r/.claude/hooks/pt.py" ] || exit 0; '
            f'PLANTRACK_ROOT="$r" exec python3 "$r/.claude/hooks/pt.py" {entry}')


CODEX_HOOKS = {"description": "PlanTrack — traduction Codex des 4 hooks (§13).", "hooks": {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": _codex_cmd("hook-prompt")}]}],
    "PostToolUse": [{"matcher": "apply_patch|Edit|Write", "hooks": [
        {"type": "command", "command": _codex_cmd("hook-filelog")}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": _codex_cmd("hook-context")}]}],
    "PreCompact": [{"hooks": [{"type": "command", "command": _codex_cmd("hook-precompact")}]}],
}}

MD_START, MD_END = "<!-- plantrack:start -->", "<!-- plantrack:end -->"
STATE_START, STATE_END = "<!-- plantrack:state -->", "<!-- plantrack:state-end -->"
MD_BLOCK = MD_START + "\n## PlanTrack\n" + RULES + MD_END + "\n"

# CLAUDE.md et GEMINI.md n'ont qu'une ligne d'import : le bloc complet vit dans
# AGENTS.md (standard cross-agents), source unique — Claude Code et Gemini CLI
# savent tous deux importer un fichier via `@chemin`.
REF_BLOCK = """<!-- plantrack:start -->
@AGENTS.md
<!-- plantrack:end -->
"""

# Deep Code (CLI tiers DeepSeek) ne lit pas AGENTS.md mais des skills format
# Claude Code (./.deepcode/skills/<nom>/SKILL.md) — simple renvoi vers AGENTS.md.
DEEPCODE_SKILL = """---
name: plantrack
description: État persistant du projet (fils de travail, décisions actées, bugs) — consignes à lire avant toute tâche.
---

**Important : lis le bloc « PlanTrack » du fichier `AGENTS.md` à la racine du projet et applique ses consignes.** C'est la source unique des règles PlanTrack.

Particularité ici (pas de hooks, donc pas d'injection automatique) : l'état persistant du projet est écrit **dans `AGENTS.md` même**, entre les marqueurs `plantrack:state` — il est rafraîchi à chaque commit, quel que soit l'agent. Lis-le. Pour la version à la seconde près (ou après une compaction du contexte), lance `./plantrack status`.
"""


def write_owned_file(path, content, label):
    """Ecrit un fichier entierement genere par PlanTrack (remplacable sans risque)."""
    existing = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            existing = f.read()
    if existing == content:
        print(f"{label} deja en place.")
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"{label} {'mis a jour' if existing is not None else 'ecrit'}.")


def write_md_block(name, block, start=MD_START, end=MD_END,
                   label="bloc d'instructions", quiet=False):
    """Insere le bloc entre marqueurs dans ROOT/name (cree le fichier au besoin) ;
    si les marqueurs existent deja, remplace leur contenu (mise a niveau)."""
    path = os.path.join(ROOT, name)
    existing = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            existing = f.read()
    if start in existing and end in existing.split(start, 1)[1]:
        pre, rest = existing.split(start, 1)
        updated = pre + block.strip("\n") + rest.split(end, 1)[1]
        if updated == existing:
            if not quiet:
                print(f"{label} a jour dans {name}.")
            return
        with open(path, "w", encoding="utf-8") as f:
            f.write(updated)
        if not quiet:
            print(f"{label} mis a jour dans {name}.")
    else:
        with open(path, "a", encoding="utf-8") as f:
            f.write(("\n" if existing and not existing.endswith("\n") else "") + block)
        if not quiet:
            print(f"{label} insere dans {name}.")


def write_state_block(st, quiet=True):
    """Fiche complete de l'etat dans AGENTS.md (d6) : c'est ELLE que le resume de
    session renvoie lire, et le seul canal qu'un agent sans hooks (Deep Code) lit
    de toute facon. Regeneree a chaque ecriture au journal (b9) et au post-commit
    git : peu importe quel agent a ecrit, l'etat suit."""
    body = (f"{STATE_START}\n<!-- genere par plantrack a chaque commit — ne pas editer a la main -->\n"
            f"```\n{context_block(st, header=False, rules=False)}\n```\n{STATE_END}\n")
    for r in copies_du_carnet():
        if os.path.exists(os.path.join(r, "AGENTS.md")):
            write_md_block(os.path.join(r, "AGENTS.md"), body, STATE_START, STATE_END,
                           "instantane de l'etat", quiet)


def copies_du_carnet():
    """ROOT et toutes les copies `git worktree` qui partagent son carnet (b14) : la
    fiche de chacune suit l'etat, quelle que soit la copie qui a ecrit."""
    main = journal_root(ROOT)
    copies = {os.path.realpath(ROOT), os.path.realpath(main)}
    wt = os.path.join(main, ".git", "worktrees")
    if main != ROOT or os.path.isdir(os.path.join(main, ".plantrack")):
        for n in (os.listdir(wt) if os.path.isdir(wt) else []):
            try:
                g = open(os.path.join(wt, n, "gitdir"), encoding="utf-8").read().strip()
            except OSError:
                continue
            copies.add(os.path.realpath(os.path.dirname(g)))
    return sorted(copies)


def chain_hook(hook, script, call, label, marker):
    """Pose un hook git, ou GREFFE l'appel PlanTrack sur celui d'un autre outil.
    Renoncer parce que la place est prise laisse le garde-fou eteint pour de bon
    (cas de bcc, ou lefthook occupait pre-commit depuis l'installation) : la
    greffe s'insere juste apres le shebang, pour passer avant un `exit` de
    l'occupant. Un outil qui regenere son hook l'efface — le diagnostic le voit."""
    if not os.path.exists(hook):
        os.makedirs(os.path.dirname(hook), exist_ok=True)
        with open(hook, "w", encoding="utf-8") as f:
            f.write(script)
        os.chmod(hook, 0o755)
        print(f"hook {label} installe.")
        return
    with open(hook, encoding="utf-8") as f:
        cur = f.read()
    # on cherche le MARQUEUR, pas la ligne exacte : une version anterieure de
    # l'appel doit compter comme deja en place, sinon la greffe se redouble
    if marker in cur:
        print(f"hook {label} deja en place.")
        return
    lines = cur.splitlines(keepends=True)
    at = 1 if lines and lines[0].startswith("#!") else 0
    lines.insert(at, f"\n# greffe plantrack — a passer avant l'outil qui occupe ce hook\n{call}")
    with open(hook, "w", encoding="utf-8") as f:
        f.write("".join(lines))
    os.chmod(hook, 0o755)
    print(f"hook {label} : appel PlanTrack greffe sur le hook existant.")


def install_git_hook():
    if not git_hooks_dir():
        sys.exit("[PlanTrack] pas de depot git ici — lance `git init` d'abord.")
    chain_hook(os.path.join(git_hooks_dir(), "pre-commit"),
               GIT_HOOK, GIT_HOOK_CALL, "pre-commit", "pt.py precommit")


def install_post_commit_hook():
    """Post-commit journalisant, installe d'office (comme le pre-commit)."""
    if not git_hooks_dir():
        return
    chain_hook(os.path.join(git_hooks_dir(), "post-commit"),
               GIT_HOOK_POST, GIT_HOOK_POST_CALL, "post-commit", "pt.py hook-commit")


def write_hooks_file(path, obj, label, hint=""):
    """Ecrit ou FUSIONNE un fichier de hooks JSON : cree s'il manque, sinon
    ajoute les entrees PlanTrack absentes (comparees sur la commande) en
    preservant tout l'existant — settings.json existe dans quasiment tout
    projet Claude Code reel. Ecriture atomique (l'utilisateur edite aussi ce
    fichier). Rend False si rien n'a pu etre ecrit."""
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"{label} ecrit ({len(obj["hooks"])} hooks).{hint}")
        return True
    with open(path, encoding="utf-8") as f:
        content = f.read()
    try:
        data = json.loads(content)
        assert isinstance(data, dict) and isinstance(data.get("hooks", {}), dict)
    except (ValueError, AssertionError):
        print(f"[PlanTrack] {label} existe mais n'est pas un objet JSON exploitable — rien "
              "n'a ete ecrase. Bloc a fusionner a la main :\n"
              + json.dumps({"hooks": obj["hooks"]}, ensure_ascii=False, indent=2))
        return False
    hooks = data.setdefault("hooks", {})
    added = 0
    # ancienne commande Codex avec repli sur le cwd (b22) : retiree, la neuve la remplace
    for cur in hooks.values():
        for e in cur:
            keep = [h for h in e.get("hooks", []) if not ("|| pwd)" in h.get("command", "")
                                                          and ".claude/hooks/pt.py" in h.get("command", ""))]
            added += len(e.get("hooks", [])) - len(keep)
            e["hooks"] = keep
        cur[:] = [e for e in cur if e.get("hooks")]
    for evt, entries in obj["hooks"].items():
        cur = hooks.setdefault(evt, [])
        have = {h.get("command") for e in cur for h in e.get("hooks", [])}
        for e in entries:
            if any(h.get("command") not in have for h in e["hooks"]):
                cur.append(e)
                added += 1
            elif "matcher" in e:
                # l'entree est en place mais son matcher peut etre perime (b6) :
                # la comparaison sur la commande seule ne le rafraichirait jamais
                mine = {h.get("command") for h in e["hooks"]}
                for c in cur:
                    if mine & {h.get("command") for h in c.get("hooks", [])} \
                            and c.get("matcher") != e["matcher"]:
                        c["matcher"] = e["matcher"]
                        added += 1
            # meme raison pour le delai (d159) : une attente de l'orchestre depasserait l'ancien
            for h in e["hooks"]:
                if "timeout" not in h:
                    continue
                for c in cur:
                    for ch in c.get("hooks", []):
                        if ch.get("command") == h["command"] and ch.get("timeout") != h["timeout"]:
                            ch["timeout"] = h["timeout"]
                            added += 1
    if not added:
        print(f"{label} deja en place.")
        return True
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    print(f"{label} : {added} hooks PlanTrack fusionnes, l'existant est preserve.{hint}")
    return True


def cmd_init(args):
    """§13 : installation vendoree dans le projet courant (CLAUDE_PROJECT_DIR ou cwd).
    Copie pt.py, ecrit/fusionne les hooks + wrapper, insere le bloc d'instructions.
    Pose d'office les hooks git post-commit et pre-commit (`--git-hook` garde pour compatibilite)."""
    known = {"--git-hook", "--agent"}
    if any(a.startswith("--") and a not in known for a in args):
        sys.exit("usage : plantrack init [--git-hook]")
    if "--agent" in args:
        print("[PlanTrack] note : --agent est obsolete — init couvre desormais "
              "tous les agents d'un coup.")

    # 1. copie vendoree du coeur
    src = os.path.abspath(__file__)
    dst = os.path.join(ROOT, ".claude", "hooks", "pt.py")
    if os.path.abspath(dst) != src:
        if os.path.exists(dst):
            if open(dst, encoding="utf-8").read() != open(src, encoding="utf-8").read():
                sys.exit(f"[PlanTrack] {dst} existe avec un contenu different — rien n'a ete "
                         "ecrit. Pour changer de version : `uvx plantrack@latest update`.")
            print("pt.py deja en place (identique).")
        else:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy(src, dst)
            os.chmod(dst, 0o755)
            print(f"pt.py copie dans {os.path.relpath(dst, ROOT)}.")

    # 2. les hooks de tous les agents supportes, systematiquement : un fichier de
    # config est inerte sans son agent, et il attend deja celui installe apres coup
    complete = write_hooks_file(os.path.join(ROOT, ".claude", "settings.json"), SETTINGS,
                                ".claude/settings.json")
    complete &= write_hooks_file(os.path.join(ROOT, ".codex", "hooks.json"), CODEX_HOOKS,
                                 ".codex/hooks.json",
                                 " Dans Codex, lance /hooks pour approuver les hooks du projet.")

    # 3. wrapper CLI humaine
    wrapper = os.path.join(ROOT, "plantrack")
    if not os.path.exists(wrapper):
        with open(wrapper, "w", encoding="utf-8") as f:
            f.write(WRAPPER)
        os.chmod(wrapper, 0o755)
        print("wrapper ./plantrack ecrit.")

    # 4. blocs d'instructions : le bloc complet dans AGENTS.md (standard
    # cross-agents, source unique), une ligne d'import @AGENTS.md dans
    # CLAUDE.md et GEMINI.md — chaque agent, present ou futur, le trouve
    write_md_block("AGENTS.md", MD_BLOCK)
    write_state_block(project(), quiet=False)
    for name in ("CLAUDE.md", "GEMINI.md"):
        write_md_block(name, REF_BLOCK)
    write_owned_file(os.path.join(ROOT, ".deepcode", "skills", "plantrack", "SKILL.md"),
                     DEEPCODE_SKILL, "skill Deep Code (.deepcode/skills/plantrack/SKILL.md)")

    # 5. transcripts gitignores
    gi = os.path.join(ROOT, ".gitignore")
    content = ""
    if os.path.exists(gi):
        with open(gi, encoding="utf-8") as f:
            content = f.read()
    # transcripts : trop lourds ; injections et incidents : propres a la machine
    missing = [l for l in (".plantrack/transcripts/", ".plantrack/injections.json",
                           ".plantrack/incidents.log", ".plantrack/ronde.log",
                           ".plantrack/battement", ".plantrack/souffle.log") if l not in content]
    if missing:
        with open(gi, "a", encoding="utf-8") as f:
            f.write(("\n" if content and not content.endswith("\n") else "")
                    + "\n".join(missing) + "\n")
        print(f".gitignore : {len(missing)} entree(s) PlanTrack ajoutee(s).")

    if not os.path.exists(INJECTIONS):
        os.makedirs(PT_DIR, exist_ok=True)
        # d151 : une PREMIERE installation promet le guide de test au site Next qui viendra ;
        # les depots deja equipes n'ont pas cette marque et ne recoivent rien par surprise
        with open(INJECTIONS, "w", encoding="utf-8") as f:
            json.dump({"_depuis": now(), "_guide": "a_poser"}, f, indent=1, sort_keys=True)
    sync_guide()
    register_root()
    install_post_commit_hook()
    install_git_hook()  # d'office : doctor le compte en panne, chaque nouveau depot sortait en defaut
    print("[PlanTrack] installation terminee. Redemarre l'agent puis verifie avec /hooks."
          if complete else
          "[PlanTrack] installation INCOMPLETE — fusionne le bloc ci-dessus a la main, "
          "puis verifie avec `plantrack doctor`.")


GUIDE_BASES = ("", "src", "app", os.path.join("apps", "web"), os.path.join("apps", "web", "src"))

# fichiers PROPRES au site, poses une seule fois a la premiere installation (d151), jamais
# ecrases ensuite : le site les remplit (scenarios) et branche sa propre porte admin
GUIDE_SITE = {
    "lib/guide/scenarios.ts": '''/* Guide de test — parcours PROPRES a ce site (jamais ecrases par PlanTrack).
 * Ajouter un parcours : une cle -> { id, titre, date, page, url, etapes: [...] } (cf. types.ts). */
import type { GuideScenario } from "./types";

export const SCENARIOS: Record<string, GuideScenario> = {};
''',
    "lib/guide/guide-reglages.ts": '''/* Guide de test — reglages CLIENT propres a ce site (jamais ecrases par PlanTrack). */
import type { ReglagesGuideClient } from "./types";

export const reglagesGuide: ReglagesGuideClient = {};
''',
    "lib/guide/guide-reglages-serveur.ts": '''/* Guide de test — reglages SERVEUR propres a ce site (jamais ecrases par PlanTrack).
 *
 * A BRANCHER : `estAdmin` doit dire si la requete courante est celle d'un admin du site
 * (session + role). Tant qu'il rend `false`, le guide reste ferme pour tout le monde.
 * Le guide ne s'allume en plus que si GUIDE_ACTIF=1 est pose cote serveur (site de test).
 * Ne leve jamais : toute erreur retombe sur `false`.
 */
import type { ReglagesGuideServeur } from "./types";

export const reglagesGuideServeur: ReglagesGuideServeur = {
  estAdmin: async () => false,
};
''',
}


def base_guide_next():
    """Ou poser le guide dans un site Next : le dossier vise par l'alias `@/` du tsconfig,
    a la racine ou dans apps/web. None si ce n'est pas un site Next ou si l'alias manque."""
    for app in ("", os.path.join("apps", "web")):
        try:
            pkg = json.load(open(os.path.join(ROOT, app, "package.json"), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        if "next" not in deps:
            continue
        try:
            ts = open(os.path.join(ROOT, app, "tsconfig.json"), encoding="utf-8").read()
        except OSError:
            return None
        m = re.search(r'"@/\*"\s*:\s*\[\s*"(?:\./)?([^"*]*)\*"', ts)
        if not m:
            return None
        base = os.path.normpath(os.path.join(app, m.group(1).strip("/")))
        base = "" if base == "." else base
        return base if base in GUIDE_BASES else None
    return None


def poser_guide(src):
    """d151 : un projet equipe pour la premiere fois recoit le guide de test des qu'il est un
    site Next — tout de suite a l'init, ou a une mise a jour plus tard si Next arrive apres."""
    try:
        etat = json.load(open(INJECTIONS, encoding="utf-8"))
    except (OSError, ValueError):
        return
    if etat.get("_guide") != "a_poser":
        return
    base = base_guide_next()
    if base is None:
        return
    racine = os.path.realpath(ROOT) + os.sep

    def dans_depot(d):  # jamais d'ecriture a travers un lien qui sortirait du depot
        return not os.path.islink(d) and os.path.realpath(d).startswith(racine)

    for dirpath, _, files in os.walk(src):
        for name in files:
            s = os.path.join(dirpath, name)
            d = os.path.join(ROOT, base, os.path.relpath(s, src))
            os.makedirs(os.path.dirname(d), exist_ok=True)
            if dans_depot(d):
                shutil.copy(s, d)
    for rel, texte in GUIDE_SITE.items():
        d = os.path.join(ROOT, base, rel)
        if os.path.lexists(d) or not dans_depot(d):
            continue
        fd = os.open(d, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(texte)
    etat["_guide"] = "pose"
    with open(INJECTIONS, "w", encoding="utf-8") as f:
        json.dump(etat, f, indent=1, sort_keys=True)
    ou = os.path.join(base, "lib", "guide") if base else os.path.join("lib", "guide")
    print(f"guide de test pose dans {ou} — reste a le monter dans le layout "
          "(<GuideDeTestLazy />) et a brancher estAdmin (guide-reglages-serveur.ts).")


def sync_guide():
    """Le moteur du guide de test (Next.js) vit ici, en un seul exemplaire (d34) : un site
    qui l'a deja (lib/guide/types.ts, a la racine ou sous src/, app/, apps/web[/src]) recoit la derniere version. Ses scenarios.ts restent a lui.
    Un depot sans guide n'est pas touche. Un site qui a son propre guide (un fichier du moteur
    qui n'est aucune version publiee par PlanTrack) n'est pas touche non plus (b24)."""
    src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plantrack_guide")
    if not os.path.isdir(src):
        return  # copie vendoree : le moteur ne voyage qu'avec le paquet ou le depot plantrack
    try:
        from pt_publies import GUIDE_PUBLIES
    except ImportError:
        GUIDE_PUBLIES = set()
    # b31 : les sites rangent leur code sous app/ (prolearn, openstyle) ou dans un monorepo
    # (projob : apps/web, mizzzen : apps/web/src) — chercher seulement a la racine et sous
    # src/ laissait ces quatre sites hors de toute mise a jour du moteur.
    bases = [b for b in GUIDE_BASES if os.path.exists(os.path.join(ROOT, b, "lib", "guide", "types.ts"))]
    if not bases:
        poser_guide(src)
    for base in bases:
        # ancien guide (envoi par le poste, avant d138) : le moteur commun importe les
        # reglages du site, que ce guide n'a pas — le recopier casserait la construction
        if not os.path.exists(os.path.join(ROOT, base, "lib", "guide", "guide-reglages-serveur.ts")):
            print("guide de test : ancien guide (avant le moteur commun), laisse tel quel — "
                  "portage a faire (guide-reglages-serveur.ts absent).")
            continue
        propres = []
        for dirpath, _, files in os.walk(src):
            for name in files:
                s = os.path.join(dirpath, name)
                d = os.path.join(ROOT, base, os.path.relpath(s, src))
                if os.path.isfile(d) and not os.path.islink(d):
                    contenu = open(d, "rb").read()
                    if (contenu != open(s, "rb").read()
                            and hashlib.sha256(contenu).hexdigest() not in GUIDE_PUBLIES):
                        propres.append(os.path.relpath(d, ROOT))
        if propres:
            print(f"guide de test : le site a son propre guide ({', '.join(propres[:3])}"
                  f"{'…' if len(propres) > 3 else ''}), laisse tel quel.")
            continue
        changes = 0
        for dirpath, _, files in os.walk(src):
            for name in files:
                s = os.path.join(dirpath, name)
                d = os.path.join(ROOT, base, os.path.relpath(s, src))
                # jamais d'ecriture a travers un lien symbolique qui sortirait du depot
                if os.path.islink(d) or not os.path.realpath(d).startswith(
                        os.path.realpath(ROOT) + os.sep):
                    print(f"guide de test : {os.path.relpath(d, ROOT)} ignore (lien hors du depot).")
                    continue
                if os.path.exists(d) and open(d, "rb").read() == open(s, "rb").read():
                    continue
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy(s, d)
                changes += 1
        print(f"guide de test : {changes} fichier(s) du moteur mis a jour." if changes
              else "guide de test deja a jour.")


def cmd_update(args):
    """Remplace la copie vendoree par la version (plus recente) qui execute la
    commande, puis rejoue init — toutes les etapes savent se mettre a niveau."""
    src, dst = os.path.abspath(__file__), os.path.abspath(os.path.join(ROOT, ".claude", "hooks", "pt.py"))
    if dst == src:
        sys.exit("[PlanTrack] la copie installee ne peut pas se mettre a jour seule — "
                 "lance `uvx plantrack@latest update`.")
    if not os.path.exists(dst):
        sys.exit("[PlanTrack] aucune installation ici — lance `plantrack init`.")
    if "--si-publie" in args:
        try:
            from pt_publies import PUBLIES
        except ImportError:
            PUBLIES = set()
        if hashlib.sha256(open(dst, "rb").read()).hexdigest() not in PUBLIES:
            sys.exit("[PlanTrack] pt.py modifie a la main, mise a jour laissee de cote.")
    if open(dst, encoding="utf-8").read() == open(src, encoding="utf-8").read():
        print("pt.py deja a jour.")
    else:
        shutil.copy(src, dst)
        os.chmod(dst, 0o755)
        print("pt.py mis a jour (nouvelle version vendoree).")
        # doctor : les pannes tracees avant cette date sont traitees par la mise a jour
        try:
            d = json.load(open(INJECTIONS, encoding="utf-8")) if os.path.exists(INJECTIONS) else {}
            d["_coeur"] = now()
            os.makedirs(PT_DIR, exist_ok=True)
            with open(INJECTIONS, "w", encoding="utf-8") as f:
                json.dump(d, f, indent=1, sort_keys=True)
        except (OSError, ValueError) as e:
            trace("update : _coeur", e)
    cmd_init(args)


def cmd_precommit():
    """Garde-fou §10-A : le commit echoue si un fichier stage appartient a un fil
    parque. S'etendra aux taches cancelled/replaced avec la couche 2."""
    try:
        git_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, cwd=ROOT, check=True,
        ).stdout.strip()
        out = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            capture_output=True, text=True, cwd=ROOT, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        sys.exit(0)  # pas de git exploitable : ne jamais bloquer un commit legitime
    # git rend des chemins relatifs a SA racine ; le journal les stocke relatifs
    # a ROOT — sans conversion, un projet en sous-repertoire ne matchait jamais
    staged = {os.path.relpath(os.path.join(git_root, l.strip()), ROOT)
              for l in out.splitlines() if l.strip()}
    st = project()
    # un fichier repris par le fil actif (sain) se commite : le fil actif a priorite
    a = st["threads"].get(st["active"]) if st["active"] else None
    a_task = st["tasks"].get(a.get("task")) if a and a.get("task") else None
    a_frozen = a_task and a_task["status"] in ("cancelled", "replaced")
    active_files = set(a["files"]) if a and not a_frozen else set()
    blocked = False
    for t in st["threads"].values():
        task = st["tasks"].get(t.get("task")) if t.get("task") else None
        frozen = task and task["status"] in ("cancelled", "replaced")
        if t["status"] != "parked" and not frozen:
            continue
        for f in sorted(staged & set(t["files"]) - active_files):
            blocked = True
            if frozen:
                date = (task.get("status_ts") or "")[:10]
                rb = f" (remplacee par {task['replaced_by']})" if task.get("replaced_by") else ""
                print(f"PlanTrack : {f} appartient a la tache {task['id']}, {task['status']} le {date}{rb}")
                print(f"  motif : {trunc(task.get('motif') or 'aucun', 100)}")
            else:
                date = (t.get("parked_ts") or "")[:10]
                print(f"PlanTrack : {f} appartient au fil {t['id']} ({trunc(t['label'], 50)}), parque le {date}")
                print(f"  note de reprise : {trunc(t['note'] or 'aucune', 100)}")
    if blocked:
        append("precommit_block")  # journalise pour `plantrack stats` (§15)
        print("Travail de ce fil livre ? Ferme-le : plantrack close <id> (ou !close), puis recommite.")
        sys.exit(1)
    sys.exit(0)


def git_commit_date(sha):
    """Date ISO d'un commit, telle que git la lit. None si le sha est inconnu —
    un commit amende ou reset ne se retrouve plus (pg4), et le journal
    append-only garde quand meme sa ligne."""
    # le journal arrive par git pull : un « sha » en forme d'option (--output=...)
    # ferait ecrire git n'importe ou — seul un hexadecimal passe
    if not sha or not re.fullmatch(r"[0-9a-fA-F]{4,64}", sha):
        return None
    try:
        r = subprocess.run(["git", "-C", ROOT, "show", "-s", "--format=%cI", sha],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as e:
        trace("git_commit_date", e)
        return None
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        # git rend l'heure LOCALE du commit ('+02:00') ; le journal est en UTC.
        # Sans cette conversion les deux chaines se comparent a l'octet et la
        # fenetre saute de deux heures deux fois par an.
        return datetime.fromisoformat(r.stdout.strip()).astimezone(
            timezone.utc).isoformat(timespec="seconds")
    except ValueError:
        return None


def travail_depuis(ts):
    """Un commit fait apres ts, hors ceux de la ronde (le robot ne travaille pas).
    En cas de doute (git muet), on repond oui : mieux vaut juger que se taire."""
    try:
        r = subprocess.run(["git", "-C", ROOT, "log", f"--since={ts}", "--pretty=%s"],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as e:
        trace("travail_depuis : git log", e)
        return True
    if r.returncode:
        return True
    return any(s != COMMIT_RONDE for s in r.stdout.splitlines())


def usage_gap(days=USAGE_DAYS):
    """Commits reellement faits vs commits arrives au carnet. Le controle
    d'installation ne voit pas un depot vert et muet ; celui-la si."""
    evs = read_events()
    stamps = [e["ts"] for e in evs if e.get("ts")]
    if not stamps:
        return None
    # la fenetre ne remonte jamais avant le PREMIER commit journalise : avant lui
    # le hook ne journalisait demontrablement pas (version trop ancienne, hook
    # jamais pose, aucun fil actif du temps ou ca faisait perdre le commit), et
    # compter cette periode fige un ecart que plus rien ne peut rattraper —
    # une alerte allumee en permanence n'alerte plus personne. Depot ou aucun
    # commit n'est jamais arrive : on retombe sur l'installation, le hook est
    # alors vraiment muet et doit se voir.
    #
    # Le plancher se prend sur l'horloge de GIT, pas sur celle du journal. Le ts
    # d'un evenement `commit` est l'heure du HOOK, qui tourne APRES le commit :
    # qu'il franchisse une seconde et `git log --since` exclut ce meme premier
    # commit que le journal, lui, compte — l'ecart annonce alors 2/1 sans qu'un
    # seul commit manque. Demander a git la date du commit reglait la question
    # par construction ; une marge en secondes ne l'aurait reglee qu'en moyenne.
    firsts = [e for e in evs if e.get("kind") == "commit" and e.get("ts")]
    plancher = min(firsts, key=lambda e: e["ts"])["ts"] if firsts else min(stamps)
    avant = []
    if firsts and (d := git_commit_date(sha := min(firsts, key=lambda e: e["ts"]).get("sha"))):
        plancher = d
        # b18 : --since est inclusif a la seconde ; les commits d'AVANT le premier
        # journalise tombes dans la meme seconde comptaient. Ses parents s'excluent
        # par ascendance, pas par l'horloge.
        avant = ["HEAD", "--not", f"{sha}^@"]
    since = max((datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds"),
                plancher)
    try:
        r = subprocess.run(["git", "-C", ROOT, "log", f"--since={since}", "--pretty=%H", *avant],
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as e:
        trace("usage_gap : git log", e)
        return None
    # on compte les commits de GIT retrouves au journal, par sha : un commit amende
    # laisse son ancien sha au journal (append-only) et comptait double (pg4, 107/105) ;
    # un commit que `--since` exclut a la seconde pres l'est des deux cotes (pg8)
    vus = {e["sha"][:7] for e in evs if e.get("kind") == "commit" and e.get("sha")}
    shas = r.stdout.split()
    return sum(1 for h in shas if h[:7] in vus), len(shas), since[:10]


def diagnose(st):
    """§12 : hooks installes, journal lisible, budget de contexte, usage reel.
    Rend une liste de (verdict, libelle, remede) ; verdict None = information.
    Le diagnostic est separe de son affichage pour que le SessionStart puisse le
    consulter : un controle qu'il faut penser a lancer a la main ne protege de
    rien — c'est ainsi que bcc a tenu une semaine en defaut sans que ca se voie."""
    out = []

    def chk(good, label, fix=""):
        out.append((bool(good), label, fix))

    def slurp(*parts):
        p = os.path.join(ROOT, *parts)
        return open(p, encoding="utf-8").read() if os.path.exists(p) else ""

    chk(os.path.exists(os.path.join(ROOT, ".claude", "hooks", "pt.py")),
        "coeur vendorise (.claude/hooks/pt.py)", "lance `plantrack init`")
    txt = slurp(".claude", "settings.json")
    for h in ("hook-prompt", "hook-filelog", "hook-pretool", "hook-context", "hook-precompact"):
        chk(h in txt, f"hook {h} declare dans settings.json", "lance `plantrack init`")
    ctxt = slurp(".codex", "hooks.json")
    for h in ("hook-prompt", "hook-filelog", "hook-context", "hook-precompact"):
        chk(h in ctxt, f"hook {h} declare dans .codex/hooks.json",
            "lance `plantrack init`")
    chk(MD_START in slurp("AGENTS.md"), "bloc d'instructions dans AGENTS.md",
        "lance `plantrack init`")
    chk(STATE_START in slurp("AGENTS.md"), "instantane de l'etat dans AGENTS.md",
        "sans lui, un agent sans hooks (Deep Code) ne voit rien — lance `plantrack init`")
    old = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat(timespec="seconds")
    inj = {}
    if os.path.exists(INJECTIONS):
        try:
            inj = json.load(open(INJECTIONS, encoding="utf-8"))
        except ValueError:
            pass
    seen = {k: v for k, v in inj.items() if not k.startswith("_")}
    detail = ", ".join(f"{k} le {v[:10]}" for k, v in sorted(seen.items())) or "jamais"
    # la fenetre part de la pose de la trace : un depot mis a niveau hier n'a pas
    # encore eu l'occasion de prouver quoi que ce soit
    dernier = max(seen.values(), default="")
    if inj.get("_depuis", "9") < old and dernier < old and not travail_depuis(dernier or old):
        # projet au repos : personne n'a ouvert de session, personne n'a commite.
        # Rien n'a pu se faire sans l'etat — ce n'est pas une panne.
        out.append((None, f"etat injecte ({detail}) — aucun travail depuis, rien a juger", ""))
    elif inj.get("_depuis", "9") < old:
        chk(dernier >= old, f"etat reellement injecte ({detail})",
            f"aucun agent n'a recu l'etat depuis {STALE_DAYS} jours — hooks declares mais "
            "jamais approuves ? (Codex : lance `/hooks`)")
    else:
        out.append((None, f"etat injecte ({detail}) — installation trop recente pour juger", ""))
    for name in ("CLAUDE.md", "GEMINI.md"):
        # un outil qui regenere ces fichiers (GSD...) peut faire sauter la reference
        chk("@AGENTS.md" in slurp(name), f"ligne d'import @AGENTS.md dans {name}",
            "un outil a regenere le fichier ? relance `plantrack init`")
    chk(os.path.exists(os.path.join(ROOT, ".deepcode", "skills", "plantrack", "SKILL.md")),
        "skill Deep Code presente", "lance `plantrack init`")
    if hooks_dir := git_hooks_dir():
        hook = os.path.join(hooks_dir, "pre-commit")
        htxt = ""
        if os.path.exists(hook):
            with open(hook, encoding="utf-8") as f:
                htxt = f.read()
        chk("pt.py precommit" in htxt, "garde-fou git pre-commit",
            "un autre outil occupe .git/hooks/pre-commit — fusionne a la main"
            if htxt else "lance `plantrack init --git-hook`")
        pc = os.path.join(hooks_dir, "post-commit")
        post = "hook-commit" in (open(pc, encoding="utf-8").read()
                                 if os.path.exists(pc) else "")
        chk(post, "hook git post-commit (journal des commits)", "lance `plantrack init`")
        if post and (u := usage_gap()):
            chk(u[0] >= u[1], f"commits arrives au carnet ({u[0]}/{u[1]} depuis le {u[2]})",
                f"{u[1] - u[0]} commit(s) hors du carnet — hook post-commit muet, "
                "ou depassement du plafond de fils ouverts")
    if os.path.exists(LOG):
        with open(LOG, encoding="utf-8") as f:
            raw = sum(1 for l in f if l.strip())
        parsed = len(read_events())
        chk(raw == parsed, f"journal lisible ({parsed}/{raw} lignes)",
            f"{raw - parsed} ligne(s) corrompue(s) ignoree(s) au rejeu")
    else:
        out.append((None, "aucun journal encore (.plantrack/events.jsonl)", ""))
    # b7 : les pannes qu'un hook a avalees pour ne pas bloquer la session. Sans
    # ce controle, un hook qui echoue a chaque appel ne se voit nulle part.
    inc = []
    if os.path.exists(INCIDENTS):
        with open(INCIDENTS, encoding="utf-8") as f:
            inc = [l for l in f.read().splitlines() if l.strip()]
    # Une panne tracee AVANT le dernier correctif declare (bug passe to_verify)
    # est traitee : le voyant s'eteint seul, sans effacer le fichier (d9). Si
    # elle revient apres, elle est neuve et le voyant se rallume.
    # ponytail: un correctif sans rapport acquitte aussi une panne anterieure ;
    # acceptable car une vraie panne de hook se repete. Lier panne<->bug si ca gene.
    fixes = [b for b in st["bugs"].values() if b["status"] in ("to_verify", "validated")]
    fix = max(fixes, key=lambda b: b.get("status_ts", b["ts"]), default=None)
    seuil, par = (fix.get("status_ts", fix["ts"]), fix["id"]) if fix else ("", "")
    # le correctif d'une panne du coeur se declare dans le depot PlanTrack, pas ici :
    # c'est la mise a jour du coeur (update) qui l'apporte, elle vaut correctif
    if inj.get("_coeur", "") > seuil:
        seuil, par = inj["_coeur"], "la mise a jour du coeur"
    neuves = [l for l in inc if l.split(" ", 1)[0] > seuil]
    if len(neuves) < len(inc):
        out.append((None, f"{len(inc) - len(neuves)} panne(s) passee(s), traitee(s) par "
                    f"{par} — traces gardees dans .plantrack/incidents.log", ""))
    chk(not neuves, f"pannes avalees par les hooks ({len(neuves)} tracee(s) depuis le dernier correctif)",
        f"derniere : {trunc(neuves[-1], 120)} — tout est dans .plantrack/incidents.log ; "
        "corrige puis passe le bug en to_verify, le voyant s'eteint seul" if neuves else "")
    stale, muettes, _ = attentes(st)
    chk(not stale, f"bugs en attente de verdict humain ({len(stale)} depuis plus de {STALE_DAYS} jours)",
        "l'agent a fini, personne n'a tranche : `!verify <id>` ou `!reject <id> motif` dans la session — "
        + ", ".join(b["id"] for b in stale[:6]))
    chk(not muettes, f"questions sans reponse ({len(muettes)} depuis plus de {STALE_DAYS} jours)",
        "l'agent attend, la question ressort a chaque session : `!answer <id> <texte>` — "
        + ", ".join(f"!answer {q['id']}" for q in muettes[:6]))
    # d6 : plus de coupe a mesurer (b2). Deux controles a la place : le resume
    # injecte reste court par construction, et la fiche AGENTS.md — l'etat
    # entier — est bien celle de l'etat courant.
    n = len(context_block(st, rules=False, full=False))
    chk(n <= CTX_MAX_CHARS, f"resume de session sous le budget ({n}/{CTX_MAX_CHARS} chars)",
        "le resume ne porte que phase, bloquants et fils : ferme des fils (!close) "
        "ou fais valider des bugs bloquants")
    agents_md = slurp("AGENTS.md")
    if STATE_START in agents_md:
        chk(context_block(st, header=False, rules=False) in agents_md,
            "fiche d'etat a jour dans AGENTS.md",
            "elle se regenere a chaque ecriture au journal — n'importe quelle "
            "commande plantrack qui ecrit la remet d'aplomb")
    # --- parcours : avertir, jamais bloquer (meme regle que les bugs sans verdict)
    # d59 : plus de controle « questions hors porte » — une question dans une phase
    # « sans question » est celle d'un prerequis humain (compte, cle), permise ;
    # l'agent est prevenu au moment de la poser (cmd_question), ca suffit.
    if (ph := active_phase(st)) and ph.get("parcours"):
        depuis = ph.get("status_ts", ph["ts"])
        # "sans livrable" ne se mesure pas : PlanTrack ne sait pas ouvrir un PDF.
        # Ce qu'il sait voir, c'est une phase ou plus RIEN ne s'est journalise —
        # pas un commit, pas une question, pas une decision. Une phase qui dort.
        bouge = [e for e in read_events() if e.get("ts", "") > depuis
                 and e.get("kind") not in ("phase_status", "phase_open", "file_touched")]
        limite = (datetime.now(timezone.utc) - timedelta(hours=PHASE_STALE_HOURS)).isoformat(timespec="seconds")
        chk(bool(bouge) or depuis >= limite,
            f"phase {ph['id']} ({trunc(ph['title'], 30)}) vivante",
            f"active depuis le {depuis[:16]} sans le moindre evenement — livrable attendu : "
            f"{trunc(ph.get('livrable') or ph.get('regle', ''), 80)}")
        if (bloc := porte_bloquee(st, ph)):
            out.append((None, f"phase {ph['id']} : {bloc}", ""))
    # un commit journalise sans fil : le plafond de fils a empeche d'en ouvrir un.
    # Le commit n'est plus perdu, encore faut-il que quelqu'un le rattache.
    # Fenetre USAGE_DAYS comme le controle d'usage : sinon un orphelin d'une cause
    # reglee depuis longtemps garde le voyant rouge a vie (pg12).
    fenetre = (datetime.now(timezone.utc) - timedelta(days=USAGE_DAYS)).isoformat(timespec="seconds")
    orph = [e for e in read_events() if e.get("kind") == "commit" and not e.get("thread")
            and e.get("ts", "") >= fenetre]
    chk(not orph, f"commits rattaches a un fil ({len(orph)} sans fil)",
        "plafond de fils ouverts atteint au moment du commit — `!close` un fil, "
        "puis `!focus <sujet>` : " + ", ".join(e.get("sha", "?") for e in orph[:6]))
    return out


def cmd_doctor(st):
    bad = 0
    for good, label, fix in diagnose(st):
        if good is None:
            print(f"  --  {label}")
        elif good:
            print(f"  ok  {label}")
        else:
            bad += 1
            print(f"  !!  {label}" + (f" — {fix}" if fix else ""))
    sys.exit(1 if bad else 0)


def registered_roots():
    if not os.path.exists(REGISTRY):
        return []
    with open(REGISTRY, encoding="utf-8") as f:
        return [r for r in dict.fromkeys(l.strip() for l in f) if r]


def jetable(root):
    """Un depot sous /tmp est un bac a sable (essais, tests en reel) : l'inscrire au
    registre reel noie la ronde sous du bruit et masque les vraies pannes (pg11).
    Un registre explicite (PLANTRACK_REGISTRY) est un harnais de test : on n'y touche pas,
    ses depots vivent justement dans /tmp."""
    if os.environ.get("PLANTRACK_REGISTRY"):
        return False
    return os.path.realpath(root).startswith(os.path.realpath(tempfile.gettempdir()) + os.sep)


def register_root():
    """Inscrit le depot au registre a l'installation — sans lui, `doctor --all`
    n'aurait rien a parcourir et chaque depot resterait a verifier a la main."""
    try:
        if ROOT not in registered_roots() and not jetable(ROOT):
            with open(REGISTRY, "a", encoding="utf-8") as f:
                f.write(ROOT + "\n")
            print(f"depot inscrit au registre ({REGISTRY}) — visible dans `plantrack doctor --all`.")
    except OSError:
        pass


def flotte(roots):
    """{depot: defauts du doctor (liste vide = sain, None = installation absente)}, et
    les depots effaces ou bacs a sable, dont l'entree au registre n'a plus de sens."""
    etat, gone = {}, []
    for r in roots:
        core = os.path.join(r, ".claude", "hooks", "pt.py")
        if not os.path.isdir(r) or jetable(r):
            gone.append(r)
        elif not os.path.exists(core):
            etat[r] = None
        else:
            # juge avec CE moteur, pas la copie du depot : un projet au repos garde une vieille
            # copie (la ronde ne passe qu'a l'ouverture) et ses vieilles fausses alertes.
            env = dict(os.environ, PLANTRACK_ROOT=r, CLAUDE_PROJECT_DIR=r)
            p = subprocess.run([sys.executable, os.path.abspath(__file__), "doctor"],
                               capture_output=True, text=True, env=env)
            etat[r] = [l.strip()[4:] for l in p.stdout.splitlines() if l.startswith("  !!")]
    return etat, gone


def cmd_doctor_all():
    """Un ecran pour toute la flotte : ou ca deraille, sans entrer dans les depots."""
    roots = registered_roots()
    if not roots:
        sys.exit("[PlanTrack] aucun depot enregistre — lance `plantrack init` dans chacun.")
    etat, gone = flotte(roots)
    bad = sum(ko != [] for ko in etat.values())
    for r, ko in etat.items():
        if ko is None:
            print(f"!!  {r} — installation absente — relance `plantrack init` ici")
            continue
        print(f"{'!!' if ko else 'ok'}  {r}" + (f" — {len(ko)} probleme(s)" if ko else ""))
        for l in ko:
            print("      !!  " + l)
    if gone:
        with open(REGISTRY, "w", encoding="utf-8") as f:
            f.write("".join(x + "\n" for x in roots if x not in gone))
        print(f"\n{len(gone)} depot(s) efface(s) retire(s) du registre.")
    print(f"\n{len(roots) - len(gone)} depot(s), {bad} en defaut.")
    sys.exit(1 if bad else 0)


def cmd_stats():
    """§15 : mesure d'usage sur 14 jours — le seul argument credible pour publier."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat(timespec="seconds")
    evs = [e for e in read_events() if e.get("ts", "") >= cutoff]
    if not evs:
        print("aucun evenement sur les 14 derniers jours.")
        return
    kinds, rejets = {}, {}
    for e in evs:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
        if e["kind"] == "bug_status" and str(e.get("text", "")).startswith("rejete"):
            rejets[e["id"]] = rejets.get(e["id"], 0) + 1
    print(f"14 derniers jours — {len(evs)} evenement(s) :")
    for k in sorted(kinds):
        print(f"  {kinds[k]:>4}  {k}")
    print(f"reprises de fil : {kinds.get('focus', 0)}")
    print(f"blocages pre-commit : {kinds.get('precommit_block', 0)}")
    loops = sorted(b for b, n in rejets.items() if n >= 2)
    if loops:
        print(f"!! bugs rejetes plusieurs fois (signal de boucle) : {', '.join(loops)}")


def bilan_ligne(st, jours=7):
    """Une ligne en francais simple pour le depot courant, ou '' s'il ne s'est rien passe
    et que rien n'attend l'humain. Des NOMBRES seulement : le texte d'une question d'un
    autre projet n'a rien a faire dans le fil PlanTrack (d11)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=jours)).isoformat(timespec="seconds")
    fait = [(sum(e.get("kind") == "commit" and e.get("ts", "") >= cutoff for e in read_events()), ("commit", "commits")),
            (sum(d["ts"] >= cutoff for d in st["decisions"]), ("décision", "décisions")),
            (sum(b["status"] in BUG_TERMINAL and b.get("status_ts", "") >= cutoff
                 for b in st["bugs"].values()), ("bug réglé", "bugs réglés"))]
    avis = [(sum(b["status"] == "to_verify" for b in st["bugs"].values()), ("bug à vérifier", "bugs à vérifier")),
            (sum(q_ouverte(q) for q in st["questions"].values()), ("question", "questions")),
            (sum(s["verdict"] is None for s in st["steps"].values()), ("point de test", "points de test"))]
    dire = lambda l: ", ".join(f"{n} {m[n > 1]}" for n, m in l if n)
    a, b = dire(fait), dire(avis)
    # sans minuteur central (d51), un depot jamais rouvert peut etre en panne sans que
    # rien ne le dise : le bilan, qui passe partout, fait le controle a sa place
    # les attentes cote humain sont dites dans « attend ton avis », pas comptees en panne
    pannes = sum(g is False and not l.startswith(ATTENTES) for g, l, _ in diagnose(st))
    vu = max((os.path.getmtime(p) for p in (RONDE, LOG) if os.path.exists(p)), default=0)
    age = int((datetime.now().timestamp() - vu) // 86400) if vu else None
    if not (a or b or pannes):
        return ""
    tete = f"⚠ en panne ({pannes} défaut{'s' * (pannes > 1)}) — " if pannes else ""
    oubli = f" — pas ouvert depuis {age} jours" if age is not None and age >= jours else ""
    return (f"{tete}{os.path.basename(ROOT)} : {a or 'rien de neuf'}"
            + (f" — attend ton avis : {b}" if b else "") + oubli)


def cmd_bilan(args, st):
    """Bilan de la semaine (d37) : ce qui a avance, ce qui attend l'humain. --all = toute la
    flotte, chaque depot lu par CE coeur (un depot pas encore rattrape n'a pas `bilan`)."""
    jours = int(args[args.index("--jours") + 1]) if "--jours" in args else 7
    if "--all" not in args:
        print(bilan_ligne(st, jours))
        return
    lignes = []
    for r in registered_roots():
        if not os.path.isfile(os.path.join(r, ".plantrack", "events.jsonl")) or jetable(r):
            continue
        env = dict(os.environ, PLANTRACK_ROOT=r, CLAUDE_PROJECT_DIR=r)
        p = subprocess.run([sys.executable, os.path.abspath(__file__), "bilan", "--jours", str(jours)],
                           capture_output=True, text=True, env=env)
        if p.stdout.strip():
            lignes.append("• " + p.stdout.strip())
    if s := sante_resume(jours):
        lignes.append(s)
    if s := orch_bilan(jours):
        lignes.append(s)
    if lignes:
        print(f"Bilan PlanTrack des {jours} derniers jours :\n" + "\n".join(lignes))


def sante(jours=None):
    """Le releve de sante (d57), les `jours` derniers jours seulement si demande."""
    if not os.path.exists(SANTE):
        return []
    debut = (datetime.now().date() - timedelta(days=jours)).isoformat() if jours else ""
    out = []
    with open(SANTE, encoding="utf-8") as f:
        for l in f:
            try:
                e = json.loads(l)
            except ValueError:
                continue
            if e.get("jour", "") > debut:
                out.append(e)
    return out


def cle(defaut):
    """Un defaut sans ses nombres : '3 pannes' puis '4 pannes', c'est la meme panne."""
    return re.sub(r"\d+", "#", defaut.split(" — ")[0])


def par_jour(lignes):
    """{jour: {depot: defauts}} — un releve relance le meme jour remplace le precedent."""
    out = {}
    for e in lignes:
        out.setdefault(e["jour"], {})[e["depot"]] = e["ko"]
    return out


def sante_resume(jours=None):
    """'Santé : 6 jours verts sur 7' + les projets qui ont eu un souci ; '' sans releve."""
    jrs = par_jour(sante(jours))
    if not jrs:
        return ""
    verts = sum(not any(d.values()) for d in jrs.values())
    soucis = {}
    for d in jrs.values():
        for r, ko in d.items():
            if ko:
                soucis[os.path.basename(r)] = soucis.get(os.path.basename(r), 0) + 1
    s = "s" * (verts > 1)
    return (f"Santé : {verts} jour{s} vert{s} sur {len(jrs)}"
            + (" — souci : " + ", ".join(f"{p} ({n} j)" for p, n in soucis.items()) if soucis else ""))


def cmd_releve(args):
    """Releve de sante quotidien (d57, 4 semaines) : une ligne par depot dans sante.jsonl.
    N'imprime que les pannes NEUVES, absentes du releve precedent du meme depot : releve.sh
    en fait une bulle, et un defaut qui dure ne reecrit pas chaque matin (d23).
    --rapport : le bilan de toute la surveillance, envoye a la fin."""
    if "--rapport" in args:
        jrs = par_jour(sante())
        if not jrs:
            print("Rapport de surveillance PlanTrack : aucun relevé n'a été fait.")
            return
        vus = {}
        for jour, d in jrs.items():
            for r, ko in d.items():
                for x in ko:
                    vus.setdefault((os.path.basename(r), trunc(cle(x), 100)), set()).add(jour)
        print(f"Rapport de la surveillance PlanTrack ({min(jrs)} → {max(jrs)}) : "
              + ("l'outil a tenu, aucune panne." if not vus else f"{len(vus)} panne(s) vue(s), à regarder ensemble.")
              + "\n" + sante_resume()
              + "".join(f"\n• {p} : {k} ({len(j)} j)" for (p, k), j in sorted(vus.items())))
        return
    avant = {r: {cle(x) for x in ko} for d in par_jour(sante()).values() for r, ko in d.items()}
    etat, _ = flotte(registered_roots())
    hier = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec="seconds")
    # une panne avalee compte le jour ou elle se produit : un correctif pose dans un AUTRE
    # depot n'eteint pas le voyant de celui-ci (d55), le rouge durerait des semaines
    vieille = lambda x: x.startswith("pannes avalees") and x.split("derniere : ", 1)[-1][:25] < hier
    jour, neuves = datetime.now().date().isoformat(), []
    with open(SANTE, "a", encoding="utf-8") as f:
        for r, ko in etat.items():
            # ce qui attend l'humain n'est pas une panne de l'outil : le bilan le dit deja,
            # et le compter ici mettrait la flotte entiere au rouge tous les jours
            ko = ["installation absente"] if ko is None else [x for x in ko if not x.startswith(ATTENTES) and not vieille(x)]
            f.write(json.dumps({"jour": jour, "depot": r, "ko": ko}, ensure_ascii=False) + "\n")
            neuves += [f"• {os.path.basename(r)} : {trunc(x, 140)}" for x in ko
                       if cle(x) not in avant.get(r, set())]
    if neuves:
        print("Relevé santé PlanTrack — nouvelle panne :\n" + "\n".join(neuves))


def arg_de(args):
    """Attestation d'un verdict humain relaye (d107) : extrait `--de <texte>`.
    Un seul argument, cite : --de "<canal> : <la reponse de l'humain>"."""
    if "--de" not in args:
        return None, args
    i = args.index("--de")
    if i + 1 >= len(args) or not args[i + 1].strip():
        sys.exit("--de attend l'attestation : --de \"<canal> : <la reponse de l'humain, citee>\"")
    return args[i + 1].strip(), args[:i] + args[i + 2:]


def arg_carte(args):
    """Id de carte du poste (d96) : extrait `--carte <id>`."""
    if "--carte" not in args:
        return None, args
    i = args.index("--carte")
    if i + 1 >= len(args) or not args[i + 1].strip():
        sys.exit("--carte attend l'id de la carte du poste")
    carte = args[i + 1].strip()
    # l'id ressort dans le contexte de l'agent : un simple identifiant, rien d'autre
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", carte):
        sys.exit("--carte : id invalide (lettres, chiffres, . _ : - ; 64 max)")
    return carte, args[:i] + args[i + 2:]


def arg_motif(args, pos):
    """Extrait le motif obligatoire `-m <texte>` a partir de args[pos]."""
    if len(args) <= pos + 1 or args[pos] != "-m":
        sys.exit("motif obligatoire : ajoute -m \"pourquoi\" — un abandon sans motif "
                 "recree exactement le probleme que l'outil combat.")
    return " ".join(args[pos + 1:])


def cmd_plan_import(args, st):
    """§8 : l'agent propose un decoupage (fichier markdown), l'humain valide
    avant ecriture. `## titre` = phase, `- texte` = tache de la phase courante."""
    require_human("plan import")
    if not args:
        sys.exit("usage : plantrack plan import <fichier.md>")
    try:
        with open(args[0], encoding="utf-8") as f:
            lines = f.readlines()
    except OSError as e:
        sys.exit(f"[PlanTrack] illisible : {e}")
    phases = []  # [(titre, [taches])]
    for line in lines:
        if line.startswith("## "):
            phases.append((line[3:].strip(), []))
        elif re.match(r"^\s*[-*] ", line) and phases:
            phases[-1][1].append(re.sub(r"^\s*[-*] ", "", line).strip())
    if not phases:
        sys.exit("[PlanTrack] aucune phase (`## titre`) trouvee — rien a importer.")
    print("Plan propose :")
    for title, tasks in phases:
        print(f"  {title}")
        for t in tasks:
            print(f"    - {trunc(t, 70)}")
    resp = input("Ecrire ce plan dans le journal ? [y/N] ").strip().lower()
    if resp not in ("y", "yes", "o", "oui"):
        sys.exit("abandon — rien n'a ete ecrit.")
    for title, tasks in phases:
        pid = next_id("p")
        append("phase_open", id=pid, text=title)
        for t in tasks:
            append("task_open", id=next_id("k"), phase=pid, text=t)
    print(f"{len(phases)} phase(s) importee(s). `plantrack plan` pour l'arbre.")


def lire_import(chemin, source):
    """Taches d'un projet existant : JSON {"source", "phases":[{"titre","objectif",
    "taches":[{"texte","fait","source"}]}]} ou Markdown (`## phase`, `- [x]` fait,
    `- [ ]` / `- ` ouvert). Rend (source, [(titre, objectif, [(texte, fait, source)])])."""
    try:
        with open(chemin, encoding="utf-8") as f:
            brut = f.read()
    except OSError as e:
        sys.exit(f"[PlanTrack] illisible : {e}")
    phases = []
    if chemin.endswith(".json"):
        try:
            doc = json.loads(brut)
        except ValueError as e:
            sys.exit(f"[PlanTrack] JSON invalide : {e}")
        source = source or doc.get("source")
        for ph in doc.get("phases") or []:
            taches = []
            for t in ph.get("taches") or []:
                t = {"texte": t} if isinstance(t, str) else t
                if str(t.get("texte", "")).strip():
                    taches.append((t["texte"].strip(), bool(t.get("fait")), t.get("source")))
            if str(ph.get("titre", "")).strip():
                phases.append((ph["titre"].strip(), ph.get("objectif") or "", taches))
    else:
        for line in brut.splitlines():
            if line.startswith("## "):
                phases.append((line[3:].strip(), "", []))
            elif (m := re.match(r"^\s*[-*] (\[([ xX])\] )?(.+)$", line)) and phases:
                phases[-1][2].append((m.group(3).strip(), (m.group(2) or " ").lower() == "x", None))
    source = source or os.path.basename(chemin)
    if not phases:
        sys.exit("[PlanTrack] aucune phase trouvee — rien a importer.")
    return source, phases


def cmd_import(args, st):
    """Projet existant (demande bcc, choix Mariella 23/10 'Fait, avec la source') :
    recopie en une fois les phases et taches notees ailleurs. Ce qui etait deja
    coche arrive termine, la provenance journalisee. Ecrire est un geste humain :
    l'agent passe par --de (l'accord cite) ; --apercu reste libre, il n'ecrit rien."""
    de, args = arg_de(args)
    apercu = "--apercu" in args
    args = [a for a in args if a != "--apercu"]
    source = None
    if "--source" in args:
        i = args.index("--source")
        if i + 1 >= len(args):
            sys.exit("usage : plantrack import <f.json|f.md> [--source <nom>] [--apercu] [--de ...]")
        source, args = args[i + 1], args[:i] + args[i + 2:]
    if len(args) != 1:
        sys.exit("usage : plantrack import <f.json|f.md> [--source <nom>] [--apercu] [--de ...]")
    source, phases = lire_import(args[0], source)
    if not apercu:
        require_human("import", de)
    n_t = sum(len(t) for _, _, t in phases)
    n_f = sum(1 for _, _, ts in phases for _, fait, _ in ts if fait)
    print(f"Import depuis {source} : {len(phases)} phase(s), {n_t} tache(s) dont {n_f} deja faite(s)")
    for titre, _, taches in phases:
        print(f"  {titre}")
        for texte, fait, _ in taches:
            print(f"    [{'x' if fait else ' '}] {trunc(texte, 70)}")
    if apercu:
        print("(apercu : rien n'a ete ecrit)")
        return
    if not de and input("Ecrire ces taches dans le journal ? [y/N] ").strip().lower() not in ("y", "yes", "o", "oui"):
        sys.exit("abandon — rien n'a ete ecrit.")
    for titre, objectif, taches in phases:
        pid = next_id("p")
        append("phase_open", id=pid, text=titre, goal=objectif or None, source=source)
        for texte, fait, src in taches:
            kid = next_id("k")
            src = src or source
            append("task_open", id=kid, phase=pid, text=texte, source=src)
            if fait:
                append("task_status", id=kid, status="done",
                       canal=f"import depuis {src}" + (f" — {de}" if de else ""))
        if taches and all(f for _, f, _ in taches):
            append("phase_status", id=pid, status="done", canal=f"import depuis {source}")
    print(f"{len(phases)} phase(s) importee(s), {n_f} tache(s) deja faite(s) marquee(s) "
          f"terminee(s) (source : {source}). `plantrack plan` pour l'arbre.")


def cmd_phase(args, st):
    sub = args[0] if args else ""
    if sub == "add":
        if len(args) < 2:
            sys.exit("usage : plantrack phase add <titre> [--goal <objectif>]")
        rest = args[1:]
        goal = ""
        if "--goal" in rest:
            i = rest.index("--goal")
            goal = " ".join(rest[i + 1:])
            rest = rest[:i]
        pid = next_id("p")
        append("phase_open", id=pid, text=" ".join(rest), goal=goal or None)
        print(f"phase {pid} creee.")
        return
    if sub == "next":
        print(cmd_phase_next(st))
        return
    if len(args) < 2 or args[1] not in st["phases"]:
        sys.exit("usage : plantrack phase add|start|done|next|cancel <id> [-m motif]")
    pid = args[1]
    if sub == "start":
        append("phase_status", id=pid, status="active")
        print(f"phase {pid} active.")
    elif sub == "done":
        require_human("phase done")
        append("phase_status", id=pid, status="done")
        print(f"phase {pid} terminee.")
    elif sub == "cancel":
        require_human("phase cancel")
        motif = arg_motif(args, 2)
        append("phase_status", id=pid, status="cancelled", text=motif)
        append("decision", id=next_id("d"), text=f"phase {pid} annulee : {motif}")
        print(f"phase {pid} annulee (decision actee).")
    else:
        sys.exit("usage : plantrack phase add|start|done|next|cancel <id> [-m motif]")


def cmd_phase_next(st):
    """Clot la phase courante et ouvre la suivante du parcours.

    C'est la seule facon de terminer une phase sans passer par `phase done`
    (humain seul) : la porte remplace ici la signature humaine. Porte agent, il
    passe ; porte humaine, il faut la trace d'un arbitrage — une question posee
    dans la phase et sa reponse. Le refus est un message, jamais un blocage dur :
    l'agent doit pouvoir continuer a travailler dans la phase en cours."""
    ph = active_phase(st)
    if not ph:
        return ("[PlanTrack] aucune phase active — `plantrack parcours start <nom>` "
                "ou `plantrack phase start <id>`.")
    if not ph.get("parcours"):
        return (f"[PlanTrack] la phase {ph['id']} n'appartient a aucun parcours : "
                "`plantrack phase done` (humain seul) la termine.")
    if (bloc := porte_bloquee(st, ph)):
        return f"[PlanTrack] refuse — {bloc}"
    suite = phases_du_parcours(st, ph["parcours"])
    ids = [p["id"] for p in suite]
    append("phase_status", id=ph["id"], status="done")
    i = ids.index(ph["id"]) if ph["id"] in ids else len(ids) - 1
    if i + 1 >= len(ids):
        return (f"[PlanTrack] phase {ph['id']} ({ph['title']}) terminee — "
                f"parcours {ph['parcours']} acheve, plus aucune phase apres celle-ci.")
    nxt = suite[i + 1]
    append("phase_status", id=nxt["id"], status="active")
    return (f"[PlanTrack] phase {ph['id']} ({ph['title']}) terminee.\n"
            f"phase {i + 2}/{len(ids)} — {nxt['title']} : {nxt.get('regle', 'aucune regle')}")


def lire_parcours(chemin):
    """Charge et valide un fichier de parcours. Un parcours mal forme doit mourir
    ICI, pas a l'injection : une regle absente laisserait l'agent sans consigne
    sans que personne ne le voie."""
    try:
        with open(chemin, encoding="utf-8") as f:
            data = json.load(f)
    except OSError as e:
        sys.exit(f"[PlanTrack] illisible : {e}")
    except ValueError as e:
        sys.exit(f"[PlanTrack] JSON invalide : {e}")
    nom = str(data.get("nom") or "").strip()
    phases = data.get("phases")
    if not nom:
        sys.exit("[PlanTrack] le parcours doit porter un `nom`.")
    if not isinstance(phases, list) or not phases:
        sys.exit("[PlanTrack] le parcours doit porter une liste `phases` non vide.")
    propres = []
    for i, p in enumerate(phases, 1):
        if not isinstance(p, dict):
            sys.exit(f"[PlanTrack] phase {i} : un objet est attendu.")
        titre = str(p.get("nom") or "").strip()
        regle = str(p.get("regle") or "").strip()
        porte = str(p.get("porte") or "agent").strip()
        if not titre:
            sys.exit(f"[PlanTrack] phase {i} : `nom` manquant.")
        if not regle:
            sys.exit(f"[PlanTrack] phase {i} ({titre}) : `regle` manquante — une phase "
                     "sans regle n'apporte rien de plus qu'une phase ordinaire.")
        if porte not in PORTES:
            sys.exit(f"[PlanTrack] phase {i} ({titre}) : `porte` doit valoir "
                     f"{' ou '.join(PORTES)}, pas {porte!r}.")
        # la regle part dans un bloc au budget serre : une regle-paragraphe ferait
        # elider le reste de l'etat sans prevenir
        if len(regle) > LINE_TRUNC:
            sys.exit(f"[PlanTrack] phase {i} ({titre}) : regle de {len(regle)} chars, "
                     f"maximum {LINE_TRUNC} — le bloc reinjecte tient dans "
                     f"{CTX_MAX_CHARS} chars, une regle longue en chasse le reste.")
        propres.append({"nom": titre, "regle": regle, "porte": porte,
                        "livrable": str(p.get("livrable") or "").strip(),
                        "questions": bool(p.get("questions", True))})
    return nom, propres


def cmd_parcours(args, st):
    sub = args[0] if args else ""
    if sub == "import":
        require_human("parcours import")
        if len(args) < 2:
            sys.exit("usage : plantrack parcours import <fichier.json>")
        nom, phases = lire_parcours(args[1])
        print(f"Parcours propose : {nom} ({len(phases)} phases)")
        for i, p in enumerate(phases, 1):
            print(f"  {i}. {p['nom']} [porte {p['porte']}"
                  + ("" if p["questions"] else ", sans question") + "]")
            print(f"     regle : {trunc(p['regle'], 100)}")
            if p["livrable"]:
                print(f"     livrable : {trunc(p['livrable'], 100)}")
        if nom in st["parcours"]:
            print(f"(un parcours {nom} existe deja — la nouvelle definition le remplacera)")
        if input("Ecrire ce parcours dans le journal ? [y/N] ").strip().lower() not in ("y", "yes", "o", "oui"):
            sys.exit("abandon — rien n'a ete ecrit.")
        append("parcours_defini", id=next_id("pc"), text=nom, phases=phases)
        print(f"parcours {nom} enregistre. `plantrack parcours start {nom}` pour le lancer.")
        return
    if sub in ("", "list"):
        if not st["parcours"]:
            sys.exit("aucun parcours declare. `plantrack parcours import <fichier.json>`.")
        for nom, pc in st["parcours"].items():
            inst = phases_du_parcours(st, nom)
            etat = ""
            if inst:
                faites = sum(1 for p in inst if p["status"] == "done")
                etat = f" — lance, {faites}/{len(inst)} phases terminees"
            print(f"{nom} ({len(pc['phases'])} phases){etat}")
            for i, p in enumerate(pc["phases"], 1):
                print(f"  {i}. {p['nom']} [porte {p['porte']}] : {trunc(p['regle'], 90)}")
        return
    if sub == "start":
        de, args = arg_de(args)
        depuis = None
        if "--depuis" in args:
            i = args.index("--depuis")
            if i + 1 >= len(args):
                sys.exit("usage : plantrack parcours start <nom> --depuis <phase> --de \"<canal> : <reponse>\"")
            depuis, args = args[i + 1], args[:i] + args[i + 2:]
            # sauter des phases, c'est franchir des portes qui attendent l'humain
            require_human("parcours start --depuis", de)
        if len(args) < 2:
            sys.exit("usage : plantrack parcours start <nom> [--depuis <phase> --de \"<canal> : <reponse>\"]")
        ok, msg = parcours_start(st, args[1], depuis, de)
        print(msg)
        if not ok:
            sys.exit(1)
        return
    if sub == "json":
        print(json.dumps(parcours_json(st), ensure_ascii=False, indent=2))
        return
    sys.exit("usage : plantrack parcours list|import <f.json>|start <nom>|json")


def parcours_start(st, nom, depuis=None, de=None):
    """Instancie les phases d'un parcours declare et active la premiere.
    Partage entre la CLI et `!parcours <nom>` : un hook ne doit jamais sys.exit,
    d'ou le couple (ok, message) plutot qu'une sortie de processus.
    `depuis` (projet existant) : les phases d'avant sont closes avec l'accord cite."""
    pc = st["parcours"].get(nom)
    if not pc:
        dispo = ", ".join(sorted(st["parcours"])) or "aucun"
        return False, f"[PlanTrack] parcours {nom} inconnu — declares : {dispo}."
    noms = [p["nom"] for p in pc["phases"]]
    debut = 0
    if depuis is not None:
        if depuis not in noms:
            return False, (f"[PlanTrack] phase {depuis} absente du parcours {nom} — "
                           f"phases : {', '.join(noms)}.")
        debut = noms.index(depuis)
    if phases_du_parcours(st, nom):
        return False, (f"[PlanTrack] le parcours {nom} tourne deja — `plantrack phase next` "
                       "pour avancer, `plantrack plan` pour l'arbre.")
    if (ph := active_phase(st)):
        return False, (f"[PlanTrack] la phase {ph['id']} ({ph['title']}) est encore active — "
                       "termine-la avant d'ouvrir un parcours.")
    ids = []
    for i, p in enumerate(pc["phases"]):
        pid = next_id("p")
        append("phase_open", id=pid, text=p["nom"], regle=p["regle"], porte=p["porte"],
               livrable=p.get("livrable") or None, parcours=nom, ordre=i,
               questions=p.get("questions", True))
        ids.append(pid)
    for pid in ids[:debut]:
        append("phase_status", id=pid, status="done", canal=f"projet existant : {de}")
    append("phase_status", id=ids[debut], status="active")
    p0 = pc["phases"][debut]
    saut = f" ({debut} phase(s) deja passee(s), source citee)" if debut else ""
    return True, (f"[PlanTrack] parcours {nom} lance — phase {debut + 1}/{len(ids)} ({ids[debut]}) : "
                  f"{p0['nom']}{saut}\nregle : {p0['regle']}")


def parcours_json(st):
    """Ce que bcc lit pour son ecran de completude : la phase courante et sa regle,
    pour montrer au client 'votre agent vous prepare des propositions' plutot qu'un
    fil vide. Rend toujours un objet, meme sans parcours en cours."""
    ph = active_phase(st)
    if not ph:
        return {"parcours": None, "phase": None,
                "parcours_declares": sorted(st["parcours"])}
    suite = phases_du_parcours(st, ph["parcours"]) if ph.get("parcours") else []
    ids = [p["id"] for p in suite]
    return {
        "parcours": ph.get("parcours"),
        "rang": ids.index(ph["id"]) + 1 if ph["id"] in ids else None,
        "total": len(ids) or None,
        "phase": {
            "id": ph["id"], "nom": ph["title"], "regle": ph.get("regle", ""),
            "livrable": ph.get("livrable", ""), "porte": ph.get("porte", ""),
            "questions": ph.get("questions", True),
            "bloque_par": porte_bloquee(st, ph),
            "depuis": ph.get("status_ts", ph["ts"]),
        },
        "phases": [{"id": p["id"], "nom": p["title"], "etat": p["status"]} for p in suite],
        "parcours_declares": sorted(st["parcours"]),
    }


def cmd_task(args, st):
    sub = args[0] if args else ""
    if sub == "add":
        if len(args) < 3:
            sys.exit("usage : plantrack task add <phase_id> <texte>")
        pid = args[1]
        p = st["phases"].get(pid)
        if not p:
            sys.exit(f"phase {pid} introuvable — `plantrack plan` pour l'arbre.")
        if p["status"] in ("done", "cancelled"):
            sys.exit(f"refuse : la phase {pid} est {p['status']}.")
        kid = next_id("k")
        append("task_open", id=kid, phase=pid, text=" ".join(args[2:]))
        print(f"tache {kid} creee dans {pid}.")
        return
    de, args = arg_de(args)
    if len(args) < 2 or args[1] not in st["tasks"]:
        sys.exit("usage : plantrack task add|start|verify|done|cancel|replace <id> ...")
    kid = args[1]
    if sub == "start":
        append("task_status", id=kid, status="in_progress")
        print(f"tache {kid} in_progress.")
    elif sub == "verify":
        append("task_status", id=kid, status="to_verify")
        print(f"tache {kid} a verifier.")
    elif sub == "done":
        require_human("task done", de)
        append("task_status", id=kid, status="done", canal=de)
        print(f"tache {kid} terminee.")
    elif sub == "cancel":
        require_human("task cancel", de)
        motif = arg_motif(args, 2)
        append("task_status", id=kid, status="cancelled", text=motif, canal=de)
        append("decision", id=next_id("d"),
               text=f"tache {kid} annulee ({trunc(st['tasks'][kid]['text'], 50)}) : {motif}")
        print(f"tache {kid} annulee (decision actee : ne jamais reimplementer).")
    elif sub == "replace":
        require_human("task replace")
        if len(args) < 3 or args[2] not in st["tasks"]:
            sys.exit("usage : plantrack task replace <ancien_id> <nouveau_id> -m <motif>\n"
                     "(le nouveau doit exister : `plantrack task add` d'abord)")
        motif = arg_motif(args, 3)
        append("task_status", id=kid, status="replaced", text=motif, replaced_by=args[2])
        append("decision", id=next_id("d"),
               text=f"tache {kid} remplacee par {args[2]} : {motif}")
        print(f"tache {kid} remplacee par {args[2]} (decision actee).")
    else:
        sys.exit("usage : plantrack task add|start|verify|done|cancel|replace <id> ...")


SIMILAR = 0.85  # §9 : au-dela, deux hypotheses sont considerees identiques

BUG_TERMINAL = ("validated", "wont_fix")


def _norm(s):
    """Normalise une hypothese pour la comparaison : casse, ponctuation, espaces."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())


def question_proche(a, b):
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio() > SIMILAR


def cmd_questions_doublons(args, st):
    """Regroupe les questions ouvertes presque identiques : la plus ancienne reste
    ouverte, les copies y sont rattachees (--fusionner). Rien ne s'efface et
    aucune reponse n'est ecrite : trancher reste a l'humain."""
    ouvertes = sorted((q for q in st["questions"].values() if q_ouverte(q)), key=lambda q: q["ts"])
    groupes, pris = [], set()
    for i, q in enumerate(ouvertes):
        if q["id"] in pris:
            continue
        copies = [c for c in ouvertes[i + 1:] if c["id"] not in pris and question_proche(q["text"], c["text"])]
        if copies:
            pris.update(c["id"] for c in copies)
            groupes.append((q, copies))
    if not groupes:
        print("aucune question en double.")
        return
    fusion = "--fusionner" in args
    for q, copies in groupes:
        print(f"{q['id']} : {trunc(q['text'], 90)}")
        for c in copies:
            if fusion:
                append("question_doublon", id=c["id"], de=q["id"])
            print(f"   {'rattachee' if fusion else 'copie'} : {c['id']}")
    if not fusion:
        print("`plantrack questions-doublons --fusionner` pour rattacher les copies.")


def cmd_echecs(args, st):
    """Combien de tentatives ont rate, par bug puis par tache (pour qu'un
    orchestrateur change de modele apres plusieurs echecs). Echec = tentative
    rejetee par l'humain ou retiree (bug repasse en open avec motif)."""
    bugs, tasks = {}, {}
    for b in st["bugs"].values():
        if not b["attempts"]:
            continue
        ech = sum(1 for a in b["attempts"] if a.get("rejected"))
        bugs[b["id"]] = {"task": b.get("task"), "status": b["status"],
                         "tentatives": len(b["attempts"]), "echecs": ech}
        if b.get("task"):
            tasks.setdefault(b["task"], {"echecs": 0})["echecs"] += ech
    if "--json" in args:
        print(json.dumps({"bugs": bugs, "tasks": tasks}, ensure_ascii=False))
        return
    if not bugs:
        print("aucune tentative consignee.")
        return
    for bid, v in bugs.items():
        tk = f"  [{v['task']}]" if v["task"] else ""
        print(f"{bid:>4}  {v['status']:<11} {v['tentatives']} tentative(s), {v['echecs']} echec(s){tk}")
    for tid, v in tasks.items():
        print(f"tache {tid} : {v['echecs']} echec(s)")


def get_bug(st, bid):
    b = st["bugs"].get(bid or "")
    if not b:
        sys.exit(f"bug introuvable : {bid or '(manquant)'} — `plantrack bugs` pour la liste.")
    return b


def cmd_attempt(args, st):
    """§9 : consigne une hypothese testee sur un bug. Refuse une hypothese trop
    proche d'une tentative existante — avec le motif de rejet si elle en a un."""
    if len(args) < 2:
        sys.exit("usage : plantrack attempt <bug_id> <hypothese testee>")
    b = get_bug(st, args[0])
    if b["status"] in BUG_TERMINAL:
        sys.exit(f"refuse : {b['id']} est {b['status']} — plus rien a tenter dessus.")
    reprendre = "--reprendre" in args
    hyp = " ".join(x for x in args[1:] if x != "--reprendre")
    session = os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CODEX_THREAD_ID")
    # q4 : une autre session a travaille ce bug il y a moins de 3 h -> elle est dessus.
    autre = next((a for a in reversed(b["attempts"]) if a.get("session")), None)
    if (session and autre and autre["session"] != session and not reprendre
            and datetime.now(timezone.utc) - datetime.fromisoformat(autre["ts"])
            < timedelta(hours=3)):
        sys.exit(f"[PlanTrack] refuse : une autre session travaille deja sur {b['id']} "
                 f"({autre['id']}, {autre['ts'][11:16]} UTC) : {trunc(autre['hypothesis'], 80)}\n"
                 "Laisse-la finir et passe a autre chose. Si elle est morte en route : "
                 f"plantrack attempt {b['id']} --reprendre \"...\"")
    for a in b["attempts"]:
        ratio = difflib.SequenceMatcher(None, _norm(hyp), _norm(a["hypothesis"])).ratio()
        if ratio > SIMILAR:
            rej = (f"\n  motif du rejet : {trunc(a['rejected'], 100)}"
                   if a.get("rejected") else "")
            sys.exit(f"[PlanTrack] refuse : hypothese deja tentee sur {b['id']} "
                     f"({a['id']}, similarite {ratio:.2f}) : {trunc(a['hypothesis'], 80)}{rej}\n"
                     "Change d'angle au lieu de retenter la meme piste.")
    aid = next_id("a")
    extra = {"repris_de": autre["session"]} if reprendre and autre else {}
    append("attempt", id=aid, bug=b["id"], hypothesis=hyp, session=session, **extra,
           actor="claude-code" if any(os.environ.get(v) for v in AGENT_ENV) else "human")
    print(f"tentative {aid} consignee sur {b['id']} : {trunc(hyp, 80)}")


def cmd_attempts(args, st):
    b = get_bug(st, args[0] if args else "")
    if not b["attempts"]:
        print(f"aucune tentative sur {b['id']}.")
    for a in b["attempts"]:
        print(f"{a['id']:>4}  {a['ts'][:16]}  {trunc(a['hypothesis'], 80)}")
        if a.get("rejected"):
            print(f"        rejetee : {trunc(a['rejected'], 90)}")


def cmd_bug_status(args, st):
    """§9 : machine a etats. L'agent ecrit open/in_progress/to_verify ;
    validated passe par `verify` (humain), wont_fix est humain seul."""
    de, args = arg_de(args)
    if len(args) < 2:
        sys.exit("usage : plantrack bug <id> open|in_progress|to_verify|wont_fix [-m motif]")
    b, target = get_bug(st, args[0]), args[1]
    if b["status"] in BUG_TERMINAL:
        sys.exit(f"refuse : {b['id']} est {b['status']} (etat terminal, le journal ne s'efface pas).")
    if target == "validated":
        sys.exit("[PlanTrack] \"validated\" est reserve a l'humain, via `plantrack verify`. "
                 "Passe le bug en \"to_verify\" et signale-le dans ta reponse.")
    if target == "wont_fix":
        require_human("bug wont_fix", de)
        motif = arg_motif(args, 2)
        append("bug_status", id=b["id"], status="wont_fix", text="wont_fix : " + motif, canal=de)
        print(f"{b['id']} classe wont_fix (motif conserve)."
              + (f" (canal : {trunc(de, 60)})" if de else ""))
    elif target in ("open", "in_progress", "to_verify"):
        motif = None
        if target == "open" and b["status"] == "to_verify":
            # retrograder un bug annonce comme corrige se motive (revue : L6) —
            # le motif s'attache a la derniere tentative, sans compter comme reject humain
            motif = arg_motif(args, 2)
        append("bug_status", id=b["id"], status=target, text=motif)
        print(f"{b['id']} -> {target}." + (" (motif conserve)" if motif else ""))
    else:
        sys.exit("statuts : open | in_progress | to_verify | wont_fix (validated : via `plantrack verify`)")


def cmd_verdict(st, bid, motif=None, canal=None):
    """verify (motif None) / reject (motif) — humain seul, par la CLI (require_human)
    ou par le prompt (!verify / !reject : seul l'humain tape un prompt, comme !answer),
    ou relaye par l'agent avec attestation (canal, d107).
    Renvoie (ok, message) sans jamais sys.exit : en hook, un exit 1 laisserait
    passer le prompt au modele."""
    b = st["bugs"].get(bid or "")
    if not b:
        return False, f"[PlanTrack] bug introuvable : {bid or '(manquant)'} — `plantrack bugs` pour la liste."
    if b["status"] != "to_verify":
        geste = "se rejette" if motif is not None else "se valide"
        return False, (f"refuse : {b['id']} est \"{b['status']}\" — seul un bug \"to_verify\" "
                       f"{geste} (machine a etats §9).")
    if motif is None:
        append("bug_status", id=b["id"], status="validated", canal=canal)
        return True, f"{b['id']} valide." + (f" (canal : {trunc(canal, 60)})" if canal else "")
    append("bug_status", id=b["id"], status="open", text="rejete : " + motif, canal=canal)
    extra = " (motif attache a la derniere tentative)" if b["attempts"] else ""
    return True, f"{b['id']} rouvert avec motif{extra}."


def require_human(cmd, de=None):
    """O6 : ecrire un verdict est reserve a l'humain. Refus deterministe quand
    la CLI est invoquee depuis un shell pilote par l'agent (env Claude Code) —
    sauf attestation d'un canal humain relaye (--de, decision d107) : le verdict
    vient bien de l'humain (telephone, carnet web), l'agent n'est que le
    messager, et l'attestation citee est journalisee avec le geste."""
    if de:
        return
    if any(os.environ.get(v) for v in AGENT_ENV):
        sys.exit(
            f"[PlanTrack] refuse : `{cmd}` est reserve a l'humain (environnement agent detecte).\n"
            "Propose l'action dans ta reponse (statut maximum pour toi : to_verify / in_progress) ; "
            "l'humain tranchera via la CLI `plantrack`.\n"
            "Il a DEJA tranche par un canal relaye (telephone, carnet web) ? Rejoue la commande avec "
            "--de \"<canal> : <sa reponse, citee>\" — l'attestation est journalisee avec le verdict."
        )


def ecrit(msg):
    """Sortie CLI des commandes d'ecriture : un refus (rien d'ecrit) sort en code 1."""
    if msg.startswith(("usage", "[PlanTrack] refuse")):
        sys.exit(msg)
    print(msg)


def cli(argv):
    st = project()
    cmd = argv[0] if argv else "status"
    args = argv[1:]

    if cmd == "status":
        print(context_block(st))
    elif cmd == "init":
        cmd_init(args)
    elif cmd == "update":
        cmd_update(args)
    elif cmd == "plan":
        if args and args[0] == "import":
            cmd_plan_import(args[1:], st)
        elif not st["phases"]:
            print("aucun plan. `plantrack phase add <titre>` ou `plantrack plan import <fichier.md>`.")
        else:
            for p in st["phases"].values():
                extra = f" — {trunc(p['goal'], 60)}" if p["goal"] else ""
                print(f"{p['id']:>4}  {p['status']:<10} {trunc(p['title'], 50)}{extra}")
                for t in (t for t in st["tasks"].values() if t["phase"] == p["id"]):
                    rb = f" -> {t['replaced_by']}" if t.get("replaced_by") else ""
                    rb += f"  (repris de {t['source']})" if t.get("source") else ""
                    print(f"   {t['id']:>4}  {t['status']:<12} {trunc(t['text'], 60)}{rb}")
    elif cmd == "import":
        cmd_import(args, st)
    elif cmd == "parcours":
        cmd_parcours(args, st)
    elif cmd == "phase":
        cmd_phase(args, st)
    elif cmd == "task":
        cmd_task(args, st)
    elif cmd == "decisions":
        if not st["decisions"]:
            print("aucune decision actee.")
        for d in st["decisions"]:
            print(f"{d['id']:>4}  {d['ts'][:16]}  {trunc(d['text'], 100)}")
    elif cmd == "precommit":
        cmd_precommit()
    elif cmd == "doctor":
        cmd_doctor_all() if "--all" in args else cmd_doctor(st)
    elif cmd == "stats":
        cmd_stats()
    elif cmd == "bilan":
        cmd_bilan(args, st)
    elif cmd == "releve":
        cmd_releve(args)
    elif cmd == "ronde":
        cmd_ronde()
    elif cmd == "respirer":
        cmd_respirer(args)
    elif cmd == "orchestre":
        cmd_orchestre(args)
    elif cmd == "attentes":
        print(cmd_attentes(args, st))
    elif cmd == "bugs":
        rows = [b for b in st["bugs"].values() if b["status"] not in BUG_TERMINAL]
        if not rows:
            print("aucun bug ouvert.")
        for b in rows:
            sev = f" [{b['severity']}]" if b.get("severity", "normal") != "normal" else ""
            tag = " (agent)" if b.get("par") == "agent" else ""
            na = f" ({len(b['attempts'])} tentative(s))" if b["attempts"] else ""
            print(f"{b['id']:>4}  {b['status']:<11}{sev} {trunc(b['text'], 90)}{tag}{na}")
            for n in b["notes"]:
                print(f"        \u21b3 {trunc(n, 90)}")
    elif cmd == "inbox":
        if not st["inbox"]:
            print("inbox vide.")
        for n in st["inbox"]:
            print(f"{n['id']:>4}  {n['ts'][:16]}  {trunc(n['text'], 90)}")
    elif cmd == "threads":
        for t in st["threads"].values():
            mark = "*" if t["id"] == st["active"] else " "
            print(f"{mark} {t['id']:>4}  {t['status']:<8} {trunc(t['label'], 50)}")
            if t["note"]:
                print(f"        reprise : {trunc(t['note'], 90)}")
            if t["commits"]:
                print(f"        commits : {len(t['commits'])} (dernier {t['commits'][-1]['sha']})")
    elif cmd == "verify":
        de, args = arg_de(args)
        require_human("verify", de)
        ok, msg = cmd_verdict(st, args[0] if args else "", canal=de)
        print(msg) if ok else sys.exit(msg)
    elif cmd == "reject":
        de, args = arg_de(args)
        require_human("reject", de)
        if len(args) < 3 or args[1] != "-m":
            sys.exit("usage : plantrack reject <bug_id> -m \"pourquoi ca ne marche pas\"")
        ok, msg = cmd_verdict(st, args[0], " ".join(args[2:]), canal=de)
        print(msg) if ok else sys.exit(msg)
    elif cmd == "bug":
        # desambiguation : "bug b1 wont_fix" (changement de statut) vs
        # "bug <texte>" (creation par l'agent, v1.5)
        if args and re.match(r"^b[0-9]+$", args[0]):
            cmd_bug_status(args, st)
        elif (len(args) == 2 and re.match(r"^b[0-9]+$", args[1])
              and args[0] in ("verify", "reject", "open", "in_progress",
                              "to_verify", "wont_fix", "validated")):
            # mots inverses : sans ce garde-fou "bug verify b5" part en TEXTE et
            # cree un bug fantome que le journal append-only ne rend jamais (b11)
            sys.exit(f"[PlanTrack] mots inverses — l'id vient en premier : "
                     f"`plantrack bug {args[1]} {args[0]}`"
                     + (f" (ou `plantrack {args[0]} {args[1]}`)"
                        if args[0] in ("verify", "reject") else ""))
        else:
            ecrit(cmd_bug(" ".join(args), st, par="agent"))
    elif cmd == "decide":
        if not args:
            sys.exit("usage : plantrack decide <texte>")
        ecrit(cmd_decide(" ".join(args), par="agent"))
    elif cmd == "piege":
        if not args:
            sys.exit("usage : plantrack piege <texte>")
        ecrit(cmd_piege(" ".join(args)))
    elif cmd == "piege-clos":
        print(cmd_piege_clos(args[0] if args else "", " ".join(args[1:])))
    elif cmd == "question":
        carte, args = arg_carte(args)
        if not args:
            sys.exit("usage : plantrack question [--carte <id_carte>] <texte>")
        ecrit(cmd_question(" ".join(args), st, carte=carte))
    elif cmd == "questions-doublons":
        cmd_questions_doublons(args, st)
    elif cmd == "echecs":
        cmd_echecs(args, st)
    elif cmd == "answer":
        de, args = arg_de(args)
        require_human("answer", de)
        carte, args = arg_carte(args)
        if carte:
            # d96 : le poste ne connait que l'id de sa carte
            qs = [q for q in st["questions"].values() if q.get("carte") == carte and q_ouverte(q)]
            if not qs:
                sys.exit(f"aucune question ouverte pour la carte {carte}.")
            args = [qs[-1]["id"]] + (args or [de or "repondue"])
        if len(args) < 2:
            sys.exit("usage : plantrack answer <question_id>|--carte <id_carte> <texte>")
        qid, text = args[0], " ".join(args[1:])
        q = st["questions"].get(qid)
        if not q:
            sys.exit(f"question introuvable : {qid} — `plantrack status` pour la liste.")
        if q.get("answer"):
            sys.exit(f"{qid} a deja une reponse.")
        append("answer", id=qid, text=text, canal=de)
        print(f"{qid} repondue." + (f" (canal : {trunc(de, 60)})" if de else ""))
    elif cmd == "testcheck":
        if not args:
            sys.exit("usage : plantrack testcheck on|off")
        print(cmd_testcheck(args[0]))
    elif cmd == "guide":
        if args and re.match(r"^g[0-9]+$", args[0]) and args[0] in st["guides"]:
            g = st["guides"][args[0]]
            print(f"{g['id']}  {trunc(g['title'], 80)}")
            for sid in g["steps"]:
                s = st["steps"][sid]
                mark = "✓" if s["verdict"] == "ok" else "✗" if s["verdict"] == "ko" else "·"
                print(f"  {mark} {s['id']}  {trunc(s['text'], 80)}")
                if s.get("attendu"):
                    print(f"        attendu : {trunc(s['attendu'], 80)}")
                if s.get("motif"):
                    print(f"        motif : {trunc(s['motif'], 80)}")
        else:
            print(cmd_guide(" ".join(args), st))
    elif cmd == "step":
        print(cmd_step(" ".join(args), st))
    elif cmd == "check":
        de, args = arg_de(args)
        require_human("check", de)
        if len(args) < 2:
            sys.exit("usage : plantrack check <step_id> ok|ko [-m motif] [--de \"<canal> : <reponse>\"]")
        motif = arg_motif(args, 2) if len(args) > 2 else None
        print(cmd_check(args[0], args[1], motif, st, canal=de))
    elif cmd == "guide-lien":
        if not args:
            sys.exit("usage : plantrack guide-lien <guide_id> --url <page> "
                     "[--poste <base>] [--scenario <id>]")
        print(cmd_guide_lien(args[0], args[1:], st))
    elif cmd == "guide-resultat":
        cmd_guide_resultat(st)
    elif cmd == "attempt":
        cmd_attempt(args, st)
    elif cmd == "attempts":
        cmd_attempts(args, st)
    elif cmd == "file":
        if len(args) < 2 or args[1] not in ("bug", "decision"):
            sys.exit("usage : plantrack file <note_id> bug|decision")
        nid, dest = args[0], args[1]
        note = next((n for n in st["inbox"] if n["id"] == nid), None)
        if not note:
            sys.exit("note introuvable dans l'inbox.")
        append("note_filed", id=nid)
        print(cmd_bug(note["text"], st) if dest == "bug" else cmd_decide(note["text"]))
    elif cmd == "close":
        if not args:
            sys.exit("usage : plantrack close <thread_id>")
        append("close", id=args[0])
        print(f"{args[0]} ferme.")
    elif cmd == "help":
        print(HELP)
    else:
        sys.exit(f"commande inconnue : {cmd}\n{HELP}")


def main():
    if len(sys.argv) < 2:
        cli(["status"])
        return
    entry = sys.argv[1]
    if entry == "hook-prompt":
        hook_prompt()
    elif entry == "hook-filelog":
        hook_filelog()
    elif entry == "hook-pretool":
        hook_pretool()
    elif entry == "hook-context":
        hook_context()
    elif entry == "hook-precompact":
        hook_precompact()
    elif entry == "hook-commit":
        hook_commit()
    else:
        cli(sys.argv[1:])


if __name__ == "__main__":
    main()
