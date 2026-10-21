/**
 * Figure engine checks: the expression parser that powers graphs, the loose
 * input normalizer and the SVG the chat card shows.
 * Run with: npm run test:figures
 */
import {
  compileExpression,
  escapeXml,
  evaluateExpression,
  figurePoints,
  formatNumber,
  moveFigurePoint,
  normalizeFigureSpec,
  renderFigureSvg,
  snapValue
} from '../src/shared/figures.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* ------------------------------ expressions ------------------------------ */

const near = (value, expected, epsilon = 1e-9) => Math.abs(value - expected) <= epsilon

check('power', near(evaluateExpression('x^2', 3), 9))
check('power is right-associative', near(evaluateExpression('2^3^2'), 512))
check('multiplication binds tighter than addition', near(evaluateExpression('2+3*4'), 14))
check('parentheses', near(evaluateExpression('(2+3)*4'), 20))
check('unary minus', near(evaluateExpression('-x^2', 3), -9))
check('implicit multiplication with x', near(evaluateExpression('2x', 4), 8))
check('implicit multiplication before parenthesis', near(evaluateExpression('3(x+1)', 2), 9))
check('constants', near(evaluateExpression('pi', 0), Math.PI))
check('functions', near(evaluateExpression('sin(0) + cos(0)'), 1))
check('nested functions', near(evaluateExpression('sqrt(abs(-16))'), 4))
check('log is base ten', near(evaluateExpression('log(100)'), 2))
check('ln is natural', near(evaluateExpression('ln(e)'), 1))
check('mod is positive for negative input', near(evaluateExpression('mod(-1, 5)'), 4))
check('double star is a power', near(evaluateExpression('2**5'), 32))
check('division by zero is not a crash', !Number.isFinite(evaluateExpression('1/0')))
check('invalid syntax is rejected', compileExpression('x +') === null)
check('unknown identifier is rejected', compileExpression('window') === null)
check('code injection is rejected', compileExpression('process.exit(1)') === null)
check('assignment is rejected', compileExpression('x = 2') === null)
check('overlong expression is rejected', compileExpression('x+'.repeat(120) + 'x') === null)

/* ------------------------------- formatting ------------------------------ */

check('format trims trailing zeros', formatNumber(2.5) === '2.5')
check('format rounds to two decimals', formatNumber(1 / 3) === '0.33')
check('format has no negative zero', formatNumber(-0.0001) === '0')
check('xml escapes every dangerous character', escapeXml('<a href="x">&\'') === '&lt;a href=&quot;x&quot;&gt;&amp;&apos;')

/* ------------------------------- normalizing ----------------------------- */

const loose = normalizeFigureSpec({
  title: 'Adjacent angles',
  elements: [
    { type: 'point', at: [0, 0], label: 'O' },
    { type: 'segment', from: { x: -4, y: 0 }, to: [4, 0], label: 'AB' },
    { type: 'ray', from: [0, 0], to: [3, 3] },
    { type: 'angle', vertex: [0, 0], from: [4, 0], to: [3, 3] },
    { type: 'dimension', from: [0, 0], to: [3, 3] },
    { type: 'mystery', at: [1, 1] },
    { type: 'circle', center: [0, 0], radius: -2 }
  ],
  results: [{ label: '∠AOB', value: '45°', formula: 'atan(3/3)' }, { label: '', value: 'x' }],
  notes: ['The angles add up to 180°.']
})
check('normalizer keeps valid elements', loose.spec?.elements.length === 7, loose.spec?.elements)
check(
  'a segment labelled "AB" adds points A and B',
  loose.spec?.elements.some((element) => element.type === 'point' && element.label === 'A') === true &&
    loose.spec?.elements.some((element) => element.type === 'point' && element.label === 'B') === true,
  loose.spec?.elements
)
check('normalizer accepts {x,y} points', JSON.stringify(loose.spec?.elements[1])?.includes('[-4,0]'))
check('normalizer warns about unknown types', loose.warnings.some((warning) => warning.includes('mystery')))
check('normalizer warns about a bad circle', loose.warnings.some((warning) => warning.includes('circle')))
check('normalizer drops incomplete results', loose.spec?.results.length === 1)
check('normalizer rejects an empty figure', normalizeFigureSpec({ elements: [] }).spec === null)

