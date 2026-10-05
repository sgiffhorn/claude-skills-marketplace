---
description: Landen und releasen in einem Zuruf. Führt `/land` aus und danach das repo-eigene Release-Kommando (`.claude/commands/release.md`). Invoke als `/ship`. Optionen von `/land` (`--no-preflight`) und von `/release` (`--patch` / `--minor` / `--major`) werden durchgereicht.
---

Du bringst die fertige Arbeit im aktuellen Worktree in einem Zug bis in die Produktion: erst landen, dann releasen.

Nutzer-Argumente: `$ARGUMENTS`

## Was tragend ist

- **`/ship` ist der Release-Zuruf, für genau ein Release.** Wer `/ship` aufruft, hat Merge UND Release dieses einen Stands freigegeben. Das deckt keinen zweiten Tag, auch nicht nach einem roten ersten: dafür braucht es einen neuen Zuruf.
- **Das Release gehört dem Repo, nicht diesem Befehl.** `/ship` kennt keine Tag-Schemata, Workflows oder Umgebungen. Es führt `.claude/commands/release.md` des Repos aus. Fehlt die Datei, endet `/ship` nach dem Landen und sagt das; es rät kein Release-Verfahren.
- **Warten nur im Hintergrund.** Jedes Beobachten (`gh run watch`, Polls) läuft mit `run_in_background`. Ein Vordergrund-`sleep` wird geblockt und sieht dann aus wie eine Ablehnung durch den Nutzer.

## Ablauf

1. **Release-Kommando vorhanden?**
   ```bash
   test -f "$(git rev-parse --show-toplevel)/.claude/commands/release.md" && echo ja || echo nein
   ```
   „nein": dem Operator sagen, dass nur gelandet wird, und mit Schritt 2 weitermachen.

2. **Landen.** `~/.claude/commands/land.md` vollständig befolgen, mit den `/land`-Optionen aus `$ARGUMENTS`. Rotes Gate, Stack-Halt oder Merge-Fehler beenden `/ship` hier; nichts wird getaggt.

3. **Release.** Nach erfolgreichem Merge `.claude/commands/release.md` vollständig befolgen, mit den Release-Optionen aus `$ARGUMENTS`. Es releast `origin/main`, also genau den gerade gemergten Stand plus alles, was davor schon ungereleast war; das Inventar dort nennt es.

4. **Bericht.** Ein Block: PR-Nummer und Merge-SHA, dann der Bericht des Release-Kommandos. Dauer vom Merge bis live dazu, sie ist die Zahl, an der sich die Pipeline messen lässt.

## Nicht

- Kein Release, wenn das Landen nicht vollständig geklappt hat.
- Kein eigenes Release-Verfahren, wenn das Repo keins hat.
- Kein zweiter Release-Versuch ohne neuen Zuruf.
