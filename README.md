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
- **`land`** — Commit → PR → Merge in einem Zug. Anders als die beiden anderen ist diese Version **repo-agnostisch**: sie erkennt Repo-Name, Default-Branch und Merge-Methode selbst über `gh repo view`, statt sie hart zu verdrahten. (Die Ursprungsversion lebt projekt-lokal in `Hezo-OPS/.claude/commands/land.md` und ist auf dieses eine Repo zugeschnitten.)

## Bekannte Einschränkungen

`backlog` und `handoff` setzen zwei Dinge voraus, die nicht überall gegeben sind:

1. **Den Pfad `~/Documents/Coding/_handoffs/`** als zentrales Handoff-Verzeichnis — eine persönliche Konvention, kein Standard. Wer einen anderen Workspace-Root nutzt, muss die Commands entsprechend anpassen.
2. **Das `spawn_task`-Tool** (Chip-Sessions) — nur verfügbar in Claude-Clients, die diese MCP-Fähigkeit mitbringen. Ohne sie funktioniert der `spawn`-Unterbefehl von `/backlog` nicht, der Rest (Auflisten, `done`, `show`) schon.

`land` hat keine dieser Abhängigkeiten und sollte in jedem Git-Repo mit `gh`-CLI-Zugriff laufen.

## Bei einer Aktualisierung

Es gibt kein Auto-Update (das ist der Preis für den kurzen Befehlsnamen). Neuer Stand:

```bash
git clone https://github.com/sgiffhorn/claude-skills-marketplace.git /tmp/claude-skills-marketplace
cp /tmp/claude-skills-marketplace/commands/*.md ~/.claude/commands/
```

Wer den Auto-Update-Weg statt der kurzen Befehle bevorzugt, kann dieselben drei Dateien auch als Claude-Code-Plugin einrichten (`/plugin marketplace add`) — dann heißen sie `/plugin-name:backlog` usw.
