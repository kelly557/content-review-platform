/**
 * 通用图片/文本审核规则 — 详情页（只读）
 *
 * 仅展示规则元信息 + 审核点 + 审核说明，不可编辑。
 */
import { useEffect, useState } from 'react'
import { Breadcrumb, Empty, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import { auditPointsApi } from '@/api/auditPoints'
import type { AuditItem, AuditPoint, MediaTypeKey } from '@/types/domain'

const { Title } = Typography

const PACKAGE_BY_MEDIA: Record<MediaTypeKey, string> = {
  image: 'image_audit_pro',
  text: 'text_audit_pro',
  audio: 'audio_audit_pro',
  doc: 'document_audit_pro',
  video: 'video_audit_pro',
}

const MEDIA_LABEL: Record<MediaTypeKey, string> = {
  image: '图片',
  text: '文本',
  audio: '音频',
  doc: '文档',
  video: '视频',
}

export default function GeneralRuleDetailPage() {
  const { mediaType = 'image', itemId = '' } = useParams<{
    mediaType: MediaTypeKey
    itemId: string
  }>()
  const [item, setItem] = useState<AuditItem | null>(null)
  const [points, setPoints] = useState<AuditPoint[]>([])
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const pkg = PACKAGE_BY_MEDIA[mediaType as MediaTypeKey] ?? mediaType
      const list = await auditItemsApi.list(pkg)
      const target = list.find((it) => it.id === Number(itemId))
      setItem(target ?? null)
      if (target) {
        const ps = await auditPointsApi.list(pkg, { item_id: target.id })
        setPoints(ps)
      } else {
        setPoints([])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType, itemId])

  const pointColumns: ColumnsType<AuditPoint> = [
    { title: '审核点', dataIndex: 'label_cn', width: '28%' },
    { title: '审核说明', dataIndex: 'description', width: '72%' },
  ]

  return (
    <div style={{ width: '100%' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/strategies">策略中心</Link> },
          { title: '审核策略' },
          {
            title: (
              <Link to={`/rules/general/${mediaType}`}>
                {MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则
              </Link>
            ),
          },
          { title: <Tag color="blue">通用</Tag> },
        ]}
      />

      {item ? (
        <>
          <Space style={{ marginBottom: 16 }}>
            <Title level={4} style={{ margin: 0 }}>
              {item.name_cn}
            </Title>
            <Tag color="blue">通用</Tag>
            <Tag color={item.is_enabled ? 'green' : 'default'}>
              {item.is_enabled ? '已启用' : '已停用'}
            </Tag>
          </Space>

          <Table<AuditPoint>
            rowKey="id"
            loading={loading}
            dataSource={points}
            columns={pointColumns}
            pagination={false}
            size="middle"
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="该规则下暂无审核点"
                  style={{ padding: '12px 0' }}
                />
              ),
            }}
          />
        </>
      ) : (
        <Empty description={loading ? '加载中...' : '未找到该规则'} />
      )}
    </div>
  )
}