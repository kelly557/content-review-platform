import * as XLSX from 'xlsx'

import type { AuditPointRisk } from '@/types/domain'

export interface ParsedImportRow {
  label_cn: string
  scope_text: string
  medium_threshold: string
  high_threshold: string
}

export interface ParseResult {
  rows: ParsedImportRow[]
  errors: string[]
}

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

const RISK_SET = new Set<AuditPointRisk>(['低风险', '中风险', '高风险'])

const COL_LABELS = {
  label_cn: ['审核点', 'label_cn', 'label'],
  scope_text: ['审核内容', 'scope_text', 'scope'],
  medium_threshold: ['中风险分', 'medium_threshold'],
  high_threshold: ['高风险分', 'high_threshold'],
} as const

function normalizeCell(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function pickColumnIndex(
  headers: string[],
  candidates: readonly string[],
): number {
  const lower = headers.map((h) => normalizeCell(h).toLowerCase())
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c === '')
}

function buildLine(row: ParsedImportRow): string {
  return `${row.label_cn} | ${row.scope_text} | ${row.medium_threshold} | ${row.high_threshold}`
}

function rowFromDelimitedCells(cells: string[]): ParsedImportRow | null {
  if (isBlankRow(cells)) return null
  return {
    label_cn: cells[0] ?? '',
    scope_text: cells[1] ?? '',
    medium_threshold: cells[2] ?? '',
    high_threshold: cells[3] ?? '',
  }
}

function filterValid(rows: ParsedImportRow[]): ParsedImportRow[] {
  return rows.filter((r) => r.label_cn !== '')
}

export async function parseImportFile(file: File): Promise<ParseResult> {
  if (file.size === 0) {
    return { rows: [], errors: ['文件为空'] }
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { rows: [], errors: [`文件超过 ${Math.floor(MAX_IMPORT_BYTES / 1024)}KB 上限`] }
  }
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseXlsx(file)
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseDelimited(file)
  return { rows: [], errors: ['仅支持 .txt / .csv / .xlsx 文件'] }
}

async function parseXlsx(file: File): Promise<ParseResult> {
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const firstName = wb.SheetNames[0]
    if (!firstName) return { rows: [], errors: ['xlsx 没有可用工作表'] }
    const sheet = wb.Sheets[firstName]
    const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    }) as unknown as string[][]
    if (aoa.length === 0) return { rows: [], errors: ['xlsx 没有可用工作表'] }

    const headers = (aoa[0] ?? []).map(normalizeCell)
    const idxMap: Record<keyof typeof COL_LABELS, number> = {
      label_cn: pickColumnIndex(headers, COL_LABELS.label_cn),
      scope_text: pickColumnIndex(headers, COL_LABELS.scope_text),
      medium_threshold: pickColumnIndex(headers, COL_LABELS.medium_threshold),
      high_threshold: pickColumnIndex(headers, COL_LABELS.high_threshold),
    }
    const missing: string[] = []
    if (idxMap.label_cn < 0) missing.push('审核点')
    if (idxMap.scope_text < 0) missing.push('审核内容')
    if (idxMap.medium_threshold < 0) missing.push('中风险分')
    if (idxMap.high_threshold < 0) missing.push('高风险分')
    if (missing.length > 0) {
      return { rows: [], errors: [`xlsx 首行缺少必填列：${missing.join('、')}`] }
    }

    const rows: ParsedImportRow[] = []
    for (let i = 1; i < aoa.length; i += 1) {
      const cells = (aoa[i] ?? []).map(normalizeCell)
      const r = rowFromDelimitedCells(cells)
      if (r) rows.push(r)
    }
    const valid = filterValid(rows)
    if (valid.length === 0) return { rows: [], errors: ['xlsx 没有有效数据行'] }
    return { rows: valid, errors: [] }
  } catch (e) {
    return { rows: [], errors: ['xlsx 解析失败：' + (e as Error).message] }
  }
}

async function parseDelimited(file: File): Promise<ParseResult> {
  try {
    const raw = await file.text()
    if (!raw.trim()) return { rows: [], errors: ['文件为空'] }
    const lines = raw.split(/\r?\n/)
    const sample = lines.find((l) => l.trim()) ?? ''
    const candidates = ['|', '\t', ',', ';']
    let sep = '|'
    let bestCount = -1
    for (const c of candidates) {
      const n = sample.split(c).length - 1
      if (n > bestCount) {
        bestCount = n
        sep = c
      }
    }
    if (bestCount < 1) {
      return { rows: [], errors: ['文件未识别出分隔符（| / Tab / , / ;）'] }
    }

    const rows: ParsedImportRow[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('#')) continue
      const cells = trimmed.split(sep).map((s) => s.trim())
      const r = rowFromDelimitedCells(cells)
      if (r) rows.push(r)
    }
    const valid = filterValid(rows)
    if (valid.length === 0) return { rows: [], errors: ['文件没有有效数据行'] }
    return { rows: valid, errors: [] }
  } catch (e) {
    return { rows: [], errors: ['文件解析失败：' + (e as Error).message] }
  }
}

export function rowsToText(rows: ParsedImportRow[]): string {
  return rows.map(buildLine).join('\n')
}

export function isKnownRisk(r: string): r is AuditPointRisk {
  return RISK_SET.has(r as AuditPointRisk)
}
