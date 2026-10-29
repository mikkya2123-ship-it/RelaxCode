/**
 * A minimal MCP server speaking JSON-RPC over stdio (newline-delimited, as the
 * MCP stdio transport requires). Used by `npm run test:mcp` and the smoke
 * harness so the MCP client path is exercised without any third-party server.
 *
 * Tools:
 *   echo  { text }        → returns the text back
 *   add   { a, b }        → returns the sum
 *   fail  {}              → answers with isError: true
 *   structured {}         → answers with structuredContent and no text
 *   slow  { ms }          → answers after `ms`, for timeout behaviour
 *
 * Run: node scripts/mock-mcp-server.mjs
 */

import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2025-06-18'

const tools = [
  {
    name: 'echo',
    description: 'Returns the given text back.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo' } },
      required: ['text']
    }
  },
  {
    name: 'add',
    description: 'Adds two numbers.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b']
    }
  },
  {
    name: 'fail',
    description: 'Always reports a tool error.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'structured',
    description: 'Returns a structured payload without text content.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'slow',
    description: 'Waits {ms} milliseconds before answering.',
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'number' } },
      required: ['ms']
    }
  }
]

function textResult(text, isError = false) {
  const result = { content: [{ type: 'text', text }] }
  if (isError) result.isError = true
  return result
}

async function callTool(name, args) {
  if (name === 'echo') return textResult(`echo: ${args.text ?? ''}`)
  if (name === 'add') return textResult(`sum: ${(args.a ?? 0) + (args.b ?? 0)}`)
  if (name === 'fail') return textResult('the mock tool failed on purpose', true)
  if (name === 'structured') {
    return { content: [], structuredContent: { ok: true, items: [1, 2, 3] } }
  }
  if (name === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(args.ms ?? 100))))
    return textResult(`woke up after ${args.ms ?? 100} ms`)
  }
  return textResult(`unknown tool: ${name}`, true)
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const readline = createInterface({ input: process.stdin, terminal: false })

readline.on('line', (line) => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    return
  }
  if (message === null || typeof message !== 'object' || message.id === undefined) return

  if (message.method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'relaxcode-mock', version: '1.0.0' }
      }
    })
    return
  }
  if (message.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: message.id, result: { tools } })
    return
  }
  if (message.method === 'tools/call') {
    void callTool(message.params?.name ?? '', message.params?.arguments ?? {}).then((result) => {
      write({ jsonrpc: '2.0', id: message.id, result })
    })
    return
  }
  if (message.method === 'ping') {
    write({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }
  write({
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `Method not found: ${String(message.method)}` }
  })
})

process.stderr.write('relaxcode-mock: stdio server started\n')
