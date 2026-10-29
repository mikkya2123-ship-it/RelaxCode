import { useMemo, useState, type JSX } from 'react'
import { Check, RotateCcw, Sparkles } from 'lucide-react'
import type { SettingsPatch } from '@shared/ipc'
import { SKILLS, type Skill, type SkillCategory, type SkillsSettings } from '@shared/skills'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useI18nStore, useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The skill library in the settings screen: the master switch, one row per
 * skill with an on/off toggle, and an editor for the rules. Editing replaces the
 * built-in text for that skill only; "вернуть стандарт" drops the override.
 */

const CATEGORIES: SkillCategory[] = ['web', 'ui', 'graphics', 'three-d', 'content']

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  web: 'settings.skills.category.web',
  ui: 'settings.skills.category.ui',
  graphics: 'settings.skills.category.graphics',
  'three-d': 'settings.skills.category.three-d',
  content: 'settings.skills.category.content'
}

export function SkillsControl({
  settings,
  patch
}: {
  settings: SkillsSettings
  patch: (values: SettingsPatch) => void
}): JSX.Element {
  const t = useT()
  const locale = useI18nStore((state) => state.locale)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const disabled = useMemo(() => new Set(settings.disabled), [settings.disabled])
  const overrides = useMemo(
    () => new Map(settings.overrides.map((override) => [override.id, override.rules])),
    [settings.overrides]
  )
  const enabledCount = SKILLS.length - disabled.size

  const title = (skill: Skill): string => (locale === 'en' ? skill.titleEn : skill.title)
  const summary = (skill: Skill): string => (locale === 'en' ? skill.summaryEn : skill.summary)

  const toggle = (id: string, on: boolean): void => {
    const next = on
      ? settings.disabled.filter((item) => item !== id)
      : [...new Set([...settings.disabled, id])]
    patch({ skills: { disabled: next } })
  }

  const openEditor = (skill: Skill): void => {
    if (editing === skill.id) {
      setEditing(null)
      return
    }
    setEditing(skill.id)
    setDraft((overrides.get(skill.id) ?? skill.rules).join('\n'))
  }

  const save = (skill: Skill): void => {
    const rules = draft
      .split('\n')
      .map((rule) => rule.trim())
      .filter((rule) => rule.length > 0)
    if (rules.length === 0) return
    const next = settings.overrides.filter((override) => override.id !== skill.id)
    next.push({ id: skill.id, rules })
    patch({ skills: { overrides: next } })
    setEditing(null)
  }

  const reset = (skill: Skill): void => {
    patch({ skills: { overrides: settings.overrides.filter((override) => override.id !== skill.id) } })
    setDraft(skill.rules.join('\n'))
  }

  return (
    <div className="divide-y divide-border" data-testid="settings-skills">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-foreground">{t('settings.skills.enabled')}</p>
          <p className="text-[11px] text-muted-foreground">{t('settings.skills.enabled.hint')}</p>
        </div>
        <Switch
          checked={settings.enabled}
          aria-label={t('settings.skills.enabled')}
          onCheckedChange={(value) => patch({ skills: { enabled: value } })}
        />
      </div>

      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {t('settings.skills.count', { n: enabledCount, total: SKILLS.length })}
      </p>

      {CATEGORIES.map((category) => (
        <div key={category}>
          <p className="bg-panel/60 px-3 py-1.5 text-[10px] uppercase tracking-wide text-tertiary">
            {t(CATEGORY_LABELS[category] as never)}
          </p>
          {SKILLS.filter((skill) => skill.category === category).map((skill) => (
            <div key={skill.id} className="px-3 py-2" data-testid={`settings-skill-${skill.id}`}>
              <div className="flex items-start gap-3">
                <Sparkles
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0',
                    disabled.has(skill.id) ? 'text-tertiary' : 'text-primary'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-foreground">
                    {title(skill)}
                    {overrides.has(skill.id) && (
                      <Badge variant="outline" className="text-[10px]">
                        {t('settings.skills.edited')}
                      </Badge>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{summary(skill)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => openEditor(skill)}
                  >
                    {editing === skill.id ? t('settings.skills.close') : t('settings.skills.edit')}
                  </Button>
                  <Switch
                    checked={!disabled.has(skill.id)}
                    aria-label={title(skill)}
                    onCheckedChange={(value) => toggle(skill.id, value)}
                  />
                </div>
              </div>

              {editing === skill.id && (
                <div className="mt-2 space-y-2">
                  <Textarea
                    rows={10}
                    value={draft}
                    spellCheck={false}
                    aria-label={t('settings.skills.edit')}
                    onChange={(event) => setDraft(event.target.value)}
                    className="min-h-[160px] resize-y font-mono text-[11.5px] leading-relaxed"
                  />
                  <p className="text-[10.5px] text-tertiary">{t('settings.skills.editHint')}</p>
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-[11px]"
                      disabled={!overrides.has(skill.id)}
                      onClick={() => reset(skill)}
                    >
                      <RotateCcw className="size-3" />
                      {t('settings.skills.reset')}
                    </Button>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setEditing(null)}
                      >
                        {t('settings.skills.cancel')}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-[11px]"
                        disabled={draft.trim().length === 0}
                        onClick={() => save(skill)}
                      >
                        <Check className="size-3" />
                        {t('settings.skills.save')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
