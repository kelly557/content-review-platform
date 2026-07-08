import { useState } from 'react'
import { Tabs, type TabsProps } from 'antd'
import { CATEGORIES, type CategoryKey } from './constants'
import ItemListWithPoints from './ItemListWithPoints'
import {
  isItemOverridden,
  type MediaPointMap,
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
  value: Record<CategoryKey, number[]>
  pointMap: MediaPointMap
  onChange: (next: Record<CategoryKey, number[]>) => void
  onPointMapChange: (next: MediaPointMap) => void
  defaultActiveKey?: CategoryKey
}

export default function StrategyTypeTabs({
  value,
  pointMap,
  onChange,
  onPointMapChange,
  defaultActiveKey = 'image',
}: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>(defaultActiveKey)

  const toggleItem = (media: CategoryKey, itemId: number, checked: boolean) => {
    const current = value[media] ?? []
    const set = new Set(current)
    if (checked) set.add(itemId)
    else set.delete(itemId)
    onChange({ ...value, [media]: Array.from(set) })
  }

  const setPointsForItem = (media: CategoryKey, itemId: number, next: PointMap) => {
    onPointMapChange({ ...pointMap, [media]: { ...pointMap[media], [itemId]: next } })
  }

  const items: TabsProps['items'] = CATEGORIES.map((cat) => {
    const selected = value[cat.key] ?? []
    const overriddenCount = Object.keys(pointMap[cat.key] ?? {}).filter((itemIdStr) => {
      const itemId = Number(itemIdStr)
      return isItemOverridden(pointMap, cat.key, itemId)
    }).length
    return {
      key: cat.key,
      label: (
        <span>
          {cat.label}
          {selected.length > 0 ? ` (${selected.length})` : ''}
          {overriddenCount > 0 ? (
            <span style={{ color: '#F59E0B', marginLeft: 4 }}>
              ·{overriddenCount} 已细化
            </span>
          ) : null}
        </span>
      ),
      children: (
        <ItemListWithPoints
          packageCode={PACKAGE_BY_MEDIA[cat.key]}
          selectedItemIds={selected}
          getPointMap={(itemId) => pointMap[cat.key]?.[itemId] ?? {}}
          isItemOverriddenFlag={(itemId) =>
            isItemOverridden(pointMap, cat.key, itemId)
          }
          onItemToggle={(itemId, checked) => toggleItem(cat.key, itemId, checked)}
          onPointMapChange={(itemId, next) => setPointsForItem(cat.key, itemId, next)}
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
