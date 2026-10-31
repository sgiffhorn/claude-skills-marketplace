import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Auftrag, Digest, Fall, Phase, RepoSicht, Routine, Stand } from '../types'

const PANE = 'autopilot-monitor'
const TITEL = 'Autopilot'
const TAKT_MS = 2 * 60 * 1000
const BAND_TAKT_MS = 10 * 60 * 1000
const READY_STAU_MS = 30 * 60 * 1000
const GH = ['gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh']
const SUCHE_ALLE_MS = 30 * 60 * 1000
const REVIEWER_WORKFLOW = 'autopilot-review.yml'
const NACHSCHUB_VORGABE = 3
const ALLE_LAEUFE = 'https://claude.ai/code/routines'

// Tag wechseln, sobald sich die Felder von Stand aendern
const stand = atom(
  { plugin: 'autopilot-monitor', key: 'stand' } as const,
  { at: 0, repos: [], isLoading: true } as Stand,
  { shape: 'stand-2' },
)
// Kennung der Hinweise, die die Person im Band weggeklickt hat
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

// Gestern 09:00 Ortszeit, Beginn des Digest-Fensters
export function digestBeginn(jetzt: number): number {
  const d = lokal(jetzt)
  const wand = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1, 9)
  return istSommerzeit(wand - 2 * H) ? wand - 2 * H : wand - H
}

// Uhrzeit ohne Zone, an einem anderen Tag mit Datum davor
function hm(ms: number, jetzt: number): string {
  const d = lokal(ms)
  const zeit = `${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())}`
  if (tagesbeginn(ms) === tagesbeginn(jetzt)) return zeit
  return `${zwei(d.getUTCDate())}.${zwei(d.getUTCMonth() + 1)}. ${zeit}`
}

