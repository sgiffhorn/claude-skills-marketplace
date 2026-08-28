---
description: Zeigt alle offenen Handoffs repo-übergreifend und spawnt daraus Chip-Sessions
---

Zentraler Rückstand über **alle** Repos. Quelle ist ausschließlich das
Handoff-Verzeichnis (`$HANDOFF_DIR`, siehe unten) — eine Datei pro offener Aufgabe,
`<repo>__<slug>.md`.

**Der Index wird immer frisch aus dem Verzeichnis gelesen, nie gespeichert.** Eine
gepflegte Indexdatei driftet garantiert von den Handoffs weg; das Verzeichnis ist die
einzige Wahrheit.

## Handoff-Verzeichnis ermitteln (einmalig, dann gemerkt)

Vor allem anderen: **`$HANDOFF_DIR`** bestimmen, in dieser Reihenfolge —

1. Env-Var `CLAUDE_HANDOFFS_DIR`, falls gesetzt.
2. Sonst die erste nicht-leere Zeile aus `~/.claude/handoffs-dir`, falls die Datei
   existiert.
3. Sonst: einmalig nachfragen, wo das zentrale, repo-übergreifende Handoff-Verzeichnis
   liegen soll (sinnvoller Vorschlag: ein `_handoffs`-Ordner neben dem Wurzelverzeichnis,
   unter dem die Repos liegen). Nach der Antwort das Verzeichnis anlegen
   (`mkdir -p "$HANDOFF_DIR/done"`) und den Pfad nach `~/.claude/handoffs-dir` schreiben
   (eine Zeile, der reine Pfad), damit künftige Aufrufe — auch von `/handoff` — nicht
   erneut fragen.

Jede weitere Erwähnung von `_handoffs/…` in diesem Dokument meint `$HANDOFF_DIR/…`.

## Frontmatter-Vertrag

Jede Datei beginnt mit:

```yaml
---
title: <Kurztitel, eine Zeile>
repo: <verzeichnisname unter ~/Documents/Coding, klein>
status: open | running | done
created: YYYY-MM-DD
next: <ein Imperativsatz: der erste konkrete Schritt>
---
```

`running` heißt: eine Chip-Session arbeitet bereits an dieser Aufgabe. Beim Wechsel nach
`running` zusätzlich `running-since: <YYYY-MM-DD HH:MM>` (lokale Zeit) eintragen — das ist
die einzige Grundlage, um später eine hängengebliebene `running`-Aufgabe zu erkennen.

Fehlt die Frontmatter, behandle die Datei als `status: open` und weise beim Auflisten
darauf hin — nie stillschweigend überspringen. Ist `next` leer, zeige `(kein nächster
Schritt notiert)` statt einer Leerzeile; das ist ein Mangel an der Datei, kein Grund,
den Eintrag zu verstecken.

`README.md` ist die Konventionsbeschreibung des Verzeichnisses und wird nie als Aufgabe
gelistet oder gespawnt.

## Unterbefehle

`$ARGUMENTS` entscheidet:

### (leer) — auflisten
Alle `*.md` mit `status: open` oder `status: running`, **nach Repo gruppiert**,
innerhalb einer Gruppe älteste zuerst. Pro Zeile: laufende Nummer, `title`, Alter in
Tagen, und darunter eingerückt `next`. Läuft eine Zeile bereits (`status: running`),
das deutlich markieren, z. B. `⏳ läuft bereits (seit <running-since>)` statt/neben
`next` — das ist der Hinweis, der Doppel-Starts verhindert. Am Ende die Gesamtzahl
(getrennt nach offen/laufend) und ein Hinweis, wie man spawnt.

Nummern sind **positionsbasiert und nur für diesen Aufruf gültig** — sag das dazu, damit
niemand sie sich notiert. Archivierte (`done`) werden nicht gezeigt; erwähne nur ihre
Anzahl.

