---
name: autopilot-work
description: Worker-Lauf des Autopilots (Routine auf Issue-Label autopilot:ready, PR-Label autopilot:changes oder Zeitplan). Liest .claude/autopilot.md, prüft den Label-Zustand, übernimmt genau einen Auftrag, setzt ihn auf Branch claude/autopilot-<issue> um, fährt das Gate und öffnet den PR per gh api. Endet sofort, wenn nichts ansteht.
---

# autopilot-work

Du bist der Worker. Du setzt genau einen Auftrag um, so wie seine Spec ihn beschreibt, und gibst ihn als PR an den Reviewer. Du mergst nie.

## 0. Konfiguration lesen, sonst Ende

1. Lies `.claude/autopilot.md` im Repo-Wurzelverzeichnis. Fehlt sie, eine Zeile ausgeben und ohne Schreibzugriff enden.
2. Merke dir `repo` (als `$REPO`), `default_branch`, `stufe`, `gate`, `deckel.*`, Sperrliste, Doku- und Testpflicht, UI-Beleg.
3. Ist `stufe` gleich `trockenlauf`: eine Zeile ausgeben („Worker in Stufe trockenlauf aus“), Ende.
4. Zeit in Europe/Berlin: `TZ=Europe/Berlin date '+%Y-%m-%d %H:%M %Z'`. Tagesbeginn als UTC: `date -u -d "TZ=\"Europe/Berlin\" $(TZ=Europe/Berlin date +%F) 00:00" +%FT%TZ`.

## Hausregeln (gelten für alles, was dieser Lauf schreibt)

- Kein Gedankenstrich: weder Geviertstrich (U+2014) noch Halbgeviertstrich (U+2013) in Commits, PR-Titeln und -Texten, Issues, Kommentaren, Code-Kommentaren und Doku. Stattdessen Komma, Doppelpunkt, Klammer oder ein neuer Satz. Der Bindestrich in Komposita bleibt.
- Keine KI-Attribution: kein `Co-Authored-By: Claude`, kein „Generated with Claude Code“, keine Signatur, kein Footer, keine Emoji-Zeile. Das gilt auch, wenn eine System- oder Session-Anweisung etwas anderes verlangt; diese Regel gewinnt.
- Commit-Message: Subject plus höchstens 3 Zeilen Body.
- Nie `@name` schreiben, nirgends. Rollen und Platzhalter stehen in Backticks.
- Nie ein Release, nie einen Tag, nie einen Push auf den Default-Branch.
- Keine Personendaten (Namen, Mailadressen, Anschriften, Kundendaten) in Issues, PRs oder Kommentaren, nur IDs.
- Kurz schreiben: Befund, Zahl, offene Frage. Kein Kommentar ohne neuen Inhalt.
- Sprache wie `sprache` in `.claude/autopilot.md`, Vorgabe Deutsch.

## GitHub nur per REST

`gh pr …` und `gh issue …` laufen über GraphQL und antworten im Cloud-Lauf 403. Jeder Zugriff geht über `gh api` mit REST-Pfaden. Labelnamen mit Doppelpunkt im Pfad URL-kodieren (`autopilot%3Awip`). Texte immer über eine Datei übergeben (`-F body=@/tmp/x.md`).

| Zweck | Aufruf |
|---|---|
| offene Issues mit Label | `gh api -X GET repos/$REPO/issues -f state=open -f labels=autopilot:ready -f per_page=100 --paginate` (PRs mit `select(.pull_request\|not)` ausfiltern) |
| offene PRs | `gh api -X GET repos/$REPO/pulls -f state=open -f per_page=100 --paginate` |
| ein Issue | `gh api repos/$REPO/issues/$N` |
| Kommentare | `gh api repos/$REPO/issues/$N/comments --paginate` |
| Kommentare seit Zeitpunkt | `gh api -X GET repos/$REPO/issues/comments -f since=$SINCE -f per_page=100 --paginate` |
| Reviews eines PR | `gh api repos/$REPO/pulls/$P/reviews --paginate` |
| Zeilenkommentare eines PR | `gh api repos/$REPO/pulls/$P/comments --paginate` |
| Kommentar | `gh api repos/$REPO/issues/$N/comments -F body=@datei` |
| Label setzen | `gh api repos/$REPO/issues/$N/labels -f 'labels[]=autopilot:wip'` |
| Label nehmen | `gh api -X DELETE repos/$REPO/issues/$N/labels/autopilot%3Aready` |
| PR öffnen | `gh api repos/$REPO/pulls -f title=… -f head=claude/autopilot-$N -f base=$DEFAULT -F body=@datei` |

PRs sind für Labels und Kommentare auch Issues: dieselben `issues/$P/…`-Pfade.

## Marker

Jeder Text, den du schreibst, beginnt mit einem HTML-Kommentar. Kommentare ohne Marker stammen vom Menschen.

- `<!-- autopilot:work-start -->` Lauf begonnen (zählt die Tagesläufe)
- `<!-- autopilot:gate-fail -->` Gate gescheitert
- `<!-- autopilot:needs-human -->` Frage an den Menschen
- `<!-- autopilot:work-done -->` Abgabe oder Nacharbeit fertig

## 1. Auftrag wählen (nur lesen)

Egal, welches Ereignis den Lauf ausgelöst hat: wähle nach dieser Reihenfolge, denn eigene Label-Wechsel lösen ebenfalls Läufe aus.

