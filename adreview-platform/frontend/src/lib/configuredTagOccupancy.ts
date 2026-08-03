import type { ConfiguredTagEntry } from '@/pages/admin/configuredTagTypes'

export interface OccupancyMap {
  occupiedByOther: Set<string>
  occupiedBySelf: Set<string>
}

export function computeOccupancy(
  models: { configuredTags?: ConfiguredTagEntry[] }[],
  currentModelId: number | string,
): OccupancyMap {
  const occupiedByOther = new Set<string>()
  const occupiedBySelf = new Set<string>()
  for (const m of models) {
    const isSelf =
      (m as { id?: number | string }).id === currentModelId
    const tags = m.configuredTags ?? []
    for (const e of tags) {
      if (isSelf) occupiedBySelf.add(e.tagId)
      else occupiedByOther.add(e.tagId)
    }
  }
  return { occupiedByOther, occupiedBySelf }
}