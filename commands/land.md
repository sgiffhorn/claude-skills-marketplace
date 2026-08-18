---
description: Commit, PR und Merge in einem Zug — repo-agnostisch. Erkennt Repo, Default-Branch und Merge-Methode selbst; lokales Gate vor dem Merge; harter Stop vor Squash-Merge, wenn PRs darüber gestapelt sind. Invoke als `/land`. Optional `--no-preflight` (bereits verifiziert), `--draft` (PR öffnen, nicht mergen), `--wip` (nur committen + pushen).
---

Du bist der Landeanflug für dieses Repo: die fertige Arbeit im aktuellen Worktree als **ein** Commit, **eine** PR und **einen** Merge auf den Default-Branch bringen. Dieser Skill ist bewusst repo-agnostisch — er ermittelt Repo, Branch, Merge-Methode und Test-Kommandos aus der Umgebung, statt sie anzunehmen.

Nutzer-Argumente: `$ARGUMENTS`

## Was hier tragend ist, unabhängig vom Repo

**CI blockiert oft nicht.** Auf privaten Repos im Free-Plan (und auf vielen Repos ohne konfigurierte Branch Protection) melden Checks nur, sie halten keinen Merge auf. Prüfe das (Schritt 0), aber verlass dich nicht darauf — das lokale Gate in Schritt 2 ist unabhängig davon Pflicht.

**Commit-Body vs. PR-Body haben verschiedene Leser, unabhängig von der Merge-Methode.** Bei Squash-Merge mit `squash_merge_commit_message: COMMIT_MESSAGES` (GitHub-Default) baut GitHub die finale Message aus den Commits, nicht aus der PR-Beschreibung — dann ist der Commit-Body das, was in der Historie bleibt. Bei anderen Einstellungen kann es umgekehrt sein. Schreib in beide etwas Sinnvolles:
- **Commit-Body** → das dauerhafte Protokoll. Warum, was geprüft wurde, welcher naheliegende Schluss falsch gewesen wäre.
- **PR-Body** → die Review-Erzählung. Darf strukturierter sein (`## Warum`, `## Verifikation`).

**Squash-Merge in einem Stack zerstört die obere PR — das ist GitHub-Verhalten, kein Repo-spezifisches Risiko.** Mergt man die untere PR eines Stapels mit `--delete-branch`, wird der Base-Branch der oberen PR gelöscht. GitHub reagiert darauf in einem von zwei Modi, unvorhersagbar: es **schließt** die obere PR (nicht reopenbar — der Head hat nach dem Rebase keinen darstellbaren Diff mehr), oder es **mergt sie still in den toten Base** (`mergedAt` gesetzt, aber die Commits landen nicht auf dem Default-Branch). Deshalb ist Schritt 8 ein harter Halt, kein Hinweis — auch wenn du „weißt", dass nichts gestapelt ist.

## Ablauf

0. **Repo-Kontext ermitteln.** Einmal zu Beginn:

   ```bash
   gh repo view --json nameWithOwner,defaultBranchRef,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge \
     -q '{repo:.nameWithOwner, base:.defaultBranchRef.name, squash:.squashMergeAllowed, mergeCommit:.mergeCommitAllowed, rebase:.rebaseMergeAllowed, autoDeleteBranch:.deleteBranchOnMerge}'
   ```

   Merge-Methode: bevorzugt `squash`, wenn erlaubt (häufigster Fall); sonst `merge` oder `rebase`, je nachdem was das Repo zulässt — bei Unklarheit den Operator fragen statt zu raten. `autoDeleteBranch` sagt, ob `--delete-branch` beim Merge nötig ist oder das Repo es selbst tut.

   Lies außerdem, falls vorhanden, `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` im Repo-Root nach eigenen Konventionen (Commit-Sprache, Pflicht-Doku-Updates, Test-Kommandos, PR-Body-Form). Wo das Repo etwas explizit vorschreibt, hat das Vorrang vor den Defaults unten.

1. **Wo stehe ich?**

   ```bash
   git rev-parse --abbrev-ref HEAD && git status --porcelain=v1 -uall | head -30
   ```

   - Branch ist der Default-Branch aus Schritt 0 → **stopp**. Erst branchen (`git switch -c <präfix>/<slug>` — Präfix nach vorhandener Konvention im Repo, sonst `claude/`), dann committen. Nie direkt auf den Default-Branch.
   - Nichts zu committen und kein ungepushter Commit → melden „nichts zu landen", Ende.
   - Untracked-Dateien, die offensichtlich Kladde sind (Debug-Skripte, `/tmp`-Kopien, auskommentierter Code): **nennen und nachfragen**, nicht stillschweigend mitnehmen und nicht stillschweigend weglassen.

