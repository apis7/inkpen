/**
 * Recovery journal — frontend half.
 *
 * Rust owns durability; this owns batching and replay. CodeMirror change specs
 * are UTF-16 offsets into a JavaScript string, so they are replayed here, in the
 * coordinate system that produced them, rather than reimplemented in Rust.
 *
 * Writes are fire-and-forget: nothing on the keystroke path awaits the backend.
 */

import type { ChangeSet } from '@codemirror/state'
import * as ipc from '../ipc'
import type { Encoding, LineEnding } from '../ipc/types'

const DEBOUNCE_MS = 250
const MAX_BATCH_BYTES = 4096
/** Compact after this many change records, so replay never grows unbounded. */
const COMPACT_EVERY = 200

export interface JournalMeta {
  path: string | null
  title: string
  encoding: Encoding
  lineEnding: LineEnding
  language: string
}

type Edit = [number, number, string]

interface HeaderRecord extends JournalMeta {
  t: 'header'
  docId: string
  ts: number
}
interface ChangeRecord {
  t: 'change'
  seq: number
  ts: number
  changes: Edit[]
}
interface SnapshotRecord {
  t: 'snapshot'
  seq: number
  ts: number
  content: string
}
type Record_ = HeaderRecord | ChangeRecord | SnapshotRecord

export interface Recovered {
  docId: string
  meta: JournalMeta
  content: string
  ts: number
}

interface Entry {
  meta: JournalMeta
  seq: number
  pending: Edit[]
  pendingBytes: number
  timer?: number
  headerWritten: boolean
  /** Latest full text, so compaction can write a snapshot without a round trip. */
  latest: string
}

const entries = new Map<string, Entry>()

export function begin(docId: string, meta: JournalMeta, content: string) {
  entries.set(docId, {
    meta,
    seq: 0,
    pending: [],
    pendingBytes: 0,
    headerWritten: false,
    latest: content,
  })
}

export function updateMeta(docId: string, meta: Partial<JournalMeta>) {
  const entry = entries.get(docId)
  if (entry) Object.assign(entry.meta, meta)
}

/** Called on every editor transaction. Cheap by construction. */
export function record(docId: string, changes: ChangeSet, latest: string) {
  const entry = entries.get(docId)
  if (!entry) return

  entry.latest = latest
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString()
    entry.pending.push([fromA, toA, text])
    entry.pendingBytes += text.length + 16
  })

  if (entry.pendingBytes >= MAX_BATCH_BYTES) {
    flush(docId)
    return
  }
  clearTimeout(entry.timer)
  entry.timer = window.setTimeout(() => flush(docId), DEBOUNCE_MS)
}

function flush(docId: string) {
  const entry = entries.get(docId)
  if (!entry) return
  clearTimeout(entry.timer)
  entry.timer = undefined
  if (!entry.pending.length) return

  const batch = entry.pending
  entry.pending = []
  entry.pendingBytes = 0
  entry.seq += 1

  // Compaction: rewrite as header + snapshot rather than appending forever.
  if (entry.seq % COMPACT_EVERY === 0) {
    void compact(docId)
    return
  }

  const records: string[] = []

  if (!entry.headerWritten) {
    // First write of the session must establish a base. Replay starts from an
    // empty string, so appending only the change records would reconstruct the
    // edits *without* the text the document was opened with — silently losing
    // the file's original contents on recovery.
    //
    // `entry.latest` already includes this batch, so the snapshot supersedes it
    // and the batch is dropped rather than applied twice.
    records.push(JSON.stringify(header(docId, entry)))
    records.push(
      JSON.stringify({
        t: 'snapshot',
        seq: entry.seq,
        ts: Date.now(),
        content: entry.latest,
      } satisfies SnapshotRecord),
    )
    entry.headerWritten = true
  } else {
    records.push(
      JSON.stringify({ t: 'change', seq: entry.seq, ts: Date.now(), changes: batch } satisfies ChangeRecord),
    )
  }

  for (const record of records) {
    // Deliberately not awaited — a journal write must never delay a keystroke.
    void ipc.journalAppend(docId, record).catch(() => {})
  }
}

function header(docId: string, entry: Entry): HeaderRecord {
  return { t: 'header', docId, ts: Date.now(), ...entry.meta }
}

async function compact(docId: string) {
  const entry = entries.get(docId)
  if (!entry) return
  const records = [
    JSON.stringify(header(docId, entry)),
    JSON.stringify({
      t: 'snapshot',
      seq: entry.seq,
      ts: Date.now(),
      content: entry.latest,
    } satisfies SnapshotRecord),
  ]
  entry.headerWritten = true
  try {
    await ipc.journalSnapshot(docId, records)
  } catch {
    /* a failed compaction leaves the previous journal intact */
  }
}

/** After a successful save the journal has nothing left to protect. */
export async function release(docId: string) {
  const entry = entries.get(docId)
  if (entry) {
    clearTimeout(entry.timer)
    entries.delete(docId)
  }
  try {
    await ipc.journalRelease(docId)
  } catch {
    /* nothing to release */
  }
}

/** Forces buffered records out. Called on blur and before shutdown. */
export async function syncNow() {
  for (const docId of entries.keys()) flush(docId)
  try {
    await ipc.journalSync()
  } catch {
    /* best effort */
  }
}

/** Replays every journal on disk to its final text. */
export async function recoverAll(): Promise<Recovered[]> {
  let journals: { docId: string; records: string[] }[]
  try {
    journals = await ipc.journalList()
  } catch {
    return []
  }

  const out: Recovered[] = []
  for (const journal of journals) {
    const replayed = replay(journal.records)
    if (replayed) out.push({ docId: journal.docId, ...replayed })
  }
  return out
}

/** Exported for testing. Tolerates a truncated tail from a hard crash. */
export function replay(
  lines: string[],
): { meta: JournalMeta; content: string; ts: number } | null {
  let meta: JournalMeta | null = null
  let content = ''
  let ts = 0

  for (const line of lines) {
    let rec: Record_
    try {
      rec = JSON.parse(line) as Record_
    } catch {
      continue
    }

    if (rec.t === 'header') {
      meta = {
        path: rec.path,
        title: rec.title,
        encoding: rec.encoding,
        lineEnding: rec.lineEnding,
        language: rec.language,
      }
      ts = Math.max(ts, rec.ts)
    } else if (rec.t === 'snapshot') {
      content = rec.content
      ts = Math.max(ts, rec.ts)
    } else if (rec.t === 'change') {
      for (const [from, to, insert] of rec.changes) {
        // A record that cannot apply means the journal is inconsistent; stop
        // rather than silently producing corrupted text.
        if (from < 0 || to < from || to > content.length) return null
        content = content.slice(0, from) + insert + content.slice(to)
      }
      ts = Math.max(ts, rec.ts)
    }
  }

  if (!meta) return null
  return { meta, content, ts }
}
