import type { Skill } from '../skills.ts'

/**
 * Web playbooks: the sections and pages a site is actually built from. Each one
 * is narrow on purpose — a hero, a pricing page and a checkout fail for
 * different reasons, and a single "make a website" skill cannot fix all three.
 */
export const WEB_SKILLS: Skill[] = [
  {
    id: 'web-hero',
    title: 'Первый экран',
    titleEn: 'Hero section',
    category: 'web',
    summary: 'Одна мысль, один CTA, реальный продукт вместо абстракции',
    summaryEn: 'One idea, one CTA, the product itself instead of abstraction',
    triggers: ['hero', 'первый экран', 'герой', 'first screen', 'above the fold', 'заголовок сайта'],
    rules: [
      'Above the fold carries one idea: what it is, who it is for, and the next step. Nothing else competes.',
      'Headline at most 8 words at 44-72px on desktop and 30-38px on mobile; subhead at most 2 lines.',
      'The primary CTA is visible without scrolling, appears once, and starts with a verb.',
      'Show the product or its result — real UI, a screenshot, a sample output. No glowing orbs or abstract 3D blobs.',
      'Align the hero to the same container and grid as the rest of the page; do not centre-align text by accident.',
      'Hero text over imagery needs 4.5:1 contrast: use a scrim or a solid panel, never a text shadow.',
      'Height 60-80vh on desktop; a forced 100vh hero hides the next section and the first proof.',
      'No hero carousel or slider: one message, no rotation, no autoplay.',
      'The largest contentful paint element is text or one optimized image, never a background video.'
    ]
  },
  {
    id: 'web-nav',
    title: 'Шапка и навигация',
    titleEn: 'Header and navigation',
    category: 'web',
    summary: '4–6 разделов, заметный текущий пункт, рабочий мобильный вариант',
    summaryEn: '4–6 sections, a visible current item, a real mobile pattern',
    triggers: ['навигац', 'navigation', 'шапк', 'header', 'menu', 'меню сайта', 'navbar'],
    rules: [
      'Four to six top-level items, named with the words visitors use — no internal product jargon.',
      'Mark the current section with weight plus an indicator, not with colour alone.',
      'Sticky header 64-72px; if it hides on scroll down it must return on scroll up.',
      'Mobile uses a drawer or a full-screen menu with a visible close button; hover-only menus are broken on touch.',
      'The header CTA repeats the primary action of the page, with the same label.',
      'Dropdowns open on click and on keyboard, close on Escape and on outside click, and never trap focus.',
      'The logo links home, keeps one size everywhere, and does not animate.',
      'Separate the header from content with either a hairline border or a shadow after scroll — never both.',
      'Every item has a focus-visible ring; a skip-to-content link comes first in the DOM.'
    ]
  },
  {
    id: 'web-footer',
    title: 'Подвал',
    titleEn: 'Footer',
    category: 'web',
    summary: 'Карта сайта и контакт, а не свалка из 60 ссылок',
    summaryEn: 'A site map and a contact route, not a pile of 60 links',
    triggers: ['подвал', 'footer', 'футер', 'низ сайта'],
    rules: [
      'Four columns at most: product, resources, company, legal. Never a wall of sixty links.',
      'Repeat the primary CTA or the newsletter once, quietly — the footer is the last chance, not a second hero.',
      'Always include a contact route, the company line, the year, and links to privacy and terms.',
      'Only social networks that are actually maintained, each with an icon and an accessible label.',
      'Use the same container and type scale as the page; footer text 13-14px and still 4.5:1 contrast.',
      'On mobile the columns become accordions or a single stacked list — no horizontal scroll.',
      'No fake trust badges (SSL, awards, "featured in") and no dead links.',
      'Keep it shallow: the footer is a map, not a second website.'
    ]
  },
  {
    id: 'web-features',
    title: 'Блоки возможностей',
    titleEn: 'Feature blocks',
    category: 'web',
    summary: 'Каждая карточка доказывает результат, а не перечисляет фичи',
    summaryEn: 'Every card proves an outcome instead of listing features',
    triggers: ['фич', 'feature section', 'возможност', 'преимуществ', 'features grid', 'блоки преимуществ'],
    rules: [
      'Three to six blocks, each with a verb-led heading and one concrete outcome for the user.',
      'Every block proves itself with a number, a screenshot or a short example — a claim alone is filler.',
      'Pick one layout pattern for the section (2x2, three-up, alternating rows) instead of mixing five.',
      'Use icons only when they carry meaning, from a single set, at a single size.',
      'Feature copy is at most two lines; anything longer belongs in its own section.',
      'Cards share a height and a text baseline; do not vertically centre each card independently.',
      'One accent colour across the grid; colouring every card differently kills the hierarchy.',
      'On mobile the grid collapses to one column with 48-64px between blocks.'
    ]
  },
  {
    id: 'web-testimonials',
    title: 'Отзывы и соцдоказательства',
    titleEn: 'Testimonials and social proof',
    category: 'web',
    summary: 'Имена, результаты, настоящие люди — или секции просто нет',
    summaryEn: 'Names, results, real people — or no section at all',
    triggers: ['отзыв', 'testimonial', 'соцдоказательств', 'social proof', 'клиенты', 'reviews section'],
    rules: [
      'Each card: quote, name, role, company, and a real face or a real logo.',
      'Cut the quote to 40 words or fewer and keep the part that names the result.',
      'Never invent people, companies, ratings or numbers. If there is no proof yet, omit the section.',
      'Layout: two or three columns on desktop, one on mobile, equal card heights.',
      'Add the metric when it exists ("сократили онбординг с 3 дней до 2 часов").',
      'Logo walls: monochrome, equal optical size, at most twelve logos, in a grid rather than a marquee.',
      'Quote text 16-18px with line-height 1.5; attribution is smaller but never below 12px or below 4.5:1.',
      'Reading order is quote first, attribution second; decorative quote marks must not break the text flow.'
    ]
  },
  {
    id: 'web-faq',
    title: 'FAQ и вопросы',
    titleEn: 'FAQ section',
    category: 'web',
    summary: 'Реальные вопросы из поддержки, короткие ответы, ссылки в доки',
    summaryEn: 'Real support questions, short answers, links into the docs',
    triggers: ['faq', 'частые вопросы', 'вопрос-ответ', 'вопросы и ответы'],
    rules: [
      'Five to eight questions taken from real support tickets, phrased the way users ask them.',
      'Accordions are buttons inside real headings, operable by keyboard, with aria-expanded.',
      'Answers at most three short paragraphs; anything longer becomes a link to the docs.',
      'Cover the objections: price, cancellation, data ownership, security, support hours.',
      'Add search or category filters only when there are more than twelve questions.',
      'Keep marketing out of the answers — every FAQ answer should reduce a support ticket.',
      'Give each question an anchor so support can link straight to it.',
      'Mobile: one column, 44px tap targets, the open answer stays in view when it expands.'
    ]
  },
  {
    id: 'web-contact',
    title: 'Контакты и форма связи',
    titleEn: 'Contact page and form',
    category: 'web',
    summary: 'Минимум полей, понятный ответ, живые альтернативы',
    summaryEn: 'Minimal fields, a promised reply, real alternatives',
    triggers: ['контакт', 'contact form', 'связь со мной', 'обратная связь', 'contact page'],
    rules: [
      'Offer three routes: the form, an email address, and a synchronous channel if one exists.',
      'Ask only for name, contact and message — nothing that will not be answered.',
      'Labels sit above the inputs; validation is inline; the success state replaces the form in place.',
      'State the response time in plain words ("ответим в течение рабочего дня").',
      'Show the real street address or map only if visitors actually come there.',
      'Use a honeypot and a rate limit instead of a CAPTCHA wall.',
      'Put a privacy line under the submit button explaining what happens with the data.',
      'Provide a mailto alternative so the page still works without JavaScript.'
    ]
  },
  {
    id: 'web-blog',
    title: 'Блог и список статей',
    titleEn: 'Blog index',
    category: 'web',
    summary: 'Один акцент, ровная сетка карточек, честная пагинация',
    summaryEn: 'One featured post, an even card grid, honest pagination',
    triggers: ['блог', 'blog index', 'статьи', 'список статей', 'news list', 'новости сайта'],
    rules: [
      'One featured post plus a chronological list; no masonry of mismatched cards.',
      'Each card: date, category, title of 2-3 lines, excerpt of 1-2 lines, and the read time.',
      'Filter by category with visible chips; add search once there are more than thirty posts.',
      'Pagination or a load-more button that shows how many items remain — never endless scroll alone.',
      'One date format, localized, with an updated date when the post was materially rewritten.',
      'Filtered categories need an empty state with a way to clear the filter.',
      'Cover images share a 16:9 crop with object-fit cover and width/height attributes.',
      'Card hover is a subtle border or background shift, not a lift plus shadow combo; links are not underlined in cards.'
    ]
  },
  {
    id: 'web-article',
    title: 'Статья и лонгрид',
    titleEn: 'Article and long read',
    category: 'web',
    summary: 'Колонка 60–75 знаков, якоря, читаемый код и картинки',
    summaryEn: 'A 60–75 character column, anchors, readable code and images',
    triggers: ['статья', 'лонгрид', 'long read', 'article layout', 'пост в блог', 'blog post page'],
    rules: [
      'Body column 60-75 characters, 17-19px, line-height 1.6-1.7; never full-width paragraphs.',
      'One H1 equals the title; the lede is a paragraph, not a second headline block.',
      'Table of contents for three or more headings on desktop; reading progress only on long posts.',
      'Code blocks, quotes and images break the column deliberately but stay aligned to the same grid.',
      'Links are distinguishable by underline or at least two contrast steps, not by bold alone.',
      'Author and date sit at the top; share and copy-link sit at the end.',
      'Every image has width and height attributes plus a caption, so nothing shifts while loading.',
      'Close with related reading instead of a dead end or a full-screen newsletter modal.'
    ]
  },
  {
    id: 'web-portfolio',
    title: 'Портфолио и кейсы',
    titleEn: 'Portfolio and case studies',
    category: 'web',
    summary: 'Работы крупно, ровные превью, кейс как история с результатом',
    summaryEn: 'Work shown large, even thumbnails, a case told with a result',
    triggers: ['портфолио', 'portfolio site', 'кейс', 'case study', 'мои работы', 'showcase'],
    rules: [
      'One project per block: image, one line about what it was, and three facts (role, year, result).',
      'Thumbnails share one aspect ratio and one crop rule; random sizes read as an accident.',
      'Case study order: context, constraints, what was done, measurable result.',
      'The work is the hero — strip decorative gradients and chrome behind screenshots.',
      'Filter by discipline only when there are more than nine projects.',
      'Every project links out to the live site or repository with an honest label.',
      'Never invent clients or metrics; mark work under NDA as such instead of padding it.',
      'Keep a contact route reachable without scrolling to the footer.'
    ]
  },
  {
    id: 'web-agency',
    title: 'Сайт студии или агентства',
    titleEn: 'Agency site',
    category: 'web',
    summary: 'Ниша, услуги с ценой, процесс и кейсы с цифрами',
    summaryEn: 'A niche, priced services, the process, cases with numbers',
    triggers: ['агентств', 'agency site', 'студия', 'digital agency', 'веб-студия', 'сайт студии'],
    rules: [
      'Lead with the niche and the outcome, not with "we are a team of professionals".',
      'Services: three to five offers, each with what the client gets and a starting price or timeline.',
      'Process in three to five steps, naming what the client does at every step.',
      'Cases carry metrics and a link; the team photos are real and current.',
      'One booking CTA repeated through the page; a calendar embed beats a contact form.',
      'Proof is verifiable: client names, years in business, awards with a source.',
      'Ban the agency filler: passionate, synergy, full-cycle, turnkey, 360.',
      'On mobile services become a comparable list with prices, not cards that need tapping open.'
    ]
  },
  {
    id: 'web-ecommerce',
    title: 'Витрина магазина',
    titleEn: 'Storefront and product grid',
    category: 'web',
    summary: 'Плотная сетка, честные остатки, фильтры и корзина на виду',
    summaryEn: 'A dense grid, honest stock, filters, a visible cart',
    triggers: ['магазин', 'ecommerce', 'e-commerce', 'shop', 'витрин', 'каталог товаров', 'storefront'],
    rules: [
      'Product grid of three to four columns on desktop and two on mobile, with price, name and one differentiator.',
      'Filters live in the sidebar on desktop and in a bottom sheet on mobile, and show the active count.',
      'The cart is one click away and always shows the item count.',
      'Product photos share a 4:5 or 1:1 frame on a neutral background, with zoom on tap.',
      'Stock is explicit ("осталось 2"); no fake "only today" countdowns.',
      'Keep sort and filter state in the URL so a filtered view can be shared.',
      'Show delivery cost and return terms before the cart, not only at checkout.',
      'Load the grid as skeletons with the real card count instead of a blank screen.'
    ]
  },
  {
    id: 'web-product-page',
    title: 'Карточка товара',
    titleEn: 'Product page',
    category: 'web',
    summary: 'Галерея, варианты, цена и доставка до первого скролла',
    summaryEn: 'Gallery, variants, price and shipping above the scroll',
    triggers: ['карточка товара', 'product page', 'страница товара', 'pdp', 'товар'],
    rules: [
      'Above the fold: gallery, title, price, variant picker, add-to-cart and stock state.',
      'Gallery is one main image plus four to six thumbnails with keyboard arrows and zoom; no autorotation.',
      'Unavailable variants are disabled in place instead of disappearing from the list.',
      'Shipping and returns live in an accordion directly under the CTA.',
      'Description starts with a scannable spec list and only then prose.',
      'Reviews show a rating distribution and verified-purchase markers, and are never invented.',
      'On mobile a sticky add-to-cart bar appears once the main button scrolls out of view.',
      'Emit structured data for product, price and availability.'
    ]
  },
  {
    id: 'web-checkout',
    title: 'Корзина и оформление заказа',
    titleEn: 'Cart and checkout',
    category: 'web',
    summary: 'Гость, три шага, живой итог и ошибки у полей',
    summaryEn: 'Guest first, three steps, a live total, errors in place',
    triggers: ['checkout', 'оформлен заказ', 'корзин', 'cart page', 'оплат заказ', 'оплата на сайте'],
    rules: [
      'Guest checkout first; account creation is offered after payment, never as a gate.',
      'One column, three steps (contacts, delivery, payment), with the progress visible.',
      'The total updates live and is visible at every step, including delivery and fees.',
      'Autocomplete attributes on every field; the address is one search field, not six.',
      'Errors sit next to their field — never only in a summary toast.',
      'Payment methods are radios with logos, the most used one selected by default.',
      'Trust cues next to the pay button: return policy, secure payment, support contact.',
      'The confirmation repeats the order number, delivery estimate and support route.'
    ]
  },
  {
    id: 'web-auth',
    title: 'Вход и регистрация',
    titleEn: 'Sign in and sign up',
    category: 'web',
    summary: 'Одна задача на экран, конкретные ошибки, честная сессия',
    summaryEn: 'One task per screen, specific errors, honest sessions',
    triggers: ['вход', 'sign in', 'логин', 'login page', 'регистрац', 'signup', 'auth screen'],
    rules: [
      'One screen, one task; sign in and sign up are separate screens joined by a visible switch, not a tab.',
      'Offer social login only for providers that are configured and tested end to end.',
      'Password field has a reveal toggle, a caps-lock hint and a stated strength rule.',
      'Errors are specific and inline ("Неверный пароль"), never one generic banner for everything.',
      'The forgot-password link is always visible, and the reset flow says what happens next.',
      'Explain the session ("оставаться в системе 30 дней") instead of a silent checkbox.',
      'No fake security badges; link to the privacy policy instead.',
      'Keyboard: focus starts in the first field, Enter submits, Escape closes any dialog.'
    ]
  },
  {
    id: 'web-404',
    title: 'Страница 404 и ошибки',
    titleEn: '404 and error pages',
    category: 'web',
    summary: 'Что случилось и три пути дальше, без шуток загадок',
    summaryEn: 'What happened and three ways out, no cryptic jokes',
    triggers: ['404', 'not found', 'страница ошибки', 'error page', 'не найдено'],
    rules: [
      'Say what happened in one sentence — no joke the visitor has to decode.',
      'Give three ways out: home, search, and the most popular section.',
      'Keep the header and footer so navigation still works.',
      'Echo the requested URL and, if the page moved, offer the new location directly.',
      'Log the miss server-side; the page must be useful, not only pretty.',
      'No giant illustration that pushes the actions below the fold on mobile.',
      'Return a real 404 (or 410 when removed) status code, not a 200 error page.',
      'Style error pages with the product language, but keep them short and calm.'
    ]
  },
  {
    id: 'web-coming-soon',
    title: 'Скоро запуск и вайтлист',
    titleEn: 'Coming soon and waitlist',
    category: 'web',
    summary: 'Одно обещание, одно поле, честная дата без таймеров',
    summaryEn: 'One promise, one field, an honest date without fake timers',
    triggers: ['coming soon', 'скоро запуск', 'waitlist', 'лист ожидания', 'предзапуск'],
    rules: [
      'One promise, one field, one button — nothing else on the page.',
      'Say what happens after signup ("письмо, когда откроемся; без спама").',
      'Show proof of life: a date, a build log entry or a real screenshot.',
      'No fake countdowns and no invented user counts.',
      'Validate the email inline and replace the form with the success state in place.',
      'Link only to social accounts that actually publish something.',
      'Keep the page under 200KB — it may be the only page a visitor loads.',
      'Always offer a way to reach a human.'
    ]
  },
  {
    id: 'web-changelog',
    title: 'Changelog и обновления',
    titleEn: 'Changelog page',
    category: 'web',
    summary: 'Даты, версии, группы изменений и ссылки на доки',
    summaryEn: 'Dates, versions, grouped changes, links to docs',
    triggers: ['changelog', 'что нового', 'список изменений', 'release notes page', 'обновлени сайта'],
    rules: [
      'Newest first, each entry dated and versioned with a one-line summary plus bullets.',
      'Group by kind — added, changed, fixed, removed — with one consistent label set.',
      'Link to docs or the issue for anything a user cannot infer from the line.',
      'Filter by product area once the changelog covers several products.',
      'Provide an RSS or JSON feed and an anchor per release for sharing.',
      'No superlatives: "faster" needs a number, "better" needs a before and after.',
      'Filtered areas need an empty state ("пока без изменений").',
      'The three newest entries show full text; older ones collapse.'
    ]
  },
  {
    id: 'web-careers',
    title: 'Вакансии',
    titleEn: 'Careers page',
    category: 'web',
    summary: 'Задачи и процесс, пять требований, зарплата без загадок',
    summaryEn: 'Work and process, five requirements, transparent salary',
    triggers: ['вакансии', 'careers', 'jobs page', 'работа у нас', 'найм'],
    rules: [
      'Open with the work and what the team ships, not with a perks list.',
      'One card per role: title, location or remote, team, and the salary range if it is published.',
      'Process in three or four steps with timelines and who the candidate meets.',
      'At most five must-have requirements; nice-to-haves are separated.',
      'No rockstar or ninja language, and no ten-years-experience demands for junior pay.',
      'Application form at most four fields plus CV, with an email alternative.',
      'When no roles are open, show an empty state with a talent-pool option.',
      'Salary and remote policy are visible without opening the role.'
    ]
  },
  {
    id: 'web-about',
    title: 'О компании',
    titleEn: 'About page',
    category: 'web',
    summary: 'Два предложения о деле, числа с датами, настоящая команда',
    summaryEn: 'Two sentences about the work, dated numbers, a real team',
    triggers: ['о компании', 'about page', 'о нас', 'про компанию'],
    rules: [
      'Lead with what the company does and for whom, in two sentences.',
      'Use numbers with dates ("с 2019", "40 человек", "3 офиса") instead of adjectives.',
      'Team members have real photos and roles; stock people are worse than no photos.',
      'A timeline only if the history is genuinely interesting, four to six milestones.',
      'Link to the product, careers and press from here.',
      'Write values as observed behaviour, not as abstract nouns.',
      'Do not repeat the same mission paragraph in three headings.',
      'Keep the page under three screens of content.'
    ]
  },
  {
    id: 'web-search-results',
    title: 'Результаты поиска',
    titleEn: 'Search results page',
    category: 'web',
    summary: 'Запрос на виду, подсветка совпадений, клавиатура и пустота',
    summaryEn: 'Query visible, matches highlighted, keyboard, a real empty state',
    triggers: ['результаты поиска', 'search results', 'поиск по сайту', 'search page'],
    rules: [
      'The search field is focused on load, with the query preserved and editable.',
      'Show the result count and the elapsed time; group by type when several exist.',
      'Highlight the match inside each result, not the whole row.',
      'Empty state repeats what was searched, suggests alternatives and clears the filters.',
      'Keyboard: arrows move between results, Enter opens, Escape clears.',
      'Keep filters and the query in the URL so back and forward work.',
      'Debounce input 250-300ms and cancel stale requests so old results never overwrite new ones.',
      'Paginate or load more with a visible "показано N из M".'
    ]
  },
  {
    id: 'web-settings-page',
    title: 'Страница настроек',
    titleEn: 'Settings page',
    category: 'web',
    summary: 'Группы по объектам, явное сохранение, опасное отдельно',
    summaryEn: 'Groups by object, explicit saving, danger kept apart',
    triggers: ['страница настроек', 'settings page', 'настройки аккаунта', 'preferences page'],
    rules: [
      'Group by object — profile, notifications, security, integrations — not by field type.',
      'Either save explicitly per group or autosave with a visible "сохранено" state; never both.',
      'Destructive actions live in their own section, in red, confirmed by typing the object name.',
      'Show the current value and the default, with a per-field reset.',
      'Validate inline and never lose unsaved changes on navigation without a warning.',
      'Add search across settings once there are more than twenty rows.',
      'Push advanced options behind a disclosure instead of a separate page.',
      'Mobile: one column, and a sticky save bar only for long forms.'
    ]
  },
  {
    id: 'web-cookie-consent',
    title: 'Куки и согласия',
    titleEn: 'Cookie consent',
    category: 'web',
    summary: 'Равные кнопки, гранулярные категории, ничего до согласия',
    summaryEn: 'Equal buttons, granular categories, nothing before consent',
    triggers: ['куки', 'cookie banner', 'согласие', 'consent', 'gdpr banner'],
    rules: [
      'One banner at the bottom with accept, reject and settings, where accept and reject have equal visual weight.',
      'No pre-checked boxes and no "by continuing you agree" as the only consent.',
      'Categories (necessary, analytics, marketing) each get a plain-language explanation.',
      'Store the choice with a timestamp and let the user change it later from the footer.',
      'Never block the page behind a modal that cannot be dismissed.',
      'No non-essential script runs before consent — check the network tab, not the copy.',
      'Banner text at most two lines plus the policy link.',
      'On mobile the banner must not cover the primary CTA or the bottom navigation.'
    ]
  },
  {
    id: 'web-newsletter',
    title: 'Подписка на рассылку',
    titleEn: 'Newsletter signup',
    category: 'web',
    summary: 'Польза, частота, двойное подтверждение и один клик отписки',
    summaryEn: 'Benefit, cadence, double opt-in, one-click unsubscribe',
    triggers: ['рассылк', 'newsletter', 'подписк', 'email signup', 'subscribe form'],
    rules: [
      'One benefit line, one field, one button, placed where the intent already exists.',
      'State the cadence and the content ("раз в две недели, только релизы").',
      'Success and error states are inline, with the address echoed back.',
      'No pre-checked marketing consent; the privacy link sits next to the button.',
      'Use double opt-in and make the confirmation email state the next step.',
      'Unsubscribe takes one click from every email.',
      'Do not ask for a name to send an email.',
      'Test the empty and invalid-email paths, not only the happy one.'
    ]
  }
]