2. **Lokales Gate.** Das ist deine Arbeit, nicht die des Operators.

   Ermittle die Test-/Lint-/Typecheck-Kommandos aus `package.json`'s `scripts` (oder dem Äquivalent der Sprache — `Makefile`, `pyproject.toml`, `Cargo.toml`) bzw. aus dem, was `CLAUDE.md`/`README` als Standardkommandos nennt. Häufig `npm run lint && npm run typecheck && npm test` oder eine schnellere Variante, falls das Repo eine dokumentiert (z. B. ein datei-paralleler `test:unit`).

   Fehler → **stopp**, exakte Datei + Zeile melden, nicht mergen.

   Wenn das Repo einen echten Produktions-Build kennt (Next.js `next build`, `tsc --build`, o. ä.) und der Diff etwas anfasst, das Lint/Typecheck/Unit-Tests nicht abdecken (Server-Runtime-Grenzen, neue Route-Handler, Build-Konfiguration) — den Build zusätzlich fahren, wenn das Repo dafür bereits ein bekanntes Muster hat.

   `--no-preflight` überspringt diesen Schritt — nur, wenn der Operator es sagt oder du die Suite in dieser Session auf genau diesem Baum schon grün gefahren hast.

   **Berührt der Diff ausschließlich Dateien, die keine Suite je liest** (reine Doku außerhalb von Quellcode) — die Dateiliste in der Zusammenfassung nennen statt eines grünen Laufs. Bei Unsicherheit, ob eine Datei von einem Guard-Test gelesen wird (Schema, Compose-Dateien, Konfiguration mit eigenen Tests), lieber den Lauf fahren.

3. **Dokumentation im selben PR, falls das Repo das verlangt.** Prüfe `CLAUDE.md`/`AGENTS.md` auf eine „Documentation freshness"-artige Regel. Wenn vorhanden: gegen den Diff prüfen und fehlende Stellen **jetzt** schreiben, nicht als Folgeaufgabe. Typische Trigger, falls das Repo sie nennt: neue/entfernte Route, neue Env-Var, neuer Cron-/Worker-Job, Schema-Änderung, geänderter Nutzer-Flow.

4. **Default-Branch neu holen — vor dem Schreiben, nicht nur zu Sessionbeginn.**

   ```bash
   git fetch origin <default-branch> --prune
   git log --oneline HEAD..origin/<default-branch> -- $(git diff --name-only origin/<default-branch>...HEAD | head -20)
   ```

   Trifft die zweite Zeile etwas, hat jemand dieselben Dateien angefasst seit dem letzten Fetch: **lies den Diff, bevor du den Commit-Body schreibst.** Besonders relevant in Repos mit mehreren parallelen Worktrees/Sessions.

   Bei Konflikt: `git rebase origin/<default-branch>`, Gate aus Schritt 2 erneut fahren.

5. **Commit.**

   Subject: `type(scope): aussage` (Conventional Commits — `feat` / `fix` / `docs` / `chore` / `perf` / `refactor`). Scope der Subsystem-Name. Sprache: **die, in der die letzten Commits des Repos geschrieben sind** (`git log -10 --oneline` zeigt es) — nicht automatisch Deutsch oder Englisch annehmen, sondern der Konvention des Repos folgen. Die Aussage nennt das Ergebnis, nicht die Tätigkeit.

   Body: Prosa in derselben Sprache, Absätze statt Bullet-Wüste. Was gemessen/geprüft wurde, welcher naheliegende Schluss falsch gewesen wäre, was bewusst nicht getan wurde. Keine Nacherzählung des Diffs.

   Trailer, falls das Repo dieses Muster kennt (`git log -5` prüfen, ob Co-authored-by-Trailer üblich sind) — sonst weglassen:

   ```
   Co-authored-by: Claude <noreply@anthropic.com>
   ```

   ```bash
   git add -A          # oder gezielt, wenn Schritt 1 Kladde gefunden hat
   git commit -F - <<'EOF'
   type(scope): aussage

   Prosa …
   EOF
   ```

   Mehrere Commits sind in Ordnung — bei Squash-Merge klebt GitHub ihre Bodies ohnehin zusammen. Ein Commit pro abgeschlossenem Gedanken, nicht pro Datei.

   **`--wip`**: hier committen + pushen (Schritt 6) und aufhören. Keine PR, kein Merge.

6. **Push.**

   ```bash
   git push -u origin HEAD
   ```

   Branch-Namen nach vorhandener Repo-Konvention (`git branch -a` zeigt sie); ohne erkennbares Muster reicht ein beschreibender Slug. Kein Force-Push auf einen Branch, dessen PR bereits ein Review hat, ohne `--force-with-lease`.

