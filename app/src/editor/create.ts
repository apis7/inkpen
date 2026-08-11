/** CodeMirror instance factory and extension assembly. */

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'

import { linkClickHandler, markdownDecorations } from './markdown-decorations'
import { mathPlugin } from './math'
import { themeExtensions } from './theme'
import { smartListContinuation } from './list-continuation'

/** Reconfigurable slots — flipped at runtime without rebuilding the editor. */
export const compartments = {
  language: new Compartment(),
  markdown: new Compartment(),
  lineNumbers: new Compartment(),
  wrap: new Compartment(),
  readOnly: new Compartment(),
  vim: new Compartment(),
  indent: new Compartment(),
  spellcheck: new Compartment(),
  whitespace: new Compartment(),
  typewriter: new Compartment(),
}

/**
 * Typewriter scrolling: hold the active line at a fixed height on screen so the
 * eye never has to track down the page.
 *
 * Only reacts to cursor movement and edits, never to plain scrolling — otherwise
 * dragging the scrollbar would fight the user by yanking the view back.
 */
export const typewriterScrolling = EditorView.updateListener.of((update) => {
  if (!update.docChanged && !update.selectionSet) return
  const head = update.state.selection.main.head
  update.view.dispatch({
    effects: EditorView.scrollIntoView(head, { y: 'center' }),
  })
})

/**
 * Markdown treats four spaces or a tab at the start of a line as a code block.
 * Correct CommonMark, wrong for a writing tool: pressing Tab to indent a
 * paragraph silently turned it into monospaced code. Fenced blocks still work,
 * and they are how anyone actually writes code in Markdown.
 */
const NoIndentedCode = { remove: ['CodeBlock'] }

async function languageSupport(language: string): Promise<Extension> {
  if (language === 'markdown') {
    return markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: false,
      extensions: [NoIndentedCode],
    })
  }
  if (language === 'ini') {
    // No dedicated package; the stream parser is plenty for section files.
    const { StreamLanguage: SL } = await import('@codemirror/language')
    const { properties } = await import('@codemirror/legacy-modes/mode/properties')
    return SL.define(properties)
  }
  const desc = languages.find(
    (l) => l.name.toLowerCase() === language || l.alias.includes(language),
  )
  if (!desc) return []
  const support = await desc.load()
  return support
}

export interface CreateOptions {
  parent: HTMLElement
  doc: string
  language: string
  fastMode: boolean
  readOnly: boolean
  lineNumbers: boolean
  wordWrap: boolean
  indentSize: number
  indentWithTabs: boolean
  spellcheck: boolean
  vimMode: boolean
  showWhitespace: boolean
  typewriter: boolean
  onChange: (changes: import('@codemirror/state').ChangeSet, doc: string) => void
  onSelectionChange: () => void
}

export function createEditor(opts: CreateOptions): EditorView {
  const base: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    search({ top: true }),
    EditorState.allowMultipleSelections.of(true),

    compartments.lineNumbers.of(opts.lineNumbers ? [lineNumbers(), foldGutter()] : []),
    compartments.wrap.of(opts.wordWrap ? EditorView.lineWrapping : []),
    compartments.readOnly.of(EditorState.readOnly.of(opts.readOnly)),
    // Vim loads lazily — it is a large chunk for a feature that is off by
    // default, and it must not sit on the cold-start path.
    compartments.vim.of([]),
    compartments.indent.of(
      indentUnit.of(opts.indentWithTabs ? '\t' : ' '.repeat(opts.indentSize)),
    ),
    compartments.whitespace.of(opts.showWhitespace ? highlightWhitespace() : []),
    compartments.typewriter.of(opts.typewriter ? typewriterScrolling : []),
    compartments.spellcheck.of(
      EditorView.contentAttributes.of({
        spellcheck: String(opts.spellcheck && !opts.fastMode),
        autocorrect: 'off',
        autocapitalize: 'off',
      }),
    ),

    keymap.of([
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),

    ...themeExtensions,

    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange(update.changes, update.state.doc.toString())
      if (update.selectionSet || update.docChanged) opts.onSelectionChange()
    }),
  ]

  // Fast mode strips everything that needs a syntax tree. See ARCHITECTURE §9.
  if (opts.fastMode) {
    base.push(compartments.language.of([]), compartments.markdown.of([]))
  } else {
    base.push(
      compartments.language.of([]),
      compartments.markdown.of(
        opts.language === 'markdown'
          ? [markdownDecorations, mathPlugin, linkClickHandler, smartListContinuation]
          : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })],
      ),
    )
  }

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.doc, extensions: base }),
  })

  if (!opts.fastMode) {
    // Language packages load lazily so they never sit on the cold-start path.
    void languageSupport(opts.language).then((support) => {
      view.dispatch({ effects: compartments.language.reconfigure(support) })
    })
  }

  if (opts.vimMode) void setVimMode(view, true)

  return view
}

export async function setVimMode(view: EditorView, enabled: boolean) {
  const ext = enabled ? (await import('@replit/codemirror-vim')).vim() : []
  view.dispatch({ effects: compartments.vim.reconfigure(ext) })
}

export interface LiveSettings {
  lineNumbers: boolean
  wordWrap: boolean
  showWhitespace: boolean
  indentSize: number
  indentWithTabs: boolean
  spellcheck: boolean
  typewriter: boolean
  vimMode: boolean
}

/**
 * Pushes changed settings into an already-open editor.
 *
 * Compartments were being configured once at construction and never touched
 * again, so toggling word wrap or line numbers did nothing until a new tab was
 * opened — while the Settings panel claimed changes apply immediately.
 *
 * Fast mode deliberately ignores most of this: its whole point is that the
 * expensive extensions stay off.
 */
export function applyLiveSettings(view: EditorView, s: LiveSettings, fastMode: boolean) {
  view.dispatch({
    effects: [
      compartments.lineNumbers.reconfigure(s.lineNumbers ? [lineNumbers(), foldGutter()] : []),
      compartments.wrap.reconfigure(s.wordWrap ? EditorView.lineWrapping : []),
      compartments.indent.reconfigure(
        indentUnit.of(s.indentWithTabs ? '\t' : ' '.repeat(s.indentSize)),
      ),
      compartments.spellcheck.reconfigure(
        EditorView.contentAttributes.of({
          spellcheck: String(s.spellcheck && !fastMode),
          autocorrect: 'off',
          autocapitalize: 'off',
        }),
      ),
      compartments.whitespace.reconfigure(
        s.showWhitespace && !fastMode ? highlightWhitespace() : [],
      ),
      compartments.typewriter.reconfigure(s.typewriter ? typewriterScrolling : []),
    ],
  })
  // Vim loads lazily, so it reconfigures on its own schedule.
  void setVimMode(view, s.vimMode && !fastMode)
}

export { undo, redo, StreamLanguage }
