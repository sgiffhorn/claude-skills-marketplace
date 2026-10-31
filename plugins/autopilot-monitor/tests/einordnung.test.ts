import { expect, test } from 'claude-code/testing'

import {
  baueDigest,
  belegeAus,
  budgetBalken,
  digestBeginn,
  frageAus,
  frageKurz,
  grundKurz,
  istMechanisch,
  kategorie,
  ohneArbeit,
  ohneWirkung,
  ordneFaelle,
  zaehleNachschub,
} from '../hooks/register'

const R = 'https://github.com/beispiel/repo'
const NH = '<!-- autopilot:needs-human -->'

test('mechanische Gruende raeumt der Worker ab, echte bleiben beim Menschen', async () => {
  expect(istMechanisch('Review-Lauf ohne Urteil (https://example.invalid/run/1).')).toBe(true)
  expect(istMechanisch('Review-Workflow gescheitert, kein Ergebnis.')).toBe(true)
  expect(istMechanisch('Leitplanke: PR #32 ist nicht mergebar (`mergeable: false`).')).toBe(true)
  expect(istMechanisch('Review-Workflow gescheitert an der Merge-Leitplanke.')).toBe(false)
  expect(istMechanisch('Befund: die Schnittstelle liefert das Feld nicht. Welcher Weg?')).toBe(false)
  expect(istMechanisch('')).toBe(false)
})

test('der Grund ist der erste Satz ohne Marker und Fusszeile', async () => {
  const body = `${NH}\nBefund: das Feld fehlt, z. B. an der Spule. Der Rest steht hier.\n\nFrage: welcher Weg?\n\n---\n_Fusszeile_`
  expect(grundKurz(body)).toBe('Befund: das Feld fehlt, z. B. an der Spule.')
  expect(grundKurz(`${NH}\nReview-Lauf ohne Urteil (https://example.invalid/run/1).`)).toBe(
    'Review-Lauf ohne Urteil (https://example.invalid/run/1).',
  )
})

test('Issue und PR sind ein Fall, der juengste needs-human-Kommentar zaehlt', async () => {
  const faelle = ordneFaelle([
    {
      __typename: 'Issue',
      number: 22,
      title: 'Beispielauftrag 22',
      url: `${R}/issues/22`,
      comments: { nodes: [{ body: `${NH}\nEine echte Frage an den Menschen?`, createdAt: '2026-10-30T10:00:00Z' }] },
    },
    {
      __typename: 'PullRequest',
      number: 31,
      title: 'PR zu 22',
      url: `${R}/pull/31`,
      headRefName: 'claude/autopilot-22',
      comments: {
        nodes: [
          { body: `${NH}\nReview-Lauf ohne Urteil (https://example.invalid/run/2).`, createdAt: '2026-10-30T12:00:00Z' },
          { body: 'Kommentar ohne Marker', createdAt: '2026-10-30T13:00:00Z' },
        ],
      },
    },
    {
      __typename: 'Issue',
      number: 21,
      title: 'Beispielauftrag 21',
      url: `${R}/issues/21`,
      comments: { nodes: [{ body: `${NH}\nUmbauen, warten oder verwerfen?`, createdAt: '2026-10-30T09:00:00Z' }] },
    },
  ])
  expect(faelle.length).toBe(2)
  expect(faelle[0]).toEqual({
    nummer: 21,
    titel: 'Beispielauftrag 21',
    url: `${R}/issues/21`,
    pr: undefined,
    grund: 'Umbauen, warten oder verwerfen?',
    mechanisch: false,
    frage: 'Umbauen, warten oder verwerfen?',
  })
  expect(faelle[1]?.nummer).toBe(22)
  expect(faelle[1]?.pr).toMatchObject({ number: 31, url: `${R}/pull/31`, zweig: 'claude/autopilot-22' })
  expect(faelle[1]?.mechanisch).toBe(true)
})

test('Digest-Kategorien nach dem Titel', async () => {
  expect(kategorie('Doku: Beispielseite nachgezogen')).toBe('doku')
  expect(kategorie('Handbuch: neuer Abschnitt')).toBe('doku')
  expect(kategorie('Test: Beispielfunktion abgesichert')).toBe('tests')
  expect(kategorie('test: Zweig ohne Ergebnis')).toBe('tests')
  expect(kategorie('Tests: zwei Faelle')).toBe('tests')
  expect(kategorie('Toter Code: Hilfsfunktion entfernt')).toBe('tests')
  expect(kategorie('autopilot: Deckel neu')).toBe('autopilot')
  expect(kategorie('autopilot-review: Urteil schliessen')).toBe('autopilot')
  expect(kategorie('Beispielfunktion: neuer Knopf')).toBe('features')
})

