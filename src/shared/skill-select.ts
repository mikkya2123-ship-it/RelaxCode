/**
 * Picking the skill for a request.
 *
 * The rule is deliberately simple and explainable: count the triggers the
 * request contains, give longer (more specific) triggers more weight, add one
 * point when the user is clearly asking to build or redesign something, and
 * require a minimum score. A bug report that merely mentions a site does not
 * drag a design playbook into the prompt; "сделай сайт" does.
 *
 * Anything ambiguous stays unmatched — no skill is better than the wrong one.
 */

import { SKILLS, type Skill } from './skills.ts'

/** Weight of one matched trigger: long or multi-word triggers are specific. */
function weightOf(trigger: string): number {
  return trigger.includes(' ') || trigger.length >= 8 ? 2 : 1
}

/** "Make me a thing" wording; it turns a weak noun into a real request. */
const BUILD_VERBS = [
  'сделай',
  'создай',
  'сверстай',
  'нарисуй',
  'придумай',
  'собери',
  'построй',
  'разработай',
  'переделай',
  'редизайн',
  'перепиши',
  'напиши',
  'улучши',
  'смоделируй',
  'build',
  'create',
  'design',
  'redesign',
  'make',
  'generate',
  'implement',
  'draw',
  'model',
  'rewrite',
  'improve'
]

const MIN_SCORE = 2

export interface SkillRank {
  skill: Skill
  score: number
  matched: string[]
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е')
}

/**
 * Every skill that matches, best first. `catalog` is the user's effective
 * catalog, so disabled skills and edited rules are already applied by then.
 */
export function rankSkills(request: string, catalog: readonly Skill[] = SKILLS): SkillRank[] {
  const text = normalise(request)
  if (text.trim() === '') return []
  const wantsSomething = BUILD_VERBS.some((verb) => text.includes(verb))

  const ranks: SkillRank[] = []
  for (const skill of catalog) {
    const matched = skill.triggers.filter((trigger) => text.includes(normalise(trigger)))
    if (matched.length === 0) continue
    const base = matched.reduce((sum, trigger) => sum + weightOf(trigger), 0)
    const score = base + (wantsSomething ? 1 : 0)
    ranks.push({ skill, score, matched })
  }

  return ranks.sort(
    (a, b) =>
      b.score - a.score ||
      Math.max(...b.matched.map((item) => item.length)) - Math.max(...a.matched.map((item) => item.length)) ||
      catalog.indexOf(a.skill) - catalog.indexOf(b.skill)
  )
}

/** The one skill for this request, or null when nothing fits well enough. */
export function selectSkill(request: string, catalog: readonly Skill[] = SKILLS): Skill | null {
  const [best] = rankSkills(request, catalog)
  if (!best || best.score < MIN_SCORE) return null
  return best.skill
}
