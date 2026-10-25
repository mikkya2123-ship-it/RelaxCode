import { BrowserWindow } from 'electron'
import type { ImageMeta } from '@shared/tool-meta'
import { safeHttpUrl } from '@shared/web-search'
import { listBackground } from './proc'
import { argBool, argNumber, argString, ToolError, truncate, type ToolContext, type ToolDef } from './tool-utils'

/**
 * The agent's own eyes and hands on a running web app.
 *
 * A hidden Electron BrowserWindow is driven like a test browser: load a URL,
 * click, fill fields, read the page, take screenshots. A screenshot is both
 * shown to the user (a card) and handed to the MODEL itself (an image part in
 * the next request) — that second half is what lets the model judge a UI by
 * looking at it instead of guessing.
 */

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

/** First localhost URL a background server seems to be serving. */
function guessServerUrl(): string | null {
  const running = listBackground().find((item) => item.running)
  if (!running || !running.port || running.port <= 0) return null
  return `http://localhost:${running.port}`
}

interface PilotResult {
  log: string[]
  errors: string[]
  pageText: string
  screenshot: ImageMeta | null
}

interface PilotOptions {
  url: string
  width: number
  height: number
  signal: AbortSignal
}

/**
 * Opens the page offscreen and runs `act` against it. The window never shows;
 * everything the agent needs comes back as data.
 */
async function withPilot(
  options: PilotOptions,
  act: (win: BrowserWindow, result: PilotResult) => Promise<void>
): Promise<PilotResult> {
  const result: PilotResult = { log: [], errors: [], pageText: '', screenshot: null }
  const win = new BrowserWindow({
    show: false,
    width: options.width,
    height: options.height,
    webPreferences: {
      // No node in the visited page: it is arbitrary web content.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  const onConsole = (_event: unknown, level: unknown, message: string, _line: number, source: string): void => {
    if (/\berror\b/i.test(String(level)) || /\berror\b/i.test(message)) {
      result.errors.push(`${message}${source ? ` (${source})` : ''}`)
    }
  }
  win.webContents.on('console-message', onConsole as never)

  try {
    await win.webContents.loadURL(options.url)
    result.log.push(`loaded ${options.url} (${options.width}×${options.height})`)
    await act(win, result)
    result.pageText = await pageSummary(win)
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error))
  } finally {
    win.webContents.removeListener('console-message', onConsole as never)
    if (!win.isDestroyed()) win.destroy()
  }
  return result
}

async function pageSummary(win: BrowserWindow): Promise<string> {
  try {
    return await win.webContents.executeJavaScript(
      `document.title + '\\n' + (document.body ? document.body.innerText.slice(0, 3000) : '')`
    )
  } catch {
    return ''
  }
}

/** Runs page JS in a try/catch and returns a short status string. */
function pageScript(body: string): string {
  return `(() => { try { ${body} } catch (e) { return 'ERROR: ' + (e && e.message ? e.message : e) } })()`
}