function uhrzeit(ms: number, jetzt: number): string {
  return `${hm(ms, jetzt)} ${istSommerzeit(ms) ? 'CEST' : 'CET'}`
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
const STARTFEHLER = /ENOENT|failed to start/

export async function gh($: EngineInterface, args: string[]): Promise<string> {
  const kandidaten = ghPfad ? [ghPfad, ...GH.filter(p => p !== ghPfad)] : GH
  let letzter = 'gh nicht gefunden'
  for (const pfad of kandidaten) {
    const r = await $.process
      .run([pfad, ...args], { timeoutMs: 60000 })
      .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    if (r instanceof Error) {
      letzter = r.message
      // Ein gemerkter Pfad, der nur haengt, bleibt gemerkt; startet er nicht mehr
      // (PATH der App geaendert), gilt wieder die ganze Liste
      if (pfad === ghPfad && !STARTFEHLER.test(letzter)) throw r
      if (pfad === ghPfad) ghPfad = undefined
      continue
    }
    ghPfad = pfad
    if (r.exitCode !== 0) throw new Error(kurz(r.stderr || `gh endete mit ${r.exitCode}`, 200))
    return r.stdout
  }
  throw new Error(letzter)
}

// Routine-API von claude.ai, mit der Anmeldung der Session. Der Weg ueber das
// Werkzeug RemoteTrigger scheitert im Auto-Modus: ohne Anfrage des Modells
// gibt der Klassifikator kein Urteil.
const API = 'https://api.anthropic.com'
// $.http.fetch legt die Header des Auth-Handles zuletzt darueber, darunter
// anthropic-beta: oauth-2025-04-20. Unter gleichem Schluessel ginge die
// Routine-Beta verloren (404); die andere Schreibweise haengt beide an.
const API_HEADERS = {
  'anthropic-version': '2023-06-01',
  'Anthropic-Beta': 'ccr-triggers-2026-01-30',
}

// Ohne x-organization-uuid antwortet die Routine-API mit 404. Die Engine
// nennt die Organisation nur unter verwalteter Anmeldung, also aus der
// Konfiguration von Claude Code lesen, wie es RemoteTrigger intern tut.
let orgUuid: string | undefined

async function organisation($: EngineInterface): Promise<string> {
  if (orgUuid) return orgUuid
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || (await $.env.get('HOME'))
  const konfig = JSON.parse(await $.fs.read(`${dir}/.claude.json`))
  const uuid = konfig?.oauthAccount?.organizationUuid
  if (!uuid) throw new Error('keine Organisation in .claude.json, mit /login anmelden')
  orgUuid = uuid
  return uuid
}

async function api($: EngineInterface, pfad: string): Promise<any> {
  const auth = await $.session.authorize()
  if (!auth) throw new Error('keine claude.ai-Anmeldung in dieser Session')
  const headers = { ...API_HEADERS, 'x-organization-uuid': await organisation($) }
  const r = await $.http.fetch(`${API}${pfad}`, { headers, auth: auth.handle })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${kurz(r.text, 160)}`)
  return JSON.parse(r.text)
}


// ---------- Repos aus den Routinen ----------

// Ein Repo gehoert dazu, sobald eine aktive Routine "Autopilot <name>: Planer",
// "...: Worker", "...: Reviewer" oder "...: Chat" heisst; das Repo ist ihre erste Quelle.
type RepoEintrag = { repo: string; routinen: { rolle: string; triggerId: string; naechster?: number }[] }

type TriggerRoh = {
  id: string
  name?: string
  enabled?: boolean
  next_run_at?: string | null
  job_config?: { ccr?: { session_context?: { sources?: { git_repository?: { url?: string } }[] } } }
}

// Reihenfolge im Panel
const ROLLEN = ['Planer', 'Worker', 'Reviewer', 'Chat']
let gefunden: { at: number; repos: RepoEintrag[] } | undefined

function veraltet(repos: RepoEintrag[], jetzt: number): boolean {
  // Ein vergangener naechster Lauf heisst: die Routine lief, die Zeit ist neu zu lesen
  return repos.some(r => r.routinen.some(x => x.naechster !== undefined && x.naechster <= jetzt))
}

async function findeRepos($: EngineInterface, jetzt: number): Promise<RepoEintrag[]> {
  if (gefunden && jetzt - gefunden.at < SUCHE_ALLE_MS && !veraltet(gefunden.repos, jetzt)) {
    return gefunden.repos
  }
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
      const naechster = t.next_run_at ? Date.parse(t.next_run_at) : NaN
      eintrag.routinen.push({ rolle, triggerId: t.id, naechster: Number.isNaN(naechster) ? undefined : naechster })
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

type Konfig = { stufe?: string; journal?: number; deckel: Record<string, number> }

function leseKonfig(md: string): Konfig {
  const kopf = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const konfig: Konfig = { deckel: {} }
  let block = ''
  for (const zeile of kopf.split('\n')) {
    if (/^\s*#/.test(zeile) || !zeile.trim()) continue
    const oben = zeile.match(/^([a-z_]+):\s*(.*)$/)
    if (oben) {
      block = oben[1] ?? ''
      const wert = (oben[2] ?? '').trim()
      if (block === 'stufe') konfig.stufe = wert
      if (block === 'journal_issue' && Number(wert) > 0) konfig.journal = Number(wert)
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

function issueVonZweig(zweig?: string): number | undefined {
  const n = Number(zweig?.match(/^claude\/autopilot-(\d+)$/)?.[1])
  return n || undefined
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
    const n = issueVonZweig(k.headRefName)
    if (n) je.set(n, { ...je.get(n), pr: k })
    else eigene.push({ pr: k })
  }

  // WIP wie beim Worker: offene Issues mit autopilot:wip
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

// ---------- needs-human: echte Entscheidung oder mechanisch ----------

const NH_MARKE = '<!-- autopilot:needs-human -->'

// Dieselben technischen Gruende, die der Worker selbst abraeumt (autopilot-work)
export function istMechanisch(grund: string): boolean {
  if (/Review-Lauf ohne Urteil|kein Ergebnis|nicht mergebar/.test(grund)) return true
  return grund.includes('Review-Workflow gescheitert') && !grund.includes('Merge-Leitplanke')
}

// Erster Satz des Kommentars, ohne Marker und Fusszeile
export function grundKurz(body: string): string {
  const text = body.replace(/<!--[\s\S]*?-->/g, '').split(/\n-{3,}\s*\n/)[0] ?? ''
  const zeile = text.split('\n').map(z => z.trim()).find(z => z) ?? ''
  // Ein Satz endet nach mindestens zwei Zeichen, damit "z. B." nicht schneidet
  const satz = zeile.match(/^.*?[^\s.]{2}[.?!](?=\s|$)/)?.[0] ?? zeile
  return kurz(satz, 160)
}

type NhKnoten = {
  __typename: 'Issue' | 'PullRequest'
  number: number
  title: string
  url: string
  headRefName?: string
  comments?: { nodes: { body: string; createdAt: string }[] }
}

export function ordneFaelle(knoten: NhKnoten[]): Fall[] {
  type Paar = { issue?: NhKnoten; pr?: NhKnoten }
  const je = new Map<string, Paar>()
  for (const k of knoten) {
    if (k.__typename === 'Issue') {
      const s = `#${k.number}`
      je.set(s, { ...je.get(s), issue: k })
      continue
    }
    const n = issueVonZweig(k.headRefName)
    const s = n ? `#${n}` : `pr${k.number}`
    je.set(s, { ...je.get(s), pr: k })
  }
  const faelle: Fall[] = []
  for (const { issue, pr } of je.values()) {
    const kommentare = [...(issue?.comments?.nodes ?? []), ...(pr?.comments?.nodes ?? [])]
      .filter(c => c.body.includes(NH_MARKE))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const juengster = kommentare.pop()?.body ?? ''
    const kopf = issue ?? pr
    if (!kopf) continue
    faelle.push({
      nummer: kopf.number,
      titel: kopf.title,
      url: kopf.url,
      pr: issue && pr ? { number: pr.number, url: pr.url } : undefined,
      grund: juengster ? grundKurz(juengster) : 'Kein needs-human-Kommentar gefunden.',
      mechanisch: istMechanisch(juengster),
    })
  }
  return faelle.sort((a, b) => a.nummer - b.nummer)
}

