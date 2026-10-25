/**
 * Blender recipes: every generated script must be structurally sound Python
 * with the prelude, and arguments must flow into the code safely.
 * Run with: npm run test:recipes
 */
import { BLENDER_RECIPES, recipeNames } from '../src/shared/blender-recipes.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const names = recipeNames()
check('the palette has the core recipes', ['clear_scene', 'terrain', 'forest', 'rocks', 'sunset_light', 'moon_light', 'camera_shot', 'render_preview', 'material_color', 'save_blend'].every((n) => names.includes(n)), names)
check('every recipe has a description', names.every((n) => BLENDER_RECIPES[n].description.length > 10))
check('every recipe has a params schema', names.every((n) => BLENDER_RECIPES[n].params?.type === 'object'))

for (const name of names) {
  const code = BLENDER_RECIPES[name].python({})
  check(`${name}: compiles a script with the prelude`, code.includes('_result(') && code.includes('import bpy'))
  check(`${name}: braces balance`, (code.match(/\(/g) ?? []).length === (code.match(/\)/g) ?? []).length)
  check(`${name}: brackets balance`, (code.match(/\[/g) ?? []).length === (code.match(/\]/g) ?? []).length)
  check(`${name}: no template leftovers`, !code.includes('${') && !code.includes('undefined') && !code.includes('NaN'))
}

const forest = BLENDER_RECIPES.forest.python({ count: 20, area: 25 })
check('forest: arguments land in the code', forest.includes('int(20)') && forest.includes('25'))
check('forest: greens are tuples', /\[\(\d+, \d+, \d+\), \(\d+, \d+, \d+\)/.test(forest))
check('forest: the ground search is a simple nearest-vertex loop', forest.includes('best = None'))

const sunset = BLENDER_RECIPES.sunset_light.python({ fog: false })
check('sunset: fog=false removes the mist block', !sunset.includes('mist_settings.use_mist'))
const sunsetFog = BLENDER_RECIPES.sunset_light.python({})
check('sunset: fog on by default', sunsetFog.includes('mist_settings.use_mist = True'))
check('sunset: density stays in range', /intensity = 0\.00\d/.test(sunsetFog))

const render = BLENDER_RECIPES.render_preview.python({ engine: 'cycles', filename: 'my render.png' })
check('render: engine maps to CYCLES', render.includes("'CYCLES'"))
check('render: a dangerous file name is sanitised', render.includes('my_render.png') && !render.includes('my render'))

const save = BLENDER_RECIPES.save_blend.python({ filename: 'scene 2.blend' })
check('save: spaces become underscores', save.includes("scene_2.blend"))

const tint = BLENDER_RECIPES.material_color.python({ name: 'Cube', color: '0xff0000' })
check('tint: the color reaches the material', tint.includes('FF') || tint.includes('255, 0, 0'))

check('tint: a bad color falls back, never breaks codegen', BLENDER_RECIPES.material_color.python({ name: 'Cube', color: 'red' }).includes('(204, 122, 58)'))
check('unknown args are ignored safely', BLENDER_RECIPES.terrain.python({ size: 'huge' }).includes('size = 40'))

if (failed > 0) {
  console.log(`\n${failed} RECIPE CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nALL RECIPE CHECKS PASSED')
