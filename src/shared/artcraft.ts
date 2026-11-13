/**
 * ArtCraft Craft App Suite: the open-source creative apps from the ArtCraft
 * team, each of which ships an MCP server in its own CLI.
 *
 * The suite is not uniform: most apps take `--automation-read-root` /
 * `--automation-write-root`, PdfCraft takes `--root`, TextureCraft and
 * MaterialCraft take `--read-root` / `--write-root`, LightCraft takes a folder
 * positionally, and a few apps have no confinement flags at all. Keeping the
 * table here means the detection, the setup and the settings screen all agree
 * on one command line per app.
 */

export const ARTCRAFT_APP_IDS = [
  'photocraft',
  'vectorcraft',
  'filmcraft',
  'lightcraft',
  'pdfcraft',
  'effectcraft',
  'designcraft',
  'figcraft',
  'wordcraft',
  'soundcraft',
  'deckcraft',
  'cadcraft',
  'gridcraft',
  'texturecraft',
  'materialcraft',
  'craft-anything',
  'solidcraft'
] as const

export type ArtCraftAppId = (typeof ARTCRAFT_APP_IDS)[number]

/** How an app lets the MCP client grant folders. */
export type ArtCraftRoots = 'automation' | 'root' | 'read-write' | 'positional' | 'none'

/**
 * `headless` runs the MCP server against its own in-process engine: fast and
 * safe, but a document opened there is not the one the user sees. `live`
 * bridges the same tools to a running desktop app, so the agent edits the
 * open document and UI tools become available.
 */
export type ArtCraftConnectMode = 'headless' | 'live'

export interface ArtCraftAppDef {
  id: ArtCraftAppId
  /** Product name, also the install folder under ArtCraft on Windows. */
  label: string
  /** Command-line tool that speaks MCP. */
  cli: string
  /** Desktop executable (no extension). */
  gui: string
  roots: ArtCraftRoots
  /**
   * The desktop app has a control channel the CLI can bridge to. Only apps
   * whose CLI documents `mcp --bridge` should set this.
   */
  bridge?: boolean
  repo: string
  site: string
  /** True for the community app that is not part of the ArtCraft org. */
  community?: boolean
  /** App-specific paragraph for the agent playbook. */
  notes: string
}