test('der Digest zaehlt nur Autopilot-Zweige im Fenster, Autopilot selbst getrennt', async () => {
  const seit = Date.parse('2026-10-30T08:00:00Z')
  const pr = (number: number, title: string, mergedAt: string, headRefName = `claude/autopilot-${number}`) => ({
    number,
    title,
    url: `${R}/pull/${number}`,
    headRefName,
    mergedAt,
  })
  const d = baueDigest(
    [
      pr(1, 'Funktion A', '2026-10-30T09:00:00Z'),
      pr(2, 'Funktion B', '2026-10-31T07:00:00Z'),
      pr(3, 'Doku: Seite', '2026-10-30T10:00:00Z'),
      pr(4, 'Test: Fall', '2026-10-30T11:00:00Z'),
      pr(5, 'autopilot: Deckel', '2026-10-30T12:00:00Z', 'claude/autopilot-master-3'),
      pr(6, 'Funktion alt', '2026-10-30T07:00:00Z'),
      pr(7, 'Abhaengigkeit hoch', '2026-10-30T09:30:00Z', 'renovate/beispiel'),
      ...[8, 9, 10, 11, 12].map(n => pr(n, `Funktion ${n}`, '2026-10-30T15:00:00Z')),
    ],
    [
      { number: 50, title: 'Vorfall im Fenster', url: `${R}/issues/50`, state: 'CLOSED', createdAt: '2026-10-30T20:00:00Z', closedAt: '2026-10-30T21:00:00Z' },
      { number: 49, title: 'Vorfall offen', url: `${R}/issues/49`, state: 'OPEN', createdAt: '2026-10-31T06:00:00Z', closedAt: null },
      { number: 48, title: 'Vorfall alt', url: `${R}/issues/48`, state: 'CLOSED', createdAt: '2026-10-20T06:00:00Z', closedAt: '2026-10-21T06:00:00Z' },
    ],
    seit,
  )
  expect([d.gemergt, d.features, d.tests, d.doku, d.autopilot]).toEqual([9, 7, 1, 1, 1])
  expect(d.featureTitel.map(p => p.nummer)).toEqual([2, 8, 9, 10, 11])
  expect(d.prod).toEqual([
    { nummer: 50, titel: 'Vorfall im Fenster', url: `${R}/issues/50`, offen: false },
    { nummer: 49, titel: 'Vorfall offen', url: `${R}/issues/49`, offen: true },
  ])
})

test('das Digest-Fenster beginnt gestern 09:00 Ortszeit, auch ueber die Umstellung', async () => {
  expect(new Date(digestBeginn(Date.parse('2026-10-31T08:34:00Z'))).toISOString()).toBe('2026-10-30T08:00:00.000Z')
  expect(new Date(digestBeginn(Date.parse('2026-10-26T08:00:00Z'))).toISOString()).toBe('2026-10-25T08:00:00.000Z')
  expect(new Date(digestBeginn(Date.parse('2026-07-01T05:00:00Z'))).toISOString()).toBe('2026-06-30T07:00:00.000Z')
})

test('Nachschub zaehlt Laufzeilen von heute und merkt, wann der Deckel erreicht war', async () => {
  const tag = Date.parse('2026-10-30T23:00:00Z')
  const j = (createdAt: string, text: string) => ({ body: `<!-- autopilot:journal -->\n${text}`, createdAt })
  const n = zaehleNachschub(
    [
      j('2026-10-30T22:00:00Z', '23:00 Nachschub 3 von 3: gestern'),
      j('2026-10-31T00:10:00Z', '01:10 Nachschub 1 von 3: zwei Auftraege'),
      j('2026-10-31T00:40:00Z', '01:40: nichts zu tun.'),
      j('2026-10-31T01:16:00Z', '02:16 Nachschub 3 von 3: einer'),
      j('2026-10-31T00:50:00Z', '01:50 Nachschub 2 von 3: einer'),
      { body: 'Nachschub bitte', createdAt: '2026-10-31T02:00:00Z' },
    ],
    tag,
    3,
  )
  expect(n).toEqual({ heute: 3, vollUm: Date.parse('2026-10-31T01:16:00Z') })
  expect(zaehleNachschub([], tag, 3)).toEqual({ heute: 0, vollUm: undefined })
})

test('Worker ohne Arbeit und Planer ohne Wirkung am Ergebnistext', async () => {
  expect(ohneArbeit('Warteschlange leer, Nachschub angefordert (1 von 3 heute)')).toBe(true)
  expect(ohneArbeit('#20, PR #30, Gate gruen.')).toBe(false)
  expect(ohneWirkung('[issues.labeled #9] Kein Nachschub-Lauf, Ende ohne Schreibzugriff.')).toBe(true)
  expect(ohneWirkung('Nachschub 1 von 3: zwei neue Auftraege.')).toBe(false)
})

