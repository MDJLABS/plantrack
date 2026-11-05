#!/usr/bin/env python3
"""Relais du guide de test mdjlabs vers sa session (choix de Mariella, tel 05/11 : « Le relais »).

mdjlabs-site est un site statique sur Cloudflare Pages : sa Function /api/guide-verdict range
chaque fin de visite dans la base D1 de preview (table guide_verdicts), mais personne ne
prevenait la session — l'ecran de fin disait « Envoye a la session » sans que rien n'arrive.
Ce relais, lance par un minuteur systeme (root), lit les lignes nouvelles et les porte a la
boite aux lettres du poste (POST /guide/point), comme le moteur commun des autres sites.

- Le jeton Cloudflare n'est jamais lu ici : la requete passe par /root/.config/mdj/cf-api.sh.
- Premier passage : on part de la derniere ligne existante, l'historique n'est pas rejoue.
- Le repere n'avance qu'apres un envoi accepte : un poste eteint fait reessayer au tour suivant.
- Ce que Mariella a tape est cite sur une ligne, borne : rien ne peut s'y lire comme une consigne.
"""
import json
import os
import subprocess
import sys
import urllib.request

CF_API = os.environ.get("GUIDE_RELAIS_CF_API", "/root/.config/mdj/cf-api.sh")
COMPTE = "ec93677907b6d62ee290eb1d9def9a16"
BASE_D1 = "1443aa3d-7a47-47e5-9230-1a8519440291"  # mdjlabs_bot_preview (wrangler.toml, env.preview)
PROJET = os.environ.get("GUIDE_RELAIS_PROJET", "/home/mariella/mdjlabs-site")
POSTE = os.environ.get("GUIDE_RELAIS_POSTE", "http://127.0.0.1:8787")
REPERE = os.environ.get("GUIDE_RELAIS_REPERE", "/var/lib/plantrack-guide-relais/mdjlabs.json")
PAR_TOUR = 20


def citer(texte, n=500):
    return " ".join(str(texte).split()).replace("`", "'")[:n]


def requete_d1(sql, params):
    corps = json.dumps({"sql": sql, "params": params})
    sortie = subprocess.run(
        [CF_API, "POST", f"/accounts/{COMPTE}/d1/database/{BASE_D1}/query", corps],
        capture_output=True, text=True, timeout=60, check=True,
    ).stdout
    rep = json.loads(sortie)
    if not rep.get("success"):
        raise RuntimeError(f"D1 : {citer(rep.get('errors'), 300)}")
    return rep["result"][0]["results"]


def texte_avis(ligne):
    try:
        points = json.loads(ligne.get("points") or "{}")
    except ValueError:
        points = {}
    ko = sum(1 for p in points.values() if isinstance(p, dict) and p.get("verdict") == "ko")
    tete = (f"Guide « {citer(ligne.get('scenario_id'), 80)} » terminé (site mdjlabs, relayé depuis "
            f"Cloudflare) : {len(points) - ko} ok, {ko} pas ok.")
    lignes = []
    for i, (pid, p) in enumerate(points.items(), 1):
        p = p if isinstance(p, dict) else {}
        etat = "PAS OK" if p.get("verdict") == "ko" else "ok" if p.get("verdict") == "ok" else "pas encore vu"
        note = f" — « {citer(p['note'])} »" if p.get("note") else ""
        lignes.append(f"{i}. {citer(pid, 80)} : {etat}{note}")
    pied = f"\n\nVisite du {citer(ligne.get('cree_le'), 30)} UTC, depuis {citer(ligne.get('origine') or '?', 120)}."
    return f"{tete}\n\nOù en est le parcours :\n" + "\n".join(lignes) + pied


def avertir(texte):
    req = urllib.request.Request(
        f"{POSTE}/guide/point", method="POST",
        data=json.dumps({"projet": PROJET, "texte": texte}).encode(),
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return 200 <= r.status < 300
    except OSError:
        return False


def lire_repere():
    try:
        return int(json.load(open(REPERE))["dernier"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def ecrire_repere(n):
    os.makedirs(os.path.dirname(REPERE), exist_ok=True)
    tmp = REPERE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"dernier": n}, f)
    os.replace(tmp, REPERE)


def main():
    dernier = lire_repere()
    if dernier is None:
        lignes = requete_d1("SELECT COALESCE(MAX(id), 0) AS m FROM guide_verdicts", [])
        ecrire_repere(int(lignes[0]["m"]))
        print(f"premier passage : repere pose a {lignes[0]['m']}, historique non rejoue")
        return 0
    nouvelles = requete_d1(
        "SELECT id, scenario_id, statut, points, origine, cree_le FROM guide_verdicts "
        "WHERE id > ? AND statut != 'en-cours' ORDER BY id LIMIT ?", [dernier, PAR_TOUR])
    for ligne in nouvelles:
        if not avertir(texte_avis(ligne)):
            print(f"poste injoignable, ligne {ligne['id']} reessayee au prochain tour", file=sys.stderr)
            return 1
        ecrire_repere(int(ligne["id"]))
        print(f"ligne {ligne['id']} ({citer(ligne.get('scenario_id'), 80)}) portee a la session")
    return 0


if __name__ == "__main__":
    sys.exit(main())
