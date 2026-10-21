import { useState, type JSX } from 'react'
import { ChevronDown, Server, Square } from 'lucide-react'
import type { BackgroundProcessInfo } from '@shared/ipc'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const OPEN_KEY = 'relaxcode.serversOpen'

function readOpen(): boolean {
  try {
    // The pre-rename key keeps the panel state of existing profiles.
    return (localStorage.getItem(OPEN_KEY) ?? localStorage.getItem('easycode.serversOpen')) === 'true'
  } catch {
    return false
  }
}

/** Background processes (dev servers, watchers) started by the agent. */
export function ProcessPanel({
  processes,
  onStop
}: {
  processes: BackgroundProcessInfo[]
  onStop: (id: string) => void
}): JSX.Element | null {
  const t = useT()
  // Collapsed by default: the panel is only a status strip until you open it.
  const [open, setOpen] = useState(readOpen)
  if (processes.length === 0) return null

  const running = processes.filter((item) => item.running).length

  const toggle = (): void => {
    setOpen((previous) => {
      const next = !previous
      try {
        localStorage.setItem(OPEN_KEY, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  return (
    <div
      data-testid="servers-panel"
      className="rounded-lg border border-border bg-panel/70 transition-colors duration-150"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={t('chat.processes.title')}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold text-muted-foreground transition-colors duration-100 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <Server className="size-3.5 shrink-0" />
        {t('chat.processes.title')}
        {running > 0 && <span className="size-1.5 shrink-0 rounded-full bg-success" />}
        <span className="font-normal text-tertiary">{processes.length}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-3.5 shrink-0 transition-transform duration-150',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <ul data-testid="servers-list" className="flex flex-col gap-1 px-2.5 pb-2">
          {processes.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-[12px]">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  item.running ? 'bg-success' : 'bg-foreground/25'
                )}
                title={item.running ? t('chat.processes.running') : t('chat.processes.stopped')}
              />
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80"
                title={item.command}
              >
                {item.command}
              </span>
              {item.port !== null && (
                <a
                  href={`http://localhost:${item.port}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded px-1 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  title={t('chat.processes.open')}
                >
                  :{item.port}
                </a>
              )}
              {item.running && (
                <button
                  type="button"
                  onClick={() => onStop(item.id)}
                  className="shrink-0 rounded p-0.5 text-tertiary transition-colors duration-100 hover:text-destructive"
                  title={t('chat.processes.stop')}
                  aria-label={t('chat.processes.stop')}
                >
                  <Square className="size-3 fill-current" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
