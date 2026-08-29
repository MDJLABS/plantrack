# Rapport de terrain — `plantrack init` n'installe pas les hooks sur Claude Code

> Écrit le 2026-08-29 depuis le dépôt **miamboost**, où PlanTrack v1.3.0 a été installé
> le 29/08 à 17:20. Constaté en jouant l'installation, pas déduit de la lecture du code.
> Copie vendorée `.claude/hooks/pt.py` **identique** à la source (`diff -q` muet) :
> les trois défauts ci-dessous sont dans la v1.3.0.

## Le symptôme

Installé sur miamboost le 29/08 à 17:20, PlanTrack n'a **pas tourné une seule fois sous
Claude Code**. Dès la première session qui a suivi — celle d'où j'écris — le bloc
d'instructions `AGENTS.md` était bien présent dans mon contexte, donc la phrase « l'état
du projet t'est injecté automatiquement en début de session » aussi, alors qu'**aucun état
n'était injecté et qu'aucun `!bug` / `!decide` n'aurait été capté**. Les hooks n'étaient
déclarés que dans `.codex/hooks.json`. Rien à l'écran ne le signalait : c'est l'utilisatrice
qui a demandé « est-ce que tu l'as pris en compte ? », et il a fallu aller lire
`settings.json` pour répondre.

C'est le pire des deux mondes : l'agent lit une règle qui affirme qu'un état existe, ne
voit pas de bloc, et peut raisonnablement en conclure « ce projet n'a rien à me dire ».
Un échec silencieux qui **ressemble à un projet vierge**.

## Défaut 1 — `init --git-hook` fait MOINS que `init` (retour anticipé)

`pt.py:628`, dans `cmd_init` :

```python
if args == ["--git-hook"]:
    install_git_hook()
    return
```

`--git-hook` est le **seul** argument que la commande accepte (`--agent` est obsolète).
Donc `args == ["--git-hook"]` est vrai à chaque fois qu'on passe le drapeau : la forme
**documentée par l'aide** — `plantrack init [--git-hook]` — n'installe *que* le garde-fou
git et retourne. Elle ne copie pas le cœur, n'écrit aucun fichier de hooks, ne pose aucun
bloc d'instructions.

Le chemin combiné existe pourtant, 60 lignes plus bas :

```python
if "--git-hook" in args:
    install_git_hook()
print("[PlanTrack] installation terminee. ...")
```

