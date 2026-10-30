import { expect, mock, test } from 'claude-code/testing'

// Erfundener Stand: sechs freigegeben, keins in Arbeit, Worker-Limit erreicht
const STAND = {
 "at": 1793369544161,
 "isLoading": false,
 "repos": [
  {
   "repo": "beispiel/repo",
   "stufe": "autonom",
   "auftraege": [
    {
     "phase": "freigegeben",
     "issue": {
      "number": 11,
      "title": "Beispielauftrag 11",
      "url": "https://github.com/beispiel/repo/issues/11"
     },
     "readySeit": 1793365284161
    },
    {
     "phase": "freigegeben",
     "issue": {
      "number": 12,
      "title": "Beispielauftrag 12",
      "url": "https://github.com/beispiel/repo/issues/12"
     },
     "readySeit": 1793365224161
    },
    {
     "phase": "freigegeben",
     "issue": {
      "number": 13,
      "title": "Beispielauftrag 13",
      "url": "https://github.com/beispiel/repo/issues/13"
     },
     "readySeit": 1793365164161
    },
    {
     "phase": "freigegeben",
     "issue": {
      "number": 14,
      "title": "Beispielauftrag 14",
      "url": "https://github.com/beispiel/repo/issues/14"
     },
     "readySeit": 1793365104161
    },
    {
     "phase": "freigegeben",
     "issue": {
      "number": 15,
      "title": "Beispielauftrag 15",
      "url": "https://github.com/beispiel/repo/issues/15"
     },
     "readySeit": 1793365044161
    },
    {
     "phase": "freigegeben",
     "issue": {
      "number": 16,
      "title": "Beispielauftrag 16",
      "url": "https://github.com/beispiel/repo/issues/16"
     },
     "readySeit": 1793364984161
    },
    {
     "phase": "Vorschlag",
     "issue": {
      "number": 17,
      "title": "Beispielauftrag 17",
      "url": "https://github.com/beispiel/repo/issues/17"
     }
    }
   ],
   "routinen": [
    {
     "rolle": "Planer",
     "url": "https://claude.ai/code/routines/trig_planer",
     "laeufe": [
      {
       "id": "cse_p1",
       "url": "https://claude.ai/code/session_p1",
       "startedAt": 1793364144161,
       "lastEventAt": 1793364204161,
       "isRunning": false,
       "ergebnis": "Drei neue Auftraege angelegt."
      }
     ]
    },
    {
     "rolle": "Worker",
     "url": "https://claude.ai/code/routines/trig_worker",
     "laeufe": [
      {
       "id": "cse_w1",
       "url": "https://claude.ai/code/session_w1",
       "startedAt": 1793367744161,
       "lastEventAt": 1793367804161,
       "isRunning": false,
       "ergebnis": "[issues.labeled #16] Tageslimit erreicht: 6 von 6 work-start-Laeufen."
      }
     ]
    }
   ],
   "workerHeute": 6,
   "workerDeckel": 6,
   "wip": 0,
   "wipDeckel": 2,
   "fehler": []
  }
 ]
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
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('das Panel zeigt Deckel, Stau und Laeufe auf jeder Oberflaeche', async ($, on) => {
  const uhr = mock.clock(on)
  await uhr.set(STAND.at)
  on('state.get', ($, e, next) =>
    e.key === 'stand' ? { value: { value: { shape: 'stand-1', value: STAND }, version: 1 } } : next(e),
  )

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const limit = await ui.find({ type: 'Text', text: /Worker-Tageslimit erreicht: 6 von 6/ })
    expect(limit).toBeTruthy()
    const stau = await ui.find({ type: 'Text', text: /6 freigegebene Issues seit über 30 min/ })
    expect(stau).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /WIP-Deckel/ })).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /Tageslimit erreicht: 6 von 6 work-start/ })).toBeTruthy()
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

test('das Band zeigt greifende Deckel und laesst sich ausblenden', async ($, on) => {
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const }))
  on('state.get', ($, e, next) =>
    e.key === 'stand' ? { value: { value: { shape: 'stand-1', value: STAND }, version: 1 } } : next(e),
  )

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /repo: Worker-Tageslimit 6\/6/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /WIP/ })).toBeFalsy()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'weg' })
  expect(await ui.find({ type: 'Text', text: /Worker-Tageslimit/ })).toBeFalsy()
  await ui.unmount()
})
