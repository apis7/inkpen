import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/**
 * Everything resolves through CSS custom properties, so switching theme is a
 * single attribute flip on `<html>` — no editor reconfiguration, no reflow.
 */
export const inkTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--bg)',
    color: 'var(--fg)',
    fontFamily: 'var(--prose)',
    fontSize: 'var(--ed-size)',
  },
  '&.cm-focused': { outline: 'none' },

  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'var(--ed-lh)',
    overflow: 'auto',
  },

  '.cm-content': {
    padding: '12px 24px 40vh 0',
    caretColor: 'var(--accent)',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  },

  /* Wrapped continuation lines indent to the wrapped line's text, so lists and
     quotes stay visually aligned instead of falling back to column zero. */
  '.cm-line': { padding: '0 0 0 6px' },

  '.cm-cursor, .cm-dropCursor': {
    borderLeft: '2px solid var(--accent)',
    borderRadius: '1px',
  },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },

  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--fg-faint)',
    border: 'none',
    fontFamily: 'var(--mono)',
    fontSize: '12px',
    minWidth: '52px',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 8px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
  '.cm-foldGutter .cm-gutterElement': { opacity: 0, transition: 'opacity 0.12s ease' },
  '.cm-gutters:hover .cm-foldGutter .cm-gutterElement': { opacity: 1 },

  '.cm-selectionMatch': { backgroundColor: 'transparent', textDecoration: 'underline' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: '1px solid var(--fg-faint)',
  },

  '.cm-panels': {
    backgroundColor: 'var(--chrome-bg)',
    color: 'var(--fg)',
    border: 'none',
    fontFamily: 'var(--ui)',
    fontSize: '12.5px',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 10px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    fontFamily: 'var(--ui)',
    fontSize: '12.5px',
  },
  '.cm-panel.cm-search input': {
    background: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '3px 7px',
    userSelect: 'text',
  },
  '.cm-panel.cm-search button': {
    background: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '3px 9px',
    cursor: 'pointer',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
  },

  '.cm-tooltip': {
    background: 'var(--chrome-bg)',
    border: '1px solid var(--border)',
    borderRadius: '7px',
    boxShadow: 'var(--shadow-pop)',
  },

  '.cm-scroller::-webkit-scrollbar': { width: '10px', height: '10px' },
  '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: 'var(--fg-faint)',
    borderRadius: '5px',
    border: '3px solid transparent',
    backgroundClip: 'content-box',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: 'var(--fg-muted)',
    backgroundClip: 'content-box',
  },
})

/**
 * Syntax colour for code blocks and non-Markdown files.
 *
 * Markdown headings are deliberately absent: they differentiate by size and
 * weight only. Coloured headings read as noise in a writing tool.
 */
export const inkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.modifier, t.controlKeyword], color: 'var(--kw)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--str)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--fn)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--num)' },
  { tag: [t.typeName, t.className, t.namespace, t.annotation], color: 'var(--typ)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--cmt)', fontStyle: 'italic' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--fn)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--fg)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--fg-muted)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--fg-muted)' },
  { tag: t.invalid, color: 'var(--error)' },
])

export const themeExtensions = [inkTheme, syntaxHighlighting(inkHighlight)]
