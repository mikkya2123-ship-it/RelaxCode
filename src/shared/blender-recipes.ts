/**
 * Blender recipes: high-level scene operations as parameterised Python
 * templates for models that cannot reliably write long bpy code (the palette
 * is offered only to connections the model-memory marked as weak tool
 * callers). The python() builders are pure string functions, covered by
 * `npm run test:recipes`.
 */

export interface BlenderRecipe {
  /** One-line help for the model. */
  description: string
  /** JSON schema of the arguments. */
  params: Record<string, unknown>
  /** bpy script body. Runs inside Blender via execute_blender_code. */
  python: (args: Record<string, unknown>) => string
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

const hex = (value: unknown, fallback: string): string => {
  const text = str(value, fallback)
  return /^0x[0-9a-fA-F]{6}$/.test(text) ? text : fallback
}

/** All imports and helpers every recipe may rely on. */
const PRELUDE = `import bpy, bmesh, random, math, json
def _result(**kv):
    print('__MCP_RESULT__' + json.dumps(kv))
def _del(names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o: bpy.data.objects.remove(o, do_unlink=True)
def _mat(name, color, rough=0.8, emission=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*[c/255 for c in color], 1)
        bsdf.inputs['Roughness'].default_value = rough
        if emission and 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = (*[c/255 for c in emission], 1)
            bsdf.inputs['Emission Strength'].default_value = 5.0
    return m`

/** rgb ints from a 0xRRGGBB literal. */
function rgbFromHex(hexLiteral: string): [number, number, number] {
  const value = parseInt(hexLiteral.slice(2), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export const BLENDER_RECIPES: Record<string, BlenderRecipe> = {
  clear_scene: {
    description:
      'Remove all mesh/light/camera objects for a fresh start (keeps the world; optionally resets it).',
    params: {
      type: 'object',
      properties: {
        reset_world: { type: 'boolean', description: 'Also clear world fog/colors' }
      }
    },
    python: (args) => `${PRELUDE}
_del([o.name for o in bpy.context.scene.objects if o.type in {'MESH','LIGHT','CAMERA'}])
${args.reset_world === true ? `w = bpy.context.scene.world or bpy.data.worlds.new('World'); bpy.context.scene.world = w; w.use_nodes = False; w.color = (0.05, 0.05, 0.08)` : ''}
_result(status='cleared', objects=len(bpy.context.scene.objects))`
  },

  terrain: {
    description:
      'Low-poly ground plane with gentle hills. The base every nature scene stands on.',
    params: {
      type: 'object',
      properties: {
        size: { type: 'number', description: 'Side length in metres (default 40)' },
        height: { type: 'number', description: 'Max hill height (default 1.2)' },
        color: { type: 'string', description: 'Ground color, 0xRRGGBB (default mossy green)' },
        subdivisions: { type: 'number', description: 'Grid subdivisions 10–200 (default 60)' }
      }
    },
    python: (args) => {
      const color = hex(args.color, '0x3e6b3a')
      const [r, g, b] = rgbFromHex(color)
      return `${PRELUDE}
_del(['Ground'])
size = ${num(args.size, 40)}
bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
ground = bpy.context.active_object
ground.name = 'Ground'
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(ground.data)
subs = max(10, min(200, int(${num(args.subdivisions, 60)})))
bpy.ops.mesh.subdivide(number_cuts=subs)
bm = bmesh.from_edit_mesh(ground.data)
hmax = ${num(args.height, 1.2)}
for v in bm.verts:
    d = math.sqrt(v.co.x**2 + v.co.y**2) / (size / 2)
    v.co.z = (math.sin(v.co.x * 0.35) * math.cos(v.co.y * 0.28) + random.uniform(-0.25, 0.25)) * hmax * (1.1 - 0.6 * d)
bmesh.update_edit_mesh(ground.data)
bpy.ops.object.mode_set(mode='OBJECT')
for p in ground.data.polygons: p.use_smooth = False
ground.data.materials.clear()
ground.data.materials.append(_mat('RC_Ground', (${r}, ${g}, ${b})))
_result(status='terrain', size=size, verts=len(ground.data.vertices))`
    }
  },

  forest: {
    description:
      'A low-poly forest: cone-crown trees scattered naturally, varied sizes and green shades.',
    params: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Trees (default 14, max 60)' },
        area: { type: 'number', description: 'Spread radius in metres (default 16)' },
        min_scale: { type: 'number', description: 'Smallest tree scale (default 0.6)' },
        max_scale: { type: 'number', description: 'Largest tree scale (default 1.6)' }
      }
    },
    python: (args) => `${PRELUDE}
_del([o.name for o in bpy.context.scene.objects if o.name.startswith('RC_Tree')])
greens = [${[0x2f6b34, 0x3e7a3a, 0x4c8a44, 0x35602f, 0x57944b]
      .map((c) => `(${rgbFromHex(`0x${c.toString(16).padStart(6, '0')}`).join(', ')})`)
      .join(', ')}]
count = max(1, min(60, int(${num(args.count, 14)})))
radius = ${num(args.area, 16)}
made = 0
attempts = 0
placed = []
while made < count and attempts < count * 30:
    attempts += 1
    x = random.uniform(-radius, radius)
    y = random.uniform(-radius, radius)
    if any((x - px) ** 2 + (y - py) ** 2 < 3.5 for px, py in placed): continue
    placed.append((x, y))
    s = random.uniform(${num(args.min_scale, 0.6)}, ${num(args.max_scale, 1.6)})
    g = 0
    ground = bpy.data.objects.get('Ground')
    if ground:
        best = None
        for v in ground.data.vertices:
            w = ground.matrix_world @ v.co
            d = (w.x - x) ** 2 + (w.y - y) ** 2
            if best is None or d < best[0]: best = (d, w.z)
        g = best[1] if best else 0
    crown = bpy.data.meshes.new('c')
    trunk_h = 0.9 * s
    bpy.ops.mesh.primitive_cone_add(vertices=random.choice([6, 7, 8]), radius1=0.85 * s, depth=2.2 * s, location=(x, y, g + trunk_h + 1.1 * s))
    crown_obj = bpy.context.active_object
    crown_obj.name = 'RC_Tree_Crown_%d' % made
    crown_obj.data.materials.clear()
    cr, cg, cb = random.choice(greens)
    crown_obj.data.materials.append(_mat('RC_Leaf', (cr, cg, cb), rough=0.9))
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.14 * s, depth=trunk_h, location=(x, y, g + trunk_h / 2))
    trunk = bpy.context.active_object
    trunk.name = 'RC_Tree_Trunk_%d' % made
    trunk.data.materials.clear()
    trunk.data.materials.append(_mat('RC_Bark', (92, 62, 40), rough=0.95))
    made += 1
_result(status='forest', trees=made)`
  },

  rocks: {
    description: 'Scattered low-poly rocks to break up empty ground.',
    params: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Rocks (default 10)' },
        area: { type: 'number', description: 'Spread radius (default 18)' },
        color: { type: 'string', description: '0xRRGGBB (default grey)' }
      }
    },
    python: (args) => {
      const [r, g, b] = rgbFromHex(hex(args.color, '0x8a8d91'))
      return `${PRELUDE}
_del([o.name for o in bpy.context.scene.objects if o.name.startswith('RC_Rock')])
count = max(1, min(40, int(${num(args.count, 10)})))
made = 0
while made < count:
    x = random.uniform(-${num(args.area, 18)}, ${num(args.area, 18)})
    y = random.uniform(-${num(args.area, 18)}, ${num(args.area, 18)})
    s = random.uniform(0.25, 1.1)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=s, location=(x, y, s * 0.3))
    rock = bpy.context.active_object
    rock.name = 'RC_Rock_%d' % made
    rock.scale = (1.0, random.uniform(0.7, 1.2), random.uniform(0.5, 0.8))
    rock.rotation_euler = (random.uniform(0, 0.3), random.uniform(0, 0.3), random.uniform(0, 6.28))
    for p in rock.data.polygons: p.use_smooth = False
    rock.data.materials.clear()
    rock.data.materials.append(_mat('RC_Stone', (${r}, ${g}, ${b}), rough=0.95))
    made += 1
_result(status='rocks', rocks=made)`
    }
  },

  sunset_light: {
    description:
      'Warm sunset key light low over the horizon + cool blue fill + optional world fog. Instant mood.',
    params: {
      type: 'object',
      properties: {
        sun_color: { type: 'string', description: '0xRRGGBB (default warm orange)' },
        fog: { type: 'boolean', description: 'Enable mist in the world (default true)' },
        fog_density: { type: 'number', description: 'Mist density 0.001–0.02 (default 0.006)' },
        sun_elevation: { type: 'number', description: 'Degrees above horizon (default 8)' }
      }
    },
    python: (args) => {
      const [r, g, b] = rgbFromHex(hex(args.sun_color, '0xff8c3a'))
      const density = Math.min(0.02, Math.max(0.001, num(args.fog_density, 0.006)))
      return `${PRELUDE}
_del(['RC_Sun', 'RC_Fill'])
sun_data = bpy.data.lights.new('RC_Sun', type='SUN')
sun_data.energy = 3.0
sun_data.angle = math.radians(6)
sun_data.use_nodes = True
if sun_data.node_tree.nodes.get('Emission'):
    sun_data.node_tree.nodes['Emission'].inputs['Color'].default_value = (${r} / 255, ${g} / 255, ${b} / 255, 1)
sun = bpy.data.objects.new('RC_Sun', sun_data)
elev = math.radians(${num(args.sun_elevation, 8)})
azim = math.radians(200)
sun.rotation_euler = (elev, 0, azim)
bpy.context.collection.objects.link(sun)
fill_data = bpy.data.lights.new('RC_Fill', type='SUN')
fill_data.energy = 0.5
fill = bpy.data.objects.new('RC_Fill', fill_data)
fill.rotation_euler = (math.radians(55), 0, math.radians(30))
bpy.context.collection.objects.link(fill)
w = bpy.context.scene.world or bpy.data.worlds.new('World')
bpy.context.scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (${r} / 500, ${g} / 500, ${b} / 450, 1)
    bg.inputs['Strength'].default_value = 0.9
${args.fog === false ? '' : `bpy.context.scene.world.mist_settings.use_mist = True
bpy.context.scene.world.mist_settings.intensity = ${density}`}
_result(status='sunset', fog=${args.fog === false ? 'False' : 'True'}, elevation=${num(args.sun_elevation, 8)})`
    }
  },

  moon_light: {
    description: 'Night scene: pale blue moonlight + dark indigo world + fog.',
    params: {
      type: 'object',
      properties: {
        fog: { type: 'boolean', description: 'Enable mist (default true)' },
        intensity: { type: 'number', description: 'Sun strength (default 2.0)' }
      }
    },
    python: (args) => `${PRELUDE}
_del(['RC_Sun', 'RC_Fill'])
sun_data = bpy.data.lights.new('RC_Sun', type='SUN')
sun_data.energy = ${num(args.intensity, 2)}
sun_data.angle = math.radians(4)
sun = bpy.data.objects.new('RC_Sun', sun_data)
sun.rotation_euler = (math.radians(38), 0, math.radians(160))
bpy.context.collection.objects.link(sun)
w = bpy.context.scene.world or bpy.data.worlds.new('World')
bpy.context.scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get('Background')
if bg:
    bg.inputs['Color'].default_value = (0.06, 0.08, 0.18, 1)
    bg.inputs['Strength'].default_value = 0.5
${args.fog === false ? '' : `w.mist_settings.use_mist = True
w.mist_settings.intensity = 0.008`}
_result(status='moon')`
  },

  camera_shot: {
    description:
      'Place a camera that frames the scene nicely (rule of thirds, slight tilt). Call before rendering.',
    params: {
      type: 'object',
      properties: {
        distance: { type: 'number', description: 'Distance from centre (default 22)' },
        height: { type: 'number', description: 'Camera height (default 6)' },
        target_name: { type: 'string', description: 'Object to look at (default scene centre)' }
      }
    },
    python: (args) => `${PRELUDE}
_del(['RC_Camera'])
cam_data = bpy.data.cameras.new('RC_Camera')
cam = bpy.data.objects.new('RC_Camera', cam_data)
d = ${num(args.distance, 22)}
cam.location = (d * 0.85, -d * 0.9, ${num(args.height, 6)})
bpy.context.collection.objects.link(cam)
target = bpy.data.objects.get(${JSON.stringify(str(args.target_name, ''))})
if not target: target = bpy.data.objects.new('RC_Target', None); target.location = (0, 0, 1); bpy.context.collection.objects.link(target)
direction = target.location - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
cam_data.lens = 50
bpy.context.scene.camera = cam
_result(status='camera', location=list(cam.location))`
  },

  render_preview: {
    description:
      'Render the current view to a file inside the workspace and report the path. Fast engine by default.',
    params: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File name (default render_preview.png)' },
        engine: { type: 'string', description: '"eevee" (fast) or "cycles" (default eevee)' },
        width: { type: 'number', description: 'Default 960' },
        height: { type: 'number', description: 'Default 540' },
        samples: { type: 'number', description: 'Cycles samples (default 64)' }
      }
    },
    python: (args) => {
      const engine = str(args.engine, 'eevee').toLowerCase() === 'cycles' ? 'CYCLES' : 'BLENDER_EEVEE_NEXT'
      const filename = str(args.filename, 'render_preview.png').replace(/[^a-zA-Z0-9._-]/g, '_')
      return `${PRELUDE}
scene = bpy.context.scene
scene.render.engine = '${engine}'
scene.render.resolution_x = int(${num(args.width, 960)})
scene.render.resolution_y = int(${num(args.height, 540)})
if scene.render.engine == 'CYCLES':
    scene.cycles.samples = int(${num(args.samples, 64)})
    scene.cycles.use_denoising = True
out = '//${filename}'
scene.render.filepath = out
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
abs_path = bpy.path.abspath(out)
_result(status='rendered', path=abs_path, engine=scene.render.engine)`
    }
  },

  material_color: {
    description: 'Recolor an object with a flat low-poly material.',
    params: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Object name' },
        color: { type: 'string', description: '0xRRGGBB' },
        roughness: { type: 'number', description: '0–1 (default 0.85)' }
      },
      required: ['name', 'color']
    },
    python: (args) => {
      const [r, g, b] = rgbFromHex(hex(args.color, '0xcc7a3a'))
      return `${PRELUDE}
obj = bpy.data.objects.get(${JSON.stringify(str(args.name, ''))})
if not obj:
    _result(status='error', message='no object named that')
else:
    obj.data.materials.clear()
    obj.data.materials.append(_mat('RC_Tint_${r}_${g}_${b}', (${r}, ${g}, ${b}), rough=${num(args.roughness, 0.85)}))
    _result(status='tinted', object=obj.name)`
    }
  },

  save_blend: {
    description: 'Save the .blend into the workspace (relative path, e.g. scene.blend).',
    params: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'File name ending in .blend' }
      },
      required: ['filename']
    },
    python: (args) => {
      const filename = str(args.filename, 'scene.blend').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.blend$/, '') + '.blend'
      return `${PRELUDE}
filepath = '//${filename}'
bpy.ops.wm.save_as_mainfile(filepath=filepath)
_result(status='saved', path=bpy.path.abspath(filepath))`
    }
  }
}

/** The recipe names, for the tool description. */
export function recipeNames(): string[] {
  return Object.keys(BLENDER_RECIPES)
}
