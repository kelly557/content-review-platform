import { useState } from 'react'
import { Tabs, type TabsProps } from 'antd'
import { CATEGORIES, type CategoryKey } from './constants'
import RulesTreeView from './RulesTreeView'
import {
  type MediaPointMap,
  type MediaPointOverrideMap,
  type PointMap,
} from './pointLevel'

const PACKAGE_BY_MEDIA: Record<CategoryKey, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

interface Props {
  /** 已选 item id 集合（由父级根据 point 勾选反推） */
  enabledItemIds: Record<CategoryKey, number[]>
  pointMap: MediaPointMap
  pointOverrides: MediaPointOverrideMap
  onPointMapChange: (next: MediaPointMap) => void
  onPointOverrideChange: (
    media: CategoryKey,
    itemId: number,
    pointId: number,
    override: { medium_threshold?: number; high_threshold?: number; linked_library_ids?: number[] },
  ) => void
  onPointToggle: (
    media: CategoryKey,
    itemId: number,
    pointId: number,
    checked: boolean,
  ) => void
  defaultActiveKey?: CategoryKey
}

export default function StrategyTypeTabs({
  enabledItemIds,
  pointMap,
  pointOverrides,
  onPointMapChange,
  onPointOverrideChange,
  onPointToggle,
  defaultActiveKey = 'image',
}: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>(defaultActiveKey)

  const setPointsForItem = (media: CategoryKey, itemId: number, next: PointMap) => {
    onPointMapChange({ ...pointMap, [media]: { ...pointMap[media], [itemId]: next } })
  }

  const items: TabsProps['items'] = CATEGORIES.map((cat) => {
    const selectedItems = enabledItemIds[cat.key] ?? []
    const overriddenCount = Object.keys(pointMap[cat.key] ?? {}).filter((itemIdStr) => {
      const itemId = Number(itemIdStr)
      const itemMap = pointMap[cat.key]?.[itemId] ?? {}
      return Object.values(itemMap).some((v) => v === false)
    }).length
    const totalPoints = Object.values(pointMap[cat.key] ?? {}).reduce(
      (n, itemMap) => n + Object.values(itemMap).filter((v) => v === true).length,
      0,
    )
    return {
      key: cat.key,
      label: (
        <span>
          {cat.label}
          {totalPoints > 0 ? ` (${totalPoints})` : ''}
          {overriddenCount > 0 ? (
            <span style={{ color: '#F59E0B', marginLeft: 4 }}>
              ·{overriddenCount} 已细化
            </span>
          ) : null}
        </span>
      ),
      children: (
        <RulesTreeView
          packageCode={PACKAGE_BY_MEDIA[cat.key]}
          enabledItemIds={selectedItems}
          getPointMap={(itemId) => pointMap[cat.key]?.[itemId] ?? {}}
          onPointMapChange={(itemId, next) => setPointsForItem(cat.key, itemId, next)}
          pointOverrides={pointOverrides}
          onPointOverrideChange={(itemId, pointId, override) =>
            onPointOverrideChange(cat.key, itemId, pointId, override)
          }
          onPointToggle={(itemId, pointId, checked) =>
            onPointToggle(cat.key, itemId, pointId, checked)
          }
        />
      ),
    }
  })

  return (
    <Tabs
      type="line"
      activeKey={activeCategory}
      onChange={(k) => setActiveCategory(k as CategoryKey)}
      destroyOnHidden={false}
      items={items}
    />
  )
}