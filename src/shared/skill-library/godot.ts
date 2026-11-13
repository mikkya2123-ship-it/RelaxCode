import type { Skill } from '../skills.ts'

/**
 * Godot 4 playbooks. Each covers one system a game actually needs — UI,
 * input, saves, navigation, shaders, export — with the API names that changed
 * between Godot 3 and 4 and the mistakes that eat whole evenings.
 */
export const GODOT_SKILLS: Skill[] = [
  {
    id: 'godot-ui',
    title: 'Godot: интерфейс',
    titleEn: 'Godot: UI',
    category: 'godot',
    summary: 'Контейнеры, якоря, тема и масштабирование CanvasLayer',
    summaryEn: 'Containers, anchors, themes and CanvasLayer scaling',
    triggers: ['godot ui', 'godot интерфейс', 'control nod', 'godot hud', 'godot gui'],
    rules: [
      'Lay out with containers (VBoxContainer, HBoxContainer, MarginContainer, GridContainer) instead of manual positions.',
      'Use anchors and offsets for full-screen elements, and set custom_minimum_size instead of fixed sizes inside containers.',
      'One Theme resource for fonts, colours and styleboxes; never style each Control by hand.',
      'Put the HUD on a CanvasLayer so moving the camera never moves the interface.',
      'Set the project stretch mode (canvas_items with keep aspect) before designing at a fixed resolution.',
      'Buttons need focus_mode and a visible focus style if the game supports a gamepad.',
      'Connect button signals in the editor or in _ready() with a typed Callable, and disconnect when the node is freed.',
      'Text uses LabelSettings or a theme font size, not a scale transform that blurs glyphs.',
      'Hide and show groups (visible = false) instead of instancing UI every time; keep the tree stable.',
      'Test at the smallest and largest supported resolution and with a gamepad, not only with a mouse.'
    ]
  },
  {
    id: 'godot-input',
    title: 'Godot: ввод и управление',
    titleEn: 'Godot: input and controls',
    category: 'godot',
    summary: 'InputMap, действия, дедзоны и переназначение клавиш',
    summaryEn: 'InputMap, actions, deadzones and rebinding',
    triggers: ['godot input', 'inputmap', 'godot управлен', 'переназнач клавиш', 'геймпад godot'],
    rules: [
      'Define named actions in Project Settings > Input Map and read them with Input.is_action_pressed, never raw keycodes.',
      'Use get_vector with a deadzone for sticks, and give each action its own deadzone when needed.',
      'Read continuous movement in _physics_process and one-shot events with _input or _unhandled_input.',
      'Call get_viewport().set_input_as_handled() after consuming a UI-relevant event so it does not double-fire.',
      'Buffer jumps and attacks (100-150ms) so early presses are not lost between frames.',
      'Support rebinding by saving InputEvent objects to a config file, and restore defaults on conflict.',
      'Show the actual bound keys in the UI; never hardcode "press Space" text.',
      'Detect the device (keyboard, gamepad, touch) and swap prompts, not the whole controls layer.',
      'Keep a single input script or autoload for reading actions; scattered Input calls make remapping painful.'
    ]
  },
  {
    id: 'godot-state-machine',
    title: 'Godot: машина состояний',
    titleEn: 'Godot: state machine',
    category: 'godot',
    summary: 'Состояния отдельными нодами, переходы через сигналы',
    summaryEn: 'States as nodes, transitions through signals',
    triggers: ['godot state machine', 'машина состояний godot', 'fsm godot', 'состояния игрока'],
    rules: [
      'One state per file or node with enter, exit, update and physics_update methods; no giant match in _process.',
      'Keep transitions in one place (the state machine), so the graph stays readable.',
      'States emit a finished or transition signal with the target name instead of calling each other directly.',
      'Pass the owner as a typed reference; states read input and write the shared velocity/animation.',
      'Never allocate state objects every frame — create them once and reuse.',
      'Keep animation and state in sync: each state sets the animation and the transition, not both places.',
      'Log transitions with print_debug or a small on-screen label while developing.',
      'Write down the state list and allowed transitions before coding, and check every transition has an exit path.',
      'Test interrupting states (hurt during attack, jump during dash) explicitly — that is where FSMs break.'
    ]
  },
  {
    id: 'godot-save-load',
    title: 'Godot: сохранения',
    titleEn: 'Godot: save and load',
    category: 'godot',
    summary: 'JSON с версией, атомарная запись, миграции',
    summaryEn: 'Versioned JSON, atomic writes, migrations',
    triggers: ['godot save', 'сохранен godot', 'save load godot', 'сохранить игру'],
    rules: [
      'Save a plain Dictionary to JSON via FileAccess and JSON.stringify; store objects as ids, not as node paths.',
      'Put a save_version field first and write a migration for every shape change.',
      'Write to a temporary file and rename it, so a crash mid-write never corrupts the save.',
      'Keep the save path in user:// and read it with get_open_error checks, not assumptions.',
      'Serialize only what differs from defaults; derived values are recomputed on load.',
      'Never store Resource paths that may be renamed; use stable ids and a lookup table.',
      'Load in one place (SaveManager autoload) and apply state through explicit setters.',
      'Handle a corrupt or older save by falling back with a message instead of crashing.',
      'Test load into a fresh scene tree — not only into the same running session.'
    ]
  },
  {
    id: 'godot-scene-transitions',
    title: 'Godot: переходы сцен',
    titleEn: 'Godot: scene transitions',
    category: 'godot',
    summary: 'change_scene, загрузочный экран и await вместо freeze',
    summaryEn: 'change_scene, a loading screen, await instead of freezes',
    triggers: ['godot смена сцен', 'scene transition godot', 'change_scene_to_file', 'загрузочн экран godot'],
    rules: [
      'Use get_tree().change_scene_to_file for whole-game changes and change_scene_to_packed with preloaded scenes for hot paths.',
      'Never change the scene inside _process; defer it with call_deferred or await so the current frame finishes.',
      'Show a loading CanvasLayer before the switch when the next scene is heavy, and hide it after _ready.',
      'Await the transition (create_timer plus await) so the fade finishes before the tree changes.',
      'Keep persistent game state in autoloads, not in the scene being replaced.',
      'Free the old scene explicitly if you swap it manually; two live scenes cause duplicate audio and input.',
      'Pause gameplay input during the transition to avoid actions landing in the new scene.',
      'Reset time_scale to 1 on transition — a slow-motion death state easily leaks into the menu.',
      'Test the transition while audio is playing and while a timer is running.'
    ]
  },
  {
    id: 'godot-inventory',
    title: 'Godot: инвентарь',
    titleEn: 'Godot: inventory',
    category: 'godot',
    summary: 'Предметы как Resource, стеки, сигналы и UI',
    summaryEn: 'Items as resources, stacks, signals, UI',
    triggers: ['инвентар', 'godot inventory', 'godot предметы', 'инвентар godot', 'items godot'],
    rules: [
      'Define each item as a custom Resource (ItemData) with id, name, icon, stack size and effects.',
      'Store the inventory as slots (array of {id, count}) and keep derived stats out of it.',
      'Emit add/remove/change signals from the inventory and let the UI redraw from those signals.',
      'Stack by item id with a max stack size, and split stacks without losing counts.',
      'Validate capacity before adding; a full inventory must refuse with a reason, not silently drop items.',
      'Save only ids and counts, resolve resources by id on load.',
      'Keep action logic (use, equip, drop) in the item resource or an item service, not in the slot UI.',
      'Make drag and drop keyboard accessible: move, split and use must work without a mouse.',
      'Test edge cases: add a stack when full, remove the last item, use an item twice in one frame.'
    ]
  },
  {
    id: 'godot-dialogue',
    title: 'Godot: диалоги',
    titleEn: 'Godot: dialogue',
    category: 'godot',
    summary: 'Данные диалога отдельно от UI, ветвление и сигналы',
    summaryEn: 'Dialogue data separate from UI, branching and signals',
    triggers: ['godot диалог', 'dialogue godot', 'квест диалог', 'диалоговая систем'],
    rules: [
      'Keep lines in a data file (JSON or custom Resources) with id, speaker, text and next ids.',
      'The runner node walks the graph and emits line_shown and dialogue_finished; the UI only renders.',
      'Model choices as an array of {text, next, condition} and disable rather than hide unmet options.',
      'Type text with a visible speed and allow an instant-complete press; that press must not skip the whole line.',
      'Never block the game loop while waiting: use signals or await, not while loops.',
      'Localize by key, not by baked strings, and keep speaker names in the same table.',
      'Save progress as the current node id per conversation, not as an index into a list that may change.',
      'Provide a skip and a log panel for players who tap through.',
      'Test every branch with a script that walks the graph and reports unreachable or dead-end nodes.'
    ]
  },
  {
    id: 'godot-pathfinding',
    title: 'Godot: навигация и ИИ-агенты',
    titleEn: 'Godot: navigation and agents',
    category: 'godot',
    summary: 'NavigationRegion, NavigationAgent и поведение врагов',
    summaryEn: 'NavigationRegion, NavigationAgent, enemy behaviour',
    triggers: ['godot pathfinding', 'навигац godot', 'navigationagent', 'ии врагов godot', 'патфайндинг'],
    rules: [
      'Bake a NavigationRegion3D or NavigationRegion2D over walkable geometry; re-bake after layout changes.',
      'Give each agent a NavigationAgent with a radius that matches the body collider.',
      'Set the target with set_target_position and read the next point with get_next_path_position each physics tick.',
      'Move with the body velocity (move_and_slide), never by assigning global_position to the path point.',
      'Throttle path updates (every 0.2-0.5s or when the target moves significantly); recomputing per frame is waste.',
      'Check is_navigation_finished and fall back to steering or an idle state when unreachable.',
      'Add avoidance (avoidance_enabled) only for crowded scenes — it costs more than plain paths.',
      'Separate decision-making (state machine) from movement so debugging one does not rewrite the other.',
      'Visualize paths with debug lines while developing and test narrow doorways and stairs explicitly.'
    ]
  },
  {
    id: 'godot-shaders',
    title: 'Godot: шейдеры',
    titleEn: 'Godot: shaders',
    category: 'godot',
    summary: 'canvas_item и spatial, uniforms, TIME и мягкие эффекты',
    summaryEn: 'canvas_item and spatial, uniforms, TIME, soft effects',
    triggers: ['godot shader', 'шейдер godot', 'canvas_item', 'spatial shader', 'godot эффект шейдер'],
    rules: [
      'Choose the shader type by node: canvas_item for 2D and UI, spatial for 3D, sky or fog for atmosphere.',
      'Expose tunables as uniforms with hints (uniform float speed : hint_range(0.0, 5.0) = 1.0).',
      'Use TIME for continuous motion and UV for flow; never bake a frame counter into the shader.',
      'Keep an unshaded variant for UI effects so lighting does not wash them out.',
      'For dissolve, use a noise texture plus alpha and clip() rather than blending a texture.',
      'Sample textures with the correct hint (hint_default_white, filter_linear) to avoid unexpected colour spaces.',
      'Prefer one shader with parameters over many near-identical copies.',
      'Test on the lowest target renderer (Compatibility) — some features differ between Forward+ and Mobile.',
      'Document the uniforms in a comment at the top so the next person knows what to tweak.'
    ]
  },
  {
    id: 'godot-particles',
    title: 'Godot: частицы',
    titleEn: 'Godot: particles',
    category: 'godot',
    summary: 'GPUParticles, process material и бюджет на мобильных',
    summaryEn: 'GPUParticles, process material, a mobile budget',
    triggers: ['godot частиц', 'gpu particles', 'particles godot', 'эффект искр godot'],
    rules: [
      'Use GPUParticles2D/3D with a ParticleProcessMaterial; CPUParticles are the fallback for unsupported platforms.',
      'Set amount from the visual target: 16-64 for a spark burst, hundreds only for continuous atmosphere.',
      'Drive shape, direction, spread and gravity in the process material, not by scripting each particle.',
      'One-shot effects use emitting with a lifetime and free themselves afterwards (queue_free on finished).',
      'Set the particle draw order and material blend mode deliberately: additive for glow, mix for smoke.',
      'Use texture atlases and keep particle textures small; large soft sprites are fill-rate killers.',
      'Disable particles off-screen (visibility toggles) and cap them on mobile.',
      'Emit from the right origin node so scaling the parent does not distort the burst.',
      'Check the effect against the actual background: white sparks on a bright level disappear.'
    ]
  },
  {
    id: 'godot-tilemap',
    title: 'Godot: TileMap и уровни',
    titleEn: 'Godot: tilemaps and levels',
    category: 'godot',
    summary: 'TileMapLayer, террейны, коллизии и правила рисования',
    summaryEn: 'TileMapLayer, terrains, collisions, painting rules',
    triggers: ['tilemap', 'godot tilemap', 'тайлмап', 'tilemaplayer', 'уровень 2d godot'],
    rules: [
      'In Godot 4.3+ use TileMapLayer one per layer (ground, decoration, collision) instead of the deprecated TileMap node.',
      'Define physics layers on the tile set and give each tile the right collision polygon.',
      'Use terrain sets with peering bits so edges and corners connect automatically.',
      'Keep one tile size across the project and draw on the grid with snapping enabled.',
      'Separate visuals from collision: a decoration layer with no physics, a collision layer with no texture.',
      'Set y_sort_enabled on layers that need depth sorting, and match the origin of sprites.',
      'Keep large levels chunked into scenes with their own TileMapLayer, loaded by region.',
      'Bake navigation polygons from walkable tiles instead of hand-placing them per level.',
      'Test level edges and one-tile gaps: those are where players fall through collision.'
    ]
  },
  {
    id: 'godot-multiplayer',
    title: 'Godot: мультиплеер',
    titleEn: 'Godot: multiplayer',
    category: 'godot',
    summary: 'ENet, authority, спавнер и синхронизация состояния',
    summaryEn: 'ENet, authority, spawner, state sync',
    triggers: ['godot multiplayer', 'мультиплеер godot', 'enet', 'multiplayerspawner', 'сетев игра godot'],
    rules: [
      'Create an ENetMultiplayerPeer on the server (create_server) and on clients (create_client), then assign multiplayer.multiplayer_peer.',
      'Use MultiplayerSpawner for instancing and MultiplayerSynchronizer for replicated state; do not rpc every transform.',
      'Set authority explicitly: the owning peer drives its player, the server drives world state.',
      'Validate every client rpc on the server; never trust a client for damage, money or inventory.',
      'Send inputs or intent, not positions, for authoritative movement.',
      'Keep rpc payloads small (numbers and ids); big dictionaries per tick saturate the channel.',
      'Handle disconnect: free the player node, update the roster and let the scene continue.',
      'Test with two local clients on different ports before trying across machines.',
      'Log the peer id and the authority in debug output, and mark unreliable where loss is acceptable.'
    ]
  },
  {
    id: 'godot-performance',
    title: 'Godot: производительность',
    titleEn: 'Godot: performance',
    category: 'godot',
    summary: 'Профайлер, MultiMesh, пулы и лишние _process',
    summaryEn: 'Profiler, MultiMesh, pools, unnecessary _process',
    triggers: ['godot оптимизац', 'godot performance', 'производительн godot', 'fps godot', 'godot профайлер'],
    rules: [
      'Profile before optimizing: the Debugger > Profiler and the Monitors tab show where the frame actually goes.',
      'Disable _process and _physics_process on nodes that do not need them every frame.',
      'Use MultiMeshInstance for hundreds of identical props, and instancing for dozens.',
      'Pool bullets, particles and enemies instead of instancing and freeing every shot.',
      'Cache node references in @onready variables; get_node in _process is a silent per-frame cost.',
      'Avoid string comparisons and allocations in hot loops; compare enums and reuse arrays.',
      'If it does not move, make it static: static bodies and baked lighting are far cheaper.',
      'Watch draw calls and object count in the Monitors tab, not only the fps counter.',
      'Set a frame budget (16.6ms at 60) and test the worst scene, not the empty one.'
    ]
  },
  {
    id: 'godot-project-structure',
    title: 'Godot: структура проекта',
    titleEn: 'Godot: project structure',
    category: 'godot',
    summary: 'Папки по системам, автолоады по делу, имена без мусора',
    summaryEn: 'Folders by system, autoloads with purpose, clean names',
    triggers: ['godot структур проект', 'godot project structure', 'организац проект godot', 'autoload godot'],
    rules: [
      'Organise by feature (player, enemies, ui, systems), not by file type scattered across the root.',
      'Keep scenes and their scripts side by side so a rename never orphans them.',
      'Autoloads are for true globals (save, audio, settings, event bus) — not for convenience references.',
      'Prefix abstract base scenes with base_ and instantiate concrete scenes that inherit them.',
      'Name nodes by role (PlayerSprite, HitBox), never leave Node2D2, Sprite3 and Label7 in a shipped scene.',
      'Keep project.godot free of machine-specific paths and commit .import settings for the assets you ship.',
      'Use @tool scripts only where editor automation genuinely helps, and guard them with Engine.is_editor_hint().',
      'Group input actions, physics layers and autoloads with a naming convention documented in the README.',
      'Run a check before committing: no unused autoloads, no duplicated scenes, no missing dependencies.'
    ]
  },
  {
    id: 'godot-testing',
    title: 'Godot: тесты',
    titleEn: 'Godot: testing',
    category: 'godot',
    summary: 'GUT, headless-прогон и тестируемая логика',
    summaryEn: 'GUT, headless runs, testable logic',
    triggers: ['godot тест', 'gut godot', 'тесты игры', 'godot unit test', 'headless godot'],
    rules: [
      'Put pure logic (damage, inventory, economy, save migration) in plain classes that can be tested without the tree.',
      'Use GUT or gdUnit4 for scene-level tests with a real SceneTree and awaits.',
      'Run tests headless in CI with godot --headless -s addons/gut/gut_cmdln.gd -gexit and fail the build on errors.',
      'One assertion per behaviour; name tests by the rule they protect.',
      'Use helper factories for common nodes instead of repeating setup in every test.',
      'Free nodes you create (add_child then queue_free, or autofree) so tests do not leak into each other.',
      'Test the intended failure paths: full inventory, corrupt save, missing resource.',
      'Keep tests fast (under a second each); anything longer belongs in a separate integration pass.',
      'Verify the exported build at least once — headless tests do not catch export-only problems.'
    ]
  },
  {
    id: 'godot-shop-economy',
    title: 'Godot: магазин и экономика',
    titleEn: 'Godot: shop and economy',
    category: 'godot',
    summary: 'Одна валюта в одном месте, цены данными, честный баланс',
    summaryEn: 'One wallet in one place, prices as data, honest balance',
    triggers: ['godot магазин', 'godot экономик', 'shop godot', 'внутриигров валюта', 'godot shop'],
    rules: [
      'Keep the wallet in one autoload with add/spend methods and a changed signal; no ad-hoc counters.',
      'Prices live in item resources, never in UI code, so balancing does not touch the shop screen.',
      'Validate affordability and inventory space before the transaction and refuse atomically.',
      'Transactions are a single function: check, deduct, grant, emit — in that order, all or nothing.',
      'Show prices and the current balance next to each other, with the change previewed on hover.',
      'Design the economy around a sink and a source table: where money comes from and where it goes.',
      'Save purchases by item id; re-derive owned state on load instead of trusting the UI.',
      'Never price anything for real currency without an explicit confirmation step and a receipt.',
      'Test numbers with a scripted simulation of an hour of play, not by eyeballing the shop.'
    ]
  },
  {
    id: 'godot-juice',
    title: 'Godot: game feel',
    titleEn: 'Godot: game feel',
    category: 'godot',
    summary: 'Хитстоп, тряска, твины и звук на удар',
    summaryEn: 'Hitstop, shake, tweens, sound on impact',
    triggers: ['game feel', 'godot juice', 'хитстоп', 'тряска камер godot', 'сочность игр'],
    rules: [
      'Every impact gets three layers: a freeze, a visual cue and a sound — one alone feels flat.',
      'Hitstop 40-90ms via Engine.time_scale or a paused timer; restore it on a timer, never by hoping.',
      'Screenshake with a short decay (0.1-0.25s) and small amplitude (2-6px); trauma-based shake beats random.',
      'Tween scale and rotation in 80-140ms with ease-out on spawn and pickups.',
      'Flash the sprite white for one or two frames on damage; a tint alone is invisible in motion.',
      'Add squash and stretch on jump and land, but keep the collider unchanged.',
      'Pitch-shift repeated sounds slightly (0.95-1.05) so a burst is not a machine gun of one sample.',
      'Delay the game-over or reward screen by 100-300ms so the last hit is visible.',
      'Respect accessibility: a toggle for shake and flashes, and never rely on flashing alone.'
    ]
  },
  {
    id: 'godot-camera',
    title: 'Godot: камера',
    titleEn: 'Godot: camera',
    category: 'godot',
    summary: 'Сглаживание, лимиты, упреждение и тряска',
    summaryEn: 'Smoothing, limits, look-ahead and shake',
    triggers: ['godot камера', 'godot camera', 'camera2d', 'camera3d', 'камер godot'],
    rules: [
      'Camera2D/3D follows a target with position smoothing enabled and a speed around 6-10, not instant snapping.',
      'Set limits from the level bounds so the camera never shows the void at the edges.',
      'Add look-ahead in the direction of movement (40-80px) with a slow return to centre.',
      'Offset the camera slightly upward for platformers so the player sees more of the path ahead.',
      'Shake with a separate offset applied after smoothing, with decay, so it never corrupts the follow state.',
      'For 3D, use a SpringArm3D for third-person collision avoidance instead of a hard-coded distance.',
      'Keep FOV modest (60-75 degrees) and never animate it quickly.',
      'Reset the camera on respawn or respawn the player at the camera position, never mid-shake.',
      'Test the camera while the target moves fast vertically — that is where smoothing lags visibly.'
    ]
  },
  {
    id: 'godot-light-2d',
    title: 'Godot: свет 2D',
    titleEn: 'Godot: 2D lighting',
    category: 'godot',
    summary: 'PointLight2D, CanvasModulate, normal map и тени',
    summaryEn: 'PointLight2D, CanvasModulate, normal maps, shadows',
    triggers: ['godot свет 2d', '2d освещен godot', 'pointlight2d', 'godot lighting 2d', 'тени 2d godot'],
    rules: [
      'Dim the scene with a CanvasModulate first; lights only read when the base is dark.',
      'Add PointLight2D nodes with a texture and a matching scale; the light texture is the falloff.',
      'Enable shadows per light only where needed — every shadow-casting light costs fill rate.',
      'Use normal maps on sprites for volume; flat sprites lit by a point light still look flat.',
      'Set energy carefully (0.6-1.2): overlapping lights stack to pure white quickly.',
      'Use LightOccluder2D around geometry that should block light, with the collision layer configured.',
      'Separate gameplay light (torches, lamps) from UI glow; UI glows belong to shaders, not lights.',
      'Keep the light count per screen under about 8 on mobile and cull off-screen lights.',
      'Test in a dark room on a bad monitor: a scene that only reads on a bright display is too dark.'
    ]
  },
  {
    id: 'godot-debug',
    title: 'Godot: отладка',
    titleEn: 'Godot: debugging',
    category: 'godot',
    summary: 'Debugger, remote tree, print_debug и мониторы',
    summaryEn: 'Debugger, remote tree, print_debug, monitors',
    triggers: ['godot отладк', 'godot debug', 'ошибк godot', 'godot debugger', 'godot профилир'],
    rules: [
      'Read the first error in the Debugger panel and fix it before the rest — the later ones are usually cascades.',
      'Use breakpoints and the remote scene tree to inspect live nodes instead of adding dozens of prints.',
      'print_debug() gives file and line; use push_error and push_warning for real problems so they surface in the panel.',
      'Watch the Monitors tab for object count, draw calls and memory while the scene runs.',
      'Toggle visible collision shapes and navigation meshes from the Debug menu when physics misbehaves.',
      'Reproduce the bug in the smallest scene possible; large scenes hide the cause.',
      'Check for freed-object errors (is_instance_valid) when a node is deleted asynchronously.',
      'Keep a debug overlay for game state (fps, state, velocity) behind a key toggle, not always on.',
      'Remove or gate debug prints before release; a print in a hot loop tanks the frame rate.'
    ]
  }
]