export const ARTCRAFT_APPS: readonly ArtCraftAppDef[] = [
  {
    id: 'photocraft',
    label: 'PhotoCraft',
    cli: 'photocraft-cli',
    gui: 'photocraft',
    roots: 'automation',
    bridge: true,
    repo: 'https://github.com/storytold/photocraft',
    site: 'https://getartcraft.com/apps/photocraft',
    notes:
      'PhotoCraft is a Photoshop-class image editor. Prefer `command_batch` for a series of edits, `doc_inspect` to read the document and `render_preview` to see the result. PSD and .pcraft files round-trip; never overwrite the only copy of a document without a backup. Recovery snapshots live in PhotoCraft’s own config folder, outside the granted root, and are refused by design: ask the user to restore from PhotoCraft’s recovery dialog instead of opening those files.'
  },
  {
    id: 'vectorcraft',
    label: 'VectorCraft',
    cli: 'vectorcraft-cli',
    gui: 'vectorcraft',
    roots: 'automation',
    repo: 'https://github.com/storytold/vectorcraft',
    site: 'https://getartcraft.com/apps/vectorcraft',
    notes:
      'VectorCraft draws vector artwork: shapes, paths, type, live blends and artboards. Use `command_list` to find the drawing commands, then `command_run` / `command_batch`. Export through the app commands (SVG, PDF, PNG, AI/PDF-compatible).'
  },
  {
    id: 'filmcraft',
    label: 'FilmCraft',
    cli: 'filmcraft-cli',
    gui: 'filmcraft',
    roots: 'none',
    repo: 'https://github.com/storytold/filmcraft',
    site: 'https://getartcraft.com/apps/filmcraft',
    notes:
      'FilmCraft has no folder-confinement flags: be deliberate about every path and keep all outputs inside the workspace. It starts with an empty project; import media, build the timeline, grade, mix and export through commands. Renders can take minutes — wait for the call instead of starting a second render.'
  },
  {
    id: 'lightcraft',
    label: 'LightCraft',
    cli: 'lightcraft-cli',
    gui: 'lightcraft',
    roots: 'positional',
    repo: 'https://github.com/storytold/lightcraft',
    site: 'https://getartcraft.com/apps/lightcraft',
    notes:
      'LightCraft develops raw photos in a library. The workspace folder (when one is open) is passed at launch; use the import/query/develop/render/export helpers and `run_command` for `engine.commands` ids. Develop sliders are listable with `develop.controls`; masks are created through commands such as `mask.add`.'
  },
  {
    id: 'pdfcraft',
    label: 'PdfCraft',
    cli: 'pdfcraft-cli',
    gui: 'pdfcraft',
    roots: 'root',
    repo: 'https://github.com/storytold/pdfcraft',
    site: 'https://getartcraft.com/apps/pdfcraft',
    notes:
      'PdfCraft is confined to the one granted root. Work on PDFs through its tools: inspect, extract, reorder, annotate, protect. Saving appends an incremental update, so originals are preserved; call `doc_save` when the user wants the changes kept.'
  },
  {
    id: 'effectcraft',
    label: 'EffectCraft',
    cli: 'effectcraft-cli',
    gui: 'effectcraft',
    roots: 'automation',
    repo: 'https://github.com/storytold/effectcraft',
    site: 'https://getartcraft.com/apps/effectcraft',
    notes:
      'EffectCraft builds motion graphics and visual effects. Use `command_list`, `doc_inspect`, `command_run` / `command_batch`, and `render_preview` for a frame. Renders can run for minutes; do not launch a second render while one is running.'
  },
  {
    id: 'designcraft',
    label: 'DesignCraft',
    cli: 'designcraft-cli',
    gui: 'designcraft',
    roots: 'automation',
    repo: 'https://github.com/storytold/designcraft',
    site: 'https://getartcraft.com/apps/designcraft',
    notes:
      'DesignCraft is page layout and publishing. Create documents, lay out frames and text, place images and export through commands. Read the result back as a page render before calling a layout finished.'
  },
  {
    id: 'figcraft',
    label: 'FigCraft',
    cli: 'figcraft-cli',
    gui: 'figcraft',
    roots: 'automation',
    repo: 'https://github.com/storytold/figcraft',
    site: 'https://getartcraft.com/apps/figcraft',
    notes:
      'FigCraft is interface design and prototyping: frames, auto layout, components, variants and prototype links are commands. Use `render_preview` to check the canvas; keep design files and exported assets in the workspace.'
  },
  {
    id: 'wordcraft',
    label: 'WordCraft',
    cli: 'wordcraft-cli',
    gui: 'wordcraft',
    roots: 'automation',
    repo: 'https://github.com/storytold/wordcraft',
    site: 'https://getartcraft.com/apps/wordcraft',
    notes:
      'WordCraft exposes `list_commands`, `execute`, `batch`, `type_text`, `select_text`, `inspect_document`, `render_page` and `save_document`. Inspect the document after structural edits and render a page when the visual result matters.'
  },
  {
    id: 'soundcraft',
    label: 'SoundCraft',
    cli: 'soundcraft-cli',
    gui: 'soundcraft',
    roots: 'automation',
    repo: 'https://github.com/storytold/soundcraft',
    site: 'https://getartcraft.com/apps/soundcraft',
    notes:
      'SoundCraft is a DAW; a headless session has no audio device, so mixing and bounce happen offline. Drive edits through the command registry and verify the session with an inspect command before bouncing. Keep renders inside the workspace.'
  },
  {
    id: 'deckcraft',
    label: 'DeckCraft',
    cli: 'deckcraft-cli',
    gui: 'deckcraft',
    roots: 'automation',
    repo: 'https://github.com/storytold/deckcraft',
    site: 'https://getartcraft.com/apps/deckcraft',
    notes:
      'DeckCraft builds presentations. Use the command registry for slides, text, images and layouts, then export the deck. Render a slide or the deck preview and check every requested slide before reporting done.'
  },
  {
    id: 'cadcraft',
    label: 'CADCraft',
    cli: 'cadcraft-cli',
    gui: 'cadcraft',
    roots: 'none',
    repo: 'https://github.com/storytold/cadcraft',
    site: 'https://getartcraft.com/apps/cadcraft',
    notes:
      'CADCraft is a CAD drafting app. It has no confinement flags, so stay inside the workspace. Drive it through commands (`command_list`, `command_run`), use the drawing command names the app reports, and export DXF/SVG/PDF or a PNG preview to verify the drawing.'
  },
  {
    id: 'gridcraft',
    label: 'GridCraft',
    cli: 'gridcraft-cli',
    gui: 'gridcraft',
    roots: 'none',
    repo: 'https://github.com/storytold/gridcraft',
    site: 'https://getartcraft.com/apps/gridcraft',
    notes:
      'GridCraft is a spreadsheet. Prefer `read_range`, `write_range`, `set_cell`, `evaluate_formula`, `format_range`, `insert_chart`, `create_table`, `sort_range` and `filter`; `execute_command` reaches every ribbon command. Read a range back after writing it and check formulas instead of trusting a write.'
  },
  {
    id: 'texturecraft',
    label: 'TextureCraft',
    cli: 'texturecraft-cli',
    gui: 'texturecraft',
    roots: 'read-write',
    repo: 'https://github.com/storytold/texturecraft',
    site: 'https://getartcraft.com/apps/texturecraft',
    notes:
      'TextureCraft paints 3D textures and bakes maps. Work through its command registry, render the texture set for a visual check, and export into the workspace. Keep meshes and texture sets together so the project stays portable.'
  },
  {
    id: 'materialcraft',
    label: 'MaterialCraft',
    cli: 'materialcraft-cli',
    gui: 'materialcraft',
    roots: 'read-write',
    repo: 'https://github.com/storytold/materialcraft',
    site: 'https://getartcraft.com/apps/materialcraft',
    notes:
      'MaterialCraft builds procedural PBR materials as node graphs. Use commands to add nodes, connect them and set parameters, then render the material to check it. Export the cooked textures and the material file into the workspace.'
  },
  {
    id: 'craft-anything',
    label: 'Craft Anything',
    cli: 'craft-anything-cli',
    gui: 'craft-anything',
    roots: 'none',
    repo: 'https://github.com/storytold/craft-anything',
    site: 'https://getartcraft.com/apps/craft-anything',
    notes:
      'Craft Anything studies software and rebuilds it. Its tools are grouped by toolset: start with the discovery tools, keep evidence-based claims, and page large results with `core_evidence_browse`. Only examine software the user owns or is allowed to inspect.'
  },
  {
    id: 'solidcraft',
    label: 'SolidCraft',
    cli: 'solidcraft-cli',
    gui: 'solidcraft',
    roots: 'none',
    community: true,
    repo: 'https://github.com/tangency-labs/solidcraft',
    site: 'https://github.com/tangency-labs/solidcraft',
    notes:
      'SolidCraft is a parametric 3D CAD app by Tangency Labs (a community app in the launcher). It has no confinement flags, so keep files in the workspace. Drive sketches, constraints and features through the command registry, then export STEP/STL/3MF and verify the model.'
  }
]

