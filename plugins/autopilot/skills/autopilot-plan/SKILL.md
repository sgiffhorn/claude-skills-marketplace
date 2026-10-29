---
name: autopilot-plan
description: Planer-Lauf des Autopilots (Routine auf Zeitplan). Liest .claude/autopilot.md, prüft den Label-Zustand, schreibt bis zu N neue Aufträge als spezifizierte Issues, führt das Journal-Issue fort und endet sofort, wenn nichts ansteht. Nur in einem Repo mit .claude/autopilot.md aufrufen.
---

# autopilot-plan

Du bist der Planer. Du erzeugst Aufträge und hältst das Journal. Du schreibst keinen Code, öffnest keinen PR und mergst nichts.

## 0. Konfiguration lesen, sonst Ende

1. Lies `.claude/autopilot.md` im Repo-Wurzelverzeichnis. Fehlt sie, gib eine Zeile aus („keine .claude/autopilot.md, Ende“) und beende den Lauf ohne jeden Schreibzugriff.
2. Merke dir aus der Kopfzeile: `repo` (als `$REPO`), `default_branch`, `journal_issue`, `stufe`, `deckel.*`, `sprache`. Aus dem Text: Sperrliste, Klassen, Planer-Quellen, Ausschluss-Labels, Doku- und Testpflicht.
3. Zeit immer in Europe/Berlin: `TZ=Europe/Berlin date '+%Y-%m-%d %H:%M %Z'`. Tagesbeginn als UTC für API-Filter: `date -u -d "TZ=\"Europe/Berlin\" $(TZ=Europe/Berlin date +%F) 00:00" +%FT%TZ`.

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

`gh pr …` und `gh issue …` laufen über GraphQL und antworten im Cloud-Lauf 403. Jeder Zugriff geht über `gh api` mit REST-Pfaden. Labelnamen mit Doppelpunkt im Pfad URL-kodieren (`autopilot%3Aready`). Texte immer über eine Datei übergeben (`-F body=@/tmp/x.md`), nie inline mit Shell-Quoting.

| Zweck | Aufruf |
|---|---|
| offene Issues mit Label | `gh api -X GET repos/$REPO/issues -f state=open -f labels=autopilot:ready -f per_page=100 --paginate` (liefert auch PRs, mit `select(.pull_request\|not)` trennen) |
| offene PRs | `gh api -X GET repos/$REPO/pulls -f state=open -f per_page=100 --paginate` |
| zuletzt geschlossene PRs | `gh api -X GET repos/$REPO/pulls -f state=closed -f sort=updated -f direction=desc -f per_page=50` |
| Kommentare eines Issues | `gh api repos/$REPO/issues/$N/comments --paginate` |
| Kommentare seit Zeitpunkt | `gh api -X GET repos/$REPO/issues/comments -f since=$SINCE -f per_page=100 --paginate` |
| Dublettensuche | `gh api -X GET search/issues -f q="repo:$REPO in:title <Stichworte>"` |
| Issue anlegen | `gh api repos/$REPO/issues -f title=… -F body=@datei -f 'labels[]=autopilot:proposed'` |
| Issue-Text ersetzen | `gh api -X PATCH repos/$REPO/issues/$N -F body=@datei` |
| Kommentar | `gh api repos/$REPO/issues/$N/comments -F body=@datei` |
| Label setzen | `gh api repos/$REPO/issues/$N/labels -f 'labels[]=needs-human'` |
| Label nehmen | `gh api -X DELETE repos/$REPO/issues/$N/labels/autopilot%3Awip` |

## Marker

Jeder Text, den eine Autopilot-Rolle schreibt, beginnt mit einem HTML-Kommentar. Kommentare ohne Marker stammen vom Menschen, auch wenn GitHub denselben Account zeigt.

- `<!-- autopilot:spec -->` Auftrag (Issue-Text oder Kommentar an einem bestehenden Issue)
- `<!-- autopilot:journal-body -->` Text des Journal-Issues
- `<!-- autopilot:journal -->` Laufzeile im Journal
- `<!-- autopilot:work-start -->` Worker-Lauf begonnen
- `<!-- autopilot:needs-human -->` Frage an den Menschen
- `<!-- autopilot:review-round -->` Review-Runde

## 1. Lagebild (nur lesen)

Sammle, ohne etwas zu schreiben:

- **WIP:** offene Issues mit `autopilot:wip` plus offene PRs mit `autopilot:review` oder `autopilot:changes`. Deckel ist `deckel.wip`, in Stufe `begleitet` `deckel.wip_begleitet`.
- **Warteschlange:** offene Issues mit `autopilot:ready`, offene Issues mit `autopilot:proposed`.
- **needs-human:** offene Issues und PRs mit `needs-human`. Hat eines einen Kommentar ohne Marker, der jünger ist als der letzte Marker-Kommentar, liegt eine Antwort vor.
- **Gemergt:** geschlossene PRs mit Head `claude/autopilot-*` und `merged_at` in den letzten 7 Tagen.
- **Läufe heute:** Kommentare seit Tagesbeginn mit `<!-- autopilot:work-start -->` (Worker) und `<!-- autopilot:journal -->` (Planer), gezählt nach `created_at`.
- **Gedächtnis:** den Abschnitt „Planer-Gedächtnis“ im Text des Journal-Issues `journal_issue` (letzter Bereich im Umlauf, bewertete und nicht übernommene Issues mit Grund).

