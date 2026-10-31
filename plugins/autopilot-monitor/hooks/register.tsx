import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Auftrag, Digest, Fall, Fenster, Phase, RepoSicht, Routine, Stand } from '../types'

const PANE = 'autopilot-monitor'
const TITEL = 'Autopilot'
const TAKT_MS = 2 * 60 * 1000
const BAND_TAKT_MS = 10 * 60 * 1000
const READY_STAU_MS = 30 * 60 * 1000
const GH = ['gh', '/usr/local/bin/gh', '/opt/homebrew/bin/gh']
const SUCHE_ALLE_MS = 30 * 60 * 1000
const REVIEWER_WORKFLOW = 'autopilot-review.yml'
const NACHSCHUB_VORGABE = 3
const IDEEN_VORGABE = 30
const ALLE_LAEUFE = 'https://claude.ai/code/routines'

// Tag wechseln, sobald sich die Felder von Stand aendern
const stand = atom(
  { plugin: 'autopilot-monitor', key: 'stand' } as const,
  { at: 0, repos: [], isLoading: true } as Stand,
  { shape: 'stand-3' },
)
// Kennung der Hinweise, die die Person im Band weggeklickt hat
const bandWeg = atom({ plugin: 'autopilot-monitor', key: 'bandWeg' } as const, null as string | null)
// Ratenfenster aus der eigenen Session, dasselbe Konto wie die Routinen
const fenster = atom({ plugin: 'autopilot-monitor', key: 'fenster' } as const, [] as Fenster[])
// Repo, dessen Zeile im Panel aufgeklappt ist
const aufgeklappt = atom({ plugin: 'autopilot-monitor', key: 'aufgeklappt' } as const, null as string | null)

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

// Eine Routine gehoert dazu, sobald sie aktiv ist und "Autopilot <name>: Planer",
// "...: Worker", "...: Reviewer" oder "...: Chat" heisst. Nennt ihr Prompt eine Zeile
// "Zentrale: <owner>/<name>", gehoert sie zur Zentrale, deren repos: die Repos sind;
// sonst ist das Repo ihre erste Quelle (Ein-Repo-Modus).
type RoutineEintrag = { rolle: string; triggerId: string; naechster?: number }
export type Gruppe = { quelle: string; zentrale: boolean; routinen: RoutineEintrag[] }
type RepoEintrag = {
  repo: string
  routinen: RoutineEintrag[]
  zentrale?: { repo: string; konfig: Konfig }
  fehler?: string
}

type Inhalt = string | { type: string; text?: string }[]

export type TriggerRoh = {
  id: string
  name?: string
  enabled?: boolean
  next_run_at?: string | null
  job_config?: {
    ccr?: {
      session_context?: { sources?: { git_repository?: { url?: string } }[] }
      events?: { data?: { message?: { content?: Inhalt } } }[]
    }
  }
}

// Reihenfolge im Panel
const ROLLEN = ['Planer', 'Scout', 'Worker', 'Reviewer', 'Chat']
let gefunden: { at: number; gruppen: Gruppe[] } | undefined

function veraltet(gruppen: Gruppe[], jetzt: number): boolean {
  // Ein vergangener naechster Lauf heisst: die Routine lief, die Zeit ist neu zu lesen
  return gruppen.some(g => g.routinen.some(x => x.naechster !== undefined && x.naechster <= jetzt))
}