### `spawn <n> [<n> …]` oder `spawn <slug>`
Vor dem Anlegen pro gewählter Zeile den aktuellen Status prüfen. Ist er bereits
`running`, **nichts spawnen** — Eintrag überspringen und melden (analog zum fehlenden
Repo-Verzeichnis: „läuft bereits seit …, kein neuer Chip angelegt"). Das ist der Zweck
von `running`: verhindern, dass dieselbe Aufgabe aus Versehen doppelt gestartet wird.

Sonst für jede gewählte Zeile **einen** Chip via `spawn_task` anlegen:
- `cwd`: `~/Documents/Coding/<repo>` aus der Frontmatter. Existiert das Verzeichnis
  nicht, den Eintrag überspringen und das melden — ein Chip mit falschem `cwd` startet
  im falschen Repo.
- `title`: der `title` der Frontmatter, auf 60 Zeichen gekürzt.
- `tldr`: der `next`-Satz.
- `prompt`: **muss allein stehen** (der Chip trägt keinen Gesprächskontext). Nimm den
  vollständigen Pfad der Handoff-Datei, den ersten Schritt aus `next`, und die Anweisung,
  die Datei zuerst zu lesen und **sofort danach, vor der eigentlichen Arbeit**, sich
  selbst als laufend zu markieren. Etwa:

  > Lies zuerst `$HANDOFF_DIR/<datei>`, sie enthält Stand, getroffene
  > Entscheidungen, offene Subtasks und relevante Pfade. Steht dort inzwischen
  > `status: running`, arbeitet schon jemand daran: nicht anfangen, sondern melden.
  > Sonst setze noch vor dem ersten Arbeitsschritt `status: running` und
  > `running-since: <jetzt, YYYY-MM-DD HH:MM>` in der Datei, damit kein zweiter Chip
  > dieselbe Aufgabe startet.
  > Erster Schritt: <next>. Wenn die Arbeit abgeschlossen ist, ruf `/finish` auf (räumt
  > Kladde auf und schließt diese Handoff-Datei korrekt ab, inklusive Verschieben nach
  > `done/`).

Die Prüfung ist nicht redundant zum Filter beim Auflisten: zwischen dem Listen und
dem Start des Chips liegen Minuten, und ein über seinen Anschlussprompt gestarteter Lauf
setzt den Marker erst beim Lesen der Datei. Der Chip liest sie später und sieht damit
den frischeren Stand.

Danach die angelegten Chips auflisten.

### `done <slug>`
`status: done` in die Datei schreiben **und** sie nach `$HANDOFF_DIR/done/` verschieben.
Beides, damit weder `ls` noch ein Grep über `status:` allein täuscht.

### `reset <slug>`
Für eine hängengebliebene `running`-Aufgabe: `status` zurück auf `open` setzen und
`running-since` entfernen. Das ist der Fall, wenn die Chip-Session abgebrochen oder
gelöscht wurde, bevor sie fertig war (Datei blieb sonst für immer als `running`
stehen und wäre nie wieder spawnbar). Vor dem Zurücksetzen kurz gegenchecken, ob die
Aufgabe nicht doch gerade noch aktiv läuft — im Zweifel nachfragen statt zu raten.

### `show <slug>`
Die Datei ausgeben, ohne etwas zu ändern.

### `worktrees`: Leichen listen
Zweiter, unabhängiger Rückstand: Git-Worktrees, die von abgeschlossenen Chip-Sessions
übrig geblieben sind. Eine Session kann ihren eigenen Worktree nicht entfernen, weil sie
darin sitzt, deshalb passiert das hier, von außen.

**Quelle ist immer der frische Lauf, nie eine Merkliste:**

```bash
bash ~/.claude/bin/worktree-triage.sh
```

Das Skript ist read-only und gibt je Worktree eine Tab-getrennte Zeile aus:
`tier | repo | pfad | branch | dirty | ahead | grund`. Drei Stufen:

- **SAFE**: sauber und der HEAD steckt schon im Default-Branch, oder das Verzeichnis
  ist ganz weg (`prunable`). Entfernen verliert nichts.
- **REVIEW**: sauber, aber der Inhalt steckt nicht nachweisbar im Default-Branch.
  **Kein Automatismus.** Bei `DETACHED` hängt der Commit an keinem Branch: ihn zu
  entfernen macht ihn unerreichbar, das ist echter Verlust. Bei einem benannten Branch
  bleibt die Arbeit erhalten, nur das Arbeitsverzeichnis geht.

  Der häufigste REVIEW-Fall ist harmlos und in einem Schritt aufzulösen: der Commit ist
  längst als PR gemergt, main hat die Dateien danach nur weiterentwickelt, sodass der
  Datei-Vergleich anschlägt. Das prüft man am Commit-Betreff, nicht am Bauch:
  ```bash
  gh -R <owner>/<repo> pr list --state merged --search "<Commit-Betreff>" --limit 3
  ```
  Kommt ein gemergter PR mit demselben Titel zurück, ist die Arbeit gelandet und die
  Zeile so gefahrlos wie SAFE. Kommt nichts, liegt hier wirklich ungelandete Arbeit:
  dann nicht entfernen, sondern melden und den Operator entscheiden lassen.
- **BLOCKED**: uncommittete Änderungen, laufende Session (Prozess mit `cwd` darin), oder
  der Worktree der aktuellen Session. Nie anfassen, auch nicht auf Zuruf.

Nach Tier gruppiert ausgeben, SAFE zuerst, mit laufender Nummer je Zeile. Bei REVIEW den
Grund mitschreiben (wie viele Commits, detached oder nicht). Am Ende die Zählung je Tier
und der Hinweis auf `worktrees clean`. Nummern sind **positionsbasiert und nur für diesen
Aufruf gültig**, das dazusagen.

### `worktrees clean [<n> …]`
Ohne Nummern: **alle SAFE-Zeilen** entfernen. Mit Nummern: genau diese Zeilen.

Ablauf, in dieser Reihenfolge:

1. Triage neu laufen lassen (nie auf der Liste aus einem früheren Aufruf arbeiten, der
   Zustand kann sich geändert haben, eine Session kann inzwischen in einem Worktree
   sitzen, der eben noch frei war).
2. Auflisten, was entfernt würde, und **einmal gebündelt bestätigen lassen**. Bei
   REVIEW-Zeilen zusätzlich beim Namen nennen, was verloren geht („2 Commits, detached,
   danach nicht mehr erreichbar").
3. Erst nach dem Ja entfernen, je Zeile:
   ```bash
   git -C <repo-pfad> worktree remove <worktree-pfad>
   ```
   Fehlt das Verzeichnis nur noch in der Registrierung:
   ```bash
   git -C <repo-pfad> worktree prune
   ```
4. Danach kurz melden, was weg ist und was stehen blieb.

**Nie `git worktree remove --force`** und **nie `rm -rf`.** Wenn `remove` sich weigert,
ist das die Schutzfunktion von git: melden, nicht überstimmen. Lokale Branches bleiben
stehen, `worktree remove` löscht sie nicht, ein `git branch -D` ist eine eigene,
ausdrückliche Entscheidung des Operators und passiert hier nicht.

## Regeln

- **Nie eine Handoff-Datei löschen.** Erledigtes wandert nach `done/`; das ist der
  Forensik-Pfad, wenn sich herausstellt, dass doch etwas offen war.
- **Nie den Status raten.** Wenn beim Auflisten auffällt, dass eine Aufgabe erledigt
  aussieht, sag es als Beobachtung — umstellen darf nur `done` (bzw. `reset` bei
  hängengebliebenem `running`).
- Verweist eine Aufgabe auf ein Repo, dessen Verzeichnis fehlt, melde das beim Auflisten
  (die Aufgabe ist dann nicht spawnbar).
- **Nie eine bereits `running`-Aufgabe erneut spawnen**, auch nicht auf explizite
  Nummer/Slug-Auswahl — stattdessen überspringen und melden.
- **Worktrees nie auf Verdacht entfernen.** Nur was die frische Triage als `SAFE`
  ausweist, und `REVIEW` ausschließlich auf ausdrückliche Nummernwahl mit vorher
  genanntem Verlust. `BLOCKED` bleibt in jedem Fall stehen.
