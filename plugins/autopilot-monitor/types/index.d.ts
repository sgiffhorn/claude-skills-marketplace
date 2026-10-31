export type Phase = 'Vorschlag' | 'freigegeben' | 'in Arbeit' | 'im Review' | 'Nacharbeit' | 'wird gemergt' | 'braucht dich'

export type Auftrag = {
  issue?: { number: number; title: string; url: string }
  pr?: { number: number; title: string; url: string }
  phase: Phase
  // Seit wann das Issue autopilot:ready traegt (ms), nur bei Phase freigegeben
  readySeit?: number
}

export type Lauf = {
  id: string
  url: string
  startedAt: number
  lastEventAt: number
  isRunning: boolean
  ergebnis: string
}

// naechster: geplanter naechster Lauf (ms), wo die Routine einen Zeitplan hat
// triggerId: die Routine auf claude.ai, wo es eine ist (die Reviewer-Action hat keine)
export type Routine = { rolle: string; url?: string; triggerId?: string; laeufe: Lauf[]; naechster?: number; fehler?: string }

// Ein offener needs-human-Fall oder eine offene Entscheidung; Issue und zugehoeriger PR sind ein Fall
export type Fall = {
  nummer: number
  titel: string
  url: string
  pr?: {
    number: number
    url: string
    titel?: string
    zweig?: string
    // Diff, Kopf und Checks des PR, soweit gelesen
    plus?: number
    minus?: number
    dateien?: number
    sha?: string
    ci?: string
    mergebar?: string
  }
  // Erster Satz des juengsten needs-human-Kommentars
  grund: string
  // Die eine Frage an den Menschen, wo der Kommentar eine stellt
  frage?: string
  // Optionen einer Entscheidung ("a) ..., b) ...") und ihr Stand
  optionen?: { kennung: string; text: string }[]
  stand?: string
  // Nummerierte Belege oder Befunde des Kommentars
  belege?: string[]
  // Runde des Reviews, wo der Kommentar sie nennt
  runde?: number
  // Technischer Grund, den der Worker selbst abraeumt
  mechanisch: boolean
  // Issue mit autopilot:entscheidung; grund ist dann die Frage des Planers
  entscheidung?: boolean
  // Der Reviewer gibt den PR in Stufe begleitet frei ("Urteil: wuerde mergen")
  merge?: boolean
  // Entscheidung mit einer Antwort, die der Planer noch einarbeitet
  beantwortet?: boolean
}

export type Digest = {
  // Fensterbeginn (ms): gestern 09:00 Europe/Berlin
  seit: number
  gemergt: number
  features: number
  tests: number
  doku: number
  // Aenderungen am Autopiloten selbst, nicht in gemergt
  autopilot: number
  featureTitel: { nummer: number; titel: string; url: string }[]
  prod: { nummer: number; titel: string; url: string; offen: boolean }[]
}

export type RepoSicht = {
  repo: string
  // Repo der Zentrale, wenn die Routinen eine nennen; sonst Ein-Repo-Modus
  zentrale?: string
  stufe?: string
  // merge_methode aus der Repo-Datei, Vorgabe squash
  mergeMethode?: string
  auftraege: Auftrag[]
  routinen: Routine[]
  faelle: Fall[]
  digest?: Digest
  journalUrl?: string
  // Offene Issues mit autopilot:wip in diesem Repo; mit Zentrale ist wipDeckel
  // nur deckel.wip_begleitet in Stufe begleitet
  wip?: number
  wipDeckel?: number
  // Mit Zentrale: WIP ueber alle ihre Repos gegen den globalen deckel.wip
  wipAlle?: number
  wipAlleDeckel?: number
  nachschubHeute?: number
  nachschubDeckel: number
  // Offene Issues mit autopilot:idee hier, mit Zentrale summiert gegen den globalen deckel.offene_ideen
  ideen?: number
  ideenAlle?: number
  ideenDeckel?: number
  // Bremsschwellen des Workers aus deckel.budget_5h und deckel.budget_woche_vorlauf
  budget5h?: number
  budgetVorlauf?: number
  // Wann heute der Nachschub-Deckel erreicht wurde (ms)
  nachschubVollUm?: number
  fehler: string[]
}

// Ratenfenster des Kontos (five_hour, seven_day); Cloud-Laeufe zehren vom selben Kontingent
export type Fenster = { kind: string; percentUsed: number; resetsAt?: string }

// Laufende oder zuletzt gelaufene Aktion aus dem Panel; frage wartet auf die Bestaetigung
export type Aktion = { id: string; status: 'frage' | 'laeuft' | 'ok' | 'fehler'; text?: string }

export type Stand = { at: number; repos: RepoSicht[]; isLoading: boolean; fehler?: string }

declare module 'claude-code' {
  interface PluginState {
    'autopilot-monitor': { stand: Shaped<Stand>; bandWeg: string | null; fenster: Fenster[]; aufgeklappt: string | null; details: string | null; aktion: Aktion | null }
  }
}