test('Budget-Balken mit den Bremsschwellen des Workers', async () => {
  const jetzt = Date.parse('2026-10-31T10:00:00Z')
  // Reset in 6 Tagen: ein Siebtel der Woche vorbei, Soll 14 %
  const reset = new Date(jetzt + 6 * 24 * 3600 * 1000).toISOString()
  const r = { repo: 'beispiel/repo', auftraege: [], routinen: [], faelle: [], nachschubDeckel: 3, fehler: [] }
  const b = budgetBalken(r, [
    { kind: 'five_hour', percentUsed: 17 },
    { kind: 'seven_day', percentUsed: 11, resetsAt: reset },
  ], jetzt)
  expect(b.map(x => x.anzeige)).toEqual(['17 %', '11 % (Soll 14 %)'])
  expect(b.map(x => x.warn)).toEqual([false, false])
  const eng = budgetBalken({ ...r, budget5h: 50 }, [
    { kind: 'five_hour', percentUsed: 55 },
    { kind: 'seven_day', percentUsed: 30, resetsAt: reset },
  ], jetzt)
  expect(eng.map(x => x.warn)).toEqual([true, true])
  expect(budgetBalken(r, [], jetzt)).toEqual([])
})

test('eine offene Entscheidung braucht dich, mit der juengsten Frage des Planers', async () => {
  const F = '<!-- autopilot:entscheidung -->'
  expect(frageKurz(`${F}\n**Frage:** Darf das Etikett die Kundennummer tragen?\n**Optionen:** a) ja, b) nein.`)).toBe(
    'Darf das Etikett die Kundennummer tragen?',
  )
  const faelle = ordneFaelle([
    {
      __typename: 'Issue',
      number: 40,
      title: 'Etikett mit Kundennummer',
      url: `${R}/issues/40`,
      body: `${F}\n**Frage:** Alte Frage?`,
      labels: { nodes: [{ name: 'autopilot:entscheidung' }] },
      comments: {
        nodes: [
          { body: `${F}\n**Frage:** Neue Frage nach der Antwort?`, createdAt: '2026-10-31T10:00:00Z' },
          { body: 'Antwort ohne Marker', createdAt: '2026-10-31T11:00:00Z' },
        ],
      },
    },
  ])
  expect(faelle).toEqual([
    {
      nummer: 40,
      titel: 'Etikett mit Kundennummer',
      url: `${R}/issues/40`,
      grund: 'Neue Frage nach der Antwort?',
      mechanisch: false,
      entscheidung: true,
      beantwortet: true,
    },
  ])
})

test('eine Entscheidung bringt Optionen und Stand mit, ohne Antwort ist sie offen', async () => {
  const F = '<!-- autopilot:entscheidung -->'
  const [fall] = ordneFaelle([
    {
      __typename: 'Issue',
      number: 41,
      title: 'Beispielentscheidung',
      url: `${R}/issues/41`,
      body: `${F}\n**Frage:** Welcher Weg?\n**Optionen:** a) Feld \`x\` übernehmen, b) Feld weglassen.\n**Quelle:** docs/a.md\n**Stand:** Das Feld gibt es nur im Export.`,
      labels: { nodes: [{ name: 'autopilot:entscheidung' }] },
      comments: { nodes: [{ body: '<!-- autopilot:journal -->\nLauf', createdAt: '2026-10-31T11:00:00Z' }] },
    },
  ])
  expect(fall?.beantwortet).toBeUndefined()
  expect(fall?.optionen).toEqual([
    { kennung: 'a', text: 'Feld x übernehmen' },
    { kennung: 'b', text: 'Feld weglassen' },
  ])
  expect(fall?.stand).toBe('Das Feld gibt es nur im Export.')
})

test('needs-human: Frage und nummerierte Befunde aus dem Kommentar', async () => {
  const body = `${NH}\nRunde 3: zwei Befunde sind nicht behoben.\n\n1. \`a.ts:3\` prüft den Fall nicht.\n2. Test fehlt.\n\nSoll der Worker den Test nachziehen oder reicht die Prüfung?`
  expect(frageAus(body)).toBe('Soll der Worker den Test nachziehen oder reicht die Prüfung?')
  expect(belegeAus(body)).toEqual(['a.ts:3 prüft den Fall nicht.', 'Test fehlt.'])
  expect(frageAus(`${NH}\n**Frage:** Welcher Weg?`)).toBe('Welcher Weg?')
  expect(frageAus(`${NH}\nNur ein Befund.`)).toBeUndefined()
})

test('ein PR, den der Reviewer in Stufe begleitet freigibt, ist ein Merge-Fall', async () => {
  const [fall] = ordneFaelle([
    {
      __typename: 'PullRequest',
      number: 45,
      title: 'Doku: Beispiel',
      url: `${R}/pull/45`,
      headRefName: 'claude/autopilot-44',
      comments: { nodes: [{ body: `${NH}\nUrteil: würde mergen. CI grün.`, createdAt: '2026-10-30T12:00:00Z' }] },
    },
    {
      __typename: 'Issue',
      number: 44,
      title: 'Doku: Beispiel',
      url: `${R}/issues/44`,
      comments: { nodes: [] },
    },
  ])
  expect(fall?.merge).toBe(true)
  expect(fall?.pr).toMatchObject({ number: 45, url: `${R}/pull/45` })
  expect(fall?.frage).toBeUndefined()
  expect(fall?.grund).toBe('Urteil: würde mergen.')
})
