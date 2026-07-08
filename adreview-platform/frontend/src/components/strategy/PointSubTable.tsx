import { useEffect, useState } from 'react'
import { Alert, Empty, Skeleton, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditPoint } from '@/types/domain'
import PointQuickBar from './PointQuickBar'
import {
  invertPoints,
  selectAllPoints,
  selectLowRiskOnly,
  selectNonePoints,
  type PointMap,
} from './pointLevel'

const { Text } = Typography

const RISK_COLOR: Record<AuditPoint['risk_level'], string> = {
  低风险: 'green',
  中风险: 'blue',
  高风险: 'red',
}

interface Props {
  packageCode: string
  itemId: number
  pointMap: PointMap
  itemEnabled: boolean
  onChange: (next: PointMap) => void
}

export default function PointSubTable({
  packageCode,
  itemId,
  pointMap,
  itemEnabled,
  onChange,
}: Props) {
  const [points, setPoints] = useState<AuditPoint[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    auditPointsApi
      .list(packageCode, { item_id: itemId })
      .then((list) => {
        if (!cancelled) setPoints(list)
      })
      .catch(() => {
        if (!cancelled) setPoints([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [packageCode, itemId])

  const toggle = (pointId: number, checked: boolean) => {
    onChange({ ...pointMap, [pointId]: checked })
  }

  const selectedCount = points.reduce(
    (n, p) => (pointMap[p.id] === true ? n + 1 : n),
    0,
  )

  const columns: ColumnsType<AuditPoint> = [
    {
      title: '启用',
      key: 'enabled',
      width: 64,
      render: (_v, row) => (
        <input
          type="checkbox"
          checked={pointMap[row.id] === true}
          disabled={!itemEnabled}
          onChange={(e) => toggle(row.id, e.target.checked)}
          aria-label={`启用审核点 ${row.label_cn}`}
        />
      ),
    },
    {
      title: '审核点',
      dataIndex: 'label_cn',
      width: '20%',
      render: (v: string) => (
        <Text strong style={{ color: itemEnabled ? '#020617' : '#94A3B8' }}>
          {v}
        </Text>
      ),
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      width: '12%',
      render: (v: AuditPoint['risk_level']) => (
        <Tag color={RISK_COLOR[v]} bordered={false}>
          {v}
        </Tag>
      ),
    },
    {
      title: '审核内容',
      dataIndex: 'description',
      render: (v: string | null) =>
        v ? <Text>{v}</Text> : <Text type="secondary">—</Text>,
    },
  ]

  if (loading) {
    return <Skeleton active paragraph={{ rows: 3 }} />
  }

  if (points.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该规则下暂无审核点"
        style={{ padding: '16px 0' }}
      />
    )
  }

  return (
    <div
      style={{
        background: itemEnabled ? '#F8FAFC' : '#F1F5F9',
        padding: '8px 0 8px 32px',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0',
        marginTop: 4,
      }}
    >
      {!itemEnabled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8, marginRight: 16 }}
          message="该规则未启用，下方审核点不会生效，但已保留你的勾选记录"
        />
      )}
      <div style={{ marginBottom: 6, marginRight: 16 }}>
        <PointQuickBar
          total={points.length}
          selected={selectedCount}
          disabled={!itemEnabled}
          onSelectAll={() => onChange(selectAllPoints(points, pointMap))}
          onSelectNone={() => onChange(selectNonePoints(points, pointMap))}
          onInvert={() => onChange(invertPoints(points, pointMap))}
          onSelectLowRisk={() => onChange(selectLowRiskOnly(points, pointMap))}
        />
      </div>
      <Table<AuditPoint>
        rowKey="id"
        dataSource={points}
        columns={columns}
        pagination={false}
        size="small"
      />
    </div>
  )
}
