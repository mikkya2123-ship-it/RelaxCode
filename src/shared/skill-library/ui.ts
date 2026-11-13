import type { Skill } from '../skills.ts'

/**
 * Interface playbooks: the patterns that make an app feel built rather than
 * assembled — command palettes, dense tables, real dialogs, empty screens.
 */
export const UI_SKILLS: Skill[] = [
  {
    id: 'ui-command-palette',
    title: 'Палитра команд',
    titleEn: 'Command palette',
    category: 'ui',
    summary: 'Ctrl/Cmd+K, поиск по действиям, клавиатура без мыши',
    summaryEn: 'Ctrl/Cmd+K, actions search, keyboard without a mouse',
    triggers: [
      'палитра команд',
      'палитру команд',
      'палитры команд',
      'command palette',
      'cmd+k',
      'ctrl+k',
      'quick actions',
      'быстрые действия'
    ],
    rules: [
      'Open with Ctrl/Cmd+K, close on Escape, and restore focus to the previous element.',
      'List actions as verb plus object ("Создать проект", "Открыть настройки"), never as nouns.',
      'Group results (navigation, actions, recent) with headings and keep groups in a fixed order.',
      'Filter by fuzzy match on the label, the id and the shortcut, and highlight matched characters.',
      'Arrow keys move, Enter runs, Tab completes the highlighted query, and the highlight is always visible.',
      'Show the shortcut on the right of each row; rows without one are still clickable.',
      'Disable actions that cannot run now and say why in a muted line instead of hiding them.',
      'Cap the list at about 50 rows and virtualize beyond that.',
      'Recent and frequently used items rank first, but never move while the user is reading the list.',
      'Empty query shows recents; no matches shows the query plus a hint, not a blank panel.'
    ]
  },
  {
    id: 'ui-navigation',
    title: 'Навигация приложения',
    titleEn: 'App navigation',
    category: 'ui',
    summary: 'Боковое меню, вкладки и хлебные крошки без дублей',
    summaryEn: 'Sidebar, tabs and breadcrumbs without duplication',
    triggers: ['боковое меню', 'sidebar nav', 'app navigation', 'вкладки', 'breadcrumbs', 'хлебные крошки'],
    rules: [
      'One primary navigation pattern per product area; never a sidebar and a top tab bar competing.',
      'Sidebar items are icon plus label; collapsed mode keeps tooltips and keyboard access.',
      'Persist collapsed or expanded state per user, and remember the last visited page.',
      'Tabs are for sibling views of one object; pages are links, tabs are not.',
      'Breadcrumbs appear only when there are three or more levels, and the current page is not a link.',
      'Mark the active route with weight plus an indicator, and keep the marker visible in dark mode.',
      'Navigation never shifts layout when a badge count changes — reserve its width.',
      'Deep links land on the same state: copy the URL, open it in a new window, see the same view.',
      'On narrow widths the sidebar becomes a drawer that closes on navigation.'
    ]
  },
  {
    id: 'ui-modals',
    title: 'Диалоги и подтверждения',
    titleEn: 'Dialogs and confirmations',
    category: 'ui',
    summary: 'Одна задача, ловушка фокуса, честная кнопка отмены',
    summaryEn: 'One task, focus trap, an honest cancel button',
    triggers: ['модалк', 'modal', 'диалог', 'dialog', 'подтвержден', 'confirm dialog', 'popup'],
    rules: [
      'A dialog does one task and fits the viewport without scrolling on a 1280x720 screen.',
      'Title names the action, the body explains the consequence, the footer holds at most two buttons.',
      'Primary action on the right, cancel on the left; Escape and the overlay close it unless data would be lost.',
      'Focus moves into the dialog on open, stays trapped while open, and returns to the trigger on close.',
      'Destructive confirmation repeats the object name and uses a red button with a verb ("Удалить проект").',
      'Never stack dialogs; a second question becomes a step inside the first.',
      'Do not close on submit before the request resolves — show a busy state on the button instead.',
      'Widths: 400px for confirmations, 560px for short forms, 720px for content — not full-screen on desktop.',
      'On mobile dialogs become bottom sheets with a visible handle and a safe-area inset.'
    ]
  },
  {
    id: 'ui-notifications',
    title: 'Уведомления и тосты',
    titleEn: 'Notifications and toasts',
    category: 'ui',
    summary: 'Тост для подтверждения, инлайн для решений, тишина для шума',
    summaryEn: 'Toasts confirm, inline handles decisions, silence for noise',
    triggers: ['уведомлен', 'toast', 'notification', 'снекбар', 'snackbar', 'алерт'],
    rules: [
      'Toasts confirm what the user just did and disappear in 4-6 seconds; actions live inline.',
      'Errors that need a decision are inline next to the control, never only a toast.',
      'Stack at most three toasts, newest on top, and never cover the primary action or the input.',
      'Every toast has a close button and the container is aria-live polite, assertive for errors.',
      'A notification centre groups by day and marks read state; badge counts match the unread number exactly.',
      'Do not notify about things the user cannot act on (background success, telemetry, marketing).',
      'Same message never repeats twice for the same event; deduplicate by id.',
      'Respect the system preference: a settings switch per category, not one global mute.',
      'In-app notifications and email stay in sync — read in one place, gone in the other.'
    ]
  },
  {
    id: 'ui-tables',
    title: 'Таблицы данных',
    titleEn: 'Data tables',
    category: 'ui',
    summary: 'Плотные строки, липкая шапка, цифры вправо, действия по наведению',
    summaryEn: 'Dense rows, sticky header, right-aligned numbers, hover actions',
    triggers: ['таблиц', 'data table', 'таблица данных', 'grid table', 'список записей'],
    rules: [
      'Row height 40-44px, cells aligned to an 8px grid, and a hairline divider or zebra — never both.',
      'The header stays visible while scrolling and states the sort column with an arrow.',
      'Numbers are right-aligned with tabular figures and carry units; text is left-aligned; never centre data.',
      'Row actions appear on hover and on focus; on touch they are always visible as a menu.',
      'Selection: a header checkbox for all visible rows, a bar showing the count, and bulk actions only on the bar.',
      'Column widths stay stable between pages and sorts — set min widths and truncate with a title.',
      'Sorting, filtering and pagination state live in the URL so a view can be shared.',
      'Loading shows skeleton rows with the real column count; empty shows what to do next; error offers retry.',
      'Keyboard: arrows move between cells, Enter opens the row, Space selects it.'
    ]
  },
  {
    id: 'ui-filters',
    title: 'Фильтры и сортировка',
    titleEn: 'Filters and sorting',
    category: 'ui',
    summary: 'Видимые активные фильтры, сброс одним кликом, счётчик результатов',
    summaryEn: 'Visible active filters, one-click reset, a result count',
    triggers: ['фильтр', 'filter panel', 'сортировк', 'sort control', 'facets'],
    rules: [
      'Active filters are always visible as removable chips above the list, with a "сбросить всё" action.',
      'Show the result count next to the filters and update it as the user changes them.',
      'Filters apply immediately for lists under 500 items; use an explicit apply button only for heavy queries.',
      'Group filters by meaning (status, owner, date) and keep the group order stable.',
      'Zero results keeps the filters visible and explains which one to relax, with a one-click fix.',
      'Date ranges offer presets (today, 7 дней, 30 дней, произвольный) and show the resolved dates.',
      'Sort control states the current order in words, not only an arrow.',
      'Preserve filters in the URL and restore them on back navigation.',
      'On mobile filters open in a sheet with the count of active ones on the trigger.'
    ]
  },
  {
    id: 'ui-pagination',
    title: 'Пагинация и списки',
    titleEn: 'Pagination and lists',
    category: 'ui',
    summary: 'Явные границы, сохранение позиции, никакой бесконечной прокрутки вслепую',
    summaryEn: 'Explicit bounds, preserved position, no blind infinite scroll',
    triggers: ['пагинац', 'pagination', 'постранично', 'load more', 'бесконечная прокрутк', 'infinite scroll'],
    rules: [
      'Always show the bounds: "1-50 из 2 340" — a page number alone tells nothing.',
      'Prefer numbered pages for referenceable data, and load-more for feeds where position does not matter.',
      'Infinite scroll must also provide a linkable page or a "показать ещё" fallback and a footer that can be reached.',
      'Keep the scroll position when the user opens an item and comes back.',
      'Changing page size or filters resets to the first page, invisibly and instantly.',
      'Disable the previous/next controls at the edges instead of hiding them.',
      'Page size options are concrete (25, 50, 100) and the choice persists.',
      'New items arriving while the user reads never insert above the viewport.',
      'On mobile the controls collapse to previous, page indicator, next.'
    ]
  },
  {
    id: 'ui-search',
    title: 'Поиск в интерфейсе',
    titleEn: 'In-app search',
    category: 'ui',
    summary: 'Дебаунс, отмена устаревших запросов, понятная пустота',
    summaryEn: 'Debounce, cancel stale requests, a real empty state',
    triggers: ['поиск', 'search field', 'search input', 'поиск по приложению', 'autocomplete'],
    rules: [
      'Search input has a visible label or a persistent icon plus placeholder example, and a clear button.',
      'Debounce 250-300ms, cancel the previous request, and ignore late responses for older queries.',
      'Show a spinner inside the field after 250ms, not a full-page loader.',
      'Group suggestions by type and cap each group at five rows.',
      'Highlight the matched fragment inside each result.',
      'No results: repeat the query, offer spelling or a broader filter, and never show a blank panel.',
      'Keyboard: arrows move, Enter opens, Escape clears or closes, and Cmd/Ctrl+K focuses the field.',
      'Keep the query in the URL for list searches so a shared link reproduces it.',
      'Never search on every keystroke for remote data without debounce and abort.'
    ]
  },
  {
    id: 'ui-keyboard',
    title: 'Клавиатура и горячие клавиши',
    titleEn: 'Keyboard and shortcuts',
    category: 'ui',
    summary: 'Все действия достижимы, конфликты видны, шпаргалка внутри',
    summaryEn: 'Everything reachable, conflicts visible, a cheatsheet inside',
    triggers: ['горячие клавиш', 'keyboard shortcut', 'hotkeys', 'клавиатур навигац', 'shortcut map'],
    rules: [
      'Every mouse action has a keyboard path; nothing is drag-only or hover-only.',
      'One modifier convention (Cmd on macOS, Ctrl elsewhere) and never both in one row.',
      'Never shadow a browser or system shortcut; the app list wins only inside a focused editor.',
      'Show shortcuts in menus, tooltips and the palette, formatted per platform.',
      'Provide a searchable shortcut sheet and a way to disable app-wide hotkeys.',
      'Focus order follows the visual order; a visible focus ring of at least 2px with 2px offset.',
      'Escape always closes the topmost layer, one layer at a time.',
      'Shortcut handlers ignore keystrokes typed inside inputs unless the shortcut uses a modifier.',
      'Document rebinding rules if shortcuts are configurable, and detect conflicts before saving.'
    ]
  },
  {
    id: 'ui-drag-drop',
    title: 'Drag and drop',
    titleEn: 'Drag and drop',
    category: 'ui',
    summary: 'Видимые зоны, живой предпросмотр, клавиатурный эквивалент',
    summaryEn: 'Visible targets, live preview, a keyboard equivalent',
    triggers: ['drag and drop', 'dragdrop', 'перетаскиван', 'drag', 'сортировк перетаскиванием'],
    rules: [
      'Draggable items show a grab affordance and a dragging state with elevation and reduced opacity.',
      'Drop targets highlight on hover and show where the item will land (a line or a placeholder).',
      'Never reorder under the cursor without a placeholder — the layout must not jump.',
      'Autoscroll near container edges while dragging, with speed proportional to the distance.',
      'Cancel on Escape and on drop outside; the item returns with a short transition.',
      'Provide buttons or keyboard commands (move up/down, move to) for every drag action.',
      'Show the effect before committing for destructive drops ("переместить в Архив").',
      'On touch use long-press to start and keep the item under the finger without offset jumping.',
      'Persist the new order immediately and reconcile if the server rejects it.'
    ]
  },
  {
    id: 'ui-dark-mode',
    title: 'Тёмная тема',
    titleEn: 'Dark mode',
    category: 'ui',
    summary: 'Поверхности выше, акцент тише, границы видны',
    summaryEn: 'Raised surfaces, quieter accent, visible borders',
    triggers: ['тёмная тема', 'dark theme', 'dark mode ui', 'ночной режим'],
    rules: [
      'Dark mode is a designed token set, not an inverted filter: define surfaces, borders and text separately.',
      'Never pure black backgrounds with pure white text; use near-black surfaces and 88-92% white text.',
      'Raise elevation with lighter surfaces instead of heavier shadows — shadows barely read on dark.',
      'Desaturate the accent by 10-20% and check its contrast against every surface it appears on.',
      'Keep borders visible: 1px at 8-12% white, more for focused or selected states.',
      'Follow the system preference by default and offer light, dark and system toggles.',
      'Images, charts and screenshots need per-theme variants or a light frame; no inverted photos.',
      'Test the theme with real data: charts, code blocks, badges and destructive states.',
      'Avoid a flash of the wrong theme: resolve the theme before first paint.',
      'Semantic colours (danger, success) stay in the same hue family but shift lightness for contrast.'
    ]
  },
  {
    id: 'ui-layout-shell',
    title: 'Каркас приложения',
    titleEn: 'App shell layout',
    category: 'ui',
    summary: 'Один каркас: навигация, рабочая область, панели и их размеры',
    summaryEn: 'One shell: navigation, workspace, panels and their sizes',
    triggers: ['каркас прилож', 'app shell', 'layout shell', 'основной макет', 'рабочая область'],
    rules: [
      'One shell for the whole product: fixed navigation, scrollable workspace, optional right panel.',
      'Only the workspace scrolls; the shell keeps header and navigation stable.',
      'Panels are resizable with sensible min/max, and the width persists per user.',
      'At most one primary scroll container per pane; nested scrollbars are a bug.',
      'Breakpoints change the shell (sidebar to drawer, panel to overlay), not only the content width.',
      'Nothing overlaps on narrow widths: the shell stacks instead of shrinking controls to 24px.',
      'Keep a single source for spacing: header height, sidebar width, panel width as CSS variables.',
      'Loading the shell never blocks the workspace; skeleton the content only.',
      'Keyboard focus order follows the panes: navigation, workspace, panel.'
    ]
  },
  {
    id: 'ui-component-api',
    title: 'API компонентов',
    titleEn: 'Component API design',
    category: 'ui',
    summary: 'Варианты по смыслу, один способ сделать вещь, предсказуемые пропсы',
    summaryEn: 'Variants by intent, one way to do a thing, predictable props',
    triggers: ['api компонент', 'component api', 'props design', 'варианты компонент', 'react component api'],
    rules: [
      'Variants are named by intent (primary, secondary, ghost, danger), never by colour or size in the same prop.',
      'One way to express one thing: do not accept both className overrides and a style prop for the same visual.',
      'Props that change layout go in one place (size, density), props that change meaning in another (tone, status).',
      'Every interactive component exposes disabled, loading and focus-visible states explicitly.',
      'Composition over configuration: children and slots before a dozen boolean props.',
      'Defaults produce the most common case; callers only state the exception.',
      'Forward refs and native attributes for every element that wraps a DOM node.',
      'Document one usage example per variant and the do-not case.',
      'No component reads global state or theme internals directly — it receives tokens or context.',
      'Breaking prop changes ship with a deprecation path, not a silent rename.'
    ]
  },
  {
    id: 'ui-tooltips',
    title: 'Подсказки и подписи',
    titleEn: 'Tooltips and labels',
    category: 'ui',
    summary: 'Коротко, по фокусу тоже, и никогда не единственный источник смысла',
    summaryEn: 'Short, on focus too, never the only source of meaning',
    triggers: ['тултип', 'tooltip', 'подсказк', 'hint text', 'hover label'],
    rules: [
      'A tooltip appears on hover and on keyboard focus, after a 300-500ms delay, and hides on Escape.',
      'Text is one short sentence, no buttons, no interactive content inside.',
      'Never rely on a tooltip for essential information: give the control a visible label.',
      'Position to avoid covering the trigger and flip automatically near the viewport edge.',
      'Icon-only buttons always have an accessible name in addition to the tooltip.',
      'Do not animate the tooltip entrance beyond a 120ms fade; no bouncing.',
      'On touch, tooltips are not available — use a popover with a tap target instead.',
      'Hide the tooltip when the action is performed so it does not linger.',
      'Keep contrast at 4.5:1 and a background strong enough to read over any surface.'
    ]
  },
  {
    id: 'ui-loading-performance',
    title: 'Скорость восприятия',
    titleEn: 'Perceived performance',
    category: 'ui',
    summary: 'Скелетоны, оптимистичные обновления, никаких прыжков интерфейса',
    summaryEn: 'Skeletons, optimistic updates, no layout jumps',
    triggers: ['скелетон', 'skeleton loader', 'perceived performance', 'быстродейств интерфейс', 'загрузк данных'],
    rules: [
      'Skeletons mirror the real layout with the real row and column count, not a grey block.',
      'No spinner for work under 200ms; show one only after that delay.',
      'Optimistic updates for actions the server almost always accepts, with rollback and a message on failure.',
      'Reserve space for images, badges and counters so nothing shifts after load (width/height or aspect-ratio).',
      'Keep the button width stable while its label becomes a spinner.',
      'Disable only the affected control while saving, never the whole form.',
      'Stream or paginate large lists; never block the first paint on data that is below the fold.',
      'Prefetch on hover or on viewport entry for likely next navigations.',
      'With slow networks, show progress with bytes or steps, not an endless bar.'
    ]
  },
  {
    id: 'ui-design-review',
    title: 'Ревью интерфейса',
    titleEn: 'Interface review',
    category: 'ui',
    summary: 'Проверка по иерархии, сетке, состояниям и контрасту',
    summaryEn: 'A pass over hierarchy, grid, states and contrast',
    triggers: ['ревью интерфейс', 'design review', 'аудит дизайн', 'ui audit', 'проверь дизайн'],
    rules: [
      'First check the hierarchy: one focal point per screen, and the primary action is findable in two seconds.',
      'Check the spacing system: values come from one scale, gaps between groups are consistently larger than inside them.',
      'Check type: at most three heading sizes on a screen, no line under 45 or over 75 characters.',
      'Check contrast for body text, muted text, borders and disabled states separately.',
      'Check every state: default, hover, focus, active, disabled, loading, empty, error.',
      'Check the narrowest supported width and 200% zoom before judging the desktop layout.',
      'Check alignment: text left edges, card padding and icon baselines line up across sections.',
      'Check copy: verb-first buttons, sentence case, no placeholder text left behind.',
      'Report findings as a short list ordered by impact, each with the fix, not as a general impression.',
      'Do not suggest a redesign when a spacing, contrast or state fix solves the actual problem.'
    ]
  },
  {
    id: 'ui-data-entry',
    title: 'Ввод данных и мастера',
    titleEn: 'Data entry and wizards',
    category: 'ui',
    summary: 'Группы полей, умные значения по умолчанию, сохранение черновика',
    summaryEn: 'Field groups, smart defaults, draft saving',
    triggers: ['мастер', 'wizard', 'ввод данных', 'data entry', 'multi-step form', 'анкета'],
    rules: [
      'Group fields into blocks of 3-6 that belong together, each block with a short heading.',
      'Ask for the minimum; derive or prefill anything that can be computed or remembered.',
      'Show all requirements up front instead of revealing a new rule at submit.',
      'Validate on blur and on submit; keep the entered values on every failure.',
      'Autosave a draft and restore it after a reload, with a visible "черновик сохранён".',
      'Multi-step flows show step count, allow going back without data loss, and keep the primary button in one place.',
      'Inline hints explain tricky fields; never rely on placeholder as the only hint.',
      'Support keyboard-only entry: Tab order matches the visual order, Enter does not submit accidentally from a multiline field.',
      'Review step for anything irreversible, with a link back to each section.',
      'Success state confirms what was saved and what happens next.'
    ]
  },
  {
    id: 'ui-bulk-actions',
    title: 'Массовые действия',
    titleEn: 'Bulk actions',
    category: 'ui',
    summary: 'Выбор, счётчик, панель действий и точное подтверждение',
    summaryEn: 'Selection, count, an action bar, precise confirmation',
    triggers: ['массовы', 'bulk actions', 'выделен запис', 'batch actions', 'выбрать все'],
    rules: [
      'Selection shows a bar with the exact count and a way to clear it.',
      'The header checkbox selects the visible page and states that scope; a second click offers "выбрать все N".',
      'Bulk actions live only on the selection bar, never duplicated in each row.',
      'Destructive bulk actions state the number and the object type and ask to confirm.',
      'Run actions with progress and per-item results; partial failures are listed with retry.',
      'Keep the selection stable across pages only when the scope says so.',
      'Disable actions that do not apply to the current mix and explain why on hover.',
      'Escape clears the selection; the bar hides when nothing is selected.',
      'After success, refresh the affected rows and keep the user where they were.'
    ]
  },
  {
    id: 'ui-permissions',
    title: 'Роли и права в интерфейсе',
    titleEn: 'Roles and permissions UI',
    category: 'ui',
    summary: 'Скрывать нельзя — объяснять, почему действие недоступно',
    summaryEn: 'Do not hide — explain why an action is unavailable',
    triggers: ['права доступ', 'permissions ui', 'роли', 'roles ui', 'доступ по ролям', 'rbac'],
    rules: [
      'Show actions the user cannot perform as disabled with a reason ("нужна роль Администратор"), not as silence.',
      'Never rely on the UI alone for security: the server checks every permission too.',
      'Explain scope: which workspace, project or team the role applies to.',
      'Role changes show a diff of what the user gains or loses before saving.',
      'Members list shows role, status and last activity, with filters by role.',
      'Invites have an expiry, a clear pending state and a resend action.',
      'Destructive role changes (removing the last admin) are blocked with an explanation.',
      'Audit trail entries for permission changes are visible and timestamped.',
      'Do not use colour alone for role badges; include the role name.'
    ]
  },
  {
    id: 'ui-error-handling',
    title: 'Ошибки в интерфейсе',
    titleEn: 'Error handling UI',
    category: 'ui',
    summary: 'Что случилось, что делать, и сохранённый ввод',
    summaryEn: 'What happened, what to do, and the input kept',
    triggers: ['ошибк интерфейс', 'error handling', 'сообщение об ошибк', 'failed request ui', 'обработка ошибок'],
    rules: [
      'Every error says what happened, what to do next, and keeps the user input intact.',
      'Map technical states to plain sentences: offline, timeout, rate limit, auth expired, server error.',
      'Show errors where the action happened; use a banner only for page-level failures.',
      'Retry is a button, not advice; retry automatically only for idempotent reads with backoff.',
      'Network loss shows a persistent inline notice and recovers without a reload.',
      'Never lose form data on a failed submit, and never clear the field the user must fix.',
      'Include a support or log reference for errors the user cannot act on.',
      'Do not apologise twice in one message and do not blame the user.',
      'Log client errors with enough context to reproduce, and never log secrets or full tokens.'
    ]
  },
  {
    id: 'ui-tour',
    title: 'Онбординг-подсказки',
    titleEn: 'Product tour and hints',
    category: 'ui',
    summary: 'Короткие подсказки по месту, пропуск всегда, повторный запуск',
    summaryEn: 'Short in-place hints, always skippable, restartable',
    triggers: ['тур по прилож', 'product tour', 'онбординг подсказк', 'coach marks', 'walkthrough'],
    rules: [
      'At most three to five steps, each pointing at one element and explaining one action.',
      'Every step is dismissible, and the whole tour can be skipped from the first screen.',
      'Never cover the element being explained or the primary button of the screen.',
      'Do not repeat a tour the user already finished; store progress per feature.',
      'Reach the tour again from help, so dismissing is never permanent.',
      'Hints appear after the interface is loaded and idle, not during initial render.',
      'Each hint says the benefit ("здесь задачи синхронизируются"), not the feature name.',
      'Support keyboard: arrows move, Escape closes, focus stays on the highlighted element.',
      'After the tour, the empty state repeats the first action so nothing dead-ends.'
    ]
  },
  {
    id: 'ui-drawer-panels',
    title: 'Боковые панели',
    titleEn: 'Side panels and drawers',
    category: 'ui',
    summary: 'Один контекст, ресайз, закрытие без потери работы',
    summaryEn: 'One context, resizable, closes without losing work',
    triggers: ['боковая панел', 'side panel', 'drawer', 'инспектор', 'inspector panel'],
    rules: [
      'A panel holds one context (details of the selected item), never a second navigation.',
      'Width is resizable within min/max and remembered per user.',
      'The panel does not steal focus on open; Escape closes it and returns focus to the trigger.',
      'Unsaved changes in a panel ask before closing or keep a draft automatically.',
      'On narrow widths the panel becomes a full-width overlay, not a squeezed column.',
      'Header of the panel states what is selected and offers a close button.',
      'Selected item and panel state survive a reload via the URL where it makes sense.',
      'Do not nest scrolling inside a scrolling panel without a visible reason.',
      'Empty state when nothing is selected: instructions, not a blank rectangle.'
    ]
  },
  {
    id: 'ui-inline-edit',
    title: 'Редактирование на месте',
    titleEn: 'Inline editing',
    category: 'ui',
    summary: 'Клик — правка, Enter — сохранить, Escape — отменить',
    summaryEn: 'Click to edit, Enter saves, Escape cancels',
    triggers: ['inline edit', 'редактирован на месте', 'inline редактирован', 'правка поля'],
    rules: [
      'Click or Enter enters edit mode in place; the field takes the size and typography of the value.',
      'Enter saves, Escape cancels, and blur saves only when the value changed.',
      'Show a saving indicator on the field itself and keep the old value visible until success.',
      'On failure, restore the previous value and show the reason inline.',
      'Validate inline with the same rules as the full form, not a looser version.',
      'Do not enter edit mode on a single click if the row also navigates — use a pencil affordance or a double click.',
      'Keep the focus and the caret position when the field is re-rendered.',
      'Long values open a full editor instead of a one-line input.',
      'A cancelled edit must leave no trace in history or in autosave.'
    ]
  },
  {
    id: 'ui-upload',
    title: 'Загрузка файлов',
    titleEn: 'File upload',
    category: 'ui',
    summary: 'Зона, список, прогресс и честные ограничения',
    summaryEn: 'A drop zone, a list, progress, honest limits',
    triggers: ['загрузк файл', 'file upload', 'upload zone', 'drag files', 'прикрепить файл'],
    rules: [
      'Show the accepted types and the size limit before the user picks a file.',
      'The drop zone is clickable and keyboard accessible, and highlights while dragging over it.',
      'Each file gets a row with name, size, progress and a remove action.',
      'Upload in parallel with a cap and show per-file progress, not one global bar.',
      'Failed files stay in the list with a retry and the reason, never disappear silently.',
      'Reject wrong types by extension and by MIME, and say which rule failed.',
      'Large files show a cancel action that actually aborts the request.',
      'After success, show a thumbnail for images and let the user open or replace the file.',
      'On mobile offer the camera and the file picker explicitly.'
    ]
  }
]