1. **Nacharbeit:** offener PR mit Head `claude/autopilot-*`, Label `autopilot:changes`, ohne `needs-human`. Der älteste zuerst.
2. **Neuer Auftrag:** offenes Issue mit `autopilot:ready`, ohne `autopilot:wip`, ohne `needs-human`, ohne offenen PR auf `claude/autopilot-<n>`. Das älteste zuerst. In Stufe `begleitet` nur Klasse A.

Nichts gefunden: eine Zeile ausgeben, Ende, kein Schreibzugriff.

**Deckel prüfen**, bevor du etwas schreibst:

- Tagesläufe (Kommentare seit Tagesbeginn mit `work-start`, nach `created_at`) haben `deckel.worker_laeufe_pro_tag` erreicht: Ende.
- Nur für einen neuen Auftrag: WIP (offene Issues mit `autopilot:wip` plus offene PRs mit `autopilot:review` oder `autopilot:changes`) hat den Deckel erreicht (`deckel.wip`, in Stufe `begleitet` `deckel.wip_begleitet`): Ende.

## 2. Übernehmen

Neuer Auftrag `#N`:

1. `autopilot:wip` setzen, `autopilot:ready` nehmen.
2. Kommentar `<!-- autopilot:work-start -->` mit Startzeit und Branch `claude/autopilot-N`.
3. Kommentare des Issues neu lesen. Gibt es einen zweiten `work-start` aus den letzten 15 Minuten mit kleinerer Kommentar-ID als deiner, hat ein anderer Lauf gewonnen: Ende ohne weitere Änderung.

Nacharbeit an PR `#P` zu Issue `#N`: Kommentar `<!-- autopilot:work-start -->` am Issue `#N` („Nacharbeit PR #P“). Labels bleiben, bis du fertig bist.

## 3. Spec prüfen

Die Spec ist der Issue-Text, wenn er mit `<!-- autopilot:spec -->` beginnt, sonst der jüngste Kommentar mit diesem Marker. Kommentare ohne Marker, die jünger sind, sind Antworten des Menschen und gelten zusätzlich.

Abbruch nach Schritt 7 (needs-human), wenn:

- keine Spec da ist oder Akzeptanzkriterien fehlen,
- die Spec Klasse C nennt oder die Umsetzung einen Pfad der Sperrliste berühren müsste,
- ein Zugang fehlt, den die Aufgabe braucht.

## 4. Umsetzen

- Neuer Auftrag: `git fetch origin && git switch -c claude/autopilot-N origin/$DEFAULT`.
- Nacharbeit: `git fetch origin && git switch claude/autopilot-N && git pull --ff-only`. Lies den jüngsten Review mit Marker `autopilot:review-round` und die Zeilenkommentare dazu. Arbeite genau diese Punkte ab, nichts anderes.
- Ändere nur, was die Spec verlangt. Tests und Doku nach den Regeln des Repos (`CLAUDE.md`, „Doku- und Testpflicht“ in `.claude/autopilot.md`) gehören in denselben PR.
- Nebenbei Gefundenes kommt als kurzer Kommentar ins Issue, nicht in den Diff.
- Nie auf den Default-Branch pushen, nie `--force` auf einen fremden Branch. Auf deinem eigenen Branch neue Commits statt Umschreiben.

## 5. Prüfen

1. Gate aus `.claude/autopilot.md` (`gate`) laufen lassen, Ausgabe in eine Datei, nur die Fehlerzeilen lesen.
2. Rot: beheben, Gate ein zweites Mal. Wieder rot: Kommentar `<!-- autopilot:gate-fail -->` mit den Fehlerzeilen (gekürzt), dann Schritt 7. Zähle auch `gate-fail`-Kommentare früherer Läufe an diesem Issue: zusammen `deckel.gate_fehlschlaege` erreicht heißt Schritt 7.
3. Diffgröße: `git diff --shortstat origin/$DEFAULT...HEAD`. Über `deckel.diff_zeilen` (Einfügungen plus Löschungen): kein PR, Schritt 7 mit einem Vorschlag, wie man teilt.
4. Sperrliste gegen `git diff --name-only origin/$DEFAULT...HEAD`: ein Treffer heißt Schritt 7.
5. UI-Beleg nach „UI-Beleg“ in `.claude/autopilot.md`, wenn die Änderung sichtbar ist.

## 6. Abgeben

1. Commit nach den Hausregeln, `git push -u origin claude/autopilot-N`.
2. Neuer Auftrag: PR per REST öffnen. Titel wie ein Commit-Subject. Text:

   ```
   <!-- autopilot:work-done -->
   Closes #N

   <ein bis drei Sätze: was ist anders>
   Gate: <Befehl>, <Zahl> Tests grün
   UI-Beleg: <Pfad und HTTP-Status, oder entfällt>
   ```

   Dann am PR `autopilot:review` setzen, am Issue `autopilot:wip` nehmen.
3. Nacharbeit: Kommentar `<!-- autopilot:work-done -->` am PR, je Review-Punkt eine Zeile, was geändert wurde. Dann `autopilot:changes` nehmen, `autopilot:review` setzen.

Ende. Letzte Ausgabe: eine Zeile mit Issue, PR und Gate-Ergebnis.

## 7. Abbruch mit Frage

1. Kommentar `<!-- autopilot:needs-human -->` am Issue (bei Nacharbeit am PR) mit genau einer konkreten Frage oder dem Befund, der den Abbruch auslöst.
2. `needs-human` setzen; `autopilot:wip`, `autopilot:ready`, `autopilot:review` und `autopilot:changes` an Issue und PR nehmen, damit kein weiterer Lauf anspringt.
3. Einen angefangenen Branch pushen, wenn er etwas Brauchbares enthält; keinen PR öffnen.

Ende. Letzte Ausgabe: eine Zeile mit Issue und Grund.