// ---------- Digest seit gestern 09:00 ----------

export type Kategorie = 'features' | 'tests' | 'doku' | 'autopilot'

export function kategorie(titel: string): Kategorie {
  const t = titel.trim()
  if (/^autopilot/i.test(t)) return 'autopilot'
  if (/^(doku|handbuch)/i.test(t)) return 'doku'
  if (/^(test|toter code)/i.test(t)) return 'tests'
  return 'features'
}

type PrRoh = { number?: number; title?: string; url?: string; headRefName?: string; mergedAt?: string }
type ProdRoh = { number?: number; title?: string; url?: string; state?: string; createdAt?: string; closedAt?: string | null }

export function baueDigest(prs: PrRoh[], prod: ProdRoh[], seit: number): Digest {
  const digest: Digest = { seit, gemergt: 0, features: 0, tests: 0, doku: 0, autopilot: 0, featureTitel: [], prod: [] }
  const eigene = prs
    .filter(p => /^claude\/autopilot-/.test(p.headRefName ?? ''))
    .filter(p => p.mergedAt && Date.parse(p.mergedAt) >= seit)
    .sort((a, b) => Date.parse(b.mergedAt ?? '') - Date.parse(a.mergedAt ?? ''))
  for (const p of eigene) {
    const k = kategorie(p.title ?? '')
    digest[k]++
    if (k === 'autopilot') continue
    digest.gemergt++
    if (k === 'features' && digest.featureTitel.length < 5) {
      digest.featureTitel.push({ nummer: p.number ?? 0, titel: p.title ?? '', url: p.url ?? '' })
    }
  }
  for (const i of prod) {
    const imFenster = [i.createdAt, i.closedAt].some(t => t && Date.parse(t) >= seit)
    if (!imFenster || !i.number) continue
    digest.prod.push({ nummer: i.number, titel: i.title ?? '', url: i.url ?? '', offen: i.state === 'OPEN' })
  }
  return digest
}

// ---------- Nachschub aus dem Journal ----------

