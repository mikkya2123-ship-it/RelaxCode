import { useEffect, useRef, type JSX } from 'react'
import MonacoEditor, { type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditorApi } from 'monaco-editor'
import { useEditorStore } from '@/stores/editor'
import { useSettingsStore } from '@/stores/settings'
import { useT } from '@/lib/i18n'
import { resolveTheme } from '@/lib/appearance'
import { EDITOR_FONT_FAMILY, editorThemeName } from '@/lib/monaco-setup'

export default function EditorPaneInner(): JSX.Element {
  const files = useEditorStore((s) => s.files)
  const activePath = useEditorStore((s) => s.activePath)
  const active = files.find((file) => file.path === activePath)
  const editor = useSettingsStore((s) => s.settings?.editor)
  const theme = useSettingsStore((s) => s.settings?.ui.theme ?? 'light')
  const autoSave = editor?.autoSave ?? 'off'
  const autoSaveDelay = editor?.autoSaveDelayMs ?? 1200
  const t = useT()
  const instance = useRef<Parameters<OnMount>[0] | null>(null)

  /** Writes every buffer that changed since the last save. */
  const saveDirty = (): void => {
    const store = useEditorStore.getState()
    for (const file of store.files) {
      if (file.content !== file.savedContent) void store.saveFile(file.path)
    }
  }

  useEffect(() => {
    if (autoSave === 'onFocusChange') {
      const onBlur = (): void => saveDirty()
      window.addEventListener('blur', onBlur)
      return () => window.removeEventListener('blur', onBlur)
    }
    if (autoSave !== 'afterDelay') return
    const timer = window.setInterval(() => {
      const store = useEditorStore.getState()
      const file = store.files.find((item) => item.path === store.activePath)
      if (file && file.content !== file.savedContent) void store.saveFile(file.path)
    }, Math.max(300, autoSaveDelay))
    return () => window.clearInterval(timer)
  }, [autoSave, autoSaveDelay])

  if (!active) {
    return <div className="h-full bg-card" />
  }

  const handleMount: OnMount = (editorInstance, monaco) => {
    instance.current = editorInstance
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void useEditorStore.getState().saveActive()
    })
    editorInstance.focus()
  }

  const options: MonacoEditorApi.IStandaloneEditorConstructionOptions = {
    fontSize: editor?.fontSize ?? 13,
    fontFamily: editor?.fontFamily?.trim() || EDITOR_FONT_FAMILY,
    fontLigatures: editor?.fontLigatures ?? true,
    lineHeight: editor?.lineHeight ?? 0,
    minimap: { enabled: editor?.minimap ?? false },
    scrollBeyondLastLine: editor?.scrollBeyondLastLine ?? false,
    renderLineHighlight: editor?.renderLineHighlight ?? 'line',
    automaticLayout: true,
    wordWrap: editor?.wordWrap ? 'on' : 'off',
    padding: { top: editor?.padding ?? 10, bottom: editor?.padding ?? 10 },
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false
    },
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    guides: { indentation: editor?.indentGuides ?? true, highlightActiveIndentation: false },
    stickyScroll: { enabled: editor?.stickyScroll ?? false },
    smoothScrolling: editor?.smoothScrolling ?? true,
    cursorSmoothCaretAnimation: 'off',
    cursorBlinking: editor?.cursorBlinking ?? 'blink',
    lineNumbersMinChars: 3,
    glyphMargin: editor?.glyphMargin ?? false,
    foldingHighlight: false,
    renderWhitespace: editor?.renderWhitespace ?? 'selection',
    lineNumbers: editor?.lineNumbers ?? 'on',
    tabSize: editor?.tabSize ?? 2,
    insertSpaces: editor?.insertSpaces ?? true,
    bracketPairColorization: { enabled: editor?.bracketPairColorization ?? false }
  }

  return (
    <MonacoEditor
      path={active.path}
      language={active.language}
      value={active.content}
      theme={editorThemeName(resolveTheme(theme))}
      onChange={(value) => useEditorStore.getState().updateContent(active.path, value ?? '')}
      onMount={handleMount}
      loading={
        <div className="flex h-full items-center justify-center bg-card text-xs text-tertiary">
          {t('editor.loading')}
        </div>
      }
      options={options}
    />
  )
}
