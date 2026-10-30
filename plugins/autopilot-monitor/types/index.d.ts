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

export type Routine = { rolle: string; url?: string; laeufe: Lauf[]; fehler?: string }

export type RepoSicht = {
  repo: string
  stufe?: string
  auftraege: Auftrag[]
  routinen: Routine[]
  workerHeute?: number
  workerDeckel?: number
  wip?: number
  wipDeckel?: number
  fehler: string[]
}

export type Stand = { at: number; repos: RepoSicht[]; isLoading: boolean; fehler?: string }

declare module 'claude-code' {
  interface PluginState {
    'autopilot-monitor': { stand: Shaped<Stand> }
  }
}