export function zaehleNachschub(
  kommentare: { body: string; createdAt: string }[],
  tag: number,
  deckel: number,
): { heute: number; vollUm?: number } {
  const zeiten = kommentare
    .filter(c => c.body.startsWith('<!-- autopilot:journal -->') && c.body.includes('Nachschub'))
    .map(c => Date.parse(c.createdAt))
    .filter(t => t >= tag)
    .sort((a, b) => a - b)
  return { heute: zeiten.length, vollUm: zeiten.length >= deckel ? zeiten[deckel - 1] : undefined }
}

const UEBERSICHT = `query($nh:String!, $pr:String!, $prod:String!, $o:String!, $n:String!, $j:Int!, $mitJournal:Boolean!){
 nh: search(query:$nh, type:ISSUE, first:50){ nodes{ __typename
  ... on Issue{ number title url comments(last:20){nodes{body createdAt}} }
  ... on PullRequest{ number title url headRefName comments(last:20){nodes{body createdAt}} } } }
 merged: search(query:$pr, type:ISSUE, first:100){ nodes{ ... on PullRequest{ number title url headRefName mergedAt } } }
 prod: search(query:$prod, type:ISSUE, first:20){ nodes{ ... on Issue{ number title url state createdAt closedAt } } }
 repository(owner:$o, name:$n) @include(if:$mitJournal){ issue(number:$j){ url comments(last:100){ nodes{ body createdAt } } } } }`

type Uebersicht = {
  faelle: Fall[]
  digest: Digest
  journalUrl?: string
  nachschub?: { heute: number; vollUm?: number }
}

async function leseUebersicht(
  $: EngineInterface,
  repo: string,
  journal: number | undefined,
  nachschubDeckel: number,
  jetzt: number,
): Promise<Uebersicht> {
  const seit = digestBeginn(jetzt)
  const ab = new Date(seit).toISOString().replace(/\.\d+Z$/, 'Z')
  const [owner, name] = repo.split('/')
  const roh = await gh($, [
    'api', 'graphql',
    '-f', `query=${UEBERSICHT}`,
    '-f', `nh=repo:${repo} is:open label:needs-human`,
    '-f', `pr=repo:${repo} is:pr is:merged merged:>=${ab}`,
    '-f', `prod=repo:${repo} is:issue label:prod-incident updated:>=${ab}`,
    '-f', `o=${owner}`,
    '-f', `n=${name}`,
    '-F', `j=${journal ?? 0}`,
    '-F', `mitJournal=${journal ? 'true' : 'false'}`,
  ])
  const d = JSON.parse(roh).data
  const issue = d.repository?.issue
  return {
    faelle: ordneFaelle(d.nh.nodes ?? []),
    digest: baueDigest(d.merged.nodes ?? [], d.prod.nodes ?? [], seit),
    journalUrl: issue?.url,
    nachschub: issue ? zaehleNachschub(issue.comments.nodes ?? [], tagesbeginn(jetzt), nachschubDeckel) : undefined,
  }
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
  // Lang genug, um "nichts geschrieben" auch spaet im Text zu finden
  return kurz(`${anlass ? `[${anlass}] ` : ''}${fehlerHinweis}${kern}`, 300)
}

// Wie viele Laeufe je Rolle gelesen werden: der Planer fuer den Zaehler der
// letzten 24 h, der Worker fuer "seit wann ohne Arbeit", sonst nur der letzte
function auswahl(rolle: string, runs: LaufRoh[], jetzt: number): LaufRoh[] {
  if (rolle === 'Planer') {
    const tag = runs.filter(r => Date.parse(r.created_at) >= jetzt - 24 * H)
    return (tag.length > 0 ? tag : runs).slice(0, 30)
  }
  return runs.slice(0, rolle === 'Worker' ? 10 : 1)
}

