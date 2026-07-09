import dayjs from 'dayjs'

/**
 * Generate task name(s) for new review tasks.
 *
 * Format: `{typeLabel}-{yyyyMMdd-HHmmss}-{XXXX}`
 *   - typeLabel: 1-3 chars in `TYPE_LABELS` (e.g. "图片", "文本")
 *   - timestamp: second-precision to avoid collisions in bulk creates
 *   - XXXX: 4-char uppercase hex random suffix
 *
 * For bulk creation the same base is reused with a `-NN` suffix:
 *   图片-20260709-143012-A7F3-01
 *   图片-20260709-143012-A7F3-02
 *
 * Pure function (no side effects, no dayjs.locale side effects); safe to call
 * during render. The caller is expected to invoke once per render and cache
 * the result for the lifetime of the create-page session — the random suffix
 * is generated once at module-init to keep batch siblings aligned.
 */

const SUFFIX_LEN = 4

function randomSuffix(): string {
  // toString(16) gives hex; slice(2,) drops the "0." prefix; uppercase for readability
  return Math.random().toString(16).slice(2, 2 + SUFFIX_LEN).toUpperCase().padEnd(SUFFIX_LEN, '0')
}

export interface GenerateTaskNameOptions {
  /** 中文素材类型 label, e.g. "图片" / "文本" / "视频" */
  typeLabel: string
  /** 任务总数. 1 = 单件; >=1 = 批量（会生成同 base + -NN 后缀） */
  count: number
  /** 可选：传入以保证同一批次任务名稳定（避免每次 render 重抽随机后缀） */
  sharedSuffix?: string
  /** 可选：覆盖时间戳（默认 now）。便于单测 */
  now?: Date
}

export interface GeneratedTaskName {
  /** 共享 base（去掉 -NN 后缀的部分） */
  base: string
  /** 每个任务的完整名字 */
  items: string[]
}

export function generateTaskName(opts: GenerateTaskNameOptions): GeneratedTaskName {
  const { typeLabel, count, sharedSuffix, now = new Date() } = opts
  const safeLabel = (typeLabel || '素材').slice(0, 8)
  const ts = dayjs(now).format('YYYYMMDD-HHmmss')
  const suffix = sharedSuffix ?? randomSuffix()
  const base = `${safeLabel}-${ts}-${suffix}`

  const total = Math.max(1, Math.floor(count))
  const items: string[] = []
  for (let i = 0; i < total; i++) {
    items.push(total > 1 ? `${base}-${String(i + 1).padStart(2, '0')}` : base)
  }
  return { base, items }
}

/** Strip the trailing -NN suffix so callers can re-render a fresh preview
 *  when the count changes (avoids orphan suffixes sticking to the base). */
export function sharedBase(name: string): string {
  return name.replace(/-\d{2}$/, '')
}