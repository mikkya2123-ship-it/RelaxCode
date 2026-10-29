import type { JSX } from 'react'
import { Sparkles } from 'lucide-react'
import { skillById } from '@shared/skills'
import { useI18nStore, useT } from '@/lib/i18n'

/**
 * The skill a run is following, shown above the answer. It names the craft
 * standard in plain words ("Скилл: Лендинг AI-продукта"), so the user can see
 * why the output looks the way it does — and ask for a different one.
 */
export function SkillChip({ skillId }: { skillId: string }): JSX.Element | null {
  const t = useT()
  const locale = useI18nStore((state) => state.locale)
  const skill = skillById(skillId)
  if (!skill) return null

  const title = locale === 'en' ? skill.titleEn : skill.title
  const summary = locale === 'en' ? skill.summaryEn : skill.summary

  return (
    <div
      data-testid="chat-skill"
      title={summary}
      className="flex items-start gap-2 rounded-lg border border-border bg-panel/60 px-2.5 py-1.5"
    >
      <Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="truncate text-[11.5px] font-medium text-foreground">
          {t('chat.skill.applied')}: {title}
        </p>
        <p className="truncate text-[10.5px] text-muted-foreground">{summary}</p>
      </div>
    </div>
  )
}