export function artCraftApp(id: string): ArtCraftAppDef | null {
  return ARTCRAFT_APPS.find((app) => app.id === id) ?? null
}

export function isArtCraftAppId(value: string): value is ArtCraftAppId {
  return (ARTCRAFT_APP_IDS as readonly string[]).includes(value)
}

/** Server name in mcp.json: the app id, already prompt- and file-safe. */
export function artCraftServerName(id: ArtCraftAppId): string {
  return id
}

/**
 * The MCP command line for one app. `workspace` is the folder the user opened;
 * it is granted for reading and writing where the app supports roots. An empty
 * workspace means "no folder granted", which the apps enforce rather than
 * silently opening the home folder. Connector setup refuses to register such a
 * server, because an agent that cannot read or write files is not useful.
 */
export function artCraftMcpArgs(id: ArtCraftAppId, workspace: string): string[] {
  const roots = artCraftApp(id)?.roots ?? 'none'
  const ws = workspace.trim()
  if (ws.length === 0) return ['mcp']

  switch (roots) {
    case 'automation':
      return ['mcp', '--automation-read-root', ws, '--automation-write-root', ws]
    case 'root':
      return ['mcp', '--root', ws]
    case 'read-write':
      return ['mcp', '--read-root', ws, '--write-root', ws]
    case 'positional':
      return ['mcp', ws]
    default:
      return ['mcp']
  }
}

