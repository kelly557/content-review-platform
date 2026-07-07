export interface ParsedWords {
  words: string[]
}

export interface ParsedPairs {
  pairs: Array<{ trigger: string; reply: string }>
}

export interface ParseError {
  errors: string[]
}

export type ParseLibFileResult =
  | (ParsedWords & ParseError)
  | (ParsedPairs & ParseError)

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

function normalize(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

async function readText(file: File): Promise<string | { error: string }> {
  if (file.size === 0) return { error: '文件为空' }
  if (file.size > MAX_IMPORT_BYTES) {
    return { error: `文件超过 ${Math.floor(MAX_IMPORT_BYTES / 1024)}KB 上限` }
  }
  const name = file.name.toLowerCase()
  if (!name.endsWith('.txt') && !name.endsWith('.csv')) {
    return { error: '仅支持 .txt / .csv 文件' }
  }
  try {
    const buf = await file.arrayBuffer()
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      try {
        text = new TextDecoder('gbk').decode(buf)
      } catch {
        return { error: '文件编码不支持,请使用 UTF-8 或 GBK 编码' }
      }
    }
    return text
  } catch (e) {
    return { error: '文件读取失败：' + (e as Error).message }
  }
}

function dedupeWords(words: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

function dedupePairs(
  pairs: Array<{ trigger: string; reply: string }>,
): Array<{ trigger: string; reply: string }> {
  const seen = new Set<string>()
  const out: Array<{ trigger: string; reply: string }> = []
  for (const p of pairs) {
    const k = `${p.trigger}|||${p.reply}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

/** 词库：每行一词。.csv 用逗号分隔多个。 */
export async function parseWordsFile(file: File): Promise<ParsedWords & ParseError> {
  const result = await readText(file)
  if (typeof result !== 'string') return { words: [], errors: [result.error] }

  const text = result
  const words: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    for (const cell of line.split(',')) {
      const w = cell.trim()
      if (w) words.push(w)
    }
  }
  if (words.length === 0)
    return { words: [], errors: ['文件没有有效词'] }
  return { words: dedupeWords(words), errors: [] }
}

/** 代答：每行 `trigger<sep>reply` 其中 <sep> 是空格(任意连续空白)
 * 或单个全角 '｜' (U+FF5C)。
 */
export async function parseReplyFile(
  file: File,
): Promise<ParsedPairs & ParseError> {
  const result = await readText(file)
  if (typeof result !== 'string') return { pairs: [], errors: [result.error] }

  const text = result
  const pairs: Array<{ trigger: string; reply: string }> = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    let t = ''
    let r = ''
    const wideSep = '｜'
    const widx = line.indexOf(wideSep)
    if (widx > 0) {
      t = line.slice(0, widx).trim()
      r = line.slice(widx + wideSep.length).trim()
    } else {
      const parts = line.split(/\s+/, 2)
      if (parts.length >= 2) {
        t = parts[0].trim()
        r = parts[1].trim()
      }
    }
    if (!t || !r) {
      errors.push(`第 ${i + 1} 行无法解析,确认用空格或 '｜' 分隔`)
      continue
    }
    pairs.push({ trigger: t, reply: r })
  }
  if (pairs.length === 0) {
    return {
      pairs: [],
      errors: errors.length ? errors : ['文件没有有效的触发词/回复对'],
    }
  }
  return { pairs: dedupePairs(pairs), errors }
}

void normalize
