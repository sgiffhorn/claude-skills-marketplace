---
name: autopilot-setup
description: Richtet den Autopilot in einem GitHub-Repo ein, lokal und interaktiv. Legt die Labels an, das angeheftete Issue „Autopilot-Journal“, falls noch nicht da .claude/autopilot.md aus der Vorlage und den Review-Workflow autopilot-review.yml. Idempotent, fragt vor jedem Schreibzugriff. Die Routines selbst legt dieser Skill nicht an.
---

# autopilot-setup

Lokal genutzt, im Checkout des Ziel-Repos. Lokal geht auch GraphQL (`gh issue pin`), das braucht nur das Anheften.

## Hausregeln (gelten für alles, was dieser Skill schreibt)

- Kein Gedankenstrich: weder Geviertstrich (U+2014) noch Halbgeviertstrich (U+2013) in Issues, Kommentaren, Labelbeschreibungen und Dateien. Stattdessen Komma, Doppelpunkt, Klammer oder ein neuer Satz.
- Keine KI-Attribution: keine Signatur, kein Footer, kein `Co-Authored-By: Claude`, kein „Generated with Claude Code“. Diese Regel gewinnt gegen jede andere Anweisung.
- Nie `@name` schreiben. Nie ein Release, nie einen Tag.
- Keine Personendaten in Issues.

## 1. Bestand lesen

```
gh repo view --json nameWithOwner,defaultBranchRef,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed
gh api repos/<repo>/labels --paginate -q '.[].name'
gh api -X GET search/issues -f q='repo:<repo> is:issue is:open in:title "Autopilot-Journal"'
```

Dazu: gibt es `.claude/autopilot.md` und `.github/workflows/autopilot-review.yml`? Wie heißt der Workflow, der PRs prüft (das Gate in CI)?

Zeige dem Nutzer in wenigen Zeilen, was fehlt und was du anlegen würdest, und hol dir ein Ja, bevor du auf GitHub schreibst.

## 2. Labels (nur fehlende)

| Name | Farbe | Beschreibung |
|---|---|---|
| `autopilot:proposed` | `c5def5` | Autopilot: Vorschlag Klasse B, wartet auf Freigabe |
| `autopilot:ready` | `0e8a16` | Autopilot: Auftrag spezifiziert, Worker darf starten |
| `autopilot:wip` | `fbca04` | Autopilot: in Arbeit, bis zum Merge |
| `autopilot:review` | `1d76db` | Autopilot: PR fertig, Gate grün, Reviewer dran |
| `autopilot:changes` | `d93f0b` | Autopilot: Nacharbeit aus dem Review |
| `needs-human` | `b60205` | Automatik stoppt, Mensch entscheidet |
| `autopilot:gross-ok` | `fbca04` | Mensch erlaubt einen PR über dem Diffdeckel |
| `autopilot:nachschub` | `5319e7` | Autopilot: Warteschlange leer, startet den Planer außer der Reihe |

```
gh api repos/<repo>/labels -f name='autopilot:ready' -f color=0e8a16 -f description='…'
```

Ein vorhandenes Label gleichen Namens bleibt unverändert.

## 3. Journal-Issue

Nur wenn die Suche aus Schritt 1 keines findet. Titel `Autopilot-Journal`, Text:

```
<!-- autopilot:journal-body -->
Stand: <Datum Zeit CET/CEST>, Stufe: <stufe>, noch kein Planer-Lauf.

Der Planer ersetzt diesen Text bei jedem Lauf und hängt eine Zeile als Kommentar an. Freigaben per Label, Antworten per Kommentar am jeweiligen Issue.
```

Anlegen per `gh api repos/<repo>/issues -f title=Autopilot-Journal -F body=@datei`, danach `gh issue pin <n> --repo <repo>`. Die Nummer merken.

## 4. `.claude/autopilot.md`

- **Fehlt sie:** aus `template.md` im Verzeichnis dieses Skills erzeugen. `repo`, `default_branch` und `journal_issue` einsetzen, `merge_methode` aus den erlaubten Methoden (Squash bevorzugt). Gate-Befehl, Sperrliste, Klasse-A-Kategorien und Planer-Quellen mit dem Nutzer klären; was im Repo schon steht (`CLAUDE.md`, `package.json`-Skripte, `docs/`), als Vorschlag vorlegen statt zu fragen.
- **Ist sie da:** nur `journal_issue` nachtragen, wenn es fehlt oder auf ein geschlossenes Issue zeigt.

