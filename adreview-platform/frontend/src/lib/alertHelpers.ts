import dayjs from 'dayjs'
import type { AnomalyExtraCondition } from './anomalyThresholds'

const OPERATOR_LABEL: Record<string, string> = {
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  '=': '=',
}

export function formatOperator(op: string): string {
  return OPERATOR_LABEL[op] ?? op
}

export function formatWindow(windowStart: string, windowEnd: string): string {
  const s = dayjs(windowStart)
  const e = dayjs(windowEnd)
  const sameDay = s.format('YYYY-MM-DD') === e.format('YYYY-MM-DD')
  const minutes = Math.max(e.diff(s, 'minute'), 1)
  const durLabel = minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}min`
  if (sameDay) {
    return `${s.format('MM-DD HH:mm')} ~ ${e.format('HH:mm')} (${durLabel})`
  }
  return `${s.format('MM-DD HH:mm')} ~ ${e.format('MM-DD HH:mm')} (${durLabel})`
}

/**
 * 观测值 / 阈值 显示。
 *
 * - 百分比场景 (observed 与 threshold 都在 100 以内): 拼 "%" 后缀
 * - 整数计数场景 (两者都是整数, 且超过 100): 不带 %, 加 " / N"
 * - 默认: 2 位小数, 用 "%" 后缀
 *
 * 通过 `unit` 强制覆写单位 ('%' / 'count'). 缺省: '%' 表示百分比,
 * 'count' 表示条数.
 */
export function formatObserved(
  observed: number,
  threshold: number,
  unit?: '%' | 'count',
): string {
  // 1. 推断或使用显式 unit
  const inferredUnit: '%' | 'count' = (() => {
    if (unit) return unit
    // 启发式: 整数 + 都 >= 10 → count; 否则 → %
    if (Number.isInteger(observed) && Number.isInteger(threshold)
        && observed >= 10 && threshold >= 10) {
      return 'count'
    }
    return '%'
  })()

  const isCountUnit = inferredUnit === 'count'
  const suffix = isCountUnit ? '' : '%'

  if (isCountUnit) {
    // 整数计数: 不显示小数
    if (Number.isInteger(observed) && Number.isInteger(threshold)) {
      return `${observed}${suffix} / ${threshold}${suffix}`
    }
    return `${observed.toFixed(2)}${suffix} / ${threshold.toFixed(2)}${suffix}`
  }
  // 百分比场景
  return `${observed.toFixed(2)}${suffix} / ${threshold.toFixed(2)}${suffix}`
}

/**
 * 拼接附加条件 → 字符串, 例如 `AND 请求数 > 20 AND 账号数 > 5`.
 * 缺省 (空数组) → 返回 undefined.
 */
export function formatExtraConditions(
  conditions: AnomalyExtraCondition[] | undefined,
): string | undefined {
  if (!conditions || conditions.length === 0) return undefined
  return conditions
    .map((c) => `AND ${formatExtraField(c.field)} ${c.operator} ${c.value}`)
    .join(' ')
}

const EXTRA_FIELD_LABEL: Record<string, string> = {
  request_count: '请求数',
  account_count: '账号数',
}

function formatExtraField(value: string): string {
  return EXTRA_FIELD_LABEL[value] ?? value
}

export function formatTriggerTime(iso: string): string {
  return dayjs(iso).format('MM-DD HH:mm:ss')
}

export function formatPublicId(publicId: string): string {
  if (!publicId) return '—'
  return publicId
}

export function formatRuleCode(ruleCode: string): string {
  return ruleCode
}

export const SEVERITY_COLOR: Record<string, string> = {
  critical: 'red',
  warn: 'orange',
  info: 'blue',
}

export const SEVERITY_LABEL: Record<string, string> = {
  critical: '严重',
  warn: '提醒',
  info: '提示',
}

export function formatSeverity(value: string): { color: string; label: string } {
  return {
    color: SEVERITY_COLOR[value] ?? 'default',
    label: SEVERITY_LABEL[value] ?? value,
  }
}

export const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  acknowledged: '已确认',
}

export function formatStatus(value: string): string {
  return STATUS_LABEL[value] ?? value
}
