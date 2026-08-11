/**
 * Reflow: join lines that were hard-wrapped, keep the paragraphs.
 *
 * Text copied out of a browser or PDF usually arrives wrapped at whatever width
 * the source happened to be, with a real newline at the end of every visual
 * line. Pasted into an editor that wraps by itself, the result is ragged.
 *
 * The transform joins those lines back into single paragraphs while preserving
 * the structure that carries meaning. What it must never do is flatten things
 * where a line break *is* the content — that would turn a list into a sentence
 * and corrupt code.
 */

/** Lines that stand alone and must never absorb the line after them. */
function isAtomic(trimmed: string): boolean {
  return (
    /^#{1,6}\s/.test(trimmed) ||        // ATX heading
    /^([-*_])\s*(\1\s*){2,}$/.test(trimmed) || // horizontal rule
    /^\|.*\|?$/.test(trimmed) ||        // table row
    /^(-{3,}|={3,})$/.test(trimmed)     // setext underline or front-matter fence
  )
}

/** Lines that begin a block and *may* absorb wrapped continuations. */
function isBlockStart(trimmed: string): boolean {
  return (
    /^[-*+]\s+/.test(trimmed) ||        // bullet list
    /^\d+[.)]\s+/.test(trimmed) ||      // ordered list
    /^>\s?/.test(trimmed)               // blockquote
  )
}

function isFence(trimmed: string): boolean {
  return /^(```|~~~)/.test(trimmed)
}

/**
 * Joins two fragments.
 *
 * A trailing hyphen keeps its hyphen and loses the space: "state-" + "of-the-art"
 * gives "state-of-the-art". Dropping the hyphen instead would repair words split
 * across lines but mangle genuine compounds, and there is no way to tell them
 * apart without a dictionary — so the safe option wins.
 */
function join(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  return /-$/.test(left) ? left + right : `${left} ${right}`
}

export function reflowText(input: string): string {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para = ''
  let inFence = false

  const flush = () => {
    if (para) out.push(para)
    para = ''
  }

  for (const raw of lines) {
    const trimmed = raw.trim()

    if (isFence(trimmed)) {
      flush()
      out.push(raw)
      inFence = !inFence
      continue
    }
    // Inside a fenced block every line is content; leave it exactly as it is.
    if (inFence) {
      out.push(raw)
      continue
    }
    // A deeply indented line starting a block is left alone. Indented code is
    // disabled in the editor's Markdown, but pasted text may still contain
    // deliberately indented material worth preserving.
    if (!para && /^(\t| {4,})\S/.test(raw)) {
      flush()
      out.push(raw)
      continue
    }

    if (trimmed === '') {
      flush()
      out.push('')
      continue
    }
    if (isAtomic(trimmed)) {
      flush()
      out.push(raw.trimEnd())
      continue
    }
    if (isBlockStart(trimmed)) {
      flush()
      para = raw.trimEnd()
      continue
    }
    para = join(para, trimmed)
  }
  flush()

  // Never leave more than one blank line between paragraphs.
  const collapsed: string[] = []
  for (const line of out) {
    if (line === '' && collapsed[collapsed.length - 1] === '') continue
    collapsed.push(line)
  }
  return collapsed.join('\n')
}