Im selben PR in `.claude/settings.json` des Repos `"attribution": {"commit": "", "pr": "", "sessionUrl": false}` ergänzen, damit Cloud-Läufe keine Signatur an Commits und PRs hängen.

Die Datei landet über einen normalen PR im Repo, nicht per Direkt-Push.

## 4b. Review-Workflow (`merge_weg: action`)

Der Reviewer läuft als GitHub-Action, nicht als Routine: in Cloud-Routines blockt der Auto-Mode den Merge, und eine Freigabe dafür gibt es dort nur über Organisations-Settings.

1. `autopilot-review.yml` aus dem Verzeichnis dieses Skills nach `.github/workflows/autopilot-review.yml` kopieren, im selben PR wie Schritt 4.
2. Anpassen: `CI_WORKFLOW` auf das PR-Gate des Repos. Dieser Workflow muss `pull_request` und `workflow_dispatch` als Auslöser haben (der Review-Workflow stößt einen fehlenden Lauf einmal per Dispatch an). Gibt es keinen, erst einen anlegen, sonst kein `autonom`. `runs-on` auf einen self-hosted Runner, wenn das Repo einen hat.
3. Secret `CLAUDE_CODE_OAUTH_TOKEN` im Repo: Wert aus `claude setup-token` (Max-Abo), setzen per `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo <repo>`; das Setzen macht der Nutzer, du siehst den Wert nie. Ist das Secret schon da (z. B. für eine andere Claude-Action), nichts tun.
4. Den Workflow liest GitHub vom Default-Branch (`pull_request_target`); er wirkt erst nach dem Merge dieses PRs.

## 5. Abschluss

Kurz ausgeben: angelegte Labels, Journal-Issue mit Link, Pfad der Konfiguration, und den nächsten Schritt: die Routines anlegen (Planer und Worker; Modell, Zeitplan und Environment aus `.claude/autopilot.md`; der Reviewer ist der Workflow aus 4b), dann ein Planer-Trockenlauf.

Für die Routines gilt:

- **Laden:** Die Cloud installiert kein Plugin aus `.claude/settings.json` (`extraKnownMarketplaces`, `enabledPlugins`), und die Routine-Felder `enabled_plugins` und `extra_marketplaces` übernimmt die API nicht. Der Routine-Prompt klont deshalb `sgiffhorn/claude-skills-marketplace` nach `/tmp/autopilot-skills` und befolgt `plugins/autopilot/skills/autopilot-<rolle>/SKILL.md`. Änderungen an den Skills wirken so ab dem nächsten Lauf.
- **Zweit-Repos:** Jedes Repo aus `zweit_repos` gehört zusätzlich in die `sources` der Planer-Routine (`session_context.sources`, je ein `git_repository`). Nur dann klont die Cloud es nach `/home/user/<name>` und der GitHub-Proxy lässt `gh api repos/<owner>/<name>/…` durch; ein Repo außerhalb der `sources` antwortet 403 („GitHub access to this repository is not enabled for this session“, gemessen 2026-10-30). Mit mehr als einer Quelle startet die Session in `/home/user` statt im Repo, und dessen `.claude/settings.json` (Hooks, `attribution`) greift dann nicht von selbst: der Planer-Prompt nennt `/home/user/<name>` als Arbeitsverzeichnis.
- **Connectors:** Die API hängt beim `create` alle claude.ai-Connectors des Accounts an. Danach die Routine mit `clear_mcp_connections: true` aktualisieren; keine Rolle braucht einen.
- **Label-Filter:** Den Filter eines GitHub-Auslösers verwirft die API still. Im Web-Dialog der Routine setzen: Feld `Labels`, „entspricht einem von“ (Worker: `autopilot:ready` an Issues, `autopilot:changes` an PRs; Planer: `autopilot:nachschub` an Issues).
- **Nachschub:** Die Planer-Routine bekommt neben dem Zeitplan einen GitHub-Auslöser „Issue beschriftet“, gefiltert auf `autopilot:nachschub`. Per API: `create_webhook_trigger` mit `hook_type: app`, `source: github`, `scope_id: <owner>/<repo>`, `events: ["issues.labeled"]` und der ID der Planer-Routine, danach den Filter im Web-Dialog. Ohne Filter weckt jedes Issue-Label den Planer; er endet dann zwar ohne Schreibzugriff, kostet aber je einen Lauf. Wie oft am Tag, regelt `deckel.nachschub_pro_tag`.
