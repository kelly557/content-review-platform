/**
 * 通用图片/文本审核规则 — 列表页
 *
 * 视觉与行为故意与个性化页不同：
 * - 顶栏仅有「刷新」(无「新建规则」)
 * - 行操作只有「切换版本」(无「配置」)
 * - 「审核模型」列为「审核模型·版本」
 * - 标签 [通用] 蓝底
 */
import { useEffect, useMemo, useState } from 'react'
import { Breadcrumb, Button, Empty, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link, useParams } from 'react-router-dom'
import { auditItemsApi } from '@/api/auditItems'
import type { AuditItem, MediaTypeKey } from '@/types/domain'
import SmallModelChooseModal from './SmallModelChooseModal'

const { Text, Title } = Typography

const MEDIA_LABEL: Record<MediaTypeKey, string> = {
  image: '图片',
  text: '文本',
  audio: '音频',
  doc: '文档',
  video: '视频',
}

export default function GeneralRuleListPage({
  embedded = false,
  mediaTypeProp,
}: {
  embedded?: boolean
  mediaTypeProp?: MediaTypeKey
}) {
  const params = useParams<{ mediaType: MediaTypeKey }>()
  const mediaType = (mediaTypeProp ?? params.mediaType ?? 'image') as MediaTypeKey
  const [items, setItems] = useState<AuditItem[]>([])
  const [loading, setLoading] = useState(false)
  const [switchTarget, setSwitchTarget] = useState<AuditItem | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      const all = await auditItemsApi.listByMediaType(mediaType)
      setItems(all.filter((it) => it.is_builtin))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [mediaType])

  const columns: ColumnsType<AuditItem> = useMemo(
    () => [
      {
        title: '规则名',
        dataIndex: 'name_cn',
        width: '28%',
        render: (v: string, row) => (
          <Link to={`/rules/general/${mediaType}/${row.id}`}>
            <Text strong>{v}</Text>
          </Link>
        ),
      },
      {
        title: '审核模型',
        key: 'active_model',
        width: '18%',
        render: (_, row) => {
          const mv = row.active_model_version
          if (!mv) {
            return (
              <Text type="secondary" style={{ fontStyle: 'italic' }}>
                (未指定)
              </Text>
            )
          }
          return (
            <Space size={4} wrap>
              <Text>{mv.model_name}</Text>
            </Space>
          )
        },
      },
      {
        title: '版本',
        key: 'active_version',
        width: '18%',
        render: (_, row) => {
          const mv = row.active_model_version
          if (!mv) {
            return (
              <Text type="secondary" style={{ fontStyle: 'italic' }}>
                —
              </Text>
            )
          }
          return (
            <Space size={4} wrap>
              <Text style={{ fontVariantNumeric: 'tabular-nums' }}>
                v{mv.version_no}
                {mv.version_label ? ` (${mv.version_label})` : ''}
              </Text>
            </Space>
          )
        },
      },
      {
        title: '启用',
        dataIndex: 'is_enabled',
        width: '12%',
        render: (v: boolean) => (
          <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: '24%',
        render: (_, row) => (
          <Space>
            <Button
              size="small"
              type="primary"
              ghost
              onClick={() => setSwitchTarget(row)}
            >
              切换版本
            </Button>
            <Link to={`/rules/general/${mediaType}/${row.id}`}>
              <Button size="small" type="link">
                查看
              </Button>
            </Link>
          </Space>
        ),
      },
    ],
    [mediaType],
  )

  return (
    <div style={{ width: '100%' }}>
      {!embedded && (
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={[
            { title: <Link to="/strategies">策略中心</Link> },
            { title: '审核策略' },
            { title: `${MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则` },
            { title: <Tag color="blue">通用</Tag> },
          ]}
        />
      )}
      {!embedded && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <Space>
            <Title level={4} style={{ margin: 0 }}>
              通用{MEDIA_LABEL[mediaType as MediaTypeKey] ?? mediaType}审核规则
            </Title>
            <Tag color="blue">通用</Tag>
          </Space>
          <Space>
            <Button onClick={() => void reload()}>刷新</Button>
          </Space>
        </div>
      )}
      <Table<AuditItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        size="middle"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无通用规则，请联系平台运营"
              style={{ padding: '24px 0' }}
            />
          ),
        }}
      />
      <SmallModelChooseModal
        item={switchTarget}
        mediaType={mediaType}
        onClose={() => setSwitchTarget(null)}
        onSaved={async () => {
          setSwitchTarget(null)
          await reload()
        }}
      />
    </div>
  )
}