/** Where click/fill should land: a selector wins, otherwise visible text. */
function findScript(selector?: string, text?: string): string {
  if (selector) {
    return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; window.__pilot = el; return true })()`
  }
  if (text) {
    return `(() => { const want = ${JSON.stringify(text.toLowerCase())}; const el = [...document.querySelectorAll('button, a, input, select, textarea, [role=button], label')].find(el => (el.textContent || el.value || '').toLowerCase().includes(want)); if (!el) return null; window.__pilot = el; return true })()`
  }
  return 'null'
}

export interface PilotAction {
  type: string
  selector?: string
  text?: string
  value?: string
  url?: string
  ms?: number
}

/** Shared engine of browser_pilot / fill_form / chaos_check. */
async function runPilotActions(win: BrowserWindow, actions: PilotAction[], log: string[]): Promise<void> {
  for (const action of actions) {
    const locate = async (what: string): Promise<void> => {
      const script = findScript(action.selector, action.text)
      if (script === 'null') throw new ToolError(`${what}: pass a selector or text`)
      const found = await win.webContents.executeJavaScript(pageScript(`${script}; return !!window.__pilot`))
      if (found !== true) {
        throw new ToolError(`element not found for ${what}: ${action.selector ?? action.text}`)
      }
    }
    switch (action.type) {
      case 'goto': {
        const url = safeHttpUrl(action.url ?? '')
        if (!url) throw new ToolError(`invalid URL: ${action.url}`)
        await win.webContents.loadURL(url)
        log.push(`opened ${url}`)
        break
      }
      case 'click': {
        await locate('click')
        const done = await win.webContents.executeJavaScript(
          pageScript(`const el = window.__pilot; el.click(); return (el.textContent || '').trim().slice(0, 40)`)
        )
        log.push(`clicked ${done || action.selector || action.text}`)
        break
      }
      case 'fill': {
        await locate('fill')
        const done = await win.webContents.executeJavaScript(
          pageScript(
            `const el = window.__pilot; el.value = ${JSON.stringify(action.value ?? '')}; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); return el.name || el.id || (el.previousElementSibling && el.previousElementSibling.textContent || '').slice(0, 30)`
          )
        )
        log.push(`filled ${done || action.selector || action.text}`)
        break
      }
      case 'wait': {
        const ms = Math.min(Math.max(action.ms ?? 1000, 100), 10000)
        await new Promise((resolve) => setTimeout(resolve, ms))
        log.push(`waited ${ms}ms`)
        break
      }
      case 'read': {
        log.push('read the page')
        break
      }
      default:
        throw new ToolError(`unknown action type: ${action.type}`)
    }
  }
}

function pilotToolResult(
  result: PilotResult,
  title: string,
  ctx: ToolContext
): { ok: boolean; summary: string; detail: string; meta?: ImageMeta } {
  if (result.screenshot) ctx.report?.(result.screenshot)
  const detail = [
    result.log.length > 0 ? result.log.map((line) => `· ${line}`).join('\n') : '',
    result.errors.length > 0 ? `Page errors:\n${result.errors.slice(0, 10).join('\n')}` : '',
    result.pageText ? `Page text:\n${result.pageText.slice(0, 2000)}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    ok: result.errors.length === 0,
    summary: `${title}${result.errors.length > 0 ? ` — ${result.errors.length} page error(s)` : ''}`,
    detail: truncate(detail || '(nothing happened)'),
    ...(result.screenshot ? { meta: result.screenshot } : {})
  }
}

async function captureScreenshot(win: BrowserWindow, label: string): Promise<ImageMeta | null> {
  try {
    const image = await win.webContents.capturePage()
    if (image.isEmpty()) return null
    const buffer = image.toJPEG(80)
    const size = image.getSize()
    const src = `data:image/jpeg;base64,${buffer.toString('base64')}`
    return { kind: 'image', src, alt: label, mime: 'image/jpeg', bytes: buffer.length, width: size.width, height: size.height }
  } catch {
    return null
  }
}

const screenshotAppTool: ToolDef = {
  name: 'screenshot_app',
  description:
    'Take a screenshot of a running web app and LOOK at it: the picture is delivered to you as an image so you can judge the layout yourself. Pass a url, or omit it to use the dev server started with start_server. Use it to verify a UI after changes — compare against what the user asked for instead of assuming.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'http(s) URL to shoot (default: the running dev server)' },
      width: { type: 'number', description: 'Viewport width (default 1280)' },
      height: { type: 'number', description: 'Viewport height (default 800)' }
    }
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const url = safeHttpUrl(argString(args, 'url', false) || guessServerUrl() || '')
    if (!url) {
      return {
        ok: false,
        summary: 'no URL to shoot',
        detail: 'Pass a url, or start the app first with start_server so its port is known.'
      }
    }
    const width = Math.min(Math.max(argNumber(args, 'width') ?? DESKTOP.width, 320), 1920)
    const height = Math.min(Math.max(argNumber(args, 'height') ?? DESKTOP.height, 480), 1200)

    const result = await withPilot({ url, width, height, signal: ctx.signal }, async (win, res) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      res.screenshot = await captureScreenshot(win, url)
    })
    const shot = result.screenshot
    if (!shot) return { ok: false, summary: 'screenshot failed', detail: 'The page loaded but no image could be captured.' }
    ctx.showModelImage?.(shot.src, `Screenshot of ${url} (${width}×${height})`)
    return pilotToolResult(result, `screenshot of ${url}`, ctx)
  }
}

