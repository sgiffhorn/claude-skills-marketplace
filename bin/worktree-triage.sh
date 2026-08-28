#!/bin/bash
# Read-only Triage aller Git-Worktrees unter $CODE_ROOT (Default ~/Documents/Coding).
# Gibt eine Zeile je Worktree aus, tab-getrennt:
#   tier | repo | pfad | branch_oder_detached | dirty | ahead | grund
# tier: SAFE (gefahrlos entfernbar) | REVIEW (Entscheidung noetig) | BLOCKED (nie automatisch)
# Aendert nichts. Entfernen ist Sache des Aufrufers.
set -uo pipefail

ROOT="${CODE_ROOT:-$HOME/Documents/Coding}"
CUR_TOP="$(git rev-parse --show-toplevel 2>/dev/null || echo __none__)"

is_live() {
  command -v lsof >/dev/null 2>&1 || return 1
  lsof -a -d cwd -- "$1" >/dev/null 2>&1
}

for d in "$ROOT"/*/; do
  r="${d%/}"
  # Nur Haupt-Repos: dort ist .git ein Verzeichnis. Ein verlinkter Worktree hat
  # .git als Datei und wuerde sonst dieselbe Worktree-Liste ein zweites Mal liefern.
  [ -d "$r/.git" ] || continue
  repo="$(basename "$r")"

  def="$(git -C "$r" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's#^refs/remotes/##')"
  if [ -z "$def" ]; then
    for cand in origin/main origin/master; do
      git -C "$r" rev-parse --verify --quiet "$cand" >/dev/null 2>&1 && def="$cand" && break
    done
  fi

  git -C "$r" worktree list --porcelain 2>/dev/null | awk '
    /^worktree /{wt=substr($0,10)}
    /^HEAD /{head=substr($0,6)}
    /^branch /{br=substr($0,8)}
    /^detached/{br="DETACHED"}
    /^prunable/{pr="prunable"}
    /^$/{if(wt!=""){print wt"\t"head"\t"br"\t"pr; wt="";head="";br="";pr=""}}
    END{if(wt!=""){print wt"\t"head"\t"br"\t"pr}}
  ' | tail -n +2 | while IFS=$'\t' read -r wt head br pr; do

    br_short="${br#refs/heads/}"

    if [ "$wt" = "$CUR_TOP" ]; then
      printf 'BLOCKED\t%s\t%s\t%s\t-\t-\taktuelle Session sitzt hier\n' "$repo" "$wt" "$br_short"
      continue
    fi

    if [ ! -d "$wt" ]; then
      printf 'SAFE\t%s\t%s\t%s\t-\t-\tVerzeichnis fehlt (%s), nur Registrierung aufraeumen\n' \
        "$repo" "$wt" "$br_short" "${pr:-verwaist}"
      continue
    fi

    if is_live "$wt"; then
      printf 'BLOCKED\t%s\t%s\t%s\t-\t-\tlaufende Session (Prozess mit cwd hier)\n' "$repo" "$wt" "$br_short"
      continue
    fi

    dirty="$(git -C "$wt" status --porcelain=v1 -uall 2>/dev/null | wc -l | tr -d ' ')"
    if [ "${dirty:-0}" -gt 0 ]; then
      printf 'BLOCKED\t%s\t%s\t%s\t%s\t-\tuncommittete Aenderungen\n' "$repo" "$wt" "$br_short" "$dirty"
      continue
    fi

    if [ -z "$def" ]; then
      printf 'REVIEW\t%s\t%s\t%s\t0\t?\tkein origin-Default-Branch, Merge-Stand unpruefbar\n' \
        "$repo" "$wt" "$br_short"
      continue
    fi

    if git -C "$r" merge-base --is-ancestor "$head" "$def" 2>/dev/null; then
      printf 'SAFE\t%s\t%s\t%s\t0\t0\tsauber, HEAD ist in %s enthalten\n' "$repo" "$wt" "$br_short" "$def"
      continue
    fi

    ahead="$(git -C "$r" rev-list --count "$def..$head" 2>/dev/null || echo '?')"

    # Squash-Merge erkennen: der Ancestor-Test oben schlaegt fehl, weil der
    # Squash-Commit eine andere SHA hat. Massgeblich ist der Inhalt. Wenn jede
    # Datei, die der Branch gegenueber der Merge-Base angefasst hat, im
    # Default-Branch byte-gleich vorliegt, bringt der Branch nichts Eigenes mehr mit.
    touched="$(git -C "$wt" diff --name-only "$def...HEAD" 2>/dev/null)"
    if [ -n "$touched" ]; then
      # shellcheck disable=SC2086
      if [ -z "$(git -C "$wt" diff --name-only "$def" HEAD -- $touched 2>/dev/null)" ]; then
        printf 'SAFE\t%s\t%s\t%s\t0\t%s\tsquash-gemergt: alle beruehrten Dateien liegen in %s gleich vor\n' \
          "$repo" "$wt" "$br_short" "$ahead" "$def"
        continue
      fi
    fi

    if [ "$br_short" = "DETACHED" ]; then
      printf 'REVIEW\t%s\t%s\t%s\t0\t%s\t%s unglandete Commit(s), DETACHED: gingen beim Entfernen verloren\n' \
        "$repo" "$wt" "$br_short" "$ahead" "$ahead"
    else
      printf 'REVIEW\t%s\t%s\t%s\t0\t%s\t%s unglandete Commit(s), Branch bleibt erhalten\n' \
        "$repo" "$wt" "$br_short" "$ahead" "$ahead"
    fi
  done
done
