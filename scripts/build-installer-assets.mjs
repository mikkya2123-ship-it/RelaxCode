/**
 * Builds the custom installer art for the RelaxCode NSIS wizard — pure
 * Node orchestration, rendering delegated to GDI+ via a small PowerShell
 * runner (scripts/installer-assets.ps1).
 *
 * Reads build/installer/theme.json (colors, texts, geometry), preprocesses
 * the mascot (black background keyed out to alpha), emits a JSON render
 * spec, invokes the renderer and verifies the produced BMPs. Also writes
 * build/installer/theme.nsh so the NSIS script shares the exact same
 * geometry and colors, and PNG page previews into build/installer/preview/
 * for quick visual iteration without building the installer.
 *
 * Run with: npm run installer:assets
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { decodePng, encodePng, boxDownsample } from './lib/png-codec.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INSTALLER_DIR = path.join(ROOT, 'build', 'installer')
const ASSETS_DIR = path.join(INSTALLER_DIR, 'assets')
const PREVIEW_DIR = path.join(INSTALLER_DIR, 'preview')
const LICENSES_DIR = path.join(INSTALLER_DIR, 'licenses')

const theme = JSON.parse(readFileSync(path.join(INSTALLER_DIR, 'theme.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const LANGS = ['ru', 'en']

const { width: W, height: H, barHeight: BAR_H, margin: M, contentMargin: C } = theme.window
const PAGE_H = H - BAR_H
const BAR_Y = H - BAR_H
const BTN_Y = BAR_Y + Math.floor((BAR_H - theme.buttons.height) / 2)
const { width: BTN_W, height: BTN_H, bigWidth: BIG_W, bigHeight: BIG_H, smallWidth: SMALL_W, radius: BTN_R } = theme.buttons
const SMALL_H = 44
const NEXT_X = W - M - BTN_W
const BACK_X = NEXT_X - 12 - BTN_W
const CARD_W = 426
const CARD_H = 96
const CARD1_X = C
const CARD2_X = W - C - CARD_W
const CARD_Y = 116
const FONT = theme.fonts

mkdirSync(ASSETS_DIR, { recursive: true })
mkdirSync(PREVIEW_DIR, { recursive: true })

/* ------------------------------ mascot prep ------------------------------- */

function keyMascot() {
  const source = decodePng(readFileSync(path.join(ROOT, 'src/renderer/src/assets/app-logo-dark.png')))
  // The drawing is white strokes on opaque black; alpha = brightness.
  for (let i = 0; i < source.pixels.length; i += 4) {
    const a = Math.max(source.pixels[i], source.pixels[i + 1], source.pixels[i + 2])
    source.pixels[i] = 255
    source.pixels[i + 1] = 255
    source.pixels[i + 2] = 255
    source.pixels[i + 3] = a
  }
  const small = boxDownsample(source.width, source.height, source.pixels, 2)
  writeFileSync(path.join(ASSETS_DIR, 'mascot-white.png'), encodePng(small.width, small.height, small.pixels))
}
keyMascot()

/* ------------------------------ shared pieces ----------------------------- */

const specFiles = []

function file(name, width, height, ops, extra = {}) {
  const out = { name, width, height, ops, ...extra }
  if (out.previewButtons) {
    out.previewButtons = out.previewButtons.map((b) => (/\.\w+$/.test(b.asset) ? b : { ...b, asset: `${b.asset}.bmp` }))
  }
  specFiles.push(out)
}

function barBase() {
  return [
    { t: 'rect', x: 0, y: BAR_Y, w: W, h: BAR_H, fill: c('panel') },
    { t: 'line', x1: 0, y1: BAR_Y, x2: W, y2: BAR_Y, color: c('border'), sw: 1 }
  ]
}