async function leseRoutine(
  $: EngineInterface,
  eintrag: { rolle: string; triggerId: string; naechster?: number },
  jetzt: number,
  cache: Cache,
  neu: Cache,
): Promise<Routine> {
  const { rolle, triggerId } = eintrag
  const routine: Routine = {
    rolle,
    url: `https://claude.ai/code/routines/${triggerId}`,
    laeufe: [],
    naechster: eintrag.naechster !== undefined && eintrag.naechster > jetzt ? eintrag.naechster : undefined,
  }
  try {
    const liste = await api($, `/v1/code/sessions?trigger_id=${encodeURIComponent(triggerId)}`)
    const runs: LaufRoh[] = liste.data ?? []
    runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    for (const run of auswahl(rolle, runs, jetzt)) {
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
    const roh = await gh($, ['api', `repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`])
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
  const sicht: RepoSicht = {
    repo: eintrag.repo,
    auftraege: [],
    routinen: [],
    faelle: [],
    nachschubDeckel: NACHSCHUB_VORGABE,
    fehler: [],
  }
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
  const uebersicht = konfig.then(k =>
    leseUebersicht($, eintrag.repo, k?.journal, k?.deckel.nachschub_pro_tag ?? NACHSCHUB_VORGABE, jetzt).catch(
      err => {
        fehler('Uebersicht')(err)
        return undefined
      },
    ),
  )
  const hatReviewerRoutine = eintrag.routinen.some(r => r.rolle === 'Reviewer')
  const routinen = Promise.all([
    ...eintrag.routinen.map(r => leseRoutine($, r, jetzt, cache, neu)),
    ...(hatReviewerRoutine ? [] : [leseReviewer($, eintrag.repo, REVIEWER_WORKFLOW)]),
  ]).then(liste =>
    liste
      .filter((r): r is Routine => r !== undefined)
      .sort((a, b) => ROLLEN.indexOf(a.rolle) - ROLLEN.indexOf(b.rolle)),
  )

  const [k, a, u, r] = await Promise.all([konfig, auftraege, uebersicht, routinen])
  sicht.stufe = k?.stufe
  sicht.routinen = r
  if (a) {
    sicht.auftraege = a.auftraege
    sicht.wip = a.wip
  }
  if (u) {
    sicht.faelle = u.faelle
    sicht.digest = u.digest
    sicht.journalUrl = u.journalUrl
    sicht.nachschubHeute = u.nachschub?.heute
    sicht.nachschubVollUm = u.nachschub?.vollUm
  }
  sicht.nachschubDeckel = k?.deckel.nachschub_pro_tag ?? NACHSCHUB_VORGABE
  sicht.wipDeckel =
    k?.stufe === 'begleitet' ? (k.deckel.wip_begleitet ?? k.deckel.wip) : k?.deckel.wip
  return sicht
}

// ---------- Auswertung fuer Panel und Band ----------

function wipVoll(r: RepoSicht): boolean {
  return r.wip !== undefined && r.wipDeckel !== undefined && r.wip >= r.wipDeckel
}

function nachschubVoll(r: RepoSicht): boolean {
  return r.nachschubHeute !== undefined && r.nachschubHeute >= r.nachschubDeckel
}

function rolle(r: RepoSicht, name: string): Routine | undefined {
  return r.routinen.find(x => x.rolle === name)
}

// Lauf des Workers, der keinen Auftrag hatte
export function ohneArbeit(ergebnis: string): boolean {
  if (/PR #?\d+/.test(ergebnis)) return false
  return /Warteschlange leer|nichts zu tun|keine Arbeit|kein(?:en)? Auftrag|Nachschub/i.test(ergebnis)
}

// Planer-Lauf, den ein Ereignis ohne Label-Filter geweckt hat
export function ohneWirkung(ergebnis: string): boolean {
  return /nichts geschrieben|kein Nachschub-Lauf/i.test(ergebnis)
}

export type Hinweis = { titel: string; text?: string; schwer: boolean }

export function auffaellig(r: RepoSicht, jetzt: number): Hinweis[] {
  const hinweise: Hinweis[] = []
  const bereit = r.auftraege.filter(a => a.phase === 'freigegeben')
  const worker = rolle(r, 'Worker')
  const planer = rolle(r, 'Planer')

  const letzter = worker?.laeufe[0]
  if (bereit.length === 0 && letzter && !letzter.isRunning && ohneArbeit(letzter.ergebnis) && nachschubVoll(r)) {
    let seit = letzter.startedAt
    for (const l of worker?.laeufe ?? []) {
      if (l.isRunning || !ohneArbeit(l.ergebnis)) break
      seit = l.startedAt
    }
    const voll = r.nachschubVollUm ? ` schon um ${hm(r.nachschubVollUm, jetzt)}` : ''
    const naechster = planer?.naechster ? `, nächster Planer ${hm(planer.naechster, jetzt)}` : ''
    hinweise.push({
      titel: `Worker seit ${hm(seit, jetzt)} ohne Arbeit`,
      text: `Nachschub-Deckel${voll} erreicht${naechster}.`,
      schwer: true,
    })
  }

  const leer = (planer?.laeufe ?? []).filter(
    l => !l.isRunning && l.startedAt >= jetzt - 24 * H && ohneWirkung(l.ergebnis),
  ).length
  if (leer > 0) {
    hinweise.push({
      titel: `Planer ${leer}× ohne Wirkung geweckt`,
      text: 'Vermutlich fehlt der Label-Filter autopilot:nachschub am GitHub-Auslöser der Planer-Routine.',
      schwer: false,
    })
  }

  if (wipVoll(r)) hinweise.push({ titel: `WIP-Deckel erreicht: ${r.wip} von ${r.wipDeckel}`, schwer: true })

  const stau = bereit.filter(a => a.readySeit !== undefined && jetzt - a.readySeit > READY_STAU_MS)
  if (stau.length > 0) {
    hinweise.push({
      titel: `${stau.length} freigegebene Issues seit über 30 min nicht in Arbeit`,
      text: stau.map(a => `#${a.issue?.number} (${dauer(jetzt - (a.readySeit ?? jetzt))})`).join(', '),
      schwer: true,
    })
  }
  return hinweise
}

function ohneAnlass(ergebnis: string): string {
  return ergebnis.replace(/^\[[^\]]*\]\s*/, '')
}

function rollenZeile(rt: Routine, jetzt: number): string {
  const teile: string[] = []
  const l = rt.laeufe[0]
  if (rt.fehler) teile.push(`Fehler: ${kurz(rt.fehler, 60)}`)
  else if (!l) teile.push('noch kein Lauf')
  else if (l.isRunning) teile.push(`läuft seit ${hm(l.startedAt, jetzt)}`)
  else teile.push(`zuletzt ${hm(l.startedAt, jetzt)}, ${kurz(ohneAnlass(l.ergebnis), 60)}`)
  if (rt.naechster) teile.push(`nächster ${hm(rt.naechster, jetzt)}`)
  return teile.join(' · ')
}

function balken(wert: number, max: number): { voll: string; rest: string } {
  const breite = 12
  const n = max > 0 ? Math.min(breite, Math.round((wert / max) * breite)) : 0
  return { voll: '█'.repeat(n), rest: '░'.repeat(breite - n) }
}

function echte(r: RepoSicht): Fall[] {
  return r.faelle.filter(f => !f.mechanisch)
}

function bandText(r: RepoSicht, jetzt: number): string[] {
  const t: string[] = []
  const n = echte(r).length
  if (n > 0) t.push(`${n} ${n === 1 ? 'braucht' : 'brauchen'} dich`)
  for (const hw of auffaellig(r, jetzt)) t.push(hw.titel)
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
    const jetzt = await $.clock.now()
    const greifen = (await read($, stand)).repos
      .map(r => ({ repo: r.repo, texte: bandText(r, jetzt), dringend: echte(r).length > 0 }))
      .filter(g => g.texte.length > 0)
    if (greifen.length === 0) return next(e)
    const kennung = greifen.map(g => `${g.repo}:${g.texte.join(',')}`).join(';')
    if ((await read($, bandWeg)) === kennung) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const offen = await istOffen($)
    const text = greifen
      .map(g => `${g.repo.split('/').pop()}: ${g.texte.join(' · ')}`)
      .join(' | ')

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={greifen.some(g => g.dringend) ? 'warning' : 'error'}>⚠ Autopilot {text}</Text>
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

    const ueberschrift = (titel: string) => (
      <Text weight="semibold" size="caption" dimColor>
        {titel.toUpperCase()}
      </Text>
    )

    const kopf = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text dimColor>{!s.at ? 'Lade …' : s.isLoading ? 'lädt …' : ''}</Text>
        <Button key="neu" label="Aktualisieren" onPress={() => void aktualisiere($)} />
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {kopf}
        {s.fehler && <Text color="error">Fehler: {s.fehler}</Text>}
        {s.at > 0 && !s.fehler && s.repos.length === 0 && (
          <Text dimColor>Keine aktive Routine namens „Autopilot …: Planer|Worker|Reviewer|Chat“ gefunden.</Text>
        )}
        {s.repos.map(r => {
          const worker = rolle(r, 'Worker')
          const bereit = r.auftraege.filter(a => a.phase === 'freigegeben').length
          const faelle = echte(r)
          const mechanisch = r.faelle.filter(f => f.mechanisch)
          const hinweise = auffaellig(r, jetzt)
          const d = r.digest

          // Status-Chips als Text mit Trennpunkt; Farbe nur, wo es etwas heisst
          const chips: { text: string; color?: string }[] = []
          if (worker) {
            const aktiv = worker.laeufe[0]?.isRunning === true
            chips.push({ text: aktiv ? 'Worker arbeitet' : 'Worker wartet', color: aktiv ? 'success' : undefined })
          }
          chips.push(bereit > 0 ? { text: `${bereit} bereit`, color: 'suggestion' } : { text: 'Warteschlange leer' })
          if (nachschubVoll(r)) {
            chips.push({ text: `Nachschub ${r.nachschubHeute}/${r.nachschubDeckel} verbraucht`, color: 'warning' })
          }

          const selbst = mechanisch.length > 0 && (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Text dimColor>Repariert sich selbst:</Text>
              {mechanisch.map(f => (
                <Link href={f.pr?.url ?? f.url} label={`#${f.pr?.number ?? f.nummer}`} />
              ))}
              {worker?.naechster && <Text dimColor>(nächster Worker {hm(worker.naechster, jetzt)})</Text>}
            </Box>
          )

          const bars: { name: string; wert: number; max: number }[] = []
          if (r.wip !== undefined && r.wipDeckel !== undefined) bars.push({ name: 'WIP', wert: r.wip, max: r.wipDeckel })
          if (r.nachschubHeute !== undefined) {
            bars.push({ name: 'Nachschub heute', wert: r.nachschubHeute, max: r.nachschubDeckel })
          }

          return (
            <Box key={`repo-${r.repo}`} flexDirection="column" gap={1}>
              <Box flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between">
                  <Link href={`https://github.com/${r.repo}`}>
                    <Text weight="bold">{r.repo}</Text>
                  </Link>
                  <Text dimColor>
                    {[r.stufe, s.at ? uhrzeit(s.at, jetzt) : ''].filter(Boolean).join(' · ')}
                  </Text>
                </Box>
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {chips.map((c, i) => (
                    <Text color={c.color} dimColor={!c.color}>
                      {i > 0 ? '· ' : ''}
                      {c.text}
                    </Text>
                  ))}
                </Box>
              </Box>

              {faelle.length > 0 && (
                <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1} gap={1}>
                  <Box flexDirection="row" justifyContent="space-between">
                    <Text color="warning" weight="semibold">
                      Braucht dich · {faelle.length}
                    </Text>
                    {r.journalUrl && <Link href={r.journalUrl} label="Im Journal antworten" />}
                  </Box>
                  {faelle.map(f => (
                    <Box flexDirection="column">
                      <Box flexDirection="row" gap={1}>
                        <Link href={f.url}>
                          <Text weight="semibold">{kurz(`#${f.nummer} ${f.titel}`, 70)}</Text>
                        </Link>
                        {f.pr && <Link href={f.pr.url} label={`PR #${f.pr.number}`} />}
                      </Box>
                      <Text>{f.grund}</Text>
                    </Box>
                  ))}
                  {selbst}
                </Box>
              )}
              {faelle.length === 0 && selbst}

              {d && (
                <Box flexDirection="column">
                  {ueberschrift('Seit gestern 09:00')}
                  <Box flexDirection="row" gap={1}>
                    {[
                      [d.gemergt, 'gemergt'],
                      [d.features, 'Features'],
                      [d.tests, 'Tests, Code'],
                      [d.doku, 'Doku'],
                    ].map(([zahl, name]) => (
                      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} flexGrow={1}>
                        <Text weight="semibold" size="heading" tabular>
                          {String(zahl)}
                        </Text>
                        <Text dimColor size="caption">
                          {String(name)}
                        </Text>
                      </Box>
                    ))}
                  </Box>
                  {d.featureTitel.map(p => (
                    <Box flexDirection="row" gap={1}>
                      <Link href={p.url} label={`#${p.nummer}`} />
                      <Text>{kurz(p.titel, 64)}</Text>
                    </Box>
                  ))}
                  {d.gemergt > d.featureTitel.length && (
                    <Text dimColor>und {d.gemergt - d.featureTitel.length} weitere</Text>
                  )}
                  {d.autopilot > 0 && (
                    <Text dimColor>
                      Autopilot selbst: {d.autopilot} {d.autopilot === 1 ? 'Änderung' : 'Änderungen'}
                    </Text>
                  )}
                  {d.prod.length === 0 && <Text dimColor>Prod: keine Vorfälle</Text>}
                  {d.prod.map(p => (
                    <Box flexDirection="row" gap={1}>
                      <Text color={p.offen ? 'error' : undefined} dimColor={!p.offen}>
                        Prod:
                      </Text>
                      <Link href={p.url} label={`#${p.nummer}`} />
                      <Text color={p.offen ? 'error' : undefined} dimColor={!p.offen}>
                        {kurz(p.titel, 56)}, {p.offen ? 'offen' : 'erledigt'}
                      </Text>
                    </Box>
                  ))}
                </Box>
              )}

              {hinweise.length > 0 && (
                <Box flexDirection="column">
                  {ueberschrift('Auffällig')}
                  {hinweise.map(hw => (
                    <Box flexDirection="column" borderStyle="round" borderColor={hw.schwer ? 'warning' : 'subtle'} paddingX={1}>
                      <Text weight="semibold" color={hw.schwer ? 'warning' : undefined}>
                        {hw.titel}
                      </Text>
                      {hw.text && <Text>{hw.text}</Text>}
                    </Box>
                  ))}
                </Box>
              )}

              {bars.length > 0 && (
                <Box flexDirection="column">
                  {ueberschrift('Deckel und Budget')}
                  <Box flexDirection="row" columnGap={3} flexWrap="wrap">
                    {bars.map(b => {
                      const { voll, rest } = balken(b.wert, b.max)
                      const ganz = b.wert >= b.max
                      return (
                        <Box flexDirection="column" minWidth={24}>
                          <Box flexDirection="row" justifyContent="space-between" gap={1}>
                            <Text>{b.name}</Text>
                            <Text color={ganz ? 'warning' : undefined} dimColor={!ganz}>
                              {b.wert} von {b.max}
                            </Text>
                          </Box>
                          <Text>
                            <Text color={ganz ? 'warning' : 'suggestion'}>{voll}</Text>
                            <Text dimColor>{rest}</Text>
                          </Text>
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              )}

              {r.routinen.length > 0 && (
                <Box flexDirection="column">
                  {ueberschrift('Rollen')}
                  {r.routinen.map(rt => (
                    <Box flexDirection="row" gap={1}>
                      <Box width={9} flexShrink={0}>
                        {rt.url ? (
                          <Link href={rt.url}>
                            <Text weight="semibold">{rt.rolle}</Text>
                          </Link>
                        ) : (
                          <Text weight="semibold">{rt.rolle}</Text>
                        )}
                      </Box>
                      <Text color={rt.fehler ? 'error' : undefined} dimColor={!rt.fehler}>
                        {rollenZeile(rt, jetzt)}
                      </Text>
                    </Box>
                  ))}
                  <Link href={ALLE_LAEUFE} label="Alle Läufe" />
                </Box>
              )}

              {r.fehler.map(f => (
                <Text color="error">Fehler {f}</Text>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
