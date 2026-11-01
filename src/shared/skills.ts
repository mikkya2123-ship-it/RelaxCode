/**
 * The design skill library.
 *
 * Every skill is a compact, opinionated playbook: the rules a senior designer
 * would repeat while reviewing the work. The agent picks the one skill that
 * matches the request (see `selectSkill`) and gets its rules in the system
 * prompt, so the output follows a craft standard instead of generic model
 * taste — the difference between a layout that looks designed and AI slop.
 *
 * Rules are written in English for the model, one per line, imperative and
 * checkable. They stay short on purpose: a skill must fit in a prompt next to
 * the workspace context.
 */

export type SkillCategory = 'web' | 'ui' | 'graphics' | 'three-d' | 'content'

export interface Skill {
  id: string
  /** Russian title for the chat card. */
  title: string
  titleEn: string
  category: SkillCategory
  /** One line shown in the chat: what standard is being applied. */
  summary: string
  summaryEn: string
  /** Lower-case stems; the selector matches them inside the request text. */
  triggers: string[]
  rules: string[]
}

export const SKILLS: readonly Skill[] = [
  {
    id: 'ai-landing',
    title: 'Лендинг AI-продукта',
    titleEn: 'AI product landing page',
    category: 'web',
    summary: 'Оффер в одну строку, живой продукт вместо абстракций, один CTA',
    summaryEn: 'One-line offer, real product instead of abstractions, one CTA',
    triggers: [
      'лендинг',
      'landing',
      'посадочн',
      'hero section',
      'ai стартап',
      'ai startup',
      'ai продукт',
      'ai product',
      'промо-страниц',
      'промо страниц',
      'sales page'
    ],
    rules: [
      'Above the fold give one sentence of positioning: who it is for, what it does, what changes for them. No abstract taglines.',
      'Exactly one primary CTA per screen and the same verb everywhere ("Начать бесплатно", not "Начать"/"Попробовать"/"Войти" mixed).',
      'Show the product: a real UI fragment, a sample output, a before/after. No glowing orbs, neural networks or stock robots.',
      'Hero headline at most 8 words, subhead at most 2 lines.',
      'Banned filler: revolutionary, unleash, supercharge, next-gen, game-changing, seamless, effortless — say the concrete benefit instead.',
      '3–4 feature blocks, each with a verb-led heading and one proof: a number, a screenshot, an example result.',
      'Social proof must be specific (names, metrics). Never invent logos, ratings or review counts.',
      'Vertical rhythm: 96–128px between sections on desktop, one spacing scale everywhere, at most 2 background tones.',
      'Restraint: one accent colour, one font pairing, no gradient on every card, no border plus heavy shadow on the same block.',
      'Every clickable element has hover, focus-visible and active states; transitions 120–240ms, transform/opacity only.',
      'Mobile below 768px: single column, tap targets ≥ 44px, hero headline 36–40px, no horizontal scroll.',
      'Do not ship placeholder art or "lorem ipsum" — if an image is missing, use a real generated graphic, data or typographic block.'
    ]
  },
  {
    id: 'saas-dashboard',
    title: 'Дашборд и админка',
    titleEn: 'Dashboard and admin UI',
    category: 'ui',
    summary: 'Плотная сетка, читаемые числа, честные состояния загрузки и пустоты',
    summaryEn: 'Dense grid, readable numbers, honest loading and empty states',
    triggers: ['дашборд', 'dashboard', 'админк', 'admin panel', 'admin ui', 'crm', 'аналитик', 'analytics'],
    rules: [
      'Keep density high: 240–280px left nav, 56px top bar, content grid with 24px gutters. Marketing-sized whitespace is wrong here.',
      'Every number carries a unit, a trend and a time window ("12 400 запросов за 24 ч, +8%").',
      'Right-align numeric columns with tabular figures; never centre-align data.',
      'Tables: sticky header, either zebra rows or hairline dividers (not both), row actions on hover, keyboard row navigation.',
      'Charts: no 3D, no gradient fills as data, max 5 series, direct labels instead of a legend when possible, axis starts at zero for bars.',
      'Filters and the date range are always visible, and the active filter state is explicit ("Все проекты · 7 дней").',
      'Design all four states: loading (skeleton with the real row count), empty (what to do next), error (retry action), no access.',
      'Colour is semantic: one accent for the primary action; red/amber/green only for state, never for decoration.',
      '8px spacing grid, 40–44px rows, 12px between label and value, never let text touch a cell edge.',
      'Destructive actions are outlined red, never the primary filled button, and always confirm with the object name.'
    ]
  },
  {
    id: 'marketing-site',
    title: 'Многостраничный сайт',
    titleEn: 'Multi-page marketing site',
    category: 'web',
    summary: 'Единая сетка и ритм секций, живые тексты, никаких стоковых клише',
    summaryEn: 'One grid and section rhythm, real copy, no stock clichés',
    triggers: ['маркетинг', 'marketing site', 'многостраничн', 'корпоративн', 'сайт компании', 'agency', 'портфолио', 'portfolio'],
    rules: [
      'One layout grid and one spacing scale across every page; sections alternate at most two background tones.',
      'Each page has one job — say it in the H1, do not repeat the homepage promise on every page.',
      'Real copy beats placeholders: write headline, subhead, 3 bullets and a CTA for every section you build.',
      'Case studies use structure: context → what was done → measurable result. No "we are passionate about quality".',
      'Photography only if it is real and relevant; otherwise use typography, diagrams or product shots.',
      'Nav: 4–6 items max, current page marked, footer carries the long tail of links.',
      'Consistent hero height and heading scale between pages so navigation feels like one site.',
      'Include a contact route on every page and a real form with validation.',
      'Dark and light text both pass 4.5:1 contrast against their backgrounds.'
    ]
  },
  {
    id: 'docs-site',
    title: 'Документация',
    titleEn: 'Documentation layout',
    category: 'web',
    summary: 'Читаемая колонка 60–75 символов, навигация и живые примеры кода',
    summaryEn: 'Readable 60–75 character column, navigation, live code examples',
    triggers: ['документац', 'documentation', 'docs site', 'readme layout', 'справочник api', 'api reference'],
    rules: [
      'Body column 60–75 characters wide, 16–18px, line-height 1.6–1.7; never full-width paragraphs.',
      'Sidebar with two levels and the current page highlighted; table of contents on the right for long pages.',
      'One H1 per page; heading levels never skip; anchors are linkable.',
      'Code blocks: language label, copy button, and the expected output right below.',
      'Every page ends with "what next" links instead of a dead end.',
      'Inline code styled distinctly from links; links underlined or clearly coloured, never both bold and coloured.',
      'Search is available from every page, with a keyboard shortcut.',
      'Do not describe UI in prose if a screenshot or a numbered list does it faster.'
    ]
  },
  {
    id: 'pricing-page',
    title: 'Тарифы',
    titleEn: 'Pricing page',
    category: 'web',
    summary: 'Три плана, честные лимиты, сравнение без мелкого шрифта',
    summaryEn: 'Three plans, honest limits, comparison without fine print',
    triggers: ['тариф', 'pricing', 'подписк', 'subscription plan', 'план оплат', 'billing page'],
    rules: [
      'Three plans is the default; a fourth only if there is a real enterprise tier.',
      'Mark one plan as recommended and say why in one line, not with a badge alone.',
      'Show the limit that decides the upgrade on the card itself ("10 000 запросов / мес"), not only in the comparison table.',
      'Prices: same currency and period everywhere, taxes and annual discount stated plainly.',
      'Feature comparison table: group rows, keep it scannable, no checkmark-only rows without a short label.',
      'The CTA on each card names the plan outcome ("Перейти на Pro"), not the generic "Выбрать".',
      'FAQ answers the three objections: cancellation, overage, data export.',
      'No dark patterns: no hidden fees, no fake countdown, no pre-selected annual plan.'
    ]
  },
  {
    id: 'onboarding',
    title: 'Онбординг и первые шаги',
    titleEn: 'Onboarding flow',
    category: 'ui',
    summary: '3–5 шагов, прогресс, возможность пропустить, польза до регистрации',
    summaryEn: '3–5 steps, progress, skippable, value before signup',
    triggers: ['онбординг', 'onboarding', 'первый запуск', 'first run', 'welcome flow', 'мастер настройки', 'setup wizard'],
    rules: [
      '3–5 steps maximum; each step asks for exactly one thing.',
      'Show progress ("2 из 4") and let the user go back without losing input.',
      'Let people skip; never block the product behind a tutorial.',
      'Ask only what changes the experience now — no company size, no role survey before the first result.',
      'Every step states the benefit in its heading ("Подключите модель"), not the mechanic ("Шаг 2").',
      'Finish with a concrete first action and a sample that is already filled in.',
      'Empty states after onboarding repeat the same next step, so nothing dead-ends.',
      'Escape hatch on every screen: close, skip, or "настрою позже".'
    ]
  },
  {
    id: 'mobile-ui',
    title: 'Мобильный интерфейс',
    titleEn: 'Mobile app UI',
    category: 'ui',
    summary: 'Зона большого пальца, 44px цели, safe area и нижняя навигация',
    summaryEn: 'Thumb zone, 44px targets, safe areas, bottom navigation',
    triggers: ['мобильн', 'mobile app', 'ios app', 'android', 'смартфон', 'phone layout'],
    rules: [
      'Primary actions live in the bottom third (thumb zone); top corners are for context, not for frequent taps.',
      'Tap targets ≥ 44×44px with ≥ 8px between them.',
      'Respect safe areas: no content under the notch or the home indicator.',
      'Bottom navigation with 3–5 items; tabs keep their state when switching.',
      'Use platform patterns (bottom sheet, swipe back, native pickers) instead of desktop dropdowns.',
      'One column, full-width cards, 16px side padding, text ≥ 15px.',
      'Modals are sheets, not centred dialogs; they dismiss by swipe and by a visible handle.',
      'Design the keyboard state: inputs stay visible above the keyboard, the CTA does not jump under it.'
    ]
  },
  {
    id: 'forms',
    title: 'Формы и валидация',
    titleEn: 'Forms and validation',
    category: 'ui',
    summary: 'Подписи сверху, ошибки по месту, никакой валидации после отправки',
    summaryEn: 'Labels above, errors in place, no validate-after-submit',
    triggers: ['форм', 'form ', 'форм', 'валидац', 'validation', 'input field', 'регистрац', 'signup form', 'login form'],
    rules: [
      'Labels above inputs, always visible; placeholders are examples, never the label.',
      'Validate on blur and on submit, not on every keystroke; keep the error next to the field it belongs to.',
      'Error text says how to fix it ("Нужен адрес вида name@company.com"), not "Неверный ввод".',
      'Mark required fields once, at the top, not with an asterisk on every row.',
      'One primary action per form; secondary actions are text buttons.',
      'Group fields into short sections; more than 7 fields needs a progress hint or a split.',
      'Disabled submit is a trap — keep it enabled and show what is missing.',
      'Success state confirms what happened and what is next, in place.'
    ]
  },
  {
    id: 'design-system',
    title: 'Дизайн-система и токены',
    titleEn: 'Design system and tokens',
    category: 'ui',
    summary: 'Токены вместо магии, шкала, состояния каждого компонента',
    summaryEn: 'Tokens instead of magic values, a scale, states for every component',
    triggers: ['дизайн-систем', 'design system', 'токен', 'tokens', 'ui kit', 'компонент', 'component library', 'стайлгайд', 'style guide'],
    rules: [
      'Define tokens first: colour, spacing, radius, type, shadow, duration. Components use tokens only.',
      'One spacing scale (4/8/12/16/24/32/48/64/96) and one type scale; no arbitrary 13px, 17px, 27px.',
      'Every component documents its states: default, hover, focus-visible, active, disabled, loading, error, empty.',
      'Variants are limited and named by intent (primary, secondary, ghost, danger), not by colour.',
      'Radius and shadow come from the scale; mixing 4px and 14px radii looks accidental.',
      'Dark mode is a token set, not an inverted filter: check contrast and borders separately.',
      'Document usage in one sentence per component plus a do/don\'t pair.',
      'No component is allowed to invent its own spacing or colour inside a screen.'
    ]
  },
  {
    id: 'typography',
    title: 'Типографика',
    titleEn: 'Typography',
    category: 'graphics',
    summary: 'Две гарнитуры максимум, модульная шкала, ритм строк',
    summaryEn: 'Two families maximum, modular scale, line rhythm',
    triggers: ['типограф', 'typography', 'шрифт', 'font pairing', 'заголовк', 'headline scale', 'line height'],
    rules: [
      'Two font families maximum: one for headings, one for text, or a single family with weights.',
      'Modular scale (1.2–1.333) for headings; body 15–18px depending on density.',
      'Body line-height 1.5–1.7, headings 1.1–1.25; never the same line-height for both.',
      'Line length 45–75 characters; long text gets a max-width, not a full-width paragraph.',
      'Use 2–3 weights only; fake bold and fake italic are forbidden.',
      'Letter-spacing: slightly negative on large headings (-0.01 to -0.02em), zero or positive on small caps.',
      'Aligned left, ragged right; avoid justified text on the web.',
      'Hierarchy through size, weight and space — not through colouring every heading.',
      'Check widows and orphans in headings; keep a heading with at least two lines of its paragraph.'
    ]
  },
  {
    id: 'color-system',
    title: 'Цвет и контраст',
    titleEn: 'Colour and contrast',
    category: 'graphics',
    summary: 'Один акцент, нейтральная база, AA-контраст и паритет тёмной темы',
    summaryEn: 'One accent, neutral base, AA contrast, dark-mode parity',
    triggers: ['палитр', 'palette', 'цвет', 'color scheme', 'контраст', 'contrast', 'тёмн темы', 'dark theme', 'dark mode design'],
    rules: [
      'Start from neutrals (8–10 steps), then add exactly one accent plus semantic red/amber/green.',
      'Text contrast: 4.5:1 for body, 3:1 for large text and UI borders that carry meaning.',
      'Do not encode meaning in hue alone — pair colour with an icon, label or weight.',
      'Accent is for the primary action and one emphasis per screen; if everything is accented, nothing is.',
      'Hover and active states move lightness, not hue.',
      'Dark theme is designed, not inverted: raise surfaces instead of pure black, desaturate the accent slightly, keep borders visible.',
      'Check the palette in greyscale to confirm the hierarchy survives without colour.',
      'No rainbow gradients on text or cards; one two-stop gradient is the maximum and only where it carries meaning.'
    ]
  },
  {
    id: 'motion',
    title: 'Анимация интерфейса',
    titleEn: 'UI motion',
    category: 'ui',
    summary: 'Смысл, 120–300мс, только transform и opacity, уважение к reduced-motion',
    summaryEn: 'Purpose, 120–300ms, transform and opacity only, reduced-motion respected',
    triggers: ['анимац', 'animation', 'motion design', 'переход', 'transition', 'микроанимац', 'microinteraction', 'framer motion', 'motion/react'],
    rules: [
      'Every animation answers a question: where did this come from, what changed, what is happening now.',
      'Durations: 120–200ms for state changes, 200–300ms for entrances, up to 400ms for full-screen transitions.',
      'Animate transform and opacity; animating layout, width, height or box-shadow causes jank.',
      'One easing family: ease-out for entrances, ease-in for exits, no bounce unless the product is playful.',
      'Stagger lists by 20–40ms; never more than 8 items in a stagger.',
      'Listen to prefers-reduced-motion and drop to instant or fade-only.',
      'Loading states use motion to prove liveness, not to decorate: no spinner on top of a spinner.',
      'No parallax scroll hijacking; no animation that delays the user\'s next action.'
    ]
  },
  {
    id: 'accessibility',
    title: 'Доступность',
    titleEn: 'Accessibility',
    category: 'ui',
    summary: 'Семантика, фокус, клавиатура, ARIA только по делу',
    summaryEn: 'Semantics, focus, keyboard, ARIA only where needed',
    triggers: ['доступност', 'accessib', 'a11y', 'aria', 'скринридер', 'screen reader', 'клавиатур', 'keyboard navigation'],
    rules: [
      'Use semantic elements first (button, nav, main, label); ARIA only fills gaps, it never replaces native behaviour.',
      'Everything interactive is reachable and operable by keyboard, in a logical order.',
      'Focus is always visible: a 2px ring with 2px offset, contrast ≥ 3:1.',
      'Images carry meaningful alt text or empty alt when decorative.',
      'Form fields are associated with labels, errors announced via aria-live and tied with aria-describedby.',
      'Headings form a real outline, one H1 per page.',
      'Do not remove outlines, do not trap focus, and return focus when a dialog closes.',
      'Colour is never the only signal; test the UI at 200% zoom.'
    ]
  },
  {
    id: 'states-feedback',
    title: 'Состояния и обратная связь',
    titleEn: 'States and feedback',
    category: 'ui',
    summary: 'Загрузка, пустота, ошибка и успех — у каждого экрана',
    summaryEn: 'Loading, empty, error and success for every screen',
    triggers: ['пустое состояние', 'empty state', 'состояни загрузк', 'loading state', 'skeleton', 'уведомлен', 'toast', 'error state', 'фидбек'],
    rules: [
      'Every data screen ships four states: loading, empty, error, success.',
      'Loading uses skeletons that match the real layout, not a centred spinner on a blank page.',
      'Empty states explain what this area is for and give one action to fill it.',
      'Errors say what happened, what to do, and keep the user\'s input.',
      'Toasts are for transient confirmation only; anything that needs a decision goes inline.',
      'Optimistic updates must reconcile: if the request fails, the UI rolls back and says so.',
      'Never show a spinner for under 200ms; never leave one spinning after the result arrived.',
      'Disabled and busy states are visually distinct, and the button keeps its width when the label changes to a spinner.'
    ]
  },
  {
    id: 'ai-chat-ui',
    title: 'Чат-интерфейс для AI',
    titleEn: 'AI chat interface',
    category: 'ui',
    summary: 'Стриминг, карточки инструментов, остановка, честные токены',
    summaryEn: 'Streaming, tool cards, stop button, honest token accounting',
    triggers: ['чат-интерфейс', 'chat ui', 'ai chat', 'ассистент интерфейс', 'llm interface', 'стриминг', 'streaming response'],
    rules: [
      'Stream tokens into place; the answer never waits for the full response to appear.',
      'Tool calls get their own compact cards with status (running / ok / error) and an expandable detail.',
      'A stop button is always reachable while the model works, and stopping keeps what was already produced.',
      'Show context usage honestly (used / limit, what was dropped) instead of a hidden counter.',
      'Errors are inline and actionable: rate limit, bad key, no model, empty answer each get their own sentence.',
      'Input stays usable while streaming; support queueing rather than silently disabling send.',
      'Reasoning, if shown, is collapsible and clearly separate from the answer.',
      'Auto-scroll follows new output only while the user is near the bottom; never yank the viewport.'
    ]
  },
  {
    id: 'data-viz',
    title: 'Графики и диаграммы',
    titleEn: 'Charts and data viz',
    category: 'graphics',
    summary: 'Без 3D-пирогов, честные оси, прямые подписи, одна идея на график',
    summaryEn: 'No 3D pies, honest axes, direct labels, one idea per chart',
    triggers: ['график', 'chart', 'диаграмм', 'diagram', 'визуализац', 'data viz', 'visualization', 'гистограмм', 'bar chart'],
    rules: [
      'One chart, one question. If two questions are needed, draw two charts.',
      'No 3D pies, no exploded slices, no shadows; a pie only for 2–3 parts that sum to a whole.',
      'Bars start at zero; lines may crop the axis, but say so.',
      'Label series directly on the chart; a legend is the fallback, not the default.',
      'Max 5 colours; the same colour means the same thing across the whole page.',
      'Order categories by value unless the axis is ordinal.',
      'Annotate the point that matters; drop gridlines that do not help read a number.',
      'Show units, the time window, and the source.'
    ]
  },
  {
    id: 'ui-copy',
    title: 'Тексты интерфейса',
    titleEn: 'UI copywriting',
    category: 'content',
    summary: 'Глаголы, конкретика, никаких AI-штампов',
    summaryEn: 'Verbs, specifics, no AI clichés',
    triggers: [
      'текст интерфейс',
      'тексты интерфейса',
      'тексты кнопок',
      'текст кнопок',
      'подписи кнопок',
      'тексты для сайта',
      'ui copy',
      'микротекст',
      'microcopy',
      'копирайт',
      'copywriting',
      'заголовк',
      'tagline',
      'слоган'
    ],
    rules: [
      'Buttons are verbs ("Сохранить", "Удалить проект"), never "ОК"/"Отправить" when something more specific exists.',
      'Headlines promise an outcome, not a feature name.',
      'Banned AI-slop words: revolutionize, unleash, elevate, seamless, cutting-edge, supercharge, empower, game-changer, "в мире", "под ключ".',
      'Errors: what happened + what to do, in that order, in one sentence.',
      'Empty states invite the first action instead of apologising.',
      'Sentence case for UI labels; no ALL CAPS paragraphs, no exclamation marks.',
      'Numbers instead of vague claims ("в 2 раза быстрее", not "значительно быстрее").',
      'Read every string aloud: if a person would not say it, rewrite it.'
    ]
  },
  {
    id: 'brand',
    title: 'Бренд и айдентика',
    titleEn: 'Brand and identity',
    category: 'graphics',
    summary: 'Один знак, палитра, тон голоса и правила применения',
    summaryEn: 'One mark, a palette, tone of voice and usage rules',
    triggers: ['бренд', 'brand', 'логотип', 'logo', 'айдентик', 'identity', 'фирменн', 'visual identity'],
    rules: [
      'Start from three adjectives that describe the product; every visual decision must trace back to one of them.',
      'The mark must work at 16px and in one colour before any gradient or detail is added.',
      'Palette: 1 accent, 2–3 neutrals, plus semantic states; document hex values and usage.',
      'Type: one family for identity, one for running text; define weights and minimum sizes.',
      'Show the system applied: card, app icon, social banner, one page. A logo on white is not an identity.',
      'Define clear space, minimum size, what not to do (stretch, recolour, add effects).',
      'Tone of voice gets examples: three sentences to sound like, three to avoid.'
    ]
  },
  {
    id: 'poster',
    title: 'Постер и обложка',
    titleEn: 'Poster and cover graphics',
    category: 'graphics',
    summary: 'Сетка, крупная типографика, 2–3 цвета, один фокус',
    summaryEn: 'Grid, large type, 2–3 colours, one focal point',
    triggers: ['постер', 'poster', 'обложк', 'cover art', 'афиш', 'banner design', 'баннер'],
    rules: [
      'One focal element; everything else supports it. If two things shout, neither is heard.',
      'Build on a visible grid (columns and a baseline); place type on it deliberately.',
      'Type carries the poster: 3 levels maximum (headline, subhead, detail) with a huge jump between them.',
      '2–3 colours, one of them dominant; check the pair in greyscale.',
      'Margins at least 5% of the short side; nothing important within 10px of the edge.',
      'No clipart and no stock photo collages; if imagery is needed, use geometry, texture or a real photo with a clear crop.',
      'Export at the target ratio from the start (4:5, 1:1, 16:9) instead of stretching later.'
    ]
  },
  {
    id: 'threejs',
    title: '3D-сцена на Three.js',
    titleEn: 'Three.js scene',
    category: 'three-d',
    summary: 'Свет key/fill/rim, PBR, ACES, бюджет кадров и мягкие тени',
    summaryEn: 'Key/fill/rim light, PBR, ACES, draw-call budget, soft shadows',
    triggers: ['three.js', 'threejs', 'webgl', 'react three fiber', 'r3f', '3д сцен', '3d scene', 'web 3d', 'glsl', 'shader'],
    rules: [
      'Camera: FOV 35–50, positioned with intent; no fisheye defaults.',
      'Lighting is a rig, not a lamp: key light, softer fill, rim for separation; ambient alone flattens everything.',
      'Use PBR materials (metalness/roughness) from physically plausible values: metal 0.8–1 with low roughness, plastic 0.0 metal with 0.3–0.6 roughness.',
      'Renderer: ACESFilmic tone mapping, sRGB output, shadows PCFSoft; cap devicePixelRatio at 2.',
      'Composition: fill ~60% of the frame, leave deliberate empty space, keep the horizon off-centre.',
      'Ground contact matters — objects need a shadow catcher or they float.',
      'Performance budget: < 100 draw calls, instance repeated geometry, dispose textures and geometries on unmount.',
      'Use an HDRI/PMREM environment for reflections instead of fake white highlights.',
      'Motion: a slow idle, not a spinning model; respect prefers-reduced-motion.'
    ]
  },
  {
    id: 'blender-modeling',
    title: 'Моделинг в Blender',
    titleEn: 'Blender modelling',
    category: 'three-d',
    summary: 'Реальный масштаб, чистая топология, bevel и лишний вес',
    summaryEn: 'Real scale, clean topology, bevelled edges, controlled polycount',
    triggers: ['blender', 'моделинг', 'modeling', '3д модель', '3d model', 'меш', 'mesh editing', 'скульпт', 'sculpt'],
    rules: [
      'Model at real-world scale first (a chair is 45cm seat height); every later step depends on it.',
      'Use a reference with dimensions; never model from imagination before proportions are verified.',
      'Clean topology: quads on curved surfaces, no n-gons on deformation areas, no duplicate verts, no flipped normals.',
      'Bevel the edges that catch light (0.5–2mm on hard-surface objects); unbevelled CG reads as plastic toy.',
      'Modifiers stay live until the end; apply only for export or boolean cleanup.',
      'Subdivision for organic shapes, weighted normals for hard-surface; do not stack both without reason.',
      'Uniform, sensible UVs; real-world texel density; seams where they will not be seen.',
      'Name objects and collections meaningfully — "Cube.013" is not a deliverable.',
      'Check silhouette from four angles before adding detail.'
    ]
  },
  {
    id: 'blender-render',
    title: 'Свет и рендер в Blender',
    titleEn: 'Blender lighting and render',
    category: 'three-d',
    summary: 'Трёхточечный свет, HDRI, композиция и денойз',
    summaryEn: 'Three-point rig, HDRI, composition, denoise',
    triggers: ['рендер', 'render', 'освещен', 'lighting setup', 'cycles', 'eevee', 'hdri', 'студийный свет'],
    rules: [
      'Three-point rig: key at 45°, fill half the key power, rim behind for edge separation.',
      'Add an HDRI for reflections and ambient; raise its strength only after the key reads correctly.',
      'Soft shadows: area lights larger than the subject at 1–2m distance, not a point light with a 0.1 radius.',
      'Use Filmic/AgX view transform and check highlights for clipping.',
      'Camera: 50–85mm equivalent for product shots, 35mm for environments; avoid extreme wide angles.',
      'Compose in the frame: rule of thirds or centred symmetry, not accidental.',
      'Cycles: 128–512 samples with denoising is enough for stills; EEVEE needs baked GI or it looks flat.',
      'Transparent or subtle gradient backgrounds beat a busy scene.',
      'Render a final at the target aspect ratio and check it at 100%, not in the viewport.'
    ]
  },
  {
    id: 'game-asset',
    title: '3D-ассет для игры',
    titleEn: 'Game-ready 3D asset',
    category: 'three-d',
    summary: 'Бюджет полигонов, LOD, атлас текстур, PBR-карты',
    summaryEn: 'Poly budget, LODs, texture atlas, PBR maps',
    triggers: ['game asset', 'игров ассет', 'low poly', 'lowpoly', 'unity asset', 'unreal asset', 'lod', 'game-ready'],
    rules: [
      'Start from the poly and texture budget of the target platform; state it before modelling.',
      'High-to-low workflow: sculpt or model high, bake normals onto a clean low-poly mesh.',
      'LODs at 100/50/25% triangles with matching silhouettes.',
      'One texture atlas per material group; avoid a unique 4K texture for a prop.',
      'PBR set: base colour without baked lighting, roughness, metalness, normal, AO.',
      'Collision mesh is separate and simple; never use the render mesh for physics.',
      'Pivot at a sensible origin, scale 1 unit = 1 metre, transforms applied.',
      'Test in the engine with the real lighting before calling it done.'
    ]
  },
  {
    id: 'product-3d',
    title: 'Продуктовый 3D-визуал',
    titleEn: 'Product 3D visual',
    category: 'three-d',
    summary: 'Студийный свет, отражения, чистый фон и честный материал',
    summaryEn: 'Studio lighting, reflections, clean background, honest material',
    triggers: ['продуктов визуал', 'product visual', 'product render', 'предметн съемк', 'бутылк', 'packshot'],
    rules: [
      'Studio setup: large softbox key, two strip lights for edge definition, black flags to shape reflections.',
      'Material must tell the truth: plastic is not chrome, glass needs thickness and an IOR near 1.45.',
      'Reflections define the shape — plan the environment, do not add a random HDRI.',
      'Background: seamless gradient or solid; no distracting props unless they explain the product.',
      'Camera: 50–85mm, product fills 55–70% of the height, eye level or slightly above.',
      'One hero shot plus detail shots (texture, cap, label), same lighting family.',
      'Colour management: check the label text is legible and whites are neutral.',
      'Deliver at the store\'s aspect ratio with a clean alpha if it will be composited.'
    ]
  },
  {
    id: 'iconography',
    title: 'Иконки',
    titleEn: 'Iconography',
    category: 'graphics',
    summary: 'Один сет 24px, единая толщина, выравнивание по пикселям',
    summaryEn: 'One 24px set, consistent stroke, pixel alignment',
    triggers: ['иконк', 'icon set', 'iconography', 'иконки', 'lucide'],
    rules: [
      'One set, one grid: 24×24 with a 2px keyline and 2px stroke unless the set says otherwise.',
      'Stay inside the icon library already in the project; do not mix outline and filled styles.',
      'Keep optical sizes consistent: a circle and a square of the same nominal size must look equal.',
      'Align to the pixel grid at 1× and 2×; avoid half-pixel strokes.',
      'Use icons to support a label, not to replace it, unless the meaning is universal (close, search, play).',
      'Colour icons with currentColor so they inherit text colour and states.',
      'Touch targets are larger than the glyph: at least 32px in dense UI, 44px on mobile.'
    ]
  },
  {
    id: 'responsive-layout',
    title: 'Адаптивная вёрстка',
    titleEn: 'Responsive layout',
    category: 'web',
    summary: 'Контейнеры и fluid-типографика, 3–4 брейкпоинта без ломки сетки',
    summaryEn: 'Containers and fluid type, 3–4 breakpoints without broken grids',
    triggers: ['адаптив', 'responsive', 'брейкпоинт', 'breakpoint', 'mobile first', 'вёрстк', 'layout grid', 'сетк'],
    rules: [
      'Design mobile-first; the desktop layout is the enlargement, not the source of truth.',
      '3–4 breakpoints are enough; use content-driven ones, not device names.',
      'Use a container with max-width plus fluid padding (clamp), not fixed pixel widths.',
      'Fluid type with clamp() for headings; body text stays between 15 and 18px.',
      'Grid: CSS grid for page structure, flex for rows of items; never rely on floats.',
      'Test 320, 768, 1024, 1440 and a 200% zoom; no horizontal scroll at any of them.',
      'Images: size attributes plus object-fit, so nothing jumps while loading.',
      'Navigation collapses to a real pattern (drawer or bottom bar), not a squeezed desktop menu.'
    ]
  },
  {
    id: 'web-page',
    title: 'Веб-страница',
    titleEn: 'Web page',
    category: 'web',
    summary: 'Иерархия, сетка и единый ритм вместо шаблонного ИИ-макета',
    summaryEn: 'Hierarchy, grid and rhythm instead of the usual AI template',
    triggers: ['сайт', 'website', 'web page', 'веб-страниц', 'вебсайт', 'веб сайт', 'статическ страниц'],
    rules: [
      'Build the hierarchy first: one H1, one primary action, then supporting blocks. A page without a focal point reads as a template.',
      'Pick a grid (12 columns or a 1200px container) and keep every block inside it; align left edges.',
      'One spacing scale from the project; consistent gaps between sections beat hand-tuned margins.',
      'Type scale: 3 sizes for headings plus body; do not use 6 heading sizes on one page.',
      'Colour: neutral base, one accent, semantic states; no coloured card per feature.',
      'Every section answers a question the visitor has (what is it, who for, why trust, what next).',
      'Real content: write the actual headline and three real feature lines instead of placeholders.',
      'Interactive states for every link and button; focus-visible must be visible.',
      'Check 320px and 1440px wide; no overflow, no stretched images, no orphan headings.',
      'Avoid the stock AI look: no purple-blue gradient hero, no glassmorphism cards, no floating orbs or dotted grid backgrounds.'
    ]
  },

// Godot pack sourced from github.com/gamedev-skills/awesome-gamedev-agent-skills
// (MIT-style community skills, condensed from their SKILL.md playbooks).
  {
    id: 'godot-gdscript',
    title: 'Godot: GDScript',
    titleEn: 'Godot: GDScript',
    category: 'three-d',
    summary: 'Типизация, жизненный цикл нод, сигналы и await по канонам Godot 4',
    summaryEn: 'Типизация, жизненный цикл нод, сигналы и await по канонам Godot 4',
    triggers: [
      'godot',
      'gdscript',
      '.gd',
      'скрипт godot',
      'typing godot',
      'cannot infer'
    ],
    rules: [
      'Use when writing or fixing \'.gd\' files: declaring variables, functions, classes, using \'@export\'/\'@onready\', connecting signals, or awaiting',
      'Use when porting Godot 3.x scripts to 4.x and the script no longer',
      'Type everything you can. GDScript 2.0 supports static types (\'var hp: int = 10\', \'func add(a: int, b: int) -> int:\'). Types catch errors at parse time and speed up the VM. Use \':=\' for inferred',
      'Use the lifecycle callbacks for their purpose: \'_ready()\' once when the node and its children enter the tree; \'_process(delta)\' every rendered frame; \'_physics_process(delta)\' on the fixed physics tick (use it for',
      'Grab node references with \'@onready\', not in \'_init()\' — children do not exist until the node enters the',
      'Expose tunables with \'@export\' so designers edit them in the',
      'React to events with signals + \'await\', not polling, where it reads',
      'Run and read errors. The Debugger panel prints typed errors with line numbers; fix the first error first (later ones are often',
      '3.x → 4.x signal API changed. \'emit_signal("x")\' still works but prefer \'x.emit(...)\'; \'connect("x", self, "_on_x")\' is gone — use \'x.connect(_on_x)\' with a Callable. \'yield(obj, "sig")\' is now \'await',
      '\'export var\' is now \'@export var\' (annotation). Likewise \'onready\'→\'@onready\', \'tool\'→\'@tool\', \'remote\'/\'master\' RPC keywords → the \'@rpc(...)\'',
      '\'@onready\' and \'$NodePath\' in \'_init()\' fail — the node isn\'t in the tree yet. Initialize node references in \'_ready()\' or with',
      'Integer division truncates. \'5 / 2 == 2\'. Use \'5.0 / 2\' or cast to',
      '\'_process\' vs \'_physics_process\'. Put \'move_and_slide()\' and physics in \'_physics_process(delta)\'; using \'_process\' makes motion frame-rate',
      '\'class_name\' must be unique project-wide and is required to use the type name in other scripts or as an Inspector',
    ]
  },

  {
    id: 'godot-physics',
    title: 'Godot: физика',
    titleEn: 'Godot: physics',
    category: 'three-d',
    summary: 'Типы тел, слои коллизий, рейкасты, Jolt в 3D',
    summaryEn: 'Типы тел, слои коллизий, рейкасты, Jolt в 3D',
    triggers: [
      'godot',
      'физика',
      'physics',
      'jolt',
      'collision',
      'коллиз',
      'raycast',
      'reigcast',
      'тело'
    ],
    rules: [
      'Use when choosing between body types, setting collision layers/masks so the right things collide, detecting overlaps (triggers, hurtboxes) with \'Area\', applying forces/impulses to a \'RigidBody\', or casting rays for',
      'For 3D, check which engine runs before debugging behavior: Project Settings > Physics > 3D > Physics Engine (\'[physics]\' \'3d/physics_engine="Jolt Physics"\' in \'project.godot\'). Projects created in 4.6+ get Jolt written there by',
      '\'StaticBody\' — never moves (floors, walls). Collides, no',
      '\'RigidBody\' — fully simulated (gravity, forces, bouncing). Don\'t set its \'position\' directly; apply forces/impulses or set',
      '\'CharacterBody\' — script-driven kinematic (see',
      '\'Area\' — detects overlaps and can apply gravity/damping; no solid collision. Every body needs a \'CollisionShape\' (or \'CollisionPolygon\')',
      'Configure layers and masks. A body is *on* its layers and *scans for* its masks. Two bodies interact only if one\'s layer is in the other\'s mask. Name layers in Project Settings > Layer Names for',
      'Detect overlaps with \'Area\' signals (\'body_entered\',',
      'Drive RigidBodies with forces/impulses, or override \'_integrate_forces\' for full',
      'Cast rays with a \'RayCast2D/3D\' node (polled each frame) or a one-shot space-state query from',
      'Layer vs mask confusion is the #1 bug. Layer = "what I am"; mask = "what I look for". For A to detect B, B\'s layer must be in A\'s mask. Detection can be',
      'Moving a RigidBody by \'position\' fights the solver and causes tunneling/jitter. Use impulses/forces, set \'linear_velocity\', or \'freeze\' it. To teleport, set position and zero the velocities inside',
      '\'Area\' doesn\'t fire when neither monitoring nor monitorable is set, or layers/masks don\'t overlap. \'monitoring\' must be on for the Area to detect; \'monitorable\' lets others detect',
      'RayCast2D/3D read stale or no data if \'enabled\' is false, or if you read it before physics updated — read in \'_physics_process\', and call \'force_raycast_update()\' after moving it within the same',
    ]
  },

  {
    id: 'godot-3d-essentials',
    title: 'Godot: 3D-основы',
    titleEn: 'Godot: 3D essentials',
    category: 'three-d',
    summary: 'Ноды, трансформации, окружение и свет в 3D',
    summaryEn: 'Ноды, трансформации, окружение и свет в 3D',
    triggers: [
      'godot',
      '3d',
      'сцена 3d',
      'свет godot',
      'environment'
    ],
    rules: [
      'Use when starting or fixing a 3D scene: positioning a \'Camera3D\', adding lights, setting up a \'WorldEnvironment\' (sky, ambient, tonemap, glow/SSAO), assigning materials, or building levels with',
      'Everything 3D is a \'Node3D\' with a \'Transform3D\' (position, rotation basis, scale). Move with \'global_position\', rotate with \'rotate_y(angle)\' or',
      'Add a \'Camera3D\'. Mark it \'current\' (or call \'make_current()\'); set \'fov\', \'near\', \'far\'. Parent it to a rig/pivot for orbit or follow',
      'Light the scene. A \'DirectionalLight3D\' is the sun; \'OmniLight3D\'/\'SpotLight3D\' are local; \'AreaLight3D\' (4.7+) is a rectangular panel light that costs more than omni/spot. Enable shadows per light. Without lights and ambient,',
      'Add a \'WorldEnvironment\' with an \'Environment\' resource: background (sky/color), ambient light, tonemap, and post (glow, SSAO, fog,',
      'Give meshes materials (\'StandardMaterial3D\' or a \'ShaderMaterial\') on',
      'Block out levels with \'GridMap\', which places \'MeshLibrary\' items on a 3D grid (the 3D analog of a',
      'Scene renders black → no lights and no ambient. Add a \'DirectionalLight3D\' and/or a \'WorldEnvironment\' with ambient/sky. New scenes have neither by',
      'No camera / wrong camera. If nothing shows, no \'Camera3D\' is \'current\'. Set \'current = true\' or \'make_current()\'; only one camera renders per',
      'Confusing local vs global transforms. \'position\'/\'rotation\' are relative to the parent; \'global_position\'/\'global_transform\' are world space. Mixing them under a rotated parent gives surprising results. \'look_at\' uses global',
      'Scaling physics/lights. Non-uniform \'scale\' on a \'Node3D\' distorts child collisions and lights; prefer scaling the mesh asset or using uniform',
      '\'look_at\' does nothing and prints an error → the target equals the node\'s position, the \'up\' vector is parallel to the look direction (e.g. looking straight down with \'Vector3.UP\'), or the node is not in the tree yet. Keep an',
      'GridMap with no \'MeshLibrary\' places nothing. Create a \'MeshLibrary\' (from scenes) and assign it; \'set_cell_item(cell, -1)\' clears a',
      'HDR/glow too strong → check \'tonemap_mode\' and glow thresholds; raw emissive values bloom hard under filmic',
    ]
  },

  {
    id: 'godot-nodes-scenes',
    title: 'Godot: ноды и сцены',
    titleEn: 'Godot: nodes and scenes',
    category: 'three-d',
    summary: 'Дерево, инстансинг PackedScene, композиция сцен',
    summaryEn: 'Дерево, инстансинг PackedScene, композиция сцен',
    triggers: [
      'godot',
      'нода',
      'node',
      'сцена',
      'scene',
      'instancing',
      'packedscene'
    ],
    rules: [
      'Use when structuring \'.tscn\' scenes, choosing how to break a feature into nodes, instancing a \'PackedScene\' (bullets, enemies, UI), or setting up autoload',
      'Use when debugging \'get_node()\' / \'$Path\' returning \'null\', or "Attempt to call on a previously freed',
      'Model with composition. A scene is a tree of nodes saved as \'.tscn\'. Build small, single-purpose scenes (Player, Bullet, Enemy) and compose larger scenes from them. Favor adding child nodes over deep',
      'Make a scene reusable by giving its root a script and exposing \'@export\' config. Save it; it becomes a \'PackedScene\' you can instance many',
      'Instance at runtime with \'preload\'/\'load\' → \'scene.instantiate()\' → \'add_child(instance)\'. Set position/state _after_ adding (or before, both',
      'Access nodes safely. Use \'@onready var x = $Path\' for fixed children; use unique names (\'%Name\') for nodes deep in the tree; never assume a node still',
      'Use autoloads for global state/services (game state, audio, scene switching) — registered in Project Settings > Globals (Autoload), accessible by name',
      'Free nodes with \'queue_free()\' and guard later access with',
      'Check references before you finish. After creating, moving or renaming scenes, resources or scripts, run \'python scripts/check_godot_project.py <project-dir>\' (no Godot install needed; \'--json\' for machine-readable output). Fix',
      '\'$Path\' / \'get_node()\' return \'null\' or error when the path is wrong or the node isn\'t in the tree yet. Use \'@onready\', verify the path matches the scene, or use \'get_node_or_null()\' for optional',
      'Renaming a node breaks \'$Path\'. Use unique names (\'%Name\', set via right-click > Access as Unique Name) so deep references survive renames and',
      '\'free()\' mid-frame can crash other code still using the node. Prefer \'queue_free()\' (deletes at end of frame) and check',
      'Setting child state before \'add_child()\' is fine, but \'_ready()\' on the child only runs _after_ it enters the tree — don\'t expect its \'@onready\' vars before',
      'Autoload order matters: autoloads are added before the main scene, in list order. An autoload can\'t depend on the main scene existing',
    ]
  },

  {
    id: 'godot-animation',
    title: 'Godot: анимация',
    titleEn: 'Godot: animation',
    category: 'three-d',
    summary: 'AnimationPlayer, Tween, таймлайны и game feel',
    summaryEn: 'AnimationPlayer, Tween, таймлайны и game feel',
    triggers: [
      'godot',
      'анимац',
      'animation',
      'tween',
      'animationplayer'
    ],
    rules: [
      'Use when playing keyframed animations, blending walk/run/idle states, animating a sprite sheet, or tweening UI/objects in',
      '\'AnimationPlayer\' — author keyframed clips (transforms, properties, method calls, audio, even other animations). The source of truth for clip',
      '\'AnimationTree\' — blend and transition between those clips at runtime with a state machine and/or blend spaces. Needs an \'AnimationPlayer\' to pull clips',
      '\'Tween\' — fire-and-forget procedural interpolation in code (\'create_tween()\'); ideal for UI pops, fades, and one-off',
      'For 2D sprite sheets: use \'AnimatedSprite2D\' + \'SpriteFrames\', or keyframe the \'frame\' property in an',
      'For characters: build clips in \'AnimationPlayer\', then add an \'AnimationTree\' (\'active = true\'), set its \'anim_player\', and design an \'AnimationNodeStateMachine\' or \'AnimationNodeBlendSpace2D\' as the tree',
      'Drive transitions from code via the playback object (\'travel\') or by setting blend',
      'React to clip events with the \'animation_finished\' signal and Call Method',
      '\'AnimationTree.active\' left false → nothing animates and \'travel()\' appears to do nothing. Set \'active = true\' and assign the \'anim_player\'',
      'Wrong parameter path. Blend/condition paths are \'"parameters/<NodeName>/..."\' and must match the node names in the tree exactly (e.g. \'"parameters/playback"\', \'"parameters/Move/blend_position"\'). A typo silently',
      'AnimationPlayer and AnimationTree fighting. When an \'AnimationTree\' is active, don\'t also call \'AnimationPlayer.play()\' for the same tracks — let the tree own',
      '3.x Tween node is gone. There is no \'Tween\' node to add in 4.x; create tweens in code with \'create_tween()\' (which returns a \'Tween\'). They auto-start and free',
      'Tween stalls when its node leaves the tree. \'node.create_tween()\' pauses while that node is outside the tree and dies when it is freed. Use \'get_tree().create_tween()\' for a tween that must keep running while the node is out of',
      'Scale/rotation tween on a child of a \'Container\' snaps back → the container resets child transforms whenever it re-sorts. In 4.7+ set \'offset_transform_enabled = true\' and tween \'offset_transform_scale\' /',
    ]
  },

  {
    id: 'godot-audio',
    title: 'Godot: звук',
    titleEn: 'Godot: audio',
    category: 'three-d',
    summary: 'Шины, AudioStreamPlayer, позиционирование и баланс',
    summaryEn: 'Шины, AudioStreamPlayer, позиционирование и баланс',
    triggers: [
      'godot',
      'звук',
      'audio',
      'sfx',
      'аудио'
    ],
    rules: [
      'Use when playing sound effects or music, routing audio to buses (Master/Music/SFX), adjusting volume/mute from code, adding bus effects (reverb, compressor), positional 3D audio, or syncing events to',
      '\'AudioStreamPlayer\' — non-positional (music, UI, global',
      '\'AudioStreamPlayer2D\' / \'AudioStreamPlayer3D\' — positional; volume/pan from',
      'Assign an \'AudioStream\' to \'stream\' (\'.ogg\' for music/loops, \'.wav\' for short SFX) and \'play()\'. Set \'autoplay\' for music that starts with the',
      'Route to a bus. Set the player\'s \'bus\' to a named bus (e.g. \'"Music"\', \'"SFX"\'). Define buses in the Audio panel (bottom dock); each can have volume, mute, solo, and',
      'Control volume in dB, not linear (audio is logarithmic). \'0 dB\' = unchanged, \'-80 dB\' ≈ silent. Convert with \'linear_to_db\'/\'db_to_linear\', or use the linear helpers (\'volume_linear\' on players,',
      'Drive volume/mute from code with \'AudioServer\' by bus',
      'For rhythm, compute precise playback time using output latency',
      'Treating volume as linear. \'volume_db\'/\'set_bus_volume_db\' are decibels. Setting \'volume_db = 0.5\' is nearly full volume, not half. Map sliders with',
      '\'linear_to_db(0.0)\' is \'-inf\'. It is silent, but tweening or doing math from \'-inf\' produces NaN. Clamp the linear value to a small minimum (e.g. \'0.0001\') before converting, or special-case 0 → mute. \'set_bus_volume_linear(bus,',
      'Bus name typos fail quietly. \'get_bus_index("Muisc")\' returns \'-1\'; calls then error or no-op. Match the exact bus name from the Audio',
      'Short SFX cut off when the same player is retriggered → \'max_polyphony\' defaults to 1. Raise it (e.g. 4) so \'play()\' overlaps copies, or use an \'AudioStreamPolyphonic\' / separate players freed on',
      'Music doesn\'t loop unless the import/stream loop is enabled (\'.ogg\' import has a Loop option; \'AudioStreamWAV\' has',
      'Syncing to \'get_playback_position()\' alone is jittery — it updates per audio mix, not per frame; add \'get_time_since_last_mix()\' and subtract',
    ]
  },

  {
    id: 'godot-resources',
    title: 'Godot: ресурсы',
    titleEn: 'Godot: resources',
    category: 'three-d',
    summary: 'Resource-паттерны: данные, инвентари, настройки башен',
    summaryEn: 'Resource-паттерны: данные, инвентари, настройки башен',
    triggers: [
      'godot',
      'ресурс',
      'resource',
      'custom resource',
      'данные башен'
    ],
    rules: [
      'Use when representing items, stats, enemy configs, dialogue lines, or level metadata as data; authoring \'.tres\' files in the Inspector; or loading/saving custom',
      'Subclass \'Resource\' with \'class_name\' and \'@export\' fields. It now appears in the "New Resource" dialog and as an \'@export\' type, editable in the',
      'Create instances as \'.tres\' files in the FileSystem dock (text, diff-friendly) or \'.res\' (binary, smaller/faster). Edit their fields in the Inspector — no code',
      'Reference resources from nodes via \'@export var data: ItemResource\', or arrays \'@export var loot:',
      'Load at runtime with \'preload\' (constant path) or \'load\'/\'ResourceLoader.load\' (variable path). Use threaded loading for large',
      'Duplicate before mutating a shared resource at runtime, or every node using it changes too (resources are shared',
      'Save generated/edited resources with',
      'Resources are shared by reference. A single \'.tres\' assigned to many nodes is the *same* object — mutating it changes all of them (and re-saving the file). Call \'duplicate(true)\' for per-instance',
      'A deep copy still changes the original\'s sub-resource → \'duplicate(true)\' only copies sub-resources embedded in the file; one saved as its own \'.tres\' (e.g. a shared \'stats.tres\' inside \'goblin.tres\') is still the same object.',
      '\'class_name\' required to instance from the editor. Without it the class won\'t appear in the "New Resource" dialog or as an \'@export\'',
      '\'res://\' is read-only in exported games. Write runtime data to \'user://\', never \'res://\'. \'ResourceSaver.save\' to \'res://\' only works in the',
      'Storing nodes in a Resource doesn\'t serialize them. Resources hold data, not live scene nodes. Reference scenes via \'PackedScene\', not node',
      'Cyclic resource references (A holds B holds A) can fail to save/load cleanly — keep data graphs acyclic or use',
      '\'preload\' vs \'load\'. \'preload\' needs a constant path and loads with the script; \'load\' accepts a variable path at runtime. Use \'ResourceLoader.exists()\' before \'load\' to avoid errors on missing',
    ]
  },

  {
    id: 'godot-gdscript-headless-testing',
    title: 'Godot: headless-тесты',
    titleEn: 'Godot: headless testing',
    category: 'three-d',
    summary: 'Прогон и проверка проекта без открытия редактора',
    summaryEn: 'Прогон и проверка проекта без открытия редактора',
    triggers: [
      'godot',
      'headless',
      'тест godot',
      'проверка проекта',
      'ci'
    ],
    rules: [
      'Use when a Godot project has no testing addon installed and needs a fast way to verify GDScript logic (pure functions, resource loading, autoload state) from a terminal or CI',
      'Use when wiring a CI job that must fail the build when a \'.gd\' test',
      'Use when debugging why a \'godot --headless\' invocation hangs, opens a window, or exits 0 despite failing',
      'Confirm the binary resolves headless. Godot 4.x ships \'--headless\' built in (no export template needed); run \'godot --headless --version\' and confirm it prints a version string, not a GUI',
      'On a fresh checkout, import before running tests. \'.godot/\' is normally not committed, so a clean checkout has no import cache: \'class_name\' types fail to resolve (\'Identifier "X" not declared in the current scope\') and imported',
      'Write the runner as a \'SceneTree\' script, not a \'Node\' scene. A \'SceneTree\' script\'s \'_initialize()\' runs once before any frame — enough for pure-logic tests and no \'.tscn\' required to',
      'Track pass/fail counts yourself and call \'quit(<code>)\' explicitly. Do not use bare \'assert()\' to fail a test. Godot does not turn the process exit code non-zero on \'push_error()\' by itself — the runner must count failures and',
      'Invoke with \'godot --headless --path <project_dir> --script res://<runner>.gd\' and read the process exit code, not just stdout, from the shell or CI step. \'--script\' accepts both a \'res://\'-relative path and an absolute',
      'Redirect stdout and stderr to files when scripting the invocation from a wrapper shell (PowerShell, some CI runners). \'push_error()\' output goes to stderr and can be dropped or reordered when only stdout is captured',
      'Add a step timeout in CI. Even with the \'assert()\' pitfall avoided, an \'await\' that never resolves (Pattern #2) hangs the runner forever; a \'timeout-minutes\' on the CI step is a backstop CI-side, not a substitute for backing',
      'name: Import project (populates .godot/ on a fresh checkout) run: godot --headless --path .',
      'name: Run GDScript tests timeout-minutes: 5 run: godot --headless --path . --script',
      'Script "does nothing" or opens the editor window → missing \'--headless\', or the script path is wrong. \'--script\' accepts a \'res://\'-relative path resolved against \'--path <project_dir>\', and also an absolute filesystem path —',
      '\'Identifier "X" not declared in the current scope\', or a resource fails to load, only on a fresh checkout → \'.godot/\' (the import cache) is normally not committed, so \'class_name\' types and imported assets aren\'t resolved yet.',
    ]
  },

  {
    id: 'godot-export',
    title: 'Godot: экспорт',
    titleEn: 'Godot: export',
    category: 'three-d',
    summary: 'Пресеты экспорта и сборка из командной строки',
    summaryEn: 'Пресеты экспорта и сборка из командной строки',
    triggers: [
      'godot',
      'экспорт',
      'export',
      'сборка игры',
      'build game'
    ],
    rules: [
      'Use when producing a shippable build: installing export templates, creating/editing export presets, exporting from the editor or headless CLI (CI), or troubleshooting web (HTML5) and dedicated-server',
      'Install export templates matching your engine version: Editor menu > *Manage Export Templates* (download), or install the \'.tpz\' offline. Versions must match the editor exactly. Since 4.7 the downloader can fetch templates for a',
      'Add export presets in *Project > Export*: pick a platform (Windows Desktop, macOS, Linux, Web, Android, iOS), set the export path, icons, features, and resource include/exclude filters. Presets are saved to',
      'Export from the editor with *Export Project* (release) or *Export',
      'Or export headless from the CLI for automation/CI using \'--export-release "<preset name>" <output',
      'Per platform: Web needs cross-origin isolation (COOP/COEP) only if the preset\'s *Thread Support* is on (off by default); Android needs the SDK/keystore; macOS/iOS need signing for',
      'Smoke-test the build on the target before shipping — exported builds use \'res://\' read-only; write to',
      '"No export template found". Templates must match the exact editor version (incl. beta/rc). Re-download via *Manage Export Templates* after upgrading',
      'Preset name mismatch in CLI. \'--export-release "Windows"\' fails if the preset is named \'"Windows Desktop"\'. Names are case- and space-sensitive; quote',
      'Web build shows a blank page / threads error. Builds with the preset\'s *Thread Support* option enabled require the server to send \'Cross-Origin-Opener-Policy: same-origin\' and \'Cross-Origin-Embedder-Policy: require-corp\'',
      'Writing to \'res://\' at runtime fails in exports (read-only, packed). Use',
      'Missing resources in the build. Non-resource files (e.g. external \'.json\', \'.txt\') are not auto-included — add them via the preset\'s *Resources > Filters to export non-resource files* (e.g.',
      'Android export needs setup: Android SDK/JDK paths in Editor Settings, a debug or release keystore, and the \'INTERNET\' permission for networked',
      'macOS/iOS distribution requires signing/notarization; unsigned macOS apps are blocked by',
    ]
  },

  {
    id: 'godot-2d-movement',
    title: 'Godot: 2D-движение',
    titleEn: 'Godot: 2D movement',
    category: 'three-d',
    summary: 'Контроллеры персонажей и движение в 2D',
    summaryEn: 'Контроллеры персонажей и движение в 2D',
    triggers: [
      'godot',
      '2d',
      'движение',
      'movement',
      'platformer',
      'платформер'
    ],
    rules: [
      'Use when scripting a 2D player/enemy that moves and collides: platformer (gravity + jump) or top-down (free 8-direction), slope walking, or wall/floor',
      'Use when \'move_and_slide()\' "does nothing", the character sinks through floors, or \'is_on_floor()\' is always',
      'Use \'CharacterBody2D\' with a \'CollisionShape2D\' child. It is script-driven: it does not fall or react to forces on its',
      'Set the \'velocity\' property, then call \'move_and_slide()\' (no arguments in 4.x). The method reads \'velocity\', moves the body, slides along surfaces, and updates \'velocity\' to reflect what actually',
      'Do it in \'_physics_process(delta)\' — \'move_and_slide()\' uses the physics step\'s delta internally, so do not multiply \'velocity\' by \'delta\'',
      'Platformer: add gravity to \'velocity.y\' each tick, jump by setting \'velocity.y\' negative when',
      'Top-down: build a direction from input and scale by speed; set \'motion_mode = MOTION_MODE_FLOATING\' so there is no "floor/wall"',
      'Read results with \'is_on_floor()\', \'is_on_wall()\', \'get_wall_normal()\', and \'get_slide_collision(i)\' after the',
      '3.x signature is gone. \'move_and_slide(velocity)\' (returning the new velocity) was removed. In 4.x set the \'velocity\' property and call \'move_and_slide()\' with no args. \'move_and_slide(velocity, Vector2.UP)\' will not',
      'Multiplying velocity by delta. \'move_and_slide()\' already accounts for the physics delta. Setting \'velocity = dir * speed * delta\' makes the body',
      'Movement in \'_process\' instead of \'_physics_process\' causes frame-rate-dependent, jittery motion. Always move in',
      '\'is_on_floor()\' always false when \'up_direction\' is wrong (default \'Vector2.UP\'), there is no \'CollisionShape2D\', or you never called \'move_and_slide()\' this',
      'Sinking through floors usually means the collision shape is missing/zero-sized, the floor body is on a layer this body\'s mask doesn\'t include, or you moved the body via \'position +=\' instead of velocity +',
      'Slope slipping while idle: keep \'floor_stop_on_slope = true\' (default) and raise \'floor_snap_length\' (default 1 px) so the body sticks to downward',
    ]
  }
]

