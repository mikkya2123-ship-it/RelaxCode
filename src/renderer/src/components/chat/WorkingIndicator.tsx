import type { JSX } from 'react'
import type { TKey } from '@shared/i18n'
import type { ChatPart, ToolPart } from '@/stores/chat'
import { useT } from '@/lib/i18n'
import { AITextLoading } from '@/components/ui/ai-text-loading'

/**
 * The line that says what the agent is doing right now, with the shimmering
 * text from `AITextLoading`. It sits under a streaming answer: while a tool
 * runs it names the action, otherwise it cycles through thinking phrases, so
 * the gap before the next step is never a still screen.
 *
 * Every kind of work has its own pool of wordings — reading, editing, git,
 * tests, documents, screenshots — and each tool maps to one of those pools.
 * The pool rotates, so a long run never repeats the same two words, and two
 * different actions rarely read alike.
 */

const PHRASES = {
  /** Nothing running yet: the model is still deciding what to do. */
  thinking: [
    'chat.working.thinking',
    'chat.working.planning',
    'chat.working.analyzing',
    'chat.working.weighing',
    'chat.working.recalling',
    'chat.working.outlining',
    'chat.working.selfCheck',
    'chat.working.almost'
  ],
  reading: [
    'chat.working.reading',
    'chat.working.opening',
    'chat.working.scanning',
    'chat.working.tracing'
  ],
  listing: ['chat.working.listing', 'chat.working.walking', 'chat.working.mapping'],
  search: [
    'chat.working.search',
    'chat.working.matching',
    'chat.working.symbols',
    'chat.working.references'
  ],
  docs: ['chat.working.pdf', 'chat.working.docx', 'chat.working.sheet'],
  writing: [
    'chat.working.writing',
    'chat.working.creating',
    'chat.working.overwriting',
    'chat.working.saving'
  ],
  editing: [
    'chat.working.editing',
    'chat.working.patching',
    'chat.working.replacing',
    'chat.working.formatting'
  ],
  deleting: ['chat.working.deleting', 'chat.working.cleaning', 'chat.working.trash'],
  moving: ['chat.working.moving', 'chat.working.renaming'],
  command: [
    'chat.working.command',
    'chat.working.spawning',
    'chat.working.waitingOutput',
    'chat.working.shell'
  ],
  tests: ['chat.working.tests', 'chat.working.testRun', 'chat.working.testWait'],
  checks: ['chat.working.lint', 'chat.working.types'],
  deps: ['chat.working.deps', 'chat.working.installing'],
  servers: ['chat.working.servers', 'chat.working.stoppingServer'],
  git: [
    'chat.working.git',
    'chat.working.diff',
    'chat.working.commit',
    'chat.working.restore',
    'chat.working.blame'
  ],
  web: ['chat.working.web', 'chat.working.fetch', 'chat.working.docs', 'chat.working.download'],
  media: [
    'chat.working.screenshot',
    'chat.working.image',
    'chat.working.drawing',
    'chat.working.table'
  ],
  planning: ['chat.working.todos', 'chat.working.asking', 'chat.working.planning'],
  generic: ['chat.working.generic', 'chat.working.almostDone']
} satisfies Record<string, TKey[]>

type Group = keyof typeof PHRASES

/** Which pool a tool speaks with. Unlisted tools fall back to `generic`. */
const TOOL_GROUPS: Record<string, Group> = {
  read_file: 'reading',
  open_in_editor: 'reading',
  explain_code: 'reading',
  list_dir: 'listing',
  recent_files: 'listing',
  project_map: 'listing',
  search_files: 'search',
  search_content: 'search',
  symbol_search: 'search',
  find_references: 'search',
  similar_code: 'search',
  read_pdf: 'docs',
  read_docx: 'docs',
  read_xlsx: 'docs',
  write_file: 'writing',
  backup_file: 'writing',
  snapshot_project: 'writing',
  edit_file: 'editing',
  format_code: 'editing',
  delete_path: 'deleting',
  recycle_bin: 'deleting',
  move_path: 'moving',
  run_command: 'command',
  terminal_feed: 'command',
  run_tests: 'tests',
  lint_check: 'checks',
  type_check: 'checks',
  chaos_check: 'checks',
  health_check: 'checks',
  deps_check: 'deps',
  check_versions: 'deps',
  install_package: 'deps',
  start_server: 'servers',
  stop_server: 'servers',
  list_servers: 'servers',
  port_check: 'servers',
  process_kill: 'servers',
  git_status: 'git',
  git_diff: 'git',
  git_log: 'git',
  git_commit: 'git',
  git_restore: 'git',
  git_blame: 'git',
  web_search: 'web',
  fetch_url: 'web',
  open_url: 'web',
  docs_lookup: 'web',
  download_file: 'web',
  browser_pilot: 'web',
  fill_form: 'web',
  api_call: 'web',
  screenshot_app: 'media',
  check_mobile: 'media',
  show_image: 'media',
  show_poster: 'media',
  show_table: 'media',
  draw_figure: 'media',
  make_diagram: 'media',
  todo_write: 'planning',
  task_queue: 'planning',
  project_notes: 'planning',
  watch_folder: 'planning',
  schedule_task: 'planning',
  ask_user: 'planning'
}

export function WorkingIndicator({ parts }: { parts: ChatPart[] }): JSX.Element | null {
  const t = useT()

  const running = parts.findLast(
    (part): part is ToolPart => part.kind === 'tool' && part.status === 'running'
  )
  const last = parts[parts.length - 1]

  // Text is arriving: the answer itself is the animation, no label needed.
  if (!running && last?.kind === 'text' && last.text.trim().length > 0) return null

  const group: Group = running ? (TOOL_GROUPS[running.name] ?? 'generic') : 'thinking'
  const texts = PHRASES[group].map((key) => t(key))

  return <AITextLoading texts={texts} interval={1600} className="text-[12.5px]" />
}
