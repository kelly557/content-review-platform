import { useEffect, useState } from 'react'
import {
  Tabs,
  Space,
  Badge,
  Tag,
  Typography,
  App,
  Tooltip,
} from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import ServiceRuleTable from '@/components/ServiceRuleTable'
import {
  CATEGORIES,
  MEDIA_TYPE_LABELS,
  expandCategoryNames,
  type CategoryKey,
} from './constants'

const { Text } = Typography

interface Props {
  value: string[]
  onChange: (codes: string[]) => void
  onCountChange?: (counts: Record<CategoryKey, number>) => void
  defaultActiveKey?: CategoryKey
}

const ZERO_COUNTS: Record<CategoryKey, number> = {
  image: 0,
  text: 0,
  audio: 0,
  doc: 0,
  video: 0,
}

function filterCodesBySourceCategory(
  codes: string[],
  allVisibleCodes: Set<string>,
  sourceCategoryNames: string[],
  categoryIndexMap: Record<string, number>,
  codeCategoryMap: Map<string, number | null>,
): Set<string> {
  if (!sourceCategoryNames.length) return new Set()
  const want = new Set<number>()
  sourceCategoryNames.forEach((n) => {
    const id = categoryIndexMap[n]
    if (typeof id === 'number') want.add(id)
  })
  const out = new Set<string>()
  codes.forEach((code) => {
    if (!allVisibleCodes.has(code)) return
    const catId = codeCategoryMap.get(code)
    if (catId != null && want.has(catId)) {
      out.add(code)
    }
  })
  return out
}

export default function StrategyTypeTabs({
  value,
  onChange,
  onCountChange,
  defaultActiveKey = 'image',
}: Props) {
  const { message } = App.useApp()
  const [activeCategory, setActiveCategory] = useState<CategoryKey>(defaultActiveKey)
  const [counts, setCounts] = useState<Record<CategoryKey, number>>(ZERO_COUNTS)
  const [categories, setCategories] = useState<
    Array<{ id: number; name: string }>
  >([])
  const [visibleCodes, setVisibleCodes] = useState<Set<string>>(new Set())
  const [codeCategoryMap, setCodeCategoryMap] = useState<Map<string, number | null>>(
    new Map(),
  )

  useEffect(() => {
    let cancelled = false
    import('@/api/serviceCategories')
      .then(({ serviceCategoriesApi }) =>
        serviceCategoriesApi.list({ size: 200 }).then((data) => {
          if (cancelled) return
          setCategories(
            data.items
              .filter((c) => c.is_active)
              .map((c) => ({ id: c.id, name: c.name })),
          )
        }),
      )
      .catch(() => {
        // ignore
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    onCountChange?.(counts)
  }, [counts, onCountChange])

  const resolveCategoryIds = (names: string[]): number[] => {
    if (!names.length) return []
    return names
      .map((n) => categories.find((c) => c.name === n)?.id)
      .filter((id): id is number => typeof id === 'number')
  }

  const onVisibleCodes = (
    codes: string[],
    categoryByCode: Array<{ code: string; category_id: number | null }>,
  ) => {
    setVisibleCodes(new Set(codes))
    setCodeCategoryMap(
      new Map(categoryByCode.map((c) => [c.code, c.category_id ?? null])),
    )
  }

  const handleCopyFromSource = (sourceKey: CategoryKey) => {
    const source = CATEGORIES.find((c) => c.key === sourceKey)
    if (!source) {
      message.warning('源类型不存在')
      return
    }
    const sourceCategoryNames =
      source.categoryNames.length > 0
        ? source.categoryNames
        : expandCategoryNames(sourceKey)
    const categoryIndexMap: Record<string, number> = {}
    categories.forEach((c) => {
      categoryIndexMap[c.name] = c.id
    })
    const sourceSet = filterCodesBySourceCategory(
      value,
      visibleCodes,
      sourceCategoryNames,
      categoryIndexMap,
      codeCategoryMap,
    )
    if (sourceSet.size === 0) {
      message.info(
        `「${MEDIA_TYPE_LABELS[sourceKey]}」下暂无可加入的规则，请先到对应类型下选择。`,
      )
      return
    }
    const next = Array.from(new Set([...value, ...sourceSet]))
    onChange(next)
    message.success(`已从「${MEDIA_TYPE_LABELS[sourceKey]}」加入 ${sourceSet.size} 项`)
  }

  return (
    <Tabs
      type="line"
      activeKey={activeCategory}
      onChange={(k) => setActiveCategory(k as CategoryKey)}
      destroyOnHidden={false}
      items={CATEGORIES.map((cat) => {
        const selectedInCat = counts[cat.key] ?? 0
        const categoryIds = resolveCategoryIds(expandCategoryNames(cat.key))
        const noPreset = cat.categoryNames.length === 0
        return {
          key: cat.key,
          label: (
            <Space size={6} wrap align="center">
              <span>{cat.label}</span>
              {selectedInCat > 0 ? (
                <Badge
                  count={selectedInCat}
                  showZero={false}
                  style={{ backgroundColor: '#0369A1', color: '#fff' }}
                  title={`本类已选 ${selectedInCat} 项`}
                />
              ) : null}
            </Space>
          ),
          children: (
            <div>
              {cat.description && (
                <Text
                  type="secondary"
                  style={{ fontSize: 13, display: 'block', marginBottom: 12 }}
                >
                  {cat.description}
                </Text>
              )}
              {noPreset && !cat.composesFrom?.length && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    该审核类型下暂无系统预置规则，但支持新增自定义规则。
                  </Text>
                </div>
              )}
              {cat.allowCopyFromSources && cat.composesFrom && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: '8px 12px',
                    background: '#F0F9FF',
                    border: '1px solid #BAE6FD',
                    borderRadius: 6,
                  }}
                >
                  <Space size={8} wrap>
                    <Text strong style={{ fontSize: 13 }}>
                      一键复用合成来源规则：
                    </Text>
                    {cat.composesFrom.map((src) => (
                      <Tooltip
                        key={src}
                        title={`将「${MEDIA_TYPE_LABELS[src]}」中已选规则同步加入当前类型`}
                      >
                        <Tag
                          color="blue"
                          icon={<CopyOutlined />}
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleCopyFromSource(src)}
                          aria-label={`从${MEDIA_TYPE_LABELS[src]}复制规则`}
                        >
                          从{MEDIA_TYPE_LABELS[src]}复制
                        </Tag>
                      </Tooltip>
                    ))}
                  </Space>
                </div>
              )}
              <ServiceRuleTable
                key={cat.key}
                value={value}
                onChange={onChange}
                categoryIds={categoryIds}
                categoryName={
                  cat.categoryNames.length > 0 ? cat.categoryNames[0] : cat.label
                }
                emptyHint={
                  noPreset && !cat.composesFrom?.length
                    ? `${cat.label} - 暂无规则`
                    : `${cat.label} - 暂无可选规则`
                }
                onCategoryCountChange={(n) =>
                  setCounts((prev) =>
                    prev[cat.key] === n ? prev : { ...prev, [cat.key]: n },
                  )
                }
                onVisibleItems={onVisibleCodes}
              />
              <div style={{ marginTop: 12 }}>
                <Tag color="blue">本类已选 {selectedInCat} 项</Tag>
              </div>
            </div>
          ),
        }
      })}
    />
  )
}
