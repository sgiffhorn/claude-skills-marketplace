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
  e.key === 'stand' ? { value: { value: { shape: 'stand-3', value: stand }, version: 1 } } : next(e)

test('ohne Zentrale zeigt das Panel Kopf, Braucht dich, Deckel, Repo-Zeile und Auffaelliges', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('state.get', zustand(STAND))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const find = (text: RegExp) => ui.find({ type: 'Text', text })
    // Kopf
    expect(await find(/^Autopilot$/)).toBeTruthy()
    expect(await find(/^repo · Journal #1 · 09:34 CET$/)).toBeTruthy()
    // Braucht dich: nur der echte Fall, mit Art
    expect(await find(/BRAUCHT DICH · 1/)).toBeTruthy()
    expect(await find(/^needs-human$/)).toBeTruthy()
    expect(await ui.find({ type: 'Link', text: 'Im Journal antworten' })).toBeTruthy()
    expect(await find(/^repo#21$/)).toBeTruthy()
    expect(await find(/^Grund: Die Schnittstelle liefert das Feld nicht, welcher Weg\?$/)).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'frei-beispiel/repo#21' })).toBeTruthy()
    expect(await find(/repo#22/)).toBeFalsy()
    // Deckel und Rollen
    expect(await find(/^DECKEL UND ROLLEN$/)).toBeTruthy()
    expect(await find(/^0 von 4$/)).toBeTruthy()
    expect(await find(/^Nachschub heute$/)).toBeTruthy()
    expect(await find(/^zuletzt 08:56 · nächster 09:55$/)).toBeTruthy()
    expect(await find(/^zuletzt 08:34 · nächster 12:54$/)).toBeTruthy()
    expect(await find(/^zuletzt 09:16$/)).toBeTruthy()
    expect(await ui.find({ type: 'Link', text: 'Alle Läufe' })).toBeTruthy()
    // Repo-Zeile eingeklappt
    expect(await ui.find({ type: 'Button', key: 'repo-beispiel/repo' })).toBeTruthy()
    expect(await find(/^1 wartet$/)).toBeTruthy()
    expect(await find(/^7 gemergt$/)).toBeTruthy()
    expect(await find(/^autonom · 0 in Arbeit · 0 bereit · 1 Vorschläge$/)).toBeTruthy()
    expect(await find(/WARTET AUF DICH/)).toBeFalsy()
    // Auffaellig als Saetze, ohne Repo davor
    expect(await find(/^Worker seit 04:55 ohne Arbeit\. Nachschub-Deckel schon um 03:34 erreicht, nächster Planer 12:54\.$/)).toBeTruthy()
    expect(await find(/^Planer 2× ohne Wirkung geweckt\. Vermutlich/)).toBeTruthy()
    expect(await find(/WIP-Deckel/)).toBeFalsy()
    await ui.unmount()
  }
})

test('ein aufgeklapptes Repo zeigt Details, Braucht dich und Deckel schrumpfen auf je eine Zeile', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('state.get', zustand(STAND))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const find = (text: RegExp) => ui.find({ type: 'Text', text })
  await ui.press({ key: 'repo-beispiel/repo' })
  expect(await find(/eingeklappt, weil ein Repo offen ist/)).toBeTruthy()
  expect(await find(/^Braucht dich · 1$/)).toBeTruthy()
  expect(await find(/^WIP 0 von 4$/)).toBeTruthy()
  expect(await find(/^● 3 Rollen ok$/)).toBeTruthy()
  expect(await find(/^DECKEL UND ROLLEN$/)).toBeFalsy()
  expect(await find(/^autonom · WIP 0 von 4$/)).toBeTruthy()
  expect(await find(/^WARTET AUF DICH$/)).toBeTruthy()
  expect(await find(/^repo#21$/)).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'frei-beispiel/repo#21' })).toBeTruthy()
  expect(await find(/^VORSCHLÄGE$/)).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'vorschlag-beispiel/repo#17' })).toBeTruthy()
  expect(await find(/Repariert sich selbst/)).toBeTruthy()
  expect(await find(/nächster Worker 09:55/)).toBeTruthy()
  expect(await ui.find({ type: 'Link', text: '#31' })).toBeTruthy()
  expect(await find(/^GEMERGT SEIT GESTERN 09:00$/)).toBeTruthy()
  expect(await find(/^Features 2 · Tests, Code 3 · Doku 2 · Autopilot 1$/)).toBeTruthy()
  expect(await find(/Beispielvorfall, erledigt/)).toBeTruthy()
  expect(await ui.find({ type: 'Link', text: 'Review-Läufe' })).toBeTruthy()
  // Zweiter Druck klappt wieder zu
  await ui.press({ key: 'repo-beispiel/repo' })
  expect(await find(/WARTET AUF DICH/)).toBeFalsy()
  expect(await find(/BRAUCHT DICH · 1/)).toBeTruthy()
  await ui.unmount()
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

test('mit Zentrale zeigt das Panel alle Faelle, globale Deckel einmal und je Repo eine Zeile', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  const Z = 'https://github.com/beispiel/zwei'
  const eins = { ...STAND.repos[0], zentrale: 'beispiel/meta', wip: 0, wipDeckel: undefined, wipAlle: 1, wipAlleDeckel: 4, ideen: 2, ideenAlle: 2, ideenDeckel: 30 }
  const zwei = {
    ...eins,
    repo: 'beispiel/zwei',
    stufe: 'begleitet',
    wip: 1,
    wipDeckel: 1,
    ideen: 0,
    auftraege: [{ phase: 'in Arbeit', issue: { number: 43, title: 'Beispielauftrag 43', url: `${Z}/issues/43` } }],
    faelle: [
      {
        nummer: 44,
        titel: 'Doku: Beispiel',
        url: `${Z}/issues/44`,
        pr: { number: 45, url: `${Z}/pull/45`, titel: 'Doku: Beispiel', zweig: 'claude/autopilot-44', plus: 9, minus: 11, dateien: 3, sha: 'abc123', ci: 'SUCCESS', mergebar: 'MERGEABLE' },
        grund: 'Urteil: würde mergen.',
        mechanisch: false,
        merge: true,
        runde: 2,
        belege: ['a.md:1 stimmt mit dem Code überein.', 'Nicht-Ziele eingehalten.'],
      },
      {
        nummer: 46,
        titel: 'Beispielfrage',
        url: `${Z}/issues/46`,
        grund: 'Welcher Weg?',
        mechanisch: false,
        entscheidung: true,
        optionen: [
          { kennung: 'a', text: 'Feld übernehmen' },
          { kennung: 'b', text: 'Feld weglassen' },
        ],
        stand: 'Das Feld gibt es nur im Export.',
      },
      { nummer: 47, titel: 'Schon beantwortet', url: `${Z}/issues/47`, grund: 'Alt?', mechanisch: false, entscheidung: true, beantwortet: true },
    ],
    digest: { ...STAND.repos[0].digest, gemergt: 1 },
    fehler: [],
  }
  on('state.get', zustand({ ...STAND, repos: [eins, zwei] }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const find = (text: RegExp) => ui.find({ type: 'Text', text })
    expect(await find(/^Zentrale meta · Journal #1 · 09:34 CET$/)).toBeTruthy()
    expect(await find(/BRAUCHT DICH · 3/)).toBeTruthy()
    expect(await find(/^zwei#45$/)).toBeTruthy()
    expect(await find(/^Doku: Beispiel$/)).toBeTruthy()
    expect(await find(/^Reviewer würde mergen \(Runde 2\)\. In Stufe begleitet mergst du\.$/)).toBeTruthy()
    expect(await find(/^\+9\/-11 in 3 Dateien · CI grün · mergebar$/)).toBeTruthy()
    expect(await find(/^Frage: Welcher Weg\?$/)).toBeTruthy()
    expect(await find(/^Stand: Das Feld gibt es nur im Export\.$/)).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'option-beispiel/zwei#46-a' })).toBeTruthy()
    expect(await find(/zwei#47/)).toBeFalsy()
    expect(await find(/^zwei#46$/)).toBeTruthy()
    expect(await find(/^Merge$/)).toBeTruthy()
    expect(await find(/^Entscheidung$/)).toBeTruthy()
    // Globale Deckel einmal
    expect(await ui.findAll({ type: 'Text', text: /^ALLE REPOS$/ })).toHaveLength(1)
    expect(await find(/^1 von 4$/)).toBeTruthy()
    expect(await find(/^2 von 30$/)).toBeTruthy()
    // Je Repo eine Zeile
    expect(await find(/^2 wartet$/)).toBeTruthy()
    expect(await find(/^begleitet · 1 in Arbeit · 0 bereit · 0 Vorschläge$/)).toBeTruthy()
    // Was die Zentrale betrifft, steht einmal und ohne Repo davor
    expect(await ui.findAll({ type: 'Text', text: /^Worker seit 04:55 ohne Arbeit/ })).toHaveLength(1)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'repo-beispiel/zwei' })
  expect(await ui.find({ type: 'Text', text: /^begleitet · WIP 1 von 1 \(begleitet\) · Reviewer mergt nicht$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^WIP 1 von 4 · Ideen 2 von 30$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Link', text: '#43 Beispielauftrag 43' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Braucht dich · 3$/ })).toBeTruthy()
  await ui.unmount()
})

// Zwei Repos einer Zentrale mit je einem Fall jeder Art, fuer die Knoepfe
function mitFaellen() {
  const Z = 'https://github.com/beispiel/zwei'
  const eins = { ...STAND.repos[0], zentrale: 'beispiel/meta' }
  const zwei = {
    ...eins,
    repo: 'beispiel/zwei',
    stufe: 'begleitet',
    auftraege: [],
    faelle: [
      {
        nummer: 44,
        titel: 'Doku: Beispiel',
        url: `${Z}/issues/44`,
        pr: { number: 45, url: `${Z}/pull/45`, titel: 'Doku: Beispiel', zweig: 'claude/autopilot-44', sha: 'abc123', mergebar: 'MERGEABLE' },
        grund: 'Urteil: würde mergen.',
        mechanisch: false,
        merge: true,
        belege: ['a.md:1 stimmt.'],
      },
      {
        nummer: 46,
        titel: 'Beispielfrage',
        url: `${Z}/issues/46`,
        grund: 'Welcher Weg?',
        mechanisch: false,
        entscheidung: true,
        optionen: [{ kennung: 'a', text: 'Feld übernehmen' }],
      },
    ],
  }
  return { ...STAND, repos: [eins, zwei] }
}

const gestartet = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const aufrufe: string[][] = []
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    aufrufe.push([...e.argv])
    return { value: { exitCode: 0, stdout: '{}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return aufrufe
}

test('Mergen fragt nach und mergt dann den geprueften Stand', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('state.get', zustand(mitFaellen()))
  const aufrufe = gestartet(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'belege-beispiel/zwei#44' })
  expect(await ui.find({ type: 'Text', text: /^1\. a\.md:1 stimmt\.$/ })).toBeTruthy()
  await ui.press({ key: 'merge-beispiel/zwei#44' })
  expect(await ui.find({ type: 'Text', text: /^PR #45 per squash mergen\?$/ })).toBeTruthy()
  expect(aufrufe.length).toBe(0)
  await ui.press({ key: 'ja-beispiel/zwei#44' })
  const merge = aufrufe.find(a => a.includes('repos/beispiel/zwei/pulls/45/merge'))
  expect(merge).toBeTruthy()
  expect(merge).toContain('sha=abc123')
  expect(merge).toContain('merge_method=squash')
  expect(merge).toContain('commit_title=Doku: Beispiel (#45)')
  expect(merge).toContain('commit_message=Closes #44')
  expect(aufrufe.some(a => a.includes('repos/beispiel/zwei/git/refs/heads/claude/autopilot-44'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^PR #45 gemergt\.$/ })).toBeTruthy()
  await ui.unmount()
})

test('Freigeben loest needs-human auf, eine Antwort geht mit', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('state.get', zustand(mitFaellen()))
  const aufrufe = gestartet(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'frei-beispiel/repo#21' })
  expect(aufrufe.some(a => a.includes('repos/beispiel/repo/issues/21/comments') && a.some(x => x.startsWith('body=<!-- autopilot:antwort -->')))).toBe(true)
  expect(aufrufe.some(a => a.includes('DELETE') && a.includes('repos/beispiel/repo/issues/21/labels/needs-human'))).toBe(true)
  expect(aufrufe.some(a => a.includes('repos/beispiel/repo/issues/21/labels') && a.includes('labels[]=autopilot:ready'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Freigegeben, #21 ist wieder bereit\.$/ })).toBeTruthy()

  aufrufe.length = 0
  await $.ui.input({ plugin: 'autopilot-monitor', key: 'antwort-beispiel/repo#21', text: 'Nimm Weg B.' })
  expect(aufrufe.some(a => a.includes('body=<!-- autopilot:antwort -->\nNimm Weg B.'))).toBe(true)
  await ui.unmount()
})

test('eine Entscheidung wird per Option oder eigener Antwort beantwortet', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('state.get', zustand(mitFaellen()))
  const aufrufe = gestartet(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'option-beispiel/zwei#46-a' })
  expect(aufrufe.some(a => a.includes('repos/beispiel/zwei/issues/46/comments') && a.includes('body=a) Feld übernehmen'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Planer arbeitet sie im nächsten Lauf ein/ })).toBeTruthy()

  aufrufe.length = 0
  await $.ui.input({ plugin: 'autopilot-monitor', key: 'antwort-beispiel/zwei#46', text: 'Weder noch, erst messen.' })
  expect(aufrufe.some(a => a.includes('body=Weder noch, erst messen.'))).toBe(true)
  await ui.unmount()
})

test('auf Mobile bleiben die Knoepfe, ohne Eingabefeld', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(AT)
  on('state.get', zustand(mitFaellen()))

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Button', key: 'frei-beispiel/repo#21' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'option-beispiel/zwei#46-a' })).toBeTruthy()
  expect(await ui.find({ type: 'Input' })).toBeFalsy()
  await ui.unmount()
})
