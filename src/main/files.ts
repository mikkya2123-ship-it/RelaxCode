import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { ReadFileResult, WriteFileResult } from '@shared/ipc'
import { assertInsideWorkspace } from './workspace'
import { getSettings } from './store'

const SNIFF_BYTES = 8192

export async function readTextFile(inputPath: string): Promise<ReadFileResult> {
  let target: string
  try {
    target = assertInsideWorkspace(inputPath)
  } catch {
    return { ok: false, reason: 'outside-workspace' }
  }

  const maxFileSize = getSettings().files.largeFileKb * 1024

  try {
    const stat = await fs.stat(target)
    if (!stat.isFile()) return { ok: false, reason: 'not-file' }
    if (stat.size > maxFileSize) return { ok: false, reason: 'too-large' }

    const handle = await fs.open(target, 'r')
    try {
      const sniffLength = Math.min(SNIFF_BYTES, Number(stat.size))
      if (sniffLength > 0) {
        const sniff = Buffer.alloc(sniffLength)
        await handle.read(sniff, 0, sniffLength, 0)
        if (sniff.includes(0)) return { ok: false, reason: 'binary' }
      }
    } finally {
      await handle.close()
    }

    let content = await fs.readFile(target, 'utf8')
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
    return { ok: true, content, name: basename(target), mtime: stat.mtimeMs }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: false, reason: 'not-found' }
    return { ok: false, reason: 'unknown' }
  }
}

export async function writeTextFile(inputPath: string, content: string): Promise<WriteFileResult> {
  let target: string
  try {
    target = assertInsideWorkspace(inputPath)
  } catch {
    return { ok: false, reason: 'outside-workspace' }
  }

  try {
    await fs.writeFile(target, content, 'utf8')
    return { ok: true }
  } catch {
    return { ok: false, reason: 'unknown' }
  }
}
