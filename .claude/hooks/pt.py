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

import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone

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
    st = {"threads": {}, "bugs": {}, "decisions": [], "inbox": [], "active": None}
    for ev in read_events():
        k = ev.get("kind")
        if k == "thread_open":
            st["threads"][ev["id"]] = {
                "id": ev["id"], "label": ev.get("text", ""), "status": "active",
                "note": "", "files": [], "ts": ev["ts"],
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
            }
        elif k == "bug_status":
            b = st["bugs"].get(ev["id"])
            if b:
                b["status"] = ev.get("status", b["status"])
                if ev.get("text"):
                    b["notes"].append(ev["text"])
        elif k == "decision":
            st["decisions"].append({"id": ev["id"], "text": ev.get("text", ""), "ts": ev["ts"]})
        elif k == "note":
            st["inbox"].append({"id": ev["id"], "text": ev.get("text", ""), "ts": ev["ts"]})
        elif k == "note_filed":
            st["inbox"] = [n for n in st["inbox"] if n["id"] != ev["id"]]
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

    a = st["threads"].get(st["active"]) if st["active"] else None
    if a:
        L.append(f"\nFIL ACTIF — {a['id']} : {trunc(a['label'])}")
        if a["files"]:
            L.append("  fichiers recemment ecrits : " + ", ".join(a["files"][-CTX_MAX_FILES:]))
    else:
        L.append("\nFIL ACTIF : aucun. Demande a l'utilisateur de faire `!focus <sujet>` avant de coder.")

    parked = [t for t in st["threads"].values() if t["status"] == "parked"]
    if parked:
        L.append("\nFILS EN PAUSE (ne pas y toucher sans reprise explicite) :")
        for t in parked:
            L.append(f"  {t['id']} : {trunc(t['label'], 60)} — reprise : {trunc(t['note'] or 'aucune note', 110)}")

    bugs = [b for b in st["bugs"].values() if b["status"] in ("open", "to_verify")]
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
        return "usage : !bug <description>"
    bid = next_id("b")
    append("bug", id=bid, text=text, thread=st["active"])
    return f"[PlanTrack] bug {bid} enregistre : {trunc(text, 80)}\n(non traite pour l'instant — il sera rappele a chaque session)"


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
  !bug <texte>        enregistre un bug, sans interrompre le fil en cours
  !decide <texte>     acte une decision (elle sera rappelee a chaque session)
  !focus <sujet|id>   ouvre ou reprend un fil de travail
  !park <note>        met le fil actif en pause avec une note de reprise (obligatoire)
  !close              ferme le fil actif
  !state              affiche l'etat persistant courant
  !<texte libre>      capture dans l'inbox, a classer plus tard
CLI humaine : plantrack status | bugs | inbox | verify <id> | reject <id> -m ... | close <id>"""


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


def require_human(cmd):
    """O6 : ecrire un verdict est reserve a l'humain. Refus deterministe quand
    la CLI est invoquee depuis un shell pilote par l'agent (env Claude Code)."""
    if any(os.environ.get(v) for v in AGENT_ENV):
        sys.exit(
            f"[PlanTrack] refuse : `{cmd}` est reserve a l'humain (environnement agent detecte).\n"
            "Signale dans ta reponse que le correctif est pret a verifier ; "
            "l'humain tranchera avec `plantrack verify` ou `plantrack reject -m ...`."
        )


def cli(argv):
    st = project()
    cmd = argv[0] if argv else "status"
    args = argv[1:]

    if cmd == "status":
        print(context_block(st))
    elif cmd == "bugs":
        rows = [b for b in st["bugs"].values() if b["status"] != "validated"] or []
        if not rows:
            print("aucun bug ouvert.")
        for b in rows:
            print(f"{b['id']:>4}  {b['status']:<10} {trunc(b['text'], 90)}")
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
        if not args or args[0] not in st["bugs"]:
            sys.exit("usage : plantrack verify <bug_id>")
        append("bug_status", id=args[0], status="validated")
        print(f"{args[0]} valide.")
    elif cmd == "reject":
        require_human("reject")
        if len(args) < 3 or args[1] != "-m":
            sys.exit("usage : plantrack reject <bug_id> -m \"pourquoi ca ne marche pas\"")
        append("bug_status", id=args[0], status="open", text="rejete : " + " ".join(args[2:]))
        print(f"{args[0]} rouvert avec motif.")
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