/**
 * MCP command line for a bridge to an already running desktop app. The app
 * owns the filesystem roots in this mode; root flags on the CLI are refused.
 */
export function artCraftBridgeMcpArgs(
  _id: ArtCraftAppId,
  port: number,
  tokenFile: string
): string[] {
  return ['mcp', '--bridge', `127.0.0.1:${port}`, '--control-token-file', tokenFile]
}

/**
 * Desktop-app arguments that open the live control channel and grant the
 * workspace to automation. The app must be started with these flags; a normal
 * launch has no control port and no automation roots.
 */
export function artCraftControlArgs(
  id: ArtCraftAppId,
  port: number,
  tokenFile: string,
  workspace: string
): string[] {
  const roots = artCraftMcpArgs(id, workspace).filter((arg) => arg !== 'mcp')
  return ['--control', String(port), '--control-token-file', tokenFile, ...roots]
}

/** `live` when the registered command line bridges to a desktop app. */
export function artCraftServerMode(args: string[]): ArtCraftConnectMode {
  return args.includes('--bridge') ? 'live' : 'headless'
}

/** Port from `mcp --bridge 127.0.0.1:<port>` (or a bare port). */
export function artCraftBridgePort(args: string[]): number | null {
  const index = args.indexOf('--bridge')
  if (index < 0) return null
  const value = args[index + 1] ?? ''
  const port = Number(value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/** Token file from `mcp --bridge … --control-token-file <path>`. */
export function artCraftBridgeTokenFile(args: string[]): string | null {
  const index = args.indexOf('--control-token-file')
  const value = index >= 0 ? (args[index + 1] ?? '').trim() : ''
  return value.length > 0 ? value : null
}

/**
 * The folder a registered headless server was granted, read back from its
 * arguments. Live servers keep the folder in `config.cwd` instead, because the
 * root is passed to the desktop process. `null` means "no folder granted" —
 * the state that used to make every doc_open/doc_save call fail.
 */
export function artCraftGrantedRoot(id: ArtCraftAppId, args: string[]): string | null {
  if (artCraftServerMode(args) === 'live') return null
  const def = artCraftApp(id)
  if (!def) return null
  const flags: Record<ArtCraftRoots, string[]> = {
    automation: ['--automation-read-root', '--automation-write-root'],
    root: ['--root'],
    'read-write': ['--read-root', '--write-root'],
    positional: [],
    none: []
  }
  for (const flag of flags[def.roots]) {
    const index = args.indexOf(flag)
    const value = index >= 0 ? (args[index + 1] ?? '').trim() : ''
    if (value.length > 0) return value
  }
  if (def.roots === 'positional') {
    const mcp = args.indexOf('mcp')
    const value = mcp >= 0 ? (args[mcp + 1] ?? '').trim() : ''
    if (value.length > 0 && !value.startsWith('-')) return value
  }
  return null
}

/**
 * Compare two workspace paths the way the platform does: Windows ignores case,
 * and a trailing separator never makes a different folder. Used by both the
 * settings screen and the "connect" flow, which re-grants a stale root.
 */
export function sameArtCraftFolder(left: string, right: string): boolean {
  const trim = (value: string): string => value.trim().replace(/[\\/]+$/, '')
  const a = trim(left)
  const b = trim(right)
  if (a.length === 0 || b.length === 0) return false
  const windows = /^[a-zA-Z]:[\\/]/.test(a) || /^[a-zA-Z]:[\\/]/.test(b)
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Longer calls for apps that render video or audio. */
export function artCraftTimeoutMs(id: ArtCraftAppId): number {
  return id === 'filmcraft' || id === 'effectcraft' || id === 'soundcraft' ? 600000 : 300000
}

/**
 * The agent playbook written into userData on setup. It is generated, not
 * hand-written, so it can explain the exact mode: a headless session and a
 * live window behave differently around documents, saving and UI tools.
 */
export function artCraftPlaybook(
  id: ArtCraftAppId,
  workspace: string,
  mode: ArtCraftConnectMode = 'headless'
): string {
  const app = artCraftApp(id)
  if (!app) return ''
  const ws = workspace.trim()
  const live = mode === 'live'
  const rootLine =
    app.roots === 'none'
      ? ws.length > 0
        ? `This app has no folder-confinement flags. Treat ${ws} as the only allowed workspace and keep every created file inside it.`
        : 'This app has no folder-confinement flags. Ask the user to open a project folder before touching files.'
      : app.roots === 'positional'
        ? ws.length > 0
          ? `The workspace folder (${ws}) is passed to the app at launch. This app has no separate root flags, so keep other paths inside the workspace on your own.`
          : 'No folder was passed to this app at launch. Ask the user to reconnect it from Settings with the project open.'
        : ws.length > 0
          ? live
            ? `The desktop app was started with ${ws} as both the read and write root. Absolute paths beneath it are accepted; files outside it are refused.`
            : `The only folder granted to this server is ${ws}. Absolute paths beneath it are accepted; files outside it are refused.`
          : 'No folder was granted to this server. Ask the user to reconnect it from Settings with the project open before reading or writing files.'
  const modeLine = live
    ? `This connector is bridged to the running ${app.label} window. Tools act on the document the user sees: doc_inspect reads it, commands edit it, doc_save saves it, and doc_open opens a path as a new tab in the same window. Before creating anything, list the open documents; if one is already open, work on that active document instead of starting a new one. If the app is not running, ask the user to open it from Settings → Applications & MCP → ArtCraft.`
    : `This connector starts ${app.label} headless, in its own engine session. Documents you create here are separate from any window the user has open. If the user says "my scene", "my document" or "the file I have open", say before doing any work that this connector is headless and cannot see that window, then either continue in the headless session only if they agree, or ask them to reconnect it in live mode. Never present a new headless document as their open one.`
  return [
    `# ${app.label} playbook`,
    '',
    `You are driving ${app.label} through MCP tools (mcp__${id}__…). ${app.notes}`,
    '',
    '## Ground rules',
    `- ${modeLine}`,
    '- Discover before acting: list the tools and the command registry first instead of inventing tool or command names.',
    '- Make small, reversible steps and read the state after each meaningful change (inspect the document/project/scene).',
    '- When a preview or render tool exists, use it and look at the image before saying the result is ready.',
    live
      ? '- UI tools (`ui_inspect`, `ui_screenshot`, pointer and menu tools) work in this mode: use them to check what the user sees before and after a change.'
      : '- GUI-driving tools (`ui_*`, screenshots, clicks) are absent or refuse to run headless; do not depend on them.',
    live
      ? '- A live document may have been opened by the user from anywhere. Read and edit it through the bridge; do not call doc_open on its path when that path is outside the granted folder. Call doc_save without a path to keep its current location, or pass a path inside the workspace for Save As.'
      : '- To work on a document the user has open in the app window, reconnect the connector in live mode; opening its path here reads a separate copy.',
    '- Pass paths as plain tool arguments: relative to the granted folder, or absolute inside it. Windows paths with spaces and Cyrillic are valid — do not wrap them in shell quotes or escape sequences. In relative paths use forward slashes (`assets/logo.png`); some apps reject backslashes there.',
    '- Create an output folder before saving into it: save tools do not create missing directories.',
    '- Keep every created file in the workspace; never overwrite the only copy of a user document without a backup.',
    '- A tool timeout can mean a long render. Wait and retry once before reporting a failure; do not loop.',
    '',
    '## Assets and fonts',
    '- When the work needs a photo, texture, icon, illustration, model or font that is not in the project, get it yourself: `web_search` for the source, then `download_asset` with a direct link. Do not ask the user to download and place it by hand.',
    '- Save assets under `assets/` (`assets/images`, `assets/fonts`, `assets/textures`) and import them through the app’s place/import command. Never make the document depend on a remote URL.',
    '- Prefer the app’s own asset or search tools when it exposes them; its bundled library is already licensed for the app and needs no download.',
    '- Good sources: Poly Haven and ambientCG (CC0 textures and HDRIs); Unsplash, Pexels and Pixabay (photos — check each licence); Simple Icons (brand marks, CC0), game-icons.net (CC BY 3.0), SVG Repo (mixed); Google Fonts or Fontsource (OFL/Apache — take the TTF/OTF build, not the CSS).',
    '- Verify a picture with `inspect_image` before placing it: size, transparency, content box and palette; pass `expect` when the brief fixes dimensions or a transparent background. Desktop apps generally need TTF/OTF fonts; WOFF2 is a web container.',
    '- Font or icon packs often arrive as a ZIP: `download_asset` the archive, extract it with `run_command` into `assets/fonts` or `assets/icons`, then import the files you actually need. Do not point the app at the archive itself.',
    '- Keep `assets/SOURCES.md` with one line per file: local path, source URL, author and licence. Never use a copyrighted logo, film still or stock photo without permission, and say plainly when a licence cannot be confirmed.',
    '',
    '## Files',
    rootLine,
    '',
    `Source and documentation: ${app.repo}`,
    '',
    '<!-- relaxcode:artcraft-playbook -->'
  ].join('\n')
}

/** The partnership note the settings screen can copy for the user. */
export const ARTCRAFT_PARTNER_LETTER = `Subject: RelaxCode × ArtCraft — official integration proposal

Hi ArtCraft team,

I maintain RelaxCode, an open-source desktop AI IDE built with an agent that can drive creative tools over MCP. We have just shipped first-class support for the whole Craft App Suite: PhotoCraft, VectorCraft, FilmCraft, LightCraft, PdfCraft, EffectCraft, DesignCraft, FigCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft, TextureCraft, MaterialCraft, Craft Anything and the community app SolidCraft.

What we built:
- auto-detection of every installed Craft app on Windows, macOS and Linux;
- one-click registration of each app's own MCP server (<app>-cli mcp) with access limited to the open project folder;
- per-app agent playbooks that teach the model your command registry, inspect and render-preview workflow;
- your official app icons, linked back to each app's repository and getartcraft.com page;
- a partnership block in the IDE that points artists to ArtCraft.

We would love to make this official:
- list RelaxCode as an MCP client/integration on getartcraft.com and in the apps' documentation;
- publish a short joint guide ("drive PhotoCraft from RelaxCode") and cross-link our repositories;
- exchange feedback on the MCP surface and mention each other in release notes;
- if it fits your roadmap, consider RelaxCode as a distribution channel in ArtCraft Launcher.

Both projects are open source and community-built, and our users are exactly the artists and makers the Craft apps are for. If you are interested, reply here or find us on Discord — we are happy to do the work on our side.

Thank you for building the suite in the open.

— The RelaxCode team`