// Models are not consistent about shapes; the common variants must work.
const asString = normalizeFigureSpec({
  elements: JSON.stringify([
    { type: 'point', at: [0, 0], label: 'A' },
    { type: 'segment', start: [0, 0], end: [2, 2] }
  ])
})
check('elements may arrive as a JSON string', asString.spec?.elements.length === 2, asString.warnings)

const angleByPoints = normalizeFigureSpec({
  elements: [{ type: 'angle', points: [[4, 0], [0, 0], [0, 3]] }]
})
const angleSvg = renderFigureSvg(angleByPoints.spec, { grid: false, theme: 'paper', results: true }).svg
check('an angle accepts points [A, O, B]', angleSvg.includes('90°'), angleSvg.slice(-400))

const graphAliases = normalizeFigureSpec({
  elements: [{ type: 'graph', function: 'x^2', xFrom: -2, xTo: 2 }]
})
const aliasSvg = renderFigureSvg(graphAliases.spec, { grid: false, theme: 'paper', results: true }).svg
check('a graph accepts function/xFrom/xTo', /<path d="M [^"]+"/.test(aliasSvg), graphAliases.warnings)

// Shapes that weak models (free endpoints) actually send for draw_figure.
const fenced = normalizeFigureSpec({
  elements: '```json\n[{"type":"point","at":[0,0],"label":"O"}]\n```'
})
check('elements may arrive as a fenced JSON string', fenced.spec?.elements.length === 1, fenced.warnings)

const singleElement = normalizeFigureSpec({ elements: { type: 'point', at: [1, 2], label: 'A' } })
check('elements may be a single element object', singleElement.spec?.elements.length === 1)

const namedMap = normalizeFigureSpec({
  elements: {
    first: { type: 'point', at: [0, 0] },
    second: { type: 'segment', from: [0, 0], to: [3, 4] }
  }
})
check('elements may be a name → element map', namedMap.spec?.elements.length === 2, namedMap.warnings)

const bareArray = normalizeFigureSpec([{ type: 'segment', from: [0, 0], to: [4, 0] }])
check('the whole argument may be the elements array', bareArray.spec?.elements.length === 1)

const bareElement = normalizeFigureSpec({ type: 'point', at: [0, 0], label: 'O' })
check('the whole argument may be one bare element', bareElement.spec?.elements.length === 1)

const nestedFigure = normalizeFigureSpec({
  figure: { elements: [{ type: 'circle', center: [0, 0], radius: 3 }] }
})
check('a spec nested under "figure" is found', nestedFigure.spec?.elements.length === 1)

const flatPoints = normalizeFigureSpec({ elements: [{ type: 'segment', points: [0, 0, 4, 0], label: '4' }] })
check(
  'a flat points array [x1,y1,x2,y2] becomes from/to',
  JSON.stringify(flatPoints.spec?.elements[0]?.from) === '[0,0]' &&
    JSON.stringify(flatPoints.spec?.elements[0]?.to) === '[4,0]',
  flatPoints.spec?.elements[0]
)

const flatPolygon = normalizeFigureSpec({
  elements: [{ type: 'polygon', points: [0, 0, 4, 0, 2, 3], filled: true }]
})
check('a flat points array becomes a polygon', flatPolygon.spec?.elements[0]?.points?.length === 3)

const stringPoint = normalizeFigureSpec({ elements: [{ type: 'point', at: '0,0', label: 'O' }] })
check('a point may arrive as the string "0,0"', JSON.stringify(stringPoint.spec?.elements[0]?.at) === '[0,0]')

const unreadable = normalizeFigureSpec({ title: 'Вертикальный угол', elements: 'not json at all' })
check('an unreadable elements string is reported', unreadable.spec === null && unreadable.warnings.some((warning) => warning.includes('not valid JSON')))

const noElements = normalizeFigureSpec({ title: 'Вертикальный угол', caption: 'двойной угол' })
check('missing elements still fails', noElements.spec === null)