function button(assetBase, text, style, w, h, size, surface = 'panel') {
  const ops = []
  const r = BTN_R
  const palette = {
    primary: { fill: c('fg'), text: c('fgOnAccent'), glass: '#FFFFFF59', shade: '#00000012' },
    disabled: { fill: c('secondary'), text: c('tertiary'), glass: null },
    ghost: { fill: c('secondary'), text: c('fg'), glass: '#FFFFFF12' },
    destructive: { fill: c('destructive'), text: '#ffffff', glass: '#FFFFFF45' }
  }[style]
  // BMP has no alpha: corners must be baked in the color of the surface the
  // button sits on (bottom bar panel or page background).
  ops.push({ t: 'rect', x: 0, y: 0, w, h, fill: c(surface) })
  ops.push({ t: 'round', x: 0, y: 0, w, h, r, fill: palette.fill, stroke: style === 'primary' || style === 'destructive' ? null : c('border'), sw: 1 })
  if (palette.glass) {
    ops.push({ t: 'clip', x: 0, y: 0, w, h, r })
    ops.push({ t: 'grad', x: 2, y: 1, w: w - 4, h: Math.round(h * 0.4), from: palette.glass, to: '#FFFFFF00' })
    ops.push({ t: 'grad', x: 2, y: h - Math.round(h * 0.28), w: w - 4, h: Math.round(h * 0.28), from: '#00000000', to: palette.shade ?? '#00000000' })
    ops.push({ t: 'clipEnd' })
  }
  ops.push({ t: 'text', text, x: Math.round(w / 2), y: Math.round((h - size * 1.35) / 2), size, family: FONT.semibold, color: palette.text, align: 'c' })
  file(`${assetBase}.bmp`, w, h, ops)
}

function modeCard(assetBase, title, sub, selected) {
  const ops = [{ t: 'rect', x: 0, y: 0, w: CARD_W, h: CARD_H, fill: c('bg') }]
  ops.push({ t: 'round', x: 0, y: 0, w: CARD_W, h: CARD_H, r: 12, fill: selected ? c('cardSelected') : c('card'), stroke: selected ? c('accent') : c('border'), sw: selected ? 2 : 1 })
  // user glyph: head circle + shoulder arc
  ops.push({ t: 'circle', cx: 46, cy: 38, r: 8, stroke: c('muted'), sw: 2 })
  ops.push({ t: 'arc', cx: 46, cy: 66, rx: 14, ry: 12, start: 180, sweep: 180, color: c('muted'), sw: 2 })
  if (assetBase.startsWith('card-all')) {
    ops.push({ t: 'circle', cx: 40, cy: 38, r: 7, stroke: c('muted'), sw: 2 })
    ops.push({ t: 'arc', cx: 40, cy: 64, rx: 12, ry: 10, start: 180, sweep: 180, color: c('muted'), sw: 2 })
    ops.push({ t: 'circle', cx: 60, cy: 40, r: 5, stroke: c('muted'), sw: 2 })
    ops.push({ t: 'arc', cx: 60, cy: 62, rx: 9, ry: 8, start: 180, sweep: 180, color: c('muted'), sw: 2 })
  }
  ops.push({ t: 'text', text: title, x: 84, y: 28, size: 16, family: FONT.medium, color: c('fg'), align: 'l' })
  ops.push({ t: 'text', text: sub, x: 84, y: 56, size: 12, family: FONT.medium, color: c('muted'), align: 'l' })
  // radio dot on the right
  const rx = CARD_W - 30
  if (selected) {
    ops.push({ t: 'circle', cx: rx, cy: CARD_H / 2, r: 8, fill: c('accent') })
    ops.push({ t: 'circle', cx: rx, cy: CARD_H / 2, r: 3, fill: c('fgOnAccent') })
  } else {
    ops.push({ t: 'circle', cx: rx, cy: CARD_H / 2, r: 8, stroke: c('tertiary'), sw: 2 })
  }
  file(`${assetBase}.bmp`, CARD_W, CARD_H, ops)
}

