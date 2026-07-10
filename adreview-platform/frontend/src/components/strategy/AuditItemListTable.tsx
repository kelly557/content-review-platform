import { useEffect, useMemo, useState } from 'react'
import { Empty, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import type { AuditItem } from '@/types/domain'

const { Text } = Typography

const PACKAGE_BY_MEDIA: Record<string, string | null> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

interface Props {
  mediaType: string
}

export default function AuditItemListTable({ mediaType }: Props) {
  const packageCode = PACKAGE_BY_MEDIA[mediaType] ?? null
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!packageCode) {
      setItems([])
      return
    }
    setLoading(true)
    auditItemsApi
      .list(packageCode)
      .then(setItems)
      .finally(() => setLoading(false))
  }, [packageCode])

  const { builtinItems, customItems } = useMemo(() => {
    const b: AuditItem[] = []
    const c: AuditItem[] = []
    items.forEach((it) => {
      if (it.is_builtin) b.push(it)
      else c.push(it)
    })
    return { builtinItems: b, customItems: c }
  }, [items])

  const columns: ColumnsType<AuditItem> = [
    {
      title: '名称',
      dataIndex: 'name_cn',
      width: '22%',
      render: (v: string) => (
        <Text strong style={{ color: '#020617' }}>
          {v}
        </Text>
      ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: '36%',
      render: (v: string | null) =>
        v ? (
          <Text type="secondary">{v}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: '22%',
      render: (v: string | null) =>
        v ? (
          <Text style={{ fontVariantNumeric: 'tabular-nums' }}>
            {dayjs(v).format('YYYY-MM-DD HH:mm:ss')}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '操作',
      width: '20%',
      render: (_, row) => (
        <Link to={`/strategies/rules-by-type/${mediaType}/${row.id}`}>
          配置
        </Link>
      ),
    },
  ]

  if (!packageCode) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该类型暂无规则"
        style={{ padding: '24px 0' }}
      />
    )
  }

  const empty = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="该类型暂无规则"
      style={{ padding: '24px 0' }}
    />
  )

  const renderGroup = (groupItems: AuditItem[], groupTitle: string) => (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: '#475569',
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          padding: '6px 12px',
          marginBottom: 8,
        }}
      >
        {groupTitle}
      </div>
      <Table<AuditItem>
        rowKey="id"
        loading={loading}
        dataSource={groupItems}
        columns={columns}
        pagination={false}
        size="middle"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`暂无${groupTitle}`}
              style={{ padding: '12px 0' }}
            />
          ),
        }}
      />
    </div>
  )

  return (
    <div style={{ width: '100%' }}>
      {renderGroup(builtinItems, '通用规则（平台预置，仅允许启用 / 调整风险分 / 关联自定义库）')}
      {renderGroup(customItems, '个性化规则')}
      {items.length === 0 && !loading && empty}
    </div>
  )
}