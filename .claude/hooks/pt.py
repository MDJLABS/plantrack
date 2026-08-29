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

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------- configuration

MAX_OPEN_THREADS = 3          # garde-fou : au-dela, le contexte reinjecte enfle
CTX_MAX_CHARS = 3000          # budget dur du bloc reinjecte
CTX_MAX_BUGS = 8
CTX_MAX_DECISIONS = 6
CTX_MAX_FILES = 6
LINE_TRUNC = 140

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
PT_DIR = os.path.join(ROOT, ".plantrack")
LOG = os.path.join(PT_DIR, "events.jsonl")
ARCHIVE = os.path.join(PT_DIR, "transcripts")


# ---------------------------------------------------------------------- journal

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def append(kind, **fields):
    os.makedirs(PT_DIR, exist_ok=True)
    ev = {"ts": now(), "kind": kind}
    ev.update({k: v for k, v in fields.items() if v is not None})
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    return ev


def read_events():
    if not os.path.exists(LOG):
        return []
    out = []
    with open(LOG, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # une ligne corrompue ne doit jamais casser une session
    return out


# -------------------------------------------------------------------- projection

def project():
    """Rejoue le journal et renvoie l'etat courant."""
    st = {"threads": {}, "bugs": {}, "decisions": [], "inbox": [], "active": None,
          "phases": {}, "tasks": {}}
    for ev in read_events():
        k = ev.get("kind")
        if k == "thread_open":
            st["threads"][ev["id"]] = {
                "id": ev["id"], "label": ev.get("text", ""), "status": "active",
                "note": "", "files": [], "ts": ev["ts"], "task": ev.get("task"),
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
            }
        elif k == "bug_status":
            b = st["bugs"].get(ev["id"])
            if b:
                b["status"] = ev.get("status", b["status"])
                if ev.get("text"):
                    b["notes"].append(ev["text"])
                    # un rejet motive s'attache a la derniere tentative (§9)
                    if ev.get("status") == "open" and b["attempts"]:
                        b["attempts"][-1]["rejected"] = re.sub(r"^rejete : ", "", ev["text"])
        elif k == "attempt":
            b = st["bugs"].get(ev.get("bug"))
            if b:
                b["attempts"].append({
                    "id": ev["id"], "hypothesis": ev.get("text", ""),
                    "ts": ev["ts"], "rejected": None,
                })
        elif k == "decision":
            st["decisions"].append({"id": ev["id"], "text": ev.get("text", ""), "ts": ev["ts"]})
        elif k == "note":
            st["inbox"].append({"id": ev["id"], "text": ev.get("text", ""), "ts": ev["ts"]})
        elif k == "note_filed":
            st["inbox"] = [n for n in st["inbox"] if n["id"] != ev["id"]]
        elif k == "phase_open":
            st["phases"][ev["id"]] = {
                "id": ev["id"], "title": ev.get("text", ""), "goal": ev.get("goal", ""),
                "status": "open", "ts": ev["ts"],
            }
        elif k == "phase_status":
            p = st["phases"].get(ev["id"])
            if p:
                p["status"] = ev.get("status", p["status"])
                if ev.get("text"):
                    p["motif"] = ev["text"]
        elif k == "task_open":
            st["tasks"][ev["id"]] = {
                "id": ev["id"], "phase": ev.get("phase"), "text": ev.get("text", ""),
                "status": "todo", "ts": ev["ts"],
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


def trunc(s, n=LINE_TRUNC):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "\u2026"


# ------------------------------------------------------------- bloc de contexte

def context_block(st, header=True):
    L = []
    if header:
        L.append("== PlanTrack — etat persistant du projet ==")
        L.append("(reinjecte automatiquement, y compris apres compaction du contexte)")

    blockers = [b for b in st["bugs"].values()
                if b.get("blocking") and b["status"] not in ("validated", "wont_fix")]
    if blockers:
        ids = " ; ".join(f"{b['id']} {trunc(b['text'], 50)}" for b in blockers[:2])
        L.append(f"\n!! BUG BLOQUANT — a traiter avant toute autre chose : {ids}")

    a = st["threads"].get(st["active"]) if st["active"] else None
    if a:
        tag = f" [{a['task']}]" if a.get("task") else ""
        L.append(f"\nFIL ACTIF — {a['id']}{tag} : {trunc(a['label'])}")
        if a["files"]:
            L.append("  fichiers recemment ecrits : " + ", ".join(a["files"][-CTX_MAX_FILES:]))
    else:
        L.append("\nFIL ACTIF : aucun. Demande a l'utilisateur de faire `!focus <sujet>` avant de coder.")

    parked = [t for t in st["threads"].values() if t["status"] == "parked"]
    if parked:
        L.append("\nFILS EN PAUSE (ne pas y toucher sans reprise explicite) :")
        for t in parked:
            L.append(f"  {t['id']} : {trunc(t['label'], 60)} — reprise : {trunc(t['note'] or 'aucune note', 110)}")

    bugs = [b for b in st["bugs"].values() if b["status"] in ("open", "in_progress", "to_verify")]
    if bugs:
        L.append("\nBUGS OUVERTS (ne pas traiter maintenant, sauf demande explicite) :")
        for b in bugs[-CTX_MAX_BUGS:]:
            th = f"[{b['thread']}] " if b.get("thread") else ""
            L.append(f"  {b['id']} ({b['status']}) {th}{trunc(b['text'])}")

    if st["decisions"]:
        L.append("\nDECISIONS ACTEES (ne jamais revenir dessus ni reimplementer) :")
        for d in st["decisions"][-CTX_MAX_DECISIONS:]:
            L.append(f"  {d['id']} : {trunc(d['text'])}")

    if st["inbox"]:
        L.append(f"\nINBOX NON CLASSEE : {len(st['inbox'])} element(s), voir `plantrack inbox`.")

    L.append(
        "\nREGLES : tu ne valides jamais un bug toi-meme (statut maximum : to_verify). "
        "Tu ne reimplementes rien qui figure sous DECISIONS ACTEES. "
        "Tu ne modifies pas les fichiers d'un fil en pause."
    )
    out = "\n".join(L)
    if len(out) > CTX_MAX_CHARS:
        out = out[:CTX_MAX_CHARS] + "\n[...tronque — budget de contexte atteint]"
    return out


# ---------------------------------------------------------------------- commandes

def cmd_bug(text, st):
    if not text:
        return "usage : !bug <description> [--low|--high|--blocker]"
    severity = "normal"
    m = re.search(r"\s*--(low|high|blocker)\b", text)
    if m:
        severity = m.group(1)
        text = (text[:m.start()] + text[m.end():]).strip()
    if not text:
        return "usage : !bug <description> [--low|--high|--blocker]"
    bid = next_id("b")
    append("bug", id=bid, text=text, thread=st["active"], severity=severity,
           blocking=True if severity == "blocker" else None)
    sev = f" [{severity}]" if severity != "normal" else ""
    return f"[PlanTrack] bug {bid}{sev} enregistre : {trunc(text, 80)}\n(non traite pour l'instant — il sera rappele a chaque session)"


def cmd_decide(text):
    if not text:
        return "usage : !decide <ce qui est decide> — <motif>"
    did = next_id("d")
    append("decision", id=did, text=text)
    return f"[PlanTrack] decision {did} actee : {trunc(text, 80)}"


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
  !state              affiche l'etat persistant courant
  !<texte libre>      capture dans l'inbox, a classer plus tard
CLI humaine : plantrack status | bugs | inbox | verify <id> | reject <id> -m ... | close <id>
              plantrack attempt <bug_id> <hypothese> | attempts <bug_id>
              plantrack bug <id> open|in_progress|to_verify|wont_fix   (wont_fix : humain seul)
              plantrack plan [import <f.md>] | decisions
              plantrack phase add|start|done|cancel   (done/cancel : humain seul)
              plantrack task add|start|verify|done|cancel|replace   (done/cancel/replace : humain seul)
              plantrack init [--git-hook] [--agent claude|codex|gemini]   installation vendoree
              plantrack doctor   verifie l'installation | plantrack stats   usage sur 14 jours"""


# -------------------------------------------------------------------------- hooks

def read_hook_input():
    try:
        return json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        return {}


def hook_prompt():
    """UserPromptSubmit. Les commandes '!' sont capturees puis le prompt est
    rejete (exit 2) : l'agent ne les voit jamais, son contexte reste propre."""
    data = read_hook_input()
    prompt = (data.get("prompt") or "").strip()
    if not prompt.startswith("!"):
        sys.exit(0)
    try:
        msg = handle_command(prompt[1:])
    except Exception as e:  # un hook ne doit jamais bloquer une session
        msg = f"[PlanTrack] erreur : {e}"
    print(msg, file=sys.stderr)
    sys.exit(2)


def hook_filelog():
    """PostToolUse sur les outils d'ecriture : journalise le fichier touche."""
    data = read_hook_input()
    ti = data.get("tool_input") or {}
    path = ti.get("file_path") or ti.get("path") or ti.get("notebook_path")
    if not path:
        sys.exit(0)
    st = project()
    if not st["active"]:
        sys.exit(0)
    try:
        path = os.path.relpath(path, ROOT)
    except ValueError:
        pass
    append("file_touched", text=path, thread=st["active"])
    sys.exit(0)


def hook_context():
    """SessionStart. stdout est injecte comme contexte visible par l'agent."""
    data = read_hook_input()
    src = data.get("source", "startup")
    st = project()
    if not any([st["threads"], st["bugs"], st["decisions"]]):
        sys.exit(0)
    if src == "compact":
        print("(contexte compacte — etat du projet reinjecte depuis PlanTrack)")
    print(context_block(st))
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
        except OSError:
            pass
    sys.exit(0)


# ---------------------------------------------------------------------- CLI

AGENT_ENV = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")


GIT_HOOK = "#!/bin/sh\n# installe par plantrack init --git-hook\nexec python3 .claude/hooks/pt.py precommit\n"

WRAPPER = '#!/bin/sh\nexec python3 "$(dirname "$0")/.claude/hooks/pt.py" "$@"\n'

SETTINGS = {"hooks": {
    "UserPromptSubmit": [{"hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-prompt"}]}],
    "PostToolUse": [{"matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-filelog"}]}],
    "SessionStart": [{"hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-context"}]}],
    "PreCompact": [{"hooks": [
        {"type": "command", "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/pt.py\" hook-precompact"}]}],
}}

