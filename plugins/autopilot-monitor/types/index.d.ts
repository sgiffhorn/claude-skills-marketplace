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
export type Routine = { rolle: string; url?: string; laeufe: Lauf[]; naechster?: number; fehler?: string }

// Ein offener needs-human-Fall; Issue und zugehoeriger PR sind ein Fall
export type Fall = {
  nummer: number
  titel: string
  url: string
  pr?: { number: number; url: string }
  // Erster Satz des juengsten needs-human-Kommentars
  grund: string
  // Technischer Grund, den der Worker selbst abraeumt
  mechanisch: boolean
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
  // Bremsschwellen des Workers aus deckel.budget_5h und deckel.budget_woche_vorlauf
  budget5h?: number
  budgetVorlauf?: number
  // Wann heute der Nachschub-Deckel erreicht wurde (ms)
  nachschubVollUm?: number
  fehler: string[]
}

// Ratenfenster des Kontos (five_hour, seven_day); Cloud-Laeufe zehren vom selben Kontingent
export type Fenster = { kind: string; percentUsed: number; resetsAt?: string }

export type Stand = { at: number; repos: RepoSicht[]; isLoading: boolean; fehler?: string }

declare module 'claude-code' {
  interface PluginState {
    'autopilot-monitor': { stand: Shaped<Stand>; bandWeg: string | null; fenster: Fenster[] }
  }
}
