/**
 * The telemetry includes prompts, tool arguments and command output. Those
 * legitimately contain file contents, and people sometimes paste keys there, so
 * everything passes through this filter before it is written to disk.
 *
 * Redaction is deliberately conservative: it removes credential-shaped strings,
 * not arbitrary text, so diagnostics stay useful.
 */

const MARK = '«скрыто»'

const PATTERNS = [
  // OpenAI / Anthropic / OpenRouter style keys.
  [/\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}\b/g, `sk-${MARK}`],
  // Bearer tokens in headers or pasted curl commands.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${MARK}`],
  // JSON / env / query-string assignments of secrets.
  [
    /\b((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret))\b(\s*["']?\s*[:=]\s*["']?)([^\s"',;}]{6,})/gi,
    `$1$2${MARK}`
  ],
  // Common provider-specific formats.
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, `AIza${MARK}`],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, `gh_${MARK}`],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, `xox-${MARK}`],
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, `telegram:${MARK}`],
  // JWTs are recognizable by their three base64url segments.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, `jwt.${MARK}`],
  // PEM private keys: keep the envelope, drop the body.
  [
    /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
    `$1\n${MARK}\n$2`
  ]
]

const DATA_URL = /data:([a-z0-9.+/-]+);base64,[A-Za-z0-9+/=\s]+/gi

export function stripPayloads(text) {
  if (typeof text !== 'string') return text
  return text.replace(DATA_URL, (match, mime) => `data:${mime};base64,[${match.length} символов]`)
}

export function redact(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  let out = stripPayloads(text)
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/** Redacts every string inside a plain JSON-ish value, with a depth guard. */
export function redactDeep(value, depth = 0) {
  if (depth > 8) return value
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, child] of Object.entries(value)) out[key] = redactDeep(child, depth + 1)
    return out
  }
  return value
}
