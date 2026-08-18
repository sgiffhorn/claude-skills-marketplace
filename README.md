# sebastian-claude-tools

Privater Claude-Code-Plugin-Marketplace für drei Custom Slash-Commands.

## Installation

```
/plugin marketplace add sebastiangiffhorn/claude-skills-marketplace
/plugin install backlog-plugin@sebastian-claude-tools
/plugin install handoff-plugin@sebastian-claude-tools
/plugin install land-plugin@sebastian-claude-tools
```

Aufruf danach als `/backlog-plugin:backlog`, `/handoff-plugin:handoff`, `/land-plugin:land`.

## Plugins

- **backlog-plugin** — listet offene Handoffs aus `~/Documents/Coding/_handoffs/` repo-übergreifend und kann daraus Chip-Sessions spawnen.
- **handoff-plugin** — schreibt eine Handoff-Datei nach derselben Konvention, mit der die nächste Session schlank weiterarbeiten kann.
- **land-plugin** — Commit → PR → Merge in einem Zug. Anders als die beiden anderen ist diese Version **repo-agnostisch**: sie erkennt Repo-Name, Default-Branch und Merge-Methode selbst über `gh repo view`, statt sie hart zu verdrahten. (Die Ursprungsversion lebt projekt-lokal in `Hezo-OPS/.claude/commands/land.md` und ist auf dieses eine Repo zugeschnitten.)

## Bekannte Einschränkungen

`backlog-plugin` und `handoff-plugin` setzen zwei Dinge voraus, die nicht überall gegeben sind:

1. **Den Pfad `~/Documents/Coding/_handoffs/`** als zentrales Handoff-Verzeichnis — das ist eine persönliche Konvention des Erstellers, kein Standard. Wer einen anderen Workspace-Root nutzt, muss die Commands entsprechend anpassen.
2. **Das `spawn_task`-Tool** (Chip-Sessions) — nur verfügbar in Claude-Clients, die diese MCP-Fähigkeit mitbringen. Ohne sie funktioniert der `spawn`-Unterbefehl von `/backlog` nicht, der Rest (Auflisten, `done`, `show`) schon.

`land-plugin` hat keine dieser Abhängigkeiten und sollte in jedem Git-Repo mit `gh`-CLI-Zugriff laufen.

## Wartung

Iterationen an einem Plugin: Datei unter `plugins/<name>/commands/` bearbeiten, committen, pushen — Nutzer bekommen das Update beim nächsten `/plugin update` bzw. automatisch je nach Client-Einstellung.
