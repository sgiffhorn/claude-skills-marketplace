# claude-skills-marketplace

Fünf Custom Slash-Commands für Claude Code plus ein Hilfsskript, zum Kopieren, nicht als Plugin.

**Warum kein Plugin:** Claude-Code-Plugin-Commands sind immer namespaced (`/plugin-name:command-name`), es gibt keinen Weg zu einem bare `/backlog`. Wer den kurzen Befehl will, muss die Datei stattdessen in sein eigenes `.claude/commands/` legen — dann lädt Claude Code sie unter ihrem Dateinamen, ohne Präfix.

## Installation

**Persönlich (überall verfügbar):**

```bash
git clone https://github.com/sgiffhorn/claude-skills-marketplace.git /tmp/claude-skills-marketplace
cp /tmp/claude-skills-marketplace/commands/*.md ~/.claude/commands/
mkdir -p ~/.claude/bin
cp /tmp/claude-skills-marketplace/bin/worktree-triage.sh ~/.claude/bin/
chmod +x ~/.claude/bin/worktree-triage.sh
```

**Projektweit (nur in einem bestimmten Repo, landet mit im Repo):**

```bash
git clone https://github.com/sgiffhorn/claude-skills-marketplace.git /tmp/claude-skills-marketplace
mkdir -p .claude/commands ~/.claude/bin
cp /tmp/claude-skills-marketplace/commands/*.md .claude/commands/
cp /tmp/claude-skills-marketplace/bin/worktree-triage.sh ~/.claude/bin/
chmod +x ~/.claude/bin/worktree-triage.sh
```

Das Skript gehört auch beim projektweiten Weg nach `~/.claude/bin/`, weil `backlog` es
unter diesem Pfad aufruft. Es wird nur für `/backlog worktrees` gebraucht, die übrigen
Unterbefehle laufen ohne.

Danach: `/backlog`, `/handoff`, `/finish`, `/land`, `/ship`, wie gewohnt, kein Präfix.

## Commands

- **`backlog`**: listet offene Handoffs repo-übergreifend und kann daraus Chip-Sessions spawnen. Der Unterbefehl `worktrees` listet zusätzlich Git-Worktrees, die von abgeschlossenen Sessions übrig blieben, und kann die gefahrlosen davon entfernen.
- **`handoff`**: schreibt eine Handoff-Datei nach derselben Konvention, mit der die nächste Session schlank weiterarbeiten kann.
- **`finish`**: schließt eine Session ab: prüft ehrlich gegen die Subtasks und DoD der Handoff-Datei, ob die Arbeit wirklich fertig ist, räumt die eigene Kladde auf und verschiebt die Datei erst dann nach `done/`. `backlog` schickt seine Chips am Ende hierher.
- **`land`**: Commit, PR und Merge in einem Zug. Diese Version ist **repo-agnostisch**: sie erkennt Repo-Name, Default-Branch und Merge-Methode selbst über `gh repo view`, statt sie hart zu verdrahten.
- **`ship`**: `land` und danach das Release in einem Zuruf. Das Release-Verfahren gehört dem Repo: `ship` führt dessen `.claude/commands/release.md` aus und endet ohne sie nach dem Landen.

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
voraus, nur verfügbar in Claude-Clients, die diese MCP-Fähigkeit mitbringen. Ohne sie
funktioniert `spawn` nicht, der Rest (Auflisten, `done`, `reset`, `show`, `worktrees`) schon.

`backlog worktrees` erwartet die Repos als direkte Unterverzeichnisse eines gemeinsamen
Wurzelverzeichnisses, per Vorgabe `~/Documents/Coding`. Ein anderer Ort geht über die
Env-Var `CODE_ROOT`. Das Skript liest nur, entfernt wird ausschließlich über
`worktrees clean` und erst nach Rückfrage. Für die Unterscheidung „schon gemergt" nutzt es
`git`, und für einen der Grenzfälle optional die `gh`-CLI.

`finish` und `land` haben keine dieser Abhängigkeiten und sollten in jedem Git-Repo laufen,
`land` zusätzlich mit `gh`-CLI-Zugriff.

## Bei einer Aktualisierung

Es gibt kein Auto-Update (das ist der Preis für den kurzen Befehlsnamen). Neuer Stand:

```bash
git clone https://github.com/sgiffhorn/claude-skills-marketplace.git /tmp/claude-skills-marketplace
cp /tmp/claude-skills-marketplace/commands/*.md ~/.claude/commands/
cp /tmp/claude-skills-marketplace/bin/worktree-triage.sh ~/.claude/bin/
chmod +x ~/.claude/bin/worktree-triage.sh
```

Wer den Auto-Update-Weg statt der kurzen Befehle bevorzugt, kann dieselben Dateien auch als Claude-Code-Plugin einrichten (`/plugin marketplace add`), dann heißen sie `/plugin-name:backlog` usw.
