import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

monaco.editor.defineTheme('relaxcode-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '9a9a9f', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8a5fb0' },
    { token: 'string', foreground: '5f8a5f' },
    { token: 'number', foreground: 'a05252' },
    { token: 'type', foreground: '4a7db8' },
    { token: 'type.identifier', foreground: '4a7db8' },
    { token: 'identifier', foreground: '1c1c1e' },
    { token: 'delimiter', foreground: '6e6e73' },
    { token: 'tag', foreground: '4a7db8' },
    { token: 'attribute.name', foreground: '8a5fb0' },
    { token: 'attribute.value', foreground: '5f8a5f' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1c1c1e',
    'editor.lineHighlightBackground': '#f7f7f8',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#c6c6ca',
    'editorLineNumber.activeForeground': '#6e6e73',
    'editorCursor.foreground': '#1c1c1e',
    'editor.selectionBackground': '#e4e4ea',
    'editor.inactiveSelectionBackground': '#eeeef2',
    'editorIndentGuide.background1': '#f0f0f2',
    'editorIndentGuide.activeBackground1': '#e0e0e4',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#e6e6e8',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#e6e6e8',
    'editorSuggestWidget.selectedBackground': '#f0f0f2',
    'editorHoverWidget.background': '#ffffff',
    'editorHoverWidget.border': '#e6e6e8',
    'editorBracketMatch.background': '#00000000',
    'editorBracketMatch.border': '#c9c9ce',
    'editorGutter.background': '#ffffff',
    'editorOverviewRuler.border': '#00000000',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#00000018',
    'scrollbarSlider.hoverBackground': '#00000028',
    'scrollbarSlider.activeBackground': '#00000030',
    'minimap.background': '#ffffff',
    'editor.findMatchBackground': '#e8e0b8',
    'editor.findMatchHighlightBackground': '#f0ecd8',
    'editorError.foreground': '#d94f4f',
    'editorWarning.foreground': '#c98a00',
    'editorInfo.foreground': '#4a7db8'
  }
})

monaco.editor.defineTheme('relaxcode-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6f6f7a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c39bf0' },
    { token: 'string', foreground: '9ecf9e' },
    { token: 'number', foreground: 'e8a598' },
    { token: 'type', foreground: '8ab6f0' },
    { token: 'type.identifier', foreground: '8ab6f0' },
    { token: 'identifier', foreground: 'e4e4ea' },
    { token: 'delimiter', foreground: '9a9aa2' },
    { token: 'tag', foreground: '8ab6f0' },
    { token: 'attribute.name', foreground: 'c39bf0' },
    { token: 'attribute.value', foreground: '9ecf9e' }
  ],
  colors: {
    'editor.background': '#1d1d21',
    'editor.foreground': '#e4e4ea',
    'editor.lineHighlightBackground': '#26262c',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#4c4c56',
    'editorLineNumber.activeForeground': '#9a9aa2',
    'editorCursor.foreground': '#e4e4ea',
    'editor.selectionBackground': '#3b3b48',
    'editor.inactiveSelectionBackground': '#31313b',
    'editorIndentGuide.background1': '#2a2a32',
    'editorIndentGuide.activeBackground1': '#3c3c46',
    'editorWidget.background': '#212126',
    'editorWidget.border': '#33333a',
    'editorSuggestWidget.background': '#212126',
    'editorSuggestWidget.border': '#33333a',
    'editorSuggestWidget.selectedBackground': '#2e2e36',
    'editorHoverWidget.background': '#212126',
    'editorHoverWidget.border': '#33333a',
    'editorBracketMatch.background': '#00000000',
    'editorBracketMatch.border': '#565662',
    'editorGutter.background': '#1d1d21',
    'editorOverviewRuler.border': '#00000000',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#ffffff14',
    'scrollbarSlider.hoverBackground': '#ffffff22',
    'scrollbarSlider.activeBackground': '#ffffff2e',
    'minimap.background': '#1d1d21',
    'editor.findMatchBackground': '#5b5320',
    'editor.findMatchHighlightBackground': '#3f3a1c',
    'editorError.foreground': '#ff6b6b',
    'editorWarning.foreground': '#e0b055',
    'editorInfo.foreground': '#8ab6f0'
  }
})

loader.config({ monaco })

/** Picks the Monaco theme that matches the interface theme. */
export function editorThemeName(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? 'relaxcode-dark' : 'relaxcode-light'
}

const ts = monaco.typescript
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.ReactJSX,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  strict: true
})
ts.javascriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.ReactJSX,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  strict: true
})
ts.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false
})
ts.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false
})

export const EDITOR_FONT_FAMILY =
  "'Cascadia Code', 'Cascadia Mono', Consolas, 'JetBrains Mono', 'Courier New', monospace"
