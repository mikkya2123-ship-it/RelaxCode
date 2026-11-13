// one-off: regenerate electron-builder's temp messages.nsh for manual makensis
// runs (mirrors computeCustomMessageTranslations from app-builder-lib)
const fs = require('fs')
const path = require('path')
const yaml = require('../node_modules/js-yaml')
const lib = require('../node_modules/app-builder-lib/out/util/langs.js')
const lcid = lib.lcid
// the languages the generated addLangs macro inserts (MUI names); fallback
// LangStrings must cover every one of them or NSIS warns 6040
const nameToLcid = {
  English: 1033,
  German: 1031,
  French: 1036,
  SpanishInternational: 3082,
  SimpChinese: 2052,
  TradChinese: 1028,
  Japanese: 1041,
  Korean: 1042,
  Italian: 1040,
  Dutch: 1043,
  Danish: 1030,
  Swedish: 1053,
  Norwegian: 1044,
  Finnish: 1035,
  Russian: 1049,
  Portuguese: 2070,
  PortugueseBR: 1046,
  Polish: 1045,
  Ukrainian: 1058,
  Czech: 1029,
  Slovak: 1051,
  Hungarian: 1038,
  Arabic: 1025,
  Turkish: 1055,
  Thai: 1054,
  Vietnamese: 1066
}
const WIZARD_LANGS = ['English', 'German', 'French', 'SpanishInternational', 'SimpChinese', 'TradChinese', 'Japanese', 'Korean', 'Italian', 'Dutch', 'Danish', 'Swedish', 'Norwegian', 'Finnish', 'Russian', 'Portuguese', 'PortugueseBR', 'Polish', 'Ukrainian', 'Czech', 'Slovak', 'Hungarian', 'Arabic', 'Turkish', 'Thai', 'Vietnamese']
// every NSIS language table that can end up loaded (MUI_LANGUAGE plus the
// per-language fallback tables); matches the list in
// scripts/build-installer-assets.mjs which was derived from the .nlf headers
const NSIS_LANG_IDS = [1025, 1026, 1027, 1028, 1029, 1030, 1031, 1032, 1033, 1034, 1035, 1036, 1037, 1038, 1039, 1040, 1041, 1042, 1043, 1044, 1045, 1046, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1055, 1057, 1058, 1059, 1060, 1061, 1062, 1063, 1065, 1066, 1067, 2092, 1069, 1071, 1078, 1079, 1081, 1086, 1089, 1091, 1092, 1104, 1106, 1107, 1110, 1123, 1130, 1136, 1150, 1155, 1169, 1536, 1537, 1538, 2052, 2068, 2070, 2074, 2108, 3082, 3098, 4103, 5146, 9997, 9998, 9999, 33280]
function allNsfLangIds() {
  const ids = new Set(WIZARD_LANGS.map((n) => nameToLcid[n]))
  for (const id of NSIS_LANG_IDS) ids.add(id)
  return [...ids]
}
const messagesDir = path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'templates', 'nsis')

function nsisEscapeString(s) {
  return String(s)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\$(?![{(])/g, '$$$$')
    .replace(/"/g, '$\\"')
}

function generate(ymlPath, outPath) {
  const data = yaml.load(fs.readFileSync(ymlPath, 'utf8'))
  const wizardIds = allNsfLangIds(nsisLangDir)
  const result = []
  for (const messageId of Object.keys(data)) {
    const translations = data[messageId]
    const emitted = new Set()
    for (const lang of Object.keys(translations)) {
      const withRegion = lib.toLangWithRegion(lang)
      const id = lcid[withRegion]
      if (id == null) continue
      const text = nsisEscapeString(translations[lang])
      result.push(`LangString ${messageId} ${id} "${text}"`)
      emitted.add(id)
    }
    for (const id of wizardIds) {
      if (emitted.has(id)) continue
      const text = nsisEscapeString(translations.en)
      result.push(`LangString ${messageId} ${id} "${text}"`)
      emitted.add(id)
    }
  }
  fs.writeFileSync(outPath, result.join('\n'))
  console.log(outPath, result.length, 'LangStrings')
}

const outDir = process.argv[2]
const nsisLangDir = 'C:/Users/Misha/AppData/Local/electron-builder/Cache/nsis/nsis-3.0.4.1/Contrib/Language files'
generate(path.join(messagesDir, 'messages.yml'), path.join(outDir, '2-messages.nsh'))
generate(path.join(messagesDir, 'assistedMessages.yml'), path.join(outDir, '3-messages.nsh'))
