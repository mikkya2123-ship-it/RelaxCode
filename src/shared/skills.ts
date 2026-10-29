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