function c(name) {
  return theme.colors[name]
}

const T = theme.texts

/* -------------------------------- buttons --------------------------------- */

function rasterCheckbox(state) {
  const ops = [
    { t: 'rect', x: 0, y: 0, w: 20, h: 20, fill: c('bg') },
    {
      t: 'round', x: 1, y: 1, w: 18, h: 18, r: 6,
      fill: state ? c('fg') : c('card'),
      stroke: state ? null : c('inputBorder'), sw: 1
    }
  ]
  if (state) ops.push({ t: 'check', x: 5, y: 7, size: 10, color: c('fgOnAccent'), sw: 2 })
  file(`cb-${state ? 'on' : 'off'}.bmp`, 20, 20, ops)
}
rasterCheckbox(false)
rasterCheckbox(true)

// NOTE: the raster nav buttons (btn-next, cards, checkboxes) were dropped:
// click routing for plugin-created controls does not survive real mouse
// input, so the wizard uses the NATIVE wizard buttons (controls 1/2/3)
// moved into the bottom bar by RelaxBarSetup (build/installer/ui.nsh).
// The button()/modeCard() helpers above stay for a future comeback.

/* --------------------------------- pages ---------------------------------- */

const IMG_MASCOT = path.join(ASSETS_DIR, 'mascot-white.png')
const IMG_ICON = path.join(ROOT, 'build', 'icon-256.png')

function welcomePage(lang) {
  const t = T.welcome
  const ops = [
    { t: 'rect', x: 0, y: 0, w: W, h: PAGE_H, fill: c('bg') },
    { t: 'grad', x: 0, y: 0, w: 360, h: PAGE_H, from: c('bgArtTop'), to: c('bgArtBottom') },
    { t: 'line', x1: 360, y1: 0, x2: 360, y2: PAGE_H, color: c('border'), sw: 1 },
    { t: 'glow', cx: 180, cy: 310, rx: 150, ry: 150, color: '#7a6eff24' },
    { t: 'img', src: IMG_ICON, x: 48, y: 48, w: 84, h: 84 },
    { t: 'text', text: 'RelaxCode', x: 148, y: 74, size: 22, family: FONT.semibold, color: c('fg'), align: 'l' },
    { t: 'img', src: IMG_MASCOT, x: 65, y: 195, w: 230, h: 230 },
    { t: 'text', text: `v${pkg.version}`, x: 180, y: 468, size: 13, family: FONT.medium, color: c('muted'), align: 'c' },
    { t: 'text', text: t.titleLines[lang][0], x: 420, y: 142, size: 28, family: FONT.semibold, color: c('fg'), align: 'l' },
    { t: 'text', text: t.titleLines[lang][1], x: 420, y: 180, size: 28, family: FONT.semibold, color: c('fg'), align: 'l' },
    { t: 'text', text: t.subLines[lang][0], x: 420, y: 246, size: 15, family: FONT.medium, color: c('muted'), align: 'l' },
    { t: 'text', text: t.subLines[lang][1], x: 420, y: 270, size: 15, family: FONT.medium, color: c('muted'), align: 'l' }
  ]
  const features = t.features[lang]
  for (let i = 0; i < features.length; i += 1) {
    const y = 330 + i * 56
    ops.push({ t: 'round', x: 420, y, w: 24, h: 24, r: 7, fill: '#58c07c26', stroke: '#58c07c59', sw: 1 })
    ops.push({ t: 'check', x: 425, y: y + 6, size: 13, color: c('success'), sw: 2 })
    ops.push({ t: 'text', text: features[i], x: 458, y: y + 2, size: 14, family: FONT.medium, color: c('fg'), align: 'l' })
  }
  return ops
}