export function zentraleAusPrompt(inhalt?: Inhalt): string | undefined {
  const text = typeof inhalt === 'string' ? inhalt : (inhalt ?? []).map(b => b.text ?? '').join('\n')
  // Die Routine-Prompts nennen die Zentrale mitten im ersten Satz, nicht am Zeilenanfang
  return text.match(/(?:^|[\s.(*>-])Zentrale:\**\s*`?([\w-]+\/[\w.-]*[\w-])/m)?.[1]
}

export function gruppiere(trigger: TriggerRoh[]): Gruppe[] {
  const je = new Map<string, Gruppe>()
  for (const t of trigger) {
    const rolle = t.name?.match(/^Autopilot .+: (\w+)$/)?.[1]
    if (!t.enabled || !rolle || !ROLLEN.includes(rolle)) continue
    const ccr = t.job_config?.ccr
    const zentrale = zentraleAusPrompt(ccr?.events?.[0]?.data?.message?.content)
    const url = ccr?.session_context?.sources?.[0]?.git_repository?.url ?? ''
    const quelle = zentrale ?? url.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1]
    if (!quelle) continue
    const schluessel = `${zentrale ? 'z' : 'r'}:${quelle}`
    const gruppe = je.get(schluessel) ?? { quelle, zentrale: !!zentrale, routinen: [] }
    const naechster = t.next_run_at ? Date.parse(t.next_run_at) : NaN
    gruppe.routinen.push({ rolle, triggerId: t.id, naechster: Number.isNaN(naechster) ? undefined : naechster })
    je.set(schluessel, gruppe)
  }
  for (const g of je.values()) g.routinen.sort((a, b) => ROLLEN.indexOf(a.rolle) - ROLLEN.indexOf(b.rolle))
  return [...je.values()].sort((a, b) => a.quelle.localeCompare(b.quelle))
}

// Zentralen auf ihre Repos verteilen, in der Reihenfolge von repos:. Fehlt die
// Datei der Zentrale (Wert ist dann der Fehlertext), steht die Zentrale selbst da.
export function verteile(gruppen: Gruppe[], zentralen: Map<string, Konfig | string>): RepoEintrag[] {
  const je = new Map<string, RepoEintrag>()
  const dazu = (e: RepoEintrag) => {
    const alt = je.get(e.repo)
    if (!alt) return void je.set(e.repo, e)
    for (const r of e.routinen) if (!alt.routinen.some(x => x.triggerId === r.triggerId)) alt.routinen.push(r)
  }
  for (const g of gruppen) {
    if (!g.zentrale) {
      dazu({ repo: g.quelle, routinen: [...g.routinen] })
      continue
    }
    const konfig = zentralen.get(g.quelle)
    if (typeof konfig !== 'object' || !konfig.repos?.length) {
      const fehler = typeof konfig === 'string' ? konfig : 'keine repos: in der Datei'
      dazu({ repo: g.quelle, routinen: [...g.routinen], fehler: `Zentrale ${g.quelle}: ${fehler}` })
      continue
    }
    for (const repo of konfig.repos) {
      dazu({ repo, routinen: [...g.routinen], zentrale: { repo: g.quelle, konfig } })
    }
  }
  return [...je.values()]
}

async function findeGruppen($: EngineInterface, jetzt: number): Promise<Gruppe[]> {
  if (gefunden && jetzt - gefunden.at < SUCHE_ALLE_MS && !veraltet(gefunden.gruppen, jetzt)) {
    return gefunden.gruppen
  }
  const alle: TriggerRoh[] = []
  let cursor = ''
  for (let seite = 0; seite < 10; seite++) {
    const antwort = await api($, `/v1/code/triggers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
    alle.push(...((antwort.data ?? []) as TriggerRoh[]))
    cursor = antwort.next_cursor ?? ''
    if (!antwort.has_more || !cursor) break
  }
  const gruppen = gruppiere(alle)
  gefunden = { at: jetzt, gruppen }
  return gruppen
}

// ---------- Konfiguration aus .claude/autopilot.md ----------

export type Konfig = { stufe?: string; journal?: number; repos?: string[]; deckel: Record<string, number> }

export function leseKonfig(md: string): Konfig {
  const kopf = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const konfig: Konfig = { deckel: {} }
  let block = ''
  for (const zeile of kopf.split('\n')) {
    if (/^\s*#/.test(zeile) || !zeile.trim()) continue
    const oben = zeile.match(/^([a-z0-9_]+):\s*(.*)$/)
    if (oben) {
      block = oben[1] ?? ''
      const wert = (oben[2] ?? '').trim()
      if (block === 'stufe') konfig.stufe = wert
      if (block === 'journal_issue' && Number(wert) > 0) konfig.journal = Number(wert)
      continue
    }
    const eintrag = zeile.match(/^\s+-\s+["'`]?([\w-]+\/[\w.-]*[\w-])/)
    if (eintrag?.[1] && block === 'repos') konfig.repos = [...(konfig.repos ?? []), eintrag[1]]
    const innen = zeile.match(/^\s+([a-z0-9_]+):\s*(\d+)\s*$/)
    if (innen?.[1] && block === 'deckel') konfig.deckel[innen[1]] = Number(innen[2])
  }
  return konfig
}

async function leseKonfigVon($: EngineInterface, repo: string): Promise<Konfig> {
  const md = await gh($, ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/.claude/autopilot.md`])
  return leseKonfig(md)
}

// Nur aus der Zentrale, wie in autopilot-plan und autopilot-work
const GLOBAL = [
  'wip',
  'neue_auftraege_pro_planerlauf',
  'offene_vorschlaege',
  'pruefungen_pro_lauf',
  'nachschub_pro_tag',
  'ideen_pro_lauf',
  'offene_ideen',
  'scout_dateien_pro_lauf',
  'budget_5h',
  'budget_woche_vorlauf',
]

// Stufe und repo-eigene Deckel aus der Repo-Datei, ein fehlender faellt auf die
// Zentrale zurueck; Journal und globale Deckel nur aus der Zentrale
export function fuehreZusammen(repo: Konfig | undefined, zentrale: Konfig): Konfig {
  const eigene = Object.entries(repo?.deckel ?? {}).filter(([k]) => !GLOBAL.includes(k))
  return {
    stufe: repo?.stufe,
    journal: zentrale.journal,
    deckel: { ...zentrale.deckel, ...Object.fromEntries(eigene) },
  }
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
const FRAGE_MARKE = '<!-- autopilot:entscheidung -->'

// Die Frage des Planers an einem Issue mit autopilot:entscheidung, ohne Marker und "**Frage:**"
export function frageKurz(body: string): string {
  const zeile = body.split('\n').map(z => z.trim()).find(z => /^\**Frage:?\**/.test(z))
  return zeile ? kurz(zeile.replace(/^\**Frage:?\**:?\s*/, ''), 160) : grundKurz(body)
}

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
  body?: string
  labels?: { nodes: { name: string }[] }
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
    if (issue?.labels?.nodes.some(l => l.name === 'autopilot:entscheidung')) {
      // Die Frage steht im juengsten Kommentar mit Marker, bei neuen Issues im Text
      const fragen = [{ body: issue.body ?? '', createdAt: '' }, ...(issue.comments?.nodes ?? [])]
        .filter(c => c.body.includes(FRAGE_MARKE))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const frage = fragen.pop()?.body
      faelle.push({
        nummer: issue.number,
        titel: issue.title,
        url: issue.url,
        grund: frage ? frageKurz(frage) : 'Keine Frage gefunden.',
        mechanisch: false,
        entscheidung: true,
      })
      continue
    }
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
      ...(pr && /würde mergen/i.test(juengster) ? { merge: true } : {}),
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

const UEBERSICHT = `query($nh:String!, $pr:String!, $prod:String!, $ideen:String!, $o:String!, $n:String!, $j:Int!, $mitJournal:Boolean!){
 nh: search(query:$nh, type:ISSUE, first:50){ nodes{ __typename
  ... on Issue{ number title url body labels(first:20){nodes{name}} comments(last:20){nodes{body createdAt}} }
  ... on PullRequest{ number title url headRefName comments(last:20){nodes{body createdAt}} } } }
 merged: search(query:$pr, type:ISSUE, first:100){ nodes{ ... on PullRequest{ number title url headRefName mergedAt } } }
 prod: search(query:$prod, type:ISSUE, first:20){ nodes{ ... on Issue{ number title url state createdAt closedAt } } }
 ideen: search(query:$ideen, type:ISSUE, first:1){ issueCount }
 repository(owner:$o, name:$n) @include(if:$mitJournal){ issue(number:$j){ url comments(last:100){ nodes{ body createdAt } } } } }`

type Uebersicht = {
  faelle: Fall[]
  digest: Digest
  journalUrl?: string
  nachschub?: { heute: number; vollUm?: number }
  ideen: number
}

async function leseUebersicht(
  $: EngineInterface,
  repo: string,
  // Repo des Journals: die Zentrale, im Ein-Repo-Modus das Repo selbst
  journalRepo: string,
  journal: number | undefined,
  nachschubDeckel: number,
  jetzt: number,
): Promise<Uebersicht> {
  const seit = digestBeginn(jetzt)
  const ab = new Date(seit).toISOString().replace(/\.\d+Z$/, 'Z')
  const [owner, name] = journalRepo.split('/')
  const roh = await gh($, [
    'api', 'graphql',
    '-f', `query=${UEBERSICHT}`,
    '-f', `nh=repo:${repo} is:open label:needs-human,autopilot:entscheidung`,
    '-f', `pr=repo:${repo} is:pr is:merged merged:>=${ab}`,
    '-f', `prod=repo:${repo} is:issue label:prod-incident updated:>=${ab}`,
    '-f', `ideen=repo:${repo} is:issue is:open label:autopilot:idee`,
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
    ideen: d.ideen?.issueCount ?? 0,
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
  routineVon: (r: RoutineEintrag) => Promise<Routine>,
): Promise<RepoSicht> {
  const z = eintrag.zentrale
  const sicht: RepoSicht = {
    repo: eintrag.repo,
    zentrale: z?.repo,
    auftraege: [],
    routinen: [],
    faelle: [],
    nachschubDeckel: NACHSCHUB_VORGABE,
    fehler: eintrag.fehler ? [eintrag.fehler] : [],
  }
  const fehler = (was: string) => (err: unknown) => {
    sicht.fehler.push(`${was}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const konfig = leseKonfigVon($, eintrag.repo)
    .catch(err => {
      fehler('autopilot.md')(err)
      return undefined
    })
    .then(k => (z ? fuehreZusammen(k, z.konfig) : k))
  const auftraege = leseAuftraege($, eintrag.repo).catch(err => {
    fehler('Auftraege')(err)
    return undefined
  })
  const uebersicht = konfig.then(k =>
    leseUebersicht(
      $,
      eintrag.repo,
      z?.repo ?? eintrag.repo,
      k?.journal,
      k?.deckel.nachschub_pro_tag ?? NACHSCHUB_VORGABE,
      jetzt,
    ).catch(err => {
      fehler('Uebersicht')(err)
      return undefined
    }),
  )
  const hatReviewerRoutine = eintrag.routinen.some(r => r.rolle === 'Reviewer')
  const routinen = Promise.all([
    ...eintrag.routinen.map(routineVon),
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
    sicht.ideen = u.ideen
  }
  sicht.ideenDeckel = k?.deckel.offene_ideen ?? IDEEN_VORGABE
  sicht.nachschubDeckel = k?.deckel.nachschub_pro_tag ?? NACHSCHUB_VORGABE
  if (z) {
    // wip zaehlt ueber alle Repos der Zentrale (summiereWip), wip_begleitet je Repo
    sicht.wipAlleDeckel = k?.deckel.wip
    sicht.wipDeckel = k?.stufe === 'begleitet' ? k.deckel.wip_begleitet : undefined
  } else {
    sicht.wipDeckel =
      k?.stufe === 'begleitet' ? (k.deckel.wip_begleitet ?? k.deckel.wip) : k?.deckel.wip
  }
  sicht.budget5h = k?.deckel.budget_5h
  sicht.budgetVorlauf = k?.deckel.budget_woche_vorlauf
  return sicht
}

// WIP-Summe je Zentrale in jedes ihrer Repos; ein unlesbares Repo zaehlt nicht mit
export function summiereWip(sichten: RepoSicht[]): RepoSicht[] {
  const summe = new Map<string, number>()
  for (const s of sichten) {
    if (s.zentrale) summe.set(s.zentrale, (summe.get(s.zentrale) ?? 0) + (s.wip ?? 0))
  }
  // Offene Ideen zaehlen wie der Deckel offene_ideen ueber alle Repos der Zentrale
  const ideen = new Map<string, number>()
  for (const s of sichten) {
    if (s.zentrale) ideen.set(s.zentrale, (ideen.get(s.zentrale) ?? 0) + (s.ideen ?? 0))
  }
  return sichten.map(s =>
    s.zentrale ? { ...s, wipAlle: summe.get(s.zentrale), ideenAlle: ideen.get(s.zentrale) } : s,
  )
}

// ---------- Auswertung fuer Panel und Band ----------

function wipVoll(r: RepoSicht): boolean {
  return r.wip !== undefined && r.wipDeckel !== undefined && r.wip >= r.wipDeckel
}

function wipAlleVoll(r: RepoSicht): boolean {
  return r.wipAlle !== undefined && r.wipAlleDeckel !== undefined && r.wipAlle >= r.wipAlleDeckel
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

// global: gilt fuer alle Repos der Zentrale, im Panel nur einmal und ohne Repo davor
export type Hinweis = { titel: string; text?: string; schwer: boolean; global?: boolean }

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
      global: !!r.zentrale,
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
      global: !!r.zentrale,
    })
  }

  if (wipAlleVoll(r)) {
    hinweise.push({ titel: `WIP-Deckel erreicht: ${r.wipAlle} von ${r.wipAlleDeckel} über alle Repos`, schwer: true, global: true })
  }
  if (wipVoll(r)) {
    const art = r.zentrale ? 'WIP-Deckel begleitet' : 'WIP-Deckel'
    hinweise.push({ titel: `${art} erreicht: ${r.wip} von ${r.wipDeckel}`, schwer: true })
  }

  const stau = bereit.filter(a => a.readySeit !== undefined && jetzt - a.readySeit > READY_STAU_MS)
  if (stau.length > 0) {
    hinweise.push({
      titel: `${stau.length} freigegebene Issues seit über 30 min nicht in Arbeit`,
      text: stau.map(a => `#${a.issue?.number} (${dauer(jetzt - (a.readySeit ?? jetzt))})`).join(', '),
      schwer: true,
    })
  }
  for (const p of r.digest?.prod ?? []) {
    if (p.offen) hinweise.push({ titel: `Prod-Vorfall offen: #${p.nummer} ${kurz(p.titel, 60)}`, schwer: true })
  }
  return hinweise
}

function ohneAnlass(ergebnis: string): string {
  return ergebnis.replace(/^\[[^\]]*\]\s*/, '')
}

export function rollenZeile(rt: Routine, jetzt: number): string {
  const teile: string[] = []
  const l = rt.laeufe[0]
  if (rt.fehler) teile.push(`Fehler: ${kurz(rt.fehler, 60)}`)
  else if (!l) teile.push('noch kein Lauf')
  else if (l.isRunning) teile.push(`läuft seit ${hm(l.startedAt, jetzt)}`)
  else teile.push(`zuletzt ${hm(l.startedAt, jetzt)}`)
  if (rt.naechster) teile.push(`nächster ${hm(rt.naechster, jetzt)}`)
  return teile.join(' · ')
}

// Fehler der Routine selbst oder des letzten Laufs
export function rolleGestoert(rt: Routine): boolean {
  const l = rt.laeufe[0]
  return !!rt.fehler || (!!l && !l.isRunning && /^(?:Fehler \(|Umgebung: |Log nicht lesbar)/.test(ohneAnlass(l.ergebnis)))
}

function balken(wert: number, max: number): { voll: string; rest: string } {
  const breite = 12
  const n = max > 0 ? Math.min(breite, Math.round((wert / max) * breite)) : 0
  return { voll: '█'.repeat(n), rest: '░'.repeat(breite - n) }
}

const WOCHE_MS = 7 * 24 * H

// Balken fuer 5h-Fenster und Woche mit denselben Schwellen wie die Bremse des Workers
export function budgetBalken(
  r: RepoSicht,
  f: Fenster[],
  jetzt: number,
): { name: string; wert: number; max: number; anzeige: string; warn: boolean }[] {
  const aus: { name: string; wert: number; max: number; anzeige: string; warn: boolean }[] = []
  const h = f.find(x => x.kind === 'five_hour')
  if (h) {
    const grenze = r.budget5h ?? 70
    aus.push({ name: '5h-Fenster', wert: h.percentUsed, max: 100, anzeige: `${Math.floor(h.percentUsed)} %`, warn: h.percentUsed >= grenze })
  }
  const w = f.find(x => x.kind === 'seven_day')
  if (w) {
    const reset = w.resetsAt ? Date.parse(w.resetsAt) : NaN
    const soll = Number.isNaN(reset) ? undefined : Math.max(0, Math.min(100, 100 - ((reset - jetzt) / WOCHE_MS) * 100))
    const warn = soll !== undefined && w.percentUsed > soll + (r.budgetVorlauf ?? 10)
    const anzeige = `${Math.floor(w.percentUsed)} %` + (soll !== undefined ? ` (Soll ${Math.floor(soll)} %)` : '')
    aus.push({ name: 'Woche', wert: w.percentUsed, max: 100, anzeige, warn })
  }
  return aus
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

// ---------- Panel: ueber alle Repos ----------

// Repos einer Zentrale teilen Routinen, Journal und globale Deckel; ohne Zentrale
// ist jedes Repo ein Verbund fuer sich
export type Verbund = { quelle: string; zentrale: boolean; repos: RepoSicht[] }

export function verbuende(repos: RepoSicht[]): Verbund[] {
  const je = new Map<string, Verbund>()
  for (const r of repos) {
    const quelle = r.zentrale ?? r.repo
    const v = je.get(quelle) ?? { quelle, zentrale: !!r.zentrale, repos: [] }
    v.repos.push(r)
    je.set(quelle, v)
  }
  return [...je.values()]
}

// Je Rolle eine Zeile; die Reviewer-Action liegt je Repo, es zaehlt der juengste Lauf
export function rollenVon(v: Verbund): Routine[] {
  const je = new Map<string, Routine>()
  for (const r of v.repos) {
    for (const rt of r.routinen) {
      const alt = je.get(rt.rolle)
      if (!alt || (rt.laeufe[0]?.startedAt ?? 0) > (alt.laeufe[0]?.startedAt ?? 0)) je.set(rt.rolle, rt)
    }
  }
  return [...je.values()].sort((a, b) => ROLLEN.indexOf(a.rolle) - ROLLEN.indexOf(b.rolle))
}

export type Art = 'Merge' | 'Entscheidung' | 'needs-human'

export function artVon(f: Fall): Art {
  return f.entscheidung ? 'Entscheidung' : f.merge ? 'Merge' : 'needs-human'
}

export function kurzname(repo: string): string {
  return repo.split('/').pop() ?? repo
}

export type Balken = { name: string; wert: number; max: number; anzeige?: string; warn?: boolean }

// WIP und Ideen gegen die globalen Deckel, Nachschub aus dem Journal, Budget des Kontos
export function verbundBalken(v: Verbund, f: Fenster[], jetzt: number): Balken[] {
  const r = v.repos[0]
  if (!r) return []
  const bars: Balken[] = []
  const wip = v.zentrale ? r.wipAlle : r.wip
  const wipDeckel = v.zentrale ? r.wipAlleDeckel : r.wipDeckel
  if (wip !== undefined && wipDeckel !== undefined) bars.push({ name: 'WIP', wert: wip, max: wipDeckel })
  const ideen = v.zentrale ? r.ideenAlle : r.ideen
  if (ideen !== undefined && r.ideenDeckel !== undefined) bars.push({ name: 'Ideen offen', wert: ideen, max: r.ideenDeckel })
  bars.push(...budgetBalken(r, f, jetzt))
  if (r.nachschubHeute !== undefined) {
    bars.push({ name: 'Nachschub heute', wert: r.nachschubHeute, max: r.nachschubDeckel })
  }
  return bars
}

// Eine Zeile, wenn ein Repo aufgeklappt ist
export function verbundKurz(bars: Balken[]): string {
  const teil = (name: string, kurzName = name) => {
    const b = bars.find(x => x.name === name)
    return b ? `${kurzName} ${b.anzeige ?? `${b.wert} von ${b.max}`}` : undefined
  }
  return [teil('WIP'), teil('Woche'), teil('Ideen offen', 'Ideen')].filter(Boolean).join(' · ')
}

export function zaehle(r: RepoSicht): { inArbeit: number; bereit: number; vorschlaege: number } {
  const n = (...phasen: Phase[]) => r.auftraege.filter(a => phasen.includes(a.phase)).length
  return {
    inArbeit: n('in Arbeit', 'im Review', 'Nacharbeit', 'wird gemergt'),
    bereit: n('freigegeben'),
    vorschlaege: n('Vorschlag'),
  }
}

// Auffaelliges aller Repos als Saetze; Globales einmal, sonst mit Repo davor
export function auffaelligAlle(repos: RepoSicht[], jetzt: number): { text: string; schwer: boolean }[] {
  const aus = new Map<string, boolean>()
  for (const r of repos) {
    for (const hw of auffaellig(r, jetzt)) {
      const vorne = repos.length > 1 && !hw.global ? `${kurzname(r.repo)}: ` : ''
      const satz = `${vorne}${hw.titel}${hw.text ? `. ${hw.text}` : '.'}`
      aus.set(satz, (aus.get(satz) ?? false) || hw.schwer)
    }
  }
  return [...aus].map(([text, schwer]) => ({ text, schwer }))
}

function auftragTitel(a: Auftrag): string {
  const n = a.issue?.number ?? a.pr?.number
  return `#${n} ${a.issue?.title || a.pr?.title || ''}`.trim()
}

let laeuft = false

function merke(l: { kind: string; percentUsed: number; resetsAt?: string }): Fenster {
  return { kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }
}

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
    const gruppen = await findeGruppen($, jetzt)
    // Die Datei der Zentrale in jedem Durchlauf neu, Deckel und repos: koennen sich aendern
    const zentralen = new Map<string, Konfig | string>()
    await Promise.all(
      gruppen
        .filter(g => g.zentrale)
        .map(g =>
          leseKonfigVon($, g.quelle).then(
            k => void zentralen.set(g.quelle, k),
            err => void zentralen.set(g.quelle, `autopilot.md: ${err instanceof Error ? err.message : String(err)}`),
          ),
        ),
    )
    // Die Routinen einer Zentrale stehen in jedem ihrer Repos, gelesen wird jede einmal
    const memo = new Map<string, Promise<Routine>>()
    const routineVon = (r: RoutineEintrag) => {
      const p = memo.get(r.triggerId) ?? leseRoutine($, r, jetzt, cache, neu)
      memo.set(r.triggerId, p)
      return p
    }
    const eintraege = verteile(gruppen, zentralen)
    const repos = summiereWip(await Promise.all(eintraege.map(r => leseRepo($, r, jetzt, routineVon))))
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
    void $.session.usage().then(u => update($, fenster, () => u.rateLimits.map(merke)))
    // Offenes Panel im Takt, sonst seltener fuer das Band
    $.clock.every(TAKT_MS, () => void (async () => {
      const alt = (await read($, stand)).at
      if ((await istOffen($)) || (await $.clock.now()) - alt >= BAND_TAKT_MS) await aktualisiere($)
    })())
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, fenster, () => e.rateLimits.map(merke))
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
    const f = await read($, fenster)
    const offen = await read($, aufgeklappt)
    const jetzt = await $.clock.now()
    const vs = verbuende(s.repos)
    // Ein Repo, das es nicht mehr gibt, klappt nichts zu
    const einRepoOffen = s.repos.some(r => r.repo === offen)

    const ueberschrift = (titel: string) => (
      <Text weight="semibold" size="caption" dimColor>
        {titel.toUpperCase()}
      </Text>
    )

    const quellen = vs.map(v => {
      const nr = v.repos.find(r => r.journalUrl)?.journalUrl?.match(/\/issues\/(\d+)/)?.[1]
      return `${v.zentrale ? 'Zentrale ' : ''}${kurzname(v.quelle)}${nr ? ` · Journal #${nr}` : ''}`
    })
    const unterzeile = [...quellen, s.at ? uhrzeit(s.at, jetzt) : '', !s.at ? 'Lade …' : s.isLoading ? 'lädt …' : '']
      .filter(Boolean)
      .join(' · ')
    const kopf = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="column">
          <Text weight="bold">Autopilot</Text>
          <Text dimColor>{unterzeile}</Text>
        </Box>
        <Button key="neu" label="Aktualisieren" onPress={() => void aktualisiere($)} />
      </Box>
    )

    const balkenGitter = (bars: Balken[]) => (
      <Box flexDirection="row" columnGap={3} flexWrap="wrap">
        {bars.map(b => {
          const { voll, rest } = balken(b.wert, b.max)
          const ganz = b.warn ?? b.wert >= b.max
          return (
            <Box key={`bar-${b.name}`} flexDirection="column" minWidth={24}>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text color={ganz ? 'warning' : undefined}>{b.name}</Text>
                <Text color={ganz ? 'warning' : undefined} dimColor={!ganz}>
                  {b.anzeige ?? `${b.wert} von ${b.max}`}
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
    )

    // 1. Braucht dich ueber alle Repos
    const faelle = s.repos.flatMap(r => echte(r).map(fall => ({ repo: r.repo, fall })))
    const journalUrl = s.repos.find(r => r.journalUrl)?.journalUrl
    const brauchtDich = einRepoOffen ? (
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={faelle.length > 0 ? 'warning' : undefined} dimColor={faelle.length === 0} weight="semibold">
          Braucht dich · {faelle.length}
        </Text>
        <Text dimColor>eingeklappt, weil ein Repo offen ist</Text>
      </Box>
    ) : (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={faelle.length > 0 ? 'warning' : undefined} weight="semibold" size="caption" dimColor={faelle.length === 0}>
            BRAUCHT DICH · {faelle.length}
          </Text>
          {faelle.length > 0 && journalUrl && <Link href={journalUrl} label="Im Journal antworten" />}
        </Box>
        {faelle.length === 0 && <Text dimColor>nichts</Text>}
        {faelle.map(({ repo, fall }) => {
          const art = artVon(fall)
          const nummer = art === 'Merge' ? (fall.pr?.number ?? fall.nummer) : fall.nummer
          const url = art === 'Merge' ? (fall.pr?.url ?? fall.url) : fall.url
          const satz = art === 'Merge' ? `${fall.titel}. Reviewer: ${fall.grund}` : fall.grund
          return (
            <Box key={`fall-${repo}-${fall.nummer}`} flexDirection="row" gap={1}>
              <Box width={13} flexShrink={0}>
                <Text color={art === 'Entscheidung' ? 'merged' : 'warning'} weight="semibold">
                  {art}
                </Text>
              </Box>
              <Box flexDirection="column" flexShrink={1}>
                <Link href={url}>
                  <Text weight="semibold">{`${kurzname(repo)}#${nummer}`}</Text>
                </Link>
                <Text dimColor>{kurz(satz, 140)}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    // 2. Alle Repos: globale Deckel und Rollen je Verbund
    const verbundBlock = (v: Verbund) => {
      const bars = verbundBalken(v, f, jetzt)
      const rollen = rollenVon(v)
      const titel = v.zentrale ? 'Alle Repos' : 'Deckel und Rollen'
      const name = vs.length > 1 ? `${titel} · ${kurzname(v.quelle)}` : titel
      if (einRepoOffen) {
        const gestoert = rollen.filter(rolleGestoert).length
        const status =
          gestoert > 0
            ? `● ${gestoert} ${gestoert === 1 ? 'Rolle' : 'Rollen'} mit Fehler`
            : `● ${rollen.length} ${rollen.length === 1 ? 'Rolle' : 'Rollen'} ok`
        return (
          <Box key={`verbund-${v.quelle}`} flexDirection="row" justifyContent="space-between" gap={1}>
            <Text dimColor>{verbundKurz(bars) || name}</Text>
            {rollen.length > 0 && <Text color={gestoert > 0 ? 'error' : 'success'}>{status}</Text>}
          </Box>
        )
      }
      return (
        <Box key={`verbund-${v.quelle}`} flexDirection="column">
          {ueberschrift(name)}
          {bars.length > 0 && balkenGitter(bars)}
          {rollen.map(rt => {
            const gestoert = rolleGestoert(rt)
            const l = rt.laeufe[0]
            return (
              <Box key={`rolle-${v.quelle}-${rt.rolle}`} flexDirection="row" justifyContent="space-between" gap={1}>
                <Box flexDirection="row" gap={1}>
                  <Text color={gestoert ? 'error' : l ? 'success' : undefined} dimColor={!gestoert && !l}>
                    ●
                  </Text>
                  {rt.url ? <Link href={rt.url} label={rt.rolle} /> : <Text>{rt.rolle}</Text>}
                </Box>
                <Text color={gestoert ? 'error' : undefined} dimColor={!gestoert}>
                  {rollenZeile(rt, jetzt)}
                </Text>
              </Box>
            )
          })}
          {rollen.length > 0 && <Link href={ALLE_LAEUFE} label="Alle Läufe" />}
        </Box>
      )
    }

    // 3. Repos, je eine Zeile, eine davon aufgeklappt
    const repoZeile = (r: RepoSicht) => {
      const auf = r.repo === offen
      const z = zaehle(r)
      const warten = echte(r).length
      const gemergt = r.digest ? `${r.digest.gemergt} gemergt` : '? gemergt'
      const zeile2 = auf
        ? [
            r.stufe,
            r.wip !== undefined
              ? r.wipDeckel !== undefined
                ? `WIP ${r.wip} von ${r.wipDeckel}${r.zentrale ? ' (begleitet)' : ''}`
                : `WIP ${r.wip}`
              : '',
            r.stufe === 'begleitet' ? 'Reviewer mergt nicht' : '',
            r.stufe === 'trockenlauf' ? 'nur Vorschläge' : '',
          ]
        : r.stufe === 'trockenlauf'
          ? [r.stufe, 'nur Vorschläge']
          : [r.stufe, `${z.inArbeit} in Arbeit`, `${z.bereit} bereit`, `${z.vorschlaege} Vorschläge`]
      const kopfZeile = (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexDirection="row" gap={1}>
              <Button
                key={`repo-${r.repo}`}
                plain
                onPress={() => update($, aufgeklappt, alt => (alt === r.repo ? null : r.repo))}
              >
                {auf ? '⌄ ' : '› '}
                <Text weight="bold">{kurzname(r.repo)}</Text>
              </Button>
              {warten > 0 && (
                <Text color="warning" weight="semibold">
                  {warten} wartet
                </Text>
              )}
              {r.fehler.length > 0 && <Text color="error">Fehler</Text>}
            </Box>
            <Text dimColor>{gemergt}</Text>
          </Box>
          <Box paddingLeft={2}>
            <Text dimColor>{zeile2.filter(Boolean).join(' · ')}</Text>
          </Box>
        </Box>
      )
      if (!auf) {
        return (
          <Box key={`zeile-${r.repo}`} flexDirection="column" borderStyle="round" borderColor={warten > 0 ? 'warning' : 'subtle'} paddingX={1}>
            {kopfZeile}
          </Box>
        )
      }

      const inArbeit = r.auftraege.filter(a => ['in Arbeit', 'im Review', 'Nacharbeit', 'wird gemergt'].includes(a.phase))
      const bereit = r.auftraege.filter(a => a.phase === 'freigegeben')
      const mechanisch = r.faelle.filter(x => x.mechanisch)
      const worker = rolle(r, 'Worker')
      const d = r.digest
      const abschnitt = (titel: string, inhalt: RenderChildren[]) =>
        inhalt.length > 0 && (
          <Box flexDirection="column">
            {ueberschrift(titel)}
            {inhalt}
          </Box>
        )
      const reviewer = rolle(r, 'Reviewer')?.url ?? `https://github.com/${r.repo}/actions/workflows/${REVIEWER_WORKFLOW}`
      return (
        <Box key={`zeile-${r.repo}`} flexDirection="column" borderStyle="round" borderColor={warten > 0 ? 'warning' : 'suggestion'} paddingX={1} gap={1}>
          {kopfZeile}
          <Box flexDirection="column" paddingLeft={2} gap={1}>
            {abschnitt(
              'Wartet auf dich',
              echte(r).map(fall => {
                const art = artVon(fall)
                return (
                  <Box key={`warte-${fall.nummer}`} flexDirection="row" justifyContent="space-between" gap={1}>
                    <Link href={art === 'Merge' ? (fall.pr?.url ?? fall.url) : fall.url} label={kurz(`#${fall.nummer} ${fall.titel}`, 60)} />
                    <Text color={art === 'Entscheidung' ? 'merged' : 'warning'}>{art}</Text>
                  </Box>
                )
              }),
            )}
            {mechanisch.length > 0 && (
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                <Text dimColor>Repariert sich selbst:</Text>
                {mechanisch.map(x => (
                  <Link href={x.pr?.url ?? x.url} label={`#${x.pr?.number ?? x.nummer}`} />
                ))}
                {worker?.naechster && <Text dimColor>(nächster Worker {hm(worker.naechster, jetzt)})</Text>}
              </Box>
            )}
            {abschnitt(
              'In Arbeit',
              inArbeit.map(a => (
                <Box key={`arbeit-${a.issue?.number ?? a.pr?.number}`} flexDirection="row" justifyContent="space-between" gap={1}>
                  <Link href={a.pr?.url ?? a.issue?.url ?? ''} label={kurz(auftragTitel(a), 60)} />
                  <Text dimColor>{a.phase}</Text>
                </Box>
              )),
            )}
            {abschnitt(
              'Bereit',
              bereit.map(a => (
                <Link href={a.issue?.url ?? ''} label={kurz(auftragTitel(a), 64)} />
              )),
            )}
            {d && (
              <Box flexDirection="column">
                {ueberschrift('Gemergt seit gestern 09:00')}
                <Text dimColor>
                  {`Features ${d.features} · Tests, Code ${d.tests} · Doku ${d.doku}`}
                  {d.autopilot > 0 ? ` · Autopilot ${d.autopilot}` : ''}
                </Text>
                {d.featureTitel.map(p => (
                  <Box flexDirection="row" gap={1}>
                    <Link href={p.url} label={`#${p.nummer}`} />
                    <Text>{kurz(p.titel, 60)}</Text>
                  </Box>
                ))}
                {d.prod.map(p => (
                  <Box flexDirection="row" gap={1}>
                    <Text color={p.offen ? 'error' : undefined} dimColor={!p.offen}>
                      Prod:
                    </Text>
                    <Link href={p.url} label={`#${p.nummer}`} />
                    <Text color={p.offen ? 'error' : undefined} dimColor={!p.offen}>
                      {kurz(p.titel, 50)}, {p.offen ? 'offen' : 'erledigt'}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}
            {r.fehler.map(x => (
              <Text color="error">Fehler {x}</Text>
            ))}
            <Box flexDirection="row" gap={2}>
              <Link href={`https://github.com/${r.repo}/issues`} label="Issues" />
              <Link href={`https://github.com/${r.repo}/pulls`} label="PRs" />
              <Link href={reviewer} label="Review-Läufe" />
            </Box>
          </Box>
        </Box>
      )
    }

    // 4. Auffaellig
    const saetze = auffaelligAlle(s.repos, jetzt)

    return (
      <Box flexDirection="column" gap={1}>
        {kopf}
        {s.fehler && <Text color="error">Fehler: {s.fehler}</Text>}
        {s.at > 0 && !s.fehler && s.repos.length === 0 && (
          <Text dimColor>Keine aktive Routine namens „Autopilot …: Planer|Scout|Worker|Reviewer|Chat“ gefunden.</Text>
        )}
        {s.repos.length > 0 && brauchtDich}
        {vs.map(verbundBlock)}
        {s.repos.length > 0 && (
          <Box flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between">
              {ueberschrift('Repos')}
              <Text dimColor size="caption">
                gemergt seit gestern 09:00
              </Text>
            </Box>
            {s.repos.map(repoZeile)}
          </Box>
        )}
        {s.repos.length > 0 && (
          <Box flexDirection="column">
            {ueberschrift('Auffällig')}
            {saetze.length === 0 && <Text dimColor>nichts</Text>}
            {saetze.map(x => (
              <Text color={x.schwer ? 'warning' : undefined} dimColor={!x.schwer}>
                {x.text}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
