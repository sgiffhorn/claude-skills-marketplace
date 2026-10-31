---
# Zentrale fuer mehrere Repos. Jedes Repo der Liste hat zusaetzlich seine eigene
# .claude/autopilot.md (template.md) mit stufe, gate, Sperrliste und den repo-eigenen Deckeln.
# Reihenfolge = Prioritaet: der Worker nimmt Nacharbeit und neue Auftraege aus dem ersten
# Repo der Liste, das welche hat; der Planer gibt jedem Repo mit Kandidat mindestens einen Platz.
repos:
  - OWNER/NAME
# Journal-Issue in diesem Repo (Labels autopilot:journal und autopilot:nachschub nur hier)
journal_issue: 0
sprache: de
environments:
  planer: NAME-plan
  worker: NAME-cloud
modelle:
  planer: opus
  worker: sonnet
  reviewer: opus
deckel:
  # zaehlen ueber alle Repos der Liste
  wip: 2
  neue_auftraege_pro_planerlauf: 6
  offene_vorschlaege: 10
  pruefungen_pro_lauf: 15
  # Worker und Planer bremsen ab dieser Auslastung des 5h-Fensters (Prozent),
  # und wenn der Wochenverbrauch mehr als budget_woche_vorlauf Prozentpunkte vor dem Wochenfortschritt liegt
  budget_5h: 70
  budget_woche_vorlauf: 10
  # Planer-Laeufe ausser der Reihe, wenn der Worker in keinem Repo Arbeit findet (Label autopilot:nachschub)
  nachschub_pro_tag: 3
  # Scout: neue Ideen-Issues je Lauf, offene autopilot:idee ueber alle Repos (erreicht: keine neuen), gelesene Dateien je Lauf
  ideen_pro_lauf: 5
  offene_ideen: 30
  scout_dateien_pro_lauf: 8
  # Vorgaben fuer Repos, deren Datei den Schluessel nicht setzt (nicht fuer den Review-Workflow)
  wip_begleitet: 1
  gate_fehlschlaege: 2
  wip_timeout_stunden: 6
---

# Autopilot: Zentrale

Gelesen von den Skills `autopilot-plan`, `autopilot-scout`, `autopilot-work` und `autopilot-chat` (Plugin `autopilot`), wenn der Routine-Prompt `Zentrale: OWNER/META` nennt. Die Kopfzeile ist maschinenlesbar.

Die Routinen für Planer, Scout, Worker und Chat haben dieses Repo und jedes Repo aus `repos:` (dazu dessen `zweit_repos`) als Quelle; die Cloud klont sie nach `/home/user/<name>`. Dieses Repo ist kein Arbeitsrepo: der Planer legt hier keine Aufträge an, außer es steht selbst in `repos:`.
