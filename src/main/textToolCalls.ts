/* ------------------------------------------------------------------------- *
 * Fallback for models without native function calling.
 *
 * Weak or free models frequently "call" a tool by printing it as text:
 *   <tool_call>write_file<param_key>path</param_key>…
 *   {"name": "write_file", "arguments": {…}}
 *   <invoke name="write_file"><parameter name="path">…</parameter></invoke>
 * Such a reply produces no `delta.tool_calls`, so a naive agent run silently
 * does nothing. These helpers recover the calls so they can be executed.
 * ------------------------------------------------------------------------- */

export interface TextToolCall {
  name: string
  args: string
}

export interface ParsedTextCalls {
  calls: TextToolCall[]
  /** Index where the markup starts, so the leaked text can be removed from the UI. */
  startIndex: number
}

/** Maps a model-supplied tool name to a canonical one, or null when unknown. */
export type ToolNameResolver = (raw: string) => string | null

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json|tool_call|tool|xml)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : trimmed).trim()
  if (!candidate.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(candidate)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function callFromObject(
  source: Record<string, unknown>,
  resolveName: ToolNameResolver
): TextToolCall | null {
  let name: unknown = source.name ?? source.tool ?? source.tool_name ?? source.function
  let args: unknown =
    source.arguments ?? source.parameters ?? source.args ?? source.input ?? source.params

  if (name && typeof name === 'object') {
    const fn = name as Record<string, unknown>
    name = fn.name
    args = args ?? fn.arguments ?? fn.parameters
  }
  if (typeof name !== 'string') return null

  const resolved = resolveName(name)
  if (!resolved) return null

  let argString: string
  if (typeof args === 'string' && args.trim().length > 0) argString = args
  else if (args && typeof args === 'object') argString = JSON.stringify(args)
  else argString = '{}'

  return { name: resolved, args: argString }
}

/** `write_file<param_key>path</param_key><param_value>…</param_value>` */
function callsFromParamPairs(body: string, resolveName: ToolNameResolver): TextToolCall[] {
  const nameMatch = body.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)/)
  if (!nameMatch) return []
  const resolved = resolveName(nameMatch[1])
  if (!resolved) return []

  const args: Record<string, unknown> = {}
  const pairRe = /<param_key>([\s\S]*?)<\/param_key>\s*<param_value>([\s\S]*?)<\/param_value>/gi
  let match: RegExpExecArray | null
  let consumed = 0
  while ((match = pairRe.exec(body)) !== null) {
    args[match[1].trim()] = match[2]
    consumed = pairRe.lastIndex
  }
  // Tolerate a reply that was cut off before the closing tag of the last value.
  const rest = body.slice(consumed)
  const tail = rest.match(/<param_key>([\s\S]*?)<\/param_key>\s*<param_value>([\s\S]*)$/i)
  if (tail) args[tail[1].trim()] = tail[2]
  if (Object.keys(args).length === 0) return []
  return [{ name: resolved, args: JSON.stringify(args) }]
}

/** `<invoke name="write_file"><parameter name="path">…</parameter></invoke>` */
function callsFromInvokes(text: string, resolveName: ToolNameResolver): ParsedTextCalls | null {
  const invokeRe = /<invoke\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/invoke>/gi
  const calls: TextToolCall[] = []
  let match: RegExpExecArray | null
  while ((match = invokeRe.exec(text)) !== null) {
    const resolved = resolveName(match[1])
    if (!resolved) continue
    const args: Record<string, unknown> = {}
    const paramRe = /<parameter\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/parameter>/gi
    let param: RegExpExecArray | null
    while ((param = paramRe.exec(match[2])) !== null) args[param[1]] = param[2]
    if (Object.keys(args).length === 0) {
      const inline = extractJsonObject(match[2])
      if (inline) Object.assign(args, inline)
    }
    calls.push({ name: resolved, args: JSON.stringify(args) })
  }
  if (calls.length === 0) return null
  const startIndex = text.search(/<invoke\s/i)
  return { calls, startIndex: startIndex < 0 ? 0 : startIndex }
}

export function parseTextToolCalls(
  text: string,
  resolveName: ToolNameResolver
): ParsedTextCalls | null {
  if (text.length === 0 || text.length > 400_000) return null

  // 1) <tool_call>…</tool_call> — JSON body, <tool_name> body, or param pairs.
  const blockRe = /<tool_call[^>]*>([\s\S]*?)<\/tool_call>/gi
  const blockCalls: TextToolCall[] = []
  let startIndex = -1
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    if (startIndex < 0) startIndex = match.index
    const body = match[1]

    const fromJson = extractJsonObject(body)
    const fromObject = fromJson ? callFromObject(fromJson, resolveName) : null
    if (fromObject) {
      blockCalls.push(fromObject)
      continue
    }

    const innerName = body.match(/<tool_name>([\s\S]*?)<\/tool_name>/i)
    if (innerName) {
      const resolved = resolveName(innerName[1].trim())
      if (resolved) {
        const params = body.match(/<parameters>([\s\S]*?)<\/parameters>/i)
        const parsed = params ? extractJsonObject(params[1]) : null
        blockCalls.push({ name: resolved, args: parsed ? JSON.stringify(parsed) : '{}' })
        continue
      }
    }

    blockCalls.push(...callsFromParamPairs(body, resolveName))
  }
  if (blockCalls.length > 0) return { calls: blockCalls, startIndex: Math.max(startIndex, 0) }

  // 1b) Unterminated <tool_call> (response cut off mid-call).
  const openRe = /<tool_call[^>]*>([\s\S]+)$/i
  const open = text.match(openRe)
  if (open) {
    const fromJson = extractJsonObject(open[1])
    const fromObject = fromJson ? callFromObject(fromJson, resolveName) : null
    const partial = fromObject ? [fromObject] : callsFromParamPairs(open[1], resolveName)
    if (partial.length > 0) {
      return { calls: partial, startIndex: text.search(/<tool_call[^>]*>/i) }
    }
  }

  // 2) Anthropic-style <invoke> blocks.
  const invokes = callsFromInvokes(text, resolveName)
  if (invokes) return invokes

  // 3) The whole reply is a single JSON tool object (optionally in a fence).
  const whole = extractJsonObject(text)
  if (whole) {
    const call = callFromObject(whole, resolveName)
    if (call) {
      const fence = text.indexOf('```')
      return { calls: [call], startIndex: fence >= 0 ? fence : 0 }
    }
  }

  return null
}
