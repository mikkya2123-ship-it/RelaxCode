import type { Skill } from '../skills.ts'

/**
 * Visual craft beyond the screen: print, editorial spreads, decks, social kits,
 * logos and the art direction that keeps a series of images coherent.
 */
export const GRAPHICS_SKILLS: Skill[] = [
  {
    id: 'gs-editorial-layout',
    title: 'Редакционная вёрстка',
    titleEn: 'Editorial layout',
    category: 'graphics',
    summary: 'Колонки, базлайн и крупные паузы вместо ровного серого текста',
    summaryEn: 'Columns, baseline rhythm and large pauses instead of grey text',
    triggers: ['редакционн вёрстк', 'editorial layout', 'журнальн вёрстк', 'layout spread', 'газетн'],
    rules: [
      'Set a baseline grid first; every text block and image snaps to it so facing pages align.',
      'Use two or three columns with a gutter of at least 4mm and keep body text aligned to a single column grid.',
      'Vary density deliberately: one dominant element per spread, the rest subordinated.',
      'Build hierarchy with scale jumps of at least 1.5x between levels — 11pt and 13pt are not different levels.',
      'Allow one full-bleed image per spread at most; the white space around it does the work.',
      'Keep running heads, folios and captions on a consistent position across pages.',
      'Justify only with hyphenation enabled; otherwise align left with a ragged right edge.',
      'Set widows and orphans control and check the last lines of every column before export.'
    ]
  },
  {
    id: 'gs-magazine-spread',
    title: 'Разворот журнала',
    titleEn: 'Magazine spread',
    category: 'graphics',
    summary: 'Один образ на разворот, читаемые подписи, поля и вылеты',
    summaryEn: 'One hero per spread, readable captions, margins and bleed',
    triggers: ['разворот', 'magazine spread', 'журнал макет', 'two page spread'],
    rules: [
      'Design the spread as one composition, not two pages side by side — the gutter is part of the layout.',
      'One clear entry point (headline or image) and a reading path that crosses the gutter intentionally.',
      'Keep text at least 10mm from the gutter so nothing disappears in the binding.',
      'Captions sit next to their image, not in a block at the bottom of the page.',
      'Margins: outside at least 15mm, inside 18-20mm, top 15mm, bottom 20mm for print.',
      'Photos need 3mm bleed and a crop that survives a 5mm trim variance.',
      'Use one or two type sizes for body across the whole issue; the spread is not a poster.',
      'Check the spread at 100% and in a greyscale proof before approving colours.'
    ]
  },
  {
    id: 'gs-poster-print',
    title: 'Печатный постер',
    titleEn: 'Print poster',
    category: 'graphics',
    summary: 'Вылеты, CMYK, читаемость с 3 метров и один фокус',
    summaryEn: 'Bleed, CMYK, legibility from 3 metres, one focal point',
    triggers: ['печатн постер', 'print poster', 'плакат', 'афиша печать', 'flyer print'],
    rules: [
      'Set the document in CMYK at 300dpi with 3mm bleed and keep critical text 5mm inside the trim.',
      'One focal element; from three metres the viewer must get the message in two seconds.',
      'Headline at least 72pt for A3, supporting text at least 10pt — no hairline type on a print poster.',
      'Limit to two typefaces and three colours; check the greyscale proof for hierarchy.',
      'Rich black for large black areas (C40 M30 Y30 K100), plain K100 for small text.',
      'Check total ink coverage under 300% and convert RGB images to CMYK with a profile.',
      'Avoid thin white text over busy photos; add a solid or gradient scrim behind it.',
      'Export a press-ready PDF with fonts embedded and marks included.'
    ]
  },
  {
    id: 'gs-social-kit',
    title: 'Соцсети: комплект шаблонов',
    titleEn: 'Social media kit',
    category: 'graphics',
    summary: 'Серия в одном стиле, безопасные зоны, читаемость в маленьком превью',
    summaryEn: 'One style across the set, safe zones, legible at thumbnail size',
    triggers: ['соцсет', 'social media kit', 'посты для инстаграм', 'сторис', 'social templates'],
    rules: [
      'Build one master grid and reuse it across 1:1, 4:5 and 9:16 instead of redrawing each format.',
      'Keep safe zones: 64px from edges for story UI, 40px for feed, and never put text under the platform chrome.',
      'Text must survive at 25% zoom — headline at least 8% of the canvas height.',
      'One message per card; a carousel is a sequence of single messages, not a paragraph split.',
      'Keep a consistent corner treatment, type scale and accent position across the whole set.',
      'Design a cover that works alone and a second slide that works as a teaser.',
      'Export at 1080px minimum on the short side, sRGB, and check the JPEG artefacts on gradients.',
      'Leave the caption area free of critical text so the platform crop never cuts meaning.'
    ]
  },
  {
    id: 'gs-presentation-deck',
    title: 'Презентация',
    titleEn: 'Presentation deck',
    category: 'graphics',
    summary: 'Один тезис на слайд, крупный шрифт, данные вместо буллетов',
    summaryEn: 'One point per slide, large type, data instead of bullets',
    triggers: ['презентац', 'presentation', 'слайды', 'pitch deck', 'deck design'],
    rules: [
      'One idea per slide, stated in the slide title as a full sentence, not a topic label.',
      'Title font 28-36pt, body 18-24pt minimum; if it does not fit, the slide has too much content.',
      'Replace bullet lists with a diagram, a number, or a single quote.',
      'Consistent grid: same margins, same title position, same footer on every slide.',
      'Charts use one accent colour for the point being made and grey for the rest.',
      'One image per slide at most, full-bleed or aligned to the grid, never both on one slide.',
      'A cover, a section divider and an end slide with contact — no more special layouts.',
      'Contrast checked on a projector: avoid light grey on white and thin fonts under 18pt.',
      'Keep a 16:9 canvas and export a PDF backup for the machine you do not control.'
    ]
  },
  {
    id: 'gs-infographic',
    title: 'Инфографика',
    titleEn: 'Infographic',
    category: 'graphics',
    summary: 'Один вывод, честные пропорции, подписи вместо легенд',
    summaryEn: 'One takeaway, honest proportions, labels instead of legends',
    triggers: ['инфографик', 'infographic', 'схема данных', 'data story', 'визуализац процесса'],
    rules: [
      'Write the takeaway as a sentence first; the graphic exists to prove it.',
      'Use position and length for quantity, not area, angle or 3D — humans read those badly.',
      'Every number carries a unit, a period and a source.',
      'Order the flow top to bottom or left to right, and number the steps when order matters.',
      'Keep the palette to three colours: background, data, emphasis.',
      'Label directly on the marks; avoid a legend the eye must travel to.',
      'Keep icons at one weight and one optical size, and never use them as decoration in place of data.',
      'Leave 30-40% of the canvas empty; a full canvas is unreadable on a phone.',
      'Check the whole piece at 400px wide — if it dies there, it needs a vertical version.'
    ]
  },
  {
    id: 'gs-logo-mark',
    title: 'Логотип и знак',
    titleEn: 'Logo and mark',
    category: 'graphics',
    summary: 'Форма из идеи, работа в 16px, один цвет без эффектов',
    summaryEn: 'A form from an idea, working at 16px, one colour, no effects',
    triggers: ['логотип', 'logo design', 'знак', 'logomark', 'monogram'],
    rules: [
      'Start from one idea in a sentence; every curve must trace back to it.',
      'Draw in one colour and check at 16px before adding any colour or detail.',
      'Keep geometry simple enough to redraw from memory: 2-4 shapes, consistent stroke or solid fills.',
      'Optically correct, not mathematically: overshoot curves, align to the visual centre.',
      'Build on a 24px or 32px grid with a consistent stroke width across the mark.',
      'Deliver lockups: mark alone, mark plus wordmark horizontal and stacked, with clear space defined.',
      'Show the mark in one colour, reversed on dark, and on a photo — it must survive all three.',
      'No gradients, bevels, glows or drop shadows in the primary mark; keep them for a campaign variant.',
      'Ship an SVG with clean paths and no embedded raster, plus PNG at 16, 32, 128, 512.'
    ]
  },
  {
    id: 'gs-gradient',
    title: 'Градиенты',
    titleEn: 'Gradients',
    category: 'graphics',
    summary: 'Два стопа, близкие оттенки, ноль радуги на тексте',
    summaryEn: 'Two stops, close hues, no rainbow text',
    triggers: ['градиент', 'gradient design', 'mesh gradient', 'градиентный фон'],
    rules: [
      'Two stops, at most three; a rainbow ramp is a data visual, not decoration.',
      'Keep hue distance small (under 40 degrees) and shift lightness more than saturation.',
      'Never put a gradient behind body text without a solid or blur scrim.',
      'Avoid gradients on top of photos except as a bottom scrim for text legibility.',
      'Match the gradient direction to the composition: vertical for depth, diagonal for movement.',
      'Check banding on large areas and add a 1-2% noise layer when it appears.',
      'Do not put a gradient, a shadow and a border on the same card — pick one.',
      'Ship a static fallback colour for browsers and print that cannot render the gradient.'
    ]
  },
  {
    id: 'gs-texture-grain',
    title: 'Текстуры и зерно',
    titleEn: 'Texture and grain',
    category: 'graphics',
    summary: 'Одна текстура на макет, мягкая и в масштабе',
    summaryEn: 'One texture per layout, soft and correctly scaled',
    triggers: ['текстур', 'texture design', 'зерно', 'grain', 'noise overlay', 'шум фон'],
    rules: [
      'One texture per layout; two competing textures read as compression artefacts.',
      'Scale the grain relative to the canvas: 2-4px for screens, 300dpi noise for print.',
      'Keep opacity 3-8% over text areas and up to 15% over flat backgrounds.',
      'Use multiply or overlay blending on a single layer instead of per-element textures.',
      'Match texture to the material story: paper grain for print, film grain for photography, none for UI chrome.',
      'Never texture small text; it destroys legibility at 12-14px.',
      'Tile seamlessly or use a full-canvas layer so edges do not repeat visibly.',
      'Export texture as a separate layer when handing off, so the client can remove it.'
    ]
  },
  {
    id: 'gs-photo-treatment',
    title: 'Обработка фотографий',
    titleEn: 'Photo treatment',
    category: 'graphics',
    summary: 'Единый тон серии, честные цвета, кроп по смыслу',
    summaryEn: 'One tone for the set, honest colour, meaningful crops',
    triggers: ['фотообработк', 'photo treatment', 'цветокоррекц', 'photo grading', 'ретушь фото'],
    rules: [
      'Set one treatment for a series: same white balance, contrast curve and saturation level.',
      'Keep skin tones neutral; check against a reference before pushing the grade.',
      'Do not crush blacks or clip highlights — keep detail at both ends.',
      'Crop for meaning: faces and products stay out of the centre only when the composition earns it.',
      'Match the crop ratio across a set; mixed ratios look accidental in a grid.',
      'Remove distractions (wires, exit signs) only when they do not change the scene meaning.',
      'Export sRGB for screens, Adobe RGB or CMYK for print, at the needed resolution.',
      'Retouch lightly: visible dodge-and-burn reads as amateur, not as polish.'
    ]
  },
  {
    id: 'gs-illustration-style',
    title: 'Иллюстрация в стиле',
    titleEn: 'Illustration style',
    category: 'graphics',
    summary: 'Одна линия и палитра, система фигур, повторяемость',
    summaryEn: 'One line and palette, a shape system, repeatability',
    triggers: ['иллюстрац', 'illustration style', 'векторн иллюстрац', 'рисунок в стиле', 'spot illustration'],
    rules: [
      'Define three rules up front: line weight, corner radius, and the number of colours.',
      'Build a small shape vocabulary (circle, rounded rectangle, triangle) and reuse it across the set.',
      'Limit the palette to a base, an accent and one shadow tone; no gradients in flat illustration.',
      'Draw at one scale and scale down; strokes must stay visually equal.',
      'Keep figures simplified: no facial detail if the style is geometric, no shading if it is flat.',
      'Perspective is consistent within a set — pick flat, isometric or three-quarter and stay there.',
      'Leave breathing room inside the canvas so the illustration sits beside text without crowding.',
      'Export SVG where possible and check that strokes render at 2x without artefacts.'
    ]
  },
  {
    id: 'gs-svg-optimization',
    title: 'Оптимизация SVG',
    titleEn: 'SVG optimization',
    category: 'graphics',
    summary: 'Пути без мусора, currentColor, вес под контролем',
    summaryEn: 'Clean paths, currentColor, controlled weight',
    triggers: ['svg оптимизац', 'svg optimization', 'svg сжатие', 'svg icon export'],
    rules: [
      'Strip editor metadata, comments, hidden layers and unused defs before shipping.',
      'Convert strokes to outlines only when the stroke must scale non-uniformly.',
      'Use currentColor for single-colour icons so themes and hover states work.',
      'Keep the viewBox and drop fixed width/height when the SVG must scale with layout.',
      'Round path coordinates to 1-2 decimals; more precision is invisible and doubles the size.',
      'Prefer one path per glyph over dozens of tiny shapes; merge where the rendering is identical.',
      'Avoid embedded raster images and base64 blobs in interface icons.',
      'Target under 2KB per icon and under 50KB per illustration; check after every export.',
      'Test the file in the real browser at 1x and 2x — some optimizers break fill rules.'
    ]
  },
  {
    id: 'gs-generative-art',
    title: 'Генеративная графика',
    titleEn: 'Generative art',
    category: 'graphics',
    summary: 'Правило вместо случайности, зерно и семя, печатный результат',
    summaryEn: 'A rule instead of randomness, grain and seed, a printable result',
    triggers: ['генеративн', 'generative art', 'арт кодом', 'p5.js', 'canvas art', 'процедурн графика'],
    rules: [
      'Define the rule that generates the image in one sentence; the code implements that rule only.',
      'Seed every random call so a good result can be reproduced and iterated.',
      'Compose with a grid or a field, not with random placement — randomness is a texture, not a layout.',
      'Limit the palette to 3-5 values taken from one hue family plus neutrals.',
      'Add controlled imperfection (grain, jitter, overprint) so the result reads as printed, not computed.',
      'Cap the composition density: leave at least 25% empty space for the eye to rest.',
      'Export at print resolution with a fixed canvas and no device pixel ratio surprises.',
      'Keep the generation time under a few seconds for interactive use, otherwise pre-render.'
    ]
  },
  {
    id: 'gs-cover-art',
    title: 'Обложка альбома и книги',
    titleEn: 'Cover art',
    category: 'graphics',
    summary: 'Один образ, читаемый в 64px, типографика вместо коллажа',
    summaryEn: 'One image, readable at 64px, type instead of collage',
    triggers: ['обложк альбом', 'cover art', 'album cover', 'book cover', 'обложка книги'],
    rules: [
      'One image idea, not a collage; the cover must read at 64px in a streaming list.',
      'Title and author are the only mandatory text; keep the type block to one alignment.',
      'Keep a clear safe margin: 8mm around the trim for print, 5% for digital storefronts.',
      'Contrast between the type and the artwork is a hard requirement, use a solid panel when needed.',
      'Choose imagery that states the genre without clichés (no lone tree for "atmospheric").',
      'Leave room for platform overlays (price sticker, parental warning, streaming badge).',
      'Deliver 1:1 for streaming, 2:3 for print, with the same composition recomposed, not cropped.',
      'Check the artwork in greyscale — if it dies, the value structure is wrong.'
    ]
  },
  {
    id: 'gs-packaging',
    title: 'Упаковка',
    titleEn: 'Packaging design',
    category: 'graphics',
    summary: 'Полка на 2 метра, диелайн, материалы и честные вылеты',
    summaryEn: 'Two-metre shelf, dieline, materials, honest bleed',
    triggers: ['упаковк', 'packaging', 'коробк дизайн', 'dieline', 'этикетк'],
    rules: [
      'Design for the shelf: the front panel must be readable from two metres and in a photo thumbnail.',
      'Work on the real dieline with fold, glue and bleed zones marked; never invent panel sizes.',
      'Keep mandatory legal text at the exact minimum size your market requires, and check the locale rules.',
      'Print-safe: 3mm bleed, 3mm safety margin, CMYK, no fine hairlines under 0.25pt.',
      'Respect the material: uncoated paper takes overprint and texture differently; mock it before approving.',
      'One hierarchy per panel: brand, product name, variant, then claims — never three equal logos.',
      'Design the back panel for scanning: ingredients, barcode zone clear of folds, batch area empty.',
      'Check how the design repeats across a range: colour coding must survive colour blindness.',
      'Produce a physical or 3D proof before production; a flat PDF lies about curvature.'
    ]
  },
  {
    id: 'gs-motion-graphics',
    title: 'Моушн-графика',
    titleEn: 'Motion graphics',
    category: 'graphics',
    summary: 'Тайминг, читаемость кадра, один ритм на весь ролик',
    summaryEn: 'Timing, frame legibility, one rhythm for the whole piece',
    triggers: ['моушн', 'motion graphics', 'анимац логотипа', 'видео титры', 'after effects'],
    rules: [
      'Storyboard the beats first: hook in 2 seconds, one idea per beat, a clear end card.',
      'Design for 25-30fps and check readability frame by frame, not only in motion preview.',
      'Text on screen stays at least 24 frames; under 12 it is unreadable.',
      'One easing family per piece: 4-6 frame ease-out on entrances, no mixed bounce.',
      'Keep a safe area of 10% for platform crops (9:16, 1:1, 16:9).',
      'Limit to one moving element per shot; everything moving means nothing reads.',
      'Sync to the audio grid if music is present — cuts and hits land on the beat.',
      'Hold the end card at least 2 seconds with the brand and one action.',
      'Export H.264 at the target resolution with a constant frame rate, and check the first frame.'
    ]
  },
  {
    id: 'gs-grid-systems',
    title: 'Модульные сетки',
    titleEn: 'Grid systems',
    category: 'graphics',
    summary: 'Колонки, модули и поля как система, а не как линии',
    summaryEn: 'Columns, modules and margins as a system, not as lines',
    triggers: ['модульн сетк', 'grid system', 'сетка макет', 'baseline grid', 'columns layout'],
    rules: [
      'Choose the grid from the content: 12 columns for flexible pages, 6 for editorial, a module grid for cards.',
      'Set margins and gutters as multiples of one base unit so everything can align.',
      'Snap text to a baseline grid; images align to columns or modules, never to nothing.',
      'Break the grid deliberately once per layout at most, and only for the most important element.',
      'Keep the same grid across a series of pages so the eye learns the rhythm.',
      'Check the grid at the smallest supported width — a 12-column grid on mobile must collapse to 4.',
      'Do not draw the grid in the deliverable; it is a construction tool, not decoration.',
      'Document the grid (margins, columns, gutters, baseline) so the next designer can continue.'
    ]
  },
  {
    id: 'gs-art-direction',
    title: 'Арт-дирекшн',
    titleEn: 'Art direction',
    category: 'graphics',
    summary: 'Референсы, правила серии и единый визуальный язык',
    summaryEn: 'References, series rules, one visual language',
    triggers: ['арт-дирекшн', 'art direction', 'визуальный язык', 'moodboard', 'стиль проекта'],
    rules: [
      'Write the brief in three adjectives plus one anti-reference; every choice must trace to an adjective.',
      'Collect 6-10 references and name what exactly is borrowed from each (light, type, crop, palette).',
      'Define the rules that make a series coherent: crop ratio, light direction, palette, texture, type.',
      'Fix the palette and type before producing any single piece, not after ten of them.',
      'Shoot or generate one test asset first and judge it against the brief before scaling.',
      'Keep a "do not" list as long as the "do" list — the bans are what make the style recognisable.',
      'Review the set as a contact sheet: inconsistencies in tone or crop show up instantly.',
      'Hand off with a one-page style guide plus the raw files and the naming convention.'
    ]
  }
]