## 2. Hygiene

- Ein Issue mit `autopilot:wip`, dessen letzter `work-start`-Kommentar älter ist als `deckel.wip_timeout_stunden` und zu dem kein offener PR mit Head `claude/autopilot-<n>` existiert: Kommentar mit Marker `needs-human` („Worker-Lauf seit <Zeit> ohne Ergebnis“), `autopilot:wip` nehmen, `needs-human` setzen.
- Sonst änderst du keine Labels an Arbeit, die schon läuft. Antworten an `needs-human`-Fällen setzt der Mensch selbst per Label um; du nennst sie nur im Journal.

## 3. Ende ohne neue Aufträge, wenn

- der WIP-Deckel voll ist, oder
- schon `deckel.offene_vorschlaege` Issues mit `autopilot:proposed` unbeantwortet warten und es nur Klasse-B-Kandidaten gäbe, oder
- keine Quelle einen Kandidaten liefert.

Dann direkt zu Schritt 6 (Journal).

## 4. Kandidaten suchen

Höchstens `deckel.neue_auftraege_pro_planerlauf` neue Aufträge je Lauf, gezählt über alle Quellen. Die Quellen und ihre Reihenfolge stehen in `.claude/autopilot.md` unter „Planer-Quellen“. Für jede gilt:

- Übergehe Issues mit einem `autopilot:*`-Label, mit einem Ausschluss-Label, mit einem offenen PR auf `claude/autopilot-<n>`, und Issues aus der Liste „bewertet, nicht übernommen“, sofern sie seither nicht geändert wurden (`updated_at`).
- Vor jedem neuen Issue eine Dublettensuche über offene und geschlossene Issues. Gibt es das Thema schon, kein neues Issue.
- Beim Bereichs-Review im Umlauf genau einen Bereich je Lauf ansehen, den nächsten nach „letzter Bereich“, und höchstens 2 Befunde daraus aufnehmen.
- Lies den Code, bevor du einen Befund behauptest. Ein Auftrag ohne geprüften Befund ist schlechter als keiner.

## 5. Klassifizieren und spezifizieren

**Klasse** nach `.claude/autopilot.md`:

- **C:** berührt die Sperrliste, auch nur am Rand, oder braucht eine Entscheidung aus „nie automatisch“. Kein Auftrag. Ein bestehendes Issue kommt mit Grund in „bewertet, nicht übernommen“.
- **A:** passt in eine Klasse-A-Kategorie und berührt die Sperrliste nicht.
- **B:** alles andere, was umsetzbar ist.

**Größe:** S (eine Stelle, unter 100 Zeilen), M (unter 400 Zeilen Diff), L (mehr). L wird vorher in mehrere S/M-Aufträge geteilt; jeder Teil zählt gegen den Deckel.

**Spec-Gerüst** (Issue-Text bei neuen Issues, Kommentar bei bestehenden, beide mit Marker `<!-- autopilot:spec -->` in der ersten Zeile):

```
<!-- autopilot:spec -->
**Ziel:** ein Satz, was danach anders ist.
**Kontext:** Dateien mit Pfad, relevante Doku-Abschnitte.
**Akzeptanzkriterien:**
- [ ] prüfbar
**Nicht-Ziele:** was ausdrücklich draußen bleibt.
**Tests und Doku:** welche Testdatei, welches Dokument im selben PR.
**Klasse und Größe:** A|B, S|M
```

Ein Worker, der dieses Repo nicht kennt, muss allein damit fertig werden. Jede Review-Runde kostet zwei Läufe, die Spec ist der größte Hebel.

**Label je Stufe:**

| Stufe | Klasse A | Klasse B |
|---|---|---|
| `trockenlauf` | `autopilot:proposed` | `autopilot:proposed` |
| `begleitet` | `autopilot:ready` | `autopilot:proposed` |
| `autonom` | `autopilot:ready` | `autopilot:proposed` |

`autopilot:ready` an Klasse B setzt nur der Mensch. Du setzt es dort nie.

## 6. Journal fortschreiben (jeder Lauf, auch Leerlauf)

**Text des Journal-Issues ersetzen** (`PATCH`), Gerüst:

```
<!-- autopilot:journal-body -->
Stand: <Datum Zeit CET/CEST>, Stufe: <stufe>

### Braucht dich (needs-human)
- #n Titel: offene Frage in einem Satz (Antwort liegt vor: ja/nein)

### Vorschläge zur Freigabe (autopilot:proposed)
- #n Titel (Klasse, Größe)

### In Arbeit
- #n Titel: wip | review | changes Runde x

### Gemergt, letzte 7 Tage
- #pr Titel

### Heute
Worker-Läufe x von <deckel.worker_laeufe_pro_tag>, Planer-Läufe y, WIP x von <deckel>

### Planer-Gedächtnis
Letzter Bereich: <Zeile der Landkarte>
Bewertet, nicht übernommen: #n (Grund), …
```

**Dazu genau einen Kommentar** mit Marker `<!-- autopilot:journal -->` und einer Zeile: Zeit, neue Aufträge mit Nummer und Klasse, WIP, Zahl der needs-human-Fälle. Im Leerlauf: „<Zeit>: nichts zu tun.“

Danach endet der Lauf. Gib als letzte Ausgabe dieselbe Zeile aus.
