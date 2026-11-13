import type { Skill } from '../skills.ts'

/**
 * Blender playbooks, including the Python automation ones: a scene that is
 * built by hand is fine, but a scene that can be rebuilt by a script is
 * reproducible, and that is what a repeatable pipeline needs.
 */
export const BLENDER_SKILLS: Skill[] = [
  {
    id: 'blender-scripting',
    title: 'Blender: Python и bpy',
    titleEn: 'Blender: Python and bpy',
    category: 'blender',
    summary: 'Сцены кодом, контекст операторов, повторяемость',
    summaryEn: 'Scenes as code, operator context, repeatability',
    triggers: ['bpy', 'blender python', 'blender скрипт', 'blender script', 'blender api', 'автоматизац blender'],
    rules: [
      'Clear the scene first (bpy.ops.wm.read_factory_settings or explicit object deletion) so a rerun is reproducible.',
      'Prefer data API calls (bpy.data.meshes.new, objects.new, collection.objects.link) over operators, which depend on context.',
      'When an operator is unavoidable, set the context with temp_override(area, region, object) instead of guessing.',
      'Build one function per object or material group and call them from a main(); never a 500-line script.',
      'Return and log counts (triangles, objects) so a failed build is visible, not silent.',
      'Use bpy.context.view_layer.update() after transforms before measuring or exporting.',
      'Keep every parameter at the top as constants so a rerun with different numbers is one edit.',
      'Save the scene before rendering, and print the output path at the end.',
      'Test the script on an empty factory scene, not on the working file.'
    ]
  },
  {
    id: 'blender-geometry-nodes',
    title: 'Blender: Geometry Nodes',
    titleEn: 'Blender: geometry nodes',
    category: 'blender',
    summary: 'Процедурные сцены, поля и контроль плотности',
    summaryEn: 'Procedural scenes, fields, controlled density',
    triggers: ['geometry nodes', 'геометрия ноды', 'geo nodes', 'процедурн blender', 'gnodes'],
    rules: [
      'Name every node group input and output; a group called Group.001 is unusable by anyone else.',
      'Drive variation with fields (Random Value, noise textures), not with duplicate node chains.',
      'Cap instance counts and use density masks so scattering does not explode the triangle count.',
      'Keep the modifier stack readable: one group for scattering, one for deformation, one for the final merge.',
      'Use the Viewer node plus the spreadsheet to verify attribute values before judging the render.',
      'Realize instances only when you must; realized geometry can be far heavier than instanced.',
      'Expose the meaningful parameters on the modifier panel and lock the rest inside the group.',
      'Version-check node names when scripting them — a renamed socket breaks the script silently.',
      'Bake the result to a mesh when the scene ships, so downstream tools do not need Blender.'
    ]
  },
  {
    id: 'blender-materials',
    title: 'Blender: материалы',
    titleEn: 'Blender: materials',
    category: 'blender',
    summary: 'Principled, физические значения, процедурные детали',
    summaryEn: 'Principled, physical values, procedural detail',
    triggers: ['blender материал', 'blender material', 'principled bsdf', 'шейдер blender', 'процедурн материал'],
    rules: [
      'One Principled BSDF per material; separate shaders for metal and glass, not one that does both.',
      'Use physical values: metalness 0 or 1, roughness 0.05-0.9, IOR 1.45 for glass and 1.33 for water.',
      'Base Color carries no baked lighting; keep it neutral and add variation with a subtle colour ramp.',
      'Layer procedural detail (noise, voronoi) through roughness and bump, not through the base colour only.',
      'Keep node graphs readable: frames, labelled reroutes and groups instead of spaghetti.',
      'Texture coordinates from Object or Generated for procedural work; UV only where a texture must follow the layout.',
      'Use the Material Preview with the final HDRI before judging colour, not the solid view.',
      'Name materials by intent (mat_wood_oak_varnished) and reuse; a hundred duplicates slow iterations.',
      'Check the material under a grazing angle; roughness and normal errors show up only there.'
    ]
  },
  {
    id: 'blender-uv-unwrap',
    title: 'Blender: UV-развёртка',
    titleEn: 'Blender: UV unwrapping',
    category: 'blender',
    summary: 'Швы по логике, ровный тексель, без растяжений',
    summaryEn: 'Seams with logic, even texel density, no stretching',
    triggers: ['uv развёртк', 'blender uv', 'unwrap', 'uv map', 'развёртка модель'],
    rules: [
      'Mark seams where a real object would have them: material borders, back faces, under edges.',
      'Use Smart UV Project only for quick props, never for hero assets or anything with a texture pattern.',
      'Check texel density with a checker texture scaled to the final map; islands must match across objects.',
      'Pack islands with margin (4-8px at 2k) and no overlap; overlapping UVs break baking.',
      'Keep island orientation consistent so directional textures read the same on every part.',
      'Straighten cylindrical islands (Follow Active Quads) so seams do not twist.',
      'Leave a small gap from the UV border so mipmaps do not bleed edges.',
      'Rebuild UVs before baking, not after; a bake on stretched UVs wastes the whole pass.',
      'Verify with a 1:1 checker at 100% zoom, not at 25% in the viewport.'
    ]
  },
  {
    id: 'blender-animation',
    title: 'Blender: анимация',
    titleEn: 'Blender: animation',
    category: 'blender',
    summary: 'Ключи по таймингу, интерполяция и графики',
    summaryEn: 'Keys on timing, interpolation, graph editor',
    triggers: ['blender анимац', 'blender animation', 'ключев кадр blender', 'graph editor', 'анимац blender'],
    rules: [
      'Block the timing with two or three poses first; polish keys only after the motion reads.',
      'Keep the frame rate consistent (24 or 30) and set it before the first key.',
      'Default interpolation is Bezier — check the Graph Editor and set ease in/out deliberately.',
      'Space keys by the motion: fast action has 2-4 frames between extremes, not 10.',
      'Animate the root, then the limbs; never key every bone on every frame.',
      'Use the Dope Sheet to offset overlapping actions so movement does not stop everywhere at once.',
      'Add moving holds and small overshoots; perfectly linear motion looks mechanical.',
      'Bake animation to keyframes before export so the target tool sees the same motion.',
      'Review at real speed, then frame by frame — both passes catch different problems.'
    ]
  },
  {
    id: 'blender-rigging',
    title: 'Blender: риггинг',
    titleEn: 'Blender: rigging',
    category: 'blender',
    summary: 'Кости по анатомии, IK, веса и контроль деформаций',
    summaryEn: 'Anatomically placed bones, IK, weights, deformation checks',
    triggers: ['rig blender', 'риггинг', 'арматура blender', 'armature', 'скелет blender', 'ik blender'],
    rules: [
      'Place bones at joint pivots, not at the visible surface; the rotation centre defines the motion.',
      'Keep the deform skeleton separate from control bones, and parent controls with constraints.',
      'Use IK for limbs with a pole target, and switch to FK for arcs and hand animation.',
      'Name bones consistently (spine_01, arm_l_upper) and mirror with the .L/.R convention so tools work.',
      'Parent the mesh with automatic weights, then fix by hand; automatic weights fail at shoulders, hips and fingers.',
      'Test deformation in extreme poses (arm raised, knee bent 120 degrees) before detailing.',
      'Add twist bones or corrective shapes for shoulders and elbows if the silhouette collapses.',
      'Lock and hide unused transform channels on controls so animators cannot break the rig.',
      'Keep the rig in its own collection and a rest pose saved; a broken rig without a backup costs a day.'
    ]
  },
  {
    id: 'blender-character',
    title: 'Blender: персонаж',
    titleEn: 'Blender: character',
    category: 'blender',
    summary: 'Пропорции, силуэт, лицо и топология под анимацию',
    summaryEn: 'Proportions, silhouette, face, animation topology',
    triggers: ['персонаж blender', 'character blender', 'модель персонажа', 'character modeling', 'голова blender'],
    rules: [
      'Start from proportions and a strong silhouette; a recognisable character reads in black.',
      'Block the body with primitives at real scale, then refine — detail before proportion wastes work.',
      'Topology follows deformation: loops around eyes and mouth, even quads on joints, no poles on the face.',
      'Hands and face carry the read: give them the density, keep the torso economical.',
      'Keep the eyes as separate meshes for control over highlights and shape.',
      'Build the mouth and eyelids so they open correctly, not as flat holes.',
      'Match the style: stylised characters simplify anatomy deliberately, realistic ones need reference.',
      'Check the mesh in the final lighting early, before adding small details.',
      'For animation, plan the rig before the final topology and leave clean loops at every joint.'
    ]
  },
  {
    id: 'blender-architecture',
    title: 'Blender: архитектура и интерьер',
    titleEn: 'Blender: architecture and interiors',
    category: 'blender',
    summary: 'Масштаб, свет из окон, материалы и композиция кадра',
    summaryEn: 'Scale, window light, materials, shot composition',
    triggers: ['архвиз', 'archviz blender', 'интерьер blender', 'архитектур визуализац', 'interior render'],
    rules: [
      'Model at real scale (doors 2.1m, ceilings 2.7-3m); every material and light depends on it.',
      'Use a physical sun plus a portal or an HDRI for window light; interiors die without bounce.',
      'Camera at eye level 1.5-1.7m with a 24-35mm lens and vertical lines corrected.',
      'Compose with the architecture: leading lines, one focal piece of furniture, foreground depth.',
      'Materials need scale: a 1m tile texture on a 3m wall reads as a mistake.',
      'Add believable imperfection: slight roughness variation, a rug, books, a plant — one or two, not ten.',
      'Light with intent: sunlight plus one interior lamp tells a story; five ceiling lights flatten it.',
      'Render at least two views; a single shot hides errors in the layout.',
      'Check the exposure on the window area — blown highlights are the classic archviz tell.'
    ]
  },
  {
    id: 'blender-product-shot',
    title: 'Blender: продуктовый кадр',
    titleEn: 'Blender: product shot',
    category: 'blender',
    summary: 'Студия, отражения, чистая геометрия и композиция',
    summaryEn: 'Studio, reflections, clean geometry, composition',
    triggers: ['продуктов рендер', 'product shot blender', 'студи рендер blender', 'packshot blender', 'предметн рендер'],
    rules: [
      'Build a studio: large key softbox, two strip lights for edges, black flags to shape reflections.',
      'Reflections define form on glossy products — plan the light shapes, do not hope for the HDRI.',
      'Check the geometry for seams and n-gon shading artefacts before lighting.',
      'Fill 55-70% of the frame with the product, eye level or slightly above.',
      'Use 50-85mm equivalent and a shallow depth of field only if the background needs separation.',
      'Separate the product from the background with a subtle gradient or a colour that supports the brand.',
      'Set AgX view transform and verify the label text stays legible and whites neutral.',
      'Render beauty plus details (texture, cap, label) with the same lighting family.',
      'Export with alpha if the shot will be composited into a page.'
    ]
  },
  {
    id: 'blender-eevee',
    title: 'Blender: EEVEE',
    titleEn: 'Blender: EEVEE',
    category: 'blender',
    summary: 'Скорость, screen-space эффекты и честные ограничения',
    summaryEn: 'Speed, screen-space effects, honest limits',
    triggers: ['eevee', 'eevee next', 'рендер eevee', 'blender eevee настройк'],
    rules: [
      'EEVEE Next relies on screen space: reflections and AO disappear off-screen, plan shots accordingly.',
      'Enable ray-traced reflections only for materials that need them; it is the main cost.',
      'Use probes (light probe, reflection probe) instead of hoping for ambient light to fill interiors.',
      'Shadows need high resolution on the sun and soft shadows from area lights; tune bias against acne.',
      'Volumetrics are expensive in EEVEE — keep the volume box tight around the visible fog.',
      'TAA samples 32-64 are usually enough for stills; motion blur multiplies the cost.',
      'Motion blur and depth of field are screen-space too; check fast-moving objects for artefacts.',
      'Compare EEVEE and Cycles on the hero frame: if the difference is invisible, ship EEVEE.',
      'For animation, test one frame per second of the shot before rendering the whole sequence.'
    ]
  },
  {
    id: 'blender-cycles-optimization',
    title: 'Blender: Cycles без ожидания',
    titleEn: 'Blender: Cycles speed',
    category: 'blender',
    summary: 'Сэмплы, денойз, упрощение сцены и GPU',
    summaryEn: 'Samples, denoise, scene simplification, GPU',
    triggers: ['cycles оптимизац', 'cycles render time', 'денойз', 'cycles samples', 'быстр рендер blender'],
    rules: [
      'Use the OptiX or OpenImageDenoise denoiser and lower samples to 64-256 for stills.',
      'Set adaptive sampling with a noise threshold of 0.01-0.02 instead of a fixed high sample count.',
      'Clamp indirect and direct light bounces to 4-6; the last bounces rarely change the image.',
      'Use light portals or smaller light sources instead of huge area lights that add noise.',
      'Simplify: hide off-camera geometry, use lower subdivision in reflections, cap texture sizes.',
      'Bake complex static lighting into textures for animations instead of re-path-tracing it per frame.',
      'Enable persistent data between frames and reuse the BVH when only the camera moves.',
      'Render regions or a lower resolution for look development, then the final pass once.',
      'Measure seconds per frame before and after each change; otherwise the optimization is a guess.'
    ]
  },
  {
    id: 'blender-compositing',
    title: 'Blender: композитинг',
    titleEn: 'Blender: compositing',
    category: 'blender',
    summary: 'Пассы, глоу, грейдинг и своевременный экспорт',
    summaryEn: 'Passes, glow, grading, export at the right moment',
    triggers: ['композитинг blender', 'compositor', 'blender post', 'render passes', 'грейдинг рендер'],
    rules: [
      'Render to EXR with the passes you need (denoise, cryptomatte, AO) before grading anything.',
      'Keep the compositor graph short: glow, glare, colour balance, vignette — in that order of usefulness.',
      'Drive bloom with the Glare node at low threshold; a big white halo reads as a mistake.',
      'Grade in a neutral view transform and check the histogram, not only the viewport.',
      'Do not destroy highlight detail before the final export; expose last.',
      'Use the Denoise node before sharpening, never after.',
      'Add film grain at 2-4% only for the final look, and disable it for asset delivery.',
      'Keep the raw render and the node setup in the file so the look can be redone.',
      'Export stills as PNG 16-bit or EXR, video as a lossless master before any compression.'
    ]
  },
  {
    id: 'blender-export-glb',
    title: 'Blender: экспорт в glTF',
    titleEn: 'Blender: glTF export',
    category: 'blender',
    summary: 'Y-up, масштаб, материалы и предпросмотр в браузере',
    summaryEn: 'Y-up, scale, materials, a browser check',
    triggers: ['glb export', 'gltf export blender', 'экспорт glb', 'blender gltf', 'экспорт модель веб'],
    rules: [
      'Apply transforms (scale 1, rotation 0) before export; unapplied scale breaks normals and physics.',
      'Use +Y up in the exporter for web engines and check the orientation in a viewer, not in Blender.',
      'Export one collection per asset with a clear root object; the scene hierarchy becomes the GLB hierarchy.',
      'Keep materials Principled-based; the exporter maps base colour, roughness, metalness and normal, nothing else.',
      'Pack textures or export them beside the GLB with the right paths; missing textures show as white.',
      'Strip cameras, lights, empties and animation that the target does not need.',
      'Watch the triangle count and texture sizes in the export summary.',
      'Validate the file in the Khronos viewer or three.js editor before handing it over.',
      'Keep the .blend source next to the export so the asset can be rebuilt.'
    ]
  },
  {
    id: 'blender-procedural-textures',
    title: 'Blender: процедурные текстуры',
    titleEn: 'Blender: procedural textures',
    category: 'blender',
    summary: 'Масштаб, слои деталей и запекание в карты',
    summaryEn: 'Scale, layered detail, baking to maps',
    triggers: ['процедурн текстур', 'procedural texture', 'bake texture blender', 'noise texture', 'запекан текстур'],
    rules: [
      'Layer detail by scale: macro variation, meso pattern, micro roughness — one noise cannot do all three.',
      'Drive bump from a separate high-frequency noise, not from the colour map.',
      'Use Object coordinates for procedural patterns so the texture does not swim when UVs change.',
      'Mix wood, stone and metal from colour ramps and distorted noise, not from a single Voronoi.',
      'Bake to texture maps for export: base colour, roughness, normal, AO at the resolution the target needs.',
      'Bake with a margin (4-8px) and check the seams after baking, not before.',
      'Keep texture resolution proportional to screen size: 4K for hero, 1K for props, 512 for background.',
      'Save the node group as an asset so the same surface language can be reused.',
      'Check the material with a moving light; procedural patterns reveal tiling under grazing angles.'
    ]
  },
  {
    id: 'blender-sculpt',
    title: 'Blender: скульптинг',
    titleEn: 'Blender: sculpting',
    category: 'blender',
    summary: 'Формы крупно, детали позже, ремеш и контроль плотности',
    summaryEn: 'Big forms first, detail later, remesh and density control',
    triggers: ['скульптинг', 'sculpt blender', 'blender sculpt', 'цифров скульптур', 'dynatopo'],
    rules: [
      'Block the primary forms with the Grab and Clay brushes before any detail.',
      'Block out from big masses to small planes; detail on a wrong shape is wasted work.',
      'Use Dyntopo or a Multires workflow deliberately: Dyntopo for concept, Multires for a final asset.',
      'Keep the silhouette check in flat lighting every few minutes — colour hides form errors.',
      'Work at a resolution that matches the final size: tiny forms need density, big ones do not.',
      'Use the Remesh modifier or Quad Remesh for a clean base before adding details.',
      'Retopologise before baking or rigging; sculpted meshes are not animation-ready.',
      'Save versions (file_01, file_02) before destructive remeshes.',
      'Judge the sculpt at 100% zoom on the face and at thumbnail size for the overall read.'
    ]
  },
  {
    id: 'blender-cloth-sim',
    title: 'Blender: ткань и симуляция',
    titleEn: 'Blender: cloth simulation',
    category: 'blender',
    summary: 'Коллизии, плотность сетки, кэш и фиксация результата',
    summaryEn: 'Collisions, mesh density, cache, baked result',
    triggers: ['cloth sim', 'ткань blender', 'симуляц ткани', 'blender cloth', 'симуляц blender'],
    rules: [
      'Give the cloth enough subdivisions to fold (grid 20-40 across) but not so many that the sim crawls.',
      'Set the collider object as a separate simplified mesh; the render mesh is rarely a good collider.',
      'Tune quality steps and collision distance before adding more detail; most jitter is a collision setting.',
      'Pin the cloth where it is physically held (shoulders, waist) with a vertex group.',
      'Use pressure for inflatables and a shrink factor for fitted cloth; defaults give a stiff sheet.',
      'Bake the simulation to a cache and save the file before rendering the animation.',
      'Test the first 30 frames: if the cloth explodes early, the collision distance is wrong.',
      'Convert to mesh and clean it after baking when the cloth is not animated further.',
      'For stills, simulate with a hidden floor and delete it after baking if it is not visible.'
    ]
  },
  {
    id: 'blender-rigidbody-sim',
    title: 'Blender: физика объектов',
    titleEn: 'Blender: rigid body simulation',
    category: 'blender',
    summary: 'Типы тел, коллизии, кэш и правдоподобный вес',
    summaryEn: 'Body types, collisions, cache, believable weight',
    triggers: ['rigid body blender', 'физика blender', 'rigidbody', 'разлет объектов', 'симуляц паден'],
    rules: [
      'Mark exactly one object (or a passive floor) as passive; everything that moves is active.',
      'Set mass and friction with real values: a 1kg box and a 100kg crate must behave differently.',
      'Use convex hull or mesh colliders by intention; concave meshes need decomposed shapes.',
      'Enable collision margins only where jitter appears; large margins make objects float.',
      'Bake the simulation before rendering and keep the cache file next to the .blend.',
      'Use Animated rigid bodies for hand-placed beats and let physics do the rest.',
      'Check the first impact frame: penetration means the collider or the step size is wrong.',
      'Add a slight random rotation to many identical objects so the result is not suspiciously tidy.',
      'For product or VFX shots, simulate with real-world scale and gravity -9.81, not 0.5.'
    ]
  },
  {
    id: 'blender-camera-animation',
    title: 'Blender: движение камеры',
    titleEn: 'Blender: camera animation',
    category: 'blender',
    summary: 'Путь, фокус и ритм кадра без рывков',
    summaryEn: 'Path, focus, shot rhythm without jerks',
    triggers: ['камера blender', 'camera animation blender', 'движен камер blender', 'камера облёт'],
    rules: [
      'Animate the camera along a path with a Follow Path constraint and a separate aim target.',
      'Keep the horizon level unless the tilt is the point; roll reads as an accident.',
      'Move slowly: a 5-10 second move across a room, not 2 seconds.',
      'Animate focus with an empty parented to the subject, and keep the aperture plausible.',
      'Use ease in and out on the first and last keyframes; linear camera motion looks robotic.',
      'Block the move in the viewport with OpenGL render before committing to full renders.',
      'Avoid passing through geometry and check the near clip on close-ups.',
      'Render a low-res preview of the whole shot at 12fps to judge the rhythm.',
      'For product turntables, keep the object static and rotate the camera rig, not the object.'
    ]
  },
  {
    id: 'blender-lighting-cinematic',
    title: 'Blender: киношный свет',
    titleEn: 'Blender: cinematic lighting',
    category: 'blender',
    summary: 'Мотивация света, контраст и один акцент',
    summaryEn: 'Motivated light, contrast, one accent',
    triggers: ['киношн свет', 'cinematic lighting', 'свет blender', 'постановк света', 'mood light'],
    rules: [
      'Every light has a motivation: a window, a lamp, a fire, the sun. Unmotivated light looks fake.',
      'Keep one key direction and let the rest support it; three equal lights flatten the scene.',
      'Use negative fill (black flags) to deepen shadows instead of lowering ambient globally.',
      'Separate the subject from the background with a rim or a practical light behind.',
      'Control contrast in the view transform (AgX) and check the black and white points.',
      'Colour temperature tells the story: warm practicals against cool moonlight is a classic for a reason.',
      'Keep the brightest area small; a large blown highlight pulls the eye away from the subject.',
      'Block with a single sun first, then add practicals; if it does not read with one light, more will not fix it.',
      'Look at the frame squinting — the value structure should survive without colour.'
    ]
  },
  {
    id: 'blender-stylized',
    title: 'Blender: стилизация и NPR',
    titleEn: 'Blender: stylized and NPR',
    category: 'blender',
    summary: 'Toon-шейдер, контур, плоские планы и контроль деталей',
    summaryEn: 'Toon shader, outlines, flat planes, controlled detail',
    triggers: ['npr', 'toon shader', 'стилизован рендер', 'cel shading', 'мультяшн blender'],
    rules: [
      'Build the toon look from a Shader to RGB plus a colour ramp in EEVEE; Cycles cannot read Shader to RGB.',
      'Two or three tone bands read as cel shading; five bands read as a bug.',
      'Outlines come from Solidify with flipped normals or Freestyle; pick one and keep the width consistent.',
      'Simplify materials: flat colour plus one shadow tone, no procedural noise.',
      'Control the silhouette first; a stylised model fails on clutter, not on shading.',
      'Light with a single directional key so the bands stay stable, especially in animation.',
      'Avoid realistic HDRI reflections in a toon scene; they break the illusion instantly.',
      'Keep outlines constant in screen space; width that changes with distance reads as a mistake.',
      'Check at the smallest output size — thin outlines vanish below 512px.'
    ]
  },
  {
    id: 'blender-hardsurface',
    title: 'Blender: hard surface',
    titleEn: 'Blender: hard surface',
    category: 'blender',
    summary: 'Булевы с умом, фаски, weighted normals и чистая топология',
    summaryEn: 'Careful booleans, bevels, weighted normals, clean topology',
    triggers: ['hard surface', 'хардсурфейс', 'blender булев', 'boolean blender', 'техник модель'],
    rules: [
      'Block the silhouette with primitives, then cut; box modelling beats boolean soup.',
      'Booleans need clean, coplanar geometry and a bevel on the cutter, or shading breaks.',
      'Apply Bevel with 2-3 segments and a limit angle instead of adding support loops everywhere.',
      'Use Weighted Normal after booleans and bevels to keep flat surfaces flat.',
      'Keep quads on visible curved surfaces; n-gons are acceptable on flat, hidden caps.',
      'Check normals after every boolean (Shift+N) and look for dark, inverted faces.',
      'Panel lines and small details come last, after the main forms read correctly.',
      'Keep real-world thickness on every plate; zero-thickness shells break in renders and engines.',
      'Review with a matcap and with the final material — different artefacts show in each.'
    ]
  },
  {
    id: 'blender-scene-organization',
    title: 'Blender: организация сцены',
    titleEn: 'Blender: scene organization',
    category: 'blender',
    summary: 'Коллекции, имена, ссылки и передача файла',
    summaryEn: 'Collections, names, links, handing the file over',
    triggers: ['организац сцен', 'scene organization blender', 'коллекции blender', 'порядок в blender'],
    rules: [
      'One collection per logical group (props, lights, cameras, characters) and no loose objects at the root.',
      'Name objects and materials by what they are (chair_wood_01), never by default suffixes.',
      'Link repeated assets from a library file instead of duplicating meshes inside the scene.',
      'Keep cameras and lights in their own collections with clear names (cam_hero, key_softbox).',
      'Use collection instances for repeated set dressing; it keeps the outliner readable and the file small.',
      'Hide but keep helper objects (targets, colliders) in a dedicated helpers collection.',
      'Keep the file free of dead data: purge orphans before saving the delivery.',
      'Save a versioned copy before destructive steps (file_v01, file_v02).',
      'Hand off with a short README: Blender version, addons required, what is baked, what is live.'
    ]
  }
]
