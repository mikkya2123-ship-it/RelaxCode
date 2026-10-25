import { useState, type JSX } from 'react'
import { PencilLine, ShieldAlert } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '@shared/ipc'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * The approval bar. Beyond allow/always/deny, a write_file or edit_file
 * proposal can be CORRECTED right here: the user tweaks the model's text and
 * the tool runs with the fixed version — no deny, retype, retry dance.
 */

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // The model's arguments are broken JSON — the tool will fail anyway.
  }
  return {}
}

export function ApprovalBar({
  request,
  onDecision
}: {
  request: ApprovalRequest
  onDecision: (decision: ApprovalDecision, editedArgs?: string) => void
}): JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const parsed = parseArgs(request.args)
  const field =
    request.toolName === 'write_file' && typeof parsed.content === 'string'
      ? 'content'
      : request.toolName === 'edit_file' && typeof parsed.new_string === 'string'
        ? 'new_string'
        : null

  const startEdit = (): void => {
    setValue(field ? String(parsed[field]) : '')
    setEditing(true)
  }

  const applyEdited = (decision: ApprovalDecision): void => {
    if (!field) {
      onDecision(decision)
      return
    }
    onDecision(decision, JSON.stringify({ ...parsed, [field]: value }))
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 shadow-xs" data-testid="approval-bar">
      <div className="flex items-center gap-1.5">
        <ShieldAlert className="size-3.5 text-amber-600 dark:text-amber-500" />
        <span className="text-[12px] font-medium">{t('chat.approval.title')}</span>
        <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t(`chat.approval.risk.${request.risk}` as 'chat.approval.risk.write')}
        </span>
      </div>
      <div className="mt-1.5 break-all whitespace-pre-wrap font-mono text-[11px] text-foreground/90">
        {request.toolName} · {request.preview}
      </div>

      {editing && field ? (
        <div className="mt-2">
          <p className="mb-1 text-[11px] text-muted-foreground">
            {field === 'content'
              ? t('chat.approval.editContent', { path: String(parsed.path ?? '') })
              : t('chat.approval.editReplacement', { path: String(parsed.path ?? '') })}
          </p>
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={10}
            spellCheck={false}
            className="max-h-[280px] min-h-[120px] resize-y font-mono text-[11px]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button variant="primary" size="sm" onClick={() => applyEdited('allow')}>
              {t('chat.approval.applyEdited')}
            </Button>
            <Button variant="default" size="sm" onClick={() => onDecision('always')}>
              {t('chat.approval.always')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t('chat.approval.cancelEdit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDecision('deny')}>
              {t('chat.approval.deny')}
            </Button>
          </div>
        </div>
      ) : (
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
          {field && (
            <Button variant="ghost" size="sm" onClick={startEdit}>
              <PencilLine className="mr-1 size-3" />
              {t('chat.approval.edit')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
