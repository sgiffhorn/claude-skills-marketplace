---
description: Schreibt eine eindeutige Handoff-Datei, mit der die nächste Session schlank weiterarbeiten kann
---

Erstelle eine Übergabedatei, mit der eine **frische** Session diese Arbeit fortsetzen
kann, ohne den jetzigen Kontext mitschleppen zu müssen.

## Handoff-Verzeichnis ermitteln (einmalig, dann gemerkt)

Vor allem anderen: **`$HANDOFF_DIR`** bestimmen, in dieser Reihenfolge —

1. Env-Var `CLAUDE_HANDOFFS_DIR`, falls gesetzt.
2. Sonst die erste nicht-leere Zeile aus `~/.claude/handoffs-dir`, falls die Datei
   existiert.
3. Sonst: einmalig nachfragen, wo das zentrale, repo-übergreifende Handoff-Verzeichnis
   liegen soll (sinnvoller Vorschlag: ein `_handoffs`-Ordner neben dem Wurzelverzeichnis,
   unter dem die Repos liegen). Nach der Antwort das Verzeichnis anlegen
   (`mkdir -p "$HANDOFF_DIR/done"`) und den Pfad nach `~/.claude/handoffs-dir` schreiben
   (eine Zeile, der reine Pfad), damit künftige Aufrufe — auch von `/backlog` — nicht
   erneut fragen.

## Ort: zentral, repo-übergreifend

**Immer nach `$HANDOFF_DIR` schreiben** — nicht ins Repo.

Grund: der Rückstand verteilt sich über viele Repos, und `/backlog` muss ihn an *einem*
Ort sehen. Ein zentraler Ort erledigt nebenbei zwei alte Probleme: er überlebt das
Aufräumen von git-Worktrees, und cross-repo-Aufgaben („Infra-PR zuerst, App-PR danach")
haben endlich ein Zuhause, statt willkürlich in einem der beiden Repos zu landen.

- Dateiname: `<repo>__handoff-<slug>.md`.
  - `<repo>` ist der **Verzeichnisname unter `~/Documents/Coding`**, klein — nicht der
    Pfad der aktuellen Session. Läuft die Session in einem Worktree
    (`…/.claude/worktrees/…`), liefert `git rev-parse --show-toplevel` den Worktree; nimm
    stattdessen `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`.
  - `<slug>` ist kurz und kebab-case und beschreibt die Aufgabe
    (`handoff-auth-refactor`), NIE ein fixer Name — sonst überschreiben sich parallele
    Sessions.
- **Niemals stillschweigend überschreiben.** Existiert die Zieldatei, prüfe, ob sie ein
  veralteter Rest oder ein fremder paralleler Handoff ist, und hänge dann `-2` an. Im
  Zweifel nachfragen.
- Umfangreiches Begleitmaterial (JSON-Dumps, CSVs) nach
  `$HANDOFF_DIR/assets/<repo>__<slug>/` und in der Datei darauf verweisen.

## Frontmatter (Pflicht)

Die Datei MUSS damit beginnen — `/backlog` liest genau diese Felder:

```yaml
---
title: <Kurztitel, eine Zeile, ohne "Handoff —">
repo: <derselbe Verzeichnisname wie im Dateinamen>
status: open
created: <YYYY-MM-DD, heute>
next: <EIN Imperativsatz: der erste konkrete Schritt>
---
```

`next` ist das Feld, das in der Rückstandsliste als einzige Zeile erscheint. Es muss ohne
den Rest der Datei verständlich sein und konkret benennen, was zu tun ist — „Ingress-Lauf
mit einer echten 21-MB-Platte fahren", nicht „Testing".

## Abschnitte

- **Stand:** Was ist erledigt, welche Entscheidungen wurden getroffen — inkl. kurzer
  Begründung bei nicht offensichtlichen Entscheidungen.
- **Offene Subtasks:** In Bearbeitungsreihenfolge, jeweils mit Definition of Done.
- **Relevante Dateien/Pfade:** Konkret, damit die neue Session nicht erneut explorieren
  muss.
- **Einstieg:** Der erste Schritt, ausführlicher als `next`.

## Alles ausschreiben, nichts verlinken

Die Datei ersetzt den Gesprächskontext und wird oft aus einem **anderen** Repo heraus
gelesen. Deshalb:

- **Keine `[[memory-links]]`** — Memories sind pro Projekt gescoped und im anderen Repo
  tot. Den Fakt selbst hinschreiben.
- Zahlen, Env-Namen, Contracts, Task-Definitionen, Kommandos **inline**, nicht als
  Verweis auf eine Session oder ein anderes Repo.
- Betrifft die Aufgabe zwei Repos, benenne beide samt Reihenfolge; `repo:` ist das, in
  dem der erste Schritt passiert.

Präzise und vollständig, aber ohne Geschwätz.

## Zum Schluss

Gib den **genauen Pfad** aus und einen **paste-ready Anschlussprompt** als eigenen
fenced Code-Block im Chat (nicht nur in der Datei), mit dem sich die nächste Session
starten lässt. Weise darauf hin, dass die Aufgabe ab jetzt in `/backlog` auftaucht.