const checkMobileTool: ToolDef = {
  name: 'check_mobile',
  description:
    'Screenshot a running web app at phone size (390×844) and LOOK at it, to check the mobile layout: what wraps, overflows or becomes unreachable. Same as screenshot_app but with a phone viewport.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'http(s) URL (default: the running dev server)' } }
  },
  risk: 'read',
  execute: async (args, ctx) => {
    const url = safeHttpUrl(argString(args, 'url', false) || guessServerUrl() || '')
    if (!url) return { ok: false, summary: 'no URL to shoot', detail: 'Pass a url, or start the app with start_server first.' }
    const result = await withPilot({ url, ...MOBILE, signal: ctx.signal }, async (win, res) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      res.screenshot = await captureScreenshot(win, `${url} (mobile)`)
    })
    const shot = result.screenshot
    if (!shot) return { ok: false, summary: 'screenshot failed', detail: 'The page loaded but no image could be captured.' }
    ctx.showModelImage?.(shot.src, `Mobile screenshot of ${url} (390×844)`)
    return pilotToolResult(result, `mobile screenshot of ${url}`, ctx)
  }
}

const browserPilotTool: ToolDef = {
  name: 'browser_pilot',
  description:
    'Drive a real browser against a web app like a human tester: open pages, click buttons and links, fill fields, wait, read what the page says, and finish with a screenshot you can see. Actions run in order; find elements by CSS selector or by their visible text. Use it to verify flows end-to-end (login, checkout, navigation) on a dev server.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'First http(s) URL to open' },
      actions: {
        type: 'array',
        description: 'Steps to run in order',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['goto', 'click', 'fill', 'wait', 'read'], description: 'What to do' },
            url: { type: 'string', description: 'goto: URL to open' },
            selector: { type: 'string', description: 'click/fill: CSS selector of the element' },
            text: { type: 'string', description: 'click/fill: find the element by its visible text instead' },
            value: { type: 'string', description: 'fill: value to type into the field' },
            ms: { type: 'number', description: 'wait: milliseconds (100-10000)' }
          },
          required: ['type']
        }
      },
      screenshot: { type: 'boolean', description: 'Take a final screenshot (default true)' }
    },
    required: ['url', 'actions']
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const url = safeHttpUrl(argString(args, 'url'))
    if (!url) throw new ToolError('Invalid or non-http(s) URL')
    const raw = Array.isArray(args.actions) ? args.actions : []
    const actions = raw.slice(0, 25) as PilotAction[]
    const wantShot = argBool(args, 'screenshot') || !('screenshot' in args)

    const result = await withPilot({ url, ...DESKTOP, signal: ctx.signal }, async (win, res) => {
      await runPilotActions(win, actions, res.log)
      if (wantShot) res.screenshot = await captureScreenshot(win, 'browser pilot result')
    })
    if (result.screenshot) ctx.showModelImage?.(result.screenshot.src, 'Browser pilot final screenshot')
    return pilotToolResult(result, `${actions.length} action(s) on ${url}`, ctx)
  }
}

