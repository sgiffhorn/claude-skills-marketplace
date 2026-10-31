import { expect, test } from 'claude-code/testing'

import {
  auffaellig,
  fuehreZusammen,
  gruppiere,
  leseKonfig,
  summiereWip,
  verteile,
  zentraleAusPrompt,
} from '../hooks/register'
import type { Konfig, TriggerRoh } from '../hooks/register'

const ZENTRALE = `---
# Zentrale fuer mehrere Repos
repos:
  - beispiel/zwei
  - beispiel/eins # Kommentar
journal_issue: 102
sprache: de
deckel:
  # zaehlen ueber alle Repos der Liste
  wip: 4
  budget_5h: 70
  nachschub_pro_tag: 3
  wip_begleitet: 1
  inventur_tage: 30
---

# Autopilot: Zentrale
`

const REPO = `---
repo: beispiel/eins
stufe: begleitet
deckel:
  wip: 9
  wip_begleitet: 2
  diff_zeilen: 0
---
`

const quelle = (repo: string) => ({ git_repository: { url: `https://github.com/${repo}` } })

const trigger = (id: string, name: string, quellen: string[], prompt?: string): TriggerRoh => ({
  id,
  name,
  enabled: true,
  job_config: {
    ccr: {
      session_context: { sources: quellen.map(quelle) },
      events: prompt ? [{ data: { message: { content: prompt } } }] : undefined,
    },
  },
})

test('die Zeile Zentrale im Prompt ordnet die Routine der Zentrale zu', async () => {
  expect(zentraleAusPrompt('Rolle: Worker.\nZentrale: beispiel/meta\nSonst nichts.')).toBe('beispiel/meta')
  expect(zentraleAusPrompt([{ type: 'text', text: 'Zentrale: `beispiel/meta`.' }])).toBe('beispiel/meta')
  expect(zentraleAusPrompt('Ohne Zentrale.')).toBeUndefined()
  expect(zentraleAusPrompt(undefined)).toBeUndefined()

  const gruppen = gruppiere([
    trigger('t3', 'Autopilot beispiel: Chat', ['beispiel/meta', 'beispiel/eins'], 'Zentrale: beispiel/meta'),
    trigger('t1', 'Autopilot beispiel: Planer', ['beispiel/eins', 'beispiel/meta'], 'Zentrale: beispiel/meta'),
    trigger('t9', 'Autopilot solo: Worker', ['beispiel/solo'], 'Arbeite die Warteschlange ab.'),
    { ...trigger('t8', 'Autopilot solo: Planer', ['beispiel/solo']), enabled: false },
  ])
  expect(gruppen.map(g => [g.quelle, g.zentrale, g.routinen.map(r => r.rolle)])).toEqual([
    ['beispiel/meta', true, ['Planer', 'Chat']],
    ['beispiel/solo', false, ['Worker']],
  ])
})

test('die Repos einer Zentrale kommen aus repos:, in deren Reihenfolge, mit allen Routinen', async () => {
  const z = leseKonfig(ZENTRALE)
  expect(z.repos).toEqual(['beispiel/zwei', 'beispiel/eins'])
  expect(z.journal).toBe(102)
  expect(z.deckel).toEqual({ wip: 4, budget_5h: 70, nachschub_pro_tag: 3, wip_begleitet: 1, inventur_tage: 30 })

  const gruppen = [
    { quelle: 'beispiel/meta', zentrale: true, routinen: [{ rolle: 'Planer', triggerId: 't1' }, { rolle: 'Chat', triggerId: 't3' }] },
    { quelle: 'beispiel/solo', zentrale: false, routinen: [{ rolle: 'Worker', triggerId: 't9' }] },
  ]
  const e = verteile(gruppen, new Map([['beispiel/meta', z]]))
  expect(e.map(x => [x.repo, x.zentrale?.repo, x.routinen.map(r => r.triggerId)])).toEqual([
    ['beispiel/zwei', 'beispiel/meta', ['t1', 't3']],
    ['beispiel/eins', 'beispiel/meta', ['t1', 't3']],
    ['beispiel/solo', undefined, ['t9']],
  ])

  // Ohne lesbare Zentrale steht sie selbst da, mit dem Fehler
  const kaputt = verteile(gruppen.slice(0, 1), new Map([['beispiel/meta', 'autopilot.md: HTTP 404']]))
  expect(kaputt.map(x => [x.repo, x.fehler])).toEqual([['beispiel/meta', 'Zentrale beispiel/meta: autopilot.md: HTTP 404']])
})

test('Stufe und Repo-Deckel aus der Repo-Datei, Journal und globale Deckel aus der Zentrale', async () => {
  const k = fuehreZusammen(leseKonfig(REPO), leseKonfig(ZENTRALE))
  expect(k.stufe).toBe('begleitet')
  expect(k.journal).toBe(102)
  expect(k.deckel).toEqual({ wip: 4, budget_5h: 70, nachschub_pro_tag: 3, wip_begleitet: 2, inventur_tage: 30, diff_zeilen: 0 })
  // Ohne Repo-Datei gelten die Vorgaben der Zentrale
  const leer: Konfig | undefined = undefined
  expect(fuehreZusammen(leer, leseKonfig(ZENTRALE)).deckel.wip_begleitet).toBe(1)
})

test('WIP zaehlt ueber alle Repos der Zentrale, wip_begleitet je Repo', async () => {
  const basis = { auftraege: [], routinen: [], faelle: [], nachschubDeckel: 3, fehler: [] }
  const sichten = summiereWip([
    { ...basis, repo: 'beispiel/zwei', zentrale: 'beispiel/meta', wip: 3, wipAlleDeckel: 4 },
    { ...basis, repo: 'beispiel/eins', zentrale: 'beispiel/meta', wip: 1, wipDeckel: 1, wipAlleDeckel: 4 },
    { ...basis, repo: 'beispiel/solo', wip: 1, wipDeckel: 2 },
  ])
  expect(sichten.map(s => s.wipAlle)).toEqual([4, 4, undefined])
  const jetzt = Date.parse('2026-10-31T10:00:00Z')
  expect(auffaellig(sichten[0]!, jetzt).map(h => h.titel)).toEqual(['WIP-Deckel erreicht: 4 von 4 über alle Repos'])
  expect(auffaellig(sichten[1]!, jetzt).map(h => h.titel)).toEqual([
    'WIP-Deckel erreicht: 4 von 4 über alle Repos',
    'WIP-Deckel begleitet erreicht: 1 von 1',
  ])
  expect(auffaellig(sichten[2]!, jetzt)).toEqual([])
})
