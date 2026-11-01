/**
 * The Friendly Development team: a roster of REAL people who work on tasks
 * with AI assistance. The lead assigns tasks; each member works within their
 * specialty scope on their own git branch, and the AI agent that helps them
 * knows their role, their open tasks and their limits. One team per app for
 * now; a network of cooperating teams is a future step.
 */

export type TeamSpecialty =
  | 'admin'
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'designer'
  | 'tester'
  | 'devops'
  | 'gameplay'

export type TeamLevel = 'intern' | 'junior' | 'middle' | 'senior' | 'lead'

export interface TeamMember {
  id: string
  nick: string
  specialty: TeamSpecialty
  level: TeamLevel
  /** File-scope prefixes this member works in ('src/ui'), '**' = everything. */
  scope: string[]
  /** Free-form duties written by the lead. */
  duties: string
  stats: { done: number; failed: number }
}

export type TeamTaskStatus = 'open' | 'progress' | 'review' | 'done'

export interface TeamTask {
  id: string
  title: string
  description: string
  assigneeId: string
  /** Lead who created the task (member id). */
  createdBy: string
  status: TeamTaskStatus
  createdAt: number
}

export interface TeamGithub {
  owner: string
  repo: string
  /** safeStorage-encrypted token of the LOCAL user (repo scope). */
  tokenEnc: string | null
}

/** The shared team file: identical for everyone, synced via git/GitHub. */
export interface TeamState {
  name: string
  description: string
  members: TeamMember[]
  tasks: TeamTask[]
  baseBranch: string
  github: TeamGithub
}

/**
 * Local-only identity: who works on THIS machine. Never part of the shared
 * team file — every teammate has their own.
 */
export interface TeamMe {
  memberId: string | null
  /** Encrypted personal access token of the local user. */
  tokenEnc: string | null
}

export type TeamEvent =
  | { kind: 'state'; state: TeamState }
  | { kind: 'log'; line: string; level: 'info' | 'error' }

export const TEAM_SPECIALTIES: readonly TeamSpecialty[] = [
  'admin',
  'frontend',
  'backend',
  'fullstack',
  'designer',
  'tester',
  'devops',
  'gameplay'
]

export const TEAM_LEVELS: readonly TeamLevel[] = ['intern', 'junior', 'middle', 'senior', 'lead']

export const TEAM_TASK_STATUSES: readonly TeamTaskStatus[] = [
  'open',
  'progress',
  'review',
  'done'
]
