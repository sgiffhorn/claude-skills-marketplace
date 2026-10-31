import { expect, mock, test } from 'claude-code/testing'

// Erfundener Stand, 31.10.2026 09:34 CET: Warteschlange leer, Nachschub verbraucht,
// ein echter Fall, zwei mechanische, Planer zweimal ohne Wirkung geweckt
const AT = Date.UTC(2026, 9, 31, 8, 34)
const MIN = 60 * 1000
const R = 'https://github.com/beispiel/repo'

const STAND = {
  at: AT,
  isLoading: false,
  repos: [
    {
      repo: 'beispiel/repo',
      stufe: 'autonom',
      auftraege: [
        { phase: 'braucht dich', issue: { number: 21, title: 'Beispielauftrag 21', url: `${R}/issues/21` } },
        { phase: 'Vorschlag', issue: { number: 17, title: 'Beispielauftrag 17', url: `${R}/issues/17` } },
      ],
      faelle: [
        {
          nummer: 21,
          titel: 'Beispielauftrag 21',
          url: `${R}/issues/21`,
          grund: 'Die Schnittstelle liefert das Feld nicht, welcher Weg?',
          mechanisch: false,
        },
        {
          nummer: 22,
          titel: 'Beispielauftrag 22',
          url: `${R}/issues/22`,
          pr: { number: 31, url: `${R}/pull/31` },
          grund: 'Review-Lauf ohne Urteil (https://example.invalid/run/1).',
          mechanisch: true,
        },
        {
          nummer: 23,
          titel: 'Beispielauftrag 23',
          url: `${R}/issues/23`,
          pr: { number: 32, url: `${R}/pull/32` },
          grund: 'Leitplanke: PR #32 ist nicht mergebar.',
          mechanisch: true,
        },
      ],
      digest: {
        seit: AT - 25 * 60 * MIN,
        gemergt: 7,
        features: 2,
        tests: 3,
        doku: 2,
        autopilot: 1,
        featureTitel: [
          { nummer: 41, titel: 'Beispielfunktion A', url: `${R}/pull/41` },
          { nummer: 40, titel: 'Beispielfunktion B', url: `${R}/pull/40` },
        ],
        prod: [{ nummer: 50, titel: 'Beispielvorfall', url: `${R}/issues/50`, offen: false }],
      },
      journalUrl: `${R}/issues/1`,
      wip: 0,
      wipDeckel: 4,
      nachschubHeute: 3,
      nachschubDeckel: 3,
      nachschubVollUm: AT - 6 * 60 * MIN,
      routinen: [
        {
          rolle: 'Planer',
          url: 'https://claude.ai/code/routines/trig_planer',
          naechster: AT + 200 * MIN,
          laeufe: [
            { id: 'p3', url: 'https://claude.ai/code/session_p3', startedAt: AT - 60 * MIN, lastEventAt: AT - 59 * MIN, isRunning: false, ergebnis: '[issues.labeled #9] Kein Nachschub-Lauf, Ende, nichts geschrieben.' },
            { id: 'p2', url: 'https://claude.ai/code/session_p2', startedAt: AT - 90 * MIN, lastEventAt: AT - 89 * MIN, isRunning: false, ergebnis: '[issues.labeled #8] Kein Nachschub-Lauf, Ende, nichts geschrieben.' },
            { id: 'p1', url: 'https://claude.ai/code/session_p1', startedAt: AT - 400 * MIN, lastEventAt: AT - 390 * MIN, isRunning: false, ergebnis: 'Nachschub 3 von 3: zwei neue Auftraege angelegt.' },
          ],
        },
        {
          rolle: 'Worker',
          url: 'https://claude.ai/code/routines/trig_worker',
          naechster: AT + 21 * MIN,
          laeufe: [
            { id: 'w2', url: 'https://claude.ai/code/session_w2', startedAt: AT - 38 * MIN, lastEventAt: AT - 37 * MIN, isRunning: false, ergebnis: 'Warteschlange leer, Nachschub-Deckel 3 von 3 erreicht.' },
            { id: 'w1', url: 'https://claude.ai/code/session_w1', startedAt: AT - 279 * MIN, lastEventAt: AT - 278 * MIN, isRunning: false, ergebnis: 'Warteschlange leer, Nachschub-Deckel 3 von 3 erreicht.' },
            { id: 'w0', url: 'https://claude.ai/code/session_w0', startedAt: AT - 500 * MIN, lastEventAt: AT - 450 * MIN, isRunning: false, ergebnis: '#20, PR #30, Gate gruen.' },
          ],
        },
        {
          rolle: 'Chat',
          url: 'https://claude.ai/code/routines/trig_chat',
          laeufe: [
            { id: 'c1', url: 'https://claude.ai/code/session_c1', startedAt: AT - 18 * MIN, lastEventAt: AT - 17 * MIN, isRunning: false, ergebnis: 'Frage beantwortet.' },
          ],
        },
      ],
      fehler: [],
    },
  ],
}

