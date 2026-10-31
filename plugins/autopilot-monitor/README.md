# autopilot-monitor

Ein Panel neben dem Chat, das den Autopilot (Plugin `autopilot`) aller Repos auf einen Blick zeigt und sich alle 2 Minuten selbst aktualisiert.

Je Repo, von oben nach unten:

- **Kopf:** Repo, Stufe, Stand; Worker arbeitet oder wartet, Warteschlange leer oder `n bereit`, Nachschub `x/y verbraucht`, sobald `deckel.nachschub_pro_tag` erreicht ist.
- **Braucht dich:** offene Issues und PRs mit `needs-human`, Issue und PR als ein Fall, Grund ist der erste Satz des jüngsten `<!-- autopilot:needs-human -->`-Kommentars. Technische Gründe, die der Worker selbst abräumt („Review-Lauf ohne Urteil“, „kein Ergebnis“, „Review-Workflow gescheitert“ ohne „Merge-Leitplanke“, „nicht mergebar“), stehen nur grau als „Repariert sich selbst“. Link zum Journal-Issue (`journal_issue`).
- **Seit gestern 09:00:** gemergte PRs mit Head `claude/autopilot-*`, nach Titel in Features, Tests und toter Code, Doku; Änderungen am Autopiloten selbst (Titel beginnt mit „autopilot“) getrennt. Bis zu fünf Feature-Titel, dazu Issues mit `prod-incident` im Fenster.
- **Auffällig:** Worker ohne Arbeit bei leerer Warteschlange und verbrauchtem Nachschub, Planer-Läufe der letzten 24 h ohne Wirkung (fehlender Label-Filter), WIP-Deckel erreicht, freigegebene Issues seit mehr als 30 Minuten nicht in Arbeit.
- **Deckel und Budget:** WIP (offene Issues mit `autopilot:wip`) gegen `deckel.wip`, Nachschub heute (Journal-Laufzeilen mit „Nachschub“) gegen `deckel.nachschub_pro_tag`.
- **Rollen:** Planer, Worker, Reviewer (Routine oder Action `autopilot-review.yml`) und Chat mit letztem Lauf, Ergebnis in Kurzform und nächstem geplanten Lauf.

## Welche Repos

Keine Konfiguration: Das Panel nimmt jede aktive Routine, die `Autopilot <name>: Planer`, `…: Worker`, `…: Reviewer` oder `…: Chat` heißt, und das Repo ihrer ersten Quelle. Deckel und Stufe liest es aus der `.claude/autopilot.md` dieses Repos.

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
