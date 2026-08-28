---
description: Beendet eine Session sauber. Räumt eigene Kladde auf und prüft ehrlich gegen die Subtasks/DoD der zugehörigen Handoff-Datei, ob die Arbeit wirklich fertig ist, bevor sie als done nach done/ verschoben wird. Invoke als `/finish`.
---

Du bist der Session-Abschluss: bevor diese Session endet, prüfst du ehrlich, ob die
Arbeit wirklich fertig ist, räumst eigene Kladde auf und bringst die zugehörige
Handoff-Datei in einen Zustand, der zu `/backlog` nicht widerspricht.

## Handoff-Verzeichnis ermitteln (einmalig, dann gemerkt)

Vor allem anderen: **`$HANDOFF_DIR`** bestimmen, in dieser Reihenfolge:

1. Env-Var `CLAUDE_HANDOFFS_DIR`, falls gesetzt.
2. Sonst die erste nicht-leere Zeile aus `~/.claude/handoffs-dir`, falls die Datei
   existiert.
3. Sonst: es gibt noch keinen zentralen Rückstand, also auch keine Handoff-Datei zu
   dieser Arbeit. Weiter direkt mit Schritt 2 (Kladde), Schritt 0/1/3 entfallen.

## Ablauf

0. **Zugehörige Handoff-Datei finden.**

   - Wurde diese Session über `/backlog spawn` gestartet, steht der Pfad bereits im
     ersten Prompt dieser Session: den nehmen.
   - Sonst in `$HANDOFF_DIR` nach `<repo>__handoff-*.md` mit `status: running` suchen,
     wobei `<repo>` der Verzeichnisname dieses Repos ist, Worktree-sicher ermittelt:
     ```bash
     basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
     ```
   - Genau ein Treffer: den nehmen. Mehrere Treffer: nachfragen, welcher gemeint ist,
     nie raten. Kein Treffer: es gibt keine offene Handoff-Datei zu dieser Arbeit,
     weiter mit Schritt 2, Schritt 1 und 3 entfallen.

1. **Ehrlich prüfen, ob wirklich fertig.**

   Gegen die Abschnitte „Offene Subtasks" und die dort genannten DoDs der
   Handoff-Datei prüfen, nicht gegen die eigene Erinnerung an den bisherigen
   Gesprächsverlauf. Bei mehreren Subtasks jeden einzeln durchgehen.

   - **Alles erledigt und verifiziert:** weiter mit Schritt 3.
   - **Noch etwas offen:** nicht schönreden. `next` in der Datei auf den
     tatsächlichen Reststand aktualisieren (was konkret fehlt), `status` zurück auf
     `open` setzen, `running-since` entfernen. Melden, was fertig ist und was fehlt,
     dann Ende. Kein Verschieben nach `done/`.

2. **Kladde räumen.** Unabhängig davon, ob Schritt 0 einen Treffer hatte.

   Analog zu `land`s Schritt 1, nur am Sessionende statt vor dem Commit:

   ```bash
   git status --porcelain=v1 -uall | head -30
   ```

   - Eigene Scratch- und Debug-Dateien dieser Session (Diagnose-Skripte, Kopien im
     `/tmp`- oder Scratchpad-Verzeichnis, testweise auskommentierter Code): **nennen
     und um Bestätigung bitten**, dann löschen. Nicht stillschweigend.
   - Substantielle uncommittete Änderungen, also die eigentliche Arbeit und kein
     Debug-Rest: das ist ein Signal, dass noch nicht wirklich fertig ist. Nicht als
     „fertig" durchwinken, zurück zu Schritt 1 und fragen, ob `/land` zuerst laufen
     soll, bevor hier weitergemacht wird.
   - Worktree oder lokale Branches selbst NICHT löschen (`git worktree remove`,
     `git branch -D`). Das bleibt eine bewusste Handlung des Operators, genau wie im
     Abschnitt „Nicht" von `land`. Diese Session sitzt ohnehin im Worktree und kann ihn
     nicht entfernen; aufgeräumt wird von außen über `/backlog worktrees clean`, das den
     Zustand selbst frisch prüft. Hier ist also nichts vorzumerken.

3. **Handoff-Datei sauber abschließen.** Nur falls Schritt 0 einen Treffer hatte und
   Schritt 1 „alles erledigt" ergab.

   - `next:` durch eine kurze Abschlusszeile ersetzen: was fertig ist, PR-Nummer oder
     Commit-SHA falls vorhanden, Datum.
   - `status: done` setzen, zusätzlich ein eigenes Feld `closed: <YYYY-MM-DD>`
     ergänzen.
   - Datei in einem Schritt nach `$HANDOFF_DIR/done/` verschieben (`mv`, nicht
     kopieren und die alte Datei separat löschen, sonst entsteht ein Zwischenzustand
     mit zwei Kopien).
   - `running-since` kann stehen bleiben, die Datei ist jetzt archiviert und dient als
     Forensik-Pfad.

4. **Kurz melden.**

   Ein bis zwei Sätze: Handoff geschlossen (Pfad in `done/`) oder offen mit
   Reststand, Kladde geräumt (was genau), offene Fragen falls welche (zum Beispiel ob
   noch `/land` laufen soll).

## Nicht

- **Keine eigene Einschätzung „wahrscheinlich fertig"** ohne Abgleich gegen die
  Subtasks und DoDs der Handoff-Datei.
- **Keine Handoff-Datei nach `done/` verschieben**, solange noch etwas offen ist.
- **Kein `git worktree remove`, kein `git branch -D` lokal.**
- **Keine Kladde stillschweigend löschen**, immer erst nennen und bestätigen lassen.
- **Existiert keine Handoff-Datei zu dieser Arbeit, keine neue erfinden.** Das ist
  Aufgabe von `/handoff`, falls die Arbeit doch nicht fertig ist und an eine frische
  Session übergeben werden soll.
