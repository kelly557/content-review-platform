/** 词库/图片库「有效时间」标签的派生与渲染工具。 */
import dayjs from 'dayjs'
import type { LibraryEffectiveStatus } from '@/types/domain'

export interface EffectiveMeta {
  status: LibraryEffectiveStatus
  /** 渲染表格单元格的副标题：YYYY-MM-DD ~ YYYY-MM-DD；永久/无范围/已停用 时为 null */
  rangeText: string | null
  /** 渲染 Tag 时的颜色 */
  color: 'default' | 'green' | 'orange' | 'red'
}

/**
 * 由服务端返回的 effective_from / effective_until / is_active 派生展示态。
 *
 * 优先级：
 *   is_active=false                 → "已停用"（default）
 *   effective_until && now > until   → "已过期"（red）
 *   effective_from  && now < from    → "未生效"（orange）
 *   范围都设置 且 区间内             → "生效中"（green）
 *   范围都为空                       → "永久"（default）
 *   范围半填（在范围内）              → "生效中"（green）
 */
export function deriveEffectiveMeta(
  is_active: boolean,
  effective_from: string | null,
  effective_until: string | null,
  now: dayjs.Dayjs = dayjs(),
): EffectiveMeta {
  if (!is_active) {
    return { status: '已停用', rangeText: null, color: 'default' }
  }

  const ef = effective_from ? dayjs(effective_from) : null
  const eu = effective_until ? dayjs(effective_until) : null

  if (eu && now.isAfter(eu)) {
    return {
      status: '已过期',
      rangeText: rangeText(ef, eu),
      color: 'red',
    }
  }
  if (ef && now.isBefore(ef)) {
    return {
      status: '未生效',
      rangeText: rangeText(ef, eu),
      color: 'orange',
    }
  }
  const hasAny = ef !== null || eu !== null
  return {
    status: hasAny ? '生效中' : '永久',
    rangeText: hasAny ? rangeText(ef, eu) : null,
    color: hasAny ? 'green' : 'default',
  }
}

function rangeText(
  ef: dayjs.Dayjs | null,
  eu: dayjs.Dayjs | null,
): string | null {
  const f = ef ? ef.format('YYYY-MM-DD') : null
  const u = eu ? eu.format('YYYY-MM-DD') : null
  if (!f && !u) return null
  return `${f ?? '—'} ~ ${u ?? '—'}`
}
