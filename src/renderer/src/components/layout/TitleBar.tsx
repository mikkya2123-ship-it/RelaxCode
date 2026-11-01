import { useEffect, useState, type JSX, type ReactNode } from 'react'
import {CircleHelp, Copy, MessageSquare, Minus, Monitor, PanelLeft, Settings, Square, X, Users, Lock } from 'lucide-react'
import { useUiStore } from '@/stores/ui'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/components/ui/app-logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, basename } from '@/lib/utils'
import { useTeamStore } from '@/stores/team'
import { FeedbackDialog } from '@/components/layout/FeedbackDialog'

function WindowControlButton({
  label,
  onClick,
  children,
  danger = false
}: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            'no-drag rounded-md text-muted-foreground',
            danger && 'hover:bg-destructive/10 hover:text-destructive'
          )}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function TitleBar(): JSX.Element {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const chatOpen = useUiStore((s) => s.chatOpen)
  const screenOpen = useUiStore((s) => s.screenOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const toggleChat = useUiStore((s) => s.toggleChat)
  const toggleScreen = useUiStore((s) => s.toggleScreen)
  const openSettings = useUiStore((s) => s.openSettings)
  const workspace = useUiStore((s) => s.workspace)
  const [maximized, setMaximized] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const t = useT()

  useEffect(() => window.relaxcode.window.onMaximizedChanged(setMaximized), [])

  return (
    <header className="no-glass drag flex h-10 shrink-0 select-none items-center justify-between bg-background pl-1.5 pr-1">
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label={t('titlebar.toggleSidebar')}
              className={cn('no-drag text-muted-foreground', sidebarOpen && 'bg-pressed text-foreground')}
            >
              <PanelLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('titlebar.toggleSidebar')}</TooltipContent>
        </Tooltip>

        <div className="flex min-w-0 items-center gap-2 pl-1">
          <AppLogo className="size-6 rounded-md ring-1 ring-black/[0.06] dark:ring-white/10" />
          <span className="text-[13px] font-semibold tracking-[-0.01em]">RelaxCode</span>
          {workspace && (
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-tertiary">/</span>
              <span className="truncate text-[13px] text-muted-foreground">
                {basename(workspace.path)}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setFeedbackOpen(true)}
              aria-label={t('feedback.title')}
              className="no-drag text-muted-foreground"
            >
              <CircleHelp className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('feedback.title')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleChat}
              aria-label={t('titlebar.toggleChat')}
              className={cn('no-drag text-muted-foreground', chatOpen && 'bg-pressed text-foreground')}
            >
              <MessageSquare className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('titlebar.toggleChat')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={useTeamStore.getState().openTeam}
              aria-label={t('team.title')}
              className="no-drag text-muted-foreground"
            >
              <span className="relative inline-flex" data-testid="team-locked-badge">
                <Users className="size-4" />
                <Lock className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-background bg-card p-px text-tertiary" />
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('team.title')} — {t('team.soon.badge')}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleScreen}
              aria-label={t('titlebar.toggleScreen')}
              data-testid="titlebar-toggle-screen"
              className={cn('no-drag text-muted-foreground', screenOpen && 'bg-pressed text-foreground')}
            >
              <Monitor className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('titlebar.toggleScreen')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={openSettings}
              aria-label={t('titlebar.settings')}
              className="no-drag text-muted-foreground"
            >
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('titlebar.settings')}</TooltipContent>
        </Tooltip>

        <div className="ml-1 flex items-center gap-0.5 pl-1.5">
          <WindowControlButton
            label={t('titlebar.minimize')}
            onClick={() => window.relaxcode.window.minimize()}
          >
            <Minus className="size-4" />
          </WindowControlButton>
          <WindowControlButton
            label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
            onClick={() => window.relaxcode.window.toggleMaximize()}
          >
            {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
          </WindowControlButton>
          <WindowControlButton
            label={t('titlebar.close')}
            onClick={() => window.relaxcode.window.close()}
            danger
          >
            <X className="size-4" />
          </WindowControlButton>
        </div>
      </div>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </header>
  )
}