/* --------------------------------- render -------------------------------- */

const render = renderFigureSvg(loose.spec, { grid: true, theme: 'paper', results: true })
check('svg has a viewBox', /^<svg [^>]*viewBox="0 0 720 [\d.]+"/.test(render.svg), render.svg.slice(0, 120))
check('svg contains the title', render.svg.includes('Adjacent angles'))
check('angle without a label prints its measure', render.svg.includes('45°'), render.svg.slice(-600))
check('dimension without a label prints its length', render.svg.includes('4.24'))
check('grid is drawn', render.svg.includes('stroke="#e9e4d8"'))
check('results are returned', render.results.length === 1)
check('normalizer warnings reach the caller', loose.warnings.length > 0)

const noGrid = renderFigureSvg(loose.spec, { grid: false, theme: 'blueprint', results: false })
check('grid can be switched off', !noGrid.svg.includes('stroke="#e9e4d8"'))
check('blueprint uses its own paper', noGrid.svg.includes('fill="#10263d"'))
check('results can be switched off', noGrid.results.length === 0)

const graph = normalizeFigureSpec({
  elements: [
    { type: 'axes', from: [-6, -2], to: [6, 8], step: 1, xLabel: 'x', yLabel: 'y' },
    { type: 'graph', expr: 'x^2 - 4', from: -3, to: 3, label: 'y = x²' },
    { type: 'point', at: [-2, 0], label: 'A' },
    { type: 'point', at: [2, 0], label: 'B' }
  ],
  results: [{ label: 'roots', value: 'x = ±2', formula: 'x² − 4 = 0' }]
})
const graphSvg = renderFigureSvg(graph.spec, { grid: true, theme: 'paper', results: true }).svg
check('graph path is drawn', /<path d="M [^"]+" fill="none" stroke="#2563eb"/.test(graphSvg))
check('graph path has no NaN', !graphSvg.includes('NaN'))
check('axes labels are drawn', graphSvg.includes('>x</text>') && graphSvg.includes('>y</text>'))

const brokenGraph = normalizeFigureSpec({
  elements: [
    { type: 'point', at: [0, 0], label: 'O' },
    { type: 'graph', expr: 'alert(1)', from: -1, to: 1 }
  ]
})
const brokenRender = renderFigureSvg(brokenGraph.spec, { grid: false, theme: 'paper', results: true })
check('an unsafe graph cannot become a path', !brokenRender.svg.includes('<script'))
check('an unsafe graph is reported', brokenRender.warnings.some((warning) => warning.includes('alert')))

const injected = normalizeFigureSpec({
  elements: [
    { type: 'text', at: [0, 0], text: '<script>alert(1)</script>' },
    { type: 'point', at: [1, 1], label: '" onmouseover="alert(1)' }
  ]
})
const injectedSvg = renderFigureSvg(injected.spec, { grid: false, theme: 'paper', results: true }).svg
check('labels are escaped', !injectedSvg.includes('<script>') && !injectedSvg.includes('onmouseover="'))
check('escaped label survives as text', injectedSvg.includes('&lt;script&gt;'))

/* --------------------------- interactive editing ------------------------- */

const dragSpec = normalizeFigureSpec({
  elements: [
    { type: 'segment', from: [0, 0], to: [4, 0], label: 'AB' },
    { type: 'point', at: [0, 0], label: 'A' },
    { type: 'angle', vertex: [0, 0], from: [4, 0], to: [0, 3], label: '120°' },
    { type: 'dimension', from: [0, 0], to: [0, 3], offset: 0.4, label: '10 см' },
    { type: 'graph', expr: 'x^2', from: -1, to: 1 }
  ]
}).spec

// The angle's arms were 90° apart but the label said 120°, so the normalizer
// rotates the arm to the stated measure. It is the fourth distinct point.
check('shared coordinates are listed once', figurePoints(dragSpec).length === 4, figurePoints(dragSpec))

