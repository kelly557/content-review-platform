import { useEffect, useState } from 'react'
import {
  Tabs,
  Table,
  Typography,
  Empty,
  Tooltip,
  Space,
  type TableColumnsType,
} from 'antd'
import { Link } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import {
  CATEGORIES,
  MEDIA_TYPE_LABELS,
  type CategoryKey,
} from './constants'
import type { AuditItem } from '@/types/domain'

const { Text } = Typography

interface Props {
  /** 启用的 item id 集合 (按 media_type 划分). */
  value: Record<CategoryKey, number[]>
  onChange: (next: Record<CategoryKey, number[]>) => void
  defaultActiveKey?: CategoryKey
}

const EMPTY_ITEMS: Record<CategoryKey, AuditItem[]> = {
  image: [],
  text: [],
  audio: [],
  doc: [],
  video: [],
}

export default function StrategyTypeTabs({
  value,
  onChange,
  defaultActiveKey = 'image',
}: Props) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>(defaultActiveKey)
  const [itemsByMedia, setItemsByMedia] = useState<
    Record<CategoryKey, AuditItem[]>
  >({ image: [], text: [], audio: [], doc: [], video: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all(
      CATEGORIES.map(async (c) => {
        try {
          const list = await auditItemsApi.listByMediaType(c.key)
          return [c.key, list] as const
        } catch {
          return [c.key, [] as AuditItem[]] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      const map: Record<CategoryKey, AuditItem[]> = { ...EMPTY_ITEMS }
      entries.forEach(([k, list]) => {
        map[k] = list
      })
      setItemsByMedia(map)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleItem = (media: CategoryKey, itemId: number, checked: boolean) => {
    const current = value[media] ?? []
    const set = new Set(current)
    if (checked) {
      set.add(itemId)
    } else {
      set.delete(itemId)
    }
    onChange({ ...value, [media]: Array.from(set) })
  }

  const columns: TableColumnsType<AuditItem> = [
    {
      title: '启用',
      key: 'enabled',
      width: '8%',
      render: (_v, row) => (
        <input
          type="checkbox"
          checked={(value[activeCategory] ?? []).includes(row.id)}
          onChange={(e) => toggleItem(activeCategory, row.id, e.target.checked)}
          aria-label={`启用 ${row.name_cn}`}
        />
      ),
    },
    {
      title: '业务规则',
      dataIndex: 'name_cn',
      width: '20%',
      render: (v: string, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
            {row.code}
          </Text>
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: '40%',
      render: (v: string | null) =>
        v ? <Text>{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '细分点',
      dataIndex: 'point_count',
      width: '10%',
      render: (n: number, row) => (
        <Tooltip title="该规则下的细分审核点（阈值 / 词库等可在审核点页面配置）">
          <Link to={`/strategies/rules-by-type/${activeCategory}/${row.id}`}>
            <Text style={{ color: '#0369A1' }}>{n} 项</Text>
          </Link>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      width: '12%',
      render: (enabled: boolean) => (
        <Text style={{ color: enabled ? '#16A34A' : '#94A3B8' }}>
          {enabled ? '系统启用' : '系统停用'}
        </Text>
      ),
    },
  ]

  return (
    <Tabs
      type="line"
      activeKey={activeCategory}
      onChange={(k) => setActiveCategory(k as CategoryKey)}
      destroyOnHidden={false}
      items={CATEGORIES.map((cat) => {
        const list = itemsByMedia[cat.key] ?? []
        const selected = value[cat.key] ?? []
        return {
          key: cat.key,
          label: (
            <span>
              {cat.label}
              {selected.length > 0 ? ` (${selected.length})` : ''}
            </span>
          ),
          children: (
            <Table<AuditItem>
              rowKey="id"
              loading={loading}
              dataSource={list}
              columns={columns}
              pagination={false}
              size="middle"
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={`${MEDIA_TYPE_LABELS[cat.key]}暂无规则`}
                  />
                ),
              }}
            />
          ),
        }
      })}
    />
  )
}