Il est **mort** : aucune valeur d'`args` ne peut l'atteindre. Le commentaire de la
docstring (« `--git-hook` seul n'installe que le garde-fou git (comportement v0.5) ») décrit
une intention qui n'est plus atteignable, parce que « seul » est devenu « toujours ».

**Ce que ça donne à l'usage** : l'utilisateur lit l'aide, choisit la forme la plus complète,
et obtient la plus incomplète — en silence, avec un message de succès (`hook pre-commit
installe`). C'est exactement ce qui s'est passé ici.

**Correctif** : supprimer le retour anticipé. Le bloc de fin gère déjà le cas.
Si l'on tient à garder « le garde-fou git seul », lui donner sa propre sous-commande
(`plantrack init-git-hook`) plutôt qu'un drapeau d'une commande qui fait autre chose.

## Défaut 2 — `write_hooks_file` n'écrit jamais dans un `settings.json` existant

`pt.py:599-615` :

```python
if os.path.exists(path):
    ...
    print(f"[PlanTrack] {label} existe sans les hooks {...} — fusionne le bloc `hooks` "
          "a la main (voir README), rien n'a ete ecrase.")
else:
    ... json.dump(obj, ...)
```

Le refus d'écraser est juste. Le problème est ce qui le remplace : **rien**.

Or `.claude/settings.json` **existe dans quasiment tout projet Claude Code réel** — il
suffit d'un plugin activé, d'une permission, d'un `model`. Sur miamboost il ne contenait
que ceci :

```json
{ "enabledPlugins": { "cloudflare@claude-plugins-official": true } }
```

Trois lignes sans le moindre `hooks`, et l'installation automatique s'arrête là. La
conséquence est asymétrique et explique tout le symptôme : **Codex marche parce que
`.codex/hooks.json` n'existe presque jamais**, Claude Code échoue parce que
`.claude/settings.json` existe presque toujours. L'installateur réussit donc précisément
sur l'agent le moins répandu.

Ce n'est pas un cas de fusion difficile : `hooks` est un objet dont les clés sont des
noms d'événements et les valeurs des **listes**. La fusion additive tient en cinq lignes,
préserve les hooks déjà présents, et n'écrase rien :

```python
d = json.load(open(path))
d.setdefault("hooks", {})
for evt, entries in obj["hooks"].items():
    d["hooks"].setdefault(evt, []).extend(entries)
```

(C'est littéralement ce que j'ai dû écrire à la main pour débloquer miamboost.)

**Correctif** : fusionner quand le fichier existe. Deux précautions qui manqueront sinon :
- **idempotence** — ne pas ré-ajouter une entrée déjà présente (comparer sur la `command`),
  sinon un second `init` fait tourner chaque hook deux fois ;
- **écriture atomique** — `settings.json` est un fichier que l'utilisateur édite aussi ;
  écrire dans un temporaire puis `os.replace`, et sauvegarder l'original.

À défaut de fusionner, le message doit au minimum **imprimer le bloc JSON à coller**.
Renvoyer vers « voir README » quand on a l'objet exact sous la main fait porter à
l'utilisateur un travail que le programme peut faire.

## Défaut 3 — le succès et le diagnostic mentent tous les deux

Deux messages, chacun anodin seul, qui ensemble ferment la boucle :

1. `cmd_init` imprime **« [PlanTrack] installation terminee. Redemarre l'agent puis
   verifie avec /hooks. »** même quand `write_hooks_file` vient d'annoncer qu'il n'a rien
   écrit. L'utilisateur redémarre, ne voit rien venir, et cherche la panne ailleurs —
   dans Claude Code, pas dans l'installateur.

2. `doctor` affiche, pour chacun des quatre hooks absents :
   **« hook hook-prompt declare dans settings.json — lance `plantrack init` »**.
   Le remède proposé est la commande qui vient d'échouer. Suivi à la lettre, il **boucle**.

`doctor` est par ailleurs le point fort de l'outil : c'est lui qui m'a permis de voir en
une ligne que les hooks n'existaient que côté Codex — un diagnostic que je n'aurais pas
posé seul. D'où l'importance que son remède soit juste.

**Correctif** : que `cmd_init` retienne si une étape a échoué et termine sur
« installation INCOMPLETE — il reste X à faire » ; que `doctor` propose la fusion (ou la
commande qui la fait), pas `init`.

## Ce que j'ai fait pour débloquer miamboost

1. `plantrack init --git-hook` → garde-fou git posé, **rien d'autre** (défaut 1).
2. `plantrack init` → refus sur `.claude/settings.json` (défaut 2).
3. Fusion manuelle du bloc `hooks` de `SETTINGS` dans `.claude/settings.json`, en
   préservant `enabledPlugins`.
4. `plantrack doctor` → les 13 lignes au vert.
5. Cycle vérifié de bout en bout, pas seulement le doctor :
   `echo '{"prompt":"!decide ..."}' | pt.py hook-prompt` → `decision d1 actee`, puis
   `pt.py hook-context` → le bloc d'état ressort avec `d1` dedans.

L'installation est donc fonctionnelle **sur ce dépôt**. Ce rapport ne demande rien pour
miamboost : il porte sur ce que le prochain `init` fera chez quelqu'un d'autre.

## Priorité suggérée

Le défaut 2 est le seul qui **rend l'outil silencieusement inopérant sur son agent
principal** — c'est lui qui décide si PlanTrack tourne ou non. Le défaut 1 est un
one-liner. Le défaut 3 est ce qui fait qu'on ne s'en aperçoit pas : l'installation annonce
un succès, le diagnostic renvoie vers la commande qui vient d'échouer, et il faut ouvrir
`settings.json` pour voir qu'il ne s'est rien passé.
