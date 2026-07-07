import type { LibraryBatchItemPayload, LibraryKind } from '@/types/domain'

export interface ParseLibraryFileResult {
  rows: LibraryBatchItemPayload[]
  errors: string[]
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

function normalize(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function splitTabs(line: string): string[] {
  return line.split(/\t/).map((s) => s.trim())
}

/** Parse a single .txt / .csv line into LibraryBatchItemPayload or null.
 *
 * Formats accepted:
 *   1. code<TAB>name<TAB>items (csv/tsv)
 *   2. code<TAB>name<TAB>items_csv (items comma separated)
 *
 * When `kind` is given, applies to all rows. `defaultGroupId` resolves
 * when the row didn't specify.
 */
export function parseLibraryLine(
  line: string,
  idx: number,
  kind: LibraryKind,
  defaultGroupId?: number,
): { row: LibraryBatchItemPayload | null; error: string | null } {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return { row: null, error: null }
  const cells = splitTabs(trimmed)
  if (cells.length < 2) {
    return {
      row: null,
      error: `第 ${idx + 1} 行格式应为 code<TAB>name<TAB>items`,
    }
  }
  const [code, name, itemsRaw] = cells
  if (!code || !name) {
    return { row: null, error: `第 ${idx + 1} 行 code/name 不能为空` }
  }
  let words: string[] | undefined
  if (itemsRaw) {
    if (kind === 'reply') {
      words = [itemsRaw]
    } else {
      words = itemsRaw
        .split(/[,，;；]/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }
  return {
    row: {
      code,
      name,
      library_type: kind,
      words,
      group_id: defaultGroupId ?? null,
    },
    error: null,
  }
}

export async function parseLibraryFile(
  file: File,
  kind: LibraryKind,
  defaultGroupId?: number,
): Promise<ParseLibraryFileResult> {
  if (file.size === 0) return { rows: [], errors: ['文件为空'] }
  if (file.size > MAX_IMPORT_BYTES) {
    return { rows: [], errors: [`文件超过 ${MAX_IMPORT_BYTES / 1024}KB 上限`] }
  }
  const name = file.name.toLowerCase()
  if (
    !name.endsWith('.txt') &&
    !name.endsWith('.csv') &&
    !name.endsWith('.tsv')
  ) {
    return { rows: [], errors: ['仅支持 .txt / .csv / .tsv 文件'] }
  }
  let raw: string
  try {
    raw = await file.text()
  } catch (e) {
    return {
      rows: [],
      errors: ['文件读取失败：' + (e as Error).message],
    }
  }
  if (!raw.trim()) return { rows: [], errors: ['文件为空'] }

  const lines = raw.split(/\r?\n/)
  const rows: LibraryBatchItemPayload[] = []
  const errors: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const r = parseLibraryLine(lines[i], i, kind, defaultGroupId)
    if (r.error) errors.push(r.error)
    if (r.row) rows.push(r.row)
  }
  const seen = new Set<string>()
  const dedupRows = rows.filter((row) => {
    if (seen.has(row.code)) return false
    seen.add(row.code)
    return true
  })
  if (dedupRows.length === 0) {
    return {
      rows: [],
      errors: errors.length > 0 ? errors : ['文件没有有效行'],
    }
  }
  return { rows: dedupRows, errors }
}

export function rowsToText(rows: LibraryBatchItemPayload[]): string {
  return rows
    .map((r) => `${r.code}\t${r.name}\t${(r.words ?? []).join(',')}`)
    .join('\n')
}

/** Generate up to N sequential payloads sharing a prefix. */
export function generateByPrefix(
  prefix: string,
  count: number,
  kind: LibraryKind,
  defaultGroupId?: number,
): LibraryBatchItemPayload[] {
  const safeCount = Math.max(1, Math.min(count, 50))
  const out: LibraryBatchItemPayload[] = []
  for (let i = 1; i <= safeCount; i += 1) {
    out.push({
      code: `${prefix}${i}`,
      name: `${prefix}${i}`,
      library_type: kind,
      group_id: defaultGroupId ?? null,
      words: [],
    })
  }
  return out
}

// avoid unused-import lint when normalize is not directly used
void normalize
