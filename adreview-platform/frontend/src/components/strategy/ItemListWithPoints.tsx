import { useEffect, useState } from 'react'
import { Alert, Empty, Table, Tooltip, Typography } from 'antd'
import { DownOutlined, RightOutlined, StarFilled } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { auditItemsApi } from '@/api/auditItems'
import type { AuditItem } from '@/types/domain'
import PointSubTable from './PointSubTable'
import type { PointMap } from './pointLevel'

const { Text } = Typography

interface Props {
  packageCode: string | null
  selectedItemIds: number[]
  /** 该 media 下、该 item 的 point 选择 map。父组件按 itemId 透传切片。 */
  getPointMap: (itemId: number) => PointMap
  isItemOverriddenFlag: (itemId: number) => boolean
  onItemToggle: (itemId: number, checked: boolean) => void
  onPointMapChange: (itemId: number, next: PointMap) => void
}

export default function ItemListWithPoints({
  packageCode,
  selectedItemIds,
  getPointMap,
  isItemOverriddenFlag,
  onItemToggle,
  onPointMapChange,
}: Props) {
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!packageCode) {
      setItems([])
      return
    }
    let cancelled = false
    setLoading(true)
    auditItemsApi
      .list(packageCode)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [packageCode])

  if (!packageCode) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该审核类型暂无规则包"
        style={{ padding: '24px 0' }}
      />
    )
  }

  const selectedSet = new Set(selectedItemIds)

  const toggleExpand = (itemId: number) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const columns: ColumnsType<AuditItem> = [
    {
      title: '启用',
      key: 'enabled',
      width: 60,
      render: (_v, row) => (
        <input
          type="checkbox"
          checked={selectedSet.has(row.id)}
          onChange={(e) => onItemToggle(row.id, e.target.checked)}
          aria-label={`启用 ${row.name_cn}`}
        />
      ),
    },
    {
      title: '规则',
      dataIndex: 'name_cn',
      width: '20%',
      render: (v: string, row) => {
        const overridden = isItemOverriddenFlag(row.id)
        const isExpanded = expandedKeys.has(row.id)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <a
                onClick={() => toggleExpand(row.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                aria-label={isExpanded ? '收起审核点' : '展开审核点'}
              >
                {isExpanded ? <DownOutlined /> : <RightOutlined />}
                <Text strong style={{ color: '#020617' }}>
                  {v}
                </Text>
              </a>
              {overridden && (
                <Tooltip title="该规则下审核点已被细化选择">
                  <StarFilled style={{ color: '#F59E0B', fontSize: 11 }} />
                </Tooltip>
              )}
            </div>
            <Text
              type="secondary"
              style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}
            >
              {row.code}
            </Text>
          </div>
        )
      },
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: '36%',
      render: (v: string | null) =>
        v ? <Text>{v}</Text> : <Text type="secondary">—</Text>,
    },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="勾选「规则」= 启用整条规则；点击行左侧箭头展开后，可对下属审核点逐个细选。未展开的规则 = 该规则下所有点跟随默认（系统启用即启用）。"
      />
      <Table<AuditItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        size="middle"
        expandable={{
          showExpandColumn: false,
          expandedRowKeys: Array.from(expandedKeys),
          expandedRowRender: (row) => (
            <PointSubTable
              packageCode={packageCode}
              itemId={row.id}
              pointMap={getPointMap(row.id)}
              itemEnabled={selectedSet.has(row.id)}
              onChange={(next) => onPointMapChange(row.id, next)}
            />
          ),
        }}
      />
    </div>
  )
}