const fillFormTool: ToolDef = {
  name: 'fill_form',
  description:
    'Open a page and fill a form with the given values, then submit it and report what happened: page errors, where it landed, and a screenshot. Fields are matched by CSS selector or by label text. Use it to test registration, login and checkout flows.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Page with the form' },
      fields: {
        type: 'array',
        description: 'Fields to fill in order',
        items: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'CSS selector of the input' },
            text: { type: 'string', description: 'Find the input by its label text instead' },
            value: { type: 'string', description: 'Value to enter' }
          },
          required: ['value']
        }
      },
      submit: { type: 'string', description: 'Selector or text of the submit button (default: the form submit button)' }
    },
    required: ['url', 'fields']
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const url = safeHttpUrl(argString(args, 'url'))
    if (!url) throw new ToolError('Invalid or non-http(s) URL')
    const raw = Array.isArray(args.fields) ? args.fields : []
    const fields = raw
      .filter(
        (field): field is Record<string, unknown> =>
          !!field && typeof field === 'object' && typeof (field as { value?: unknown }).value === 'string'
      )
      .slice(0, 20)
    const submit = argString(args, 'submit', false)
    const submitIsSelector = submit.startsWith('#') || submit.startsWith('.') || submit.includes('[') || submit.includes('>')

    const actions: PilotAction[] = fields.map((field) => ({
      type: 'fill',
      selector: typeof field.selector === 'string' ? field.selector : undefined,
      text: typeof field.text === 'string' ? field.text : undefined,
      value: String(field.value)
    }))
    actions.push({ type: 'wait', ms: 300 })
    actions.push(
      submit
        ? { type: 'click', ...(submitIsSelector ? { selector: submit } : { text: submit }) }
        : { type: 'click', selector: 'form button[type=submit], form input[type=submit], button[type=submit]' }
    )
    actions.push({ type: 'wait', ms: 1200 })

    const result = await withPilot({ url, ...DESKTOP, signal: ctx.signal }, async (win, res) => {
      await runPilotActions(win, actions, res.log)
      res.screenshot = await captureScreenshot(win, 'form result')
    })
    if (result.screenshot) ctx.showModelImage?.(result.screenshot.src, 'Form submission result')
    return pilotToolResult(result, `filled ${fields.length} field(s) on ${url}`, ctx)
  }
}

const CHAOS_VALUES = ['', ' ', '{}<script>alert(1)</script> ✂ ★', 'A'.repeat(300), 'null', '-1']

const chaosCheckTool: ToolDef = {
  name: 'chaos_check',
  description:
    'Stress-test every form on a page with hostile input: empty values, huge strings, special characters — then submit and report page errors and a screenshot of the outcome. Catches crashes and missing validation before users find them.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Page with the form' } },
    required: ['url']
  },
  risk: 'exec',
  execute: async (args, ctx) => {
    const url = safeHttpUrl(argString(args, 'url'))
    if (!url) throw new ToolError('Invalid or non-http(s) URL')

    const result = await withPilot({ url, ...DESKTOP, signal: ctx.signal }, async (win, res) => {
      const count = await win.webContents.executeJavaScript(
        pageScript(
          `const els = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea'); els.forEach((el, i) => { el.value = ${JSON.stringify(
            CHAOS_VALUES
          )}[i % ${CHAOS_VALUES.length}]; el.dispatchEvent(new Event('input', {bubbles: true})) }); return els.length`
        )
      )
      res.log.push(`filled ${count} field(s) with hostile values`)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const submitted = await win.webContents.executeJavaScript(
        pageScript(
          `const b = document.querySelector('form button[type=submit], form input[type=submit], button[type=submit]'); if (b) { b.click(); return 'submitted' } return 'no submit button'`
        )
      )
      res.log.push(submitted)
      await new Promise((resolve) => setTimeout(resolve, 1200))
      res.screenshot = await captureScreenshot(win, 'chaos result')
    })
    return pilotToolResult(result, `chaos test on ${url}`, ctx)
  }
}

export const SCREEN_TOOLS: ToolDef[] = [screenshotAppTool, checkMobileTool, browserPilotTool, fillFormTool, chaosCheckTool]