7. **PR anlegen.**

   Titel = Commit-Subject (bei mehreren Commits: die Aussage, die den PR trägt). Bei Squash-Merge hängt GitHub automatisch ` (#NNN)` an — selbst nicht mitschreiben.

   Body, in der Repo-Sprache, mit `##`-Abschnitten (nicht alle immer nötig, `## Verifikation` schon wenn etwas geprüft wurde):

   ```markdown
   Ein Absatz: was sich ändert und auf wessen Entscheidung.

   ## Warum

   Der Grund, nicht der Diff.

   ## Verifikation

   Was geprüft wurde, mit konkreten Ergebnissen — nicht nur „getestet".
   ```

   ```bash
   gh pr create --base <default-branch> --title "type(scope): aussage" --body-file /tmp/pr-body.md
   ```

   **`--draft`**: `gh pr create --draft`, dann melden und aufhören — Schritt 8/9 entfallen.

8. **Stack-Prüfung. Harter Halt, kein Hinweis — immer ausführen, egal was du zu wissen glaubst.**

   ```bash
   gh pr list --state open --json number,baseRefName,headRefName --jq --arg base "<default-branch>" '.[] | select(.baseRefName != $base)'
   ```

   - **Leere Ausgabe** → weiter zu Schritt 9.
   - **Irgendein Eintrag** → jede dieser PRs **vor** dem Merge umhängen:
     ```bash
     gh pr edit <N> --base <default-branch>
     gh pr view <N> --json baseRefName,mergeable
     ```

   Der Grund steht oben unter „Was hier tragend ist" — dieser Fehler ist real und wiederholt sich, wenn man den Schritt für optional hält.

   Beim Rebase der oberen Branches nach dem Merge: `git rebase --onto origin/<default-branch> <alter-tip-des-gemergten>`, dann `--force-with-lease`.

9. **Merge.**

   ```bash
   gh pr merge <N> --squash --delete-branch    # oder --merge / --rebase je nach Schritt 0
   ```

   `--delete-branch` weglassen, wenn `deleteBranchOnMerge` (Schritt 0) bereits `true` ist — sonst räumt GitHub selbst auf und die Flag ist redundant, aber harmlos.

   **Nach dem Merge, falls `--delete-branch` genutzt wurde und du in einem Git-Worktree arbeitest:** `gh` wechselt beim Cleanup auf den Default-Branch. Zwei Fälle, beide nachzufassen:

   - **Ein anderer Worktree hält den Default-Branch bereits.** Dann scheitert der Wechsel, `gh` bricht den ganzen Cleanup ab (inklusive Remote-Löschung des gemergten Branches). Der Merge selbst ist trotzdem gelaufen. Remote-Branch von Hand löschen:
     ```bash
     git ls-remote --heads origin <branch> | grep . && git push origin --delete <branch>
     ```
   - **Es klappt, dein Worktree steht danach auf dem Default-Branch.** Unauffälliger, aber gefährlicher — du bist einen Tippfehler von einem Commit auf den Default-Branch entfernt (Schritt 1 verbietet das) und produzierst für die nächste Session den ersten Fall. Sofort runter:
     ```bash
     git switch -c <präfix>/<nächster-slug>     # oder: git switch --detach
     ```

   Nur die **Remote**-Referenz nachziehen, nie lokal löschen (`git branch -D` unter einem laufenden Worktree ist der Fehler, den Schritt „Nicht" unten verbietet). Den Worktree selbst nicht anfassen — Aufräumen ist eine bewusste Handlung des Operators.

10. **Nachprüfen und melden.**

    ```bash
    git fetch origin <default-branch> --prune
    git log --oneline -1 origin/<default-branch>
    ```

    Der Merge-Commit muss dort stehen. Steht er nicht, obwohl `gh pr view <N> --json mergedAt` gesetzt ist: der Silent-Merge-in-toten-Base aus Schritt 8 ist eingetreten — `gh pr view <N> --json mergeCommit` liefert die SHA, die Commits sind im DAG und werden per `git cherry-pick` auf einen frischen Branch vom Default-Branch gerettet.

    Kurze Zusammenfassung: gemergte PR-Nummer + SHA, welches Gate gelaufen ist, Branch-Status, ob CI noch nachläuft (falls sie nicht blockiert).

## Nicht

- **Kein Tag, kein Release-Cut.** Das Taggen/Deployen ist ein eigener, bewusster Schritt des Operators — dieser Skill committet und mergt, mehr nicht.
- **Kein Merge bei rotem lokalem Gate**, auch wenn CI nicht blockiert.
- **Kein `gh pr merge`, ohne vorher Schritt 8 (Stack-Prüfung) ausgeführt zu haben.**
- **Kein Commit auf den Default-Branch.**
- **Kein `git worktree remove`, kein `git branch -D` lokal** — andere Sessions könnten denselben Worktree/Branch nutzen.
- **Kein Force-Push auf den Default-Branch**, nie.
- **Kein stilles Mitnehmen** von Debug-Artefakten — Schritt 1 nennt sie, der Operator entscheidet.
- **Keine Datenbank-Migration o. ä. Deploy-Schritte fahren** — das ist Sache der Deploy-Pipeline, nicht dieses Skills.