const movedSpec = moveFigurePoint(dragSpec, [0, 0], [-1, 2])
const movedPoints = figurePoints(movedSpec)
check('a shared vertex moves in every element', movedPoints.some((p) => p[0] === -1 && p[1] === 2))
check('the old vertex is gone everywhere', !movedPoints.some((p) => p[0] === 0 && p[1] === 0))
check('unrelated points stay put', movedPoints.some((p) => p[0] === 4 && p[1] === 0))
check('the source spec is untouched', figurePoints(dragSpec).some((p) => p[0] === 0 && p[1] === 0))
check('snap rounds to the step', snapValue(1.24, 0.5) === 1 && snapValue(1.26, 0.5) === 1.5)
check('snap ignores a broken step', snapValue(1.26, 0) === 1.26)

const projectionRender = renderFigureSvg(dragSpec, { grid: true, theme: 'paper', results: true })
const projection = projectionRender.projection
const probe = [2.5, 1.75]
const [pixelX, pixelY] = projection.toPixel(probe)
const back = projection.toMath(pixelX, pixelY)
check(
  'the projection round-trips',
  Math.abs(back[0] - probe[0]) < 1e-9 && Math.abs(back[1] - probe[1]) < 1e-9,
  back
)
check('the projection spans the whole svg', projection.width === 720 && projection.height > projection.titleHeight)

// A label that reads like a measurement is recomputed after the user moves a
// point; a name or a formula stays as the model wrote it.
const dragAngle = dragSpec.elements.find((element) => element.type === 'angle')
const movedArm = moveFigurePoint(dragSpec, dragAngle.to, [4, 4])
const staticSvg = renderFigureSvg(movedArm, { grid: false, theme: 'paper', results: true }).svg
const liveSvg = renderFigureSvg(movedArm, { grid: false, theme: 'paper', results: true, live: true }).svg
check('static rendering keeps the model label', staticSvg.includes('120°'))
check('live rendering recomputes the angle', liveSvg.includes('45°') && !liveSvg.includes('120°'), liveSvg.slice(-700))
const movedDimension = moveFigurePoint(dragSpec, [0, 3], [0, 4])
const dimensionLiveSvg = renderFigureSvg(movedDimension, {
  grid: false,
  theme: 'paper',
  results: true,
  live: true
}).svg
check(
  'live rendering keeps the unit and recomputes the length',
  dimensionLiveSvg.includes('4 см') && !dimensionLiveSvg.includes('10 см'),
  dimensionLiveSvg.slice(-700)
)
const named = normalizeFigureSpec({
  elements: [
    { type: 'segment', from: [0, 0], to: [3, 0] },
    { type: 'dimension', from: [0, 0], to: [3, 0], label: 'гипотенуза' }
  ]
}).spec
const namedLive = renderFigureSvg(named, { grid: false, theme: 'paper', results: true, live: true }).svg
check('a worded label is never overwritten', namedLive.includes('гипотенуза'))

/* ------------------------- what weak models send ------------------------- */

const angleMeasure = (element) => {
  const start = Math.atan2(element.from[1] - element.vertex[1], element.from[0] - element.vertex[0])
  const end = Math.atan2(element.to[1] - element.vertex[1], element.to[0] - element.vertex[0])
  let delta = (end - start) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return Math.abs((delta * 180) / Math.PI)
}

const numericText = normalizeFigureSpec({
  elements: [{ type: 'segment', from: { x: '0', y: '0' }, to: ['4', '0'] }]
})
check(
  'coordinates may be numeric strings',
  JSON.stringify(numericText.spec?.elements[0]?.from) === '[0,0]' &&
    JSON.stringify(numericText.spec?.elements[0]?.to) === '[4,0]',
  numericText.spec?.elements
)

const namedRefs = normalizeFigureSpec({
  elements: [
    { type: 'point', at: [0, 0], label: 'A' },
    { type: 'point', at: [4, 0], label: 'B' },
    { type: 'segment', from: 'A', to: 'B' },
    { type: 'angle', vertex: 'A', from: 'B', to: [0, 3], label: '∠BAC' }
  ]
})
const namedSegment = namedRefs.spec?.elements.find((element) => element.type === 'segment')
check(
  'points can be referenced by their label',
  JSON.stringify(namedSegment?.from) === '[0,0]' && JSON.stringify(namedSegment?.to) === '[4,0]',
  namedRefs.warnings
)

