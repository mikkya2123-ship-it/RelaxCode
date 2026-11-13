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

/**
 * A loose form of an id or title: lower case, ё folded, runs of separators
 * collapsed into single dashes. "Blender: Render", "blender render" and
 * "BLENDER_RENDER" all become "blender-render".
 */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Resolves what the model passed to `use_skill` into a skill.
 *
 * A model may send the id exactly, the English or Russian title, an id with
 * underscores or capitals, or just describe the domain ("3d website"). None of
 * those may end up as a red cross in the chat: the id and the titles are
 * matched exactly first, then by containment (shortest match wins, so
 * "threejs" does not jump to "threejs-postprocessing"), and a description is
 * ranked by the same triggers that pick the skill automatically.
 */
export function findSkill(query: string, catalog: readonly Skill[] = SKILLS): Skill | null {
  const text = query.trim()
  if (text.length === 0) return null
  const needle = slugify(text)
  if (needle.length === 0) return null

  const byId = catalog.find((skill) => slugify(skill.id) === needle)
  if (byId) return byId

  const byTitle = catalog.find(
    (skill) => slugify(skill.titleEn) === needle || slugify(skill.title) === needle
  )
  if (byTitle) return byTitle

  const containing = catalog.filter((skill) => {
    const id = slugify(skill.id)
    return id.includes(needle) || needle.includes(id)
  })
  if (containing.length > 0) {
    return [...containing].sort((a, b) => a.id.length - b.id.length)[0] ?? null
  }

  const byTitlePart = catalog.filter((skill) => {
    const title = slugify(skill.titleEn)
    return title.includes(needle) || needle.includes(title)
  })
  if (byTitlePart.length > 0) {
    return [...byTitlePart].sort((a, b) => a.id.length - b.id.length)[0] ?? null
  }

  // Not an id at all: treat it as a description of the task.
  const [best] = rankSkills(text, catalog)
  return best?.skill ?? null
}