function licensePage(lang) {
  const ops = [
    { t: 'rect', x: 0, y: 0, w: W, h: PAGE_H, fill: c('bg') },
    { t: 'text', text: T.license.title[lang], x: C, y: 40, size: 26, family: FONT.semibold, color: c('fg'), align: 'l' },
    { t: 'text', text: T.license.sub[lang], x: C, y: 82, size: 14, family: FONT.medium, color: c('muted'), align: 'l' },
    { t: 'round', x: C, y: 116, w: W - 2 * C, h: 346, r: 12, fill: c('card'), stroke: c('border'), sw: 1 }
  ]
  // bake the license text into the card — no native edit control needed
  const text = readFileSync(path.join(ASSETS_DIR, `license-${lang}.txt`), 'utf8')
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length && i < 15; i += 1) {
    ops.push({ t: 'text', text: lines[i], x: C + 24, y: 140 + i * 22, size: 13, family: FONT.regular, color: c('fg'), align: 'l' })
  }
  ops.push({ t: 'text', text: T.license.accept[lang], x: C, y: 490, size: 13, family: FONT.medium, color: c('muted'), align: 'l' })
  return ops
}

function dirPage(lang) {
  return [
    { t: 'rect', x: 0, y: 0, w: W, h: PAGE_H, fill: c('bg') },
    { t: 'text', text: T.dir.title[lang], x: C, y: 40, size: 26, family: FONT.semibold, color: c('fg'), align: 'l' },
    { t: 'text', text: T.dir.sub[lang], x: C, y: 82, size: 14, family: FONT.medium, color: c('muted'), align: 'l' },
    { t: 'text', text: T.dir.pathLabel[lang], x: C, y: 258, size: 14, family: FONT.medium, color: c('muted'), align: 'l' },
    { t: 'round', x: C, y: 288, w: 740, h: 44, r: 10, fill: c('input'), stroke: c('inputBorder'), sw: 1 }
  ]
}

function finishPage(lang) {
  return [
    { t: 'rect', x: 0, y: 0, w: W, h: PAGE_H, fill: c('bg') },
    { t: 'glow', cx: 480, cy: 222, rx: 155, ry: 155, color: '#58c07c2b' },
    { t: 'img', src: IMG_MASCOT, x: 380, y: 122, w: 200, h: 200 },
    { t: 'text', text: T.finish.title[lang], x: 480, y: 342, size: 30, family: FONT.semibold, color: c('fg'), align: 'c' },
    { t: 'text', text: T.finish.sub[lang], x: 480, y: 396, size: 15, family: FONT.medium, color: c('muted'), align: 'c' }
  ]
}

function unconfirmPage(lang) {
  const t = T.unconfirm
  const ops = [
    { t: 'rect', x: 0, y: 0, w: W, h: PAGE_H, fill: c('bg') },
    { t: 'glow', cx: 480, cy: 155, rx: 115, ry: 115, color: '#e5484d1f' },
    { t: 'img', src: IMG_MASCOT, x: 410, y: 85, w: 140, h: 140 },
    { t: 'text', text: t.title[lang], x: 480, y: 268, size: 26, family: FONT.semibold, color: c('fg'), align: 'c' },
    { t: 'text', text: t.subLines[lang][0], x: 480, y: 316, size: 14, family: FONT.medium, color: c('muted'), align: 'c' },
    { t: 'text', text: t.subLines[lang][1], x: 480, y: 340, size: 14, family: FONT.medium, color: c('muted'), align: 'c' }
  ]
  return ops
}

function unfinishPage(lang) {
  return [
    { t: 'rect', x: 0, y: 0, w: W, h: PAGE_H, fill: c('bg') },
    { t: 'glow', cx: 480, cy: 185, rx: 125, ry: 125, color: '#58c07c20' },
    { t: 'img', src: IMG_MASCOT, x: 420, y: 128, w: 120, h: 120 },
    { t: 'text', text: T.unfinish.title[lang], x: 480, y: 292, size: 26, family: FONT.semibold, color: c('fg'), align: 'c' },
    { t: 'text', text: T.unfinish.sub[lang], x: 480, y: 340, size: 14, family: FONT.medium, color: c('muted'), align: 'c' }
  ]
}