const angleRepair = normalizeFigureSpec({
  elements: [{ type: 'angle', vertex: [0, 0], from: [3, 0], to: [0, 3], label: '∠AOB = 60°' }]
})
const repairedAngle = angleRepair.spec?.elements.find((element) => element.type === 'angle')
check(
  'a stated angle measure wins over inconsistent arms',
  Math.abs(angleMeasure(repairedAngle) - 60) < 0.5,
  repairedAngle
)
check(
  'the letters in an angle label become point names',
  ['A', 'O', 'B'].every((letter) =>
    angleRepair.spec?.elements.some((element) => element.type === 'point' && element.label === letter)
  ),
  angleRepair.spec?.elements
)
check(
  'a bare angle gets visible arms',
  angleRepair.spec?.elements.filter((element) => element.type === 'segment').length === 2,
  angleRepair.spec?.elements
)
const angleRepairSvg = renderFigureSvg(angleRepair.spec, { grid: false, theme: 'paper', results: true }).svg
check('the arc label is shortened to the measure', angleRepairSvg.includes('>60°<'), angleRepairSvg.slice(-500))

const angleDegrees = normalizeFigureSpec({
  elements: [{ type: 'angle', vertex: [0, 0], from: [4, 0], degrees: 120, label: '120°' }]
})
check(
  'degrees builds the second arm exactly',
  Math.abs(angleMeasure(angleDegrees.spec?.elements.find((element) => element.type === 'angle')) - 120) < 0.5,
  angleDegrees.spec?.elements
)

const rightAngle = normalizeFigureSpec({
  elements: [{ type: 'angle', vertex: [0, 0], from: [4, 0], to: [1, 1], right: true, label: '90°' }]
})
const rightElement = rightAngle.spec?.elements.find((element) => element.type === 'angle')
check(
  'right:true forces a right angle',
  Math.abs(angleMeasure(rightElement) - 90) < 0.5 && rightElement?.right === true,
  rightElement
)

const russian = normalizeFigureSpec({
  элементы: [{ тип: 'угол', вершина: [0, 0], от: [3, 0], градусы: 60, подпись: '∠AOB = 60°' }]
})
check(
  'Russian keys, type names and degree labels are understood',
  Math.abs(angleMeasure(russian.spec?.elements.find((element) => element.type === 'angle')) - 60) < 0.5,
  russian.warnings
)

const inferred = normalizeFigureSpec({
  elements: [{ vertex: [0, 0], from: [2, 0], degrees: 45 }]
})
check(
  'an element without a type is inferred from its fields',
  inferred.spec?.elements.some((element) => element.type === 'angle'),
  inferred.spec?.elements
)

check('y= and superscripts are understood', evaluateExpression('y = x² - 4', 3) === 5)
check('roots, pi and decimal commas are understood', near(evaluateExpression('√(x) + π', 9), 3 + Math.PI))
check('a decimal comma is understood', near(evaluateExpression('2,5x', 4), 10))

const graphDefaults = normalizeFigureSpec({ elements: [{ type: 'graph', expr: 'y = x^2' }] })
check(
  'a graph without a range gets a sensible view',
  graphDefaults.spec?.elements.some((element) => element.type === 'graph' && element.from === -5 && element.to === 5),
  graphDefaults.spec?.elements
)
check(
  'a graph with no axes gets axes around it',
  graphDefaults.spec?.elements[0]?.type === 'axes',
  graphDefaults.spec?.elements
)

const polarSegment = normalizeFigureSpec({
  elements: [{ type: 'segment', from: [0, 0], length: 5, direction: '30°', label: 'AB' }]
})
const polar = polarSegment.spec?.elements.find((element) => element.type === 'segment')
check(
  'a segment can be given length and direction',
  near(polar?.to?.[0], 5 * Math.cos(Math.PI / 6), 1e-6) && near(polar?.to?.[1], 2.5, 1e-6),
  polar
)
check(
  '"AB" becomes endpoint labels even without point elements',
  ['A', 'B'].every((letter) =>
    polarSegment.spec?.elements.some((element) => element.type === 'point' && element.label === letter)
  ),
  polarSegment.spec?.elements
)

