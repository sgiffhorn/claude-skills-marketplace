# claude-skills-marketplace

Drei Custom Slash-Commands für Claude Code, zum Kopieren — nicht als Plugin.

**Warum kein Plugin:** Claude-Code-Plugin-Commands sind immer namespaced (`/plugin-name:command-name`), es gibt keinen Weg zu einem bare `/backlog`. Wer den kurzen Befehl will, muss die Datei stattdessen in sein eigenes `.claude/commands/` legen — dann lädt Claude Code sie unter ihrem Dateinamen, ohne Präfix.

## Installation

**Persönlich (überall verfügbar):**

```bash
git clone https://github.com/sgiffhorn/claude-skills-marketplace.git /tmp/claude-skills-marketplace
cp /tmp/claude-skills-marketplace/commands/*.md ~/.claude/commands/
```

**Projektweit (nur in einem bestimmten Repo, landet mit im Repo):**

```bash
git clone https://github.com/sgiffhorn/claude-skills-marketplace.git /tmp/claude-skills-marketplace
mkdir -p .claude/commands
cp /tmp/claude-skills-marketplace/commands/*.md .claude/commands/
```

Danach: `/backlog`, `/handoff`, `/land` — wie gewohnt, kein Präfix.

## Commands

- **`backlog`** — listet offene Handoffs aus `~/Documents/Coding/_handoffs/` repo-übergreifend und kann daraus Chip-Sessions spawnen.
- **`handoff`** — schreibt eine Handoff-Datei nach derselben Konvention, mit der die nächste Session schlank weiterarbeiten kann.
- **`land`** — Commit → PR → Merge in einem Zug. Diese Version ist **repo-agnostisch**: sie erkennt Repo-Name, Default-Branch und Merge-Methode selbst über `gh repo view`, statt sie hart zu verdrahten.

## Handoff-Verzeichnis

`backlog` und `handoff` teilen sich ein zentrales, repo-übergreifendes Verzeichnis für
Übergabedateien. Der Pfad ist **nicht hartkodiert** — beide Commands ermitteln ihn beim
ersten Aufruf in dieser Reihenfolge:

1. Env-Var `CLAUDE_HANDOFFS_DIR`, falls gesetzt.
2. Sonst `~/.claude/handoffs-dir` (eine Zeile, der Pfad), falls vorhanden.
3. Sonst wird einmalig gefragt und die Antwort in `~/.claude/handoffs-dir` gemerkt —
   jeder weitere Aufruf, auch auf einem anderen Rechner, fragt nicht erneut, solange
   diese Datei existiert.

## Bekannte Einschränkung

`backlog` setzt das **`spawn_task`-Tool** (Chip-Sessions) für seinen `spawn`-Unterbefehl
voraus — nur verfügbar in Claude-Clients, die diese MCP-Fähigkeit mitbringen. Ohne sie
funktioniert `spawn` nicht, der Rest (Auflisten, `done`, `show`) schon.

`land` hat keine dieser Abhängigkeiten und sollte in jedem Git-Repo mit `gh`-CLI-Zugriff laufen.

## Bei einer Aktualisierung

Es gibt kein Auto-Update (das ist der Preis für den kurzen Befehlsnamen). Neuer Stand:

```bash
git clone https://github.com/sgiffhorn/claude-skills-marketplace.git /tmp/claude-skills-marketplace
cp /tmp/claude-skills-marketplace/commands/*.md ~/.claude/commands/
```

Wer den Auto-Update-Weg statt der kurzen Befehle bevorzugt, kann dieselben drei Dateien auch als Claude-Code-Plugin einrichten (`/plugin marketplace add`) — dann heißen sie `/plugin-name:backlog` usw.