/* preview-only mock of the native checkbox inside the card */
function licensePreviewExtras(lang) {
  return [
    { t: 'img', src: 'cb-off.bmp', x: C + 4, y: 486 },
    { t: 'text', text: T.license.accept[lang], x: C + 36, y: 488, size: 14, family: FONT.medium, color: c('muted'), align: 'l' }
  ]
}

for (const lang of LANGS) {
  file(`page-welcome-${lang}.bmp`, W, PAGE_H, welcomePage(lang))
  file(`page-license-${lang}.bmp`, W, PAGE_H, licensePage(lang))
  file(`page-dir-${lang}.bmp`, W, PAGE_H, dirPage(lang))
  file(`page-finish-${lang}.bmp`, W, PAGE_H, finishPage(lang))
  file(`page-unconfirm-${lang}.bmp`, W, PAGE_H, unconfirmPage(lang))
  file(`page-unfinish-${lang}.bmp`, W, PAGE_H, unfinishPage(lang))
}

/* ------------------------------ licenses copy ------------------------------ */

for (const lang of LANGS) {
  const source = path.join(LICENSES_DIR, `${lang}.txt`)
  if (!existsSync(source)) throw new Error(`missing license text: ${source}`)
  copyFileSync(source, path.join(ASSETS_DIR, `license-${lang}.txt`))
}

/* ------------------------------ run renderer ------------------------------- */

const spec = { assetsDir: ASSETS_DIR, previewDir: PREVIEW_DIR, fontFile: path.join(INSTALLER_DIR, FONT.file), files: specFiles }
const specPath = path.join(INSTALLER_DIR, 'spec.json')
writeFileSync(specPath, JSON.stringify(spec, null, 2))

const ps = spawnSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(ROOT, 'scripts', 'installer-assets.ps1'),
  '-Spec', specPath
], { stdio: 'inherit', windowsHide: true })
if (ps.status !== 0) throw new Error(`renderer failed with code ${ps.status}`)

/* -------------------------------- verify ----------------------------------- */

let count = 0
for (const f of specFiles) {
  const target = path.join(ASSETS_DIR, f.name)
  const buf = readFileSync(target)
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error(`${f.name}: bad BMP magic`)
  const w = buf.readInt32LE(18)
  const h = buf.readInt32LE(22)
  if (w !== f.width || Math.abs(h) !== f.height) throw new Error(`${f.name}: size ${w}x${h}, expected ${f.width}x${f.height}`)
  count += 1
  const preview = path.join(PREVIEW_DIR, f.name.replace(/\.bmp$/, '.png'))
  if (!existsSync(preview)) throw new Error(`missing preview: ${preview}`)
}
console.log(`installer assets: ${count} bmp verified + previews in build/installer/preview/`)

/* ------------------------------- lang.nsh --------------------------------- */

