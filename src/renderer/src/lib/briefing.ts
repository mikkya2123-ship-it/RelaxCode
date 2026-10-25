import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

/**
 * The morning briefing: once a day, when a workspace folder opens, the agent
 * is asked to run the project's own checks (tests, linter, git history) and
 * report in the chat — so the first thing you see is the state of the
 * project, not an empty input box.
 */

const BRIEFING_PROMPT =
  'Morning briefing for this project, as a system check: run run_tests and lint_check, look at git_status and git_log (last 10 commits). Then report briefly: (1) do tests and lints pass — and if not, the culprit file and what exactly broke; (2) what changed in the project recently; (3) one or two things worth attention today. Keep the whole report under 12 lines, plain language, no tool logs. If a check cannot run (no runner, no git), say so in one short line and move on.'

/** Stable short key for a workspace path (localStorage has no folder nesting). */
function keyOf(root: string): string {
  let hash = 0
  for (let index = 0; index < root.length; index += 1) {
    hash = (hash * 31 + root.charCodeAt(index)) | 0
  }
  return `relaxcode.briefing.${(hash >>> 0).toString(36)}`
}

/**
 * Sends the briefing prompt when due: the setting is on, a model is picked,
 * nothing is streaming and this workspace has not had one today. The 15s
 * delay lets the workspace, models and UI settle first.
 */
export function maybeRunMorningBriefing(rootPath: string | null): void {
  if (!rootPath) return
  const settings = useSettingsStore.getState().settings
  if (!settings?.agent.morningBriefing || !settings.model) return
  if (useChatStore.getState().chats.some((chat) => chat.streaming)) return
  const key = keyOf(rootPath)
  const today = new Date().toISOString().slice(0, 10)
  try {
    if (localStorage.getItem(key) === today) return
    localStorage.setItem(key, today)
  } catch {
    return
  }
  window.setTimeout(() => {
    const state = useChatStore.getState()
    if (state.chats.some((chat) => chat.streaming)) return
    if (!useSettingsStore.getState().settings?.model) return
    void state.send(BRIEFING_PROMPT)
  }, 15000)
}
