# autopilot-monitor

Ein Panel neben dem Chat, das den Autopilot (Plugin `autopilot`) aller Repos auf einen Blick zeigt und sich alle 2 Minuten selbst aktualisiert.

Von oben nach unten:

- **Kopf:** Zentrale (im Ein-Repo-Modus das Repo) mit Journal-Nummer, Stand, Aktualisieren.
- **Braucht dich:** alle offenen Fälle über alle Repos, je Fall eine Zeile mit Art, `repo#n` als Link und einem Satz. Art `Merge` ist ein PR mit `needs-human`, den der Reviewer in Stufe `begleitet` freigibt („würde mergen“); `Entscheidung` ein Issue mit `autopilot:entscheidung`, der Satz ist die Frage des Planers; sonst `needs-human` mit dem ersten Satz des jüngsten `<!-- autopilot:needs-human -->`-Kommentars. Technische Gründe, die der Worker selbst abräumt („Review-Lauf ohne Urteil“, „kein Ergebnis“, „Review-Workflow gescheitert“ ohne „Merge-Leitplanke“, „nicht mergebar“), zählen nicht mit. Link zum Journal-Issue (`journal_issue`).
- **Alle Repos** (ohne Zentrale: **Deckel und Rollen**), einmal je Zentrale: WIP (offene Issues mit `autopilot:wip`, mit Zentrale summiert über alle Repos) gegen `deckel.wip`, offene Ideen (`autopilot:idee`) gegen `deckel.offene_ideen`, 5h-Fenster und Woche mit Soll (Bremsschwellen `budget_5h`, `budget_woche_vorlauf`), Nachschub heute (Journal-Laufzeilen mit „Nachschub“) gegen `deckel.nachschub_pro_tag`. Dazu die Rollen Planer, Scout, Worker, Reviewer (Routine oder Action `autopilot-review.yml`, der jüngste Lauf über alle Repos) und Chat mit Status-Punkt, letztem und nächstem Lauf.
- **Repos:** je Repo eine Zeile mit Stufe, in Arbeit, bereit, Vorschlägen und gemergten PRs seit gestern 09:00, orange mit `n wartet`, wenn es einen offenen Fall hat. Ein Druck klappt sie auf: Wartet auf dich, „Repariert sich selbst“ (die technischen Fälle), In Arbeit, Bereit, Gemergt nach Art (Head `claude/autopilot-*`, nach Titel in Features, Tests und toter Code, Doku, Autopilot selbst; Feature-Titel und Issues mit `prod-incident`), Links zu Issues, PRs und Review-Läufen. In Stufe `begleitet` steht dort auch `WIP n von deckel.wip_begleitet`. Solange ein Repo aufgeklappt ist, schrumpfen „Braucht dich“ und „Alle Repos“ auf je eine Zeile.
- **Auffällig:** Worker ohne Arbeit bei leerer Warteschlange und verbrauchtem Nachschub, Planer-Läufe der letzten 24 h ohne Wirkung (fehlender Label-Filter), WIP-Deckel erreicht, freigegebene Issues seit mehr als 30 Minuten nicht in Arbeit, offene Prod-Vorfälle. Was die ganze Zentrale betrifft, steht einmal, sonst mit dem Repo davor.

## Welche Repos

Keine Konfiguration: Das Panel nimmt jede aktive Routine, die `Autopilot <name>: Planer`, `…: Scout`, `…: Worker`, `…: Reviewer` oder `…: Chat` heißt.

- **Mit Zentrale:** Nennt der Prompt der Routine eine Zeile `Zentrale: <owner>/<name>`, sind die Repos die aus `repos:` in der `.claude/autopilot.md` der Zentrale, in deren Reihenfolge, jedes mit allen Routinen der Zentrale. Die Zentrale selbst erscheint nur, wenn sie in `repos:` steht. Stufe und repo-eigene Deckel kommen aus der `.claude/autopilot.md` des Repos, ein fehlender Deckel fällt auf den Wert der Zentrale zurück. Journal (`journal_issue`, im Repo der Zentrale) und die globalen Deckel (`wip`, `nachschub_pro_tag`, `offene_ideen`, `budget_5h`, `budget_woche_vorlauf` und die des Planers) kommen nur aus der Zentrale.
- **Ohne Zentrale:** das Repo der ersten Quelle; Deckel, Stufe und Journal aus dessen `.claude/autopilot.md`.

## Voraussetzungen

- `gh`, angemeldet, mit Lesezugriff auf die Repos.
- Claude Code mit claude.ai-Anmeldung. Die Läufe kommen aus derselben API wie beim Werkzeug `RemoteTrigger`, aber direkt mit der Anmeldung der Session, weil ein Plugin-Aufruf von `RemoteTrigger` im Auto-Modus am Klassifikator scheitert.

## Bedienung

`/autopilot-panel` blendet das Panel ein oder aus, ebenso das Schließen-Kreuz. Neue Sessions starten so, wie es zuletzt war.

Braucht dich ein Fall oder ist etwas auffällig, steht es knapp in einem Band über dem Eingabefeld, auch bei geschlossenem Panel. „Panel“ öffnet das Panel, „Ausblenden“ blendet das Band aus, bis sich der Text ändert. Bei geschlossenem Panel fragt das Plugin alle 10 Minuten ab, sonst alle 2.

## Installation

```bash
claude plugin marketplace add sgiffhorn/claude-skills-marketplace
```

```bash
claude plugin install autopilot-monitor@sgiffhorn-skills
```

In der Desktop-App: + neben dem Eingabefeld, Plugins, Marketplace `sgiffhorn/claude-skills-marketplace` hinzufügen, dann das Plugin.
