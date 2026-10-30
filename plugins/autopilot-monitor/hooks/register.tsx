import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Auftrag, Lauf, Phase, RepoSicht, Routine, Stand } from '../types'

const PANE = 'autopilot-monitor'
const TITEL = 'Autopilot'
const TAKT_MS = 2 * 60 * 1000
const BAND_TAKT_MS = 10 * 60 * 1000
const LAEUFE_JE_ROUTINE = 5
const READY_STAU_MS = 30 * 60 * 1000
const GH = ['gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh']
const SUCHE_ALLE_MS = 30 * 60 * 1000
const REVIEWER_WORKFLOW = 'autopilot-review.yml'

// Tag wechseln, sobald sich die Felder von Stand aendern
const stand = atom(
  { plugin: 'autopilot-monitor', key: 'stand' } as const,
  { at: 0, repos: [], isLoading: true } as Stand,
  { shape: 'stand-1' },
)
// Kennung der Deckel, die die Person im Band weggeklickt hat
const bandWeg = atom({ plugin: 'autopilot-monitor', key: 'bandWeg' } as const, null as string | null)

// ---------- Zeit in Europe/Berlin, ohne Intl ----------

const H = 3600 * 1000

function letzterSonntag(jahr: number, monat: number): number {
  const ende = Date.UTC(jahr, monat + 1, 0, 1)
  return ende - new Date(ende).getUTCDay() * 24 * H
}

function istSommerzeit(ms: number): boolean {
  const jahr = new Date(ms).getUTCFullYear()
  return ms >= letzterSonntag(jahr, 2) && ms < letzterSonntag(jahr, 9)
}

function lokal(ms: number): Date {
  return new Date(ms + (istSommerzeit(ms) ? 2 : 1) * H)
}

function zwei(n: number): string {
  return String(n).padStart(2, '0')
}

function tagesbeginn(ms: number): number {
  const d = lokal(ms)
  const mitternacht = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  // Die Umstellung liegt um 01:00 UTC, also nach Mitternacht Ortszeit
  return mitternacht - (istSommerzeit(mitternacht - 2 * H) ? 2 : 1) * H
}

function uhrzeit(ms: number, jetzt: number): string {
  const d = lokal(ms)
  const hm = `${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())}`
  const zone = istSommerzeit(ms) ? 'CEST' : 'CET'
  if (tagesbeginn(ms) === tagesbeginn(jetzt)) return `${hm} ${zone}`
  return `${zwei(d.getUTCDate())}.${zwei(d.getUTCMonth() + 1)}. ${hm} ${zone}`
}

function dauer(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${min % 60} min`
}

function kurz(text: string, max = 180): string {
  const eine = text.replace(/\s+/g, ' ').trim()
  return eine.length > max ? `${eine.slice(0, max - 1)}…` : eine
}

// ---------- Datenquellen ----------

let ghPfad: string | undefined

async function gh($: EngineInterface, args: string[]): Promise<string> {
  const kandidaten = ghPfad ? [ghPfad] : GH
  let letzter = 'gh nicht gefunden'
  for (const pfad of kandidaten) {
    try {
      const r = await $.process.run([pfad, ...args], { timeoutMs: 60000 })
      ghPfad = pfad
      if (r.exitCode !== 0) throw new Error(kurz(r.stderr || `gh endete mit ${r.exitCode}`, 200))
      return r.stdout
    } catch (err) {
      letzter = err instanceof Error ? err.message : String(err)
      if (ghPfad) throw err
    }
  }
  throw new Error(letzter)
}

// Routine-API von claude.ai, mit der Anmeldung der Session. Der Weg ueber das
// Werkzeug RemoteTrigger scheitert im Auto-Modus: ohne Anfrage des Modells
// gibt der Klassifikator kein Urteil.
const API = 'https://api.anthropic.com'
const API_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'ccr-triggers-2026-01-30',
}

async function api($: EngineInterface, pfad: string): Promise<any> {
  const auth = await $.session.authorize()
  if (!auth) throw new Error('keine claude.ai-Anmeldung in dieser Session')
  const r = await $.http.fetch(`${API}${pfad}`, { headers: API_HEADERS, auth: auth.handle })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${kurz(r.text, 160)}`)
  return JSON.parse(r.text)
}