const circleDiameter = normalizeFigureSpec({
  elements: [{ type: 'circle', center: [0, 0], diameter: 6 }]
})
check(
  'a circle accepts a diameter',
  circleDiameter.spec?.elements.find((element) => element.type === 'circle')?.radius === 3,
  circleDiameter.spec?.elements
)

const triangle = normalizeFigureSpec({
  elements: [{ type: 'triangle', points: [[0, 0], [4, 0], [0, 3]], label: 'ABC' }]
})
check(
  'a polygon labelled ABC labels its vertices',
  ['A', 'B', 'C'].every((letter) =>
    triangle.spec?.elements.some((element) => element.type === 'point' && element.label === letter)
  ),
  triangle.spec?.elements
)

const plainRender = renderFigureSvg(
  normalizeFigureSpec({ elements: [{ type: 'segment', from: [0, 0], to: [4, 0] }] }).spec,
  { grid: false, theme: 'paper', results: true }
)
const annotatedRender = renderFigureSvg(
  normalizeFigureSpec({
    elements: [
      { type: 'segment', from: [0, 0], to: [4, 0] },
      { type: 'text', at: [0, -1], text: 'Очень длинная подпись к этому чертежу', align: 'middle' }
    ]
  }).spec,
  { grid: false, theme: 'paper', results: true }
)
const plainSpan = plainRender.projection.toPixel([4, 0])[0] - plainRender.projection.toPixel([0, 0])[0]
const annotatedSpan =
  annotatedRender.projection.toPixel([4, 0])[0] - annotatedRender.projection.toPixel([0, 0])[0]
check('a text annotation does not shrink the drawing', annotatedSpan > plainSpan * 0.4, {
  plainSpan,
  annotatedSpan
})

const cutOff = normalizeFigureSpec({
  elements:
    '[{"type":"point","at":[0,0],"label":"A"},{"type":"segment","from":[0,0],"to":[4,0]},{"type":"poi'
})
check(
  'a cut-off elements JSON keeps its complete elements',
  cutOff.spec?.elements.length === 2 && cutOff.warnings.some((warning) => warning.includes('cut off')),
  cutOff.warnings
)

const looseShape = normalizeFigureSpec({
  elements: "[{'type':'point','at':[0,0],'label':'O',},{type:point,at:[2,0],label:'B'},]"
})
check('single quotes, bare keys and trailing commas are accepted', looseShape.spec?.elements.length === 2, looseShape.warnings)

const reflex = normalizeFigureSpec({
  elements: [{ type: 'angle', vertex: [0, 0], from: [3, 0], degrees: 240, label: '240°' }]
})
const reflexAngle = reflex.spec?.elements.find((element) => element.type === 'angle')
check('an angle above 180° keeps a reflex flag', reflexAngle?.reflex === true, reflexAngle)
const reflexSvg = renderFigureSvg(reflex.spec, { grid: false, theme: 'paper', results: true }).svg
check('the reflex arc uses the large-arc flag', / A [\d.]+ [\d.]+ 0 1 /.test(reflexSvg), reflexSvg)

const adjacent = normalizeFigureSpec({
  elements: [
    { type: 'angle', vertex: [0, 0], from: [4, 0], to: [2, 2], label: '45°' },
    { type: 'angle', vertex: [0, 0], from: [2, 2], to: [-3, 1], label: '135°' }
  ]
})
check(
  'a shared angle arm is drawn only once',
  adjacent.spec?.elements.filter((element) => element.type === 'segment').length === 3,
  adjacent.spec?.elements
)

