import { useEffect, useState } from 'react'
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

  const columns: ColumnsType<AuditItem> = [
    {
      title: '名称',
      dataIndex: 'name_cn',
      width: '35%',
      render: (v: string) => (
        <Text strong style={{ color: '#020617' }}>
          {v}
        </Text>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: '35%',
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
      width: '30%',
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

  return (
    <Table<AuditItem>
      rowKey="id"
      loading={loading}
      dataSource={items}
      columns={columns}
      pagination={false}
      scroll={{ x: true }}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该类型暂无规则"
            style={{ padding: '24px 0' }}
          />
        ),
      }}
    />
  )
}