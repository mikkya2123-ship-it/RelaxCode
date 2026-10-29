import type { JSX } from 'react'
import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileLock,
  FileText,
  Settings
} from 'lucide-react'

const EXTENSION_COLORS: Record<string, string> = {
  ts: '#4a7db8',
  tsx: '#4a7db8',
  mts: '#4a7db8',
  cts: '#4a7db8',
  js: '#a08c3e',
  jsx: '#a08c3e',
  mjs: '#a08c3e',
  cjs: '#a08c3e',
  json: '#8a8f98',
  jsonc: '#8a8f98',
  css: '#5f7fb8',
  scss: '#5f7fb8',
  less: '#5f7fb8',
  html: '#b06a4a',
  htm: '#b06a4a',
  vue: '#6d9f71',
  svelte: '#b06a4a',
  md: '#7a7f87',
  mdx: '#7a7f87',
  py: '#5c87b0',
  rs: '#a06040',
  go: '#4f9da6',
  java: '#b06a4a',
  kt: '#8a6db8',
  rb: '#a05252',
  php: '#7a6db8',
  sh: '#6d9f71',
  ps1: '#4a7db8',
  bat: '#8a8f98',
  cmd: '#8a8f98',
  yml: '#8a7db8',
  yaml: '#8a7db8',
  toml: '#8a7db8',
  ini: '#8a8f98',
  env: '#6d9f71',
  sql: '#5c87b0',
  png: '#6d9f71',
  jpg: '#6d9f71',
  jpeg: '#6d9f71',
  gif: '#6d9f71',
  webp: '#6d9f71',
  svg: '#b0913e',
  ico: '#b0913e',
  lock: '#8a8f98'
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', '7z', 'rar', 'bz2', 'xz'])
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'kt',
  'rb',
  'php',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'swift',
  'vue',
  'svelte',
  'sh',
  'ps1',
  'sql'
])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

interface FileIconProps {
  name: string
  className?: string
}

export function FileIcon({ name, className }: FileIconProps): JSX.Element {
  const ext = extensionOf(name)
  const color = EXTENSION_COLORS[ext] ?? 'currentColor'

  if (ext === 'json' || ext === 'jsonc') {
    return <FileJson className={className} style={{ color }} />
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return <FileImage className={className} style={{ color }} />
  }
  if (ARCHIVE_EXTENSIONS.has(ext)) {
    return <FileArchive className={className} style={{ color }} />
  }
  if (CODE_EXTENSIONS.has(ext)) {
    return <FileCode className={className} style={{ color }} />
  }
  if (name === 'package-lock.json' || ext === 'lock') {
    return <FileLock className={className} style={{ color }} />
  }
  if (name.startsWith('.') || ext === 'md' || ext === 'txt' || ext === 'mdx') {
    return <FileText className={className} style={{ color }} />
  }
  if (name.toLowerCase().includes('config') || ext === 'toml' || ext === 'ini') {
    return <Settings className={className} style={{ color }} />
  }
  return <File className={className} style={{ color }} />
}

export function extensionColor(name: string): string {
  return EXTENSION_COLORS[extensionOf(name)] ?? ''
}
