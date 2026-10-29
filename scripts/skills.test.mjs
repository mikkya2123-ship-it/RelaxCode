/**
 * The design skill library and the selector that picks one per request.
 *
 * What matters here: every skill is usable as a prompt (rules, not vibes), the
 * catalog has no duplicates, and the selector chooses the right skill for the
 * obvious requests while staying silent on ordinary code work.
 *
 * Run with: npm run test:skills
 */
import {
  DEFAULT_SKILLS_SETTINGS,
  SKILLS,
  effectiveSkills,
  skillById
} from '../src/shared/skills.ts'
import { rankSkills, selectSkill } from '../src/shared/skill-select.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* ------------------------------- the catalog ------------------------------ */

const ids = new Set()
for (const skill of SKILLS) {
  check(`${skill.id}: unique id`, !ids.has(skill.id))
  ids.add(skill.id)
  check(`${skill.id}: has both titles`, skill.title.length > 0 && skill.titleEn.length > 0)
  check(`${skill.id}: has a summary`, skill.summary.length > 0 && skill.summaryEn.length > 0)
  check(`${skill.id}: at least 6 rules`, skill.rules.length >= 6, skill.rules.length)
  check(`${skill.id}: at least 2 triggers`, skill.triggers.length >= 2, skill.triggers.length)
  check(
    `${skill.id}: rules are single lines`,
    skill.rules.every((rule) => !rule.includes('\n') && rule.trim().length > 20)
  )
  const size = skill.rules.join(' ').length
  check(`${skill.id}: fits a prompt (< 2800 chars)`, size < 2800, size)
  check(
    `${skill.id}: triggers are lower case`,
    skill.triggers.every((trigger) => trigger === trigger.toLowerCase())
  )
}

check('the catalog is big enough to be useful', SKILLS.length >= 20, SKILLS.length)
check('skillById finds a known skill', skillById('threejs')?.id === 'threejs')
check('skillById returns null for an unknown id', skillById('nope') === null)

/* ------------------------------ the selector ------------------------------ */

const expected = [
  ['Сделай лендинг для AI-сервиса генерации обложек', 'ai-landing'],
  ['Build a landing page for an AI startup', 'ai-landing'],
  ['Собери дашборд с таблицей заказов и фильтрами', 'saas-dashboard'],
  ['Нужна 3D-сцена на three.js с мягкими тенями', 'threejs'],
  ['Смоделируй в Blender стул по референсу', 'blender-modeling'],
  ['Настрой свет и рендер в Cycles', 'blender-render'],
  ['Сделай постер для конференции', 'poster'],
  ['Сделай сайт-визитку для студии', 'web-page'],
  ['Сделай мобильное приложение для заметок', 'mobile-ui'],
  ['Нужна дизайн-система и токены для проекта', 'design-system'],
  ['Собери иконки для меню', 'iconography'],
  ['Перепиши тексты кнопок в интерфейсе', 'ui-copy'],
  ['Проверь доступность формы и контраст', 'accessibility'],
  ['Сделай адаптивную вёрстку под мобильные', 'responsive-layout'],
  ['Собери график продаж по месяцам', 'data-viz'],
  ['Придумай логотип и фирменный стиль', 'brand'],
  ['Сделай страницу тарифов с тремя планами', 'pricing-page'],
  ['Нужен онбординг при первом запуске', 'onboarding']
]

for (const [request, id] of expected) {
  const picked = selectSkill(request)
  check(`picks ${id} for "${request}"`, picked?.id === id, picked?.id ?? null)
}

// Ordinary code work must stay untouched: a skill in the wrong prompt costs
// context and distracts the model.
const silent = [
  'Поправь опечатку в README',
  'Исправь падающий тест в парсере',
  'Почему у меня падает сборка?',
  'Переименуй переменную x в y',
  'На сайте упал бэкенд, посмотри логи nginx',
  'Добавь ретраи в загрузчик файлов'
]
for (const request of silent) {
  check(`no skill for "${request}"`, selectSkill(request) === null, selectSkill(request)?.id ?? null)
}

/* --------------------------- user configuration --------------------------- */

const all = effectiveSkills(DEFAULT_SKILLS_SETTINGS)
check('defaults keep every skill', all.length === SKILLS.length, all.length)

const withoutBlender = effectiveSkills({ ...DEFAULT_SKILLS_SETTINGS, disabled: ['blender-modeling'] })
check('a disabled skill disappears', !withoutBlender.some((skill) => skill.id === 'blender-modeling'))
check(
  'a disabled skill is never picked',
  selectSkill('Смоделируй в Blender стул по референсу', withoutBlender)?.id !== 'blender-modeling',
  selectSkill('Смоделируй в Blender стул по референсу', withoutBlender)?.id ?? null
)
check(
  'a pinned skill must be enabled',
  withoutBlender.find((skill) => skill.id === 'blender-modeling') === undefined
)

const edited = effectiveSkills({
  ...DEFAULT_SKILLS_SETTINGS,
  overrides: [{ id: 'web-page', rules: ['Use the studio grid.', 'One accent colour only.'] }]
})
const editedPage = edited.find((skill) => skill.id === 'web-page')
check('an override replaces the rules', editedPage?.rules.length === 2, editedPage?.rules)
check('an override leaves the catalog intact', skillById('web-page')?.rules.length > 2)
check(
  'an empty override is ignored',
  effectiveSkills({
    ...DEFAULT_SKILLS_SETTINGS,
    overrides: [{ id: 'web-page', rules: ['   '] }]
  }).find((skill) => skill.id === 'web-page')?.rules.length === skillById('web-page').rules.length
)
check(
  'selection still works on an edited catalog',
  selectSkill('Сделай сайт-визитку', edited)?.id === 'web-page'
)

/* ------------------------------ explainability ---------------------------- */

const ranks = rankSkills('Сделай лендинг для AI-стартапа')
check('the winner is first', ranks[0]?.skill.id === 'ai-landing', ranks[0]?.skill.id)
check('the winner is explainable', (ranks[0]?.matched.length ?? 0) > 0, ranks[0]?.matched)
check('scores are sorted', ranks.every((item, index) => index === 0 || ranks[index - 1].score >= item.score))
check('an empty request picks nothing', selectSkill('   ') === null)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log(`\nall skill checks passed (${SKILLS.length} skills)`)
