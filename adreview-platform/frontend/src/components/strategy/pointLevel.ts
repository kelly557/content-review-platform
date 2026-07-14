import type { CategoryKey } from './constants'
import type { AuditPoint, StrategyPointRef } from '@/types/domain'

export type PointMap = Record<number, boolean>
export type ItemPointMap = Record<number, PointMap>
export type MediaPointMap = Record<CategoryKey, ItemPointMap>

/** 单个 point 的策略级 override（中/高风险分）。
 * 关联自定义图库词库已上移至审核项；策略级不再持有 linked_library_ids override。 */
export interface PointOverride {
  medium_threshold?: number
  high_threshold?: number
}
/** itemId → pointId → override */
export type ItemPointOverrideMap = Record<number, Record<number, PointOverride>>
/** media → item → point → override */
export type MediaPointOverrideMap = Record<CategoryKey, ItemPointOverrideMap>

export const EMPTY_MEDIA_POINTS: MediaPointMap = {
  image: {},
  text: {},
  audio: {},
  doc: {},
  video: {},
}

export const EMPTY_MEDIA_OVERRIDES: MediaPointOverrideMap = {
  image: {},
  text: {},
  audio: {},
  doc: {},
  video: {},
}

export function countEnabledPoints(map: MediaPointMap): number {
  let n = 0
  for (const byItem of Object.values(map)) {
    for (const byPoint of Object.values(byItem)) {
      for (const v of Object.values(byPoint)) {
        if (v === true) n += 1
      }
    }
  }
  return n
}

export function countExplicitOverrides(map: MediaPointMap): number {
  let n = 0
  for (const byItem of Object.values(map)) {
    for (const byPoint of Object.values(byItem)) {
      for (const v of Object.values(byPoint)) {
        if (v === false) n += 1
      }
    }
  }
  return n
}

export function hasAnyOverride(map: MediaPointMap): boolean {
  for (const byItem of Object.values(map)) {
    if (Object.keys(byItem).length > 0) return true
  }
  return false
}

export function flattenEnabledPoints(
  map: MediaPointMap,
): StrategyPointRef[] {
  const out: StrategyPointRef[] = []
  for (const [media_type, byItem] of Object.entries(map) as [
    CategoryKey,
    ItemPointMap,
  ][]) {
    for (const [itemIdStr, byPoint] of Object.entries(byItem)) {
      const item_id = Number(itemIdStr)
      for (const [pointIdStr, is_enabled] of Object.entries(byPoint)) {
        const point_id = Number(pointIdStr)
        out.push({ media_type, item_id, point_id, is_enabled })
      }
    }
  }
  return out
}

/**
 * 同时把 MediaPointOverrideMap 中的覆盖（中/高风险分）合并到结果。
 * 仅对 is_enabled=true 的 point 输出 override；is_enabled=false 不带。
 * 「关联自定义图库词库」已从策略级 override 移除（已上移至审核项）。
 */
export function flattenEnabledPointsWithOverride(
  pointMap: MediaPointMap,
  overrideMap: MediaPointOverrideMap,
): StrategyPointRef[] {
  const out: StrategyPointRef[] = []
  for (const [media_type, byItem] of Object.entries(pointMap) as [
    CategoryKey,
    ItemPointMap,
  ][]) {
    for (const [itemIdStr, byPoint] of Object.entries(byItem)) {
      const item_id = Number(itemIdStr)
      const itemOverride = overrideMap[media_type]?.[item_id] ?? {}
      for (const [pointIdStr, is_enabled] of Object.entries(byPoint)) {
        const point_id = Number(pointIdStr)
        const ov = itemOverride[point_id] ?? {}
        const ref: StrategyPointRef = {
          media_type,
          item_id,
          point_id,
          is_enabled,
        }
        if (is_enabled) {
          if (ov.medium_threshold !== undefined)
            ref.medium_threshold = ov.medium_threshold
          if (ov.high_threshold !== undefined)
            ref.high_threshold = ov.high_threshold
        }
        out.push(ref)
      }
    }
  }
  return out
}

export function buildPointMapFromStrategy(
  refs: StrategyPointRef[] | undefined,
): MediaPointMap {
  const out: MediaPointMap = {
    image: {},
    text: {},
    audio: {},
    doc: {},
    video: {},
  }
  if (!refs || refs.length === 0) return out
  for (const r of refs) {
    if (!r) continue
    const media = r.media_type as CategoryKey
    if (!(media in out)) continue
    if (!out[media][r.item_id]) out[media][r.item_id] = {}
    out[media][r.item_id][r.point_id] = r.is_enabled
  }
  return out
}

export function isItemOverridden(
  map: MediaPointMap,
  media: CategoryKey,
  itemId: number,
): boolean {
  return Object.keys(map[media]?.[itemId] ?? {}).length > 0
}

export function selectAllPoints(
  points: AuditPoint[],
  current: PointMap,
): PointMap {
  const next: PointMap = { ...current }
  for (const p of points) next[p.id] = true
  return next
}

export function selectNonePoints(
  points: AuditPoint[],
  current: PointMap,
): PointMap {
  const next: PointMap = { ...current }
  for (const p of points) next[p.id] = false
  return next
}

export function invertPoints(
  points: AuditPoint[],
  current: PointMap,
): PointMap {
  const next: PointMap = { ...current }
  for (const p of points) {
    next[p.id] = !next[p.id]
  }
  return next
}

export function selectLowRiskOnly(
  points: AuditPoint[],
  current: PointMap,
): PointMap {
  const next: PointMap = { ...current }
  for (const p of points) {
    if (p.risk_level === '低风险') next[p.id] = true
    else next[p.id] = false
  }
  return next
}
