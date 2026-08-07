/**
 * cron 表达式 → 自然语言描述器
 *
 * 覆盖业务常见 4 种可视化模式：
 *   - 每天 (daily)
 *   - 每周一/二/... (weekly)
 *   - 每月 D 日 (monthly)
 *   - 自定义原始 cron 字符串（识别不了的 fallback）
 *
 * 后端 cron 表达式字段: 分 时 日 月 周 (5 段空格分隔)
 */
export type ScheduleKind = 'daily' | 'weekly' | 'monthly' | 'custom'

export interface ScheduleDescriptor {
  kind: ScheduleKind
  /** 自然语言描述，例如 "每天 09:00" */
  human: string
  /** 原始 cron 字符串 */
  cron: string
}

const WD_NAMES = ['日', '一', '二', '三', '四', '五', '六']

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function padTime(h: number, m: number): string {
  return `${pad(h)}:${pad(m)}`
}

export function describeCron(cron: string | undefined | null): ScheduleDescriptor {
  if (!cron) {
    return { kind: 'custom', human: '—', cron: '' }
  }
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { kind: 'custom', human: cron, cron }
  }
  const [minStr, hourStr, domStr, monthStr, dowStr] = parts

  const m = parseInt(minStr, 10)
  const h = parseInt(hourStr, 10)
  if (!Number.isFinite(m) || !Number.isFinite(h)) {
    return { kind: 'custom', human: cron, cron }
  }
  const time = padTime(h, m)

  // daily: dom=* month=* dow=*
  if (domStr === '*' && monthStr === '*' && dowStr === '*') {
    return { kind: 'daily', human: `每天 ${time}`, cron }
  }

  // weekly: dow is one or more weekday numbers, dom=* month=*
  if (
    domStr === '*' &&
    monthStr === '*' &&
    dowStr !== '*' &&
    /^[0-9,]+$/.test(dowStr)
  ) {
    const days = dowStr
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((d) => d >= 0 && d <= 6)
      .sort((a, b) => a - b)
    if (days.length === 0) {
      return { kind: 'custom', human: cron, cron }
    }
    if (days.length === 7) {
      return { kind: 'daily', human: `每天 ${time}`, cron }
    }
    const names = days.map((d) => `周${WD_NAMES[d]}`).join('、')
    return { kind: 'weekly', human: `${names} ${time}`, cron }
  }

  // monthly: dom is a number, month=* dow=*
  if (
    monthStr === '*' &&
    dowStr === '*' &&
    /^\d+$/.test(domStr)
  ) {
    const d = parseInt(domStr, 10)
    if (d >= 1 && d <= 31) {
      return { kind: 'monthly', human: `每月 ${d} 日 ${time}`, cron }
    }
  }

  return { kind: 'custom', human: cron, cron }
}

/** 触发器列表 / 详情用：把 spec 字段描述成一行 */
export function describeLaunch(t: {
  trigger_type: 'cron' | 'external_callback'
  spec: Record<string, unknown>
}): string {
  if (t.trigger_type === 'external_callback') {
    return '外部通知触发'
  }
  const spec = t.spec as {
    cron?: string
    timezone?: string
  }
  const desc = describeCron(spec.cron)
  if (desc.kind === 'custom') {
    return spec.cron ? spec.cron : '—'
  }
  const tz = spec.timezone ?? 'Asia/Shanghai'
  const tzLabel = tz === 'Asia/Shanghai' ? '北京时间' : tz
  return `${desc.human}（${tzLabel}）`
}

/** 由可视化值构造 cron 表达式 */
export function buildCron(opts: {
  hour: number
  minute: number
  weekdays?: number[]
  dayOfMonth?: number
}): string {
  const m = pad(opts.minute)
  const h = pad(opts.hour)
  if (opts.weekdays && opts.weekdays.length > 0 && !opts.weekdays.every((d) => d === d)) {
    return `${m} ${h} * * ${opts.weekdays.sort((a, b) => a - b).join(',')}`
  }
  if (typeof opts.dayOfMonth === 'number' && opts.dayOfMonth >= 1 && opts.dayOfMonth <= 31) {
    return `${m} ${h} ${opts.dayOfMonth} * *`
  }
  return `${m} ${h} * * *`
}

/** 由 cron 表达式反解出可视化字段，便于回填到 SchedulePicker */
export function parseCron(cron: string): {
  hour: number
  minute: number
  weekdays?: number[]
  dayOfMonth?: number
} | null {
  const desc = describeCron(cron)
  if (desc.kind === 'custom') {
    return null
  }
  const parts = cron.trim().split(/\s+/)
  const m = parseInt(parts[0], 10)
  const h = parseInt(parts[1], 10)
  if (desc.kind === 'daily') {
    return { hour: h, minute: m }
  }
  if (desc.kind === 'weekly') {
    const wd = parts[4]
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((d) => d >= 0 && d <= 6)
    return { hour: h, minute: m, weekdays: wd }
  }
  if (desc.kind === 'monthly') {
    const dom = parseInt(parts[2], 10)
    return { hour: h, minute: m, dayOfMonth: dom }
  }
  return null
}
