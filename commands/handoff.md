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
- **Anschlussprompt:** Pflicht, und immer der **letzte** Abschnitt. Die Überschrift
  heißt exakt `## Anschlussprompt`, ohne Zusatz wie „(paste-ready)" oder „für die
  frische Session": sie ist der Anker, an dem sich der Abschnitt über alle Repos hinweg
  finden lässt. Inhalt ist ein fenced Code-Block, den man ohne Nacharbeit einfügen kann,
  und er beginnt mit Lesen, Statusprüfung und Statuszeile (Wortlaut unter „Zum
  Schluss").

Ohne diesen Abschnitt lässt sich die Aufgabe nur über `/backlog` starten. Das
funktioniert, ist aber der schmalere Weg: `/backlog` baut den Prompt aus `next`, also
aus einem Satz, während der Anschlussprompt die Entscheidungen mitgibt, die sonst erneut
hergeleitet werden.

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

**Der Anschlussprompt beginnt mit Lesen, Statusprüfung und Statuszeile**, in dieser
Reihenfolge, und im Chat-Block wortgleich wie im `## Anschlussprompt`-Abschnitt der
Datei. Fehlt das, startet eine Session über den Anschlussprompt, ohne sich als laufend
zu markieren, die Datei bleibt auf `status: open`, und `/backlog` spawnt ahnungslos
einen zweiten Chip auf dieselbe Aufgabe. Das ist kein theoretischer Fall: der zweite
Chip findet die Arbeit dann halb fertig vor, und wo sich beide Läufe eine Ressource
teilen (eine gemeinsame Entwicklungsdatenbank etwa), blockieren sie sich gegenseitig.
`/backlog` gibt seinen Chips diese Zeile längst mit, der handkopierte Anschlussprompt
war der ungeschützte Weg. Wortlaut:

  > Lies zuerst `$HANDOFF_DIR/<datei>`, sie enthält Stand, getroffene Entscheidungen,
  > offene Subtasks und relevante Pfade. Steht dort schon `status: running`, arbeitet
  > jemand daran: nicht anfangen, sondern melden. Sonst setze vor dem ersten
  > Arbeitsschritt `status: running` und `running-since: <jetzt, YYYY-MM-DD HH:MM>`.