/** The skill with this id, or null when it is unknown (old chats, renamed skills). */
export function skillById(id: string): Skill | null {
  return SKILLS.find((skill) => skill.id === id) ?? null
}

/* ------------------------------- user settings ------------------------------ */

/** A skill whose rules the user rewrote. The list replaces the built-in text. */
export interface SkillOverride {
  id: string
  rules: string[]
}

export interface SkillsSettings {
  /** Master switch: off means the agent never picks a skill. */
  enabled: boolean
  /** Skills the user turned off; they never get picked and never reach the prompt. */
  disabled: string[]
  overrides: SkillOverride[]
}

export const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
  enabled: true,
  disabled: [],
  overrides: []
}

/** The catalog as the user configured it: disabled skills gone, edits applied. */
export function effectiveSkills(settings: SkillsSettings | undefined): Skill[] {
  const config = settings ?? DEFAULT_SKILLS_SETTINGS
  const disabled = new Set(config.disabled)
  const overrides = new Map(
    config.overrides.map((override) => [
      override.id,
      override.rules.filter((rule) => rule.trim().length > 0)
    ])
  )
  return SKILLS.filter((skill) => !disabled.has(skill.id)).map((skill) => {
    const rules = overrides.get(skill.id)
    return rules && rules.length > 0 ? { ...skill, rules } : skill
  })
}