const bareAngle = normalizeFigureSpec({ elements: [{ type: 'angle', label: '∠AOB = 60°' }] })
const bareAngleElement = bareAngle.spec?.elements.find((element) => element.type === 'angle')
check(
  'an angle with only a label is still drawn',
  Math.abs((angleMeasure(bareAngleElement) ?? 0) - 60) < 0.5 &&
    bareAngle.warnings.some((warning) => warning.includes('origin')),
  bareAngle
)
check(
  'that angle also gets its letters as points',
  ['A', 'O', 'B'].every((letter) =>
    bareAngle.spec?.elements.some((element) => element.type === 'point' && element.label === letter)
  ),
  bareAngle.spec?.elements
)

const namedAdjacent = normalizeFigureSpec({
  elements: [
    { type: 'angle', points: ['A', 'O', 'B'], degrees: 50 },
    { type: 'angle', points: ['B', 'O', 'C'], degrees: 70 }
  ]
})
const namedAngles = namedAdjacent.spec?.elements.filter((element) => element.type === 'angle') ?? []
check(
  'named adjacent angles share one arm instead of overlapping',
  namedAngles.length === 2 &&
    Math.abs((angleMeasure(namedAngles[0]) ?? 0) - 50) < 0.5 &&
    Math.abs((angleMeasure(namedAngles[1]) ?? 0) - 70) < 0.5 &&
    JSON.stringify(namedAngles[0]?.to) === JSON.stringify(namedAngles[1]?.from),
  namedAdjacent
)

const defaultRender = renderFigureSvg(normalizeFigureSpec({ elements: [{ type: 'angle', label: '∠AOB = 60°' }] }).spec)
check('rendering works without explicit options', defaultRender.svg.startsWith('<svg'), defaultRender.svg.slice(0, 80))

const keyedType = normalizeFigureSpec({
  elements: [
    { point: [0, 0], label: 'O' },
    { point: [4, 0], label: 'A' },
    { point: [2, 3.46], label: 'B' },
    { angle: { vertex: [0, 0], from: [4, 0], degrees: 60, label: '∠AOB = 60°' } }
  ]
})
check(
  'a type used as the key is understood',
  keyedType.spec?.elements.filter((element) => element.type === 'point').length === 3 &&
    Math.abs((angleMeasure(keyedType.spec?.elements.find((element) => element.type === 'angle')) ?? 0) - 60) < 0.5,
  keyedType
)

const dotsOnly = normalizeFigureSpec({
  elements: [
    { point: [10, 10], label: 'O' },
    { point: [20, 10], label: 'A' },
    { point: [10, 20], label: 'B' }
  ]
})
check(
  'a points-only figure says the shape is missing',
  dotsOnly.spec?.elements.length === 3 &&
    dotsOnly.warnings.some((warning) => warning.includes('Only points')),
  dotsOnly
)

const roundedShared = normalizeFigureSpec({
  elements: [
    { type: 'line', from: [-5, 0], to: [5, 0] },
    { type: 'angle', vertex: [0, 0], from: [5, 0], degrees: 60, label: '∠AOB' },
    { type: 'angle', vertex: [0, 0], from: [2.5, 4.33], degrees: 120, label: '∠BOC' }
  ]
})
const roundedAngles = roundedShared.spec?.elements.filter((element) => element.type === 'angle') ?? []
check(
  'a rounded shared point still gets the third label',
  roundedAngles.length === 2 &&
    ['A', 'B', 'C'].every((letter) =>
      roundedShared.spec?.elements.some((element) => element.type === 'point' && element.label === letter)
    ),
  roundedShared
)

const cutKeyed = normalizeFigureSpec({
  elements:
    '[{"from": [0, 0], "to": [1, 0], "label": "A", "ticks": true}, {"from": [0, 0], "to": [0, 1], "label": "B", "ticks": true}, {"from": [0, 0], "to": [1, 1], "label": "C", "ticks": true}, {"angle": {"from": [1, 0], "to": [1, 1], "vertex": [0, 0], "label": "∠AOB", "right": true}}'
})
check(
  'a cut-off array keeps a type-keyed element too',
  cutKeyed.spec?.elements.filter((element) => element.type === 'angle').length === 1,
  cutKeyed
)

if (failed > 0) {
  console.error(`\n${failed} figure check(s) failed`)
  process.exit(1)
}
console.log('\nALL FIGURE CHECKS PASSED')
