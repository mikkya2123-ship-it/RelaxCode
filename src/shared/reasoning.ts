/* ------------------------------------------------------------------------- *
 * "Thinking" — how deep a model is asked to reason before it answers.
 *
 * The OpenAI protocol has no single switch for this. Every provider spells it
 * its own way:
 *   - OpenRouter ……… `reasoning: { effort }` (or `{ enabled: false }`)
 *   - OpenAI, xAI, Groq, Gemini's compat layer … `reasoning_effort`
 *   - Qwen / DashScope … `enable_thinking`
 *   - z.ai / GLM ……… `thinking: { type }`
 *   - DeepSeek reasoner, o-series, …-thinking … nothing: the model decides
 *
 * The module is shared on purpose: the main process builds the request body
 * from it and the UI describes what will be sent, so the popover can never
 * drift away from the wire.
 * ------------------------------------------------------------------------- */

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

/** Ordered from "no extra work" to "as deep as it gets". */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high']

/** How a provider wants to be asked. */
export type ReasoningStyle = 'openrouter' | 'effort' | 'groq' | 'qwen' | 'zai' | 'model-only'

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** The provider family, decided by the endpoint the user configured. */
export function reasoningStyle(baseUrl: string): ReasoningStyle {
  const host = hostOf(baseUrl)
  if (/(^|\.)openrouter\.ai$/.test(host)) return 'openrouter'
  if (/(^|\.)api\.groq\.com$/.test(host)) return 'groq'
  if (/(^|\.)(dashscope(-intl)?\.aliyuncs\.com|alibabacloud\.com)$/.test(host)) return 'qwen'
  if (/(^|\.)(api\.z\.ai|open\.bigmodel\.cn|api\.zhipuai\.cn)$/.test(host)) return 'zai'
  // The reasoner answers `reasoning_content` on its own and rejects sampling
  // parameters, so there is nothing useful to send.
  if (/(^|\.)api\.deepseek\.com$/.test(host)) return 'model-only'
  // OpenAI, xAI, Google's OpenAI compatibility layer, LiteLLM, vLLM and every
  // gateway that follows the OpenAI spelling.
  return 'effort'
}

/**
 * Models that reason whatever the request says — a "-thinking" variant, an
 * o-series model or a reasoner. The level can still cap how much they think,
 * but it cannot switch the thinking off.
 */
const ALWAYS_THINKING_RE =
  /(reasoner|reasoning|thinking|^o[1-9](-|$)|^qwq|^qwr|^gpt-5(\.\d)?(-|$))/i

export function thinksByDefault(model: string): boolean {
  return ALWAYS_THINKING_RE.test(model.trim())
}

/**
 * The parameters merged into a chat request for a level. `{}` means "send
 * nothing": either the provider has no parameter for it or the provider's
 * default already is the right behaviour.
 */
export function reasoningParams(
  style: ReasoningStyle,
  level: ThinkingLevel
): Record<string, unknown> {
  const on = level !== 'off'
  switch (style) {
    case 'openrouter':
      // OpenRouter's unified field. `exclude: false` keeps the reasoning text
      // in the stream so the UI can show it.
      return on ? { reasoning: { effort: level, exclude: false } } : { reasoning: { enabled: false } }
    case 'groq':
      // `parsed` puts the reasoning in `delta.reasoning` instead of the answer.
      return on ? { reasoning_effort: level, reasoning_format: 'parsed' } : {}
    case 'qwen':
      return { enable_thinking: on }
    case 'zai':
      return { thinking: { type: on ? 'enabled' : 'disabled' } }
    case 'model-only':
      return {}
    case 'effort':
    default:
      // Nothing is sent when it is off: for a model that thinks by default this
      // leaves the provider's own default in place, which is the honest answer.
      return on ? { reasoning_effort: level } : {}
  }
}

/**
 * A short, provider-accurate description of the parameters above, for the UI.
 * `null` when nothing goes on the wire.
 */
export function reasoningWireLabel(style: ReasoningStyle, level: ThinkingLevel): string | null {
  const params = reasoningParams(style, level)
  const entries = Object.entries(params)
  if (entries.length === 0) return null
  return entries
    .map(([key, value]) =>
      typeof value === 'object' && value !== null
        ? Object.entries(value as Record<string, unknown>)
            .map(([inner, innerValue]) => `${key}.${inner} = ${String(innerValue)}`)
            .join(' · ')
        : `${key} = ${String(value)}`
    )
    .join(' · ')
}

/** OpenRouter names the efforts it knows; map them onto our four levels. */
const EFFORT_LEVEL: Record<string, ThinkingLevel> = {
  minimal: 'low',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
  max: 'high',
  none: 'off'
}

/** The levels a model advertises (empty when the endpoint says nothing). */
export function levelsFromEfforts(efforts: readonly string[]): ThinkingLevel[] {
  const found = new Set<ThinkingLevel>()
  for (const effort of efforts) {
    const level = EFFORT_LEVEL[effort.toLowerCase()]
    if (level) found.add(level)
  }
  return THINKING_LEVELS.filter((level) => found.has(level))
}

/** Sampling parameters these models reject outright, whatever temperature is set. */
const NO_SAMPLING_RE = /^(o[1-9](-|$)|deepseek-reasoner)/i

export function supportsSampling(model: string): boolean {
  return !NO_SAMPLING_RE.test(model.trim())
}
