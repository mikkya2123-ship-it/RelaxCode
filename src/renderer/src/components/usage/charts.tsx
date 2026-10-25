import type { JSX } from 'react'

/**
 * Charts for the usage screen, drawn by hand instead of pulling a chart
 * library into the bundle. Every chart takes plain numbers and a label string,
 * so the screen keeps all wording (and all localization) to itself.
 */

/** 1234 → "1 234"; grouping comes from the system locale. */
export function grouped(value: number): string {
  return Math.round(value).toLocaleString()
}

/** The smallest 1/2/2.5/5/10×10ⁿ above the value, so axis labels stay round. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const mantissa = value / pow
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 2.5 ? 2.5 : mantissa <= 5 ? 5 : 10
  return nice * pow
}

export interface TokenBarDatum {
  /** One line shown when the bar is hovered. */
  label: string
  prompt: number
  completion: number
  /** Part of `completion` the provider counted as reasoning. */
  reasoning: number
}

const AXIS_TEXT = 'fill-[var(--muted-foreground)] text-[10px] tabular-nums'

/** One stacked bar per answer: prompt below, completion above, reasoning on top. */
export function TokenBarsChart({
  data,
  height = 190,
  legend
}: {
  data: TokenBarDatum[]
  height?: number
  legend: { prompt: string; completion: string; reasoning: string }
}): JSX.Element {
  const barW = 22
  const gap = 8
  const padLeft = 54
  const padRight = 10
  const padTop = 10
  const padBottom = 22
  const plotH = height - padTop - padBottom
  const innerW = Math.max(80, data.length * (barW + gap) - gap)
  const width = padLeft + innerW + padRight
  const peak = Math.max(1, ...data.map((d) => d.prompt + d.completion))
  const scale = niceCeiling(peak)
  const y = (value: number): number => padTop + plotH * (1 - value / scale)
  const step = data.length > 24 ? Math.ceil(data.length / 24) : 1

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[190px] w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((part) => (
        <g key={part}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={y(scale * part)}
            y2={y(scale * part)}
            className="stroke-[var(--border)]"
            strokeWidth={1}
          />
          <text x={padLeft - 6} y={y(scale * part) + 3} textAnchor="end" className={AXIS_TEXT}>
            {grouped(scale * part)}
          </text>
        </g>
      ))}
      {data.map((d, index) => {
        const x = padLeft + index * (barW + gap)
        const answer = Math.max(0, d.completion - d.reasoning)
        const promptH = (d.prompt / scale) * plotH
        const answerH = (answer / scale) * plotH
        const reasoningH = (d.reasoning / scale) * plotH
        const baseY = padTop + plotH
        const tip = `${d.label}\n${legend.prompt}: ${grouped(d.prompt)}\n${legend.completion}: ${grouped(d.completion)}\n${legend.reasoning}: ${grouped(d.reasoning)}`
        return (
          <g key={index}>
            {d.prompt > 0 && (
              <rect
                x={x}
                y={baseY - promptH}
                width={barW}
                height={promptH}
                rx={2}
                className="fill-primary"
              >
                <title>{tip}</title>
              </rect>
            )}
            {answer > 0 && (
              <rect
                x={x}
                y={baseY - promptH - answerH}
                width={barW}
                height={answerH}
                className="fill-[var(--tertiary)]"
              >
                <title>{tip}</title>
              </rect>
            )}
            {reasoningH > 0 && (
              <rect
                x={x}
                y={baseY - promptH - answerH - reasoningH}
                width={barW}
                height={reasoningH}
                className="fill-amber-500"
              >
                <title>{tip}</title>
              </rect>
            )}
            {(d.prompt + d.completion) === 0 && (
              <rect x={x} y={baseY - 2} width={barW} height={2} className="fill-[var(--muted)]">
                <title>{tip}</title>
              </rect>
            )}
            {index % step === 0 && (
              <text
                x={x + barW / 2}
                y={height - 7}
                textAnchor="middle"
                className={AXIS_TEXT}
              >
                {index + 1}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** How the conversation grew: the provider's context number after each answer. */
export function ContextLineChart({
  values,
  limit,
  limitLabel,
  height = 190
}: {
  /** One entry per answer; `null` means the provider reported nothing there. */
  values: (number | null)[]
  limit?: number | null
  limitLabel?: string
  height?: number
}): JSX.Element {
  const padLeft = 54
  const padRight = 10
  const padTop = 10
  const padBottom = 22
  const plotH = height - padTop - padBottom
  const points = values
    .map((value, index) => ({ index, value }))
    .filter((point): point is { index: number; value: number } => point.value !== null)
  const peak = Math.max(1, ...points.map((point) => point.value))
  const knownLimit = typeof limit === 'number' && limit > 0
  const scale = knownLimit ? Math.max(limit as number, peak) : niceCeiling(peak)
  const count = values.length
  const innerW = Math.max(80, count * 16)
  const width = padLeft + innerW + padRight
  const step = Math.max(1, count - 1)
  const px = (index: number): number => padLeft + (index / step) * innerW
  const py = (value: number): number => padTop + plotH * (1 - value / scale)
  const line = points.map((point) => `${px(point.index)},${py(point.value)}`).join(' ')
  const area =
    points.length > 0
      ? `${px(points[0].index)},${padTop + plotH} ${line} ${px(points[points.length - 1].index)},${padTop + plotH}`
      : ''
  const labelStep = count > 24 ? Math.ceil(count / 24) : 1

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[190px] w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((part) => (
        <g key={part}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={py(scale * part)}
            y2={py(scale * part)}
            className="stroke-[var(--border)]"
            strokeWidth={1}
          />
          <text x={padLeft - 6} y={py(scale * part) + 3} textAnchor="end" className={AXIS_TEXT}>
            {grouped(scale * part)}
          </text>
        </g>
      ))}
      {knownLimit && limit < scale && (
        <g>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={py(limit)}
            y2={py(limit)}
            className="stroke-amber-500"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text
            x={width - padRight}
            y={py(limit) - 4}
            textAnchor="end"
            className="fill-amber-500 text-[10px] tabular-nums"
          >
            {limitLabel}
          </text>
        </g>
      )}
      {area !== '' && <polygon points={area} className="fill-primary/10" />}
      {points.length > 1 && (
        <polyline
          points={line}
          fill="none"
          className="stroke-primary"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      {points.map((point) => (
        <circle key={point.index} cx={px(point.index)} cy={py(point.value)} r={2} className="fill-primary">
          <title>{`#${point.index + 1}: ${grouped(point.value)}`}</title>
        </circle>
      ))}
      {points.map((point, i) =>
        i % labelStep === 0 ? (
          <text
            key={`label-${point.index}`}
            x={px(point.index)}
            y={height - 7}
            textAnchor="middle"
            className={AXIS_TEXT}
          >
            {point.index + 1}
          </text>
        ) : null
      )}
    </svg>
  )
}

export interface BarListItem {
  label: string
  /** Each part is a colored segment of the bar, left to right. */
  parts: Array<{ value: number; className: string }>
  /** Right-aligned text next to the bar. */
  value: string
  /** Optional second line under the label. */
  note?: string
}

/** A ranked list of horizontal bars: chats, tools, anything comparable. */
export function BarList({ items }: { items: BarListItem[] }): JSX.Element {
  const max = Math.max(1, ...items.map((item) => item.parts.reduce((n, part) => n + part.value, 0)))
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, index) => {
        return (
          <div key={`${item.label}-${index}`} className="flex items-center gap-2">
            <span
              className="w-[104px] shrink-0 truncate text-[11px] text-foreground"
              title={item.note ? `${item.label}\n${item.note}` : item.label}
            >
              {item.label}
            </span>
            <span className="flex h-3.5 min-w-0 flex-1 items-center gap-[2px]">
              {item.parts.map((part, partIndex) =>
                part.value > 0 ? (
                  <span
                    key={partIndex}
                    style={{ width: `${(part.value / max) * 100}%` }}
                    className={`h-3.5 shrink-0 rounded-[3px] ${part.className}`}
                    title={`${item.label} — ${grouped(part.value)}`}
                  />
                ) : null
              )}
            </span>
            <span className="w-[56px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {item.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
