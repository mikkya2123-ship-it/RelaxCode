/**
 * Dev helper: dumps the exact NSIS script electron-builder pipes to
 * makensis (shared header + final header + our installer.nsi), then runs
 * the normal build. Usage: node scripts/dump-nsis-script.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const Module = require('node:module')
const origCompile = Module._extensions['.js']
let patched = false
Module._extensions['.js'] = function (module, filename) {
  origCompile(module, filename)
  if (!patched && filename.includes('app-builder-lib') && filename.endsWith('NsisTarget.js')) {
    patched = true
    const proto = module.exports.NsisTarget.prototype
    const original = proto.executeMakensis
    proto.executeMakensis = async function (defines, commands, script) {
      fs.writeFileSync(path.join(process.cwd(), 'build', 'nsis-script-dump.nsi'), script)
      console.log('[dump] build/nsis-script-dump.nsi written,', script.length, 'chars')
      return original.apply(this, arguments)
    }
  }
}

process.argv = [process.argv[0], require.resolve('electron-builder/cli.js'), '--win']
require(require.resolve('electron-builder/cli.js'))
