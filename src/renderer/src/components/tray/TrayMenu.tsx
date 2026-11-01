import { useEffect, useState, type JSX } from 'react'

/**
 * The custom tray menu: a calm, flat black window with quiet typography.
 * Opened by the main process above the tray icon; every action is sent back
 * over IPC.
 */

export function TrayMenu(): JSX.Element {
  const [closeToTray, setCloseToTray] = useState(true)
  const [ru, setRu] = useState(false)

  // Lets the page background go transparent for the rounded black card.
  useEffect(() => {
    document.documentElement.dataset.trayMenu = '1'
    return () => {
      delete document.documentElement.dataset.trayMenu
    }
  }, [])

  useEffect(() => {
    return window.relaxcode.tray.onState((state) => {
      setCloseToTray(state.closeToTray)
      if (state.language === 'system') setRu(navigator.language.toLowerCase().startsWith('ru'))
      else setRu(state.language === 'ru')
    })
  }, [])

  const act = (action: string): void => window.relaxcode.tray.action(action)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') act('dismiss')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const labels = ru
    ? {
        open: ['Открыть RelaxCode', 'Вернуться к работе'],
        newChat: ['Новая задача', 'Начать чат с нуля'],
        settings: ['Настройки', 'Подключения, агент, редактор'],
        background: ['Работать при закрытии', 'Задачи живут в трее'],
        quit: ['Выход', 'Остановить всё и закрыть']
      }
    : {
        open: ['Open RelaxCode', 'Back to work'],
        newChat: ['New task', 'Start a fresh chat'],
        settings: ['Settings', 'Connections, agent, editor'],
        background: ['Keep running when closed', 'Tasks live in the tray'],
        quit: ['Quit', 'Stop everything and exit']
      }

  const item = (
    key: keyof typeof labels,
    action: string,
    opts: { danger?: boolean; trailing?: string } = {}
  ): JSX.Element => (
    <button
      key={key}
      type="button"
      onClick={() => act(action)}
      className={
        'group flex w-full items-center gap-4 px-5 py-3 text-left transition-colors duration-100 focus-visible:outline-none ' +
        (opts.danger
          ? 'hover:bg-rose-500/[0.07] focus-visible:bg-rose-500/[0.07]'
          : 'hover:bg-white/[0.05] focus-visible:bg-white/[0.05]')
      }
    >
      <span className="min-w-0 flex-1">
        <span
          className={
            'block text-[13.5px] leading-tight font-medium ' +
            (opts.danger ? 'text-rose-300/90' : 'text-white/85')
          }
        >
          {labels[key][0]}
        </span>
        <span className="mt-0.5 block text-[11px] leading-tight text-white/35">
          {labels[key][1]}
        </span>
      </span>
      {opts.trailing && (
        <span className="shrink-0 text-[11px] font-medium text-white/40">{opts.trailing}</span>
      )}
    </button>
  )

  const divider = <div className="mx-5 my-1 h-px bg-white/[0.06]" />

  return (
    <div
      // Square window: a rounded card inside a transparent window would show
      // whatever sits behind the cut corners (the main window, the desktop).
      className="flex h-screen w-screen flex-col overflow-hidden border border-white/[0.08] bg-[#0a0a0b] py-2"
      style={{ fontFamily: "'Manrope Variable', 'Manrope', system-ui, sans-serif" }}
    >
      {item('open', 'open')}
      {divider}
      {item('newChat', 'new-chat')}
      {item('settings', 'open-settings')}
      {item('background', 'toggle-background', { trailing: closeToTray ? (ru ? 'вкл' : 'on') : ru ? 'выкл' : 'off' })}
      {divider}
      {item('quit', 'quit', { danger: true })}
    </div>
  )
}