const PANE = {
  plugin: 'autopilot-monitor',
  component: 'Pane',
  requestId: 'autopilot-monitor',
  props: {
    title: 'Autopilot',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const zustand = (stand: unknown) => ($: unknown, e: { key: string }, next: (e: unknown) => unknown) =>
  e.key === 'stand' ? { value: { value: { shape: 'stand-2', value: stand }, version: 1 } } : next(e)

test('das Panel zeigt die Abschnitte des Mockups auf jeder Oberflaeche', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('state.get', zustand(STAND))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const find = (text: RegExp) => ui.find({ type: 'Text', text })
    // Kopf und Chips
    expect(await find(/autonom · 09:34 CET/)).toBeTruthy()
    expect(await find(/Worker wartet/)).toBeTruthy()
    expect(await find(/Warteschlange leer/)).toBeTruthy()
    expect(await find(/Nachschub 3\/3 verbraucht/)).toBeTruthy()
    // Braucht dich: nur der echte Fall, die mechanischen grau
    expect(await find(/Braucht dich · 1/)).toBeTruthy()
    expect(await find(/#21 Beispielauftrag 21/)).toBeTruthy()
    expect(await find(/#22 Beispielauftrag 22/)).toBeFalsy()
    expect(await find(/Repariert sich selbst/)).toBeTruthy()
    expect(await find(/nächster Worker 09:55/)).toBeTruthy()
    expect(await ui.find({ type: 'Link', text: '#31' })).toBeTruthy()
    expect(await ui.find({ type: 'Link', text: 'Im Journal antworten' })).toBeTruthy()
    // Digest
    expect(await find(/SEIT GESTERN 09:00/)).toBeTruthy()
    expect(await find(/^Tests, Code$/)).toBeTruthy()
    expect(await find(/und 5 weitere/)).toBeTruthy()
    expect(await find(/Autopilot selbst: 1 Änderung$/)).toBeTruthy()
    expect(await find(/Beispielvorfall, erledigt/)).toBeTruthy()
    // Auffaellig
    expect(await find(/Worker seit 04:55 ohne Arbeit/)).toBeTruthy()
    expect(await find(/schon um 03:34 erreicht, nächster Planer 12:54/)).toBeTruthy()
    expect(await find(/Planer 2× ohne Wirkung geweckt/)).toBeTruthy()
    expect(await find(/WIP-Deckel/)).toBeFalsy()
    // Deckel und Budget, ohne den alten Worker-Tageswert
    expect(await find(/^Nachschub heute$/)).toBeTruthy()
    expect(await find(/^0 von 4$/)).toBeTruthy()
    expect(await find(/Worker \d+\/\?/)).toBeFalsy()
    // Rollen
    expect(await find(/zuletzt 08:56, Warteschlange leer.* · nächster 09:55/)).toBeTruthy()
    expect(await find(/zuletzt 09:16, Frage beantwortet\./)).toBeTruthy()
    expect(await find(/zuletzt 08:34, Kein Nachschub-Lauf/)).toBeTruthy()
    expect(await ui.find({ type: 'Link', text: 'Alle Läufe' })).toBeTruthy()
    await ui.unmount()
  }
})

const BAND = {
  plugin: 'autopilot-monitor',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('das Band zeigt echte Faelle und Auffaelliges und laesst sich ausblenden', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const }))
  on('state.get', zustand(STAND))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /repo: 1 braucht dich · Worker seit 04:55 ohne Arbeit · Planer 2× ohne Wirkung/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Review-Lauf|#22/ })).toBeFalsy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'weg' })
  expect(await ui.find({ type: 'Text', text: /braucht dich/ })).toBeFalsy()
  await ui.unmount()
})

test('ohne echte Faelle und ohne Auffaelliges bleibt das Band leer', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  const ruhig = {
    ...STAND,
    repos: [
      {
        ...STAND.repos[0],
        faelle: STAND.repos[0].faelle.filter(f => f.mechanisch),
        nachschubHeute: 1,
        routinen: [],
      },
    ],
  }
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const }))
  on('state.get', zustand(ruhig))

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Autopilot/ })).toBeFalsy()
  await ui.unmount()
})
