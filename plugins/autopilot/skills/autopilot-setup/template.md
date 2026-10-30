---
repo: OWNER/NAME
default_branch: main
journal_issue: 0
# trockenlauf: nur der Planer, alles als autopilot:proposed
# begleitet: Worker und Reviewer an, nur Klasse A, Reviewer mergt nicht
# autonom: Reviewer mergt Klasse A und freigegebene Klasse B
stufe: trockenlauf
# mensch: Klasse B wartet als autopilot:proposed auf das Label des Menschen
# auto: in Stufe autonom setzt der Planer Klasse B selbst auf autopilot:ready
freigabe_b: mensch
sprache: de
gate: npm test
merge_methode: squash
# action: Reviewer laeuft als .github/workflows/autopilot-review.yml, der Workflow mergt
# api: Reviewer-Routine mergt per gh api (Cloud-Auto-Mode blockt das ohne Org-Freigabe)
# label: Reviewer-Routine setzt autopilot:merge, ein eigener Workflow im Repo mergt
merge_weg: action
# weitere Repos, die der Planer liest (nie schreibt), z. B. ein Meta-Repo; jedes auch in die sources der Planer-Routine
zweit_repos: []
environments:
  planer: NAME-plan
  worker: NAME-cloud
modelle:
  planer: opus
  worker: sonnet
  reviewer: opus
deckel:
  wip: 2
  wip_begleitet: 1
  neue_auftraege_pro_planerlauf: 6
  offene_vorschlaege: 10
  pruefungen_pro_lauf: 15
  inventur_tage: 30
  # ein neuer Befund je Runde ist Fortschritt; ein unbehobener aus der Vorrunde geht sofort an den Menschen
  review_runden: 3
  gate_fehlschlaege: 2
  # Einfügungen plus Löschungen ohne Testdateien; 0 heißt kein Deckel, dann urteilt nur das Review
  diff_zeilen: 400
  # Worker und Planer bremsen ab dieser Auslastung des 5h-Fensters (Prozent),
  # und wenn der Wochenverbrauch mehr als budget_woche_vorlauf Prozentpunkte vor dem Wochenfortschritt liegt
  budget_5h: 70
  budget_woche_vorlauf: 10
  wip_timeout_stunden: 6
  # Planer-Läufe außer der Reihe, wenn der Worker keine Arbeit findet (Label autopilot:nachschub)
  nachschub_pro_tag: 3
---

# Autopilot: Konfiguration für OWNER/NAME

Gelesen von den Skills `autopilot-plan`, `autopilot-work` und `autopilot-review` (Plugin `autopilot`). Die Kopfzeile ist maschinenlesbar, der Rest gilt wörtlich.

## Sperrliste (Klasse C)

Berührt ein Diff einen dieser Pfade, auch nur am Rand, entscheidet nur der Mensch.

- `.github/workflows/`
- Abhängigkeiten in `package.json` und Lockfiles
- neue Umgebungsvariablen
- Tags und Releases

## Klasse A (Planer gibt selbst frei)

- Testlücken
- Doku-Drift
- Bugs mit Repro
- Lint- und Typfehler
- kleine Refactors außerhalb der Sperrliste

## Klasse B (Freigabe durch den Menschen per Label `autopilot:ready`)

Features, neue Routen, sichtbare UI-Änderungen.

## Planer-Quellen (in dieser Reihenfolge)

1. Offene Issues ohne `autopilot:*`-Label und ohne Ausschluss-Label.
2. **Doku-Sweep** über diese Dokumente (Inventur, danach nur Änderungen; Ablauf im Skill `autopilot-plan`). `§ Abschnitt` heißt, nur diesen Abschnitt lesen.
   - `docs/**/*.md`
   - je Eintrag in `zweit_repos`, nur was dieses Repo betrifft: `OWNER/META:docs/*.md`
3. Bereichs-Review im Umlauf (Zeiger „Letzter Bereich“): je Lauf ein Bereich des Codes, der Reihe nach. Gesucht: Testlücken, Doku-Drift, toter Code. Höchstens 2 Befunde je Lauf.

Jeder Doku-Treffer wird am Code geprüft: schon umgesetzt ist Doku-Drift (Klasse A), umsetzbar ohne offene Entscheidung ist ein Vorschlag (meist Klasse B), alles mit offener Entscheidung oder auf der Sperrliste kommt mit Grund ins Gedächtnis.

## Ausschluss-Labels

`wontfix`

## Doku- und Testpflicht

Wie in `CLAUDE.md` des Repos.

## UI-Beleg

Entfällt.