// NSIS warns (6040) when a referenced LangString misses a loaded language
// table; the wizard loads a table for every .nlf bundled with NSIS, so our
// strings are emitted with English fallbacks for all of them (ru overrides).
const NSIS_LANG_IDS = [1025, 1026, 1027, 1028, 1029, 1030, 1031, 1032, 1033, 1034, 1035, 1036, 1037, 1038, 1039, 1040, 1041, 1042, 1043, 1044, 1045, 1046, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1055, 1057, 1058, 1059, 1060, 1061, 1062, 1063, 1065, 1066, 1067, 2092, 1069, 1071, 1078, 1079, 1081, 1086, 1089, 1091, 1092, 1104, 1106, 1107, 1110, 1123, 1130, 1136, 1150, 1155, 1169, 1536, 1537, 1538, 2052, 2068, 2070, 2074, 2108, 3082, 3098, 4103, 5146, 9997, 9998, 9999, 33280]
const LANG_STRINGS = {
  relaxWindowTitle: { ru: 'RelaxCode — Установка', en: 'RelaxCode — Setup' },
  relaxUnWindowTitle: { ru: 'RelaxCode — Удаление', en: 'RelaxCode — Uninstall' },
  relaxInstallBtn: { ru: 'Установить', en: 'Install' },
  relaxLaunch: { ru: 'Запустить RelaxCode', en: 'Launch RelaxCode' },
  relaxUninstallBtn: { ru: 'Удалить', en: 'Uninstall' },
  relaxFinishBtn: { ru: 'Готово', en: 'Done' },
  relaxInstallTitle: { ru: 'Устанавливаем RelaxCode…', en: 'Installing RelaxCode…' },
  relaxSpaceAvailable: { ru: 'Доступно на диске: $R1 ГБ', en: 'Free space: $R1 GB' },
  relaxAdminNote: { ru: 'Потребуются права администратора.', en: 'Administrator rights will be requested.' }
}

function generateLangNsh() {
  const lines = [
    '; Generated by scripts/build-installer-assets.mjs — do not edit by hand.',
    '; Strings mirror the flat ru/en keys of src/shared/i18n.ts; every NSIS',
    '; language table gets an English fallback, Russian overrides where present.'
  ]
  for (const [key, value] of Object.entries(LANG_STRINGS)) {
    for (const id of NSIS_LANG_IDS) {
      const text = id === 1049 ? value.ru : value.en
      lines.push(`LangString ${key} ${id} "${text}"`)
    }
  }
  writeFileSync(path.join(INSTALLER_DIR, 'lang.nsh'), lines.join('\n') + '\n')
  console.log(`lang.nsh: ${Object.keys(LANG_STRINGS).length} strings x ${NSIS_LANG_IDS.length} languages`)
}

generateLangNsh()

/* ------------------------------- theme.nsh -------------------------------- */

function nsisColor(hex) {
  const value = hex.replace('#', '').slice(0, 6).toUpperCase()
  return `0x${value}`
}

/** COLORREF is 0x00BBGGRR — progress bar messages want BGR order. */
function nsisColorBgr(hex) {
  const value = hex.replace('#', '').slice(0, 6)
  return `0x${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`.toUpperCase()
}

