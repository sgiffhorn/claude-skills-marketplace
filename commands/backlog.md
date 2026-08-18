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
status: open | done
created: YYYY-MM-DD
next: <ein Imperativsatz: der erste konkrete Schritt>
---
```

Fehlt die Frontmatter, behandle die Datei als `status: open` und weise beim Auflisten
darauf hin — nie stillschweigend überspringen. Ist `next` leer, zeige `(kein nächster
Schritt notiert)` statt einer Leerzeile; das ist ein Mangel an der Datei, kein Grund,
den Eintrag zu verstecken.

`README.md` ist die Konventionsbeschreibung des Verzeichnisses und wird nie als Aufgabe
gelistet oder gespawnt.

## Unterbefehle

`$ARGUMENTS` entscheidet:

### (leer) — auflisten
Alle `*.md` mit `status: open`, **nach Repo gruppiert**, innerhalb einer Gruppe älteste
zuerst. Pro Zeile: laufende Nummer, `title`, Alter in Tagen, und darunter eingerückt
`next`. Am Ende die Gesamtzahl und ein Hinweis, wie man spawnt.

Nummern sind **positionsbasiert und nur für diesen Aufruf gültig** — sag das dazu, damit
niemand sie sich notiert. Archivierte (`done`) werden nicht gezeigt; erwähne nur ihre
Anzahl.

### `spawn <n> [<n> …]` oder `spawn <slug>`
Für jede gewählte Zeile **einen** Chip via `spawn_task` anlegen:
- `cwd`: `~/Documents/Coding/<repo>` aus der Frontmatter. Existiert das Verzeichnis
  nicht, den Eintrag überspringen und das melden — ein Chip mit falschem `cwd` startet
  im falschen Repo.
- `title`: der `title` der Frontmatter, auf 60 Zeichen gekürzt.
- `tldr`: der `next`-Satz.
- `prompt`: **muss allein stehen** (der Chip trägt keinen Gesprächskontext). Nimm den
  vollständigen Pfad der Handoff-Datei, den ersten Schritt aus `next`, und die Anweisung,
  die Datei zuerst zu lesen. Etwa:

  > Lies zuerst `$HANDOFF_DIR/<datei>` — sie enthält Stand, getroffene
  > Entscheidungen, offene Subtasks und relevante Pfade. Erster Schritt: <next>.
  > Wenn die Arbeit abgeschlossen ist, setze in der Datei `status: done`.

Danach die angelegten Chips auflisten.

### `done <slug>`
`status: done` in die Datei schreiben **und** sie nach `$HANDOFF_DIR/done/` verschieben.
Beides, damit weder `ls` noch ein Grep über `status:` allein täuscht.

### `show <slug>`
Die Datei ausgeben, ohne etwas zu ändern.

## Regeln

- **Nie eine Handoff-Datei löschen.** Erledigtes wandert nach `done/`; das ist der
  Forensik-Pfad, wenn sich herausstellt, dass doch etwas offen war.
- **Nie den Status raten.** Wenn beim Auflisten auffällt, dass eine Aufgabe erledigt
  aussieht, sag es als Beobachtung — umstellen darf nur `done`.
- Verweist eine Aufgabe auf ein Repo, dessen Verzeichnis fehlt, melde das beim Auflisten
  (die Aufgabe ist dann nicht spawnbar).
