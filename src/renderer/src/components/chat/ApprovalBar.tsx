import type { JSX } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '@shared/ipc'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

export function ApprovalBar({
  request,
  onDecision
}: {
  request: ApprovalRequest
  onDecision: (decision: ApprovalDecision) => void
}): JSX.Element {
  const t = useT()

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-xs">
      <div className="flex items-center gap-1.5">
        <ShieldAlert className="size-3.5 text-amber-600 dark:text-amber-500" />
        <span className="text-[12px] font-medium">{t('chat.approval.title')}</span>
        <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t(`chat.approval.risk.${request.risk}` as 'chat.approval.risk.write')}
        </span>
      </div>
      <div className="mt-1.5 break-all font-mono text-[11px] text-foreground/90">
        {request.toolName} · {request.preview}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="sm" onClick={() => onDecision('allow')}>
          {t('chat.approval.allow')}
        </Button>
        <Button variant="default" size="sm" onClick={() => onDecision('always')}>
          {t('chat.approval.always')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDecision('deny')}>
          {t('chat.approval.deny')}
        </Button>
      </div>
    </div>
  )
}