MD_BLOCK = """<!-- plantrack:start -->
## PlanTrack
- L'état du projet t'est injecté automatiquement en début de session et après chaque compaction. Fie-toi à ce bloc, pas à ta mémoire de la conversation.
- Ne réimplémente jamais ce qui figure sous DECISIONS ACTEES.
- Ne modifie pas les fichiers d'un fil en pause.
- Après correction d'un bug : consigne la tentative, puis passe-le en "to_verify". Tu ne valides jamais un bug toi-même.
<!-- plantrack:end -->
"""


def install_git_hook():
    if not os.path.isdir(os.path.join(ROOT, ".git")):
        sys.exit("[PlanTrack] pas de depot git ici — lance `git init` d'abord.")
    hook = os.path.join(ROOT, ".git", "hooks", "pre-commit")
    if os.path.exists(hook):
        sys.exit(f"[PlanTrack] {hook} existe deja — fusionne a la main, rien n'a ete ecrit.")
    os.makedirs(os.path.dirname(hook), exist_ok=True)
    with open(hook, "w", encoding="utf-8") as f:
        f.write(GIT_HOOK)
    os.chmod(hook, 0o755)
    print("[PlanTrack] hook pre-commit installe (contournement : git commit --no-verify).")


def cmd_init(args):
    """§13 : installation vendoree dans le projet courant (CLAUDE_PROJECT_DIR ou cwd).
    Copie pt.py, ecrit settings.json + wrapper, insere le bloc d'instructions.
    `--git-hook` seul n'installe que le garde-fou git (comportement v0.5)."""
    known = {"--git-hook", "--agent"}
    if any(a.startswith("--") and a not in known for a in args):
        sys.exit("usage : plantrack init [--git-hook] [--agent claude|codex|gemini]")
    agent = "claude"
    if "--agent" in args:
        i = args.index("--agent")
        agent = args[i + 1] if len(args) > i + 1 else ""
        if agent not in ("claude", "codex", "gemini"):
            sys.exit("usage : plantrack init [--git-hook] [--agent claude|codex|gemini]")
    if args == ["--git-hook"]:
        install_git_hook()
        return

    # 1. copie vendoree du coeur
    src = os.path.abspath(__file__)
    dst = os.path.join(ROOT, ".claude", "hooks", "pt.py")
    if os.path.abspath(dst) != src:
        if os.path.exists(dst):
            with open(dst, encoding="utf-8") as f:
                same = f.read() == open(src, encoding="utf-8").read()
            if not same:
                sys.exit(f"[PlanTrack] {dst} existe avec un contenu different — rien n'a ete "
                         "ecrit. Supprime-le pour reinstaller (ton journal .plantrack/ est intact).")
            print("pt.py deja en place (identique).")
        else:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy(src, dst)
            os.chmod(dst, 0o755)
            print(f"pt.py copie dans {os.path.relpath(dst, ROOT)}.")

    # 2. les 4 hooks Claude Code
    settings = os.path.join(ROOT, ".claude", "settings.json")
    if os.path.exists(settings):
        with open(settings, encoding="utf-8") as f:
            has_pt = "pt.py" in f.read()
        print("settings.json deja en place." if has_pt else
              "[PlanTrack] .claude/settings.json existe sans les hooks pt.py — fusionne le "
              "bloc `hooks` a la main (voir README), rien n'a ete ecrase.")
    else:
        os.makedirs(os.path.dirname(settings), exist_ok=True)
        with open(settings, "w", encoding="utf-8") as f:
            json.dump(SETTINGS, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("settings.json ecrit (4 hooks).")
    if agent != "claude":
        print(f"[PlanTrack] agent {agent} : hooks non traduits automatiquement pour l'instant — "
              "la CLI, le bloc d'instructions et le pre-commit git tiennent (mode degrade, §13).")

    # 3. wrapper CLI humaine
    wrapper = os.path.join(ROOT, "plantrack")
    if not os.path.exists(wrapper):
        with open(wrapper, "w", encoding="utf-8") as f:
            f.write(WRAPPER)
        os.chmod(wrapper, 0o755)
        print("wrapper ./plantrack ecrit.")

    # 4. bloc d'instructions entre marqueurs, sans ecraser l'existant
    md = os.path.join(ROOT, "CLAUDE.md" if agent == "claude" else "AGENTS.md")
    for candidate in ("CLAUDE.md", "AGENTS.md"):
        if os.path.exists(os.path.join(ROOT, candidate)):
            md = os.path.join(ROOT, candidate)
            break
    existing = ""
    if os.path.exists(md):
        with open(md, encoding="utf-8") as f:
            existing = f.read()
    if "<!-- plantrack:start -->" in existing:
        print(f"bloc d'instructions deja present dans {os.path.basename(md)}.")
    else:
        with open(md, "a", encoding="utf-8") as f:
            f.write(("\n" if existing and not existing.endswith("\n") else "") + MD_BLOCK)
        print(f"bloc d'instructions insere dans {os.path.basename(md)}.")

    # 5. transcripts gitignores
    gi = os.path.join(ROOT, ".gitignore")
    line = ".plantrack/transcripts/"
    content = ""
    if os.path.exists(gi):
        with open(gi, encoding="utf-8") as f:
            content = f.read()
    if line not in content:
        with open(gi, "a", encoding="utf-8") as f:
            f.write(("\n" if content and not content.endswith("\n") else "") + line + "\n")
        print(".gitignore : transcripts exclus.")

    if "--git-hook" in args:
        install_git_hook()
    print("[PlanTrack] installation terminee. Redemarre l'agent puis verifie avec /hooks.")


def cmd_precommit():
    """Garde-fou §10-A : le commit echoue si un fichier stage appartient a un fil
    parque. S'etendra aux taches cancelled/replaced avec la couche 2."""
    try:
        out = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            capture_output=True, text=True, cwd=ROOT, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        sys.exit(0)  # pas de git exploitable : ne jamais bloquer un commit legitime
    staged = {l.strip() for l in out.splitlines() if l.strip()}
    st = project()
    blocked = False
    for t in st["threads"].values():
        task = st["tasks"].get(t.get("task")) if t.get("task") else None
        frozen = task and task["status"] in ("cancelled", "replaced")
        if t["status"] != "parked" and not frozen:
            continue
        for f in sorted(staged & set(t["files"])):
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
        print("Contournement : git commit --no-verify")
        sys.exit(1)
    sys.exit(0)


def cmd_doctor(st):
    """§12 : hooks installes, journal lisible, budget de contexte."""
    probs = 0

    def chk(good, label, fix=""):
        nonlocal probs
        if good:
            print(f"  ok  {label}")
        else:
            probs += 1
            print(f"  !!  {label}" + (f" — {fix}" if fix else ""))

    chk(os.path.exists(os.path.join(ROOT, ".claude", "hooks", "pt.py")),
        "coeur vendorise (.claude/hooks/pt.py)", "lance `plantrack init`")
    settings = os.path.join(ROOT, ".claude", "settings.json")
    txt = ""
    if os.path.exists(settings):
        with open(settings, encoding="utf-8") as f:
            txt = f.read()
    for h in ("hook-prompt", "hook-filelog", "hook-context", "hook-precompact"):
        chk(h in txt, f"hook {h} declare dans settings.json", "lance `plantrack init`")
    if os.path.isdir(os.path.join(ROOT, ".git")):
        hook = os.path.join(ROOT, ".git", "hooks", "pre-commit")
        htxt = ""
        if os.path.exists(hook):
            with open(hook, encoding="utf-8") as f:
                htxt = f.read()
        chk("pt.py precommit" in htxt, "garde-fou git pre-commit",
            "lance `plantrack init --git-hook`")
    if os.path.exists(LOG):
        with open(LOG, encoding="utf-8") as f:
            raw = sum(1 for l in f if l.strip())
        parsed = len(read_events())
        chk(raw == parsed, f"journal lisible ({parsed}/{raw} lignes)",
            f"{raw - parsed} ligne(s) corrompue(s) ignoree(s) au rejeu")
    else:
        print("  --  aucun journal encore (.plantrack/events.jsonl)")
    n = len(context_block(st))
    chk(n <= CTX_MAX_CHARS, f"bloc reinjecte sous le budget ({n}/{CTX_MAX_CHARS} chars)",
        "le bloc sera tronque — ferme des fils ou valide des bugs")
    sys.exit(1 if probs else 0)


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
    if len(args) < 2 or args[1] not in st["phases"]:
        sys.exit("usage : plantrack phase add|start|done|cancel <id> [-m motif]")
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
        sys.exit("usage : plantrack phase add|start|done|cancel <id> [-m motif]")


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
        require_human("task done")
        append("task_status", id=kid, status="done")
        print(f"tache {kid} terminee.")
    elif sub == "cancel":
        require_human("task cancel")
        motif = arg_motif(args, 2)
        append("task_status", id=kid, status="cancelled", text=motif)
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
    hyp = " ".join(args[1:])
    for a in b["attempts"]:
        ratio = difflib.SequenceMatcher(None, _norm(hyp), _norm(a["hypothesis"])).ratio()
        if ratio > SIMILAR:
            rej = (f"\n  motif du rejet : {trunc(a['rejected'], 100)}"
                   if a.get("rejected") else "")
            sys.exit(f"[PlanTrack] refuse : hypothese deja tentee sur {b['id']} "
                     f"({a['id']}, similarite {ratio:.2f}) : {trunc(a['hypothesis'], 80)}{rej}\n"
                     "Change d'angle au lieu de retenter la meme piste.")
    aid = next_id("a")
    append("attempt", id=aid, bug=b["id"], text=hyp)
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
    if len(args) < 2:
        sys.exit("usage : plantrack bug <id> open|in_progress|to_verify|wont_fix [-m motif]")
    b, target = get_bug(st, args[0]), args[1]
    if b["status"] in BUG_TERMINAL:
        sys.exit(f"refuse : {b['id']} est {b['status']} (etat terminal, le journal ne s'efface pas).")
    if target == "validated":
        sys.exit("[PlanTrack] \"validated\" est reserve a l'humain, via `plantrack verify`. "
                 "Passe le bug en \"to_verify\" et signale-le dans ta reponse.")
    if target == "wont_fix":
        require_human("bug wont_fix")
        motif = arg_motif(args, 2)
        append("bug_status", id=b["id"], status="wont_fix", text="wont_fix : " + motif)
        print(f"{b['id']} classe wont_fix (motif conserve).")
    elif target in ("open", "in_progress", "to_verify"):
        append("bug_status", id=b["id"], status=target)
        print(f"{b['id']} -> {target}.")
    else:
        sys.exit("statuts : open | in_progress | to_verify | wont_fix (validated : via `plantrack verify`)")


def require_human(cmd):
    """O6 : ecrire un verdict est reserve a l'humain. Refus deterministe quand
    la CLI est invoquee depuis un shell pilote par l'agent (env Claude Code)."""
    if any(os.environ.get(v) for v in AGENT_ENV):
        sys.exit(
            f"[PlanTrack] refuse : `{cmd}` est reserve a l'humain (environnement agent detecte).\n"
            "Propose l'action dans ta reponse (statut maximum pour toi : to_verify / in_progress) ; "
            "l'humain tranchera via la CLI `plantrack`."
        )


def cli(argv):
    st = project()
    cmd = argv[0] if argv else "status"
    args = argv[1:]

    if cmd == "status":
        print(context_block(st))
    elif cmd == "init":
        cmd_init(args)
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
                    print(f"   {t['id']:>4}  {t['status']:<12} {trunc(t['text'], 60)}{rb}")
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
        cmd_doctor(st)
    elif cmd == "stats":
        cmd_stats()
    elif cmd == "bugs":
        rows = [b for b in st["bugs"].values() if b["status"] not in BUG_TERMINAL]
        if not rows:
            print("aucun bug ouvert.")
        for b in rows:
            sev = f" [{b['severity']}]" if b.get("severity", "normal") != "normal" else ""
            na = f" ({len(b['attempts'])} tentative(s))" if b["attempts"] else ""
            print(f"{b['id']:>4}  {b['status']:<11}{sev} {trunc(b['text'], 90)}{na}")
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
    elif cmd == "verify":
        require_human("verify")
        b = get_bug(st, args[0] if args else "")
        if b["status"] != "to_verify":
            sys.exit(f"refuse : {b['id']} est \"{b['status']}\" — seul un bug \"to_verify\" "
                     "se valide (machine a etats §9).")
        append("bug_status", id=b["id"], status="validated")
        print(f"{b['id']} valide.")
    elif cmd == "reject":
        require_human("reject")
        if len(args) < 3 or args[1] != "-m":
            sys.exit("usage : plantrack reject <bug_id> -m \"pourquoi ca ne marche pas\"")
        b = get_bug(st, args[0])
        if b["status"] != "to_verify":
            sys.exit(f"refuse : {b['id']} est \"{b['status']}\" — on ne rejette qu'un bug "
                     "\"to_verify\" (machine a etats §9).")
        append("bug_status", id=b["id"], status="open", text="rejete : " + " ".join(args[2:]))
        extra = " (motif attache a la derniere tentative)" if b["attempts"] else ""
        print(f"{b['id']} rouvert avec motif{extra}.")
    elif cmd == "bug":
        cmd_bug_status(args, st)
    elif cmd == "attempt":
        cmd_attempt(args, st)
    elif cmd == "attempts":
        cmd_attempts(args, st)
    elif cmd == "file":
        if len(args) < 2:
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
    elif entry == "hook-context":
        hook_context()
    elif entry == "hook-precompact":
        hook_precompact()
    else:
        cli(sys.argv[1:])


if __name__ == "__main__":
    main()