// ---------- Repos aus den Routinen ----------

// Ein Repo gehoert dazu, sobald eine aktive Routine "Autopilot <name>: Planer",
// "...: Worker" oder "...: Reviewer" heisst; das Repo ist ihre erste Quelle.
type RepoEintrag = { repo: string; routinen: { rolle: string; triggerId: string }[] }

type TriggerRoh = {
  id: string
  name?: string
  enabled?: boolean
  job_config?: { ccr?: { session_context?: { sources?: { git_repository?: { url?: string } }[] } } }
}

const ROLLEN = ['Planer', 'Worker', 'Reviewer']
let gefunden: { at: number; repos: RepoEintrag[] } | undefined

async function findeRepos($: EngineInterface, jetzt: number): Promise<RepoEintrag[]> {
  if (gefunden && jetzt - gefunden.at < SUCHE_ALLE_MS) return gefunden.repos
  const je = new Map<string, RepoEintrag>()
  let cursor = ''
  for (let seite = 0; seite < 10; seite++) {
    const antwort = await api($, `/v1/code/triggers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
    for (const t of (antwort.data ?? []) as TriggerRoh[]) {
      const rolle = t.name?.match(/^Autopilot .+: (\w+)$/)?.[1]
      if (!t.enabled || !rolle || !ROLLEN.includes(rolle)) continue
      const url = t.job_config?.ccr?.session_context?.sources?.[0]?.git_repository?.url ?? ''
      const repo = url.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1]
      if (!repo) continue
      const eintrag = je.get(repo) ?? { repo, routinen: [] }
      eintrag.routinen.push({ rolle, triggerId: t.id })
      je.set(repo, eintrag)
    }
    cursor = antwort.next_cursor ?? ''
    if (!antwort.has_more || !cursor) break
  }
  for (const e of je.values()) e.routinen.sort((a, b) => ROLLEN.indexOf(a.rolle) - ROLLEN.indexOf(b.rolle))
  const repos = [...je.values()].sort((a, b) => a.repo.localeCompare(b.repo))
  gefunden = { at: jetzt, repos }
  return repos
}

// ---------- Konfiguration aus .claude/autopilot.md ----------

type Konfig = { stufe?: string; deckel: Record<string, number> }

function leseKonfig(md: string): Konfig {
  const kopf = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const konfig: Konfig = { deckel: {} }
  let block = ''
  for (const zeile of kopf.split('\n')) {
    if (/^\s*#/.test(zeile) || !zeile.trim()) continue
    const oben = zeile.match(/^([a-z_]+):\s*(.*)$/)
    if (oben) {
      block = oben[1] ?? ''
      if (block === 'stufe') konfig.stufe = (oben[2] ?? '').trim()
      continue
    }
    const innen = zeile.match(/^\s+([a-z_]+):\s*(\d+)\s*$/)
    if (innen?.[1] && block === 'deckel') konfig.deckel[innen[1]] = Number(innen[2])
  }
  return konfig
}

// ---------- Auftraege aus Labels ----------

const SUCHE = `query($q:String!){ search(query:$q, type:ISSUE, first:100){ nodes{ __typename
 ... on Issue{ number title url labels(first:20){nodes{name}} timelineItems(itemTypes:[LABELED_EVENT], last:30){nodes{... on LabeledEvent{createdAt label{name}}}} }
 ... on PullRequest{ number title url headRefName labels(first:20){nodes{name}} } } } }`

const LABELS = [
  'autopilot:proposed',
  'autopilot:ready',
  'autopilot:wip',
  'autopilot:review',
  'autopilot:changes',
  'autopilot:merge',
  'needs-human',
]

const RANG: [string, Phase][] = [
  ['needs-human', 'braucht dich'],
  ['autopilot:changes', 'Nacharbeit'],
  ['autopilot:review', 'im Review'],
  ['autopilot:merge', 'wird gemergt'],
  ['autopilot:wip', 'in Arbeit'],
  ['autopilot:ready', 'freigegeben'],
  ['autopilot:proposed', 'Vorschlag'],
]

type Knoten = {
  __typename: 'Issue' | 'PullRequest'
  number: number
  title: string
  url: string
  headRefName?: string
  labels: { nodes: { name: string }[] }
  timelineItems?: { nodes: { createdAt?: string; label?: { name: string } }[] }
}

async function leseAuftraege(
  $: EngineInterface,
  repo: string,
): Promise<{ auftraege: Auftrag[]; wip: number }> {
  const q = `repo:${repo} is:open label:${LABELS.map(l => `"${l}"`).join(',')}`
  const roh = await gh($, ['api', 'graphql', '-f', `query=${SUCHE}`, '-f', `q=${q}`])
  const knoten: Knoten[] = JSON.parse(roh).data.search.nodes

  type Zeile = { issue?: Knoten; pr?: Knoten }
  const je = new Map<number, Zeile>()
  const eigene: Zeile[] = []
  for (const k of knoten) {
    if (k.__typename === 'Issue') {
      je.set(k.number, { ...je.get(k.number), issue: k })
      continue
    }
    const n = Number(k.headRefName?.match(/^claude\/autopilot-(\d+)$/)?.[1])
    if (n) je.set(n, { ...je.get(n), pr: k })
    else eigene.push({ pr: k })
  }

  let wip = 0
  const auftraege: Auftrag[] = []
  for (const [n, z] of [...je.entries(), ...eigene.map(z => [0, z] as const)]) {
    const labels = new Set([
      ...(z.issue?.labels.nodes ?? []).map(l => l.name),
      ...(z.pr?.labels.nodes ?? []).map(l => l.name),
    ])
    const phase = RANG.find(([l]) => labels.has(l))?.[1]
    if (!phase) continue
    if (z.issue?.labels.nodes.some(l => l.name === 'autopilot:wip')) wip++
    if (z.pr?.labels.nodes.some(l => /^autopilot:(review|changes|merge)$/.test(l.name))) wip++

    const issue = z.issue
      ? { number: z.issue.number, title: z.issue.title, url: z.issue.url }
      : n
        ? { number: n, title: '', url: `https://github.com/${repo}/issues/${n}` }
        : undefined
    const pr = z.pr ? { number: z.pr.number, title: z.pr.title, url: z.pr.url } : undefined
    let readySeit: number | undefined
    if (phase === 'freigegeben') {
      const ereignisse = z.issue?.timelineItems?.nodes ?? []
      const letztes = ereignisse.filter(x => x.label?.name === 'autopilot:ready').pop()
      if (letztes?.createdAt) readySeit = Date.parse(letztes.createdAt)
    }
    auftraege.push({ issue, pr, phase, readySeit })
  }
  const ordnung = (a: Auftrag) => RANG.findIndex(([, p]) => p === a.phase)
  auftraege.sort(
    (a, b) => ordnung(a) - ordnung(b) || (a.issue?.number ?? 0) - (b.issue?.number ?? 0),
  )
  return { auftraege, wip }
}

async function zaehleWorkerHeute($: EngineInterface, repo: string, jetzt: number): Promise<number> {
  const seit = new Date(tagesbeginn(jetzt)).toISOString().replace(/\.\d+Z$/, 'Z')
  const roh = await gh($, [
    'api',
    '--paginate',
    `repos/${repo}/issues/comments?since=${seit}&per_page=100`,
    '--jq',
    `.[] | select(.created_at >= "${seit}") | select(.body | contains("<!-- autopilot:work-start")) | .id`,
  ])
  return roh.split('\n').filter(Boolean).length
}

// ---------- Routine-Laeufe ----------

type LaufRoh = {
  id: string
  created_at: string
  last_event_at?: string
  worker_status?: string
}

type Ereignis = {
  event_type: string
  payload?: {
    subtype?: string
    is_error?: boolean
    result?: string
    message?: { content?: string | { type: string; text?: string }[] }
    data?: { level?: string; content?: string }
  }
}

type Cache = Record<string, { lastEventAt: number; ergebnis: string }>

function textVon(e: Ereignis): string {
  const c = e.payload?.message?.content
  if (typeof c === 'string') return c
  return (c ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join(' ')
}

// Ereignisse kommen neueste zuerst
function ergebnisAusEreignissen(ereignisse: Ereignis[]): string {
  const alt = [...ereignisse].reverse()
  let anlass = ''
  let letzteAntwort = ''
  let abschluss = ''
  let fehlerHinweis = ''
  let stopHook = false
  for (const e of alt) {
    const text = textVon(e)
    if (e.event_type === 'user' && text.includes('github-trigger-context')) {
      const ereignis = text.match(/Event: (\S+)/)?.[1] ?? 'GitHub'
      const nr = text.match(/(?:Issue|Pull request|PR): #(\d+)/i)?.[1]
      anlass = nr ? `${ereignis} #${nr}` : ereignis
    } else if (e.event_type === 'user' && text.includes('Stop hook feedback')) {
      stopHook = true
    } else if (e.event_type === 'assistant' && !stopHook && text.trim()) {
      letzteAntwort = text
    } else if (e.event_type === 'result') {
      const p = e.payload ?? {}
      if (p.is_error || (p.subtype && p.subtype !== 'success')) {
        fehlerHinweis = `Fehler (${p.subtype ?? 'error'}): `
      }
      abschluss = p.result ?? ''
    } else if (e.event_type === 'env_manager_log' && e.payload?.data?.level === 'error') {
      fehlerHinweis = 'Umgebung: '
      letzteAntwort = letzteAntwort || (e.payload.data.content ?? '')
    }
  }
  const kern = letzteAntwort || abschluss || 'noch kein Ergebnis'
  return kurz(`${anlass ? `[${anlass}] ` : ''}${fehlerHinweis}${kern}`)
}

async function leseRoutine(
  $: EngineInterface,
  rolle: string,
  triggerId: string,
  cache: Cache,
  neu: Cache,
): Promise<Routine> {
  const routine: Routine = {
    rolle,
    url: `https://claude.ai/code/routines/${triggerId}`,
    laeufe: [],
  }
  try {
    const liste = await api($, `/v1/code/sessions?trigger_id=${encodeURIComponent(triggerId)}`)
    const runs: LaufRoh[] = liste.data ?? []
    runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    for (const run of runs.slice(0, LAEUFE_JE_ROUTINE)) {
      const lastEventAt = Date.parse(run.last_event_at ?? run.created_at)
      const isRunning = run.worker_status !== undefined && run.worker_status !== 'idle'
      const alt = cache[run.id]
      let ergebnis = alt?.lastEventAt === lastEventAt ? alt.ergebnis : ''
      if (!ergebnis || isRunning) {
        try {
          const log = await api($, `/v1/code/sessions/${encodeURIComponent(run.id)}/events`)
          ergebnis = ergebnisAusEreignissen(log.data ?? [])
        } catch (err) {
          ergebnis = `Log nicht lesbar: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      if (!isRunning) neu[run.id] = { lastEventAt, ergebnis }
      routine.laeufe.push({
        id: run.id,
        url: `https://claude.ai/code/${run.id.replace(/^cse_/, 'session_')}`,
        startedAt: Date.parse(run.created_at),
        lastEventAt,
        isRunning,
        ergebnis,
      })
    }
  } catch (err) {
    routine.fehler = err instanceof Error ? err.message : String(err)
  }
  return routine
}

async function leseReviewer($: EngineInterface, repo: string, workflow: string): Promise<Routine | undefined> {
  const routine: Routine = {
    rolle: 'Reviewer',
    url: `https://github.com/${repo}/actions/workflows/${workflow}`,
    laeufe: [],
  }
  try {
    const roh = await gh($, [
      'api',
      `repos/${repo}/actions/workflows/${workflow}/runs?per_page=${LAEUFE_JE_ROUTINE}`,
    ])
    type Run = {
      id: number
      html_url: string
      created_at: string
      updated_at: string
      status: string
      conclusion: string | null
      display_title: string
      event: string
    }
    for (const r of JSON.parse(roh).workflow_runs as Run[]) {
      routine.laeufe.push({
        id: String(r.id),
        url: r.html_url,
        startedAt: Date.parse(r.created_at),
        lastEventAt: Date.parse(r.updated_at),
        isRunning: r.status !== 'completed',
        ergebnis: kurz(`[${r.event}] ${r.conclusion ?? r.status}: ${r.display_title}`),
      })
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    // Kein Reviewer-Workflow im Repo: dann eben keiner
    if (/404|Not Found/.test(text)) return undefined
    routine.fehler = text
  }
  return routine
}

// ---------- Ein Durchlauf ----------

async function leseRepo(
  $: EngineInterface,
  eintrag: RepoEintrag,
  jetzt: number,
  cache: Cache,
  neu: Cache,
): Promise<RepoSicht> {
  const sicht: RepoSicht = { repo: eintrag.repo, auftraege: [], routinen: [], fehler: [] }
  const fehler = (was: string) => (err: unknown) => {
    sicht.fehler.push(`${was}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const konfig = gh($, [
    'api',
    '-H',
    'Accept: application/vnd.github.raw',
    `repos/${eintrag.repo}/contents/.claude/autopilot.md`,
  ])
    .then(md => leseKonfig(md))
    .catch(err => {
      fehler('autopilot.md')(err)
      return undefined
    })
  const auftraege = leseAuftraege($, eintrag.repo).catch(err => {
    fehler('Auftraege')(err)
    return undefined
  })
  const heute = zaehleWorkerHeute($, eintrag.repo, jetzt).catch(err => {
    fehler('Worker-Laeufe heute')(err)
    return undefined
  })
  const hatReviewerRoutine = eintrag.routinen.some(r => r.rolle === 'Reviewer')
  const routinen = Promise.all([
    ...eintrag.routinen.map(r => leseRoutine($, r.rolle, r.triggerId, cache, neu)),
    ...(hatReviewerRoutine ? [] : [leseReviewer($, eintrag.repo, REVIEWER_WORKFLOW)]),
  ]).then(liste => liste.filter((r): r is Routine => r !== undefined))

  const [k, a, h, r] = await Promise.all([konfig, auftraege, heute, routinen])
  sicht.stufe = k?.stufe
  sicht.routinen = r
  if (a) {
    sicht.auftraege = a.auftraege
    sicht.wip = a.wip
  }
  sicht.workerHeute = h
  sicht.workerDeckel = k?.deckel.worker_laeufe_pro_tag
  sicht.wipDeckel =
    k?.stufe === 'begleitet' ? (k.deckel.wip_begleitet ?? k.deckel.wip) : k?.deckel.wip
  return sicht
}

function workerVoll(r: RepoSicht): boolean {
  return r.workerHeute !== undefined && r.workerDeckel !== undefined && r.workerHeute >= r.workerDeckel
}

function wipVoll(r: RepoSicht): boolean {
  return r.wip !== undefined && r.wipDeckel !== undefined && r.wip >= r.wipDeckel
}

function deckelKurz(r: RepoSicht): string[] {
  const t: string[] = []
  if (workerVoll(r)) t.push(`Worker-Tageslimit ${r.workerHeute}/${r.workerDeckel}`)
  if (wipVoll(r)) t.push(`WIP-Deckel ${r.wip}/${r.wipDeckel}`)
  return t
}

let laeuft = false

async function istOffen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function aktualisiere($: EngineInterface): Promise<void> {
  if (laeuft) return
  laeuft = true
  try {
    await update($, stand, s => ({ ...s, isLoading: true }))
    const jetzt = await $.clock.now()
    const cache = ((await $.store.get('laeufe')) ?? {}) as Cache
    const neu: Cache = {}
    const eintraege = await findeRepos($, jetzt)
    const repos = await Promise.all(eintraege.map(r => leseRepo($, r, jetzt, cache, neu)))
    await $.store.set('laeufe', neu)
    await update($, stand, () => ({ at: jetzt, repos, isLoading: false }))
  } catch (err) {
    const fehler = err instanceof Error ? err.message : String(err)
    await update($, stand, s => ({ ...s, isLoading: false, fehler }))
  } finally {
    laeuft = false
  }
}


// ---------- Hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'autopilot-panel',
      description: 'Autopilot-Panel ein- oder ausblenden',
    })
    // Zuletzt gewaehlter Zustand gilt fuer jede neue Session
    if ((await $.store.get('offen')) !== false) void $.ui.open({ id: PANE, title: TITEL })
    void aktualisiere($)
    // Offenes Panel im Takt, sonst seltener fuer das Band
    $.clock.every(TAKT_MS, () => void (async () => {
      const alt = (await read($, stand)).at
      if ((await istOffen($)) || (await $.clock.now()) - alt >= BAND_TAKT_MS) await aktualisiere($)
    })())
    return next(e)
  })

  on('command.run', { command: 'autopilot-panel' }, async $ => {
    if (await istOffen($)) {
      await $.store.set('offen', false)
      await $.ui.close({ id: PANE })
      return { text: 'Autopilot-Panel ausgeblendet.' }
    }
    await $.store.set('offen', true)
    await $.ui.open({ id: PANE, title: TITEL })
    void aktualisiere($)
    return { text: 'Autopilot-Panel eingeblendet.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('offen', false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const greifen = (await read($, stand)).repos
      .map(r => ({ repo: r.repo, texte: deckelKurz(r) }))
      .filter(g => g.texte.length > 0)
    if (greifen.length === 0) return next(e)
    const kennung = greifen.map(g => `${g.repo}:${g.texte.join(',')}`).join(';')
    if ((await read($, bandWeg)) === kennung) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const offen = await istOffen($)
    const text = greifen
      .map(g => `${g.repo.split('/').pop()}: ${g.texte.join(', ')}`)
      .join(' · ')

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color="error">⚠ Autopilot {text}</Text>
        {!offen && (
          <Button
            key="panel"
            label="Panel"
            onPress={async () => {
              await $.store.set('offen', true)
              await $.ui.open({ id: PANE, title: TITEL })
            }}
          />
        )}
        <Button key="weg" label="Ausblenden" onPress={() => update($, bandWeg, () => kennung)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const s = await read($, stand)
    const jetzt = await $.clock.now()

    const kopf = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text dimColor>
          {s.at ? `Stand ${uhrzeit(s.at, jetzt)}` : 'Lade …'}
          {s.isLoading && s.at ? ' · lädt …' : ''}
        </Text>
        <Button key="neu" label="Aktualisieren" onPress={() => void aktualisiere($)} />
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {kopf}
        {s.fehler && <Text color="error">Fehler: {s.fehler}</Text>}
        {s.at > 0 && !s.fehler && s.repos.length === 0 && (
          <Text dimColor>Keine aktive Routine namens „Autopilot …: Planer|Worker|Reviewer“ gefunden.</Text>
        )}
        {s.repos.map(r => {
          const warnungen: string[] = []
          if (workerVoll(r)) {
            warnungen.push(
              `Worker-Tageslimit erreicht: ${r.workerHeute} von ${r.workerDeckel} Läufen heute. Neue Läufe enden ohne Arbeit bis 00:00 ${istSommerzeit(jetzt) ? 'CEST' : 'CET'}.`,
            )
          }
          if (wipVoll(r)) {
            warnungen.push(`WIP-Deckel erreicht: ${r.wip} von ${r.wipDeckel}.`)
          }
          const stau = r.auftraege.filter(
            a => a.phase === 'freigegeben' && a.readySeit !== undefined && jetzt - a.readySeit > READY_STAU_MS,
          )
          if (stau.length > 0) {
            warnungen.push(
              `${stau.length} freigegebene Issues seit über 30 min nicht in Arbeit: ${stau
                .map(a => `#${a.issue?.number} (${dauer(jetzt - (a.readySeit ?? jetzt))})`)
                .join(', ')}`,
            )
          }
          const braucht = r.auftraege.filter(a => a.phase === 'braucht dich').length

          return (
            <Box key={`repo-${r.repo}`} flexDirection="column" gap={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Link href={`https://github.com/${r.repo}`}>
                  <Text weight="bold">{r.repo}</Text>
                </Link>
                <Text dimColor>
                  {r.stufe ? `Stufe ${r.stufe}` : ''}
                  {r.workerHeute !== undefined ? ` · Worker ${r.workerHeute}/${r.workerDeckel ?? '?'}` : ''}
                  {r.wip !== undefined ? ` · WIP ${r.wip}/${r.wipDeckel ?? '?'}` : ''}
                </Text>
              </Box>

              {warnungen.length > 0 && (
                <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
                  {warnungen.map(w => (
                    <Text color="error" weight="semibold">
                      ⚠ {w}
                    </Text>
                  ))}
                </Box>
              )}
              {braucht > 0 && (
                <Box borderStyle="round" borderColor="warning" paddingX={1}>
                  <Text color="warning" weight="semibold">
                    {braucht} {braucht === 1 ? 'Auftrag braucht' : 'Aufträge brauchen'} dich.
                  </Text>
                </Box>
              )}
              {r.fehler.map(f => (
                <Text color="error">Fehler {f}</Text>
              ))}

              <Box flexDirection="column">
                <Text weight="semibold">Aufträge ({r.auftraege.length})</Text>
                {r.auftraege.length === 0 && <Text dimColor>Keine offenen Aufträge.</Text>}
                {r.auftraege.map(a => (
                  <Box flexDirection="row" gap={1}>
                    <Text color={farbe(a.phase)}>{a.phase.padEnd(12)}</Text>
                    {a.issue && <Link href={a.issue.url} label={`#${a.issue.number}`} />}
                    {a.pr && <Link href={a.pr.url} label={`PR #${a.pr.number}`} />}
                    <Text dimColor>{kurz(a.issue?.title || a.pr?.title || '', 70)}</Text>
                  </Box>
                ))}
              </Box>

              {r.routinen.map(rt => (
                <Box flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    {rt.url ? (
                      <Link href={rt.url}>
                        <Text weight="semibold">{rt.rolle}</Text>
                      </Link>
                    ) : (
                      <Text weight="semibold">{rt.rolle}</Text>
                    )}
                    <Text dimColor>letzte Läufe</Text>
                  </Box>
                  {rt.fehler && <Text color="error">Fehler: {rt.fehler}</Text>}
                  {!rt.fehler && rt.laeufe.length === 0 && <Text dimColor>Keine Läufe.</Text>}
                  {rt.laeufe.map((l: Lauf) => (
                    <Box flexDirection="row" gap={1}>
                      <Link href={l.url} label={uhrzeit(l.startedAt, jetzt)} />
                      {l.isRunning && <Text color="suggestion">läuft</Text>}
                      <Text dimColor={!l.isRunning}>{l.ergebnis}</Text>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}

function farbe(p: Phase): string {
  switch (p) {
    case 'braucht dich':
      return 'warning'
    case 'Nacharbeit':
      return 'error'
    case 'in Arbeit':
    case 'im Review':
    case 'wird gemergt':
      return 'success'
    case 'freigegeben':
      return 'suggestion'
    default:
      return 'inactive'
  }
}
