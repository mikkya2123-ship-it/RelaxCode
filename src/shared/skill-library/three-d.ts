import type { Skill } from '../skills.ts'

/**
 * Real-time 3D for the web: the pipelines, budgets and shader basics that
 * separate a smooth scene from a 6fps particle soup.
 */
export const THREE_D_SKILLS: Skill[] = [
  {
    id: 'r3f-scene',
    title: 'Сцена на React Three Fiber',
    titleEn: 'React Three Fiber scene',
    category: 'three-d',
    summary: 'Декларативная сцена, dispose на размонтирование, Canvas как рамка',
    summaryEn: 'Declarative scene, disposal on unmount, Canvas as the frame',
    triggers: ['react three fiber', 'r3f', '@react-three/fiber', 'drei', 'сцена react 3d'],
    rules: [
      'One Canvas per page area, mounted once; it owns the render loop, the camera and the resize handling.',
      'Build the scene as components (model, lights, rig); never call imperative three.js on every render.',
      'Dispose geometries, materials, textures and render targets on unmount — R3F does not do it for you.',
      'Use drei helpers for controls, environment, text and loaders instead of re-implementing them.',
      'Keep state outside the render loop: animation reads refs and mutable objects, not React state.',
      'Use useFrame for per-frame work and always multiply motion by delta, never by a fixed step.',
      'Set dpr={[1, 2]} so retina screens do not quadruple the fill cost.',
      'Wrap the Canvas in a fixed-aspect container; the canvas must never drive layout on its own.',
      'Load models with Suspense plus a real fallback, and keep the rest of the page interactive.'
    ]
  },
  {
    id: 'threejs-lighting-scene',
    title: 'Свет в 3D-сцене',
    titleEn: 'Lighting a real-time scene',
    category: 'three-d',
    summary: 'Риг из трёх источников, окружение и бюджет теней',
    summaryEn: 'A three-light rig, an environment, a shadow budget',
    triggers: ['свет 3d', '3d lighting', 'three.js light', 'риг света', 'теней настройк'],
    rules: [
      'Start from an environment (HDRI or a procedural room) so metals and glass have something to reflect.',
      'Add a three-light rig: key at 45 degrees, fill at 30-50% of the key, rim behind for separation.',
      'Only the key casts shadows; two shadow-casting lights double the cost and muddy the result.',
      'Use soft shadows from an area or directional light, never a point light with a tiny radius.',
      'Set shadow map size to the smallest that looks fine (1024 is usually enough) and tighten the frustum.',
      'Tune exposure and tone mapping (ACES) before adding more lights — most scenes are just underexposed.',
      'Keep ambient near 0.1-0.3 with the environment doing the fill, otherwise surfaces go flat.',
      'Match light colour temperature across sources; a warm key with a cold rim is a deliberate choice.',
      'Do not animate the sun unless the scene is about time; static light reads as product photography.'
    ]
  },
  {
    id: 'three-materials',
    title: 'Материалы в Three.js',
    titleEn: 'Three.js materials',
    category: 'three-d',
    summary: 'PBR-значения, envMap, честные металлы и без самосвета вместо света',
    summaryEn: 'PBR values, envMap, honest metals, no glow as a substitute for light',
    triggers: ['материал three', 'three.js material', 'pbr материал', 'material pbr', 'messtandardmaterial'],
    rules: [
      'Use physical values: metal is metalness 1 with roughness 0.05-0.4; plastic is metalness 0 with 0.3-0.6.',
      'A metal without an environment map renders black — set the scene environment before judging it.',
      'Do not use emissive to fake lighting; it cannot receive shadows and breaks the composition.',
      'Textures need the right colour space: sRGB for albedo, linear for roughness, metalness and normal maps.',
      'Share materials between meshes; each unique material is a draw call and a shader compile.',
      'Keep normal maps subtle (0.5-1 intensity) — exaggerated normals look like plastic wrap.',
      'Use alphaTest instead of transparent where possible; transparency sorting is the classic artefact source.',
      'Verify the material from three angles and under the final environment, not in isolation.',
      'Define a naming convention (material_wood_oak) so the asset survives a handoff.'
    ]
  },
  {
    id: 'shader-glsl',
    title: 'Шейдеры и GLSL',
    titleEn: 'Shaders and GLSL',
    category: 'three-d',
    summary: 'Одна идея на шейдер, uniforms вместо констант, проверка на слабых GPU',
    summaryEn: 'One idea per shader, uniforms over constants, tested on weak GPUs',
    triggers: ['шейдер', 'shader', 'glsl', 'fragment shader', 'vertex shader', 'шэйдер'],
    rules: [
      'One visual idea per shader; combining noise, refraction and displacement at once is unreadable.',
      'Expose everything that might be tuned as a uniform, with sensible defaults.',
      'Write the vertex shader first and keep it cheap: displacement needs normals recalculated or they lie.',
      'Use uv-driven effects with an explicit aspect ratio uniform so circles stay round.',
      'Prefer a few octaves of simplex/value noise over heavy loops; banding and cost both drop.',
      'Guard against division by zero and pow() of negative values — most GLSL NaNs come from those.',
      'Cap the loop count literally; dynamic loops with break are slow on older drivers.',
      'Test on integrated graphics and a mid-range phone, and watch the frame time, not the fps counter.',
      'Provide a fallback material when shader compilation fails, so the page never goes black.'
    ]
  },
  {
    id: 'webgl-performance',
    title: 'Производительность WebGL',
    titleEn: 'WebGL performance',
    category: 'three-d',
    summary: 'Draw calls, инстансинг, dpr и стабильные 60 кадров',
    summaryEn: 'Draw calls, instancing, dpr, a steady 60 frames',
    triggers: ['webgl производительн', 'three.js performance', 'draw calls', 'инстансинг', 'fps 3d'],
    rules: [
      'Budget: under 100 draw calls, under 300k triangles and under 60MB of textures for a landing page.',
      'Merge static geometry and instance repeated meshes; ten identical props are one instanced mesh.',
      'Cap devicePixelRatio at 2 and skip anti-aliasing when the canvas is already dense.',
      'Use one render loop for the whole app, pause it when the canvas is off-screen or the tab is hidden.',
      'Compress textures (KTX2/Basis) and keep them under 2048px unless the object fills the screen.',
      'Avoid per-frame allocations: reuse vectors and matrices, no new objects inside the loop.',
      'Set frustum culling on and keep geometry bounding spheres correct after transforms.',
      'Profile with the browser GPU inspector before optimizing guesses; fill rate and draw calls fail differently.',
      'Degrade gracefully: drop shadows, then post-processing, then dpr on weak devices.'
    ]
  },
  {
    id: 'threejs-postprocessing',
    title: 'Постобработка',
    titleEn: 'Post-processing',
    category: 'three-d',
    summary: 'Bloom и tonemapping по делу, один эффект, честная стоимость',
    summaryEn: 'Bloom and tonemapping with purpose, one effect, honest cost',
    triggers: ['постобработк', 'postprocessing', 'bloom', 'эффект свечен', 'эффекты three'],
    rules: [
      'Start with tone mapping and colour correction only; add an effect when it solves a real problem.',
      'One stylistic effect per scene — bloom plus chromatic aberration plus grain is a filter pack, not a look.',
      'Bloom needs threshold and intensity tuned per scene; default values blow out highlights.',
      'Post-processing runs at full resolution by default: render at dpr 1 and upscale before adding more passes.',
      'SSAO and DOF cost real frames — enable them for hero shots, disable in interactive scenes.',
      'Keep the effect chain short (under 4 passes) and reuse render targets between passes.',
      'Disable effects on prefers-reduced-motion and on devices that report a low frame budget.',
      'Check the effect in the final composition with real UI on top, not on an empty test scene.'
    ]
  },
  {
    id: 'gltf-pipeline',
    title: 'Пайплайн glTF',
    titleEn: 'glTF pipeline',
    category: 'three-d',
    summary: 'Драко, KTX2, атласы и один файл вместо папки',
    summaryEn: 'Draco, KTX2, atlases, one file instead of a folder',
    triggers: ['gltf', 'glb', 'модель веб', 'gltf pipeline', 'draco', 'ktx2'],
    rules: [
      'Export one GLB per scene, not a folder of textures and a JSON that must resolve paths.',
      'Compress geometry with Draco or Meshopt and textures with KTX2/Basis; measure the download before shipping.',
      'Bake transformations into the mesh, apply scale, and keep one unit equal to one metre.',
      'Merge materials that differ only by colour into one material with a texture atlas.',
      'Name meshes and materials meaningfully — the web code finds them by name.',
      'Keep the triangle budget explicit per scene and record it in the file name or README.',
      'Test the GLB in three viewers (three.js editor, Babylon sandbox, model-viewer) before integrating.',
      'Provide a low-poly LOD and a poster frame for slow connections.',
      'Validate with the Khronos glTF validator and fix warnings, not only errors.'
    ]
  },
  {
    id: 'scroll-3d',
    title: '3D и скролл',
    titleEn: 'Scroll-driven 3D',
    category: 'three-d',
    summary: 'Скролл как таймлайн, без джиттера и захвата колеса',
    summaryEn: 'Scroll as a timeline, without jitter or scroll hijacking',
    triggers: ['scroll 3d', '3d скролл', 'scroll animation 3d', 'параллакс 3d', 'scrolltrigger'],
    rules: [
      'Let the page scroll normally; the 3D camera follows scroll progress, it never hijacks the wheel.',
      'Map scroll to a normalized 0-1 progress and interpolate towards it every frame (lerp 0.08-0.15).',
      'Design the scene as keyframes along that timeline: camera pose, object state, light intensity.',
      'Keep one WebGL canvas fixed in the viewport and move the camera, instead of mounting scenes per section.',
      'Respect prefers-reduced-motion: no camera animation, show the final state and static frames.',
      'Preload the model and textures before the section enters the viewport; a late pop breaks the illusion.',
      'Test at 60Hz and on a low-end laptop — smooth scroll interpolation hides most frame drops.',
      'Keep a text fallback in the DOM so content is readable with WebGL disabled.',
      'Do not pin the page for more than two screens; users need to be able to leave.'
    ]
  },
  {
    id: 'particle-systems',
    title: 'Частицы и эффекты',
    titleEn: 'Particle systems',
    category: 'three-d',
    summary: 'Один буфер, GPU-анимация, честное количество частиц',
    summaryEn: 'One buffer, GPU animation, honest particle counts',
    triggers: ['частиц', 'particles', 'particle system', 'эффект искр', 'points three'],
    rules: [
      'Particles live in one BufferGeometry with typed arrays, updated on the GPU, not one mesh per particle.',
      'Count from the visual target: 2k-10k points is plenty for dust, 50k+ needs a real reason.',
      'Animate in the vertex shader with a time uniform and per-particle seeds; no CPU loop per frame.',
      'Additive blending only for glow; otherwise use normal blending with a soft alpha texture.',
      'Give particles a lifecycle: spawn, drift, fade, respawn, so the field never looks static or infinite.',
      'Keep the spawn volume inside the camera frustum; invisible particles are wasted fill rate.',
      'Cap the effect on mobile by pixel ratio and count, and disable it under prefers-reduced-motion.',
      'Test with the final background: white particles on a light page are invisible, not subtle.'
    ]
  },
  {
    id: 'camera-animation',
    title: 'Камера и раскадровка',
    titleEn: 'Camera animation',
    category: 'three-d',
    summary: 'Движение с целью, без случайных облётов',
    summaryEn: 'Purposeful motion, no random fly-arounds',
    triggers: ['камера анимац', 'camera animation', 'облёт камеры', 'camera path', 'движен камеры'],
    rules: [
      'Every camera move has a start idea and an end idea: reveal, focus or transition.',
      'Use eased paths (ease-in-out) and keep the subject on screen at every keyframe.',
      'Prefer slow dolly and orbit moves; fast fly-throughs are nauseating and hide the model.',
      'Keep the horizon stable unless the tilt is the point; roll reads as an accident.',
      'Match the lens to the subject: 50-85mm for products, 24-35mm for space and architecture.',
      'Never animate the camera while the user is interacting; pause and resume rather than fight the input.',
      'Respect prefers-reduced-motion by cutting to the final framing.',
      'Test the path for clipping through geometry and for near-plane intersections.'
    ]
  },
  {
    id: '3d-typography',
    title: '3D-типографика',
    titleEn: '3D typography',
    category: 'three-d',
    summary: 'Объём с фаской, читаемый силуэт и честный вес',
    summaryEn: 'Volume with bevels, a readable silhouette, controlled weight',
    triggers: ['3d текст', '3d typography', 'объёмн букв', 'textgeometry', '3d шрифт'],
    rules: [
      'Use a real typeface converted to outlines, not an extruded system font.',
      'Extrusion depth is 5-15% of the cap height; deeper letters read as blocks, not type.',
      'Bevel 1-2% of the cap height catches light and stops the letters looking like painted cardboard.',
      'Keep the front face flat and the sides smooth; the silhouette carries the legibility.',
      'One or two words maximum in 3D; a sentence belongs in DOM text.',
      'Light the type from the side so the extrusion reads; frontal light flattens it back to 2D.',
      'Check kerning after conversion — extruded outlines often need manual spacing.',
      'Provide a DOM text alternative for accessibility and for slow devices.'
    ]
  },
  {
    id: 'css-3d',
    title: '3D на CSS',
    titleEn: 'CSS 3D',
    category: 'three-d',
    summary: 'Perspective, preserve-3d и transform-style без магии',
    summaryEn: 'Perspective, preserve-3d and transform-style without magic',
    triggers: ['css 3d', 'perspective css', 'transform-style', '3d карточк css', 'css перспектив'],
    rules: [
      'Set perspective on the container (600-1200px) and preserve-3d on the parent of the transformed elements.',
      'Animate transform only; animating width, height or top breaks the 3D illusion and the frame rate.',
      'Keep rotations small (under 20 degrees) for cards and UI; large angles need real 3D.',
      'Use backface-visibility: hidden only on elements that actually flip.',
      'Compose transforms in one string (translate3d rotateX rotateY) to avoid order surprises.',
      'Add will-change only while the animation runs, and remove it after.',
      'Respect prefers-reduced-motion: fall back to a static tilt or no transform.',
      'Test with a text selection and with the browser zoomed — CSS 3D often blurs text.'
    ]
  },
  {
    id: '3d-configurator',
    title: '3D-конфигуратор товара',
    titleEn: '3D product configurator',
    category: 'three-d',
    summary: 'Варианты без перезагрузки, честные цвета, шаринг конфигурации',
    summaryEn: 'Variants without reloads, honest colours, shareable configs',
    triggers: ['конфигуратор', 'configurator', '3d товар настройк', 'product configurator', 'кастомизац 3d'],
    rules: [
      'One model with swappable materials, not one model per variant — instant switches, no loading.',
      'Show real material values: the same base colour reads differently on metal and plastic, so preview both.',
      'Colour pickers use the product palette, with a name and a swatch, not an arbitrary hex field.',
      'Disable impossible combinations instead of allowing them and failing at checkout.',
      'Store configuration in the URL and let the user copy a link or a screenshot.',
      'Keep the camera under user control with sensible limits; add a reset view action.',
      'Lazy-load the heavy model after the first paint and show a poster while it loads.',
      'Update the price and the spec list live next to the canvas, never behind a step.',
      'Test the configurator on a phone: canvas takes the top, options are a scrollable sheet.'
    ]
  },
  {
    id: 'ar-preview',
    title: 'AR-просмотр',
    titleEn: 'AR preview',
    category: 'three-d',
    summary: 'model-viewer, масштаб в метрах, fallback на фото',
    summaryEn: 'model-viewer, real-world scale, a photo fallback',
    triggers: ['ar', 'augmented reality', 'model-viewer', 'ar просмотр', '3d в комнате'],
    rules: [
      'Use model-viewer with ar and camera-controls rather than a custom AR pipeline.',
      'Model in metres: a chair is 0.45m seat height, and placement in a room depends on that.',
      'Keep the GLB under 3-5MB with Draco compression; AR startup time is the whole experience.',
      'Provide an iOS USDZ and an Android WebXR path, or the launcher will be missing on one platform.',
      'Add a poster image and explicit dimensions so the page does not shift while loading.',
      'Offer a photo fallback and a "поставить в комнату" explanation when AR is unsupported.',
      'Light the model with a neutral environment map; baked shadows from another room look wrong.',
      'Give the user scale and rotate controls before placement, and a reset.',
      'Test on a real phone in normal room light — emulators hide tracking and exposure problems.'
    ]
  },
  {
    id: 'model-optimization',
    title: 'Оптимизация 3D-модели',
    titleEn: '3D model optimization',
    category: 'three-d',
    summary: 'Полигоны, атласы, LOD и вес под мобильный интернет',
    summaryEn: 'Polygons, atlases, LODs and weight for mobile networks',
    triggers: ['оптимизац модель', 'model optimization', 'полигон оптимизац', 'decimate', 'lod модель'],
    rules: [
      'Set a triangle budget from the target device before modelling: 30-80k for a hero object, 2-10k per prop.',
      'Decimate with a plan: keep hard-surface edges, protect UV seams, then fix shading by hand.',
      'Merge materials and bake a texture atlas; every extra material is a draw call and a texture bind.',
      'Bake lighting and ambient occlusion into the texture instead of keeping extra lights.',
      'Bake normals from the high-poly mesh, do not hand-paint details that a bake can capture.',
      'Keep textures power-of-two and compressed (KTX2/Basis), 1024-2048 for hero, 512 for props.',
      'Produce LODs at 100/50/25% and switch by screen coverage, not by distance alone.',
      'Strip animations, cameras and lights from the exported web model.',
      'Measure the final download and the first-frame time on a throttled 3G profile.'
    ]
  },
  {
    id: 'threejs-physics',
    title: 'Физика в браузере',
    titleEn: 'Web 3D physics',
    category: 'three-d',
    summary: 'Rapier, фиксированный шаг и синхронизация меша',
    summaryEn: 'Rapier, a fixed step, mesh synchronisation',
    triggers: ['физика three', 'physics three.js', 'rapier', 'cannon', 'аммо физика'],
    rules: [
      'Use a fixed timestep (1/60) with an accumulator; variable steps make collisions frame-rate dependent.',
      'Keep the physics world separate from the scene graph; sync transforms once per rendered frame.',
      'Colliders are simple primitives (box, sphere, capsule) even when the visual mesh is detailed.',
      'Sleep bodies that settle, and cap the substeps per frame to avoid a death spiral.',
      'Use raycasts and shape casts for interaction instead of invisible collider walls everywhere.',
      'Keep gravity and damping explicit in the scene config so the behaviour is reproducible.',
      'Do not drive gameplay off rendered fps; read the fixed-step state.',
      'Limit the number of dynamic bodies on mobile and switch to baked animation when it is only decoration.',
      'Test with slow frames: physics must stay stable when rendering drops to 20fps.'
    ]
  },
  {
    id: 'hdri-studio',
    title: 'HDRI и студийное окружение',
    titleEn: 'HDRI studio setup',
    category: 'three-d',
    summary: 'Один envMap, PMREM, сила света и честные отражения',
    summaryEn: 'One envMap, PMREM, light strength, honest reflections',
    triggers: ['hdri', 'environment map', 'pmrem', 'студийн окружен', 'envmap'],
    rules: [
      'Pick one HDRI that matches the intended light: soft studio, overcast sky or hard sun; do not mix.',
      'Pre-filter with PMREM and use the same environment for background and lighting only when it is meant to be seen.',
      'Control the intensity (0.6-1.2) before adding artificial lights; most scenes need less light than expected.',
      'Blur or hide the HDRI background when the page has its own colour; a visible stock kitchen is a tell.',
      'Add a ground plane or a shadow catcher so objects do not float in the environment.',
      'Match the light direction to the shadows in the composited UI, or the scene feels pasted on.',
      'Keep the HDRI file small (1-2k, compressed) — it is only an env map, not a background photo.',
      'Check metals and glass under the final env; these two materials expose any mismatch.'
    ]
  },
  {
    id: 'terrain',
    title: 'Ландшафт и окружение',
    titleEn: 'Terrain and environment',
    category: 'three-d',
    summary: 'Высоты, слои материалов, дистанция и туман',
    summaryEn: 'Heights, material layers, distance and fog',
    triggers: ['ландшафт', 'terrain', 'рельеф', 'heightmap', 'окружен сцен'],
    rules: [
      'Start from a heightmap or a procedural field; sculpted noise without a scale reference reads as random.',
      'Blend materials by slope and height (grass on flats, rock on steep faces), not by random patches.',
      'Keep the terrain mesh adaptive: fewer triangles away from the camera, more where the path goes.',
      'Use fog and distance haze to hide the far edge; a hard terrain boundary breaks the illusion.',
      'Place vegetation with instancing and density falloff, with a wind animation in the vertex shader.',
      'Bake ambient occlusion into vertex colours or a lightmap for large static ground areas.',
      'Keep the sun direction consistent across terrain, props and shadows.',
      'Cap the visible draw distance and test the scene while moving the camera fast — pop-in is the giveaway.',
      'Add a ground texture at two scales (near detail, far aerial) so the surface never looks flat.'
    ]
  }
]
