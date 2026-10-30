# autopilot-monitor

Ein Panel neben dem Chat, das den Autopilot (Plugin `autopilot`) aller Repos auf einen Blick zeigt und sich alle 2 Minuten selbst aktualisiert.

- **Aufträge:** je Issue eine Zeile mit PR und Phase aus den Labels (Vorschlag, freigegeben, in Arbeit, im Review, Nacharbeit, wird gemergt, braucht dich).
- **Läufe:** die letzten 5 Läufe von Planer und Worker (Routines) und vom Reviewer (Routine oder Action `autopilot-review.yml`), mit Zeit in CET/CEST, Anlass, Ergebnis in einer Zeile und Link.
- **Deckel:** ein roter Hinweis, wenn die Worker-Läufe heute `deckel.worker_laeufe_pro_tag` erreichen (gezählt über `<!-- autopilot:work-start`-Kommentare seit 00:00 Berlin) oder WIP `deckel.wip` erreicht, dazu freigegebene Issues, die seit mehr als 30 Minuten nicht in Arbeit sind.

## Welche Repos

Keine Konfiguration: Das Panel nimmt jede aktive Routine, die `Autopilot <name>: Planer`, `…: Worker` oder `…: Reviewer` heißt, und das Repo ihrer ersten Quelle. Deckel und Stufe liest es aus der `.claude/autopilot.md` dieses Repos.

## Voraussetzungen

- `gh`, angemeldet, mit Lesezugriff auf die Repos.
- Claude Code mit claude.ai-Anmeldung. Die Läufe kommen aus derselben API wie beim Werkzeug `RemoteTrigger`, aber direkt mit der Anmeldung der Session, weil ein Plugin-Aufruf von `RemoteTrigger` im Auto-Modus am Klassifikator scheitert.

## Bedienung

`/autopilot-panel` blendet das Panel ein oder aus, ebenso das Schließen-Kreuz. Neue Sessions starten so, wie es zuletzt war.

Greift ein Deckel (Worker-Tageslimit oder WIP), steht über dem Eingabefeld ein rotes Band, auch bei geschlossenem Panel. „Panel“ öffnet das Panel, „Ausblenden“ blendet das Band aus, bis sich die Zahlen ändern. Bei geschlossenem Panel fragt das Plugin alle 10 Minuten ab, sonst alle 2.

## Installation

```bash
claude plugin marketplace add sgiffhorn/claude-skills-marketplace
```

```bash
claude plugin install autopilot-monitor@sgiffhorn-skills
```

In der Desktop-App: + neben dem Eingabefeld, Plugins, Marketplace `sgiffhorn/claude-skills-marketplace` hinzufügen, dann das Plugin.