const lines = [
  '; Generated by scripts/build-installer-assets.mjs from theme.json — do not edit by hand.',
  `!define RELAX_WINDOW_W ${W}`,
  `!define RELAX_WINDOW_H ${H}`,
  `!define RELAX_PAGE_H ${PAGE_H}`,
  `!define RELAX_BAR_H ${BAR_H}`,
  `!define RELAX_BAR_Y ${BAR_Y}`,
  `!define RELAX_MARGIN ${M}`,
  `!define RELAX_CONTENT_MARGIN ${C}`,
  `!define RELAX_BTN_W ${BTN_W}`,
  `!define RELAX_BTN_H ${BTN_H}`,
  `!define RELAX_BTN_X ${NEXT_X}`,
  `!define RELAX_BTN_BACK_X ${BACK_X}`,
  `!define RELAX_BTN_Y ${BTN_Y}`,
  `!define RELAX_BTN_SMALL_W ${SMALL_W}`,
  `!define RELAX_BTN_SMALL_H ${SMALL_H}`,
  `!define RELAX_BTN_BROWSE_X 800`,
  `!define RELAX_BTN_BROWSE_Y 288`,
  `!define RELAX_BIG_W ${BIG_W}`,
  `!define RELAX_BIG_H ${BIG_H}`,
  `!define RELAX_BIG_X ${Math.floor((W - BIG_W) / 2)}`,
  `!define RELAX_BIG_Y 446`,
  `!define RELAX_CARD_W ${CARD_W}`,
  `!define RELAX_CARD_H ${CARD_H}`,
  `!define RELAX_CARD1_X ${CARD1_X}`,
  `!define RELAX_CARD2_X ${CARD2_X}`,
  `!define RELAX_CARD_Y ${CARD_Y}`,
  `!define RELAX_LICENSE_CARD_X ${C}`,
  `!define RELAX_LICENSE_CARD_Y 116`,
  `!define RELAX_LICENSE_CARD_W ${W - 2 * C}`,
  `!define RELAX_LICENSE_CARD_H 346`,
  `!define RELAX_LICENSE_EDIT_X ${C + 12}`,
  `!define RELAX_LICENSE_EDIT_Y 128`,
  `!define RELAX_LICENSE_EDIT_W ${W - 2 * C - 24}`,
  `!define RELAX_LICENSE_EDIT_H 322`,
  `!define RELAX_CHECK_X ${C + 4}`,
  `!define RELAX_CHECK_Y 484`,
  `!define RELAX_CHECK_TEXT_X ${C + 36}`,
  `!define RELAX_UNCHECK_X 280`,
  `!define RELAX_UNCHECK_Y 410`,
  `!define RELAX_PATH_LABEL_X ${C}`,
  `!define RELAX_PATH_LABEL_Y 258`,
  `!define RELAX_PATH_X ${C}`,
  `!define RELAX_PATH_Y 288`,
  `!define RELAX_PATH_W 740`,
  `!define RELAX_PATH_H 44`,
  `!define RELAX_PATH_EDIT_X ${C + 12}`,
  `!define RELAX_PATH_EDIT_Y 296`,
  `!define RELAX_PATH_EDIT_W 716`,
  `!define RELAX_PATH_EDIT_H 28`,
  `!define RELAX_SPACE_X ${C}`,
  `!define RELAX_SPACE_Y 356`,
  `!define RELAX_NOTE_X ${C}`,
  `!define RELAX_NOTE_Y 388`,
  `!define RELAX_STATUS_X ${C}`,
  `!define RELAX_STATUS_Y 196`,
  `!define RELAX_STATUS_W ${W - 2 * C}`,
  `!define RELAX_STATUS_H 22`,
  `!define RELAX_PROGRESS_X ${C}`,
  `!define RELAX_PROGRESS_Y 248`,
  `!define RELAX_PROGRESS_W ${W - 2 * C}`,
  `!define RELAX_PROGRESS_H 8`,
  `!define RELAX_FONT_NAME "${FONT.regular}"`,
  `!define RELAX_FONT_MEDIUM "${FONT.medium}"`,
  `!define RELAX_FONT_SEMIBOLD "${FONT.semibold}"`,
  `!define RELAX_BG ${nsisColor(theme.colors.bg)}`,
  `!define RELAX_PANEL ${nsisColor(theme.colors.panel)}`,
  `!define RELAX_FG ${nsisColor(theme.colors.fg)}`,
  `!define RELAX_MUTED ${nsisColor(theme.colors.muted)}`,
  `!define RELAX_CARD ${nsisColor(theme.colors.card)}`,
  `!define RELAX_INPUT ${nsisColor(theme.colors.input)}`,
  `!define RELAX_BORDER ${nsisColor(theme.colors.border)}`,
  `!define RELAX_ACCENT ${nsisColor(theme.colors.accent)}`,
  `!define RELAX_DESTRUCTIVE ${nsisColor(theme.colors.destructive)}`,
  `!define RELAX_ACCENT_BGR ${nsisColorBgr(theme.colors.accent)}`,
  `!define RELAX_DESTRUCTIVE_BGR ${nsisColorBgr(theme.colors.destructive)}`,
  `!define RELAX_CARD_BGR ${nsisColorBgr(theme.colors.card)}`
]
writeFileSync(path.join(INSTALLER_DIR, 'theme.nsh'), lines.join('\n') + '\n')
console.log(`theme.nsh: ${lines.length - 1} defines`)
