/** Validate the shipping installer configuration, rather than unused bitmap mockups. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const nsis = pkg.build.nsis
assert.equal(nsis.script, undefined, 'Use the maintained electron-builder wizard')
assert.equal(nsis.oneClick, false)
assert.equal(nsis.allowToChangeInstallationDirectory, true)
assert.equal(nsis.perMachine, false)
assert.equal(nsis.deleteAppDataOnUninstall, false)
assert.deepEqual(nsis.installerLanguages, ['ru_RU', 'en_US'])
assert.ok(fs.existsSync(new URL('../' + nsis.license, import.meta.url)))
const license = fs.readFileSync(new URL('../' + nsis.license, import.meta.url), 'utf8')
assert.equal(license.charCodeAt(0), 0xfeff, 'NSIS license must have a UTF-8 BOM')
assert.ok(license.includes('Условия использования'), 'Russian license text must survive encoding')
assert.ok(!license.includes('?'), 'License must not contain corrupted characters')
assert.equal(pkg.build.publish[0].provider, 'github')
console.log('Installer configuration checks passed')
